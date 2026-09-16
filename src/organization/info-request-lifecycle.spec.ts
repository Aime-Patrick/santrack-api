import { OrganizationType } from './organization-type.enum';
import { OnboardingStatus } from './onboarding-status.enum';
import { InfoRequestStatus } from './entities/registration-info-request.entity';
import { OrganizationService } from './services/organization.service';

/**
 * Information-request lifecycle: resend is delivery retry; create supersedes
 * any open PENDING request (revoke-and-reissue).
 */
describe('registration information requests', () => {
  const ORG_ID = 42;
  const REQUEST_ID = 7;

  function organization(over: Record<string, unknown> = {}) {
    return {
      id: ORG_ID,
      name: 'Acme Dairy',
      type: OrganizationType.MANUFACTURER,
      onboardingStatus: OnboardingStatus.PENDING,
      email: 'ops@acme.test',
      ...over,
    };
  }

  function pendingRequest(over: Record<string, unknown> = {}) {
    return {
      id: REQUEST_ID,
      organizationId: ORG_ID,
      token: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      requestMessage: 'Please attach the FDA premise certificate.',
      requestedFields: [],
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: InfoRequestStatus.PENDING,
      createdById: 1,
      ...over,
    };
  }

  function harness(options: {
    organization?: Record<string, unknown> | null;
    openRequests?: unknown[];
    requestById?: unknown | null;
  } = {}) {
    const org =
      'organization' in options
        ? options.organization
        : organization();

    const openRequests = options.openRequests ?? [];
    const requestById =
      'requestById' in options ? options.requestById : pendingRequest();

    const infoRequests = {
      find: jest.fn().mockResolvedValue(openRequests),
      findOne: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where?.id != null) return requestById;
        return null;
      }),
      save: jest.fn(async (row: unknown) => row),
      create: jest.fn((row: unknown) => row),
    };

    const organizations = {
      findOne: jest.fn().mockResolvedValue(org),
      find: jest.fn().mockResolvedValue([]),
    };

    const users = {
      find: jest.fn().mockResolvedValue([
        { id: 99, email: 'ops@acme.test', organization: { id: ORG_ID } },
      ]),
    };

    const notifications = {
      sendToUser: jest.fn().mockResolvedValue(undefined),
    };

    const email = {
      sendRegistrationInfoRequest: jest.fn().mockResolvedValue(undefined),
      sendRegistrationResponseReceived: jest.fn().mockResolvedValue(undefined),
    };

    const service = new OrganizationService(
      organizations as never,
      users as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      infoRequests as never,
      {} as never,
      {} as never,
      {} as never,
      notifications as never,
      email as never,
      {
        get: (key: string) =>
          key === 'appPublicUrl' ? 'https://app.test' : undefined,
      } as never,
    );

    // staffOf uses users.find with organization relation — stub via prototype path
    jest.spyOn(service as never, 'staffOf' as never).mockResolvedValue([
      { id: 99, email: 'ops@acme.test' },
    ] as never);

    return { service, infoRequests, email, notifications, organizations };
  }

  const regulator = {
    id: 1,
    type: OrganizationType.REGULATOR,
    name: 'Rwanda FDA',
  };
  const actor = { id: 2 };

  it('supersedes open PENDING requests before creating a new one', async () => {
    const prior = pendingRequest({ id: 3, token: 'old-token' });
    const h = harness({ openRequests: [prior] });

    const created = await h.service.createInfoRequest(
      regulator as never,
      actor as never,
      ORG_ID,
      { requestMessage: 'Need cold-chain proof.', requestedFields: [] },
    );

    expect(h.infoRequests.save).toHaveBeenCalled();
    const supersededCall = h.infoRequests.save.mock.calls.find(
      (call) =>
        Array.isArray(call[0]) &&
        call[0][0]?.status === InfoRequestStatus.SUPERSEDED,
    );
    expect(supersededCall).toBeDefined();
    expect(created.status).toBe(InfoRequestStatus.PENDING);
    expect(created.token).not.toBe('old-token');
    expect(h.email.sendRegistrationInfoRequest).toHaveBeenCalled();
  });

  it('resends the same token without creating another request', async () => {
    const existing = pendingRequest();
    const h = harness({
      openRequests: [],
      requestById: existing,
    });

    const result = await h.service.resendInfoRequest(
      regulator as never,
      actor as never,
      ORG_ID,
      REQUEST_ID,
    );

    expect(result.token).toBe(existing.token);
    expect(h.infoRequests.create).not.toHaveBeenCalled();
    expect(h.email.sendRegistrationInfoRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ops@acme.test',
        responseUrl: `https://app.test/apply/respond/${existing.token}`,
      }),
    );
  });

  it('refuses to resend a superseded request', async () => {
    const h = harness({
      requestById: pendingRequest({ status: InfoRequestStatus.SUPERSEDED }),
    });

    await expect(
      h.service.resendInfoRequest(
        regulator as never,
        actor as never,
        ORG_ID,
        REQUEST_ID,
      ),
    ).rejects.toThrow(/replaced by a newer/i);
  });

  it('rejects public access to a superseded token', async () => {
    const h = harness({
      requestById: {
        ...pendingRequest({ status: InfoRequestStatus.SUPERSEDED }),
        organization: organization(),
      },
    });
    h.infoRequests.findOne.mockResolvedValue({
      ...pendingRequest({ status: InfoRequestStatus.SUPERSEDED }),
      organization: organization(),
    });

    await expect(
      h.service.getInfoRequestByToken('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
    ).rejects.toThrow(/replaced by a newer/i);
  });
});
