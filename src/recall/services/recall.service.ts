import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { User } from '../../auth/entities/user.entity';
import { BatchStatus } from '../../batch/batch-status.enum';
import { Batch } from '../../batch/entities/batch.entity';
import {
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { TraceableItem } from '../../item/entities/traceable-item.entity';
import { ItemStatus } from '../../item/item.enums';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { EventType } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import { RecallDto } from '../dto/recall.dto';

export interface HolderImpact {
  organizationId: number | null;
  organizationName: string | null;
  status: ItemStatus;
  /** Identities to chase down and scan. */
  count: number;
  /** Physical units those identities represent. */
  units: number;
}

export interface RecallImpact {
  batchId: number;
  batchCode: string;
  batchStatus: BatchStatus;
  totalIdentities: number;
  totalUnits: number;
  recoverable: number;
  recoverableUnits: number;
  soldToConsumers: number;
  soldUnits: number;
  destroyed: number;
  destroyedUnits: number;
  holders: HolderImpact[];
}

/**
 * Recalls a production lot. One decision reaches every unit made in that lot,
 * wherever it currently sits, which is the whole point of recording batches at
 * manufacture time (proposal section 11, use case 10).
 */
@Injectable()
export class RecallService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Batch)
    private readonly batches: Repository<Batch>,
    @InjectRepository(TraceableItem)
    private readonly items: Repository<TraceableItem>,
    private readonly recorder: EventRecorder,
  ) {}

  /** List all recalled batches with impact summary. */
  async list() {
    const recalled = await this.batches.find({
      where: { status: BatchStatus.RECALLED },
      relations: { manufacturer: true, product: true },
      order: { statusChangedAt: 'DESC' },
    });

    const results = [];
    for (const batch of recalled) {
      const impact = await this.impact(batch.id);
      results.push({
        batchId: batch.id,
        batchNumber: batch.batchCode,
        reason: batch.statusReason ?? 'No reason provided',
        recallDate: batch.statusChangedAt?.toISOString() ?? batch.createdAt.toISOString(),
        initiatedBy: batch.manufacturer?.name ?? 'Unknown',
        // Units, as the field name says. This passed totalIdentities, which
        // under batch traceability would report a 10,000-unit recall as 1.
        affectedUnits: impact.totalUnits,
        affectedIdentities: impact.totalIdentities,
        impactedLocations: impact.holders.map((h) => ({
          locationId: h.organizationId ?? 0,
          locationName: h.organizationName ?? 'Unknown',
          eventType: h.status,
          qty: h.units,
          identities: h.count,
        })),
      });
    }

    return results;
  }

  /**
   * Blocks a batch and every item made from it. Items already sold to
   * consumers keep their SOLD status - the goods are gone, and pretending
   * otherwise would hide the part of the problem that needs a public notice -
   * but they still receive a RECALLED event, so a consumer scanning the code
   * is warned.
   */
  async recallBatch(
    acting: Organization,
    actor: User,
    dto: RecallDto,
  ): Promise<RecallImpact> {
    await this.recorder.rejectReplay(dto.meta);

    await this.dataSource.transaction(async (manager) => {
      const batch = await requireBatch(manager, dto.batchId);
      requireMayRecall(acting, batch);

      if (batch.status === BatchStatus.RECALLED) {
        throw new TraceabilityRuleException(
          `Batch ${batch.batchCode} is already recalled`,
        );
      }

      batch.previousStatus = batch.status;
      batch.status = BatchStatus.RECALLED;
      batch.statusReason = dto.reason ?? null;
      batch.statusChangedAt = new Date();
      await manager.save(Batch, batch);

      const affected = await manager.find(TraceableItem, {
        where: { batch: { id: batch.id } },
      });

      let first = true;
      for (const item of affected) {
        if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.DESTROYED) {
          item.status = ItemStatus.RECALLED;
          await manager.save(TraceableItem, item);
        }

        await this.recorder.record(manager, {
          item,
          type: EventType.RECALLED,
          actor,
          meta: first ? dto.meta : null,
          sourceOrganization: item.holder,
          sourceLocation: item.location,
          quantity: item.quantity,
          notes: dto.reason ?? null,
        });

        first = false;
      }
    });

    return this.impact(dto.batchId);
  }

  /** Lifts a recall once the cause has been resolved. */
  async liftRecall(
    acting: Organization,
    actor: User,
    batchId: number,
    reason?: string,
  ): Promise<RecallImpact> {
    await this.dataSource.transaction(async (manager) => {
      const batch = await requireBatch(manager, batchId);
      requireMayRecall(acting, batch);

      if (batch.status !== BatchStatus.RECALLED) {
        throw new TraceabilityRuleException(
          `Batch ${batch.batchCode} is not under recall`,
        );
      }

      // Restores the verdict the lot had earned rather than promoting every
      // lifted recall to the same state.
      batch.status = batch.previousStatus ?? BatchStatus.ACTIVE;
      batch.previousStatus = null;
      batch.statusReason = reason ?? null;
      batch.statusChangedAt = new Date();
      await manager.save(Batch, batch);

      const held = await manager.find(TraceableItem, {
        where: { batch: { id: batchId }, status: ItemStatus.RECALLED },
      });

      for (const item of held) {
        item.status = ItemStatus.ACTIVE;
        await manager.save(TraceableItem, item);

        await this.recorder.record(manager, {
          item,
          type: EventType.RELEASED,
          actor,
          sourceOrganization: item.holder,
          sourceLocation: item.location,
          notes: reason ?? null,
        });
      }
    });

    return this.impact(batchId);
  }

  /** Where the batch is now, so a recall can be worked rather than announced. */
  async impact(batchId: number): Promise<RecallImpact> {
    const batch = await this.batches.findOne({ where: { id: batchId } });
    if (!batch) {
      throw new NotFoundEntityException('Batch', batchId);
    }

    const rows = await this.items
      .createQueryBuilder('i')
      .leftJoin('organizations', 'o', 'o.id = i.holder_id')
      .select('i.holder_id', 'organizationId')
      .addSelect('o.name', 'organizationName')
      .addSelect('i.status', 'status')
      .addSelect('COUNT(i.id)', 'count')
      // Units as well as identities. Under batch traceability one identity can
      // stand for the whole lot, and a regulator asked to judge a recall needs
      // to know 10,000 units are affected, not that one row is (DR-01).
      .addSelect('COALESCE(SUM(i.quantity), 0)', 'units')
      .where('i.batch_id = :batchId', { batchId })
      .groupBy('i.holder_id')
      .addGroupBy('o.name')
      .addGroupBy('i.status')
      .getRawMany<{
        organizationId: number | null;
        organizationName: string | null;
        status: ItemStatus;
        count: string;
        units: string;
      }>();

    const holders: HolderImpact[] = [];
    let totalIdentities = 0;
    let totalUnits = 0;
    let recoverable = 0;
    let recoverableUnits = 0;
    let soldToConsumers = 0;
    let soldUnits = 0;
    let destroyed = 0;
    let destroyedUnits = 0;

    for (const row of rows) {
      const count = parseInt(row.count ?? '0', 10);
      const units = parseInt(row.units ?? '0', 10);

      holders.push({
        organizationId: row.organizationId,
        organizationName: row.organizationName,
        status: row.status,
        count,
        units,
      });

      totalIdentities += count;
      totalUnits += units;

      if (row.status === ItemStatus.SOLD) {
        soldToConsumers += count;
        soldUnits += units;
      } else if (row.status === ItemStatus.DESTROYED) {
        destroyed += count;
        destroyedUnits += units;
      } else {
        recoverable += count;
        recoverableUnits += units;
      }
    }

    return {
      batchId: batch.id,
      batchCode: batch.batchCode,
      batchStatus: batch.status,
      // Both, deliberately. Identities are what has to be chased down and
      // scanned; units are how much product is actually affected. Under batch
      // traceability the two differ by four orders of magnitude, and reporting
      // only one of them misleads whoever is deciding the scale of the recall.
      totalIdentities,
      totalUnits,
      recoverable,
      recoverableUnits,
      soldToConsumers,
      soldUnits,
      destroyed,
      destroyedUnits,
      holders,
    };
  }
}

async function requireBatch(
  manager: EntityManager,
  batchId: number,
): Promise<Batch> {
  const batch = await manager.findOne(Batch, { where: { id: batchId } });
  if (!batch) {
    throw new NotFoundEntityException('Batch', batchId);
  }
  return batch;
}

/**
 * Only the lot's manufacturer or a regulator may recall it. Anyone else
 * blocking another company's stock would be a denial-of-service on the
 * supply chain.
 */
function requireMayRecall(organization: Organization, batch: Batch): void {
  if (organization.type === OrganizationType.REGULATOR) {
    return;
  }
  if (batch.manufacturer && batch.manufacturer.id === organization.id) {
    return;
  }
  throw new TraceabilityRuleException(
    `Only the manufacturer of batch ${batch.batchCode} or a regulator can recall it`,
  );
}
