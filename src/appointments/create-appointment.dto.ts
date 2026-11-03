import { IsUUID } from 'class-validator';
import { AvailabilityQueryDto } from '../scheduling/availability.dto';

export class CreateAppointmentDto extends AvailabilityQueryDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  vehicleId!: string;

  @IsUUID()
  dealershipId!: string;
}

export class AppointmentParamsDto {
  @IsUUID()
  id!: string;
}
