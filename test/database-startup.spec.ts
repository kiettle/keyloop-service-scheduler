import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/database/prisma.service';

// Uses the real driver against an unreachable local port; no database fixture or mock.
describe('database startup', () => {
  it('rejects initialization when PostgreSQL is unavailable', async () => {
    const module = await Test.createTestingModule({
      providers: [
        PrismaService,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            DATABASE_URL: 'postgresql://127.0.0.1:1/unreachable',
          }),
        },
      ],
    }).compile();

    try {
      await expect(module.init()).rejects.toThrow();
    } finally {
      await module.get(PrismaService).$disconnect();
    }
  }, 10_000);
});
