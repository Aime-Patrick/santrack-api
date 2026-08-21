import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { CurrentUser, ActingOrg, RequireCapability } from '../../common/decorators';
import { User } from '../../auth/entities/user.entity';
import { Organization } from '../../organization/entities/organization.entity';
import {
  AllocateMaterialsDto,
  AmendQuantityDto,
  CancelProductionDto,
  CompleteProductionDto,
  CreateProductionOrderDto,
  IssueMaterialsDto,
  StartProductionDto,
} from '../dto/production-order.dto';
import { ProductionEvent } from '../entities/production-event.entity';
import {
  ProductionOrder,
  ProductionOrderMaterial,
} from '../entities/production-order.entity';
import { ProductionOrderStatus } from '../manufacturing.enums';
import { ProductionService } from '../services/production.service';

@ApiTags('Manufacturing - Production Orders')
@ApiBearerAuth()
@Controller('api/production-orders')
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Post()
  @RequireCapability(Capability.RUN_PRODUCTION)
  async create(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: CreateProductionOrderDto,
  ) {
    return describeOrder(await this.production.create(organization, actor, dto));
  }

  @Post(':id/start')
  @HttpCode(200)
  @RequireCapability(Capability.RUN_PRODUCTION)
  async start(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto?: StartProductionDto,
  ) {
    return describeOrder(await this.production.start(organization, actor, id, dto));
  }

  @Post(':id/materials/allocate')
  @HttpCode(200)
  @RequireCapability(Capability.RUN_PRODUCTION)
  async allocate(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AllocateMaterialsDto,
  ) {
    return describeOrder(await this.production.allocate(organization, actor, id, dto));
  }

  @Post(':id/materials/issue')
  @HttpCode(200)
  @RequireCapability(Capability.RUN_PRODUCTION)
  async issue(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: IssueMaterialsDto,
  ) {
    return describeOrder(await this.production.issue(organization, actor, id, dto));
  }

  @Post(':id/amend-quantity')
  @HttpCode(200)
  @RequireCapability(Capability.RUN_PRODUCTION)
  async amendQuantity(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AmendQuantityDto,
  ) {
    return describeOrder(await this.production.amendQuantity(organization, actor, id, dto));
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequireCapability(Capability.RUN_PRODUCTION)
  async complete(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto?: CompleteProductionDto,
  ) {
    return describeOrder(await this.production.complete(organization, actor, id, dto));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequireCapability(Capability.RUN_PRODUCTION)
  async cancel(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelProductionDto,
  ) {
    return describeOrder(await this.production.cancel(organization, actor, id, dto));
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequireCapability(Capability.RUN_PRODUCTION)
  async close(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describeOrder(await this.production.close(organization, actor, id));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @ActingOrg() organization: Organization,
    @Query('status') status?: string,
    @Query('page') page = '0',
    @Query('size') size = '20',
  ) {
    const result = await this.production.list(
      organization,
      status ? (status as ProductionOrderStatus) : undefined,
      parseInt(page, 10),
      parseInt(size, 10),
    );
    return {
      ...result,
      content: result.content.map((order) => describeOrder(order)),
    };
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const order = await this.production.get(organization, id);
    const [materials, events, cost] = await Promise.all([
      this.production.materialsOf(order.id),
      this.production.eventsOf(order.id),
      this.production.costOf(order.id),
    ]);
    return describeOrder(order, { materials, events, cost });
  }
}

export function describeOrder(
  order: ProductionOrder,
  extras?: {
    materials?: ProductionOrderMaterial[];
    events?: ProductionEvent[];
    cost?: { materialCost: number; costPerUnit: number | null };
  },
) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    productId: order.product.id,
    productName: order.product.name,
    bomId: order.bom?.id ?? null,
    bomVersion: order.bom?.version ?? null,
    machineId: order.machine?.id ?? null,
    // Which site is running this (DR-02). Carried onto the batch, so a recall
    // can name the plant without walking back through the order.
    facilityId: order.facilityId ?? null,
    facilityName: order.facility?.name ?? null,
    machineCode: order.machine?.code ?? null,
    plannedQuantity: order.plannedQuantity,
    producedQuantity: order.producedQuantity,
    status: order.status,
    scheduledStartOn: order.scheduledStartOn,
    scheduledEndOn: order.scheduledEndOn,
    startedAt: order.startedAt,
    completedAt: order.completedAt,
    batchId: order.batch?.id ?? null,
    batchCode: order.batch?.batchCode ?? null,
    notes: order.notes,
    createdAt: order.createdAt,
    materials: extras?.materials?.map(describeMaterialRow),
    events: extras?.events?.map(describeEvent),
    cost: extras?.cost,
  };
}

export function describeMaterialRow(row: ProductionOrderMaterial) {
  return {
    materialId: row.material.id,
    materialCode: row.material.code,
    materialName: row.material.name,
    unitOfMeasure: row.material.unitOfMeasure,
    allocatedQuantity: Number(row.allocatedQuantity),
    consumedQuantity: Number(row.consumedQuantity),
    wastagePercent: Number(row.wastagePercent),
  };
}

export function describeEvent(event: ProductionEvent) {
  return {
    type: event.type,
    quantity: event.quantity === null ? null : Number(event.quantity),
    previousQuantity:
      'previousQuantity' in event && event.previousQuantity !== null
        ? Number(event.previousQuantity)
        : undefined,
    actorName: event.actor?.fullName ?? null,
    notes: event.notes,
    recordedAt: event.recordedAt,
  };
}
