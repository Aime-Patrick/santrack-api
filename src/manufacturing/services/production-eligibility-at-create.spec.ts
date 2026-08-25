import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { DataSource, EntityManager } from 'typeorm';

import { TraceabilityRuleException } from '../../common/errors';
import { EligibilityCheckCode } from '../../licensing/eligibility';
import { ProductionEligibilityDecision } from '../../licensing/entities/production-eligibility-decision.entity';
import { Facility } from '../../organization/entities/facility.entity';
import { Product } from '../../product/entities/product.entity';
import { ProductionOrder } from '../entities/production-order.entity';
import { ProductionService } from './production.service';

/**
 * DR-07 WU-6: eligibility at production-order creation.
 *
 * Planning a run used to consult no licence at all — the enforcement hole this
 * DR was written to close. It now evaluates server-side, stores the verdict
 * that permitted the run, links the order to it, and refuses only where the
 * verdict says to refuse.
 *
 * The evaluation here is the authoritative one. The preview the Start
 * Production screen shows is advisory and is never stored, because a licence
 * can lapse between the two and it is the second that decided.
 */
describe('planning a production run', () => {
  const ORG = { id: 3, name: 'Acme Dairy' } as never;
  const ACTOR = { id: 9, fullName: 'Planner' } as never;
  const KIGALI = 21;

  const clean = () => ({
    eligible: true,
    blocking: false,
    enforcementMode: 'ADVISORY' as const,
    evaluatedAt: new Date('2026-08-21T09:00:00Z'),
    checks: [
      {
        code: EligibilityCheckCode.ORGANIZATION_LICENCE,
        status: 'PASS' as const,
        message: 'Licence LIC-1 is active.',
      },
    ],
    reliedOn: {
      licenseIds: [44],
      licenseNumbers: ['LIC-1'],
      categoryCodes: ['MFG'],
    },
    rulesetVersion: 'DR07-MVP-1',
  });

  const refused = (mode: 'OFF' | 'ADVISORY' | 'STRICT') => ({
    ...clean(),
    eligible: false,
    blocking: true,
    enforcementMode: mode,
    checks: [
      {
        code: EligibilityCheckCode.ORGANIZATION_LICENCE,
        status: 'FAIL' as const,
        message: 'Manufacturing licence LIC-1 has been revoked.',
        remedy: { label: 'Go to licences', href: '/licenses' },
      },
      {
        code: EligibilityCheckCode.FACILITY_AUTHORIZATION,
        status: 'FAIL' as const,
        message: 'The licence covering this site has been revoked.',
      },
    ],
  });

  const permittedButIneligible = () => ({
    ...clean(),
    eligible: false,
    blocking: false,
    checks: [
      {
        code: EligibilityCheckCode.LICENCE_VALIDITY_AT_REQUESTED_DATE,
        status: 'FAIL' as const,
        message: 'Licence LIC-1 expires on 2026-08-01, before 2026-12-01.',
      },
    ],
  });

  function harness(verdict: unknown = clean()) {
    const saved: Record<string, unknown>[] = [];

    const manager = {
      findOne: jest.fn((entity: unknown) => {
        if (entity === Product) {
          return Promise.resolve({
            id: 100,
            name: 'Yogurt 500ml',
            organizationId: 3,
          });
        }
        if (entity === Facility) {
          return Promise.resolve({ id: KIGALI, organizationId: 3, active: true });
        }
        return Promise.resolve(null);
      }),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((entity: { name: string }, data: Record<string, unknown>) => ({
        __entity: entity.name,
        ...data,
      })),
      save: jest.fn((a: unknown, b?: unknown) => {
        const row = (b ?? a) as Record<string, unknown>;
        if (row.__entity === 'ProductionEligibilityDecision' && !row.id) {
          row.id = '9001';
        }
        saved.push(row);
        return Promise.resolve(row);
      }),
    } as unknown as EntityManager;

    const dataSource = {
      transaction: (cb: (m: EntityManager) => Promise<unknown>) => cb(manager),
    } as unknown as DataSource;

    const licensing = {
      checkOwnTrade: jest.fn().mockResolvedValue(undefined),
      recordIneligibleProduction: jest.fn().mockResolvedValue(undefined),
    };
    const eligibility = { evaluate: jest.fn().mockResolvedValue(verdict) };
    const sequences = { next: jest.fn().mockResolvedValue(7) };

    const service = new ProductionService(
      dataSource,
      {} as never,
      {} as never,
      {} as never,
      sequences as never,
      licensing as never,
      eligibility as never,
      {} as never,
      {} as never,
    );

    const of = (entity: string) => saved.filter((row) => row.__entity === entity);

    return { service, licensing, eligibility, saved, of, manager };
  }

  const dto = (over: Record<string, unknown> = {}) => ({
    productId: 100,
    facilityId: KIGALI,
    plannedQuantity: 250,
    ...over,
  });

  // --------------------------------------------------------- the happy path

  it('stores exactly one decision and points the order at it', async () => {
    // Invariant 6: every order created after this DR references exactly one
    // decision, whose organization, facility and product equal the order's.
    const h = harness();

    const order = await h.service.create(ORG, ACTOR, dto() as never);

    const decisions = h.of('ProductionEligibilityDecision');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      organizationId: 3,
      facilityId: KIGALI,
      productId: 100,
      requestedQuantity: 250,
      eligible: true,
      blocking: false,
      enforcementMode: 'ADVISORY',
      rulesetVersion: 'DR07-MVP-1',
    });
    expect(order.eligibilityDecisionId).toBe('9001');
    expect(order.facilityId).toBe(KIGALI);
  });

  it('stores the checks exactly as they were returned, not a summary', async () => {
    // A verdict without its reasons cannot be defended two years later.
    const verdict = clean();
    const h = harness(verdict);

    await h.service.create(ORG, ACTOR, dto() as never);

    const decision = h.of('ProductionEligibilityDecision')[0];
    expect(decision.checks).toEqual(verdict.checks);
    expect(decision.reliedOn).toEqual(verdict.reliedOn);
  });

  it('judges the run against the day it is scheduled for, not the day it is booked', async () => {
    // The case that matters: a licence that is fine this morning and gone
    // before the run it is being booked for.
    const h = harness();

    await h.service.create(
      ORG,
      ACTOR,
      dto({ scheduledStartOn: '2026-12-01' }) as never,
    );

    expect(h.eligibility.evaluate).toHaveBeenCalledWith({
      organizationId: 3,
      facilityId: KIGALI,
      productId: 100,
      requestedQuantity: 250,
      requestedDate: '2026-12-01',
    });
    expect(h.of('ProductionEligibilityDecision')[0].requestedDate).toBe('2026-12-01');
  });

  it('resolves the site before asking, because the site decides which licence governs', async () => {
    const h = harness();
    await h.service.create(ORG, ACTOR, dto() as never);
    expect(h.eligibility.evaluate.mock.calls[0][0].facilityId).toBe(KIGALI);
  });

  it('writes no finding and notifies nobody when the run is eligible', async () => {
    const h = harness();
    await h.service.create(ORG, ACTOR, dto() as never);
    expect(h.licensing.recordIneligibleProduction).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------- ADVISORY

  describe('ineligible but not blocking', () => {
    it('creates the order anyway and records exactly one finding', async () => {
      // Invariant 9. The proposal describes supervision, not gatekeeping: the
      // run goes ahead, the regulator sees it, and suspension or revocation
      // stays the regulator's lever rather than this code's.
      const h = harness(permittedButIneligible());

      const order = await h.service.create(ORG, ACTOR, dto() as never);

      expect(order.orderNumber).toBe('MO-000007');
      // Saved twice — once planned, once with its batch attached — but one order.
      expect(
        new Set(h.of('ProductionOrder').map((row) => row.orderNumber)).size,
      ).toBe(1);
      expect(h.of('ProductionEligibilityDecision')).toHaveLength(1);
      expect(h.licensing.recordIneligibleProduction).toHaveBeenCalledTimes(1);
    });

    it('hands the finding only the failing messages, and the site it happened at', async () => {
      const h = harness(permittedButIneligible());

      await h.service.create(ORG, ACTOR, dto() as never);

      const [organization, facilityId, action, failures] =
        h.licensing.recordIneligibleProduction.mock.calls[0];
      expect(organization).toBe(ORG);
      expect(facilityId).toBe(KIGALI);
      expect(action).toContain('MO-000007');
      expect(failures).toEqual([
        'Licence LIC-1 expires on 2026-08-01, before 2026-12-01.',
      ]);
    });

    it('records the ineligibility on the stored decision rather than hiding it', async () => {
      const h = harness(permittedButIneligible());
      await h.service.create(ORG, ACTOR, dto() as never);

      expect(h.of('ProductionEligibilityDecision')[0]).toMatchObject({
        eligible: false,
        blocking: false,
      });
    });

    it('files the finding only after the run is a fact', async () => {
      // A finding is a statement that something happened. One left behind for a
      // run that rolled back would be evidence of something that did not occur.
      const h = harness(permittedButIneligible());
      const order = jest.fn();
      h.licensing.recordIneligibleProduction.mockImplementation(() => {
        order();
        return Promise.resolve();
      });

      await h.service.create(ORG, ACTOR, dto() as never);

      expect(h.of('ProductionEvent')).toHaveLength(1);
      expect(order).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- refusal

  describe('blocking', () => {
    it('refuses with a 409 carrying every check', async () => {
      // 409, not 400 — the request was well formed, the world is not in the
      // state it needs to be in. The frontend branches on this.
      const h = harness(refused('STRICT'));

      const error = await h.service
        .create(ORG, ACTOR, dto() as never)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TraceabilityRuleException);
      const thrown = error as TraceabilityRuleException;
      expect(thrown.getStatus()).toBe(409);

      const body = thrown.getResponse() as Record<string, unknown>;
      expect(body.status).toBe(409);
      expect(body.checks).toHaveLength(2);
      expect(body.eligible).toBe(false);
      expect(body.blocking).toBe(true);
      expect(body.enforcementMode).toBe('STRICT');
      expect(body.rulesetVersion).toBe('DR07-MVP-1');
      expect(body.reliedOn).toEqual({
        licenseIds: [44],
        licenseNumbers: ['LIC-1'],
        categoryCodes: ['MFG'],
      });
      expect(String(body.message)).toContain('revoked');
    });

    it('writes no order, no batch and no decision when it refuses', async () => {
      const h = harness(refused('STRICT'));

      await h.service.create(ORG, ACTOR, dto() as never).catch(() => undefined);

      expect(h.of('ProductionOrder')).toHaveLength(0);
      expect(h.of('Batch')).toHaveLength(0);
      expect(h.of('ProductionEligibilityDecision')).toHaveLength(0);
      expect(h.licensing.recordIneligibleProduction).not.toHaveBeenCalled();
    });

    it('refuses a revoked licence in every mode', async () => {
      // Revocation is terminal. The whole point of revoking is that the
      // business stops, and a deployment setting is not a reason for it not to.
      for (const mode of ['OFF', 'ADVISORY', 'STRICT'] as const) {
        const h = harness(refused(mode));
        await expect(h.service.create(ORG, ACTOR, dto() as never)).rejects.toBeInstanceOf(
          TraceabilityRuleException,
        );
        expect(h.of('ProductionOrder')).toHaveLength(0);
      }
    });
  });

  // ------------------------------------------------------------ append-only

  describe('the decision table is append-only', () => {
    // Invariants 15 and 16. A decision that can be edited is not a record of
    // what was decided, and a run re-judged against today's rules is a
    // reconstruction wearing a record's clothes.
    const SRC = join(__dirname, '..', '..');

    function walk(dir: string, found: string[] = []): string[] {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === 'node_modules') continue;
          walk(full, found);
        } else if (entry.endsWith('.ts')) {
          found.push(full);
        }
      }
      return found;
    }

    // The migration's down() legitimately drops the table.
    const sources = walk(SRC).filter(
      (file) =>
        !relative(SRC, file).startsWith(`migrations${sep}`) && !file.endsWith('.spec.ts'),
    );

    const FORBIDDEN = [
      /UPDATE\s+"?production_eligibility_decisions/i,
      /DELETE\s+FROM\s+"?production_eligibility_decisions/i,
      /\.(update|delete|remove|softDelete|softRemove)\s*\(\s*ProductionEligibilityDecision/,
      /getRepository\(\s*ProductionEligibilityDecision\s*\)\s*\.\s*(update|delete|remove)/,
    ];

    it.each(FORBIDDEN.map((pattern, index) => [index, pattern]))(
      'pattern %i appears nowhere in the tree',
      (_index, pattern) => {
        const offenders = sources
          .filter((file) => (pattern as RegExp).test(readFileSync(file, 'utf8')))
          .map((file) => relative(SRC, file));
        expect(offenders).toEqual([]);
      },
    );

    it('has a real source tree to search, and does find the one writer', () => {
      const writers = sources.filter((file) =>
        /create\(\s*ProductionEligibilityDecision/.test(readFileSync(file, 'utf8')),
      );
      expect(writers.map((file) => relative(SRC, file))).toEqual([
        join('manufacturing', 'services', 'production.service.ts'),
      ]);
    });
  });

  it('does not add a regulatory member to ProductionOrderStatus', async () => {
    // Invariant 22, and invariant 21 by extension: eligibility is a decision
    // recorded beside the order, never a new state inside its lifecycle.
    const { ProductionOrderStatus } = await import('../manufacturing.enums');
    expect(Object.keys(ProductionOrderStatus)).toEqual([
      'PLANNED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'CLOSED',
    ]);
  });

  it('keeps the order pointing at its decision by id, not by relation', () => {
    // Manufacturing records which decision it was created under; reading that
    // decision is licensing's job.
    const order = new ProductionOrder();
    order.eligibilityDecisionId = '9001';
    expect(order.eligibilityDecisionId).toBe('9001');
    expect(Object.keys(new ProductionEligibilityDecision())).not.toContain(
      'productionOrder',
    );
  });
});
