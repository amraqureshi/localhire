const test = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../config/prisma');
const escrowController = require('../controllers/escrowController');

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

test('Batch B: getEscrowProviderStatus reports SIMULATED sandbox mode safely', () => {
  const prevMode = process.env.ESCROW_PAYMENT_MODE;
  try {
    process.env.ESCROW_PAYMENT_MODE = 'SIMULATED';
    const status = escrowController.getEscrowProviderStatus();
    assert.equal(status.enabled, true);
    assert.equal(status.mode, 'SIMULATED');
    assert.equal(status.isSimulated, true);
    assert.equal(status.provider, 'SIMULATED_GATEWAY');
  } finally {
    if (prevMode !== undefined) {
      process.env.ESCROW_PAYMENT_MODE = prevMode;
    } else {
      delete process.env.ESCROW_PAYMENT_MODE;
    }
  }
});

test('Batch B: fundEscrow rejects non-positive or invalid amounts', async () => {
  const req = {
    user: { id: 'cust-1', role: 'Customer' },
    body: { bookingId: 'bk-1', amount: -50 }
  };
  const res = createMockResponse();

  await escrowController.fundEscrow(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.message, /positive number/i);
});

test('Batch B: fundEscrow rejects customer who does not own the booking', async () => {
  const origFindUnique = prisma.booking.findUnique;
  try {
    prisma.booking.findUnique = async () => ({
      id: 'bk-1',
      customerId: 'other-cust',
      workerId: 'wrk-1',
      status: 'REQUESTED'
    });

    const req = {
      user: { id: 'cust-1', role: 'Customer' },
      body: { bookingId: 'bk-1', amount: 500 }
    };
    const res = createMockResponse();

    await escrowController.fundEscrow(req, res);
    assert.equal(res.statusCode, 403);
    assert.match(res.payload.message, /customer or admin/i);
  } finally {
    prisma.booking.findUnique = origFindUnique;
  }
});

test('Batch B: fundEscrow rejects already completed or cancelled bookings', async () => {
  const origFindUnique = prisma.booking.findUnique;
  try {
    prisma.booking.findUnique = async () => ({
      id: 'bk-1',
      customerId: 'cust-1',
      workerId: 'wrk-1',
      status: 'COMPLETED'
    });

    const req = {
      user: { id: 'cust-1', role: 'Customer' },
      body: { bookingId: 'bk-1', amount: 500 }
    };
    const res = createMockResponse();

    await escrowController.fundEscrow(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /COMPLETED/i);
  } finally {
    prisma.booking.findUnique = origFindUnique;
  }
});

test('Batch B: fundEscrow performs atomic creation and sets SIMULATED status', async () => {
  const origFindUnique = prisma.booking.findUnique;
  const origTransaction = prisma.$transaction;

  let createdPaymentData = null;
  let updatedBookingData = null;

  try {
    prisma.booking.findUnique = async () => ({
      id: 'bk-1',
      customerId: 'cust-1',
      workerId: 'wrk-1',
      status: 'REQUESTED'
    });

    prisma.$transaction = async (cb) => {
      const mockTx = {
        escrowPayment: {
          findFirst: async () => null,
          create: async ({ data }) => {
            createdPaymentData = data;
            return {
              id: 'esc-1',
              invoiceNumber: data.invoiceNumber,
              bookingId: 'bk-1',
              customerId: 'cust-1',
              workerId: 'wrk-1',
              totalAmount: data.totalAmount,
              currency: 'INR',
              status: 'HELD_IN_ESCROW',
              paymentMethod: data.paymentMethod,
              gatewayProvider: data.gatewayProvider,
              createdAt: new Date(),
              heldAt: new Date()
            };
          }
        },
        booking: {
          update: async ({ data }) => {
            updatedBookingData = data;
            return {
              id: 'bk-1',
              status: 'IN_PROGRESS'
            };
          }
        }
      };
      return await cb(mockTx);
    };

    const req = {
      user: { id: 'cust-1', role: 'Customer' },
      body: { bookingId: 'bk-1', amount: 650, paymentMethod: 'UPI' }
    };
    const res = createMockResponse();

    await escrowController.fundEscrow(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.isSimulated, true);
    assert.equal(createdPaymentData.gatewayProvider, 'SIMULATED_GATEWAY');
    assert.equal(createdPaymentData.status, 'HELD_IN_ESCROW');
    assert.equal(updatedBookingData.status, 'IN_PROGRESS');
    assert.equal(updatedBookingData.statusHistory.create.toStatus, 'IN_PROGRESS');
  } finally {
    prisma.booking.findUnique = origFindUnique;
    prisma.$transaction = origTransaction;
  }
});

test('Batch B: fundEscrow returns 409 Conflict if escrow already funded', async () => {
  const origFindUnique = prisma.booking.findUnique;
  const origTransaction = prisma.$transaction;

  try {
    prisma.booking.findUnique = async () => ({
      id: 'bk-1',
      customerId: 'cust-1',
      workerId: 'wrk-1',
      status: 'REQUESTED'
    });

    prisma.$transaction = async (cb) => {
      const mockTx = {
        escrowPayment: {
          findFirst: async () => ({ id: 'esc-existing', status: 'HELD_IN_ESCROW' })
        }
      };
      return await cb(mockTx);
    };

    const req = {
      user: { id: 'cust-1', role: 'Customer' },
      body: { bookingId: 'bk-1', amount: 500 }
    };
    const res = createMockResponse();

    await escrowController.fundEscrow(req, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.payload.message, /already exists/i);
  } finally {
    prisma.booking.findUnique = origFindUnique;
    prisma.$transaction = origTransaction;
  }
});

test('Batch B: releaseEscrow prevents unauthorized non-customer / non-admin release', async () => {
  const origTransaction = prisma.$transaction;

  try {
    prisma.$transaction = async (cb) => {
      const mockTx = {
        escrowPayment: {
          findFirst: async () => ({
            id: 'esc-1',
            bookingId: 'bk-1',
            customerId: 'customer-owner',
            workerId: 'wrk-1',
            status: 'HELD_IN_ESCROW',
            booking: { id: 'bk-1', status: 'IN_PROGRESS' }
          })
        }
      };
      return await cb(mockTx);
    };

    const req = {
      user: { id: 'unauthorized-user', role: 'Customer' },
      body: { bookingId: 'bk-1' }
    };
    const res = createMockResponse();

    await escrowController.releaseEscrow(req, res);
    assert.equal(res.statusCode, 403);
    assert.match(res.payload.message, /customer or admin/i);
  } finally {
    prisma.$transaction = origTransaction;
  }
});

test('Batch B: releaseEscrow prevents double release (idempotency / race condition guard)', async () => {
  const origTransaction = prisma.$transaction;

  try {
    prisma.$transaction = async (cb) => {
      const mockTx = {
        escrowPayment: {
          findFirst: async ({ where }) => {
            if (where.status === 'HELD_IN_ESCROW') return null;
            if (where.status === 'RELEASED_TO_WORKER') return { id: 'esc-1', status: 'RELEASED_TO_WORKER' };
            return null;
          }
        }
      };
      return await cb(mockTx);
    };

    const req = {
      user: { id: 'cust-1', role: 'Customer' },
      body: { bookingId: 'bk-1' }
    };
    const res = createMockResponse();

    await escrowController.releaseEscrow(req, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.payload.message, /already been released/i);
  } finally {
    prisma.$transaction = origTransaction;
  }
});

test('Batch B: releaseEscrow releases funds and marks booking COMPLETED with status history', async () => {
  const origTransaction = prisma.$transaction;

  let paymentUpdatedStatus = null;
  let bookingUpdatedStatus = null;

  try {
    prisma.$transaction = async (cb) => {
      const mockTx = {
        escrowPayment: {
          findFirst: async () => ({
            id: 'esc-1',
            invoiceNumber: 'INV-2026-001',
            bookingId: 'bk-1',
            customerId: 'cust-1',
            workerId: 'wrk-1',
            totalAmount: 700,
            status: 'HELD_IN_ESCROW',
            booking: { id: 'bk-1', status: 'IN_PROGRESS', jobPostId: null }
          }),
          update: async ({ data }) => {
            paymentUpdatedStatus = data.status;
            return {
              id: 'esc-1',
              invoiceNumber: 'INV-2026-001',
              bookingId: 'bk-1',
              customerId: 'cust-1',
              workerId: 'wrk-1',
              totalAmount: 700,
              currency: 'INR',
              status: data.status,
              paymentMethod: 'UPI',
              gatewayProvider: 'SIMULATED_GATEWAY',
              releasedAt: data.releasedAt
            };
          }
        },
        booking: {
          update: async ({ data }) => {
            bookingUpdatedStatus = data;
            return { id: 'bk-1', status: data.status };
          }
        }
      };
      return await cb(mockTx);
    };

    const req = {
      user: { id: 'cust-1', role: 'Customer' },
      body: { bookingId: 'bk-1' }
    };
    const res = createMockResponse();

    await escrowController.releaseEscrow(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(paymentUpdatedStatus, 'RELEASED_TO_WORKER');
    assert.equal(bookingUpdatedStatus.status, 'COMPLETED');
    assert.equal(bookingUpdatedStatus.statusHistory.create.toStatus, 'COMPLETED');
  } finally {
    prisma.$transaction = origTransaction;
  }
});

test('Batch B: disputeEscrow allows worker or customer but blocks third parties', async () => {
  const origTransaction = prisma.$transaction;

  try {
    prisma.$transaction = async (cb) => {
      const mockTx = {
        escrowPayment: {
          findFirst: async () => ({
            id: 'esc-1',
            bookingId: 'bk-1',
            customerId: 'cust-1',
            workerId: 'wrk-1',
            status: 'HELD_IN_ESCROW',
            booking: { id: 'bk-1', status: 'IN_PROGRESS' }
          })
        }
      };
      return await cb(mockTx);
    };

    // Third-party attempt -> 403
    const reqThirdParty = {
      user: { id: 'stranger-99', role: 'Customer' },
      body: { bookingId: 'bk-1', reason: 'Unrelated user complaining' }
    };
    const resThirdParty = createMockResponse();
    await escrowController.disputeEscrow(reqThirdParty, resThirdParty);
    assert.equal(resThirdParty.statusCode, 403);
    assert.match(resThirdParty.payload.message, /not authorized/i);
  } finally {
    prisma.$transaction = origTransaction;
  }
});

test('Batch B: disputeEscrow flags payment & booking DISPUTED atomically', async () => {
  const origTransaction = prisma.$transaction;

  let disputedPayment = null;
  let disputedBooking = null;

  try {
    prisma.$transaction = async (cb) => {
      const mockTx = {
        escrowPayment: {
          findFirst: async () => ({
            id: 'esc-1',
            invoiceNumber: 'INV-2026-002',
            bookingId: 'bk-1',
            customerId: 'cust-1',
            workerId: 'wrk-1',
            totalAmount: 500,
            status: 'HELD_IN_ESCROW',
            booking: { id: 'bk-1', status: 'IN_PROGRESS' }
          }),
          update: async ({ data }) => {
            disputedPayment = data;
            return {
              id: 'esc-1',
              invoiceNumber: 'INV-2026-002',
              bookingId: 'bk-1',
              customerId: 'cust-1',
              workerId: 'wrk-1',
              totalAmount: 500,
              currency: 'INR',
              status: data.status,
              paymentMethod: 'UPI',
              gatewayProvider: 'SIMULATED_GATEWAY',
              refundReason: data.refundReason
            };
          }
        },
        booking: {
          update: async ({ data }) => {
            disputedBooking = data;
            return { id: 'bk-1', status: data.status };
          }
        }
      };
      return await cb(mockTx);
    };

    const req = {
      user: { id: 'wrk-1', role: 'Worker' },
      body: { bookingId: 'bk-1', reason: 'Customer changed scope unexpectedly' }
    };
    const res = createMockResponse();

    await escrowController.disputeEscrow(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(disputedPayment.status, 'DISPUTED');
    assert.equal(disputedPayment.refundReason, 'Customer changed scope unexpectedly');
    assert.equal(disputedBooking.status, 'DISPUTED');
    assert.equal(disputedBooking.statusHistory.create.toStatus, 'DISPUTED');
  } finally {
    prisma.$transaction = origTransaction;
  }
});
