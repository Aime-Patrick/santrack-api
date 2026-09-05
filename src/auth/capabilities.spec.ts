import { OrganizationType } from '../organization/organization-type.enum';
import {
  CAPABILITY_DESCRIPTIONS,
  Capability,
  ROLE_CAPABILITIES,
  can,
  capabilitiesFor,
  userCan,
} from './capabilities';
import { UserRole } from './user-role.enum';

describe('role capabilities (proposal section 12)', () => {
  it('gives every role in the proposal a defined capability set', () => {
    for (const role of Object.values(UserRole)) {
      expect(ROLE_CAPABILITIES[role]).toBeDefined();
    }
  });

  it('lets only production and org-admin roles mint identities', () => {
    // A QR identity is created at the point of manufacture and nowhere else,
    // so a warehouse, a shop, or the platform operator must never invent one.
    const minters = Object.values(UserRole).filter((role) =>
      can(role, Capability.REGISTER_IDENTITY),
    );
    expect(minters.sort()).toEqual(
      [
        UserRole.ORG_ADMIN,
        UserRole.PRODUCTION_MANAGER,
        UserRole.PRODUCTION_OFFICER,
      ].sort(),
    );
  });

  it('gives the platform operator oversight without operational tools', () => {
    // SAN TECH administers the registry, writes to it (Add Industry) and can
    // read the whole platform's audit log and open Trace for investigation.
    // They do not run a factory floor, warehouse, or payroll.
    expect(ROLE_CAPABILITIES[UserRole.SYSTEM_ADMIN].sort()).toEqual(
      [
        Capability.VIEW_OPERATIONS,
        Capability.MANAGE_USERS,
        Capability.OVERSEE_INDUSTRIES,
        Capability.ADMINISTER_PLATFORM,
        Capability.MANAGE_INDUSTRIES,
        Capability.READ_AUDIT,
      ].sort(),
    );
    expect(can(UserRole.SYSTEM_ADMIN, Capability.REGISTER_IDENTITY)).toBe(false);
    expect(can(UserRole.SYSTEM_ADMIN, Capability.MOVE_STOCK)).toBe(false);
    expect(can(UserRole.SYSTEM_ADMIN, Capability.SELL)).toBe(false);
    expect(can(UserRole.SYSTEM_ADMIN, Capability.RUN_PRODUCTION)).toBe(false);
    expect(can(UserRole.SYSTEM_ADMIN, Capability.MANAGE_FINANCE)).toBe(false);
    expect(can(UserRole.SYSTEM_ADMIN, Capability.VIEW_OPERATIONS)).toBe(true);
    expect(can(UserRole.SYSTEM_ADMIN, Capability.ADMINISTER_PLATFORM)).toBe(true);
    expect(can(UserRole.SYSTEM_ADMIN, Capability.MANAGE_INDUSTRIES)).toBe(true);
    expect(can(UserRole.SYSTEM_ADMIN, Capability.READ_AUDIT)).toBe(true);
  });

  it('gives no business role a registry write by default', () => {
    // Add Industry is operator-only unless the operator grants it to a
    // specific officer. A manufacturer's admin, a warehouse manager, an
    // auditor - none of them may create registry entries on title alone.
    for (const role of Object.values(UserRole)) {
      if (role === UserRole.SYSTEM_ADMIN) continue;
      expect(can(role, Capability.MANAGE_INDUSTRIES)).toBe(false);
    }
  });

  it('gives read-only roles no write capability at all', () => {
    // An auditor who can move stock is not an auditor.
    for (const role of [UserRole.AUDITOR, UserRole.MANAGEMENT]) {
      expect(ROLE_CAPABILITIES[role]).toEqual([Capability.VIEW_OPERATIONS]);
    }
  });

  it('does not let a warehouse officer sell', () => {
    expect(can(UserRole.WAREHOUSE_OFFICER, Capability.SELL)).toBe(false);
  });

  it('does not let a sales officer issue a recall', () => {
    expect(can(UserRole.SALES_OFFICER, Capability.MANAGE_RECALL)).toBe(false);
  });

  it('lets a quality officer quarantine and recall', () => {
    expect(can(UserRole.QUALITY_OFFICER, Capability.APPLY_LIFECYCLE)).toBe(true);
    expect(can(UserRole.QUALITY_OFFICER, Capability.MANAGE_RECALL)).toBe(true);
  });

  it('lets only production and org-admin roles run production', () => {
    const runners = Object.values(UserRole).filter((role) =>
      can(role, Capability.RUN_PRODUCTION),
    );
    expect(runners.sort()).toEqual(
      [
        UserRole.ORG_ADMIN,
        UserRole.PRODUCTION_MANAGER,
        UserRole.PRODUCTION_OFFICER,
      ].sort(),
    );
  });

  it('lets only production, quality and org-admin roles record inspections', () => {
    const inspectors = Object.values(UserRole).filter((role) =>
      can(role, Capability.PERFORM_QC),
    );
    expect(inspectors.sort()).toEqual(
      [
        UserRole.ORG_ADMIN,
        UserRole.PRODUCTION_MANAGER,
        UserRole.QUALITY_OFFICER,
      ].sort(),
    );
  });

  it('does not let a warehouse or sales officer run production', () => {
    expect(can(UserRole.WAREHOUSE_OFFICER, Capability.RUN_PRODUCTION)).toBe(false);
    expect(can(UserRole.SALES_OFFICER, Capability.RUN_PRODUCTION)).toBe(false);
  });

  it('lets only logistics, warehouse and org-admin roles manage logistics', () => {
    const managers = Object.values(UserRole).filter((role) =>
      can(role, Capability.MANAGE_LOGISTICS),
    );
    expect(managers.sort()).toEqual(
      [
        UserRole.ORG_ADMIN,
        UserRole.LOGISTICS_OFFICER,
        UserRole.WAREHOUSE_MANAGER,
      ].sort(),
    );
  });

  it('lets only sales and org-admin roles manage clients', () => {
    const managers = Object.values(UserRole).filter((role) =>
      can(role, Capability.MANAGE_CLIENTS),
    );
    expect(managers.sort()).toEqual(
      [UserRole.ORG_ADMIN, UserRole.SALES_OFFICER].sort(),
    );
  });

  it('lets only org-admin manage finance', () => {
    const managers = Object.values(UserRole).filter((role) =>
      can(role, Capability.MANAGE_FINANCE),
    );
    expect(managers.sort()).toEqual([UserRole.ORG_ADMIN].sort());
  });

  it('lets only org-admin manage payroll', () => {
    const managers = Object.values(UserRole).filter((role) =>
      can(role, Capability.MANAGE_PAYROLL),
    );
    expect(managers.sort()).toEqual([UserRole.ORG_ADMIN].sort());
  });

  it('does not let a sales officer post to the ledger', () => {
    expect(can(UserRole.SALES_OFFICER, Capability.MANAGE_FINANCE)).toBe(false);
  });

  it('does not let a sales officer run payroll', () => {
    expect(can(UserRole.SALES_OFFICER, Capability.MANAGE_PAYROLL)).toBe(false);
  });

  it('gives every role the ability to read its own operations', () => {
    for (const role of Object.values(UserRole)) {
      expect(can(role, Capability.VIEW_OPERATIONS)).toBe(true);
    }
  });

  it('explains every capability it defines', () => {
    // A capability with no description reaches the Roles screen as a bare
    // SCREAMING_SNAKE token, which tells an administrator nothing.
    for (const capability of Object.values(Capability)) {
      expect(CAPABILITY_DESCRIPTIONS[capability]?.length).toBeGreaterThan(0);
    }
  });
});

describe('capabilities conferred by regulatory standing', () => {
  const manufacturer = { type: OrganizationType.MANUFACTURER };
  const regulator = { type: OrganizationType.REGULATOR };

  it('gives no business role sight of the industry registry', () => {
    // The complaint that started this: a production manager could see every
    // company on the platform because the browser kept its own capability
    // table and that table was out of date.
    for (const role of Object.values(UserRole)) {
      if (role === UserRole.SYSTEM_ADMIN) continue;
      expect(userCan({ role, organization: manufacturer }, Capability.OVERSEE_INDUSTRIES)).toBe(
        false,
      );
    }
  });

  it('gives a licensing authority sight of the industry registry', () => {
    // Proposal section 3: industry registration, licensing, compliance and
    // inspection belong to the regulatory authorities.
    for (const role of [UserRole.ORG_ADMIN, UserRole.AUDITOR, UserRole.MANAGEMENT]) {
      expect(userCan({ role, organization: regulator }, Capability.OVERSEE_INDUSTRIES)).toBe(
        true,
      );
    }
  });

  it('lets the platform operator see the registry wherever they sit', () => {
    expect(
      userCan(
        { role: UserRole.SYSTEM_ADMIN, organization: manufacturer },
        Capability.OVERSEE_INDUSTRIES,
      ),
    ).toBe(true);
  });

  it('does not let standing confer platform administration', () => {
    // An authority supervises the businesses on the platform. It does not run
    // the platform, and must not be able to award itself or anyone else
    // regulatory standing.
    expect(
      userCan(
        { role: UserRole.ORG_ADMIN, organization: regulator },
        Capability.ADMINISTER_PLATFORM,
      ),
    ).toBe(false);
  });

  it('confers no write capability a role does not already hold', () => {
    // Standing widens what you can see, never what you can do. It adds the
    // industry registry and the platform audit log - both reads.
    const auditorAtRegulator = capabilitiesFor(UserRole.AUDITOR, OrganizationType.REGULATOR);
    expect(auditorAtRegulator).toEqual([
      Capability.VIEW_OPERATIONS,
      Capability.OVERSEE_INDUSTRIES,
      Capability.READ_AUDIT,
    ]);
  });

  it('gives a licensing authority the platform audit log but no registry write', () => {
    // The regulator reads who did what across the platform, but does not
    // create registry entries - that stays with the operator unless a
    // specific officer is granted it.
    const regulatorAdmin = capabilitiesFor(
      UserRole.ORG_ADMIN,
      OrganizationType.REGULATOR,
    );
    expect(regulatorAdmin).toContain(Capability.READ_AUDIT);
    expect(regulatorAdmin).not.toContain(Capability.MANAGE_INDUSTRIES);
  });

  it('merges per-user grants outside the organization ceiling', () => {
    // A grant from the operator is an explicit exception for a named officer:
    // the grant survives the ceiling that would otherwise strip it.
    const granted = capabilitiesFor(
      UserRole.AUDITOR,
      OrganizationType.MANUFACTURER,
      [Capability.MANAGE_INDUSTRIES],
    );
    expect(granted).toContain(Capability.MANAGE_INDUSTRIES);
    expect(granted).toContain(Capability.VIEW_OPERATIONS);
  });

  it('resolves the same list with grants regardless of how the question is asked', () => {
    const grants = [Capability.MANAGE_INDUSTRIES];
    for (const role of Object.values(UserRole)) {
      expect(userCan({ role, organization: regulator, extraCapabilities: grants }, Capability.MANAGE_INDUSTRIES)).toBe(
        capabilitiesFor(role, OrganizationType.REGULATOR, grants).includes(
          Capability.MANAGE_INDUSTRIES,
        ),
      );
    }
  });

  it('resolves the same list regardless of how the question is asked', () => {
    for (const role of Object.values(UserRole)) {
      for (const capability of Object.values(Capability)) {
        expect(userCan({ role, organization: manufacturer }, capability)).toBe(
          capabilitiesFor(role, OrganizationType.MANUFACTURER).includes(capability),
        );
      }
    }
  });
});

/**
 * The ceiling each organization type may hold, pinned exactly (DR-09 WU-7).
 *
 * This file is the single source of truth for the whole platform - the browser
 * keeps no copy, and /api/auth/me returns the resolved list - so these
 * assertions are the specification rather than a check on it. A ceiling read
 * through ORG_ADMIN is the ceiling itself: that role holds everything a
 * business can do, so whatever survives the intersection is the limit.
 */
describe('what an organization type may hold at most', () => {
  const ceilingOf = (type: OrganizationType) =>
    capabilitiesFor(UserRole.ORG_ADMIN, type);

  it('lets a retailer take a delivery', () => {
    // The last mile of the chain. Without MOVE_STOCK the receive endpoint is
    // refused and stock a distributor dispatched stays IN_TRANSIT under the
    // distributor for ever, because nobody downstream can confirm it.
    expect(ceilingOf(OrganizationType.RETAILER)).toEqual([
      Capability.HANDLE_PACKAGING,
      Capability.MOVE_STOCK,
      Capability.SELL,
      Capability.APPLY_LIFECYCLE,
      Capability.MANAGE_CLIENTS,
      Capability.VIEW_OPERATIONS,
      Capability.MANAGE_USERS,
    ]);
  });

  it('lets a shop take a delivery and write off what it finds broken', () => {
    expect(ceilingOf(OrganizationType.SHOP)).toEqual([
      Capability.HANDLE_PACKAGING,
      Capability.MOVE_STOCK,
      Capability.SELL,
      Capability.APPLY_LIFECYCLE,
      Capability.MANAGE_CLIENTS,
      Capability.VIEW_OPERATIONS,
      Capability.MANAGE_USERS,
    ]);
  });

  it('leaves the warehouse unable to sell', () => {
    // Widening the retail ceilings must not widen this one by accident: a
    // warehouse holds other businesses' goods and has no commercial layer.
    expect(ceilingOf(OrganizationType.WAREHOUSE)).toEqual([
      Capability.HANDLE_PACKAGING,
      Capability.MOVE_STOCK,
      Capability.APPLY_LIFECYCLE,
      Capability.MANAGE_LOGISTICS,
      Capability.VIEW_OPERATIONS,
      Capability.MANAGE_USERS,
    ]);
  });

  it('lets nobody but a manufacturer mint an identity or run production', () => {
    // The ceiling's original job, unchanged by DR-09. Minting an identity is a
    // manufacturing claim; taking a delivery is not.
    for (const type of [
      OrganizationType.WAREHOUSE,
      OrganizationType.DISTRIBUTOR,
      OrganizationType.RETAILER,
      OrganizationType.SHOP,
    ]) {
      expect(ceilingOf(type)).not.toContain(Capability.REGISTER_IDENTITY);
      expect(ceilingOf(type)).not.toContain(Capability.RUN_PRODUCTION);
    }
    expect(ceilingOf(OrganizationType.MANUFACTURER)).toContain(
      Capability.REGISTER_IDENTITY,
    );
    expect(ceilingOf(OrganizationType.MANUFACTURER)).toContain(
      Capability.RUN_PRODUCTION,
    );
  });

  it('gives an authority no operational capability at all', () => {
    // A regulator supervises businesses; it does not move their stock.
    expect(ceilingOf(OrganizationType.REGULATOR)).not.toContain(
      Capability.MOVE_STOCK,
    );
    expect(ceilingOf(OrganizationType.REGULATOR)).not.toContain(Capability.SELL);
  });

  it('lets only a regulator organization administrator decide licences', () => {
    // DECIDE_LICENCES used to ride inside every org-admin's role, so a
    // manufacturer's administrator was offered the regulator's command centre
    // in the navigation. Deciding licences is done to businesses, never by
    // them: the authority's own administrator holds it, and nobody else.
    expect(
      capabilitiesFor(UserRole.ORG_ADMIN, OrganizationType.MANUFACTURER),
    ).not.toContain(Capability.DECIDE_LICENCES);
    expect(
      capabilitiesFor(UserRole.ORG_ADMIN, OrganizationType.RETAILER),
    ).not.toContain(Capability.DECIDE_LICENCES);
    expect(
      capabilitiesFor(UserRole.ORG_ADMIN, OrganizationType.REGULATOR),
    ).toContain(Capability.DECIDE_LICENCES);
    // Standing widens reading, never deciding: an inspector or auditor at an
    // authority reviews, they do not approve.
    expect(
      capabilitiesFor(UserRole.AUDITOR, OrganizationType.REGULATOR),
    ).not.toContain(Capability.DECIDE_LICENCES);
  });
});
