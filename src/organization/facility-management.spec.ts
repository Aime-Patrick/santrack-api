import { NotFoundEntityException } from '../common/errors';
import { FacilityService } from './services/facility.service';

/**
 * DR-07 WU-1: a business can open a second site.
 *
 * Until this landed, 211 organizations held 211 facilities and none held two.
 * The multi-plant case the whole authorization model rests on was not
 * unauthorised — it was unenterable.
 */
describe('opening and closing sites', () => {
  const ACME = { id: 1, name: 'Acme Dairy' } as never;

  interface Row {
    id: number;
    organizationId: number;
    name: string;
    code: string | null;
    address: string | null;
    active: boolean;
  }

  function service(seed: Row[] = []) {
    const rows: Row[] = seed.map((row) => ({ ...row }));
    let nextId = Math.max(0, ...rows.map((r) => r.id)) + 1;

    const matches = (row: Row, where: Record<string, unknown>) =>
      Object.entries(where).every(
        ([key, value]) => (row as unknown as Record<string, unknown>)[key] === value,
      );

    // The manager handed to the transaction callback. `save` and `create` stand
    // in for the real ones closely enough that the code under test cannot tell.
    const manager = {
      findOne: jest.fn((_entity: unknown, { where }: { where: Record<string, unknown> }) =>
        Promise.resolve(rows.find((row) => matches(row, where)) ?? null),
      ),
      create: jest.fn((_entity: unknown, row: Partial<Row>) => ({ ...row })),
      save: jest.fn((row: Partial<Row>) => {
        const saved = { ...row, id: nextId++ } as Row;
        rows.push(saved);
        return Promise.resolve(saved);
      }),
    };

    const repository = {
      manager: {
        transaction: jest.fn((run: (m: unknown) => Promise<unknown>) => run(manager)),
      },
      find: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(rows.filter((row) => matches(row, where))),
      ),
      findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(rows.find((row) => matches(row, where)) ?? null),
      ),
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(rows.filter((row) => matches(row, where)).length),
      ),
      save: jest.fn((row: Row) => {
        const index = rows.findIndex((r) => r.id === row.id);
        if (index >= 0) rows[index] = { ...row };
        return Promise.resolve(row);
      }),
    };

    const sequences = { next: jest.fn(() => Promise.resolve(7)) };

    return {
      service: new FacilityService(repository as never, sequences as never),
      rows,
      repository,
      sequences,
    };
  }

  const site = (over: Partial<Row> = {}): Row => ({
    id: 10,
    organizationId: 1,
    name: 'Masaka plant',
    code: 'FAC-000010',
    address: null,
    active: true,
    ...over,
  });

  describe('opening', () => {
    it('gives a business a second site', async () => {
      const { service: svc, rows } = service([site()]);

      const opened = await svc.create(ACME, { name: 'Nyagatare plant' });

      expect(opened.name).toBe('Nyagatare plant');
      expect(rows.filter((r) => r.organizationId === 1)).toHaveLength(2);
    });

    it('draws the code from the shared counter rather than the caller', async () => {
      // Two sites answering to one code would misroute production, so the
      // reference is minted, never typed in.
      const { service: svc, sequences } = service();

      const opened = await svc.create(ACME, {
        name: 'Nyagatare plant',
        // deliberately sent, and deliberately ignored
        code: 'FAC-999999',
      } as never);

      expect(sequences.next).toHaveBeenCalledWith(expect.anything(), 'FAC');
      expect(opened.code).toBe('FAC-000007');
    });

    it('mints the code inside a transaction', async () => {
      // The counter takes a pessimistic lock, which Postgres will not grant
      // outside one. This is the failure that broke organization creation
      // during DR-02.
      const { service: svc, repository } = service();

      await svc.create(ACME, { name: 'Nyagatare plant' });

      expect(repository.manager.transaction).toHaveBeenCalledTimes(1);
    });

    it('trims the name and keeps an empty address empty', async () => {
      const { service: svc } = service();

      const opened = await svc.create(ACME, {
        name: '  Nyagatare plant  ',
        address: '   ',
      });

      expect(opened.name).toBe('Nyagatare plant');
      expect(opened.address).toBeNull();
    });
  });

  describe('reading', () => {
    it("reports another organization's site as not found", async () => {
      // Not 403: a 403 would confirm the site exists, which is more than a
      // stranger is entitled to know.
      const { service: svc } = service([site({ id: 12, organizationId: 2 })]);

      await expect(svc.get(12, 1)).rejects.toBeInstanceOf(NotFoundEntityException);
    });

    it('lists closed sites alongside open ones', async () => {
      // A closed plant still answers for everything made there.
      const { service: svc } = service([site(), site({ id: 11, name: 'Closed', active: false })]);

      await expect(svc.list(1)).resolves.toHaveLength(2);
    });
  });

  describe('correcting and closing', () => {
    it('renames a site', async () => {
      const { service: svc } = service([site()]);

      await expect(svc.update(10, 1, { name: 'Masaka works' })).resolves.toMatchObject({
        name: 'Masaka works',
      });
    });

    it('closes a site without deleting it', async () => {
      // Batches, orders, machines and locations reference this row.
      const { service: svc, rows } = service([site(), site({ id: 11, name: 'Nyagatare plant' })]);

      const closed = await svc.update(11, 1, { active: false });

      expect(closed.active).toBe(false);
      expect(rows.find((r) => r.id === 11)).toBeDefined();
    });

    it('closes the only site a business has', async () => {
      // The service does not police this. Whether a business may be left with
      // no open site is a question for production, which refuses to run
      // against one rather than quietly making an unsited batch — see the
      // producing-facility tests.
      const { service: svc } = service([site()]);

      await expect(svc.update(10, 1, { active: false })).resolves.toMatchObject({
        active: false,
      });
    });

    it('reopens a closed site', async () => {
      const { service: svc } = service([site({ active: false }), site({ id: 11, name: 'B' })]);

      await expect(svc.update(10, 1, { active: true })).resolves.toMatchObject({
        active: true,
      });
    });

    it("refuses to touch another organization's site", async () => {
      const { service: svc } = service([site({ id: 12, organizationId: 2 })]);

      await expect(
        svc.update(12, 1, { name: 'Mine now' }),
      ).rejects.toBeInstanceOf(NotFoundEntityException);
    });

    it('leaves everything alone when the request changes nothing', async () => {
      const { service: svc } = service([site()]);

      const unchanged = await svc.update(10, 1, {});

      expect(unchanged).toMatchObject({ name: 'Masaka plant', active: true });
    });
  });

  /**
   * The site code is the printed, scanned reference. Labels already in
   * circulation carry it, so a rename must never reach it.
   */
  it('never lets a site code change', async () => {
    const { service: svc } = service([site()]);

    const updated = await svc.update(10, 1, {
      name: 'Masaka works',
      code: 'FAC-999999',
    } as never);

    expect(updated.code).toBe('FAC-000010');
  });
});
