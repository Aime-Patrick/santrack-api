import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';

/**
 * The question the Start Production screen asks as the operator fills the form.
 *
 * Query parameters arrive as strings and the global pipe does not convert
 * implicitly, so each number is transformed explicitly rather than trusted.
 */
export class EligibilityQueryDto {
  @Type(() => Number)
  @IsInt({ message: 'productId must be a whole number' })
  productId: number;

  /**
   * The site producing this. Optional, because the form asks for it after the
   * product and a single-site business never has to answer at all.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'facilityId must be a whole number' })
  facilityId?: number;

  @Type(() => Number)
  @IsInt({ message: 'quantity must be a whole number' })
  @Min(1, { message: 'Quantity must be at least 1' })
  quantity: number;

  /**
   * The day the run is *for*. Optional: a half-filled form should get an
   * answer about today rather than a validation error, and the licence-validity
   * check reads this rather than today's date precisely so a run scheduled past
   * a licence's expiry is caught before it is booked.
   */
  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  date?: string;
}
