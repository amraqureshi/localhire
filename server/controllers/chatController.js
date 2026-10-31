const prisma = require('../config/prisma');

const MESSAGE_MAX_LENGTH = 2000;

const normalizeMessage = (message) => ({
  id: message.id,
  sender: message.senderId,
  receiver: message.receiverId,
  content: message.content,
  createdAt: message.createdAt,
  isRead: message.isRead,
  conversationId: message.conversationId
});

const getAuthorizedBookingBetweenUsers = async (userAId, userBId) => {
  if (!userAId || !userBId || String(userAId) === String(userBId)) {
    return null;
  }

  return prisma.booking.findFirst({
    where: {
      OR: [
        { customerId: String(userAId), workerId: String(userBId) },
        { customerId: String(userBId), workerId: String(userAId) }
      ]
    },
    select: {
      id: true,
      customerId: true,
      workerId: true,
      status: true,
      scheduledAt: true
    }
  });
};

const ensureAuthorizedChatParticipants = async (currentUserId, otherUserId) => {
  const booking = await getAuthorizedBookingBetweenUsers(currentUserId, otherUserId);

  if (!booking) {
    return {
      authorized: false,
      message: 'You can only message the customer or worker associated with a valid booking.'
    };
  }

  const participantIds = new Set([String(booking.customerId), String(booking.workerId)]);
  if (!participantIds.has(String(currentUserId)) || !participantIds.has(String(otherUserId))) {
    return {
      authorized: false,
      message: 'The chat participants are not authorized for this booking.'
    };
  }

  return { authorized: true, booking };
};

// @desc    Get message history between two users
// @route   GET /api/chat/messages/:otherUserId
// @access  Private
exports.getMessages = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { otherUserId } = req.params;

    const authResult = await ensureAuthorizedChatParticipants(currentUserId, otherUserId);
    if (!authResult.authorized) {
      return res.status(403).json({ success: false, message: authResult.message });
    }

    const messages = await prisma.chatMessage.findMany({
      where: {
        OR: [
          { senderId: currentUserId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: currentUserId }
        ]
      },
      orderBy: { createdAt: 'asc' }
    });

    return res.json({
      success: true,
      count: messages.length,
      messages: messages.map(normalizeMessage)
    });
  } catch (error) {
    console.error('[Chat Controller] getMessages error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving messages' });
  }
};

// @desc    Send a message
// @route   POST /api/chat/messages
// @access  Private
exports.sendMessage = async (req, res) => {
  try {
    const { receiverId, content } = req.body;
    const senderId = req.user.id;

    if (!receiverId) {
      return res.status(400).json({ success: false, message: 'Receiver ID is required' });
    }

    const cleanContent = typeof content === 'string' ? content.trim() : '';
    if (!cleanContent) {
      return res.status(400).json({ success: false, message: 'Message content is required' });
    }

    if (cleanContent.length > MESSAGE_MAX_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Message is too long. Maximum length is ${MESSAGE_MAX_LENGTH} characters.`
      });
    }

    const authResult = await ensureAuthorizedChatParticipants(senderId, receiverId);
    if (!authResult.authorized) {
      return res.status(403).json({ success: false, message: authResult.message });
    }

    const [user1Id, user2Id] = [String(senderId), String(receiverId)].sort();

    const conversation = await prisma.conversation.upsert({
      where: {
        user1Id_user2Id: {
          user1Id,
          user2Id
        }
      },
      update: {
        lastMessageAt: new Date()
      },
      create: {
        user1Id,
        user2Id,
        lastMessageAt: new Date()
      }
    });

    const message = await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: String(senderId),
        receiverId: String(receiverId),
        content: cleanContent,
        isRead: false
      }
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() }
    });

    return res.status(201).json({
      success: true,
      message: normalizeMessage(message)
    });
  } catch (error) {
    console.error('[Chat Controller] sendMessage error:', error);
    return res.status(500).json({ success: false, message: 'Server error sending message' });
  }
};

exports.ensureAuthorizedChatParticipants = ensureAuthorizedChatParticipants;
exports.normalizeMessage = normalizeMessage;
