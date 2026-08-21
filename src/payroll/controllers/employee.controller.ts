import {
  Body,
  Controller,
  Delete,
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
  CreateEmployeeDto,
  CreatePayItemDto,
  UpdateEmployeeDto,
} from '../dto/employee.dto';
import { Employee } from '../entities/employee.entity';
import { EmployeePayItem } from '../entities/employee-pay-item.entity';
import { EmployeeService } from '../services/employee.service';

@ApiTags('Payroll & HR - Employees')
@ApiBearerAuth()
@Controller('api/payroll/employees')
export class EmployeeController {
  constructor(private readonly employees: EmployeeService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_PAYROLL)
  async create(
    @ActingOrg() organization: Organization,
    @Body() dto: CreateEmployeeDto,
  ) {
    const employee = await this.employees.create(organization, dto);
    return describeEmployee(employee, await this.employees.payItemsOf(employee.id));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    const employees = await this.employees.list(organization);
    return Promise.all(
      employees.map(async (employee) =>
        describeEmployee(employee, await this.employees.payItemsOf(employee.id)),
      ),
    );
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const employee = await this.employees.get(organization, id);
    return describeEmployee(employee, await this.employees.payItemsOf(employee.id));
  }

  @Patch(':id')
  @RequireCapability(Capability.MANAGE_PAYROLL)
  async update(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEmployeeDto,
  ) {
    const employee = await this.employees.update(organization, id, dto);
    return describeEmployee(employee, await this.employees.payItemsOf(employee.id));
  }

  @Post(':id/pay-items')
  @RequireCapability(Capability.MANAGE_PAYROLL)
  async addPayItem(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreatePayItemDto,
  ) {
    const item = await this.employees.addPayItem(
      organization,
      id,
      dto.name,
      dto.type,
      dto.amount,
    );
    return describePayItem(item);
  }

  @Delete(':id/pay-items/:payItemId')
  @RequireCapability(Capability.MANAGE_PAYROLL)
  async removePayItem(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Param('payItemId', ParseIntPipe) payItemId: number,
  ) {
    await this.employees.removePayItem(organization, id, payItemId);
    return { removed: true };
  }
}

function describeEmployee(employee: Employee, payItems: EmployeePayItem[]) {
  return {
    id: employee.id,
    employeeNumber: employee.employeeNumber,
    name: employee.name,
    departmentId: employee.department?.id ?? null,
    departmentName: employee.department?.name ?? null,
    jobPositionId: employee.position?.id ?? null,
    jobPositionTitle: employee.position?.title ?? null,
    status: employee.status,
    hireDate: employee.hireDate,
    phone: employee.phone,
    email: employee.email,
    baseSalary: Number(employee.baseSalary),
    overtimeRate: Number(employee.overtimeRate),
    active: employee.active,
    payItems: payItems.map(describePayItem),
    createdAt: employee.createdAt,
  };
}

function describePayItem(item: EmployeePayItem) {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    amount: Number(item.amount),
    active: item.active,
  };
}