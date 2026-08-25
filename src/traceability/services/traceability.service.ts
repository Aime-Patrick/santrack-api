import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Batch } from '../../batch/entities/batch.entity';
import { BatchStatus } from '../../batch/batch-status.enum';
import { TraceableItem, today } from '../../item/entities/traceable-item.entity';
import { ItemStatus, blocksSale } from '../../item/item.enums';
import { QualityInspection } from '../../manufacturing/entities/quality-inspection.entity';
import { ProductionOrder, ProductionOrderMaterial } from '../../manufacturing/entities/production-order.entity';
import { TraceabilityEvent } from '../entities/traceability-event.entity';
import { EventType } from '../event-type.enum';

export interface TimelineEntry {
  eventId: number;
  type: EventType;
  occurredAt: Date;
  recordedAt: Date;
  sourceOrganization: string | null;
  sourceLocation: string | null;
  destinationOrganization: string | null;
  destinationLocation: string | null;
  quantity: number | null;
  actor: string | null;
  notes: string | null;
  consumerRef: string | null;
  /** Set when the entry is inherited from a container that carried the item. */
  viaContainer: string | null;
  /** Set when the entry is the lot history the identity inherited. */
  viaBatch: string | null;
}

export interface VerificationResponse {
  known: boolean;
  code: string | null;
  productName: string | null;
  productSku: string | null;
  manufacturer: string | null;
  facilityName: string | null;
  batchCode: string | null;
  batchStatus: string | null;
  itemStatus: ItemStatus | null;
  manufacturedOn: string | null;
  expiresOn: string | null;
  expired: boolean;
  recalled: boolean;
  blocked: boolean;
  verdict: string;
}

export interface QualityInspectionSummary {
  id: number;
  result: string;
  inspector: string;
  notes: string | null;
  testedAt: Date;
}

export interface ProductionOrderSummary {
  id: number;
  orderNumber: string;
  plannedQuantity: number;
  producedQuantity: number;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface RawMaterialSummary {
  id: number;
  name: string;
  code: string;
  category: string | null;
  unitOfMeasure: string;
  allocatedQuantity: string;
  consumedQuantity: string;
}

export interface BatchDetail {
  id: number;
  batchCode: string;
  status: string;
  statusReason: string | null;
  statusChangedAt: Date | null;
  manufacturedOn: string | null;
  expiresOn: string | null;
  facilityName: string | null;
  manufacturerName: string | null;
  productName: string | null;
  inspections: QualityInspectionSummary[];
  productionOrder: ProductionOrderSummary | null;
  rawMaterials: RawMaterialSummary[];
}

/**
 * Reads the event log back as history. Nothing here writes: the timeline is a
 * projection of immutable events, which is what lets the same query serve an
 * operator, an auditor and a regulator.
 */
@Injectable()
export class TraceabilityService {
  constructor(
    @InjectRepository(TraceableItem)
    private readonly items: Repository<TraceableItem>,
    @InjectRepository(TraceabilityEvent)
    private readonly events: Repository<TraceabilityEvent>,
    @InjectRepository(Batch)
    private readonly batches: Repository<Batch>,
    @InjectRepository(QualityInspection)
    private readonly inspections: Repository<QualityInspection>,
    @InjectRepository(ProductionOrder)
    private readonly productionOrders: Repository<ProductionOrder>,
    @InjectRepository(ProductionOrderMaterial)
    private readonly orderMaterials: Repository<ProductionOrderMaterial>,
  ) {}

  /**
   * The history of one identity, merged with the history of every container it
   * has ever been inside, and with the manufacturing history of its lot.
   *
   * Without the container merge a unit that travelled inside a sealed box
   * would appear never to have moved. Without the lot merge it would appear to
   * have sprung into existence fully formed: the run that made it, the
   * materials consumed and the quality verdict all happen before the unit has
   * an identity to record them against, so they are recorded against the batch
   * and read back here. Section 20 asks for one chronological history of the
   * product, not two logs that have to be cross-referenced by hand.
   */
  async timeline(
    item: TraceableItem,
    includeConsumerRef: boolean,
  ): Promise<{ item: TraceableItem; entries: TimelineEntry[] }> {
    const carriers = await this.carriersOf(item);
    const ids = [item.id, ...carriers.keys()];

    const where: Record<string, unknown>[] = [{ item: { id: In(ids) } }];
    if (item.batch) {
      where.push({ batch: { id: item.batch.id } });
    }

    const rows = await this.events.find({
      where,
      relations: {
        item: true,
        batch: true,
        actor: true,
        sourceOrganization: true,
        sourceLocation: true,
        destinationOrganization: true,
        destinationLocation: true,
      },
      order: { occurredAt: 'ASC', id: 'ASC' },
    });

    const entries: TimelineEntry[] = rows.map((event) => ({
      eventId: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      recordedAt: event.recordedAt,
      sourceOrganization: event.sourceOrganization?.name ?? null,
      sourceLocation: event.sourceLocation?.name ?? null,
      destinationOrganization: event.destinationOrganization?.name ?? null,
      destinationLocation: event.destinationLocation?.name ?? null,
      quantity: event.quantity,
      actor: event.actor?.fullName ?? null,
      notes: event.notes,
      consumerRef: includeConsumerRef ? event.consumerRef : null,
      // Batch-level entries carry no item at all, so they are never "via" a
      // container - they are the lot's own manufacturing history.
      viaContainer:
        event.item === null || event.item.id === item.id
          ? null
          : (carriers.get(event.item.id) ?? null),
      /** Set when the entry comes from the lot rather than this identity. */
      viaBatch: event.item === null ? (event.batch?.batchCode ?? null) : null,
    }));

    return { item, entries };
  }

  /**
   * What a consumer gets from scanning a code without an account.
   * No holder, no location, no personal data - just identity and safety.
   *
   * Looks up the opaque QR token ONLY. The printed human code is sequential,
   * so accepting it here would let anyone walk the entire product catalogue
   * one increment at a time (proposal section 16).
   */
  async verify(token: string): Promise<VerificationResponse> {
    const item = await this.items.findOne({ where: { qrCode: token } });

    if (!item) {
      return {
        known: false,
        code: null,
        productName: null,
        productSku: null,
        manufacturer: null,
        facilityName: null,
        batchCode: null,
        batchStatus: null,
        itemStatus: null,
        manufacturedOn: null,
        expiresOn: null,
        expired: false,
        recalled: false,
        blocked: false,
        verdict:
          'This code is not registered. Treat the product as unverified.',
      };
    }

    const batch = item.batch;
    const recalled =
      item.status === ItemStatus.RECALLED || batch?.status === BatchStatus.RECALLED;
    const expired = item.isExpired(today()) || item.status === ItemStatus.EXPIRED;
    const blocked = recalled || expired || blocksSale(item.status);

    return {
      known: true,
      code: item.code,
      productName: item.product?.name ?? null,
      productSku: item.product?.sku ?? null,
      manufacturer: batch?.manufacturer?.name ?? null,
      facilityName: batch?.facility?.name ?? null,
      batchCode: batch?.batchCode ?? null,
      batchStatus: batch?.status ?? null,
      itemStatus: item.status,
      manufacturedOn: batch?.manufacturedOn ?? null,
      expiresOn: item.expiresOn,
      expired,
      recalled,
      blocked,
      verdict: verdict(item, recalled, expired),
    };
  }

  /**
   * Full batch detail for the authenticated trace view: QC inspections,
   * production order, raw materials, facility.
   */
  async batchDetail(batchId: number): Promise<BatchDetail | null> {
    const batch = await this.batches.findOne({
      where: { id: batchId },
      relations: ['manufacturer', 'facility', 'product'],
    });
    if (!batch) return null;

    // QC inspections for this batch, most recent first
    const inspections = await this.inspections.find({
      where: { batch: { id: batchId } },
      relations: ['inspector'],
      order: { testedAt: 'DESC' },
    });

    // Production order linked to this batch (most recent if multiple)
    const order = await this.productionOrders.findOne({
      where: { batch: { id: batchId } },
      order: { createdAt: 'DESC' },
    });

    // Raw materials from the production order
    let rawMaterials: RawMaterialSummary[] = [];
    if (order) {
      const materials = await this.orderMaterials.find({
        where: { productionOrder: { id: order.id } },
        relations: ['material'],
      });

      rawMaterials = materials.map((m) => ({
        id: m.material?.id ?? 0,
        name: m.material?.name ?? 'Unknown',
        code: m.material?.code ?? '',
        category: m.material?.category ?? null,
        unitOfMeasure: m.material?.unitOfMeasure ?? '',
        allocatedQuantity: m.allocatedQuantity ?? '0',
        consumedQuantity: m.consumedQuantity ?? '0',
      }));
    }

    return {
      id: batch.id,
      batchCode: batch.batchCode,
      status: batch.status,
      statusReason: batch.statusReason,
      statusChangedAt: batch.statusChangedAt,
      manufacturedOn: batch.manufacturedOn,
      expiresOn: batch.expiresOn,
      facilityName: batch.facility?.name ?? null,
      manufacturerName: batch.manufacturer?.name ?? null,
      productName: batch.product?.name ?? null,
      inspections: inspections.map((i) => ({
        id: i.id,
        result: i.result,
        inspector: i.inspector?.fullName ?? 'Unknown',
        notes: i.notes,
        testedAt: i.testedAt,
      })),
      productionOrder: order
        ? {
            id: order.id,
            orderNumber: order.orderNumber,
            plannedQuantity: order.plannedQuantity,
            producedQuantity: order.producedQuantity,
            status: order.status,
            startedAt: order.startedAt,
            completedAt: order.completedAt,
          }
        : null,
      rawMaterials,
    };
  }

  /**
   * Containers this item has been carried by, keyed by id, recovered from its
   * PACKAGED events plus wherever it sits right now.
   */
  private async carriersOf(item: TraceableItem): Promise<Map<number, string>> {
    const carriers = new Map<number, string>();

    const packedEvents = await this.events.find({
      where: { item: { id: item.id }, type: EventType.PACKAGED },
      relations: { relatedItem: true },
    });
    for (const event of packedEvents) {
      if (event.relatedItem) {
        carriers.set(event.relatedItem.id, event.relatedItem.code);
      }
    }

    let cursor = item.parent;
    while (cursor) {
      carriers.set(cursor.id, cursor.code);
      const reloaded = await this.items.findOne({
        where: { id: cursor.id },
        relations: { parent: true },
      });
      cursor = reloaded?.parent ?? null;
    }

    carriers.delete(item.id);
    return carriers;
  }
}

function verdict(item: TraceableItem, recalled: boolean, expired: boolean): string {
  if (recalled) {
    return 'Recalled. Do not use this product - return it to the seller.';
  }
  if (expired) {
    return `Expired on ${item.expiresOn}. Do not use this product.`;
  }
  switch (item.status) {
    case ItemStatus.DESTROYED:
      return (
        'This item was recorded as destroyed. A product bearing this code ' +
        'should not be in circulation.'
      );
    case ItemStatus.QUARANTINED:
      return 'Held under inspection. Not cleared for sale.';
    case ItemStatus.DAMAGED:
      return 'Recorded as damaged. Not cleared for sale.';
    case ItemStatus.RETURNED:
      return 'Returned to the supply chain and awaiting inspection.';
    case ItemStatus.SOLD:
      return 'Genuine. This item has been sold.';
    case ItemStatus.IN_TRANSIT:
      return 'Genuine. Currently moving between businesses.';
    default:
      return 'Genuine and in good standing.';
  }
}
