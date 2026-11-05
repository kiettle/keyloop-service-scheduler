import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { PageMetadataDto } from '../common/http/pagination';

export class CustomerParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;
}

export class CustomerDto {
  @ApiProperty({ format: 'uuid', example: '20000000-0000-4000-8000-000000000001' }) id!: string;
  @ApiProperty({ example: 'Demo Customer One' }) name!: string;
}
export class VehicleDto {
  @ApiProperty({ format: 'uuid', example: '30000000-0000-4000-8000-000000000001' }) id!: string;
  @ApiProperty({ format: 'uuid', example: '20000000-0000-4000-8000-000000000001' })
  customerId!: string;
  @ApiProperty({
    example: 'TEST0000000000001',
    description: 'Unique vehicle identification number.',
  })
  vin!: string;
  @ApiProperty({ example: 'Demo', description: 'Vehicle manufacturer or brand.' }) make!: string;
  @ApiProperty({ example: 'Sedan' }) model!: string;
}
export class DealershipDto {
  @ApiProperty({ format: 'uuid', example: '10000000-0000-4000-8000-000000000001' }) id!: string;
  @ApiProperty({ example: 'Demo Dealership A' }) name!: string;
  @ApiProperty({ example: 'Asia/Ho_Chi_Minh' }) timeZone!: string;
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
