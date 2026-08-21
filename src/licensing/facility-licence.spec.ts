import { NotFoundEntityException, TraceabilityRuleException } from '../common/errors';
import { OrganizationType } from '../organization/organization-type.enum';
import { LicenseService } from './services/license.service';
import { LicensedActivity, LicenseStatus } from './licensing.enums';

/**
 * DR-07 WU-3: applying for a licence about one site.
 *
 * This is the unit that opens the only write path to `licenses.facility_id`,
 * so it is where invariant 1 stops being a database assertion and becomes an
 * enforced rule: no licence may reference a facility belonging to another
 * organization.
 */
describe('applying for a site licence', () => {
  const ACME = { id: 1, name: 'Acme Dairy', type: OrganizationType.MANUFACTURER } as never;
  const ACTOR = { id: 7, fullName: 'Operator' } as never;

  const KIGALI = { id: 10, organizationId: 1, name: 'Kigali plant', active: true };
  const HUYE = { id: 11, organizationId: 1, name: 'Huye plant', active: true };
  const SOMEONE_ELSES = { id: 12, organizationId: 2, name: 'Their plant', active: true };

  const MFG = {
    id: 3,
    code: 'MFG',
    name: 'Manufacturing licence',
    activity: LicensedActivity.MANUFACTURING,
    active: true,
    appliesTo: [OrganizationType.MANUFACTURER],
    requiredDocuments: [],
  };

  function service(existing: Record<string, unknown>[] = []) {
    const saved: Record<string, unknown>[] = [];
    const facilities = [KIGALI, HUYE, SOMEONE_ELSES];

    const manager = {
      findOne: jest.fn((entity: { name: string }, { where }: { where: any }) => {
        if (entity.name === 'LicenseCategory') return Promise.resolve(MFG);
        if (entity.name === 'Facility') {
          return Promise.resolve(facilities.find((f) => f.id === where.id) ?? null);
        }
        if (entity.name !== 'License') return Promise.resolve(null);

        const wanted =
          where.facilityId && typeof where.facilityId === 'object'
            ? null // IsNull()
            : (where.facilityId as number | undefined);

        return Promise.resolve(
          existing.find((row) => {
            if (where.provisional !== undefined && row.provisional !== where.provisional) {
              return false;
            }
            if (where.status && !where.status.value.includes(row.status)) return false;
            return row.facilityId === (wanted ?? null);
          }) ?? null,
        );
      }),
      create: jest.fn((_entity: unknown, row: Record<string, unknown>) => row),
      save: jest.fn((row: Record<string, unknown>) => {
        saved.push(row);
        return Promise.resolve({ id: 90 + saved.length, ...row });
      }),
    };

    const instance = new LicenseService(
      { transaction: (work: (m: unknown) => Promise<unknown>) => work(manager) } as never,
      {} as never,
      {} as never,
      {} as never,
      { next: jest.fn().mockResolvedValue(1) } as never,
      {} as never,
    );

    return { instance, saved };
  }

  const licence = (facilityId: number | null) => ({
    facilityId,
    provisional: false,
    status: LicenseStatus.ACTIVE,
    licenseNumber: `LIC-${facilityId ?? 'ORG'}`,
  });

  describe('the write path', () => {
    it('records the site the application is about', async () => {
      const { instance, saved } = service();

      await instance.apply(ACME, ACTOR, { categoryId: MFG.id, facilityId: KIGALI.id });

      expect(saved[0].facilityId).toBe(KIGALI.id);
    });

    it('comes back able to name its site, without being reloaded', async () => {
      // Setting only the column left the new licence carrying an id and a null
      // name, so the applicant was shown a site licence with no site on it
      // until something re-read the row. Found by live check, not by typecheck.
      const { instance, saved } = service();

      await instance.apply(ACME, ACTOR, { categoryId: MFG.id, facilityId: KIGALI.id });

      expect((saved[0].facility as { name: string })?.name).toBe('Kigali plant');
    });

    it('still defaults to the business as a whole', async () => {
      // Naming a site is the exception. Most businesses are licensed as a
      // business, and leaving the field out must keep meaning that.
      const { instance, saved } = service();

      await instance.apply(ACME, ACTOR, { categoryId: MFG.id });

      expect(saved[0].facilityId).toBeNull();
    });
  });

  describe("invariant 1 — a licence may not name another business's site", () => {
    it("refuses another organization's facility", async () => {
      const { instance } = service();

      await expect(
        instance.apply(ACME, ACTOR, { categoryId: MFG.id, facilityId: SOMEONE_ELSES.id }),
      ).rejects.toBeInstanceOf(NotFoundEntityException);
    });

    it('refuses a facility that does not exist', async () => {
      const { instance } = service();

      await expect(
        instance.apply(ACME, ACTOR, { categoryId: MFG.id, facilityId: 4040 }),
      ).rejects.toBeInstanceOf(NotFoundEntityException);
    });

    it('writes nothing when the site is refused', async () => {
      // The refusal has to come before the row, or a rejected application
      // still consumes a licence number.
      const { instance, saved } = service();

      await expect(
        instance.apply(ACME, ACTOR, { categoryId: MFG.id, facilityId: SOMEONE_ELSES.id }),
      ).rejects.toThrow();
      expect(saved).toHaveLength(0);
    });
  });

  describe('one application per category and site', () => {
    it('lets a business apply for Huye while holding Kigali', async () => {
      // The case the whole grain change exists for. Scoped to the category
      // alone, the second plant could never be authorised.
      const { instance, saved } = service([licence(KIGALI.id)]);

      await instance.apply(ACME, ACTOR, { categoryId: MFG.id, facilityId: HUYE.id });

      expect(saved[0].facilityId).toBe(HUYE.id);
    });

    it('refuses a second application for the same site', async () => {
      const { instance } = service([licence(KIGALI.id)]);

      await expect(
        instance.apply(ACME, ACTOR, { categoryId: MFG.id, facilityId: KIGALI.id }),
      ).rejects.toBeInstanceOf(TraceabilityRuleException);
    });

    it('does not let a site licence block a business-wide application', async () => {
      const { instance, saved } = service([licence(KIGALI.id)]);

      await instance.apply(ACME, ACTOR, { categoryId: MFG.id });

      expect(saved[0].facilityId).toBeNull();
    });

    it('does not let a business-wide licence block a site application', async () => {
      const { instance, saved } = service([licence(null)]);

      await instance.apply(ACME, ACTOR, { categoryId: MFG.id, facilityId: KIGALI.id });

      expect(saved[0].facilityId).toBe(KIGALI.id);
    });
  });

  describe('renewal keeps the grain', () => {
    /** Renewal reads the licence through `requireOwn`, so that is what is stubbed. */
    function renewing(previous: Record<string, unknown>) {
      const saved: Record<string, unknown>[] = [];
      const manager = {
        // `require()` reaches the licence through a repository, not directly.
        getRepository: jest.fn(() => ({
          findOne: jest.fn(() => Promise.resolve(previous)),
        })),
        findOne: jest.fn(() => Promise.resolve(previous)),
        create: jest.fn((_e: unknown, row: Record<string, unknown>) => row),
        save: jest.fn((row: Record<string, unknown>) => {
          saved.push(row);
          return Promise.resolve({ id: 77, ...row });
        }),
      };
      const instance = new LicenseService(
        { transaction: (work: (m: unknown) => Promise<unknown>) => work(manager) } as never,
        {} as never,
        {} as never,
        {} as never,
        { next: jest.fn().mockResolvedValue(2) } as never,
        {} as never,
      );
      return { instance, saved };
    }

    const active = (facilityId: number | null) => ({
      id: 5,
      licenseNumber: 'LIC-OLD',
      status: LicenseStatus.ACTIVE,
      category: MFG,
      facilityId,
      organization: ACME,
    });

    it("carries the site forward, so Huye's renewal is still Huye's", async () => {
      // Without this the renewal comes back organization-wide: the plant
      // silently loses its own authorisation and inherits the company's,
      // taking the company's suspensions and expiry with it.
      const { instance, saved } = renewing(active(HUYE.id));

      await instance.renew(ACME, ACTOR, 5);

      expect(saved[0].facilityId).toBe(HUYE.id);
    });

    it('leaves a business-wide licence business-wide', async () => {
      const { instance, saved } = renewing(active(null));

      await instance.renew(ACME, ACTOR, 5);

      expect(saved[0].facilityId).toBeNull();
    });
  });
});
