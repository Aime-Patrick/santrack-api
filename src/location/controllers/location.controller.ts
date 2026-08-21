import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { ActingOrg, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateLocationDto } from '../dto/location.dto';
import { Location } from '../entities/location.entity';
import { LocationService } from '../services/location.service';

@ApiTags('Locations')
@ApiBearerAuth()
@Controller('api/locations')
export class LocationController {
  constructor(private readonly locations: LocationService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_CATALOG)
  async create(
    @ActingOrg() organization: Organization,
    @Body() dto: CreateLocationDto,
  ) {
    return describe(await this.locations.create(organization, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    return (await this.locations.list(organization)).map(describe);
  }

  @Put(':id')
  @RequireCapability(Capability.MANAGE_CATALOG)
  async update(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateLocationDto,
  ) {
    return describe(await this.locations.update(organization, id, dto));
  }
}

function describe(location: Location) {
  return {
    id: location.id,
    name: location.name,
    /** Printed on the bay label and scanned to address a movement. */
    code: location.code,
    type: location.type,
    address: location.address,
    active: location.active,
    organizationId: location.organization.id,
  };
}
