import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class BomLineDto {
  @IsInt()
  materialId: number;

  /** How much of this material one finished unit needs. */
  @IsNumber()
  @Min(0, { message: 'quantityPerUnit cannot be negative' })
  quantityPerUnit: number;

  /** Expected process loss, as a percentage. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  wastagePercent?: number;
}

export class CreateBomDto {
  @IsInt()
  productId: number;

  @IsOptional()
  @IsString()
  name?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'A BOM needs at least one material' })
  @ValidateNested({ each: true })
  @Type(() => BomLineDto)
  lines: BomLineDto[];
}
