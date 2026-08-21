/**
 * Role of a user within their organization, following the twelve roles named
 * in the technical proposal, section 12. Consumers are deliberately absent:
 * a final consumer never holds an account, they scan the public verification
 * endpoint instead (proposal section 8, privacy).
 */
export enum UserRole {
  /** Platform operator. Crosses organization boundaries. */
  SYSTEM_ADMIN = 'SYSTEM_ADMIN',
  ORG_ADMIN = 'ORG_ADMIN',
  PRODUCTION_MANAGER = 'PRODUCTION_MANAGER',
  PRODUCTION_OFFICER = 'PRODUCTION_OFFICER',
  WAREHOUSE_MANAGER = 'WAREHOUSE_MANAGER',
  WAREHOUSE_OFFICER = 'WAREHOUSE_OFFICER',
  QUALITY_OFFICER = 'QUALITY_OFFICER',
  LOGISTICS_OFFICER = 'LOGISTICS_OFFICER',
  SALES_OFFICER = 'SALES_OFFICER',
  /** Reads dashboards and reports; performs no field operations. */
  MANAGEMENT = 'MANAGEMENT',
  /** Read-only across the chain of custody, for compliance review. */
  AUDITOR = 'AUDITOR',
}
