import { License, LicenseCategory } from './entities/license.entity';
import { EligibilityCheckCode, RULESET_VERSION } from './eligibility';
import { Assessment } from './governing-licence';
import {
  EnforcementMode,
  LicensedActivity,
  LicenseStatus,
  LicenseVerdict,
} from './licensing.enums';
import { ProductionEligibilityService } from './services/production-eligibility.service';
import { BatchStatus } from '../batch/batch-status.enum';
import { TraceabilityLevel } from '../product/traceability-level.enum';

/**
 * DR-07 WU-4: whether a business may make something, and what it is told when
 * it may not.
 *
 * The rule this file exists to hold: `evaluate()` answers, it never acts. The
 * preview endpoint calls it on every field change of the Start Production form,
 * so a verdict that wrote a row would file a compliance finding and notify the
 * licence holder once per keystroke. Every repository the service is given here
 * throws on every write method, so a write anywhere in the tree fails a test
 * rather than being noticed in production.
 */
describe('production eligibility', () => {
  const ORG = 1;
  const KIGALI = 10;
  const HUYE = 11;
  const TODAY = new Date().toISOString().slice(0, 10);

  let counter = 0;

  function category(over: Partial<LicenseCategory> = {}): LicenseCategory {
    return Object.assign(new LicenseCategory(), {
      id: 1,
      code: 'MFG',
      name: 'Manufacturing',
      activity: LicensedActivity.MANUFACTURING,
      permittedProductCategories: [],
      ...over,
    });
  }

  function licence(over: Partial<License> = {}): License {
    return Object.assign(new License(), {
      id: ++counter,
      licenseNumber: `LIC-${counter}`,
      organization: { id: ORG, name: 'Acme Dairy' },
      category: category(),
      status: LicenseStatus.ACTIVE,
      facilityId: null,
      facility: null,
      issuedOn: '2020-01-01',
      expiresOn: '2099-01-01',
      provisional: false,
      statusReason: null,
    }, over) as License;
  }

  function product(over: Record<string, unknown> = {}) {
    return {
      id: 100,
      organizationId: ORG,
      name: 'Yogurt 500ml',
      sku: 'YOG-500',
      categoryId: null,
      productCategory: null,
      traceabilityLevel: TraceabilityLevel.BATCH,
      ...over,
    };
  }

  /**
   * Repositories that refuse to write. `find`, `findOne` and `count` answer;
   * everything that could put a row anywhere throws, which is how invariant 11
   * is held at the unit level rather than by comment.
   */
  function readOnlyRepo(rows: unknown[], one: unknown = null) {
    const refuse = (name: string) =>
      jest.fn(() => {
        throw new Error(`eligibility must not call ${name}()`);
      });

    return {
      find: jest.fn().mockResolvedValue(rows),
      findOne: jest.fn().mockResolvedValue(one),
      count: jest.fn().mockResolvedValue(rows.length),
      save: refuse('save'),
      insert: refuse('insert'),
      update: refuse('update'),
      delete: refuse('delete'),
      remove: refuse('remove'),
      create: refuse('create'),
      upsert: refuse('upsert'),
      softDelete: refuse('softDelete'),
    };
  }

  function harness(options: {
    organization?: Assessment;
    site?: Assessment;
    product?: unknown;
    batches?: unknown[];
    mode?: EnforcementMode;
  }) {
    const licensed = (): Assessment => ({
      verdict: LicenseVerdict.LICENSED,
      license: licence(),
    });

    const organization = options.organization ?? licensed();
    const site = options.site ?? organization;

    const assess = jest.fn(
      (_org: number, _activity: LicensedActivity, facilityId: number | null) =>
        Promise.resolve(facilityId === null ? organization : site),
    );

    const enforcement = {
      assess,
      enforcementMode: () => options.mode ?? EnforcementMode.ADVISORY,
      // Present so that calling it is a failure rather than a mock miss.
      check: jest.fn(() => {
        throw new Error('eligibility must never route through check()');
      }),
      checkOwnTrade: jest.fn(() => {
        throw new Error('eligibility must never route through checkOwnTrade()');
      }),
    };

    const products = readOnlyRepo(
      [],
      'product' in options ? options.product : product(),
    );
    const batches = readOnlyRepo(options.batches ?? []);

    const service = new ProductionEligibilityService(
      enforcement as never,
      products as never,
      batches as never,
    );

    return { service, enforcement, products, batches, assess };
  }

  const ask = (over: Record<string, unknown> = {}) => ({
    organizationId: ORG,
    facilityId: KIGALI,
    productId: 100,
    requestedQuantity: 500,
    requestedDate: TODAY,
    ...over,
  });

  const statusOf = (result: { checks: { code: EligibilityCheckCode; status: string }[] },
    code: EligibilityCheckCode) =>
    result.checks.find((check) => check.code === code)?.status;

  // ------------------------------------------------------------------ shape

  describe('the check list', () => {
    it('returns all eight checks, in order, when the first one fails', async () => {
      // Invariant 7. A manufacturer who is stopped needs to see everything that
      // is wrong with the run, not the first thing that was noticed.
      const h = harness({
        organization: { verdict: LicenseVerdict.NONE, license: null },
        site: { verdict: LicenseVerdict.NONE, license: null },
      });

      const result = await h.service.evaluate(ask());

      expect(statusOf(result, EligibilityCheckCode.ORGANIZATION_LICENCE)).toBe('FAIL');
      expect(result.checks).toHaveLength(8);
      expect(result.checks.map((check) => check.code)).toEqual([
        EligibilityCheckCode.ORGANIZATION_LICENCE,
        EligibilityCheckCode.FACILITY_AUTHORIZATION,
        EligibilityCheckCode.PRODUCT_CATEGORY_COVERAGE,
        EligibilityCheckCode.PRODUCT_AUTHORIZATION,
        EligibilityCheckCode.LICENCE_VALIDITY_AT_REQUESTED_DATE,
        EligibilityCheckCode.PRODUCT_TRACEABILITY,
        EligibilityCheckCode.BATCH_AND_RECALL_RESTRICTIONS,
        EligibilityCheckCode.PER_PRODUCTION_APPROVAL,
      ]);
    });

    it('ships the two post-MVP checks inert rather than absent', async () => {
      // They are in the list so the response shape does not change on the day
      // product authorization and per-production approval go live.
      const result = await harness({}).service.evaluate(ask());

      expect(statusOf(result, EligibilityCheckCode.PRODUCT_AUTHORIZATION)).toBe(
        'NOT_APPLICABLE',
      );
      expect(statusOf(result, EligibilityCheckCode.PER_PRODUCTION_APPROVAL)).toBe(
        'NOT_APPLICABLE',
      );
    });

    it('gives every check a message and stamps the ruleset version', async () => {
      const result = await harness({}).service.evaluate(ask());

      for (const check of result.checks) {
        expect(check.message.length).toBeGreaterThan(0);
      }
      expect(result.rulesetVersion).toBe(RULESET_VERSION);
      expect(result.rulesetVersion).toBe('DR07-MVP-1');
    });

    it('names the licences, numbers and category codes it relied on', async () => {
      // Ids alone stop being an audit record the moment a LicenseCategory is
      // deactivated: a decision that cannot name what it relied on has recorded
      // nothing.
      const national = licence({ licenseNumber: 'LIC-NAT' });
      const site = licence({
        licenseNumber: 'LIC-KGL',
        facilityId: KIGALI,
        category: category({ code: 'MFG-SITE' }),
      });

      const result = await harness({
        organization: { verdict: LicenseVerdict.LICENSED, license: national },
        site: { verdict: LicenseVerdict.LICENSED, license: site },
      }).service.evaluate(ask());

      expect(result.reliedOn.licenseIds).toEqual([national.id, site.id]);
      expect(result.reliedOn.licenseNumbers).toEqual(['LIC-NAT', 'LIC-KGL']);
      expect(result.reliedOn.categoryCodes).toEqual(['MFG', 'MFG-SITE']);
    });
  });

  // --------------------------------------------------------------- T1 guard

  describe('it answers without acting', () => {
    it('writes nothing, on the happy path or any failing one', async () => {
      // Invariant 11, held here at the unit level: every write method on every
      // repository throws. The row-count proof over the HTTP endpoint is WU-5.
      const cases = [
        {},
        { organization: { verdict: LicenseVerdict.NONE, license: null } },
        { site: { verdict: LicenseVerdict.REVOKED, license: licence({ status: LicenseStatus.REVOKED }) } },
        { product: null },
        { batches: [{ id: 1, batchCode: 'MO-000001', status: BatchStatus.RECALLED }] },
        { mode: EnforcementMode.STRICT },
        { mode: EnforcementMode.OFF },
      ];

      for (const options of cases) {
        const h = harness(options as never);
        await expect(h.service.evaluate(ask())).resolves.toBeDefined();
        expect(h.products.save).not.toHaveBeenCalled();
        expect(h.batches.save).not.toHaveBeenCalled();
      }
    });

    it('never routes through check(), in any mode', async () => {
      // Trap T1. check() fabricates a LICENSED verdict under OFF, throws on
      // REVOKED and under STRICT, and writes a finding and a notification
      // before it refuses.
      for (const mode of [
        EnforcementMode.OFF,
        EnforcementMode.ADVISORY,
        EnforcementMode.STRICT,
      ]) {
        const h = harness({ mode });
        await h.service.evaluate(ask());
        expect(h.enforcement.check).not.toHaveBeenCalled();
        expect(h.enforcement.checkOwnTrade).not.toHaveBeenCalled();
        expect(h.enforcement.assess).toHaveBeenCalled();
      }
    });

    it('asks the organization question without a facility and the site question with one', async () => {
      const h = harness({});
      await h.service.evaluate(ask({ facilityId: HUYE }));

      expect(h.assess.mock.calls.map((call) => call[2])).toEqual([null, HUYE]);
      expect(h.assess.mock.calls.map((call) => call[1])).toEqual([
        LicensedActivity.MANUFACTURING,
        LicensedActivity.MANUFACTURING,
      ]);
    });

    it('computes a truthful verdict under OFF rather than a fabricated one', async () => {
      // The reason check() cannot be the input: under OFF it returns LICENSED
      // without assessing anything, which would make `eligible` a lie in one of
      // the three modes.
      const result = await harness({
        mode: EnforcementMode.OFF,
        organization: { verdict: LicenseVerdict.NONE, license: null },
        site: { verdict: LicenseVerdict.NONE, license: null },
      }).service.evaluate(ask());

      expect(result.eligible).toBe(false);
      expect(result.enforcementMode).toBe('OFF');
    });
  });

  // ------------------------------------------------------- blocking / mode

  describe('the blocking truth table', () => {
    // Invariant 8: blocking is true if and only if (ineligible and STRICT) or a
    // check failed on a revoked licence.
    const revoked = () => ({
      verdict: LicenseVerdict.REVOKED,
      license: licence({ status: LicenseStatus.REVOKED, statusReason: 'Repeated failure' }),
    });
    const none = () => ({ verdict: LicenseVerdict.NONE, license: null });
    const good = () => ({ verdict: LicenseVerdict.LICENSED, license: licence() });

    const table: {
      mode: EnforcementMode;
      state: 'eligible' | 'ineligible' | 'revoked';
      eligible: boolean;
      blocking: boolean;
    }[] = [
      { mode: EnforcementMode.OFF, state: 'eligible', eligible: true, blocking: false },
      { mode: EnforcementMode.OFF, state: 'ineligible', eligible: false, blocking: false },
      { mode: EnforcementMode.OFF, state: 'revoked', eligible: false, blocking: true },
      { mode: EnforcementMode.ADVISORY, state: 'eligible', eligible: true, blocking: false },
      { mode: EnforcementMode.ADVISORY, state: 'ineligible', eligible: false, blocking: false },
      { mode: EnforcementMode.ADVISORY, state: 'revoked', eligible: false, blocking: true },
      { mode: EnforcementMode.STRICT, state: 'eligible', eligible: true, blocking: false },
      { mode: EnforcementMode.STRICT, state: 'ineligible', eligible: false, blocking: true },
      { mode: EnforcementMode.STRICT, state: 'revoked', eligible: false, blocking: true },
    ];

    it.each(table)(
      '$mode + $state -> eligible $eligible, blocking $blocking',
      async ({ mode, state, eligible, blocking }) => {
        const assessment =
          state === 'revoked' ? revoked() : state === 'ineligible' ? none() : good();

        const result = await harness({
          mode,
          organization: assessment,
          site: assessment,
        }).service.evaluate(ask());

        expect(result.eligible).toBe(eligible);
        expect(result.blocking).toBe(blocking);
      },
    );

    it('treats revocation as terminal even where nothing else would block', async () => {
      // The carve-out check() has always had, applied in every mode. Revoking a
      // licence exists to make a business stop; a deployment setting is not a
      // reason for it not to.
      for (const mode of [
        EnforcementMode.OFF,
        EnforcementMode.ADVISORY,
        EnforcementMode.STRICT,
      ]) {
        const result = await harness({
          mode,
          organization: revoked(),
          site: revoked(),
        }).service.evaluate(ask());
        expect(result.blocking).toBe(true);
      }
    });

    it('does not let a warning defeat eligibility', async () => {
      const result = await harness({
        organization: {
          verdict: LicenseVerdict.LICENSED,
          license: licence({ provisional: true }),
        },
      }).service.evaluate(ask());

      expect(statusOf(result, EligibilityCheckCode.ORGANIZATION_LICENCE)).toBe('WARN');
      expect(result.eligible).toBe(true);
      expect(result.blocking).toBe(false);
    });

    it('reports the mode in the upper case the contract froze', async () => {
      for (const [mode, reported] of [
        [EnforcementMode.OFF, 'OFF'],
        [EnforcementMode.ADVISORY, 'ADVISORY'],
        [EnforcementMode.STRICT, 'STRICT'],
      ] as const) {
        const result = await harness({ mode }).service.evaluate(ask());
        expect(result.enforcementMode).toBe(reported);
      }
    });
  });

  // -------------------------------------------------------- individual checks

  describe('ORGANIZATION_LICENCE', () => {
    it('warns, never fails, on a provisional licence inside its dates', async () => {
      // D2 and invariant 13. 180 of 182 licences on the platform are grace
      // records; failing them would stop almost everything that produces today.
      const result = await harness({
        organization: {
          verdict: LicenseVerdict.LICENSED,
          license: licence({ provisional: true, expiresOn: '2099-12-12' }),
        },
      }).service.evaluate(ask());

      const check = result.checks.find(
        (entry) => entry.code === EligibilityCheckCode.ORGANIZATION_LICENCE,
      );
      expect(check?.status).toBe('WARN');
      expect(check?.message).toContain('provisional');
      expect(check?.message).toContain('2099-12-12');
      expect(check?.remedy?.href).toBe('/licenses');
    });

    it('fails a provisional licence that has lapsed, because it is lapsed', async () => {
      // Invariant 13 protects a provisional licence *while it is within its
      // dates*. A grace period that never ends would be an exemption.
      const result = await harness({
        organization: {
          verdict: LicenseVerdict.EXPIRED,
          license: licence({ provisional: true, expiresOn: '2020-01-01' }),
        },
      }).service.evaluate(ask());

      expect(statusOf(result, EligibilityCheckCode.ORGANIZATION_LICENCE)).toBe('FAIL');
    });

    it('fails, with the regulator reason, on suspension', async () => {
      const result = await harness({
        organization: {
          verdict: LicenseVerdict.SUSPENDED,
          license: licence({
            status: LicenseStatus.SUSPENDED,
            statusReason: 'Pending inspection',
          }),
        },
      }).service.evaluate(ask());

      const check = result.checks[0];
      expect(check.status).toBe('FAIL');
      expect(check.message).toContain('Pending inspection');
    });
  });

  describe('FACILITY_AUTHORIZATION', () => {
    it('passes on the site licence where one exists (D1)', async () => {
      const result = await harness({
        site: {
          verdict: LicenseVerdict.LICENSED,
          license: licence({
            facilityId: KIGALI,
            facility: { id: KIGALI, name: 'Kigali plant', organizationId: ORG } as never,
          }),
        },
      }).service.evaluate(ask());

      const check = result.checks[1];
      expect(check.status).toBe('PASS');
      expect(check.message).toContain('Kigali plant');
    });

    it("fails the suspended site while saying its siblings are unaffected", async () => {
      const result = await harness({
        site: {
          verdict: LicenseVerdict.SUSPENDED,
          license: licence({
            status: LicenseStatus.SUSPENDED,
            facilityId: HUYE,
            facility: { id: HUYE, name: 'Huye plant', organizationId: ORG } as never,
            statusReason: 'Contamination found',
          }),
        },
      }).service.evaluate(ask({ facilityId: HUYE }));

      const check = result.checks[1];
      expect(check.status).toBe('FAIL');
      expect(check.message).toContain('Huye plant');
      expect(check.message).toContain('Contamination found');
      expect(result.eligible).toBe(false);
    });

    it('does not repeat the provisional warning on the facility check', async () => {
      // D2 assigns the warning to ORGANIZATION_LICENCE. Saying it twice about
      // one licence would double a warning that already appears on nearly every
      // run on the platform.
      const provisional = {
        verdict: LicenseVerdict.LICENSED,
        license: licence({ provisional: true }),
      };
      const result = await harness({
        organization: provisional,
        site: provisional,
      }).service.evaluate(ask());

      expect(statusOf(result, EligibilityCheckCode.ORGANIZATION_LICENCE)).toBe('WARN');
      expect(statusOf(result, EligibilityCheckCode.FACILITY_AUTHORIZATION)).toBe('PASS');
    });
  });

  describe('PRODUCT_CATEGORY_COVERAGE', () => {
    it('passes when the licence restricts no categories at all', async () => {
      // OQ 5. Empty means unrestricted, as it already does for warehousing and
      // distribution, and every LicenseCategory row on the platform is empty.
      const result = await harness({
        organization: {
          verdict: LicenseVerdict.LICENSED,
          license: licence({ category: category({ permittedProductCategories: [] }) }),
        },
      }).service.evaluate(ask());

      const check = result.checks[2];
      expect(check.status).toBe('PASS');
      expect(check.message).toContain('not restricted');
    });

    it('warns, never fails, when the product carries no category', async () => {
      // OQ 12. An unclassified product is a catalogue gap, not a regulatory
      // breach - 92 of 111 products have no category recorded.
      const result = await harness({
        organization: {
          verdict: LicenseVerdict.LICENSED,
          license: licence({
            category: category({ permittedProductCategories: ['DAIRY'] }),
          }),
        },
        product: product({ categoryId: null, productCategory: null }),
      }).service.evaluate(ask());

      const check = result.checks[2];
      expect(check.status).toBe('WARN');
      expect(result.eligible).toBe(true);
      expect(check.remedy?.href).toBe('/products/100');
    });

    it('passes a product whose category the licence covers', async () => {
      const result = await harness({
        organization: {
          verdict: LicenseVerdict.LICENSED,
          license: licence({
            category: category({ permittedProductCategories: ['DAIRY', 'BEVERAGE'] }),
          }),
        },
        product: product({
          categoryId: 4,
          productCategory: { id: 4, code: 'DAIRY', name: 'Dairy' },
        }),
      }).service.evaluate(ask());

      expect(result.checks[2].status).toBe('PASS');
    });

    it('fails a product outside a licence that does restrict categories', async () => {
      const result = await harness({
        organization: {
          verdict: LicenseVerdict.LICENSED,
          license: licence({
            category: category({ permittedProductCategories: ['DAIRY'] }),
          }),
        },
        product: product({
          categoryId: 9,
          productCategory: { id: 9, code: 'PHARMA', name: 'Pharmaceuticals' },
        }),
      }).service.evaluate(ask());

      const check = result.checks[2];
      expect(check.status).toBe('FAIL');
      expect(check.message).toContain('Pharmaceuticals');
      expect(result.eligible).toBe(false);
    });
  });

  describe('LICENCE_VALIDITY_AT_REQUESTED_DATE', () => {
    it('fails a licence that is valid today but expires before the requested date', async () => {
      // Against requestedDate, not today. This is the case a manufacturer most
      // needs warning about: a licence that is fine this morning and gone by
      // the run they are scheduling.
      const result = await harness({
        organization: {
          verdict: LicenseVerdict.LICENSED,
          license: licence({ issuedOn: '2020-01-01', expiresOn: '2026-12-31' }),
        },
      }).service.evaluate(ask({ requestedDate: '2027-03-01' }));

      const check = result.checks[4];
      expect(check.status).toBe('FAIL');
      expect(check.message).toContain('2026-12-31');
      expect(check.message).toContain('2027-03-01');
      expect(result.eligible).toBe(false);
      // Today's verdict is untouched - the licence really is in force today.
      expect(result.checks[0].status).toBe('PASS');
    });

    it('fails a run backdated before the licence was issued', async () => {
      // OQ 11: a run recorded for a date the licence did not cover is
      // ineligible, and under ADVISORY is permitted with a finding.
      const result = await harness({
        organization: {
          verdict: LicenseVerdict.LICENSED,
          license: licence({ issuedOn: '2026-06-01', expiresOn: '2099-01-01' }),
        },
      }).service.evaluate(ask({ requestedDate: '2026-01-15' }));

      const check = result.checks[4];
      expect(check.status).toBe('FAIL');
      expect(check.message).toContain('2026-06-01');
    });

    it('passes inside the dates', async () => {
      const result = await harness({}).service.evaluate(
        ask({ requestedDate: '2026-08-21' }),
      );
      expect(result.checks[4].status).toBe('PASS');
    });
  });

  describe('PRODUCT_TRACEABILITY', () => {
    it('passes for a product in the catalogue', async () => {
      const result = await harness({}).service.evaluate(ask());
      const check = result.checks[5];
      expect(check.status).toBe('PASS');
      expect(check.message).toContain('BATCH');
    });

    it('fails when the product is not in this business catalogue', async () => {
      const result = await harness({ product: null }).service.evaluate(ask());

      expect(result.checks[5].status).toBe('FAIL');
      expect(result.eligible).toBe(false);
      // Still all eight, still in order.
      expect(result.checks).toHaveLength(8);
    });
  });

  describe('BATCH_AND_RECALL_RESTRICTIONS', () => {
    it('fails while a lot of this product is under recall', async () => {
      const result = await harness({
        batches: [{ id: 5, batchCode: 'MO-000005', status: BatchStatus.RECALLED }],
      }).service.evaluate(ask());

      const check = result.checks[6];
      expect(check.status).toBe('FAIL');
      expect(check.message).toContain('MO-000005');
      expect(result.eligible).toBe(false);
    });

    it('fails while a lot is quarantined pending a quality decision', async () => {
      const result = await harness({
        batches: [{ id: 6, batchCode: 'MO-000006', status: BatchStatus.QUARANTINED }],
      }).service.evaluate(ask());

      expect(result.checks[6].status).toBe('FAIL');
      expect(result.checks[6].message).toContain('quarantined');
    });

    it('passes when nothing is held', async () => {
      const result = await harness({ batches: [] }).service.evaluate(ask());
      expect(result.checks[6].status).toBe('PASS');
    });
  });
});
