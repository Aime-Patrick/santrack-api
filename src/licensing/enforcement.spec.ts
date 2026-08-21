import { License } from './entities/license.entity';
import {
  ComplianceFindingType,
  LicenseStatus,
  LicenseVerdict,
  findingFor,
} from './licensing.enums';

/**
 * The judgement and precedence rules behind advisory enforcement, exercised as
 * pure functions. The service that wraps them needs a database; these are the
 * parts that decide whether a business is compliant, so they are pinned here.
 *
 * Mirrors the private helpers in license-enforcement.service.ts. Kept in step
 * deliberately: if one changes without the other, these tests fail.
 */
function judge(license: Pick<License, 'status' | 'isWithinDates'>, on: string) {
  if (license.status === LicenseStatus.REVOKED) return LicenseVerdict.REVOKED;
  if (license.status === LicenseStatus.SUSPENDED) return LicenseVerdict.SUSPENDED;
  if (license.status === LicenseStatus.EXPIRED || !license.isWithinDates(on)) {
    return LicenseVerdict.EXPIRED;
  }
  return LicenseVerdict.LICENSED;
}

function rank(verdict: LicenseVerdict): number {
  switch (verdict) {
    case LicenseVerdict.LICENSED:
      return 4;
    case LicenseVerdict.REVOKED:
      return 3;
    case LicenseVerdict.SUSPENDED:
      return 2;
    case LicenseVerdict.EXPIRED:
      return 1;
    default:
      return 0;
  }
}

/** A licence stub that answers only what judging needs. */
function licence(status: LicenseStatus, withinDates = true) {
  return { status, isWithinDates: () => withinDates } as Pick<
    License,
    'status' | 'isWithinDates'
  >;
}

const TODAY = '2026-08-20';

describe('licence judgement', () => {
  it('treats an active licence inside its dates as licensed', () => {
    expect(judge(licence(LicenseStatus.ACTIVE), TODAY)).toBe(LicenseVerdict.LICENSED);
  });

  it('treats an active licence past its dates as expired without waiting for a sweep', () => {
    // The stored status still says ACTIVE; the date is what decides.
    expect(judge(licence(LicenseStatus.ACTIVE, false), TODAY)).toBe(
      LicenseVerdict.EXPIRED,
    );
  });

  it('reports suspension ahead of expiry, because it is a decision not a date', () => {
    expect(judge(licence(LicenseStatus.SUSPENDED, false), TODAY)).toBe(
      LicenseVerdict.SUSPENDED,
    );
  });

  it('reports revocation whatever the dates say', () => {
    expect(judge(licence(LicenseStatus.REVOKED, true), TODAY)).toBe(
      LicenseVerdict.REVOKED,
    );
  });
});

describe('precedence between several licences for one activity', () => {
  it('lets a valid licence outrank a lapsed one', () => {
    expect(rank(LicenseVerdict.LICENSED)).toBeGreaterThan(rank(LicenseVerdict.EXPIRED));
  });

  it('does not let an old expired licence soften a revocation', () => {
    // Revoking is a standing decision about the business. An unrelated lapsed
    // licence sitting beside it must not be the one that gets reported.
    expect(rank(LicenseVerdict.REVOKED)).toBeGreaterThan(rank(LicenseVerdict.EXPIRED));
    expect(rank(LicenseVerdict.REVOKED)).toBeGreaterThan(rank(LicenseVerdict.SUSPENDED));
  });

  it('still lets a genuine renewal win over an earlier suspension', () => {
    expect(rank(LicenseVerdict.LICENSED)).toBeGreaterThan(rank(LicenseVerdict.REVOKED));
  });

  it('ranks having nothing lowest', () => {
    expect(rank(LicenseVerdict.NONE)).toBe(0);
  });
});

describe('findings raised', () => {
  it('raises no finding when the business is licensed', () => {
    expect(findingFor(LicenseVerdict.LICENSED)).toBeNull();
  });

  it('raises no finding for revocation, which is refused rather than recorded', () => {
    expect(findingFor(LicenseVerdict.REVOKED)).toBeNull();
  });

  it('maps each non-compliant verdict to its own finding', () => {
    expect(findingFor(LicenseVerdict.NONE)).toBe(
      ComplianceFindingType.UNLICENSED_ACTIVITY,
    );
    expect(findingFor(LicenseVerdict.EXPIRED)).toBe(
      ComplianceFindingType.EXPIRED_LICENCE,
    );
    expect(findingFor(LicenseVerdict.SUSPENDED)).toBe(
      ComplianceFindingType.SUSPENDED_LICENCE,
    );
  });
});
