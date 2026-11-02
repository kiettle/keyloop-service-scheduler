require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

async function check() {
  let prisma;
  try {
    if (!process.env.DATABASE_URL) throw new Error('Missing database configuration');
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 5000,
      }),
    });
    const rows = await prisma.$queryRaw`SELECT 1 AS connected`;
    if (rows[0]?.connected !== 1) throw new Error('Unexpected database response');
    console.log('PostgreSQL connection verified through Prisma (SELECT 1).');
  } catch {
    console.error('Database connection failed. Check DATABASE_URL and PostgreSQL availability.');
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect();
  }
}
void check();
