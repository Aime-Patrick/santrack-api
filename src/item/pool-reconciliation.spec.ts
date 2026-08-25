import { ItemStatus } from './item.enums';
import { reconcileCounts } from './pool-reconciliation';

/**
 * The Akagera Water 500ml run, which is the case this whole lifecycle was
 * built for: ten thousand labels printed, nine thousand eight hundred and
 * fifty bottles made, a hundred broken on the line, fifty labels never used.
 */
const akagera = new Map<ItemStatus, number>([
  [ItemStatus.ACTIVE, 9_850],
  [ItemStatus.CANCELLED, 150],
]);

describe('pool reconciliation', () => {
  it('reports a finished run the way the supervisor counted it', () => {
    const counts = reconcileCounts(10_000, akagera);

    expect(counts.requested).toBe(10_000);
    expect(counts.minted).toBe(10_000);
    expect(counts.produced).toBe(9_850);
    expect(counts.cancelled).toBe(150);
    expect(counts.awaitingProduction).toBe(0);
    expect(counts.unminted).toBe(0);
  });

  /**
   * The invariant the whole screen rests on. If these ever fail to add up,
   * bottles have been lost or invented, and the number on the stock page is
   * fiction.
   */
  it('always balances: minted = produced + cancelled + awaiting', () => {
    const cases: Array<Map<ItemStatus, number>> = [
      akagera,
      new Map([[ItemStatus.GENERATED, 10_000]]),
      new Map([
        [ItemStatus.GENERATED, 4_000],
        [ItemStatus.ASSIGNED, 6_000],
      ]),
      new Map([
        [ItemStatus.ACTIVE, 500],
        [ItemStatus.SOLD, 300],
        [ItemStatus.IN_TRANSIT, 100],
        [ItemStatus.CANCELLED, 100],
      ]),
      new Map(),
    ];

    for (const byStatus of cases) {
      const c = reconcileCounts(10_000, byStatus);
      expect(c.produced + c.cancelled + c.awaitingProduction).toBe(c.minted);
    }
  });

  /**
   * The moment the demo turns on: ten thousand codes exist and not one bottle
   * does. Anything other than zero produced here means a print run is being
   * reported as stock.
   */
  it('counts a freshly minted pool as nothing produced', () => {
    const counts = reconcileCounts(
      10_000,
      new Map([[ItemStatus.GENERATED, 10_000]]),
    );

    expect(counts.minted).toBe(10_000);
    expect(counts.produced).toBe(0);
    expect(counts.awaitingProduction).toBe(10_000);
  });

  it('still counts nothing produced once codes are assigned to a run', () => {
    // Assignment plans the work. It does not make a bottle.
    const counts = reconcileCounts(
      10_000,
      new Map([[ItemStatus.ASSIGNED, 10_000]]),
    );

    expect(counts.produced).toBe(0);
    expect(counts.awaitingProduction).toBe(10_000);
  });

  it('counts goods that have moved on as produced', () => {
    // Sold and in-transit bottles were made. They are not in the warehouse,
    // but this is a yield figure, not a stock figure.
    const counts = reconcileCounts(
      1_000,
      new Map([
        [ItemStatus.ACTIVE, 400],
        [ItemStatus.SOLD, 350],
        [ItemStatus.IN_TRANSIT, 250],
      ]),
    );

    expect(counts.produced).toBe(1_000);
    expect(counts.cancelled).toBe(0);
  });

  /**
   * A destroyed bottle was really made and then disposed of; a cancelled code
   * never named a bottle at all. Folding them together would overstate waste
   * and understate yield.
   */
  it('separates a destroyed product from a code that never became one', () => {
    const counts = reconcileCounts(
      100,
      new Map([
        [ItemStatus.ACTIVE, 80],
        [ItemStatus.DESTROYED, 10],
        [ItemStatus.CANCELLED, 10],
      ]),
    );

    expect(counts.produced).toBe(90);
    expect(counts.cancelled).toBe(10);
  });

  it('shows the shortfall while a job is still minting', () => {
    const counts = reconcileCounts(
      10_000,
      new Map([[ItemStatus.GENERATED, 6_400]]),
    );

    expect(counts.minted).toBe(6_400);
    expect(counts.unminted).toBe(3_600);
  });

  /**
   * A job that died leaves a real, usable, short pool. The figure has to say
   * so rather than pretend the missing codes exist.
   */
  it('reports a failed job as a shortfall, not as cancelled', () => {
    const counts = reconcileCounts(
      10_000,
      new Map([
        [ItemStatus.ACTIVE, 6_000],
        [ItemStatus.GENERATED, 400],
      ]),
    );

    expect(counts.unminted).toBe(3_600);
    expect(counts.cancelled).toBe(0);
  });

  it('handles a pool nothing has minted into yet', () => {
    const counts = reconcileCounts(10_000, new Map());

    expect(counts.minted).toBe(0);
    expect(counts.produced).toBe(0);
    expect(counts.unminted).toBe(10_000);
  });
});
