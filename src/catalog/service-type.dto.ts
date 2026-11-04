import { ApiProperty } from '@nestjs/swagger';

export class ServiceTypeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  durationMinutes!: number;
}
