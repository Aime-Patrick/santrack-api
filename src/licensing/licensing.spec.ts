import { addMonths } from './services/license.service';
import {
  LicenseStatus,
  permitsOperation,
  permitsReturns,
} from './licensing.enums';
import { License } from './entities/license.entity';

describe('what a licence permits', () => {
  it('only lets an ACTIVE licence authorise work', () => {
    for (const status of Object.values(LicenseStatus)) {
      expect(permitsOperation(status)).toBe(status === LicenseStatus.ACTIVE);
    }
  });

  it('still lets a suspended holder take goods back', () => {
    // The defect case: when product is bad you want it flowing back to the
    // manufacturer. A state that blocked returns would strand it in shops.
    expect(permitsReturns(LicenseStatus.SUSPENDED)).toBe(true);
    expect(permitsReturns(LicenseStatus.EXPIRED)).toBe(true);
  });

  it('closes the door completely once revoked', () => {
    expect(permitsReturns(LicenseStatus.REVOKED)).toBe(false);
    expect(permitsOperation(LicenseStatus.REVOKED)).toBe(false);
  });

  it('authorises nothing while an application is still being screened', () => {
    for (const status of [
      LicenseStatus.DRAFT,
      LicenseStatus.SUBMITTED,
      LicenseStatus.UNDER_REVIEW,
      LicenseStatus.REJECTED,
    ]) {
      expect(permitsOperation(status)).toBe(false);
      expect(permitsReturns(status)).toBe(false);
    }
  });
});

describe('licence validity window', () => {
  function licence(issuedOn: string | null, expiresOn: string | null): License {
    const l = new License();
    l.issuedOn = issuedOn;
    l.expiresOn = expiresOn;
    return l;
  }

  it('is valid on its first and last day', () => {
    const l = licence('2026-01-01', '2026-12-31');
    expect(l.isWithinDates('2026-01-01')).toBe(true);
    expect(l.isWithinDates('2026-12-31')).toBe(true);
  });

  it('is not valid before it was issued or after it lapsed', () => {
    const l = licence('2026-01-01', '2026-12-31');
    expect(l.isWithinDates('2025-12-31')).toBe(false);
    expect(l.isWithinDates('2027-01-01')).toBe(false);
  });

  it('treats a missing expiry as open-ended', () => {
    // Only the platform's own regulatory licences are issued this way.
    expect(licence('2026-01-01', null).isWithinDates('2099-01-01')).toBe(true);
  });
});

describe('renewal dates', () => {
  it('adds whole months', () => {
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15');
    expect(addMonths('2026-08-18', 24)).toBe('2028-08-18');
  });

  it('clamps to the end of a shorter month', () => {
    // A licence issued on the 31st must not silently land on the 1st.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
  });

  it('handles a leap February', () => {
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });
});
