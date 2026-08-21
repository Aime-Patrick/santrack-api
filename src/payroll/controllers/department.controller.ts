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
  CreateDepartmentDto,
  UpdateDepartmentDto,
} from '../dto/department.dto';
import { Department } from '../entities/department.entity';
import { DepartmentService } from '../services/department.service';

@ApiTags('Payroll & HR - Departments')
@ApiBearerAuth()
@Controller('api/payroll/departments')
export class DepartmentController {
  constructor(private readonly departments: DepartmentService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_PAYROLL)
  async create(
    @ActingOrg() organization: Organization,
    @Body() dto: CreateDepartmentDto,
  ) {
    return describe(await this.departments.create(organization, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    return (await this.departments.list(organization)).map(describe);
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.departments.get(organization, id));
  }

  @Patch(':id')
  @RequireCapability(Capability.MANAGE_PAYROLL)
  async update(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return describe(await this.departments.update(organization, id, dto));
  }
}

function describe(department: Department) {
  return {
    id: department.id,
    code: department.code,
    name: department.name,
    active: department.active,
    createdAt: department.createdAt,
  };
}