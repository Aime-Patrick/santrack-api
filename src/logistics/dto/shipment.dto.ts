import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateShipmentDto {
  /**
   * The dispatched transfer this shipment carries. It must be a dispatch the
   * caller's organization sent, still awaiting receipt.
   */
  @IsInt({ message: 'A dispatched transfer is required' })
  transferId: number;

  @IsInt({ message: 'Transporter is required' })
  transporterId: number;

  @IsOptional()
  @IsInt()
  vehicleId?: number;

  @IsOptional()
  @IsInt()
  driverId?: number;

  @IsOptional()
  @IsInt()
  routeId?: number;

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  scheduledDepartureOn?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  scheduledDeliveryOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class DeliverShipmentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  recipientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CancelShipmentDto {
  @IsString()
  @MinLength(1, { message: 'A cancellation needs a reason' })
  reason: string;
}