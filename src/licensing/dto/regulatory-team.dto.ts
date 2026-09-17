import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateRegulatoryTeamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(10_000)
  maxOpenCases?: number | null;
}

export class UpdateRegulatoryTeamDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Pass null to clear the cap. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(10_000)
  maxOpenCases?: number | null;
}

export class AddRegulatoryTeamMemberDto {
  @IsInt()
  userId: number;

  @IsOptional()
  @IsBoolean()
  isLeader?: boolean;
}

export class UpdateRegulatoryTeamMemberDto {
  @IsBoolean()
  isLeader: boolean;
}
