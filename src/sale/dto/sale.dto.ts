import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ScanMeta } from '../../common/scan-meta';
import { SaleType } from '../entities/sale.entity';

/**
 * A business sale needs buyerOrganizationId; a consumer sale needs
 * consumerRef - a phone number, receipt number or opaque token, not a full
 * customer account (proposal section 8).
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

  @IsArray()
  @ArrayNotEmpty({ message: 'Scan at least one item to sell' })
  @IsString({ each: true })
  itemQrCodes: string[];

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
