import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../common/http/api-error.dto';
import { PageMetadataDto, PaginationQueryDto } from '../common/http/pagination';
import { CustomerParamsDto } from '../directory/directory.dto';
import { AppointmentResponseDto } from './appointment-response.dto';
import { ListCustomerAppointmentsUseCase } from './list-customer-appointments.use-case';

export class CustomerAppointmentsPageDto extends PageMetadataDto {
  @ApiProperty({ type: [AppointmentResponseDto] }) items!: AppointmentResponseDto[];
}

@Controller('api/v1/customers/:customerId/appointments')
@ApiTags('Appointments')
export class CustomerAppointmentsController {
  constructor(private readonly list: ListCustomerAppointmentsUseCase) {}

  @Get()
  @ApiOperation({
    summary: 'List customer appointments',
    description:
      'All stored statuses, past and future. Ordered by start time descending, then ID descending.',
  })
  @ApiOkResponse({ type: CustomerAppointmentsPageDto })
  @ApiResponse({ status: 400, type: ApiErrorResponseDto, description: 'VALIDATION_ERROR.' })
  @ApiResponse({ status: 404, type: ApiErrorResponseDto, description: 'CUSTOMER_NOT_FOUND.' })
  @ApiResponse({ status: 503, type: ApiErrorResponseDto, description: 'SERVICE_UNAVAILABLE.' })
  @ApiResponse({ status: 500, type: ApiErrorResponseDto, description: 'INTERNAL_ERROR.' })
  get(@Param() params: CustomerParamsDto, @Query() query: PaginationQueryDto) {
    return this.list.execute(params.customerId, query);
  }
}
