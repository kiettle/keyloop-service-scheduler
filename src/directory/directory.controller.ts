import { HttpRequest } from '../common/http/request-context';
import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../common/http/api-error.dto';
import { PaginationQueryDto } from '../common/http/pagination';
import {
  CustomerParamsDto,
  CustomersPageDto,
  VehiclesPageDto,
  DealershipsPageDto,
} from './directory.dto';
import { DirectoryService } from './directory.service';

@Controller('api/v1')
@ApiTags('Booking lookups')
@ApiResponse({
  status: 400,
  type: ApiErrorResponseDto,
  description:
    'VALIDATION_ERROR: invalid pagination, malformed customer ID, or unknown query fields.',
  example: {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request.',
      details: ['page must not be less than 1'],
    },
    requestId: '90000000-0000-4000-8000-000000000001',
  },
})
@ApiResponse({
  status: 503,
  type: ApiErrorResponseDto,
  description: 'SERVICE_UNAVAILABLE: temporary database failure. Retry-After: 1.',
  example: {
    error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable. Please retry later.',
    },
    requestId: '90000000-0000-4000-8000-000000000001',
  },
})
@ApiResponse({
  status: 500,
  type: ApiErrorResponseDto,
  description: 'INTERNAL_ERROR: unexpected failure; internal details are not exposed.',
  example: {
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    requestId: '90000000-0000-4000-8000-000000000001',
  },
})
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Get('customers')
  @ApiOperation({ summary: 'List customers for the unauthenticated assessment demo' })
  @ApiOkResponse({ type: CustomersPageDto, description: 'Customer page, ordered by name then ID.' })
  customers(@Query() query: PaginationQueryDto) {
    return this.directory.customers(query);
  }

  @Get('customers/:customerId/vehicles')
  @ApiOperation({ summary: 'List vehicles owned by a customer' })
  @ApiOkResponse({
    type: VehiclesPageDto,
    description:
      'Owned vehicles, ordered by ID. An existing customer with no vehicles gets items: [].',
  })
  @ApiResponse({
    status: 404,
    type: ApiErrorResponseDto,
    description: 'CUSTOMER_NOT_FOUND: no customer exists with the supplied ID.',
    example: {
      error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found.' },
      requestId: '90000000-0000-4000-8000-000000000001',
    },
  })
  vehicles(@Param() params: CustomerParamsDto, @Query() query: PaginationQueryDto) {
    return this.directory.vehicles(params.customerId, query);
  }

  @Get('dealerships')
  @ApiOperation({
    summary: 'List dealerships',
    description: 'Pages may be cached for five minutes; Redis failures fall back to PostgreSQL.',
  })
  @ApiOkResponse({
    type: DealershipsPageDto,
    description: 'Dealership page, ordered by name then ID.',
  })
  dealerships(@Query() query: PaginationQueryDto, @Req() request: HttpRequest) {
    return this.directory.dealerships(query, request.requestId);
  }
}
