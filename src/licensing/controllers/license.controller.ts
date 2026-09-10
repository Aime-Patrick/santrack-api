import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import {
  ActingOrg,
  CurrentUser,
  OptionalActingOrg,
  Public,
  RequireAnyCapability,
  RequireCapability,
} from '../../common/decorators';
import { OrganizationRequiredException, TraceabilityRuleException, NotFoundEntityException } from '../../common/errors';
import { UserRole } from '../../auth/user-role.enum';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import {
  ActionFollowUpDto,
  ApplyForLicenseDto,
  AttachDocumentDto,
  CloseFollowUpDto,
  CreateFollowUpDto,
  CreateLicenseCategoryDto,
  DecisionDto,
  ReasonDto,
  RequiredReasonDto,
  SendFollowUpLinkDto,
  UpdateLicenseCategoryDto,
} from '../dto/license.dto';
import { ComplianceFinding } from '../entities/compliance-finding.entity';
import { License } from '../entities/license.entity';
import { grainOf } from '../governing-licence';
import { LicenseEnforcementService } from '../services/license-enforcement.service';
import { LicenseService, UploadedFile as Upload } from '../services/license.service';

/** The applicant's side: apply, attach certificates, submit, renew. */
@ApiTags('Licenses')
@ApiBearerAuth()
@Controller('api/licenses')
export class LicenseController {
  constructor(private readonly licenses: LicenseService) {}

  @Get('categories')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async categories() {
    return (await this.licenses.listCategories()).map((category) => ({
      id: category.id,
      code: category.code,
      name: category.name,
      activity: category.activity,
      appliesTo: category.appliesTo,
      requiredDocuments: category.requiredDocuments,
      permittedProductCategories: category.permittedProductCategories,
      validityMonths: category.validityMonths,
      active: category.active,
    }));
  }

  @Get('categories/all')
  @RequireAnyCapability(
    Capability.ADMINISTER_PLATFORM,
    Capability.OVERSEE_INDUSTRIES,
    Capability.DECIDE_LICENCES,
  )
  async allCategories() {
    return (await this.licenses.listAllCategories()).map((category) => ({
      id: category.id,
      code: category.code,
      name: category.name,
      activity: category.activity,
      appliesTo: category.appliesTo,
      requiredDocuments: category.requiredDocuments,
      permittedProductCategories: category.permittedProductCategories,
      validityMonths: category.validityMonths,
      active: category.active,
    }));
  }

  @Post('categories')
  @RequireAnyCapability(
    Capability.ADMINISTER_PLATFORM,
    Capability.OVERSEE_INDUSTRIES,
  )
  async createCategory(@Body() dto: CreateLicenseCategoryDto) {
    return this.licenses.createCategory(dto);
  }

  @Patch('categories/:id')
  @RequireAnyCapability(
    Capability.ADMINISTER_PLATFORM,
    Capability.OVERSEE_INDUSTRIES,
  )
  async updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLicenseCategoryDto,
  ) {
    return this.licenses.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @RequireAnyCapability(
    Capability.ADMINISTER_PLATFORM,
    Capability.OVERSEE_INDUSTRIES,
  )
  async deleteCategory(@Param('id', ParseIntPipe) id: number) {
    return this.licenses.deleteCategory(id);
  }

  /** Public verification of an issued licence certificate by its licence number. */
  @Get('public/verify/:licenseNumber')
  @Public()
  async verifyPublic(@Param('licenseNumber') licenseNumber: string) {
    const result = await this.licenses.verifyByNumber(licenseNumber);
    if (!result) {
      throw new NotFoundEntityException('License', licenseNumber);
    }
    return result;
  }

  /** The caller's own licences and applications. */
  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async mine(@ActingOrg() organization: Organization) {
    return (await this.licenses.listFor(organization)).map(describe);
  }

  @Post()
  @RequireCapability(Capability.MANAGE_USERS)
  async apply(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: ApplyForLicenseDto,
  ) {
    return describe(await this.licenses.apply(organization, actor, dto));
  }

  @Post(':id/documents')
  @RequireCapability(Capability.MANAGE_USERS)
  @UseInterceptors(FileInterceptor('file'))
  async attach(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttachDocumentDto,
    @UploadedFile() file?: Upload,
  ) {
    if (!file) {
      throw new TraceabilityRuleException('Attach a file under the "file" field');
    }
    const document = await this.licenses.attachDocument(
      organization,
      actor,
      id,
      dto.documentType,
      file,
    );
    return {
      id: document.id,
      documentType: document.documentType,
      filename: document.filename,
      contentType: document.contentType,
      sizeBytes: document.sizeBytes,
      uploadedAt: document.uploadedAt,
    };
  }

  /**
   * The applicant's own checklist: what is already attached to this licence.
   *
   * The regulator has had this since review existed; the holder never did,
   * which left the Continue Application dialog asking for documents it could
   * not see were already there. Ownership is checked in the service - the
   * capability says a business may read its paperwork, `documentsOfOwn` says
   * it is theirs to read.
   */
  @Get(':id/documents')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async myDocuments(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return (await this.licenses.documentsOfOwn(organization, id)).map(
      (document) => ({
        id: document.id,
        documentType: document.documentType,
        filename: document.filename,
        contentType: document.contentType,
        sizeBytes: document.sizeBytes,
        uploadedAt: document.uploadedAt,
      }),
    );
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_USERS)
  async submit(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.licenses.submit(organization, actor, id));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_USERS)
  async cancel(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.licenses.cancel(organization, actor, id));
  }

  @Post(':id/renew')
  @RequireCapability(Capability.MANAGE_USERS)
  async renew(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.licenses.renew(organization, actor, id));
  }

  @Get(':id/history')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async history(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return (await this.licenses.historyOfOwn(organization, id)).map((event) => ({
      id: event.id,
      type: event.type,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      actor: event.actor?.fullName ?? null,
      notes: event.notes,
      recordedAt: event.recordedAt,
    }));
  }

  /** Streams a certificate back. Holder and regulators only. */
  @Get('documents/:documentId')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async download(
    @ActingOrg() organization: Organization,
    @Param('documentId', ParseIntPipe) documentId: number,
    @Res() response: Response,
  ): Promise<void> {
    const { document, content } = await this.licenses.readDocument(
      organization,
      documentId,
    );
    response
      .type(document.contentType)
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${document.filename.replace(/["\r\n]/g, '')}"`,
      )
      .send(content);
  }

  @Get(':id/follow-ups')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async followUps(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const followUps = await this.licenses.listFollowUpsOfOwn(organization, id);
    return followUps.map((fu) => ({
      id: fu.id,
      licenseId: fu.licenseId,
      title: fu.title,
      description: fu.description,
      priority: fu.priority,
      status: fu.status,
      dueDate: fu.dueDate,
      createdBy: fu.createdBy ? { id: fu.createdBy.id, fullName: fu.createdBy.fullName } : null,
      businessResponse: fu.businessResponse,
      evidenceAttachmentKey: fu.evidenceAttachmentKey,
      evidenceFilename: fu.evidenceFilename,
      actionedBy: fu.actionedBy ? { id: fu.actionedBy.id, fullName: fu.actionedBy.fullName } : null,
      actionedAt: fu.actionedAt,
      closureNotes: fu.closureNotes,
      closedBy: fu.closedBy ? { id: fu.closedBy.id, fullName: fu.closedBy.fullName } : null,
      closedAt: fu.closedAt,
      createdAt: fu.createdAt,
      updatedAt: fu.updatedAt,
    }));
  }

  @Post(':id/follow-ups/:followUpId/action')
  @RequireCapability(Capability.MANAGE_USERS)
  async actionFollowUp(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Param('followUpId', ParseIntPipe) followUpId: number,
    @Body() dto: ActionFollowUpDto,
  ) {
    const fu = await this.licenses.actionFollowUp(organization, actor, id, followUpId, dto);
    return {
      id: fu.id,
      licenseId: fu.licenseId,
      title: fu.title,
      description: fu.description,
      priority: fu.priority,
      status: fu.status,
      dueDate: fu.dueDate,
      businessResponse: fu.businessResponse,
      evidenceAttachmentKey: fu.evidenceAttachmentKey,
      evidenceFilename: fu.evidenceFilename,
      actionedBy: fu.actionedBy ? { id: fu.actionedBy.id, fullName: fu.actionedBy.fullName } : null,
      actionedAt: fu.actionedAt,
      closureNotes: fu.closureNotes,
      closedBy: fu.closedBy ? { id: fu.closedBy.id, fullName: fu.closedBy.fullName } : null,
      closedAt: fu.closedAt,
      createdAt: fu.createdAt,
      updatedAt: fu.updatedAt,
    };
  }
}

/**
 * The regulator's side. Every route here re-checks that the caller is a
 * licensing authority in the service, not only via the capability - the
 * capability says what the role may do, the check says who they are.
 */
@ApiTags('License Review')
@ApiBearerAuth()
@Controller('api/regulator/licenses')
export class LicenseReviewController {
  constructor(
    private readonly licenses: LicenseService,
    private readonly enforcement: LicenseEnforcementService,
  ) {}

  /** Applications waiting to be screened. */
  @Get('queue')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async queue(@ActingOrg() regulator: Organization) {
    return (await this.licenses.queue(regulator)).map(describe);
  }

  /**
   * Businesses recorded acting outside what their licence covers - the
   * "expired licenses" and "unregistered products" half of the section 10
   * compliance panel. This is what advisory enforcement produces instead of a
   * refusal, so it is the regulator's route to the same information.
   *
   * Platform operators (SYSTEM_ADMIN) may also read it — they oversee the
   * registry but do not decide licences.
   */
  @Get('findings')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async findings(
    @OptionalActingOrg() organization: Organization | null,
    @CurrentUser() actor: User,
  ) {
    requireIndustryOverseer(organization, actor);
    const findings = await this.enforcement.recentFindings();
    return {
      enforcement: this.enforcement.enforcementMode(),
      findings: findings.map((finding: ComplianceFinding) => ({
        id: finding.id,
        organizationId: finding.organization.id,
        organizationName: finding.organization.name,
        type: finding.type,
        activity: finding.activity,
        action: finding.action,
        licenseNumber: finding.license?.licenseNumber ?? null,
        detail: finding.detail,
        recordedAt: finding.recordedAt,
      })),
    };
  }

  /** Full record for one finding — list rows truncate; this does not. */
  @Get('findings/:id')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async findingOne(
    @Param('id', ParseIntPipe) id: number,
    @OptionalActingOrg() organization: Organization | null,
    @CurrentUser() actor: User,
  ) {
    requireIndustryOverseer(organization, actor);
    const finding = await this.enforcement.findingById(id);
    if (!finding) {
      throw new NotFoundEntityException('ComplianceFinding', id);
    }

    const org = finding.organization;
    const license = finding.license;
    const findingActor = finding.actor;

    return {
      id: finding.id,
      type: finding.type,
      activity: finding.activity,
      action: finding.action,
      detail: finding.detail,
      recordedAt: finding.recordedAt,
      organization: org
        ? {
            id: org.id,
            name: org.name,
            type: org.type,
            tin: org.tin,
            registrationNumber: org.registrationNumber,
          }
        : null,
      license: license
        ? {
            id: license.id,
            licenseNumber: license.licenseNumber,
            status: license.status,
            expiresOn: license.expiresOn,
          }
        : null,
      actor: findingActor
        ? {
            id: findingActor.id,
            email: findingActor.email,
            fullName: findingActor.fullName,
            role: findingActor.role,
          }
        : null,
      enforcement: this.enforcement.enforcementMode(),
    };
  }

  @Post(':id/review')
  @HttpCode(200)
  @RequireCapability(Capability.DECIDE_LICENCES)
  async startReview(
    @ActingOrg() regulator: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.licenses.startReview(regulator, actor, id));
  }

  @Post(':id/decision')
  @HttpCode(200)
  @RequireCapability(Capability.DECIDE_LICENCES)
  async decide(
    @ActingOrg() regulator: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecisionDto,
  ) {
    return describe(await this.licenses.decide(regulator, actor, id, dto));
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @RequireCapability(Capability.DECIDE_LICENCES)
  async suspend(
    @ActingOrg() regulator: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RequiredReasonDto,
  ) {
    return describe(await this.licenses.suspend(regulator, actor, id, dto.reason));
  }

  @Post(':id/reinstate')
  @HttpCode(200)
  @RequireCapability(Capability.DECIDE_LICENCES)
  async reinstate(
    @ActingOrg() regulator: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto?: ReasonDto,
  ) {
    return describe(
      await this.licenses.reinstate(regulator, actor, id, dto?.reason),
    );
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequireCapability(Capability.DECIDE_LICENCES)
  async revoke(
    @ActingOrg() regulator: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RequiredReasonDto,
  ) {
    return describe(await this.licenses.revoke(regulator, actor, id, dto.reason));
  }

  /**
   * A licence's paperwork, for screening.
   *
   * Standing is checked here for the same reason `queue` checks it: the
   * capability is held by every business that can view its own operations, so
   * without this a competitor could list another company's certificates by
   * licence id. Only the filenames were ever exposed - `readDocument` has
   * always checked ownership before handing back bytes - but a filename is
   * enough to say who a rival banks with.
   */
  @Get(':id/documents')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async documents(
    @ActingOrg() regulator: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    requireRegulatorStanding(regulator, "Another business's certificates");
    return (await this.licenses.documentsOf(id)).map((document) => ({
      id: document.id,
      documentType: document.documentType,
      filename: document.filename,
      contentType: document.contentType,
      sizeBytes: document.sizeBytes,
      uploadedAt: document.uploadedAt,
    }));
  }

  @Get(':id/follow-ups')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async followUps(
    @ActingOrg() regulator: Organization,
    @Param('id', ParseIntPipe) id: number,
  ) {
    requireRegulatorStanding(regulator);
    const followUps = await this.licenses.listFollowUps(id);
    return followUps.map((fu) => ({
      id: fu.id,
      licenseId: fu.licenseId,
      title: fu.title,
      description: fu.description,
      priority: fu.priority,
      status: fu.status,
      dueDate: fu.dueDate,
      createdBy: fu.createdBy ? { id: fu.createdBy.id, fullName: fu.createdBy.fullName } : null,
      businessResponse: fu.businessResponse,
      evidenceAttachmentKey: fu.evidenceAttachmentKey,
      evidenceFilename: fu.evidenceFilename,
      actionedBy: fu.actionedBy ? { id: fu.actionedBy.id, fullName: fu.actionedBy.fullName } : null,
      actionedAt: fu.actionedAt,
      closureNotes: fu.closureNotes,
      closedBy: fu.closedBy ? { id: fu.closedBy.id, fullName: fu.closedBy.fullName } : null,
      closedAt: fu.closedAt,
      createdAt: fu.createdAt,
      updatedAt: fu.updatedAt,
    }));
  }

  @Post(':id/follow-ups')
  @RequireAnyCapability(Capability.DECIDE_LICENCES, Capability.OVERSEE_INDUSTRIES)
  async createFollowUp(
    @ActingOrg() regulator: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateFollowUpDto,
  ) {
    requireRegulatorStanding(regulator);
    const fu = await this.licenses.addFollowUp(regulator, actor, id, dto);
    return {
      id: fu.id,
      licenseId: fu.licenseId,
      title: fu.title,
      description: fu.description,
      priority: fu.priority,
      status: fu.status,
      dueDate: fu.dueDate,
      createdBy: fu.createdBy ? { id: fu.createdBy.id, fullName: fu.createdBy.fullName } : null,
      createdAt: fu.createdAt,
    };
  }

  @Post(':id/follow-ups/:followUpId/close')
  @RequireAnyCapability(Capability.DECIDE_LICENCES, Capability.OVERSEE_INDUSTRIES)
  async closeFollowUp(
    @ActingOrg() regulator: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Param('followUpId', ParseIntPipe) followUpId: number,
    @Body() dto: CloseFollowUpDto,
  ) {
    requireRegulatorStanding(regulator);
    const fu = await this.licenses.closeFollowUp(regulator, actor, id, followUpId, dto);
    return {
      id: fu.id,
      licenseId: fu.licenseId,
      title: fu.title,
      description: fu.description,
      priority: fu.priority,
      status: fu.status,
      closureNotes: fu.closureNotes,
      closedBy: fu.closedBy ? { id: fu.closedBy.id, fullName: fu.closedBy.fullName } : null,
      closedAt: fu.closedAt,
    };
  }

  /**
   * Generates a one-time response token for a follow-up condition and emails
   * the holder organisation with the link so they can submit evidence without
   * having to log in.
   */
  @Post(':id/follow-ups/:followUpId/send-link')
  @RequireAnyCapability(Capability.DECIDE_LICENCES, Capability.OVERSEE_INDUSTRIES)
  async sendFollowUpLink(
    @ActingOrg() regulator: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Param('followUpId', ParseIntPipe) followUpId: number,
    @Body() dto: SendFollowUpLinkDto,
  ) {
    requireRegulatorStanding(regulator);
    const fu = await this.licenses.sendFollowUpLink(regulator, actor, id, followUpId, dto);
    return {
      id: fu.id,
      responseTokenExpiresAt: fu.responseTokenExpiresAt,
    };
  }
}

function describe(license: License) {
  return {
    id: license.id,
    licenseNumber: license.licenseNumber,
    status: license.status,
    provisional: license.provisional,
    organizationId: license.organization.id,
    organizationName: license.organization.name,
    categoryId: license.category.id,
    categoryCode: license.category.code,
    categoryName: license.category.name,
    activity: license.category.activity,
    facilityId: license.facilityId ?? null,
    facilityName: license.facility?.name ?? null,
    grain: grainOf(license),
    issuedByName: license.issuedBy?.name ?? null,
    reviewedByName: license.reviewedBy?.fullName ?? null,
    issuedOn: license.issuedOn,
    expiresOn: license.expiresOn,
    statusReason: license.statusReason,
    statusChangedAt: license.statusChangedAt,
    previousLicenseId: license.previousLicense?.id ?? null,
    premiseMetadata: license.premiseMetadata ?? null,
  };
}

/**
 * Regulatory standing for cross-organization compliance reads.
 * Licensing authorities and the platform operator may call these.
 */
function requireIndustryOverseer(
  organization: Organization | null,
  actor: User,
): void {
  if (actor.role === UserRole.SYSTEM_ADMIN) {
    return;
  }
  if (!organization) {
    throw new OrganizationRequiredException();
  }
  requireRegulatorStanding(organization);
}

/**
 * Regulatory standing, checked at the controller for the cross-organization
 * reads that have no service-side owner to check it for them.
 */
function requireRegulatorStanding(
  organization: Organization,
  subject = 'Compliance findings across businesses',
): void {
  if (organization.type !== OrganizationType.REGULATOR) {
    throw new TraceabilityRuleException(
      `${subject} are available to licensing authorities only`,
    );
  }
}
