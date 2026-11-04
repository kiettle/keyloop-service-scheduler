import { ApiProperty } from '@nestjs/swagger';

export class AppointmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  customerId!: string;

  @ApiProperty({ format: 'uuid' })
  vehicleId!: string;

  @ApiProperty({ format: 'uuid' })
  dealershipId!: string;

  @ApiProperty({ format: 'uuid' })
  serviceTypeId!: string;

  @ApiProperty({ format: 'uuid' })
  technicianId!: string;

  @ApiProperty({ format: 'uuid' })
  serviceBayId!: string;

  @ApiProperty({ format: 'date-time', example: '2035-01-15T10:00:00.000Z' })
  startAt!: string;

  @ApiProperty({ format: 'date-time', example: '2035-01-15T10:30:00.000Z' })
  endAt!: string;

  @ApiProperty({
    enum: ['CONFIRMED', 'CANCELLED'],
    description: 'POST always creates CONFIRMED. There is no cancellation API.',
  })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
