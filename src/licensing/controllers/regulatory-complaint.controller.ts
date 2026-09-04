import { Body, Controller, Get, Param, ParseIntPipe, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../auth/user-role.enum';
import { ActingOrg, CurrentUser, RequireCapability } from '../../common/decorators';
import { TraceabilityRuleException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import { PublicComplaint } from '../entities/public-complaint.entity';
import { PublicComplaintService } from '../services/public-complaint.service';
import { PromotePublicComplaintDto } from '../dto/public-complaint.dto';
import { Response } from 'express';

@ApiTags('Regulatory Complaint Triage')
@ApiBearerAuth()
@Controller('api/regulator/complaints')
export class RegulatoryComplaintController {
  constructor(private readonly complaints: PublicComplaintService) {}

  @Get()
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async list(@ActingOrg() organization: Organization, @CurrentUser() actor: User) {
    requireRegulator(organization, actor);
    return (await this.complaints.listTriage()).map(describe);
  }

  @Post(':id/promote')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async promote(@Param('id', ParseIntPipe) id: number, @ActingOrg() organization: Organization, @CurrentUser() actor: User, @Body() dto: PromotePublicComplaintDto) {
    requireRegulator(organization, actor);
    const result = await this.complaints.promote(id, actor, dto);
    return { complaint: describe(result.complaint), caseNumber: result.caseRecord.caseNumber, caseId: result.caseRecord.id };
  }

  @Post(':id/dismiss')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async dismiss(@Param('id', ParseIntPipe) id: number, @ActingOrg() organization: Organization, @CurrentUser() actor: User) {
    requireRegulator(organization, actor);
    return describe(await this.complaints.dismiss(id, actor));
  }

  @Get(':id/photo')
  @RequireCapability(Capability.OVERSEE_INDUSTRIES)
  async photo(@Param('id', ParseIntPipe) id: number, @ActingOrg() organization: Organization, @CurrentUser() actor: User, @Res() response: Response) {
    requireRegulator(organization, actor);
    const complaint = await this.complaints.photoForTriage(id);
    const bytes = await this.complaints.photoBytes(complaint);
    response.setHeader('Content-Type', photoContentType(complaint.photoName!));
    response.setHeader('Content-Length', String(bytes.length));
    response.setHeader('Content-Disposition', `inline; filename="${safeFilename(complaint.photoName!)}"`);
    response.send(bytes);
  }
}

function photoContentType(filename: string): string {
  const suffix = filename.toLowerCase().split('.').pop();
  if (suffix === 'png') return 'image/png';
  if (suffix === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function safeFilename(filename: string): string { return filename.replace(/[\\\r\n"]/g, '_'); }

function requireRegulator(organization: Organization, actor: User): void {
  if (actor.role !== UserRole.SYSTEM_ADMIN && organization.type !== OrganizationType.REGULATOR) {
    throw new TraceabilityRuleException('Complaint triage is available to regulatory authorities only');
  }
}

function describe(complaint: PublicComplaint) {
  return {
    id: complaint.id, token: complaint.token, issue: complaint.issue, note: complaint.note,
    locationHint: complaint.locationHint, photoName: complaint.photoName, receivedAt: complaint.receivedAt,
    item: complaint.item ? { id: complaint.item.id, code: complaint.item.code } : null,
    batch: complaint.batch ? { id: complaint.batch.id, batchCode: complaint.batch.batchCode } : null,
  };
}
