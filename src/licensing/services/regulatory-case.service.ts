import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../auth/user-role.enum';
import { Batch } from '../../batch/entities/batch.entity';
import { NotFoundEntityException, TraceabilityRuleException } from '../../common/errors';
import { EmailService } from '../../email/email.service';
import { Facility } from '../../organization/entities/facility.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { NotificationsGateway } from '../../notifications/gateways/notifications.gateway';
import { STORAGE_PROVIDER, StorageProvider } from '../../storage/storage.provider';
import { OpenRegulatoryCaseDto } from '../dto/regulatory-case.dto';
import { ComplianceFinding } from '../entities/compliance-finding.entity';
import { License } from '../entities/license.entity';
import {
  RegulatoryCase,
  RegulatoryCaseEvent,
  RegulatoryCaseEventType,
  RegulatoryCaseEvidence,
  RegulatoryCasePriority,
  RegulatoryCaseStatus,
  RegulatoryCaseReferral,
  RegulatoryCaseReferralStatus,
} from '../entities/regulatory-case.entity';
import { RegulatoryAuthority } from '../entities/regulatory-authority.entity';
import { RegulatoryAuthorityService } from './regulatory-authority.service';
import { RegulatoryTeamService } from './regulatory-team.service';
import { ReferRegulatoryCaseDto } from '../dto/regulatory-case.dto';
import { UploadedFile } from './license.service';

const EVIDENCE_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

@Injectable()
export class RegulatoryCaseService {
  private readonly logger = new Logger(RegulatoryCaseService.name);

  constructor(
    @InjectRepository(RegulatoryCase)
    private readonly cases: Repository<RegulatoryCase>,
    @InjectRepository(RegulatoryCaseEvent)
    private readonly events: Repository<RegulatoryCaseEvent>,
    @InjectRepository(RegulatoryCaseEvidence)
    private readonly evidence: Repository<RegulatoryCaseEvidence>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(Facility)
    private readonly facilities: Repository<Facility>,
    @InjectRepository(License)
    private readonly licenses: Repository<License>,
    @InjectRepository(ComplianceFinding)
    private readonly findings: Repository<ComplianceFinding>,
    @InjectRepository(Batch)
    private readonly batches: Repository<Batch>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(RegulatoryAuthority)
    private readonly authorities: Repository<RegulatoryAuthority>,
    @InjectRepository(RegulatoryCaseReferral)
    private readonly referrals: Repository<RegulatoryCaseReferral>,
    private readonly authorityService: RegulatoryAuthorityService,
    private readonly teamService: RegulatoryTeamService,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider,
    private readonly notifications: NotificationsGateway,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async listForAuthority(
    authority: RegulatoryAuthority,
    status?: RegulatoryCaseStatus,
    assignedToId?: number,
    scope?: 'all' | 'mine' | 'team',
    actorId?: number,
  ) {
    const where: Record<string, unknown> = {
      leadAuthority: { id: authority.id },
      ...(status ? { status } : {}),
      ...(assignedToId ? { assignedTo: { id: assignedToId } } : {}),
    };

    if (scope === 'mine' && actorId) {
      where.assignedTo = { id: actorId };
    }

    let rows = await this.cases.find({
      where,
      relations: { assignedTeamRef: true },
      order: { openedAt: 'DESC' },
      take: 200,
    });

    if (scope === 'team' && actorId) {
      const [teamIds, teamNames] = await Promise.all([
        this.teamService.teamIdsForUser(authority.id, actorId),
        this.teamService.teamNamesForUser(authority.id, actorId),
      ]);
      rows = rows.filter(
        (row) =>
          row.assignedTo?.id === actorId ||
          (row.assignedTeamRef?.id != null && teamIds.includes(row.assignedTeamRef.id)) ||
          (row.assignedTeam != null && teamNames.includes(row.assignedTeam)),
      );
    }

    return rows;
  }

  async officers(regulator: Organization): Promise<User[]> {
    return this.users.find({
      where: { organization: { id: regulator.id } },
      order: { fullName: 'ASC', email: 'ASC' },
    });
  }

  async one(id: number): Promise<RegulatoryCase> {
    const caseRecord = await this.cases.findOne({
      where: { id },
      relations: { assignedTeamRef: true },
    });
    if (!caseRecord) throw new NotFoundEntityException('RegulatoryCase', id);
    return caseRecord;
  }

  async oneForAuthority(id: number, authority: RegulatoryAuthority): Promise<RegulatoryCase> {
    const caseRecord = await this.cases.findOne({
      where: { id, leadAuthority: { id: authority.id } },
      relations: { assignedTeamRef: true },
    });
    if (!caseRecord) throw new NotFoundEntityException('RegulatoryCase', id);
    return caseRecord;
  }

  /** The cases opened against one business — the subject of the case. */
  async listForOrganization(organization: Organization, status?: RegulatoryCaseStatus) {
    return this.cases.find({
      where: {
        organization: { id: organization.id },
        ...(status ? { status } : {}),
      },
      order: { openedAt: 'DESC' },
      take: 200,
    });
  }

  /** A single case, but only when the caller is the business it is opened against. */
  async oneForOrganization(id: number, organization: Organization): Promise<RegulatoryCase> {
    const caseRecord = await this.cases.findOne({ where: { id, organization: { id: organization.id } } });
    if (!caseRecord) throw new NotFoundEntityException('RegulatoryCase', id);
    return caseRecord;
  }

  async history(id: number): Promise<RegulatoryCaseEvent[]> {
    await this.one(id);
    return this.events.find({ where: { case: { id } }, order: { recordedAt: 'ASC' } });
  }

  async evidenceForCase(id: number): Promise<RegulatoryCaseEvidence[]> {
    await this.one(id);
    return this.evidence.find({ where: { case: { id } }, order: { submittedAt: 'ASC' } });
  }

  async submitEvidence(
    organization: Organization,
    actor: User,
    caseId: number,
    note: string | undefined,
    file: UploadedFile,
  ): Promise<RegulatoryCaseEvidence> {
    if (!EVIDENCE_CONTENT_TYPES.includes(file.mimetype)) {
      throw new TraceabilityRuleException('Upload a PDF or an image as corrective-action evidence');
    }
    if (file.size > MAX_EVIDENCE_BYTES) {
      throw new TraceabilityRuleException(`${file.originalname} is larger than the 10MB evidence limit`);
    }

    const caseRecord = await this.one(caseId);
    if (caseRecord.organization.id !== organization.id) {
      throw new NotFoundEntityException('RegulatoryCase', caseId);
    }
    if (caseRecord.status === RegulatoryCaseStatus.CLOSED) {
      throw new TraceabilityRuleException('A closed case cannot receive new evidence');
    }

    const stored = await this.storage.put({
      folder: `regulatory-cases/${caseRecord.id}/evidence`,
      filename: file.originalname,
      contentType: file.mimetype,
      content: file.buffer,
    });

    try {
      const evidence = await this.cases.manager.transaction(async (manager) => {
        const evidenceRow = await manager.save(manager.create(RegulatoryCaseEvidence, {
          case: caseRecord,
          submittedBy: actor,
          filename: file.originalname,
          contentType: stored.contentType,
          sizeBytes: stored.size,
          storageKey: stored.key,
          note: note?.trim() || null,
        }));
        const previous = caseRecord.status;
        if (caseRecord.status === RegulatoryCaseStatus.AWAITING_BUSINESS) {
          caseRecord.status = RegulatoryCaseStatus.IN_PROGRESS;
          await manager.save(RegulatoryCase, caseRecord);
        }
        await manager.save(manager.create(RegulatoryCaseEvent, {
          case: caseRecord,
          actor,
          type: RegulatoryCaseEventType.EVIDENCE_SUBMITTED,
          summary: `Corrective-action evidence submitted: ${evidenceRow.filename}`,
          detail: { evidenceId: evidenceRow.id, note: evidenceRow.note, fromStatus: previous, toStatus: caseRecord.status },
        }));
        return evidenceRow;
      });
      // The response has landed. Tell the officer so review is a push, not a
      // refresh-the-queue habit. Best-effort: a notification failure must not
      // roll back a stored, committed piece of evidence.
      await this.notifyAssignedRegulator(caseRecord, evidence).catch(() => undefined);
      return evidence;
    } catch (error) {
      await this.storage.delete(stored.key);
      throw error;
    }
  }

  private async notifyBusiness(caseRecord: RegulatoryCase, note?: string) {
    const recipients = await this.users.find({
      where: [
        { organization: { id: caseRecord.organization.id }, role: UserRole.ORG_ADMIN },
        { organization: { id: caseRecord.organization.id }, role: UserRole.MANAGEMENT },
      ],
    });
    const label = caseRecord.caseNumber ?? `case #${caseRecord.id}`;
    for (const recipient of recipients) {
      await this.notifications.sendToUser(recipient.id, {
        type: NotificationType.WARNING,
        title: `Corrective action requested — ${label}`,
        message: `${caseRecord.title}${note ? `: ${note}` : ''}. Open cases to submit corrective-action evidence.`,
        module: 'compliance',
        actionUrl: '/dashboard/compliance/cases',
      });
    }
  }

  private async notifyBusinessDecision(caseRecord: RegulatoryCase, status: RegulatoryCaseStatus, note?: string) {
    const recipients = await this.users.find({
      where: [
        { organization: { id: caseRecord.organization.id }, role: UserRole.ORG_ADMIN },
        { organization: { id: caseRecord.organization.id }, role: UserRole.MANAGEMENT },
      ],
    });
    const label = caseRecord.caseNumber ?? `case #${caseRecord.id}`;
    const outcome = status === RegulatoryCaseStatus.RESOLVED ? 'resolved' : 'closed';
    for (const recipient of recipients) {
      await this.notifications.sendToUser(recipient.id, {
        type: status === RegulatoryCaseStatus.RESOLVED ? NotificationType.SUCCESS : NotificationType.INFO,
        title: `${label} ${outcome}`,
        message: `${caseRecord.title}${note ? `: ${note}` : ''}. Open cases to see the recorded decision.`,
        module: 'compliance',
        actionUrl: '/dashboard/compliance/cases',
      });
    }
  }

  private async notifyAssignedRegulator(caseRecord: RegulatoryCase, evidence: RegulatoryCaseEvidence) {
    const recipients = new Map<number, User>();
    if (caseRecord.assignedTo) recipients.set(caseRecord.assignedTo.id, caseRecord.assignedTo);
    // The authority's operating organization may have more supervisors than
    // the single assigned officer — make sure at least the org admins know a
    // response has landed so the case does not stall on one person's inbox.
    const authorityOrgId = caseRecord.leadAuthority?.operatingOrganization?.id;
    if (authorityOrgId) {
      const supervisors = await this.users.find({
        where: [
          { organization: { id: authorityOrgId }, role: UserRole.ORG_ADMIN },
          { organization: { id: authorityOrgId }, role: UserRole.MANAGEMENT },
        ],
      });
      for (const supervisor of supervisors) recipients.set(supervisor.id, supervisor);
    }
    const label = caseRecord.caseNumber ?? `case #${caseRecord.id}`;
    for (const recipient of recipients.values()) {
      await this.notifications.sendToUser(recipient.id, {
        type: NotificationType.INFO,
        title: `Corrective-action evidence received — ${label}`,
        message: `${caseRecord.organization.name} submitted ${evidence.filename}. Open the case to review and decide.`,
        module: 'regulator',
        actionUrl: `/dashboard/regulator?tab=enforcement&case=${caseRecord.id}`,
      });
    }
  }

  async readEvidenceForOrganization(organization: Organization, caseId: number, evidenceId: number) {
    const evidence = await this.findEvidence(caseId, evidenceId);
    if (evidence.case.organization.id !== organization.id) throw new NotFoundEntityException('RegulatoryCaseEvidence', evidenceId);
    return evidence;
  }

  async readEvidence(caseId: number, evidenceId: number) {
    return this.findEvidence(caseId, evidenceId);
  }

  async evidenceBytes(evidence: RegulatoryCaseEvidence): Promise<Buffer> {
    return this.storage.get(evidence.storageKey);
  }

  async open(actor: User, dto: OpenRegulatoryCaseDto): Promise<RegulatoryCase> {
    if (!actor.organization) throw new TraceabilityRuleException('An operating regulatory authority is required to open a case');
    const leadAuthority = await this.authorityService.forOperator(actor.organization);
    const caseCategory = dto.caseCategory?.trim() || null;
    if (caseCategory && !leadAuthority.caseCategories.includes(caseCategory)) {
      throw new TraceabilityRuleException('Choose a case category configured by your authority');
    }
    const desk = await this.resolveTeam(leadAuthority, dto.assignedTeamId, dto.assignedTeam);
    if (desk) await this.teamService.assertWithinWorkloadCap(desk);
    const organization = await this.organizations.findOne({ where: { id: dto.organizationId } });
    if (!organization) throw new NotFoundEntityException('Organization', dto.organizationId);
    const [facility, license, finding, batch] = await Promise.all([
      dto.facilityId ? this.facilities.findOne({ where: { id: dto.facilityId } }) : null,
      dto.licenseId ? this.licenses.findOne({ where: { id: dto.licenseId } }) : null,
      dto.findingId ? this.findings.findOne({ where: { id: dto.findingId } }) : null,
      dto.batchId ? this.batches.findOne({ where: { id: dto.batchId } }) : null,
    ]);
    if (dto.facilityId && (!facility || facility.organizationId !== organization.id)) {
      throw new TraceabilityRuleException('The facility must belong to the case organization');
    }
    if (dto.licenseId && (!license || license.organization.id !== organization.id)) {
      throw new TraceabilityRuleException('The licence must belong to the case organization');
    }
    if (dto.findingId && (!finding || finding.organization.id !== organization.id)) {
      throw new TraceabilityRuleException('The finding must belong to the case organization');
    }
    if (dto.batchId && (!batch || batch.manufacturer?.id !== organization.id)) {
      throw new TraceabilityRuleException('The batch must belong to the case organization');
    }

    let caseRecord = await this.cases.save(this.cases.create({
      organization,
      leadAuthority,
      caseCategory,
      assignedTeam: desk?.name ?? null,
      assignedTeamRef: desk ?? null,
      facility: facility ?? null,
      license: license ?? null,
      finding: finding ?? null,
      batch: batch ?? null,
      title: dto.title.trim(),
      description: dto.description?.trim() || null,
      priority: dto.priority ?? RegulatoryCasePriority.NORMAL,
      dueOn: dto.dueOn ?? null,
      openedBy: actor,
      caseNumber: null,
    }));
    caseRecord.caseNumber = `RC-${String(caseRecord.id).padStart(6, '0')}`;
    caseRecord = await this.cases.save(caseRecord);
    await this.record(caseRecord, actor, RegulatoryCaseEventType.OPENED, 'Case opened', {
      sourceFindingId: finding?.id ?? null,
      sourceLicenseId: license?.id ?? null,
      priority: caseRecord.priority,
      dueOn: caseRecord.dueOn,
      leadAuthorityId: leadAuthority.id,
      caseCategory,
      assignedTeam: desk?.name ?? null,
      assignedTeamId: desk?.id ?? null,
    });
    this.notifyBusinessOpened(caseRecord).catch(() => undefined);
    return caseRecord;
  }

  async openRecallCase(
    actor: User,
    batch: Batch,
    manager: EntityManager,
  ): Promise<RegulatoryCase> {
    if (!batch.manufacturer) {
      throw new TraceabilityRuleException('A recall case needs a manufacturer to own the affected batch');
    }
    // A business-initiated recall is evidence for regulator triage, not an
    // automatic legal assignment. A regulator-initiated recall stays within
    // that regulator's configured authority.
    const leadAuthority = actor.organization?.type === OrganizationType.REGULATOR
      ? await this.authorityService.forOperator(actor.organization)
      : null;
    let caseRecord = await manager.save(manager.create(RegulatoryCase, {
      organization: batch.manufacturer,
      leadAuthority,
      batch,
      title: `Recall: batch ${batch.batchCode}`,
      description: batch.statusReason,
      priority: RegulatoryCasePriority.HIGH,
      openedBy: actor,
      caseNumber: null,
    }));
    caseRecord.caseNumber = `RC-${String(caseRecord.id).padStart(6, '0')}`;
    caseRecord = await manager.save(RegulatoryCase, caseRecord);
    await manager.save(manager.create(RegulatoryCaseEvent, {
      case: caseRecord,
      actor,
      type: RegulatoryCaseEventType.OPENED,
      summary: 'Recall case opened',
      detail: { batchId: batch.id, reason: batch.statusReason },
    }));
    return caseRecord;
  }

  async assign(id: number, actor: User, authority: RegulatoryAuthority, officerId: number, note?: string) {
    const [caseRecord, officer] = await Promise.all([
      this.oneForAuthority(id, authority), this.users.findOne({ where: { id: officerId } }),
    ]);
    if (!officer) throw new NotFoundEntityException('User', officerId);
    if (officer.organization?.id !== actor.organization?.id) {
      throw new TraceabilityRuleException('Cases may only be assigned to an officer in your regulatory authority');
    }
    await this.assertCanAssign(actor, authority, caseRecord, undefined, officer.id);
    caseRecord.assignedTo = officer;
    if (caseRecord.status === RegulatoryCaseStatus.OPEN) caseRecord.status = RegulatoryCaseStatus.IN_PROGRESS;
    const saved = await this.cases.save(caseRecord);
    await this.record(saved, actor, RegulatoryCaseEventType.ASSIGNED, `Assigned to ${officer.fullName ?? officer.email}`, {
      officerId: officer.id,
      note: note?.trim() || null,
    });
    if (officer.id !== actor.id) {
      const caseLabel = saved.caseNumber ?? `case #${saved.id}`;
      const title = `Assigned to you — ${caseLabel}`;
      const message = `${saved.title}. Open the case to inspect, request evidence, or close it.`;
      const actionUrl = `/dashboard/regulator?tab=enforcement&case=${saved.id}`;
      this.notifications
        .sendToUser(officer.id, {
          type: NotificationType.WARNING,
          title,
          message,
          module: 'regulator',
          actionUrl,
        })
        .catch(() => undefined);
      void this.notifyAssignmentEmail({
        user: officer,
        title,
        message,
        caseLabel,
        organizationName: saved.organization?.name ?? 'Business',
        teamName: null,
        actionUrl,
      });
    }
    return saved;
  }

  async assignTeam(
    id: number,
    actor: User,
    authority: RegulatoryAuthority,
    input: { teamId?: number; team?: string },
  ) {
    const caseRecord = await this.oneForAuthority(id, authority);
    const desk = await this.resolveTeam(authority, input.teamId, input.team);
    if (!desk) {
      throw new TraceabilityRuleException('Choose a team configured by your authority');
    }
    await this.assertCanAssign(actor, authority, caseRecord, desk);
    await this.teamService.assertWithinWorkloadCap(desk);
    caseRecord.assignedTeam = desk.name;
    caseRecord.assignedTeamRef = desk;
    const saved = await this.cases.save(caseRecord);
    await this.record(saved, actor, RegulatoryCaseEventType.ASSIGNED, `Assigned to team ${desk.name}`, {
      team: desk.name,
      teamId: desk.id,
    });

    const recipients = (desk.members ?? [])
      .map((member) => member.user)
      .filter((user) => user?.id && user.id !== actor.id);
    const caseLabel = saved.caseNumber ?? `case #${saved.id}`;
    const title = `Team assignment — ${caseLabel}`;
    const message = `${desk.name}: ${saved.title}. Open the case to pick it up or reassign.`;
    const actionUrl = `/dashboard/regulator?tab=enforcement&case=${saved.id}`;
    await Promise.all(
      recipients.map((user) =>
        this.notifications
          .sendToUser(user.id, {
            type: NotificationType.WARNING,
            title,
            message,
            module: 'regulator',
            actionUrl,
          })
          .catch(() => undefined),
      ),
    );
    for (const user of recipients) {
      void this.notifyAssignmentEmail({
        user,
        title,
        message,
        caseLabel,
        organizationName: saved.organization?.name ?? 'Business',
        teamName: desk.name,
        actionUrl,
      });
    }
    return saved;
  }

  async changeStatus(id: number, actor: User, authority: RegulatoryAuthority, status: RegulatoryCaseStatus, note?: string) {
    const caseRecord = await this.oneForAuthority(id, authority);
    if (caseRecord.status === RegulatoryCaseStatus.CLOSED) {
      throw new TraceabilityRuleException('A closed case cannot be changed; open a new case if further action is needed');
    }
    const previous = caseRecord.status;
    caseRecord.status = status;
    const saved = await this.cases.save(caseRecord);
    await this.record(saved, actor, RegulatoryCaseEventType.STATUS_CHANGED, `Status changed from ${previous} to ${status}`, {
      from: previous,
      to: status,
      note: note?.trim() || null,
    });

    // The regulator just told the business to act (or closed the loop). Make
    // sure the business actually hears it — a corrective-action request that
    // arrives only as a status in a regulator's workspace has not arrived.
    if (status === RegulatoryCaseStatus.AWAITING_BUSINESS) {
      await this.notifyBusiness(saved, note);
    } else if (status === RegulatoryCaseStatus.RESOLVED || status === RegulatoryCaseStatus.CLOSED) {
      await this.notifyBusinessDecision(saved, status, note);
    }
    return saved;
  }

  async refer(id: number, actor: User, fromAuthority: RegulatoryAuthority, dto: ReferRegulatoryCaseDto) {
    const caseRecord = await this.oneForAuthority(id, fromAuthority);
    const toAuthority = await this.authorities.findOne({ where: { id: dto.toAuthorityId, isActive: true } });
    if (!toAuthority) throw new NotFoundEntityException('RegulatoryAuthority', dto.toAuthorityId);
    if (toAuthority.id === fromAuthority.id) throw new TraceabilityRuleException('A case cannot be referred to the same authority');
    const pending = await this.referrals.findOne({ where: { case: { id }, status: RegulatoryCaseReferralStatus.PENDING } });
    if (pending) throw new TraceabilityRuleException('This case already has a pending referral');
    const referral = await this.referrals.save(this.referrals.create({ case: caseRecord, fromAuthority, toAuthority, reason: dto.reason.trim(), referredBy: actor, status: RegulatoryCaseReferralStatus.PENDING, decidedBy: null, decisionNote: null, decidedAt: null }));
    await this.record(caseRecord, actor, RegulatoryCaseEventType.REFERRED, `Referred to ${toAuthority.name}`, { referralId: referral.id, fromAuthorityId: fromAuthority.id, toAuthorityId: toAuthority.id, reason: referral.reason });
    this.notifyAuthorityStaff(toAuthority, {
      type: NotificationType.WARNING,
      title: `Case referred to you — ${caseRecord.caseNumber ?? `case #${caseRecord.id}`}`,
      message: `${fromAuthority.name} referred “${caseRecord.title}”: ${referral.reason}. Accept or decline from incoming referrals.`,
      module: 'regulator',
      actionUrl: '/dashboard/regulator?tab=enforcement',
    }).catch(() => undefined);
    return referral;
  }

  async incomingReferrals(authority: RegulatoryAuthority) {
    const referrals = await this.referrals.find({ where: { toAuthority: { id: authority.id }, status: RegulatoryCaseReferralStatus.PENDING }, order: { referredAt: 'ASC' }, take: 200 });
    const target = authority.referralResponseDays;
    return referrals.map((referral) => ({ referral, overdue: target !== null && referral.referredAt.getTime() + target * 86_400_000 < Date.now() }));
  }

  async referralsForCase(id: number): Promise<RegulatoryCaseReferral[]> {
    await this.one(id);
    return this.referrals.find({ where: { case: { id } }, order: { referredAt: 'ASC' } });
  }

  async decideReferral(id: number, actor: User, authority: RegulatoryAuthority, accept: boolean, note?: string) {
    const referral = await this.referrals.findOne({ where: { id, toAuthority: { id: authority.id }, status: RegulatoryCaseReferralStatus.PENDING } });
    if (!referral) throw new NotFoundEntityException('RegulatoryCaseReferral', id);
    referral.status = accept ? RegulatoryCaseReferralStatus.ACCEPTED : RegulatoryCaseReferralStatus.REJECTED;
    referral.decidedBy = actor; referral.decisionNote = note?.trim() || null; referral.decidedAt = new Date();
    const saved = await this.referrals.save(referral);
    const caseRecord = await this.one(referral.case.id);
    if (accept) {
      caseRecord.leadAuthority = authority;
      caseRecord.assignedTo = null;
      caseRecord.assignedTeam = null;
      caseRecord.assignedTeamRef = null;
      if (caseRecord.status === RegulatoryCaseStatus.CLOSED) throw new TraceabilityRuleException('A closed case cannot be transferred');
      await this.cases.save(caseRecord);
    }
    await this.record(caseRecord, actor, accept ? RegulatoryCaseEventType.REFERRAL_ACCEPTED : RegulatoryCaseEventType.REFERRAL_REJECTED, accept ? `Referral accepted by ${authority.name}` : `Referral declined by ${authority.name}`, { referralId: saved.id, fromAuthorityId: referral.fromAuthority.id, toAuthorityId: authority.id, note: saved.decisionNote });
    this.notifyAuthorityStaff(referral.fromAuthority, {
      type: accept ? NotificationType.SUCCESS : NotificationType.WARNING,
      title: accept
        ? `Referral accepted — ${caseRecord.caseNumber ?? `case #${caseRecord.id}`}`
        : `Referral declined — ${caseRecord.caseNumber ?? `case #${caseRecord.id}`}`,
      message: accept
        ? `${authority.name} accepted “${caseRecord.title}”. It now sits with that authority.`
        : `${authority.name} declined “${caseRecord.title}”. Keep the case on your desk or refer elsewhere.`,
      module: 'regulator',
      actionUrl: `/dashboard/regulator?tab=enforcement&case=${caseRecord.id}`,
    }).catch(() => undefined);
    return saved;
  }

  private async notifyBusinessOpened(caseRecord: RegulatoryCase) {
    const recipients = await this.users.find({
      where: [
        { organization: { id: caseRecord.organization.id }, role: UserRole.ORG_ADMIN },
        { organization: { id: caseRecord.organization.id }, role: UserRole.MANAGEMENT },
      ],
    });
    const label = caseRecord.caseNumber ?? `case #${caseRecord.id}`;
    for (const recipient of recipients) {
      await this.notifications.sendToUser(recipient.id, {
        type: NotificationType.WARNING,
        title: `Investigation opened — ${label}`,
        message: `A regulator opened “${caseRecord.title}”. Prepare records; you may be asked for evidence from the cases desk.`,
        module: 'compliance',
        actionUrl: '/dashboard/compliance/cases',
      });
    }
  }

  private async notifyAuthorityStaff(
    authority: RegulatoryAuthority,
    payload: { type: NotificationType; title: string; message: string; module: string; actionUrl: string },
  ) {
    const orgId = authority.operatingOrganization?.id;
    if (!orgId) return;
    const staff = await this.users.find({ where: { organization: { id: orgId } } });
    await Promise.allSettled(
      staff.map((user) => this.notifications.sendToUser(user.id, payload)),
    );
  }

  private async record(caseRecord: RegulatoryCase, actor: User, type: RegulatoryCaseEventType, summary: string, detail: Record<string, unknown>) {
    await this.events.save(this.events.create({ case: caseRecord, actor, type, summary, detail }));
  }

  private async findEvidence(caseId: number, evidenceId: number): Promise<RegulatoryCaseEvidence> {
    const evidence = await this.evidence.findOne({
      where: { id: evidenceId, case: { id: caseId } },
      relations: { case: { organization: true } },
    });
    if (!evidence) throw new NotFoundEntityException('RegulatoryCaseEvidence', evidenceId);
    return evidence;
  }

  private async resolveTeam(
    authority: RegulatoryAuthority,
    teamId?: number,
    teamName?: string,
  ) {
    if (teamId) {
      const byId = await this.teamService.findActiveById(authority.id, teamId);
      if (!byId) {
        throw new TraceabilityRuleException('Choose a team configured by your authority');
      }
      return byId;
    }
    const cleaned = teamName?.trim() || null;
    if (!cleaned) return null;
    const byName = await this.teamService.findActiveByName(authority.id, cleaned);
    if (byName) return byName;
    throw new TraceabilityRuleException('Choose a team configured by your authority');
  }

  private async assertCanAssign(
    actor: User,
    authority: RegulatoryAuthority,
    caseRecord: RegulatoryCase,
    targetTeam?: { id: number; name: string } | null,
    officerId?: number,
  ) {
    if (
      actor.role === UserRole.ORG_ADMIN ||
      actor.role === UserRole.MANAGEMENT ||
      actor.role === UserRole.SYSTEM_ADMIN
    ) {
      return;
    }
    const teamIds = [caseRecord.assignedTeamRef?.id, targetTeam?.id]
      .filter((id): id is number => typeof id === 'number' && id > 0);
    if (await this.teamService.isLeaderOfAnyIds(authority.id, actor.id, teamIds)) {
      return;
    }
    const names = [caseRecord.assignedTeam, targetTeam?.name]
      .map((name) => name?.trim())
      .filter((name): name is string => Boolean(name));
    if (await this.teamService.isLeaderOfAny(authority.id, actor.id, names)) {
      return;
    }
    // Team members may claim an unowned case for themselves only.
    if (
      officerId === actor.id &&
      !caseRecord.assignedTo &&
      (teamIds.length > 0 || names.length > 0)
    ) {
      const memberIds = await this.teamService.teamIdsForUser(authority.id, actor.id);
      const memberNames = await this.teamService.teamNamesForUser(authority.id, actor.id);
      if (
        teamIds.some((id) => memberIds.includes(id)) ||
        names.some((name) => memberNames.includes(name))
      ) {
        return;
      }
    }
    throw new TraceabilityRuleException(
      'Only an authority admin or the team leader may reassign this case',
    );
  }

  private async notifyAssignmentEmail(input: {
    user: User;
    title: string;
    message: string;
    caseLabel: string;
    organizationName: string;
    teamName: string | null;
    actionUrl: string;
  }) {
    if (!input.user.email) return;
    const dashboardUrl = `${this.appPublicUrl()}${input.actionUrl}`;
    await this.email
      .sendCaseAssignment({
        to: input.user.email,
        recipientName: input.user.fullName,
        title: input.title,
        message: input.message,
        caseLabel: input.caseLabel,
        organizationName: input.organizationName,
        teamName: input.teamName,
        dashboardUrl,
      })
      .catch((err: Error) => {
        this.logger.warn(`Case assignment email to ${input.user.email} failed: ${err.message}`);
      });
  }

  private appPublicUrl(): string {
    const configured = this.config.get<string>('appPublicUrl');
    return (configured ?? 'http://localhost:3000').replace(/\/$/, '');
  }
}
