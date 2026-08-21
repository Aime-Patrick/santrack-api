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
  MinLength,
  ValidateNested,
} from 'class-validator';

export class QuotationLineDto {
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

export class CreateQuotationDto {
  @IsInt({ message: 'Customer is required' })
  customerId: number;

  @IsArray()
  @ArrayNotEmpty({ message: 'A quotation needs at least one line' })
  @ValidateNested({ each: true })
  @Type(() => QuotationLineDto)
  lines: QuotationLineDto[];

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  validUntilOn?: string;

  @IsOptional()
  @IsNumberString()
  taxPercent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateSalesOrderDto {
  @IsInt({ message: 'Customer is required' })
  customerId: number;

  @IsOptional()
  @IsInt()
  quotationId?: number;

  @IsArray()
  @ArrayNotEmpty({ message: 'An order needs at least one line' })
  @ValidateNested({ each: true })
  @Type(() => QuotationLineDto)
  lines: QuotationLineDto[];

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  requestedDeliveryOn?: string;

  @IsOptional()
  @IsNumberString()
  taxPercent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class AcceptQuotationDto {
  @IsInt({ message: 'Customer is required' })
  customerId: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class RejectQuotationDto {
  @IsString()
  @MinLength(1, { message: 'A rejection needs a reason' })
  reason: string;
}