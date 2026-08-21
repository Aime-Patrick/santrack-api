import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * A single posting on one side of a journal entry. Every line moves exactly
 * one side: a debit OR a credit, never both, never neither.
 */
export class JournalLineDto {
  @IsInt({ message: 'Account is required' })
  accountId: number;

  @IsOptional()
  @IsInt()
  costCentreId?: number;

  @IsOptional()
  @IsNumberString()
  debit?: string;

  @IsOptional()
  @IsNumberString()
  credit?: string;
}

export class CreateJournalEntryDto {
  @IsString()
  @MinLength(1, { message: 'A description is required' })
  description: string;

  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  postedOn: string;

  @IsArray()
  @ArrayNotEmpty({ message: 'An entry needs at least two lines' })
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines: JournalLineDto[];
}