export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  BOOKING_MAX_ATTEMPTS: number;
  BOOKING_MAX_CONCURRENT: number;
  BOOKING_MAX_PENDING: number;
  BOOKING_TIMEOUT_MS: number;
}

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const nodeEnv = input.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  const port = integerSetting(input, 'PORT', 3000, 1, 65535);

  if (typeof input.DATABASE_URL !== 'string' || input.DATABASE_URL.trim() === '') {
    throw new Error('DATABASE_URL is required.');
  }
  try {
    const url = new URL(input.DATABASE_URL);
    if (
      !['postgresql:', 'postgres:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length < 2
    ) {
      throw new Error('Invalid database URL');
    }
  } catch {
    // Never include the URL: it can contain credentials.
    throw new Error('DATABASE_URL must be a PostgreSQL URL with a host and database.');
  }

  const attempts = integerSetting(input, 'BOOKING_MAX_ATTEMPTS', 4, 1, 10);

  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL: input.DATABASE_URL,
    BOOKING_MAX_ATTEMPTS: attempts,
    // Runtime pool has ten connections; reserve at least two for other operations.
    BOOKING_MAX_CONCURRENT: integerSetting(input, 'BOOKING_MAX_CONCURRENT', 8, 1, 8),
    BOOKING_MAX_PENDING: integerSetting(input, 'BOOKING_MAX_PENDING', 128, 0, 1000),
    BOOKING_TIMEOUT_MS: integerSetting(input, 'BOOKING_TIMEOUT_MS', 5000, 100, 30000),
  };
}

function integerSetting(
  input: Record<string, unknown>,
  name: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const value = input[name] ?? defaultValue;
  const number = Number(value);
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^\d+$/.test(String(value)) ||
    !Number.isInteger(number) ||
    number < min ||
    number > max
  ) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return number;
}
