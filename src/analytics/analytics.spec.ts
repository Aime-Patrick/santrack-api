import {
  capacityUtilization,
  dailySeries,
  dayBuckets,
  round2,
  stockOutCount,
} from './analytics';

describe('executive analytics helpers (proposal sections 10 and 21)', () => {
  it('buckets a full year ending on the reference day', () => {
    const buckets = dayBuckets('2026-12-31', 5);
    expect(buckets).toHaveLength(5);
    expect(buckets[0].label).toBe('2026-12-27');
    expect(buckets[4].label).toBe('2026-12-31');
  });

  it('spreads dated values into daily buckets', () => {
    const buckets = dayBuckets('2026-01-03', 3);
    const series = dailySeries(buckets, [
      { date: '2026-01-01', amount: 100 },
      { date: '2026-01-01', amount: 50 },
      { date: '2026-01-03', amount: 25 },
    ]);
    expect(series).toEqual([
      { label: '2026-01-01', amount: 150 },
      { label: '2026-01-02', amount: 0 },
      { label: '2026-01-03', amount: 25 },
    ]);
  });

  it('counts products with no available units as stock-outs', () => {
    expect(
      stockOutCount([
        { productId: 1, availableUnits: 5 },
        { productId: 2, availableUnits: 0 },
        { productId: 3, availableUnits: 0 },
      ]),
    ).toBe(2);
  });

  it('sums units across positions of the same product', () => {
    expect(
      stockOutCount([
        { productId: 1, availableUnits: 0 },
        { productId: 1, availableUnits: 3 },
      ]),
    ).toBe(0);
  });

  it('rounds money to two decimals', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(83.325)).toBe(83.33);
  });

  it('measures capacity utilization and never divides by zero', () => {
    expect(
      capacityUtilization([
        { plannedQuantity: 100, producedQuantity: 75 },
        { plannedQuantity: 300, producedQuantity: 300 },
      ]),
    ).toBe(93.75);
    expect(capacityUtilization([{ plannedQuantity: 0, producedQuantity: 0 }])).toBe(0);
    expect(
      capacityUtilization([
        { plannedQuantity: 10, producedQuantity: 999 },
      ]),
    ).toBe(100);
  });
});