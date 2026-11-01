// LocalHire - Escrow Routes
// Isolated route definitions for job payment escrow services

const express = require('express');
const router = express.Router();
const {
  fundEscrow,
  releaseEscrow,
  disputeEscrow,
  refundEscrow,
  getJobEscrow,
  getUserLedger,
  getEscrowProviderStatus
} = require('../controllers/escrowController');
const {
  getRazorpayConfig,
  createPaymentOrder,
  verifyPayment,
  handleWebhook
} = require('../controllers/razorpayController');
const { protect } = require('../middlewares/authMiddleware');

router.get('/status', (req, res) => {
  res.json({ success: true, ...getEscrowProviderStatus() });
});

// Razorpay Payment Routes (Phase 6)
router.get('/razorpay/config', getRazorpayConfig);
router.post('/razorpay/create-order', protect, createPaymentOrder);
router.post('/razorpay/verify-payment', protect, verifyPayment);
router.post('/razorpay/webhook', handleWebhook);

router.post('/fund', protect, fundEscrow);
router.post('/release', protect, releaseEscrow);
router.post('/dispute', protect, disputeEscrow);
router.post('/refund', protect, refundEscrow);
router.get('/job/:jobId', protect, getJobEscrow);
router.get('/booking/:bookingId', protect, getJobEscrow);
router.get('/ledger', protect, getUserLedger);

module.exports = router;
