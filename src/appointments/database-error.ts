import { BookingConflict, DatabaseUnavailable } from './booking.error';

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function adapterCause(error: unknown): Record<string, unknown> | undefined {
  const outer = record(error);
  const adapter = record(record(outer?.meta)?.driverAdapterError);
  return record(adapter?.cause);
}

export function postgresState(error: unknown): string | undefined {
  const cause = adapterCause(error);
  const code = cause?.originalCode ?? cause?.code ?? record(error)?.code;
  return typeof code === 'string' && /^\d{2}[A-Z0-9]{3}$/.test(code) ? code : undefined;
}

export function translateDatabaseError(error: unknown, transactionStarted = true): unknown {
  const state = postgresState(error);
  const prismaCode = record(error)?.code;
  // P2028 before the callback starts is transaction acquisition failure, not a code-path error.
  if (prismaCode === 'P2028' && !transactionStarted) return new DatabaseUnavailable();
  if (state === '23P01') return new BookingConflict('resource');
  if (state === '40P01' || state === '40001' || state === '55P03' || prismaCode === 'P2034') {
    return new BookingConflict('transaction');
  }
  // Do not retry connection failures: a lost commit acknowledgement can be ambiguous.
  if (
    // Prisma raw queries expose connection refusal as a kind, without a SQLSTATE.
    adapterCause(error)?.kind === 'DatabaseNotReachable' ||
    (typeof prismaCode === 'string' &&
      ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(prismaCode)) ||
    state?.startsWith('08') ||
    state === '53300' ||
    state === '57014' ||
    state === '25P04' ||
    state === '57P01'
  ) {
    return new DatabaseUnavailable();
  }
  return error;
}
