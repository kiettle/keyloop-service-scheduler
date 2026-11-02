import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { fixtureIds, seedDatabase } from './seed-data';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
    }),
  });
  try {
    await seedDatabase(prisma);
    console.log('Reference data seeded; no appointments created. Fixture IDs:');
    console.log(fixtureIds);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  console.error('Seed failed. Verify PostgreSQL, applied migrations, and DATABASE_URL.');
  process.exitCode = 1;
});
