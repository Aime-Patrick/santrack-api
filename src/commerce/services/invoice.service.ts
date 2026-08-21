import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import {
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { SequenceService } from '../../common/sequence.service';
import { Organization } from '../../organization/entities/organization.entity';
import {
  InvoiceStatus,
  PaymentMethod,
  canIssueInvoice,
  canVoidInvoice,
  computeTotals,
  round2,
} from '../commerce.enums';
import { IssueInvoiceDto, RecordPaymentDto } from '../dto/invoice.dto';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { Payment } from '../entities/payment.entity';
import { SalesOrder, SalesOrderLine } from '../entities/sales-order.entity';

@Injectable()
export class InvoiceService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Invoice)
    private readonly invoices: Repository<Invoice>,
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(SalesOrder)
    private readonly orders: Repository<SalesOrder>,
    @InjectRepository(SalesOrderLine)
    private readonly orderLines: Repository<SalesOrderLine>,
    private readonly sequence: SequenceService,
  ) {}

  /**
   * Raises a draft invoice from a confirmed order, or as a standalone bill.
   * Amounts default to the order's own totals so they stay consistent.
   */
  async create(
    organization: Organization,
    actor: User,
    dto: IssueInvoiceDto,
  ): Promise<Invoice> {
    return this.dataSource.transaction(async (manager) => {
      const customer = dto.salesOrderId
        ? await this.requireOrderCustomer(manager, organization, dto.salesOrderId)
        : null;
      if (!customer) {
        throw new TraceabilityRuleException(
          'An invoice needs a sales order to bill against',
        );
      }

      const order = await manager.findOne(SalesOrder, {
        where: { id: dto.salesOrderId },
      });

      const totals = dto.subtotal
        ? {
            subtotal: dto.subtotal,
            total: dto.totalAmount ?? dto.subtotal,
          }
        : order
          ? {
              subtotal: order.subtotal ?? '0',
              total: order.totalAmount ?? '0',
            }
          : { subtotal: '0', total: '0' };

      const invoiceNumber = await this.nextNumber(manager, 'INV');
      const invoice = await manager.save(
        manager.create(Invoice, {
          invoiceNumber,
          organization,
          customer,
          salesOrder: order,
          status: InvoiceStatus.DRAFT,
          issuedOn: dto.issuedOn ?? null,
          dueOn: dto.dueOn ?? null,
          subtotal: totals.subtotal,
          taxPercent: order?.taxPercent ?? dto.taxPercent ?? null,
          totalAmount: totals.total,
          amountPaid: '0',
          notes: dto.notes ?? null,
          createdBy: actor,
        }),
      );

      return invoice;
    });
  }

  async issue(organization: Organization, invoiceId: number): Promise<Invoice> {
    return this.dataSource.transaction(async (manager) => {
      const invoice = await this.requireOwned(manager, organization, invoiceId);
      if (!canIssueInvoice(invoice.status)) {
        throw new TraceabilityRuleException(
          `Invoice ${invoice.invoiceNumber} is ${invoice.status} and cannot be issued`,
        );
      }
      invoice.status = InvoiceStatus.ISSUED;
      return manager.save(Invoice, invoice);
    });
  }

  async void(organization: Organization, invoiceId: number): Promise<Invoice> {
    return this.dataSource.transaction(async (manager) => {
      const invoice = await this.requireOwned(manager, organization, invoiceId);
      if (!canVoidInvoice(invoice.status)) {
        throw new TraceabilityRuleException(
          `Invoice ${invoice.invoiceNumber} is ${invoice.status} and cannot be voided`,
        );
      }
      if (parseFloat(invoice.amountPaid) > 0) {
        throw new TraceabilityRuleException(
          `Invoice ${invoice.invoiceNumber} has payments against it and cannot be voided`,
        );
      }
      invoice.status = InvoiceStatus.VOID;
      return manager.save(Invoice, invoice);
    });
  }

  /**
   * A payment received against an invoice advances it towards PAID and feeds
   * the customer statement. The amount must not exceed what is still owed.
   */
  async recordPayment(
    organization: Organization,
    actor: User,
    dto: RecordPaymentDto,
  ): Promise<{ payment: Payment; invoice: Invoice }> {
    return this.dataSource.transaction(async (manager) => {
      const invoice = await this.requireOwned(manager, organization, dto.invoiceId);
      if (invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.VOID) {
        throw new TraceabilityRuleException(
          `Invoice ${invoice.invoiceNumber} is ${invoice.status} and cannot take a payment`,
        );
      }

      // A payment has to be a positive amount. `@IsNumberString` admits "-100"
      // and "NaN" is what a non-numeric body would produce, and neither trips
      // the overpayment check below - a negative one would quietly reduce what
      // the customer has paid.
      const amount = parseFloat(dto.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new TraceabilityRuleException(
          'A payment must be a positive amount',
        );
      }

      const total = parseFloat(invoice.totalAmount ?? '0');
      const paid = parseFloat(invoice.amountPaid ?? '0');
      if (round2(amount + paid) > round2(total)) {
        throw new TraceabilityRuleException(
          `Payment of ${dto.amount} would overpay ${invoice.invoiceNumber}, which is owed ${round2(round2(total) - paid)}`,
        );
      }

      const paymentNumber = await this.nextNumber(manager, 'PAY');
      const payment = await manager.save(
        manager.create(Payment, {
          paymentNumber,
          organization,
          customer: invoice.customer,
          invoice,
          amount: dto.amount,
          method: dto.method as PaymentMethod,
          reference: dto.reference ?? null,
          receivedBy: actor,
          paidOn: dto.paidOn ?? null,
        }),
      );

      const newPaid = round2(paid + amount);
      invoice.amountPaid = String(newPaid);
      invoice.status =
        newPaid >= round2(total) ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;
      await manager.save(Invoice, invoice);

      return { payment, invoice };
    });
  }

  async list(organization: Organization, page: number, size: number) {
    const [content, total] = await this.invoices.findAndCount({
      where: { organization: { id: organization.id } },
      order: { createdAt: 'DESC' },
      skip: page * size,
      take: size,
    });
    return { content, total, page, size };
  }

  async get(organization: Organization, invoiceId: number): Promise<Invoice> {
    const invoice = await this.invoices.findOne({ where: { id: invoiceId } });
    if (!invoice || invoice.organization.id !== organization.id) {
      throw new NotFoundEntityException('Invoice', invoiceId);
    }
    return invoice;
  }

  async paymentsOf(invoiceId: number): Promise<Payment[]> {
    return this.payments.find({
      where: { invoice: { id: invoiceId } },
      order: { createdAt: 'DESC' },
    });
  }

  async linesOf(invoiceId: number): Promise<SalesOrderLine[]> {
    const invoice = await this.invoices.findOne({ where: { id: invoiceId } });
    if (!invoice?.salesOrder) return [];
    return this.orderLines.find({
      where: { order: { id: invoice.salesOrder.id } },
      order: { id: 'ASC' },
    });
  }

  private async requireOrderCustomer(
    manager: EntityManager,
    organization: Organization,
    orderId: number,
  ): Promise<Customer> {
    const order = await manager.findOne(SalesOrder, { where: { id: orderId } });
    if (!order || order.organization.id !== organization.id) {
      throw new NotFoundEntityException('SalesOrder', orderId);
    }
    if (order.status !== 'CONFIRMED') {
      throw new TraceabilityRuleException(
        `Order ${order.orderNumber} is ${order.status}; only a confirmed order can be invoiced`,
      );
    }
    return order.customer;
  }

  private async requireOwned(
    manager: EntityManager,
    organization: Organization,
    invoiceId: number,
  ): Promise<Invoice> {
    const invoice = await manager.findOne(Invoice, { where: { id: invoiceId } });
    if (!invoice || invoice.organization.id !== organization.id) {
      throw new NotFoundEntityException('Invoice', invoiceId);
    }
    return invoice;
  }

  private async nextNumber(manager: EntityManager, prefix: string): Promise<string> {
    const value = await this.sequence.next(manager, prefix);
    return `${prefix}-${String(value).padStart(6, '0')}`;
  }
}