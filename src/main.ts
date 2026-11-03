import 'reflect-metadata';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Environment } from './config/environment';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    abortOnError: false,
    logger: new ConsoleLogger({ json: true }),
  });
  try {
    app.enableShutdownHooks();
    const config = app.get(ConfigService<Environment, true>);
    await app.listen(config.get('PORT', { infer: true }));
  } catch (error) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch(() => {
  // Do not print database errors that may contain credentials or connection details.
  Logger.error('Startup failed. Check configuration and PostgreSQL availability.', 'Bootstrap');
  process.exitCode = 1;
});
