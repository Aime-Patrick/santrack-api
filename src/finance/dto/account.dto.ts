import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { AccountType } from '../finance.enums';

export class CreateAccountDto {
  @IsString()
  @MinLength(1, { message: 'Account code is required' })
  code: string;

  @IsString()
  @MinLength(1, { message: 'Account name is required' })
  name: string;

  @IsEnum(AccountType)
  type: AccountType;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateCostCentreDto {
  @IsString()
  @MinLength(1, { message: 'Cost centre code is required' })
  code: string;

  @IsString()
  @MinLength(1, { message: 'Cost centre name is required' })
  name: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateCostCentreDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}