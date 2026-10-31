const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/prisma');
const {
  activeTracking,
  verifyBookingTrackingAccess,
  bookingTrackingRoom,
  io
} = require('../server');
const {
  stopBookingTracking,
  stopWorkerTracking,
  broadcastBookingStatus,
  setSocketServer
} = require('../trackingState');
const bookingController = require('../controllers/bookingController');

// Helper to simulate an authenticated socket
function createMockSocket(user) {
  const events = {};
  const emitted = [];
  const joinedRooms = new Set();
  const leftRooms = new Set();

  const socket = {
    id: 'mock-socket-' + Math.random().toString(36).substring(7),
    user,
    data: {},
    on(event, handler) {
      events[event] = handler;
      return this;
    },
    emit(event, payload) {
      emitted.push({ event, payload });
      return this;
    },
    join(room) {
      joinedRooms.add(room);
      return this;
    },
    leave(room) {
      joinedRooms.delete(room);
      leftRooms.add(room);
      return this;
    },
    async trigger(event, payload) {
      if (events[event]) {
        await events[event](payload);
      }
    },
    getEmitted(eventName) {
      return emitted.filter((e) => !eventName || e.event === eventName);
    },
    joinedRooms,
    leftRooms,
    events
  };

  return socket;
}

// Helper for HTTP controller tests
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

test('Phase 5: Real-Time Worker Tracking & Service Lifecycle Suite', async (t) => {
  const roomBroadcasts = [];
  const originalIoTo = io.to;
  const connectionHandler = io.listeners('connection')[0];

  // Intercept io.to().emit() to inspect room broadcasts
  io.to = (room) => ({
    emit(event, payload) {
      roomBroadcasts.push({ room, event, payload });
      return true;
    }
  });

  t.after(() => {
    io.to = originalIoTo;
    activeTracking.clear();
  });

  const testBooking = {
    id: 'booking-p5-1',
    status: 'CONFIRMED',
    customerId: 'cust-123',
    workerId: 'work-456'
  };

  await t.test('1. Customer joins authorized tracking room (booking:join)', async () => {
    const originalFindUnique = prisma.booking.findUnique;
    const originalWorkerProfile = prisma.workerProfile.findUnique;

    prisma.booking.findUnique = async ({ where }) => {
      if (where.id === testBooking.id) return testBooking;
      return null;
    };

    prisma.workerProfile.findUnique = async () => ({
      locationSharing: {
        sharingEnabled: true,
        latitude: 12.9716,
        longitude: 77.5946,
        lastLocationUpdate: new Date()
      }
    });

    try {
      const customerSocket = createMockSocket({ id: 'cust-123', role: 'Customer' });
      connectionHandler(customerSocket);

      await customerSocket.trigger('booking:join', { bookingId: testBooking.id });

      assert.ok(customerSocket.joinedRooms.has(`booking:${testBooking.id}`));
      assert.equal(customerSocket.data.trackingRoom, `booking:${testBooking.id}`);

      const stateEmits = customerSocket.getEmitted('tracking:state');
      assert.equal(stateEmits.length, 1);
      assert.equal(stateEmits[0].payload.bookingId, testBooking.id);
      assert.equal(stateEmits[0].payload.workerId, testBooking.workerId);
      assert.ok(stateEmits[0].payload.lastLocation != null);
      assert.equal(stateEmits[0].payload.lastLocation.latitude, 12.9716);
    } finally {
      prisma.booking.findUnique = originalFindUnique;
      prisma.workerProfile.findUnique = originalWorkerProfile;
    }
  });

  await t.test('2. Worker joins authorized tracking room (booking:join)', async () => {
    const originalFindUnique = prisma.booking.findUnique;
    const originalWorkerProfile = prisma.workerProfile.findUnique;

    prisma.booking.findUnique = async () => testBooking;
    prisma.workerProfile.findUnique = async () => ({
      locationSharing: { sharingEnabled: true }
    });

    try {
      const workerSocket = createMockSocket({ id: 'work-456', role: 'Worker' });
      connectionHandler(workerSocket);

      await workerSocket.trigger('booking:join', { bookingId: testBooking.id });

      assert.ok(workerSocket.joinedRooms.has(`booking:${testBooking.id}`));
      assert.ok(activeTracking.has(testBooking.id));
      assert.equal(activeTracking.get(testBooking.id).workerId, 'work-456');

      const broadcastState = roomBroadcasts.find(
        (b) => b.room === `booking:${testBooking.id}` && b.event === 'tracking:state'
      );
      assert.ok(broadcastState);
      assert.equal(broadcastState.payload.active, true);
      assert.equal(broadcastState.payload.workerId, 'work-456');
    } finally {
      prisma.booking.findUnique = originalFindUnique;
      prisma.workerProfile.findUnique = originalWorkerProfile;
    }
  });

  await t.test('3. Unrelated customer rejected with tracking:error', async () => {
    const originalFindUnique = prisma.booking.findUnique;
    prisma.booking.findUnique = async () => testBooking;

    try {
      const unrelatedCustomerSocket = createMockSocket({ id: 'cust-unrelated-999', role: 'Customer' });
      connectionHandler(unrelatedCustomerSocket);

      await unrelatedCustomerSocket.trigger('booking:join', { bookingId: testBooking.id });

      assert.equal(unrelatedCustomerSocket.joinedRooms.has(`booking:${testBooking.id}`), false);
      const errors = unrelatedCustomerSocket.getEmitted('tracking:error');
      assert.equal(errors.length, 1);
      assert.match(errors[0].payload.message.toLowerCase(), /booking owner|authorized/i);
    } finally {
      prisma.booking.findUnique = originalFindUnique;
    }
  });

  await t.test('4. Unassigned worker rejected with tracking:error', async () => {
    const originalFindUnique = prisma.booking.findUnique;
    prisma.booking.findUnique = async () => testBooking;

    try {
      const unassignedWorkerSocket = createMockSocket({ id: 'work-unassigned-888', role: 'Worker' });
      connectionHandler(unassignedWorkerSocket);

      await unassignedWorkerSocket.trigger('booking:join', { bookingId: testBooking.id });

      assert.equal(unassignedWorkerSocket.joinedRooms.has(`booking:${testBooking.id}`), false);
      const errors = unassignedWorkerSocket.getEmitted('tracking:error');
      assert.equal(errors.length, 1);
      assert.match(errors[0].payload.message.toLowerCase(), /assigned worker|authorized/i);
    } finally {
      prisma.booking.findUnique = originalFindUnique;
    }
  });

  await t.test('5. Tracking rejected before worker accepts (REQUESTED status)', async () => {
    const originalFindUnique = prisma.booking.findUnique;
    prisma.booking.findUnique = async () => ({
      id: 'booking-requested-only',
      status: 'REQUESTED',
      customerId: 'cust-123',
      workerId: 'work-456'
    });

    try {
      const customerSocket = createMockSocket({ id: 'cust-123', role: 'Customer' });
      connectionHandler(customerSocket);

      await customerSocket.trigger('booking:join', { bookingId: 'booking-requested-only' });

      assert.equal(customerSocket.joinedRooms.has('booking:booking-requested-only'), false);
      const errors = customerSocket.getEmitted('tracking:error');
      assert.equal(errors.length, 1);
      assert.match(errors[0].payload.message.toLowerCase(), /accepted active|eligible/i);
    } finally {
      prisma.booking.findUnique = originalFindUnique;
    }
  });

  await t.test('6. Valid GPS coordinate updates broadcast worker:location:changed & tracking:location', async () => {
    const originalFindUnique = prisma.booking.findUnique;
    const originalWorkerProfile = prisma.workerProfile.findUnique;
    const originalUpdateMany = prisma.workerLocation.updateMany;

    prisma.booking.findUnique = async () => testBooking;
    prisma.workerProfile.findUnique = async () => ({
      id: 'profile-456',
      locationSharing: { sharingEnabled: true }
    });
    prisma.workerLocation.updateMany = async () => ({ count: 1 });

    try {
      const workerSocket = createMockSocket({ id: 'work-456', role: 'Worker' });
      connectionHandler(workerSocket);

      roomBroadcasts.length = 0; // reset captured broadcasts

      await workerSocket.trigger('worker:location:update', {
        bookingId: testBooking.id,
        latitude: 12.9725,
        longitude: 77.5955,
        accuracy: 12.5,
        timestamp: new Date().toISOString()
      });

      const changedEvent = roomBroadcasts.find(
        (b) => b.room === `booking:${testBooking.id}` && b.event === 'worker:location:changed'
      );
      assert.ok(changedEvent, 'Expected worker:location:changed event to be broadcast to room');
      assert.equal(changedEvent.payload.bookingId, testBooking.id);
      assert.equal(changedEvent.payload.workerId, 'work-456');
      assert.equal(changedEvent.payload.location.latitude, 12.9725);
      assert.equal(changedEvent.payload.location.longitude, 77.5955);
      assert.equal(changedEvent.payload.location.accuracy, 12.5);

      const compatEvent = roomBroadcasts.find(
        (b) => b.room === `booking:${testBooking.id}` && b.event === 'tracking:location'
      );
      assert.ok(compatEvent, 'Expected backwards-compatible tracking:location event');
      assert.equal(compatEvent.payload.location.latitude, 12.9725);
    } finally {
      prisma.booking.findUnique = originalFindUnique;
      prisma.workerProfile.findUnique = originalWorkerProfile;
      prisma.workerLocation.updateMany = originalUpdateMany;
    }
  });

  await t.test('7. Invalid GPS coordinates rejected (out-of-range or non-numeric)', async () => {
    const originalFindUnique = prisma.booking.findUnique;
    const originalWorkerProfile = prisma.workerProfile.findUnique;

    prisma.booking.findUnique = async () => testBooking;
    prisma.workerProfile.findUnique = async () => ({
      locationSharing: { sharingEnabled: true }
    });

    try {
      const workerSocket = createMockSocket({ id: 'work-456', role: 'Worker' });
      connectionHandler(workerSocket);

      await workerSocket.trigger('worker:location:update', {
        bookingId: testBooking.id,
        latitude: 150.0, // invalid: max 90
        longitude: 77.5955
      });

      const errors = workerSocket.getEmitted('tracking:error');
      assert.equal(errors.length, 1);
      assert.match(errors[0].payload.message.toLowerCase(), /valid latitude and longitude/i);

      await workerSocket.trigger('worker:location:update', {
        bookingId: testBooking.id,
        latitude: 'invalid-coord',
        longitude: 77.5955
      });
      assert.equal(workerSocket.getEmitted('tracking:error').length, 2);
    } finally {
      prisma.booking.findUnique = originalFindUnique;
      prisma.workerProfile.findUnique = originalWorkerProfile;
    }
  });

  await t.test('8. Spoofed worker ID update rejected', async () => {
    const originalFindUnique = prisma.booking.findUnique;
    prisma.booking.findUnique = async () => testBooking;

    try {
      // Imposter worker trying to update location for another worker's booking
      const imposterSocket = createMockSocket({ id: 'work-imposter-777', role: 'Worker' });
      connectionHandler(imposterSocket);

      await imposterSocket.trigger('worker:location:update', {
        bookingId: testBooking.id,
        latitude: 12.9725,
        longitude: 77.5955
      });

      const errors = imposterSocket.getEmitted('tracking:error');
      assert.equal(errors.length, 1);
      assert.match(errors[0].payload.message.toLowerCase(), /assigned worker|spoofed/i);
    } finally {
      prisma.booking.findUnique = originalFindUnique;
    }
  });

  await t.test('9. Worker service lifecycle: CONFIRMED -> DISPATCHED -> IN_PROGRESS -> COMPLETED', async () => {
    const originalFindUnique = prisma.booking.findUnique;
    const originalTransaction = prisma.$transaction;
    const originalNotificationCreate = prisma.notification.create;

    let currentStatus = 'CONFIRMED';
    const mockDbBooking = {
      id: testBooking.id,
      status: currentStatus,
      customerId: 'cust-123',
      workerId: 'work-456',
      customer: { id: 'cust-123', name: 'Alice Customer', email: 'alice@example.com' },
      worker: { id: 'work-456', name: 'Bob Worker', email: 'bob@example.com' }
    };

    prisma.booking.findUnique = async () => ({ ...mockDbBooking, status: currentStatus });
    prisma.notification.create = async () => ({ id: 'notif-1' });
    prisma.$transaction = async (callback) => {
      mockDbBooking.status = currentStatus;
      return mockDbBooking;
    };

    try {
      roomBroadcasts.length = 0;

      // 1. Worker marks as DISPATCHED (On The Way)
      const reqDispatch = {
        params: { id: testBooking.id },
        user: { id: 'work-456', role: 'Worker' },
        body: { status: 'DISPATCHED', notes: 'Departed base' }
      };
      const resDispatch = createMockResponse();

      await bookingController.updateBookingStatus(reqDispatch, resDispatch);
      assert.equal(resDispatch.statusCode, 200);
      assert.equal(resDispatch.payload.success, true);
      currentStatus = 'DISPATCHED';

      const dispatchedBroadcast = roomBroadcasts.find(
        (b) => b.room === `booking:${testBooking.id}` && b.event === 'booking:status:changed' && b.payload.status === 'DISPATCHED'
      );
      assert.ok(dispatchedBroadcast, 'Expected booking:status:changed with DISPATCHED');

      // 2. Worker marks as IN_PROGRESS (Started service)
      const reqStart = {
        params: { id: testBooking.id },
        user: { id: 'work-456', role: 'Worker' },
        body: { status: 'IN_PROGRESS' }
      };
      const resStart = createMockResponse();

      await bookingController.updateBookingStatus(reqStart, resStart);
      assert.equal(resStart.statusCode, 200);
      currentStatus = 'IN_PROGRESS';

      const inProgressBroadcast = roomBroadcasts.find(
        (b) => b.room === `booking:${testBooking.id}` && b.event === 'booking:status:changed' && b.payload.status === 'IN_PROGRESS'
      );
      assert.ok(inProgressBroadcast, 'Expected booking:status:changed with IN_PROGRESS');

      // 3. Worker marks as COMPLETED
      const reqComplete = {
        params: { id: testBooking.id },
        user: { id: 'work-456', role: 'Worker' },
        body: { status: 'COMPLETED' }
      };
      const resComplete = createMockResponse();

      await bookingController.updateBookingStatus(reqComplete, resComplete);
      assert.equal(resComplete.statusCode, 200);
      currentStatus = 'COMPLETED';

      const completedBroadcast = roomBroadcasts.find(
        (b) => b.room === `booking:${testBooking.id}` && b.event === 'booking:status:changed' && b.payload.status === 'COMPLETED'
      );
      assert.ok(completedBroadcast, 'Expected booking:status:changed with COMPLETED');

      const stoppedBroadcast = roomBroadcasts.find(
        (b) => b.room === `booking:${testBooking.id}` && b.event === 'tracking:stopped'
      );
      assert.ok(stoppedBroadcast, 'Expected tracking:stopped to be broadcast on completion');
    } finally {
      prisma.booking.findUnique = originalFindUnique;
      prisma.$transaction = originalTransaction;
      prisma.notification.create = originalNotificationCreate;
    }
  });

  await t.test('10. Worker disconnect terminates live location sharing', async () => {
    activeTracking.set(testBooking.id, {
      bookingId: testBooking.id,
      workerId: 'work-456',
      customerId: 'cust-123',
      startedAt: new Date().toISOString()
    });

    try {
      const workerSocket = createMockSocket({ id: 'work-456', role: 'Worker' });
      workerSocket.data.trackingRoom = `booking:${testBooking.id}`;
      connectionHandler(workerSocket);

      roomBroadcasts.length = 0;

      await workerSocket.trigger('disconnect');

      assert.equal(activeTracking.has(testBooking.id), false, 'Active tracking session must be cleaned up');
      const disconnectBroadcast = roomBroadcasts.find(
        (b) => b.room === `booking:${testBooking.id}` && b.event === 'tracking:stopped'
      );
      assert.ok(disconnectBroadcast, 'Expected tracking:stopped broadcast on worker disconnect');
      assert.match(disconnectBroadcast.payload.message.toLowerCase(), /disconnected/i);
    } finally {
      activeTracking.clear();
    }
  });
});
