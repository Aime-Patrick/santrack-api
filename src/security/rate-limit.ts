/**
 * A dependency-free fixed-window rate limiter for the public endpoints
 * (technical proposal section 15: rate limiting). The public verification
 * endpoint answers anyone without a token, so it needs protection against
 * being driven from a single address; authenticated routes already carry a
 * per-user rate limit from the token bucket below.
 *
 * The implementation keeps one window per key in memory. Old windows are
 * dropped when they fall out of the map, so the map cannot grow without bound.
 */

export interface RateWindow {
  resetAt: number;
  count: number;
}

export class FixedWindowLimiter {
  private windows = new Map<string, RateWindow>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Returns the count of accepted calls for `key` after this call, or -1 when
   * the call must be rejected because the window is full. The clock is
   * injected so tests can advance it without sleeping.
   */
  hit(key: string, now = Date.now()): number {
    const current = this.windows.get(key);
    if (!current || now >= current.resetAt) {
      this.windows.set(key, { resetAt: now + this.windowMs, count: 1 });
      this.trim(now);
      return 1;
    }
    if (current.count >= this.limit) {
      return -1;
    }
    current.count += 1;
    return current.count;
  }

  /** The count so far in the current window for a key (0 when none). */
  count(key: string, now = Date.now()): number {
    const current = this.windows.get(key);
    if (!current) return 0;
    if (now >= current.resetAt) {
      this.windows.delete(key);
      return 0;
    }
    return current.count;
  }

  reset(): void {
    this.windows.clear();
  }

  /** Drops every key whose window already reset, bounding the map's size. */
  private trim(now: number): void {
    for (const [key, window] of this.windows) {
      if (now >= window.resetAt) {
        this.windows.delete(key);
      }
    }
  }
}