import { formatDate, addDays } from './services/expiry.service';

/**
 * Shelf dates are calendar dates: no time, no zone. The conversions below are
 * where that is easiest to lose, and losing it means telling a warehouse the
 * wrong day.
 */
describe('shelf date handling', () => {
  it('passes a date string through unchanged', () => {
    expect(formatDate('2026-08-30')).toBe('2026-08-30');
  });

  it('trims a timestamp string to its calendar date', () => {
    expect(formatDate('2026-08-30T00:00:00.000Z')).toBe('2026-08-30');
  });

  it('reads a Date as the local day it was built for, not its UTC instant', () => {
    // Postgres returns MIN(date) as a Date at local midnight. Converting via
    // toISOString() first would report the previous day anywhere east of
    // Greenwich - a batch expiring on the 30th was reaching the warehouse as
    // the 29th.
    const localMidnight = new Date(2026, 7, 30, 0, 0, 0);
    expect(formatDate(localMidnight)).toBe('2026-08-30');
  });

  it('is stable late in the day, when a UTC shift would cross midnight', () => {
    const lateEvening = new Date(2026, 7, 30, 23, 30, 0);
    expect(formatDate(lateEvening)).toBe('2026-08-30');
  });

  it('rolls the month when adding days', () => {
    expect(addDays('2026-08-20', 30)).toBe('2026-09-19');
  });

  it('rolls the year', () => {
    expect(addDays('2026-12-20', 30)).toBe('2027-01-19');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});
