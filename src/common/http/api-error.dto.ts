import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ApiErrorDetailsDto {
  @ApiProperty({
    description: 'Machine-readable code; see the status-specific response description.',
  })
  code!: string;

  @ApiProperty({
    description: 'Safe explanation of the failure.',
  })
  message!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Validation messages, present only for DTO validation failures.',
  })
  details?: string[];
}

export class ApiErrorResponseDto {
  @ApiProperty({ type: ApiErrorDetailsDto })
  error!: ApiErrorDetailsDto;

  @ApiProperty({
    format: 'uuid',
    description: 'Same server-generated ID as the x-request-id response header.',
  })
  requestId!: string;
}
