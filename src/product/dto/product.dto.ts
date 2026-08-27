import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
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
   * Required on create — every product is filed under a catalogue category.
   * Optional on update so a rename that omits it leaves the filing alone.
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

  /**
   * The mark this is sold under, from the organization's own brands.
   *
   * Supersedes the free-text `brand` for the same reason `categoryId`
   * superseded `category`: "Mützig" typed twice is two brands, and a dropdown
   * of marks the business already registered is one fewer thing for whoever
   * fills in this form to get wrong.
   */
  @IsOptional()
  @IsInt({ message: 'Choose a brand from your own list' })
  brandId?: number;

  /**
   * @deprecated Free-text brand. Kept so an older client sending it gets a
   * clear refusal rather than a silently ignored field.
   */
  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  model?: string;

  /**
   * What one unit of stock is called — BOTTLE, KG, LITRE (DR-09).
   *
   * Display and order entry only. Nothing that counts or reserves stock reads
   * it. Left blank, quantities show as bare numbers, which is what every
   * existing product does today.
   */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  baseUnit?: string;

  /**
   * The one pack this is also sold in — CARTON, BAG, CRATE, PALLET.
   *
   * Send with `unitsPerPack` or not at all. One pack, one conversion: a second
   * sellable tier is a decision, not a field.
   */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  packUnit?: string;

  /** How many base units one pack nominally holds. At least 2. */
  @IsOptional()
  @IsInt({ message: 'Units per pack is a whole number' })
  @Min(2, { message: 'A pack holds at least 2 units — a pack of one is just the unit' })
  unitsPerPack?: number;

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
