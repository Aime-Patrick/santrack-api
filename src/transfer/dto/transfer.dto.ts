import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ScanMeta } from '../../common/scan-meta';

export class DispatchDto {
  @IsInt({ message: 'Destination organization is required' })
  destinationOrganizationId: number;

  /** Optional - the destination may pick its own location on receipt. */
  @IsOptional()
  @IsInt()
  destinationLocationId?: number;

  @IsOptional()
  @IsInt()
  sourceLocationId?: number;

  @IsArray()
  @ArrayNotEmpty({ message: 'Scan at least one item to dispatch' })
  @IsString({ each: true })
  itemQrCodes: string[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScanMeta)
  meta?: ScanMeta;
}

export class ReceiveDto {
  @IsOptional()
  @IsInt()
  destinationLocationId?: number;

  /**
   * What the receiver actually scanned. Leave empty to accept the whole
   * dispatch; send a partial list to flag what did not arrive.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scannedQrCodes?: string[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScanMeta)
  meta?: ScanMeta;
}

export class RelocateDto {
  @IsInt()
  destinationLocationId: number;

  @IsArray()
  @ArrayNotEmpty({ message: 'Scan at least one item to relocate' })
  @IsString({ each: true })
  itemQrCodes: string[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScanMeta)
  meta?: ScanMeta;
}
