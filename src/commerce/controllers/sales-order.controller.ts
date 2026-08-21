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
import { CreateSalesOrderDto } from '../dto/quotation.dto';
import { SalesOrder, SalesOrderLine } from '../entities/sales-order.entity';
import { SalesOrderService } from '../services/sales-order.service';

@ApiTags('Commerce - Sales Orders')
@ApiBearerAuth()
@Controller('api/commerce/orders')
export class SalesOrderController {
  constructor(private readonly orders: SalesOrderService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async create(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: CreateSalesOrderDto,
  ) {
    const order = await this.orders.create(organization, actor, dto);
    return describe(order, await this.orders.linesOf(order.id));
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async confirm(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const order = await this.orders.confirm(organization, id);
    return describe(order, await this.orders.linesOf(order.id));
  }

  @Post(':id/fulfil')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async fulfil(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const order = await this.orders.fulfil(organization, id);
    return describe(order, await this.orders.linesOf(order.id));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async cancel(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const order = await this.orders.cancel(organization, id);
    return describe(order, await this.orders.linesOf(order.id));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @ActingOrg() organization: Organization,
    @Query('page') page = '0',
    @Query('size') size = '20',
  ) {
    const result = await this.orders.list(
      organization,
      parseInt(page, 10) || 0,
      Math.min(parseInt(size, 10) || 20, 100),
    );
    const content = await Promise.all(
      result.content.map(async (order) =>
        describe(order, await this.orders.linesOf(order.id)),
      ),
    );
    return { ...result, content };
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const order = await this.orders.get(organization, id);
    return describe(order, await this.orders.linesOf(order.id));
  }
}

function describe(order: SalesOrder, lines: SalesOrderLine[]) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    customerId: order.customer.id,
    customerName: order.customer.name,
    quotationId: order.quotation?.id ?? null,
    quotationNumber: order.quotation?.quotationNumber ?? null,
    requestedDeliveryOn: order.requestedDeliveryOn,
    subtotal: order.subtotal === null ? null : Number(order.subtotal),
    taxPercent: order.taxPercent === null ? null : Number(order.taxPercent),
    totalAmount: order.totalAmount === null ? null : Number(order.totalAmount),
    notes: order.notes,
    /**
     * How the goods left. A registered buyer gets a transfer to confirm; an
     * off-platform customer gets a sale, because there is nobody downstream to
     * confirm anything. Exactly one is set once the order is fulfilled.
     */
    transferId: order.transferId,
    saleId: order.saleId,
    createdAt: order.createdAt,
    lines: lines.map((line) => ({
      id: line.id,
      productId: line.product.id,
      productName: line.product.name,
      description: line.description,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      lineTotal: line.lineTotal === null ? null : Number(line.lineTotal),
    })),
  };
}