// LocalHire - Booking Routes
// Routes for creating bookings, fetching assigned bookings, and updating status.
// Strictly protected with authentication and role-based access control.

const express = require('express');
const {
  createBooking,
  getMyBookings,
  getBookingById,
  updateBookingStatus
} = require('../controllers/bookingController');
const { protect, authorize } = require('../middlewares/authMiddleware');

const router = express.Router();

// Customer or Admin can initiate a booking
router.post('/', protect, authorize('Customer', 'Admin'), createBooking);

// Retrieve current authenticated user's bookings (Customer sees requested, Worker sees assigned)
router.get('/my', protect, getMyBookings);

// Specific booking details (ownership validated on server)
router.get('/:id', protect, getBookingById);

// Update status (e.g. Worker confirms/starts/completes, Customer cancels)
router.put('/:id/status', protect, updateBookingStatus);

module.exports = router;
