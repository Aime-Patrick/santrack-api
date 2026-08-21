import {
  IsDateString,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreatePayrollRunDto {
  /** The period being paid, e.g. '2026-08'. */
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'Use yyyy-MM' })
  period: string;

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  paidOn?: string;
}