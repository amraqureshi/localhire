const prisma = require('../config/prisma');

const normalizeReview = (review) => ({
  id: review.id,
  job: review.booking?.jobPostId || null,
  worker: review.workerId,
  customer: review.customer ? {
    id: review.customer.id,
    name: review.customer.name,
    avatarUrl: review.customer.avatarUrl
  } : { id: review.customerId },
  rating: Number(review.rating),
  comment: review.comment,
  createdAt: review.createdAt,
  isVerified: review.isVerified
});

// @desc    Add review for a worker
// @route   POST /api/reviews
// @access  Private (Customer)
exports.createReview = async (req, res) => {
  try {
    const { jobId, workerId, rating, comment } = req.body;
    const customerId = req.user.id;

    if (!jobId || !workerId || !rating) {
      return res.status(400).json({ success: false, message: 'Job ID, worker ID, and rating are required' });
    }

    const ratingValue = Number(rating);
    if (!Number.isFinite(ratingValue) || ratingValue < 1 || ratingValue > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be a number between 1 and 5' });
    }

    const booking = await prisma.booking.findFirst({
      where: {
        jobPostId: String(jobId),
        customerId,
        workerId: String(workerId),
        status: 'COMPLETED'
      }
    });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Completed booking for this job and worker was not found' });
    }

    const existingReview = await prisma.review.findUnique({ where: { bookingId: booking.id } });
    if (existingReview) {
      return res.status(409).json({ success: false, message: 'A review already exists for this booking' });
    }

    const review = await prisma.review.create({
      data: {
        bookingId: booking.id,
        customerId,
        workerId: String(workerId),
        rating: Math.round(ratingValue),
        comment: String(comment || ''),
        isVerified: true
      },
      include: {
        customer: {
          select: { id: true, name: true, avatarUrl: true }
        },
        booking: {
          select: { jobPostId: true }
        }
      }
    });

    const reviews = await prisma.review.findMany({ where: { workerId: String(workerId) } });
    const avgRating = reviews.length
      ? reviews.reduce((acc, item) => acc + item.rating, 0) / reviews.length
      : ratingValue;

    await prisma.workerProfile.updateMany({
      where: { userId: String(workerId) },
      data: {
        rating: Number(avgRating.toFixed(2)),
        reviewsCount: reviews.length
      }
    });

    res.status(201).json({
      success: true,
      review: normalizeReview(review),
      updatedRating: avgRating.toFixed(1)
    });
  } catch (error) {
    console.error('[Review Controller] createReview error:', error);
    res.status(500).json({ success: false, message: 'Server error creating review' });
  }
};

// @desc    Get reviews for a worker
// @route   GET /api/reviews/worker/:workerId
// @access  Public
exports.getWorkerReviews = async (req, res) => {
  try {
    const reviews = await prisma.review.findMany({
      where: { workerId: req.params.workerId },
      include: {
        customer: {
          select: { id: true, name: true, avatarUrl: true }
        },
        booking: {
          select: { jobPostId: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      count: reviews.length,
      reviews: reviews.map(normalizeReview)
    });
  } catch (error) {
    console.error('[Review Controller] getWorkerReviews error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving reviews' });
  }
};
