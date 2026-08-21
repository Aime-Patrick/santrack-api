import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { EmployeeStatus, PayItemType } from '../payroll.enums';

export class CreateEmployeeDto {
  @IsString()
  @MinLength(1, { message: 'Employee name is required' })
  name: string;

  @IsOptional()
  @IsInt()
  departmentId?: number;

  @IsOptional()
  @IsInt()
  jobPositionId?: number;

  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  hireDate?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Provide a valid email' })
  email?: string;

  @IsNumberString({}, { message: 'Basic salary is required' })
  baseSalary: string;

  @IsOptional()
  @IsNumberString()
  overtimeRate?: string;

  @IsOptional()
  @Type(() => CreatePayItemDto)
  @ValidateNested({ each: true })
  payItems?: CreatePayItemDto[];
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  departmentId?: number;

  @IsOptional()
  @IsInt()
  jobPositionId?: number;

  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  hireDate?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Provide a valid email' })
  email?: string;

  @IsOptional()
  @IsNumberString()
  baseSalary?: string;

  @IsOptional()
  @IsNumberString()
  overtimeRate?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreatePayItemDto {
  @IsString()
  @MinLength(1, { message: 'Pay item name is required' })
  name: string;

  @IsEnum(PayItemType)
  type: PayItemType;

  @IsNumberString({}, { message: 'Pay item amount is required' })
  amount: string;
}