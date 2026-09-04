import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import { ActingOrg, CurrentUser, OptionalActingOrg, RequireCapability } from '../../common/decorators';
import { OrganizationRequiredException, TraceabilityRuleException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { UserRole } from '../../auth/user-role.enum';
import { RecordRegulatoryInspectionDto } from '../dto/regulatory-inspection.dto';
import { RegulatoryInspection } from '../entities/regulatory-inspection.entity';
import { RegulatoryInspectionService } from '../services/regulatory-inspection.service';
import { RegulatoryAuthorityService } from '../services/regulatory-authority.service';

@ApiTags('Regulatory Inspections')
@ApiBearerAuth()
@Controller('api/regulator/cases/:caseId/inspections')
export class RegulatoryInspectionController {
  constructor(private readonly inspections: RegulatoryInspectionService, private readonly authorities: RegulatoryAuthorityService) {}

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @Param('caseId', ParseIntPipe) caseId: number,
    @OptionalActingOrg() organization: Organization | null,
    @CurrentUser() actor: User,
  ) {
    requireRegulator(organization, actor);
    return (await this.inspections.listForCase(caseId, await this.authorities.forOperator(organization!))).map(describe);
  }

  @Post()
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async record(
    @Param('caseId', ParseIntPipe) caseId: number,
    @ActingOrg() regulator: Organization,
    @CurrentUser() inspector: User,
    @Body() dto: RecordRegulatoryInspectionDto,
  ) {
    requireRegulator(regulator, inspector);
    return describe(await this.inspections.record(caseId, regulator, await this.authorities.forOperator(regulator), inspector, dto));
  }
}

function requireRegulator(organization: Organization | null, actor: User): void {
  if (actor.role === UserRole.SYSTEM_ADMIN && organization?.type === OrganizationType.REGULATOR) return;
  if (!organization) throw new OrganizationRequiredException();
  if (organization.type !== OrganizationType.REGULATOR) {
    throw new TraceabilityRuleException('Regulatory inspections are available to regulatory authorities only');
  }
}

function describe(inspection: RegulatoryInspection) {
  return {
    id: inspection.id,
    caseId: inspection.case.id,
    organization: { id: inspection.organization.id, name: inspection.organization.name },
    facility: inspection.facility ? { id: inspection.facility.id, name: inspection.facility.name } : null,
    inspector: { id: inspection.inspector.id, name: inspection.inspector.fullName ?? inspection.inspector.email },
    result: inspection.result,
    notes: inspection.notes,
    inspectedAt: inspection.inspectedAt,
  };
}
