import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import { ActingOrg, CurrentUser, RequireCapability } from '../../common/decorators';
import { NotFoundEntityException, TraceabilityRuleException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { UploadedFile as EvidenceUpload } from '../services/license.service';
import { RegulatoryCaseStatus } from '../entities/regulatory-case.entity';
import { RegulatoryCaseService } from '../services/regulatory-case.service';

@ApiTags('Regulatory Case Responses')
@ApiBearerAuth()
@Controller('api/cases')
export class RegulatoryCaseResponseController {
  constructor(private readonly cases: RegulatoryCaseService) {}

  /** Cases opened against this business — the corrective-action inbox. */
  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list(@ActingOrg() organization: Organization, @Query('status') status?: RegulatoryCaseStatus) {
    return (await this.cases.listForOrganization(organization, status)).map(describeCase);
  }

  /** One case against this business, with the full timeline it needs to respond. */
  @Get(':caseId')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async one(@Param('caseId', ParseIntPipe) caseId: number, @ActingOrg() organization: Organization) {
    const caseRecord = await this.cases.oneForOrganization(caseId, organization);
    return {
      ...describeCase(caseRecord),
      evidence: (await this.cases.evidenceForCase(caseRecord.id)).map(describeEvidence),
      events: (await this.cases.history(caseRecord.id)).map((event) => ({
        id: event.id, type: event.type, summary: event.summary, detail: event.detail,
        actor: event.actor ? event.actor.fullName ?? event.actor.email : 'System', actorId: event.actor?.id ?? null, recordedAt: event.recordedAt,
      })),
    };
  }

  /** The affected business attaches proof without entering the regulator workspace. */
  @Post(':caseId/evidence')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  @UseInterceptors(FileInterceptor('file'))
  async submitEvidence(
    @Param('caseId', ParseIntPipe) caseId: number,
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body('note') note: string | undefined,
    @UploadedFile() file?: EvidenceUpload,
  ) {
    if (!file) throw new TraceabilityRuleException('Attach a file under the "file" field');
    return describeEvidence(await this.cases.submitEvidence(organization, actor, caseId, note, file));
  }

  @Get(':caseId/evidence')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async evidence(@Param('caseId', ParseIntPipe) caseId: number, @ActingOrg() organization: Organization) {
    const caseRecord = await this.cases.one(caseId);
    if (caseRecord.organization.id !== organization.id) {
      // Use the same not-found behaviour as the submission path: another
      // business must not learn that this case exists.
      throw new NotFoundEntityException('RegulatoryCase', caseId);
    }
    return (await this.cases.evidenceForCase(caseId)).map(describeEvidence);
  }

  @Get(':caseId/evidence/:evidenceId/download')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async download(
    @Param('caseId', ParseIntPipe) caseId: number,
    @Param('evidenceId', ParseIntPipe) evidenceId: number,
    @ActingOrg() organization: Organization,
    @Res() response: Response,
  ) {
    const evidence = await this.cases.readEvidenceForOrganization(organization, caseId, evidenceId);
    const bytes = await this.cases.evidenceBytes(evidence);
    response.setHeader('Content-Type', evidence.contentType);
    response.setHeader('Content-Length', String(evidence.sizeBytes));
    response.setHeader('Content-Disposition', `attachment; filename="${safeFilename(evidence.filename)}"`);
    response.send(bytes);
  }
}

function describeEvidence(evidence: Awaited<ReturnType<RegulatoryCaseService['submitEvidence']>>) {
  return {
    id: evidence.id,
    filename: evidence.filename,
    contentType: evidence.contentType,
    sizeBytes: evidence.sizeBytes,
    note: evidence.note,
    submittedAt: evidence.submittedAt,
    submittedBy: { id: evidence.submittedBy.id, name: evidence.submittedBy.fullName ?? evidence.submittedBy.email },
  };
}

/** What a case looks like to the business it is opened against. */
function describeCase(caseRecord: Awaited<ReturnType<RegulatoryCaseService['listForOrganization']>>[number]) {
  return {
    id: caseRecord.id, caseNumber: caseRecord.caseNumber, title: caseRecord.title,
    description: caseRecord.description, priority: caseRecord.priority, status: caseRecord.status, caseCategory: caseRecord.caseCategory,
    dueOn: caseRecord.dueOn, openedAt: caseRecord.openedAt,
    leadAuthority: caseRecord.leadAuthority ? { id: caseRecord.leadAuthority.id, code: caseRecord.leadAuthority.code, name: caseRecord.leadAuthority.name } : null,
    facility: caseRecord.facility ? { id: caseRecord.facility.id, name: caseRecord.facility.name } : null,
    license: caseRecord.license ? { id: caseRecord.license.id, licenseNumber: caseRecord.license.licenseNumber } : null,
    batch: caseRecord.batch ? { id: caseRecord.batch.id, batchCode: caseRecord.batch.batchCode } : null,
    assignedTo: caseRecord.assignedTo ? { id: caseRecord.assignedTo.id, name: caseRecord.assignedTo.fullName ?? caseRecord.assignedTo.email } : null,
  };
}

function safeFilename(filename: string): string {
  return filename.replace(/[\\\r\n"]/g, '_');
}
