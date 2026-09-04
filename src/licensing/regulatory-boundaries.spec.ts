import { TraceabilityRuleException } from '../common/errors';
import { RegulatoryCaseService } from './services/regulatory-case.service';
import { RegulatoryOversightService } from './services/regulatory-oversight.service';
import { RegulatoryCaseReferralStatus, RegulatoryCaseStatus } from './entities/regulatory-case.entity';

/**
 * Security invariants for configurable authorities. These tests intentionally
 * exercise the service boundary: hiding a card in the browser is not access
 * control, and every rejected cross-authority action must be rejected here.
 */
describe('regulatory authority boundaries', () => {
  const authorityA = { id: 10, name: 'Authority A', code: 'A', teams: ['Team A'] } as any;
  const authorityB = { id: 11, name: 'Authority B', code: 'B', teams: ['Team B'] } as any;
  const actorA = { id: 20, organization: { id: 100 } } as any;

  function caseService(caseRow: any = null, referralRow: any = null) {
    const cases = { findOne: jest.fn().mockResolvedValue(caseRow), save: jest.fn().mockResolvedValue(caseRow), create: jest.fn((row) => row), manager: {} } as any;
    const referrals = { findOne: jest.fn().mockResolvedValue(referralRow), find: jest.fn().mockResolvedValue([]), save: jest.fn(async (row) => ({ id: 1, ...row })), create: jest.fn((row) => row) } as any;
    const authorities = { findOne: jest.fn().mockResolvedValue(authorityB) } as any;
    const events = { save: jest.fn().mockResolvedValue(undefined), create: jest.fn((row) => row) } as any;
    const service = new RegulatoryCaseService(cases, events, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, authorities, referrals, {} as any, {} as any);
    return { service, cases, referrals, authorities };
  }

  it('filters a case lookup by the operating authority at the database boundary', async () => {
    const { service, cases } = caseService();
    await expect(service.oneForAuthority(77, authorityA)).rejects.toThrow();
    expect(cases.findOne).toHaveBeenCalledWith({ where: { id: 77, leadAuthority: { id: authorityA.id } } });
  });

  it('refuses to assign a team that the owning authority did not configure', async () => {
    const caseRow = { id: 77, leadAuthority: authorityA, assignedTeam: null };
    const { service } = caseService(caseRow);
    await expect(service.assignTeam(77, actorA, authorityA, 'Team B')).rejects.toBeInstanceOf(TraceabilityRuleException);
  });

  it('refuses a referral back to the same authority', async () => {
    const caseRow = { id: 77, leadAuthority: authorityA };
    const { service, authorities } = caseService(caseRow);
    authorities.findOne.mockResolvedValue(authorityA);
    await expect(service.refer(77, actorA, authorityA, { toAuthorityId: authorityA.id, reason: 'Wrong mandate' })).rejects.toBeInstanceOf(TraceabilityRuleException);
  });

  it('moves ownership only when the receiving authority accepts and clears old internal assignment', async () => {
    const caseRow = { id: 77, status: RegulatoryCaseStatus.OPEN, leadAuthority: authorityA, assignedTo: { id: 3 }, assignedTeam: 'Team A' };
    const referral = { id: 4, case: caseRow, fromAuthority: authorityA, toAuthority: authorityB, status: RegulatoryCaseReferralStatus.PENDING };
    const { service, cases } = caseService(caseRow, referral);
    await service.decideReferral(4, actorA, authorityB, true, 'Accepted');
    expect(caseRow.leadAuthority).toBe(authorityB);
    expect(caseRow.assignedTo).toBeNull();
    expect(caseRow.assignedTeam).toBeNull();
    expect(cases.save).toHaveBeenCalledWith(caseRow);
  });
});

describe('regulatory oversight boundaries', () => {
  it('returns aggregate metrics only, never cases, evidence, or officers', async () => {
    const scope = { authority: { id: 10, code: 'A', name: 'Authority A', referralResponseDays: null } };
    const scopes = { find: jest.fn().mockResolvedValue([scope]) } as any;
    const count = jest.fn().mockResolvedValue(2);
    const cases = { count } as any;
    const referrals = { count: jest.fn().mockResolvedValue(1), find: jest.fn().mockResolvedValue([]) } as any;
    const service = new RegulatoryOversightService(scopes, {} as any, {} as any, cases, referrals);
    const summary = await service.summary({ id: 99 } as any);
    expect(summary.authorities[0]).toEqual(expect.objectContaining({ authority: { id: 10, code: 'A', name: 'Authority A' }, open: 2 }));
    expect(JSON.stringify(summary)).not.toContain('evidence');
    expect(JSON.stringify(summary)).not.toContain('assignedTo');
  });
});
