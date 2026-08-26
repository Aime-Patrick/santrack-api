import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ScanMeta } from '../../common/scan-meta';
import { SaleType } from '../entities/sale.entity';

/**
 * Sell by commercial quantity (DR-09). The server FEFO-picks whole identities
 * that cover the requested product units — never splits an identity.
 */
export class SellQuantityLineDto {
  @IsInt({ message: 'Product is required' })
  productId: number;

  @IsNumberString({}, { message: 'Quantity is required' })
  requestedQuantity: string;

  /**
   * Piece / carton / box — must be a sellable unit on the product when declared.
   * Omit only for legacy catalogue rows with no base/pack unit.
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  salesUnit?: string;
}

/**
 * A business sale needs buyerOrganizationId; a consumer sale needs
 * consumerRef - a phone number, receipt number or opaque token, not a full
 * customer account (proposal section 8).
 *
 * Provide either scanned `itemQrCodes` or `quantityLines` (or both). Quantity
 * lines are resolved to identities server-side before the sale commits.
 */
export class SellDto {
  @IsEnum(SaleType, { message: 'Sale type is required' })
  type: SaleType;

  @IsOptional()
  @IsInt()
  buyerOrganizationId?: number;

  @IsOptional()
  @IsString()
  consumerRef?: string;

  @IsOptional()
  @IsInt()
  sellerLocationId?: number;

  /** Where the buyer wants the goods delivered, for business sales. */
  @IsOptional()
  @IsInt()
  deliveryLocationId?: number;

  @ValidateIf((o: SellDto) => !o.quantityLines?.length)
  @IsArray()
  @ArrayNotEmpty({ message: 'Scan at least one item, or add a quantity line' })
  @IsString({ each: true })
  itemQrCodes?: string[];

  @ValidateIf((o: SellDto) => !o.itemQrCodes?.length)
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one quantity line, or scan items' })
  @ValidateNested({ each: true })
  @Type(() => SellQuantityLineDto)
  quantityLines?: SellQuantityLineDto[];

  /** Held as a string so decimal money never passes through a float. */
  @IsOptional()
  @IsNumberString()
  totalAmount?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScanMeta)
  meta?: ScanMeta;
}
