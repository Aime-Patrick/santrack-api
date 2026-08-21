import { Capability, capabilitiesFor } from '../auth/capabilities';
import { UserRole } from '../auth/user-role.enum';
import { TraceableItem } from '../item/entities/traceable-item.entity';
import { ItemKind, ItemStatus, SealState } from '../item/item.enums';
import { Organization } from '../organization/entities/organization.entity';
import { OrganizationType } from '../organization/organization-type.enum';
import { ItemAction, availableActions } from './available-actions';

const warehouse = { id: 1, name: 'Kigali Warehouse' } as Organization;
const shop = { id: 2, name: 'Nyabugogo Shop' } as Organization;

/** A unit sitting in the warehouse's own hands, unless said otherwise. */
function unit(overrides: Partial<TraceableItem> = {}): TraceableItem {
  return {
    id: 10,
    qrCode: 'ST-QR-000010',
    code: 'ST-LPT-000010',
    kind: ItemKind.UNIT,
    packageType: null,
    status: ItemStatus.ACTIVE,
    sealState: null,
    parent: null,
    holder: warehouse,
    batch: { id: 5, batchCode: 'BT-2026-0001' },
    expiresOn: null,
    isExpired: () => false,
    ...overrides,
  } as unknown as TraceableItem;
}

function container(overrides: Partial<TraceableItem> = {}): TraceableItem {
  return unit({
    kind: ItemKind.PACKAGE,
    sealState: SealState.SEALED,
    ...overrides,
  });
}

function actionsFor(
  item: TraceableItem,
  role: UserRole,
  organization: Organization = warehouse,
) {
  return availableActions({
    item,
    organization,
    capabilities: capabilitiesFor(role, OrganizationType.WAREHOUSE),
  });
}

function find(
  item: TraceableItem,
  role: UserRole,
  action: ItemAction,
  organization: Organization = warehouse,
) {
  return actionsFor(item, role, organization).find((a) => a.action === action);
}

describe('what a role is even shown', () => {
  it('does not offer destruction to a sales officer', () => {
    // Not a permission check the operator should have to fail: it is simply
    // not their job, and a button that always errors teaches distrust.
    expect(find(unit(), UserRole.SALES_OFFICER, ItemAction.DESTROY)).toBeUndefined();
  });

  it('does not offer a sale to a warehouse officer', () => {
    expect(find(unit(), UserRole.WAREHOUSE_OFFICER, ItemAction.SELL)).toBeUndefined();
  });

  it('offers an auditor the label and nothing else', () => {
    // Read-only means read-only. An auditor who can quarantine stock is not an
    // auditor.
    const actions = actionsFor(unit(), UserRole.AUDITOR);
    expect(actions.map((a) => a.action)).toEqual([ItemAction.PRINT_LABEL]);
  });

  it('offers an organization administrator the full set', () => {
    const actions = actionsFor(container({ sealState: SealState.OPEN }), UserRole.ORG_ADMIN);
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        ItemAction.PRINT_LABEL,
        ItemAction.PACK,
        ItemAction.DISPATCH,
        ItemAction.SELL,
        ItemAction.QUARANTINE,
        ItemAction.RECALL_BATCH,
      ]),
    );
  });
});

describe('custody', () => {
  it('refuses to act on goods another party holds, and names them', () => {
    const elsewhere = unit({ holder: shop });
    const dispatch = find(elsewhere, UserRole.ORG_ADMIN, ItemAction.DISPATCH);

    expect(dispatch?.available).toBe(false);
    expect(dispatch?.reason).toContain('Nyabugogo Shop');
  });

  it('still lets anyone print the label of goods they do not hold', () => {
    // A regulator inspecting a consignment needs the label; custody is about
    // acting on goods, not about looking at them.
    const elsewhere = unit({ holder: shop });
    expect(find(elsewhere, UserRole.AUDITOR, ItemAction.PRINT_LABEL)?.available).toBe(
      true,
    );
  });

  it('waits for the receiving party while goods are in transit', () => {
    const moving = unit({ status: ItemStatus.IN_TRANSIT });
    const relocate = find(moving, UserRole.WAREHOUSE_MANAGER, ItemAction.RELOCATE);

    expect(relocate?.available).toBe(false);
    expect(relocate?.reason).toContain('receiving party');
  });
});

describe('packaging state', () => {
  it('will not pack into a sealed container', () => {
    const packAction = find(container(), UserRole.WAREHOUSE_OFFICER, ItemAction.PACK);
    expect(packAction?.available).toBe(false);
    expect(packAction?.reason).toContain('sealed');
  });

  it('packs into an open one', () => {
    const open = container({ sealState: SealState.OPEN });
    expect(find(open, UserRole.WAREHOUSE_OFFICER, ItemAction.PACK)?.available).toBe(
      true,
    );
  });

  it('will not open a container twice', () => {
    const open = container({ sealState: SealState.OPEN });
    expect(find(open, UserRole.WAREHOUSE_OFFICER, ItemAction.OPEN)?.available).toBe(
      false,
    );
  });

  it('will not take anything out of an empty container', () => {
    const empty = container({ sealState: SealState.EMPTY });
    const remove = find(empty, UserRole.WAREHOUSE_OFFICER, ItemAction.REMOVE_CONTENT);
    expect(remove?.available).toBe(false);
    expect(remove?.reason).toContain('empty');
  });

  it('explains that a unit is not a container', () => {
    const packAction = find(unit(), UserRole.WAREHOUSE_OFFICER, ItemAction.PACK);
    expect(packAction?.available).toBe(false);
    expect(packAction?.reason).toContain('single unit');
  });
});

describe('an item inside a container', () => {
  const boxed = unit({
    parent: { id: 99, code: 'ST-BOX-000099' } as TraceableItem,
  });

  it('cannot be dispatched on its own', () => {
    const dispatch = find(boxed, UserRole.WAREHOUSE_MANAGER, ItemAction.DISPATCH);
    expect(dispatch?.available).toBe(false);
    expect(dispatch?.reason).toContain('ST-BOX-000099');
  });

  it('cannot be sold on its own', () => {
    const sell = find(boxed, UserRole.SALES_OFFICER, ItemAction.SELL);
    expect(sell?.available).toBe(false);
    expect(sell?.reason).toContain('Take it out');
  });
});

describe('lifecycle state', () => {
  it('will not quarantine what is already quarantined', () => {
    const held = unit({ status: ItemStatus.QUARANTINED });
    expect(find(held, UserRole.QUALITY_OFFICER, ItemAction.QUARANTINE)?.available).toBe(
      false,
    );
  });

  it('releases quarantined and returned goods, and nothing else', () => {
    for (const status of [ItemStatus.QUARANTINED, ItemStatus.RETURNED]) {
      expect(
        find(unit({ status }), UserRole.QUALITY_OFFICER, ItemAction.RELEASE)?.available,
      ).toBe(true);
    }
    expect(
      find(unit(), UserRole.QUALITY_OFFICER, ItemAction.RELEASE)?.available,
    ).toBe(false);
  });

  it('will not expire an identity with no expiry date', () => {
    const expire = find(unit(), UserRole.QUALITY_OFFICER, ItemAction.EXPIRE);
    expect(expire?.available).toBe(false);
    expect(expire?.reason).toContain('No expiry date');
  });

  it('closes every operation once an identity is destroyed', () => {
    // The history stays readable - that is the point of an append-only log -
    // but nothing further happens to the physical thing.
    const gone = unit({ status: ItemStatus.DESTROYED });
    const actions = actionsFor(gone, UserRole.ORG_ADMIN).filter(
      (a) => a.action !== ItemAction.PRINT_LABEL && a.action !== ItemAction.RECALL_BATCH,
    );

    for (const action of actions) {
      expect(action.available).toBe(false);
    }
  });

  it('carries the verb the lifecycle endpoint expects', () => {
    // The six lifecycle actions share one endpoint, so the page needs to know
    // what to post rather than mapping button labels back to verbs itself.
    const quarantine = find(unit(), UserRole.QUALITY_OFFICER, ItemAction.QUARANTINE);
    expect(quarantine?.lifecycleAction).toBe('QUARANTINE');
  });
});

describe('selling', () => {
  it.each([
    [ItemStatus.SOLD, 'already been sold'],
    [ItemStatus.RECALLED, 'under recall'],
    [ItemStatus.EXPIRED, 'past its expiry'],
    [ItemStatus.DAMAGED, 'damaged'],
    [ItemStatus.RESERVED, 'sales order'],
    [ItemStatus.RETURNED, 'not been inspected'],
  ])('refuses to sell %s stock and says why', (status, expected) => {
    const sell = find(unit({ status }), UserRole.SALES_OFFICER, ItemAction.SELL);
    expect(sell?.available).toBe(false);
    expect(sell?.reason).toContain(expected);
  });

  it('sells active stock in hand', () => {
    expect(find(unit(), UserRole.SALES_OFFICER, ItemAction.SELL)?.available).toBe(true);
  });
});

describe('recall', () => {
  it('reaches goods the caller does not hold', () => {
    // A recall follows the batch wherever it went. Requiring custody would
    // make it useless - the dangerous stock is precisely the stock that left.
    const sold = unit({ holder: shop, status: ItemStatus.SOLD });
    expect(
      find(sold, UserRole.QUALITY_OFFICER, ItemAction.RECALL_BATCH, warehouse)?.available,
    ).toBe(true);
  });

  it('has nothing to act on when the identity belongs to no batch', () => {
    const batchless = unit({ batch: null });
    const recall = find(batchless, UserRole.QUALITY_OFFICER, ItemAction.RECALL_BATCH);
    expect(recall?.available).toBe(false);
  });
});

describe('capability resolution', () => {
  it('offers the registry-free actions consistently with the guard', () => {
    // Same expression the JWT guard uses, so a button that appears is a call
    // that will be allowed through.
    const capabilities = capabilitiesFor(
      UserRole.WAREHOUSE_OFFICER,
      OrganizationType.WAREHOUSE,
    );
    const actions = availableActions({ item: unit(), organization: warehouse, capabilities });

    expect(capabilities).toContain(Capability.HANDLE_PACKAGING);
    expect(actions.some((a) => a.action === ItemAction.PACK)).toBe(true);
    expect(capabilities).not.toContain(Capability.APPLY_LIFECYCLE);
    expect(actions.some((a) => a.action === ItemAction.QUARANTINE)).toBe(false);
  });
});
