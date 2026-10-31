const test = require('node:test');
const assert = require('node:assert/strict');

const escrowController = require('../controllers/escrowController');
const notificationController = require('../controllers/notificationController');

test('payment provider status must be disabled when no supported payment gateway is configured', () => {
  const status = escrowController.getEscrowProviderStatus();

  assert.equal(status.enabled, false);
  assert.match(status.message, /No supported payment provider/i);
  assert.equal(status.provider, 'UNAVAILABLE');
});

test('booking notification payloads must include user, type, title, and message metadata', () => {
  const payload = notificationController.buildNotificationPayload({
    userId: 'user-1',
    type: 'BOOKING_REQUEST',
    title: 'Booking request received',
    message: 'A customer requested a booking for your service.'
  });

  assert.equal(payload.userId, 'user-1');
  assert.equal(payload.type, 'BOOKING_REQUEST');
  assert.equal(payload.title, 'Booking request received');
  assert.match(payload.message, /customer requested a booking/i);
});
