/**
 * Where a production lot sits in the canonical lifecycle.
 *
 * The run finishes, quality control decides, and only an APPROVED lot may be
 * given product identities (use case 5: Approved / Rejected / Rework /
 * Quarantine; §7's "Approval → Packaging → Product Registration").
 */
export enum BatchStatus {
  /**
   * Made, awaiting a verdict. Where a completed production run leaves its lot.
   */
  PENDING_QC = 'PENDING_QC',
  /** Passed inspection. Identities may now be assigned. */
  APPROVED = 'APPROVED',
  /** Failed inspection. No identities may be assigned. Re-inspectable. */
  REJECTED = 'REJECTED',
  /** Sent back to production to be made right, then inspected again. */
  REWORK = 'REWORK',
  /**
   * Cleared for normal trade.
   *
   * Kept alongside APPROVED because a lot created directly - outside any
   * production order - has no run to inspect, and blocking it behind a QC
   * verdict that can never come would make the catalogue path unusable.
   */
  ACTIVE = 'ACTIVE',
  /** Under recall - nothing from this lot may be sold. */
  RECALLED = 'RECALLED',
  /** Held pending a quality decision. */
  QUARANTINED = 'QUARANTINED',
  /** Lot fully consumed or withdrawn. */
  CLOSED = 'CLOSED',
}

/**
 * Whether product identities may be minted against this lot.
 *
 * ACTIVE is included for lots created outside a production order; APPROVED is
 * the verdict a manufactured lot has to earn. Everything else - awaiting a
 * verdict, failed, being reworked, quarantined, recalled or closed - is a lot
 * whose goods must not acquire the identity that says the platform vouches
 * for them.
 */
export function permitsIdentityAssignment(status: BatchStatus): boolean {
  return status === BatchStatus.APPROVED || status === BatchStatus.ACTIVE;
}

/**
 * Whether quality control may still record a verdict on this lot.
 *
 * Rejection is deliberately not terminal: rework exists precisely so a failed
 * lot can be put right and looked at again. What closes the door is not the
 * verdict but circulation - once any of the lot has been dispatched or sold, a
 * later adverse finding is a recall, not a re-inspection. That check needs the
 * event log and so lives in the service; this covers only the states where
 * inspecting makes no sense at all.
 */
export function permitsInspection(status: BatchStatus): boolean {
  return (
    status === BatchStatus.PENDING_QC ||
    status === BatchStatus.APPROVED ||
    status === BatchStatus.REJECTED ||
    status === BatchStatus.REWORK ||
    status === BatchStatus.QUARANTINED ||
    status === BatchStatus.ACTIVE
  );
}

/** Lots whose goods may move and sell normally. */
export function permitsTrade(status: BatchStatus): boolean {
  return status === BatchStatus.ACTIVE || status === BatchStatus.APPROVED;
}
