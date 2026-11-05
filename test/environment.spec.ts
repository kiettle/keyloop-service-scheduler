import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../src/config/environment';

const databaseUrl = 'postgresql://scheduler:example@localhost:55432/service_scheduler';

describe('environment validation', () => {
  it('accepts a Redis URL only with an explicit safe namespace', () => {
    expect(
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        REDIS_URL: 'redis://localhost:56379',
        CATALOG_CACHE_NAMESPACE: 'scheduler:local',
      }),
    ).toMatchObject({
      REDIS_URL: 'redis://localhost:56379',
      CATALOG_CACHE_NAMESPACE: 'scheduler:local',
    });
    expect(validateEnvironment({ DATABASE_URL: databaseUrl, REDIS_URL: '' })).not.toHaveProperty(
      'REDIS_URL',
    );
  });

  it.each([undefined, '', ' ', 'scheduler:*'])(
    'rejects an invalid namespace %p when Redis is configured',
    (CATALOG_CACHE_NAMESPACE) => {
      expect(() =>
        validateEnvironment({
          DATABASE_URL: databaseUrl,
          REDIS_URL: 'redis://localhost',
          CATALOG_CACHE_NAMESPACE,
        }),
      ).toThrow('CATALOG_CACHE_NAMESPACE');
    },
  );

  it.each(['http://user:secret@localhost', 'redis://', 'bad', true])(
    'rejects invalid Redis configuration without leaking credentials',
    (REDIS_URL) => {
      expect(() => validateEnvironment({ DATABASE_URL: databaseUrl, REDIS_URL })).toThrow(
        'REDIS_URL must be a Redis URL with a host.',
      );
    },
  );
  it('provides development defaults with an explicit database URL', () => {
    expect(validateEnvironment({ DATABASE_URL: databaseUrl })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: databaseUrl,
      BOOKING_MAX_ATTEMPTS: 4,
      BOOKING_MAX_CONCURRENT: 16,
      BOOKING_MAX_PENDING: 1024,
      BOOKING_TIMEOUT_MS: 5000,
    });
  });

  it.each([
    ['BOOKING_MAX_CONCURRENT', '0'],
    ['BOOKING_MAX_CONCURRENT', '17'],
    ['BOOKING_MAX_PENDING', '-1'],
    ['BOOKING_MAX_PENDING', '1025'],
    ['BOOKING_TIMEOUT_MS', '99'],
    ['BOOKING_TIMEOUT_MS', '30001'],
    ['BOOKING_MAX_CONCURRENT', true],
    ['BOOKING_MAX_PENDING', ''],
    ['BOOKING_TIMEOUT_MS', '500ms'],
  ])('rejects invalid capacity/budget %s=%p', (key, value) => {
    expect(() => validateEnvironment({ DATABASE_URL: databaseUrl, [key]: value })).toThrow(key);
  });

  it('allows disabling the pending queue', () => {
    expect(
      validateEnvironment({ DATABASE_URL: databaseUrl, BOOKING_MAX_PENDING: '0' })
        .BOOKING_MAX_PENDING,
    ).toBe(0);
  });

  it('parses the configured port', () => {
    expect(
      validateEnvironment({ DATABASE_URL: databaseUrl, PORT: '3100', NODE_ENV: 'test' }).PORT,
    ).toBe(3100);
  });

  it('parses a configured booking attempt limit', () => {
    expect(
      validateEnvironment({ DATABASE_URL: databaseUrl, BOOKING_MAX_ATTEMPTS: '2' })
        .BOOKING_MAX_ATTEMPTS,
    ).toBe(2);
  });

  it.each(['0', '11', '1.5', '', 'four', true])(
    'rejects invalid booking attempts %p',
    (BOOKING_MAX_ATTEMPTS) => {
      expect(() =>
        validateEnvironment({ DATABASE_URL: databaseUrl, BOOKING_MAX_ATTEMPTS }),
      ).toThrow('BOOKING_MAX_ATTEMPTS');
    },
  );

  it.each(['0', '65536', '3.5', '3000junk', '', '-1'])('rejects invalid port %p', (PORT) => {
    expect(() => validateEnvironment({ DATABASE_URL: databaseUrl, PORT })).toThrow('PORT');
  });

  it('rejects unsupported environments', () => {
    expect(() => validateEnvironment({ DATABASE_URL: databaseUrl, NODE_ENV: 'preview' })).toThrow(
      'NODE_ENV',
    );
  });

  it.each([undefined, '', 'not-a-url', 'https://localhost/db', 'postgresql://localhost/'])(
    'rejects invalid database configuration %p',
    (DATABASE_URL) => {
      expect(() => validateEnvironment({ DATABASE_URL })).toThrow('DATABASE_URL');
    },
  );

  it('does not reveal credentials in validation errors', () => {
    expect(() => validateEnvironment({ DATABASE_URL: 'https://user:secret@localhost/db' })).toThrow(
      'DATABASE_URL must be a PostgreSQL URL with a host and database.',
    );
  });
});
