import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import {
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { RegulatoryAuthority } from '../../licensing/entities/regulatory-authority.entity';
import { RegulatoryAuthorityService } from '../../licensing/services/regulatory-authority.service';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { NotificationsGateway } from '../../notifications/gateways/notifications.gateway';
import { Organization } from '../entities/organization.entity';
import {
  ConsultationStatus,
  ConsultationVerdict,
  RegistrationConsultation,
} from '../entities/registration-consultation.entity';
import { OnboardingStatus } from '../onboarding-status.enum';

// ---------------------------------------------------------------------------
// DTOs (inline — small enough not to warrant a separate file)
// ---------------------------------------------------------------------------

export interface OpenConsultationDto {
  /** ID of the RegulatoryAuthority to consult. */
  toAuthorityId: number;
  /** What specifically is being asked. */
  subject: string;
  /** Background context / document references for the secondary authority. */
  contextNote?: string;
  /** IDs of organization_documents to share with the secondary authority. */
  forwardedDocumentIds?: number[];
  /** Optional SLA date (yyyy-MM-dd). */
  dueDate?: string;
}

export interface RespondConsultationDto {
  verdict: ConsultationVerdict;
  responseNote?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class RegistrationConsultationService {
  constructor(
    @InjectRepository(RegistrationConsultation)
    private readonly consultations: Repository<RegistrationConsultation>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(RegulatoryAuthority)
    private readonly regulatoryAuthorities: Repository<RegulatoryAuthority>,
    private readonly authorityService: RegulatoryAuthorityService,
    private readonly notifications: NotificationsGateway,
  ) {}

  // ---------------------------------------------------------------- primary

  /**
   * Primary regulator opens a consultation to a secondary authority.
   *
   * Sets the applicant's onboarding status to UNDER_CONSULTATION (if not
   * already) so they can see their application is actively being reviewed by
   * multiple regulatory bodies.
   *
   * The same primary authority may consult multiple secondary authorities in
   * parallel, and may open a second consultation on the same authority after
   * the first is resolved. A primary authority cannot consult itself.
   */
  async open(
    actor: User,
    fromAuthority: RegulatoryAuthority,
    organizationId: number,
    dto: OpenConsultationDto,
  ): Promise<RegistrationConsultation> {
    const organization = await this.organizations.findOne({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new NotFoundEntityException('Organization', organizationId);
    }

    const reviewable: OnboardingStatus[] = [
      OnboardingStatus.PENDING,
      OnboardingStatus.UNDER_CONSULTATION,
      OnboardingStatus.CHANGES_REQUESTED,
    ];
    if (!reviewable.includes(organization.onboardingStatus)) {
      throw new TraceabilityRuleException(
        `${organization.name}'s registration is ${organization.onboardingStatus} — consultations can only be opened on active applications`,
      );
    }

    const toAuthority = await this.regulatoryAuthorities.findOne({
      where: { id: dto.toAuthorityId, isActive: true },
    });
    if (!toAuthority) {
      throw new NotFoundEntityException('RegulatoryAuthority', dto.toAuthorityId);
    }

    if (toAuthority.id === fromAuthority.id) {
      throw new TraceabilityRuleException(
        'A regulatory authority cannot consult itself',
      );
    }

    // No limit on parallel consultations to different authorities, but prevent
    // opening a duplicate PENDING consultation to the same authority on the
    // same application — it serves no purpose and clutters the inbox.
    const duplicate = await this.consultations.findOne({
      where: {
        organization: { id: organizationId },
        fromAuthority: { id: fromAuthority.id },
        toAuthority: { id: toAuthority.id },
        status: ConsultationStatus.PENDING,
      },
    });
    if (duplicate) {
      throw new TraceabilityRuleException(
        `A consultation to ${toAuthority.name} is already pending on this application (consultation #${duplicate.id})`,
      );
    }

    const consultation = await this.consultations.save(
      this.consultations.create({
        organization,
        fromAuthority,
        toAuthority,
        subject: dto.subject.trim(),
        contextNote: dto.contextNote?.trim() || null,
        forwardedDocumentIds: dto.forwardedDocumentIds ?? [],
        status: ConsultationStatus.PENDING,
        verdict: null,
        responseNote: null,
        dueDate: dto.dueDate || null,
        createdBy: actor,
        respondedBy: null,
        respondedAt: null,
      }),
    );

    // Move the applicant to UNDER_CONSULTATION so their wall screen reflects
    // that their application is actively being reviewed by multiple bodies.
    if (organization.onboardingStatus !== OnboardingStatus.UNDER_CONSULTATION) {
      organization.onboardingStatus = OnboardingStatus.UNDER_CONSULTATION;
      await this.organizations.save(organization);
    }

    // Notify officers of the secondary authority's operating organization.
    await this.notifySecondaryAuthority(consultation, 'OPENED');

    return consultation;
  }

  /**
   * Lists all consultations for one application, visible to the primary
   * authority that opened them.
   */
  async listForOrganization(
    organizationId: number,
    fromAuthority: RegulatoryAuthority,
  ): Promise<RegistrationConsultation[]> {
    return this.consultations.find({
      where: {
        organization: { id: organizationId },
        fromAuthority: { id: fromAuthority.id },
      },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Primary authority cancels a PENDING consultation (e.g. they no longer
   * need the input, or they are about to make a final decision).
   */
  async cancel(
    actor: User,
    fromAuthority: RegulatoryAuthority,
    consultationId: number,
  ): Promise<RegistrationConsultation> {
    const consultation = await this.requireFrom(consultationId, fromAuthority);

    if (consultation.status !== ConsultationStatus.PENDING) {
      throw new TraceabilityRuleException(
        `Consultation #${consultationId} is ${consultation.status} — only PENDING consultations can be cancelled`,
      );
    }

    consultation.status = ConsultationStatus.CANCELLED;
    const saved = await this.consultations.save(consultation);

    // If no other PENDING consultations remain, revert the applicant to PENDING
    // so the primary authority's queue shows it as ready to decide.
    await this.syncOrganizationStatus(consultation.organization.id);

    return saved;
  }

  // ---------------------------------------------------------------- secondary

  /**
   * The secondary authority's incoming consultation inbox — PENDING requests
   * addressed to them, with an overdue flag for SLA tracking.
   */
  async incomingForAuthority(
    toAuthority: RegulatoryAuthority,
  ): Promise<{ consultation: RegistrationConsultation; overdue: boolean }[]> {
    const rows = await this.consultations.find({
      where: {
        toAuthority: { id: toAuthority.id },
        status: In([ConsultationStatus.PENDING, ConsultationStatus.OVERDUE]),
      },
      order: { createdAt: 'ASC' },
    });

    const today = new Date().toISOString().slice(0, 10);
    return rows.map((c) => ({
      consultation: c,
      overdue: c.status === ConsultationStatus.OVERDUE ||
        (!!c.dueDate && c.dueDate < today),
    }));
  }

  /**
   * Secondary authority responds to a consultation with a verdict and optional
   * notes. The verdict is advisory — the primary regulator makes the final
   * registration decision.
   *
   * After the response, if all consultations on the application are resolved
   * the applicant's status reverts to PENDING so the primary authority sees
   * the application back in their review queue.
   */
  async respond(
    actor: User,
    toAuthority: RegulatoryAuthority,
    consultationId: number,
    dto: RespondConsultationDto,
  ): Promise<RegistrationConsultation> {
    const consultation = await this.requireTo(consultationId, toAuthority);

    if (
      consultation.status !== ConsultationStatus.PENDING &&
      consultation.status !== ConsultationStatus.OVERDUE
    ) {
      throw new TraceabilityRuleException(
        `Consultation #${consultationId} is ${consultation.status} — only PENDING or OVERDUE consultations can be responded to`,
      );
    }

    consultation.status = ConsultationStatus.RESPONDED;
    consultation.verdict = dto.verdict;
    consultation.responseNote = dto.responseNote?.trim() || null;
    consultation.respondedBy = actor;
    consultation.respondedAt = new Date();

    const saved = await this.consultations.save(consultation);

    // Notify the primary authority's officers that a response has arrived.
    await this.notifyPrimaryAuthority(saved);

    // If all consultations are now resolved, revert the application to PENDING.
    await this.syncOrganizationStatus(consultation.organization.id);

    return saved;
  }

  // ---------------------------------------------------------------- expiry

  /**
   * Marks PENDING consultations past their due date as OVERDUE. Called by the
   * nightly maintenance sweep alongside licence expiry. Returns the count of
   * consultations flipped.
   */
  async markOverdue(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const overdue = await this.consultations.find({
      where: { status: ConsultationStatus.PENDING },
    });

    let count = 0;
    for (const c of overdue) {
      if (c.dueDate && c.dueDate < today) {
        c.status = ConsultationStatus.OVERDUE;
        await this.consultations.save(c);
        count++;
      }
    }
    return count;
  }

  // ---------------------------------------------------------------- private

  /**
   * Keeps the applicant's onboarding status in sync with the consultation
   * state.
   *
   * If any PENDING or OVERDUE consultation remains → stay UNDER_CONSULTATION.
   * If all are resolved (RESPONDED or CANCELLED) → revert to PENDING so the
   * primary authority's review queue surfaces the application again.
   *
   * Does not touch APPROVED, REJECTED, or CHANGES_REQUESTED — those are
   * terminal or awaiting applicant action.
   */
  private async syncOrganizationStatus(organizationId: number): Promise<void> {
    const organization = await this.organizations.findOne({
      where: { id: organizationId },
    });
    if (!organization) return;
    if (
      organization.onboardingStatus !== OnboardingStatus.UNDER_CONSULTATION
    ) {
      return;
    }

    const openCount = await this.consultations.count({
      where: {
        organization: { id: organizationId },
        status: In([ConsultationStatus.PENDING, ConsultationStatus.OVERDUE]),
      },
    });

    if (openCount === 0) {
      organization.onboardingStatus = OnboardingStatus.PENDING;
      await this.organizations.save(organization);
    }
  }

  private async requireFrom(
    id: number,
    fromAuthority: RegulatoryAuthority,
  ): Promise<RegistrationConsultation> {
    const c = await this.consultations.findOne({
      where: { id, fromAuthority: { id: fromAuthority.id } },
    });
    if (!c) throw new NotFoundEntityException('RegistrationConsultation', id);
    return c;
  }

  private async requireTo(
    id: number,
    toAuthority: RegulatoryAuthority,
  ): Promise<RegistrationConsultation> {
    const c = await this.consultations.findOne({
      where: { id, toAuthority: { id: toAuthority.id } },
    });
    if (!c) throw new NotFoundEntityException('RegistrationConsultation', id);
    return c;
  }

  /**
   * Notifies officers of the secondary authority when a consultation is opened.
   * Best-effort: notification failures never fail the consultation creation.
   */
  private async notifySecondaryAuthority(
    consultation: RegistrationConsultation,
    _event: 'OPENED',
  ): Promise<void> {
    const toOrg = consultation.toAuthority.operatingOrganization;
    if (!toOrg) return;

    try {
      const officers = await this.staffOf(toOrg.id);
      await Promise.allSettled(
        officers.map((u) =>
          this.notifications.sendToUser(u.id, {
            type: NotificationType.INFO,
            title: 'New registration consultation',
            message:
              `${consultation.fromAuthority.name} has requested your input on ` +
              `${consultation.organization.name}'s registration: "${consultation.subject}"`,
            module: 'compliance',
            actionUrl: '/dashboard/regulator',
          }),
        ),
      );
    } catch {
      // Swallowed — notification failure must not fail consultation creation.
    }
  }

  /**
   * Notifies officers of the primary authority when a response arrives.
   */
  private async notifyPrimaryAuthority(
    consultation: RegistrationConsultation,
  ): Promise<void> {
    const fromOrg = consultation.fromAuthority.operatingOrganization;
    if (!fromOrg) return;

    const verdictLabel: Record<ConsultationVerdict, string> = {
      [ConsultationVerdict.APPROVED]: '✓ Approved',
      [ConsultationVerdict.CONCERNS]: '⚠ Concerns noted',
      [ConsultationVerdict.OBJECTION]: '✗ Objection',
    };

    try {
      const officers = await this.staffOf(fromOrg.id);
      await Promise.allSettled(
        officers.map((u) =>
          this.notifications.sendToUser(u.id, {
            type:
              consultation.verdict === ConsultationVerdict.OBJECTION
                ? NotificationType.WARNING
                : NotificationType.INFO,
            title: 'Consultation response received',
            message:
              `${consultation.toAuthority.name} responded to your consultation on ` +
              `${consultation.organization.name}'s registration: ` +
              `${verdictLabel[consultation.verdict!] ?? consultation.verdict}`,
            module: 'compliance',
            actionUrl: '/dashboard/regulator',
          }),
        ),
      );
    } catch {
      // Swallowed.
    }
  }

  private async staffOf(organizationId: number) {
    return this.consultations.manager
      .getRepository('users')
      .find({ where: { organization: { id: organizationId } } });
  }
}
