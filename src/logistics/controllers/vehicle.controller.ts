import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import {
  ActingOrg,
  RequireCapability,
} from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateVehicleDto, UpdateVehicleDto } from '../dto/vehicle.dto';
import { Vehicle } from '../entities/vehicle.entity';
import { VehicleService } from '../services/vehicle.service';

@ApiTags('Logistics - Vehicles')
@ApiBearerAuth()
@Controller('api/logistics/vehicles')
export class VehicleController {
  constructor(private readonly vehicles: VehicleService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_LOGISTICS)
  async create(
    @ActingOrg() organization: Organization,
    @Body() dto: CreateVehicleDto,
  ) {
    return describe(await this.vehicles.create(organization, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    const rows = await this.vehicles.list(organization);
    return { total: rows.length, content: rows.map(describe) };
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.vehicles.get(organization, id));
  }

  @Patch(':id')
  @RequireCapability(Capability.MANAGE_LOGISTICS)
  async update(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVehicleDto,
  ) {
    return describe(await this.vehicles.update(organization, id, dto));
  }
}

function describe(vehicle: Vehicle) {
  return {
    id: vehicle.id,
    transporterId: vehicle.transporter.id,
    transporterName: vehicle.transporter.name,
    registrationNumber: vehicle.registrationNumber,
    type: vehicle.type,
    capacity: vehicle.capacity === null ? null : Number(vehicle.capacity),
    active: vehicle.active,
    createdAt: vehicle.createdAt,
  };
}