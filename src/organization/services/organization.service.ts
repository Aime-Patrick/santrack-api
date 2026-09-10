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
import { RegulatoryAuthority } from '../../licensing/entities/regulatory-authority.entity';
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
    @InjectRepository(RegulatoryAuthority)
    private readonly regulatoryAuthorities: Repository<RegulatoryAuthority>,
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
  async create(actor: User, dto: CreateOrganizationDto): Promise<Organization> {
    if (actor.organization) {
      throw new TraceabilityRuleException(
        `You already act for ${actor.organization.name}`,
      );
    }
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
        industrySector: dto.industrySector ?? null,
        onboardingStatus: OnboardingStatus.PENDING,
      }),
    );
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
    await this.facilities.manager.transaction((manager) =>
      this.sites.openWithin(manager, organization, `${name} — main site`),
    );

    actor.organization = organization;
    await this.users.save(actor);
    void this.routeToAuthority(organization).catch((err: Error) =>
      this.logger.warn(
        `Sector routing for ${organization.name} failed silently: ${err.message}`,
      ),
    );

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
  async pendingRegistrations(): Promise<Organization[]> {
    return this.organizations.find({
      where: [
        { onboardingStatus: OnboardingStatus.PENDING },
        { onboardingStatus: OnboardingStatus.CHANGES_REQUESTED },
      ],
      relations: { owners: true },
      order: { createdAt: 'ASC' },
    });
  }
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
    const decidable: OnboardingStatus[] = [
      OnboardingStatus.PENDING,
      OnboardingStatus.CHANGES_REQUESTED,
    ];
    if (!decidable.includes(organization.onboardingStatus)) {
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
      organization.reviewNote = null;
      const saved = await this.organizations.save(organization);
      void this.notifyRegistrationDecision(saved, actor, 'REJECTED');
      return saved;
    }

    if (dto.decision === 'REQUEST_CHANGES') {
      if (!dto.reason?.trim()) {
        throw new TraceabilityRuleException(
          'Requesting changes needs a note — the applicant has to know what to provide',
        );
      }
      organization.onboardingStatus = OnboardingStatus.CHANGES_REQUESTED;
      organization.reviewNote = dto.reason.trim();
      organization.rejectionReason = null;
      const saved = await this.organizations.save(organization);
      void this.notifyRegistrationDecision(saved, actor, 'CHANGES_REQUESTED');
      return saved;
    }

    // APPROVE
    organization.onboardingStatus = OnboardingStatus.APPROVED;
    organization.rejectionReason = null;
    organization.reviewNote = null;
    const saved = await this.organizations.save(organization);

    // Fire-and-forget: a licensing problem must not roll back an approval.
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

  async resubmitRegistration(
    actor: User,
    organization: Organization,
  ): Promise<Organization> {
    if (organization.onboardingStatus !== OnboardingStatus.CHANGES_REQUESTED) {
      throw new TraceabilityRuleException(
        `${organization.name}'s registration is ${organization.onboardingStatus.toLowerCase()} — only a CHANGES_REQUESTED application can be resubmitted`,
      );
    }

    organization.onboardingStatus = OnboardingStatus.PENDING;
    organization.reviewNote = null;
    const saved = await this.organizations.save(organization);

    await this.notifications.sendToUser(actor.id, {
      type: NotificationType.INFO,
      title: 'Registration resubmitted',
      message:
        `${organization.name} has been resubmitted for review. ` +
        'You will be notified once a decision is made.',
      module: 'compliance',
      actionUrl: '/dashboard',
    });

    return saved;
  }

  private async routeToAuthority(organization: Organization): Promise<void> {
    const authority = await this.resolveAuthorityForSector(organization.industrySector);
    if (!authority?.operatingOrganization) return;

    const staff = await this.staffOf(authority.operatingOrganization.id);
    await Promise.allSettled(
      staff.map((user) =>
        this.notifications.sendToUser(user.id, {
          type: NotificationType.INFO,
          title: 'New registration application',
          message:
            `${organization.name} has submitted a registration application` +
            (organization.industrySector
              ? ` in the ${organization.industrySector.replace(/_/g, ' ').toLowerCase()} sector`
              : '') +
            '. Review it from the pending registrations queue.',
          module: 'compliance',
          actionUrl: '/dashboard/regulator',
        }),
      ),
    );
  }

  private async resolveAuthorityForSector(sector: string | null): Promise<RegulatoryAuthority | null> {
    const active = await this.regulatoryAuthorities.find({ where: { isActive: true }, order: { id: 'ASC' } });
    if (active.length === 0) return null;
    if (sector) {
      const match = active.find((a) => a.mandates.includes(sector));
      if (match) return match;
    }
    return active[0];
  }

  private async staffOf(organizationId: number): Promise<User[]> {
    return this.users.find({ where: { organization: { id: organizationId } } });
  }
  private async notifyRegistrationDecision(
    organization: Organization,
    regulator: User,
    outcome: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED',
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
        } else if (outcome === 'CHANGES_REQUESTED') {
          await this.notifications.sendToUser(user.id, {
            type: NotificationType.WARNING,
            title: 'Changes requested on your registration',
            message:
              `A regulator has reviewed ${organization.name}'s registration and ` +
              `needs some changes before approval. Sign in to see what's required.`,
            module: 'compliance',
            actionUrl: '/dashboard',
          });
          if (user.email) {
            await this.email
              .sendRegistrationChangesRequested({
                to: user.email,
                companyName: organization.name,
                note: organization.reviewNote ?? 'Please check your registration for details.',
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

  async documentsFor(reader: Organization | null, organizationId: number) {
    const target = await this.organizations.findOne({
      where: { id: organizationId },
    });
    if (!target) {
      throw new NotFoundEntityException('Organization', organizationId);
    }
    // null reader = SYSTEM_ADMIN with no organization — platform-wide access.
    if (reader !== null) {
      const own = target.id === reader.id;
      if (!own && reader.type !== OrganizationType.REGULATOR) {
        throw new TraceabilityRuleException(
          "Another business's registration documents are for the licensing authority",
        );
      }
    }

    return this.documents.find({
      where: { organizationId },
      order: { uploadedAt: 'ASC' },
    });
  }

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
  async list(types?: OrganizationType[]): Promise<Organization[]> {
    return this.organizations.find({
      where: types && types.length > 0 ? { type: In(types) } : {},
      order: { name: 'ASC' },
    });
  }

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

  async registerRegulator(name: string): Promise<Organization> {
    const trimmed = name.trim();
    if (await this.organizations.findOne({ where: { name: trimmed } })) {
      throw new DuplicateException(`An organization named ${trimmed} already exists`);
    }

    return this.organizations.save(
      this.organizations.create({
        name: trimmed,
        type: OrganizationType.REGULATOR,
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

  async grantRegulatoryStanding(organizationId: number): Promise<Organization> {
    const organization = await this.organizations.findOne({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new NotFoundEntityException('Organization', organizationId);
    }

    organization.type = OrganizationType.REGULATOR;
    organization.onboardingStatus = OnboardingStatus.APPROVED;
    organization.rejectionReason = null;
    return this.organizations.save(organization);
  }
  async purge(organizationId: number): Promise<void> {
    const organization = await this.organizations.findOne({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new NotFoundEntityException('Organization', organizationId);
    }

    const userCount = await this.users.count({
      where: { organization: { id: organizationId } },
    });
    if (userCount > 0) {
      throw new TraceabilityRuleException(
        `${organization.name} still has ${userCount} user(s) attached — remove them before deleting`,
      );
    }

    const productCount = await this.products.count({
      where: { organizationId },
    });
    if (productCount > 0) {
      throw new TraceabilityRuleException(
        `${organization.name} has ${productCount} product(s) on the platform — remove them before deleting`,
      );
    }

    const authorityCount = await this.regulatoryAuthorities.count({
      where: { operatingOrganization: { id: organizationId } },
    });
    if (authorityCount > 0) {
      throw new TraceabilityRuleException(
        `${organization.name} is linked to a regulatory authority — unlink it from the Regulators page before deleting`,
      );
    }

    const em = this.organizations.manager;
    const nullUpdates: Array<{ table: string; column: string }> = [
      // licenses: the regulator that issued a licence
      { table: 'licenses',            column: 'issued_by_organization_id' },
      // traceability events: source and destination org on a movement
      { table: 'traceability_events', column: 'source_organization_id' },
      { table: 'traceability_events', column: 'destination_organization_id' },
      // audit log actor org
      { table: 'audit_logs',          column: 'organization_id' },
      // shipments: destination org (nullable)
      { table: 'shipments',           column: 'destination_organization_id' },
      // sales: buyer org (nullable)
      { table: 'sales',               column: 'buyer_organization_id' },
      // batch manufacturer (nullable)
      { table: 'batches',             column: 'manufacturer_id' },
      // item holder (nullable)
      { table: 'traceable_items',     column: 'holder_id' },
      // supplier linked org (nullable)
      { table: 'suppliers',           column: 'linked_organization_id' },
      // customer buyer org (nullable)
      { table: 'customers',           column: 'buyer_organization_id' },
    ];
    for (const { table, column } of nullUpdates) {
      await em.query(
        `UPDATE "${table}" SET "${column}" = NULL WHERE "${column}" = $1`,
        [organizationId],
      );
    }

    // Cascade order: owned rows first, then the parent org row.
    await this.documents.delete({ organizationId });
    await this.owners.delete({ organizationId });
    await this.sites.deleteFor(organizationId);
    await this.organizations.delete(organizationId);
  }
}
