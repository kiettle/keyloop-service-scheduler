import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Environment } from '../config/environment';

export const DATABASE_POOL_MAX = 20;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService<Environment, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
        connectionTimeoutMillis: 5000,
        max: DATABASE_POOL_MAX,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      // The adapter creates its pool lazily; a query verifies actual connectivity.
      await this.$queryRaw`SELECT 1`;
    } catch (error) {
      await this.$disconnect();
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
