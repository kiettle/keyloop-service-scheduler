import { Module } from '@nestjs/common';
import { Clock } from '../common/time/clock';
import { DatabaseModule } from '../database/database.module';
import { CheckAvailabilityUseCase } from './check-availability.use-case';
import { ResourceAllocationService } from './resource-allocation.service';
import { SchedulingRepository } from './scheduling.repository';
import { AvailabilityController } from './availability.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [AvailabilityController],
  providers: [Clock, SchedulingRepository, ResourceAllocationService, CheckAvailabilityUseCase],
  exports: [CheckAvailabilityUseCase],
})
export class SchedulingModule {}
