import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { STORAGE_PROVIDER, StorageProvider } from '../../storage/storage.provider';
import {
  DuplicateException,
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { LicenseService } from '../../licensing/services/license.service';
import { NotificationsGateway } from '../../notifications/gateways/notifications.gateway';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { EmailService } from '../../email/email.service';
import { Product } from '../../product/entities/product.entity';
import {
  CreateOrganizationDto,
  RegistrationDecisionDto,
} from '../dto/organization.dto';
import {
  OrganizationType,
  SELF_DECLARABLE_TYPES,
  isSelfDeclarable,
} from '../organization-type.enum';
import { OnboardingStatus } from '../onboarding-status.enum';
import { Facility } from '../entities/facility.entity';
import { Organization } from '../entities/organization.entity';
import { OrganizationDocument } from '../entities/organization-document.entity';
import { OrganizationOwner } from '../entities/organization-owner.entity';
import { FacilityService } from './facility.service';

/** A certificate uploaded with a registration application. */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/** One business as the industry registry reports it. */
export interface RegistryEntry {
  organization: Organization;
  staff: number;
  products: number;
  licenses: {
    licenseNumber: string;
    activity: string;
    status: string;
    expiresOn: string | Date | null;
  }[];
}

@Injectable()
export class OrganizationService {
  private readonly logger = new Logger(OrganizationService.name);

  constructor(
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(Facility)
    private readonly facilities: Repository<Facility>,
    @InjectRepository(OrganizationDocument)
    private readonly documents: Repository<OrganizationDocument>,
    @InjectRepository(OrganizationOwner)
    private readonly owners: Repository<OrganizationOwner>,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider,
    private readonly sites: FacilityService,
    private readonly licenses: LicenseService,
    private readonly notifications: NotificationsGateway,
    private readonly email: EmailService,
    config: ConfigService,
  ) {
    this.appPublicUrl = (
      config.get<string>('appPublicUrl') ??
      (config.get<string[]>('corsOrigins') ?? ['http://localhost:3000'])[0] ??
      'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  private readonly appPublicUrl: string;

  /**
   * Onboarding: the caller creates the business they act for and is attached
   * to it. One organization per user - a person who moves between businesses
   * gets a new account there, because the chain of custody records which
   * business acted, and an ambiguous actor would undermine that.
   */
  async create(actor: User, dto: CreateOrganizationDto): Promise<Organization> {
    if (actor.organization) {
      throw new TraceabilityRuleException(
        `You already act for ${actor.organization.name}`,
      );
    }

    // Belt and braces: the DTO already rejects non-self-declarable types, but
    // this is the boundary that actually matters, so it does not rely on a
    // validator staying correct.
    if (!isSelfDeclarable(dto.type)) {
      throw new TraceabilityRuleException(
        `${dto.type} standing is granted by the platform, not chosen at sign-up`,
      );
    }

    const name = dto.name.trim();
    if (await this.organizations.findOne({ where: { name } })) {
      throw new DuplicateException(`An organization named ${name} already exists`);
    }

    const organization = await this.organizations.save(
      this.organizations.create({
        name,
        type: dto.type,
        tin: dto.tin?.trim() || null,
        registrationNumber: dto.registrationNumber?.trim() || null,
        email: dto.email?.trim() || null,
        phone: dto.phone?.trim() || null,
        licenseType: dto.licenseType?.trim() || null,
        dateIncorporated: dto.dateIncorporated ?? null,
        description: dto.description?.trim() || null,
        province: dto.province?.trim() || null,
        district: dto.district?.trim() || null,
        sector: dto.sector?.trim() || null,
        cell: dto.cell?.trim() || null,
        village: dto.village?.trim() || null,
        // A registration is an application, not a grant: no licence is issued
        // until a regulator approves it (Digital Tax Stamp flow).
        onboardingStatus: OnboardingStatus.PENDING,
      }),
    );

    // Ownership is part of the registration record (ownership transparency the
    // regulator screens against), not something attached later.
    if (dto.ownership && dto.ownership.length > 0) {
      await this.owners.save(
        dto.ownership.map((owner) =>
          this.owners.create({
            organization,
            organizationId: organization.id,
            name: owner.name.trim(),
            email: owner.email?.trim() || null,
            phone: owner.phone?.trim() || null,
            percentage: owner.percentage,
            idNumber: owner.idNumber?.trim() || null,
          }),
        ),
      );
    }

    /**
     * Every organization gets a site (DR-02).
     *
     * The migration backfilled one for each business that already existed, and
     * without this new ones would be the only organizations that could not
     * answer "which facility produced this batch?" — the guarantee would hold
     * for historic data and quietly lapse for everything created afterwards.
     *
     * Named after the organization, the same way the backfill named them, so a
     * single-site business never has to think about it.
     */
    // Inside a transaction because the code counter takes a pessimistic lock,
    // which Postgres will not grant outside one - and because two people
    // onboarding at the same moment must not be handed the same site code.
    //
    // The site itself is minted by FacilityService, which is also what the
    // facilities endpoint calls. Onboarding used to draw its own FAC- number
    // inline, so there were two implementations of how a site is created and
    // coded; they agreed, until they would not have.
    await this.facilities.manager.transaction((manager) =>
      this.sites.openWithin(manager, organization, `${name} — main site`),
    );

    actor.organization = organization;
    await this.users.save(actor);

    await this.notifications.sendToUser(actor.id, {
      type: NotificationType.INFO,
      title: 'Registration submitted',
      message:
        `${organization.name} is registered and waiting for a regulator to ` +
        'review it. You will be notified by email once a decision is made.',
      module: 'compliance',
      actionUrl: '/dashboard',
    });

    void this.email
      .sendRegistrationSubmitted({
        to: actor.email,
        companyName: organization.name,
      })
      .catch(() => undefined);

    return organization;
  }

  // -------------------------------------------------- registration review

  /**
   * Self-registrations awaiting a regulator's decision, oldest first, with
   * their declared owners attached so the review screen is one read.
   *
   * Regulator-only: callers reach it through the DECIDE_LICENCES gate, the
   * same one that guards licence screening.
   */
  async pendingRegistrations(): Promise<Organization[]> {
    return this.organizations.find({
      where: { onboardingStatus: OnboardingStatus.PENDING },
      relations: { owners: true },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * The regulator's verdict on a registration application.
   *
   * Approving activates the business and issues its operating licence; the
   * licence issuance is deliberately not allowed to fail the decision.
   * Rejecting records why, so the applicant can fix it and reapply.
   */
  async decideRegistration(
    regulator: Organization,
    actor: User,
    organizationId: number,
    dto: RegistrationDecisionDto,
  ): Promise<Organization> {
    if (regulator.type !== OrganizationType.REGULATOR) {
      throw new TraceabilityRuleException(
        'Only a licensing authority can approve registrations',
      );
    }

    const organization = await this.organizations.findOne({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new NotFoundEntityException('Organization', organizationId);
    }
    if (organization.onboardingStatus !== OnboardingStatus.PENDING) {
      throw new TraceabilityRuleException(
        `${organization.name}'s registration is already ${organization.onboardingStatus.toLowerCase()}`,
      );
    }

    if (dto.decision === 'REJECT') {
      if (!dto.reason?.trim()) {
        throw new TraceabilityRuleException(
          'A rejection needs a reason - the applicant has to know what to fix',
        );
      }
      organization.onboardingStatus = OnboardingStatus.REJECTED;
      organization.rejectionReason = dto.reason.trim();
      const saved = await this.organizations.save(organization);
      void this.notifyRegistrationDecision(saved, actor, 'REJECTED');
      return saved;
    }

    organization.onboardingStatus = OnboardingStatus.APPROVED;
    organization.rejectionReason = null;
    const saved = await this.organizations.save(organization);

    // Fire-and-forget like the licence service's own notification path: a
    // licensing problem must not roll back an approval that is already saved.
    void this.licenses
      .issueOnApproval(saved, regulator, actor)
      .then(() => this.notifyRegistrationDecision(saved, actor, 'APPROVED'))
      .catch((error: Error) =>
        this.logger.warn(
          `Licence/notification for approved registration ${saved.name} failed: ${error.message}`,
        ),
      );
    return saved;
  }

  /** Every user attached to an organization. */
  private async staffOf(organizationId: number): Promise<User[]> {
    return this.users.find({ where: { organization: { id: organizationId } } });
  }

  /**
   * Tells everyone at an approved/rejected business what happened - an in-app
   * notification for each staff member and an email per address. Fire and
   * forget; email failures are logged, not thrown.
   */
  private async notifyRegistrationDecision(
    organization: Organization,
    regulator: User,
    outcome: 'APPROVED' | 'REJECTED',
  ): Promise<void> {
    const staff = await this.staffOf(organization.id);
    await Promise.allSettled(
      staff.map(async (user) => {
        if (outcome === 'APPROVED') {
          await this.notifications.sendToUser(user.id, {
            type: NotificationType.SUCCESS,
            title: 'Registration approved',
            message: `${organization.name} is approved. Your operating licence is active and you can now work on the platform.`,
            module: 'compliance',
            actionUrl: '/dashboard',
          });
          if (user.email) {
            await this.email
              .sendRegistrationApproved({
                to: user.email,
                companyName: organization.name,
                loginUrl: `${this.appPublicUrl}/login`,
              })
              .catch(() => undefined);
          }
        } else {
          await this.notifications.sendToUser(user.id, {
            type: NotificationType.WARNING,
            title: 'Registration rejected',
            message:
              `${organization.name}'s registration was rejected: ` +
              `${organization.rejectionReason ?? 'no reason given'}.`,
            module: 'compliance',
            actionUrl: '/dashboard',
          });
          if (user.email) {
            await this.email
              .sendRegistrationRejected({
                to: user.email,
                companyName: organization.name,
                reason: organization.rejectionReason ?? 'No reason given.',
              })
              .catch(() => undefined);
          }
        }
      }),
    );
  }

  // ------------------------------------------------- registration documents

  /**
   * Files a certificate against a registration application (RDB certificate,
   * FDA premise certificate, import licence...). Only the applying
   * organization may attach while its application is still pending.
   */
  async attachDocument(
    organization: Organization,
    documentType: string,
    file: UploadedFile,
    certificateNumber?: string,
    expiryDate?: string,
  ): Promise<OrganizationDocument> {
    if (!ALLOWED_CONTENT_TYPES.includes(file.mimetype)) {
      throw new TraceabilityRuleException(
        `${file.mimetype} is not an accepted certificate format. Upload a PDF or an image.`,
      );
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new TraceabilityRuleException(
        `${file.originalname} is larger than the ${MAX_DOCUMENT_BYTES / (1024 * 1024)}MB limit`,
      );
    }

    // Stored before the row is written: an orphaned object costs disk, whereas
    // a row pointing at bytes that were never written is a broken download.
    const stored = await this.storage.put({
      folder: `organizations/${organization.id}/documents`,
      filename: file.originalname,
      contentType: file.mimetype,
      content: file.buffer,
    });

    return this.documents.save(
      this.documents.create({
        organization,
        organizationId: organization.id,
        documentType,
        certificateNumber: certificateNumber?.trim() || null,
        expiryDate: expiryDate || null,
        filename: file.originalname,
        contentType: stored.contentType,
        sizeBytes: stored.size,
        storageKey: stored.key,
      }),
    );
  }

  /**
   * The certificates filed against a registration. The applicant may read its
   * own; a licensing authority may read any, which is what screening needs.
   */
  async documentsFor(reader: Organization, organizationId: number) {
    const target = await this.organizations.findOne({
      where: { id: organizationId },
    });
    if (!target) {
      throw new NotFoundEntityException('Organization', organizationId);
    }
    const own = target.id === reader.id;
    if (!own && reader.type !== OrganizationType.REGULATOR) {
      throw new TraceabilityRuleException(
        "Another business's registration documents are for the licensing authority",
      );
    }

    return this.documents.find({
      where: { organizationId },
      order: { uploadedAt: 'ASC' },
    });
  }

  /** Streams a filed certificate back. Holder and regulators only. */
  async readDocument(
    reader: Organization,
    documentId: number,
  ): Promise<{ document: OrganizationDocument; content: Buffer }> {
    const document = await this.documents.findOne({
      where: { id: documentId },
    });
    if (!document) {
      throw new NotFoundEntityException('Document', documentId);
    }
    const own = document.organizationId === reader.id;
    if (!own && reader.type !== OrganizationType.REGULATOR) {
      throw new NotFoundEntityException('Document', documentId);
    }
    return { document, content: await this.storage.get(document.storageKey) };
  }

  /**
   * The directory of trading partners: who you can dispatch to or sell to.
   * Names and types only - never another organization's stock or history.
   *
   * `types` narrows it. The unfiltered list mixes oversight bodies in with
   * businesses, which is wrong in both directions: a regulator is not somebody
   * you dispatch stock to, and a page about regulators should not be showing
   * every shop on the platform. Filtering here rather than in the browser
   * keeps the payload proportionate to what the caller asked for.
   */
  async list(types?: OrganizationType[]): Promise<Organization[]> {
    return this.organizations.find({
      where: types && types.length > 0 ? { type: In(types) } : {},
      order: { name: 'ASC' },
    });
  }

  /**
   * The supervisory view of the businesses on the platform: who is registered,
   * how many people work there, how much catalogue they carry, and where their
   * licences stand.
   *
   * Deliberately not the same call as `list`. That one answers "who can I
   * dispatch to?" and every signed-in user needs it; this one answers "who is
   * operating in this industry and are they compliant?", which proposal
   * section 3 places with the licensing authorities and the platform operator.
   * Two questions, two capabilities - and the trading-partner picker does not
   * become a back door into the register.
   *
   * Oversight bodies are excluded: a regulator is an authority, not an
   * industry, and listing the authorities among the businesses they supervise
   * is what `listRegulators` is for.
   */
  async registry(): Promise<RegistryEntry[]> {
    const businesses = await this.organizations.find({
      where: { type: In(SELF_DECLARABLE_TYPES as OrganizationType[]) },
      order: { name: 'ASC' },
    });

    return Promise.all(
      businesses.map(async (organization) => {
        const licenses = await this.licenses.listFor(organization);
        return {
          organization,
          staff: await this.users.count({
            where: { organization: { id: organization.id } },
          }),
          products: await this.products.count({
            where: { organizationId: organization.id },
          }),
          licenses: licenses.map((license) => ({
            licenseNumber: license.licenseNumber,
            activity: license.category.activity,
            status: license.status,
            expiresOn: license.expiresOn,
          })),
        };
      }),
    );
  }

  /**
   * Corrects a registry entry. Platform operators only.
   *
   * Type changes are restricted to the business types: moving an organization
   * into or out of REGULATOR is granting or withdrawing standing, which has
   * its own routes because it carries consequences a rename does not.
   */
  async amend(
    organizationId: number,
    changes: {
      name?: string;
      type?: OrganizationType;
      tin?: string;
      registrationNumber?: string;
    },
  ): Promise<Organization> {
    const organization = await this.organizations.findOne({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new NotFoundEntityException('Organization', organizationId);
    }

    if (changes.type && changes.type !== organization.type) {
      if (organization.type === OrganizationType.REGULATOR) {
        throw new TraceabilityRuleException(
          `${organization.name} holds regulatory standing; withdraw it before changing its type`,
        );
      }
      if (!isSelfDeclarable(changes.type)) {
        throw new TraceabilityRuleException(
          `${changes.type} standing is granted by the platform, not set by editing the registry`,
        );
      }
      organization.type = changes.type;
    }

    if (changes.name) {
      const name = changes.name.trim();
      const clash = await this.organizations.findOne({ where: { name } });
      if (clash && clash.id !== organization.id) {
        throw new DuplicateException(
          `An organization named ${name} already exists`,
        );
      }
      organization.name = name;
    }

    if (changes.tin !== undefined) {
      organization.tin = changes.tin.trim() || null;
    }
    if (changes.registrationNumber !== undefined) {
      organization.registrationNumber =
        changes.registrationNumber.trim() || null;
    }

    return this.organizations.save(organization);
  }

  /**
   * Registers an oversight body. Platform operators only, for the same reason
   * `grantRegulatoryStanding` is: this organization will read every timeline
   * on the platform and can recall any manufacturer's batch.
   *
   * Unlike onboarding, the caller is not attached to it. The operator standing
   * up a regulator is not joining that regulator, and staff arrive afterwards
   * through user management.
   *
   * No provisional licence is issued either. Licensing governs who may trade;
   * an authority does not trade, and giving it a licence to lapse would put a
   * compliance finding against the body that reads them.
   */
  async registerRegulator(name: string): Promise<Organization> {
    const trimmed = name.trim();
    if (await this.organizations.findOne({ where: { name: trimmed } })) {
      throw new DuplicateException(`An organization named ${trimmed} already exists`);
    }

    return this.organizations.save(
      this.organizations.create({
        name: trimmed,
        type: OrganizationType.REGULATOR,
        // Platform-registered authorities skip the business application flow;
        // they are approved by the operator who stood them up.
        onboardingStatus: OnboardingStatus.APPROVED,
      }),
    );
  }

  /** Every organization holding regulatory standing, with its staff count. */
  async listRegulators(): Promise<{ organization: Organization; staff: number }[]> {
    const regulators = await this.organizations.find({
      where: { type: OrganizationType.REGULATOR },
      order: { name: 'ASC' },
    });

    return Promise.all(
      regulators.map(async (organization) => ({
        organization,
        staff: await this.users.count({
          where: { organization: { id: organization.id } },
        }),
      })),
    );
  }

  /**
   * Withdraws regulatory standing, returning the organization to an ordinary
   * business type.
   *
   * Standing is the type, so withdrawing it has to say what the organization
   * becomes - see `RevokeRegulatoryStandingDto`. A body registered as a
   * regulator from the start has no earlier business identity to return to,
   * and reverting it leaves a business record nobody registered; that is the
   * operator's call to make knowingly, which is why the target is stated
   * rather than inferred.
   */
  async revokeRegulatoryStanding(
    organizationId: number,
    revertTo: OrganizationType,
  ): Promise<Organization> {
    const organization = await this.organizations.findOne({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new NotFoundEntityException('Organization', organizationId);
    }
    if (organization.type !== OrganizationType.REGULATOR) {
      throw new TraceabilityRuleException(
        `${organization.name} is a ${organization.type} and holds no regulatory standing`,
      );
    }
    if (!isSelfDeclarable(revertTo)) {
      throw new TraceabilityRuleException(
        `${revertTo} is not a business type an organization can hold`,
      );
    }

    organization.type = revertTo;
    return this.organizations.save(organization);
  }

  /**
   * Confers regulatory standing on an organization. Reserved to the platform
   * operator, because a regulator reads every timeline on the platform,
   * sees consumer information and can recall any manufacturer's batch.
   *
   * This is the bootstrap for the regulatory layer: the first regulator has to
   * be granted by someone already trusted, since there is no regulator yet to
   * approve them. Once the licensing module lands, this becomes the narrow
   * path used only to seed the first authority - everyone else arrives through
   * an application that a regulator reviews.
   */
  async grantRegulatoryStanding(organizationId: number): Promise<Organization> {
    const organization = await this.organizations.findOne({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new NotFoundEntityException('Organization', organizationId);
    }

    organization.type = OrganizationType.REGULATOR;
    // If a PENDING business was ever promoted, its registration is now moot -
    // standing was granted by the platform, which is the approval.
    organization.onboardingStatus = OnboardingStatus.APPROVED;
    organization.rejectionReason = null;
    return this.organizations.save(organization);
  }
}
