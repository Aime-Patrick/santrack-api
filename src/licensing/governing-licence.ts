import { In, Repository } from 'typeorm';
import { today } from '../item/entities/traceable-item.entity';
import { License } from './entities/license.entity';
import {
  LicensedActivity,
  LicenseStatus,
  LicenseVerdict,
} from './licensing.enums';

export interface Assessment {
  verdict: LicenseVerdict;
  license: License | null;
}

/** What a licence is *about*: the business as a whole, or one of its sites. */
export type LicenceGrain = 'ORGANIZATION' | 'FACILITY';

export function grainOf(license: License): LicenceGrain {
  return license.facilityId === null || license.facilityId === undefined
    ? 'ORGANIZATION'
    : 'FACILITY';
}

/**
 * The statuses that represent a licence a regulator has ruled on.
 *
 * DRAFT, SUBMITTED and UNDER_REVIEW are deliberately absent: an application in
 * progress authorises nothing, and treating one as a decision would let a
 * business authorise itself by filling in a form. This is also what "in a
 * decided state" means in the facility replacement rule below — a half-typed
 * application for Huye must not displace the licence Huye is actually running
 * on.
 */
export const DECIDED_STATUSES = [
  LicenseStatus.ACTIVE,
  LicenseStatus.SUSPENDED,
  LicenseStatus.EXPIRED,
  LicenseStatus.REVOKED,
] as const;

/** What a single licence amounts to on a given day. */
export function judge(license: License, on: string): LicenseVerdict {
  if (license.status === LicenseStatus.REVOKED) {
    return LicenseVerdict.REVOKED;
  }
  if (license.status === LicenseStatus.SUSPENDED) {
    return LicenseVerdict.SUSPENDED;
  }
  if (license.status === LicenseStatus.EXPIRED || !license.isWithinDates(on)) {
    return LicenseVerdict.EXPIRED;
  }
  return LicenseVerdict.LICENSED;
}

/**
 * Which verdict to believe when an organization holds several licences for one
 * activity. Higher wins. REVOKED sits above the merely lapsed because it is a
 * standing decision about the business, not a date that passed - a revoked
 * licence is not cured by an older expired one sitting next to it.
 */
export function rank(verdict: LicenseVerdict): number {
  switch (verdict) {
    case LicenseVerdict.LICENSED:
      return 4;
    case LicenseVerdict.REVOKED:
      return 3;
    case LicenseVerdict.SUSPENDED:
      return 2;
    case LicenseVerdict.EXPIRED:
      return 1;
    default:
      return 0;
  }
}

/**
 * The licences that actually bear on a question, after the facility rule (D1).
 *
 * > For an activity at a facility, the governing licence is the facility-scoped
 * > licence for that (activity, facility) if one exists in a decided state;
 * > otherwise the organization-scoped licence for that activity. A
 * > facility-scoped licence, once it exists, **replaces** the organization-wide
 * > one for that site — it does not merely add to it.
 *
 * Replacement, not addition, is what gives a site suspension any force. Without
 * it, suspending Huye would change nothing: the company-wide manufacturing
 * licence would still pass and the plant would carry on producing. It cuts the
 * other way too, and that was accepted when D1 was signed — once a site holds
 * its own licence it stops inheriting the organization's, so a lapsed site
 * licence stops that site while the company remains licensed nationally.
 *
 * Asking without naming a facility is an organization-level question, and only
 * organization-grained licences answer it. A Kigali-only licence does not make
 * the company licensed to manufacture in general.
 */
export function governingPool(
  candidates: License[],
  activity: LicensedActivity,
  facilityId: number | null,
): License[] {
  const forActivity = candidates.filter(
    (license) =>
      license.category?.activity === activity && belongsToItsOwner(license),
  );

  const organizationWide = forActivity.filter(
    (license) => grainOf(license) === 'ORGANIZATION',
  );

  if (facilityId === null || facilityId === undefined) {
    return organizationWide;
  }

  const siteScoped = forActivity.filter(
    (license) => license.facilityId === facilityId,
  );
  return siteScoped.length > 0 ? siteScoped : organizationWide;
}

/**
 * A licence whose site belongs to a different business is not evidence about
 * either of them. It cannot be produced by any route in the application, and
 * the foreign key cannot express the constraint, so it is filtered here rather
 * than trusted away.
 */
function belongsToItsOwner(license: License): boolean {
  if (!license.facility) {
    return true;
  }
  return license.facility.organizationId === license.organization?.id;
}

/**
 * The single answer to "which licence governs this?".
 *
 * Both callers that used to answer it separately now come through here.
 * `assess()` ranked by verdict over a date-ordered query; `effectiveLicense()`
 * returned the first row Postgres happened to hand back, with no ordering and
 * no ranking at all. That was invisible while every business held one licence
 * and would have become a non-deterministic regulatory verdict the moment a
 * company held a national licence and a site licence at once.
 */
export async function resolveGoverning(
  licenses: Repository<License>,
  organizationId: number,
  activity: LicensedActivity,
  facilityId: number | null = null,
  on: string = today(),
): Promise<Assessment> {
  const candidates = await licenses.find({
    where: {
      organization: { id: organizationId },
      status: In([...DECIDED_STATUSES]),
    },
    order: { expiresOn: 'DESC', id: 'DESC' },
  });

  return best(governingPool(candidates, activity, facilityId), on);
}

/** The strongest verdict in a pool, and the licence that carries it. */
export function best(pool: License[], on: string): Assessment {
  let winner: Assessment = { verdict: LicenseVerdict.NONE, license: null };

  for (const license of pool) {
    const verdict = judge(license, on);
    if (rank(verdict) > rank(winner.verdict)) {
      winner = { verdict, license };
    }
  }

  return winner;
}

/** Verdicts under which a licence still authorises day-to-day operation. */
export function permitsOperation(verdict: LicenseVerdict): boolean {
  return (
    verdict === LicenseVerdict.LICENSED || verdict === LicenseVerdict.SUSPENDED
  );
}
