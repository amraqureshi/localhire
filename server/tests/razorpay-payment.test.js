const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const prisma = require('../config/prisma');
const razorpayController = require('../controllers/razorpayController');
const escrowController = require('../controllers/escrowController');
const {
  verifyPaymentSignature,
  verifyWebhookSignature,
  safeCompare,
  setRazorpayInstance
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
    status: 'CONFIRMED',
    agreedPrice: '850.00',
    customer: { id: 'cust-1', name: 'Alice Customer', email: 'alice@example.com', phone: '9876543210' },
    worker: { id: 'worker-1', name: 'Bob Worker', email: 'bob@example.com', phone: '9123456780' },
    serviceItem: { id: 'srv-1', title: 'Plumbing Repair' },
    payment: null
  };

  try {
    setRazorpayInstance({
      orders: {
        create: async ({ amount, currency, receipt }) => ({
          id: 'order_test_rzp_mock',
          amount,
          currency,
          receipt,
          status: 'created'
        })
      }
    });

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
    setRazorpayInstance(null);
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
      status: 'CONFIRMED',
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
    setRazorpayInstance(null);
    prisma.booking.findUnique = origBookingFindUnique;
  }
});

test('Razorpay 3: Cancelled or disputed bookings cannot have payment orders created', async () => {
  const origBookingFindUnique = prisma.booking.findUnique;
  const ineligibleStatuses = ['CANCELLED', 'DISPUTED'];

  try {
    for (const st of ineligibleStatuses) {
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
      assert.match(res.payload.message, /Cannot initiate payment for a booking with status/i);
    }
  } finally {
    setRazorpayInstance(null);
    prisma.booking.findUnique = origBookingFindUnique;
  }
});

test('Razorpay 4: Duplicate payment orders are prevented when already funded or completed', async () => {
  const origBookingFindUnique = prisma.booking.findUnique;

  try {
    prisma.booking.findUnique = async () => ({
      id: 'booking-test-4',
      customerId: 'cust-1',
      workerId: 'worker-1',
      status: 'CONFIRMED',
      agreedPrice: 700,
      customer: { id: 'cust-1' },
      worker: { id: 'worker-1' },
      payment: {
        id: 'escrow-held',
        status: 'HELD_IN_ESCROW',
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
    assert.match(res.payload.message, /already been held in escrow/i);
  } finally {
    setRazorpayInstance(null);
    prisma.booking.findUnique = origBookingFindUnique;
  }
});

test('Razorpay 5: Valid HMAC SHA256 payment signatures are accepted and hold payment in escrow', async () => {
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
      status: 'REQUESTED',
      agreedPrice: 1200,
      customer: { id: 'cust-1', name: 'Alice' },
      worker: { id: 'worker-1', name: 'Bob' },
      payment: {
        id: 'escrow-pending',
        status: 'PENDING',
        totalAmount: 1200,
        currency: 'INR',
        gatewayOrderId: testOrderId
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
              gatewayPaymentId: testPaymentId,
              heldAt: update.heldAt
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
    // Requirement 1: verifyPayment must set HELD_IN_ESCROW, NOT RELEASED_TO_WORKER or COMPLETED
    assert.equal(updatedPaymentStatus, 'HELD_IN_ESCROW');
    assert.equal(updatedStatus, 'CONFIRMED');
    assert.notEqual(updatedStatus, 'COMPLETED');
  } finally {
    setRazorpayInstance(null);
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
      status: 'CONFIRMED',
      agreedPrice: 500,
      customer: { id: 'cust-1' },
      worker: { id: 'worker-1' },
      payment: { id: 'escrow-6', status: 'PENDING', totalAmount: 500, currency: 'INR', gatewayOrderId: 'order_test_6' }
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
    setRazorpayInstance(null);
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
    // Payment is already HELD_IN_ESCROW
    prisma.booking.findUnique = async () => ({
      id: 'booking-test-7',
      customerId: 'cust-1',
      workerId: 'worker-1',
      status: 'CONFIRMED',
      customer: { id: 'cust-1' },
      worker: { id: 'worker-1' },
      payment: {
        id: 'escrow-7',
        status: 'HELD_IN_ESCROW',
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
    assert.match(res.payload.message, /already been verified and is held in escrow/i);
  } finally {
    setRazorpayInstance(null);
    prisma.booking.findUnique = origBookingFindUnique;
  }
});

test('Razorpay 8: Webhook payment.failed records failure and never overwrites held or released payments', async () => {
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

    // Case B: Ensure webhook does NOT overwrite already HELD_IN_ESCROW payment
    let updateCalledOnHeld = false;
    prisma.escrowPayment.findFirst = async () => ({
      id: 'escrow-held-1',
      status: 'HELD_IN_ESCROW'
    });
    prisma.escrowPayment.update = async () => {
      updateCalledOnHeld = true;
    };

    const res2 = createMockResponse();
    await razorpayController.handleWebhook(req, res2);

    assert.equal(res2.statusCode, 200);
    assert.equal(updateCalledOnHeld, false, 'Failed webhook must never downgrade a held payment');
  } finally {
    prisma.escrowPayment.findFirst = origEscrowFindFirst;
    prisma.escrowPayment.update = origEscrowUpdate;
    if (prevHookSec !== undefined) process.env.RAZORPAY_WEBHOOK_SECRET = prevHookSec;
    else delete process.env.RAZORPAY_WEBHOOK_SECRET;
  }
});

test('Razorpay 9: Webhook payment.captured sets HELD_IN_ESCROW with valid signature', async () => {
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
      totalAmount: 500,
      currency: 'INR',
      booking: { id: 'booking-cap-1', status: 'REQUESTED' }
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
            amount: 50000,
            currency: 'INR',
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
    // Requirement 1: Webhook must set HELD_IN_ESCROW, NOT RELEASED_TO_WORKER or COMPLETED
    assert.equal(capturedPaymentStatus, 'HELD_IN_ESCROW');
    assert.equal(capturedBookingStatus, 'CONFIRMED');
    assert.notEqual(capturedBookingStatus, 'COMPLETED');
  } finally {
    prisma.escrowPayment.findFirst = origEscrowFindFirst;
    prisma.$transaction = origTransaction;
    if (prevHookSec !== undefined) process.env.RAZORPAY_WEBHOOK_SECRET = prevHookSec;
    else delete process.env.RAZORPAY_WEBHOOK_SECRET;
  }
});

test('Razorpay 10: safeCompare and HMAC signature helpers prevent timing attacks and handle edge cases', () => {
  assert.equal(safeCompare('abcdef', 'abcdef'), true);
  assert.equal(safeCompare('abcdef', 'abcdeg'), false);
  assert.equal(safeCompare('abc', 'abcdef'), false);
  assert.equal(safeCompare(null, 'abc'), false);
  assert.equal(safeCompare('', ''), true);

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

// ══════════════════════════════════════════════════════════════════════════════
// REQUIREMENT 6: END-TO-END TEST MODE & ESCROW STATE MACHINE TEST SUITE
// ══════════════════════════════════════════════════════════════════════════════

test('Razorpay 11: End-to-end TEST mode flow: create order -> checkout -> verify (held) -> job done -> release -> ledger entry', async () => {
  const prevKey = process.env.RAZORPAY_KEY_ID;
  const prevSec = process.env.RAZORPAY_KEY_SECRET;
  const prevMode = process.env.ESCROW_PAYMENT_MODE;

  process.env.RAZORPAY_KEY_ID = 'rzp_test_e2e_key';
  process.env.RAZORPAY_KEY_SECRET = 'e2e_secret_999';
  process.env.ESCROW_PAYMENT_MODE = 'LIVE';

  const origBookingFindUnique = prisma.booking.findUnique;
  const origEscrowUpsert = prisma.escrowPayment.upsert;
  const origTransaction = prisma.$transaction;
  const origNotificationCreate = prisma.notification.create;
  const origFindMany = prisma.escrowPayment.findMany;

  // In-memory state tracking to emulate DB across the lifecycle steps
  let dbBooking = {
    id: 'booking-e2e-1',
    bookingNumber: 'BK-2026-E2E',
    customerId: 'cust-e2e',
    workerId: 'worker-e2e',
    status: 'CONFIRMED',
    agreedPrice: 1500,
    serviceItem: { id: 'srv-1', title: 'Home Deep Cleaning' },
    customer: { id: 'cust-e2e', name: 'Carol Customer', email: 'carol@test.com', phone: '9988776655' },
    worker: { id: 'worker-e2e', name: 'Dave Worker', email: 'dave@test.com', phone: '9988776644' },
    payment: null
  };

  let dbPayment = null;

  try {
    setRazorpayInstance({
      orders: {
        create: async ({ amount, currency, receipt }) => ({
          id: 'order_e2e_rzp_mock',
          amount,
          currency,
          receipt,
          status: 'created'
        })
      },
      payments: {
        refund: async () => ({ id: 'rfnd_e2e_mock', status: 'processed' })
      }
    });

    prisma.notification.create = async ({ data }) => ({ id: 'notif-e2e', ...data });

    // Step 1: Create Order
    prisma.booking.findUnique = async () => ({ ...dbBooking, payment: dbPayment });
    prisma.escrowPayment.upsert = async ({ create }) => {
      dbPayment = {
        id: 'escrow-e2e-1',
        invoiceNumber: create.invoiceNumber,
        bookingId: dbBooking.id,
        customerId: dbBooking.customerId,
        workerId: dbBooking.workerId,
        totalAmount: create.totalAmount,
        currency: 'INR',
        status: 'PENDING',
        gatewayOrderId: create.gatewayOrderId
      };
      return dbPayment;
    };

    const reqOrder = {
      user: { id: 'cust-e2e', role: 'Customer' },
      body: { bookingId: 'booking-e2e-1' }
    };
    const resOrder = createMockResponse();

    await razorpayController.createPaymentOrder(reqOrder, resOrder);
    assert.equal(resOrder.statusCode, 201);
    assert.equal(resOrder.payload.amount, 150000); // 1500 INR = 150000 paise
    assert.equal(resOrder.payload.currency, 'INR');
    const orderId = resOrder.payload.orderId;

    // Step 2: Checkout & Verify Payment (Funds locked in escrow)
    const paymentId = 'pay_e2e_captured_123';
    const validSignature = generateValidPaymentSignature(orderId, paymentId, 'e2e_secret_999');

    prisma.booking.findUnique = async () => ({
      ...dbBooking,
      payment: dbPayment
    });

    prisma.$transaction = async (fn) => {
      const mockTx = {
        escrowPayment: {
          upsert: async ({ update }) => {
            dbPayment = {
              ...dbPayment,
              status: update.status,
              gatewayOrderId: update.gatewayOrderId,
              gatewayPaymentId: update.gatewayPaymentId,
              gatewaySignature: update.gatewaySignature,
              heldAt: update.heldAt
            };
            return dbPayment;
          }
        },
        booking: {
          update: async ({ data }) => {
            dbBooking = { ...dbBooking, status: data.status };
            return dbBooking;
          }
        }
      };
      return fn(mockTx);
    };

    const reqVerify = {
      user: { id: 'cust-e2e', role: 'Customer' },
      body: {
        bookingId: 'booking-e2e-1',
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: validSignature
      }
    };
    const resVerify = createMockResponse();

    await razorpayController.verifyPayment(reqVerify, resVerify);
    assert.equal(resVerify.statusCode, 200);
    // Escrow state machine verification: payment is HELD_IN_ESCROW, NOT yet released
    assert.equal(dbPayment.status, 'HELD_IN_ESCROW');
    assert.ok(dbPayment.heldAt);
    assert.notEqual(dbBooking.status, 'COMPLETED');

    // Step 3: Job Done (Worker completes service)
    dbBooking.status = 'IN_PROGRESS';

    // Step 4: Customer confirms completion and releases escrow funds
    prisma.$transaction = async (cb) => {
      const mockTx = {
        escrowPayment: {
          findFirst: async () => ({
            ...dbPayment,
            customer: dbBooking.customer,
            worker: dbBooking.worker,
            booking: dbBooking
          }),
          update: async ({ data }) => {
            dbPayment = {
              ...dbPayment,
              status: data.status,
              releasedAt: data.releasedAt
            };
            return {
              ...dbPayment,
              customer: dbBooking.customer,
              worker: dbBooking.worker
            };
          }
        },
        booking: {
          update: async ({ data }) => {
            dbBooking = { ...dbBooking, status: data.status, completedAt: data.completedAt };
            return dbBooking;
          }
        },
        jobPost: {
          update: async () => ({})
        }
      };
      return await cb(mockTx);
    };

    const reqRelease = {
      user: { id: 'cust-e2e', role: 'Customer' },
      body: { bookingId: 'booking-e2e-1' }
    };
    const resRelease = createMockResponse();

    await escrowController.releaseEscrow(reqRelease, resRelease);
    assert.equal(resRelease.statusCode, 200);
    assert.equal(resRelease.payload.success, true);
    assert.equal(dbPayment.status, 'RELEASED_TO_WORKER');
    assert.ok(dbPayment.releasedAt);
    assert.equal(dbBooking.status, 'COMPLETED');

    // Step 5: Ledger Entry shows released transaction
    prisma.escrowPayment.findMany = async () => [
      {
        id: dbPayment.id,
        invoiceNumber: dbPayment.invoiceNumber,
        booking: { bookingNumber: dbBooking.bookingNumber, jobPost: null },
        customer: dbBooking.customer,
        worker: dbBooking.worker,
        totalAmount: 1500,
        status: dbPayment.status,
        paymentMethod: 'UPI',
        gatewayProvider: 'RAZORPAY',
        createdAt: new Date(),
        heldAt: dbPayment.heldAt,
        releasedAt: dbPayment.releasedAt,
        refundedAt: null
      }
    ];

    const reqLedger = {
      user: { id: 'cust-e2e', role: 'Customer' }
    };
    const resLedger = createMockResponse();

    await escrowController.getUserLedger(reqLedger, resLedger);
    assert.equal(resLedger.statusCode, 200);
    assert.equal(resLedger.payload.transactions.length, 1);
    assert.equal(resLedger.payload.transactions[0].status, 'RELEASED_TO_WORKER');
    assert.equal(resLedger.payload.transactions[0].amount, 1500);
  } finally {
    setRazorpayInstance(null);
    prisma.booking.findUnique = origBookingFindUnique;
    prisma.escrowPayment.upsert = origEscrowUpsert;
    prisma.$transaction = origTransaction;
    prisma.notification.create = origNotificationCreate;
    prisma.escrowPayment.findMany = origFindMany;
    if (prevKey !== undefined) process.env.RAZORPAY_KEY_ID = prevKey;
    else delete process.env.RAZORPAY_KEY_ID;
    if (prevSec !== undefined) process.env.RAZORPAY_KEY_SECRET = prevSec;
    else delete process.env.RAZORPAY_KEY_SECRET;
    if (prevMode !== undefined) process.env.ESCROW_PAYMENT_MODE = prevMode;
    else delete process.env.ESCROW_PAYMENT_MODE;
  }
});

test('Razorpay 12: Escrow dispute flow flags payment and booking as DISPUTED', async () => {
  const origTransaction = prisma.$transaction;

  let disputedPaymentStatus = null;
  let disputedBookingStatus = null;

  try {
    prisma.$transaction = async (cb) => {
      const mockTx = {
        escrowPayment: {
          findFirst: async () => ({
            id: 'escrow-disp-1',
            bookingId: 'bk-disp-1',
            customerId: 'cust-1',
            workerId: 'worker-1',
            status: 'HELD_IN_ESCROW',
            totalAmount: 900,
            booking: { id: 'bk-disp-1', status: 'IN_PROGRESS' }
          }),
          update: async ({ data }) => {
            disputedPaymentStatus = data.status;
            return {
              id: 'escrow-disp-1',
              status: data.status,
              totalAmount: 900,
              currency: 'INR',
              refundReason: data.refundReason,
              customer: { id: 'cust-1', name: 'Alice' },
              worker: { id: 'worker-1', name: 'Bob' }
            };
          }
        },
        booking: {
          update: async ({ data }) => {
            disputedBookingStatus = data.status;
            return { id: 'bk-disp-1', status: data.status };
          }
        }
      };
      return await cb(mockTx);
    };

    const req = {
      user: { id: 'cust-1', role: 'Customer' },
      body: { bookingId: 'bk-disp-1', reason: 'Worker did not show up' }
    };
    const res = createMockResponse();

    await escrowController.disputeEscrow(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(disputedPaymentStatus, 'DISPUTED');
    assert.equal(disputedBookingStatus, 'DISPUTED');
  } finally {
    prisma.$transaction = origTransaction;
  }
});

test('Razorpay 13: Escrow refund flow cancels booking and refunds payment to customer', async () => {
  const origTransaction = prisma.$transaction;
  const origNotificationCreate = prisma.notification.create;

  let refundedPaymentStatus = null;
  let refundedBookingStatus = null;

  try {
    prisma.notification.create = async ({ data }) => ({ id: 'notif-ref', ...data });

    prisma.$transaction = async (cb) => {
      const mockTx = {
        escrowPayment: {
          findFirst: async () => ({
            id: 'escrow-ref-1',
            bookingId: 'bk-ref-1',
            customerId: 'cust-1',
            workerId: 'worker-1',
            status: 'DISPUTED',
            totalAmount: 800,
            gatewayPaymentId: 'pay_sim_ref',
            booking: { id: 'bk-ref-1', status: 'DISPUTED', jobPostId: null }
          }),
          update: async ({ data }) => {
            refundedPaymentStatus = data.status;
            return {
              id: 'escrow-ref-1',
              status: data.status,
              totalAmount: 800,
              currency: 'INR',
              refundReason: data.refundReason,
              customer: { id: 'cust-1', name: 'Alice' },
              worker: { id: 'worker-1', name: 'Bob' }
            };
          }
        },
        booking: {
          update: async ({ data }) => {
            refundedBookingStatus = data.status;
            return { id: 'bk-ref-1', status: data.status };
          }
        }
      };
      return await cb(mockTx);
    };

    const req = {
      user: { id: 'admin-1', role: 'Admin' },
      body: { bookingId: 'bk-ref-1', reason: 'Dispute resolved in customer favor' }
    };
    const res = createMockResponse();

    await escrowController.refundEscrow(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(refundedPaymentStatus, 'REFUNDED_TO_CUSTOMER');
    assert.equal(refundedBookingStatus, 'CANCELLED');
  } finally {
    prisma.$transaction = origTransaction;
    prisma.notification.create = origNotificationCreate;
  }
});

test('Razorpay 14: Security: Customer cannot fund escrow without paying in LIVE mode', async () => {
  const prevMode = process.env.ESCROW_PAYMENT_MODE;
  process.env.ESCROW_PAYMENT_MODE = 'LIVE';

  const origFindUnique = prisma.booking.findUnique;
  const origEscrowFindFirst = prisma.escrowPayment.findFirst;

  try {
    prisma.booking.findUnique = async () => ({
      id: 'bk-unpaid-1',
      customerId: 'cust-1',
      workerId: 'worker-1',
      status: 'CONFIRMED',
      agreedPrice: 500
    });

    // No verified gateway payment exists
    prisma.escrowPayment.findFirst = async () => null;

    const req = {
      user: { id: 'cust-1', role: 'Customer' },
      body: { bookingId: 'bk-unpaid-1', amount: 500 }
    };
    const res = createMockResponse();

    await escrowController.fundEscrow(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /Direct escrow funding is disabled in LIVE mode/i);
  } finally {
    prisma.booking.findUnique = origFindUnique;
    prisma.escrowPayment.findFirst = origEscrowFindFirst;
    if (prevMode !== undefined) process.env.ESCROW_PAYMENT_MODE = prevMode;
    else delete process.env.ESCROW_PAYMENT_MODE;
  }
});

test('Razorpay 15: Security: Worker cannot release escrow funds', async () => {
  const origTransaction = prisma.$transaction;

  try {
    prisma.$transaction = async (cb) => {
      const mockTx = {
        escrowPayment: {
          findFirst: async () => ({
            id: 'escrow-sec-1',
            bookingId: 'bk-sec-1',
            customerId: 'cust-1',
            workerId: 'worker-sneaky',
            status: 'HELD_IN_ESCROW',
            booking: { id: 'bk-sec-1', status: 'IN_PROGRESS' }
          })
        }
      };
      return await cb(mockTx);
    };

    // Worker attempts to release their own payout
    const req = {
      user: { id: 'worker-sneaky', role: 'Worker' },
      body: { bookingId: 'bk-sec-1' }
    };
    const res = createMockResponse();

    await escrowController.releaseEscrow(req, res);
    assert.equal(res.statusCode, 403);
    assert.match(res.payload.message, /customer or admin can release escrow/i);
  } finally {
    prisma.$transaction = origTransaction;
  }
});

test('Razorpay 16: Security: Duplicate/replay payment attempts are handled idempotently', async () => {
  const origBookingFindUnique = prisma.booking.findUnique;

  try {
    prisma.booking.findUnique = async () => ({
      id: 'bk-replay-1',
      customerId: 'cust-1',
      workerId: 'worker-1',
      status: 'CONFIRMED',
      agreedPrice: 1000,
      customer: { id: 'cust-1' },
      worker: { id: 'worker-1' },
      payment: {
        id: 'escrow-held-replay',
        status: 'HELD_IN_ESCROW',
        totalAmount: 1000,
        gatewayOrderId: 'order_replay_1'
      }
    });

    const req = {
      user: { id: 'cust-1', role: 'Customer' },
      body: {
        bookingId: 'bk-replay-1',
        razorpay_order_id: 'order_replay_1',
        razorpay_payment_id: 'pay_replay_1',
        razorpay_signature: 'any_sig'
      }
    };
    const res = createMockResponse();

    await razorpayController.verifyPayment(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.alreadyProcessed, true);
    assert.match(res.payload.message, /already been verified and is held in escrow/i);
  } finally {
    setRazorpayInstance(null);
    prisma.booking.findUnique = origBookingFindUnique;
  }
});

test('Razorpay 17: Security: Mismatched payment amount or currency is rejected', async () => {
  const prevKey = process.env.RAZORPAY_KEY_ID;
  const prevSec = process.env.RAZORPAY_KEY_SECRET;

  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'secret_key';

  const origBookingFindUnique = prisma.booking.findUnique;

  try {
    // Payment record amount differs from agreedPrice
    prisma.booking.findUnique = async () => ({
      id: 'bk-tamper-1',
      customerId: 'cust-1',
      workerId: 'worker-1',
      status: 'CONFIRMED',
      agreedPrice: 1000, // agreed is 1000
      customer: { id: 'cust-1' },
      worker: { id: 'worker-1' },
      payment: {
        id: 'escrow-tampered',
        status: 'PENDING',
        totalAmount: 100, // tampered amount
        currency: 'INR',
        gatewayOrderId: 'order_tamper_1'
      }
    });

    const req = {
      user: { id: 'cust-1', role: 'Customer' },
      body: {
        bookingId: 'bk-tamper-1',
        razorpay_order_id: 'order_tamper_1',
        razorpay_payment_id: 'pay_tamper_1',
        razorpay_signature: 'sig'
      }
    };
    const res = createMockResponse();

    await razorpayController.verifyPayment(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /amount mismatch/i);
  } finally {
    setRazorpayInstance(null);
    prisma.booking.findUnique = origBookingFindUnique;
    if (prevKey !== undefined) process.env.RAZORPAY_KEY_ID = prevKey;
    else delete process.env.RAZORPAY_KEY_ID;
    if (prevSec !== undefined) process.env.RAZORPAY_KEY_SECRET = prevSec;
    else delete process.env.RAZORPAY_KEY_SECRET;
  }
});

test('Razorpay 18: Security: Simulated signatures are rejected when ESCROW_PAYMENT_MODE is not SIMULATED', async () => {
  const prevMode = process.env.ESCROW_PAYMENT_MODE;
  process.env.ESCROW_PAYMENT_MODE = 'LIVE';

  const origBookingFindUnique = prisma.booking.findUnique;

  try {
    prisma.booking.findUnique = async () => ({
      id: 'bk-sim-hack-1',
      customerId: 'cust-1',
      workerId: 'worker-1',
      status: 'CONFIRMED',
      agreedPrice: 500,
      customer: { id: 'cust-1' },
      worker: { id: 'worker-1' },
      payment: {
        id: 'escrow-sim-hack',
        status: 'PENDING',
        totalAmount: 500,
        currency: 'INR',
        gatewayOrderId: 'order_sim_123'
      }
    });

    // Attacker crafts simulated signature in LIVE mode
    const req = {
      user: { id: 'cust-1', role: 'Customer' },
      body: {
        bookingId: 'bk-sim-hack-1',
        razorpay_order_id: 'order_sim_123',
        razorpay_payment_id: 'pay_sim_456',
        razorpay_signature: 'sig_sim_order_sim_123_pay_sim_456'
      }
    };
    const res = createMockResponse();

    await razorpayController.verifyPayment(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /invalid signature/i);
  } finally {
    setRazorpayInstance(null);
    prisma.booking.findUnique = origBookingFindUnique;
    if (prevMode !== undefined) process.env.ESCROW_PAYMENT_MODE = prevMode;
    else delete process.env.ESCROW_PAYMENT_MODE;
  }
});
