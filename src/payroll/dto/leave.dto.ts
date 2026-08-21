import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { LeaveType } from '../payroll.enums';

export class RequestLeaveDto {
  @IsInt({ message: 'Employee is required' })
  employeeId: number;

  @IsEnum(LeaveType)
  type: LeaveType;

  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  fromDate: string;

  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  toDate: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}