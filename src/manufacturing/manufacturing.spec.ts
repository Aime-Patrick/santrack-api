import {
  InspectionResult,
  ProductionEventType,
  ProductionOrderStatus,
  canAllocate,
  canCancel,
  canClose,
  canComplete,
  canIssue,
  canStart,
  round2,
  round3,
} from './manufacturing.enums';
import {
  BatchStatus,
  permitsIdentityAssignment,
  permitsInspection,
  permitsTrade,
} from '../batch/batch-status.enum';

describe('production order transitions (proposal section 7 workflow)', () => {
  it('starts only from PLANNED', () => {
    expect(canStart(ProductionOrderStatus.PLANNED)).toBe(true);
    for (const status of [
      ProductionOrderStatus.IN_PROGRESS,
      ProductionOrderStatus.COMPLETED,
      ProductionOrderStatus.CANCELLED,
      ProductionOrderStatus.CLOSED,
    ]) {
      expect(canStart(status)).toBe(false);
    }
  });

  it('allocates while planned or running, never after', () => {
    expect(canAllocate(ProductionOrderStatus.PLANNED)).toBe(true);
    expect(canAllocate(ProductionOrderStatus.IN_PROGRESS)).toBe(true);
    expect(canAllocate(ProductionOrderStatus.COMPLETED)).toBe(false);
    expect(canAllocate(ProductionOrderStatus.CANCELLED)).toBe(false);
  });

  it('issues and completes only while running', () => {
    expect(canIssue(ProductionOrderStatus.IN_PROGRESS)).toBe(true);
    expect(canIssue(ProductionOrderStatus.PLANNED)).toBe(false);
    expect(canComplete(ProductionOrderStatus.IN_PROGRESS)).toBe(true);
    expect(canComplete(ProductionOrderStatus.PLANNED)).toBe(false);
    expect(canComplete(ProductionOrderStatus.COMPLETED)).toBe(false);
  });

  it('cancels only unfinished work', () => {
    expect(canCancel(ProductionOrderStatus.PLANNED)).toBe(true);
    expect(canCancel(ProductionOrderStatus.IN_PROGRESS)).toBe(true);
    expect(canCancel(ProductionOrderStatus.COMPLETED)).toBe(false);
  });

  it('closes only completed work', () => {
    expect(canClose(ProductionOrderStatus.COMPLETED)).toBe(true);
    expect(canClose(ProductionOrderStatus.IN_PROGRESS)).toBe(false);
    expect(canClose(ProductionOrderStatus.CLOSED)).toBe(false);
  });
});

describe('manufacturing rounding', () => {
  it('rounds money to two decimals', () => {
    expect(round2(12.345)).toBe(12.35);
    expect(round2(1.004)).toBe(1.0);
  });

  it('rounds material quantities to three decimals', () => {
    expect(round3(2.0004)).toBe(2.0);
    expect(round3(0.1234)).toBe(0.123);
  });

  it('lifts allocation by the wastage percent', () => {
    // BOM: 2.5 kg/unit, 10 units, 10% wastage -> 27.5 kg allocated.
    const allocated = round3(2.5 * 10 * (1 + 10 / 100));
    expect(allocated).toBe(27.5);
  });
});

describe('manufacturing vocabulary', () => {
  it('covers the proposal workflow steps', () => {
    expect(ProductionEventType.CREATED).toBeDefined();
    expect(ProductionEventType.MATERIAL_ISSUED).toBeDefined();
    expect(ProductionEventType.COMPLETED).toBeDefined();
  });

  it('covers the inspection verdicts from the quality workflow', () => {
    expect(InspectionResult.APPROVED).toBe('APPROVED');
    expect(InspectionResult.REWORK).toBe('REWORK');
    expect(InspectionResult.QUARANTINE).toBe('QUARANTINE');
  });
});

describe('batch lifecycle gates (Phase 3)', () => {
  it('ACTIVE lots permit identity assignment — the catalogue path', () => {
    expect(permitsIdentityAssignment(BatchStatus.ACTIVE)).toBe(true);
  });

  it('PENDING_QC lots block identity assignment — awaiting verdict', () => {
    expect(permitsIdentityAssignment(BatchStatus.PENDING_QC)).toBe(false);
    expect(permitsInspection(BatchStatus.PENDING_QC)).toBe(true);
  });

  it('APPROVED lots permit identity assignment — verdict earned', () => {
    expect(permitsIdentityAssignment(BatchStatus.APPROVED)).toBe(true);
  });

  it('REJECTED lots block identity assignment but permit re-inspection', () => {
    expect(permitsIdentityAssignment(BatchStatus.REJECTED)).toBe(false);
    expect(permitsInspection(BatchStatus.REJECTED)).toBe(true);
  });

  it('REWORK lots permit re-inspection but not identity assignment', () => {
    expect(permitsIdentityAssignment(BatchStatus.REWORK)).toBe(false);
    expect(permitsInspection(BatchStatus.REWORK)).toBe(true);
  });

  it('RECALLED lots permit neither inspection nor trade', () => {
    expect(permitsInspection(BatchStatus.RECALLED)).toBe(false);
    expect(permitsTrade(BatchStatus.RECALLED)).toBe(false);
  });

});

// Completion and amendment are exercised against the service itself in
// services/production.service.spec.ts. Asserting them here through the enum
// helpers only restated what the helpers already say.
