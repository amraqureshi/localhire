// LocalHire - Database Connectivity Verification Utility
// Tests PostgreSQL connection without modifying data or requiring frontend services.

const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  log: ['error']
});

async function checkDatabase() {
  console.log('================================================================');
  console.log('[DB Health Check] Verifying PostgreSQL Connection for LocalHire');
  console.log('================================================================');

  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    console.error('❌ Status: FAILED — DATABASE_URL is not configured.');
    console.error('\nAction Required:');
    console.error('  1. Copy .env.example to .env:');
    console.error('     cp .env.example .env');
    console.error('  2. Open .env and configure your friend\'s PostgreSQL connection string:');
    console.error('     DATABASE_URL="postgresql://<USER>:<PASSWORD>@<HOST>:5432/<DB>?schema=public"');
    console.error('  3. Re-run: npm run db:check\n');
    process.exit(1);
  }

  // Sanitize password for console display
  const sanitizedUrl = dbUrl.replace(/:([^:@]+)@/, ':********@');
  console.log(`[DB Health Check] Target Connection URI: ${sanitizedUrl}`);
  console.log('[DB Health Check] Attempting connection...');

  try {
    const startTime = Date.now();
    const result = await prisma.$queryRaw`SELECT 1 AS connected, NOW() AS server_time, version() AS pg_version`;
    const durationMs = Date.now() - startTime;

    console.log('\n✅ Status: SUCCESS — Successfully connected to PostgreSQL!');
    console.log(`[DB Health Check] Response latency: ${durationMs}ms`);
    if (result && result.length > 0) {
      console.log(`[DB Health Check] Remote Server Time: ${result[0].server_time}`);
      console.log(`[DB Health Check] PostgreSQL Version: ${result[0].pg_version}`);
    }

    // Inspect database tables count
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;

    console.log(`\n[DB Health Check] Tables present in public schema: ${tables.length}`);
    if (tables.length > 0) {
      console.log('  Schema Tables:');
      tables.forEach(t => console.log(`   - ${t.table_name}`));
    } else {
      console.log('  Notice: Database is connected but empty. Run: npm run prisma:migrate:deploy');
    }

    console.log('\n================================================================');
    console.log('Database is healthy and ready for LocalHire operations.');
    console.log('================================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Status: FAILED — Could not establish connection to PostgreSQL.');
    console.error(`[DB Health Check] Error Code:    ${err.code || 'UNKNOWN'}`);
    console.error(`[DB Health Check] Error Message: ${err.message}`);

    console.error('\nTroubleshooting Checklist:');
    console.error('  1. Is PostgreSQL running on the target machine? (Check Service status)');
    console.error('  2. Are the username and password correct?');
    console.error('  3. Does the database "localhire_db" exist?');
    console.error('  4. If connecting across a local network or VPN:');
    console.error('     - Check firewall rules for port 5432.');
    console.error('     - Check postgresql.conf for "listen_addresses = \'*\'".');
    console.error('     - Check pg_hba.conf for client authentication entries.');
    console.error('  5. Never fall back to LocalStorage or mock records when database access fails.\n');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabase();
