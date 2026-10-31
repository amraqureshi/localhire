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
