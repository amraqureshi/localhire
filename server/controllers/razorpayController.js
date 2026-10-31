// LocalHire - Razorpay Payment Controller
// Handles Razorpay order creation, payment signature verification, idempotency, and secure webhook processing.

const prisma = require('../config/prisma');
const {
  getRazorpayCredentials,
  isRazorpayConfigured,
  getRazorpayInstance,
  verifyPaymentSignature,
  verifyWebhookSignature,
  safeCompare
} = require('../config/razorpay');
const { notifyUser } = require('./notificationController');
const { broadcastBookingStatus, stopBookingTracking } = require('../trackingState');

const getCurrentUserId = (req) => req.user.id || (req.user._id && req.user._id.toString());

// @desc    Get Razorpay public configuration (Key ID only)
// @route   GET /api/escrow/razorpay/config
// @access  Public
exports.getRazorpayConfig = (req, res) => {
  const { keyId } = getRazorpayCredentials();
  res.json({
    success: true,
    keyId: isRazorpayConfigured() ? keyId : null,
    isConfigured: isRazorpayConfigured(),
    currency: 'INR'
  });
};

// @desc    Create Razorpay Order for a completed/ready booking
// @route   POST /api/escrow/razorpay/create-order
// @access  Private (Customer)
exports.createPaymentOrder = async (req, res) => {
  try {
    const { bookingId } = req.body;
    const currentUserId = getCurrentUserId(req);

    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'bookingId is required' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: String(bookingId) },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } },
        worker: { select: { id: true, name: true, email: true, phone: true } },
        serviceItem: { select: { id: true, title: true } },
        payment: true
      }
    });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // 1. Authorization: Only the booking owner (customer) or admin can pay
    if (booking.customerId !== currentUserId && req.user.role !== 'Admin') {
      return res.status(403).json({
        success: false,
        message: 'Only the customer who created this booking can make a payment'
      });
    }

    // 2. Service completion eligibility check:
    // Worker must have marked service completed or awaiting customer confirmation
    const eligibleStatuses = ['COMPLETED', 'AWAITING_CUSTOMER_CONFIRMATION'];
    if (!eligibleStatuses.includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: 'Payment is only permitted after the worker has completed the service'
      });
    }

    // 3. Prevent duplicate successful payments
    if (booking.payment && (booking.payment.status === 'RELEASED_TO_WORKER' || booking.payment.status === 'HELD_IN_ESCROW')) {
      return res.status(409).json({
        success: false,
        message: 'Payment has already been successfully completed for this booking'
      });
    }

    // 4. Calculate payable amount strictly from trusted database
    const amountNum = Number(booking.agreedPrice);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking payable amount'
      });
    }

    // Razorpay requires amounts in paise (1 INR = 100 paise)
    const amountPaise = Math.round(amountNum * 100);

    // 5. Create Razorpay order via SDK (or sandbox mock if unconfigured in dev)
    const razorpay = getRazorpayInstance();
    let razorpayOrder;

    if (razorpay) {
      try {
        const receipt = `rcpt_${String(booking.bookingNumber || booking.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 30)}`;
        razorpayOrder = await razorpay.orders.create({
          amount: amountPaise,
          currency: 'INR',
          receipt,
          notes: {
            bookingId: booking.id,
            customerId: booking.customerId,
            workerId: booking.workerId
          }
        });
      } catch (sdkError) {
        console.error('[Razorpay Controller] SDK order creation error:', sdkError);
        return res.status(502).json({
          success: false,
          message: 'Razorpay gateway failed to create payment order',
          details: sdkError.error?.description || sdkError.message
        });
      }
    } else {
      // Safe sandbox fallback for testing when keys are placeholder
      const randomSuffix = Math.floor(100000 + Math.random() * 900000);
      razorpayOrder = {
        id: `order_sim_${Date.now()}_${randomSuffix}`,
        amount: amountPaise,
        currency: 'INR',
        receipt: `rcpt_sim_${booking.id.slice(0, 8)}`,
        status: 'created',
        notes: {
          bookingId: booking.id,
          customerId: booking.customerId,
          workerId: booking.workerId
        }
      };
    }

    // 6. Persist or update order record in EscrowPayment
    const invSuffix = Math.floor(100000 + Math.random() * 900000);
    const invoiceNumber = booking.payment?.invoiceNumber || `INV-${new Date().getFullYear()}-${invSuffix}`;

    const escrowRecord = await prisma.escrowPayment.upsert({
      where: { bookingId: booking.id },
      create: {
        invoiceNumber,
        bookingId: booking.id,
        customerId: booking.customerId,
        workerId: booking.workerId,
        subtotalAmount: amountNum,
        taxAmount: 0,
        platformFee: 0,
        workerPayoutAmount: amountNum,
        totalAmount: amountNum,
        currency: 'INR',
        status: 'PENDING',
        paymentMethod: 'UPI',
        gatewayProvider: 'RAZORPAY',
        gatewayOrderId: razorpayOrder.id
      },
      update: {
        gatewayOrderId: razorpayOrder.id,
        status: 'PENDING',
        gatewayProvider: 'RAZORPAY',
        totalAmount: amountNum,
        workerPayoutAmount: amountNum,
        updatedAt: new Date()
      }
    });

    const { keyId } = getRazorpayCredentials();

    return res.status(201).json({
      success: true,
      orderId: razorpayOrder.id,
      amount: amountPaise,
      amountInRupees: amountNum,
      currency: 'INR',
      keyId: isRazorpayConfigured() ? keyId : 'rzp_test_simulated',
      isSimulated: !isRazorpayConfigured(),
      booking: {
        id: booking.id,
        bookingNumber: booking.bookingNumber,
        serviceTitle: booking.serviceItem?.title || 'Professional Service',
        workerName: booking.worker?.name || 'Worker',
        customerName: booking.customer?.name || 'Customer',
        customerEmail: booking.customer?.email || '',
        customerPhone: booking.customer?.phone || ''
      }
    });
  } catch (error) {
    console.error('[Razorpay Controller] createPaymentOrder error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error creating Razorpay payment order',
      error: error.message
    });
  }
};

// @desc    Verify Razorpay payment signature & settle booking
// @route   POST /api/escrow/razorpay/verify-payment
// @access  Private (Customer)
exports.verifyPayment = async (req, res) => {
  try {
    const { bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const currentUserId = getCurrentUserId(req);

    if (!bookingId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'bookingId, razorpay_order_id, razorpay_payment_id, and razorpay_signature are required'
      });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: String(bookingId) },
      include: {
        payment: true,
        customer: { select: { id: true, name: true, email: true } },
        worker: { select: { id: true, name: true, email: true } }
      }
    });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // 1. Authorization: Only the booking owner can verify and settle
    if (booking.customerId !== currentUserId && req.user.role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to verify payment for this booking' });
    }

    // 2. Idempotency: If payment was already completed, return success safely
    if (booking.payment && booking.payment.status === 'RELEASED_TO_WORKER') {
      return res.json({
        success: true,
        message: 'Payment has already been confirmed and completed.',
        alreadyProcessed: true,
        booking: { id: booking.id, status: booking.status },
        payment: booking.payment
      });
    }

    // 3. Cryptographic Signature Verification using HMAC SHA256
    let isSignatureValid = false;

    if (isRazorpayConfigured()) {
      isSignatureValid = verifyPaymentSignature({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature
      });
    } else {
      // Safe simulation fallback for test environments
      isSignatureValid = (
        razorpay_order_id.startsWith('order_sim_') &&
        razorpay_payment_id.startsWith('pay_sim_') &&
        razorpay_signature === `sig_sim_${razorpay_order_id}_${razorpay_payment_id}`
      ) || (
        verifyPaymentSignature({
          orderId: razorpay_order_id,
          paymentId: razorpay_payment_id,
          signature: razorpay_signature
        })
      );
    }

    if (!isSignatureValid) {
      console.warn('[Razorpay Controller] Invalid payment signature attempt for booking:', bookingId);
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed: invalid signature. Transaction rejected.'
      });
    }

    // 4. Atomic transaction: Mark payment RELEASED_TO_WORKER and booking COMPLETED
    const result = await prisma.$transaction(async (tx) => {
      const invSuffix = Math.floor(100000 + Math.random() * 900000);
      const priceNum = Number(booking.agreedPrice || 0);

      const updatedPayment = await tx.escrowPayment.upsert({
        where: { bookingId: booking.id },
        create: {
          invoiceNumber: `INV-${new Date().getFullYear()}-${invSuffix}`,
          bookingId: booking.id,
          customerId: booking.customerId,
          workerId: booking.workerId,
          subtotalAmount: priceNum,
          taxAmount: 0,
          platformFee: 0,
          workerPayoutAmount: priceNum,
          totalAmount: priceNum,
          currency: 'INR',
          status: 'RELEASED_TO_WORKER',
          paymentMethod: 'UPI',
          gatewayProvider: 'RAZORPAY',
          gatewayOrderId: razorpay_order_id,
          gatewayPaymentId: razorpay_payment_id,
          gatewaySignature: razorpay_signature,
          releasedAt: new Date()
        },
        update: {
          status: 'RELEASED_TO_WORKER',
          gatewayOrderId: razorpay_order_id,
          gatewayPaymentId: razorpay_payment_id,
          gatewaySignature: razorpay_signature,
          releasedAt: new Date()
        }
      });

      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'COMPLETED',
          completedAt: booking.completedAt || new Date(),
          statusHistory: {
            create: {
              fromStatus: booking.status,
              toStatus: 'COMPLETED',
              changedById: currentUserId,
              reason: `Payment confirmed via Razorpay (Payment ID: ${razorpay_payment_id})`
            }
          }
        },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          worker: { select: { id: true, name: true, email: true } }
        }
      });

      return { payment: updatedPayment, booking: updatedBooking };
    });

    // 5. Broadcast real-time status change over Socket.IO and terminate live tracking
    broadcastBookingStatus(booking.id, 'COMPLETED', {
      booking: result.booking,
      changedById: currentUserId,
      payment: {
        id: result.payment.id,
        amount: Number(result.payment.totalAmount),
        paymentId: razorpay_payment_id
      }
    });
    stopBookingTracking(booking.id, 'Service completed and paid.');

    // 6. Send in-app notifications
    await Promise.all([
      notifyUser({
        userId: booking.customerId,
        type: 'PAYMENT_RELEASED',
        title: 'Payment successful',
        message: `Your payment of ₹${result.payment.totalAmount} for ${booking.worker?.name || 'the worker'} was successful.`,
        linkUrl: `/bookings/${booking.id}`
      }),
      notifyUser({
        userId: booking.workerId,
        type: 'PAYMENT_RELEASED',
        title: 'Payment received',
        message: `Payment of ₹${result.payment.totalAmount} was released to you by ${booking.customer?.name || 'the customer'}.`,
        linkUrl: `/bookings/${booking.id}`
      })
    ]);

    return res.json({
      success: true,
      message: 'Payment verified and service marked as Completed.',
      payment: result.payment,
      booking: result.booking
    });
  } catch (error) {
    console.error('[Razorpay Controller] verifyPayment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error verifying Razorpay payment',
      error: error.message
    });
  }
};

// @desc    Razorpay Webhook Handler
// @route   POST /api/escrow/razorpay/webhook
// @access  Public (Signature-verified)
exports.handleWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.rawBody ? req.rawBody.toString('utf-8') : JSON.stringify(req.body);

    if (!signature) {
      return res.status(400).json({ success: false, message: 'Missing x-razorpay-signature header' });
    }

    // 1. Signature Verification
    const isWebhookValid = verifyWebhookSignature({ rawBody, signature });
    if (!isWebhookValid) {
      console.warn('[Razorpay Webhook] Invalid webhook signature received');
      return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    }

    const event = req.body?.event;
    const payload = req.body?.payload;

    if (!event || !payload) {
      return res.status(400).json({ success: false, message: 'Invalid webhook payload structure' });
    }

    // 2. Handle Payment Captured / Order Paid
    if (event === 'payment.captured' || event === 'order.paid') {
      const paymentEntity = payload.payment?.entity;
      const orderId = paymentEntity?.order_id || payload.order?.entity?.id;
      const paymentId = paymentEntity?.id;
      const bookingId = paymentEntity?.notes?.bookingId;

      if (!orderId && !bookingId) {
        return res.json({ status: 'ok', message: 'No target order or booking found' });
      }

      const existingPayment = await prisma.escrowPayment.findFirst({
        where: {
          OR: [
            ...(orderId ? [{ gatewayOrderId: orderId }] : []),
            ...(bookingId ? [{ bookingId }] : [])
          ]
        },
        include: { booking: true }
      });

      if (!existingPayment) {
        return res.json({ status: 'ok', message: 'Payment record not yet created' });
      }

      // Idempotency: Never overwrite an already settled payment
      if (existingPayment.status === 'RELEASED_TO_WORKER') {
        return res.json({ status: 'ok', message: 'Payment already processed' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.escrowPayment.update({
          where: { id: existingPayment.id },
          data: {
            status: 'RELEASED_TO_WORKER',
            gatewayPaymentId: paymentId || existingPayment.gatewayPaymentId,
            releasedAt: new Date()
          }
        });

        if (existingPayment.bookingId) {
          await tx.booking.update({
            where: { id: existingPayment.bookingId },
            data: {
              status: 'COMPLETED',
              completedAt: existingPayment.booking?.completedAt || new Date(),
              statusHistory: {
                create: {
                  fromStatus: existingPayment.booking?.status || 'IN_PROGRESS',
                  toStatus: 'COMPLETED',
                  reason: `Webhook confirmed payment capture (${paymentId || orderId})`
                }
              }
            }
          });
        }
      });

      if (existingPayment.bookingId) {
        stopBookingTracking(existingPayment.bookingId, 'Service completed via webhook payment capture.');
      }
    }

    // 3. Handle Payment Failed
    if (event === 'payment.failed') {
      const paymentEntity = payload.payment?.entity;
      const orderId = paymentEntity?.order_id;
      const reason = paymentEntity?.error_description || 'Payment failed on Razorpay';

      if (orderId) {
        const existingPayment = await prisma.escrowPayment.findFirst({
          where: { gatewayOrderId: orderId }
        });

        // Never overwrite an already successful payment
        if (existingPayment && existingPayment.status !== 'RELEASED_TO_WORKER') {
          await prisma.escrowPayment.update({
            where: { id: existingPayment.id },
            data: {
              status: 'FAILED',
              refundReason: reason
            }
          });
        }
      }
    }

    return res.json({ status: 'ok' });
  } catch (error) {
    console.error('[Razorpay Webhook] Webhook processing error:', error);
    return res.status(500).json({ success: false, message: 'Webhook processing error', error: error.message });
  }
};
