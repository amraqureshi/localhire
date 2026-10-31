const express = require('express');
const {
  getWorkers,
  getWorkerById,
  getMyLocationSharing,
  updateMyLocationSharing,
  updateProfile,
  uploadAvatar,
  deleteAvatar
} = require('../controllers/userController');
const { upload, handleMulterError } = require('../middlewares/uploadMiddleware');
const {
  getCurrentLocation,
  saveCurrentLocation,
  getMyAddresses,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress
} = require('../controllers/addressController');
const { protect, authorize, forbidRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

// 'Find Workers' search directory: restricted from Worker accounts
router.get('/workers', forbidRoles('Worker'), getWorkers);
router.get('/workers/:id', getWorkerById);
router.get('/addresses', protect, getMyAddresses);
router.post('/addresses', protect, createAddress);
router.put('/addresses/:id', protect, updateAddress);
router.patch('/addresses/:id/default', protect, setDefaultAddress);
router.delete('/addresses/:id', protect, deleteAddress);
router.get('/current-location', protect, authorize('Customer'), getCurrentLocation);
router.patch('/current-location', protect, authorize('Customer'), saveCurrentLocation);
router.get('/location', protect, authorize('Worker'), getMyLocationSharing);
router.patch('/location', protect, authorize('Worker'), updateMyLocationSharing);
router.put('/profile', protect, updateProfile);

// Profile photo upload & deletion routes (Customers and Workers)
router.post('/avatar', protect, upload.single('avatar'), handleMulterError, uploadAvatar);
router.delete('/avatar', protect, deleteAvatar);

module.exports = router;
