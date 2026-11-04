import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../common/http/api-error.dto';
import { AvailabilityResponseDto } from './availability-response.dto';
import { AvailabilityQueryDto, DealershipParamsDto } from './availability.dto';
import { CheckAvailabilityUseCase } from './check-availability.use-case';

@Controller('api/v1/dealerships/:dealershipId/availability')
@ApiTags('Availability')
export class AvailabilityController {
  constructor(private readonly availability: CheckAvailabilityUseCase) {}

  @Get()
  @ApiOperation({
    summary: 'Check full-interval availability',
    description:
      'Read-only advisory result; no reservation. Unknown query fields are rejected. Booking revalidates independently.',
  })
  @ApiOkResponse({ type: AvailabilityResponseDto })
  @ApiResponse({ status: 400, type: ApiErrorResponseDto, description: 'VALIDATION_ERROR.' })
  @ApiResponse({
    status: 404,
    type: ApiErrorResponseDto,
    description: 'DEALERSHIP_NOT_FOUND or SERVICE_TYPE_NOT_FOUND.',
  })
  @ApiResponse({
    status: 422,
    type: ApiErrorResponseDto,
    description: 'INVALID_BOOKING_TIME or BUSINESS_RULE_VIOLATION.',
  })
  @ApiResponse({
    status: 503,
    type: ApiErrorResponseDto,
    description: 'SERVICE_UNAVAILABLE: recognized temporary database failure; Retry-After: 1.',
  })
  @ApiResponse({
    status: 500,
    type: ApiErrorResponseDto,
    description: 'INTERNAL_ERROR: unexpected failure.',
  })
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
