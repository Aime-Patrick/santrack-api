import { DataSource, EntityManager } from 'typeorm';

import { BatchStatus } from '../../batch/batch-status.enum';
import { BatchService } from '../../batch/services/batch.service';
import { TraceabilityRuleException } from '../../common/errors';
import { EventType } from '../../traceability/event-type.enum';
import { EventRecorder } from '../../traceability/services/event-recorder.service';
import { ProductionEventType, ProductionOrderStatus } from '../manufacturing.enums';
import { ProductionService } from './production.service';

/**
 * Completion and amendment, exercised against the service rather than against
 * the enum helpers.
 *
 * These two paths write to three places at once - the order, the lot and the
 * event log - and the earlier tests here asserted arithmetic (`70 < 80`) that
 * held whatever the service did. A fake EntityManager records the saves, so a
 * rule that stops being enforced fails a test.
 */

type SavedEvent = { type: unknown; quantity?: unknown; previousQuantity?: unknown };

function harness(options: {
  order: Record<string, unknown>;
  registeredCount?: number;
}) {
  const saved: unknown[] = [];
  const productionEvents: SavedEvent[] = [];
  const traceEvents: { type: EventType; quantity?: number; notes?: string | null }[] = [];
  const statusChanges: { target: BatchStatus; reason?: string; scoped: boolean }[] = [];

  const manager = {
    findOne: jest.fn().mockResolvedValue(options.order),
    count: jest.fn().mockResolvedValue(options.registeredCount ?? 0),
    // The registration cap now sums the units each identity represents rather
    // than counting rows, because one identity can stand for a whole lot
    // (DR-01).  in these cases is a unit total.
    createQueryBuilder: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest
        .fn()
        .mockResolvedValue({ units: String(options.registeredCount ?? 0) }),
    })),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
    save: jest.fn((_entity: unknown, data?: unknown) => {
      const row = (data ?? _entity) as Record<string, unknown>;
      saved.push(row);
      if (row && 'productionOrder' in row) {
        productionEvents.push(row as SavedEvent);
      }
      return Promise.resolve(row);
    }),
  } as unknown as EntityManager;

  const dataSource = {
    transaction: (cb: (m: EntityManager) => Promise<unknown>) => cb(manager),
  } as unknown as DataSource;

  const batches = {
    updateStatus: jest.fn(
      (
        batch: { status: BatchStatus },
        target: BatchStatus,
        reason?: string,
        scoped?: EntityManager,
      ) => {
        statusChanges.push({ target, reason, scoped: scoped !== undefined });
        batch.status = target;
        return Promise.resolve(batch);
      },
    ),
  } as unknown as BatchService;

  const recorder = {
    record: jest.fn((_m: EntityManager, input: { type: EventType }) => {
      traceEvents.push(input as (typeof traceEvents)[number]);
      return Promise.resolve(input);
    }),
  } as unknown as EventRecorder;

  const licensing = {
    checkOwnTrade: jest.fn().mockResolvedValue(undefined),
    recordIneligibleProduction: jest.fn().mockResolvedValue(undefined),
  };

  // Planning a run now asks whether it is permitted (DR-07 WU-6). These paths
  // are completion and amendment, which do not, so the answer is a clean one.
  const eligibility = {
    evaluate: jest.fn().mockResolvedValue({
      eligible: true,
      blocking: false,
      enforcementMode: 'ADVISORY',
      evaluatedAt: new Date(),
      checks: [],
      reliedOn: { licenseIds: [], licenseNumbers: [], categoryCodes: [] },
      rulesetVersion: 'DR07-MVP-1',
    }),
  };

  const service = new ProductionService(
    dataSource,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    licensing as never,
    eligibility as never,
    batches,
    recorder,
  );

  return {
    service,
    manager,
    batches,
    recorder,
    licensing,
    eligibility,
    productionEvents,
    traceEvents,
    statusChanges,
  };
}

const ORG = { id: 1 } as never;
const ACTOR = { id: 9, fullName: 'Inspector' } as never;

function completedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    orderNumber: 'PO-0007',
    organization: { id: 1 },
    plannedQuantity: 50,
    producedQuantity: 50,
    status: ProductionOrderStatus.COMPLETED,
    batch: {
      id: 3,
      batchCode: 'PO-0007',
      status: BatchStatus.PENDING_QC,
      manufacturedOn: null,
      expiresOn: null,
    },
    ...overrides,
  };
}

describe('completing a production order', () => {
  const runningOrder = () =>
    completedOrder({
      status: ProductionOrderStatus.IN_PROGRESS,
      producedQuantity: 0,
      batch: {
        id: 3,
        batchCode: 'PO-0007',
        status: BatchStatus.PENDING_QC,
        manufacturedOn: null,
        expiresOn: null,
      },
    });

  it('keeps the lot at PENDING_QC inside the caller transaction', async () => {
    const order = runningOrder();
    const h = harness({ order });

    await h.service.complete(ORG, ACTOR, 7, { producedQuantity: 48 });

    expect(h.statusChanges).toHaveLength(1);
    expect(h.statusChanges[0].target).toBe(BatchStatus.PENDING_QC);
    // Without the manager the status would commit on its own connection and
    // outlive a rollback that discarded the events recorded beside it.
    expect(h.statusChanges[0].scoped).toBe(true);
  });

  it('dates the lot at completion, not at planning', async () => {
    const order = runningOrder();
    const h = harness({ order });

    await h.service.complete(ORG, ACTOR, 7, { producedQuantity: 48 });

    expect((order.batch as { manufacturedOn: string | null }).manufacturedOn).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it('applies the shelf date the caller supplied', async () => {
    const order = runningOrder();
    const h = harness({ order });

    await h.service.complete(ORG, ACTOR, 7, {
      producedQuantity: 48,
      expiresOn: '2030-01-01',
    });

    // Items copy expiresOn from the batch, so dropping it here would make
    // every manufactured unit unexpirable.
    expect((order.batch as { expiresOn: string | null }).expiresOn).toBe('2030-01-01');
  });

  it('refuses a shelf date that precedes manufacture', async () => {
    const h = harness({ order: runningOrder() });

    await expect(
      h.service.complete(ORG, ACTOR, 7, { expiresOn: '2000-01-01' }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });

  it('records PRODUCTION_COMPLETED against the lot', async () => {
    const h = harness({ order: runningOrder() });

    await h.service.complete(ORG, ACTOR, 7, { producedQuantity: 48 });

    expect(h.traceEvents.map((e) => e.type)).toContain(EventType.PRODUCTION_COMPLETED);
    expect(h.traceEvents[0].quantity).toBe(48);
  });

  it('refuses to complete an order that is not running', async () => {
    const h = harness({ order: completedOrder() });

    await expect(h.service.complete(ORG, ACTOR, 7)).rejects.toBeInstanceOf(
      TraceabilityRuleException,
    );
  });
});

describe('amending a produced quantity', () => {
  it('records the before and after on both logs', async () => {
    const order = completedOrder();
    const h = harness({ order, registeredCount: 50 });

    await h.service.amendQuantity(ORG, ACTOR, 7, {
      newQuantity: 55,
      reason: 'Recount after packing',
    });

    expect(order.producedQuantity).toBe(55);

    const amendment = h.productionEvents.find(
      (e) => e.type === ProductionEventType.QUANTITY_AMENDED,
    );
    expect(amendment).toBeDefined();
    expect(amendment!.previousQuantity).toBe('50');
    expect(amendment!.quantity).toBe('55');

    const trace = h.traceEvents.find(
      (e) => e.type === EventType.PRODUCED_QUANTITY_AMENDED,
    );
    expect(trace).toBeDefined();
    expect(trace!.notes).toContain('50 → 55');
  });

  it('refuses to drop below the identities already registered', async () => {
    const h = harness({ order: completedOrder(), registeredCount: 50 });

    // 50 units already carry QR codes; they cannot be un-made.
    await expect(
      h.service.amendQuantity(ORG, ACTOR, 7, { newQuantity: 40, reason: 'Recount' }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });

  it('allows a reduction down to exactly the registered count', async () => {
    const order = completedOrder({ producedQuantity: 55 });
    const h = harness({ order, registeredCount: 50 });

    await h.service.amendQuantity(ORG, ACTOR, 7, {
      newQuantity: 50,
      reason: 'Five failed final check',
    });

    expect(order.producedQuantity).toBe(50);
  });

  it('refuses an amendment that changes nothing', async () => {
    const h = harness({ order: completedOrder(), registeredCount: 0 });

    await expect(
      h.service.amendQuantity(ORG, ACTOR, 7, { newQuantity: 50, reason: 'Recount' }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });

  it('refuses a fractional or non-positive quantity', async () => {
    const h = harness({ order: completedOrder(), registeredCount: 0 });

    await expect(
      h.service.amendQuantity(ORG, ACTOR, 7, { newQuantity: 12.5, reason: 'Recount' }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);

    await expect(
      h.service.amendQuantity(ORG, ACTOR, 7, { newQuantity: 0, reason: 'Recount' }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });

  it('refuses to amend a run that has not finished', async () => {
    const h = harness({
      order: completedOrder({ status: ProductionOrderStatus.IN_PROGRESS }),
    });

    await expect(
      h.service.amendQuantity(ORG, ACTOR, 7, { newQuantity: 55, reason: 'Recount' }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });

  it('refuses to amend an order with no lot to amend', async () => {
    const h = harness({ order: completedOrder({ batch: null }) });

    await expect(
      h.service.amendQuantity(ORG, ACTOR, 7, { newQuantity: 55, reason: 'Recount' }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });
});
