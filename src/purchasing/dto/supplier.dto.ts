import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSupplierDto {
  @IsString()
  @MinLength(1, { message: 'Supplier name is required' })
  name: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @IsInt()
  linkedOrganizationId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contact?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  linkedOrganizationId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contact?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
