/**
 * The shape of a production-eligibility verdict (DR-07 §6, WU-4).
 *
 * Frozen: the frontend renders these fields and derives nothing from them. A
 * browser that recomputes a regulatory verdict is a second implementation of
 * the rule, and two implementations of a regulatory rule is how they disagree.
 *
 * The check list is always complete and always in this order, including when
 * the first entry fails (DR §24 invariant 7). A manufacturer who is stopped
 * needs to see everything that is wrong, not the first thing that was noticed.
 */

/**
 * The eight questions asked before a production run is permitted.
 *
 * Two ship inert by design and always return `NOT_APPLICABLE`:
 * `PRODUCT_AUTHORIZATION` (there is no product-level authorization in MVP) and
 * `PER_PRODUCTION_APPROVAL` (there are no per-production applications). They
 * are present so the response shape does not change on the day they go live.
 */
export enum EligibilityCheckCode {
  ORGANIZATION_LICENCE = 'ORGANIZATION_LICENCE',
  FACILITY_AUTHORIZATION = 'FACILITY_AUTHORIZATION',
  PRODUCT_CATEGORY_COVERAGE = 'PRODUCT_CATEGORY_COVERAGE',
  PRODUCT_AUTHORIZATION = 'PRODUCT_AUTHORIZATION', // inert in MVP
  LICENCE_VALIDITY_AT_REQUESTED_DATE = 'LICENCE_VALIDITY_AT_REQUESTED_DATE',
  PRODUCT_TRACEABILITY = 'PRODUCT_TRACEABILITY',
  BATCH_AND_RECALL_RESTRICTIONS = 'BATCH_AND_RECALL_RESTRICTIONS',
  PER_PRODUCTION_APPROVAL = 'PER_PRODUCTION_APPROVAL', // inert in MVP
}

/** The order the checks are always returned in. */
export const ELIGIBILITY_CHECK_ORDER: EligibilityCheckCode[] = [
  EligibilityCheckCode.ORGANIZATION_LICENCE,
  EligibilityCheckCode.FACILITY_AUTHORIZATION,
  EligibilityCheckCode.PRODUCT_CATEGORY_COVERAGE,
  EligibilityCheckCode.PRODUCT_AUTHORIZATION,
  EligibilityCheckCode.LICENCE_VALIDITY_AT_REQUESTED_DATE,
  EligibilityCheckCode.PRODUCT_TRACEABILITY,
  EligibilityCheckCode.BATCH_AND_RECALL_RESTRICTIONS,
  EligibilityCheckCode.PER_PRODUCTION_APPROVAL,
];

export type CheckStatus = 'PASS' | 'FAIL' | 'WARN' | 'NOT_APPLICABLE';

export interface EligibilityCheck {
  code: EligibilityCheckCode;
  status: CheckStatus;
  /** Written for a manufacturer, not a developer. */
  message: string;
  /** What they do next, where there is a real next action. */
  remedy?: { label: string; href: string };
}

export interface EligibilityResult {
  /** The regulatory verdict. Identical in OFF, ADVISORY and STRICT. */
  eligible: boolean;
  /** Whether creation is actually refused. */
  blocking: boolean;
  enforcementMode: 'OFF' | 'ADVISORY' | 'STRICT';
  evaluatedAt: Date;
  /** Always all eight, always in order, never short-circuited. */
  checks: EligibilityCheck[];
  reliedOn: {
    licenseIds: number[];
    licenseNumbers: string[];
    categoryCodes: string[];
  };
  rulesetVersion: string;
}

/**
 * The version of the rules a decision was taken under (OQ 8).
 *
 * A hand-bumped constant rather than a hash of the `LicenseCategory` rows,
 * because hashing needs a stable serialisation nobody has specified yet. It is
 * stored on every decision so a historical verdict can be read against the
 * rules that produced it rather than against today's.
 */
export const RULESET_VERSION = 'DR07-MVP-1';

/** `eligible` is the absence of a failure. A `WARN` does not defeat it. */
export function isEligible(checks: EligibilityCheck[]): boolean {
  return !checks.some((check) => check.status === 'FAIL');
}
