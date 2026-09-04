import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../auth/user-role.enum';
import { ActingOrg, CurrentUser, RequireCapability } from '../../common/decorators';
import { OrganizationRequiredException, TraceabilityRuleException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { RegulatoryAccountabilityService } from '../services/regulatory-accountability.service';

@ApiTags('Accountability Ledger')
@ApiBearerAuth()
@Controller('api/regulator/accountability')
export class RegulatoryAccountabilityController {
  constructor(
    private readonly accountability: RegulatoryAccountabilityService,
  ) {}

  @Get('organization/:orgId')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async organizationTimeline(
    @Param('orgId', ParseIntPipe) orgId: number,
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Query('limit') limit?: string,
  ) {
    requireRegulator(organization, actor);
    return this.accountability.organizationTimeline(orgId, Math.min(Number(limit) || 50, 100));
  }

  @Get('batch/:batchId')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async batchTimeline(
    @Param('batchId', ParseIntPipe) batchId: number,
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Query('limit') limit?: string,
  ) {
    requireRegulator(organization, actor);
    return this.accountability.batchTimeline(batchId, Math.min(Number(limit) || 30, 100));
  }
}

function requireRegulator(organization: Organization | null, actor: User): void {
  if (actor.role === UserRole.SYSTEM_ADMIN && organization?.type === OrganizationType.REGULATOR) return;
  if (!organization) throw new OrganizationRequiredException();
  if (organization.type !== OrganizationType.REGULATOR) {
    throw new TraceabilityRuleException('Accountability ledger is available to regulatory authorities only');
  }
}
