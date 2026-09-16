import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { RedisCacheService } from '../cache/redis-cache.service';
import { FixedWindowLimiter } from './rate-limit';
import { clientAddress } from './client-address';

export const RATE_LIMIT_KEY = 'santrack:rateLimit';

export interface RateLimitOptions {
  /** Policy name, used to look up an environment override. */
  policy: string;
  /** Calls allowed per window, per client address. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/**
 * Caps how often one address may call a route (technical proposal section 15).
 *
 * Applied to the endpoints that answer without a token: login, registration
 * and public verification. Authenticated routes are already attributable to an
 * account, which is a stronger control than an address.
 *
 * The numbers here are defaults. Each policy can be overridden per deployment
 * (see `rateLimits` in configuration.ts) because the right ceiling depends on
 * how the service is fronted - a shared office NAT and a mobile carrier look
 * like one very busy client from here.
 */
export const RateLimit = (policy: string, limit: number, windowMs: number) =>
  SetMetadata(RATE_LIMIT_KEY, { policy, limit, windowMs } satisfies RateLimitOptions);

/**
 * Enforces `@RateLimit`. Registered globally and inert on routes that do not
 * declare it, so adding a limit is a one-line change at the endpoint.
 *
 * Prefers Redis (shared across replicas) and falls back to in-process windows
 * when Redis is unavailable so local / degraded deploys still rate-limit.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  /** One in-memory window set per policy (fallback / single-instance). */
  private readonly memoryLimiters = new Map<string, FixedWindowLimiter>();
  private warnedFallback = false;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    @Optional() private readonly redis?: RedisCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const declared = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!declared) {
      return true;
    }

    const resolved = this.resolvePolicy(declared);
    if (resolved === null) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const address = clientAddress(request) ?? 'unknown';
    const key = `rl:${resolved.policy}:${address}`;

    const redisCount = await this.redis?.incrFixedWindow(key, resolved.windowMs);
    if (redisCount !== null && redisCount !== undefined) {
      if (redisCount > resolved.limit) {
        throw tooManyRequests();
      }
      return true;
    }

    if (!this.warnedFallback) {
      this.warnedFallback = true;
      this.logger.warn(
        'Rate limits using in-process memory (Redis unavailable). Limits will not be shared across replicas.',
      );
    }

    const limiter = this.memoryLimiterFor(resolved);
    if (limiter.hit(address) === -1) {
      throw tooManyRequests();
    }
    return true;
  }

  /** Null when the policy is disabled. */
  private resolvePolicy(
    declared: RateLimitOptions,
  ): { policy: string; limit: number; windowMs: number } | null {
    const limit =
      this.config.get<number>(`rateLimits.${declared.policy}.limit`) ??
      declared.limit;
    const windowMs =
      this.config.get<number>(`rateLimits.${declared.policy}.windowMs`) ??
      declared.windowMs;

    if (limit <= 0) {
      return null;
    }
    return { policy: declared.policy, limit, windowMs };
  }

  private memoryLimiterFor(resolved: {
    policy: string;
    limit: number;
    windowMs: number;
  }): FixedWindowLimiter {
    const existing = this.memoryLimiters.get(resolved.policy);
    if (existing) return existing;
    const limiter = new FixedWindowLimiter(resolved.limit, resolved.windowMs);
    this.memoryLimiters.set(resolved.policy, limiter);
    return limiter;
  }
}

function tooManyRequests(): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      error: 'Too Many Requests',
      message:
        'Too many attempts from this address. Wait a moment and try again.',
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
