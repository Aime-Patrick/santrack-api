import { NotFoundEntityException, TraceabilityRuleException } from '../common/errors';
import { ProductionService } from '../manufacturing/services/production.service';

/**
 * DR-02: production must be answerable by site, because "which plant made this
 * batch?" is the first question asked in a recall.
 *
 * These exercise the facility resolver directly. It is private, so it is
 * reached the way the production path reaches it — through the service — with
 * only the manager it actually uses stubbed.
 */
describe('resolving the producing facility', () => {
  const ACME = { id: 1, name: 'Acme Dairy' } as never;
  const OTHER = { id: 2, name: 'Someone Else' } as never;

  const SITES = [
    { id: 10, organizationId: 1, name: 'Masaka plant', active: true },
    { id: 11, organizationId: 1, name: 'Nyagatare plant', active: true },
    { id: 12, organizationId: 2, name: "Other's plant", active: true },
    { id: 13, organizationId: 1, name: 'Closed plant', active: false },
  ];

  /** Reaches the private resolver the way production does. */
  function resolve(
    organization: unknown,
    facilityId: number | undefined,
    visible: typeof SITES,
  ) {
    const manager = {
      findOne: (_entity: unknown, { where }: { where: { id: number } }) =>
        Promise.resolve(SITES.find((s) => s.id === where.id) ?? null),
      find: (
        _entity: unknown,
        { where }: { where: { organizationId: number; active?: boolean } },
      ) =>
        Promise.resolve(
          visible.filter(
            (s) =>
              s.organizationId === where.organizationId &&
              (where.active === undefined || s.active === where.active),
          ),
        ),
    };

    const service = Object.create(ProductionService.prototype) as ProductionService;
    return (
      service as unknown as {
        resolveFacility: (
          m: unknown,
          o: unknown,
          f?: number,
        ) => Promise<number | null>;
      }
    ).resolveFacility(manager, organization, facilityId);
  }

  it('uses the only site when a business has one', async () => {
    // A single-site manufacturer should not be asked a question with one answer.
    const single = SITES.filter((s) => s.id === 10);
    await expect(resolve(ACME, undefined, single)).resolves.toBe(10);
  });

  it('refuses to guess when a business runs several sites', async () => {
    // Guessing would put a recall at the wrong plant.
    await expect(resolve(ACME, undefined, SITES)).rejects.toBeInstanceOf(
      TraceabilityRuleException,
    );
  });

  it('accepts a site the caller owns', async () => {
    await expect(resolve(ACME, 11, SITES)).resolves.toBe(11);
  });

  it("refuses another organization's site", async () => {
    // Producing against someone else's plant would put their name on your batch.
    await expect(resolve(ACME, 12, SITES)).rejects.toBeInstanceOf(
      NotFoundEntityException,
    );
  });

  it('refuses a site that has closed', async () => {
    await expect(resolve(ACME, 13, SITES)).rejects.toBeInstanceOf(
      TraceabilityRuleException,
    );
  });

  it('leaves it empty when a business has no site at all', async () => {
    // A shop is not forced to invent a plant.
    await expect(resolve(OTHER, undefined, [])).resolves.toBeNull();
  });

  it('refuses to run when a business has sites but all of them have closed', async () => {
    // Distinct from having no site at all. Falling through to null here would
    // hand an unsited batch to a business that does have plants: DR-02 would
    // not break loudly, it would quietly stop being true for everything made
    // afterwards, and the gap would surface during a recall.
    const allClosed = SITES.filter((s) => s.organizationId === 1).map((s) => ({
      ...s,
      active: false,
    }));

    await expect(resolve(ACME, undefined, allClosed)).rejects.toBeInstanceOf(
      TraceabilityRuleException,
    );
  });
});
