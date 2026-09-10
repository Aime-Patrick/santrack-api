import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
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
import {
  ActingOrg,
  CurrentUser,
  OptionalActingOrg,
  RequireCapability,
} from '../../common/decorators';
import { TraceabilityRuleException } from '../../common/errors';
import {
  AmendOrganizationDto,
  AttachRegistrationDocumentDto,
  CreateOrganizationDto,
  GrantRegulatoryStandingDto,
  RegisterRegulatorDto,
  RegistrationDecisionDto,
  RevokeRegulatoryStandingDto,
} from '../dto/organization.dto';
import { OrganizationType } from '../organization-type.enum';
import { Organization } from '../entities/organization.entity';
import {
  OrganizationService,
  UploadedFile as DocUpload,
} from '../services/organization.service';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('api/organizations')
export class OrganizationController {
  constructor(private readonly organizations: OrganizationService) {}

  /** Onboarding - submits the business the caller acts for, for approval. */
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
   * Registration applications awaiting a regulator's decision.
   *
   * Declared before any parameterised route on purpose: Nest matches in
   * declaration order, and `pending` must never be read as an id.
   */
  @Get('pending')
  @RequireCapability(Capability.DECIDE_LICENCES)
  async pending() {
    const rows = await this.organizations.pendingRegistrations();
    return rows.map((row) => ({
      ...describe(row),
      ownership: (row.owners ?? []).map((owner) => ({
        id: owner.id,
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        percentage: Number(owner.percentage),
        idNumber: owner.idNumber,
      })),
    }));
  }

  /**
   * The regulator's verdict on a registration application. Approval activates
   * the business and issues its operating licence; rejection records why;
   * REQUEST_CHANGES sends it back with a note for the applicant to act on.
   */
  @Post(':id/decision')
  @HttpCode(200)
  @RequireCapability(Capability.DECIDE_LICENCES)
  async decide(
    @ActingOrg() regulator: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RegistrationDecisionDto,
  ) {
    return describe(await this.organizations.decideRegistration(regulator, actor, id, dto));
  }

  /**
   * Applicant resubmits after a CHANGES_REQUESTED decision.
   *
   * The applicant uploads any corrected/missing documents through
   * POST /api/organizations/:id/documents, then calls this endpoint to signal
   * the application is ready for re-review. Status returns to PENDING and
   * the review note is cleared.
   */
  @Post(':id/resubmit')
  @HttpCode(200)
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async resubmit(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    if (organization.id !== id) {
      throw new TraceabilityRuleException(
        'You can only resubmit your own registration',
      );
    }
    return describe(await this.organizations.resubmitRegistration(actor, organization));
  }

  /**
   * Files a certificate against a registration application. The applicant
   * uploads its RDB / FDA / import certificates here while the application is
   * pending; the regulator sees them in the review screen.
   *
   * Guarded by VIEW_OPERATIONS rather than MANAGE_CATALOG: VIEW_OPERATIONS is
   * inside every organization-type ceiling (WAREHOUSE, DISTRIBUTOR, RETAILER,
   * SHOP included), so a newly registered business of any type can upload its
   * own registration documents without getting a 403. The ownership check
   * below (`organization.id !== id`) is what actually enforces that you can
   * only file against your own application — the capability just proves you
   * hold an authenticated account.
   */
  @Post(':id/documents')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  @UseInterceptors(FileInterceptor('file'))
  async attachDocument(
    @ActingOrg() organization: Organization,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttachRegistrationDocumentDto,
    @UploadedFile() file?: DocUpload,
  ) {
    if (organization.id !== id) {
      throw new TraceabilityRuleException(
        'Documents can only be attached to your own registration',
      );
    }
    if (!file) {
      throw new TraceabilityRuleException('Attach a file under the "file" field');
    }
    const document = await this.organizations.attachDocument(
      organization,
      dto.documentType,
      file,
      dto.certificateNumber,
      dto.expiryDate,
    );
    return describeDocument(document);
  }

  /**
   * The certificates filed against a registration. The applicant may read its
   * own; the licensing authority may read any, which is what screening needs.
   *
   * OptionalActingOrg rather than ActingOrg so that SYSTEM_ADMIN users (who
   * have no organization of their own) can still view documents when screening
   * pending registrations. The service guards access: null reader means the
   * caller holds ADMINISTER_PLATFORM and may read everything.
   */
  @Get(':id/documents')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async documents(
    @OptionalActingOrg() organization: Organization | null,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const rows = await this.organizations.documentsFor(organization, id);
    return rows.map(describeDocument);
  }

  /** Streams a filed certificate back. Holder and regulators only. */
  @Get('documents/:documentId')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async download(
    @ActingOrg() organization: Organization,
    @Param('documentId', ParseIntPipe) documentId: number,
    @Res() response: Response,
  ): Promise<void> {
    const { document, content } = await this.organizations.readDocument(
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

  /**
   * Permanently deletes an organization and all data owned by it.
   *
   * Guards:
   *   - ADMINISTER_PLATFORM capability required (SYSTEM_ADMIN only).
   *   - Service-level safety checks block deletion if the org has users,
   *     products, or a linked regulatory-authority row.
   *
   * Intended for seed-data and test cleanup, not routine operation.
   */
  @Delete(':id')
  @HttpCode(204)
  @RequireCapability(Capability.ADMINISTER_PLATFORM)
  async purge(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.organizations.purge(id);
  }
}

function describe(organization: Organization) {
  return {
    id: organization.id,
    name: organization.name,
    type: organization.type,
    tin: organization.tin,
    registrationNumber: organization.registrationNumber,
    email: organization.email,
    phone: organization.phone,
    licenseType: organization.licenseType,
    dateIncorporated: organization.dateIncorporated,
    description: organization.description,
    province: organization.province,
    district: organization.district,
    sector: organization.sector,
    cell: organization.cell,
    village: organization.village,
    industrySector: organization.industrySector,
    onboardingStatus: organization.onboardingStatus,
    rejectionReason: organization.rejectionReason,
    reviewNote: organization.reviewNote,
    createdAt: organization.createdAt,
  };
}

function describeDocument(document: {
  id: number;
  documentType: string;
  certificateNumber: string | null;
  expiryDate: string | null;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: Date;
}) {
  return {
    id: document.id,
    documentType: document.documentType,
    certificateNumber: document.certificateNumber,
    expiryDate: document.expiryDate,
    filename: document.filename,
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
    uploadedAt: document.uploadedAt,
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
