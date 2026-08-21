/**
 * Manufacturing module vocabulary (technical proposal section 3, and the
 * "Production Order -> Material Allocation -> Production -> Quality
 * Inspection -> Approval -> Packaging -> Product Registration" workflow).
 *
 * The transition guards below are the whole workflow in one table, so a
 * service can state what it allows and the tests can pin the rules down
 * without a database.
 */

/** Where a production order sits. */
export enum ProductionOrderStatus {
  /** Being planned. Nothing has been issued and nothing is running. */
  PLANNED = 'PLANNED',
  /** Materials are being issued and work is underway. */
  IN_PROGRESS = 'IN_PROGRESS',
  /** Work finished and a batch was opened for the finished goods. */
  COMPLETED = 'COMPLETED',
  /** Abandoned before or during production. No batch is opened. */
  CANCELLED = 'CANCELLED',
  /** Completed work that has been formally closed out. */
  CLOSED = 'CLOSED',
}

/** Steps in a production order's own history. Append-only, like events. */
export enum ProductionEventType {
  CREATED = 'CREATED',
  STARTED = 'STARTED',
  MATERIAL_ALLOCATED = 'MATERIAL_ALLOCATED',
  MATERIAL_ISSUED = 'MATERIAL_ISSUED',
  COMPLETED = 'COMPLETED',
  /**
   * A completed run's recorded output was corrected. Carries the before and
   * after, so the original figure is never overwritten (business rule 14).
   */
  QUANTITY_AMENDED = 'QUANTITY_AMENDED',
  CANCELLED = 'CANCELLED',
  CLOSED = 'CLOSED',
}

/** The verdict of a quality inspection. */
export enum InspectionResult {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  /** Sent back to production to be made right. */
  REWORK = 'REWORK',
  QUARANTINE = 'QUARANTINE',
}

export enum MachineStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  MAINTENANCE = 'MAINTENANCE',
}

// ------------------------------------------------------- transition guards

export function canStart(status: ProductionOrderStatus): boolean {
  return status === ProductionOrderStatus.PLANNED;
}

export function canAllocate(status: ProductionOrderStatus): boolean {
  return (
    status === ProductionOrderStatus.PLANNED ||
    status === ProductionOrderStatus.IN_PROGRESS
  );
}

export function canIssue(status: ProductionOrderStatus): boolean {
  return status === ProductionOrderStatus.IN_PROGRESS;
}

export function canComplete(status: ProductionOrderStatus): boolean {
  return status === ProductionOrderStatus.IN_PROGRESS;
}

export function canCancel(status: ProductionOrderStatus): boolean {
  return (
    status === ProductionOrderStatus.PLANNED ||
    status === ProductionOrderStatus.IN_PROGRESS
  );
}

export function canClose(status: ProductionOrderStatus): boolean {
  return status === ProductionOrderStatus.COMPLETED;
}

// --------------------------------------------------------------- rounding

/** Money. Two decimals, banker-free: these are costs on a label, not ledger. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Material quantities. Three decimals covers kilos and litres without letting
 * floating point drift accumulate into an allocation that no longer matches
 * what was issued to the line.
 */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
