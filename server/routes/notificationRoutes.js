const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { getNotificationsForUser, markNotificationRead } = require('../controllers/notificationController');

router.get('/', protect, async (req, res) => {
  try {
    const notifications = await getNotificationsForUser(req.user.id, { limit: 50 });
    return res.json({ success: true, notifications });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to load notifications', error: error.message });
  }
});

router.patch('/:id/read', protect, async (req, res) => {
  try {
    const result = await markNotificationRead(req.params.id, req.user.id);
    return res.json({
      success: true,
      updated: !!result,
      message: result ? 'Notification marked as read.' : 'Notification update skipped.'
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to update notification', error: error.message });
  }
});

module.exports = router;
