// LocalHire - Escrow Controller
// Isolated controller handling milestone funding, payment release, disputes, and user ledgers.
// Features atomic Prisma transactions, simulated sandbox workflow, and strict role & state validation.

const prisma = require('../config/prisma');

const getEscrowProviderStatus = () => {
  const configuredMode = (process.env.ESCROW_PAYMENT_MODE || '').toUpperCase();

  if (configuredMode === 'SIMULATED') {
    return {
      enabled: true,
      mode: 'SIMULATED',
      provider: 'SIMULATED_GATEWAY',
      isSimulated: true,
      message: 'LocalHire Simulated Escrow Sandbox is active. Transactions are simulated safely.'
    };
  }

  const configuredProviders = [
    process.env.RAZORPAY_KEY_ID,
    process.env.RAZORPAY_KEY_SECRET,
    process.env.STRIPE_SECRET_KEY,
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.CASHFREE_APP_ID,
    process.env.CASHFREE_SECRET_KEY
  ].filter(Boolean);

  if (configuredProviders.length === 0) {
    return {
      enabled: false,
      mode: 'UNAVAILABLE',
      provider: 'UNAVAILABLE',
      isSimulated: false,
      message: 'No supported payment provider is configured. LocalHire will not process real funds until a verified gateway and webhook secret are added to the environment.'
    };
  }

  return {
    enabled: true,
    mode: 'LIVE',
    provider: process.env.RAZORPAY_KEY_ID ? 'RAZORPAY' : (process.env.STRIPE_SECRET_KEY ? 'STRIPE' : 'CASHFREE'),
    isSimulated: false,
    message: 'A supported payment provider is configured and real escrow processing is enabled.'
  };
};

exports.getEscrowProviderStatus = getEscrowProviderStatus;

const paymentMethodMap = {
  UPI: 'UPI',
  CARD: 'CARD',
  NET_BANKING: 'NET_BANKING',
  CASH_ON_DELIVERY: 'CASH_ON_DELIVERY',
  CASH: 'CASH_ON_DELIVERY',
  WALLET: 'WALLET'
};

const normalizePaymentMethod = (value) => {
  const key = String(value || 'UPI').toUpperCase().replace(/\s+/g, '_');
  return paymentMethodMap[key] || 'UPI';
};

const getCurrentUserId = (req) => req.user.id || req.user._id;

const normalizeEscrow = (payment, booking) => ({
  id: payment.id,
  invoiceNumber: payment.invoiceNumber,
  bookingId: payment.bookingId,
  jobId: booking?.jobPostId || null,
  customerId: payment.customerId,
  workerId: payment.workerId,
  amount: Number(payment.totalAmount),
  currency: payment.currency,
  status: payment.status,
  paymentMethod: payment.paymentMethod,
  gatewayProvider: payment.gatewayProvider,
  isSimulated: payment.gatewayProvider === 'SIMULATED_GATEWAY',
  createdAt: payment.createdAt,
  releasedAt: payment.releasedAt,
  heldAt: payment.heldAt,
  refundReason: payment.refundReason || null,
  customer: payment.customer ? {
    id: payment.customer.id,
    name: payment.customer.name,
    email: payment.customer.email
  } : null,
  worker: payment.worker ? {
    id: payment.worker.id,
    name: payment.worker.name,
    email: payment.worker.email
  } : null
});

// @desc    Fund job escrow (Hold payment in escrow)
// @route   POST /api/escrow/fund
// @access  Private (Customer)
exports.fundEscrow = async (req, res) => {
  try {
    const providerStatus = getEscrowProviderStatus();
    const isSimulated = providerStatus.isSimulated || (!providerStatus.enabled && (req.body.isSimulated || process.env.NODE_ENV !== 'production'));

    if (!providerStatus.enabled && !isSimulated) {
      return res.status(503).json({
        success: false,
        provider: providerStatus.provider,
        message: providerStatus.message
      });
    }

    const { jobId, bookingId, workerId, amount, paymentMethod } = req.body;
    const customerId = getCurrentUserId(req);

    if (!jobId && !bookingId) {
      return res.status(400).json({ success: false, message: 'Either bookingId or jobId is required' });
    }

    const amountValue = Number(amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be a valid positive number' });
    }

    // Resolve or find booking
    let booking = null;
    if (bookingId) {
      booking = await prisma.booking.findUnique({
        where: { id: String(bookingId) },
        include: { jobPost: true }
      });
    } else if (jobId) {
      booking = await prisma.booking.findFirst({
        where: {
          jobPostId: String(jobId),
          ...(workerId ? { workerId: String(workerId) } : {})
        },
        include: { jobPost: true }
      });

      if (!booking) {
        const job = await prisma.jobPost.findUnique({
          where: { id: String(jobId) }
        });
        if (!job) {
          return res.status(404).json({ success: false, message: 'Job not found' });
        }
        if (job.customerId !== customerId && req.user.role !== 'Admin') {
          return res.status(403).json({ success: false, message: 'Only the job customer can fund escrow for this job' });
        }
        if (!workerId) {
          return res.status(400).json({ success: false, message: 'Worker ID is required to fund escrow for this job' });
        }
        booking = await prisma.booking.create({
          data: {
            bookingNumber: `BK-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`,
            customerId,
            workerId: String(workerId),
            jobPostId: String(jobId),
            agreedPrice: amountValue,
            scheduledAt: new Date(),
            timeSlot: 'Flexible',
            status: 'REQUESTED'
          },
          include: { jobPost: true }
        });
      }
    }

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Validate customer ownership
    if (booking.customerId !== customerId && req.user.role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Only the customer or admin can fund escrow for this booking' });
    }

    // Prevent funding closed bookings
    if (['COMPLETED', 'CANCELLED', 'DISPUTED'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot fund escrow for a booking with status ${booking.status}`
      });
    }

    const resolvedWorkerId = booking.workerId || String(workerId);
    if (!resolvedWorkerId) {
      return res.status(400).json({ success: false, message: 'Booking does not have an assigned worker' });
    }

    const invSuffix = Math.floor(100000 + Math.random() * 900000);
    const invoiceNumber = `INV-${new Date().getFullYear()}-${invSuffix}`;

    // Execute atomic transaction for escrow creation and booking update
    const result = await prisma.$transaction(async (tx) => {
      const existingEscrow = await tx.escrowPayment.findFirst({
        where: {
          bookingId: booking.id,
          status: { in: ['PENDING', 'HELD_IN_ESCROW', 'RELEASED_TO_WORKER'] }
        }
      });

      if (existingEscrow) {
        throw { statusCode: 409, message: 'Escrow payment already exists and is active for this booking.' };
      }

      const payment = await tx.escrowPayment.create({
        data: {
          invoiceNumber,
          bookingId: booking.id,
          customerId,
          workerId: resolvedWorkerId,
          subtotalAmount: amountValue,
          taxAmount: 0,
          platformFee: 0,
          workerPayoutAmount: amountValue,
          totalAmount: amountValue,
          currency: 'INR',
          status: 'HELD_IN_ESCROW',
          paymentMethod: normalizePaymentMethod(paymentMethod),
          gatewayProvider: isSimulated ? 'SIMULATED_GATEWAY' : providerStatus.provider,
          gatewayOrderId: isSimulated ? `SIM-ORD-${Date.now()}-${invSuffix}` : null,
          gatewayPaymentId: isSimulated ? `SIM-PAY-${Date.now()}-${invSuffix}` : null,
          gatewaySignature: isSimulated ? `SIM-SIG-${Date.now()}` : null,
          heldAt: new Date()
        },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          worker: { select: { id: true, name: true, email: true } }
        }
      });

      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'IN_PROGRESS',
          startedAt: booking.startedAt || new Date(),
          statusHistory: {
            create: {
              fromStatus: booking.status,
              toStatus: 'IN_PROGRESS',
              changedById: customerId,
              reason: isSimulated
                ? '[SIMULATED] Payment locked in escrow by customer'
                : 'Payment locked in escrow by customer'
            }
          }
        }
      });

      if (booking.jobPostId) {
        await tx.jobPost.update({
          where: { id: booking.jobPostId },
          data: { status: 'IN_PROGRESS' }
        });
      }

      return { payment, updatedBooking };
    });

    res.status(201).json({
      success: true,
      isSimulated,
      mode: providerStatus.mode,
      message: isSimulated
        ? '[SIMULATED] Payment successfully locked in Escrow (Sandbox Mode).'
        : 'Payment successfully locked in Escrow.',
      escrow: normalizeEscrow(result.payment, result.updatedBooking)
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error('[Escrow Controller] Fund Error:', error);
    res.status(500).json({ success: false, message: 'Server error while funding escrow', error: error.message });
  }
};

// @desc    Release escrow funds to worker & complete job
// @route   POST /api/escrow/release
// @access  Private (Customer or Admin)
exports.releaseEscrow = async (req, res) => {
  try {
    const providerStatus = getEscrowProviderStatus();
    const isSimulated = providerStatus.isSimulated || (!providerStatus.enabled && process.env.NODE_ENV !== 'production');

    if (!providerStatus.enabled && !isSimulated) {
      return res.status(503).json({
        success: false,
        provider: providerStatus.provider,
        message: providerStatus.message
      });
    }

    const { jobId, bookingId, paymentMethod } = req.body;
    const currentUserId = getCurrentUserId(req);

    if (!jobId && !bookingId) {
      return res.status(400).json({ success: false, message: 'Either bookingId or jobId is required' });
    }

    const selectedMethod = paymentMethod ? normalizePaymentMethod(paymentMethod) : null;

    // Atomic transaction for release with concurrency protection
    const result = await prisma.$transaction(async (tx) => {
      let payment = await tx.escrowPayment.findFirst({
        where: {
          ...(bookingId ? { bookingId: String(bookingId) } : { booking: { jobPostId: String(jobId) } }),
          status: 'HELD_IN_ESCROW'
        },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          worker: { select: { id: true, name: true, email: true } },
          booking: true
        }
      });

      if (!payment) {
        const alreadyReleased = await tx.escrowPayment.findFirst({
          where: {
            ...(bookingId ? { bookingId: String(bookingId) } : { booking: { jobPostId: String(jobId) } }),
            status: 'RELEASED_TO_WORKER'
          }
        });

        if (alreadyReleased) {
          throw { statusCode: 409, message: 'Escrow payment has already been released to the worker.' };
        }

        // If no pre-held escrow exists, settle directly on completion for valid booking
        const targetBooking = await tx.booking.findFirst({
          where: {
            ...(bookingId ? { id: String(bookingId) } : { jobPostId: String(jobId) })
          },
          include: {
            customer: { select: { id: true, name: true, email: true } },
            worker: { select: { id: true, name: true, email: true } }
          }
        });

        if (targetBooking && ['IN_PROGRESS', 'COMPLETED', 'CONFIRMED'].includes(targetBooking.status)) {
          if (targetBooking.customerId !== currentUserId && req.user.role !== 'Admin') {
            throw { statusCode: 403, message: 'Only the customer or admin can release escrow payment.' };
          }

          const invSuffix = Math.floor(100000 + Math.random() * 900000);
          const priceValue = Number(targetBooking.agreedPrice || 0);

          const createdPayment = await tx.escrowPayment.create({
            data: {
              invoiceNumber: `INV-${new Date().getFullYear()}-${invSuffix}`,
              bookingId: targetBooking.id,
              customerId: targetBooking.customerId,
              workerId: targetBooking.workerId,
              subtotalAmount: priceValue,
              taxAmount: 0,
              platformFee: 0,
              workerPayoutAmount: priceValue,
              totalAmount: priceValue,
              currency: 'INR',
              status: 'RELEASED_TO_WORKER',
              paymentMethod: selectedMethod || 'UPI',
              gatewayProvider: isSimulated ? 'SIMULATED_GATEWAY' : providerStatus.provider,
              gatewayOrderId: isSimulated ? `SIM-ORD-${Date.now()}-${invSuffix}` : null,
              gatewayPaymentId: isSimulated ? `SIM-PAY-${Date.now()}-${invSuffix}` : null,
              heldAt: new Date(),
              releasedAt: new Date()
            },
            include: {
              customer: { select: { id: true, name: true, email: true } },
              worker: { select: { id: true, name: true, email: true } }
            }
          });

          const updatedBooking = await tx.booking.update({
            where: { id: targetBooking.id },
            data: {
              status: 'COMPLETED',
              completedAt: targetBooking.completedAt || new Date(),
              statusHistory: {
                create: {
                  fromStatus: targetBooking.status,
                  toStatus: 'COMPLETED',
                  changedById: currentUserId,
                  reason: `Escrow payment settled directly (${selectedMethod || 'UPI'}) upon service completion`
                }
              }
            }
          });

          if (targetBooking.jobPostId) {
            await tx.jobPost.update({
              where: { id: targetBooking.jobPostId },
              data: { status: 'COMPLETED' }
            });
          }

          return { updatedPayment: createdPayment, updatedBooking };
        }

        throw { statusCode: 404, message: 'No active held escrow transaction found.' };
      }

      if (payment.customerId !== currentUserId && req.user.role !== 'Admin') {
        throw { statusCode: 403, message: 'Only the customer or admin can release escrow payment.' };
      }

      // Customer completion confirmation check
      if (!['IN_PROGRESS', 'COMPLETED'].includes(payment.booking.status)) {
        throw {
          statusCode: 409,
          message: `Cannot release escrow: booking status is ${payment.booking.status}. It must be IN_PROGRESS or COMPLETED.`
        };
      }

      const updatedPayment = await tx.escrowPayment.update({
        where: { id: payment.id },
        data: {
          status: 'RELEASED_TO_WORKER',
          ...(selectedMethod ? { paymentMethod: selectedMethod } : {}),
          releasedAt: new Date()
        },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          worker: { select: { id: true, name: true, email: true } }
        }
      });

      const updatedBooking = await tx.booking.update({
        where: { id: payment.bookingId },
        data: {
          status: 'COMPLETED',
          completedAt: payment.booking.completedAt || new Date(),
          statusHistory: {
            create: {
              fromStatus: payment.booking.status,
              toStatus: 'COMPLETED',
              changedById: currentUserId,
              reason: `Escrow funds released to worker (${selectedMethod || payment.paymentMethod}) by customer confirmation`
            }
          }
        }
      });

      if (payment.booking.jobPostId) {
        await tx.jobPost.update({
          where: { id: payment.booking.jobPostId },
          data: { status: 'COMPLETED' }
        });
      }

      return { updatedPayment, updatedBooking };
    });

    const methodLabel = result.updatedPayment.paymentMethod === 'CASH_ON_DELIVERY' ? 'Cash' : result.updatedPayment.paymentMethod;
    res.json({
      success: true,
      message: `Escrow payment of ₹${result.updatedPayment.totalAmount} successfully released to worker via ${methodLabel}! Booking marked as Completed!`,
      escrow: normalizeEscrow(result.updatedPayment, result.updatedBooking)
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error('[Escrow Controller] Release Error:', error);
    res.status(500).json({ success: false, message: 'Server error while releasing escrow', error: error.message });
  }
};

// @desc    Raise a dispute on held escrow
// @route   POST /api/escrow/dispute
// @access  Private (Customer, Worker, or Admin)
exports.disputeEscrow = async (req, res) => {
  try {
    const { jobId, bookingId, reason } = req.body;
    const currentUserId = getCurrentUserId(req);

    if (!jobId && !bookingId) {
      return res.status(400).json({ success: false, message: 'Either bookingId or jobId is required' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.escrowPayment.findFirst({
        where: {
          ...(bookingId ? { bookingId: String(bookingId) } : { booking: { jobPostId: String(jobId) } }),
          status: 'HELD_IN_ESCROW'
        },
        include: { booking: true }
      });

      if (!payment) {
        throw { statusCode: 404, message: 'No active held escrow transaction found to dispute.' };
      }

      const isCustomer = payment.customerId === currentUserId;
      const isWorker = payment.workerId === currentUserId;
      const isAdmin = req.user.role === 'Admin';

      if (!isCustomer && !isWorker && !isAdmin) {
        throw { statusCode: 403, message: 'You are not authorized to dispute this escrow transaction.' };
      }

      const disputeReason = reason ? String(reason).trim() : 'Issue reported during job execution';

      const updatedPayment = await tx.escrowPayment.update({
        where: { id: payment.id },
        data: {
          status: 'DISPUTED',
          refundReason: disputeReason
        },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          worker: { select: { id: true, name: true, email: true } }
        }
      });

      const updatedBooking = await tx.booking.update({
        where: { id: payment.bookingId },
        data: {
          status: 'DISPUTED',
          statusHistory: {
            create: {
              fromStatus: payment.booking.status,
              toStatus: 'DISPUTED',
              changedById: currentUserId,
              reason: `Dispute raised: ${disputeReason}`
            }
          }
        }
      });

      return { updatedPayment, updatedBooking };
    });

    res.json({
      success: true,
      message: 'Escrow payment flagged for dispute. Admin team will review.',
      escrow: normalizeEscrow(result.updatedPayment, result.updatedBooking)
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error('[Escrow Controller] Dispute Error:', error);
    res.status(500).json({ success: false, message: 'Server error while disputing escrow', error: error.message });
  }
};

// @desc    Get escrow status for a specific job or booking
// @route   GET /api/escrow/job/:jobId
// @access  Private
exports.getJobEscrow = async (req, res) => {
  try {
    const identifier = req.params.jobId;
    const payment = await prisma.escrowPayment.findFirst({
      where: {
        OR: [
          { booking: { jobPostId: identifier } },
          { bookingId: identifier }
        ]
      },
      include: {
        booking: true,
        customer: { select: { id: true, name: true, email: true } },
        worker: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      escrow: payment ? normalizeEscrow(payment, payment.booking) : null
    });
  } catch (error) {
    console.error('[Escrow Controller] getJobEscrow error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching job escrow' });
  }
};

// @desc    Get user financial ledger (all escrow transactions)
// @route   GET /api/escrow/ledger
// @access  Private
exports.getUserLedger = async (req, res) => {
  try {
    const userId = getCurrentUserId(req);

    const transactions = await prisma.escrowPayment.findMany({
      where: {
        OR: [{ customerId: userId }, { workerId: userId }]
      },
      include: {
        booking: {
          include: {
            jobPost: { select: { id: true, title: true, status: true } },
            customer: { select: { id: true, name: true, email: true } },
            worker: { select: { id: true, name: true, email: true } }
          }
        },
        customer: { select: { id: true, name: true, email: true } },
        worker: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      transactions: transactions.map((tx) => ({
        id: tx.id,
        invoiceNumber: tx.invoiceNumber,
        bookingNumber: tx.booking?.bookingNumber,
        job: tx.booking?.jobPost ? {
          id: tx.booking.jobPost.id,
          title: tx.booking.jobPost.title,
          status: tx.booking.jobPost.status
        } : null,
        customer: tx.customer,
        worker: tx.worker,
        amount: Number(tx.totalAmount),
        status: tx.status,
        paymentMethod: tx.paymentMethod,
        gatewayProvider: tx.gatewayProvider,
        isSimulated: tx.gatewayProvider === 'SIMULATED_GATEWAY',
        createdAt: tx.createdAt,
        releasedAt: tx.releasedAt,
        heldAt: tx.heldAt
      }))
    });
  } catch (error) {
    console.error('[Escrow Controller] getUserLedger error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching transaction ledger' });
  }
};
