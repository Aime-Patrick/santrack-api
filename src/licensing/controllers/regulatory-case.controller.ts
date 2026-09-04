import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../auth/user-role.enum';
import { ActingOrg, CurrentUser, OptionalActingOrg, RequireCapability } from '../../common/decorators';
import { OrganizationRequiredException, TraceabilityRuleException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { AssignRegulatoryCaseDto, AssignRegulatoryCaseTeamDto, ChangeRegulatoryCaseStatusDto, OpenRegulatoryCaseDto } from '../dto/regulatory-case.dto';
import { RegulatoryCase, RegulatoryCaseStatus } from '../entities/regulatory-case.entity';
import { RegulatoryCaseService } from '../services/regulatory-case.service';
import { RegulatoryInvestigationPackService } from '../services/regulatory-investigation-pack.service';
import { RegulatoryAuthorityService } from '../services/regulatory-authority.service';

@ApiTags('Regulatory Cases')
@ApiBearerAuth()
@Controller('api/regulator/cases')
export class RegulatoryCaseController {
  constructor(
    private readonly cases: RegulatoryCaseService,
    private readonly investigationPacks: RegulatoryInvestigationPackService,
    private readonly authorities: RegulatoryAuthorityService,
  ) {}

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(
    @OptionalActingOrg() organization: Organization | null,
    @CurrentUser() actor: User,
    @Query('status') status?: RegulatoryCaseStatus,
    @Query('assignedToId', new ParseIntPipe({ optional: true })) assignedToId?: number,
  ) {
    requireRegulator(organization, actor);
    return (await this.cases.listForAuthority(await this.authorities.forOperator(organization!), status, assignedToId)).map(describe);
  }

  @Post()
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async open(@OptionalActingOrg() organization: Organization | null, @CurrentUser() actor: User, @Body() dto: OpenRegulatoryCaseDto) {
    requireRegulator(organization, actor);
    return describe(await this.cases.open(actor, dto));
  }

  @Get('officers')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async officers(@ActingOrg() organization: Organization, @CurrentUser() actor: User) {
    requireRegulator(organization, actor);
    return (await this.cases.officers(organization)).map((officer) => ({
      id: officer.id,
      name: officer.fullName ?? officer.email,
      role: officer.role,
    }));
  }

  @Get(':id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async one(@Param('id', ParseIntPipe) id: number, @OptionalActingOrg() organization: Organization | null, @CurrentUser() actor: User) {
    requireRegulator(organization, actor);
    const caseRecord = await this.cases.oneForAuthority(id, await this.authorities.forOperator(organization!));
    return { ...describe(caseRecord), evidence: (await this.cases.evidenceForCase(id)).map(describeEvidence), referrals: (await this.cases.referralsForCase(id)).map(describeReferral), events: (await this.cases.history(id)).map((event) => ({
      id: event.id, type: event.type, summary: event.summary, detail: event.detail,
      actor: event.actor ? event.actor.fullName ?? event.actor.email : 'System', actorId: event.actor?.id ?? null, recordedAt: event.recordedAt,
    })) };
  }

  @Get(':id/investigation-pack')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async investigationPack(
    @Param('id', ParseIntPipe) id: number,
    @OptionalActingOrg() organization: Organization | null,
    @CurrentUser() actor: User,
    @Res() response: Response,
  ) {
    requireRegulator(organization, actor);
    await this.cases.oneForAuthority(id, await this.authorities.forOperator(organization!));
    const pack = await this.investigationPacks.build(id);
    response.setHeader('Content-Type', pack.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${safeFilename(pack.filename)}"`);
    response.send(pack.body);
  }

  @Post(':id/assign')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async assign(@Param('id', ParseIntPipe) id: number, @ActingOrg() organization: Organization, @CurrentUser() actor: User, @Body() dto: AssignRegulatoryCaseDto) {
    requireRegulator(organization, actor);
    return describe(await this.cases.assign(id, actor, await this.authorities.forOperator(organization), dto.officerId, dto.note));
  }

  @Post(':id/team')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async assignTeam(@Param('id', ParseIntPipe) id: number, @ActingOrg() organization: Organization, @CurrentUser() actor: User, @Body() dto: AssignRegulatoryCaseTeamDto) {
    requireRegulator(organization, actor);
    return describe(await this.cases.assignTeam(id, actor, await this.authorities.forOperator(organization), dto.team));
  }

  @Post(':id/status')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async status(@Param('id', ParseIntPipe) id: number, @ActingOrg() organization: Organization, @CurrentUser() actor: User, @Body() dto: ChangeRegulatoryCaseStatusDto) {
    requireRegulator(organization, actor);
    return describe(await this.cases.changeStatus(id, actor, await this.authorities.forOperator(organization), dto.status, dto.note));
  }

  @Get(':id/evidence/:evidenceId/download')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async downloadEvidence(
    @Param('id', ParseIntPipe) id: number,
    @Param('evidenceId', ParseIntPipe) evidenceId: number,
    @OptionalActingOrg() organization: Organization | null,
    @CurrentUser() actor: User,
    @Res() response: Response,
  ) {
    requireRegulator(organization, actor);
    await this.cases.oneForAuthority(id, await this.authorities.forOperator(organization!));
    const evidence = await this.cases.readEvidence(id, evidenceId);
    const bytes = await this.cases.evidenceBytes(evidence);
    response.setHeader('Content-Type', evidence.contentType);
    response.setHeader('Content-Length', String(evidence.sizeBytes));
    response.setHeader('Content-Disposition', `attachment; filename="${safeFilename(evidence.filename)}"`);
    response.send(bytes);
  }
}

function describeReferral(referral: Awaited<ReturnType<RegulatoryCaseService['refer']>>) {
  return { id: referral.id, status: referral.status, reason: referral.reason, referredAt: referral.referredAt, fromAuthority: { id: referral.fromAuthority.id, name: referral.fromAuthority.name }, toAuthority: { id: referral.toAuthority.id, name: referral.toAuthority.name }, decisionNote: referral.decisionNote, decidedAt: referral.decidedAt };
}

function describeEvidence(evidence: Awaited<ReturnType<RegulatoryCaseService['submitEvidence']>>) {
  return {
    id: evidence.id, filename: evidence.filename, contentType: evidence.contentType,
    sizeBytes: evidence.sizeBytes, note: evidence.note, submittedAt: evidence.submittedAt,
    submittedBy: { id: evidence.submittedBy.id, name: evidence.submittedBy.fullName ?? evidence.submittedBy.email },
  };
}

function safeFilename(filename: string): string {
  return filename.replace(/[\\\r\n"]/g, '_');
}

function requireRegulator(organization: Organization | null, actor: User): void {
  if (actor.role === UserRole.SYSTEM_ADMIN && organization?.type === OrganizationType.REGULATOR) return;
  if (!organization) throw new OrganizationRequiredException();
  if (organization.type !== OrganizationType.REGULATOR) {
    throw new TraceabilityRuleException('Regulatory cases are available to regulatory authorities only');
  }
}

function describe(caseRecord: RegulatoryCase) {
  return {
    id: caseRecord.id, caseNumber: caseRecord.caseNumber, title: caseRecord.title,
    description: caseRecord.description, priority: caseRecord.priority, status: caseRecord.status, caseCategory: caseRecord.caseCategory, assignedTeam: caseRecord.assignedTeam,
    dueOn: caseRecord.dueOn, openedAt: caseRecord.openedAt,
    organization: { id: caseRecord.organization.id, name: caseRecord.organization.name },
    leadAuthority: caseRecord.leadAuthority ? { id: caseRecord.leadAuthority.id, code: caseRecord.leadAuthority.code, name: caseRecord.leadAuthority.name } : null,
    facility: caseRecord.facility ? { id: caseRecord.facility.id, name: caseRecord.facility.name } : null,
    license: caseRecord.license ? { id: caseRecord.license.id, licenseNumber: caseRecord.license.licenseNumber } : null,
    findingId: caseRecord.finding?.id ?? null,
    batch: caseRecord.batch ? { id: caseRecord.batch.id, batchCode: caseRecord.batch.batchCode } : null,
    assignedTo: caseRecord.assignedTo ? { id: caseRecord.assignedTo.id, name: caseRecord.assignedTo.fullName ?? caseRecord.assignedTo.email } : null,
    openedBy: caseRecord.openedBy ? { id: caseRecord.openedBy.id, name: caseRecord.openedBy.fullName ?? caseRecord.openedBy.email } : { id: null, name: 'Public scan report' },
  };
}
