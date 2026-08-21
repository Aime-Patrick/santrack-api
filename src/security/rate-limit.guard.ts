import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { FixedWindowLimiter } from './rate-limit';

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
 * State lives in this process. Behind more than one instance each replica
 * enforces its own share of the limit, which is the point at which this should
 * move to Redis - noted here rather than in a backlog because the failure is
 * silent: the limit simply multiplies by the number of replicas.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  /** One window set per policy, since policies carry different limits. */
  private readonly limiters = new Map<string, FixedWindowLimiter>();

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const declared = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!declared) {
      return true;
    }

    const limiter = this.limiterFor(declared);
    // A limit configured as zero switches the policy off outright, which is
    // what the walkthrough and local development need.
    if (limiter === null) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    if (limiter.hit(clientAddress(request)) === -1) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message:
            'Too many attempts from this address. Wait a moment and try again.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /** Null when the policy is disabled. Limiters are built once and reused. */
  private limiterFor(declared: RateLimitOptions): FixedWindowLimiter | null {
    const existing = this.limiters.get(declared.policy);
    if (existing) {
      return existing;
    }

    const limit =
      this.config.get<number>(`rateLimits.${declared.policy}.limit`) ??
      declared.limit;
    const windowMs =
      this.config.get<number>(`rateLimits.${declared.policy}.windowMs`) ??
      declared.windowMs;

    if (limit <= 0) {
      return null;
    }

    const limiter = new FixedWindowLimiter(limit, windowMs);
    this.limiters.set(declared.policy, limiter);
    return limiter;
  }
}

/**
 * The address to count against. `request.ip` is correct only when Express is
 * told how many proxies sit in front of it (see TRUST_PROXY_HOPS in main.ts);
 * without that it reports the proxy on every call and the limit becomes
 * global. The fallback keeps the guard working rather than letting an
 * unknown address bypass it entirely.
 *
 * Addresses are a blunt instrument for a consumer-facing endpoint: behind
 * carrier-grade NAT thousands of shoppers share one, which is why the public
 * verification ceiling is set high rather than tight. Anything stricter than
 * this needs a signal better than an IP.
 */
function clientAddress(request: {
  ip?: string;
  socket?: { remoteAddress?: string };
}): string {
  return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
}
