const prisma = require('../config/prisma');
const { getSocketServer } = require('../trackingState');

const MESSAGE_MAX_LENGTH = 2000;

const normalizeMessage = (message) => ({
  id: message.id,
  sender: message.senderId,
  receiver: message.receiverId,
  senderId: message.senderId,
  receiverId: message.receiverId,
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

// @desc    Get all active conversations for the current user with counterparty info and unread counts
// @route   GET /api/chat/conversations
// @access  Private
exports.getConversations = async (req, res) => {
  try {
    const currentUserId = String(req.user.id);

    const conversations = await prisma.conversation.findMany({
      where: {
        OR: [
          { user1Id: currentUserId },
          { user2Id: currentUserId }
        ]
      },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        user1: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            role: true
          }
        },
        user2: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            role: true
          }
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    // Query unread message counts for each conversation
    const unreadGroups = await prisma.chatMessage.groupBy({
      by: ['conversationId'],
      where: {
        receiverId: currentUserId,
        isRead: false
      },
      _count: { id: true }
    });
    const unreadMap = new Map(unreadGroups.map((u) => [u.conversationId, u._count.id]));

    const formatted = conversations.map((c) => {
      const isUser1Current = c.user1Id === currentUserId;
      const counterpartyUser = isUser1Current ? c.user2 : c.user1;
      const lastMsg = c.messages[0] || null;

      const roleName = counterpartyUser?.role === 'WORKER' ? 'Worker' : (counterpartyUser?.role === 'ADMIN' ? 'Admin' : 'Customer');

      return {
        id: c.id,
        conversationId: c.id,
        counterparty: {
          id: counterpartyUser?.id || '',
          name: counterpartyUser?.name || 'User',
          avatar: counterpartyUser?.avatarUrl || null,
          avatarUrl: counterpartyUser?.avatarUrl || null,
          role: roleName
        },
        lastMessage: lastMsg ? {
          id: lastMsg.id,
          content: lastMsg.content,
          senderId: lastMsg.senderId,
          createdAt: lastMsg.createdAt,
          isRead: lastMsg.isRead
        } : null,
        lastMessageText: lastMsg ? lastMsg.content : '',
        timestamp: lastMsg?.createdAt || c.lastMessageAt || c.updatedAt,
        unreadCount: unreadMap.get(c.id) || 0
      };
    });

    formatted.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.json({
      success: true,
      count: formatted.length,
      conversations: formatted
    });
  } catch (error) {
    console.error('[Chat Controller] getConversations error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving conversations' });
  }
};

// @desc    Mark all messages in a conversation as read
// @route   PATCH /api/chat/conversations/:id/read
// @access  Private
exports.markAsRead = async (req, res) => {
  try {
    const currentUserId = String(req.user.id);
    const targetId = String(req.params.id);

    // Check if targetId is conversationId or otherUserId
    let conversation = await prisma.conversation.findUnique({
      where: { id: targetId }
    });

    if (!conversation) {
      const [u1, u2] = [currentUserId, targetId].sort();
      conversation = await prisma.conversation.findUnique({
        where: { user1Id_user2Id: { user1Id: u1, user2Id: u2 } }
      });
    }

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    if (conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId) {
      return res.status(403).json({ success: false, message: 'Not authorized for this conversation' });
    }

    const updateResult = await prisma.chatMessage.updateMany({
      where: {
        conversationId: conversation.id,
        receiverId: currentUserId,
        isRead: false
      },
      data: {
        isRead: true,
        readAt: new Date()
      }
    });

    return res.json({
      success: true,
      message: 'Messages marked as read',
      markedCount: updateResult.count,
      conversationId: conversation.id
    });
  } catch (error) {
    console.error('[Chat Controller] markAsRead error:', error);
    return res.status(500).json({ success: false, message: 'Server error marking messages as read' });
  }
};

// @desc    Get user info for chat header
// @route   GET /api/chat/user/:id
// @access  Private
exports.getChatUser = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        role: true,
        workerProfile: {
          select: {
            businessName: true,
            primaryCategory: { select: { name: true } }
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        avatarUrl: user.avatarUrl,
        avatar: user.avatarUrl,
        role: user.role === 'WORKER' ? 'Worker' : (user.role === 'ADMIN' ? 'Admin' : 'Customer'),
        subtitle: user.workerProfile?.primaryCategory?.name || user.workerProfile?.businessName || (user.role === 'WORKER' ? 'Service Professional' : 'Customer')
      }
    });
  } catch (error) {
    console.error('[Chat Controller] getChatUser error:', error);
    return res.status(500).json({ success: false, message: 'Error retrieving user details' });
  }
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

    // Mark unread messages from otherUser as read
    await prisma.chatMessage.updateMany({
      where: {
        senderId: String(otherUserId),
        receiverId: String(currentUserId),
        isRead: false
      },
      data: {
        isRead: true,
        readAt: new Date()
      }
    }).catch((err) => console.warn('[Chat Controller] Auto mark-as-read warning:', err.message));

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

    const normalized = normalizeMessage(message);

    // Emit live Socket.IO update if socket server is initialized
    const io = getSocketServer();
    if (io) {
      const roomId = [String(senderId), String(receiverId)].sort().join('_');
      io.to(roomId).emit('receive_message', normalized);
      io.to(`user:${senderId}`).emit('conversation:updated', { conversationId: conversation.id, message: normalized });
      io.to(`user:${receiverId}`).emit('conversation:updated', { conversationId: conversation.id, message: normalized });
    }

    return res.status(201).json({
      success: true,
      message: normalized
    });
  } catch (error) {
    console.error('[Chat Controller] sendMessage error:', error);
    return res.status(500).json({ success: false, message: 'Server error sending message' });
  }
};

exports.ensureAuthorizedChatParticipants = ensureAuthorizedChatParticipants;
exports.normalizeMessage = normalizeMessage;
