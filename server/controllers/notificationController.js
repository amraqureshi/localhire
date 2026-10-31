const prisma = require('../config/prisma');

const VALID_NOTIFICATION_TYPES = [
  'BOOKING_REQUEST',
  'BOOKING_CONFIRMED',
  'QUOTE_RECEIVED',
  'QUOTE_ACCEPTED',
  'PAYMENT_HELD',
  'PAYMENT_RELEASED',
  'JOB_COMPLETED',
  'NEW_MESSAGE',
  'REVIEW_SUBMITTED',
  'SYSTEM_ALERT'
];

const buildNotificationPayload = ({ userId, type, title, message, linkUrl = null }) => {
  if (!userId) {
    throw new Error('Notification requires a target userId');
  }

  const safeType = String(type || 'SYSTEM_ALERT').toUpperCase();
  if (!VALID_NOTIFICATION_TYPES.includes(safeType)) {
    throw new Error(`Unsupported notification type: ${type}`);
  }

  return {
    userId: String(userId),
    type: safeType,
    title: String(title || 'LocalHire update').trim(),
    message: String(message || 'You have a new update.').trim(),
    linkUrl
  };
};

const notifyUser = async ({ userId, type, title, message, linkUrl }) => {
  try {
    const payload = buildNotificationPayload({ userId, type, title, message, linkUrl });
    return await prisma.notification.create({ data: payload });
  } catch (error) {
    console.warn('[Notification Controller] Could not create notification:', error.message);
    return null;
  }
};

const getNotificationsForUser = async (userId, { limit = 20 } = {}) => {
  if (!userId) return [];

  try {
    return await prisma.notification.findMany({
      where: { userId: String(userId) },
      orderBy: { createdAt: 'desc' },
      take: Number(limit) || 20
    });
  } catch (error) {
    console.warn('[Notification Controller] Could not fetch notifications:', error.message);
    return [];
  }
};

const markNotificationRead = async (notificationId, userId) => {
  if (!notificationId || !userId) {
    return null;
  }

  try {
    return await prisma.notification.updateMany({
      where: {
        id: String(notificationId),
        userId: String(userId)
      },
      data: { isRead: true }
    });
  } catch (error) {
    console.warn('[Notification Controller] Could not mark notification as read:', error.message);
    return null;
  }
};

module.exports = {
  VALID_NOTIFICATION_TYPES,
  buildNotificationPayload,
  notifyUser,
  getNotificationsForUser,
  markNotificationRead
};
