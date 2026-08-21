import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { InspectionResult } from '../manufacturing.enums';

export class CreateInspectionDto {
  /** At least one of productionOrderId / batchId is required. */
  @IsOptional()
  @IsInt()
  productionOrderId?: number;

  @IsOptional()
  @IsInt()
  batchId?: number;

  @IsEnum(InspectionResult)
  result: InspectionResult;

  @IsOptional()
  @IsString()
  notes?: string;
}
