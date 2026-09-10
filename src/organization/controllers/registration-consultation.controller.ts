import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Capability } from '../../auth/capabilities';
import { User } from '../../auth/entities/user.entity';
import { ActingOrg, CurrentUser, RequireCapability } from '../../common/decorators';
import { TraceabilityRuleException } from '../../common/errors';
import { RegulatoryAuthorityService } from '../../licensing/services/regulatory-authority.service';
import { Organization } from '../entities/organization.entity';
import {
  ConsultationStatus,
  ConsultationVerdict,
  RegistrationConsultation,
} from '../entities/registration-consultation.entity';
import { RegistrationConsultationService } from '../services/registration-consultation.service';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

class OpenConsultationBody {
  @IsInt()
  @Min(1)
  toAuthorityId: number;

  @IsString()
  @MinLength(5)
  @MaxLength(300)
  subject: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  contextNote?: string;

  @IsOptional()
  @IsInt({ each: true })
  forwardedDocumentIds?: number[];

  @IsOptional()
  @IsString()
  dueDate?: string;
}

class RespondConsultationBody {
  @IsEnum(ConsultationVerdict, {
    message: `verdict must be one of: ${Object.values(ConsultationVerdict).join(', ')}`,
  })
  verdict: ConsultationVerdict;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  responseNote?: string;
}

// ---------------------------------------------------------------------------
// Serializer — what the API returns (never raw entities with relations)
// ---------------------------------------------------------------------------

function describe(c: RegistrationConsultation) {
  return {
    id: c.id,
    subject: c.subject,
    contextNote: c.contextNote,
    forwardedDocumentIds: c.forwardedDocumentIds,
    status: c.status,
    verdict: c.verdict,
    responseNote: c.responseNote,
    dueDate: c.dueDate,
    createdAt: c.createdAt,
    respondedAt: c.respondedAt,
    fromAuthority: c.fromAuthority
      ? { id: c.fromAuthority.id, code: c.fromAuthority.code, name: c.fromAuthority.name }
      : null,
    toAuthority: c.toAuthority
      ? { id: c.toAuthority.id, code: c.toAuthority.code, name: c.toAuthority.name }
      : null,
    organization: c.organization
      ? { id: c.organization.id, name: c.organization.name, type: c.organization.type }
      : null,
    createdBy: c.createdBy
      ? { id: c.createdBy.id, fullName: c.createdBy.fullName, email: c.createdBy.email }
      : null,
    respondedBy: c.respondedBy
      ? { id: c.respondedBy.id, fullName: c.respondedBy.fullName, email: c.respondedBy.email }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Primary authority routes:  /api/organizations/:id/consultations
// These are used by the reviewing regulator from inside the registration dialog.
// ---------------------------------------------------------------------------

@ApiTags('Registration consultations')
@ApiBearerAuth()
@Controller('api/organizations/:orgId/consultations')
export class RegistrationConsultationController {
  constructor(
    private readonly consultationService: RegistrationConsultationService,
    private readonly authorityService: RegulatoryAuthorityService,
  ) {}

  /**
   * Primary authority opens a consultation to another authority.
   * Only the regulator currently reviewing the application may open
   * consultations on it.
   */
  @Post()
  @RequireCapability(Capability.DECIDE_LICENCES)
  async open(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('orgId', ParseIntPipe) orgId: number,
    @Body() dto: OpenConsultationBody,
  ) {
    const fromAuthority = await this.authorityService.forOperator(organization);
    const consultation = await this.consultationService.open(
      actor,
      fromAuthority,
      orgId,
      dto,
    );
    return describe(consultation);
  }

  /**
   * All consultations opened by the caller's authority on this application.
   */
  @Get()
  @RequireCapability(Capability.DECIDE_LICENCES)
  async list(
    @ActingOrg() organization: Organization,
    @Param('orgId', ParseIntPipe) orgId: number,
  ) {
    const fromAuthority = await this.authorityService.forOperator(organization);
    const rows = await this.consultationService.listForOrganization(
      orgId,
      fromAuthority,
    );
    return rows.map(describe);
  }

  /**
   * Primary authority cancels a PENDING consultation (no longer needs it,
   * or has decided to proceed without waiting).
   */
  @Post(':consultationId/cancel')
  @HttpCode(200)
  @RequireCapability(Capability.DECIDE_LICENCES)
  async cancel(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('orgId', ParseIntPipe) _orgId: number,
    @Param('consultationId', ParseIntPipe) consultationId: number,
  ) {
    const fromAuthority = await this.authorityService.forOperator(organization);
    const consultation = await this.consultationService.cancel(
      actor,
      fromAuthority,
      consultationId,
    );
    return describe(consultation);
  }
}

// ---------------------------------------------------------------------------
// Secondary authority routes:  /api/regulator/registration-consultations
// These are used by the consulted authority from their incoming inbox.
// ---------------------------------------------------------------------------

@ApiTags('Registration consultations')
@ApiBearerAuth()
@Controller('api/regulator/registration-consultations')
export class RegistrationConsultationInboxController {
  constructor(
    private readonly consultationService: RegistrationConsultationService,
    private readonly authorityService: RegulatoryAuthorityService,
  ) {}

  /**
   * The secondary authority's incoming consultation inbox.
   * Returns PENDING and OVERDUE consultations addressed to them.
   */
  @Get('incoming')
  @RequireCapability(Capability.DECIDE_LICENCES)
  async incoming(@ActingOrg() organization: Organization) {
    const toAuthority = await this.authorityService.forOperator(organization);
    const rows = await this.consultationService.incomingForAuthority(toAuthority);
    return rows.map(({ consultation, overdue }) => ({
      ...describe(consultation),
      overdue,
    }));
  }

  /**
   * Secondary authority responds to a consultation with their advisory verdict.
   * APPROVED / CONCERNS / OBJECTION — all three are advisory; the primary
   * authority still makes the final registration decision.
   */
  @Post(':consultationId/respond')
  @HttpCode(200)
  @RequireCapability(Capability.DECIDE_LICENCES)
  async respond(
    @ActingOrg() organization: Organization,
    @CurrentUser() actor: User,
    @Param('consultationId', ParseIntPipe) consultationId: number,
    @Body() dto: RespondConsultationBody,
  ) {
    const toAuthority = await this.authorityService.forOperator(organization);
    const consultation = await this.consultationService.respond(
      actor,
      toAuthority,
      consultationId,
      dto,
    );
    return describe(consultation);
  }
}
