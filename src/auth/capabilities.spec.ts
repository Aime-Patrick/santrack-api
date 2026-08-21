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

  it('lets only production and admin roles mint identities', () => {
    // A QR identity is created at the point of manufacture and nowhere else,
    // so a warehouse or a shop must never be able to invent one.
    const minters = Object.values(UserRole).filter((role) =>
      can(role, Capability.REGISTER_IDENTITY),
    );
    expect(minters.sort()).toEqual(
      [
        UserRole.ORG_ADMIN,
        UserRole.PRODUCTION_MANAGER,
        UserRole.PRODUCTION_OFFICER,
        UserRole.SYSTEM_ADMIN,
      ].sort(),
    );
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

  it('lets only production and admin roles run production', () => {
    const runners = Object.values(UserRole).filter((role) =>
      can(role, Capability.RUN_PRODUCTION),
    );
    expect(runners.sort()).toEqual(
      [
        UserRole.ORG_ADMIN,
        UserRole.PRODUCTION_MANAGER,
        UserRole.PRODUCTION_OFFICER,
        UserRole.SYSTEM_ADMIN,
      ].sort(),
    );
  });

  it('lets only production, quality and admin roles record inspections', () => {
    const inspectors = Object.values(UserRole).filter((role) =>
      can(role, Capability.PERFORM_QC),
    );
    expect(inspectors.sort()).toEqual(
      [
        UserRole.ORG_ADMIN,
        UserRole.PRODUCTION_MANAGER,
        UserRole.QUALITY_OFFICER,
        UserRole.SYSTEM_ADMIN,
      ].sort(),
    );
  });

  it('does not let a warehouse or sales officer run production', () => {
    expect(can(UserRole.WAREHOUSE_OFFICER, Capability.RUN_PRODUCTION)).toBe(false);
    expect(can(UserRole.SALES_OFFICER, Capability.RUN_PRODUCTION)).toBe(false);
  });

  it('lets only logistics, warehouse and admin roles manage logistics', () => {
    const managers = Object.values(UserRole).filter((role) =>
      can(role, Capability.MANAGE_LOGISTICS),
    );
    expect(managers.sort()).toEqual(
      [
        UserRole.ORG_ADMIN,
        UserRole.SYSTEM_ADMIN,
        UserRole.LOGISTICS_OFFICER,
        UserRole.WAREHOUSE_MANAGER,
      ].sort(),
    );
  });

  it('lets only sales and admin roles manage clients', () => {
    const managers = Object.values(UserRole).filter((role) =>
      can(role, Capability.MANAGE_CLIENTS),
    );
    expect(managers.sort()).toEqual(
      [UserRole.ORG_ADMIN, UserRole.SYSTEM_ADMIN, UserRole.SALES_OFFICER].sort(),
    );
  });

  it('lets only admin roles manage finance', () => {
    const managers = Object.values(UserRole).filter((role) =>
      can(role, Capability.MANAGE_FINANCE),
    );
    expect(managers.sort()).toEqual(
      [UserRole.ORG_ADMIN, UserRole.SYSTEM_ADMIN].sort(),
    );
  });

  it('lets only admin roles manage payroll', () => {
    const managers = Object.values(UserRole).filter((role) =>
      can(role, Capability.MANAGE_PAYROLL),
    );
    expect(managers.sort()).toEqual(
      [UserRole.ORG_ADMIN, UserRole.SYSTEM_ADMIN].sort(),
    );
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
    // Standing widens what you can see, never what you can do.
    const auditorAtRegulator = capabilitiesFor(UserRole.AUDITOR, OrganizationType.REGULATOR);
    expect(auditorAtRegulator).toEqual([
      Capability.VIEW_OPERATIONS,
      Capability.OVERSEE_INDUSTRIES,
    ]);
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
