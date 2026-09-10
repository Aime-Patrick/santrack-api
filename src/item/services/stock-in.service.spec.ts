/**
 * StockInService unit tests.
 *
 * These tests exercise the domain logic without a real database. Each test
 * stubs exactly the dependencies it exercises so the coverage is surgical.
 */
import { TraceabilityRuleException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { TraceableItem } from '../entities/traceable-item.entity';
import { ItemKind, ItemStatus, SealState } from '../item.enums';
import { StockInService } from './stock-in.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeOrg(type: OrganizationType): Organization {
  return { id: 1, name: 'Test Org', type } as Organization;
}

function makeContainer(overrides: Partial<TraceableItem> = {}): TraceableItem {
  return {
    id: 100,
    qrCode: 'ST-QR-PKG-0001',
    code: 'ST-PKG-0001',
    kind: ItemKind.PACKAGE,
    packageType: 'PALLET',
    status: ItemStatus.ACTIVE,
    sealState: SealState.SEALED,
    holder: { id: 99, name: 'Distributor' } as Organization,
    location: null,
    product: null,
    quantity: 12,
    parent: null,
    ...overrides,
  } as unknown as TraceableItem;
}

function makeUnit(id: number, holder?: Organization): TraceableItem {
  return {
    id,
    qrCode: `ST-QR-UNIT-${id}`,
    code: `ST-UNIT-${id}`,
    kind: ItemKind.UNIT,
    status: ItemStatus.IN_TRANSIT,
    sealState: null,
    parent: null,
    holder: holder ?? ({ id: 99 } as Organization),
  } as unknown as TraceableItem;
}

// ─── requireTradingOrg (private, tested via confirm/preview) ─────────────────

describe('StockInService — organisation type guard', () => {
  /**
   * We test the guard by calling the public confirm() method and checking
   * that it throws before it touches any async resource.
   *
   * Rather than constructing the full DI tree, we directly construct a partial
   * service instance and rely on the fact that the guard runs synchronously
   * before any await.
   */
  function serviceWithoutDeps(): Pick<StockInService, 'preview'> {
    // Cast to bypass DI. Only calling preview() to hit requireTradingOrg
    // before the itemService.require() call.
    return {
      preview: StockInService.prototype.preview.bind({
        requireTradingOrg: (StockInService.prototype as any).requireTradingOrg,
        itemService: {
          require: jest.fn().mockResolvedValue(makeContainer()),
          contents: jest.fn().mockResolvedValue({ present: [], removed: [] }),
        },
        recorder: {},
        dataSource: {},
        items: {},
      }),
    };
  }

  const tradingTypes = [OrganizationType.RETAILER, OrganizationType.SHOP] as const;
  const blockedTypes = [
    OrganizationType.MANUFACTURER,
    OrganizationType.WAREHOUSE,
    OrganizationType.DISTRIBUTOR,
    OrganizationType.REGULATOR,
  ] as const;

  it.each(tradingTypes)('allows %s to use Stock In', async (type) => {
    const svc = serviceWithoutDeps();
    await expect(svc.preview(makeOrg(type), 'ST-QR-PKG-0001')).resolves.toBeDefined();
  });

  it.each(blockedTypes)('blocks %s from Stock In', async (type) => {
    const svc = serviceWithoutDeps();
    await expect(svc.preview(makeOrg(type), 'ST-QR-PKG-0001')).rejects.toThrow(
      TraceabilityRuleException,
    );
  });
});

// ─── requireNotAutomaticStockInOrg ───────────────────────────────────────────

describe('requireNotAutomaticStockInOrg', () => {
  // Import the exported function directly
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { requireNotAutomaticStockInOrg } = require('./item.service');

  it('throws for RETAILER', () => {
    expect(() =>
      requireNotAutomaticStockInOrg(makeOrg(OrganizationType.RETAILER)),
    ).toThrow(TraceabilityRuleException);
  });

  it('throws for SHOP', () => {
    expect(() =>
      requireNotAutomaticStockInOrg(makeOrg(OrganizationType.SHOP)),
    ).toThrow(TraceabilityRuleException);
  });

  it('does not throw for WAREHOUSE', () => {
    expect(() =>
      requireNotAutomaticStockInOrg(makeOrg(OrganizationType.WAREHOUSE)),
    ).not.toThrow();
  });

  it('does not throw for MANUFACTURER', () => {
    expect(() =>
      requireNotAutomaticStockInOrg(makeOrg(OrganizationType.MANUFACTURER)),
    ).not.toThrow();
  });
});

// ─── buildReceipt (private, tested via full confirm flow stub) ────────────────

describe('StockInService — receipt construction', () => {
  /**
   * We construct a minimal service stub that replays the confirm() logic with
   * controlled inputs to verify receipt counts without a real DataSource.
   */

  function stubService(descendants: TraceableItem[]) {
    const container = makeContainer({ sealState: SealState.OPEN });
    const org = makeOrg(OrganizationType.RETAILER);
    const events: { type: string }[] = [];

    const svc = new (StockInService as any)(
      // DataSource
      {
        transaction: (fn: (m: unknown) => Promise<unknown>) =>
          fn({
            findOne: jest.fn().mockResolvedValue(null),
            save: jest.fn().mockImplementation((_, item) => item),
          }),
      },
      // ItemRepository
      {},
      // ItemService
      {
        require: jest.fn().mockImplementation(async (qr: string) => {
          if (qr === container.qrCode) return { ...container };
          return descendants.find((d) => d.qrCode === qr) ?? null;
        }),
        contents: jest.fn().mockResolvedValue({ present: descendants, removed: [] }),
        withDescendants: jest.fn().mockResolvedValue([container, ...descendants]),
      },
      // EventRecorder
      {
        rejectReplay: jest.fn().mockResolvedValue(undefined),
        record: jest.fn().mockImplementation((_, ev) => {
          events.push(ev);
          return Promise.resolve({});
        }),
      },
    ) as StockInService;

    return { svc, org, container, events };
  }

  it('counts units and nested containers correctly', async () => {
    const unit1 = makeUnit(1);
    const unit2 = makeUnit(2);
    const nestedBox = makeContainer({ id: 101, code: 'ST-BOX-001', qrCode: 'ST-QR-BOX-001' });

    const { svc, org } = stubService([unit1, unit2, nestedBox]);

    const receipt = await svc.confirm(org, { id: 1 } as any, {
      containerQrCode: 'ST-QR-PKG-0001',
    });

    expect(receipt.unitCount).toBe(2);
    expect(receipt.nestedContainerCount).toBe(1);
    expect(receipt.totalItemsRegistered).toBe(4); // container + 2 units + 1 box
  });

  it('reports outcome "received" on first run', async () => {
    const unit1 = makeUnit(1);
    const { svc, org } = stubService([unit1]);

    const receipt = await svc.confirm(org, { id: 1 } as any, {
      containerQrCode: 'ST-QR-PKG-0001',
    });

    expect(receipt.outcome).toBe('received');
  });
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('StockInService — idempotency', () => {
  it('returns idempotent outcome when all items already settled under this org', async () => {
    const org = makeOrg(OrganizationType.RETAILER);
    // Container already held by the retailer, status ACTIVE
    const container = makeContainer({
      sealState: SealState.OPEN,
      holder: org as any,
      status: ItemStatus.ACTIVE,
    });
    const unit1 = makeUnit(1, org as any);
    unit1.status = ItemStatus.ACTIVE;

    const svc = new (StockInService as any)(
      {
        transaction: (fn: (m: unknown) => Promise<unknown>) =>
          fn({
            findOne: jest.fn().mockResolvedValue(null),
            save: jest.fn().mockImplementation((_, item) => item),
          }),
      },
      {},
      {
        require: jest.fn().mockResolvedValue(container),
        contents: jest.fn().mockResolvedValue({ present: [unit1], removed: [] }),
        withDescendants: jest.fn().mockResolvedValue([container, unit1]),
      },
      {
        rejectReplay: jest.fn().mockResolvedValue(undefined),
        record: jest.fn().mockResolvedValue({}),
      },
    ) as StockInService;

    const receipt = await svc.confirm(org, { id: 1 } as any, {
      containerQrCode: 'ST-QR-PKG-0001',
    });

    expect(receipt.outcome).toBe('idempotent');
  });
});

// ─── Sealed container auto-open ───────────────────────────────────────────────

describe('StockInService — sealed container processing', () => {
  it('writes a PACKAGE_OPENED event when the container arrives sealed', async () => {
    const org = makeOrg(OrganizationType.RETAILER);
    const sealedContainer = makeContainer({ sealState: SealState.SEALED });
    const unit1 = makeUnit(1);
    const recordedEvents: { type: string }[] = [];

    const svc = new (StockInService as any)(
      {
        transaction: (fn: (m: unknown) => Promise<unknown>) =>
          fn({
            findOne: jest.fn().mockResolvedValue(null),
            save: jest.fn().mockImplementation((_entity: unknown, item: unknown) => item),
          }),
      },
      {},
      {
        require: jest.fn().mockImplementation(async (qr: string) => {
          if (qr === sealedContainer.qrCode) return sealedContainer;
          return unit1;
        }),
        contents: jest.fn().mockResolvedValue({ present: [unit1], removed: [] }),
        withDescendants: jest.fn().mockResolvedValue([sealedContainer, unit1]),
      },
      {
        rejectReplay: jest.fn().mockResolvedValue(undefined),
        record: jest.fn().mockImplementation((_m: unknown, ev: { type: string }) => {
          recordedEvents.push(ev);
          return Promise.resolve({});
        }),
      },
    ) as StockInService;

    await svc.confirm(org, { id: 1 } as any, {
      containerQrCode: 'ST-QR-PKG-0001',
    });

    const eventTypes = recordedEvents.map((e) => e.type);
    expect(eventTypes).toContain('PACKAGE_OPENED');
    expect(eventTypes).toContain('RECEIVED');
  });

  it('does NOT write PACKAGE_OPENED when container is already open', async () => {
    const org = makeOrg(OrganizationType.RETAILER);
    const openContainer = makeContainer({ sealState: SealState.OPEN });
    const unit1 = makeUnit(1);
    const recordedEventTypes: string[] = [];

    const svc = new (StockInService as any)(
      {
        transaction: (fn: (m: unknown) => Promise<unknown>) =>
          fn({
            findOne: jest.fn().mockResolvedValue(null),
            save: jest.fn().mockImplementation((_e: unknown, item: TraceableItem) => item),
          }),
      },
      {},
      {
        require: jest.fn().mockResolvedValue({ ...openContainer }),
        contents: jest.fn().mockResolvedValue({ present: [unit1], removed: [] }),
        withDescendants: jest.fn().mockResolvedValue([openContainer, unit1]),
      },
      {
        rejectReplay: jest.fn().mockResolvedValue(undefined),
        record: jest.fn().mockImplementation((_m: unknown, ev: { type: string }) => {
          recordedEventTypes.push(ev.type);
          return Promise.resolve({});
        }),
      },
    ) as StockInService;

    await svc.confirm(org, { id: 1 } as any, {
      containerQrCode: 'ST-QR-PKG-0001',
    });

    expect(recordedEventTypes).not.toContain('PACKAGE_OPENED');
    expect(recordedEventTypes).toContain('RECEIVED');
  });
});

// ─── Non-container guard ──────────────────────────────────────────────────────

describe('StockInService — container validation', () => {
  it('rejects a unit QR code (not a container)', async () => {
    const org = makeOrg(OrganizationType.RETAILER);
    const unitItem = makeUnit(1);

    const svc = new (StockInService as any)(
      {
        transaction: (fn: (m: unknown) => Promise<unknown>) => fn({}),
      },
      {},
      {
        require: jest.fn().mockResolvedValue({ ...unitItem }),
        contents: jest.fn().mockResolvedValue({ present: [], removed: [] }),
        withDescendants: jest.fn().mockResolvedValue([unitItem]),
      },
      {
        rejectReplay: jest.fn().mockResolvedValue(undefined),
        record: jest.fn(),
      },
    ) as StockInService;

    await expect(
      svc.confirm(org, { id: 1 } as any, { containerQrCode: unitItem.qrCode }),
    ).rejects.toThrow(TraceabilityRuleException);
  });
});
