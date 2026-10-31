const express = require('express');
const { createReview, getWorkerReviews } = require('../controllers/reviewController');
const { protect, authorize } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/', protect, authorize('Customer', 'Admin'), createReview);
router.get('/worker/:workerId', getWorkerReviews);

module.exports = router;
