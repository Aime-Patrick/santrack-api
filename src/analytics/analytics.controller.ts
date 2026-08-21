import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../auth/capabilities';
import { ActingOrg, RequireCapability } from '../common/decorators';
import { Organization } from '../organization/entities/organization.entity';
import { AnalyticsService } from './analytics.service';

/**
 * Executive intelligence & analytics (proposal sections 10 and 21). The
 * read-mostly management dashboard, so every route needs VIEW_OPERATIONS - an
 * auditor who can read the P&L but not alter the ledger can still question it.
 */
@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('api/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('executive')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async executive(@ActingOrg() organization: Organization) {
    return this.analytics.executive(organization);
  }

  @Get('counts')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async counts(@ActingOrg() organization: Organization) {
    return this.analytics.counts(organization);
  }

  @Get('production-trend')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async productionTrend(@ActingOrg() organization: Organization) {
    return this.analytics.productionTrend(organization);
  }

  @Get('industry')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async industry(@ActingOrg() organization: Organization) {
    return this.analytics.industry(organization);
  }

  /** Regulator-only; the service enforces it. Spans every business. */
  @Get('industry-categories')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async industryCategories(@ActingOrg() organization: Organization) {
    return this.analytics.industryCategories(organization);
  }

  @Get('supply-chain')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async supplyChain(@ActingOrg() organization: Organization) {
    return this.analytics.supplyChain(organization);
  }

  @Get('market')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async market(@ActingOrg() organization: Organization) {
    return this.analytics.market(organization);
  }

  @Get('finance')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async finance(@ActingOrg() organization: Organization) {
    return this.analytics.finance(organization);
  }

  @Get('compliance')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async compliance(@ActingOrg() organization: Organization) {
    return this.analytics.compliance(organization);
  }
}