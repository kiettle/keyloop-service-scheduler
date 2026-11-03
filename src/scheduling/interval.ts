export interface TimeInterval {
  readonly startAt: Date;
  readonly endAt: Date;
}

export function calculateServiceInterval(startAt: Date, durationMinutes: number): TimeInterval {
  if (!Number.isFinite(startAt.getTime())) {
    throw new RangeError('Service start time must be a valid instant.');
  }
  if (!Number.isSafeInteger(durationMinutes) || durationMinutes <= 0) {
    throw new RangeError('Service duration must be a positive integer in minutes.');
  }
  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  if (!Number.isFinite(endAt.getTime())) {
    throw new RangeError('Calculated service end time is out of range.');
  }
  return { startAt: new Date(startAt.getTime()), endAt };
}

// Inputs are valid half-open intervals, as produced by calculateServiceInterval.
export function intervalsOverlap(existing: TimeInterval, requested: TimeInterval): boolean {
  return existing.startAt < requested.endAt && existing.endAt > requested.startAt;
}
