import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Symbology } from '../../barcode/symbology';
import { TraceabilityLevel } from '../traceability-level.enum';

export class CreateProductDto {
  @IsString()
  @MinLength(1, { message: 'Product name is required' })
  name: string;

  /** Left blank, the system generates one. */
  @IsOptional()
  @IsString()
  sku?: string;

  /**
   * The canonical category this product belongs to.
   *
   * Replaces the free-text `category`. Nullable: most products have no category
   * recorded, and that is a real answer rather than a gap to fill.
   */
  @IsOptional()
  @IsInt({ message: 'Choose a category from the catalogue' })
  categoryId?: number;

  /**
   * @deprecated Free-text category, no longer accepted for new writes.
   *
   * Kept on the DTO so an older client sending it gets a clear refusal rather
   * than a silently ignored field — a category that appears to save and does
   * not is worse than one that is rejected. See DR-05.
   */
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  specification?: string;

  /** Manufacturer barcode (GTIN/EAN/UPC/ISBN) — scanned from physical product. */
  @IsOptional()
  @IsString()
  gtin?: string;

  /**
   * How finely this product is traced (DR-01). Defaults to SERIAL — one
   * identity per physical unit — which is right for anything individually
   * identifiable and wrong for anything sold by the lot.
   */
  @IsOptional()
  @IsEnum(TraceabilityLevel, {
    message: `Traceability level is one of: ${Object.values(TraceabilityLevel).join(', ')}`,
  })
  traceabilityLevel?: TraceabilityLevel;

  /**
   * The code type this product's label prints by default: ISBN for a book,
   * EAN-13 for a retail pack, Code 128 for an internal part. Omitted, the
   * product labels as a QR, which is the platform's own identity code.
   */
  @IsOptional()
  @IsEnum(Symbology, {
    message: `Unknown code type. One of: ${Object.values(Symbology).join(', ')}`,
  })
  barcodeSymbology?: Symbology;
}
