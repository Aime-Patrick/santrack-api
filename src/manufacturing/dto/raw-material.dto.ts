import { IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateRawMaterialDto {
  @IsString()
  @MinLength(1, { message: 'Material name is required' })
  name: string;

  /** Omitted codes are generated, so a scan of a bare rack still works. */
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsString()
  @MinLength(1, { message: 'Unit of measure is required (kg, l, m, ...)' })
  unitOfMeasure: string;

  @IsOptional()
  @IsNumber()
  unitCost?: number;

  @IsOptional()
  @IsNumber()
  reorderLevel?: number;
}
