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
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../auth/user-role.enum';
import { ActingOrg, CurrentUser, RequireCapability } from '../../common/decorators';
import { TraceabilityRuleException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import {
  ConfigureOwnAuthorityDto,
  CreateRegulatoryAuthorityDto,
  OnboardRegulatoryAuthorityDto,
  UpdateRegulatoryAuthorityDto,
} from '../dto/regulatory-authority.dto';
import {
  AddRegulatoryTeamMemberDto,
  CreateRegulatoryTeamDto,
  UpdateRegulatoryTeamDto,
  UpdateRegulatoryTeamMemberDto,
} from '../dto/regulatory-team.dto';
import { RegulatoryAuthority } from '../entities/regulatory-authority.entity';
import { RegulatoryTeam } from '../entities/regulatory-team.entity';
import { RegulatoryAuthorityService } from '../services/regulatory-authority.service';
import { RegulatoryTeamService } from '../services/regulatory-team.service';

@ApiTags('Regulatory Authorities')
@ApiBearerAuth()
@Controller('api/regulatory-authorities')
export class RegulatoryAuthorityController {
  constructor(
    private readonly authorities: RegulatoryAuthorityService,
    private readonly teams: RegulatoryTeamService,
  ) {}

  @Get()
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async list() {
    return Promise.all((await this.authorities.list()).map((a) => this.describe(a)));
  }

  @Post()
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async create(@Body() dto: CreateRegulatoryAuthorityDto) {
    return this.describe(await this.authorities.create(dto));
  }

  @Post('onboard')
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async onboard(
    @CurrentUser() actor: User,
    @Body() dto: OnboardRegulatoryAuthorityDto,
  ) {
    const result = await this.authorities.onboard(actor, dto);
    return {
      authority: await this.describe(result.authority),
      organization: { id: result.organization.id, name: result.organization.name },
      adminUser: result.adminUser,
    };
  }

  @Get('me/profile')
  @RequireCapability(Capability.MANAGE_USERS)
  async mine(@ActingOrg() organization: Organization, @CurrentUser() actor: User) {
    requireAuthorityAdmin(actor);
    const authority = await this.authorities.findForOrganization(organization);
    if (!authority) return null;
    return this.describe(authority);
  }

  @Patch('me/profile')
  @RequireCapability(Capability.MANAGE_USERS)
  async configureMine(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: ConfigureOwnAuthorityDto,
  ) {
    requireAuthorityAdmin(actor);
    const authority = await this.authorities.configureOwn(organization, dto);
    if (dto.teams) {
      await this.teams.replaceNamesFromLegacy(authority, dto.teams);
    }
    return this.describe(await this.authorities.forOrganization(organization));
  }

  @Get('me/teams')
  @RequireCapability(Capability.MANAGE_USERS)
  async listTeams(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Query('includeInactive') includeInactive?: string,
  ) {
    requireAuthorityAdmin(actor);
    const rows = await this.teams.listForOrganization(
      organization,
      includeInactive === 'true' || includeInactive === '1',
    );
    return rows.map(describeTeam);
  }

  /** Officers may read active teams for assignment dropdowns. */
  @Get('me/teams/active')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async listActiveTeams(@ActingOrg() organization: Organization) {
    const rows = await this.teams.listForOrganization(organization, false);
    return rows.map(describeTeam);
  }

  @Post('me/teams')
  @RequireCapability(Capability.MANAGE_USERS)
  async createTeam(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: CreateRegulatoryTeamDto,
  ) {
    requireAuthorityAdmin(actor);
    return describeTeam(await this.teams.create(organization, dto));
  }

  @Patch('me/teams/:teamId')
  @RequireCapability(Capability.MANAGE_USERS)
  async updateTeam(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() dto: UpdateRegulatoryTeamDto,
  ) {
    requireAuthorityAdmin(actor);
    return describeTeam(await this.teams.update(organization, teamId, dto));
  }

  @Post('me/teams/:teamId/members')
  @RequireCapability(Capability.MANAGE_USERS)
  async addMember(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() dto: AddRegulatoryTeamMemberDto,
  ) {
    requireAuthorityAdmin(actor);
    return describeTeam(await this.teams.addMember(organization, teamId, dto));
  }

  @Patch('me/teams/:teamId/members/:userId')
  @RequireCapability(Capability.MANAGE_USERS)
  async updateMember(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateRegulatoryTeamMemberDto,
  ) {
    requireAuthorityAdmin(actor);
    return describeTeam(
      await this.teams.updateMember(organization, teamId, userId, dto),
    );
  }

  @Delete('me/teams/:teamId/members/:userId')
  @RequireCapability(Capability.MANAGE_USERS)
  async removeMember(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    requireAuthorityAdmin(actor);
    return describeTeam(
      await this.teams.removeMember(organization, teamId, userId),
    );
  }

  @Patch(':id')
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRegulatoryAuthorityDto,
  ) {
    return this.describe(await this.authorities.update(id, dto));
  }

  private async describe(authority: RegulatoryAuthority) {
    const teamNames = await this.teams.activeNames(authority.id);
    return {
      id: authority.id,
      code: authority.code,
      name: authority.name,
      mandates: authority.mandates,
      caseCategories: authority.caseCategories,
      teams: teamNames,
      referralResponseDays: authority.referralResponseDays,
      isActive: authority.isActive,
      operatingOrganization: authority.operatingOrganization
        ? {
            id: authority.operatingOrganization.id,
            name: authority.operatingOrganization.name,
          }
        : null,
    };
  }
}

function requireAuthorityAdmin(actor: User) {
  if (actor.role !== UserRole.ORG_ADMIN) {
    throw new TraceabilityRuleException(
      'Only an authority administrator may configure this authority',
    );
  }
}

function describeTeam(team: RegulatoryTeam) {
  return {
    id: team.id,
    name: team.name,
    active: team.active,
    maxOpenCases: team.maxOpenCases ?? null,
    members: (team.members ?? []).map((member) => ({
      userId: member.user.id,
      fullName: member.user.fullName,
      email: member.user.email,
      isLeader: member.isLeader,
    })),
    leaderUserId:
      (team.members ?? []).find((member) => member.isLeader)?.user.id ?? null,
  };
}
