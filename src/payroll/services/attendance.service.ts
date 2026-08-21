import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, LessThanOrEqual, Repository } from 'typeorm';
import { TraceabilityRuleException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { MarkAttendanceDto } from '../dto/attendance.dto';
import { Attendance } from '../entities/attendance.entity';
import { EmployeeService } from './employee.service';

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(Attendance)
    private readonly attendance: Repository<Attendance>,
    private readonly employees: EmployeeService,
  ) {}

  /**
   * Records one employee's day. The same date can only be recorded once per
   * employee - an absent day is a fact, not a guess to be re-opened later.
   */
  async mark(organization: Organization, dto: MarkAttendanceDto): Promise<Attendance> {
    const employee = await this.employees.get(organization, dto.employeeId);
    const existing = await this.attendance.findOne({
      where: {
        organization: { id: organization.id },
        employee: { id: employee.id },
        attendanceDate: dto.attendanceDate,
      },
    });
    if (existing) {
      throw new TraceabilityRuleException(
        `Attendance for ${dto.attendanceDate} is already recorded for this employee`,
      );
    }
    return this.attendance.save(
      this.attendance.create({
        organization,
        employee,
        attendanceDate: dto.attendanceDate,
        status: dto.status ?? undefined,
        overtimeHours: dto.overtimeHours === undefined ? '0' : String(dto.overtimeHours),
      }),
    );
  }

  async list(organization: Organization, employeeId?: number, from?: string, to?: string) {
    const where: Record<string, unknown> = { organization: { id: organization.id } };
    if (employeeId) where.employee = { id: employeeId };
    if (from) where.attendanceDate = MoreThanOrEqual(from);
    if (to) where.attendanceDate = LessThanOrEqual(to);
    return this.attendance.find({
      where,
      order: { attendanceDate: 'DESC' },
    });
  }
}