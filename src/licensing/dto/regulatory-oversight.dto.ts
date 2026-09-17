import { IsEnum, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RegulatoryOversightMode } from '../entities/regulatory-oversight.entity';

export class GrantRegulatoryOversightDto {
  @IsInt()
  oversightOrganizationId: number;

  @IsInt()
  authorityId: number;

  @IsOptional()
  @IsEnum(RegulatoryOversightMode)
  mode?: RegulatoryOversightMode;
}

export class UpdateRegulatoryOversightModeDto {
  @IsEnum(RegulatoryOversightMode)
  mode: RegulatoryOversightMode;
}

export class NudgeSupervisedAuthorityDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note?: string;
}

export enum OversightLicenceOverrideAction {
  SUSPEND = 'SUSPEND',
  REVOKE = 'REVOKE',
  REINSTATE = 'REINSTATE',
}

export class OverrideSupervisedLicenceDto {
  @IsEnum(OversightLicenceOverrideAction)
  action: OversightLicenceOverrideAction;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}

export class PullUpSupervisedCaseDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}
