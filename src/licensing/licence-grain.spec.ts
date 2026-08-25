import { FindOperator } from 'typeorm';
import { TraceabilityRuleException } from '../common/errors';
import { OrganizationType } from '../organization/organization-type.enum';
import { LicenseService } from './services/license.service';
import { LicensedActivity, LicenseStatus } from './licensing.enums';

/**
 * DR-07 WU-2: the two licence queries that change meaning the moment
 * `licenses.facility_id` exists.
 *
 * Both used to ask about an organization without saying at what grain. Left
 * that way, a site-scoped licence would answer questions that were never about
 * a site: it would block an application for a different plant, and it would
 * suppress the onboarding grace a new business is entitled to.
 */
describe('licence queries after M1', () => {
  const ACME = { id: 1, name: 'Acme Dairy', type: OrganizationType.MANUFACTURER } as never;
  const ACTOR = { id: 7, fullName: 'Operator' } as never;
  const HUYE = 11;

  const MFG = {
    id: 3,
    code: 'MFG',
    name: 'Manufacturing licence',
    activity: LicensedActivity.MANUFACTURING,
    active: true,
    appliesTo: [OrganizationType.MANUFACTURER],
  };

  /** True when a `where` value is TypeORM's IsNull() rather than a number. */
  const asksForNull = (value: unknown) =>
    value instanceof FindOperator && value.type === 'isNull';

  function service(existing: Record<string, unknown>[]) {
    const saved: Record<string, unknown>[] = [];

    const manager = {
      findOne: jest.fn((entity: { name: string }, { where }: { where: any }) => {
        if (entity.name === 'LicenseCategory') {
          return Promise.resolve(MFG);
        }
        if (entity.name !== 'License') {
          return Promise.resolve(null);
        }

        const match = existing.find((row) => {
          if (where.category && row.categoryId !== where.category.id) return false;
          if (where.provisional !== undefined && row.provisional !== where.provisional) {
            return false;
          }
          if (where.status && !where.status.value.includes(row.status)) return false;

          // The predicate under test.
          if (where.facilityId !== undefined) {
            return asksForNull(where.facilityId)
              ? row.facilityId === null
              : row.facilityId === where.facilityId;
          }
          return true;
        });
        return Promise.resolve(match ?? null);
      }),
      create: jest.fn((_entity: unknown, row: Record<string, unknown>) => row),
      save: jest.fn((row: Record<string, unknown>) => {
        saved.push(row);
        return Promise.resolve({ id: 99, ...row });
      }),
    };

    const instance = new LicenseService(
      { transaction: (work: (m: unknown) => Promise<unknown>) => work(manager) } as never,
      {} as never,
      {} as never,
      {} as never,
      { next: jest.fn().mockResolvedValue(1) } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { instance, manager, saved };
  }

  const siteLicence = {
    categoryId: MFG.id,
    facilityId: HUYE,
    provisional: false,
    status: LicenseStatus.ACTIVE,
    licenseNumber: 'LIC-HUYE',
  };
  const nationalLicence = {
    categoryId: MFG.id,
    facilityId: null,
    provisional: false,
    status: LicenseStatus.ACTIVE,
    licenseNumber: 'LIC-NATIONAL',
  };

  describe('apply()', () => {
    it('scopes the duplicate check to the grain being applied for', async () => {
      const { instance, manager } = service([]);

      await instance.apply(ACME, ACTOR, { categoryId: MFG.id } as never);

      const [, options] = manager.findOne.mock.calls.find(
        (call) => (call[0] as { name: string }).name === 'License',
      ) as [unknown, { where: Record<string, unknown> }];
      expect(asksForNull(options.where.facilityId)).toBe(true);
    });

    it('lets a business apply while it already holds a site licence', async () => {
      // Inyange holding Kigali's licence must still be able to apply for Huye.
      // Unscoped, the site licence would collide with the new application and
      // the second plant could never be authorised.
      const { instance } = service([siteLicence]);

      await expect(
        instance.apply(ACME, ACTOR, { categoryId: MFG.id } as never),
      ).resolves.toBeDefined();
    });

    it('still refuses a second application at the same grain', async () => {
      const { instance } = service([nationalLicence]);

      await expect(
        instance.apply(ACME, ACTOR, { categoryId: MFG.id } as never),
      ).rejects.toBeInstanceOf(TraceabilityRuleException);
    });

    it('records the grain it applied at', async () => {
      const { instance, saved } = service([]);

      await instance.apply(ACME, ACTOR, { categoryId: MFG.id } as never);

      expect(saved[0].facilityId).toBeNull();
    });
  });

  describe('issueProvisional()', () => {
    it('asks whether the business holds anything, not whether any site does', async () => {
      const { instance, manager } = service([]);

      await instance.issueProvisional(ACME, 90);

      const [, options] = manager.findOne.mock.calls.find(
        (call) => (call[0] as { name: string }).name === 'License',
      ) as [unknown, { where: Record<string, unknown> }];
      expect(asksForNull(options.where.facilityId)).toBe(true);
    });

    it('is not suppressed by a site licence', async () => {
      // Onboarding grace is granted to the business. A licence about one plant
      // is not evidence that the business already holds one.
      const { instance } = service([siteLicence]);

      await expect(instance.issueProvisional(ACME, 90)).resolves.not.toBeNull();
    });

    it('is still suppressed by a licence the business already holds', async () => {
      const { instance } = service([nationalLicence]);

      await expect(instance.issueProvisional(ACME, 90)).resolves.toBeNull();
    });
  });
});
