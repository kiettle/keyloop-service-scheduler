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
@ApiResponse({ status: 400, type: ApiErrorResponseDto, description: 'VALIDATION_ERROR.' })
@ApiResponse({ status: 503, type: ApiErrorResponseDto, description: 'SERVICE_UNAVAILABLE.' })
@ApiResponse({ status: 500, type: ApiErrorResponseDto, description: 'INTERNAL_ERROR.' })
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Get('customers')
  @ApiOperation({ summary: 'List customers for the unauthenticated assessment demo' })
  @ApiOkResponse({ type: CustomersPageDto })
  customers(@Query() query: PaginationQueryDto) {
    return this.directory.customers(query);
  }

  @Get('customers/:customerId/vehicles')
  @ApiOperation({ summary: 'List vehicles owned by a customer' })
  @ApiOkResponse({ type: VehiclesPageDto })
  @ApiResponse({ status: 404, type: ApiErrorResponseDto, description: 'CUSTOMER_NOT_FOUND.' })
  vehicles(@Param() params: CustomerParamsDto, @Query() query: PaginationQueryDto) {
    return this.directory.vehicles(params.customerId, query);
  }

  @Get('dealerships')
  @ApiOperation({
    summary: 'List dealerships',
    description: 'Pages may be cached for five minutes; Redis failures fall back to PostgreSQL.',
  })
  @ApiOkResponse({ type: DealershipsPageDto })
  dealerships(@Query() query: PaginationQueryDto, @Req() request: HttpRequest) {
    return this.directory.dealerships(query, request.requestId);
  }
}
