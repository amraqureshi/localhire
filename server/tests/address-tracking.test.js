const test = require('node:test');
const assert = require('node:assert/strict');

const addressController = require('../controllers/addressController');
const { verifyBookingTrackingAccess } = require('../server');

function createMockResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.payload = data;
      return this;
    },
    send(data) {
      this.payload = data;
      return this;
    }
  };
}

test('customer addresses reject invalid geocoordinates', async () => {
  const req = {
    user: { id: 'customer-1', role: 'Customer' },
    body: {
      label: 'Home',
      street: '3 Main Street',
      city: 'Bengaluru',
      postalCode: '560001',
      latitude: 100,
      longitude: 20
    }
  };

  const res = createMockResponse();

  await addressController.createAddress(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.success, false);
  assert.match(String(res.payload.message).toLowerCase(), /latitude|longitude|valid/i);
});

test('tracking check rejects unauthorized booking access', async () => {
  const result = await verifyBookingTrackingAccess({
    bookingId: 'booking-999',
    userId: 'customer-2',
    role: 'Customer'
  });

  assert.equal(result.authorized, false);
  assert.match(String(result.reason).toLowerCase(), /not found|not authorized|booking/i);
});

test('tracking check allows the matching customer and assigned worker', async () => {
  const prisma = require('../config/prisma');
  const originalFindUnique = prisma.booking.findUnique;

  prisma.booking.findUnique = async () => ({
    id: 'booking-123',
    status: 'CONFIRMED',
    customerId: 'customer-1',
    workerId: 'worker-1'
  });

  try {
    const allowedCustomer = await verifyBookingTrackingAccess({
      bookingId: 'booking-123',
      userId: 'customer-1',
      role: 'Customer'
    });

    const allowedWorker = await verifyBookingTrackingAccess({
      bookingId: 'booking-123',
      userId: 'worker-1',
      role: 'Worker'
    });

    assert.equal(allowedCustomer.authorized, true);
    assert.equal(allowedWorker.authorized, true);
  } finally {
    prisma.booking.findUnique = originalFindUnique;
  }
});

test('tracking check rejects bookings before worker acceptance', async () => {
  const prisma = require('../config/prisma');
  const originalFindUnique = prisma.booking.findUnique;
  prisma.booking.findUnique = async () => ({
    id: 'booking-requested',
    status: 'REQUESTED',
    customerId: 'customer-1',
    workerId: 'worker-1'
  });

  try {
    const result = await verifyBookingTrackingAccess({
      bookingId: 'booking-requested',
      userId: 'customer-1',
      role: 'Customer'
    });
    assert.equal(result.authorized, false);
    assert.match(result.reason, /accepted active bookings/i);
  } finally {
    prisma.booking.findUnique = originalFindUnique;
  }
});
