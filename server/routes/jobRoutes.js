const express = require('express');
const { getJobs, getJobById, createJob, updateJobStatus } = require('../controllers/jobController');
const { protect, authorize } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/', getJobs);
router.get('/:id', getJobById);
router.post('/', protect, authorize('Customer', 'Admin'), createJob);
router.put('/:id/status', protect, updateJobStatus);

module.exports = router;
