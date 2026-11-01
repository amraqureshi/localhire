const test = require('node:test');
const assert = require('node:assert/strict');
const chatController = require('../controllers/chatController');
const prisma = require('../config/prisma');

function createMockResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

test('chat access is denied when the two users are not actual booking participants', async () => {
  const originalFindFirst = prisma.booking.findFirst;
  prisma.booking.findFirst = async () => null;

  try {
    const req = { user: { id: 'customer-1' }, params: { otherUserId: 'worker-9' } };
    const res = createMockResponse();

    await chatController.getMessages(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.success, false);
    assert.match(String(res.payload.message).toLowerCase(), /booking|authorized|participants/i);
  } finally {
    prisma.booking.findFirst = originalFindFirst;
  }
});

test('chat message is persisted to Prisma for a valid customer-worker booking pair', async () => {
  const originalFindFirst = prisma.booking.findFirst;
  const originalConversationUpsert = prisma.conversation.upsert;
  const originalCreate = prisma.chatMessage.create;
  const originalUpdate = prisma.conversation.update;

  prisma.booking.findFirst = async () => ({
    id: 'booking-1',
    customerId: 'customer-1',
    workerId: 'worker-2',
    status: 'CONFIRMED'
  });
  prisma.conversation.upsert = async ({ where: { user1Id_user2Id } }) => ({
    id: 'conversation-1',
    user1Id: user1Id_user2Id.user1Id,
    user2Id: user1Id_user2Id.user2Id,
    lastMessageAt: new Date()
  });
  prisma.chatMessage.create = async ({ data }) => ({
    id: 'msg-1',
    conversationId: data.conversationId,
    senderId: data.senderId,
    receiverId: data.receiverId,
    content: data.content,
    isRead: false,
    createdAt: new Date('2026-01-01T00:00:00Z')
  });
  prisma.conversation.update = async () => ({ id: 'conversation-1' });

  try {
    const req = {
      user: { id: 'customer-1' },
      body: { receiverId: 'worker-2', content: 'I am on my way.' }
    };
    const res = createMockResponse();

    await chatController.sendMessage(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.message.content, 'I am on my way.');
    assert.equal(res.payload.message.receiver, 'worker-2');
  } finally {
    prisma.booking.findFirst = originalFindFirst;
    prisma.conversation.upsert = originalConversationUpsert;
    prisma.chatMessage.create = originalCreate;
    prisma.conversation.update = originalUpdate;
  }
});

test('oversized chat content is rejected before saving', async () => {
  const originalFindFirst = prisma.booking.findFirst;
  prisma.booking.findFirst = async () => ({
    id: 'booking-2',
    customerId: 'customer-1',
    workerId: 'worker-2',
    status: 'CONFIRMED'
  });

  try {
    const req = {
      user: { id: 'customer-1' },
      body: { receiverId: 'worker-2', content: 'x'.repeat(6000) }
    };
    const res = createMockResponse();

    await chatController.sendMessage(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.success, false);
    assert.match(String(res.payload.message).toLowerCase(), /too long|maximum|message/i);
  } finally {
    prisma.booking.findFirst = originalFindFirst;
  }
});

test('GET /api/chat/conversations returns conversations with counterparty details, last message, and unread count', async () => {
  const origConvFindMany = prisma.conversation.findMany;
  const origMsgGroupBy = prisma.chatMessage.groupBy;

  try {
    prisma.conversation.findMany = async () => [
      {
        id: 'conv-101',
        user1Id: 'user-me',
        user2Id: 'user-worker-8',
        lastMessageAt: new Date('2026-05-01T10:00:00Z'),
        user1: { id: 'user-me', name: 'My Name', avatarUrl: null, role: 'CUSTOMER' },
        user2: { id: 'user-worker-8', name: 'Bob Electrician', avatarUrl: 'https://example.com/bob.jpg', role: 'WORKER' },
        messages: [
          {
            id: 'msg-99',
            conversationId: 'conv-101',
            senderId: 'user-worker-8',
            receiverId: 'user-me',
            content: 'I will be there at 10 AM.',
            createdAt: new Date('2026-05-01T10:00:00Z'),
            isRead: false
          }
        ]
      }
    ];

    prisma.chatMessage.groupBy = async () => [
      {
        conversationId: 'conv-101',
        _count: { id: 2 }
      }
    ];

    const req = { user: { id: 'user-me' } };
    const res = createMockResponse();

    await chatController.getConversations(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.count, 1);

    const conv = res.payload.conversations[0];
    assert.equal(conv.id, 'conv-101');
    assert.equal(conv.counterparty.id, 'user-worker-8');
    assert.equal(conv.counterparty.name, 'Bob Electrician');
    assert.equal(conv.counterparty.avatar, 'https://example.com/bob.jpg');
    assert.equal(conv.counterparty.role, 'Worker');
    assert.equal(conv.lastMessage.content, 'I will be there at 10 AM.');
    assert.equal(conv.unreadCount, 2);
  } finally {
    prisma.conversation.findMany = origConvFindMany;
    prisma.chatMessage.groupBy = origMsgGroupBy;
  }
});

test('PATCH /api/chat/conversations/:id/read marks unread messages in conversation as read', async () => {
  const origFindUnique = prisma.conversation.findUnique;
  const origUpdateMany = prisma.chatMessage.updateMany;

  let capturedWhere = null;
  let capturedData = null;

  try {
    prisma.conversation.findUnique = async ({ where }) => ({
      id: 'conv-202',
      user1Id: 'user-me',
      user2Id: 'user-worker-9'
    });

    prisma.chatMessage.updateMany = async ({ where, data }) => {
      capturedWhere = where;
      capturedData = data;
      return { count: 3 };
    };

    const req = {
      params: { id: 'conv-202' },
      user: { id: 'user-me' }
    };
    const res = createMockResponse();

    await chatController.markAsRead(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.markedCount, 3);
    assert.equal(capturedWhere.conversationId, 'conv-202');
    assert.equal(capturedWhere.receiverId, 'user-me');
    assert.equal(capturedWhere.isRead, false);
    assert.equal(capturedData.isRead, true);
    assert.ok(capturedData.readAt instanceof Date);
  } finally {
    prisma.conversation.findUnique = origFindUnique;
    prisma.chatMessage.updateMany = origUpdateMany;
  }
});

test('PATCH /api/chat/conversations/:id/read rejects unauthorized user with 403', async () => {
  const origFindUnique = prisma.conversation.findUnique;

  try {
    prisma.conversation.findUnique = async () => ({
      id: 'conv-private',
      user1Id: 'user-alice',
      user2Id: 'user-bob'
    });

    const req = {
      params: { id: 'conv-private' },
      user: { id: 'intruder-charlie' }
    };
    const res = createMockResponse();

    await chatController.markAsRead(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.success, false);
    assert.match(res.payload.message, /not authorized/i);
  } finally {
    prisma.conversation.findUnique = origFindUnique;
  }
});

test('GET /api/chat/user/:id returns counterparty profile info', async () => {
  const origFindUnique = prisma.user.findUnique;

  try {
    prisma.user.findUnique = async ({ where }) => {
      if (where.id === 'worker-44') {
        return {
          id: 'worker-44',
          name: 'Sarah Carpenter',
          avatarUrl: 'https://example.com/sarah.png',
          role: 'WORKER',
          workerProfile: {
            businessName: 'Sarah Woodworks',
            primaryCategory: { name: 'Carpenter' }
          }
        };
      }
      return null;
    };

    const req = { params: { id: 'worker-44' }, user: { id: 'cust-1' } };
    const res = createMockResponse();

    await chatController.getChatUser(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.user.id, 'worker-44');
    assert.equal(res.payload.user.name, 'Sarah Carpenter');
    assert.equal(res.payload.user.role, 'Worker');
    assert.equal(res.payload.user.subtitle, 'Carpenter');
  } finally {
    prisma.user.findUnique = origFindUnique;
  }
});

