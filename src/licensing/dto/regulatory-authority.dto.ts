import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateRegulatoryAuthorityDto {
  @IsString()
  @Matches(/^[A-Z0-9_]{2,32}$/, { message: 'code must use uppercase letters, numbers or underscores' })
  code: string;

  @IsInt()
  operatingOrganizationId: number;
}

export class OnboardRegulatoryAuthorityDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsString()
  @Matches(/^[A-Z0-9_]{2,32}$/, { message: 'code must use uppercase letters, numbers or underscores' })
  code: string;

  @IsOptional()
  @IsInt()
  operatingOrganizationId?: number;

  @IsOptional()
  @IsString()
  adminFullName?: string;

  @IsOptional()
  @IsString()
  adminEmail?: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  adminPassword?: string;
}

export class UpdateRegulatoryAuthorityDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Settings owned by the authority itself, never by the platform operator. */
export class ConfigureOwnAuthorityDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  mandates?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  caseCategories?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  teams?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  referralResponseDays?: number | null;
}
