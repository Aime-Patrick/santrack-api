import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
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
import { RequestLeaveDto } from '../dto/leave.dto';
import { Leave } from '../entities/leave.entity';
import { LeaveService } from '../services/leave.service';

@ApiTags('Payroll & HR - Leave')
@ApiBearerAuth()
@Controller('api/payroll/leaves')
export class LeaveController {
  constructor(private readonly leaves: LeaveService) {}

  @Post()
  @RequireCapability(Capability.MANAGE_PAYROLL)
  async request(
    @ActingOrg() organization: Organization,
    @Body() dto: RequestLeaveDto,
  ) {
    return describe(await this.leaves.request(organization, dto));
  }

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @ActingOrg() organization: Organization,
    @Query('employeeId') employeeId?: string,
  ) {
    const leaves = await this.leaves.list(
      organization,
      employeeId ? parseInt(employeeId, 10) : undefined,
    );
    return leaves.map(describe);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_PAYROLL)
  async approve(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.leaves.approve(organization, id, actor));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_PAYROLL)
  async reject(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.leaves.reject(organization, id, actor));
  }
}

function describe(leave: Leave) {
  return {
    id: leave.id,
    employeeId: leave.employee.id,
    employeeNumber: leave.employee.employeeNumber,
    employeeName: leave.employee.name,
    type: leave.type,
    fromDate: leave.fromDate,
    toDate: leave.toDate,
    days: leave.days,
    reason: leave.reason,
    status: leave.status,
    approvedById: leave.approvedBy?.id ?? null,
    createdAt: leave.createdAt,
  };
}