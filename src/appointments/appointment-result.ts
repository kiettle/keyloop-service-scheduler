import { AppointmentStatus, Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';

export interface AppointmentResult {
  id: string;
  customerId: string;
  vehicleId: string;
  dealershipId: string;
  serviceTypeId: string;
  technicianId: string;
  serviceBayId: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  createdAt: string;
}

type AppointmentRow = Omit<AppointmentResult, 'startAt' | 'endAt' | 'createdAt'> & {
  startAt: Date;
  endAt: Date;
  createdAt: Date;
};

export function serializeAppointment(row: AppointmentRow): AppointmentResult {
  return {
    id: row.id,
    customerId: row.customerId,
    vehicleId: row.vehicleId,
    dealershipId: row.dealershipId,
    serviceTypeId: row.serviceTypeId,
    technicianId: row.technicianId,
    serviceBayId: row.serviceBayId,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export function readBookingSnapshot(
  body: Prisma.JsonValue,
  appointmentId: string,
): AppointmentResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Invalid saved booking response.');
  }
  const ids = [
    'id',
    'customerId',
    'vehicleId',
    'dealershipId',
    'serviceTypeId',
    'technicianId',
    'serviceBayId',
  ] as const;
  const dates = ['startAt', 'endAt', 'createdAt'] as const;
  const validDates = dates.every((field) => {
    const value = body[field];
    return (
      typeof value === 'string' &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value
    );
  });
  if (
    Object.keys(body).length !== 11 ||
    !ids.every((field) => typeof body[field] === 'string' && isUUID(body[field])) ||
    !validDates ||
    body.id !== appointmentId ||
    body.status !== 'CONFIRMED' ||
    Date.parse(body.startAt as string) >= Date.parse(body.endAt as string)
  ) {
    throw new Error('Invalid saved booking response.');
  }
  const snapshot = body as unknown as AppointmentResult;
  // JSONB may reorder keys. Reuse the public serializer for identical response bytes.
  return serializeAppointment({
    ...snapshot,
    startAt: new Date(snapshot.startAt),
    endAt: new Date(snapshot.endAt),
    createdAt: new Date(snapshot.createdAt),
  });
}
