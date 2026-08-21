import {
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreateBudgetDto {
  @IsInt({ message: 'Account is required' })
  accountId: number;

  @IsOptional()
  @IsInt()
  costCentreId?: number;

  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'Use yyyy-MM' })
  period: string;

  @IsNumberString({}, { message: 'Budget amount is required' })
  amount: string;
}

export class UpdateBudgetDto {
  @IsOptional()
  @IsNumberString()
  amount?: string;
}