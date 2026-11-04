import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { catalogCacheKey } from '../../src/catalog/service-catalog-cache';

export async function createTestRedis() {
  const input = process.env.TEST_REDIS_URL;
  if (!input)
    throw new Error('Set TEST_REDIS_URL for the dedicated Redis test service (port 56380).');
  const url = new URL(input);
  if (
    url.protocol !== 'redis:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.port !== '56380' ||
    !['', '/', '/0'].includes(url.pathname)
  ) {
    throw new Error(
      'TEST_REDIS_URL must use the dedicated loopback Redis service on port 56380, database 0.',
    );
  }
  const namespace = `scheduler:test:${randomUUID()}`;
  const key = catalogCacheKey(namespace);
  const client = new Redis(input, {
    lazyConnect: true,
    connectTimeout: 1000,
    commandTimeout: 1000,
    retryStrategy: null,
    enableOfflineQueue: false,
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
  } catch (error) {
    client.disconnect();
    throw error;
  }
  async function clear() {
    let cursor = '0';
    do {
      const [next, keys] = await client.scan(cursor, 'MATCH', `${namespace}:*`, 'COUNT', 100);
      cursor = next;
      if (keys.length) await client.unlink(...keys);
    } while (cursor !== '0');
  }
  return {
    namespace,
    clear,
    client,
    key,
    config: { REDIS_URL: input, CATALOG_CACHE_NAMESPACE: namespace },
    async close() {
      try {
        await clear();
      } finally {
        client.disconnect();
      }
    },
  };
}
