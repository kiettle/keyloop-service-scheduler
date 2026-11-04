import { describe, expect, it } from 'vitest';
import { bookingFingerprint, bookingKey } from '../../src/appointments/booking-idempotency';
import {
  readBookingSnapshot,
  serializeAppointment,
} from '../../src/appointments/appointment-result';
import { bookingInput } from '../helpers/booking-app';

const key = '12345678-1234-4123-8123-123456789abc';
const input = { ...bookingInput, startAt: new Date(bookingInput.startAt) };
const body = serializeAppointment({
  ...input,
  id: key,
  technicianId: key,
  serviceBayId: key,
  endAt: new Date('2035-01-15T10:30:00Z'),
  status: 'CONFIRMED',
  createdAt: new Date('2035-01-01T00:00:00Z'),
});

describe('booking idempotency contract', () => {
  it('accepts one UUID v4, with case-insensitive header name and UUID', () => {
    expect(bookingKey(['Host', 'local', 'IDEMPOTENCY-KEY', key.toUpperCase()])).toBe(key);
  });

  it.each(
    [
      [],
      ['Idempotency-Key', ''],
      ['Idempotency-Key', 'hello'],
      ['Idempotency-Key', key.replace('-4', '-1')],
      ['Idempotency-Key', `${key}, ${key}`],
      ['Idempotency-Key', key, 'idempotency-key', key],
    ].map((headers) => ({ headers })),
  )('rejects invalid or duplicate raw headers: $headers', ({ headers }) => {
    expect(() => bookingKey(headers)).toThrow('Bad Request');
  });

  it('fingerprints semantic UUIDs and instants independently of representation/order', () => {
    // Seed IDs are numeric-only; use hexadecimal letters to exercise case normalization.
    const lowercase = {
      ...input,
      customerId: key,
      vehicleId: key,
      dealershipId: key,
      serviceTypeId: key,
    };
    expect(
      bookingFingerprint({
        startAt: new Date('2035-01-15T17:00:00+07:00'),
        serviceTypeId: lowercase.serviceTypeId.toUpperCase(),
        dealershipId: lowercase.dealershipId.toUpperCase(),
        vehicleId: lowercase.vehicleId.toUpperCase(),
        customerId: lowercase.customerId.toUpperCase(),
      }),
    ).toBe(bookingFingerprint(lowercase));
  });

  it.each(['customerId', 'vehicleId', 'dealershipId', 'serviceTypeId', 'startAt'] as const)(
    'includes %s in the fingerprint',
    (field) => {
      const changed =
        field === 'startAt'
          ? { ...input, startAt: new Date('2035-01-15T10:00:00.001Z') }
          : { ...input, [field]: key };
      expect(bookingFingerprint(changed)).not.toBe(bookingFingerprint(input));
    },
  );

  it('reads only a complete, canonical confirmed snapshot', () => {
    expect(readBookingSnapshot({ ...body }, key)).toEqual(body);
  });

  it('replays the same serialized body even when JSONB changes property order', () => {
    const reordered = Object.fromEntries(Object.entries(body).reverse());
    expect(JSON.stringify(readBookingSnapshot(reordered, key))).toBe(JSON.stringify(body));
  });

  it.each([
    null,
    [],
    {},
    { ...body, extra: 'private' },
    { ...body, id: 'bad' },
    { ...body, status: 'CANCELLED' },
    { ...body, startAt: '2035-01-15T10:00:00Z' },
    { ...body, endAt: body.startAt },
  ])('rejects malformed saved response %j', (saved) => {
    expect(() => readBookingSnapshot(saved, key)).toThrow('Invalid saved booking response');
  });
});
