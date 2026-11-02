import { PrismaClient } from '@prisma/client';

// Stable IDs make the demo discoverable and integration fixtures reproducible.
export const fixtureIds = {
  dealershipA: '10000000-0000-4000-8000-000000000001',
  dealershipB: '10000000-0000-4000-8000-000000000002',
  customer1: '20000000-0000-4000-8000-000000000001',
  customer2: '20000000-0000-4000-8000-000000000002',
  customer3: '20000000-0000-4000-8000-000000000003',
  vehicle1: '30000000-0000-4000-8000-000000000001',
  vehicle2: '30000000-0000-4000-8000-000000000002',
  vehicle3: '30000000-0000-4000-8000-000000000003',
  vehicle4: '30000000-0000-4000-8000-000000000004',
  oilChange: '40000000-0000-4000-8000-000000000001',
  tireReplacement: '40000000-0000-4000-8000-000000000002',
  inspection: '40000000-0000-4000-8000-000000000003',
  brakeRepair: '40000000-0000-4000-8000-000000000004',
  technicianA1: '50000000-0000-4000-8000-000000000001',
  technicianA2: '50000000-0000-4000-8000-000000000002',
  technicianA3: '50000000-0000-4000-8000-000000000003',
  technicianB1: '50000000-0000-4000-8000-000000000004',
  bayA1: '60000000-0000-4000-8000-000000000001',
  bayA2: '60000000-0000-4000-8000-000000000002',
  bayB1: '60000000-0000-4000-8000-000000000003',
} as const;

const id = fixtureIds;

// Insert missing reference records only: reruns preserve existing edits and appointments.
export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const data of [
      { id: id.dealershipA, name: 'Demo Dealership A', timeZone: 'Asia/Ho_Chi_Minh' },
      { id: id.dealershipB, name: 'Demo Dealership B', timeZone: 'Europe/London' },
    ]) {
      await tx.dealership.upsert({ where: { id: data.id }, create: data, update: {} });
    }
    for (const data of [
      { id: id.customer1, name: 'Demo Customer One' },
      { id: id.customer2, name: 'Demo Customer Two' },
      { id: id.customer3, name: 'Demo Customer Three' },
    ]) {
      await tx.customer.upsert({ where: { id: data.id }, create: data, update: {} });
    }
    for (const data of [
      {
        id: id.vehicle1,
        customerId: id.customer1,
        vin: 'TEST0000000000001',
        make: 'Demo',
        model: 'Sedan',
      },
      {
        id: id.vehicle2,
        customerId: id.customer1,
        vin: 'TEST0000000000002',
        make: 'Demo',
        model: 'Hatchback',
      },
      {
        id: id.vehicle3,
        customerId: id.customer2,
        vin: 'TEST0000000000003',
        make: 'Demo',
        model: 'SUV',
      },
      {
        id: id.vehicle4,
        customerId: id.customer3,
        vin: 'TEST0000000000004',
        make: 'Demo',
        model: 'Van',
      },
    ]) {
      await tx.vehicle.upsert({ where: { id: data.id }, create: data, update: {} });
    }
    for (const data of [
      { id: id.oilChange, name: 'Oil Change', durationMinutes: 30 },
      { id: id.tireReplacement, name: 'Tire Replacement', durationMinutes: 60 },
      { id: id.inspection, name: 'General Inspection', durationMinutes: 90 },
      { id: id.brakeRepair, name: 'Brake Repair', durationMinutes: 120 },
    ]) {
      await tx.serviceType.upsert({ where: { id: data.id }, create: data, update: {} });
    }
    for (const data of [
      { id: id.technicianA1, dealershipId: id.dealershipA, name: 'Demo Technician A1' },
      { id: id.technicianA2, dealershipId: id.dealershipA, name: 'Demo Technician A2' },
      { id: id.technicianA3, dealershipId: id.dealershipA, name: 'Demo Technician A3' },
      { id: id.technicianB1, dealershipId: id.dealershipB, name: 'Demo Technician B1' },
    ]) {
      await tx.technician.upsert({ where: { id: data.id }, create: data, update: {} });
    }
    for (const data of [
      { id: id.bayA1, dealershipId: id.dealershipA, name: 'Demo Bay A1' },
      { id: id.bayA2, dealershipId: id.dealershipA, name: 'Demo Bay A2' },
      { id: id.bayB1, dealershipId: id.dealershipB, name: 'Demo Bay B1' },
    ]) {
      await tx.serviceBay.upsert({ where: { id: data.id }, create: data, update: {} });
    }
    for (const [technicianId, serviceTypeId] of [
      [id.technicianA1, id.oilChange],
      [id.technicianA1, id.inspection],
      [id.technicianA2, id.tireReplacement],
      [id.technicianA2, id.brakeRepair],
      [id.technicianA3, id.oilChange],
      [id.technicianA3, id.tireReplacement],
      [id.technicianB1, id.oilChange],
      [id.technicianB1, id.inspection],
    ]) {
      const data = { technicianId, serviceTypeId };
      await tx.technicianQualification.upsert({
        where: { technicianId_serviceTypeId: data },
        create: data,
        update: {},
      });
    }
  });
}
