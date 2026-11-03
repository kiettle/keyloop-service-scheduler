export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  BOOKING_MAX_ATTEMPTS: number;
}

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const nodeEnv = input.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  const portValue = input.PORT ?? '3000';
  if (
    (typeof portValue !== 'string' && typeof portValue !== 'number') ||
    !/^\d+$/.test(String(portValue))
  ) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

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

  const attemptsValue = input.BOOKING_MAX_ATTEMPTS ?? '4';
  const attempts = Number(attemptsValue);
  if (
    (typeof attemptsValue !== 'string' && typeof attemptsValue !== 'number') ||
    !/^\d+$/.test(String(attemptsValue)) ||
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    attempts > 10
  ) {
    throw new Error('BOOKING_MAX_ATTEMPTS must be an integer between 1 and 10.');
  }

  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL: input.DATABASE_URL,
    BOOKING_MAX_ATTEMPTS: attempts,
  };
}
