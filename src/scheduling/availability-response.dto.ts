import { ApiProperty } from '@nestjs/swagger';

export class AvailabilityResponseDto {
  @ApiProperty({ format: 'uuid' })
  dealershipId!: string;

  @ApiProperty({ format: 'uuid' })
  serviceTypeId!: string;

  @ApiProperty({ format: 'date-time' })
  startAt!: string;

  @ApiProperty({ format: 'date-time' })
  endAt!: string;

  @ApiProperty({
    description: 'An eligible pair exists at read time; this does not reserve resources.',
  })
  available!: boolean;

  @ApiProperty({ minimum: 0, type: 'integer' })
  availableTechnicianCount!: number;

  @ApiProperty({ minimum: 0, type: 'integer' })
  availableServiceBayCount!: number;
}
