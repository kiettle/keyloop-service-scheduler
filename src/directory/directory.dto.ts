import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { PageMetadataDto } from '../common/http/pagination';

export class CustomerParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;
}

export class CustomerDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}
export class VehicleDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty() vin!: string;
  @ApiProperty() make!: string;
  @ApiProperty() model!: string;
}
export class DealershipDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() timeZone!: string;
}
export class CustomersPageDto extends PageMetadataDto {
  @ApiProperty({ type: [CustomerDto] }) items!: CustomerDto[];
}
export class VehiclesPageDto extends PageMetadataDto {
  @ApiProperty({ type: [VehicleDto] }) items!: VehicleDto[];
}
export class DealershipsPageDto extends PageMetadataDto {
  @ApiProperty({ type: [DealershipDto] }) items!: DealershipDto[];
}
