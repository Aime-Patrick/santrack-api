/**
 * How finely a product is traced (DR-01).
 *
 * Not every product earns a serial number. A laptop does: it is warranted,
 * serviced and individually identifiable, and one QR per unit is exactly right.
 * A pot of yogurt does not — a 10,000-unit run would become 10,000 identities
 * and 10,000 labels for goods that the trade, and the regulator, track by lot.
 *
 * This is a property of the product, so the catalogue decides it rather than the
 * platform imposing one answer on everything.
 */
export enum TraceabilityLevel {
  /** One identity for the whole registered quantity. Lot-traced goods. */
  BATCH = 'BATCH',
  /** One identity per pack, each carrying the units inside it. */
  PACKAGE = 'PACKAGE',
  /** One identity per physical unit. The default, and the strictest. */
  SERIAL = 'SERIAL',
}

/**
 * Strictness order: BATCH < PACKAGE < SERIAL.
 *
 * Exists so a future regulatory minimum can be compared against a product's own
 * setting and the stricter of the two win. Nothing uses it for that yet — the
 * regulatory side is deferred — but the ordering is the invariant DR-05 agreed,
 * and stating it here keeps it from being re-derived differently later.
 */
export const TRACEABILITY_STRICTNESS: Record<TraceabilityLevel, number> = {
  [TraceabilityLevel.BATCH]: 0,
  [TraceabilityLevel.PACKAGE]: 1,
  [TraceabilityLevel.SERIAL]: 2,
};

/** The stricter of two levels. Regulation may raise a level, never lower it. */
export function stricter(
  a: TraceabilityLevel,
  b: TraceabilityLevel,
): TraceabilityLevel {
  return TRACEABILITY_STRICTNESS[a] >= TRACEABILITY_STRICTNESS[b] ? a : b;
}

/**
 * Whether a pool of identities is a meaningful thing to mint for this level
 * (DR-09).
 *
 * A pool is a print run of labels, and a label goes on one thing. That only
 * says something true when one identity names one unit - which is SERIAL and
 * nothing else. Ten thousand codes minted for a BATCH-traced lot would come
 * back as ten thousand identities each claiming a single pot, contradicting
 * the catalogue entry that says the whole lot is one identity.
 *
 * The check exists because the two stock-in doors disagreed about what this
 * enum means. `registerUnits` honours it through `unitsPerIdentity`; the pool
 * mints `quantity: 1` unconditionally and never reads it, so the same product
 * got different granularity depending on which door its stock came through,
 * and nothing warned anybody.
 *
 * Refusing is deliberate rather than teaching the pool to split a run. That
 * would be a second implementation of DR-01's rule, free to drift from the
 * first - and the pool has no run to split against at minting time anyway,
 * because a pool is requested before any production order exists (DR-08).
 */
export function permitsIdentityPool(level: TraceabilityLevel): boolean {
  return level === TraceabilityLevel.SERIAL;
}
