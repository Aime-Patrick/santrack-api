import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import { ActingOrg, CurrentUser, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { DecideRegulatoryReferralDto, ReferRegulatoryCaseDto } from '../dto/regulatory-case.dto';
import { RegulatoryAuthorityService } from '../services/regulatory-authority.service';
import { RegulatoryCaseService } from '../services/regulatory-case.service';

@ApiTags('Regulatory Referrals')
@ApiBearerAuth()
@Controller('api/regulator')
export class RegulatoryReferralController {
  constructor(private readonly cases: RegulatoryCaseService, private readonly authorities: RegulatoryAuthorityService) {}

  @Post('cases/:caseId/referrals')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async refer(@Param('caseId', ParseIntPipe) caseId: number, @ActingOrg() organization: Organization, @CurrentUser() actor: User, @Body() dto: ReferRegulatoryCaseDto) {
    return describe(await this.cases.refer(caseId, actor, await this.authorities.forOperator(organization), dto));
  }

  @Get('referrals/incoming')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async incoming(@ActingOrg() organization: Organization) {
    return (await this.cases.incomingReferrals(await this.authorities.forOperator(organization))).map(({ referral, overdue }) => ({ ...describe(referral), overdue }));
  }

  @Post('referrals/:id/accept')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async accept(@Param('id', ParseIntPipe) id: number, @ActingOrg() organization: Organization, @CurrentUser() actor: User, @Body() dto: DecideRegulatoryReferralDto) {
    return describe(await this.cases.decideReferral(id, actor, await this.authorities.forOperator(organization), true, dto.note));
  }

  @Post('referrals/:id/reject')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async reject(@Param('id', ParseIntPipe) id: number, @ActingOrg() organization: Organization, @CurrentUser() actor: User, @Body() dto: DecideRegulatoryReferralDto) {
    return describe(await this.cases.decideReferral(id, actor, await this.authorities.forOperator(organization), false, dto.note));
  }
}

function describe(referral: Awaited<ReturnType<RegulatoryCaseService['refer']>>) {
  return { id: referral.id, status: referral.status, reason: referral.reason, referredAt: referral.referredAt, case: { id: referral.case.id, caseNumber: referral.case.caseNumber, title: referral.case.title }, fromAuthority: { id: referral.fromAuthority.id, name: referral.fromAuthority.name }, toAuthority: { id: referral.toAuthority.id, name: referral.toAuthority.name }, decisionNote: referral.decisionNote, decidedAt: referral.decidedAt };
}
