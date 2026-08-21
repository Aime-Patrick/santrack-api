import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class StockAdjustmentItemDto {
  /** QR code or printed code of the item being adjusted. */
  @IsString()
  @MinLength(1)
  itemQrCode: string;

  /** What the system says is on hand (for audit, not enforced). */
  @IsInt()
  @Min(0)
  systemCount: number;

  /** What was actually counted on the shelf. */
  @IsInt()
  @Min(0)
  physicalCount: number;

  /** Why the count differs — damage, theft, spillage, found extra, etc. */
  @IsString()
  @MinLength(1, { message: 'An adjustment needs a reason' })
  @MaxLength(1000)
  reason: string;

  /** Optionally mark the item as damaged during the count. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  statusOverride?: string;
}

export class StockAdjustmentDto {
  /** Location where the count was taken. */
  @IsInt()
  locationId: number;

  /** The items counted and any discrepancies found. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockAdjustmentItemDto)
  adjustments: StockAdjustmentItemDto[];
}
