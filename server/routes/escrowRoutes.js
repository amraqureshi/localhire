// LocalHire - Escrow Routes
// Isolated route definitions for job payment escrow services

const express = require('express');
const router = express.Router();
const {
  fundEscrow,
  releaseEscrow,
  disputeEscrow,
  getJobEscrow,
  getUserLedger,
  getEscrowProviderStatus
} = require('../controllers/escrowController');
const { protect } = require('../middlewares/authMiddleware');

router.get('/status', (req, res) => {
  res.json({ success: true, ...getEscrowProviderStatus() });
});

router.post('/fund', protect, fundEscrow);
router.post('/release', protect, releaseEscrow);
router.post('/dispute', protect, disputeEscrow);
router.get('/job/:jobId', protect, getJobEscrow);
router.get('/booking/:bookingId', protect, getJobEscrow);
router.get('/ledger', protect, getUserLedger);

module.exports = router;
