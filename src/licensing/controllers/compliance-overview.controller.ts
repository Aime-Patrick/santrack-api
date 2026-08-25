import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Capability } from '../../auth/capabilities';
import { ActingOrg, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { ComplianceOverviewService } from '../services/compliance-overview.service';

/**
 * The compliance overview (DR-07 WU-7).
 *
 * Pure read. Returns the current compliance posture of the calling
 * organization: company licence status, each facility, each product.
 *
 * The browser renders these fields and derives nothing — a licence
 * validity, an authorization state, or an eligibility recomputed in the
 * browser is a second implementation of the rule.
 */
@ApiTags('Compliance')
@ApiBearerAuth()
@Controller('api/compliance')
export class ComplianceOverviewController {
  constructor(private readonly overview: ComplianceOverviewService) {}

  @Get('overview')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async overviewAction(@ActingOrg() organization: Organization) {
    return this.overview.of(organization);
  }
}
