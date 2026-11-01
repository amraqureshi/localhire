const express = require('express');
const {
  getConversations,
  getMessages,
  sendMessage,
  markAsRead,
  getChatUser
} = require('../controllers/chatController');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/conversations', getConversations);
router.patch('/conversations/:id/read', markAsRead);
router.patch('/read/:id', markAsRead);
router.get('/user/:id', getChatUser);
router.get('/messages/:otherUserId', getMessages);
router.post('/messages', sendMessage);

module.exports = router;
