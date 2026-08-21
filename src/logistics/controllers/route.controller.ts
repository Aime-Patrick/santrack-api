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
import { CreateRouteDto, UpdateRouteDto } from '../dto/route.dto';
import { Route } from '../entities/route.entity';
import { RouteService } from '../services/route.service';

@ApiTags('Logistics - Routes')
@ApiBearerAuth()
@Controller('api/logistics/routes')
export class RouteController {
  constructor(private readonly routes: RouteService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_LOGISTICS)
  async create(
    @ActingOrg() organization: Organization,
    @Body() dto: CreateRouteDto,
  ) {
    return describe(await this.routes.create(organization, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    const rows = await this.routes.list(organization);
    return { total: rows.length, content: rows.map(describe) };
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.routes.get(organization, id));
  }

  @Patch(':id')
  @RequireCapability(Capability.MANAGE_LOGISTICS)
  async update(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRouteDto,
  ) {
    return describe(await this.routes.update(organization, id, dto));
  }
}

function describe(route: Route) {
  return {
    id: route.id,
    organizationId: route.organization.id,
    name: route.name,
    sourceLocationId: route.sourceLocation.id,
    sourceLocationName: route.sourceLocation.name,
    destinationLocationId: route.destinationLocation.id,
    destinationLocationName: route.destinationLocation.name,
    distanceKm: route.distanceKm === null ? null : Number(route.distanceKm),
    expectedHours: route.expectedHours === null ? null : Number(route.expectedHours),
    active: route.active,
    createdAt: route.createdAt,
  };
}