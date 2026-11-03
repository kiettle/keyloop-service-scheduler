import { describe, expect, it } from 'vitest';
import { ResourceAllocationService } from '../../src/scheduling/resource-allocation.service';

const allocation = new ResourceAllocationService();

describe('resource selection', () => {
  it('selects the lowest IDs independently of query order without changing candidate lists', () => {
    const resources = { technicianIds: ['t3', 't1', 't2'], serviceBayIds: ['b2', 'b1'] };
    expect(allocation.select(resources)).toEqual({
      available: true,
      technicianId: 't1',
      serviceBayId: 'b1',
    });
    expect(
      allocation.select({ technicianIds: ['t2', 't1', 't3'], serviceBayIds: ['b1', 'b2'] }),
    ).toEqual(allocation.select(resources));
    expect(resources).toEqual({ technicianIds: ['t3', 't1', 't2'], serviceBayIds: ['b2', 'b1'] });
  });

  it.each([
    { technicianIds: [], serviceBayIds: ['b1'] },
    { technicianIds: ['t1'], serviceBayIds: [] },
    { technicianIds: [], serviceBayIds: [] },
  ])('returns an explicit unavailable result for %j', (resources) => {
    expect(allocation.select(resources)).toEqual({
      available: false,
      technicianId: null,
      serviceBayId: null,
    });
  });
});
