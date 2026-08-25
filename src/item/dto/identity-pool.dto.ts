import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { CancellationReason } from '../item.enums';

/**
 * A request for codes: "prepare ten thousand for Akagera Water 500ml".
 *
 * There is no batch, no location and no holder here, and that absence is the
 * point. Minting a code says nothing about where a product is or who has it,
 * because no product exists yet.
 */
export class RequestIdentitiesDto {
  @IsInt()
  productId: number;

  /**
   * How many codes to prepare.
   *
   * Unbounded here beyond being positive; the service applies the real ceiling,
   * where it can say why. A pool is a sequence of committed chunks rather than
   * one transaction, so a large run is slow, not refused.
   */
  @IsInt()
  @Min(1)
  count: number;
}

/**
 * Claiming codes from a pool for a run: "this order will use six thousand of
 * these".
 *
 * Assignment is a plan, not a product. It says which codes the line is about
 * to print and stick on things, so that two runs drawing on the same pool
 * cannot claim the same code. Nothing becomes stock here.
 */
export class AssignIdentitiesDto {
  @IsInt()
  poolId: number;

  @IsInt()
  productionOrderId: number;

  /**
   * How many codes this run claims. Omit to claim everything still unassigned
   * in the pool, which is the common case: one pool, one run.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  count?: number;
}

/**
 * The moment codes become products.
 *
 * The count is optional on purpose. A run that cancelled every code that
 * failed - which is what the operator scanning breakages has been doing all
 * shift - already knows how many are left, and a number derived from what
 * actually happened cannot be mistyped. Supplying one is for the case where
 * some labels were never accounted for; the surplus is reported back rather
 * than quietly confirmed or quietly dropped.
 */
export class ConfirmProducedDto {
  @IsInt()
  productionOrderId: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  count?: number;

  @IsOptional()
  @IsInt()
  locationId?: number;
}

/**
 * Ending a code that will never name a product.
 *
 * The reason is required, and the database enforces it too. A cancelled code
 * is answerable forever - somebody scanning it in a shop in three years gets
 * this reason back - and "cancelled, reason unknown" is not something anyone
 * can act on.
 */
export class CancelIdentityDto {
  @IsEnum(CancellationReason)
  reason: CancellationReason;

  @IsOptional()
  @IsString()
  notes?: string;
}

/** Cancelling a run of codes at once, by printed code or QR payload. */
export class CancelIdentitiesDto extends CancelIdentityDto {
  @IsString({ each: true })
  codes: string[];
}
