import { User } from '../auth/entities/user.entity';
import { TraceabilityRuleException } from '../common/errors';
import { Organization } from '../organization/entities/organization.entity';
import { Product } from '../product/entities/product.entity';
import {
  TRACEABILITY_STRICTNESS,
  TraceabilityLevel,
  permitsIdentityPool,
  stricter,
} from '../product/traceability-level.enum';
import { PoolStatus } from './entities/identity-pool.entity';
import { IdentityPoolService } from './services/identity-pool.service';
import { unitsPerIdentity } from './services/item.service';

const product = (level: TraceabilityLevel) =>
  ({ traceabilityLevel: level }) as Product;

/**
 * DR-01. The invariant under all of this: an identity is not a unit. How many
 * units one identity stands for is the product's decision, and `quantity` is
 * where that number lives.
 */
describe('splitting a registration into identities', () => {
  describe('SERIAL', () => {
    it('mints one identity per unit, each holding one', () => {
      // A laptop is individually identifiable and warranted. This is the
      // behaviour every existing product keeps.
      const shares = unitsPerIdentity(product(TraceabilityLevel.SERIAL), {
        count: 100,
      });

      expect(shares).toHaveLength(100);
      expect(shares.every((n) => n === 1)).toBe(true);
      expect(sum(shares)).toBe(100);
    });
  });

  describe('BATCH', () => {
    it('mints one identity carrying the whole run', () => {
      // The point of the exercise: 10,000 pots of yogurt, one identity, one
      // label - not ten thousand of each.
      const shares = unitsPerIdentity(product(TraceabilityLevel.BATCH), {
        count: 10_000,
      });

      expect(shares).toEqual([10_000]);
      expect(sum(shares)).toBe(10_000);
    });

    it('ignores a package size, which means nothing at this level', () => {
      expect(
        unitsPerIdentity(product(TraceabilityLevel.BATCH), {
          count: 500,
          unitsPerPackage: 24,
        }),
      ).toEqual([500]);
    });
  });

  describe('PACKAGE', () => {
    it('mints one identity per pack, each holding the pack size', () => {
      const shares = unitsPerIdentity(product(TraceabilityLevel.PACKAGE), {
        count: 9_600,
        unitsPerPackage: 24,
      });

      expect(shares).toHaveLength(400);
      expect(shares.every((n) => n === 24)).toBe(true);
      expect(sum(shares)).toBe(9_600);
    });

    it('records a part-full final pack honestly', () => {
      // 100 at 24 per case is four full cases and one holding four. Rounding it
      // up to five full cases would invent twenty units of stock.
      const shares = unitsPerIdentity(product(TraceabilityLevel.PACKAGE), {
        count: 100,
        unitsPerPackage: 24,
      });

      expect(shares).toEqual([24, 24, 24, 24, 4]);
      expect(sum(shares)).toBe(100);
    });

    it('refuses a package that holds nothing', () => {
      expect(() =>
        unitsPerIdentity(product(TraceabilityLevel.PACKAGE), {
          count: 10,
          unitsPerPackage: 0,
        }),
      ).toThrow(TraceabilityRuleException);
    });
  });

  it('always conserves the number of units requested', () => {
    // Whatever the level, the units that come out must equal the units asked
    // for. This is the property that stops stock being invented or lost.
    for (const level of Object.values(TraceabilityLevel)) {
      for (const count of [1, 7, 24, 100, 9_999]) {
        const shares = unitsPerIdentity(product(level), {
          count,
          unitsPerPackage: 24,
        });
        expect(sum(shares)).toBe(count);
      }
    }
  });
});

describe('strictness ordering', () => {
  it('orders BATCH below PACKAGE below SERIAL', () => {
    expect(TRACEABILITY_STRICTNESS[TraceabilityLevel.BATCH]).toBeLessThan(
      TRACEABILITY_STRICTNESS[TraceabilityLevel.PACKAGE],
    );
    expect(TRACEABILITY_STRICTNESS[TraceabilityLevel.PACKAGE]).toBeLessThan(
      TRACEABILITY_STRICTNESS[TraceabilityLevel.SERIAL],
    );
  });

  it('picks the stricter of two levels, whichever way round they come', () => {
    // Reserved for the future regulatory minimum: regulation may raise a
    // product's level, never lower it.
    expect(stricter(TraceabilityLevel.BATCH, TraceabilityLevel.SERIAL)).toBe(
      TraceabilityLevel.SERIAL,
    );
    expect(stricter(TraceabilityLevel.SERIAL, TraceabilityLevel.BATCH)).toBe(
      TraceabilityLevel.SERIAL,
    );
    expect(stricter(TraceabilityLevel.PACKAGE, TraceabilityLevel.PACKAGE)).toBe(
      TraceabilityLevel.PACKAGE,
    );
  });
});

/**
 * DR-09 WU-1. The two stock-in doors disagreed: `registerUnits` honours the
 * product's level through `unitsPerIdentity`, while the pool mints
 * `quantity: 1` unconditionally and never reads it. A pool is a print run of
 * labels, so it is only truthful for a product where one identity is one unit.
 */
describe('which products may have a pool of codes minted', () => {
  it('allows SERIAL, where one code really does name one thing', () => {
    expect(permitsIdentityPool(TraceabilityLevel.SERIAL)).toBe(true);
  });

  it('refuses BATCH, where one identity carries the whole lot', () => {
    // Ten thousand codes for a lot the catalogue says is one identity would
    // hand back ten thousand contradictions of that entry.
    expect(permitsIdentityPool(TraceabilityLevel.BATCH)).toBe(false);
  });

  it('refuses PACKAGE, where one identity carries a pack', () => {
    expect(permitsIdentityPool(TraceabilityLevel.PACKAGE)).toBe(false);
  });

  it('has an answer for every level, so a new one cannot arrive unconsidered', () => {
    for (const level of Object.values(TraceabilityLevel)) {
      expect(typeof permitsIdentityPool(level)).toBe('boolean');
    }
  });
});

/**
 * The guard at the call site. Asserted separately from the predicate because
 * the bug being closed was not a wrong answer - it was that nothing asked the
 * question at all.
 */
describe('requesting a pool', () => {
  const ORG = { id: 1, name: 'Akagera Foods Ltd' } as Organization;
  const ACTOR = { id: 7 } as User;

  function harness(level: TraceabilityLevel) {
    const minted: unknown[] = [];
    const saved = { id: 42 };

    const service = new IdentityPoolService(
      {} as never,
      {
        create: jest.fn((data: unknown) => data),
        save: jest.fn((data: unknown) => {
          minted.push(data);
          return Promise.resolve(saved);
        }),
      } as never,
      {} as never,
      {
        findOne: jest.fn().mockResolvedValue({
          id: 3,
          name: 'Yogurt 500ml',
          organizationId: ORG.id,
          traceabilityLevel: level,
        }),
      } as never,
      {} as never,
      {} as never,
    );

    // fill() runs unawaited in the background and would reach a database.
    // Only request()'s own decision is under test here.
    jest.spyOn(service, 'fill').mockResolvedValue(undefined as never);

    return { service, minted };
  }

  it('refuses a BATCH-traced product, and says why', async () => {
    const { service, minted } = harness(TraceabilityLevel.BATCH);

    await expect(
      service.request(ORG, ACTOR, { productId: 3, count: 10_000 } as never),
    ).rejects.toThrow(TraceabilityRuleException);

    // Nothing was written. A refused request leaves no half-made pool behind.
    expect(minted).toHaveLength(0);
  });

  it('refuses a PACKAGE-traced product', async () => {
    const { service } = harness(TraceabilityLevel.PACKAGE);

    await expect(
      service.request(ORG, ACTOR, { productId: 3, count: 500 } as never),
    ).rejects.toThrow(/cannot say what it means/);
  });

  it('still accepts a SERIAL product, unchanged', async () => {
    // The behaviour every existing pool depends on. WU-1 narrows what may be
    // requested; it must not alter what happens when the answer is yes.
    const { service, minted } = harness(TraceabilityLevel.SERIAL);

    const pool = await service.request(ORG, ACTOR, {
      productId: 3,
      count: 10_000,
    } as never);

    expect(pool.id).toBe(42);
    expect(minted).toHaveLength(1);
    expect(minted[0]).toMatchObject({
      organizationId: ORG.id,
      requestedCount: 10_000,
      status: PoolStatus.GENERATING,
    });
  });
});

function sum(values: number[]): number {
  return values.reduce((total, n) => total + n, 0);
}
