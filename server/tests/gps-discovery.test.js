const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const prisma = require('../config/prisma');

test('Phase 4: GPS Location, Worker Discovery & Geospatial Queries', async (t) => {
  let customerUser = null;
  let workerUser = null;
  let workerProfile = null;
  let serviceCat = null;

  const testSuffix = Date.now();
  const customerEmail = `gps-cust-${testSuffix}@example.com`;
  const workerEmail = `gps-worker-${testSuffix}@example.com`;

  // Belagavi, Karnataka reference coordinates
  const baseLat = 15.8497;
  const baseLng = 74.4977;

  t.after(async () => {
    if (workerUser) {
      await prisma.workerLocation.deleteMany({ where: { workerProfileId: workerProfile?.id } }).catch(() => {});
      await prisma.workerProfile.deleteMany({ where: { userId: workerUser.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: workerUser.id } }).catch(() => {});
    }
    if (customerUser) {
      await prisma.customerLocation.deleteMany({ where: { userId: customerUser.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: customerUser.id } }).catch(() => {});
    }
  });

  await t.test('Seed test service category, customer, and worker for geospatial tests', async () => {
    serviceCat = await prisma.serviceCategory.findFirst({ where: { slug: 'plumber' } });
    if (!serviceCat) {
      serviceCat = await prisma.serviceCategory.create({
        data: {
          name: 'Plumber',
          slug: 'plumber',
          description: 'Plumbing services'
        }
      });
    }

    customerUser = await prisma.user.create({
      data: {
        email: customerEmail,
        passwordHash: 'dummy_hash',
        name: 'GPS Test Customer',
        role: 'CUSTOMER'
      }
    });
    assert.ok(customerUser.id);

    workerUser = await prisma.user.create({
      data: {
        email: workerEmail,
        passwordHash: 'dummy_hash',
        name: 'GPS Test Worker',
        role: 'WORKER',
        workerProfile: {
          create: {
            primaryCategoryId: serviceCat.id,
            hourlyRate: 350,
            experienceYears: 5,
            verificationStatus: 'VERIFIED',
            serviceRadiusKm: 25,
            serviceAddress: 'Camp, Belagavi',
            latitude: baseLat + 0.01,
            longitude: baseLng + 0.01
          }
        }
      },
      include: { workerProfile: true }
    });
    workerProfile = workerUser.workerProfile;
    assert.ok(workerProfile.id);
  });

  await t.test('Customer location save and retrieval via CustomerLocation model', async () => {
    // 1. Save customer current GPS location
    const saved = await prisma.customerLocation.upsert({
      where: { userId: customerUser.id },
      update: {
        latitude: baseLat,
        longitude: baseLng,
        addressLabel: 'Belagavi City Center',
        lastLocationUpdate: new Date()
      },
      create: {
        userId: customerUser.id,
        latitude: baseLat,
        longitude: baseLng,
        addressLabel: 'Belagavi City Center',
        lastLocationUpdate: new Date()
      }
    });

    assert.equal(saved.userId, customerUser.id);
    assert.equal(saved.latitude, baseLat);
    assert.equal(saved.longitude, baseLng);

    // 2. Retrieve customer location
    const retrieved = await prisma.customerLocation.findUnique({
      where: { userId: customerUser.id }
    });
    assert.ok(retrieved);
    assert.equal(retrieved.addressLabel, 'Belagavi City Center');
  });

  await t.test('Worker location consent and availability control in WorkerLocation', async () => {
    // 1. Initial location sharing enabled
    const loc = await prisma.workerLocation.upsert({
      where: { workerProfileId: workerProfile.id },
      update: {
        latitude: baseLat + 0.01,
        longitude: baseLng + 0.01,
        isAvailable: true,
        sharingEnabled: true,
        lastLocationUpdate: new Date()
      },
      create: {
        workerProfileId: workerProfile.id,
        latitude: baseLat + 0.01,
        longitude: baseLng + 0.01,
        isAvailable: true,
        sharingEnabled: true,
        lastLocationUpdate: new Date()
      }
    });

    assert.equal(loc.isAvailable, true);
    assert.equal(loc.sharingEnabled, true);

    // 2. Disable sharing (consent revoked)
    const disabled = await prisma.workerLocation.update({
      where: { workerProfileId: workerProfile.id },
      data: {
        sharingEnabled: false
      }
    });
    assert.equal(disabled.sharingEnabled, false);

    // 3. Re-enable for discovery tests
    await prisma.workerLocation.update({
      where: { workerProfileId: workerProfile.id },
      data: {
        sharingEnabled: true,
        isAvailable: true,
        lastLocationUpdate: new Date()
      }
    });
  });

  await t.test('PostGIS ST_DWithin and ST_Distance geospatial discovery query execution', async () => {
    // Query nearby available workers using ST_DWithin / ST_Distance
    const searchRadiusMeters = 20000; // 20 km

    const results = await prisma.$queryRaw`
      SELECT 
        u."id",
        u."name",
        u."avatarUrl",
        wp."id" as "workerProfileId",
        wp."hourlyRate",
        wp."rating",
        wp."verificationStatus",
        sc."name" as "categoryName",
        ROUND(
          (ST_Distance(
            wl."location",
            ST_SetSRID(ST_MakePoint(${baseLng}, ${baseLat}), 4326)::geography
          ) / 1000.0)::numeric,
          2
        ) as "distanceKm"
      FROM "WorkerLocation" wl
      JOIN "WorkerProfile" wp ON wl."workerProfileId" = wp."id"
      JOIN "User" u ON wp."userId" = u."id"
      JOIN "ServiceCategory" sc ON wp."primaryCategoryId" = sc."id"
      WHERE wl."isAvailable" = true
        AND wl."sharingEnabled" = true
        AND wl."location" IS NOT NULL
        AND ST_DWithin(
          wl."location",
          ST_SetSRID(ST_MakePoint(${baseLng}, ${baseLat}), 4326)::geography,
          ${searchRadiusMeters}
        )
      ORDER BY "distanceKm" ASC;
    `;

    assert.ok(Array.isArray(results));
    const found = results.find(r => r.id === workerUser.id);
    assert.ok(found, 'Worker with enabled sharing should appear in nearby discovery');
    assert.ok(Number(found.distanceKm) >= 0 && Number(found.distanceKm) < 20);
    assert.equal(found.categoryName, 'Plumber');
  });

  await t.test('Unavailable or unconsenting workers are excluded from discovery results', async () => {
    // Set worker as unavailable
    await prisma.workerLocation.update({
      where: { workerProfileId: workerProfile.id },
      data: { isAvailable: false }
    });

    const results = await prisma.$queryRaw`
      SELECT u."id"
      FROM "WorkerLocation" wl
      JOIN "WorkerProfile" wp ON wl."workerProfileId" = wp."id"
      JOIN "User" u ON wp."userId" = u."id"
      WHERE wl."isAvailable" = true
        AND wl."sharingEnabled" = true
        AND ST_DWithin(
          wl."location",
          ST_SetSRID(ST_MakePoint(${baseLng}, ${baseLat}), 4326)::geography,
          20000
        );
    `;

    const found = results.find(r => r.id === workerUser.id);
    assert.equal(found, undefined, 'Unavailable worker must NOT appear in discovery');
  });
});

