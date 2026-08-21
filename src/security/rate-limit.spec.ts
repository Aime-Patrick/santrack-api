import { FixedWindowLimiter } from './rate-limit';

describe('the fixed-window rate limiter (proposal section 15)', () => {
  const windowMs = 1000;

  it('admits calls up to the limit inside one window', () => {
    const limiter = new FixedWindowLimiter(3, windowMs);
    expect(limiter.hit('verify', 0)).toBe(1);
    expect(limiter.hit('verify', 100)).toBe(2);
    expect(limiter.hit('verify', 200)).toBe(3);
  });

  it('rejects once the window is full', () => {
    const limiter = new FixedWindowLimiter(2, windowMs);
    limiter.hit('verify', 0);
    limiter.hit('verify', 100);
    expect(limiter.hit('verify', 200)).toBe(-1);
  });

  it('resets the count when the window elapses', () => {
    const limiter = new FixedWindowLimiter(2, windowMs);
    limiter.hit('verify', 0);
    limiter.hit('verify', 100);
    expect(limiter.hit('verify', windowMs + 1)).toBe(1);
  });

  it('keeps keys independent', () => {
    const limiter = new FixedWindowLimiter(1, windowMs);
    expect(limiter.hit('a', 0)).toBe(1);
    expect(limiter.hit('b', 0)).toBe(1);
    expect(limiter.hit('a', 0)).toBe(-1);
  });

  it('reports the current count in the window', () => {
    const limiter = new FixedWindowLimiter(5, windowMs);
    expect(limiter.count('verify', 0)).toBe(0);
    limiter.hit('verify', 0);
    expect(limiter.count('verify', 10)).toBe(1);
  });

  it('does not grow without bound when keys stop being used', () => {
    const limiter = new FixedWindowLimiter(1, windowMs);
    for (let i = 0; i < 1000; i += 1) {
      limiter.hit(`key-${i}`, 0);
    }
    limiter.hit('fresh', windowMs + 1);
    expect(limiter.count('key-0', windowMs + 1)).toBe(0);
  });
});