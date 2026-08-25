import { TraceabilityRuleException } from '../common/errors';
import { Product } from './entities/product.entity';
import { TraceabilityLevel } from './traceability-level.enum';

/**
 * What a product may be sold in, and what that converts to (DR-09).
 *
 * Three layers sit under a sale and the vocabulary of each is different:
 * the customer speaks in a **sales unit** ("2,000 bottles", "84 cartons"),
 * stock is measured in **product units** (`TraceableItem.quantity`), and goods
 * move as whole **traceable identities**. This file is only the first
 * conversion — sales unit to product unit. Nothing here knows what is in stock,
 * and nothing here may decide what can actually be fulfilled: that needs
 * identities, and it belongs to reservation.
 *
 * Deliberately not a unit-of-measure engine. A product offers its base unit and
 * at most one pack, so there is exactly one factor and it is visible in one
 * place. There is no conversion table and no unit vocabulary: `KG`, `BOTTLE`
 * and `PALLET` are strings the trade chose, and the rules below never inspect
 * them. A continuous unit is governed by exactly the same compatibility rule as
 * a discrete one — what constrains it is the product's traceability level, not
 * its spelling.
 *
 * Everything here is pure. No database, no repository, no entity writes.
 */

/**
 * The units this product may be sold in: its base unit, then its pack.
 *
 * A pack with no size is left out. Offering a unit that cannot be converted
 * would put a choice in front of a salesperson that fails the moment they pick
 * it. `ProductService.resolvePackaging` refuses to store that shape, so this is
 * the second lock on the same door rather than the first.
 *
 * An empty list is a real answer: most of the catalogue declares no units at
 * all, and those products are quoted in bare numbers exactly as they are today.
 */
export function sellableUnits(product: Product): string[] {
  const units: string[] = [];

  if (product.baseUnit) {
    units.push(product.baseUnit);
  }
  if (product.packUnit && isWholePack(product.unitsPerPack)) {
    units.push(product.packUnit);
  }

  return units;
}

/**
 * Product units per one of `salesUnit`.
 *
 * One for the base unit — it *is* the product unit — and `unitsPerPack` for the
 * pack. Throws rather than returning a fallback for anything else: a wrong
 * factor here silently multiplies every quantity downstream, and a quantity
 * that is quietly wrong is worse than a request that fails.
 */
export function unitsPerSalesUnit(product: Product, salesUnit: string): number {
  const unit = normalise(salesUnit);

  if (unit && unit === product.baseUnit) {
    return 1;
  }
  if (unit && unit === product.packUnit && isWholePack(product.unitsPerPack)) {
    return product.unitsPerPack as number;
  }

  throw new TraceabilityRuleException(
    `${product.name} is not sold in ${salesUnit || 'that unit'}. ${offer(product)}`,
  );
}

/**
 * Whether a line may be entered at all.
 *
 * Returns `true`, or the sentence explaining the refusal — never a bare
 * `false`. This runs while a salesperson is mid-quote with a customer waiting,
 * and "invalid" tells them nothing they can act on. Every branch below names
 * what is wrong and what to do instead.
 *
 * Entry, not confirmation, is the right moment for these checks. A line refused
 * here costs a correction; the same line refused at confirmation costs a quote
 * already sent.
 *
 * What this cannot decide: whether enough stock exists, and — for a batch-traced
 * product — whether the requested quantity matches the lot. Both need
 * identities. Reservation refuses those, and it is the only place that honestly
 * can.
 */
export function salesUnitPermitted(
  product: Product,
  salesUnit: string,
  requestedQuantity: number,
): true | string {
  const unit = normalise(salesUnit);

  if (!unit) {
    return `Say what unit ${product.name} is being ordered in. ${offer(product)}`;
  }

  const offered = sellableUnits(product);
  if (offered.length === 0) {
    return (
      `${product.name} has no sales units declared, so it cannot be ordered by ` +
      'quantity yet. Set a base unit on the product first.'
    );
  }

  if (!offered.includes(unit)) {
    return `${product.name} is not sold in ${unit}. ${offer(product)}`;
  }

  /**
   * A pack is a countable object. Two and a half cartons is not a quantity
   * anybody can pick, and rounding it silently would change what the customer
   * asked for — the one thing DR-09 exists to prevent.
   */
  if (unit === product.packUnit && !Number.isInteger(requestedQuantity)) {
    return (
      `${requestedQuantity} is not a whole number of ${unit}. Order in whole ` +
      `${unit}, or switch the line to ${product.baseUnit ?? 'the base unit'}.`
    );
  }

  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    return `An order line for ${product.name} needs a quantity above zero.`;
  }

  /**
   * A batch-traced product is bulk: one identity carries the whole lot, and
   * there are no packs of it to sell. Selling it by the pack would promise a
   * subdivision the identity model cannot perform — which is the same missing
   * split operation that stops a part-lot being sold, arriving under a
   * different name (DR-09).
   */
  if (
    product.traceabilityLevel === TraceabilityLevel.BATCH &&
    unit === product.packUnit
  ) {
    return (
      `${product.name} is traced by the lot, so it has no ${unit} to sell. ` +
      `Order it in ${product.baseUnit ?? 'its base unit'} — the whole lot moves ` +
      'as one, and partial fulfilment of a batch-traced product is not supported.'
    );
  }

  return true;
}

/** A pack size that can actually convert: a whole number, at least two. */
function isWholePack(unitsPerPack: number | null): boolean {
  return (
    unitsPerPack !== null &&
    Number.isInteger(unitsPerPack) &&
    unitsPerPack >= 2
  );
}

/**
 * Units are compared exactly, after trimming. The screen picks from
 * `sellableUnits`, so an exact match is what a correct client always sends, and
 * accepting near-misses would mean deciding that "Carton" and "CARTON" are the
 * same word — a judgement about language this file has no business making.
 */
function normalise(salesUnit: string | null | undefined): string | null {
  return salesUnit?.trim() || null;
}

/** What the product *is* sold in, for the end of a refusal. */
function offer(product: Product): string {
  const units = sellableUnits(product);

  if (units.length === 0) {
    return 'It has no sales units declared yet.';
  }
  if (units.length === 1) {
    return `It is sold in ${units[0]}.`;
  }
  return `It is sold in ${units[0]} or ${units[1]}.`;
}
