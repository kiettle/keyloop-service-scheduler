import { describe, expect, it } from 'vitest';
import { BookingConflict, DatabaseUnavailable } from '../../src/appointments/booking.error';
import { postgresState, translateDatabaseError } from '../../src/appointments/database-error';

const adapterError = (code: string, originalCode: string) => ({
  code,
  meta: { driverAdapterError: { cause: { originalCode } } },
});

describe('database error classification', () => {
  it.each(['P2039', 'P2010'])('recognizes 23P01 under verified %s adapter metadata', (code) => {
    const error = adapterError(code, '23P01');
    expect(postgresState(error)).toBe('23P01');
    expect(translateDatabaseError(error)).toEqual(new BookingConflict('resource'));
  });

  it.each([
    adapterError('P2010', '40P01'),
    adapterError('P2010', '40001'),
    adapterError('P2010', '55P03'),
    { code: 'P2034' },
  ])('handles explicit aborted-transaction conflicts separately: %j', (error) => {
    expect(translateDatabaseError(error)).toEqual(new BookingConflict('transaction'));
  });

  it.each([
    { code: 'P1001' },
    { code: 'P2024' },
    adapterError('P2039', '08006'),
    adapterError('P2010', '57014'),
    adapterError('P2010', '25P04'),
    { code: 'P2010', meta: { driverAdapterError: { cause: { kind: 'DatabaseNotReachable' } } } },
  ])('recognizes temporary connection failures: %j', (error) => {
    expect(translateDatabaseError(error)).toBeInstanceOf(DatabaseUnavailable);
  });

  it.each([
    { code: 'P2039' },
    adapterError('P2039', '23503'),
    adapterError('P2010', '23514'),
    { code: 'P2010', meta: { driverAdapterError: { cause: { kind: 'UnexpectedDriverError' } } } },
    new Error('23P01 appears only in untrusted message text'),
    null,
  ])('does not classify unrelated errors as allocation conflicts: %j', (error) => {
    expect(translateDatabaseError(error)).toBe(error);
  });
  it('classifies acquisition failure only before a transaction callback has started', () => {
    const error = { code: 'P2028' };
    expect(translateDatabaseError(error, false)).toBeInstanceOf(DatabaseUnavailable);
    expect(translateDatabaseError(error, true)).toBe(error);
  });
});
