import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import {
  ActingOrg,
  CurrentUser,
  RequireCapability,
} from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import {
  IssueInvoiceDto,
  RecordInvoicePaymentDto,
} from '../dto/invoice.dto';
import { Invoice } from '../entities/invoice.entity';
import { Payment } from '../entities/payment.entity';
import { InvoiceService } from '../services/invoice.service';

@ApiTags('Commerce - Invoices & Payments')
@ApiBearerAuth()
@Controller('api/commerce/invoices')
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async create(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: IssueInvoiceDto,
  ) {
    return describe(await this.invoices.create(organization, actor, dto));
  }

  @Post(':id/issue')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async issue(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.invoices.issue(organization, id));
  }

  @Post(':id/void')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async void(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.invoices.void(organization, id));
  }

  @Post(':id/pay')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async pay(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RecordInvoicePaymentDto,
  ) {
    const { payment, invoice } = await this.invoices.recordPayment(
      organization,
      actor,
      { ...dto, invoiceId: id },
    );
    return { ...describe(invoice), payments: [describePayment(payment)] };
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @ActingOrg() organization: Organization,
    @Query('page') page = '0',
    @Query('size') size = '20',
  ) {
    const result = await this.invoices.list(
      organization,
      parseInt(page, 10) || 0,
      Math.min(parseInt(size, 10) || 20, 100),
    );
    const content = await Promise.all(
      result.content.map(async (invoice) => ({
        ...describe(invoice),
        payments: (await this.invoices.paymentsOf(invoice.id)).map(describePayment),
      })),
    );
    return { ...result, content };
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const invoice = await this.invoices.get(organization, id);
    return {
      ...describe(invoice),
      lines: await this.invoices.linesOf(invoice.id),
      payments: (await this.invoices.paymentsOf(invoice.id)).map(describePayment),
    };
  }
}

function describe(invoice: Invoice) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    customerId: invoice.customer.id,
    customerName: invoice.customer.name,
    salesOrderId: invoice.salesOrder?.id ?? null,
    salesOrderNumber: invoice.salesOrder?.orderNumber ?? null,
    issuedOn: invoice.issuedOn,
    dueOn: invoice.dueOn,
    subtotal: invoice.subtotal === null ? null : Number(invoice.subtotal),
    taxPercent: invoice.taxPercent === null ? null : Number(invoice.taxPercent),
    totalAmount: invoice.totalAmount === null ? null : Number(invoice.totalAmount),
    amountPaid: Number(invoice.amountPaid),
    balance:
      invoice.totalAmount === null
        ? null
        : Number((parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid)).toFixed(2)),
    notes: invoice.notes,
    createdAt: invoice.createdAt,
  };
}

function describePayment(payment: Payment) {
  return {
    id: payment.id,
    paymentNumber: payment.paymentNumber,
    invoiceId: payment.invoice.id,
    invoiceNumber: payment.invoice.invoiceNumber,
    amount: Number(payment.amount),
    method: payment.method,
    reference: payment.reference,
    paidOn: payment.paidOn,
    createdAt: payment.createdAt,
  };
}