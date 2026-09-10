/**
 * Where a licence sits in its life. Two ways out of ACTIVE, and they are
 * different tools: expiry lapses on a date and is fixed by renewing;
 * suspension is a decision taken today and is reversed by reinstating.
 */
export enum LicenseStatus {
  /** Being filled in. The applicant can still change it. */
  DRAFT = 'DRAFT',
  /** Handed to the regulator, waiting to be picked up. */
  SUBMITTED = 'SUBMITTED',
  /** A named reviewer is screening it. */
  UNDER_REVIEW = 'UNDER_REVIEW',
  /** Screening failed. The reason is recorded and the applicant may reapply. */
  REJECTED = 'REJECTED',
  /** Approved and within its dates. The only state that permits operating. */
  ACTIVE = 'ACTIVE',
  /** Past expiresOn without renewal. Not punitive - just lapsed. */
  EXPIRED = 'EXPIRED',
  /** Halted pending inspection. Immediate, reversible: the defect case. */
  SUSPENDED = 'SUSPENDED',
  /** Terminal. Serious or repeated failure. */
  REVOKED = 'REVOKED',
  /** Withdrawn by the applicant before submission. */
  CANCELLED = 'CANCELLED',
}

/** Licences that let a business act normally. */
export function permitsOperation(status: LicenseStatus): boolean {
  return status === LicenseStatus.ACTIVE;
}

/**
 * Statuses where the holder may still take goods back.
 *
 * A suspended manufacturer must be able to receive returns: when product is
 * defective you want it flowing back to them, and a licence state that
 * blocked returns would strand bad stock in shops. Only revocation closes
 * the door completely.
 */
export function permitsReturns(status: LicenseStatus): boolean {
  return (
    status === LicenseStatus.ACTIVE ||
    status === LicenseStatus.SUSPENDED ||
    status === LicenseStatus.EXPIRED
  );
}

/** A licence that has been decided on, one way or the other. */
export function isDecided(status: LicenseStatus): boolean {
  return (
    status === LicenseStatus.ACTIVE ||
    status === LicenseStatus.REJECTED ||
    status === LicenseStatus.SUSPENDED ||
    status === LicenseStatus.REVOKED ||
    status === LicenseStatus.EXPIRED
  );
}

/** What a licensed business is allowed to do. */
export enum LicensedActivity {
  MANUFACTURING = 'MANUFACTURING',
  WAREHOUSING = 'WAREHOUSING',
  DISTRIBUTION = 'DISTRIBUTION',
  RETAIL = 'RETAIL',
  /** The regulatory layer itself is licensed, by the platform operator. */
  REGULATION = 'REGULATION',
}

/** Steps in a licence's history. Append-only, like traceability events. */
export enum LicenseEventType {
  APPLIED = 'APPLIED',
  DOCUMENT_ATTACHED = 'DOCUMENT_ATTACHED',
  DOCUMENT_REMOVED = 'DOCUMENT_REMOVED',
  SUBMITTED = 'SUBMITTED',
  REVIEW_STARTED = 'REVIEW_STARTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
  REINSTATED = 'REINSTATED',
  REVOKED = 'REVOKED',
  RENEWED = 'RENEWED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  FOLLOW_UP_ADDED = 'FOLLOW_UP_ADDED',
  FOLLOW_UP_ACTIONED = 'FOLLOW_UP_ACTIONED',
  FOLLOW_UP_CLOSED = 'FOLLOW_UP_CLOSED',
}

/** Status lifecycle of a condition or follow-up item attached to a license. */
export enum LicenseFollowUpStatus {
  OPEN = 'OPEN',
  ACTIONED = 'ACTIONED',
  CLOSED = 'CLOSED',
}

export enum LicenseFollowUpPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/**
 * How hard the platform leans on licensing.
 *
 * The technical proposal describes supervision, not gatekeeping. Section 1
 * asks for "compliance status" and "automated license expiry notifications";
 * section 10 puts "license status", "expired licenses" and "unregistered
 * products" on the regulator's dashboard. Nothing in the document asks for an
 * unlicensed business to be stopped mid-operation - the regulator is meant to
 * see the problem and act on it.
 *
 * ADVISORY is therefore the default: the action goes through, a finding is
 * recorded against the organization, and the holder is notified. STRICT exists
 * for deployments that want the harder rule, and OFF for local development.
 *
 * Revocation is outside this setting. It is terminal and always refused.
 */
export enum EnforcementMode {
  OFF = 'off',
  ADVISORY = 'advisory',
  STRICT = 'strict',
}

/** Why an organization's activity was flagged as non-compliant. */
export enum ComplianceFindingType {
  /** Acted with no licence of the required kind at all. */
  UNLICENSED_ACTIVITY = 'UNLICENSED_ACTIVITY',
  /** Held a licence that had lapsed on its expiry date. */
  EXPIRED_LICENCE = 'EXPIRED_LICENCE',
  /** Held a licence a regulator had halted. */
  SUSPENDED_LICENCE = 'SUSPENDED_LICENCE',
}

/** The verdict of assessing one organization against one activity. */
export enum LicenseVerdict {
  LICENSED = 'LICENSED',
  NONE = 'NONE',
  EXPIRED = 'EXPIRED',
  SUSPENDED = 'SUSPENDED',
  REVOKED = 'REVOKED',
}

/** Verdicts that are non-compliant, and the finding each one raises. */
export function findingFor(verdict: LicenseVerdict): ComplianceFindingType | null {
  switch (verdict) {
    case LicenseVerdict.NONE:
      return ComplianceFindingType.UNLICENSED_ACTIVITY;
    case LicenseVerdict.EXPIRED:
      return ComplianceFindingType.EXPIRED_LICENCE;
    case LicenseVerdict.SUSPENDED:
      return ComplianceFindingType.SUSPENDED_LICENCE;
    default:
      return null;
  }
}
