import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Environment } from '../config/environment';

@Injectable()
export class RedisCache implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCache.name);
  private readonly client?: Redis;
  private readonly namespace: string;

  constructor(config: ConfigService<Environment, true>) {
    const url = config.get('REDIS_URL', { infer: true });
    this.namespace = config.get('CATALOG_CACHE_NAMESPACE', { infer: true }) ?? '';
    if (url) {
      this.client = new Redis(url, {
        lazyConnect: true,
        connectTimeout: 1000,
        commandTimeout: 100,
        socketTimeout: 1000,
        enableOfflineQueue: false,
        autoResendUnfulfilledCommands: false,
        maxRetriesPerRequest: 0,
      });
      // Redis errors can include connection details. Log only the operation/outcome.
      this.client.on('error', () => this.logger.warn({ event: 'reference_cache_unavailable' }));
    }
  }

  onModuleInit(): void {
    // Redis is optional: never await its connection during application startup.
    void this.client?.connect().catch(() => undefined);
  }

  onModuleDestroy(): void {
    this.client?.disconnect();
  }

  key(suffix: string): string {
    return `${this.namespace}:${suffix}`;
  }

  async get<T>(
    key: string,
    validate: (value: unknown) => value is T,
    requestId?: string,
  ): Promise<T | null> {
    if (!this.client || this.client.status !== 'ready') {
      this.logger.debug({ event: 'reference_cache_bypass', requestId });
      return null;
    }
    let raw: string | null;
    try {
      raw = await this.client.get(key);
    } catch {
      this.logger.warn({ event: 'reference_cache_read_failed', requestId });
      return null;
    }
    if (raw === null) {
      this.logger.debug({ event: 'reference_cache_miss', requestId });
      return null;
    }
    try {
      const value: unknown = JSON.parse(raw);
      if (!validate(value)) throw new Error('Invalid cache value.');
      this.logger.debug({ event: 'reference_cache_hit', requestId });
      return value;
    } catch {
      this.logger.warn({ event: 'reference_cache_invalid_value', requestId });
      return null;
    }
  }

  async set(key: string, value: unknown, requestId?: string): Promise<void> {
    if (!this.client || this.client.status !== 'ready') return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', 300);
    } catch {
      this.logger.warn({ event: 'reference_cache_write_failed', requestId });
    }
  }

  async invalidate(key: string): Promise<boolean> {
    if (!this.client || this.client.status !== 'ready') {
      this.logger.warn({ event: 'reference_cache_invalidation_failed' });
      return false;
    }
    try {
      await this.client.del(key);
      return true;
    } catch {
      this.logger.warn({ event: 'reference_cache_invalidation_failed' });
      return false;
    }
  }

  // Maintenance only: delete all cached pages within one trusted namespace/entity prefix.
  async invalidatePrefix(prefix: string): Promise<boolean> {
    if (!this.client || this.client.status !== 'ready') {
      this.logger.warn({ event: 'reference_cache_invalidation_failed' });
      return false;
    }
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
        cursor = next;
        if (keys.length) await this.client.unlink(...keys);
      } while (cursor !== '0');
      return true;
    } catch {
      this.logger.warn({ event: 'reference_cache_invalidation_failed' });
      return false;
    }
  }
}
