import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { ActingOrg, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { PayrollReportService } from '../services/payroll-report.service';

@ApiTags('Payroll & HR - Reports')
@ApiBearerAuth()
@Controller('api/payroll/reports')
export class PayrollReportController {
  constructor(private readonly reports: PayrollReportService) {}

  @Get('summary')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async summary(
    @ActingOrg() organization: Organization,
    @Query('runId') runId?: string,
    @Query('period') period?: string,
  ) {
    return this.reports.summary(
      organization,
      runId ? parseInt(runId, 10) : undefined,
      period,
    );
  }

  @Get('leave')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async leave(@ActingOrg() organization: Organization) {
    return this.reports.leaveReport(organization);
  }
}