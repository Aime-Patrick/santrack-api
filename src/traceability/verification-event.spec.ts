import { Repository } from 'typeorm';

import { BatchStatus } from '../batch/batch-status.enum';
import { ItemStatus } from '../item/item.enums';
import { TraceableItem } from '../item/entities/traceable-item.entity';
import { VerificationAttempt } from './entities/verification-attempt.entity';
import { EventType } from './event-type.enum';
import { EventRecorder } from './services/event-recorder.service';
import { TraceabilityService } from './services/traceability.service';

/**
 * The consumer portal used to answer scans and write nothing down.
 *
 * `VERIFY` is named in the technical proposal's event list (section 7) and was
 * the only one of the eighteen with no member in `EventType` at all, because
 * `verify()` was a pure read. A counterfeit could be scanned in six towns on
 * the same day and the platform would hold no record that anyone had asked —
 * which is the exact pattern that gives a cloned label away.
 */

function harness(item: Record<string, unknown> | null) {
  const recorded: { type: EventType; notes?: string; actor?: unknown }[] = [];
  const counted: { sql: string; params: unknown[] }[] = [];

  const items = {
    findOne: jest.fn().mockResolvedValue(item),
    manager: { marker: 'entity-manager' },
  } as unknown as Repository<TraceableItem>;

  const attempts = {
    query: jest.fn((sql: string, params: unknown[]) => {
      counted.push({ sql, params });
      return Promise.resolve([]);
    }),
  } as unknown as Repository<VerificationAttempt>;

  const recorder = {
    record: jest.fn((_m: unknown, input: { type: EventType }) => {
      recorded.push(input);
      return Promise.resolve(input);
    }),
  } as unknown as EventRecorder;

  const service = new TraceabilityService(
    items,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    attempts,
    recorder,
  );

  return { service, recorder, recorded, items, attempts, counted };
}

const genuine = {
  id: 100,
  code: 'ITM-100',
  qrCode: 'qr-100',
  status: ItemStatus.ACTIVE,
  expiresOn: null,
  batch: { batchCode: 'FG-2026-045', status: BatchStatus.APPROVED },
  product: { name: 'Akagera Water 500ml', sku: 'AKAG-W500' },
  isExpired: () => false,
};

const recalledItem = {
  ...genuine,
  status: ItemStatus.RECALLED,
  batch: { batchCode: 'FG-2026-045', status: BatchStatus.RECALLED },
};

describe('a consumer scan leaves a record', () => {
  it('appends VERIFIED against the scanned identity', async () => {
    const h = harness(genuine);

    await h.service.verify('qr-100');

    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0].type).toBe(EventType.VERIFIED);
  });

  it('names no scanner', async () => {
    const h = harness(genuine);

    await h.service.verify('qr-100');

    // The endpoint is unauthenticated by design. A verification says a code
    // was checked, never who checked it.
    expect(h.recorded[0].actor).toBeNull();
    expect(JSON.stringify(h.recorded[0])).not.toMatch(/ip|address|consumerRef/i);
  });

  it('says what the scanner was told', async () => {
    const clean = harness(genuine);
    await clean.service.verify('qr-100');
    expect(clean.recorded[0].notes).toContain('genuine');

    const bad = harness(recalledItem);
    await bad.service.verify('qr-100');
    expect(bad.recorded[0].notes).toContain('RECALLED');
  });

  it('still reports the recall it just logged', async () => {
    const h = harness(recalledItem);

    const answer = await h.service.verify('qr-100');

    expect(answer.recalled).toBe(true);
    expect(answer.blocked).toBe(true);
  });
});

describe('logging never costs the shopper an answer', () => {
  it('answers in full when the event write fails', async () => {
    const h = harness(recalledItem);
    (h.recorder.record as jest.Mock).mockRejectedValue(new Error('db down'));

    const answer = await h.service.verify('qr-100');

    // The useful half of this response is the safety verdict. Refusing it
    // because the log write failed would be the tail wagging the dog.
    expect(answer.known).toBe(true);
    expect(answer.recalled).toBe(true);
    expect(answer.verdict).toBeTruthy();
  });
});

describe('an unknown code', () => {
  it('writes no lifecycle event, because there is no identity to attach one to', async () => {
    const h = harness(null);

    const answer = await h.service.verify('qr-nonexistent');

    expect(answer.known).toBe(false);
    expect(h.recorded).toHaveLength(0);
  });

  it('is still counted, which is the whole point', async () => {
    const h = harness(null);

    await h.service.verify('qr-nonexistent');

    // A fabricated code is exactly what a counterfeiter prints. If the only
    // record were the lifecycle event, this scan would vanish.
    expect(h.counted).toHaveLength(1);
    expect(h.counted[0].params[0]).toBe('qr-nonexistent');
    expect(h.counted[0].params[1]).toBe(false);
    expect(h.counted[0].params[2]).toBeNull();
  });
});

describe('counting how often a code is presented', () => {
  it('counts known codes too — a clone carries a real code', async () => {
    const h = harness(genuine);

    await h.service.verify('qr-100');

    expect(h.counted[0].params[1]).toBe(true);
    expect(h.counted[0].params[2]).toBe(100);
  });

  it('accumulates rather than overwriting', async () => {
    const h = harness(genuine);

    await h.service.verify('qr-100');

    // The upsert has to add. TypeORM's orUpdate() would set the column to the
    // excluded row's value and pin the count at 1 for ever.
    expect(h.counted[0].sql).toMatch(/ON CONFLICT \("token"\) DO UPDATE/);
    expect(h.counted[0].sql).toMatch(/"attempts"\s*=\s*"verification_attempts"\."attempts" \+ 1/);
  });

  it('counts before deciding whether the code is known', async () => {
    const h = harness(null);

    await h.service.verify('qr-nonexistent');

    // The unknown branch returns early. Counting after it would record only
    // the codes that need recording least.
    expect(h.attempts.query).toHaveBeenCalled();
  });

  it('truncates an over-length token rather than refusing it', async () => {
    const h = harness(null);
    const long = 'x'.repeat(400);

    await h.service.verify(long);

    // Refusing to record it would hand anyone a way to probe without leaving
    // a mark.
    expect((h.counted[0].params[0] as string).length).toBe(256);
  });

  it('still answers when the count cannot be written', async () => {
    const h = harness(recalledItem);
    (h.attempts.query as jest.Mock).mockRejectedValue(new Error('db down'));

    const answer = await h.service.verify('qr-100');

    expect(answer.known).toBe(true);
    expect(answer.recalled).toBe(true);
  });
});

/**
 * Who may read scan counts.
 *
 * A count describes somebody's goods. A competitor's scan volume is exactly
 * the kind of commercial fact this platform does not hand out, so the review
 * list is scoped the same way `ItemService.maySee` scopes everything else:
 * a regulator sees the platform, everyone else sees what they hold or made.
 */

const REGULATOR = { id: 9, type: 'REGULATOR' } as never;
const MANUFACTURER = { id: 3, type: 'MANUFACTURER' } as never;

function reviewHarness() {
  const conditions: { sql: string; params?: Record<string, unknown> }[] = [];

  // Explicitly typed: every builder method returns the builder, so inference
  // would be circular.
  const query: Record<string, jest.Mock> = {
    leftJoinAndSelect: jest.fn(() => query),
    leftJoin: jest.fn(() => query),
    where: jest.fn((sql: string, params?: Record<string, unknown>) => {
      conditions.push({ sql, params });
      return query;
    }),
    andWhere: jest.fn((sql: string, params?: Record<string, unknown>) => {
      conditions.push({ sql, params });
      return query;
    }),
    orderBy: jest.fn(() => query),
    addOrderBy: jest.fn(() => query),
    take: jest.fn(() => query),
    getMany: jest.fn().mockResolvedValue([]),
  };

  const attempts = {
    createQueryBuilder: jest.fn(() => query),
  } as unknown as Repository<VerificationAttempt>;

  const service = new TraceabilityService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    attempts,
    {} as never,
  );

  return { service, conditions, query };
}

const holderFilter = /item\.holder_id = :org OR batch\.manufacturer_id = :org/;

describe('who may read scan counts', () => {
  it('narrows a manufacturer to stock it holds or made', async () => {
    const h = reviewHarness();

    await h.service.verificationAttempts(MANUFACTURER);

    const scoped = h.conditions.find((c) => holderFilter.test(c.sql));
    expect(scoped).toBeDefined();
    expect(scoped!.params).toEqual({ org: 3 });
  });

  it('does not narrow a regulator', async () => {
    const h = reviewHarness();

    await h.service.verificationAttempts(REGULATOR);

    expect(h.conditions.find((c) => holderFilter.test(c.sql))).toBeUndefined();
  });

  it('keeps unknown codes to regulators', async () => {
    const h = reviewHarness();

    const rows = await h.service.verificationAttempts(MANUFACTURER, {
      unknownOnly: true,
    });

    // An unknown code belongs to nobody, so it cannot be scoped by holder.
    // Answering empty is correct; answering unscoped would hand a
    // manufacturer every unregistered code in circulation.
    expect(rows).toEqual([]);
    expect(h.query.getMany).not.toHaveBeenCalled();
  });

  it('lets a regulator see unknown codes', async () => {
    const h = reviewHarness();

    await h.service.verificationAttempts(REGULATOR, { unknownOnly: true });

    expect(h.query.getMany).toHaveBeenCalled();
    expect(h.conditions.some((c) => /a\.known = false/.test(c.sql))).toBe(true);
  });
});
