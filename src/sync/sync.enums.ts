/**
 * The field operations a device can perform without a connection and replay
 * later (Core Architecture §10 module 12, §11, §17).
 *
 * Only operations that change what is true about a physical thing appear here.
 * Reads need no queue, and anything that needs a second party present - a
 * regulator's decision, a licence application - is not a field operation.
 */
export enum SyncOperationType {
  REGISTER_UNITS = 'REGISTER_UNITS',
  REGISTER_PACKAGE = 'REGISTER_PACKAGE',
  PACK = 'PACK',
  OPEN_PACKAGE = 'OPEN_PACKAGE',
  REMOVE_UNIT = 'REMOVE_UNIT',
  LIFECYCLE = 'LIFECYCLE',
  DISPATCH = 'DISPATCH',
  RECEIVE = 'RECEIVE',
  RELOCATE = 'RELOCATE',
  SELL = 'SELL',
}

/**
 * What happened to one queued operation.
 *
 * DUPLICATE is a success, not a failure. Business rule 12 says a device that
 * reconnects twice must not record its work twice; a device that is told
 * "already applied" has achieved exactly what it wanted and should mark the
 * operation synchronised. Reporting it as an error would make clients retry
 * forever.
 */
export enum SyncResultStatus {
  APPLIED = 'APPLIED',
  DUPLICATE = 'DUPLICATE',
  FAILED = 'FAILED',
}

/** Whether the queue should keep going after this outcome. */
export function isSettled(status: SyncResultStatus): boolean {
  return status === SyncResultStatus.APPLIED || status === SyncResultStatus.DUPLICATE;
}
