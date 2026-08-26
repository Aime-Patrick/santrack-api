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
import { CreateCustomerDto, UpdateCustomerDto } from '../dto/customer.dto';
import { Customer } from '../entities/customer.entity';
import { CustomerSegment } from '../commerce.enums';
import { Invoice } from '../entities/invoice.entity';
import { Payment } from '../entities/payment.entity';

@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(Invoice)
    private readonly invoices: Repository<Invoice>,
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
  ) {}

  async create(organization: Organization, dto: CreateCustomerDto): Promise<Customer> {
    const code = `CST-${randomUUID().slice(0, 8).toUpperCase()}`;

    const existing = await this.customers.findOne({
      where: { organization: { id: organization.id }, code },
    });
    if (existing) {
      throw new DuplicateException(`A customer with code ${code} already exists`);
    }

    return this.customers.save(
      this.customers.create({
        organization,
        code,
        buyerOrganization: await this.resolveBuyer(organization, dto.buyerOrganizationId),
        name: dto.name.trim(),
        type: dto.type,
        segment: dto.segment ?? CustomerSegment.RETAIL,
        contactPerson: dto.contactPerson ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        address: dto.address ?? null,
        creditLimit: dto.creditLimit == null ? null : String(dto.creditLimit),
        active: dto.active ?? true,
      }),
    );
  }

  async list(organization: Organization): Promise<Customer[]> {
    return this.customers.find({
      where: { organization: { id: organization.id } },
      order: { name: 'ASC' },
    });
  }

  /** Customers are private to an organization; ownership is enforced. */
  async get(organization: Organization, customerId: number): Promise<Customer> {
    const customer = await this.customers.findOne({ where: { id: customerId } });
    if (!customer || customer.organization.id !== organization.id) {
      throw new NotFoundEntityException('Customer', customerId);
    }
    return customer;
  }

  async update(
    organization: Organization,
    customerId: number,
    dto: UpdateCustomerDto,
  ): Promise<Customer> {
    const customer = await this.get(organization, customerId);

    if (dto.name !== undefined) customer.name = dto.name.trim();
    if (dto.type !== undefined) customer.type = dto.type;
    if (dto.segment !== undefined) customer.segment = dto.segment;
    if (dto.contactPerson !== undefined) customer.contactPerson = dto.contactPerson ?? null;
    if (dto.phone !== undefined) customer.phone = dto.phone ?? null;
    if (dto.email !== undefined) customer.email = dto.email ?? null;
    if (dto.address !== undefined) customer.address = dto.address ?? null;
    if (dto.creditLimit !== undefined) {
      customer.creditLimit =
        dto.creditLimit === null ? null : String(dto.creditLimit);
    }
    if (dto.active !== undefined) customer.active = dto.active;
    if (dto.buyerOrganizationId !== undefined) {
      customer.buyerOrganization = await this.resolveBuyer(
        organization,
        dto.buyerOrganizationId,
      );
    }

    return this.customers.save(customer);
  }

  /**
   * Resolves the buying organization, refusing the seller's own.
   *
   * A customer pointing at the seller would make fulfilment a transfer from an
   * organization to itself - which is a relocation, not a hand-off, and would
   * put goods permanently IN_TRANSIT because the sender cannot confirm receipt
   * of its own dispatch. `TransferService.dispatch` refuses the same thing.
   */
  private async resolveBuyer(
    seller: Organization,
    buyerOrganizationId: number | null | undefined,
  ): Promise<Organization | null> {
    if (buyerOrganizationId === undefined || buyerOrganizationId === null) {
      return null;
    }

    const buyer = await this.organizations.findOne({
      where: { id: buyerOrganizationId },
    });
    if (!buyer) {
      throw new NotFoundEntityException('Organization', buyerOrganizationId);
    }
    if (buyer.id === seller.id) {
      throw new TraceabilityRuleException(
        'A customer cannot be your own organization - use a stock relocation to move goods within it',
      );
    }
    return buyer;
  }

  /**
   * A customer statement: every invoice raised against the customer and every
   * payment received, with the running balance after each row (proposal
   * section 6, customer statements).
   */
  async statement(organization: Organization, customerId: number) {
    const customer = await this.get(organization, customerId);

    const invoices = await this.invoices.find({
      where: { organization: { id: organization.id }, customer: { id: customer.id } },
    });
    const payments = await this.payments.find({
      where: { organization: { id: organization.id }, customer: { id: customer.id } },
    });

    type RawEntry = {
      date: string;
      type: 'INVOICE' | 'PAYMENT';
      reference: string;
      amount: number;
    };

    const raw: RawEntry[] = [
      ...invoices.map((invoice) => ({
        date: invoice.issuedOn ?? invoice.createdAt.toISOString().slice(0, 10),
        type: 'INVOICE' as const,
        reference: invoice.invoiceNumber,
        amount: parseFloat(invoice.totalAmount ?? '0'),
      })),
      ...payments.map((payment) => ({
        date: payment.paidOn ?? payment.createdAt.toISOString().slice(0, 10),
        type: 'PAYMENT' as const,
        reference: payment.paymentNumber,
        amount: -parseFloat(payment.amount),
      })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const entries: StatementEntry[] = [];
    let balance = 0;

    for (const row of raw) {
      balance += row.amount;
      entries.push({ ...row, balance });
    }

    return { customer, balance, entries };
  }
}

interface StatementEntry {
  date: string;
  type: 'INVOICE' | 'PAYMENT';
  reference: string;
  amount: number;
  balance: number;
}