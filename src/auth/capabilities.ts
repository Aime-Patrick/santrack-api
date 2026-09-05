import { OrganizationType } from '../organization/organization-type.enum';
import { UserRole } from './user-role.enum';

/**
 * What a user is allowed to do, expressed as capabilities rather than as raw
 * role checks. Endpoints ask for a capability, so adding or re-scoping a role
 * is a change to one table here instead of a hunt through every controller.
 *
 * This file is the single source of truth for the whole platform. The browser
 * does not keep its own copy: /api/auth/me returns the caller's resolved
 * capability list and the UI hides what is not in it, so a change here reaches
 * the navigation, the page guards and the API in one move.
 */
export enum Capability {
  /** Mint new QR identities - only ever at the point of manufacture. */
  REGISTER_IDENTITY = 'REGISTER_IDENTITY',
  /** Pack, open and unpack containers. */
  HANDLE_PACKAGING = 'HANDLE_PACKAGING',
  /** Send stock to another party and confirm receipt. */
  MOVE_STOCK = 'MOVE_STOCK',
  /** Record a sale, to a business or a final consumer. */
  SELL = 'SELL',
  /** Quarantine, release, return, damage, expire, destroy. */
  APPLY_LIFECYCLE = 'APPLY_LIFECYCLE',
  /** Issue and lift batch recalls. */
  MANAGE_RECALL = 'MANAGE_RECALL',
  /** Create products, batches and locations. */
  MANAGE_CATALOG = 'MANAGE_CATALOG',
  /** Plan, start, complete and cancel manufacturing work. */
  RUN_PRODUCTION = 'RUN_PRODUCTION',
  /** Record quality inspections and their outcome. */
  PERFORM_QC = 'PERFORM_QC',
  /** Plan and run shipments: transporters, vehicles, drivers, routes. */
  MANAGE_LOGISTICS = 'MANAGE_LOGISTICS',
  /** Register customers and issue quotations, orders, invoices and payments. */
  MANAGE_CLIENTS = 'MANAGE_CLIENTS',
  /** Post journal entries and run the general ledger. */
  MANAGE_FINANCE = 'MANAGE_FINANCE',
  /** Register employees, attendance, leave and run payroll. */
  MANAGE_PAYROLL = 'MANAGE_PAYROLL',
  /** Read inventory, timelines and dashboards. */
  VIEW_OPERATIONS = 'VIEW_OPERATIONS',

  /**
   * Create, update and deactivate users within the caller's organization.
   * System admins can act across all organizations.
   */
  MANAGE_USERS = 'MANAGE_USERS',

  /**
   * Read the registry of every business on the platform - who is registered,
   * what they are licensed for, how they stand against compliance.
   *
   * Proposal section 3 puts industry registration, licensing, compliance and
   * inspection in the hands of the regulatory and licensing authorities, so
   * this is not something a customer's own staff hold: it is conferred by
   * regulatory standing (see CAPABILITIES_CONFERRED_BY_ORGANIZATION_TYPE) and
   * held outright by the platform operator. A manufacturer's production
   * manager runs a catalogue, not a national register.
   */
  OVERSEE_INDUSTRIES = 'OVERSEE_INDUSTRIES',

  /**
   * Screen licence applications, make decisions (approve/reject), and
   * suspend, reinstate or revoke licences. Held by licensing authorities,
   * distinct from MANAGE_RECALL which is about product batch recalls.
   */
  DECIDE_LICENCES = 'DECIDE_LICENCES',

  /**
   * Acts on the platform itself rather than within one business: granting an
   * organization regulatory standing, editing the registry, and approving
   * licences. Held only by the platform operator, never by a customer's own
   * administrator and never by a regulator - an authority supervises the
   * businesses on the platform, it does not administer the platform.
   */
  ADMINISTER_PLATFORM = 'ADMINISTER_PLATFORM',

  /**
   * Register a business in the industry registry ("Add Industry").
   *
   * A registry write, not a supervisory read: OVERSEE_INDUSTRIES lets an
   * authority look at every business, MANAGE_INDUSTRIES creates one. By
   * default only the platform operator holds it; it is the first capability
   * that can be granted to an individual user (see
   * DYNAMICALLY_GRANTABLE_CAPABILITIES) so a specific officer can be trusted
   * with it when the workload demands.
   */
  MANAGE_INDUSTRIES = 'MANAGE_INDUSTRIES',

  /**
   * Read the platform-wide audit log - the digital footprint of every write
   * across all organizations.
   *
   * Business staff keep reading their own organization's footprint through
   * VIEW_OPERATIONS with an organization scope; this is the wider view a
   * supervisor needs to answer "who did what to whom across the platform".
   * Held by the platform operator and conferred on licensing authorities by
   * their standing.
   */
  READ_AUDIT = 'READ_AUDIT',
}

const ALL = Object.values(Capability);

/**
 * Everything a business can do inside its own four walls. Excludes the
 * cross-organization capabilities: overseeing the industry registry,
 * administering the platform, deciding licence applications, writing to the
 * registry, and reading the platform-wide audit log are things done *to*
 * businesses or *to* the platform, not *by* a business's own staff. Licence
 * decisions are granted separately, only to an ORG_ADMIN who works for a
 * licensing authority (see capabilitiesFor) - a manufacturer's administrator
 * must not open the regulator's command centre.
 */
const ALL_WITHIN_ORGANIZATION = ALL.filter(
  (capability) =>
    capability !== Capability.ADMINISTER_PLATFORM &&
    capability !== Capability.OVERSEE_INDUSTRIES &&
    capability !== Capability.DECIDE_LICENCES &&
    capability !== Capability.MANAGE_INDUSTRIES &&
    capability !== Capability.READ_AUDIT,
);

/**
 * The proposal's section 12 responsibilities, translated into capabilities.
 * Read-only roles (MANAGEMENT, AUDITOR) deliberately receive no write
 * capability at all - an auditor who can move stock is not an auditor.
 *
 * SYSTEM_ADMIN is the platform operator (SAN TECH), not a factory floor role:
 * they oversee the registry and can open Trace for investigation, but they do
 * not mint identities, move stock, sell, or run payroll. Trace actions are
 * gated per capability, so VIEW_OPERATIONS alone yields timeline without Act.
 */
export const ROLE_CAPABILITIES: Record<UserRole, Capability[]> = {
  [UserRole.SYSTEM_ADMIN]: [
    Capability.VIEW_OPERATIONS,
    Capability.MANAGE_USERS,
    Capability.OVERSEE_INDUSTRIES,
    Capability.ADMINISTER_PLATFORM,
    Capability.MANAGE_INDUSTRIES,
    Capability.READ_AUDIT,
  ],
  // The most senior role a customer can hold, and still not a platform
  // operator - an organization administrator must not be able to award their
  // own company regulatory standing.
  [UserRole.ORG_ADMIN]: [...ALL_WITHIN_ORGANIZATION, Capability.MANAGE_USERS],

  [UserRole.PRODUCTION_MANAGER]: [
    Capability.REGISTER_IDENTITY,
    Capability.HANDLE_PACKAGING,
    Capability.MANAGE_CATALOG,
    Capability.RUN_PRODUCTION,
    Capability.PERFORM_QC,
    Capability.VIEW_OPERATIONS,
  ],
  [UserRole.PRODUCTION_OFFICER]: [
    Capability.REGISTER_IDENTITY,
    Capability.HANDLE_PACKAGING,
    Capability.RUN_PRODUCTION,
    Capability.VIEW_OPERATIONS,
  ],

  [UserRole.WAREHOUSE_MANAGER]: [
    Capability.HANDLE_PACKAGING,
    Capability.MOVE_STOCK,
    Capability.APPLY_LIFECYCLE,
    Capability.MANAGE_LOGISTICS,
    Capability.VIEW_OPERATIONS,
  ],
  [UserRole.WAREHOUSE_OFFICER]: [
    Capability.HANDLE_PACKAGING,
    Capability.MOVE_STOCK,
    Capability.VIEW_OPERATIONS,
  ],

  [UserRole.QUALITY_OFFICER]: [
    Capability.APPLY_LIFECYCLE,
    Capability.MANAGE_RECALL,
    Capability.PERFORM_QC,
    Capability.VIEW_OPERATIONS,
  ],

  [UserRole.LOGISTICS_OFFICER]: [
    Capability.MOVE_STOCK,
    Capability.MANAGE_LOGISTICS,
    Capability.VIEW_OPERATIONS,
  ],

  [UserRole.SALES_OFFICER]: [
    Capability.SELL,
    Capability.MANAGE_CLIENTS,
    Capability.MOVE_STOCK,
    Capability.VIEW_OPERATIONS,
  ],

  [UserRole.MANAGEMENT]: [Capability.VIEW_OPERATIONS],
  [UserRole.AUDITOR]: [Capability.VIEW_OPERATIONS],
};

/**
 * Capabilities that come from *which organization you work for* rather than
 * from your job title.
 *
 * A licensing authority's inspector and a manufacturer's inspector can hold
 * the same role and must not see the same platform: the first supervises an
 * industry, the second runs a production line. Role alone cannot express that,
 * because the role table is shared by every organization on the platform.
 *
 * Nothing here is a write capability. Standing widens what you can see;
 * acting on the registry itself stays ADMINISTER_PLATFORM.
 */
export const CAPABILITIES_CONFERRED_BY_ORGANIZATION_TYPE: Partial<
  Record<OrganizationType, Capability[]>
> = {
  // An authority supervises the businesses on the platform: it reads the
  // industry registry and the platform-wide audit log. Neither is a write -
  // registry writes (MANAGE_INDUSTRIES) stay with the operator unless a
  // specific officer is granted them.
  [OrganizationType.REGULATOR]: [
    Capability.OVERSEE_INDUSTRIES,
    Capability.READ_AUDIT,
  ],
};

/**
 * The most an organization of this type may hold, whatever its staff's job
 * titles say.
 *
 * Conferral alone was additive, which made an authority a superset of the
 * businesses it supervises: a regulator's ORG_ADMIN held every operational
 * capability the role carries - minting identities, running production,
 * posting to the ledger, running payroll - and simply gained OVERSEE_INDUSTRIES
 * on top. A licensing authority does not manufacture, and a screen full of
 * production tools is the visible half of an API that would have accepted the
 * work.
 *
 * Listed types are intersected with what the role grants; unlisted types are
 * bounded by role alone, which is right for an ordinary trading business.
 * SYSTEM_ADMIN is exempt from the ceiling: the platform operator is not a
 * business, and their account may sit in any organization without picking up
 * that organization's operational tools.
 */
export const CAPABILITY_CEILING_BY_ORGANIZATION_TYPE: Partial<
  Record<OrganizationType, Capability[]>
> = {
  // ── Regulator ────────────────────────────────────────────────────────
  // No operational capabilities. Supervises the industry, screens
  // licence applications, manages recalls, manages its own staff.
  [OrganizationType.REGULATOR]: [
    Capability.VIEW_OPERATIONS,
    Capability.OVERSEE_INDUSTRIES,
    Capability.DECIDE_LICENCES,
    Capability.MANAGE_RECALL,
    Capability.MANAGE_USERS,
    Capability.READ_AUDIT,
  ],

  // ── Manufacturer ─────────────────────────────────────────────────────
  // No ceiling — the full operational set from role applies. Only
  // manufacturers mint identities and run production.
  // (Intentionally omitted: unlisted types fall through to role-based
  // capabilities, and MANUFACTURER needs no cap.)

  // ── Warehouse ────────────────────────────────────────────────────────
  // Receives, stores, packs and ships. No identity minting, no
  // production, no sales ledger.
  [OrganizationType.WAREHOUSE]: [
    Capability.HANDLE_PACKAGING,
    Capability.MOVE_STOCK,
    Capability.APPLY_LIFECYCLE,
    Capability.MANAGE_LOGISTICS,
    Capability.MANAGE_USERS,
    Capability.VIEW_OPERATIONS,
  ],

  // ── Distributor ──────────────────────────────────────────────────────
  // Buys and resells in bulk. Moves stock, manages clients, no
  // manufacturing or identity minting.
  [OrganizationType.DISTRIBUTOR]: [
    Capability.HANDLE_PACKAGING,
    Capability.MOVE_STOCK,
    Capability.SELL,
    Capability.MANAGE_CLIENTS,
    Capability.APPLY_LIFECYCLE,
    Capability.MANAGE_USERS,
    Capability.VIEW_OPERATIONS,
  ],

  // ── Retailer ─────────────────────────────────────────────────────────
  // Sells to consumers. No production, no identity minting, no
  // logistics fleet.
  //
  // MOVE_STOCK is what lets a retailer confirm a delivery (DR-09 WU-7).
  // Without it POST /api/transfers/:id/receive is refused, and goods a
  // distributor dispatched sit IN_TRANSIT under the distributor for ever -
  // the last mile of the chain could not be completed at all. The capability
  // covers dispatch and internal relocation too, which is right: a retailer
  // moves stock from its back room to its shelves and sends goods back up
  // the chain when they are wrong.
  [OrganizationType.RETAILER]: [
    Capability.HANDLE_PACKAGING,
    Capability.MOVE_STOCK,
    Capability.SELL,
    Capability.MANAGE_CLIENTS,
    Capability.APPLY_LIFECYCLE,
    Capability.MANAGE_USERS,
    Capability.VIEW_OPERATIONS,
  ],

  // ── Shop ─────────────────────────────────────────────────────────────
  // Smallest trading unit. Sells, receives, packs. No production, no
  // identity minting, no logistics, no finance.
  //
  // MOVE_STOCK for the same reason as RETAILER above. APPLY_LIFECYCLE goes
  // with it: a shop is where a bottle is found broken on the shelf, where a
  // date is checked, and where a customer brings something back. Selling to
  // consumers without being able to say "this one is damaged" would leave
  // the shop's own stock permanently overstated (DR-09 WU-7).
  [OrganizationType.SHOP]: [
    Capability.HANDLE_PACKAGING,
    Capability.MOVE_STOCK,
    Capability.SELL,
    Capability.MANAGE_CLIENTS,
    Capability.APPLY_LIFECYCLE,
    Capability.MANAGE_USERS,
    Capability.VIEW_OPERATIONS,
  ],

  // ── Consumer ─────────────────────────────────────────────────────────
  // Final buyer — scans QR codes, views verification. No business
  // operations at all. (In practice consumers never hold a business
  // account, but the ceiling exists as a safety net.)
  [OrganizationType.CONSUMER]: [
    Capability.VIEW_OPERATIONS,
  ],
};

/**
 * Capabilities the platform operator may grant to an individual user, on top
 * of what the user's role and organization already give them. Anything not in
 * this list is refused by PATCH /api/users/:id/capabilities.
 *
 * Kept deliberately small: a per-user grant is an exception made for a
 * specific officer, so each entry should be something a normal role would
 * never hold.
 */
export const DYNAMICALLY_GRANTABLE_CAPABILITIES: Capability[] = [
  Capability.MANAGE_INDUSTRIES,
];

/**
 * Whether a role holds a capability on its own, before any organization
 * standing is taken into account.
 *
 * Prefer userCan at a boundary: this answers a question about a job title,
 * not about a person, and a regulator's staff hold capabilities their title
 * alone does not carry.
 */
export function can(role: UserRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

/**
 * Everything this person can actually do: what their role grants, plus what
 * their organization's standing confers, plus any capabilities the platform
 * operator granted them individually.
 *
 * This is what the guard enforces and what /api/auth/me reports, so the
 * navigation the browser draws and the answer the API gives are computed from
 * the same expression.
 */
export function capabilitiesFor(
  role: UserRole,
  organizationType?: OrganizationType | null,
  granted: Capability[] = [],
): Capability[] {
  const held = new Set(ROLE_CAPABILITIES[role] ?? []);

  if (organizationType) {
    const conferred =
      CAPABILITIES_CONFERRED_BY_ORGANIZATION_TYPE[organizationType] ?? [];
    for (const capability of conferred) {
      held.add(capability);
    }
  }

  // The ceiling is a limit, not a grant: it can only remove. SYSTEM_ADMIN is
  // exempt — they are not a business, and their account may sit in any org
  // without inheriting that org's operational ceiling.
  const ceiling =
    role === UserRole.SYSTEM_ADMIN || !organizationType
      ? null
      : CAPABILITY_CEILING_BY_ORGANIZATION_TYPE[organizationType];
  if (ceiling) {
    const permitted = new Set(ceiling);
    for (const capability of held) {
      if (!permitted.has(capability)) {
        held.delete(capability);
      }
    }
  }

  // Licence decisions belong to a licensing authority's administrator, not to
  // a job title: the same ORG_ADMIN role at a manufacturer must not hold it.
  // The ceiling keeps it for REGULATOR organizations; this is the grant.
  if (
    role === UserRole.ORG_ADMIN &&
    organizationType === OrganizationType.REGULATOR
  ) {
    held.add(Capability.DECIDE_LICENCES);
  }

  // Per-user grants are applied last, deliberately outside the ceiling: an
  // explicit grant from the platform operator to a named officer is an
  // exception to the organization's ordinary limits, not a case for the
  // ceiling to re-strip. The endpoint that writes these validates them
  // against DYNAMICALLY_GRANTABLE_CAPABILITIES first.
  for (const capability of granted) {
    held.add(capability);
  }

  // Declaration order, so the payload is stable and diffable.
  return ALL.filter((capability) => held.has(capability));
}

/**
 * One sentence per capability, in the language the business uses.
 *
 * These are shown on the Roles screen and in the "you cannot do this" notice a
 * user meets when they follow a link they do not hold. Keeping them beside the
 * enum means a new capability cannot ship without an explanation of itself.
 */
export const CAPABILITY_DESCRIPTIONS: Record<Capability, string> = {
  [Capability.REGISTER_IDENTITY]:
    'Mint new QR identities for units and packages, at the point of manufacture.',
  [Capability.HANDLE_PACKAGING]:
    'Pack items into containers, open a seal, and remove contents.',
  [Capability.MOVE_STOCK]:
    'Dispatch stock to another party, confirm receipt, and relocate it internally.',
  [Capability.SELL]: 'Record a sale, to a business or to a final consumer.',
  [Capability.APPLY_LIFECYCLE]:
    'Quarantine, release, return, damage, expire or destroy an identity.',
  [Capability.MANAGE_RECALL]: 'Issue and lift batch recalls.',
  [Capability.MANAGE_CATALOG]:
    'Create and maintain products, batches and locations.',
  [Capability.RUN_PRODUCTION]:
    'Plan, start, complete and cancel manufacturing work.',
  [Capability.PERFORM_QC]:
    'Record quality inspections and their pass or fail verdict.',
  [Capability.MANAGE_LOGISTICS]:
    'Run shipments: transporters, vehicles, drivers, routes and proof of delivery.',
  [Capability.MANAGE_CLIENTS]:
    'Register customers and issue quotations, orders, invoices and payments.',
  [Capability.MANAGE_FINANCE]:
    'Post journal entries and run the general ledger, budgets and reports.',
  [Capability.MANAGE_PAYROLL]:
    'Register employees, record attendance and leave, and run payroll.',
  [Capability.VIEW_OPERATIONS]:
    'Read inventory, product timelines, reports and dashboards.',
  [Capability.MANAGE_USERS]:
    'Create, update and deactivate users within your own organization.',
  [Capability.OVERSEE_INDUSTRIES]:
    'Read the registry of businesses on the platform, their licences and compliance record.',
  [Capability.DECIDE_LICENCES]:
    'Screen licence applications, approve or reject, and suspend, reinstate or revoke licences.',
  [Capability.ADMINISTER_PLATFORM]:
    'Administer the platform itself: the registry, regulatory standing and licence approval.',
  [Capability.MANAGE_INDUSTRIES]:
    'Register businesses in the industry registry (Add Industry).',
  [Capability.READ_AUDIT]:
    'Read the platform-wide audit log - the digital footprint of every write across all organizations.',
};

/** Whether a specific person may perform an operation. */
export function userCan(
  user: {
    role: UserRole;
    organization?: { type: OrganizationType } | null;
    /** Per-user grants the platform operator assigned (see capabilitiesFor). */
    extraCapabilities?: Capability[];
  },
  capability: Capability,
): boolean {
  return capabilitiesFor(
    user.role,
    user.organization?.type,
    user.extraCapabilities,
  ).includes(capability);
}
