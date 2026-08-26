import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { NotFoundEntityException, TraceabilityRuleException } from '../../common/errors';
import { SequenceService } from '../../common/sequence.service';
import { Organization } from '../../organization/entities/organization.entity';
import { Product } from '../../product/entities/product.entity';
import {
  salesUnitPermitted,
  sellableUnits,
} from '../../product/sales-unit';
import {
  QuotationStatus,
  canAcceptQuotation,
  canExpireQuotation,
  canRejectQuotation,
  canSendQuotation,
  computeTotals,
  lineTotal,
} from '../commerce.enums';
import {
  CreateQuotationDto,
  QuotationLineDto,
  RejectQuotationDto,
} from '../dto/quotation.dto';
import { Customer } from '../entities/customer.entity';
import { Quotation, QuotationLine } from '../entities/quotation.entity';

@Injectable()
export class QuotationService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Quotation)
    private readonly quotations: Repository<Quotation>,
    @InjectRepository(QuotationLine)
    private readonly quotationLines: Repository<QuotationLine>,
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    private readonly sequence: SequenceService,
  ) {}

  async create(
    organization: Organization,
    actor: User,
    dto: CreateQuotationDto,
  ): Promise<Quotation> {
    return this.dataSource.transaction(async (manager) => {
      const customer = await this.requireCustomer(manager, organization, dto.customerId);
      const quotationNumber = await this.nextNumber(manager, 'QT');

      const totals = computeTotals(dto.lines.map(toAmountLine), parseFloat(dto.taxPercent ?? '0'));

      const quotation = await manager.save(
        manager.create(Quotation, {
          quotationNumber,
          organization,
          customer,
          status: QuotationStatus.DRAFT,
          validUntilOn: dto.validUntilOn ?? null,
          subtotal: totals.subtotal,
          taxPercent: dto.taxPercent ?? null,
          totalAmount: totals.total,
          notes: dto.notes ?? null,
          createdBy: actor,
        }),
      );

      for (const line of dto.lines) {
        await this.saveLine(manager, quotation.id, line);
      }

      return quotation;
    });
  }

  async send(organization: Organization, quotationId: number): Promise<Quotation> {
    return this.dataSource.transaction(async (manager) => {
      const quotation = await this.requireOwned(manager, organization, quotationId);
      if (!canSendQuotation(quotation.status)) {
        throw new TraceabilityRuleException(
          `Quotation ${quotation.quotationNumber} is ${quotation.status} and cannot be sent`,
        );
      }
      quotation.status = QuotationStatus.SENT;
      return manager.save(Quotation, quotation);
    });
  }

  async accept(organization: Organization, quotationId: number): Promise<Quotation> {
    return this.dataSource.transaction(async (manager) => {
      const quotation = await this.requireOwned(manager, organization, quotationId);
      if (!canAcceptQuotation(quotation.status)) {
        throw new TraceabilityRuleException(
          `Quotation ${quotation.quotationNumber} is ${quotation.status} and cannot be accepted`,
        );
      }
      quotation.status = QuotationStatus.ACCEPTED;
      return manager.save(Quotation, quotation);
    });
  }

  async reject(
    organization: Organization,
    quotationId: number,
    dto: RejectQuotationDto,
  ): Promise<Quotation> {
    return this.dataSource.transaction(async (manager) => {
      const quotation = await this.requireOwned(manager, organization, quotationId);
      if (!canRejectQuotation(quotation.status)) {
        throw new TraceabilityRuleException(
          `Quotation ${quotation.quotationNumber} is ${quotation.status} and cannot be rejected`,
        );
      }
      quotation.status = QuotationStatus.REJECTED;
      quotation.notes = [quotation.notes, `Rejected: ${dto.reason}`]
        .filter(Boolean)
        .join(' | ');
      return manager.save(Quotation, quotation);
    });
  }

  async expire(organization: Organization, quotationId: number): Promise<Quotation> {
    return this.dataSource.transaction(async (manager) => {
      const quotation = await this.requireOwned(manager, organization, quotationId);
      if (!canExpireQuotation(quotation.status)) {
        throw new TraceabilityRuleException(
          `Quotation ${quotation.quotationNumber} is ${quotation.status} and cannot expire`,
        );
      }
      quotation.status = QuotationStatus.EXPIRED;
      return manager.save(Quotation, quotation);
    });
  }

  async list(organization: Organization, page: number, size: number) {
    const [content, total] = await this.quotations.findAndCount({
      where: { organization: { id: organization.id } },
      order: { createdAt: 'DESC' },
      skip: page * size,
      take: size,
    });
    return { content, total, page, size };
  }

  async get(organization: Organization, quotationId: number): Promise<Quotation> {
    const quotation = await this.quotations.findOne({ where: { id: quotationId } });
    if (!quotation || quotation.organization.id !== organization.id) {
      throw new NotFoundEntityException('Quotation', quotationId);
    }
    return quotation;
  }

  async linesOf(quotationId: number): Promise<QuotationLine[]> {
    return this.quotationLines.find({
      where: { quotation: { id: quotationId } },
      order: { id: 'ASC' },
    });
  }

  private async saveLine(
    manager: EntityManager,
    quotationId: number,
    line: QuotationLineDto,
  ): Promise<QuotationLine> {
    const product = await manager.findOne(Product, { where: { id: line.productId } });
    if (!product) {
      throw new NotFoundEntityException('Product', line.productId);
    }

    const requested = parseFloat(line.requestedQuantity);
    const salesUnit = resolveSalesUnit(product, line.salesUnit);
    assertSalesUnit(product, salesUnit, requested);

    const total = lineTotal({
      quantity: requested,
      unitPrice: parseFloat(line.unitPrice),
    });
    return manager.save(
      manager.create(QuotationLine, {
        quotation: { id: quotationId } as Quotation,
        product,
        description: line.description ?? product.name,
        requestedQuantity: line.requestedQuantity,
        salesUnit,
        unitPrice: line.unitPrice,
        lineTotal: String(total),
      }),
    );
  }

  private async requireCustomer(
    manager: EntityManager,
    organization: Organization,
    customerId: number,
  ): Promise<Customer> {
    const customer = await manager.findOne(Customer, { where: { id: customerId } });
    if (!customer || customer.organization.id !== organization.id) {
      throw new NotFoundEntityException('Customer', customerId);
    }
    return customer;
  }

  private async requireOwned(
    manager: EntityManager,
    organization: Organization,
    quotationId: number,
  ): Promise<Quotation> {
    const quotation = await manager.findOne(Quotation, { where: { id: quotationId } });
    if (!quotation || quotation.organization.id !== organization.id) {
      throw new NotFoundEntityException('Quotation', quotationId);
    }
    return quotation;
  }

  private async nextNumber(manager: EntityManager, prefix: string): Promise<string> {
    const value = await this.sequence.next(manager, prefix);
    return `${prefix}-${String(value).padStart(6, '0')}`;
  }
}

function toAmountLine(line: QuotationLineDto) {
  return {
    quantity: parseFloat(line.requestedQuantity),
    unitPrice: parseFloat(line.unitPrice),
  };
}

function resolveSalesUnit(
  product: Product,
  requested: string | undefined,
): string | null {
  const offered = sellableUnits(product);
  if (offered.length === 0) {
    return requested?.trim() || null;
  }
  return (requested?.trim() || product.baseUnit || offered[0]) ?? null;
}

function assertSalesUnit(
  product: Product,
  salesUnit: string | null,
  requestedQuantity: number,
): void {
  const offered = sellableUnits(product);
  if (offered.length === 0) {
    if (salesUnit) {
      const msg = salesUnitPermitted(product, salesUnit, requestedQuantity);
      if (msg !== true) {
        throw new TraceabilityRuleException(msg);
      }
    }
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
      throw new TraceabilityRuleException(
        `An order line for ${product.name} needs a quantity above zero.`,
      );
    }
    return;
  }

  const msg = salesUnitPermitted(product, salesUnit ?? '', requestedQuantity);
  if (msg !== true) {
    throw new TraceabilityRuleException(msg);
  }
}
