import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../auth/user-role.enum';
import { ActingOrg, CurrentUser, RequireCapability } from '../../common/decorators';
import { TraceabilityRuleException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateRegulatoryAuthorityDto, ConfigureOwnAuthorityDto, OnboardRegulatoryAuthorityDto, UpdateRegulatoryAuthorityDto } from '../dto/regulatory-authority.dto';
import { RegulatoryAuthority } from '../entities/regulatory-authority.entity';
import { RegulatoryAuthorityService } from '../services/regulatory-authority.service';

@ApiTags('Regulatory Authorities')
@ApiBearerAuth()
@Controller('api/regulatory-authorities')
export class RegulatoryAuthorityController {
  constructor(private readonly authorities: RegulatoryAuthorityService) {}

  @Get()
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async list() { return (await this.authorities.list()).map(describe); }

  @Post()
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async create(@Body() dto: CreateRegulatoryAuthorityDto) { return describe(await this.authorities.create(dto)); }

  @Post('onboard')
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async onboard(@CurrentUser() actor: User, @Body() dto: OnboardRegulatoryAuthorityDto) {
    const result = await this.authorities.onboard(actor, dto);
    return {
      authority: describe(result.authority),
      organization: { id: result.organization.id, name: result.organization.name },
      adminUser: result.adminUser,
    };
  }

  @Get('me/profile')
  @RequireCapability(Capability.MANAGE_USERS)
  async mine(@ActingOrg() organization: Organization, @CurrentUser() actor: User) {
    requireAuthorityAdmin(actor);
    return describe(await this.authorities.forOrganization(organization));
  }

  @Patch('me/profile')
  @RequireCapability(Capability.MANAGE_USERS)
  async configureMine(@ActingOrg() organization: Organization, @CurrentUser() actor: User, @Body() dto: ConfigureOwnAuthorityDto) {
    requireAuthorityAdmin(actor);
    return describe(await this.authorities.configureOwn(organization, dto));
  }

  @Patch(':id')
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRegulatoryAuthorityDto) { return describe(await this.authorities.update(id, dto)); }
}

function requireAuthorityAdmin(actor: User) {
  if (actor.role !== UserRole.ORG_ADMIN) throw new TraceabilityRuleException('Only an authority administrator may configure this authority');
}

function describe(authority: RegulatoryAuthority) {
  return { id: authority.id, code: authority.code, name: authority.name, mandates: authority.mandates, caseCategories: authority.caseCategories, teams: authority.teams, referralResponseDays: authority.referralResponseDays, isActive: authority.isActive, operatingOrganization: authority.operatingOrganization ? { id: authority.operatingOrganization.id, name: authority.operatingOrganization.name } : null };
}
