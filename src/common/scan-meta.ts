import { IsISO8601, IsOptional, IsString } from 'class-validator';

/**
 * Metadata every field operation carries so that an offline client can replay
 * its queue safely. The clientEventId is generated on the device and is unique
 * per logical operation, which makes synchronisation idempotent - reconnecting
 * twice must never record the same scan twice (business rule 12).
 */
export class ScanMeta {
  @IsOptional()
  @IsString()
  clientEventId?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  /** When it happened in the field. May predate recording when offline. */
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}

export function hasClientEventId(meta?: ScanMeta | null): boolean {
  return !!meta?.clientEventId && meta.clientEventId.trim().length > 0;
}

export function occurredAtOf(meta?: ScanMeta | null): Date {
  return meta?.occurredAt ? new Date(meta.occurredAt) : new Date();
}
