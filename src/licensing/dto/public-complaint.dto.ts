import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PublicComplaintIssue } from '../entities/public-complaint.entity';

export class SubmitPublicComplaintDto {
  @IsString()
  @MaxLength(256)
  token: string;

  @IsEnum(PublicComplaintIssue)
  issue: PublicComplaintIssue;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  locationHint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  contact?: string;
}

export class PromotePublicComplaintDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  caseCategory: string;
}
