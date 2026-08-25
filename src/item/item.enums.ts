/**
 * Whether a QR identity denotes one individually identifiable product or a
 * container holding other identities.
 */
export enum ItemKind {
  UNIT = 'UNIT',
  PACKAGE = 'PACKAGE',
}

/**
 * Packaging level of a container. Any type may nest inside any other, so the
 * hierarchy pallet -> carton -> box -> unit is expressed by containment rather
 * than by a fixed ordering here.
 */
export enum PackageType {
  BOX = 'BOX',
  CARTON = 'CARTON',
  CASE = 'CASE',
  SACK = 'SACK',
  CRATE = 'CRATE',
  PALLET = 'PALLET',
}

/**
 * Physical state of a container. Opening a package never destroys its
 * identity - it only changes this state (business rule 8).
 */
export enum SealState {
  SEALED = 'SEALED',
  OPEN = 'OPEN',
  EMPTY = 'EMPTY',
}

/**
 * Lifecycle status of a QR identity. A product never simply disappears from
 * inventory - it always ends in one of the terminal states below.
 *
 * The first two states exist because an identity is minted before the thing it
 * names exists (DR-08). A factory has to print labels before it can stick them
 * on bottles, so ten thousand codes can be real while zero bottles are.
 * GENERATED and ASSIGNED say exactly that: the code exists, the product does
 * not, and nothing may sell, dispatch or count it as stock until production
 * confirms it and it becomes ACTIVE.
 */
export enum ItemStatus {
  /**
   * Minted and printable. No physical product exists yet and none may be
   * assumed to - this is a label waiting for a bottle, not a bottle.
   */
  GENERATED = 'GENERATED',
  /**
   * Allocated to a production order. Still not a product: the run has been
   * planned and these codes reserved for it, nothing more.
   */
  ASSIGNED = 'ASSIGNED',
  /** Held by a business, available for normal operations. */
  ACTIVE = 'ACTIVE',
  /** Committed to a sales order; cannot be sold or dispatched elsewhere. */
  RESERVED = 'RESERVED',
  /** Dispatched but not yet confirmed received by the destination party. */
  IN_TRANSIT = 'IN_TRANSIT',
  /** Sold to another business or to a final consumer. */
  SOLD = 'SOLD',
  /** Sent back up the chain, awaiting inspection. */
  RETURNED = 'RETURNED',
  /** Held aside pending a decision; cannot be sold. */
  QUARANTINED = 'QUARANTINED',
  /** Covered by an active recall; cannot be sold. */
  RECALLED = 'RECALLED',
  /** Past its expiry date; cannot be sold. */
  EXPIRED = 'EXPIRED',
  DAMAGED = 'DAMAGED',
  /**
   * Terminal - the identity never became a product. The bottle broke on the
   * line, or the label was never used. Distinct from DESTROYED, which is a
   * real product that was disposed of: nothing was ever produced under a
   * CANCELLED code, and a scan of one must say so.
   */
  CANCELLED = 'CANCELLED',
  /** Terminal - physically destroyed or disposed of. */
  DESTROYED = 'DESTROYED',
}

/**
 * Why an identity was cancelled.
 *
 * One status with a reason rather than several statuses, because "broke on the
 * line" and "label never used" are the same lifecycle exit - the code will
 * never name a product - differing only in what the yield report is told. Two
 * statuses would mean two branches in every switch over ItemStatus, forever,
 * for a fact that fits in one column.
 */
export enum CancellationReason {
  /** The unit was made but failed - broke, leaked, failed inspection. */
  PRODUCTION_DEFECT = 'PRODUCTION_DEFECT',
  /** The label was printed but never applied to anything. */
  LABEL_UNUSED = 'LABEL_UNUSED',
  /** The label was damaged or destroyed before it could be applied. */
  LABEL_DAMAGED = 'LABEL_DAMAGED',
  /** The label printed wrong - unreadable, wrong product, wrong run. */
  MISPRINT = 'MISPRINT',
  OTHER = 'OTHER',
}

/**
 * The only statuses a sale may proceed from (business rule 11).
 *
 * An allowlist, deliberately. This was a denylist of statuses that block a
 * sale, which made "sellable" the default for anything not yet named - so a
 * status added to ItemStatus was silently sellable until somebody remembered
 * to add it to the list too. With GENERATED arriving that default is
 * dangerous: it would let a business sell ten thousand bottles that had never
 * been produced. Inverted, an unlisted status is refused, and the worst a
 * forgotten entry can do is block a legitimate sale.
 *
 * IN_TRANSIT is here because goods travelling to a buyer are refused earlier,
 * with a message that says they have not arrived yet - a more useful answer
 * than "cannot be sold".
 */
export const SELLABLE_STATUSES: readonly ItemStatus[] = [
  ItemStatus.ACTIVE,
  ItemStatus.IN_TRANSIT,
];

/** Whether this status stops a normal sale. */
export function blocksSale(status: ItemStatus): boolean {
  return !SELLABLE_STATUSES.includes(status);
}

/**
 * Statuses held by an identity that names no physical thing (DR-08).
 *
 * Every query that counts stock, values inventory or reports quantity has to
 * exclude these, or a pool of ten thousand printed labels is reported as ten
 * thousand bottles in the warehouse. Exported as one list so that filter is
 * written once and every caller shares it.
 */
export const NON_PHYSICAL_STATUSES: readonly ItemStatus[] = [
  ItemStatus.GENERATED,
  ItemStatus.ASSIGNED,
  ItemStatus.CANCELLED,
];

/** Whether a real physical thing exists under this identity. */
export function existsPhysically(status: ItemStatus): boolean {
  return !NON_PHYSICAL_STATUSES.includes(status);
}

/**
 * Whether the identity is minted but not yet produced - a label, not a
 * product. CANCELLED is excluded: it is also non-physical, but it is finished,
 * and a cancelled code is never awaiting production.
 */
export function isPreProduction(status: ItemStatus): boolean {
  return status === ItemStatus.GENERATED || status === ItemStatus.ASSIGNED;
}

/** No further operations are possible once an item reaches a terminal state. */
export function isTerminal(status: ItemStatus): boolean {
  return status === ItemStatus.DESTROYED || status === ItemStatus.CANCELLED;
}
