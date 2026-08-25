import { TraceabilityRuleException } from '../common/errors';
import { Product } from './entities/product.entity';
import {
  salesUnitPermitted,
  sellableUnits,
  unitsPerSalesUnit,
} from './sales-unit';
import { TraceabilityLevel } from './traceability-level.enum';

/**
 * DR-09 WU-3. The rule under all of it: a sales unit is valid only when it is
 * the product's own base unit or its own pack. There is no unit vocabulary and
 * no conversion table, so a continuous unit is checked by exactly the same rule
 * as a discrete one — nothing here reads the spelling of a unit.
 */

const make = (over: Partial<Product> = {}): Product =>
  ({
    name: 'Yogurt 500ml',
    traceabilityLevel: TraceabilityLevel.SERIAL,
    baseUnit: null,
    packUnit: null,
    unitsPerPack: null,
    ...over,
  }) as Product;

const YOGURT = make({ baseUnit: 'BOTTLE', packUnit: 'CARTON', unitsPerPack: 24 });
const BULK_MILK = make({
  name: 'Bulk milk',
  baseUnit: 'LITRE',
  traceabilityLevel: TraceabilityLevel.BATCH,
});
const CEMENT = make({
  name: 'Cement',
  baseUnit: 'KG',
  packUnit: 'BAG',
  unitsPerPack: 50,
});

describe('what a product may be sold in', () => {
  it('offers a base unit on its own', () => {
    expect(sellableUnits(make({ baseUnit: 'BOTTLE' }))).toEqual(['BOTTLE']);
  });

  it('offers the base unit and the pack, base first', () => {
    // Order matters on screen: the finer unit is the one most orders use.
    expect(sellableUnits(YOGURT)).toEqual(['BOTTLE', 'CARTON']);
  });

  it('offers a pack even when no base unit is named', () => {
    // DR-09 does not require a base unit alongside a pack, so a product that
    // declares only a pack is sellable in it.
    expect(sellableUnits(make({ packUnit: 'CRATE', unitsPerPack: 12 }))).toEqual([
      'CRATE',
    ]);
  });

  it('offers nothing for a product that declares nothing', () => {
    // Every product in the catalogue today. A real answer, not a gap.
    expect(sellableUnits(make())).toEqual([]);
  });

  it('leaves out a pack that cannot convert', () => {
    // ProductService refuses to store this shape; the function must not offer
    // a choice that would fail the moment somebody picked it.
    expect(sellableUnits(make({ packUnit: 'CARTON', unitsPerPack: null }))).toEqual(
      [],
    );
    expect(
      sellableUnits(make({ baseUnit: 'KG', packUnit: 'BAG', unitsPerPack: 1 })),
    ).toEqual(['KG']);
  });

  it('treats a continuous base unit exactly like a discrete one', () => {
    // No KG/LITRE/METRE special case anywhere: cement is sold by weight and by
    // the bag, and that is the same shape as bottles and cartons.
    expect(sellableUnits(CEMENT)).toEqual(['KG', 'BAG']);
  });
});

describe('converting a sales unit to product units', () => {
  it('counts the base unit as one', () => {
    expect(unitsPerSalesUnit(YOGURT, 'BOTTLE')).toBe(1);
  });

  it('counts a pack as its size', () => {
    expect(unitsPerSalesUnit(YOGURT, 'CARTON')).toBe(24);
    expect(unitsPerSalesUnit(CEMENT, 'BAG')).toBe(50);
  });

  it('ignores surrounding whitespace', () => {
    expect(unitsPerSalesUnit(YOGURT, '  CARTON  ')).toBe(24);
  });

  it('refuses a unit the product does not offer', () => {
    // Returning a fallback factor here would multiply every downstream
    // quantity by a number nobody chose.
    expect(() => unitsPerSalesUnit(YOGURT, 'PALLET')).toThrow(
      TraceabilityRuleException,
    );
    expect(() => unitsPerSalesUnit(YOGURT, 'PALLET')).toThrow(
      /sold in BOTTLE or CARTON/,
    );
  });

  it('refuses a unit that differs only in case', () => {
    // Deciding "Carton" and "CARTON" are the same word is a judgement about
    // language, and the screen picks from sellableUnits anyway.
    expect(() => unitsPerSalesUnit(YOGURT, 'Carton')).toThrow(
      TraceabilityRuleException,
    );
  });

  it('refuses an empty or missing unit', () => {
    expect(() => unitsPerSalesUnit(YOGURT, '')).toThrow(TraceabilityRuleException);
    expect(() => unitsPerSalesUnit(YOGURT, '   ')).toThrow(
      TraceabilityRuleException,
    );
    expect(() =>
      unitsPerSalesUnit(YOGURT, null as unknown as string),
    ).toThrow(TraceabilityRuleException);
  });

  it('refuses a pack whose size cannot convert', () => {
    const broken = make({ baseUnit: 'BOTTLE', packUnit: 'CARTON', unitsPerPack: 1 });
    expect(() => unitsPerSalesUnit(broken, 'CARTON')).toThrow(
      TraceabilityRuleException,
    );
  });
});

describe('whether a line may be entered', () => {
  it('accepts an order in the base unit', () => {
    expect(salesUnitPermitted(YOGURT, 'BOTTLE', 2000)).toBe(true);
  });

  it('accepts an order in whole packs', () => {
    expect(salesUnitPermitted(YOGURT, 'CARTON', 84)).toBe(true);
  });

  it('accepts a fractional quantity of a continuous base unit', () => {
    // 12.5 kg of cement is a real order. Nothing inspects the unit's name to
    // decide that - it is simply not a pack, so nothing requires it to be whole.
    expect(salesUnitPermitted(CEMENT, 'KG', 12.5)).toBe(true);
  });

  it('refuses a fraction of a pack, and says what to do instead', () => {
    const verdict = salesUnitPermitted(YOGURT, 'CARTON', 2.5);

    expect(verdict).toContain('not a whole number of CARTON');
    expect(verdict).toContain('switch the line to BOTTLE');
  });

  it('refuses a unit the product does not offer', () => {
    expect(salesUnitPermitted(YOGURT, 'PALLET', 4)).toContain(
      'not sold in PALLET',
    );
  });

  it('refuses a missing unit rather than guessing one', () => {
    expect(salesUnitPermitted(YOGURT, '', 10)).toContain('Say what unit');
    expect(salesUnitPermitted(YOGURT, null as unknown as string, 10)).toContain(
      'Say what unit',
    );
  });

  it('explains a product that has no units declared at all', () => {
    const verdict = salesUnitPermitted(make(), 'BOTTLE', 10);

    expect(verdict).toContain('no sales units declared');
    expect(verdict).toContain('Set a base unit');
  });

  it('refuses a quantity of zero or less', () => {
    expect(salesUnitPermitted(YOGURT, 'BOTTLE', 0)).toContain('above zero');
    expect(salesUnitPermitted(YOGURT, 'BOTTLE', -5)).toContain('above zero');
  });

  it('refuses a quantity that is not a number', () => {
    expect(salesUnitPermitted(YOGURT, 'BOTTLE', Number.NaN)).toContain(
      'above zero',
    );
    expect(salesUnitPermitted(YOGURT, 'BOTTLE', Number.POSITIVE_INFINITY)).toContain(
      'above zero',
    );
  });

  it('lets a batch-traced product be ordered in its base unit', () => {
    // Whether the quantity matches the lot is a question about identities, so
    // reservation answers it. Entry only decides the unit.
    expect(salesUnitPermitted(BULK_MILK, 'LITRE', 500)).toBe(true);
  });

  it('refuses a pack of a batch-traced product, naming the reason', () => {
    // Bulk has no packs: one identity carries the whole lot, and selling a pack
    // of it would promise a subdivision the identity model cannot perform.
    const bulkWithPack = make({
      name: 'Bulk milk',
      baseUnit: 'LITRE',
      packUnit: 'DRUM',
      unitsPerPack: 200,
      traceabilityLevel: TraceabilityLevel.BATCH,
    });

    const verdict = salesUnitPermitted(bulkWithPack, 'DRUM', 3);

    expect(verdict).toContain('traced by the lot');
    expect(verdict).toContain(
      'partial fulfilment of a batch-traced product is not supported',
    );
  });

  it('allows a pack of a package-traced product', () => {
    // PACKAGE is not BATCH. The pack is the atom, and selling by it is the
    // point of the level.
    const cased = make({
      baseUnit: 'BOTTLE',
      packUnit: 'CASE',
      unitsPerPack: 12,
      traceabilityLevel: TraceabilityLevel.PACKAGE,
    });

    expect(salesUnitPermitted(cased, 'CASE', 40)).toBe(true);
  });

  it('never returns a bare false', () => {
    // Every refusal has to be sayable to a customer waiting on a quote.
    const refusals = [
      salesUnitPermitted(YOGURT, 'PALLET', 1),
      salesUnitPermitted(YOGURT, 'CARTON', 1.5),
      salesUnitPermitted(YOGURT, 'BOTTLE', 0),
      salesUnitPermitted(make(), 'BOTTLE', 1),
    ];

    for (const verdict of refusals) {
      expect(typeof verdict).toBe('string');
      expect((verdict as string).length).toBeGreaterThan(20);
    }
  });
});
