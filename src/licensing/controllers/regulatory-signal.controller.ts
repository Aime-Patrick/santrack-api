import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { ActingOrg, RequireCapability } from '../../common/decorators';
import { TraceabilityRuleException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { RegulatorySignalService } from '../services/regulatory-signal.service';

@ApiTags('Regulatory Signals')
@ApiBearerAuth()
@Controller('api/regulator/signals')
export class RegulatorySignalController {
  constructor(private readonly signals: RegulatorySignalService) {}

  @Get()
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async list(@ActingOrg() organization: Organization) {
    if (organization.type !== OrganizationType.REGULATOR) throw new TraceabilityRuleException('Signals are available to regulatory authorities only');
    return this.signals.list();
  }
}
