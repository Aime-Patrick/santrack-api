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
  CreatePurchaseOrderDto,
  ReceivePurchaseOrderDto,
} from '../dto/purchase-order.dto';
import { PurchaseOrder, PurchaseOrderLine } from '../entities/purchase-order.entity';
import { PurchaseOrderService } from '../services/purchase-order.service';

@ApiTags('Purchasing - Orders')
@ApiBearerAuth()
@Controller('api/purchasing/orders')
export class PurchaseOrderController {
  constructor(private readonly orders: PurchaseOrderService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async create(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    const order = await this.orders.create(organization, actor, dto);
    return describe(order, await this.orders.linesOf(order.id));
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async send(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const order = await this.orders.send(organization, id);
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

  @Post(':id/receive')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CLIENTS)
  async receive(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReceivePurchaseOrderDto,
  ) {
    const order = await this.orders.receive(organization, id, dto);
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

function describe(order: PurchaseOrder, lines: PurchaseOrderLine[]) {
  return {
    id: order.id,
    poNumber: order.poNumber,
    status: order.status,
    supplierId: order.supplier.id,
    supplierName: order.supplier.name,
    supplierCode: order.supplier.code,
    linkedOrganizationId: order.supplier.linkedOrganization?.id ?? null,
    expectedOn: order.expectedOn,
    subtotal: order.subtotal === null ? null : Number(order.subtotal),
    taxPercent: order.taxPercent === null ? null : Number(order.taxPercent),
    totalAmount: order.totalAmount === null ? null : Number(order.totalAmount),
    notes: order.notes,
    createdAt: order.createdAt,
    lines: lines.map((line) => ({
      id: line.id,
      productId: line.product.id,
      productName: line.product.name,
      description: line.description,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      lineTotal: line.lineTotal === null ? null : Number(line.lineTotal),
      receivedQuantity: Number(line.receivedQuantity ?? 0),
    })),
  };
}
