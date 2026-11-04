import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Keyloop Service Scheduler')
    .setDescription(
      'Backend-only Scenario A demo. Booking assigns resources and derives duration server-side. ' +
        'Availability is advisory and creates no reservation. Responses use UTC milliseconds. ' +
        'Unknown booking/query fields are rejected. Booking requires one UUID v4 Idempotency-Key; successful results replay as 201 and keys are retained indefinitely. No authentication is implemented. ' +
        'Booking lookups and customer history use page/limit pagination. Booking assigns technicians and bays automatically. ' +
        'Responses include x-request-id; retryable 503 responses include Retry-After.',
    )
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  const booking = document.components?.schemas?.CreateAppointmentDto;
  if (booking && !('$ref' in booking)) booking.additionalProperties = false;
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: '/docs-json',
    raw: ['json'],
    customSiteTitle: 'Keyloop API documentation',
    swaggerOptions: { validatorUrl: null },
  });
}
