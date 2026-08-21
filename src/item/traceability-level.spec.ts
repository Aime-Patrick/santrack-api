import { TraceabilityRuleException } from '../common/errors';
import { Product } from '../product/entities/product.entity';
import {
  TRACEABILITY_STRICTNESS,
  TraceabilityLevel,
  stricter,
} from '../product/traceability-level.enum';
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

function sum(values: number[]): number {
  return values.reduce((total, n) => total + n, 0);
}
