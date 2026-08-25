import { IsDateString, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateBatchDto {
  @IsInt()
  productId: number;

  /**
   * The site that made this lot.
   *
   * Optional because a single-site business has nothing to choose, but it is
   * what lets a scanned product name the plant it came from — and what a
   * site-scoped licence is assessed against (DR-07).
   */
  @IsOptional()
  @IsInt({ message: 'Choose one of your own sites' })
  facilityId?: number;

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
