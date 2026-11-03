import { describe, expect, it } from 'vitest';
import { calculateServiceInterval, intervalsOverlap } from '../../src/scheduling/interval';

const at = (time: string) => new Date(`2035-01-15T${time}:00Z`);

describe('service intervals', () => {
  it('derives duration in absolute minutes without mutating the input', () => {
    const startAt = new Date('2035-01-15T17:00:00+07:00');
    const interval = calculateServiceInterval(startAt, 90);
    expect(interval).toEqual({ startAt: at('10:00'), endAt: at('11:30') });
    expect(startAt).toEqual(at('10:00'));
    expect(interval.startAt).not.toBe(startAt);
  });

  it('carries the date across midnight and preserves milliseconds', () => {
    const startAt = new Date('2035-01-15T23:45:00.123Z');

    expect(calculateServiceInterval(startAt, 30)).toEqual({
      startAt,
      endAt: new Date('2035-01-16T00:15:00.123Z'),
    });
  });

  it('uses elapsed minutes across a daylight-saving offset change', () => {
    const startAt = new Date('2026-03-08T01:45:00-05:00');

    expect(calculateServiceInterval(startAt, 30)).toEqual({
      startAt,
      endAt: new Date('2026-03-08T03:15:00-04:00'),
    });
  });

  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid duration %s', (duration) => {
    expect(() => calculateServiceInterval(at('10:00'), duration)).toThrow(RangeError);
  });

  it('rejects invalid start times and overflowing end times', () => {
    expect(() => calculateServiceInterval(new Date(NaN), 30)).toThrow(RangeError);
    expect(() => calculateServiceInterval(new Date(8.64e15), 30)).toThrow(RangeError);
  });

  it.each([
    ['identical', '10:00', '11:00', true],
    ['partial start', '09:30', '10:30', true],
    ['partial end', '10:30', '11:30', true],
    ['contained', '10:15', '10:45', true],
    ['encompassing', '09:00', '12:00', true],
    ['adjacent before', '09:00', '10:00', false],
    ['adjacent after', '11:00', '12:00', false],
    ['separate before', '08:00', '09:00', false],
    ['separate after', '12:00', '13:00', false],
  ] as const)('%s follows half-open semantics symmetrically', (_name, start, end, expected) => {
    const existing = { startAt: at('10:00'), endAt: at('11:00') };
    const requested = { startAt: at(start), endAt: at(end) };
    expect(intervalsOverlap(existing, requested)).toBe(expected);
    expect(intervalsOverlap(requested, existing)).toBe(expected);
  });
});
