/**
 * Executive intelligence & analytics (technical proposal sections 10 and 21):
 * the management dashboard dimensions. Pure helpers for grouping, valuing and
 * spotting signals, so the analytics service states what it computes and the
 * tests pin the arithmetic down without a database.
 */

/** Per-day buckets: one full calendar year back from the reference day. */
export function dayBuckets(
  referenceDay: string,
  days = 365,
): { day: string; label: string }[] {
  const reference = parseDate(referenceDay);
  const buckets: { day: string; label: string }[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(reference);
    date.setDate(date.getDate() - i);
    const day = toIso(date);
    const label = date.toISOString().slice(0, 10);
    buckets.push({ day, label });
  }
  return buckets;
}

export function parseDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Spreads dated values into daily buckets, keeping only the calendar year. */
export function dailySeries(
  buckets: { day: string; label: string }[],
  rows: { date: string; amount: number }[],
): { label: string; amount: number }[] {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const key = row.date.slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + row.amount);
  }
  return buckets.map((bucket) => ({
    label: bucket.label,
    amount: byDay.get(bucket.day) ?? 0,
  }));
}

/**
 * Stock-out count: how many products an organization holds have no available
 * units at all. A product with zero available stock cannot fulfil a sale, and
 * that is a signal worth surfacing, not a page to be found by clicking.
 */
export function stockOutCount(
  positions: { productId: number; availableUnits: number }[],
): number {
  const byProduct = new Map<number, number>();
  for (const position of positions) {
    byProduct.set(
      position.productId,
      (byProduct.get(position.productId) ?? 0) + position.availableUnits,
    );
  }
  return [...byProduct.values()].filter((available) => available <= 0).length;
}

/** Rounds money to two decimals. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Capacity utilization: produced against planned, per production order.
 * Planned is the sum of plannedQuantity, so a machine that never ran shows
 * zero rather than dividing by zero.
 */
export function capacityUtilization(
  orders: { plannedQuantity: number; producedQuantity: number }[],
): number {
  const planned = orders.reduce((sum, order) => sum + order.plannedQuantity, 0);
  if (planned <= 0) return 0;
  const produced = orders.reduce((sum, order) => sum + order.producedQuantity, 0);
  return Math.min(round2((produced / planned) * 100), 100);
}