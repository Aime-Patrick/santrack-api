import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SyncOperationType } from '../sync.enums';

/**
 * One operation a device performed while offline.
 *
 * `clientEventId` is mandatory here even though it is optional on the online
 * routes: it is the whole basis of safe replay (business rule 12). An
 * operation without one cannot be recognised on a second attempt, so a queue
 * carrying one is a queue that will eventually duplicate.
 */
export class SyncOperationDto {
  @IsString()
  @MinLength(1, { message: 'Every queued operation needs a clientEventId' })
  clientEventId: string;

  @IsEnum(SyncOperationType, { message: 'Unknown operation type' })
  type: SyncOperationType;

  /** When it happened in the field, which is not when it is being uploaded. */
  @IsOptional()
  @IsISO8601({}, { message: 'occurredAt must be an ISO 8601 timestamp' })
  occurredAt?: string;

  /** The target QR code, for operations that act on an existing identity. */
  @IsOptional()
  @IsString()
  qrCode?: string;

  /** The transfer being received, for RECEIVE. */
  @IsOptional()
  transferId?: number;

  /**
   * The same body the online route takes. Validated against that route's own
   * DTO when the operation runs, so there is one definition of what each
   * operation accepts rather than a parallel set that can drift.
   */
  @IsObject()
  payload: Record<string, unknown>;
}

export class SyncRequestDto {
  /** Which device is replaying, recorded on every event it produces. */
  @IsString()
  @MinLength(1, { message: 'deviceId identifies the replaying device' })
  deviceId: string;

  /**
   * Operations in the order they happened on the device. Order is significant:
   * packing precedes dispatch, dispatch precedes receipt. The server applies
   * them in the order given rather than reordering them.
   *
   * Capped so one upload cannot occupy a connection indefinitely. A device
   * with more than this uploads in several batches, which is safe precisely
   * because each operation is individually idempotent.
   */
  @IsArray()
  @ArrayNotEmpty({ message: 'Send at least one operation' })
  @ArrayMaxSize(500, { message: 'Upload at most 500 operations per batch' })
  @ValidateNested({ each: true })
  @Type(() => SyncOperationDto)
  operations: SyncOperationDto[];
}

/** What the server decided about one queued operation. */
export interface SyncOperationResult {
  clientEventId: string;
  type: SyncOperationType;
  status: string;
  /** Why it failed, or which event already covered it. */
  detail: string | null;
  /** The event this operation had already produced, when duplicate. */
  originalEventId?: number;
}
