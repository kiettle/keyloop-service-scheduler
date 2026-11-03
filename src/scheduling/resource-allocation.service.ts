import { Injectable } from '@nestjs/common';

export interface EligibleResources {
  technicianIds: readonly string[];
  serviceBayIds: readonly string[];
}

export type ResourceAllocation =
  | { available: true; technicianId: string; serviceBayId: string }
  | { available: false; technicianId: null; serviceBayId: null };

@Injectable()
export class ResourceAllocationService {
  // Bays are interchangeable in P0: any eligible technician and bay form a valid pair.
  select(resources: EligibleResources): ResourceAllocation {
    const technicianId = resources.technicianIds.toSorted()[0];
    const serviceBayId = resources.serviceBayIds.toSorted()[0];
    if (!technicianId || !serviceBayId) {
      return { available: false, technicianId: null, serviceBayId: null };
    }
    return { available: true, technicianId, serviceBayId };
  }
}
