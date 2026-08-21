import {
  IsBoolean,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  @MinLength(1, { message: 'Department code is required' })
  code: string;

  @IsString()
  @MinLength(1, { message: 'Department name is required' })
  name: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateJobPositionDto {
  @IsString()
  @MinLength(1, { message: 'Job position code is required' })
  code: string;

  @IsString()
  @MinLength(1, { message: 'Job title is required' })
  title: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateJobPositionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}