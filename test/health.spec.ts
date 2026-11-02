import { afterAll, beforeAll, describe, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthModule } from '../src/health/health.module';

describe('health HTTP contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [HealthModule] }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes GET /health as JSON', async () => {
    // Nest 11 returns an untyped handle; the default Express adapter uses a Node HTTP server.
    await request(app.getHttpServer() as Server)
      .get('/health')
      .expect(200)
      .expect('Content-Type', /json/)
      .expect({ status: 'ok' });
  });
});
