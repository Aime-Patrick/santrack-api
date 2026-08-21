import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_KEY, RateLimitGuard, RateLimitOptions } from './rate-limit.guard';

/**
 * Builds a context that reports one route and one caller address, so the
 * guard's keying can be exercised without an HTTP server.
 */
function contextFor(
  routeName: string,
  ip: string | undefined,
  remoteAddress?: string,
): ExecutionContext {
  const handler = { name: routeName } as unknown as () => void;
  return {
    getHandler: () => handler,
    getClass: () => ({ name: 'TestController' }),
    switchToHttp: () => ({
      getRequest: () => ({ ip, socket: { remoteAddress } }),
    }),
  } as unknown as ExecutionContext;
}

function reflectorReturning(options: RateLimitOptions | undefined): Reflector {
  return {
    getAllAndOverride: (key: string) =>
      key === RATE_LIMIT_KEY ? options : undefined,
  } as unknown as Reflector;
}

/** Stands in for the environment; empty means "use the declared defaults". */
function configWith(overrides: Record<string, number> = {}): ConfigService {
  return {
    get: (path: string) => overrides[path],
  } as unknown as ConfigService;
}

function guardFor(
  options: RateLimitOptions | undefined,
  overrides: Record<string, number> = {},
): RateLimitGuard {
  return new RateLimitGuard(reflectorReturning(options), configWith(overrides));
}

const LOGIN: RateLimitOptions = { policy: 'login', limit: 3, windowMs: 60_000 };

describe('RateLimitGuard', () => {
  it('lets undecorated routes through untouched', () => {
    const guard = guardFor(undefined);
    for (let i = 0; i < 1000; i++) {
      expect(guard.canActivate(contextFor('open', '10.0.0.1'))).toBe(true);
    }
  });

  it('allows calls up to the limit and rejects the next one', () => {
    const guard = guardFor(LOGIN);
    const context = contextFor('login', '10.0.0.1');

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(/Too many attempts/i);
  });

  it('counts each address separately', () => {
    const guard = guardFor({ ...LOGIN, limit: 1 });

    expect(guard.canActivate(contextFor('login', '10.0.0.1'))).toBe(true);
    // A different caller is unaffected by the first one exhausting its window.
    expect(guard.canActivate(contextFor('login', '10.0.0.2'))).toBe(true);
    expect(() => guard.canActivate(contextFor('login', '10.0.0.1'))).toThrow();
  });

  it('falls back to the socket address when request.ip is absent', () => {
    const guard = guardFor({ ...LOGIN, limit: 1 });

    expect(guard.canActivate(contextFor('verify', undefined, '10.0.0.9'))).toBe(true);
    // Same underlying caller, so the second call is refused rather than
    // slipping through on a missing field.
    expect(() => guard.canActivate(contextFor('verify', undefined, '10.0.0.9'))).toThrow();
  });

  it('refuses rather than exempting a caller with no discoverable address', () => {
    const guard = guardFor({ ...LOGIN, limit: 1 });

    expect(guard.canActivate(contextFor('verify', undefined, undefined))).toBe(true);
    expect(() => guard.canActivate(contextFor('verify', undefined, undefined))).toThrow();
  });

  it('prefers a configured limit over the one declared at the route', () => {
    const guard = guardFor(LOGIN, { 'rateLimits.login.limit': 1 });
    const context = contextFor('login', '10.0.0.1');

    expect(guard.canActivate(context)).toBe(true);
    // Declared limit was 3; configuration tightened it to 1.
    expect(() => guard.canActivate(context)).toThrow();
  });

  it('treats a configured limit of zero as off, so tests and dev can opt out', () => {
    const guard = guardFor(LOGIN, { 'rateLimits.login.limit': 0 });
    const context = contextFor('login', '10.0.0.1');

    for (let i = 0; i < 50; i++) {
      expect(guard.canActivate(context)).toBe(true);
    }
  });
});
