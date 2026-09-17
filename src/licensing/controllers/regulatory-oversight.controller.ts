import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { ActingOrg, CurrentUser, RequireCapability } from '../../common/decorators';
import { User } from '../../auth/entities/user.entity';
import { Organization } from '../../organization/entities/organization.entity';
import {
  GrantRegulatoryOversightDto,
  NudgeSupervisedAuthorityDto,
  OverrideSupervisedLicenceDto,
  PullUpSupervisedCaseDto,
  UpdateRegulatoryOversightModeDto,
} from '../dto/regulatory-oversight.dto';
import { RegulatoryOversightService } from '../services/regulatory-oversight.service';

@ApiTags('Regulatory Oversight')
@ApiBearerAuth()
@Controller('api/regulatory-oversight')
export class RegulatoryOversightController {
  constructor(private readonly oversight: RegulatoryOversightService) {}

  @Post('scopes')
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async grant(@Body() dto: GrantRegulatoryOversightDto) {
    return this.describeScope(await this.oversight.grant(dto));
  }

  @Get('scopes')
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async list() {
    return (await this.oversight.list()).map((scope) => this.describeScope(scope));
  }

  @Patch('scopes/:id')
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async setMode(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRegulatoryOversightModeDto,
  ) {
    return this.describeScope(await this.oversight.setMode(id, dto.mode));
  }

  @Delete('scopes/:id')
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async revoke(@Param('id', ParseIntPipe) id: number) {
    await this.oversight.revoke(id);
  }

  @Get('summary')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async summary(@ActingOrg() organization: Organization) {
    return this.oversight.summary(organization);
  }

  @Get('supervised-cases')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async supervisedCases(
    @ActingOrg() organization: Organization,
    @Query('authorityId', new ParseIntPipe({ optional: true })) authorityId?: number,
  ) {
    return this.oversight.supervisedCases(organization, authorityId);
  }

  @Get('supervised-licences')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async supervisedLicences(@ActingOrg() organization: Organization) {
    return this.oversight.supervisedLicences(organization);
  }

  @Get('supervised-pending-licences')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async supervisedPendingLicences(@ActingOrg() organization: Organization) {
    return this.oversight.supervisedPendingLicences(organization);
  }

  @Post('licences/:id/override')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async overrideLicence(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: OverrideSupervisedLicenceDto,
  ) {
    const license = await this.oversight.overrideLicence(organization, actor, id, dto);
    return {
      id: license.id,
      licenseNumber: license.licenseNumber,
      status: license.status,
    };
  }

  @Post('cases/:id/pull-up')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async pullUpCase(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PullUpSupervisedCaseDto,
  ) {
    return this.oversight.pullUpCase(organization, actor, id, dto);
  }

  @Post('authorities/:authorityId/activate')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async activateAuthority(
    @ActingOrg() organization: Organization,
    @Param('authorityId', ParseIntPipe) authorityId: number,
  ) {
    return this.oversight.activateAuthority(organization, authorityId);
  }

  @Post('authorities/:authorityId/nudge')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async nudge(
    @ActingOrg() organization: Organization,
    @Param('authorityId', ParseIntPipe) authorityId: number,
    @Body() dto: NudgeSupervisedAuthorityDto,
  ) {
    return this.oversight.nudgeAuthority(organization, authorityId, dto);
  }

  private describeScope(
    scope: Awaited<ReturnType<RegulatoryOversightService['grant']>>,
  ) {
    return {
      id: scope.id,
      mode: scope.mode,
      createdAt: scope.createdAt,
      oversightOrganization: {
        id: scope.oversightOrganization.id,
        name: scope.oversightOrganization.name,
      },
      authority: {
        id: scope.authority.id,
        code: scope.authority.code,
        name: scope.authority.name,
        isActive: scope.authority.isActive,
      },
    };
  }
}
