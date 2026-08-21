import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../auth/user-role.enum';
import { TraceabilityRuleException } from '../../common/errors';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { ComplianceFinding } from '../entities/compliance-finding.entity';
import { Assessment, resolveGoverning } from '../governing-licence';
import { License } from '../entities/license.entity';
import {
  EnforcementMode,
  LicensedActivity,
  LicenseVerdict,
  findingFor,
} from '../licensing.enums';

export type { Assessment } from '../governing-licence';

/**
 * The relationship between holding a licence and acting in the supply chain.
 *
 * The technical proposal describes supervision rather than gatekeeping. Section
 * 1 lists "compliance status" and "automated license expiry notifications";
 * section 10 puts "license status", "expired licenses" and "unregistered
 * products" on the regulator's dashboard. Searched end to end, the document
 * never asks for an unlicensed business to be blocked - it asks for the
 * regulator to be able to see that it is unlicensed and act.
 *
 * So the default is ADVISORY: the operation proceeds, a ComplianceFinding is
 * recorded against the organization, and the holder is told. A regulator sees
 * the finding and can suspend or revoke, which is the lever the document
 * actually describes.
 *
 * Two things are never advisory:
 *
 *   - REVOKED is refused in every mode. It is terminal, and the whole point of
 *     revoking is that the business stops.
 *   - Safety actions are never gated at all. A suspended manufacturer must
 *     still be able to take returns and recall its own batches; those are the
 *     actions you most want available from a business that has just been found
 *     to have a problem. Callers simply do not consult this service for them.
 */
@Injectable()
export class LicenseEnforcementService {
  private readonly logger = new Logger(LicenseEnforcementService.name);
  private readonly mode: EnforcementMode;

  constructor(
    @InjectRepository(License)
    private readonly licenses: Repository<License>,
    @InjectRepository(ComplianceFinding)
    private readonly findings: Repository<ComplianceFinding>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly notifications: NotificationsService,
    config: ConfigService,
  ) {
    this.mode = toMode(config.get<string>('licensing.enforcement'));
  }

  /**
   * Judges an organization against the activity its own type requires, then
   * applies the configured mode. Returns the assessment so a caller can report
   * it; throws only where the door is genuinely closed.
   */
  async checkOwnTrade(
    organization: Organization,
    action: string,
    actor?: User | null,
  ): Promise<Assessment> {
    const activity = this.requiredActivityFor(organization.type);
    if (!activity) {
      return { verdict: LicenseVerdict.LICENSED, license: null };
    }
    return this.check(organization, activity, action, actor);
  }

  async check(
    organization: Organization,
    activity: LicensedActivity,
    action: string,
    actor?: User | null,
  ): Promise<Assessment> {
    if (this.mode === EnforcementMode.OFF) {
      return { verdict: LicenseVerdict.LICENSED, license: null };
    }

    const assessment = await this.assess(organization.id, activity);
    if (assessment.verdict === LicenseVerdict.LICENSED) {
      return assessment;
    }

    // Terminal in every mode.
    if (assessment.verdict === LicenseVerdict.REVOKED) {
      throw new TraceabilityRuleException(
        `${organization.name} cannot ${action}: licence ` +
          `${assessment.license?.licenseNumber ?? ''} has been revoked.`.trim(),
      );
    }

    // Recorded before any refusal, so a strict deployment still leaves the
    // regulator the same evidence trail an advisory one does.
    await this.recordFinding(organization, activity, action, assessment, actor);
    await this.notifyHolder(organization, action, assessment);

    if (this.mode === EnforcementMode.STRICT) {
      throw new TraceabilityRuleException(this.refusal(organization, action, assessment));
    }

    return assessment;
  }

  /**
   * The licence an organization is relying on for an activity, and what state
   * it is really in. Expiry is evaluated against today's date rather than
   * trusted from the stored status, so a licence that lapsed overnight is
   * judged lapsed before any sweep has run.
   *
   * Where several licences exist for one activity the best one wins: an active
   * licence outranks a suspended one, which outranks an expired one. A
   * business that renewed after a suspension should be judged on the renewal.
   *
   * `facilityId` narrows the question to one site. Naming a site brings the
   * replacement rule into play (D1); leaving it out asks about the business as
   * a whole. The rule itself lives in `governing-licence.ts` and is shared with
   * `LicenseService.effectiveLicense`, which used to answer the same question a
   * different way.
   */
  async assess(
    organizationId: number,
    activity: LicensedActivity,
    facilityId: number | null = null,
  ): Promise<Assessment> {
    return resolveGoverning(this.licenses, organizationId, activity, facilityId);
  }

  /**
   * The activity an organization's own type needs to be licensed for.
   * Consumers never hold accounts, so they are not represented here.
   */
  requiredActivityFor(type: OrganizationType): LicensedActivity | null {
    switch (type) {
      case OrganizationType.MANUFACTURER:
        return LicensedActivity.MANUFACTURING;
      case OrganizationType.WAREHOUSE:
        return LicensedActivity.WAREHOUSING;
      case OrganizationType.DISTRIBUTOR:
        return LicensedActivity.DISTRIBUTION;
      case OrganizationType.RETAILER:
      case OrganizationType.SHOP:
        return LicensedActivity.RETAIL;
      case OrganizationType.REGULATOR:
        return LicensedActivity.REGULATION;
      default:
        return null;
    }
  }

  /** Findings against one organization, newest first. */
  async findingsFor(organizationId: number, limit = 100): Promise<ComplianceFinding[]> {
    return this.findings.find({
      where: { organization: { id: organizationId } },
      relations: { license: true },
      order: { recordedAt: 'DESC', id: 'DESC' },
      take: limit,
    });
  }

  /** Every recent finding, for the regulator's compliance panel. */
  async recentFindings(limit = 200): Promise<ComplianceFinding[]> {
    return this.findings.find({
      relations: { license: true },
      order: { recordedAt: 'DESC', id: 'DESC' },
      take: limit,
    });
  }

  /** Which mode is in force, for the dashboard to report honestly. */
  enforcementMode(): EnforcementMode {
    return this.mode;
  }

  // ---------------------------------------------------------------- private

  private async recordFinding(
    organization: Organization,
    activity: LicensedActivity,
    action: string,
    assessment: Assessment,
    actor?: User | null,
  ): Promise<void> {
    const type = findingFor(assessment.verdict);
    if (!type) {
      return;
    }

    await this.findings.save(
      this.findings.create({
        organization,
        type,
        activity,
        action,
        license: assessment.license,
        actor: actor ?? null,
        detail: this.refusal(organization, action, assessment),
      }),
    );
  }

  /**
   * Tells the business, not just the regulator. Section 1 asks for automated
   * notifications, and a finding nobody sees cannot be corrected.
   *
   * Notification failure never fails the operation it describes - the stock
   * movement is the fact, this is the letter about it.
   */
  private async notifyHolder(
    organization: Organization,
    action: string,
    assessment: Assessment,
  ): Promise<void> {
    try {
      const admins = await this.users.find({
        where: {
          organization: { id: organization.id },
          role: In([UserRole.ORG_ADMIN, UserRole.MANAGEMENT]),
        },
      });

      for (const admin of admins) {
        await this.notifications.create({
          userId: admin.id,
          type: NotificationType.WARNING,
          title: 'Licence attention needed',
          message: this.refusal(organization, action, assessment),
          module: 'licensing',
          actionUrl: '/licenses',
        });
      }
    } catch (error) {
      this.logger.warn(
        `Could not notify ${organization.name} about a licence finding: ${
          (error as Error).message
        }`,
      );
    }
  }

  /** One sentence an operator can act on, used for both finding and notice. */
  private refusal(
    organization: Organization,
    action: string,
    assessment: Assessment,
  ): string {
    switch (assessment.verdict) {
      case LicenseVerdict.SUSPENDED:
        return (
          `${organization.name} is recorded as "${action}" while licence ` +
          `${assessment.license?.licenseNumber} is suspended` +
          (assessment.license?.statusReason
            ? ` - ${assessment.license.statusReason}`
            : '') +
          '. Returns and recalls remain available.'
        );
      case LicenseVerdict.EXPIRED:
        return (
          `${organization.name} is recorded as "${action}" while licence ` +
          `${assessment.license?.licenseNumber} has lapsed` +
          (assessment.license?.expiresOn
            ? ` (expired ${assessment.license.expiresOn})` : '') +
          '. Renew it from your dashboard.'
        );
      default:
        return (
          `${organization.name} is recorded as "${action}" with no active ` +
          'licence for this activity. Apply from your dashboard.'
        );
    }
  }
}

function toMode(raw: string | undefined): EnforcementMode {
  switch ((raw ?? '').toLowerCase()) {
    case EnforcementMode.OFF:
      return EnforcementMode.OFF;
    case EnforcementMode.STRICT:
      return EnforcementMode.STRICT;
    default:
      return EnforcementMode.ADVISORY;
  }
}
