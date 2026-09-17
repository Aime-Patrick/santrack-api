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
import { ItemService, requireHeldBy } from '../../item/services/item.service';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { EventType } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import { TraceabilityEvent } from '../../traceability/entities/traceability-event.entity';
import { collapseLotLifecycleEvents } from '../../traceability/collapse-lot-lifecycle-events';
import { RecallDto, RecallRecoveryDto, RecallRecoveryOutcome } from '../dto/recall.dto';
import { RegulatoryCaseService } from '../../licensing/services/regulatory-case.service';
import { RegulatoryCase, RegulatoryCaseEvent, RegulatoryCaseEventType } from '../../licensing/entities/regulatory-case.entity';
import { NotificationsGateway } from '../../notifications/gateways/notifications.gateway';
import { NotificationType } from '../../notifications/entities/notification.entity';

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
  quarantined: number;
  quarantinedUnits: number;
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
    private readonly itemService: ItemService,
    private readonly recorder: EventRecorder,
    private readonly regulatoryCases: RegulatoryCaseService,
    private readonly notifications: NotificationsGateway,
  ) {}

  /**
   * List recalled batches.
   * - Regulators see every recall across the platform.
   * - Trading organisations see only recalls for batches they manufactured.
   */
  async list(viewer: Organization) {
    const where =
      viewer.type === OrganizationType.REGULATOR
        ? { status: BatchStatus.RECALLED }
        : { status: BatchStatus.RECALLED, manufacturer: { id: viewer.id } };

    const recalled = await this.batches.find({
      where,
      relations: { manufacturer: true, product: true, facility: true },
      order: { statusChangedAt: 'DESC' },
    });

    const results = [];
    for (const batch of recalled) {
      results.push(await this.describeRecall(batch));
    }

    return results;
  }

  /**
   * One recalled lot with full impact — for the recall detail page.
   * Trading orgs may only view recalls for their own batches.
   */
  async get(batchId: number, viewer: Organization) {
    const batch = await this.batches.findOne({
      where: { id: batchId },
      relations: { manufacturer: true, product: true, facility: true },
    });
    if (!batch) {
      throw new NotFoundEntityException('Batch', batchId);
    }
    if (batch.status !== BatchStatus.RECALLED) {
      throw new TraceabilityRuleException(
        `Batch ${batch.batchCode} is ${batch.status}, not under recall`,
      );
    }
    if (
      viewer.type !== OrganizationType.REGULATOR &&
      batch.manufacturer?.id !== viewer.id
    ) {
      throw new NotFoundEntityException('Batch', batchId);
    }
    return this.describeRecall(batch);
  }

  private async describeRecall(batch: Batch) {
    const impact = await this.impact(batch.id);

    const caseRecord = await this.dataSource.getRepository(RegulatoryCase).findOne({
      where: { batch: { id: batch.id } },
      relations: { leadAuthority: true, assignedTo: true },
      order: { openedAt: 'DESC' },
    });

    const recentEvents = await this.dataSource
      .getRepository(TraceabilityEvent)
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.actor', 'actor')
      .leftJoinAndSelect('e.sourceOrganization', 'org')
      .leftJoinAndSelect('e.sourceLocation', 'loc')
      .leftJoinAndSelect('e.item', 'item')
      .leftJoinAndSelect('item.batch', 'itemBatch')
      .leftJoinAndSelect('e.batch', 'batch')
      .where(
        'e.batch_id = :batchId OR (item.id IS NOT NULL AND item.batch_id = :batchId)',
        { batchId: batch.id },
      )
      .orderBy('e.occurredAt', 'DESC')
      .take(200)
      .getMany();

    return {
      batchId: batch.id,
      batchNumber: batch.batchCode,
      productName: batch.product?.name ?? 'Unknown product',
      productSku: batch.product?.sku ?? null,
      manufacturerName: batch.manufacturer?.name ?? null,
      reason: batch.statusReason ?? 'No reason provided',
      recallDate: batch.statusChangedAt?.toISOString() ?? batch.createdAt.toISOString(),
      initiatedBy: batch.manufacturer?.name ?? 'Unknown',
      affectedUnits: impact.totalUnits,
      affectedIdentities: impact.totalIdentities,
      recoverableUnits: impact.recoverableUnits,
      quarantinedUnits: impact.quarantinedUnits,
      soldUnits: impact.soldUnits,
      destroyedUnits: impact.destroyedUnits,
      manufacturedOn: batch.manufacturedOn ?? null,
      expiresOn: batch.expiresOn ?? null,
      facility: batch.facility
        ? {
            id: batch.facility.id,
            name: batch.facility.name,
            code: batch.facility.code,
          }
        : null,
      product: batch.product
        ? {
            id: batch.product.id,
            name: batch.product.name,
            sku: batch.product.sku,
            category: batch.product.category,
            traceabilityLevel: batch.product.traceabilityLevel,
          }
        : null,
      linkedCase: caseRecord
        ? {
            id: caseRecord.id,
            caseNumber: caseRecord.caseNumber,
            status: caseRecord.status,
            priority: caseRecord.priority,
            leadAuthorityName: caseRecord.leadAuthority?.name ?? null,
          }
        : null,
      impactedLocations: impact.holders.map((h) => ({
        locationId: h.organizationId ?? 0,
        locationName: h.organizationName ?? 'Unknown',
        eventType: h.status,
        qty: h.units,
        identities: h.count,
      })),
      recentEvents: collapseLotLifecycleEvents(recentEvents)
        .slice(0, 15)
        .map((e) => ({
        id: e.id,
        type: e.type,
        occurredAt: e.occurredAt.toISOString(),
        recordedAt: e.recordedAt?.toISOString() ?? e.occurredAt.toISOString(),
        actorName: e.actor?.fullName ?? e.actor?.email ?? 'System',
        actorEmail: e.actor?.email ?? null,
        organizationName: e.sourceOrganization?.name ?? null,
        organizationId: e.sourceOrganization?.id ?? null,
        locationName: e.sourceLocation?.name ?? null,
        destinationOrganizationName: e.destinationOrganization?.name ?? null,
        destinationLocationName: e.destinationLocation?.name ?? null,
        itemCode: e.item?.code ?? null,
        itemQrCode: e.item?.qrCode ?? null,
        batchCode: e.batch?.batchCode ?? e.item?.batch?.batchCode ?? null,
        relatedItemCode: e.relatedItem?.code ?? null,
        deviceId: e.deviceId ?? null,
        consumerRef: e.consumerRef ?? null,
        notes: e.notes ?? null,
        quantity: e.quantity,
      })),
    };
  }

  /**
   * Blocks a batch and every item made from it. Items already sold to
   * consumers keep their SOLD status - the goods are gone, and pretending
   * otherwise would hide the part of the problem that needs a public notice.
   * The lot itself is marked recalled, so a consumer scan of any code from
   * the lot still warns. History is one lot-level RECALLED event (not one row
   * per unit), because the action applies to the whole batch.
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

      const recallable = affected.filter(
        (item) =>
          item.status !== ItemStatus.SOLD && item.status !== ItemStatus.DESTROYED,
      );
      for (const item of recallable) {
        item.status = ItemStatus.RECALLED;
      }
      if (recallable.length > 0) {
        await manager.save(TraceableItem, recallable);
      }

      const units = affected.reduce((sum, item) => sum + item.quantity, 0);
      await this.recorder.record(manager, {
        batch,
        type: EventType.RECALLED,
        actor,
        meta: dto.meta,
        sourceOrganization: acting,
        quantity: units,
        notes: dto.reason ?? null,
      });

      if (batch.manufacturer) {
        await this.regulatoryCases.openRecallCase(actor, batch, manager);
      }
    });
    const impact = await this.impact(dto.batchId);
    this.notifyRecall(impact, dto.reason).catch(() => undefined);
    return impact;
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
      }
      if (held.length > 0) {
        await manager.save(TraceableItem, held);
      }

      const units = held.reduce((sum, item) => sum + item.quantity, 0);
      await this.recorder.record(manager, {
        batch,
        type: EventType.RELEASED,
        actor,
        sourceOrganization: acting,
        quantity: units,
        notes: reason ?? null,
      });
    });

    const impact = await this.impact(batchId);
    this.notifyRecallLifted(impact, reason).catch(() => undefined);
    return impact;
  }

  /** A scan changes the physical item's state and proves the outcome in the linked case. */
  async recordRecovery(
    organization: Organization,
    actor: User,
    dto: RecallRecoveryDto,
  ): Promise<{ item: TraceableItem; outcome: RecallRecoveryOutcome; caseId: number | null; impact: RecallImpact }> {
    await this.recorder.rejectReplay(dto.meta);
    const result = await this.dataSource.transaction(async (manager) => {
      const item = await this.itemService.require(dto.qrCode, manager);
      requireHeldBy(item, organization);
      if (!item.batch) throw new TraceabilityRuleException(`${item.code} has no batch and cannot be recovered against a recall`);
      const batch = await requireBatch(manager, item.batch.id);
      if (batch.status !== BatchStatus.RECALLED) throw new TraceabilityRuleException(`Batch ${batch.batchCode} is not under recall`);
      if (![ItemStatus.RECALLED, ItemStatus.RETURNED].includes(item.status)) {
        throw new TraceabilityRuleException(`${item.code} is ${item.status}; only a recalled or returned identity can be recorded as recovered`);
      }

      const affected = await this.itemService.withDescendants(manager, item);
      if (affected.some((member) => member.batch?.id !== batch.id)) {
        throw new TraceabilityRuleException('This container holds identities from another batch; scan the recalled identity directly');
      }
      const target = dto.outcome === RecallRecoveryOutcome.DESTROYED ? ItemStatus.DESTROYED : ItemStatus.QUARANTINED;
      const eventType = dto.outcome === RecallRecoveryOutcome.DESTROYED ? EventType.DESTROYED : EventType.QUARANTINED;
      for (const member of affected) {
        member.status = target;
        await manager.save(TraceableItem, member);
        await this.recorder.record(manager, {
          item: member,
          type: eventType,
          actor,
          meta: member.id === item.id ? dto.meta : null,
          sourceOrganization: organization,
          sourceLocation: member.location,
          relatedItem: member.id === item.id ? null : item,
          quantity: member.quantity,
          notes: `Recall recovery: ${dto.reason?.trim() || dto.outcome.toLowerCase()}`,
        });
      }

      const caseRecord = await manager.findOne(RegulatoryCase, {
        where: { batch: { id: batch.id } }, order: { openedAt: 'DESC' },
      });
      if (caseRecord) {
        await manager.save(manager.create(RegulatoryCaseEvent, {
          case: caseRecord, actor, type: RegulatoryCaseEventType.RECALL_RECOVERY_RECORDED,
          summary: `Recall recovery: ${item.code} ${dto.outcome.toLowerCase()}`,
          detail: { qrCode: item.qrCode, itemCode: item.code, outcome: dto.outcome, organizationId: organization.id, organizationName: organization.name, quantity: affected.reduce((total, member) => total + member.quantity, 0), reason: dto.reason?.trim() || null },
        }));
      }
      return { item: await this.itemService.require(item.qrCode, manager), caseId: caseRecord?.id ?? null };
    });
    return { ...result, outcome: dto.outcome, impact: await this.impact(result.item.batch!.id) };
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
    let quarantined = 0;
    let quarantinedUnits = 0;
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
      } else if (row.status === ItemStatus.QUARANTINED) {
        quarantined += count;
        quarantinedUnits += units;
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
      quarantined,
      quarantinedUnits,
      soldToConsumers,
      soldUnits,
      destroyed,
      destroyedUnits,
      holders,
    };
  }

  private async notifyRecall(impact: RecallImpact, reason?: string | null) {
    const users = await this.recallAudience(impact);
    const why = reason?.trim() ? ` ${reason.trim()}` : '';
    await Promise.allSettled(
      users.map((user) => {
        const regulator = user.organization?.type === OrganizationType.REGULATOR;
        return this.notifications.sendToUser(user.id, {
          type: NotificationType.ERROR,
          title: `Recall: batch ${impact.batchCode}`,
          message: regulator
            ? `Lot ${impact.batchCode} is recalled.${why} Open the recall desk to see holders and recoveries.`
            : `Lot ${impact.batchCode} is recalled.${why} Hold remaining stock, stop sales, and record recoveries from the recall desk.`,
          module: 'recall',
          actionUrl: `/dashboard/recall/${impact.batchId}`,
        });
      }),
    );
  }

  private async notifyRecallLifted(impact: RecallImpact, reason?: string | null) {
    const users = await this.recallAudience(impact);
    const why = reason?.trim() ? ` ${reason.trim()}` : '';
    await Promise.allSettled(
      users.map((user) =>
        this.notifications.sendToUser(user.id, {
          type: NotificationType.SUCCESS,
          title: `Recall lifted: batch ${impact.batchCode}`,
          message: `Lot ${impact.batchCode} is no longer under recall.${why} Open the recall desk to confirm current stock status.`,
          module: 'recall',
          actionUrl: `/dashboard/recall/${impact.batchId}`,
        }),
      ),
    );
  }

  private async recallAudience(impact: RecallImpact): Promise<User[]> {
    const orgIds = new Set<number>();
    for (const holder of impact.holders) {
      if (holder.organizationId) orgIds.add(holder.organizationId);
    }
    const regulators = await this.dataSource.getRepository(Organization).find({
      where: { type: OrganizationType.REGULATOR },
    });
    for (const regulator of regulators) orgIds.add(regulator.id);
    if (orgIds.size === 0) return [];
    return this.dataSource.getRepository(User).find({
      where: [...orgIds].map((id) => ({ organization: { id } })),
    });
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
