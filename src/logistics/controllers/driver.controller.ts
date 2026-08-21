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
import { CreateDriverDto, UpdateDriverDto } from '../dto/driver.dto';
import { Driver } from '../entities/driver.entity';
import { DriverService } from '../services/driver.service';

@ApiTags('Logistics - Drivers')
@ApiBearerAuth()
@Controller('api/logistics/drivers')
export class DriverController {
  constructor(private readonly drivers: DriverService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_LOGISTICS)
  async create(
    @ActingOrg() organization: Organization,
    @Body() dto: CreateDriverDto,
  ) {
    return describe(await this.drivers.create(organization, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    const rows = await this.drivers.list(organization);
    return { total: rows.length, content: rows.map(describe) };
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.drivers.get(organization, id));
  }

  @Patch(':id')
  @RequireCapability(Capability.MANAGE_LOGISTICS)
  async update(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDriverDto,
  ) {
    return describe(await this.drivers.update(organization, id, dto));
  }
}

function describe(driver: Driver) {
  return {
    id: driver.id,
    transporterId: driver.transporter.id,
    transporterName: driver.transporter.name,
    name: driver.name,
    licenseNumber: driver.licenseNumber,
    phone: driver.phone,
    active: driver.active,
    createdAt: driver.createdAt,
  };
}