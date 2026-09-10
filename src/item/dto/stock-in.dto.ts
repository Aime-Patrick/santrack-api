import { IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ScanMeta } from '../../common/scan-meta';

/**
 * Everything a RETAILER or SHOP sends to confirm receipt of a container.
 *
 * The operator scans the container's QR code and presses Confirm Stock In.
 * Nothing else is required: the system works out what is inside, what states
 * to transition, and what to register in the receiving organisation's inventory.
 */
export class StockInDto {
  /** The QR payload (or printed code) of the arriving pallet/carton. */
  @IsString()
  containerQrCode: string;

  /** Optional destination location within the receiving organisation. */
  @IsOptional()
  @IsInt()
  locationId?: number;

  /** Offline-safe idempotency envelope — same contract as every other scan. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ScanMeta)
  meta?: ScanMeta;

  @IsOptional()
  @IsString()
  notes?: string;
}
