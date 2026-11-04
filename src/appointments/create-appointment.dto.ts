import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AvailabilityQueryDto } from '../scheduling/availability.dto';

export class CreateAppointmentDto extends AvailabilityQueryDto {
  @ApiProperty({ format: 'uuid', example: '20000000-0000-4000-8000-000000000001' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ format: 'uuid', example: '30000000-0000-4000-8000-000000000001' })
  @IsUUID()
  vehicleId!: string;

  @ApiProperty({ format: 'uuid', example: '10000000-0000-4000-8000-000000000001' })
  @IsUUID()
  dealershipId!: string;
}

export class AppointmentParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}
