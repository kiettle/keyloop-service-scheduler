import { Controller, Get, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../common/http/api-error.dto';
import { HttpRequest } from '../common/http/request-context';
import { ListServiceTypesUseCase } from './list-service-types.use-case';
import { ServiceTypeDto } from './service-type.dto';

@Controller('api/v1/service-types')
@ApiTags('Service catalog')
export class ServiceTypesController {
  constructor(private readonly list: ListServiceTypesUseCase) {}

  @Get()
  @ApiOperation({
    summary: 'List active global service types',
    description:
      'Supports service selection. The catalog may be cached for five minutes; it does not guarantee qualified or available resources at a dealership. Booking and availability use current PostgreSQL data.',
  })
  @ApiOkResponse({
    type: [ServiceTypeDto],
    description: 'Active catalog ordered by name then ID; an empty catalog is [].',
  })
  @ApiResponse({
    status: 503,
    type: ApiErrorResponseDto,
    description: 'SERVICE_UNAVAILABLE: database read failed and no cached result was available.',
  })
  @ApiResponse({
    status: 500,
    type: ApiErrorResponseDto,
    description: 'INTERNAL_ERROR: unexpected database/application error.',
  })
  get(@Req() request: HttpRequest) {
    return this.list.execute(request.requestId);
  }
}
