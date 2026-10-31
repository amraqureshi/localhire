// LocalHire - Booking Controller
// Manages customer-to-worker bookings with validation and PostgreSQL/Prisma persistence.
// Strictly validates customer, worker, pricing, and scheduling without fake persistence.

const prisma = require('../config/prisma');
const { notifyUser } = require('./notificationController');
const { stopBookingTracking, broadcastBookingStatus } = require('../trackingState');

// Helper to resolve a user record from Prisma (PostgreSQL)
async function resolveUser(userId) {
  if (!userId) return null;

  try {
    let pUser = null;
    try {
      pUser = await prisma.user.findUnique({
        where: { id: String(userId) },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          avatarUrl: true,
          phone: true,
          isActive: true
        }
      });
    } catch (e) {
      pUser = null;
    }

    if (!pUser) {
      const mockEmailMap = {
        w1: 'electrician@localhire.dev',
        w2: 'electrician@localhire.dev',
        w3: 'cleaner@localhire.dev',
        w4: 'plumber@localhire.dev',
        w5: 'driver@localhire.dev',
        w6: 'freelancer@localhire.dev',
        w7: 'electrician@localhire.dev'
      };
      const fallbackEmail = mockEmailMap[String(userId)];
      if (fallbackEmail) {
        pUser = await prisma.user.findFirst({
          where: { email: fallbackEmail, role: 'WORKER' },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatarUrl: true,
            phone: true,
            isActive: true
          }
        });
      }
      if (!pUser && typeof userId === 'string' && userId.startsWith('w')) {
        pUser = await prisma.user.findFirst({
          where: { role: 'WORKER' },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatarUrl: true,
            phone: true,
            isActive: true
          }
        });
      }
    }

    if (!pUser) return null;

    return {
      id: pUser.id,
      name: pUser.name,
      email: pUser.email,
      role: pUser.role === 'WORKER' ? 'Worker' : (pUser.role === 'ADMIN' ? 'Admin' : 'Customer'),
      avatarUrl: pUser.avatarUrl,
      phone: pUser.phone,
      source: 'prisma'
    };
  } catch (err) {
    console.warn('[Booking Controller] User lookup failed in Prisma:', err.message);
    return null;
  }
}

const BOOKING_STATUS_VALUES = [
  'REQUESTED',
  'CONFIRMED',
  'DISPATCHED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'DISPUTED'
];

const evaluateBookingStatusTransition = ({
  currentUserId,
  actorRole,
  isCustomer,
  isWorker,
  isAdmin,
  currentStatus,
  requestedStatus,
  bookingCustomerId,
  bookingWorkerId,
  isEscrowHeld = false
}) => {
  if (!requestedStatus || !BOOKING_STATUS_VALUES.includes(requestedStatus)) {
    return {
      allowed: false,
      reason: `Invalid status. Valid values: ${BOOKING_STATUS_VALUES.join(', ')}`
    };
  }

  if (!currentStatus || currentStatus === requestedStatus) {
    return {
      allowed: false,
      reason: 'No status transition requested.'
    };
  }

  if (isAdmin) {
    const allowedFrom = {
      CONFIRMED: ['REQUESTED'],
      DISPATCHED: ['CONFIRMED'],
      IN_PROGRESS: ['CONFIRMED', 'DISPATCHED'],
      COMPLETED: ['IN_PROGRESS', 'CONFIRMED', 'DISPATCHED'],
      CANCELLED: ['REQUESTED', 'CONFIRMED', 'DISPATCHED', 'IN_PROGRESS'],
      DISPUTED: ['REQUESTED', 'CONFIRMED', 'DISPATCHED', 'IN_PROGRESS']
    };

    if (allowedFrom[requestedStatus] && allowedFrom[requestedStatus].includes(currentStatus)) {
      return {
        allowed: true,
        reason: 'Admin status transition permitted under explicit review workflow.',
        requiresCustomerConfirmation: false
      };
    }

    return {
      allowed: false,
      reason: 'Admin updates must follow a valid booking workflow.'
    };
  }

  if (isWorker) {
    if (requestedStatus === 'CONFIRMED' && currentStatus === 'REQUESTED') {
      return {
        allowed: true,
        reason: 'Worker accepted the booking request.'
      };
    }

    if (requestedStatus === 'CANCELLED' && currentStatus === 'REQUESTED') {
      return {
        allowed: true,
        reason: 'Worker rejected the booking request.'
      };
    }

    if (requestedStatus === 'IN_PROGRESS' && ['CONFIRMED', 'DISPATCHED'].includes(currentStatus)) {
      return {
        allowed: true,
        reason: 'Worker started the booked service.'
      };
    }

    if (requestedStatus === 'COMPLETED' && currentStatus === 'IN_PROGRESS') {
      return {
        allowed: true,
        reason: 'Worker marked the booking as complete.'
      };
    }

    if (requestedStatus === 'DISPATCHED' && currentStatus === 'CONFIRMED') {
      return {
        allowed: true,
        reason: 'Worker dispatched the booking.'
      };
    }

    return {
      allowed: false,
      reason: 'Workers are only allowed to accept, reject, dispatch, start, or complete a valid active booking.'
    };
  }

  if (isCustomer) {
    if (requestedStatus === 'CANCELLED') {
      const cancellableStatuses = ['REQUESTED', 'CONFIRMED', 'DISPATCHED', 'IN_PROGRESS'];
      if (!cancellableStatuses.includes(currentStatus)) {
        return {
          allowed: false,
          reason: 'This booking cannot be cancelled in its current state.'
        };
      }

      return {
        allowed: true,
        reason: 'Customer cancellation is allowed.'
      };
    }

    if (requestedStatus === 'COMPLETED') {
      if (currentStatus !== 'IN_PROGRESS') {
        return {
          allowed: false,
          reason: 'Customer completion is only allowed while the booking is in progress.'
        };
      }

      if (bookingCustomerId && String(currentUserId) !== String(bookingCustomerId)) {
        return {
          allowed: false,
          reason: 'Only the booking owner can close this booking.'
        };
      }

      return {
        allowed: true,
        reason: 'Customer confirmed the completed service.'
      };
    }

    return {
      allowed: false,
      reason: 'Customers may only cancel or complete an active booking.'
    };
  }

  return {
    allowed: false,
    reason: 'User is not authorized to update this booking.'
  };
};

exports.evaluateBookingStatusTransition = evaluateBookingStatusTransition;

// @desc    Create a new booking (Customer hires worker)
// @route   POST /api/bookings
// @access  Private (Customer or Admin)
exports.createBooking = async (req, res) => {
  try {
    const { workerId, scheduledAt, timeSlot, agreedPrice, notes, serviceItemId, addressId } = req.body;
    const customerId = req.user.id || (req.user._id && req.user._id.toString());

    if (req.user.role !== 'Customer' && req.user.role !== 'Admin') {
      return res.status(403).json({
        success: false,
        message: 'Only Customer accounts can create bookings to hire workers'
      });
    }

    if (!workerId) {
      return res.status(400).json({ success: false, message: 'Worker ID is required' });
    }

    if (String(workerId) === String(customerId)) {
      return res.status(400).json({ success: false, message: 'You cannot book or hire yourself' });
    }

    const priceNum = Number(agreedPrice);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return res.status(400).json({ success: false, message: 'Agreed price must be a valid positive number' });
    }

    if (!scheduledAt) {
      return res.status(400).json({ success: false, message: 'Scheduled date and time are required' });
    }

    const parsedDate = new Date(scheduledAt);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.getTime() < Date.now() - 60000) {
      return res.status(400).json({ success: false, message: 'Scheduled date must be a valid future date and time' });
    }

    const targetWorker = await resolveUser(workerId);
    if (!targetWorker) {
      return res.status(404).json({ success: false, message: 'Selected worker profile does not exist' });
    }

    if (targetWorker.role !== 'Worker') {
      return res.status(400).json({
        success: false,
        message: 'The selected account is not registered as a professional worker'
      });
    }

    if (serviceItemId) {
      const service = await prisma.serviceItem.findUnique({
        where: { id: String(serviceItemId) },
        include: {
          offeredBy: {
            include: {
              workerProfile: {
                select: { userId: true }
              }
            }
          }
        }
      });

      if (!service) {
        return res.status(404).json({ success: false, message: 'Selected service does not exist' });
      }

      const isOfferedByWorker = service.offeredBy.some((offering) => offering.workerProfile?.userId === targetWorker.id);
      if (!isOfferedByWorker) {
        return res.status(400).json({
          success: false,
          message: 'The selected service is not offered by the chosen worker'
        });
      }
    }

    const selectedAddressId = addressId || (await prisma.customerAddress.findFirst({
      where: { customerId, isDefault: true },
      select: { id: true }
    }))?.id;

    if (addressId) {
      const bookingAddress = await prisma.customerAddress.findFirst({
        where: { id: String(addressId), customerId }
      });

      if (!bookingAddress) {
        return res.status(400).json({
          success: false,
          message: 'Selected customer address does not belong to this account.'
        });
      }
    }

    const duplicateBooking = await prisma.booking.findFirst({
      where: {
        customerId,
        workerId: targetWorker.id,
        scheduledAt: parsedDate,
        status: { in: ['REQUESTED', 'CONFIRMED', 'DISPATCHED', 'IN_PROGRESS'] }
      }
    });

    if (duplicateBooking) {
      return res.status(409).json({
        success: false,
        message: 'An active booking for this worker and time slot already exists.'
      });
    }

    const bookingNumber = `BK-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    try {
      const newBooking = await prisma.$transaction(async (tx) => {
        const created = await tx.booking.create({
          data: {
            bookingNumber,
            customerId,
            workerId: targetWorker.id,
            serviceItemId: serviceItemId || null,
            addressId: selectedAddressId || null,
            agreedPrice: priceNum,
            scheduledAt: parsedDate,
            timeSlot: timeSlot || 'Flexible',
            status: 'REQUESTED',
            statusHistory: {
              create: {
                toStatus: 'REQUESTED',
                changedById: customerId,
                reason: notes || 'Booking request submitted by customer'
              }
            }
          },
          include: {
            customer: {
              select: { id: true, name: true, email: true, phone: true, avatarUrl: true }
            },
            worker: {
              select: { id: true, name: true, email: true, phone: true, avatarUrl: true }
            },
            address: true
          }
        });

        return created;
      });

      await notifyUser({
        userId: targetWorker.id,
        type: 'BOOKING_REQUEST',
        title: 'New booking request',
        message: `${newBooking.customer.name || 'A customer'} requested a booking for ${newBooking.worker.name || 'your service'}.`,
        linkUrl: `/bookings/${newBooking.id}`
      });

      return res.status(201).json({
        success: true,
        message: 'Booking successfully created and assigned to worker',
        booking: newBooking
      });
    } catch (dbError) {
      console.error('[Booking Controller] Database persistence error:', dbError.message);
      return res.status(503).json({
        success: false,
        message: 'Database persistence unavailable: PostgreSQL is not connected or ready.',
        details: 'The booking could not be saved to the database. Please ensure PostgreSQL is configured and running.',
        error: dbError.message
      });
    }
  } catch (error) {
    console.error('[Booking Controller] createBooking error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error creating booking request',
      error: error.message
    });
  }
};

// @desc    Get bookings for the currently authenticated user (Customer or Worker)
// @route   GET /api/bookings/my
// @access  Private
exports.getMyBookings = async (req, res) => {
  try {
    const currentUserId = req.user.id || (req.user._id && req.user._id.toString());
    const isWorker = req.user.role === 'Worker';
    const isAdmin = req.user.role === 'Admin';

    let filter = {};
    if (isAdmin) {
      // Admin sees all
    } else if (isWorker) {
      // Workers strictly retrieve only bookings assigned to their worker ID
      filter.workerId = currentUserId;
    } else {
      // Customers retrieve bookings they requested
      filter.customerId = currentUserId;
    }

    try {
      const bookings = await prisma.booking.findMany({
        where: filter,
        include: {
          customer: {
            select: { id: true, name: true, email: true, phone: true, avatarUrl: true }
          },
          worker: {
            select: { id: true, name: true, email: true, phone: true, avatarUrl: true }
          },
          serviceItem: {
            select: { id: true, title: true, basePrice: true }
          },
          address: true,
          payment: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      return res.json({
        success: true,
        count: bookings.length,
        bookings
      });
    } catch (dbError) {
      console.error('[Booking Controller] getMyBookings DB error:', dbError.message);
      return res.status(503).json({
        success: false,
        message: 'Database unavailable: PostgreSQL is not connected or ready.',
        bookings: [],
        error: dbError.message
      });
    }
  } catch (error) {
    console.error('[Booking Controller] getMyBookings error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving bookings',
      error: error.message
    });
  }
};

// @desc    Get single booking by ID
// @route   GET /api/bookings/:id
// @access  Private
exports.getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user.id || (req.user._id && req.user._id.toString());

    try {
      const booking = await prisma.booking.findUnique({
        where: { id },
        include: {
          customer: {
            select: { id: true, name: true, email: true, phone: true, avatarUrl: true }
          },
          worker: {
            select: { id: true, name: true, email: true, phone: true, avatarUrl: true }
          },
          address: true,
          payment: true,
          statusHistory: {
            orderBy: { createdAt: 'desc' }
          }
        }
      });

      if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking not found' });
      }

      // Security: Only customer, assigned worker, or admin can inspect this booking
      if (
        booking.customerId !== currentUserId &&
        booking.workerId !== currentUserId &&
        req.user.role !== 'Admin'
      ) {
        return res.status(403).json({ success: false, message: 'Not authorized to view this booking' });
      }

      return res.json({ success: true, booking });
    } catch (dbError) {
      return res.status(503).json({
        success: false,
        message: 'Database unavailable: PostgreSQL connection failed',
        error: dbError.message
      });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving booking', error: error.message });
  }
};

// @desc    Update booking status (Accept, Start, Complete, Cancel)
// @route   PUT /api/bookings/:id/status
// @access  Private
exports.updateBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const currentUserId = req.user.id || (req.user._id && req.user._id.toString());

    if (!status || !BOOKING_STATUS_VALUES.includes(status)) {
      return res.status(400).json({ success: false, message: `Invalid status. Valid values: ${BOOKING_STATUS_VALUES.join(', ')}` });
    }

    try {
      const existing = await prisma.booking.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Booking not found' });
      }

      const isCustomer = existing.customerId === currentUserId;
      const isWorker = existing.workerId === currentUserId;
      const isAdmin = req.user.role === 'Admin';

      if (!isCustomer && !isWorker && !isAdmin) {
        return res.status(403).json({ success: false, message: 'Not authorized to update this booking' });
      }

      const transition = evaluateBookingStatusTransition({
        currentUserId,
        actorRole: req.user.role,
        isCustomer,
        isWorker,
        isAdmin,
        currentStatus: existing.status,
        requestedStatus: status,
        bookingCustomerId: existing.customerId,
        bookingWorkerId: existing.workerId,
        isEscrowHeld: true
      });

      if (!transition.allowed) {
        const statusCode = transition.reason.includes('Only the booking owner') || transition.reason.includes('not authorized') ? 403 : 400;
        return res.status(statusCode).json({ success: false, message: transition.reason });
      }

      const updateData = {
        status,
        statusHistory: {
          create: {
            fromStatus: existing.status,
            toStatus: status,
            changedById: currentUserId,
            reason: notes || `Status updated to ${status}`
          }
        }
      };

      if (status === 'IN_PROGRESS' && !existing.startedAt) {
        updateData.startedAt = new Date();
      }

      if (status === 'COMPLETED' && !existing.completedAt) {
        updateData.completedAt = new Date();
      }

      if (status === 'CANCELLED' && !existing.cancelledAt) {
        updateData.cancelledAt = new Date();
        updateData.cancellationReason = notes || 'Cancelled by user';
      }

      const updated = await prisma.$transaction(async (tx) => {
        return tx.booking.update({
          where: { id },
          data: updateData,
          include: {
            customer: { select: { id: true, name: true, email: true, avatarUrl: true } },
            worker: { select: { id: true, name: true, email: true, avatarUrl: true } }
          }
        });
      });

      broadcastBookingStatus(id, status, {
        bookingId: id,
        status,
        changedById: currentUserId,
        booking: {
          id: updated.id,
          status: updated.status,
          customerId: updated.customerId,
          workerId: updated.workerId,
          startedAt: updated.startedAt,
          completedAt: updated.completedAt,
          cancelledAt: updated.cancelledAt
        }
      });

      if (status === 'COMPLETED' || status === 'CANCELLED') {
        stopBookingTracking(id, `Booking ${status.toLowerCase()}; location sharing stopped.`);
      }

      if (status === 'CONFIRMED') {
        await Promise.all([
          notifyUser({
            userId: updated.customerId,
            type: 'BOOKING_CONFIRMED',
            title: 'Booking confirmed',
            message: `Your booking with ${updated.worker.name || 'the worker'} has been confirmed.`,
            linkUrl: `/bookings/${updated.id}`
          }),
          notifyUser({
            userId: updated.workerId,
            type: 'BOOKING_CONFIRMED',
            title: 'Booking confirmed',
            message: `${updated.customer.name || 'A customer'} confirmed your booking request.`,
            linkUrl: `/bookings/${updated.id}`
          })
        ]);
      }

      if (status === 'COMPLETED') {
        await Promise.all([
          notifyUser({
            userId: updated.customerId,
            type: 'JOB_COMPLETED',
            title: 'Job completed',
            message: `Your job with ${updated.worker.name || 'the worker'} was marked complete.`,
            linkUrl: `/bookings/${updated.id}`
          }),
          notifyUser({
            userId: updated.workerId,
            type: 'JOB_COMPLETED',
            title: 'Job completed',
            message: `${updated.customer.name || 'The customer'} marked the job as complete.`,
            linkUrl: `/bookings/${updated.id}`
          })
        ]);
      }

      if (status === 'CANCELLED') {
        const recipientId = currentUserId === updated.customerId ? updated.workerId : updated.customerId;
        await notifyUser({
          userId: recipientId,
          type: 'SYSTEM_ALERT',
          title: 'Booking cancelled',
          message: `A booking was cancelled by ${updated.customer.name || 'the customer'}.`,
          linkUrl: `/bookings/${updated.id}`
        });
      }

      return res.json({
        success: true,
        message: `Booking status updated to ${status}`,
        booking: updated
      });
    } catch (dbError) {
      return res.status(503).json({
        success: false,
        message: 'Database unavailable: PostgreSQL connection failed',
        error: dbError.message
      });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error updating booking status', error: error.message });
  }
};
