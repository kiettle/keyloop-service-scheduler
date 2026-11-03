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

  it.each([adapterError('P2010', '40P01'), adapterError('P2010', '40001'), { code: 'P2034' }])(
    'handles explicit aborted-transaction conflicts separately: %j',
    (error) => {
      expect(translateDatabaseError(error)).toEqual(new BookingConflict('transaction'));
    },
  );

  it.each([{ code: 'P1001' }, { code: 'P2024' }, adapterError('P2039', '08006')])(
    'recognizes temporary connection failures: %j',
    (error) => {
      expect(translateDatabaseError(error)).toBeInstanceOf(DatabaseUnavailable);
    },
  );

  it.each([
    { code: 'P2039' },
    adapterError('P2039', '23503'),
    adapterError('P2010', '23514'),
    new Error('23P01 appears only in untrusted message text'),
    null,
  ])('does not classify unrelated errors as allocation conflicts: %j', (error) => {
    expect(translateDatabaseError(error)).toBe(error);
  });
});
