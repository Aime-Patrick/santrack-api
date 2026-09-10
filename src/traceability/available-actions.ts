import { Capability } from '../auth/capabilities';
import { LifecycleAction } from '../item/dto/item.dto';
import { TraceableItem } from '../item/entities/traceable-item.entity';
import {
  ItemKind,
  ItemStatus,
  SealState,
  blocksSale,
  isTerminal,
} from '../item/item.enums';
import { Organization } from '../organization/entities/organization.entity';
import { OrganizationType } from '../organization/organization-type.enum';

/**
 * Everything that can be done to one identity from its own page.
 *
 * The traceability screen is where an operator actually stands: they have
 * scanned a code and they are looking at the thing. Making them navigate to a
 * separate Dispatch page, re-enter the code they just scanned and hope they
 * typed it right is how the wrong pallet gets shipped. So the page offers the
 * operations, and this decides which of them make sense right now.
 */
export enum ItemAction {
  PRINT_LABEL = 'PRINT_LABEL',

  PACK = 'PACK',
  OPEN = 'OPEN',
  REMOVE_CONTENT = 'REMOVE_CONTENT',

  DISPATCH = 'DISPATCH',
  RELOCATE = 'RELOCATE',
  SELL = 'SELL',

  QUARANTINE = 'QUARANTINE',
  RELEASE = 'RELEASE',
  RETURN = 'RETURN',
  DAMAGE = 'DAMAGE',
  EXPIRE = 'EXPIRE',
  DESTROY = 'DESTROY',

  RECALL_BATCH = 'RECALL_BATCH',
}

export interface AvailableAction {
  action: ItemAction;
  /** Whether the operation would succeed if attempted right now. */
  available: boolean;
  /**
   * Why not, when it would not. Shown on a disabled control.
   *
   * An operator who is told "this pallet is in transit, the receiving party
   * confirms it" learns the system. One shown a button that fails on click
   * learns to distrust it, and one shown no button at all learns nothing.
   */
  reason?: string;
  /** The lifecycle verb to post, for the six that share one endpoint. */
  lifecycleAction?: LifecycleAction;
}

interface Context {
  item: TraceableItem;
  /** Null for the platform operator, who investigates without holding custody. */
  organization: Organization | null;
  capabilities: Capability[];
}

/**
 * Organisation types whose stock-in workflow is fully automatic.
 *
 * RETAILER and SHOP receive containers through the Stock In screen, which
 * handles every packaging state transition internally. Showing them PACK, OPEN
 * and REMOVE_CONTENT on the trace page would expose the implementation detail
 * they are explicitly not meant to operate manually.
 */
const STOCK_IN_ORGS: readonly OrganizationType[] = [
  OrganizationType.RETAILER,
  OrganizationType.SHOP,
];

/**
 * What this caller may do to this item, now.
 *
 * Two different questions are answered here and the difference matters.
 * Whether the caller *holds the capability* decides if the action appears at
 * all - a sales officer has no business seeing a Destroy button, and hiding it
 * is not hiding information from them, it is describing their job. Whether the
 * *item's state allows it* decides whether the action is enabled, and that one
 * always comes with a sentence, because it is a fact about the goods that the
 * operator standing in front of them needs to know.
 */
export function availableActions(context: Context): AvailableAction[] {
  const { item, organization, capabilities } = context;

  /** True when manual packaging operations must not be surfaced to this org. */
  const usesAutomaticStockIn =
    organization != null &&
    STOCK_IN_ORGS.includes(organization.type as OrganizationType);

  const holds = (capability: Capability) => capabilities.includes(capability);
  const inCustody = organization != null && item.holder?.id === organization.id;
  const isPackage = item.kind === ItemKind.PACKAGE;
  const terminal = isTerminal(item.status);

  const actions: AvailableAction[] = [];

  /** Adds an action if the caller's role covers it at all. */
  const offer = (
    capability: Capability,
    action: ItemAction,
    verdict: true | string,
    lifecycleAction?: LifecycleAction,
  ) => {
    if (!holds(capability)) return;
    actions.push({
      action,
      available: verdict === true,
      ...(verdict === true ? {} : { reason: verdict }),
      ...(lifecycleAction ? { lifecycleAction } : {}),
    });
  };

  /**
   * Almost everything below needs the goods to be in this organization's
   * hands. Custody is the whole point of the chain: a warehouse cannot
   * quarantine stock sitting in a shop, however senior the person asking.
   */
  const custody = (): true | string =>
    inCustody
      ? true
      : `${item.holder?.name ?? 'Another party'} holds this right now, so only they can act on it`;

  const operable = (): true | string => {
    if (terminal) {
      return 'This identity was destroyed. Its history stays readable, but nothing further can happen to it';
    }
    if (item.status === ItemStatus.IN_TRANSIT) {
      return 'This is in transit. The receiving party confirms it before anything else can happen';
    }
    return custody();
  };

  // Printing needs no custody: a regulator inspecting a consignment and a
  // warehouse re-labelling a scuffed carton both legitimately want the label.
  offer(Capability.VIEW_OPERATIONS, ItemAction.PRINT_LABEL, true);

  // ── Packaging ───────────────────────────────────────────────────────────
  // RETAILER / SHOP receive containers through the Stock In screen, which
  // handles all packaging transitions automatically. Suppress manual packaging
  // actions for those organisation types so the trace page never asks them to
  // open/pack/remove manually.
  if (!usesAutomaticStockIn) {
    offer(
      Capability.HANDLE_PACKAGING,
      ItemAction.PACK,
      !isPackage
        ? 'Only a container holds other items. This is a single unit'
        : item.sealState === SealState.SEALED
          ? 'This container is sealed. Open it before adding to it'
          : operable(),
    );

    offer(
      Capability.HANDLE_PACKAGING,
      ItemAction.OPEN,
      !isPackage
        ? 'Only a container can be opened. This is a single unit'
        : item.sealState !== SealState.SEALED
          ? 'This container is already open'
          : operable(),
    );

    offer(
      Capability.HANDLE_PACKAGING,
      ItemAction.REMOVE_CONTENT,
      !isPackage
        ? 'Only a container has contents. This is a single unit'
        : item.sealState === SealState.SEALED
          ? 'Open the container before taking anything out of it'
          : item.sealState === SealState.EMPTY
            ? 'This container is already empty'
            : operable(),
    );
  }

  // ── Movement ────────────────────────────────────────────────────────────
  offer(
    Capability.MOVE_STOCK,
    ItemAction.DISPATCH,
    item.parent
      ? `This is inside ${item.parent.code}. Dispatch the container, or take this out of it first`
      : blocksSale(item.status)
        ? `Cannot dispatch something ${item.status.toLowerCase()}`
        : operable(),
  );

  offer(Capability.MOVE_STOCK, ItemAction.RELOCATE, operable());

  offer(
    Capability.SELL,
    ItemAction.SELL,
    item.parent
      ? `This is inside ${item.parent.code}. Take it out before selling it separately`
      : blocksSale(item.status)
        ? statusRefusal(item.status)
        : operable(),
  );

  // ── Lifecycle ───────────────────────────────────────────────────────────
  offer(
    Capability.APPLY_LIFECYCLE,
    ItemAction.QUARANTINE,
    item.status === ItemStatus.QUARANTINED
      ? 'Already quarantined'
      : operable(),
    LifecycleAction.QUARANTINE,
  );

  offer(
    Capability.APPLY_LIFECYCLE,
    ItemAction.RELEASE,
    item.status !== ItemStatus.QUARANTINED && item.status !== ItemStatus.RETURNED
      ? 'Release puts quarantined or returned goods back into normal stock. This is neither'
      : operable(),
    LifecycleAction.RELEASE,
  );

  offer(
    Capability.APPLY_LIFECYCLE,
    ItemAction.RETURN,
    item.status === ItemStatus.RETURNED ? 'Already returned' : operable(),
    LifecycleAction.RETURN,
  );

  offer(
    Capability.APPLY_LIFECYCLE,
    ItemAction.DAMAGE,
    item.status === ItemStatus.DAMAGED
      ? 'Already recorded as damaged'
      : operable(),
    LifecycleAction.DAMAGE,
  );

  offer(
    Capability.APPLY_LIFECYCLE,
    ItemAction.EXPIRE,
    item.status === ItemStatus.EXPIRED
      ? 'Already expired'
      : !item.expiresOn
        ? 'No expiry date is recorded against this identity'
        : operable(),
    LifecycleAction.EXPIRE,
  );

  offer(
    Capability.APPLY_LIFECYCLE,
    ItemAction.DESTROY,
    terminal ? 'Already destroyed' : custody(),
    LifecycleAction.DESTROY,
  );

  // ── Recall ──────────────────────────────────────────────────────────────
  // Recall acts on the batch, not on this one item, and reaches wherever the
  // batch went - so it deliberately does not require custody.
  offer(
    Capability.MANAGE_RECALL,
    ItemAction.RECALL_BATCH,
    !item.batch
      ? 'This identity belongs to no batch, so there is nothing to recall it with'
      : true,
  );

  return actions;
}

/** Why a status blocks a sale, said plainly. */
function statusRefusal(status: ItemStatus): string {
  switch (status) {
    case ItemStatus.SOLD:
      return 'This has already been sold';
    case ItemStatus.RESERVED:
      return 'This is committed to a sales order and cannot be sold separately';
    case ItemStatus.RECALLED:
      return 'This is under recall and must not be sold';
    case ItemStatus.QUARANTINED:
      return 'This is quarantined. Release it before selling';
    case ItemStatus.RETURNED:
      return 'This came back up the chain and has not been inspected. Release it first';
    case ItemStatus.EXPIRED:
      return 'This is past its expiry date';
    case ItemStatus.DAMAGED:
      return 'This is recorded as damaged';
    default:
      return `Cannot sell something ${status.toLowerCase()}`;
  }
}
