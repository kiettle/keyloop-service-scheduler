import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { HttpModule } from './common/http/http.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    DatabaseModule,
    HealthModule,
    SchedulingModule,
    AppointmentsModule,
    HttpModule,
  ],
})
export class AppModule {}
