/**
 * The kind of business/party participating in the traceability chain.
 * Governs role-based visibility across the platform.
 */
export enum OrganizationType {
  MANUFACTURER = 'MANUFACTURER',
  WAREHOUSE = 'WAREHOUSE',
  DISTRIBUTOR = 'DISTRIBUTOR',
  RETAILER = 'RETAILER',
  SHOP = 'SHOP',
  /** Permissioned regulatory layer - sees across organizations. */
  REGULATOR = 'REGULATOR',
  CONSUMER = 'CONSUMER',
}

/**
 * The kinds of business a new account may declare itself to be.
 *
 * REGULATOR is excluded deliberately. It is not a description of a business,
 * it is an authority the platform grants: a regulator reads every timeline in
 * the system, sees consumer information and can recall any manufacturer's
 * batch. Letting an applicant tick that box at sign-up would hand those powers
 * to anyone with an email address, so regulatory standing is conferred by a
 * platform operator instead (see OrganizationService.grantRegulatoryStanding).
 *
 * CONSUMER is excluded for a different reason: a final consumer never holds a
 * business account at all - they scan the public verification endpoint
 * (proposal section 8).
 *
 * The trade types remain self-declared, and that is fine as far as it goes:
 * declaring yourself a manufacturer is a claim, not a permission. What that
 * claim entitles you to do is what the licensing module exists to verify.
 */
export const SELF_DECLARABLE_TYPES: readonly OrganizationType[] = [
  OrganizationType.MANUFACTURER,
  OrganizationType.WAREHOUSE,
  OrganizationType.DISTRIBUTOR,
  OrganizationType.RETAILER,
  OrganizationType.SHOP,
];

export function isSelfDeclarable(type: OrganizationType): boolean {
  return SELF_DECLARABLE_TYPES.includes(type);
}
