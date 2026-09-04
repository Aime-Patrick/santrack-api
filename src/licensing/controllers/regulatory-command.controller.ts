import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { ActingOrg, RequireCapability } from '../../common/decorators';
import { TraceabilityRuleException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { RegulatoryCommandService } from '../services/regulatory-command.service';
import { RegulatoryAuthorityService } from '../services/regulatory-authority.service';

@ApiTags('Regulatory Command')
@ApiBearerAuth()
@Controller('api/regulator/command')
export class RegulatoryCommandController {
  constructor(private readonly command: RegulatoryCommandService, private readonly authorities: RegulatoryAuthorityService) {}

  @Get()
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async summary(@ActingOrg() organization: Organization) {
    if (organization.type !== OrganizationType.REGULATOR) throw new TraceabilityRuleException('Command overview is available to regulatory authorities only');
    return this.command.summary(await this.authorities.forOperator(organization));
  }
}
