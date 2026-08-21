import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
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
import { CreatePayrollRunDto } from '../dto/payroll.dto';
import { PayrollLine, PayrollRun } from '../entities/payroll.entity';
import { PayrollService } from '../services/payroll.service';

@ApiTags('Payroll & HR - Payroll Runs')
@ApiBearerAuth()
@Controller('api/payroll/runs')
export class PayrollRunController {
  constructor(private readonly payroll: PayrollService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_PAYROLL)
  async create(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: CreatePayrollRunDto,
  ) {
    const run = await this.payroll.create(organization, actor, dto);
    return describeRun(run, await this.payroll.linesOf(run.id));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization) {
    const runs = await this.payroll.list(organization);
    return Promise.all(
      runs.map(async (run) => describeRun(run, await this.payroll.linesOf(run.id))),
    );
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async get(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const run = await this.payroll.get(organization, id);
    return describeRun(run, await this.payroll.linesOf(run.id));
  }

  @Post(':id/pay')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_PAYROLL)
  async pay(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const run = await this.payroll.pay(organization, id);
    return describeRun(run, await this.payroll.linesOf(run.id));
  }
}

function describeRun(run: PayrollRun, lines: PayrollLine[]) {
  return {
    id: run.id,
    runNumber: run.runNumber,
    period: run.period,
    status: run.status,
    paidOn: run.paidOn,
    createdById: run.createdBy?.id ?? null,
    createdAt: run.createdAt,
    lines: lines.map(describeLine),
  };
}

function describeLine(line: PayrollLine) {
  return {
    id: line.id,
    payslipNumber: line.payslipNumber,
    employeeId: line.employee.id,
    employeeNumber: line.employee.employeeNumber,
    employeeName: line.employee.name,
    departmentName: line.employee.department?.name ?? null,
    baseSalary: Number(line.baseSalary),
    allowances: Number(line.allowances),
    deductions: Number(line.deductions),
    overtimeHours: Number(line.overtimeHours),
    overtimeAmount: Number(line.overtimeAmount),
    gross: Number(line.gross),
    net: Number(line.net),
  };
}