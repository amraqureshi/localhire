// LocalHire - Centralized Prisma Client Singleton Module
// Enforces a single Prisma instance across application processes and hot-reloads.
// Does NOT silently fall back to mock data or LocalStorage on connection failure.

const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const globalForPrisma = global;

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('\n================================================================');
    console.error('[Prisma Error] DATABASE_URL is not defined in the environment.');
    console.error('[Prisma Error] Please set DATABASE_URL in your .env file.');
    console.error('[Prisma Error] Format: postgresql://<USER>:<PASSWORD>@<HOST>:5432/<DB>?schema=public');
    console.error('================================================================\n');
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
    errorFormat: 'pretty'
  });
}

const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

module.exports = prisma;
