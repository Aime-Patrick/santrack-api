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
  CancelShipmentDto,
  CreateShipmentDto,
  DeliverShipmentDto,
} from '../dto/shipment.dto';
import { Shipment, ShipmentEvent } from '../entities/shipment.entity';
import { ShipmentStatus } from '../logistics.enums';
import { ShipmentService } from '../services/shipment.service';

@ApiTags('Logistics - Shipments')
@ApiBearerAuth()
@Controller('api/logistics/shipments')
export class ShipmentController {
  constructor(private readonly shipments: ShipmentService) {}

  /** Books the logistics of a dispatch the caller's organization sent. */
  @Post()
  @RequireCapability(Capability.MANAGE_LOGISTICS)
  async create(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: CreateShipmentDto,
  ) {
    return describe(await this.shipments.create(organization, actor, dto));
  }

  @Post(':id/depart')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_LOGISTICS)
  async depart(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.shipments.depart(organization, actor, id));
  }

  @Post(':id/deliver')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_LOGISTICS)
  async deliver(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeliverShipmentDto,
  ) {
    return describe(await this.shipments.deliver(organization, actor, id, dto));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_LOGISTICS)
  async cancel(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelShipmentDto,
  ) {
    return describe(await this.shipments.cancel(organization, actor, id, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @ActingOrg() organization: Organization,
    @Query('status') status?: string,
    @Query('page') page = '0',
    @Query('size') size = '20',
  ) {
    const result = await this.shipments.list(
      organization,
      asStatus(status),
      parseInt(page, 10) || 0,
      Math.min(parseInt(size, 10) || 20, 100),
    );
    return { ...result, content: result.content.map(describe) };
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.shipments.get(organization, id));
  }

  @Get(':id/events')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async events(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const rows = await this.shipments.eventsOf(organization, id);
    return { total: rows.length, content: rows.map(describeEvent) };
  }
}

function asStatus(value: string | undefined): ShipmentStatus | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  return Object.values(ShipmentStatus).includes(upper as ShipmentStatus)
    ? (upper as ShipmentStatus)
    : undefined;
}

function describe(shipment: Shipment) {
  return {
    id: shipment.id,
    shipmentNumber: shipment.shipmentNumber,
    status: shipment.status,
    organizationId: shipment.organization.id,
    transferId: shipment.transfer.id,
    transferReference: shipment.transfer.reference,
    transporterId: shipment.transporter.id,
    transporterName: shipment.transporter.name,
    vehicleId: shipment.vehicle?.id ?? null,
    vehicleRegistration: shipment.vehicle?.registrationNumber ?? null,
    driverId: shipment.driver?.id ?? null,
    driverName: shipment.driver?.name ?? null,
    routeId: shipment.route?.id ?? null,
    routeName: shipment.route?.name ?? null,
    destinationOrganizationId: shipment.destinationOrganization?.id ?? null,
    destinationOrganizationName: shipment.destinationOrganization?.name ?? null,
    scheduledDepartureOn: shipment.scheduledDepartureOn,
    scheduledDeliveryOn: shipment.scheduledDeliveryOn,
    departedAt: shipment.departedAt,
    deliveredAt: shipment.deliveredAt,
    podRecipientName: shipment.podRecipientName,
    podNotes: shipment.podNotes,
    createdAt: shipment.createdAt,
    updatedAt: shipment.updatedAt,
  };
}

function describeEvent(event: ShipmentEvent) {
  return {
    id: event.id,
    type: event.type,
    actorName: event.actor?.fullName ?? null,
    notes: event.notes,
    recordedAt: event.recordedAt,
  };
}