import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Capability } from '../../auth/capabilities';
import { ActingOrg, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { EligibilityQueryDto } from '../dto/eligibility.dto';
import { ProductionEligibilityService } from '../services/production-eligibility.service';

/**
 * The eligibility preview (DR-07 WU-5).
 *
 * Pure read. The Start Production screen calls this on every field change, so
 * the one thing it must never do is write: routed through
 * `LicenseEnforcementService.check()` instead of the eligibility service,
 * opening the form would file a `ComplianceFinding` and notify the licence
 * holder once per keystroke (DR §24 invariant 11, contract §3 trap T1).
 *
 * It renders the result and derives nothing. `eligible` and `blocking` are the
 * server's, not the browser's, and not this controller's either — a verdict
 * recomputed on the way out is a second implementation of the rule.
 *
 * The answer here is advisory. The authoritative evaluation happens inside
 * `ProductionService.create()` and is the one that gets stored, because a
 * licence can lapse between the preview and the order.
 */
@ApiTags('Production eligibility')
@ApiBearerAuth()
@Controller('api/production')
export class ProductionEligibilityController {
  constructor(private readonly eligibility: ProductionEligibilityService) {}

  @Get('eligibility')
  @RequireCapability(Capability.RUN_PRODUCTION)
  async preview(
    @ActingOrg() organization: Organization,
    @Query() query: EligibilityQueryDto,
  ) {
    return this.eligibility.evaluate({
      organizationId: organization.id,
      facilityId: query.facilityId ?? null,
      productId: query.productId,
      requestedQuantity: query.quantity,
      requestedDate: query.date ?? null,
    });
  }
}
