import {
  BatchStatus,
  permitsIdentityAssignment,
  permitsInspection,
  permitsTrade,
} from './batch-status.enum';

describe('BatchStatus lifecycle gates', () => {
  describe('permitsIdentityAssignment', () => {
    it('allows APPROVED and ACTIVE', () => {
      expect(permitsIdentityAssignment(BatchStatus.APPROVED)).toBe(true);
      expect(permitsIdentityAssignment(BatchStatus.ACTIVE)).toBe(true);
    });

    it('blocks PENDING_QC, REJECTED, REWORK, QUARANTINED, RECALLED, CLOSED', () => {
      for (const status of [
        BatchStatus.PENDING_QC,
        BatchStatus.REJECTED,
        BatchStatus.REWORK,
        BatchStatus.QUARANTINED,
        BatchStatus.RECALLED,
        BatchStatus.CLOSED,
      ]) {
        expect(permitsIdentityAssignment(status)).toBe(false);
      }
    });
  });

  describe('permitsInspection', () => {
    it('allows PENDING_QC, APPROVED, REJECTED, REWORK, QUARANTINED, ACTIVE', () => {
      for (const status of [
        BatchStatus.PENDING_QC,
        BatchStatus.APPROVED,
        BatchStatus.REJECTED,
        BatchStatus.REWORK,
        BatchStatus.QUARANTINED,
        BatchStatus.ACTIVE,
      ]) {
        expect(permitsInspection(status)).toBe(true);
      }
    });

    it('blocks RECALLED and CLOSED', () => {
      expect(permitsInspection(BatchStatus.RECALLED)).toBe(false);
      expect(permitsInspection(BatchStatus.CLOSED)).toBe(false);
    });
  });

  describe('permitsTrade', () => {
    it('allows ACTIVE and APPROVED', () => {
      expect(permitsTrade(BatchStatus.ACTIVE)).toBe(true);
      expect(permitsTrade(BatchStatus.APPROVED)).toBe(true);
    });

    it('blocks everything else', () => {
      for (const status of [
        BatchStatus.PENDING_QC,
        BatchStatus.REJECTED,
        BatchStatus.REWORK,
        BatchStatus.QUARANTINED,
        BatchStatus.RECALLED,
        BatchStatus.CLOSED,
      ]) {
        expect(permitsTrade(status)).toBe(false);
      }
    });
  });
});

describe('BatchStatus canonical lifecycle', () => {
  it('production order batch lifecycle: ACTIVE → PENDING_QC → APPROVED/REJECTED', () => {
    // Batch created at order creation
    expect(permitsIdentityAssignment(BatchStatus.ACTIVE)).toBe(true);

    // Production complete: moves to PENDING_QC
    expect(permitsIdentityAssignment(BatchStatus.PENDING_QC)).toBe(false);
    expect(permitsInspection(BatchStatus.PENDING_QC)).toBe(true);

    // QC approves
    expect(permitsIdentityAssignment(BatchStatus.APPROVED)).toBe(true);

    // QC rejects (not terminal — can re-inspect after rework)
    expect(permitsIdentityAssignment(BatchStatus.REJECTED)).toBe(false);
    expect(permitsInspection(BatchStatus.REJECTED)).toBe(true);

    // Rework
    expect(permitsInspection(BatchStatus.REWORK)).toBe(true);

    // After rework, re-inspect: back to PENDING_QC or APPROVED
    expect(permitsIdentityAssignment(BatchStatus.APPROVED)).toBe(true);
  });

  it('rejection is not terminal — re-inspectable after rework', () => {
    expect(permitsInspection(BatchStatus.REJECTED)).toBe(true);
    expect(permitsInspection(BatchStatus.REWORK)).toBe(true);
  });

  it('circulation boundary prevents re-inspection but not via enum alone', () => {
    // The circulation check requires the event log (RELEASE_EVENTS),
    // not just the enum. permitsInspection still allows it; the service
    // layer checks the event log separately.
    expect(permitsInspection(BatchStatus.APPROVED)).toBe(true);
  });
});
