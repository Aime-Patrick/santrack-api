import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
} from 'class-validator';
import { AttendanceStatus } from '../payroll.enums';

export class MarkAttendanceDto {
  @IsInt({ message: 'Employee is required' })
  employeeId: number;

  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  attendanceDate: string;

  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @IsOptional()
  @IsNumberString()
  overtimeHours?: string;
}