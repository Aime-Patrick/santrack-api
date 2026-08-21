import { IsDateString, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateBatchDto {
  @IsInt()
  productId: number;

  @IsString()
  @MinLength(1, { message: 'Batch code is required' })
  batchCode: string;

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  manufacturedOn?: string;

  /** Omit for products that do not expire. */
  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  expiresOn?: string;
}
