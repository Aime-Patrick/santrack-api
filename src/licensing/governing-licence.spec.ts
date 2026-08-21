import { License } from './entities/license.entity';
import {
  best,
  governingPool,
  grainOf,
  permitsOperation,
} from './governing-licence';
import { LicensedActivity, LicenseStatus, LicenseVerdict } from './licensing.enums';

/**
 * DR-07 WU-2: which licence governs, and the facility replacement rule (D1).
 *
 * Two implementations of this question used to exist. `assess()` ranked by
 * verdict over a date-ordered query; `effectiveLicense()` returned the first row
 * Postgres handed back, with no ordering and no ranking. That was invisible
 * while every business held one licence. With site-scoped licences it would
 * have made the governing licence — and so the regulatory verdict — depend on
 * row order.
 */
describe('the governing licence', () => {
  const KIGALI = 10;
  const HUYE = 11;

  const ACME = { id: 1, name: 'Acme Dairy' };

  let counter = 0;

  function licence(over: Partial<License> & { activity?: LicensedActivity } = {}) {
    const { activity = LicensedActivity.MANUFACTURING, ...rest } = over;
    const row = Object.assign(new License(), {
      id: ++counter,
      licenseNumber: `LIC-${counter}`,
      organization: ACME,
      category: { activity },
      status: LicenseStatus.ACTIVE,
      facilityId: null,
      facility: null,
      issuedOn: '2026-01-01',
      expiresOn: '2027-01-01',
      provisional: false,
      ...rest,
    });
    return row as License;
  }

  const on = '2026-08-21';
  const resolve = (
    pool: License[],
    facilityId: number | null,
    activity = LicensedActivity.MANUFACTURING,
  ) => best(governingPool(pool, activity, facilityId), on);

  describe('grain', () => {
    it('reads a null facility as an organization-wide licence', () => {
      expect(grainOf(licence())).toBe('ORGANIZATION');
    });

    it('reads a facility as a site licence', () => {
      expect(grainOf(licence({ facilityId: KIGALI }))).toBe('FACILITY');
    });
  });

  describe('D1 — a site licence replaces the organization-wide one for that site', () => {
    it('uses the site licence where one exists', () => {
      // Invariant 4: where a facility-scoped licence exists in a decided state,
      // it - and not the organization-scoped one - decides for that facility.
      const national = licence();
      const kigali = licence({ facilityId: KIGALI, status: LicenseStatus.SUSPENDED });

      const { verdict, license } = resolve([national, kigali], KIGALI);

      expect(license?.id).toBe(kigali.id);
      expect(verdict).toBe(LicenseVerdict.SUSPENDED);
    });

    it('falls back to the organization-wide licence for a site with none of its own', () => {
      const national = licence();
      const kigali = licence({ facilityId: KIGALI });

      const { verdict, license } = resolve([national, kigali], HUYE);

      expect(license?.id).toBe(national.id);
      expect(verdict).toBe(LicenseVerdict.LICENSED);
    });

    it('suspending one site leaves its sibling alone', () => {
      // Invariant 5. This is the whole point of replacement: without it,
      // suspending Huye would change nothing because the national licence
      // would still pass and the plant would carry on producing.
      const national = licence();
      const huye = licence({ facilityId: HUYE, status: LicenseStatus.SUSPENDED });

      expect(resolve([national, huye], HUYE).verdict).toBe(LicenseVerdict.SUSPENDED);
      expect(resolve([national, huye], KIGALI).verdict).toBe(LicenseVerdict.LICENSED);
    });

    it("never lets one site's licence authorise another", () => {
      // Invariant 3.
      const kigali = licence({ facilityId: KIGALI });

      expect(resolve([kigali], HUYE).verdict).toBe(LicenseVerdict.NONE);
      expect(resolve([kigali], HUYE).license).toBeNull();
    });

    it('cuts both ways: a lapsed site licence stops that site while the company is licensed', () => {
      // The consequence accepted when D1 was signed. Replacement is not a
      // one-way widening - it is the site's own licence, for better and worse.
      const national = licence();
      const huye = licence({ facilityId: HUYE, expiresOn: '2026-03-01' });

      expect(resolve([national, huye], HUYE).verdict).toBe(LicenseVerdict.EXPIRED);
      expect(resolve([national, huye], null).verdict).toBe(LicenseVerdict.LICENSED);
    });

    it('answers an unnamed-site question from organization-wide licences only', () => {
      // "Is this business licensed to manufacture?" is a question about the
      // business. A Kigali-only licence does not make the company licensed in
      // general, and letting it would be replacement running backwards.
      const kigali = licence({ facilityId: KIGALI });

      expect(resolve([kigali], null).verdict).toBe(LicenseVerdict.NONE);
    });
  });

  describe('ranking, shared by both callers', () => {
    it('prefers an active licence over a suspended one', () => {
      const suspended = licence({ status: LicenseStatus.SUSPENDED });
      const active = licence();

      expect(resolve([suspended, active], null).license?.id).toBe(active.id);
    });

    it('is not decided by row order', () => {
      // The defect this consolidation exists to remove: one resolution path
      // had no ORDER BY and no ranking at all.
      const suspended = licence({ status: LicenseStatus.SUSPENDED });
      const active = licence();

      expect(resolve([suspended, active], null).license?.id).toBe(
        resolve([active, suspended], null).license?.id,
      );
    });

    it('does not let an older expired licence cure a revoked one', () => {
      const revoked = licence({ status: LicenseStatus.REVOKED });
      const expired = licence({ status: LicenseStatus.EXPIRED });

      expect(resolve([expired, revoked], null).verdict).toBe(LicenseVerdict.REVOKED);
    });

    it('treats an in-date status as lapsed once the date has passed', () => {
      const lapsed = licence({ expiresOn: '2026-01-31' });

      expect(resolve([lapsed], null).verdict).toBe(LicenseVerdict.EXPIRED);
    });

    it('ignores licences for another activity', () => {
      const retail = licence({ activity: LicensedActivity.RETAIL });

      expect(resolve([retail], null).verdict).toBe(LicenseVerdict.NONE);
    });
  });

  describe('a licence pointing at another business\'s site', () => {
    it('is never treated as governing', () => {
      // Invariant 1. No route in the application can produce this and the
      // foreign key cannot express the constraint, so the resolver refuses to
      // rely on such a row rather than trusting it away.
      const foreign = licence({
        facilityId: KIGALI,
        facility: { id: KIGALI, organizationId: 999 } as never,
      });

      expect(resolve([foreign], KIGALI).verdict).toBe(LicenseVerdict.NONE);
    });

    it('does not suppress the organization-wide licence either', () => {
      const national = licence();
      const foreign = licence({
        facilityId: KIGALI,
        status: LicenseStatus.REVOKED,
        facility: { id: KIGALI, organizationId: 999 } as never,
      });

      expect(resolve([national, foreign], KIGALI).license?.id).toBe(national.id);
    });
  });

  describe('what still authorises operation', () => {
    it.each([
      [LicenseVerdict.LICENSED, true],
      [LicenseVerdict.SUSPENDED, true],
      [LicenseVerdict.EXPIRED, false],
      [LicenseVerdict.REVOKED, false],
      [LicenseVerdict.NONE, false],
    ])('%s -> %s', (verdict, expected) => {
      expect(permitsOperation(verdict)).toBe(expected);
    });
  });
});
