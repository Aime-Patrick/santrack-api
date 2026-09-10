import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../auth/user-role.enum';
import { Batch } from '../../batch/entities/batch.entity';
import { NotFoundEntityException, TraceabilityRuleException } from '../../common/errors';
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
import { ReferRegulatoryCaseDto } from '../dto/regulatory-case.dto';
import { UploadedFile } from './license.service';

const EVIDENCE_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

@Injectable()
export class RegulatoryCaseService {
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
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider,
    private readonly notifications: NotificationsGateway,
  ) {}

  async listForAuthority(authority: RegulatoryAuthority, status?: RegulatoryCaseStatus, assignedToId?: number) {
    return this.cases.find({
      where: {
        leadAuthority: { id: authority.id },
        ...(status ? { status } : {}),
        ...(assignedToId ? { assignedTo: { id: assignedToId } } : {}),
      },
      order: { openedAt: 'DESC' },
      take: 200,
    });
  }

  async officers(regulator: Organization): Promise<User[]> {
    return this.users.find({
      where: { organization: { id: regulator.id } },
      order: { fullName: 'ASC', email: 'ASC' },
    });
  }

  async one(id: number): Promise<RegulatoryCase> {
    const caseRecord = await this.cases.findOne({ where: { id } });
    if (!caseRecord) throw new NotFoundEntityException('RegulatoryCase', id);
    return caseRecord;
  }

  async oneForAuthority(id: number, authority: RegulatoryAuthority): Promise<RegulatoryCase> {
    const caseRecord = await this.cases.findOne({ where: { id, leadAuthority: { id: authority.id } } });
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
        message: `${caseRecord.title}${note ? `: ${note}` : ''}. Submit your corrective-action evidence to keep the case moving.`,
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
        message: `${caseRecord.title}${note ? `: ${note}` : ''}`,
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
        message: `${caseRecord.organization.name} submitted ${evidence.filename}. Review and decide the case.`,
        module: 'regulator',
        actionUrl: '/dashboard/regulator',
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
    const assignedTeam = dto.assignedTeam?.trim() || null;
    if (assignedTeam && !leadAuthority.teams.includes(assignedTeam)) {
      throw new TraceabilityRuleException('Choose a team configured by your authority');
    }
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
      assignedTeam,
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
      assignedTeam,
    });
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
    caseRecord.assignedTo = officer;
    if (caseRecord.status === RegulatoryCaseStatus.OPEN) caseRecord.status = RegulatoryCaseStatus.IN_PROGRESS;
    const saved = await this.cases.save(caseRecord);
    await this.record(saved, actor, RegulatoryCaseEventType.ASSIGNED, `Assigned to ${officer.fullName ?? officer.email}`, {
      officerId: officer.id,
      note: note?.trim() || null,
    });
    return saved;
  }

  async assignTeam(id: number, actor: User, authority: RegulatoryAuthority, team: string) {
    const caseRecord = await this.oneForAuthority(id, authority);
    const cleaned = team.trim();
    if (!authority.teams.includes(cleaned)) throw new TraceabilityRuleException('Choose a team configured by your authority');
    caseRecord.assignedTeam = cleaned;
    const saved = await this.cases.save(caseRecord);
    await this.record(saved, actor, RegulatoryCaseEventType.ASSIGNED, `Assigned to team ${cleaned}`, { team: cleaned });
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
      if (caseRecord.status === RegulatoryCaseStatus.CLOSED) throw new TraceabilityRuleException('A closed case cannot be transferred');
      await this.cases.save(caseRecord);
    }
    await this.record(caseRecord, actor, accept ? RegulatoryCaseEventType.REFERRAL_ACCEPTED : RegulatoryCaseEventType.REFERRAL_REJECTED, accept ? `Referral accepted by ${authority.name}` : `Referral declined by ${authority.name}`, { referralId: saved.id, fromAuthorityId: referral.fromAuthority.id, toAuthorityId: authority.id, note: saved.decisionNote });
    return saved;
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
}
