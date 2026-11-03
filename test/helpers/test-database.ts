import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export function createClient(url: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 5000, max: 10 }),
  });
}

// Each run owns a newly created database. Never truncate/reset a developer database.
export async function createTestDatabase() {
  const input = process.env.TEST_DATABASE_URL;
  if (!input) throw new Error('Set TEST_DATABASE_URL for the dedicated PostgreSQL test server.');
  const url = new URL(input);
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    url.pathname !== '/service_scheduler_test'
  ) {
    throw new Error('TEST_DATABASE_URL must name the dedicated service_scheduler_test database.');
  }
  const admin = createClient(url.toString());
  const name = `scheduler_test_${randomUUID().replaceAll('-', '')}`;
  url.pathname = `/${name}`;
  url.searchParams.set('schema', 'public');
  let created = false;
  let prisma: PrismaClient | undefined;

  async function close(): Promise<void> {
    try {
      await prisma?.$disconnect();
      if (created) {
        // Identifier is generated above from a fixed prefix and UUID hex, never input SQL.
        await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      }
    } finally {
      await admin.$disconnect();
    }
  }

  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    created = true;
    const output = execFileSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      {
        env: { ...process.env, DATABASE_URL: url.toString() },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    console.log(output.trim());
    const seedOutput = execFileSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'db', 'seed'],
      {
        env: { ...process.env, DATABASE_URL: url.toString() },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    console.log(seedOutput.trim());
    prisma = createClient(url.toString());
    await prisma.$executeRawUnsafe(await readFile('scripts/configure-database.sql', 'utf8'));
    // Role defaults take effect only on new sessions, including replacement pooled connections.
    await prisma.$disconnect();
    prisma = createClient(url.toString());
    return { prisma, url: url.toString(), close };
  } catch (error) {
    await close();
    throw error;
  }
}
