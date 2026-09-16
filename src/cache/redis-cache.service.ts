import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Thin Redis wrapper for response caching.
 *
 * BullMQ already uses the same Redis instance for queues; this service is for
 * short-lived read caches (search, etc.). If Redis is unreachable, callers
 * get a miss and fall through to the database — never block the request.
 */
@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: Redis | null = null;
  private ready = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('redis.url');
    const host = this.config.get<string>('redis.host') ?? 'localhost';
    const port = this.config.get<number>('redis.port') ?? 6379;

    this.client = url
      ? new Redis(url, {
          maxRetriesPerRequest: 1,
          lazyConnect: true,
          enableOfflineQueue: false,
        })
      : new Redis({
          host,
          port,
          maxRetriesPerRequest: 1,
          lazyConnect: true,
          enableOfflineQueue: false,
        });

    this.client.on('ready', () => {
      this.ready = true;
      this.logger.log(
        url ? 'Redis cache connected (REDIS_URL)' : `Redis cache connected (${host}:${port})`,
      );
    });
    this.client.on('error', (err) => {
      this.ready = false;
      this.logger.warn(`Redis cache error: ${err.message}`);
    });
    this.client.on('end', () => {
      this.ready = false;
    });

    void this.client.connect().catch((err: Error) => {
      this.logger.warn(`Redis cache unavailable: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit().catch(() => undefined);
      this.client = null;
      this.ready = false;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.ready || !this.client) return null;
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.ready || !this.client) return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      // Cache write failures must not affect the response.
    }
  }

  /**
   * Atomic fixed-window counter for rate limits. Returns the new count, or
   * `null` when Redis is down so callers can fall back to in-process state.
   */
  async incrFixedWindow(key: string, windowMs: number): Promise<number | null> {
    if (!this.ready || !this.client) return null;
    try {
      const result = await this.client.eval(
        `
        local current = redis.call('INCR', KEYS[1])
        if current == 1 then
          redis.call('PEXPIRE', KEYS[1], ARGV[1])
        end
        return current
        `,
        1,
        key,
        String(windowMs),
      );
      return typeof result === 'number' ? result : Number(result);
    } catch {
      return null;
    }
  }

  /** True when Redis answered a ping / is ready for writes. */
  isReady(): boolean {
    return this.ready;
  }
}
