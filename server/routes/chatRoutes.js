const express = require('express');
const { getMessages, sendMessage } = require('../controllers/chatController');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/messages/:otherUserId', protect, getMessages);
router.post('/messages', protect, sendMessage);

module.exports = router;
