import { Module } from '@nestjs/common';
import { RedisCache } from './redis-cache';

@Module({ providers: [RedisCache], exports: [RedisCache] })
export class RedisCacheModule {}
