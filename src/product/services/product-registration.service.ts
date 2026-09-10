import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { User } from '../../auth/entities/user.entity';
import {
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { today } from '../../item/entities/traceable-item.entity';
import { Facility } from '../../organization/entities/facility.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { SequenceService } from '../../common/sequence.service';
import { STORAGE_PROVIDER, StorageProvider } from '../../storage/storage.provider';
import {
  ApplyForProductRegistrationDto,
  ProductDecisionDto,
  ProductReviewDecision,
} from '../dto/product-registration.dto';
import {
  ProductRegistration,
  ProductRegistrationDocument,
  ProductRegistrationEvent,
  ProductRegistrationEventType,
  ProductRegistrationStatus,
} from '../entities/product-registration.entity';
import { Product } from '../entities/product.entity';
import { ProductCategory } from '../entities/product-category.entity';
import { UploadedFile } from '../../licensing/services/license.service';

const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

function requireRegulator(organization: Organization) {
  if (organization.type !== OrganizationType.REGULATOR) {
    throw new TraceabilityRuleException(
      'Only a regulatory authority may access this registration workflow',
    );
  }
}

@Injectable()
export class ProductRegistrationService {
  private readonly logger = new Logger(ProductRegistrationService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ProductRegistration)
    private readonly registrations: Repository<ProductRegistration>,
    @InjectRepository(ProductRegistrationDocument)
    private readonly documents: Repository<ProductRegistrationDocument>,
    private readonly sequences: SequenceService,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider,
  ) {}

  /** Creates a draft product registration application. */
  async apply(
    organization: Organization,
    actor: User,
    dto: ApplyForProductRegistrationDto,
  ): Promise<ProductRegistration> {
    return this.dataSource.transaction(async (manager) => {
      let facility: Facility | null = null;
      if (dto.facilityId) {
        facility = await manager.findOne(Facility, {
          where: { id: dto.facilityId },
        });
        if (!facility || facility.organizationId !== organization.id) {
          throw new NotFoundEntityException('Facility', dto.facilityId);
        }
      }

      let category: ProductCategory | null = null;
      if (dto.categoryId) {
        category = await manager.findOne(ProductCategory, {
          where: { id: dto.categoryId },
        });
      }

      let product: Product | null = null;
      if (dto.productId) {
        product = await manager.findOne(Product, {
          where: { id: dto.productId, organizationId: organization.id },
        });
      }

      const seq = await this.sequences.next(manager, 'REG-PROD');
      const regNumber = `REG-PROD-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;

      const reg = await manager.save(
        manager.create(ProductRegistration, {
          registrationNumber: regNumber,
          organization,
          organizationId: organization.id,
          facility,
          facilityId: facility?.id ?? null,
          product,
          productId: product?.id ?? null,
          category,
          categoryId: category?.id ?? null,
          productName: dto.productName,
          brandName: dto.brandName ?? null,
          intendedUse: dto.intendedUse ?? null,
          targetConsumer: dto.targetConsumer ?? null,
          ingredients: dto.ingredients ?? [],
          netContents: dto.netContents ?? [],
          shelfLifeMonths: dto.shelfLifeMonths ?? 12,
          storageConditions: dto.storageConditions ?? null,
          rsbStandardNumber: dto.rsbStandardNumber ?? null,
          status: ProductRegistrationStatus.DRAFT,
        }),
      );

      await this.log(manager, reg, actor, ProductRegistrationEventType.APPLIED, {
        to: ProductRegistrationStatus.DRAFT,
        notes: `Application created for ${dto.productName}`,
      });

      return reg;
    });
  }

  /** Attach certificate or dossier document (CoA, label artwork, etc.) */
  async attachDocument(
    organization: Organization,
    actor: User,
    registrationId: number,
    documentType: string,
    file: UploadedFile,
  ): Promise<ProductRegistrationDocument> {
    if (!ALLOWED_CONTENT_TYPES.includes(file.mimetype)) {
      throw new TraceabilityRuleException(
        `${file.mimetype} is not an accepted document format. Upload a PDF or image.`,
      );
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new TraceabilityRuleException(
        `${file.originalname} exceeds the 10MB limit`,
      );
    }

    const reg = await this.requireOwn(organization, registrationId);
    if (reg.status !== ProductRegistrationStatus.DRAFT) {
      throw new TraceabilityRuleException(
        `${reg.registrationNumber} is ${reg.status} - documents can only be attached while in draft`,
      );
    }

    const stored = await this.storage.put({
      folder: `product-registrations/${reg.id}`,
      filename: file.originalname,
      contentType: file.mimetype,
      content: file.buffer,
    });

    return this.dataSource.transaction(async (manager) => {
      const document = await manager.save(
        manager.create(ProductRegistrationDocument, {
          productRegistration: reg,
          documentType,
          filename: file.originalname,
          contentType: stored.contentType,
          sizeBytes: stored.size,
          storageKey: stored.key,
          uploadedBy: actor,
        }),
      );

      await this.log(
        manager,
        reg,
        actor,
        ProductRegistrationEventType.DOCUMENT_ATTACHED,
        {
          notes: `${documentType}: ${file.originalname}`,
        },
      );

      return document;
    });
  }

  /** Submit product registration to regulator. */
  async submit(
    organization: Organization,
    actor: User,
    registrationId: number,
  ): Promise<ProductRegistration> {
    return this.dataSource.transaction(async (manager) => {
      const reg = await this.requireOwn(organization, registrationId, manager);
      if (reg.status !== ProductRegistrationStatus.DRAFT) {
        throw new TraceabilityRuleException(
          `${reg.registrationNumber} is already ${reg.status}`,
        );
      }

      return this.transition(manager, reg, actor, {
        to: ProductRegistrationStatus.SUBMITTED,
        event: ProductRegistrationEventType.SUBMITTED,
      });
    });
  }

  /** Cancel a draft product registration. */
  async cancel(
    organization: Organization,
    actor: User,
    registrationId: number,
  ): Promise<ProductRegistration> {
    return this.dataSource.transaction(async (manager) => {
      const reg = await this.requireOwn(organization, registrationId, manager);
      if (reg.status !== ProductRegistrationStatus.DRAFT) {
        throw new TraceabilityRuleException(
          `Only draft registrations can be cancelled`,
        );
      }

      return this.transition(manager, reg, actor, {
        to: ProductRegistrationStatus.CANCELLED,
        event: ProductRegistrationEventType.CANCELLED,
        reason: 'Cancelled by applicant',
      });
    });
  }

  /** List product registrations for an organization. */
  async listFor(organization: Organization): Promise<ProductRegistration[]> {
    return this.registrations.find({
      where: { organization: { id: organization.id } },
      relations: ['facility', 'category', 'product'],
      order: { createdAt: 'DESC' },
    });
  }

  /** Get single product registration with documents and events. */
  async get(
    organization: Organization,
    registrationId: number,
  ): Promise<{
    registration: ProductRegistration;
    documents: ProductRegistrationDocument[];
    events: ProductRegistrationEvent[];
  }> {
    const isReg = organization.type === OrganizationType.REGULATOR;
    const reg = await this.registrations.findOne({
      where: isReg
        ? { id: registrationId }
        : { id: registrationId, organization: { id: organization.id } },
      relations: ['facility', 'category', 'product', 'issuedBy', 'reviewedBy'],
    });
    if (!reg) {
      throw new NotFoundEntityException('Product registration', registrationId);
    }

    const documents = await this.documents.find({
      where: { productRegistration: { id: registrationId } },
      order: { uploadedAt: 'ASC' },
    });

    const events = await this.dataSource
      .getRepository(ProductRegistrationEvent)
      .find({
        where: { productRegistration: { id: registrationId } },
        order: { recordedAt: 'ASC' },
      });

    return { registration: reg, documents, events };
  }

  // ------------------------------------------------------------ regulator

  /** Regulator review queue. */
  async queue(regulator: Organization): Promise<ProductRegistration[]> {
    requireRegulator(regulator);
    return this.registrations.find({
      where: {
        status: In([
          ProductRegistrationStatus.SUBMITTED,
          ProductRegistrationStatus.UNDER_REVIEW,
        ]),
      },
      relations: ['organization', 'facility', 'category'],
      order: { createdAt: 'ASC' },
    });
  }

  /** Claim review. */
  async startReview(
    regulator: Organization,
    actor: User,
    registrationId: number,
  ): Promise<ProductRegistration> {
    requireRegulator(regulator);
    return this.dataSource.transaction(async (manager) => {
      const reg = await this.require(registrationId, manager);
      if (reg.status !== ProductRegistrationStatus.SUBMITTED) {
        throw new TraceabilityRuleException(
          `${reg.registrationNumber} is ${reg.status}, not awaiting review`,
        );
      }
      reg.reviewedBy = actor;
      return this.transition(manager, reg, actor, {
        to: ProductRegistrationStatus.UNDER_REVIEW,
        event: ProductRegistrationEventType.REVIEW_STARTED,
      });
    });
  }

  /** Decide (Approve / Reject). */
  async decide(
    regulator: Organization,
    actor: User,
    registrationId: number,
    dto: ProductDecisionDto,
  ): Promise<ProductRegistration> {
    requireRegulator(regulator);
    return this.dataSource.transaction(async (manager) => {
      const reg = await this.require(registrationId, manager);
      if (
        reg.status !== ProductRegistrationStatus.UNDER_REVIEW &&
        reg.status !== ProductRegistrationStatus.SUBMITTED
      ) {
        throw new TraceabilityRuleException(
          `${reg.registrationNumber} is ${reg.status} and not awaiting decision`,
        );
      }

      if (dto.decision === ProductReviewDecision.REJECT) {
        if (!dto.reason?.trim()) {
          throw new TraceabilityRuleException('A rejection reason is required');
        }
        reg.reviewedBy = actor;
        reg.issuedBy = regulator;
        return this.transition(manager, reg, actor, {
          to: ProductRegistrationStatus.REJECTED,
          event: ProductRegistrationEventType.REJECTED,
          reason: dto.reason,
        });
      }

      const issuedOn = today();
      reg.issuedBy = regulator;
      reg.reviewedBy = actor;
      reg.issuedOn = issuedOn;
      // Default 36 months validity for registered products per RICA / RFDA guidelines
      reg.expiresOn = dto.expiresOn ?? addMonths(issuedOn, 36);

      return this.transition(manager, reg, actor, {
        to: ProductRegistrationStatus.APPROVED,
        event: ProductRegistrationEventType.APPROVED,
        reason: dto.reason,
      });
    });
  }

  // ------------------------------------------------------------ shared

  private async require(
    id: number,
    manager?: EntityManager,
  ): Promise<ProductRegistration> {
    const repo = manager
      ? manager.getRepository(ProductRegistration)
      : this.registrations;
    const reg = await repo.findOne({ where: { id } });
    if (!reg) {
      throw new NotFoundEntityException('Product registration', id);
    }
    return reg;
  }

  private async requireOwn(
    organization: Organization,
    id: number,
    manager?: EntityManager,
  ): Promise<ProductRegistration> {
    const reg = await this.require(id, manager);
    if (reg.organizationId !== organization.id) {
      throw new NotFoundEntityException('Product registration', id);
    }
    return reg;
  }

  private async transition(
    manager: EntityManager,
    reg: ProductRegistration,
    actor: User | null,
    change: {
      to: ProductRegistrationStatus;
      event: ProductRegistrationEventType;
      reason?: string | null;
    },
  ): Promise<ProductRegistration> {
    const from = reg.status;
    reg.status = change.to;
    reg.statusReason = change.reason ?? null;
    reg.statusChangedAt = new Date();
    const saved = await manager.save(ProductRegistration, reg);

    await this.log(manager, saved, actor, change.event, {
      from,
      to: change.to,
      notes: change.reason,
    });

    return saved;
  }

  private async log(
    manager: EntityManager,
    reg: ProductRegistration,
    actor: User | null,
    type: ProductRegistrationEventType,
    options?: {
      from?: ProductRegistrationStatus | null;
      to?: ProductRegistrationStatus | null;
      notes?: string | null;
    },
  ): Promise<ProductRegistrationEvent> {
    return manager.save(
      manager.create(ProductRegistrationEvent, {
        productRegistration: reg,
        type,
        actor,
        fromStatus: options?.from ?? null,
        toStatus: options?.to ?? null,
        notes: options?.notes ?? null,
      }),
    );
  }
}
