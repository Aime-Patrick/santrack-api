import { IsDateString, IsEnum, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RegulatoryCasePriority, RegulatoryCaseStatus } from '../entities/regulatory-case.entity';

export class OpenRegulatoryCaseDto {
  @IsInt()
  organizationId: number;

  @IsString()
  @MinLength(3)
  @MaxLength(180)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(RegulatoryCasePriority)
  priority?: RegulatoryCasePriority;

  @IsOptional()
  @IsInt()
  facilityId?: number;

  @IsOptional()
  @IsInt()
  licenseId?: number;

  @IsOptional()
  @IsInt()
  findingId?: number;

  @IsOptional()
  @IsInt()
  batchId?: number;

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd for dueOn' })
  dueOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  caseCategory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  assignedTeam?: string;
}

export class AssignRegulatoryCaseDto {
  @IsInt()
  officerId: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AssignRegulatoryCaseTeamDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  team: string;
}

export class ChangeRegulatoryCaseStatusDto {
  @IsEnum(RegulatoryCaseStatus)
  status: RegulatoryCaseStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ReferRegulatoryCaseDto {
  @IsInt()
  toAuthorityId: number;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}

export class DecideRegulatoryReferralDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
