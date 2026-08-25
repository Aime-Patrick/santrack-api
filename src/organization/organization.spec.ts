import { TraceabilityRuleException } from '../common/errors';
import { parseTypes } from './controllers/organization.controller';
import { OrganizationService } from './services/organization.service';
import { OrganizationType, isSelfDeclarable } from './organization-type.enum';

describe('organization type filter', () => {
  it('returns undefined when nothing is asked for, so the list stays whole', () => {
    // The transfer and sale pickers want every trading partner.
    expect(parseTypes(undefined)).toBeUndefined();
    expect(parseTypes('')).toBeUndefined();
  });

  it('reads one type', () => {
    expect(parseTypes('REGULATOR')).toEqual([OrganizationType.REGULATOR]);
  });

  it('reads a comma-separated list, trimmed and case-insensitive', () => {
    expect(parseTypes('manufacturer, warehouse ,SHOP')).toEqual([
      OrganizationType.MANUFACTURER,
      OrganizationType.WAREHOUSE,
      OrganizationType.SHOP,
    ]);
  });

  it('refuses an unknown type instead of silently widening the filter', () => {
    // A typo that falls back to "everything" is how a page about regulators
    // ends up listing every shop on the platform.
    expect(() => parseTypes('REGULATORS')).toThrow(TraceabilityRuleException);
    expect(() => parseTypes('REGULATOR,SHOPP')).toThrow(TraceabilityRuleException);
  });
});

/**
 * Builds the service with every collaborator stubbed. Shared by the standing
 * tests and the onboarding tests below.
 */
function service(organization: Record<string, unknown> | null) {
  const organizations = {
    findOne: jest.fn().mockResolvedValue(organization),
    save: jest.fn((row: unknown) => Promise.resolve(row)),
    create: jest.fn((row: unknown) => row),
    count: jest.fn().mockResolvedValue(0),
    find: jest.fn().mockResolvedValue([]),
  };
  const users = { count: jest.fn().mockResolvedValue(2), save: jest.fn() };
  const products = { count: jest.fn().mockResolvedValue(0) };
  // Every new organization is given a site (DR-02).
  const facilityManager = {
    save: jest.fn((_e: unknown, row: unknown) => Promise.resolve(row)),
    create: jest.fn((_e: unknown, row: unknown) => row),
  };
  const facilities = {
    manager: {
      transaction: jest.fn((work: (m: unknown) => Promise<unknown>) =>
        work(facilityManager),
      ),
    },
  };
  // Onboarding no longer mints its own FAC- code; it calls the same service
  // the facilities endpoint calls, so there is one numbering path.
  const sites = {
    openWithin: jest.fn((_m: unknown, _o: unknown, name: string) =>
      Promise.resolve({ id: 1, name, code: 'FAC-000001' }),
    ),
  };
  const licenses = {
    listFor: jest.fn().mockResolvedValue([]),
    issueProvisional: jest.fn().mockResolvedValue(null),
  };
  const notifications = { create: jest.fn().mockResolvedValue({}) };
  const config = { get: jest.fn().mockReturnValue(90) };

  return {
    instance: new OrganizationService(
      organizations as never,
      users as never,
      products as never,
      facilities as never,
      sites as never,
      licenses as never,
      notifications as never,
      config as never,
    ),
    organizations,
    users,
    facilities,
    sites,
    licenses,
    notifications,
  };
}

describe('regulatory standing', () => {
  it('withdraws standing to a stated business type', async () => {
    const regulator = { id: 4, name: 'RSB', type: OrganizationType.REGULATOR };
    const { instance } = service(regulator);

    await instance.revokeRegulatoryStanding(4, OrganizationType.WAREHOUSE);

    expect(regulator.type).toBe(OrganizationType.WAREHOUSE);
  });

  it('refuses to withdraw standing an organization does not hold', async () => {
    const { instance } = service({
      id: 4,
      name: 'Acme',
      type: OrganizationType.MANUFACTURER,
    });

    await expect(
      instance.revokeRegulatoryStanding(4, OrganizationType.WAREHOUSE),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
  });

  it('refuses to leave the organization as something it cannot be', async () => {
    const { instance } = service({
      id: 4,
      name: 'RSB',
      type: OrganizationType.REGULATOR,
    });

    // REGULATOR would be a no-op and CONSUMER is not a business account at
    // all, so neither is somewhere an organization can land.
    await expect(
      instance.revokeRegulatoryStanding(4, OrganizationType.CONSUMER),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
    expect(isSelfDeclarable(OrganizationType.CONSUMER)).toBe(false);
  });

  it('registers an oversight body without attaching the operator to it', async () => {
    const { instance, organizations } = service(null);

    const created = (await instance.registerRegulator('  Rwanda FDA  ')) as unknown as {
      name: string;
      type: OrganizationType;
    };

    expect(created.name).toBe('Rwanda FDA');
    expect(created.type).toBe(OrganizationType.REGULATOR);
    // Onboarding writes the actor's organization back; registering an
    // authority is not joining it, so nothing touches the user.
    expect(organizations.save).toHaveBeenCalledTimes(1);
  });

  it('refuses a duplicate name', async () => {
    const { instance } = service({ id: 9, name: 'RSB', type: OrganizationType.REGULATOR });

    await expect(instance.registerRegulator('RSB')).rejects.toThrow();
  });
});

/**
 * Onboarding, end to end (DR-02, DR-07 WU-1).
 *
 * The site is the part worth guarding. A business that saved without one is
 * exactly the orphan the facility backfill had to repair once already, and the
 * numbering now runs through FacilityService so onboarding and the facilities
 * endpoint cannot drift apart.
 */
describe('creating an organization', () => {
  const actor = () => ({ id: 5, organization: null }) as never;
  const dto = { name: '  Acme Dairy  ', type: OrganizationType.MANUFACTURER };

  it('gives the new business exactly one site', async () => {
    const { instance, sites } = service(null);

    await instance.create(actor(), dto);

    expect(sites.openWithin).toHaveBeenCalledTimes(1);
  });

  it('names the site after the business', async () => {
    const { instance, sites } = service(null);

    await instance.create(actor(), dto);

    // Trimmed, so the site is not named after whitespace the user typed.
    expect(sites.openWithin.mock.calls[0][2]).toBe('Acme Dairy — main site');
  });

  it('opens the site through the shared numbering path, not its own', async () => {
    // Onboarding used to draw its own FAC- number inline. Two implementations
    // of how a site is created and coded agreed right up until they would not.
    const { instance, sites } = service(null);

    await instance.create(actor(), dto);

    const manager = sites.openWithin.mock.calls[0][0];
    expect(manager).toBeDefined();
  });

  it('opens the site inside a transaction', async () => {
    // The counter takes a pessimistic lock, which Postgres will not grant
    // outside one - and two people onboarding at the same moment must not be
    // handed the same site code.
    const { instance, facilities } = service(null);

    await instance.create(actor(), dto);

    expect(facilities.manager.transaction).toHaveBeenCalledTimes(1);
  });

  it('attaches the caller to the business they created', async () => {
    const { instance, users } = service(null);
    const user = actor();

    await instance.create(user, dto);

    expect(users.save).toHaveBeenCalledTimes(1);
  });

  it('issues the onboarding grace licence', async () => {
    // Without it, everyone onboarded after the licensing migration would be
    // non-compliant from their first action - an accident of timing rather
    // than a rule anyone chose.
    const { instance, licenses } = service(null);

    await instance.create(actor(), dto);

    expect(licenses.issueProvisional).toHaveBeenCalledTimes(1);
    expect(licenses.issueProvisional.mock.calls[0][1]).toBe(90);
  });

  it('sends a welcome notification pointing to compliance', async () => {
    const { instance, notifications } = service(null);

    await instance.create(actor(), dto);

    expect(notifications.create).toHaveBeenCalledTimes(1);
    const call = notifications.create.mock.calls[0][0];
    expect(call.userId).toBe(5);
    expect(call.title).toBe('Welcome to SanTrack');
    expect(call.module).toBe('compliance');
    expect(call.actionUrl).toBe('/compliance');
  });

  it('refuses a second organization for someone who already acts for one', async () => {
    const { instance, sites } = service(null);

    await expect(
      instance.create({ id: 5, organization: { id: 1, name: 'Elsewhere' } } as never, dto),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
    expect(sites.openWithin).not.toHaveBeenCalled();
  });

  it('refuses a type the platform grants rather than one chosen at sign-up', async () => {
    const { instance, sites } = service(null);

    await expect(
      instance.create(actor(), { name: 'Acme', type: OrganizationType.REGULATOR }),
    ).rejects.toBeInstanceOf(TraceabilityRuleException);
    expect(sites.openWithin).not.toHaveBeenCalled();
  });
});
