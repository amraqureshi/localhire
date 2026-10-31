const express = require('express');
const router = express.Router();
const {
  getMetrics,
  getAllUsers,
  deleteUser,
  deleteJob
} = require('../controllers/adminController');
const { protect, authorize } = require('../middlewares/authMiddleware');

// Protect all admin routes with authentication and Admin role check
router.use(protect);
router.use(authorize('Admin'));

router.get('/metrics', getMetrics);
router.get('/users', getAllUsers);
router.delete('/users/:id', deleteUser);
router.delete('/jobs/:id', deleteJob);

module.exports = router;
