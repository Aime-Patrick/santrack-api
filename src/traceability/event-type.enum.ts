/**
 * The vocabulary of lifecycle transitions. Every scan that changes what is
 * true about a physical product produces one of these, append-only.
 *
 * Names follow the technical proposal, section 20, extended with the
 * packaging, recall and correction transitions the proposal's list omits but
 * the domain requires.
 */
export enum EventType {
  // --- Batch-level: the manufacturing run, before identities are assigned.
  /** A production run opened against this lot. */
  PRODUCTION_STARTED = 'PRODUCTION_STARTED',
  /** Raw material consumed by the run. */
  MATERIAL_ISSUED = 'MATERIAL_ISSUED',
  /** The run finished; the lot now awaits quality control. */
  PRODUCTION_COMPLETED = 'PRODUCTION_COMPLETED',
  /** A quality officer recorded a verdict on the lot. */
  QC_INSPECTED = 'QC_INSPECTED',
  /** The lot passed and may now be given product identities. */
  BATCH_APPROVED = 'BATCH_APPROVED',
  /** The lot failed. No identities may be assigned to it. */
  BATCH_REJECTED = 'BATCH_REJECTED',
  /** Sent back to production to be made right, then re-inspected. */
  BATCH_REWORK = 'BATCH_REWORK',
  /**
   * The recorded output of a run was corrected. History is not rewritten:
   * the original figure stays on the completion event and this records the
   * change, who made it and why (business rule 14).
   */
  PRODUCED_QUANTITY_AMENDED = 'PRODUCED_QUANTITY_AMENDED',

  // --- Identity-level: the life of a code before it names a product (DR-08).
  /**
   * A code was minted into a pool. Nothing has been produced: this records
   * that the identity now exists and may be printed, and nothing more.
   */
  IDENTITY_GENERATED = 'IDENTITY_GENERATED',
  /** A minted code was allocated to a production order. Still not a product. */
  IDENTITY_ASSIGNED = 'IDENTITY_ASSIGNED',
  /**
   * A code will never name a product - the unit failed, or the label was never
   * used. Terminal, and never deleted: a cancelled code has to stay
   * answerable, so that scanning one in the market reports it as invalid
   * rather than as unknown.
   */
  IDENTITY_CANCELLED = 'IDENTITY_CANCELLED',

  // --- Item-level: everything from identity assignment onward.
  /**
   * The identity became a real product. Written when production confirms the
   * unit, not when the code was minted - minting a code makes no bottle.
   */
  MANUFACTURED = 'MANUFACTURED',
  /** Identity registered for a container. */
  PACKAGE_CREATED = 'PACKAGE_CREATED',
  /** An item was placed inside a container. */
  PACKAGED = 'PACKAGED',
  /** A container was opened; its identity survives. */
  PACKAGE_OPENED = 'PACKAGE_OPENED',
  /** An item was taken out of its container. */
  UNIT_REMOVED = 'UNIT_REMOVED',
  /** Sent towards another party; custody not yet confirmed. */
  DISPATCHED = 'DISPATCHED',
  /** Destination party confirmed physical receipt. */
  RECEIVED = 'RECEIVED',
  /** Moved between locations of the same organization. */
  RELOCATED = 'RELOCATED',
  RESERVED = 'RESERVED',
  SOLD = 'SOLD',
  DELIVERED = 'DELIVERED',
  RETURNED = 'RETURNED',
  RECALLED = 'RECALLED',
  QUARANTINED = 'QUARANTINED',
  /**
   * Back into normal stock, from wherever it was being held aside: released
   * from quarantine, released after a return was inspected, or released from
   * a sales-order reservation when that order is cancelled (DR-09 WU-6).
   *
   * Deliberately one event rather than three. All three describe the same
   * physical transition — goods that were unavailable are available again —
   * and the reservation case is told apart by its notes and by the
   * reservation rows, which are never deleted.
   */
  RELEASED = 'RELEASED',
  EXPIRED = 'EXPIRED',
  DAMAGED = 'DAMAGED',
  DESTROYED = 'DESTROYED',
  /**
   * Somebody asked what this identity is — a shopper scanning a bottle, an
   * inspector checking a shelf (proposal section 7, `VERIFY`).
   *
   * The odd one out in this enum: nothing about the product changes, and the
   * item's status is the same after as before. It is recorded anyway, because
   * on a counterfeit the pattern of scans *is* the evidence. One genuine code
   * verified forty times in four towns in a week is a cloned label, and that
   * is only visible if the scans were written down.
   *
   * Deliberately anonymous. The public endpoint has no account behind it, and
   * the scanner's address is not recorded — a verification says a code was
   * checked, never who checked it.
   */
  VERIFIED = 'VERIFIED',
  /** Compensating entry that corrects an earlier event (business rule 14). */
  CORRECTION = 'CORRECTION',
}

/**
 * Events that address a lot rather than an identity. Recorded against a batch,
 * with no item, because they happen before QC approves the run and identities
 * are assigned.
 */
export const BATCH_LEVEL_EVENTS: readonly EventType[] = [
  EventType.PRODUCTION_STARTED,
  EventType.MATERIAL_ISSUED,
  EventType.PRODUCTION_COMPLETED,
  EventType.QC_INSPECTED,
  EventType.BATCH_APPROVED,
  EventType.BATCH_REJECTED,
  EventType.BATCH_REWORK,
  EventType.PRODUCED_QUANTITY_AMENDED,
];

export function isBatchLevel(type: EventType): boolean {
  return BATCH_LEVEL_EVENTS.includes(type);
}

/**
 * Events that mean goods left the manufacturer's control.
 *
 * This is the recall boundary. A defect found while a lot is still in the
 * manufacturer's own warehouse can be handled by quarantine, re-inspection or
 * rework; once any of it has been dispatched or sold, the only honest response
 * is a recall, because the question has changed from "is this good?" to
 * "where did it go?".
 *
 * Note that identities existing is deliberately NOT the boundary. An approved
 * lot sitting labelled on the manufacturer's own racks has not entered
 * circulation, and forcing a recall for it would make recalls routine - which
 * is the fastest way to make people stop taking them seriously.
 */
export const RELEASE_EVENTS: readonly EventType[] = [
  EventType.DISPATCHED,
  EventType.SOLD,
];
