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
  const documents = {
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn((row: unknown) => Promise.resolve(row)),
    create: jest.fn((row: unknown) => row),
    findOne: jest.fn().mockResolvedValue(null),
  };
  const owners = {
    save: jest.fn((rows: unknown) => Promise.resolve(rows)),
    create: jest.fn((row: unknown) => row),
  };
  const storage = {
    put: jest.fn((input: unknown) =>
      Promise.resolve({ key: 'org-docs/1', size: 100, contentType: 'image/png' }),
    ),
    get: jest.fn().mockResolvedValue(Buffer.from('bytes')),
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
    issueOnApproval: jest.fn().mockResolvedValue(null),
  };
  const notifications = { sendToUser: jest.fn().mockResolvedValue({}) };
  const email = {
    sendRegistrationSubmitted: jest.fn().mockResolvedValue(undefined),
    sendRegistrationApproved: jest.fn().mockResolvedValue(undefined),
    sendRegistrationRejected: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'appPublicUrl') return 'http://localhost:3000';
      return undefined;
    }),
  };

  const regulatoryAuthorities = {
    find: jest.fn().mockResolvedValue([]),
  };

  return {
    instance: new OrganizationService(
      organizations as never,
      users as never,
      products as never,
      facilities as never,
      documents as never,
      owners as never,
      regulatoryAuthorities as never,
      storage as never,
      sites as never,
      licenses as never,
      notifications as never,
      email as never,
      config as never,
    ),
    organizations,
    users,
    facilities,
    documents,
    owners,
    storage,
    sites,
    licenses,
    notifications,
    email,
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

  it('does not issue a licence while the registration is pending approval', async () => {
    // A registration is an application, not a grant: the operating licence
    // only appears when a regulator approves it (Digital Tax Stamp flow).
    const { instance, licenses } = service(null);

    await instance.create(actor(), dto);

    expect(licenses.issueProvisional).not.toHaveBeenCalled();
    expect(licenses.issueOnApproval).not.toHaveBeenCalled();
  });

  it('leaves the new organization pending and tells the applicant', async () => {
    const { instance, notifications, email, organizations } = service(null);

    const created = (await instance.create(actor(), dto)) as unknown as {
      onboardingStatus: string;
    };

    expect(created.onboardingStatus).toBe('PENDING');
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
    const [userId, payload] = notifications.sendToUser.mock.calls[0];
    expect(userId).toBe(5);
    expect(payload.title).toBe('Registration submitted');
    expect(payload.module).toBe('compliance');
    expect(email.sendRegistrationSubmitted).toHaveBeenCalledTimes(1);
    // The org is saved, then the facility transaction runs, then the actor is
    // attached - the email path is fire-and-forget, so no welcome email.
    expect(organizations.save).toHaveBeenCalled();
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
