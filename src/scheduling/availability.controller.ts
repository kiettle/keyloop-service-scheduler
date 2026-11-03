import { Controller, Get, Param, Query } from '@nestjs/common';
import { AvailabilityQueryDto, DealershipParamsDto } from './availability.dto';
import { CheckAvailabilityUseCase } from './check-availability.use-case';

@Controller('api/v1/dealerships/:dealershipId/availability')
export class AvailabilityController {
  constructor(private readonly availability: CheckAvailabilityUseCase) {}

  @Get()
  async get(@Param() params: DealershipParamsDto, @Query() query: AvailabilityQueryDto) {
    const result = await this.availability.execute({
      dealershipId: params.dealershipId,
      serviceTypeId: query.serviceTypeId,
      startAt: new Date(query.startAt),
    });
    return {
      dealershipId: result.dealershipId,
      serviceTypeId: result.serviceTypeId,
      startAt: result.startAt,
      endAt: result.endAt,
      available: result.available,
      availableTechnicianCount: result.availableTechnicianCount,
      availableServiceBayCount: result.availableServiceBayCount,
    };
  }
}
