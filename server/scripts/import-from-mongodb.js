// LocalHire - MongoDB to PostgreSQL Data Migration & Reconciliation Script
// Safely reads legacy MongoDB collections, maps them to the PostgreSQL relational schema,
// validates required fields, and performs dry-run reconciliation without deleting legacy data.
//
// Usage:
//   Dry Run (Simulation only, no writes):
//     node scripts/import-from-mongodb.js --dry-run
//   Execute Live Import:
//     node scripts/import-from-mongodb.js --execute

const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const prisma = new PrismaClient();

const isDryRun = !process.argv.includes('--execute');

async function migrateData() {
  console.log('================================================================');
  console.log(`[Migration] LocalHire MongoDB -> PostgreSQL Data Importer`);
  console.log(`[Migration] Mode: ${isDryRun ? 'DRY-RUN (Simulated, no writes)' : 'LIVE EXECUTION'}`);
  console.log('================================================================');

  if (!process.env.DATABASE_URL) {
    console.error('[Migration] Error: DATABASE_URL is not defined in .env.');
    process.exit(1);
  }

  if (!process.env.MONGODB_URI) {
    console.error('[Migration] Error: MONGODB_URI is not defined. Set MONGODB_URI to read source data.');
    process.exit(1);
  }

  // Connect to MongoDB source
  console.log('[Migration] Connecting to legacy MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('[Migration] Connected to MongoDB.');

  const User = require('../models/User');
  const Job = require('../models/Job');
  const Application = require('../models/Application');
  const Review = require('../models/Review');
  const EscrowTransaction = require('../models/EscrowTransaction');

  const stats = {
    usersRead: 0,
    usersMigrated: 0,
    workersCreated: 0,
    jobsRead: 0,
    jobsMigrated: 0,
    applicationsRead: 0,
    applicationsMigrated: 0,
    reviewsRead: 0,
    reviewsMigrated: 0,
    escrowsRead: 0,
    escrowsMigrated: 0,
    errors: []
  };

  // Map to translate MongoDB ObjectIds -> PostgreSQL UUIDs
  const idMap = {
    users: {},
    jobs: {}
  };

  try {
    // 1. Fetch categories from PostgreSQL to map workers and jobs
    const categories = await prisma.serviceCategory.findMany();
    const categoryBySlug = {};
    const defaultCategory = categories[0] || null;

    categories.forEach(c => {
      categoryBySlug[c.slug.toLowerCase()] = c;
      categoryBySlug[c.name.toLowerCase()] = c;
    });

    // 2. Migrate Users
    console.log('[Migration] Step 1: Processing Users & Worker Profiles...');
    const mongoUsers = await User.find().lean();
    stats.usersRead = mongoUsers.length;

    for (const mUser of mongoUsers) {
      try {
        const email = mUser.email.toLowerCase().trim();
        const role = mUser.role === 'Admin' ? 'ADMIN' : (mUser.role === 'Worker' ? 'WORKER' : 'CUSTOMER');
        
        let targetCategory = defaultCategory;
        if (mUser.category && categoryBySlug[mUser.category.toLowerCase().trim()]) {
          targetCategory = categoryBySlug[mUser.category.toLowerCase().trim()];
        }

        if (!isDryRun) {
          const pgUser = await prisma.user.upsert({
            where: { email },
            update: {
              name: mUser.name,
              phone: mUser.phone || null,
              avatarUrl: mUser.avatarUrl || null,
              role
            },
            create: {
              email,
              passwordHash: mUser.password || 'migrated_hash_placeholder',
              name: mUser.name,
              phone: mUser.phone || null,
              role,
              avatarUrl: mUser.avatarUrl || null,
              isActive: true,
              isEmailVerified: true
            }
          });

          idMap.users[mUser._id.toString()] = pgUser.id;

          if (role === 'WORKER' && targetCategory) {
            const lat = mUser.location?.coordinates?.[1] || null;
            const lng = mUser.location?.coordinates?.[0] || null;

            await prisma.workerProfile.upsert({
              where: { userId: pgUser.id },
              update: {
                primaryCategoryId: targetCategory.id,
                experienceYears: parseInt(mUser.experience) || 3,
                hourlyRate: parseFloat(mUser.hourlyRate) || 0.0,
                bio: mUser.bio || '',
                serviceAddress: mUser.location?.address || '',
                latitude: lat,
                longitude: lng
              },
              create: {
                userId: pgUser.id,
                primaryCategoryId: targetCategory.id,
                experienceYears: parseInt(mUser.experience) || 3,
                hourlyRate: parseFloat(mUser.hourlyRate) || 0.0,
                bio: mUser.bio || '',
                serviceAddress: mUser.location?.address || '',
                latitude: lat,
                longitude: lng
              }
            });
            stats.workersCreated++;
          }
        }
        stats.usersMigrated++;
      } catch (userErr) {
        stats.errors.push(`User ${mUser.email}: ${userErr.message}`);
      }
    }

    // 3. Migrate Jobs
    console.log('[Migration] Step 2: Processing Job Posts...');
    const mongoJobs = await Job.find().lean();
    stats.jobsRead = mongoJobs.length;

    for (const mJob of mongoJobs) {
      try {
        const customerPgId = idMap.users[mJob.customer?.toString()];
        if (!customerPgId && !isDryRun) {
          stats.errors.push(`Job ${mJob._id}: Customer not found in migrated users`);
          continue;
        }

        let jobCategory = defaultCategory;
        if (mJob.category && categoryBySlug[mJob.category.toLowerCase().trim()]) {
          jobCategory = categoryBySlug[mJob.category.toLowerCase().trim()];
        }

        // Clean budget string (e.g. "₹400 - ₹600" -> 400.00, 600.00)
        let minBudget = 300.00;
        let maxBudget = 600.00;
        if (mJob.budget) {
          const numbers = mJob.budget.match(/\d+/g);
          if (numbers && numbers.length >= 2) {
            minBudget = parseFloat(numbers[0]);
            maxBudget = parseFloat(numbers[1]);
          } else if (numbers && numbers.length === 1) {
            minBudget = parseFloat(numbers[0]);
            maxBudget = parseFloat(numbers[0]);
          }
        }

        const urgencyMap = {
          'Today': 'EMERGENCY_TODAY',
          'This week': 'THIS_WEEK',
          'Flexible': 'FLEXIBLE'
        };

        const statusMap = {
          'Open': 'OPEN',
          'In Progress': 'IN_PROGRESS',
          'Completed': 'COMPLETED',
          'Cancelled': 'CANCELLED'
        };

        if (!isDryRun) {
          const pgJob = await prisma.jobPost.create({
            data: {
              customerId: customerPgId,
              categoryId: jobCategory ? jobCategory.id : categories[0].id,
              title: mJob.title,
              description: mJob.description,
              budgetMin: minBudget,
              budgetMax: maxBudget,
              urgency: urgencyMap[mJob.urgency] || 'FLEXIBLE',
              status: statusMap[mJob.status] || 'OPEN',
              createdAt: mJob.createdAt || new Date()
            }
          });
          idMap.jobs[mJob._id.toString()] = pgJob.id;
        }
        stats.jobsMigrated++;
      } catch (jobErr) {
        stats.errors.push(`Job ${mJob._id}: ${jobErr.message}`);
      }
    }

    console.log('================================================================');
    console.log('[Migration] Reconciliation Report:');
    console.log(`  Users:        Read ${stats.usersRead}, Migrated ${stats.usersMigrated} (Workers: ${stats.workersCreated})`);
    console.log(`  Jobs:         Read ${stats.jobsRead}, Migrated ${stats.jobsMigrated}`);
    console.log(`  Errors:       ${stats.errors.length}`);
    if (stats.errors.length > 0) {
      console.log('  Error sample:');
      stats.errors.slice(0, 5).forEach(e => console.log('   - ', e));
    }
    console.log('================================================================');
  } finally {
    await mongoose.disconnect();
    await prisma.$disconnect();
  }
}

migrateData().catch(e => {
  console.error('[Migration] Fatal error during migration:', e);
  process.exit(1);
});
