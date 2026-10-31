const test = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../config/prisma');
const userController = require('../controllers/userController');
const addressController = require('../controllers/addressController');

const createMockResponse = () => ({
  statusCode: 200,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(data) {
    this.payload = data;
    return this;
  }
});

test('customer location rejects invalid coordinates before persistence', async () => {
  const req = {
    user: { id: 'customer-1' },
    body: { latitude: 91, longitude: 10, addressLabel: 'Somewhere' }
  };
  const res = createMockResponse();

  await addressController.saveCurrentLocation(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.success, false);
});

test('worker marked unavailable has precise coordinates cleared', async () => {
  const originalFindUnique = prisma.workerProfile.findUnique;
  const originalUpsert = prisma.workerLocation.upsert;
  let upsertArgs;
  prisma.workerProfile.findUnique = async () => ({ id: 'profile-1' });
  prisma.workerLocation.upsert = async (args) => {
    upsertArgs = args;
    return { isAvailable: false, sharingEnabled: true, lastLocationUpdate: null };
  };

  try {
    const req = {
      user: { id: 'worker-1' },
      body: { sharingEnabled: true, isAvailable: false }
    };
    const res = createMockResponse();
    await userController.updateMyLocationSharing(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(upsertArgs.create.latitude, null);
    assert.equal(upsertArgs.create.longitude, null);
    assert.equal(upsertArgs.update.lastLocationUpdate, null);
  } finally {
    prisma.workerProfile.findUnique = originalFindUnique;
    prisma.workerLocation.upsert = originalUpsert;
  }
});

test('nearby search returns sorted distance and coarse markers without precise coordinates', async () => {
  const originalQueryRaw = prisma.$queryRaw;
  const originalFindMany = prisma.user.findMany;
  prisma.$queryRaw = async () => [{
    workerProfileId: 'profile-1',
    distanceKm: 2.34,
    latitude: 12.3456,
    longitude: 77.1234
  }];
  prisma.user.findMany = async () => [{
    id: 'worker-1',
    name: 'Worker One',
    email: 'worker@example.test',
    phone: null,
    avatarUrl: 'https://example.test/worker.png',
    createdAt: new Date(),
    updatedAt: new Date(),
    workerProfile: {
      id: 'profile-1',
      primaryCategory: { name: 'Electrician' },
      skills: [],
      hourlyRate: 45,
      rating: 4.7,
      reviewsCount: 12,
      completedJobsCount: 8,
      bio: 'Electrical repairs',
      experienceYears: 5,
      serviceRadiusKm: 20,
      verificationStatus: 'VERIFIED',
      availabilities: []
    }
  }];

  try {
    const req = { query: { lat: '12.3', lng: '77.1', radiusKm: '10' } };
    const res = createMockResponse();
    await userController.getWorkers(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.workers[0].distanceKm, 2.3);
    assert.deepEqual(res.payload.workers[0].mapLocation, { latitude: 12.35, longitude: 77.12 });
    assert.equal(Object.hasOwn(res.payload.workers[0], 'latitude'), false);
    assert.equal(Object.hasOwn(res.payload.workers[0], 'longitude'), false);
    assert.equal(res.payload.workers[0].availability, 'Available now');
  } finally {
    prisma.$queryRaw = originalQueryRaw;
    prisma.user.findMany = originalFindMany;
  }
});

test('nearby search rejects an invalid radius', async () => {
  const req = { query: { lat: '12.3', lng: '77.1', radiusKm: '500' } };
  const res = createMockResponse();

  await userController.getWorkers(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.payload.message, /radius/i);
});