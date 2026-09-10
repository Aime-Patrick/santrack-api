import {
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  OrganizationType,
  SELF_DECLARABLE_TYPES,
} from '../organization-type.enum';
import { IndustrySector } from '../onboarding-status.enum';

export class CreateOrganizationDto {
  @IsString()
  @MinLength(2, { message: 'Organization name is required' })
  name: string;

  @IsIn(SELF_DECLARABLE_TYPES as OrganizationType[], {
    message: `Choose the kind of business this is: ${SELF_DECLARABLE_TYPES.join(', ')}`,
  })
  type: OrganizationType;

  @IsOptional()
  @IsString()
  @MinLength(5, { message: 'TIN looks too short' })
  tin?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Registration number looks too short' })
  registrationNumber?: string;

  // ── Extended onboarding fields ──

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  licenseType?: string;

  @IsOptional()
  @IsDateString()
  dateIncorporated?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sector?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cell?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  village?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OwnershipDto)
  ownership?: OwnershipDto[];

  /**
   * The industry sector this business operates in. Used to route the
   * registration application to the correct regulatory authority for review
   * (e.g. Rwanda FDA for pharmaceuticals, RSB for general manufacturing,
   * RMB for minerals, NAEB for agricultural exports).
   */
  @IsOptional()
  @IsEnum(IndustrySector, {
    message: `Choose a valid industry sector: ${Object.values(IndustrySector).join(', ')}`,
  })
  industrySector?: IndustrySector;
}

export class OwnershipDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  percentage: number;

  @IsOptional()
  @IsString()
  idNumber?: string;
}

/**
 * The regulator's verdict on a registration application.
 *
 * Three possible decisions:
 * - APPROVE: activates the business and issues its operating licence.
 * - REQUEST_CHANGES: sends the application back to the applicant with a note
 *   explaining what to fix. The application stays open; the applicant can
 *   upload new documents and resubmit, re-entering the review queue.
 * - REJECT: closes the application. The applicant is told why and must
 *   re-register to try again.
 *
 * Approval activates the business and issues its operating licence; rejection
 * needs a reason, because the applicant has to know what to fix before they
 * resubmit.
 */
/**
 * One certificate uploaded against a registration application.
 * Document type is required; number/expiry ride along for the review screen.
 */
export class AttachRegistrationDocumentDto {
  @IsString()
  documentType: string;

  @IsOptional()
  @IsString()
  certificateNumber?: string;

  @IsOptional()
  @IsString()
  expiryDate?: string;
}

export class RegistrationDecisionDto {
  @IsIn(['APPROVE', 'REQUEST_CHANGES', 'REJECT'], {
    message: "Decision must be APPROVE, REQUEST_CHANGES, or REJECT",
  })
  decision: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

/**
 * Corrects a registry entry. Both fields are optional because the two reasons
 * to touch the register are independent: a company renames itself, or it was
 * recorded as the wrong kind of business.
 *
 * REGULATOR is not accepted here for the same reason it is not accepted at
 * sign-up - standing is conferred, not typed in.
 */
export class AmendOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Organization name is required' })
  name?: string;

  @IsOptional()
  @IsIn(SELF_DECLARABLE_TYPES as OrganizationType[], {
    message: `Choose the kind of business this is: ${SELF_DECLARABLE_TYPES.join(', ')}`,
  })
  type?: OrganizationType;

  @IsOptional()
  @IsString()
  @MinLength(5, { message: 'TIN looks too short' })
  tin?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Registration number looks too short' })
  registrationNumber?: string;
}

/** Platform-operator action, not part of onboarding. */
export class GrantRegulatoryStandingDto {
  @IsEnum(OrganizationType)
  @IsIn([OrganizationType.REGULATOR], {
    message: 'This endpoint only confers regulatory standing',
  })
  type: OrganizationType;
}

/**
 * Registers an oversight body directly, rather than promoting a business that
 * signed itself up.
 *
 * Onboarding attaches the new organization to the caller, which is right for a
 * business — someone works there — and wrong for a regulator: the platform
 * operator registering the authority does not join it. Without this, standing
 * a regulator up meant creating a trade account under its name first and then
 * promoting it, which leaves a manufacturer-shaped record behind.
 */
export class RegisterRegulatorDto {
  @IsString()
  @MinLength(2, { message: 'Regulator name is required' })
  name: string;
}

/**
 * Withdraws regulatory standing.
 *
 * `revertTo` is required rather than defaulted because an organization always
 * has a type, and only the operator knows what this one is once it stops being
 * an authority. Guessing would silently turn a former regulator into a
 * manufacturer, which is a claim about a business nobody made.
 */
export class RevokeRegulatoryStandingDto {
  @IsIn(SELF_DECLARABLE_TYPES as OrganizationType[], {
    message: `State what this organization becomes: ${SELF_DECLARABLE_TYPES.join(', ')}`,
  })
  revertTo: OrganizationType;

  @IsString()
  @MinLength(1, { message: 'Withdrawing standing needs a reason' })
  reason: string;
}
