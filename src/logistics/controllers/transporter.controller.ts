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
import {
  CreateTransporterDto,
  UpdateTransporterDto,
} from '../dto/transporter.dto';
import { Transporter } from '../entities/transporter.entity';
import { TransporterService } from '../services/transporter.service';

@ApiTags('Logistics - Transporters')
@ApiBearerAuth()
@Controller('api/logistics/transporters')
export class TransporterController {
  constructor(private readonly transporters: TransporterService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_LOGISTICS)
  async create(
    @ActingOrg() organization: Organization,
    @Body() dto: CreateTransporterDto,
  ) {
    return describe(await this.transporters.create(organization, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    const rows = await this.transporters.list(organization);
    return { total: rows.length, content: rows.map(describe) };
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.transporters.get(organization, id));
  }

  @Patch(':id')
  @RequireCapability(Capability.MANAGE_LOGISTICS)
  async update(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTransporterDto,
  ) {
    return describe(await this.transporters.update(organization, id, dto));
  }
}

function describe(transporter: Transporter) {
  return {
    id: transporter.id,
    organizationId: transporter.organization.id,
    name: transporter.name,
    code: transporter.code,
    contactPerson: transporter.contactPerson,
    phone: transporter.phone,
    email: transporter.email,
    active: transporter.active,
    createdAt: transporter.createdAt,
  };
}