import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { ActingOrg, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { FinanceReportService } from '../services/finance-report.service';

@ApiTags('Finance - Reports')
@ApiBearerAuth()
@Controller('api/finance/reports')
export class FinanceReportController {
  constructor(private readonly reports: FinanceReportService) {}

  @Get('trial-balance')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async trialBalance(@ActingOrg() organization: Organization) {
    return this.reports.trialBalance(organization);
  }

  @Get('profit-and-loss')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async profitAndLoss(
    @ActingOrg() organization: Organization,
    @Query('period') period?: string,
  ) {
    return this.reports.profitAndLoss(organization, period);
  }

  @Get('balance-sheet')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async balanceSheet(@ActingOrg() organization: Organization) {
    return this.reports.balanceSheet(organization);
  }

  @Get('cost-centres')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async costCentres(
    @ActingOrg() organization: Organization,
    @Query('period') period?: string,
  ) {
    return this.reports.costCentreReport(organization, period);
  }

  @Get('receivables')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async receivables(@ActingOrg() organization: Organization) {
    return this.reports.receivables(organization);
  }
}