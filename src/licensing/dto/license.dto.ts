import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import {
  LicensedActivity,
  LicenseFollowUpPriority,
} from '../licensing.enums';
import { OrganizationType } from '../../organization/organization-type.enum';

export class CreateLicenseCategoryDto {
  @IsString()
  @IsNotEmpty({ message: 'Category code is required' })
  code: string;

  @IsString()
  @IsNotEmpty({ message: 'Category name is required' })
  name: string;

  @IsEnum(LicensedActivity, { message: 'Valid activity is required' })
  activity: LicensedActivity;

  @IsArray()
  @IsEnum(OrganizationType, { each: true, message: 'Valid organization types required' })
  appliesTo: OrganizationType[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permittedProductCategories?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredDocuments?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  validityMonths?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateLicenseCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(LicensedActivity)
  activity?: LicensedActivity;

  @IsOptional()
  @IsArray()
  @IsEnum(OrganizationType, { each: true })
  appliesTo?: OrganizationType[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permittedProductCategories?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredDocuments?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  validityMonths?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}


export class ApplyForLicenseDto {
  @IsInt()
  categoryId: number;

  /**
   * The site this application is about, or absent for the business as a whole
   * (DR-07 WU-3).
   */
  @IsOptional()
  @IsInt()
  facilityId?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * Optional full premise metadata snapshot (technician, ownership, location, products produced).
   */
  @IsOptional()
  premiseMetadata?: Record<string, any>;

  /**
   * Optional facility details if registering a new facility along with the premise license.
   */
  @IsOptional()
  facilityDetails?: {
    name: string;
    province?: string;
    district?: string;
    sector?: string;
    cell?: string;
    village?: string;
    businessCenter?: string;
    gpsCoordinates?: { lat: number; lng: number };
    landUpi?: string;
    ownershipType?: string;
    leaseContractExpiry?: string;
  };
}

export class AttachDocumentDto {
  /** Must match one of the category's required document types. */
  @IsString()
  @MinLength(1, { message: 'Say which document this is' })
  documentType: string;
}

export enum ReviewDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class DecisionDto {
  @IsEnum(ReviewDecision)
  decision: ReviewDecision;

  /** Required on rejection - the applicant has to know what to fix. */
  @IsOptional()
  @IsString()
  reason?: string;

  /** Overrides the category's default validity when a regulator needs to. */
  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  expiresOn?: string;
}

export class ReasonDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class RequiredReasonDto {
  @IsString()
  @MinLength(3, { message: 'Give a reason - it is shown to the licence holder' })
  reason: string;
}

export class CreateFollowUpDto {
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  title: string;

  @IsString()
  @IsNotEmpty({ message: 'Description is required' })
  description: string;

  @IsOptional()
  @IsEnum(LicenseFollowUpPriority)
  priority?: LicenseFollowUpPriority;

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  dueDate?: string;
}

export class ActionFollowUpDto {
  @IsString()
  @IsNotEmpty({ message: 'Provide details of the corrective actions taken' })
  businessResponse: string;

  @IsOptional()
  @IsString()
  evidenceAttachmentKey?: string;

  @IsOptional()
  @IsString()
  evidenceFilename?: string;
}

export class CloseFollowUpDto {
  @IsOptional()
  @IsString()
  closureNotes?: string;
}

/** Regulator sends a token-secured response link to the license holder. */
export class SendFollowUpLinkDto {
  /**
   * How many days until the token expires. Defaults to 7, max 30.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  expiryDays?: number;
}

/** Applicant's submission through the public token link. */
export class PublicFollowUpResponseDto {
  @IsOptional()
  @IsString()
  businessResponse?: string;
}

