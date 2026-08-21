import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import {
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { canApproveLeave, canRejectLeave, LeaveStatus } from '../payroll.enums';
import { RequestLeaveDto } from '../dto/leave.dto';
import { Leave } from '../entities/leave.entity';
import { EmployeeService } from './employee.service';

@Injectable()
export class LeaveService {
  constructor(
    @InjectRepository(Leave)
    private readonly leaves: Repository<Leave>,
    private readonly employees: EmployeeService,
  ) {}

  async request(organization: Organization, dto: RequestLeaveDto): Promise<Leave> {
    const employee = await this.employees.get(organization, dto.employeeId);
    const from = new Date(dto.fromDate);
    const to = new Date(dto.toDate);
    if (to < from) {
      throw new TraceabilityRuleException('The leave end date precedes its start date');
    }
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    return this.leaves.save(
      this.leaves.create({
        organization,
        employee,
        type: dto.type,
        fromDate: dto.fromDate,
        toDate: dto.toDate,
        days,
        reason: dto.reason ?? null,
      }),
    );
  }

  async list(organization: Organization, employeeId?: number): Promise<Leave[]> {
    return this.leaves.find({
      where: employeeId
        ? { organization: { id: organization.id }, employee: { id: employeeId } }
        : { organization: { id: organization.id } },
      order: { createdAt: 'DESC' },
    });
  }

  async approve(organization: Organization, leaveId: number, actor: User): Promise<Leave> {
    const leave = await this.get(organization, leaveId);
    if (!canApproveLeave(leave.status)) {
      throw new TraceabilityRuleException('Only a requested leave can be approved');
    }
    leave.status = LeaveStatus.APPROVED;
    leave.approvedBy = actor;
    return this.leaves.save(leave);
  }

  async reject(organization: Organization, leaveId: number, actor: User): Promise<Leave> {
    const leave = await this.get(organization, leaveId);
    if (!canRejectLeave(leave.status)) {
      throw new TraceabilityRuleException('Only a requested leave can be rejected');
    }
    leave.status = LeaveStatus.REJECTED;
    leave.approvedBy = actor;
    return this.leaves.save(leave);
  }

  async get(organization: Organization, leaveId: number): Promise<Leave> {
    const leave = await this.leaves.findOne({ where: { id: leaveId } });
    if (!leave || leave.organization.id !== organization.id) {
      throw new NotFoundEntityException('Leave', leaveId);
    }
    return leave;
  }
}