import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class MaterialQuantityDto {
  @IsInt()
  materialId: number;

  @IsNumber()
  @Min(0, { message: 'Quantity cannot be negative' })
  quantity: number;
}

export class CreateProductionOrderDto {
  /**
   * The site producing this (DR-02). Omitted, the organization's only site is
   * used; a business with several must say which, because guessing would put a
   * recall at the wrong plant.
   */
  @IsOptional()
  @IsInt()
  facilityId?: number;

  @IsInt()
  productId: number;

  @IsInt()
  @Min(1, { message: 'Planned quantity must be at least 1' })
  plannedQuantity: number;

  /** Auto-allocates materials from this BOM when provided. */
  @IsOptional()
  @IsInt()
  bomId?: number;

  @IsOptional()
  @IsInt()
  machineId?: number;

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  scheduledStartOn?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  scheduledEndOn?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class StartProductionDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

export class AllocateMaterialsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MaterialQuantityDto)
  materials: MaterialQuantityDto[];
}

export class IssueMaterialsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MaterialQuantityDto)
  materials: MaterialQuantityDto[];
}

export class CompleteProductionDto {
  /** Defaults to the planned quantity when omitted. */
  @IsOptional()
  @IsInt()
  @Min(1)
  producedQuantity?: number;

  /** Expiry to put on the batch, for products that expire. */
  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  expiresOn?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AmendQuantityDto {
  @IsInt()
  @Min(1, { message: 'New quantity must be at least 1' })
  newQuantity: number;

  @IsString()
  @MinLength(1, { message: 'An amendment needs a reason' })
  reason: string;
}

export class CancelProductionDto {
  @IsString()
  @MinLength(1, { message: 'A cancellation needs a reason' })
  reason: string;
}
