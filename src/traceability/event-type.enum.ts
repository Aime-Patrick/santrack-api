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

  // --- Item-level: everything from identity assignment onward.
  /** Identity created at the point of manufacture. */
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
  /** Released from quarantine or return back into normal stock. */
  RELEASED = 'RELEASED',
  EXPIRED = 'EXPIRED',
  DAMAGED = 'DAMAGED',
  DESTROYED = 'DESTROYED',
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
