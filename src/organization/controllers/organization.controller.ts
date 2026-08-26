import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import { CurrentUser, RequireCapability } from '../../common/decorators';
import { TraceabilityRuleException } from '../../common/errors';
import {
  AmendOrganizationDto,
  CreateOrganizationDto,
  GrantRegulatoryStandingDto,
  RegisterRegulatorDto,
  RevokeRegulatoryStandingDto,
} from '../dto/organization.dto';
import { OrganizationType } from '../organization-type.enum';
import { Organization } from '../entities/organization.entity';
import { OrganizationService } from '../services/organization.service';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('api/organizations')
export class OrganizationController {
  constructor(private readonly organizations: OrganizationService) {}

  /** Onboarding - creates the business the caller acts for. */
  @Post()
  async create(@CurrentUser() actor: User, @Body() dto: CreateOrganizationDto) {
    return describe(await this.organizations.create(actor, dto));
  }

  /**
   * Trading partners you can dispatch or sell to. Names and types only.
   *
   * `?type=` narrows it, comma-separated: `?type=REGULATOR` for the oversight
   * bodies, or the five trade types for the businesses. Unfiltered returns
   * everything, which is what the transfer and sale pickers want.
   */
  @Get()
  async list(@Query('type') type?: string) {
    return (await this.organizations.list(parseTypes(type))).map(describe);
  }

  /**
   * The industry register: every business on the platform with its staff,
   * catalogue size and licence standing.
   *
   * Supervisory, not operational. Proposal section 3 gives industry
   * registration, licensing and compliance to the regulatory authorities, so
   * this is held by them and by the platform operator - and by nobody inside a
   * manufacturer, however senior. The list above stays open to everyone
   * because picking a trading partner is a different question.
   */
  @Get('registry')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async registry() {
    const entries = await this.organizations.registry();
    return entries.map((entry) => ({
      ...describe(entry.organization),
      staff: entry.staff,
      products: entry.products,
      licenses: entry.licenses,
    }));
  }

  /**
   * Corrects a registry entry - a renamed company, a mis-declared type.
   *
   * Operator only, and not a route to regulatory standing: that is granted and
   * withdrawn below, where the consequences are stated.
   */
  @Put(':id')
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async amend(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AmendOrganizationDto,
  ) {
    return describe(await this.organizations.amend(id, dto));
  }

  /**
   * The oversight bodies, with how many people staff each one.
   *
   * Separate from the filtered list above because managing regulators is a
   * different question from picking a trading partner: the operator needs to
   * see whether an authority actually has anyone in it, not just that a record
   * exists.
   */
  @Get('regulators')
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async listRegulators() {
    const rows = await this.organizations.listRegulators();
    return rows.map((row) => ({ ...describe(row.organization), staff: row.staff }));
  }

  /**
   * Registers an oversight body directly. Platform operators only.
   *
   * The caller is not attached to it, unlike onboarding: registering an
   * authority is not joining it.
   */
  @Post('regulators')
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async registerRegulator(@Body() dto: RegisterRegulatorDto) {
    return describe(await this.organizations.registerRegulator(dto.name));
  }

  /**
   * Withdraws regulatory standing. The body states what the organization
   * becomes, because standing is its type and something has to replace it.
   */
  @Delete(':id/regulatory-standing')
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async revokeRegulatoryStanding(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RevokeRegulatoryStandingDto,
  ) {
    return describe(
      await this.organizations.revokeRegulatoryStanding(id, dto.revertTo),
    );
  }

  /**
   * Confers regulatory standing. Platform operators only - this grants sight
   * of every organization's chain of custody and the power to recall any
   * batch, so it is deliberately not something an applicant can ask for.
   */
  @Put(':id/regulatory-standing')
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async grantRegulatoryStanding(
    @Param('id', ParseIntPipe) id: number,
    @Body() _dto: GrantRegulatoryStandingDto,
  ) {
    return describe(await this.organizations.grantRegulatoryStanding(id));
  }
}

function describe(organization: Organization) {
  return {
    id: organization.id,
    name: organization.name,
    type: organization.type,
    tin: organization.tin,
    registrationNumber: organization.registrationNumber,
    createdAt: organization.createdAt,
  };
}

/**
 * Reads the `type` filter, rejecting anything that is not an organization
 * type rather than quietly returning everything - a typo that silently widens
 * a filter is how a regulator page ends up listing every shop on the platform.
 */
export function parseTypes(raw?: string): OrganizationType[] | undefined {
  if (!raw) {
    return undefined;
  }

  const values = raw
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0);

  const known = Object.values(OrganizationType) as string[];
  const unknown = values.filter((value) => !known.includes(value));
  if (unknown.length > 0) {
    throw new TraceabilityRuleException(
      `Unknown organization type: ${unknown.join(', ')}`,
    );
  }

  return values as OrganizationType[];
}
