import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';

import { User } from '../../auth/entities/user.entity';
import {
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { NotificationsGateway } from '../../notifications/gateways/notifications.gateway';
import { EmailService } from '../../email/email.service';
import { today } from '../../item/entities/traceable-item.entity';
import { Facility } from '../../organization/entities/facility.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { SequenceService } from '../../common/sequence.service';
import { STORAGE_PROVIDER, StorageProvider } from '../../storage/storage.provider';
import { permitsOperation, resolveGoverning } from '../governing-licence';
import {
  ApplyForLicenseDto,
  DecisionDto,
  ReviewDecision,
} from '../dto/license.dto';
import {
  License,
  LicenseCategory,
  LicenseDocument,
  LicenseEvent,
} from '../entities/license.entity';
import {
  LicensedActivity,
  LicenseEventType,
  LicenseStatus,
  permitsReturns,
} from '../licensing.enums';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Certificates are documents and images, not executables. */
const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * The licence workflow: apply, attach certificates, submit for screening,
 * and the regulator's decisions on the other side.
 */
@Injectable()
export class LicenseService {
  private readonly logger = new Logger(LicenseService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(License)
    private readonly licenses: Repository<License>,
    @InjectRepository(LicenseCategory)
    private readonly categories: Repository<LicenseCategory>,
    @InjectRepository(LicenseDocument)
    private readonly documents: Repository<LicenseDocument>,
    private readonly sequences: SequenceService,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider,
    private readonly notifications: NotificationsGateway,
    private readonly email: EmailService,
  ) {}

  // ------------------------------------------------------------ applicant

  /** Opens a draft application. Nothing is authorised until it is approved. */
  async apply(
    organization: Organization,
    actor: User,
    dto: ApplyForLicenseDto,
  ): Promise<License> {
    return this.dataSource.transaction(async (manager) => {
      const category = await manager.findOne(LicenseCategory, {
        where: { id: dto.categoryId },
      });
      if (!category || !category.active) {
        throw new NotFoundEntityException('Licence category', dto.categoryId);
      }

      if (!category.appliesTo.includes(organization.type)) {
        throw new TraceabilityRuleException(
          `${category.name} is not available to a ${organization.type}`,
        );
      }

      /**
       * One application per category *and site* at a time - but a provisional
       * licence is not an application.
       *
       * Provisional is platform-granted onboarding grace with no issuing
       * authority, and its own status reason tells the holder to "apply for a
       * full licence before it expires". Counting it as an application in
       * progress made that instruction impossible to follow: the grace blocked
       * the very thing it was asking for, until it lapsed and left the business
       * unlicensed. The two are meant to coexist - the provisional one expires
       * on its own date, the real one is screened by a regulator.
       *
       * The site is part of the grain (DR-07 §15, M1). "One per category" alone
       * would mean a business holding Kigali's manufacturing licence could never
       * apply for Huye's: the second application would collide with the first
       * and the second plant could never be authorised.
       */
      const facility = await this.resolveFacility(
        manager,
        organization,
        dto.facilityId,
      );

      const open = await manager.findOne(License, {
        where: {
          organization: { id: organization.id },
          category: { id: category.id },
          facilityId: facility === null ? IsNull() : facility.id,
          provisional: false,
          status: In([
            LicenseStatus.DRAFT,
            LicenseStatus.SUBMITTED,
            LicenseStatus.UNDER_REVIEW,
            LicenseStatus.ACTIVE,
          ]),
        },
      });
      if (open) {
        throw new TraceabilityRuleException(
          `${organization.name} already has a ${category.name} licence in progress (${open.licenseNumber}, ${open.status})`,
        );
      }

      const license = await manager.save(
        manager.create(License, {
          licenseNumber: await this.nextNumber(manager, category.code),
          organization,
          category,
          // Both, so the licence can name its site without being reloaded.
          facility,
          facilityId: facility?.id ?? null,
          status: LicenseStatus.DRAFT,
          provisional: false,
        }),
      );

      await this.log(manager, license, actor, LicenseEventType.APPLIED, {
        to: LicenseStatus.DRAFT,
        notes: dto.notes,
      });

      return license;
    });
  }

  /**
   * The site an application is about, checked to be one of the applicant's own.
   *
   * This is the only path in the platform that writes `licenses.facility_id`,
   * so it is where invariant 1 is enforced: no licence may reference a facility
   * belonging to another organization. A Postgres CHECK cannot express it —
   * the constraint spans two tables — so it is enforced here, at the single
   * door, and asserted by test on both sides of it.
   *
   * Another business's site is reported as not found rather than forbidden,
   * matching how production and the facilities endpoint already answer the
   * same question: a 403 would confirm that a site with that id exists.
   *
   * Returns the site itself rather than its id so the caller can set the
   * relation as well as the column. Setting only the column leaves the licence
   * it just created unable to say which plant it is about - the id is there,
   * the name is null, and the applicant is shown a site licence with no site on
   * it until something reloads the row.
   */
  private async resolveFacility(
    manager: EntityManager,
    organization: Organization,
    facilityId?: number | null,
  ): Promise<Facility | null> {
    if (facilityId === undefined || facilityId === null) {
      return null;
    }

    const facility = await manager.findOne(Facility, {
      where: { id: facilityId },
    });
    if (!facility || facility.organizationId !== organization.id) {
      throw new NotFoundEntityException('Facility', facilityId);
    }
    return facility;
  }

  /** Attaches a certificate to a draft. */
  async attachDocument(
    organization: Organization,
    actor: User,
    licenseId: number,
    documentType: string,
    file: UploadedFile,
  ): Promise<LicenseDocument> {
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

    const license = await this.requireOwn(organization, licenseId);
    if (license.status !== LicenseStatus.DRAFT) {
      throw new TraceabilityRuleException(
        `${license.licenseNumber} is ${license.status} - documents can only be attached while it is a draft`,
      );
    }

    // Stored before the row is written: an orphaned object costs disk, whereas
    // a row pointing at bytes that were never written is a broken download.
    const stored = await this.storage.put({
      folder: `licences/${license.id}`,
      filename: file.originalname,
      contentType: file.mimetype,
      content: file.buffer,
    });

    return this.dataSource.transaction(async (manager) => {
      const document = await manager.save(
        manager.create(LicenseDocument, {
          license,
          documentType,
          filename: file.originalname,
          contentType: stored.contentType,
          sizeBytes: stored.size,
          storageKey: stored.key,
          uploadedBy: actor,
        }),
      );

      await this.log(manager, license, actor, LicenseEventType.DOCUMENT_ATTACHED, {
        notes: `${documentType}: ${file.originalname}`,
      });

      return document;
    });
  }

  /**
   * Hands the application to the regulator. Refuses until every document the
   * category demands is present, so screening never starts on a half-filled
   * application.
   */
  async submit(
    organization: Organization,
    actor: User,
    licenseId: number,
  ): Promise<License> {
    return this.dataSource.transaction(async (manager) => {
      const license = await this.requireOwn(organization, licenseId, manager);
      if (license.status !== LicenseStatus.DRAFT) {
        throw new TraceabilityRuleException(
          `${license.licenseNumber} is already ${license.status}`,
        );
      }

      const attached = await manager.find(LicenseDocument, {
        where: { license: { id: license.id } },
      });
      const present = new Set(attached.map((d) => d.documentType));
      const missing = license.category.requiredDocuments.filter(
        (required) => !present.has(required),
      );
      if (missing.length > 0) {
        throw new TraceabilityRuleException(
          `Attach the remaining documents before submitting: ${missing.join(', ')}`,
        );
      }

      return this.transition(manager, license, actor, {
        to: LicenseStatus.SUBMITTED,
        event: LicenseEventType.SUBMITTED,
      });
    });
  }

  /**
   * Withdraw a draft application before it reaches the regulator.
   *
   * Only DRAFT licences can be cancelled — once submitted, the regulator
   * owns the process.  The licence is soft-deleted (status → CANCELLED)
   * rather than removed, so the audit trail stays intact.
   */
  async cancel(
    organization: Organization,
    actor: User,
    licenseId: number,
  ): Promise<License> {
    return this.dataSource.transaction(async (manager) => {
      const license = await this.requireOwn(organization, licenseId, manager);
      if (license.status !== LicenseStatus.DRAFT) {
        throw new TraceabilityRuleException(
          `Only a draft licence can be cancelled — ${license.licenseNumber} is ${license.status}`,
        );
      }

      return this.transition(manager, license, actor, {
        to: LicenseStatus.CANCELLED,
        event: LicenseEventType.CANCELLED,
        reason: 'Cancelled by applicant',
      });
    });
  }

  // ------------------------------------------------------------ regulator

  /** Applications waiting on this regulator. */
  async queue(regulator: Organization): Promise<License[]> {
    // The queue spans every applicant on the platform, so it is regulator-only
    // for the same reason the decision routes are. It previously took no
    // organization at all, which left the pending applications of every
    // business readable by any signed-in account.
    requireRegulator(regulator);

    return this.licenses.find({
      where: {
        status: In([LicenseStatus.SUBMITTED, LicenseStatus.UNDER_REVIEW]),
      },
      order: { createdAt: 'ASC' },
    });
  }

  /** Claims an application, so two reviewers do not screen the same one. */
  async startReview(
    regulator: Organization,
    actor: User,
    licenseId: number,
  ): Promise<License> {
    requireRegulator(regulator);

    return this.dataSource.transaction(async (manager) => {
      const license = await this.require(licenseId, manager);
      if (license.status !== LicenseStatus.SUBMITTED) {
        throw new TraceabilityRuleException(
          `${license.licenseNumber} is ${license.status}, not awaiting review`,
        );
      }

      license.reviewedBy = actor;
      return this.transition(manager, license, actor, {
        to: LicenseStatus.UNDER_REVIEW,
        event: LicenseEventType.REVIEW_STARTED,
      });
    });
  }

  /**
   * The screening decision. Approval sets the dates; the expiry is what makes
   * the licence renewable rather than permanent.
   */
  async decide(
    regulator: Organization,
    actor: User,
    licenseId: number,
    dto: DecisionDto,
  ): Promise<License> {
    requireRegulator(regulator);

    const saved = await this.dataSource.transaction(async (manager) => {
      const license = await this.require(licenseId, manager);

      if (
        license.status !== LicenseStatus.UNDER_REVIEW &&
        license.status !== LicenseStatus.SUBMITTED
      ) {
        throw new TraceabilityRuleException(
          `${license.licenseNumber} is ${license.status} and is not awaiting a decision`,
        );
      }

      if (dto.decision === ReviewDecision.REJECT) {
        if (!dto.reason?.trim()) {
          throw new TraceabilityRuleException(
            'A rejection needs a reason - the applicant has to know what to fix',
          );
        }
        license.reviewedBy = actor;
        license.issuedBy = regulator;
        return this.transition(manager, license, actor, {
          to: LicenseStatus.REJECTED,
          event: LicenseEventType.REJECTED,
          reason: dto.reason,
        });
      }

      const issuedOn = today();
      license.issuedBy = regulator;
      license.reviewedBy = actor;
      license.issuedOn = issuedOn;
      license.expiresOn =
        dto.expiresOn ?? addMonths(issuedOn, license.category.validityMonths);

      return this.transition(manager, license, actor, {
        to: LicenseStatus.ACTIVE,
        event: LicenseEventType.APPROVED,
        reason: dto.reason,
      });
    });

    // Notify the applicant's organization outside the transaction — notification
    // and email failures must not roll back the licence decision.
    this.notifyApplicant(saved, dto.decision).catch((err) =>
      this.logger.error(`Failed to notify applicant about ${saved.licenseNumber}:`, err),
    );

    return saved;
  }

  /**
   * Halts a licence immediately. This is the defect case: it does not wait for
   * the renewal date, and it does not touch product already in the field -
   * recalling stock is a separate, deliberate decision.
   */
  async suspend(
    regulator: Organization,
    actor: User,
    licenseId: number,
    reason: string,
  ): Promise<License> {
    requireRegulator(regulator);
    if (!reason?.trim()) {
      throw new TraceabilityRuleException('A suspension needs a reason');
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const license = await this.require(licenseId, manager);
      if (license.status !== LicenseStatus.ACTIVE) {
        throw new TraceabilityRuleException(
          `${license.licenseNumber} is ${license.status}, so there is nothing to suspend`,
        );
      }
      return this.transition(manager, license, actor, {
        to: LicenseStatus.SUSPENDED,
        event: LicenseEventType.SUSPENDED,
        reason,
      });
    });

    this.notifyApplicant(saved, 'SUSPENDED', reason).catch((err) =>
      this.logger.error(`Failed to notify about suspension of ${saved.licenseNumber}:`, err),
    );
    return saved;
  }

  /** Lifts a suspension once the cause is resolved. */
  async reinstate(
    regulator: Organization,
    actor: User,
    licenseId: number,
    reason?: string,
  ): Promise<License> {
    requireRegulator(regulator);

    const saved = await this.dataSource.transaction(async (manager) => {
      const license = await this.require(licenseId, manager);
      if (license.status !== LicenseStatus.SUSPENDED) {
        throw new TraceabilityRuleException(
          `${license.licenseNumber} is ${license.status}, not suspended`,
        );
      }
      // A licence that lapsed while suspended does not come back as valid.
      const target = license.isWithinDates(today())
        ? LicenseStatus.ACTIVE
        : LicenseStatus.EXPIRED;

      return this.transition(manager, license, actor, {
        to: target,
        event: LicenseEventType.REINSTATED,
        reason,
      });
    });

    this.notifyApplicant(saved, 'REINSTATED').catch((err) =>
      this.logger.error(`Failed to notify about reinstatement of ${saved.licenseNumber}:`, err),
    );
    return saved;
  }

  /** Ends a licence permanently. */
  async revoke(
    regulator: Organization,
    actor: User,
    licenseId: number,
    reason: string,
  ): Promise<License> {
    requireRegulator(regulator);
    if (!reason?.trim()) {
      throw new TraceabilityRuleException('A revocation needs a reason');
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const license = await this.require(licenseId, manager);
      if (license.status === LicenseStatus.REVOKED) {
        throw new TraceabilityRuleException(
          `${license.licenseNumber} is already revoked`,
        );
      }
      return this.transition(manager, license, actor, {
        to: LicenseStatus.REVOKED,
        event: LicenseEventType.REVOKED,
        reason,
      });
    });

    this.notifyApplicant(saved, 'REVOKED', reason).catch((err) =>
      this.logger.error(`Failed to notify about revocation of ${saved.licenseNumber}:`, err),
    );
    return saved;
  }

  /**
   * Starts a fresh application that succeeds an existing licence. A renewal is
   * a new licence pointing back at the old one, not an edit - so the record of
   * who was authorised during which window survives.
   */
  async renew(
    organization: Organization,
    actor: User,
    licenseId: number,
  ): Promise<License> {
    return this.dataSource.transaction(async (manager) => {
      const previous = await this.requireOwn(organization, licenseId, manager);

      const renewable =
        previous.status === LicenseStatus.ACTIVE ||
        previous.status === LicenseStatus.EXPIRED;
      if (!renewable) {
        throw new TraceabilityRuleException(
          `A ${previous.status} licence cannot be renewed - apply for a new one`,
        );
      }

      const renewal = await manager.save(
        manager.create(License, {
          licenseNumber: await this.nextNumber(manager, previous.category.code),
          organization,
          category: previous.category,
          /**
           * Carried from the licence being renewed (DR-07 WU-3).
           *
           * A renewal is the same authorisation continuing, so it has to be
           * about the same thing. Without this, renewing Huye's licence would
           * produce an organization-wide one: the plant would lose its own
           * authorisation and silently inherit the company's, taking the
           * company's suspensions and expiry with it. Nobody would see it
           * happen — the renewal would simply come back at the wrong grain.
           */
          facility: previous.facility,
          facilityId: previous.facilityId,
          status: LicenseStatus.DRAFT,
          previousLicense: previous,
          provisional: false,
        }),
      );

      await this.log(manager, renewal, actor, LicenseEventType.RENEWED, {
        to: LicenseStatus.DRAFT,
        notes: `Renews ${previous.licenseNumber}`,
      });

      return renewal;
    });
  }

  // ----------------------------------------------------------- enforcement

  /**
   * The licence an organization relies on for one activity, or null.
   * Expiry is evaluated on read, so a licence that lapsed overnight stops
   * authorising work even before the nightly sweep has run.
   *
   * Delegates to the shared resolver. It used to run its own query — no
   * ordering, no ranking, returning whichever row Postgres handed back first —
   * while `assess()` ranked by verdict over a date-ordered query. Two answers
   * to one question was harmless only while every business held a single
   * licence; with site-scoped licences it would have made the governing licence,
   * and therefore the regulatory verdict, depend on row order.
   *
   * Naming a facility applies the replacement rule (D1).
   */
  async effectiveLicense(
    organizationId: number,
    activity: LicensedActivity,
    facilityId: number | null = null,
  ): Promise<License | null> {
    const { verdict, license } = await resolveGoverning(
      this.licenses,
      organizationId,
      activity,
      facilityId,
    );
    return license && permitsOperation(verdict) ? license : null;
  }

  /** Whether an organization may currently take goods back in. */
  async mayReceive(
    organizationId: number,
    activity: LicensedActivity,
    facilityId: number | null = null,
  ): Promise<boolean> {
    const license = await this.effectiveLicense(
      organizationId,
      activity,
      facilityId,
    );
    return !!license && permitsReturns(license.status);
  }

  /**
   * Moves lapsed licences to EXPIRED. Read paths already treat an out-of-date
   * licence as invalid; this exists so the stored status matches, and so the
   * holder sees the change rather than discovering it on their next scan.
   */
  async expireLapsed(): Promise<number> {
    const now = today();
    const lapsed = await this.licenses
      .createQueryBuilder('l')
      .where('l.status = :active', { active: LicenseStatus.ACTIVE })
      .andWhere('l.expires_on IS NOT NULL')
      .andWhere('l.expires_on < :now', { now })
      .getMany();

    for (const license of lapsed) {
      await this.dataSource.transaction(async (manager) => {
        await this.transition(manager, license, null, {
          to: LicenseStatus.EXPIRED,
          event: LicenseEventType.EXPIRED,
          reason: `Lapsed on ${license.expiresOn}`,
        });
      });
    }
    return lapsed.length;
  }

  // ---------------------------------------------------------------- reads

  /**
   * Every licence a business holds, at whatever grain.
   *
   * The result set is unchanged by M1 — a site-scoped licence is still one of
   * this organization's licences. What changed is that the caller can now tell
   * them apart: `describe()` reports the facility and the grain, so the UI can
   * group by site instead of presenting a national licence and a plant licence
   * as interchangeable rows.
   */
  async listFor(organization: Organization): Promise<License[]> {
    return this.licenses.find({
      where: { organization: { id: organization.id } },
      order: { createdAt: 'DESC' },
    });
  }

  async listCategories(): Promise<LicenseCategory[]> {
    return this.categories.find({ where: { active: true }, order: { name: 'ASC' } });
  }

  /**
   * The holder's own paperwork. Ownership first, then the list - a licence
   * that is not yours reads as absent rather than as forbidden, the same way
   * `readDocument` treats a certificate that is not yours.
   */
  async documentsOfOwn(
    organization: Organization,
    licenseId: number,
  ): Promise<LicenseDocument[]> {
    await this.requireOwn(organization, licenseId);
    return this.documentsOf(licenseId);
  }

  async documentsOf(licenseId: number): Promise<LicenseDocument[]> {
    return this.documents.find({
      where: { license: { id: licenseId } },
      order: { uploadedAt: 'ASC' },
    });
  }

  /** The holder's own audit trail. Ownership first, as with the documents. */
  async historyOfOwn(
    organization: Organization,
    licenseId: number,
  ): Promise<LicenseEvent[]> {
    await this.requireOwn(organization, licenseId);
    return this.historyOf(licenseId);
  }

  async historyOf(licenseId: number): Promise<LicenseEvent[]> {
    return this.dataSource.getRepository(LicenseEvent).find({
      where: { license: { id: licenseId } },
      order: { recordedAt: 'ASC', id: 'ASC' },
    });
  }

  /**
   * Reads a certificate back. Only the holder and regulators may - a
   * competitor must never be able to pull another company's paperwork.
   */
  async readDocument(
    organization: Organization,
    documentId: number,
  ): Promise<{ document: LicenseDocument; content: Buffer }> {
    const document = await this.documents.findOne({
      where: { id: documentId },
      relations: { license: true },
    });
    if (!document) {
      throw new NotFoundEntityException('Document', documentId);
    }

    const own = document.license.organization.id === organization.id;
    if (!own && organization.type !== OrganizationType.REGULATOR) {
      throw new NotFoundEntityException('Document', documentId);
    }

    return { document, content: await this.storage.get(document.storageKey) };
  }

  // --------------------------------------------------------------- shared

  async require(licenseId: number, manager?: EntityManager): Promise<License> {
    const repo = manager ? manager.getRepository(License) : this.licenses;
    const license = await repo.findOne({ where: { id: licenseId } });
    if (!license) {
      throw new NotFoundEntityException('Licence', licenseId);
    }
    return license;
  }

  private async requireOwn(
    organization: Organization,
    licenseId: number,
    manager?: EntityManager,
  ): Promise<License> {
    const license = await this.require(licenseId, manager);
    if (license.organization.id !== organization.id) {
      throw new NotFoundEntityException('Licence', licenseId);
    }
    return license;
  }

  private async transition(
    manager: EntityManager,
    license: License,
    actor: User | null,
    change: {
      to: LicenseStatus;
      event: LicenseEventType;
      reason?: string | null;
    },
  ): Promise<License> {
    const from = license.status;
    license.status = change.to;
    license.statusReason = change.reason ?? null;
    license.statusChangedAt = new Date();
    const saved = await manager.save(License, license);

    await this.log(manager, saved, actor, change.event, {
      from,
      to: change.to,
      notes: change.reason,
    });

    return saved;
  }

  /**
   * Issues a new business the same provisional licence the licensing migration
   * gave everyone who already existed when licensing was switched on.
   *
   * Without this, self-serve onboarding is broken: grandfathering was a
   * one-shot INSERT over the organizations table, so any business created
   * afterwards holds nothing and is non-compliant from its first action. That
   * is not a rule anyone chose - it is the migration's cut-off leaking into
   * normal operation.
   *
   * It is a grace period, not an exemption. It carries `provisional`, lapses
   * on its own date like any other licence, and the holder still has to make a
   * real application that a regulator screens.
   *
   * Returns null when the organization's type needs no licence, and never
   * throws: onboarding must not fail because licensing had a bad day.
   */
  async issueProvisional(
    organization: Organization,
    days: number,
  ): Promise<License | null> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        // Withdrawn categories are excluded rather than merely ordered around.
        // Two categories once claimed MANUFACTURING - one from the schema
        // migration, one from the development seed - and this lookup picked
        // whichever the database returned first. The duplicate is deactivated
        // by migration 1757300000000; this is what stops a withdrawn category
        // ever being issued against again.
        const category = await manager.findOne(LicenseCategory, {
          where: {
            activity: activityForType(organization.type) as LicensedActivity,
            active: true,
          },
        });
        if (!category) {
          return null;
        }

        /**
         * Organization-grained, explicitly (DR-07 §15, M1).
         *
         * "Does this business already hold something?" is a question about the
         * business, and onboarding grace is granted to the business. Left
         * unscoped, a site-scoped licence would suppress the grace a newly
         * onboarded organization is entitled to — which is the opposite of what
         * this exists for.
         */
        const existing = await manager.findOne(License, {
          where: { organization: { id: organization.id }, facilityId: IsNull() },
        });
        if (existing) {
          return null;
        }

        const issuedOn = todayIso();
        const license = await manager.save(
          manager.create(License, {
            licenseNumber: await this.nextNumber(manager, category.code),
            organization,
            category,
            status: LicenseStatus.ACTIVE,
            provisional: true,
            issuedOn,
            expiresOn: addDays(issuedOn, days),
            statusReason:
              'Provisional licence issued automatically at registration. ' +
              'Apply for a full licence before it expires.',
            statusChangedAt: new Date(),
          }),
        );

        await this.log(manager, license, null, LicenseEventType.APPROVED, {
          to: LicenseStatus.ACTIVE,
          notes: 'Provisional licence issued at registration',
        });

        return license;
      });
    } catch (error) {
      this.logger.warn(
        `Could not issue a provisional licence to ${organization.name}: ${
          (error as Error).message
        }`,
      );
      return null;
    }
  }

  private async log(
    manager: EntityManager,
    license: License,
    actor: User | null,
    type: LicenseEventType,
    detail: {
      from?: LicenseStatus | null;
      to?: LicenseStatus | null;
      notes?: string | null;
    },
  ): Promise<void> {
    await manager.save(
      manager.create(LicenseEvent, {
        license,
        type,
        actor,
        fromStatus: detail.from ?? null,
        toStatus: detail.to ?? null,
        notes: detail.notes ?? null,
      }),
    );
  }

  private async nextNumber(
    manager: EntityManager,
    categoryCode: string,
  ): Promise<string> {
    const n = await this.sequences.next(manager, `LIC-${categoryCode}`);
    return `LIC-${categoryCode}-${String(n).padStart(5, '0')}`;
  }

  // ------------------------------------------------------------------ notify

  /**
   * Notify every user in the applicant's organisation about a licence
   * decision. Fire-and-forget: failures are logged but do not affect the
   * outcome.
   */
  private async notifyApplicant(
    license: License,
    action: ReviewDecision | 'SUSPENDED' | 'REINSTATED' | 'REVOKED',
    reason?: string,
  ): Promise<void> {
    const orgId = license.organization.id;
    const orgName = license.organization.name;
    const licenceNum = license.licenseNumber;
    const categoryName = license.category.name;

    const messageMap: Record<string, { title: string; message: string; notifType: string }> = {
      APPROVE: {
        title: `Licence Approved: ${licenceNum}`,
        message: `Your ${categoryName} licence (${licenceNum}) has been approved. ${license.expiresOn ? `Valid until ${license.expiresOn}.` : ''}`,
        notifType: 'SUCCESS',
      },
      REJECT: {
        title: `Licence Rejected: ${licenceNum}`,
        message: `Your ${categoryName} licence application (${licenceNum}) has been rejected. ${reason ?? license.statusReason ?? 'Please review and reapply.'}`,
        notifType: 'WARNING',
      },
      SUSPENDED: {
        title: `Licence Suspended: ${licenceNum}`,
        message: `Your ${categoryName} licence (${licenceNum}) has been suspended. ${reason ?? license.statusReason ?? ''}`,
        notifType: 'DANGER',
      },
      REINSTATED: {
        title: `Licence Reinstated: ${licenceNum}`,
        message: `Your ${categoryName} licence (${licenceNum}) has been reinstated and is now active again.${license.expiresOn ? ` Valid until ${license.expiresOn}.` : ''}`,
        notifType: 'SUCCESS',
      },
      REVOKED: {
        title: `Licence Revoked: ${licenceNum}`,
        message: `Your ${categoryName} licence (${licenceNum}) has been permanently revoked. ${reason ?? license.statusReason ?? ''}`,
        notifType: 'DANGER',
      },
    };

    const info = messageMap[action];
    if (!info) return;

    // Find all users in the applicant's organisation
    const users = await this.dataSource
      .getRepository(User)
      .find({ where: { organization: { id: orgId } } });

    const notificationPromises = users.map(async (user) => {
      // In-app notification
      await this.notifications.sendToUser(user.id, {
        type: info.notifType,
        title: info.title,
        message: info.message,
        module: 'licensing',
        actionUrl: '/dashboard/licenses',
      });

      // Email
      if (user.email) {
        await this.email.send({
          to: user.email,
          subject: info.title,
          template: 'license-decision',
          data: {
            recipientName: user.fullName,
            organisationName: orgName,
            licenceNumber: licenceNum,
            categoryName,
            decision: action.toLowerCase(),
            reason: reason ?? license.statusReason ?? undefined,
            expiresOn: license.expiresOn ?? undefined,
            reviewedBy: license.reviewedBy?.fullName ?? 'The licensing authority',
          },
        }).catch((err) => {
          this.logger.warn(`Email to ${user.email} failed: ${err.message}`);
        });
      }
    });

    await Promise.allSettled(notificationPromises);
    this.logger.log(`Notified ${users.length} user(s) at ${orgName} about ${licenceNum} (${action})`);
  }
}

function requireRegulator(organization: Organization): void {
  if (organization.type !== OrganizationType.REGULATOR) {
    throw new TraceabilityRuleException(
      'Only a licensing authority can screen and decide licence applications',
    );
  }
}

/** Adds whole months to an ISO date, clamping to the end of short months. */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Today as yyyy-MM-dd, matching the date columns licences are compared on. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Adds whole days to an ISO date, rolling months and years correctly. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1, d + days));
  return target.toISOString().slice(0, 10);
}

/**
 * The activity a business of this type is licensed for. Mirrors
 * LicenseEnforcementService.requiredActivityFor; kept here so issuing a
 * licence does not depend on the service that judges them.
 */
function activityForType(type: OrganizationType): LicensedActivity | null {
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
