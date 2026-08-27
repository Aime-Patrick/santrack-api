import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Batch } from '../../batch/entities/batch.entity';
import { BatchStatus } from '../../batch/batch-status.enum';
import { TraceableItem, today } from '../../item/entities/traceable-item.entity';
import { ItemStatus, blocksSale } from '../../item/item.enums';
import { QualityInspection } from '../../manufacturing/entities/quality-inspection.entity';
import { ProductionOrder, ProductionOrderMaterial } from '../../manufacturing/entities/production-order.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { TraceabilityEvent } from '../entities/traceability-event.entity';
import {
  MAX_VERIFICATION_TOKEN,
  VerificationAttempt,
} from '../entities/verification-attempt.entity';
import { EventType } from '../event-type.enum';
import { EventRecorder } from './event-recorder.service';

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

/** One code and how often it has been presented for verification. */
export interface VerificationAttemptSummary {
  token: string;
  known: boolean;
  /** The human-readable code, where the token resolves to an identity. */
  itemCode: string | null;
  productName: string | null;
  attempts: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
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
    @InjectRepository(VerificationAttempt)
    private readonly attempts: Repository<VerificationAttempt>,
    private readonly recorder: EventRecorder,
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
    const normalized = normalizeVerifyToken(token);
    // Opaque QR payload only — never the printed ST- serial (enumeration).
    // UUID case is normalised because some scanners upper-case hex.
    const item = await this.items.findOne({ where: { qrCode: normalized } });

    // Before the early return, so a code that resolves to nothing is counted.
    // That is the case this exists for.
    await this.countVerificationAttempt(normalized, item);

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
        verdict: unknownVerifyVerdict(normalized),
      };
    }

    const batch = item.batch;
    const recalled =
      item.status === ItemStatus.RECALLED || batch?.status === BatchStatus.RECALLED;
    const expired = item.isExpired(today()) || item.status === ItemStatus.EXPIRED;
    const blocked = recalled || expired || blocksSale(item.status);

    await this.recordVerification(item, blocked);

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
   * Writes down that somebody checked this code.
   *
   * Two rules, both deliberate.
   *
   * **It never breaks the answer.** This is a public endpoint a shopper hits
   * standing in a shop, and the useful half of the response is the safety
   * verdict. If the log write fails, they still get told the bottle was
   * recalled. A verification refused because we could not record it would be
   * the logging tail wagging the safety dog.
   *
   * **It records no scanner.** No account, no address, nothing identifying —
   * the event says a code was checked, never who checked it. The value is in
   * the code's own pattern: one genuine identity verified forty times across
   * four towns in a week is a cloned label, and that shows up from the code
   * alone.
   *
   * This handles known codes only, because a lifecycle event needs an identity
   * to attach to. Codes that resolve to nothing are counted in
   * `verification_attempts` instead — see `countVerificationAttempt`.
   */
  private async recordVerification(
    item: TraceableItem,
    blocked: boolean,
  ): Promise<void> {
    try {
      await this.recorder.record(this.items.manager, {
        item,
        type: EventType.VERIFIED,
        actor: null,
        notes: blocked
          ? `Consumer verification — reported as ${item.status}`
          : 'Consumer verification — reported as genuine',
      });
    } catch {
      // Deliberately swallowed. See the note above.
    }
  }

  /**
   * Counts one presentation of a code, whether or not we recognise it.
   *
   * The half `VERIFIED` cannot reach. An event needs an identity, so a
   * fabricated code — the thing a counterfeiter actually prints — could be
   * scanned a thousand times and leave nothing behind. This counts it.
   *
   * An upsert, one row per distinct code rather than per scan: the endpoint is
   * public and anonymous, so a row per scan would let anyone with a loop decide
   * how large the table gets. `known` and `item_id` are refreshed on the way
   * through, because a code can be scanned before its identity is confirmed
   * into stock and become legitimate later; the count and `first_seen_at`
   * survive that, which is what makes the earlier scans legible.
   *
   * Fails silently for the same reason `recordVerification` does — a shopper
   * standing in a shop is owed the safety verdict whatever the log is doing.
   */
  private async countVerificationAttempt(
    token: string,
    item: TraceableItem | null,
  ): Promise<void> {
    try {
      // Written as raw SQL because the count has to accumulate. TypeORM's
      // orUpdate() sets each column to the excluded row's value, which would
      // pin `attempts` at 1 for ever and silently defeat the whole point.
      await this.attempts.query(
        `
        INSERT INTO "verification_attempts"
          ("token", "known", "item_id", "attempts", "first_seen_at", "last_seen_at")
        VALUES ($1, $2, $3, 1, now(), now())
        ON CONFLICT ("token") DO UPDATE SET
          "attempts"     = "verification_attempts"."attempts" + 1,
          "last_seen_at" = now(),
          "known"        = EXCLUDED."known",
          "item_id"      = EXCLUDED."item_id"
        `,
        [token.slice(0, MAX_VERIFICATION_TOKEN), item !== null, item?.id ?? null],
      );
    } catch {
      // Deliberately swallowed. See the note above.
    }
  }

  /**
   * How many times this one code has been presented to the public endpoint.
   *
   * Carried on the trace response so an operator holding the thing sees it
   * without going anywhere: a unit that has been verified forty times is worth
   * a second look before it is dispatched again.
   */
  async verificationCountFor(token: string): Promise<number> {
    const row = await this.attempts.findOne({ where: { token } });
    return row?.attempts ?? 0;
  }

  /**
   * Codes being scanned unusually often, most-scanned first.
   *
   * The counterfeit signal, and deliberately not a verdict. A high count means
   * one printed code is being presented far more than one physical thing
   * plausibly could be, which is what a cloned label looks like — and also what
   * a display bottle on a shop counter looks like. It is a list to investigate,
   * never evidence on its own, which is why the response says how many and
   * since when and nothing more.
   *
   * `unknownOnly` narrows it to codes that resolve to nothing: labels printed
   * for products that were never registered at all.
   *
   * **Scoped like everything else that names goods.** A regulator sees the
   * platform; anyone else sees codes for stock they hold or made. Scan counts
   * describe somebody's products, and a competitor's scan volume is exactly
   * the kind of commercial fact this platform does not hand out.
   *
   * Codes that resolve to nothing belong to nobody, so they cannot be scoped
   * that way and are shown to regulators only. That is the right home for
   * them: a fabricated label is a platform-wide problem, not one manufacturer's
   * — and a manufacturer who could list every unregistered code in circulation
   * would learn what everyone else's codes look like.
   */
  async verificationAttempts(
    organization: Organization,
    options: { unknownOnly?: boolean; minAttempts?: number; limit?: number } = {},
  ): Promise<VerificationAttemptSummary[]> {
    const { unknownOnly = false, minAttempts = 1, limit = 50 } = options;
    const isRegulator = organization.type === OrganizationType.REGULATOR;

    // Nothing to show: unknown codes are regulator-only, so this combination
    // is an empty answer rather than an unscoped one.
    if (unknownOnly && !isRegulator) {
      return [];
    }

    const query = this.attempts
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.item', 'item')
      // Selected, not just joined: the summary reports the product name, and
      // without this it comes back null on every known code.
      .leftJoinAndSelect('item.product', 'product')
      .leftJoin('item.batch', 'batch')
      .where('a.attempts >= :minAttempts', { minAttempts })
      .orderBy('a.attempts', 'DESC')
      // Property name, not column name. orderBy resolves against entity
      // metadata, and `a.last_seen_at` fails there with an error about
      // `databaseName` that says nothing about the real cause.
      .addOrderBy('a.lastSeenAt', 'DESC')
      .take(Math.min(limit, 200));

    if (unknownOnly) {
      query.andWhere('a.known = false');
    } else if (!isRegulator) {
      query.andWhere(
        '(item.holder_id = :org OR batch.manufacturer_id = :org)',
        { org: organization.id },
      );
    }

    const rows = await query.getMany();

    return rows.map((row) => ({
      token: row.token,
      known: row.known,
      itemCode: row.item?.code ?? null,
      productName: row.item?.product?.name ?? null,
      attempts: row.attempts,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
    }));
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

const UUID_TOKEN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Peel phone-camera / paste noise off a verify token before lookup.
 * Does not accept ST- serials — only shapes the opaque QR payload.
 */
function normalizeVerifyToken(raw: string): string {
  let token = (raw ?? '').trim().replace(/^["']|["']$/g, '');
  try {
    token = decodeURIComponent(token);
  } catch {
    // keep raw
  }
  token = token.trim();

  if (token.includes('/verify/')) {
    token =
      token.split('/verify/').pop()?.split('?')[0].split('#')[0].trim() ?? token;
  }

  if (UUID_TOKEN.test(token)) {
    return token.toLowerCase();
  }
  return token;
}

/**
 * Unknown codes get different copy when the scan is clearly the wrong kind of
 * label (printed serial / retail GTIN). We deliberately do not look those up —
 * confirming whether ST-000123 exists would re-open catalogue enumeration.
 */
function unknownVerifyVerdict(token: string): string {
  if (/^ST-/i.test(token) || /^[A-Z]{2,}-[A-Z0-9]+-\d+/i.test(token)) {
    return (
      'That looks like a printed serial, not the unit QR. ' +
      'Scan the QR code on the same label — sold items still verify when the QR is scanned.'
    );
  }
  if (/^\d{8,14}$/.test(token)) {
    return (
      'That looks like a product barcode (GTIN), shared by every pack. ' +
      'Scan the unique unit QR to verify this specific item.'
    );
  }
  return 'This code is not registered. Treat the product as unverified.';
}
