import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { ActingOrg, RequireCapability } from '../../common/decorators';
import { Organization } from '../../organization/entities/organization.entity';
import { GrantRegulatoryOversightDto } from '../dto/regulatory-oversight.dto';
import { RegulatoryOversightService } from '../services/regulatory-oversight.service';

@ApiTags('Regulatory Oversight')
@ApiBearerAuth()
@Controller('api/regulatory-oversight')
export class RegulatoryOversightController {
  constructor(private readonly oversight: RegulatoryOversightService) {}

  /** Platform setup: explicitly gives an oversight body aggregate visibility over one authority. */
  @Post('scopes')
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async grant(@Body() dto: GrantRegulatoryOversightDto) { return this.oversight.grant(dto); }

  @Get('scopes')
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async list() { return (await this.oversight.list()).map((scope) => ({ id: scope.id, createdAt: scope.createdAt, oversightOrganization: { id: scope.oversightOrganization.id, name: scope.oversightOrganization.name }, authority: { id: scope.authority.id, code: scope.authority.code, name: scope.authority.name } })); }

  @Delete('scopes/:id')
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async revoke(@Param('id', ParseIntPipe) id: number) { await this.oversight.revoke(id); }

  /** Read-only aggregate health for the caller's configured scope. */
  @Get('summary')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async summary(@ActingOrg() organization: Organization) { return this.oversight.summary(organization); }
}
