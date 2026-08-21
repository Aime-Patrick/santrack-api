import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
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
