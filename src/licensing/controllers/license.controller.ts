import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
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
  RequireCapability,
} from '../../common/decorators';
import { TraceabilityRuleException } from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
import {
  ApplyForLicenseDto,
  AttachDocumentDto,
  DecisionDto,
  ReasonDto,
  RequiredReasonDto,
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
    }));
  }

  /** The caller's own licences and applications. */
  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async mine(@ActingOrg() organization: Organization) {
    return (await this.licenses.listFor(organization)).map(describe);
  }

  @Post()
  @RequireCapability(Capability.MANAGE_CATALOG)
  async apply(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Body() dto: ApplyForLicenseDto,
  ) {
    return describe(await this.licenses.apply(organization, actor, dto));
  }

  @Post(':id/documents')
  @RequireCapability(Capability.MANAGE_CATALOG)
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
  @RequireCapability(Capability.MANAGE_CATALOG)
  async submit(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.licenses.submit(organization, actor, id));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequireCapability(Capability.MANAGE_CATALOG)
  async cancel(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return describe(await this.licenses.cancel(organization, actor, id));
  }

  @Post(':id/renew')
  @RequireCapability(Capability.MANAGE_CATALOG)
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
   */
  @Get('findings')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async findings(@ActingOrg() regulator: Organization) {
    requireRegulatorStanding(regulator);
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
    // What this licence is about: the business, or one of its sites (DR-07).
    // Stated explicitly rather than left for the caller to infer from a null,
    // so the UI can group a national licence and a plant licence apart instead
    // of listing them as interchangeable rows.
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
  };
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
