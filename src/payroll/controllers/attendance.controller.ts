import {
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { ActingOrg, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { MarkAttendanceDto } from '../dto/attendance.dto';
import { Attendance } from '../entities/attendance.entity';
import { AttendanceService } from '../services/attendance.service';

@ApiTags('Payroll & HR - Attendance')
@ApiBearerAuth()
@Controller('api/payroll/attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_PAYROLL)
  async mark(
    @ActingOrg() organization: Organization,
    @Body() dto: MarkAttendanceDto,
  ) {
    return describe(await this.attendance.mark(organization, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @ActingOrg() organization: Organization,
    @Query('employeeId') employeeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const rows = await this.attendance.list(
      organization,
      employeeId ? parseInt(employeeId, 10) : undefined,
      from,
      to,
    );
    return rows.map(describe);
  }
}

function describe(attendance: Attendance) {
  return {
    id: attendance.id,
    employeeId: attendance.employee.id,
    employeeNumber: attendance.employee.employeeNumber,
    employeeName: attendance.employee.name,
    attendanceDate: attendance.attendanceDate,
    status: attendance.status,
    overtimeHours: Number(attendance.overtimeHours),
    createdAt: attendance.createdAt,
  };
}