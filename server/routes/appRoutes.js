const express = require('express');
const { createApplication, getApplicationsForJob, getWorkerApplications, acceptQuote } = require('../controllers/appController');
const { protect, authorize } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/', protect, authorize('Worker', 'Admin'), createApplication);
router.get('/job/:jobId', protect, getApplicationsForJob);
router.get('/worker/me', protect, authorize('Worker', 'Admin'), getWorkerApplications);
router.put('/:id/accept', protect, authorize('Customer', 'Admin'), acceptQuote);

module.exports = router;
