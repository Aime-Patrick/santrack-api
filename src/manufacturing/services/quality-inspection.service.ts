import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { User } from '../../auth/entities/user.entity';
import { BatchStatus, permitsInspection } from '../../batch/batch-status.enum';
import { Batch } from '../../batch/entities/batch.entity';
import { BatchService } from '../../batch/services/batch.service';
import { NotFoundEntityException, TraceabilityRuleException } from '../../common/errors';
import { TraceableItem } from '../../item/entities/traceable-item.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { TraceabilityEvent } from '../../traceability/entities/traceability-event.entity';
import { EventType, RELEASE_EVENTS } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import { CreateInspectionDto } from '../dto/quality-inspection.dto';
import { ProductionOrder } from '../entities/production-order.entity';
import { QualityInspection } from '../entities/quality-inspection.entity';
import { InspectionResult } from '../manufacturing.enums';

/**
 * Quality control, and the effect a verdict has.
 *
 * A verdict used to be a row nobody read: rejecting a lot changed nothing, and
 * its goods could still be registered and shipped. Now the verdict moves the
 * lot, and only an APPROVED lot may be given product identities - which is
 * §7's "Approval → Packaging → Product Registration" and use case 5's "the
 * batch becomes Approved / Rejected / Rework / Quarantine".
 *
 * **Rejection is not terminal.** Rework exists so a failed lot can be put
 * right and looked at again, so a rejected lot can be re-inspected.
 *
 * **Circulation is the boundary, not identity.** What closes the door on
 * re-inspection is not that identities exist - an approved lot sitting
 * labelled on the manufacturer's own racks has not gone anywhere - but that
 * some of it has been dispatched or sold. After that the question stops being
 * "is this good?" and becomes "where did it go?", which is the recall
 * workflow's job. Letting a later verdict quietly overwrite the original one
 * would invalidate stock in shops with no impact map, no holder notification
 * and nothing for a consumer scanning the code to see.
 */
@Injectable()
export class QualityInspectionService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(QualityInspection)
    private readonly inspections: Repository<QualityInspection>,
    private readonly recorder: EventRecorder,
    private readonly batchService: BatchService,
  ) {}

  async create(
    organization: Organization,
    inspector: User,
    dto: CreateInspectionDto,
  ): Promise<QualityInspection> {
    if (!dto.productionOrderId && !dto.batchId) {
      throw new TraceabilityRuleException(
        'A quality inspection must reference a production order or a batch',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      let productionOrder: ProductionOrder | null = null;
      if (dto.productionOrderId) {
        productionOrder = await manager.findOne(ProductionOrder, {
          where: { id: dto.productionOrderId },
        });
        if (!productionOrder || productionOrder.organization.id !== organization.id) {
          throw new NotFoundEntityException('Production order', dto.productionOrderId);
        }
      }

      // Inspecting an order inspects the lot it produced, which is what the
      // verdict actually attaches to.
      const batch = await this.resolveBatch(manager, dto.batchId, productionOrder);

      if (batch) {
        await this.requireInspectable(manager, batch);
      }

      const inspection = await manager.save(
        manager.create(QualityInspection, {
          organization,
          productionOrder,
          batch,
          inspector,
          result: dto.result,
          notes: dto.notes ?? null,
        }),
      );

      if (batch) {
        await this.applyVerdict(manager, batch, inspection, inspector, dto.result);
      }

      return inspection;
    });
  }

  async list(
    organization: Organization,
    page: number,
    size: number,
  ): Promise<{
    content: QualityInspection[];
    total: number;
    page: number;
    size: number;
  }> {
    const [content, total] = await this.inspections.findAndCount({
      where: { organization: { id: organization.id } },
      order: { testedAt: 'DESC', id: 'DESC' },
      skip: page * size,
      take: size,
    });
    return { content, total, page, size };
  }

  /**
   * Whether a lot may take a new verdict, checked before the form is submitted.
   *
   * Same rules as create — status must allow inspection, and none of the lot
   * may have been dispatched or sold. Exposed so the UI can refuse early
   * instead of only after Record verdict.
   */
  async inspectability(
    organization: Organization,
    batchId: number,
  ): Promise<{ allowed: boolean; reason: string | null }> {
    const batch = await this.dataSource.getRepository(Batch).findOne({
      where: { id: batchId },
      relations: { manufacturer: true },
    });
    if (!batch) {
      throw new NotFoundEntityException('Batch', batchId);
    }
    if (batch.manufacturer && batch.manufacturer.id !== organization.id) {
      throw new NotFoundEntityException('Batch', batchId);
    }

    if (!permitsInspection(batch.status)) {
      return {
        allowed: false,
        reason: `Lot ${batch.batchCode} is ${batch.status} and cannot be inspected.`,
      };
    }

    if (await this.hasEnteredCirculation(this.dataSource.manager, batch)) {
      return {
        allowed: false,
        reason:
          `Some of lot ${batch.batchCode} was already shipped or sold. ` +
          'You cannot change the quality verdict. Start a recall instead.',
      };
    }

    return { allowed: true, reason: null };
  }

  // ---------------------------------------------------------------- private

  private async resolveBatch(
    manager: EntityManager,
    batchId: number | undefined,
    productionOrder: ProductionOrder | null,
  ): Promise<Batch | null> {
    if (batchId) {
      const batch = await manager.findOne(Batch, { where: { id: batchId } });
      if (!batch) {
        throw new NotFoundEntityException('Batch', batchId);
      }
      return batch;
    }
    return productionOrder?.batch ?? null;
  }

  /**
   * Refuses a verdict that would rewrite the history of goods already in the
   * market, and one on a lot whose state makes inspection meaningless.
   */
  private async requireInspectable(
    manager: EntityManager,
    batch: Batch,
  ): Promise<void> {
    if (!permitsInspection(batch.status)) {
      throw new TraceabilityRuleException(
        `Batch ${batch.batchCode} is ${batch.status} and cannot be inspected`,
      );
    }

    if (await this.hasEnteredCirculation(manager, batch)) {
      throw new TraceabilityRuleException(
        `Batch ${batch.batchCode} has already left the manufacturer, so a new ` +
          'quality verdict cannot replace the one it shipped under. Issue a ' +
          'recall instead, which finds where the affected stock went.',
      );
    }
  }

  /**
   * Whether any of the lot has left the manufacturer's control.
   *
   * Read from the event log rather than from current holders, because it is a
   * question about history: stock that was dispatched and later came back has
   * still been in circulation, and the people who handled it still need a
   * recall rather than a quiet re-inspection.
   */
  private async hasEnteredCirculation(
    manager: EntityManager,
    batch: Batch,
  ): Promise<boolean> {
    const released = await manager.count(TraceabilityEvent, {
      where: {
        item: { batch: { id: batch.id } },
        type: In([...RELEASE_EVENTS]),
      },
    });
    return released > 0;
  }

  /** Moves the lot to where the verdict puts it, and records why. */
  private async applyVerdict(
    manager: EntityManager,
    batch: Batch,
    inspection: QualityInspection,
    inspector: User,
    result: InspectionResult,
  ): Promise<void> {
    const target = statusFor(result);
    const note =
      `Quality inspection #${inspection.id}: ${result}` +
      (inspection.notes ? ` - ${inspection.notes}` : '');

    // BatchService.updateStatus records the audit trail (previousStatus,
    // statusReason, statusChangedAt) in one place so every transition is
    // consistent.
    await this.batchService.updateStatus(batch, target, note, manager);

    // The verdict itself, always recorded.
    await this.recorder.record(manager, {
      batch,
      type: EventType.QC_INSPECTED,
      actor: inspector,
      notes: note,
    });

    // Then what it did to the lot, so a timeline reads as a decision rather
    // than as an inspection with an unstated outcome.
    const outcome = outcomeEventFor(result);
    if (outcome) {
      await this.recorder.record(manager, {
        batch,
        type: outcome,
        actor: inspector,
        notes: note,
      });
    }

    // A quarantined lot's goods are held too, where any exist. Quarantining
    // the paperwork and leaving the stock sellable would be no quarantine.
    if (target === BatchStatus.QUARANTINED) {
      await manager.update(
        TraceableItem,
        { batch: { id: batch.id } },
        { status: 'QUARANTINED' as never },
      );
    }
  }
}

function statusFor(result: InspectionResult): BatchStatus {
  switch (result) {
    case InspectionResult.APPROVED:
      return BatchStatus.APPROVED;
    case InspectionResult.REJECTED:
      return BatchStatus.REJECTED;
    case InspectionResult.REWORK:
      return BatchStatus.REWORK;
    case InspectionResult.QUARANTINE:
      return BatchStatus.QUARANTINED;
  }
}

function outcomeEventFor(result: InspectionResult): EventType | null {
  switch (result) {
    case InspectionResult.APPROVED:
      return EventType.BATCH_APPROVED;
    case InspectionResult.REJECTED:
      return EventType.BATCH_REJECTED;
    case InspectionResult.REWORK:
      return EventType.BATCH_REWORK;
    // Quarantine is a hold, not a verdict on the lot's quality. The
    // QC_INSPECTED entry already says what was decided.
    case InspectionResult.QUARANTINE:
      return null;
  }
}
