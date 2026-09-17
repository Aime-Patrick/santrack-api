import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../auth/user-role.enum';
import { NotFoundEntityException, TraceabilityRuleException } from '../../common/errors';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { NotificationsGateway } from '../../notifications/gateways/notifications.gateway';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { today } from '../../item/entities/traceable-item.entity';
import {
  GrantRegulatoryOversightDto,
  NudgeSupervisedAuthorityDto,
  OversightLicenceOverrideAction,
  OverrideSupervisedLicenceDto,
  PullUpSupervisedCaseDto,
} from '../dto/regulatory-oversight.dto';
import { License } from '../entities/license.entity';
import { RegulatoryAuthority } from '../entities/regulatory-authority.entity';
import {
  RegulatoryCase,
  RegulatoryCaseEvent,
  RegulatoryCaseEventType,
  RegulatoryCaseReferral,
  RegulatoryCaseReferralStatus,
  RegulatoryCaseStatus,
} from '../entities/regulatory-case.entity';
import {
  RegulatoryOversightMode,
  RegulatoryOversightScope,
} from '../entities/regulatory-oversight.entity';
import { LicenseStatus } from '../licensing.enums';
import { LicenseService } from './license.service';
import { RegulatoryAuthorityService } from './regulatory-authority.service';

@Injectable()
export class RegulatoryOversightService {
  constructor(
    @InjectRepository(RegulatoryOversightScope)
    private readonly scopes: Repository<RegulatoryOversightScope>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(RegulatoryAuthority)
    private readonly authorities: Repository<RegulatoryAuthority>,
    @InjectRepository(RegulatoryCase)
    private readonly cases: Repository<RegulatoryCase>,
    @InjectRepository(RegulatoryCaseEvent)
    private readonly caseEvents: Repository<RegulatoryCaseEvent>,
    @InjectRepository(RegulatoryCaseReferral)
    private readonly referrals: Repository<RegulatoryCaseReferral>,
    @InjectRepository(License)
    private readonly licenses: Repository<License>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly notifications: NotificationsGateway,
    private readonly licenseService: LicenseService,
    private readonly authorityService: RegulatoryAuthorityService,
  ) {}

  async grant(dto: GrantRegulatoryOversightDto) {
    const mode = dto.mode ?? RegulatoryOversightMode.OBSERVE;
    const [organization, authority] = await Promise.all([
      this.organizations.findOne({ where: { id: dto.oversightOrganizationId } }),
      // Inactive desks allowed so platform can stage a subordinate for overseer activation.
      this.authorities.findOne({
        where: { id: dto.authorityId },
        relations: { operatingOrganization: true },
      }),
    ]);
    if (!organization) throw new NotFoundEntityException('Organization', dto.oversightOrganizationId);
    if (organization.type !== OrganizationType.REGULATOR) {
      throw new TraceabilityRuleException('An oversight body must be a regulator organization');
    }
    if (!authority) throw new NotFoundEntityException('RegulatoryAuthority', dto.authorityId);
    if (authority.operatingOrganization?.id === organization.id) {
      throw new TraceabilityRuleException(
        'A regulator cannot be granted oversight over its own authority desk',
      );
    }

    const existing = await this.scopes.findOne({
      where: {
        oversightOrganization: { id: organization.id },
        authority: { id: authority.id },
      },
    });
    if (existing) {
      existing.mode = mode;
      return this.scopes.save(existing);
    }
    return this.scopes.save(
      this.scopes.create({
        oversightOrganization: organization,
        authority,
        mode,
      }),
    );
  }

  async setMode(id: number, mode: RegulatoryOversightMode) {
    const scope = await this.scopes.findOne({ where: { id } });
    if (!scope) throw new NotFoundEntityException('RegulatoryOversightScope', id);
    scope.mode = mode;
    return this.scopes.save(scope);
  }

  list() {
    return this.scopes.find({ order: { createdAt: 'ASC' } });
  }

  async revoke(id: number) {
    const scope = await this.scopes.findOne({ where: { id } });
    if (!scope) throw new NotFoundEntityException('RegulatoryOversightScope', id);
    await this.scopes.remove(scope);
  }

  async summary(organization: Organization) {
    const scopes = await this.scopes.find({
      where: { oversightOrganization: { id: organization.id } },
      relations: { authority: true },
    });
    if (scopes.length === 0) {
      throw new TraceabilityRuleException('This organization has no configured oversight scope');
    }
    const authorityIds = scopes.map((scope) => scope.authority.id);
    const closed = [RegulatoryCaseStatus.CLOSED, RegulatoryCaseStatus.RESOLVED];
    const authorities = await Promise.all(
      scopes.map(async (scope) => {
        const id = scope.authority.id;
        const [open, overdue, unassigned, resolved] = await Promise.all([
          this.cases.count({ where: { leadAuthority: { id }, status: Not(In(closed)) } }),
          this.cases.count({
            where: {
              leadAuthority: { id },
              status: Not(In(closed)),
              dueOn: LessThan(today()) as unknown as string,
            },
          }),
          this.cases.count({
            where: { leadAuthority: { id }, status: Not(In(closed)), assignedTo: IsNull() },
          }),
          this.cases.count({
            where: { leadAuthority: { id }, status: RegulatoryCaseStatus.RESOLVED },
          }),
        ]);
        const pendingReferrals = await this.referrals.find({
          where: { toAuthority: { id }, status: RegulatoryCaseReferralStatus.PENDING },
        });
        const target = scope.authority.referralResponseDays;
        const overdueReferrals =
          target === null
            ? 0
            : pendingReferrals.filter(
                (referral) =>
                  referral.referredAt.getTime() + target * 86_400_000 < Date.now(),
              ).length;
        return {
          authority: {
            id,
            code: scope.authority.code,
            name: scope.authority.name,
            isActive: scope.authority.isActive,
          },
          mode: scope.mode,
          open,
          overdue,
          unassigned,
          resolved,
          overdueReferrals,
        };
      }),
    );
    const [pendingReferrals, acceptedReferrals, declinedReferrals] = await Promise.all([
      this.referrals.count({
        where: { toAuthority: { id: In(authorityIds) }, status: RegulatoryCaseReferralStatus.PENDING },
      }),
      this.referrals.count({
        where: { toAuthority: { id: In(authorityIds) }, status: RegulatoryCaseReferralStatus.ACCEPTED },
      }),
      this.referrals.count({
        where: { toAuthority: { id: In(authorityIds) }, status: RegulatoryCaseReferralStatus.REJECTED },
      }),
    ]);
    return {
      authorities,
      referrals: {
        pending: pendingReferrals,
        accepted: acceptedReferrals,
        declined: declinedReferrals,
      },
      canSupervise: scopes.some((scope) => scope.mode === RegulatoryOversightMode.SUPERVISE),
    };
  }

  async supervisedCases(organization: Organization, authorityId?: number) {
    const scopes = await this.superviseScopes(organization);
    const allowedIds = scopes.map((scope) => scope.authority.id);
    if (authorityId != null && !allowedIds.includes(authorityId)) {
      throw new TraceabilityRuleException(
        'That authority is not in your supervise scope',
      );
    }
    const ids = authorityId != null ? [authorityId] : allowedIds;
    const closed = [RegulatoryCaseStatus.CLOSED, RegulatoryCaseStatus.RESOLVED];
    const rows = await this.cases.find({
      where: {
        leadAuthority: { id: In(ids) },
        status: Not(In(closed)),
      },
      order: { dueOn: 'ASC', openedAt: 'DESC' },
      take: 200,
      relations: {
        organization: true,
        leadAuthority: true,
        assignedTo: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      caseNumber: row.caseNumber,
      title: row.title,
      status: row.status,
      priority: row.priority,
      dueOn: row.dueOn,
      assignedTeam: row.assignedTeam,
      assignedTo: row.assignedTo
        ? { id: row.assignedTo.id, name: row.assignedTo.fullName ?? row.assignedTo.email }
        : null,
      organization: { id: row.organization.id, name: row.organization.name },
      leadAuthority: row.leadAuthority
        ? { id: row.leadAuthority.id, code: row.leadAuthority.code, name: row.leadAuthority.name }
        : null,
      overdue: !!row.dueOn && row.dueOn < today(),
    }));
  }

  /**
   * Licences issued by supervised authority operating orgs — for override review.
   */
  async supervisedLicences(organization: Organization) {
    const scopes = await this.superviseScopes(organization);
    const issuerIds = scopes
      .map((scope) => scope.authority.operatingOrganization?.id)
      .filter((id): id is number => typeof id === 'number');
    if (issuerIds.length === 0) return [];

    const rows = await this.licenses.find({
      where: {
        issuedBy: { id: In(issuerIds) },
        status: In([
          LicenseStatus.ACTIVE,
          LicenseStatus.SUSPENDED,
          LicenseStatus.EXPIRED,
        ]),
      },
      order: { updatedAt: 'DESC' },
      take: 100,
      relations: { organization: true, issuedBy: true, category: true },
    });

    return rows.map((row) => ({
      id: row.id,
      licenseNumber: row.licenseNumber,
      status: row.status,
      organization: { id: row.organization.id, name: row.organization.name },
      issuedBy: row.issuedBy
        ? { id: row.issuedBy.id, name: row.issuedBy.name }
        : null,
      category: row.category
        ? { id: row.category.id, name: row.category.name, code: row.category.code }
        : null,
    }));
  }

  /**
   * Pending applications whose applicant sector matches a supervised
   * authority's mandate — the overseer's decide-scope view.
   */
  async supervisedPendingLicences(organization: Organization) {
    const scopes = await this.superviseScopes(organization);
    const mandates = [
      ...new Set(
        scopes.flatMap((scope) =>
          (scope.authority.mandates ?? []).map((m) => m.trim()).filter(Boolean),
        ),
      ),
    ];
    if (mandates.length === 0) return [];

    const rows = await this.licenses
      .createQueryBuilder('license')
      .leftJoinAndSelect('license.organization', 'organization')
      .leftJoinAndSelect('license.category', 'category')
      .where('license.status IN (:...statuses)', {
        statuses: [LicenseStatus.SUBMITTED, LicenseStatus.UNDER_REVIEW],
      })
      .andWhere(
        '(organization.industry_sector IN (:...mandates) OR organization.industry_sector IS NULL)',
        { mandates },
      )
      .orderBy('license.createdAt', 'ASC')
      .take(100)
      .getMany();

    return rows.map((row) => ({
      id: row.id,
      licenseNumber: row.licenseNumber,
      status: row.status,
      organization: {
        id: row.organization.id,
        name: row.organization.name,
        industrySector: row.organization.industrySector ?? null,
      },
      category: row.category
        ? { id: row.category.id, name: row.category.name, code: row.category.code }
        : null,
      createdAt: row.createdAt,
    }));
  }

  async overrideLicence(
    organization: Organization,
    actor: User,
    licenseId: number,
    dto: OverrideSupervisedLicenceDto,
  ) {
    const scopes = await this.superviseScopes(organization);
    const license = await this.licenses.findOne({
      where: { id: licenseId },
      relations: { issuedBy: true },
    });
    if (!license) throw new NotFoundEntityException('License', licenseId);
    const issuerId = license.issuedBy?.id;
    const allowed = scopes.some(
      (scope) => scope.authority.operatingOrganization?.id === issuerId,
    );
    if (!allowed) {
      throw new TraceabilityRuleException(
        'That licence was not issued by an authority you supervise',
      );
    }

    const reason = `[Oversight ${organization.name}] ${dto.reason.trim()}`;
    if (dto.action === OversightLicenceOverrideAction.SUSPEND) {
      return this.licenseService.suspend(organization, actor, licenseId, reason);
    }
    if (dto.action === OversightLicenceOverrideAction.REVOKE) {
      return this.licenseService.revoke(organization, actor, licenseId, reason);
    }
    return this.licenseService.reinstate(organization, actor, licenseId, reason);
  }

  /**
   * Pull a supervised case onto the overseer's own desk and mark ESCALATED.
   */
  async pullUpCase(
    organization: Organization,
    actor: User,
    caseId: number,
    dto: PullUpSupervisedCaseDto,
  ) {
    const scopes = await this.superviseScopes(organization);
    const overseerDesk = await this.authorityService.forOperator(organization);
    const caseRecord = await this.cases.findOne({
      where: { id: caseId },
      relations: {
        leadAuthority: { operatingOrganization: true },
        organization: true,
      },
    });
    if (!caseRecord) throw new NotFoundEntityException('RegulatoryCase', caseId);
    const leadId = caseRecord.leadAuthority?.id;
    if (!leadId || !scopes.some((scope) => scope.authority.id === leadId)) {
      throw new TraceabilityRuleException(
        'That case is not led by an authority you supervise',
      );
    }
    if (leadId === overseerDesk.id) {
      throw new TraceabilityRuleException('That case is already on your desk');
    }
    if (
      caseRecord.status === RegulatoryCaseStatus.CLOSED ||
      caseRecord.status === RegulatoryCaseStatus.RESOLVED
    ) {
      throw new TraceabilityRuleException('A closed or resolved case cannot be pulled up');
    }

    const previous = caseRecord.leadAuthority;
    caseRecord.leadAuthority = overseerDesk;
    caseRecord.assignedTo = null;
    caseRecord.assignedTeam = null;
    caseRecord.assignedTeamRef = null;
    caseRecord.status = RegulatoryCaseStatus.ESCALATED;
    const saved = await this.cases.save(caseRecord);

    await this.caseEvents.save(
      this.caseEvents.create({
        case: saved,
        actor,
        type: RegulatoryCaseEventType.STATUS_CHANGED,
        summary: `Pulled up to ${overseerDesk.name} by oversight`,
        detail: {
          oversightPullUp: true,
          fromAuthorityId: previous?.id ?? null,
          toAuthorityId: overseerDesk.id,
          reason: dto.reason.trim(),
          status: RegulatoryCaseStatus.ESCALATED,
        },
      }),
    );

    if (previous) {
      await this.notifyAuthorityAdmins(previous, {
        type: NotificationType.WARNING,
        title: `Case pulled up — ${saved.caseNumber ?? `case #${saved.id}`}`,
        message: `${organization.name} took “${saved.title}” onto their desk: ${dto.reason.trim()}`,
        module: 'regulator',
        actionUrl: `/dashboard/regulator?tab=enforcement`,
      });
    }

    return {
      id: saved.id,
      caseNumber: saved.caseNumber,
      status: saved.status,
      leadAuthority: { id: overseerDesk.id, name: overseerDesk.name, code: overseerDesk.code },
    };
  }

  /**
   * Authorize (activate) a subordinate desk that platform staged as inactive
   * under this overseer's SUPERVISE scope.
   */
  async activateAuthority(organization: Organization, authorityId: number) {
    const scopes = await this.superviseScopes(organization);
    const scope = scopes.find((row) => row.authority.id === authorityId);
    if (!scope) {
      throw new TraceabilityRuleException(
        'That authority is not in your supervise scope',
      );
    }
    const authority = await this.authorities.findOne({
      where: { id: authorityId },
      relations: { operatingOrganization: true },
    });
    if (!authority) throw new NotFoundEntityException('RegulatoryAuthority', authorityId);
    if (authority.isActive) {
      throw new TraceabilityRuleException('That authority is already active');
    }
    authority.isActive = true;
    const saved = await this.authorities.save(authority);
    await this.notifyAuthorityAdmins(saved, {
      type: NotificationType.SUCCESS,
      title: `Authority activated — ${saved.name}`,
      message: `${organization.name} authorized your regulatory desk. You can begin casework and licensing.`,
      module: 'regulator',
      actionUrl: '/dashboard',
    });
    return {
      id: saved.id,
      code: saved.code,
      name: saved.name,
      isActive: saved.isActive,
    };
  }

  async nudgeAuthority(
    organization: Organization,
    authorityId: number,
    dto: NudgeSupervisedAuthorityDto,
  ) {
    const scopes = await this.superviseScopes(organization);
    const scope = scopes.find((row) => row.authority.id === authorityId);
    if (!scope) {
      throw new TraceabilityRuleException(
        'That authority is not in your supervise scope',
      );
    }
    const authority = await this.authorities.findOne({
      where: { id: authorityId },
      relations: { operatingOrganization: true },
    });
    if (!authority?.operatingOrganization) {
      throw new TraceabilityRuleException(
        'That authority has no operating organization to notify',
      );
    }
    const note = dto.note?.trim();
    const title = `Oversight follow-up — ${authority.name}`;
    const message = note
      ? `${organization.name} requested attention on your case queue: ${note}`
      : `${organization.name} requested attention on your open / overdue case queue. Review assignments and deadlines.`;
    const notified = await this.notifyAuthorityAdmins(authority, {
      type: NotificationType.WARNING,
      title,
      message,
      module: 'regulator',
      actionUrl: '/dashboard/regulator?tab=enforcement',
    });
    return {
      authorityId,
      notified,
      mode: scope.mode,
    };
  }

  private async notifyAuthorityAdmins(
    authority: RegulatoryAuthority,
    payload: {
      type: NotificationType;
      title: string;
      message: string;
      module: string;
      actionUrl: string;
    },
  ): Promise<number> {
    const orgId = authority.operatingOrganization?.id;
    if (!orgId) return 0;
    const staff = await this.users.find({
      where: [
        { organization: { id: orgId }, role: UserRole.ORG_ADMIN },
        { organization: { id: orgId }, role: UserRole.MANAGEMENT },
      ],
    });
    await Promise.allSettled(
      staff.map((user) => this.notifications.sendToUser(user.id, payload)),
    );
    return staff.length;
  }

  private async superviseScopes(organization: Organization) {
    const scopes = await this.scopes.find({
      where: {
        oversightOrganization: { id: organization.id },
        mode: RegulatoryOversightMode.SUPERVISE,
      },
      relations: { authority: { operatingOrganization: true } },
    });
    if (scopes.length === 0) {
      throw new TraceabilityRuleException(
        'Your organization has no supervise-level oversight scopes',
      );
    }
    return scopes;
  }
}
