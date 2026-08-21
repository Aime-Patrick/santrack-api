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
import { Organization } from '../../organization/entities/organization.entity';
import {
  CreateJobPositionDto,
  UpdateJobPositionDto,
} from '../dto/department.dto';
import { JobPosition } from '../entities/job-position.entity';
import { JobPositionService } from '../services/job-position.service';

@ApiTags('Payroll & HR - Job Positions')
@ApiBearerAuth()
@Controller('api/payroll/job-positions')
export class JobPositionController {
  constructor(private readonly positions: JobPositionService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_PAYROLL)
  async create(
    @ActingOrg() organization: Organization,
    @Body() dto: CreateJobPositionDto,
  ) {
    return describe(await this.positions.create(organization, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    return (await this.positions.list(organization)).map(describe);
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.positions.get(organization, id));
  }

  @Patch(':id')
  @RequireCapability(Capability.MANAGE_PAYROLL)
  async update(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateJobPositionDto,
  ) {
    return describe(await this.positions.update(organization, id, dto));
  }
}

function describe(position: JobPosition) {
  return {
    id: position.id,
    code: position.code,
    title: position.title,
    active: position.active,
    createdAt: position.createdAt,
  };
}