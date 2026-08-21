import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Query parameters arrive as strings, so the numeric and boolean fields are
 * coerced here rather than in the controller.
 */
export class RenderBarcodeDto {
  /** Symbology name; the service rejects anything not in the catalogue. */
  @IsOptional()
  @IsString()
  symbology?: string;

  @IsString()
  @MinLength(1, { message: 'There is nothing to encode' })
  @MaxLength(2048)
  value: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsNumber()
  @Min(1)
  @Max(10)
  scale?: number;

  /** Bar height in millimetres. Ignored by the matrix symbologies. */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsNumber()
  @Min(5)
  @Max(100)
  height?: number;

  /** Overrides whether the value is printed under the bars. */
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true' || value === true,
  )
  @IsBoolean()
  showText?: boolean;

  @IsOptional()
  @IsIn(['png', 'svg'], { message: 'Labels render as png or svg' })
  format?: 'png' | 'svg';
}
