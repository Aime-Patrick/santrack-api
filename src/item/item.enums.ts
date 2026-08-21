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
 */
export enum ItemStatus {
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
  /** Terminal - physically destroyed or disposed of. */
  DESTROYED = 'DESTROYED',
}

/**
 * Statuses that block a normal sale (business rule 11).
 *
 * RETURNED is included: goods that came back up the chain have not been
 * inspected yet, and selling them on without a quality decision is exactly
 * what the return workflow exists to prevent. A RELEASE puts them back.
 */
export function blocksSale(status: ItemStatus): boolean {
  return (
    status === ItemStatus.RESERVED ||
    status === ItemStatus.QUARANTINED ||
    status === ItemStatus.RECALLED ||
    status === ItemStatus.EXPIRED ||
    status === ItemStatus.DAMAGED ||
    status === ItemStatus.DESTROYED ||
    status === ItemStatus.RETURNED ||
    status === ItemStatus.SOLD
  );
}

/** No further operations are possible once an item reaches a terminal state. */
export function isTerminal(status: ItemStatus): boolean {
  return status === ItemStatus.DESTROYED;
}
