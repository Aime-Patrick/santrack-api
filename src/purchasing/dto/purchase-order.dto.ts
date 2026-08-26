import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PurchaseOrderLineDto {
  @IsInt({ message: 'Product is required' })
  productId: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsNumberString({}, { message: 'Quantity is required' })
  quantity: string;

  @IsNumberString({}, { message: 'Unit price is required' })
  unitPrice: string;
}

export class CreatePurchaseOrderDto {
  @IsInt({ message: 'Supplier is required' })
  supplierId: number;

  @IsArray()
  @ArrayNotEmpty({ message: 'A purchase order needs at least one line' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines: PurchaseOrderLineDto[];

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  expectedOn?: string;

  @IsOptional()
  @IsNumberString()
  taxPercent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ReceiveLineDto {
  @IsInt({ message: 'Line is required' })
  lineId: number;

  /**
   * Quantity to add to received_quantity this call (commercial progress only;
   * does not move stock — DR-10 D4).
   */
  @IsNumberString({}, { message: 'Received quantity is required' })
  quantity: string;
}

export class ReceivePurchaseOrderDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Receive needs at least one line receipt' })
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines: ReceiveLineDto[];
}
