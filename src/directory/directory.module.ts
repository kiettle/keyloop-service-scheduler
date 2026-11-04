import { RedisCacheModule } from '../cache/redis-cache.module';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DirectoryCache } from './directory-cache';
import { DirectoryController } from './directory.controller';
import { DirectoryService } from './directory.service';
import { DirectoryRepository } from './directory.repository';

@Module({
  imports: [DatabaseModule, RedisCacheModule],
  controllers: [DirectoryController],
  providers: [DirectoryService, DirectoryRepository, DirectoryCache],
})
export class DirectoryModule {}
