const test = require('node:test');
const assert = require('node:assert/strict');
const bookingController = require('../controllers/bookingController');
const prisma = require('../config/prisma');

function createMockResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    }
  };
}

test('createBooking accepts a valid request from the authenticated customer only', async () => {
  const originalUserFindUnique = prisma.user.findUnique;
  const originalServiceFindUnique = prisma.serviceItem.findUnique;
  const originalBookingFindFirst = prisma.booking.findFirst;
  const originalTransaction = prisma.$transaction;

  prisma.user.findUnique = async ({ where }) => {
    if (where.id === 'worker-1') {
      return { id: 'worker-1', role: 'WORKER', name: 'Worker One' };
    }
    return null;
  };
  prisma.serviceItem.findUnique = async () => ({
    id: 'service-1',
    offeredBy: [{ workerProfile: { userId: 'worker-1' } }]
  });
  prisma.booking.findFirst = async () => null;
  prisma.$transaction = async (callback) => callback({
    booking: {
      create: async ({ data }) => ({
        id: 'booking-1',
        ...data,
        customer: { id: 'customer-1', name: 'Alice Customer', email: 'alice@example.com' },
        worker: { id: 'worker-1', name: 'Worker One', email: 'worker@example.com' }
      })
    }
  });

  try {
    const req = {
      user: { id: 'customer-1', role: 'Customer' },
      body: {
        customerId: 'spoofed-customer',
        workerId: 'worker-1',
        serviceItemId: 'service-1',
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        agreedPrice: '420.00',
        notes: 'Please help with installation.'
      }
    };
    const res = createMockResponse();

    await bookingController.createBooking(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.booking.customerId, 'customer-1');
    assert.equal(res.payload.booking.workerId, 'worker-1');
    assert.equal(res.payload.booking.agreedPrice, 420);
  } finally {
    prisma.user.findUnique = originalUserFindUnique;
    prisma.serviceItem.findUnique = originalServiceFindUnique;
    prisma.booking.findFirst = originalBookingFindFirst;
    prisma.$transaction = originalTransaction;
  }
});

test('createBooking rejects invalid workers, invalid pricing, and unavailable services', async () => {
  const originalUserFindUnique = prisma.user.findUnique;
  const originalServiceFindUnique = prisma.serviceItem.findUnique;
  const originalBookingFindFirst = prisma.booking.findFirst;
  prisma.user.findUnique = async () => null;
  prisma.serviceItem.findUnique = async () => null;
  prisma.booking.findFirst = async () => null;

  try {
    const invalidWorkerReq = {
      user: { id: 'customer-1', role: 'Customer' },
      body: { workerId: 'missing-worker', scheduledAt: new Date(Date.now() + 60 * 1000).toISOString(), agreedPrice: '250' }
    };
    const invalidWorkerRes = createMockResponse();
    await bookingController.createBooking(invalidWorkerReq, invalidWorkerRes);
    assert.equal(invalidWorkerRes.statusCode, 404);

    prisma.user.findUnique = async () => ({ id: 'worker-1', role: 'WORKER', name: 'Worker One' });
    prisma.serviceItem.findUnique = async () => ({
      id: 'service-2',
      offeredBy: [{ workerProfile: { userId: 'other-worker' } }]
    });

    const invalidServiceReq = {
      user: { id: 'customer-1', role: 'Customer' },
      body: { workerId: 'worker-1', serviceItemId: 'service-2', scheduledAt: new Date(Date.now() + 60 * 1000).toISOString(), agreedPrice: '250' }
    };
    const invalidServiceRes = createMockResponse();
    await bookingController.createBooking(invalidServiceReq, invalidServiceRes);
    assert.equal(invalidServiceRes.statusCode, 400);

    const invalidPriceReq = {
      user: { id: 'customer-1', role: 'Customer' },
      body: { workerId: 'worker-1', scheduledAt: new Date(Date.now() + 60 * 1000).toISOString(), agreedPrice: '-30' }
    };
    const invalidPriceRes = createMockResponse();
    await bookingController.createBooking(invalidPriceReq, invalidPriceRes);
    assert.equal(invalidPriceRes.statusCode, 400);
  } finally {
    prisma.user.findUnique = originalUserFindUnique;
    prisma.serviceItem.findUnique = originalServiceFindUnique;
    prisma.booking.findFirst = originalBookingFindFirst;
  }
});

test('updateBookingStatus rejects unauthorized customer actions and invalid transitions', async () => {
  const originalBookingFindUnique = prisma.booking.findUnique;
  prisma.booking.findUnique = async () => ({
    id: 'booking-2',
    customerId: 'customer-1',
    workerId: 'worker-1',
    status: 'IN_PROGRESS'
  });

  try {
    const req = {
      user: { id: 'customer-2', role: 'Customer' },
      params: { id: 'booking-2' },
      body: { status: 'COMPLETED', notes: 'I am trying to close it' }
    };
    const res = createMockResponse();

    await bookingController.updateBookingStatus(req, res);

    assert.equal(res.statusCode, 403);
    assert.match(String(res.payload.message), /owner|authorized/i);

    const invalidTransitionReq = {
      user: { id: 'worker-1', role: 'Worker' },
      params: { id: 'booking-2' },
      body: { status: 'AWAITING_CUSTOMER_CONFIRMATION', notes: 'not allowed' }
    };
    const invalidTransitionRes = createMockResponse();
    await bookingController.updateBookingStatus(invalidTransitionReq, invalidTransitionRes);
    assert.equal(invalidTransitionRes.statusCode, 400);
  } finally {
    prisma.booking.findUnique = originalBookingFindUnique;
  }
});
