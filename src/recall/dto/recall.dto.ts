import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ScanMeta } from '../../common/scan-meta';

export class RecallDto {
  @IsInt()
  batchId: number;

  /** Why the lot is being pulled. Shown to everyone holding affected stock. */
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScanMeta)
  meta?: ScanMeta;
}

export class LiftRecallDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export enum RecallRecoveryOutcome {
  QUARANTINED = 'QUARANTINED',
  DESTROYED = 'DESTROYED',
}

/** The scan-confirmed physical outcome of a recalled identity. */
export class RecallRecoveryDto {
  @IsString()
  qrCode: string;

  @IsEnum(RecallRecoveryOutcome)
  outcome: RecallRecoveryOutcome;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScanMeta)
  meta?: ScanMeta;
}
