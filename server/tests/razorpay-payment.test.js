const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const prisma = require('../config/prisma');
const razorpayController = require('../controllers/razorpayController');
const {
  verifyPaymentSignature,
  verifyWebhookSignature,
  safeCompare
} = require('../config/razorpay');

function createMockResponse() {
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
  return res;
}

// Helper to compute valid test payment HMAC SHA256 signature
function generateValidPaymentSignature(orderId, paymentId, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

// Helper to compute valid test webhook HMAC SHA256 signature
function generateValidWebhookSignature(rawBody, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
}

test('Razorpay 1: Eligible customer can create a payment order with correct paise calculation', async () => {
  const origBookingFindUnique = prisma.booking.findUnique;
  const origEscrowUpsert = prisma.escrowPayment.upsert;

  const mockBooking = {
    id: 'booking-test-1',
    bookingNumber: 'LH-BK-1001',
    customerId: 'cust-1',
    workerId: 'worker-1',
    status: 'COMPLETED',
    agreedPrice: '850.00',
    customer: { id: 'cust-1', name: 'Alice Customer', email: 'alice@example.com', phone: '9876543210' },
    worker: { id: 'worker-1', name: 'Bob Worker', email: 'bob@example.com', phone: '9123456780' },
    serviceItem: { id: 'srv-1', title: 'Plumbing Repair' },
    payment: null
  };

  try {
    prisma.booking.findUnique = async () => mockBooking;
    prisma.escrowPayment.upsert = async ({ create }) => ({
      id: 'escrow-1',
      ...create
    });

    const req = {
      user: { id: 'cust-1', role: 'Customer' },
      body: { bookingId: 'booking-test-1' }
    };
    const res = createMockResponse();

    await razorpayController.createPaymentOrder(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.success, true);
    assert.ok(res.payload.orderId);
    assert.equal(res.payload.currency, 'INR');
    // ₹850 in paise must be 85000
    assert.equal(res.payload.amount, 85000);
    assert.equal(res.payload.amountInRupees, 850);
    assert.equal(res.payload.booking.workerName, 'Bob Worker');
  } finally {
    prisma.booking.findUnique = origBookingFindUnique;
    prisma.escrowPayment.upsert = origEscrowUpsert;
  }
});

test('Razorpay 2: Unrelated customer cannot pay for another customer\'s booking', async () => {
  const origBookingFindUnique = prisma.booking.findUnique;

  try {
    prisma.booking.findUnique = async () => ({
      id: 'booking-test-2',
      customerId: 'cust-legit',
      workerId: 'worker-1',
      status: 'COMPLETED',
      agreedPrice: 500,
      customer: { id: 'cust-legit', name: 'Legit Customer' },
      worker: { id: 'worker-1', name: 'Bob' },
      payment: null
    });

    // An attacker/different customer tries to create order
    const reqCreate = {
      user: { id: 'cust-attacker', role: 'Customer' },
      body: { bookingId: 'booking-test-2' }
    };
    const resCreate = createMockResponse();

    await razorpayController.createPaymentOrder(reqCreate, resCreate);
    assert.equal(resCreate.statusCode, 403);
    assert.match(resCreate.payload.message, /Only the customer who created this booking/i);

    // An attacker tries to verify payment
    const reqVerify = {
      user: { id: 'cust-attacker', role: 'Customer' },
      body: {
        bookingId: 'booking-test-2',
        razorpay_order_id: 'order_123',
        razorpay_payment_id: 'pay_123',
        razorpay_signature: 'sig_123'
      }
    };
    const resVerify = createMockResponse();

    await razorpayController.verifyPayment(reqVerify, resVerify);
    assert.equal(resVerify.statusCode, 403);
    assert.match(resVerify.payload.message, /Not authorized/i);
  } finally {
    prisma.booking.findUnique = origBookingFindUnique;
  }
});

test('Razorpay 3: Incomplete service cannot be paid for', async () => {
  const origBookingFindUnique = prisma.booking.findUnique;

  const incompleteStatuses = ['REQUESTED', 'CONFIRMED', 'DISPATCHED', 'IN_PROGRESS'];

  try {
    for (const st of incompleteStatuses) {
      prisma.booking.findUnique = async () => ({
        id: 'booking-test-3',
        customerId: 'cust-1',
        workerId: 'worker-1',
        status: st,
        agreedPrice: 600,
        customer: { id: 'cust-1' },
        worker: { id: 'worker-1' },
        payment: null
      });

      const req = {
        user: { id: 'cust-1', role: 'Customer' },
        body: { bookingId: 'booking-test-3' }
      };
      const res = createMockResponse();

      await razorpayController.createPaymentOrder(req, res);
      assert.equal(res.statusCode, 400, `Status ${st} must be rejected`);
      assert.match(res.payload.message, /only permitted after the worker has completed the service/i);
    }
  } finally {
    prisma.booking.findUnique = origBookingFindUnique;
  }
});

test('Razorpay 4: Duplicate payment orders are prevented when already paid', async () => {
  const origBookingFindUnique = prisma.booking.findUnique;

  try {
    prisma.booking.findUnique = async () => ({
      id: 'booking-test-4',
      customerId: 'cust-1',
      workerId: 'worker-1',
      status: 'COMPLETED',
      agreedPrice: 700,
      customer: { id: 'cust-1' },
      worker: { id: 'worker-1' },
      payment: {
        id: 'escrow-paid',
        status: 'RELEASED_TO_WORKER',
        totalAmount: 700
      }
    });

    const req = {
      user: { id: 'cust-1', role: 'Customer' },
      body: { bookingId: 'booking-test-4' }
    };
    const res = createMockResponse();

    await razorpayController.createPaymentOrder(req, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.payload.message, /already been successfully completed/i);
  } finally {
    prisma.booking.findUnique = origBookingFindUnique;
  }
});

test('Razorpay 5: Valid HMAC SHA256 payment signatures are accepted and complete booking', async () => {
  const prevKey = process.env.RAZORPAY_KEY_ID;
  const prevSec = process.env.RAZORPAY_KEY_SECRET;

  process.env.RAZORPAY_KEY_ID = 'rzp_test_validKey';
  process.env.RAZORPAY_KEY_SECRET = 'superSecretKey123';

  const origBookingFindUnique = prisma.booking.findUnique;
  const origTransaction = prisma.$transaction;
  const origNotificationCreate = prisma.notification.create;

  const testOrderId = 'order_valid_789';
  const testPaymentId = 'pay_valid_456';
  const validSignature = generateValidPaymentSignature(testOrderId, testPaymentId, 'superSecretKey123');

  let updatedStatus = null;
  let updatedPaymentStatus = null;

  try {
    prisma.notification.create = async ({ data }) => ({ id: 'notif-1', ...data });
    prisma.booking.findUnique = async () => ({
      id: 'booking-test-5',
      customerId: 'cust-1',
      workerId: 'worker-1',
      status: 'COMPLETED',
      agreedPrice: 1200,
      customer: { id: 'cust-1', name: 'Alice' },
      worker: { id: 'worker-1', name: 'Bob' },
      payment: {
        id: 'escrow-pending',
        status: 'PENDING',
        totalAmount: 1200
      }
    });

    prisma.$transaction = async (fn) => {
      const mockTx = {
        escrowPayment: {
          upsert: async ({ update }) => {
            updatedPaymentStatus = update.status;
            return {
              id: 'escrow-pending',
              status: update.status,
              totalAmount: 1200,
              gatewayOrderId: testOrderId,
              gatewayPaymentId: testPaymentId
            };
          }
        },
        booking: {
          update: async ({ data }) => {
            updatedStatus = data.status;
            return {
              id: 'booking-test-5',
              status: data.status,
              customer: { id: 'cust-1', name: 'Alice' },
              worker: { id: 'worker-1', name: 'Bob' }
            };
          }
        }
      };
      return fn(mockTx);
    };

    const req = {
      user: { id: 'cust-1', role: 'Customer' },
      body: {
        bookingId: 'booking-test-5',
        razorpay_order_id: testOrderId,
        razorpay_payment_id: testPaymentId,
        razorpay_signature: validSignature
      }
    };
    const res = createMockResponse();

    await razorpayController.verifyPayment(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(updatedStatus, 'COMPLETED');
    assert.equal(updatedPaymentStatus, 'RELEASED_TO_WORKER');
  } finally {
    prisma.booking.findUnique = origBookingFindUnique;
    prisma.$transaction = origTransaction;
    prisma.notification.create = origNotificationCreate;
    if (prevKey !== undefined) process.env.RAZORPAY_KEY_ID = prevKey;
    else delete process.env.RAZORPAY_KEY_ID;
    if (prevSec !== undefined) process.env.RAZORPAY_KEY_SECRET = prevSec;
    else delete process.env.RAZORPAY_KEY_SECRET;
  }
});

test('Razorpay 6: Invalid HMAC SHA256 payment signatures are rejected with 400', async () => {
  const prevKey = process.env.RAZORPAY_KEY_ID;
  const prevSec = process.env.RAZORPAY_KEY_SECRET;

  process.env.RAZORPAY_KEY_ID = 'rzp_test_validKey';
  process.env.RAZORPAY_KEY_SECRET = 'superSecretKey123';

  const origBookingFindUnique = prisma.booking.findUnique;

  try {
    prisma.booking.findUnique = async () => ({
      id: 'booking-test-6',
      customerId: 'cust-1',
      workerId: 'worker-1',
      status: 'COMPLETED',
      agreedPrice: 500,
      customer: { id: 'cust-1' },
      worker: { id: 'worker-1' },
      payment: { id: 'escrow-6', status: 'PENDING' }
    });

    const req = {
      user: { id: 'cust-1', role: 'Customer' },
      body: {
        bookingId: 'booking-test-6',
        razorpay_order_id: 'order_test_6',
        razorpay_payment_id: 'pay_test_6',
        razorpay_signature: 'tampered_forged_signature_hex_value'
      }
    };
    const res = createMockResponse();

    await razorpayController.verifyPayment(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.success, false);
    assert.match(res.payload.message, /invalid signature/i);
  } finally {
    prisma.booking.findUnique = origBookingFindUnique;
    if (prevKey !== undefined) process.env.RAZORPAY_KEY_ID = prevKey;
    else delete process.env.RAZORPAY_KEY_ID;
    if (prevSec !== undefined) process.env.RAZORPAY_KEY_SECRET = prevSec;
    else delete process.env.RAZORPAY_KEY_SECRET;
  }
});

test('Razorpay 7: Duplicate payment callbacks are handled safely and idempotently', async () => {
  const origBookingFindUnique = prisma.booking.findUnique;

  try {
    // Payment is already RELEASED_TO_WORKER
    prisma.booking.findUnique = async () => ({
      id: 'booking-test-7',
      customerId: 'cust-1',
      workerId: 'worker-1',
      status: 'COMPLETED',
      customer: { id: 'cust-1' },
      worker: { id: 'worker-1' },
      payment: {
        id: 'escrow-7',
        status: 'RELEASED_TO_WORKER',
        gatewayOrderId: 'order_already_processed',
        gatewayPaymentId: 'pay_already_processed'
      }
    });

    const req = {
      user: { id: 'cust-1', role: 'Customer' },
      body: {
        bookingId: 'booking-test-7',
        razorpay_order_id: 'order_already_processed',
        razorpay_payment_id: 'pay_already_processed',
        razorpay_signature: 'any_sig'
      }
    };
    const res = createMockResponse();

    await razorpayController.verifyPayment(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.alreadyProcessed, true);
    assert.match(res.payload.message, /already been confirmed/i);
  } finally {
    prisma.booking.findUnique = origBookingFindUnique;
  }
});

test('Razorpay 8: Webhook payment.failed records failure and never overwrites successful payments', async () => {
  const prevHookSec = process.env.RAZORPAY_WEBHOOK_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test_secret_123';

  const origEscrowFindFirst = prisma.escrowPayment.findFirst;
  const origEscrowUpdate = prisma.escrowPayment.update;

  let recordedStatus = null;
  let recordedReason = null;

  try {
    prisma.escrowPayment.findFirst = async ({ where }) => ({
      id: 'escrow-fail-1',
      gatewayOrderId: where.gatewayOrderId,
      status: 'PENDING'
    });

    prisma.escrowPayment.update = async ({ data }) => {
      recordedStatus = data.status;
      recordedReason = data.refundReason;
      return { id: 'escrow-fail-1', ...data };
    };

    const webhookBody = {
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_failed_123',
            order_id: 'order_fail_test',
            error_description: 'Card declined by issuing bank'
          }
        }
      }
    };

    const rawBody = JSON.stringify(webhookBody);
    const validSignature = generateValidWebhookSignature(rawBody, 'whsec_test_secret_123');

    const req = {
      headers: { 'x-razorpay-signature': validSignature },
      rawBody: Buffer.from(rawBody, 'utf-8'),
      body: webhookBody
    };
    const res = createMockResponse();

    await razorpayController.handleWebhook(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(recordedStatus, 'FAILED');
    assert.equal(recordedReason, 'Card declined by issuing bank');

    // Case B: Ensure webhook does NOT overwrite already RELEASED_TO_WORKER payment
    let updateCalledOnReleased = false;
    prisma.escrowPayment.findFirst = async () => ({
      id: 'escrow-released-1',
      status: 'RELEASED_TO_WORKER'
    });
    prisma.escrowPayment.update = async () => {
      updateCalledOnReleased = true;
    };

    const res2 = createMockResponse();
    await razorpayController.handleWebhook(req, res2);

    assert.equal(res2.statusCode, 200);
    assert.equal(updateCalledOnReleased, false, 'Failed webhook must never downgrade a successful payment');
  } finally {
    prisma.escrowPayment.findFirst = origEscrowFindFirst;
    prisma.escrowPayment.update = origEscrowUpdate;
    if (prevHookSec !== undefined) process.env.RAZORPAY_WEBHOOK_SECRET = prevHookSec;
    else delete process.env.RAZORPAY_WEBHOOK_SECRET;
  }
});

test('Razorpay 9: Webhook payment.captured updates booking and payment record with valid signature', async () => {
  const prevHookSec = process.env.RAZORPAY_WEBHOOK_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test_capture_789';

  const origEscrowFindFirst = prisma.escrowPayment.findFirst;
  const origTransaction = prisma.$transaction;

  let capturedPaymentStatus = null;
  let capturedBookingStatus = null;

  try {
    prisma.escrowPayment.findFirst = async () => ({
      id: 'escrow-cap-1',
      bookingId: 'booking-cap-1',
      status: 'PENDING',
      booking: { id: 'booking-cap-1', status: 'IN_PROGRESS' }
    });

    prisma.$transaction = async (fn) => {
      const mockTx = {
        escrowPayment: {
          update: async ({ data }) => {
            capturedPaymentStatus = data.status;
            return { id: 'escrow-cap-1', status: data.status };
          }
        },
        booking: {
          update: async ({ data }) => {
            capturedBookingStatus = data.status;
            return { id: 'booking-cap-1', status: data.status };
          }
        }
      };
      return fn(mockTx);
    };

    const webhookBody = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_captured_777',
            order_id: 'order_cap_777',
            notes: { bookingId: 'booking-cap-1' }
          }
        }
      }
    };

    const rawBody = JSON.stringify(webhookBody);
    const validSignature = generateValidWebhookSignature(rawBody, 'whsec_test_capture_789');

    const req = {
      headers: { 'x-razorpay-signature': validSignature },
      rawBody: Buffer.from(rawBody, 'utf-8'),
      body: webhookBody
    };
    const res = createMockResponse();

    await razorpayController.handleWebhook(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(capturedPaymentStatus, 'RELEASED_TO_WORKER');
    assert.equal(capturedBookingStatus, 'COMPLETED');
  } finally {
    prisma.escrowPayment.findFirst = origEscrowFindFirst;
    prisma.$transaction = origTransaction;
    if (prevHookSec !== undefined) process.env.RAZORPAY_WEBHOOK_SECRET = prevHookSec;
    else delete process.env.RAZORPAY_WEBHOOK_SECRET;
  }
});

test('Razorpay 10: safeCompare and HMAC signature helpers prevent timing attacks and handle edge cases', () => {
  // Test constant time safeCompare
  assert.equal(safeCompare('abcdef', 'abcdef'), true);
  assert.equal(safeCompare('abcdef', 'abcdeg'), false);
  assert.equal(safeCompare('abc', 'abcdef'), false);
  assert.equal(safeCompare(null, 'abc'), false);
  assert.equal(safeCompare('', ''), true);

  // Test signature verification helper
  const secret = 'myTestSecretKey123';
  const orderId = 'order_999';
  const paymentId = 'pay_999';
  const validSig = generateValidPaymentSignature(orderId, paymentId, secret);

  const prevSec = process.env.RAZORPAY_KEY_SECRET;
  try {
    process.env.RAZORPAY_KEY_SECRET = secret;
    assert.equal(verifyPaymentSignature({ orderId, paymentId, signature: validSig }), true);
    assert.equal(verifyPaymentSignature({ orderId, paymentId, signature: 'wrong_sig' }), false);
    assert.equal(verifyPaymentSignature({ orderId: null, paymentId, signature: validSig }), false);
  } finally {
    if (prevSec !== undefined) process.env.RAZORPAY_KEY_SECRET = prevSec;
    else delete process.env.RAZORPAY_KEY_SECRET;
  }
});
