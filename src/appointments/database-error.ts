import { BookingConflict, DatabaseUnavailable } from './booking.error';

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function postgresState(error: unknown): string | undefined {
  const outer = record(error);
  const adapter = record(record(outer?.meta)?.driverAdapterError);
  const cause = record(adapter?.cause);
  const code = cause?.originalCode ?? cause?.code ?? outer?.code;
  return typeof code === 'string' && /^\d{2}[A-Z0-9]{3}$/.test(code) ? code : undefined;
}

export function translateDatabaseError(error: unknown): unknown {
  const state = postgresState(error);
  const prismaCode = record(error)?.code;
  if (state === '23P01') return new BookingConflict('resource');
  if (state === '40P01' || state === '40001' || prismaCode === 'P2034') {
    return new BookingConflict('transaction');
  }
  // Do not retry connection failures: a lost commit acknowledgement can be ambiguous.
  if (
    (typeof prismaCode === 'string' &&
      ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(prismaCode)) ||
    state?.startsWith('08') ||
    state === '53300' ||
    state === '57P01'
  ) {
    return new DatabaseUnavailable();
  }
  return error;
}
