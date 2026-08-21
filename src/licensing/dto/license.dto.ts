import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class ApplyForLicenseDto {
  @IsInt()
  categoryId: number;

  /**
   * The site this application is about, or absent for the business as a whole
   * (DR-07 WU-3).
   *
   * Absent is the ordinary case and stays the default: most businesses are
   * licensed as a business. Naming a site is how a multi-plant manufacturer
   * gets Huye authorised separately from Kigali — and, once that licence
   * exists, how Huye can be suspended without stopping Kigali (D1).
   */
  @IsOptional()
  @IsInt()
  facilityId?: number;

  @IsOptional()
  @IsString()
  notes?: string;
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
