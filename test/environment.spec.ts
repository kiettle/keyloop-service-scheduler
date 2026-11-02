import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../src/config/environment';

const databaseUrl = 'postgresql://scheduler:example@localhost:55432/service_scheduler';

describe('environment validation', () => {
  it('provides development defaults with an explicit database URL', () => {
    expect(validateEnvironment({ DATABASE_URL: databaseUrl })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: databaseUrl,
    });
  });

  it('parses the configured port', () => {
    expect(
      validateEnvironment({ DATABASE_URL: databaseUrl, PORT: '3100', NODE_ENV: 'test' }).PORT,
    ).toBe(3100);
  });

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
