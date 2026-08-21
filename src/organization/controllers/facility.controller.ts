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
import { ActingOrg, RequireCapability } from '../../common/decorators';
import { CreateFacilityDto, UpdateFacilityDto } from '../dto/facility.dto';
import { Facility } from '../entities/facility.entity';
import { Organization } from '../entities/organization.entity';
import { FacilityService } from '../services/facility.service';

/**
 * The sites an organization operates (DR-02, DR-07 WU-1).
 *
 * Reading is an operations question — anyone who can see production can see
 * which plants exist. Opening or closing one is a catalogue decision about the
 * shape of the business, so it sits with `MANAGE_CATALOG` alongside products
 * and locations.
 */
@ApiTags('Facilities')
@ApiBearerAuth()
@Controller('api/facilities')
export class FacilityController {
  constructor(private readonly facilities: FacilityService) {}

  /** Your own sites. Another business's premises are not listed. */
  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() org: Organization) {
    return (await this.facilities.list(org.id)).map(describe);
  }

  @Post()
  @RequireCapability(Capability.MANAGE_CATALOG)
  async create(
    @ActingOrg() org: Organization,
    @Body() dto: CreateFacilityDto,
  ) {
    return describe(await this.facilities.create(org, dto));
  }

  @Patch(':id')
  @RequireCapability(Capability.MANAGE_CATALOG)
  async update(
    @ActingOrg() org: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFacilityDto,
  ) {
    return describe(await this.facilities.update(id, org.id, dto));
  }
}

function describe(facility: Facility) {
  return {
    id: facility.id,
    name: facility.name,
    code: facility.code,
    address: facility.address,
    active: facility.active,
  };
}
