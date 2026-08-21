import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ScanMeta } from '../../common/scan-meta';
import { PackageType } from '../item.enums';

export class ScanDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScanMeta)
  meta?: ScanMeta;
}

export class RegisterUnitsDto extends ScanDto {
  @IsInt()
  productId: number;

  @IsOptional()
  @IsInt()
  batchId?: number;

  @IsOptional()
  @IsInt()
  locationId?: number;

  /**
   * Physical units to register.
   *
   * The real limit is on *identities minted*, not units requested — a thousand
   * rows in one transaction is what blocks every other scan, and a batch-traced
   * lot of 10,000 units mints exactly one row. That check lives in the service,
   * where the product's traceability level is known; this bound only rejects
   * input no production run could plausibly mean (DR-01).
   */
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  count: number;

  /**
   * Units in each package, when the product is traced at PACKAGE level.
   * Ignored at the other levels, where it has no meaning.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  unitsPerPackage?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];
}

export class RegisterPackageDto extends ScanDto {
  @IsEnum(PackageType)
  packageType: PackageType;

  @IsOptional()
  @IsInt()
  productId?: number;

  @IsOptional()
  @IsInt()
  batchId?: number;

  @IsOptional()
  @IsInt()
  locationId?: number;
}

export class PackDto extends ScanDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Scan at least one item to pack' })
  @IsString({ each: true })
  childQrCodes: string[];
}

export class RemoveUnitDto extends ScanDto {
  @IsString()
  childQrCode: string;
}

/** Quarantine, release, return, damage, expiry or destruction. */
export enum LifecycleAction {
  QUARANTINE = 'QUARANTINE',
  RELEASE = 'RELEASE',
  RETURN = 'RETURN',
  DAMAGE = 'DAMAGE',
  EXPIRE = 'EXPIRE',
  DESTROY = 'DESTROY',
}

export class LifecycleDto extends ScanDto {
  @IsEnum(LifecycleAction)
  action: LifecycleAction;

  @IsOptional()
  @IsString()
  reason?: string;
}
