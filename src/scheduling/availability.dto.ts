import { IsISO8601, IsUUID, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export class AvailabilityQueryDto {
  @ApiProperty({ format: 'uuid', example: '40000000-0000-4000-8000-000000000001' })
  @IsUUID()
  serviceTypeId!: string;

  @ApiProperty({
    format: 'date-time',
    pattern: timestampPattern.source,
    example: '2035-01-15T10:00:00.000Z',
    description: 'Future instant with seconds and Z or ±HH:MM offset; at most 3 fractional digits.',
  })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(timestampPattern, {
    message:
      'startAt must include seconds and Z or an explicit UTC offset, with at most 3 fractional digits.',
  })
  startAt!: string;
}

export class DealershipParamsDto {
  @ApiProperty({ format: 'uuid', example: '10000000-0000-4000-8000-000000000001' })
  @IsUUID()
  dealershipId!: string;
}
