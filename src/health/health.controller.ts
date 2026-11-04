import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@Controller('health')
@ApiTags('Health')
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Process liveness',
    description: 'Does not perform a continuous database-readiness check.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['status'],
      properties: { status: { type: 'string', enum: ['ok'] } },
    },
  })
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
