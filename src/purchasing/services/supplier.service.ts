import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
  DuplicateException,
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { CreateSupplierDto, UpdateSupplierDto } from '../dto/supplier.dto';
import { Supplier } from '../entities/supplier.entity';

/** Org types that may hold a purchasing supplier directory (DR-10 D5). */
const PURCHASING_ORG_TYPES: ReadonlySet<OrganizationType> = new Set([
  OrganizationType.MANUFACTURER,
  OrganizationType.DISTRIBUTOR,
  OrganizationType.RETAILER,
  OrganizationType.SHOP,
]);

@Injectable()
export class SupplierService {
  constructor(
    @InjectRepository(Supplier)
    private readonly suppliers: Repository<Supplier>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
  ) {}

  async create(organization: Organization, dto: CreateSupplierDto): Promise<Supplier> {
    assertPurchasingOrg(organization);

    const code = (dto.code?.trim() || `SUP-${randomUUID().slice(0, 8).toUpperCase()}`);

    const existing = await this.suppliers.findOne({
      where: { organization: { id: organization.id }, code },
    });
    if (existing) {
      throw new DuplicateException(`A supplier with code ${code} already exists`);
    }

    return this.suppliers.save(
      this.suppliers.create({
        organization,
        code,
        name: dto.name.trim(),
        linkedOrganization: await this.resolveLinked(organization, dto.linkedOrganizationId),
        contact: dto.contact ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        active: dto.active ?? true,
      }),
    );
  }

  async list(organization: Organization): Promise<Supplier[]> {
    assertPurchasingOrg(organization);
    return this.suppliers.find({
      where: { organization: { id: organization.id } },
      order: { name: 'ASC' },
    });
  }

  async get(organization: Organization, supplierId: number): Promise<Supplier> {
    assertPurchasingOrg(organization);
    const supplier = await this.suppliers.findOne({ where: { id: supplierId } });
    if (!supplier || supplier.organization.id !== organization.id) {
      throw new NotFoundEntityException('Supplier', supplierId);
    }
    return supplier;
  }

  async update(
    organization: Organization,
    supplierId: number,
    dto: UpdateSupplierDto,
  ): Promise<Supplier> {
    const supplier = await this.get(organization, supplierId);

    if (dto.name !== undefined) supplier.name = dto.name.trim();
    if (dto.contact !== undefined) supplier.contact = dto.contact ?? null;
    if (dto.phone !== undefined) supplier.phone = dto.phone ?? null;
    if (dto.email !== undefined) supplier.email = dto.email ?? null;
    if (dto.active !== undefined) supplier.active = dto.active;
    if (dto.linkedOrganizationId !== undefined) {
      supplier.linkedOrganization = await this.resolveLinked(
        organization,
        dto.linkedOrganizationId,
      );
    }

    return this.suppliers.save(supplier);
  }

  private async resolveLinked(
    buyer: Organization,
    linkedOrganizationId: number | null | undefined,
  ): Promise<Organization | null> {
    if (linkedOrganizationId === undefined || linkedOrganizationId === null) {
      return null;
    }

    const linked = await this.organizations.findOne({
      where: { id: linkedOrganizationId },
    });
    if (!linked) {
      throw new NotFoundEntityException('Organization', linkedOrganizationId);
    }
    if (linked.id === buyer.id) {
      throw new TraceabilityRuleException(
        'A supplier cannot be your own organization',
      );
    }
    return linked;
  }
}

export function assertPurchasingOrg(organization: Organization): void {
  if (!PURCHASING_ORG_TYPES.has(organization.type)) {
    throw new TraceabilityRuleException(
      `Organization type ${organization.type} cannot use purchasing`,
    );
  }
}
