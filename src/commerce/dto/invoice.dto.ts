import {
  ArrayMinSize,
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

export class IssueInvoiceDto {
  @IsOptional()
  @IsInt()
  salesOrderId?: number;

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  issuedOn?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  dueOn?: string;

  @IsOptional()
  @IsNumberString()
  subtotal?: string;

  @IsOptional()
  @IsNumberString()
  taxPercent?: string;

  @IsOptional()
  @IsNumberString()
  totalAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class RecordPaymentDto {
  @IsInt({ message: 'Invoice is required' })
  invoiceId: number;

  @IsNumberString({}, { message: 'Amount is required' })
  amount: string;

  @IsString()
  @MinLength(1, { message: 'Payment method is required' })
  method: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  paidOn?: string;
}

/**
 * The body of `POST /api/commerce/invoices/:id/pay`. The invoice comes from
 * the URL, so it is not repeated here.
 *
 * This exists as its own class rather than `Omit<RecordPaymentDto, 'invoiceId'>`
 * because `Omit` is a type, and types are gone at runtime: Nest saw `Object`
 * for that parameter and validated nothing at all, so any shape reached the
 * service - a negative amount, or one that is not a number.
 */
export class RecordInvoicePaymentDto {
  @IsNumberString({}, { message: 'Amount is required' })
  amount: string;

  @IsString()
  @MinLength(1, { message: 'Payment method is required' })
  method: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  paidOn?: string;
}

export class RequestReturnDto {
  @IsInt({ message: 'Customer is required' })
  customerId: number;

  @IsOptional()
  @IsInt()
  invoiceId?: number;

  @IsString()
  @MinLength(1, { message: 'A return needs a reason' })
  reason: string;
}

export class ApproveReturnDto {
  @IsOptional()
  @IsNumberString()
  refundAmount?: string;

  /** QR codes of the specific items being returned. */
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one item must be returned' })
  itemQrCodes: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class RejectReturnDto {
  @IsString()
  @MinLength(1, { message: 'A rejection needs a reason' })
  reason: string;
}