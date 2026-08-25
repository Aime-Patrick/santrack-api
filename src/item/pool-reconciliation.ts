import { ItemStatus, isPreProduction } from './item.enums';

/**
 * What became of a pool's codes.
 *
 * Every number here is counted from the identities rather than stored, so none
 * of them can disagree with the rows they describe - the same reason Product
 * carries no quantity column.
 */
export interface PoolCounts {
  /** How many codes were asked for. */
  requested: number;
  /** How many identities exist. Equals `requested` once minting finishes. */
  minted: number;
  /** Became real products. */
  produced: number;
  /** Will never be products, each with a reason recorded against it. */
  cancelled: number;
  /** Printed, not yet produced, not cancelled. */
  awaitingProduction: number;
  /**
   * Requested but never minted - a job that failed or is still running.
   * Zero on a finished pool.
   */
  unminted: number;
}

/**
 * The reconciliation arithmetic, kept apart from the query that feeds it so it
 * can be tested without a database.
 *
 * The invariant this exists to hold is
 *
 *     minted = produced + cancelled + awaitingProduction
 *
 * for every pool, always. It holds by construction here - `produced` is what is
 * left after the other two are taken out - which is deliberate: computing all
 * three independently would let them disagree, and a yield report that does not
 * add up is worse than no yield report, because somebody will act on it.
 *
 * The consequence is that a status nobody has classified counts as produced.
 * That is the safe direction to be wrong in: an unclassified status showing up
 * as a bottle somebody has to go and find is a question that gets asked, where
 * a bottle silently dropped from the count is not.
 */
export function reconcileCounts(
  requested: number,
  byStatus: ReadonlyMap<ItemStatus, number>,
): PoolCounts {
  let minted = 0;
  let awaitingProduction = 0;
  let cancelled = 0;

  for (const [status, count] of byStatus) {
    minted += count;
    if (isPreProduction(status)) {
      awaitingProduction += count;
    } else if (status === ItemStatus.CANCELLED) {
      cancelled += count;
    }
  }

  return {
    requested,
    minted,
    produced: minted - awaitingProduction - cancelled,
    cancelled,
    awaitingProduction,
    unminted: requested - minted,
  };
}
