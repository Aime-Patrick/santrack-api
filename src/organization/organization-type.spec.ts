import { Capability, ROLE_CAPABILITIES, can } from '../auth/capabilities';
import { UserRole } from '../auth/user-role.enum';
import {
  OrganizationType,
  SELF_DECLARABLE_TYPES,
  isSelfDeclarable,
} from './organization-type.enum';

describe('what an applicant may declare itself to be', () => {
  it('never lets an applicant claim regulatory standing', () => {
    // A regulator reads every organization's chain of custody, sees consumer
    // information and can recall any manufacturer's batch. If this box could
    // be ticked at sign-up, anyone with an email address would hold it.
    expect(isSelfDeclarable(OrganizationType.REGULATOR)).toBe(false);
    expect(SELF_DECLARABLE_TYPES).not.toContain(OrganizationType.REGULATOR);
  });

  it('never lets an applicant register as a consumer', () => {
    // Final consumers hold no business account at all - they use the public
    // verification endpoint.
    expect(isSelfDeclarable(OrganizationType.CONSUMER)).toBe(false);
  });

  it('allows the ordinary trade types', () => {
    for (const type of [
      OrganizationType.MANUFACTURER,
      OrganizationType.WAREHOUSE,
      OrganizationType.DISTRIBUTOR,
      OrganizationType.RETAILER,
      OrganizationType.SHOP,
    ]) {
      expect(isSelfDeclarable(type)).toBe(true);
    }
  });
});

describe('platform administration', () => {
  it('is held by the platform operator alone', () => {
    const holders = Object.values(UserRole).filter((role) =>
      can(role, Capability.ADMINISTER_PLATFORM),
    );
    expect(holders).toEqual([UserRole.SYSTEM_ADMIN]);
  });

  it('is withheld from a customer organization administrator', () => {
    // ORG_ADMIN is the most senior role a customer holds, and must still not
    // be able to award their own company regulatory standing.
    expect(can(UserRole.ORG_ADMIN, Capability.ADMINISTER_PLATFORM)).toBe(false);
  });

  it('still gives an organization administrator every in-house capability', () => {
    // Five exclusions: running the platform, reading the register of every
    // business, deciding licence applications, writing to the registry, and
    // reading the platform-wide audit log. All are things done *to* businesses
    // or *to* the platform rather than by them - the most senior role a
    // customer holds does not carry any of them - but everything that happens
    // inside their own four walls does.
    //
    // DECIDE_LICENCES is deliberately not on the role: it is granted only to
    // an ORG_ADMIN who works for a licensing authority (capabilitiesFor), so a
    // manufacturer's administrator must not open the regulator's command
    // centre. MANAGE_INDUSTRIES and READ_AUDIT are operator-held (and the
    // former is individually grantable) rather than role-held.
    const outsideOrganization: Capability[] = [
      Capability.ADMINISTER_PLATFORM,
      Capability.OVERSEE_INDUSTRIES,
      Capability.DECIDE_LICENCES,
      Capability.MANAGE_INDUSTRIES,
      Capability.READ_AUDIT,
    ];

    for (const capability of Object.values(Capability)) {
      if (outsideOrganization.includes(capability)) continue;
      expect(ROLE_CAPABILITIES[UserRole.ORG_ADMIN]).toContain(capability);
    }

    for (const capability of outsideOrganization) {
      expect(ROLE_CAPABILITIES[UserRole.ORG_ADMIN]).not.toContain(capability);
    }
  });
});
