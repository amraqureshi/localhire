const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const prisma = require('../config/prisma');
const authController = require('../controllers/authController');
const userController = require('../controllers/userController');

function createStorage() {
  const store = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    },
    clear() {
      Object.keys(store).forEach((key) => delete store[key]);
    }
  };
}

function loadBrowserScript(relativePath) {
  const scriptPath = path.join(__dirname, '..', '..', relativePath);
  const script = fs.readFileSync(scriptPath, 'utf8');
  const context = {
    window: { localHireApp: { getCurrentUser: () => null } },
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    fetch: async () => ({ ok: false, json: async () => ({ success: false, message: 'not implemented' }) }),
    URLSearchParams,
    console,
    document: { addEventListener: () => {} }
  };
  vm.runInNewContext(script, context);
  return context.window;
}

test('customer registration succeeds with valid input', async () => {
  const originalFindUnique = prisma.user.findUnique;
  const originalCreate = prisma.user.create;

  prisma.user.findUnique = async () => null;
  prisma.user.create = async ({ data }) => ({
    id: 'user-customer-1',
    email: data.email,
    name: data.name,
    phone: data.phone,
    role: data.role,
    avatarUrl: data.avatarUrl,
    isActive: data.isActive,
    isEmailVerified: data.isEmailVerified,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  try {
    const req = { body: { name: 'Alice Customer', email: 'alice@example.com', password: 'secret123', role: 'customer' } };
    const res = createMockResponse();

    await authController.register(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.user.role, 'Customer');
    assert.equal(typeof res.payload.token, 'string');
  } finally {
    prisma.user.findUnique = originalFindUnique;
    prisma.user.create = originalCreate;
  }
});

test('worker registration succeeds with valid input', async () => {
  const originalFindUnique = prisma.user.findUnique;
  const originalCreate = prisma.user.create;

  prisma.user.findUnique = async () => null;
  prisma.user.create = async ({ data }) => ({
    id: 'user-worker-1',
    email: data.email,
    name: data.name,
    phone: data.phone,
    role: data.role,
    avatarUrl: data.avatarUrl,
    isActive: data.isActive,
    isEmailVerified: data.isEmailVerified,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  try {
    const req = { body: { name: 'Bob Worker', email: 'bob@worker.com', password: 'secret123', role: 'worker' } };
    const res = createMockResponse();

    await authController.register(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.user.role, 'Worker');
  } finally {
    prisma.user.findUnique = originalFindUnique;
    prisma.user.create = originalCreate;
  }
});

test('admin or unsupported-role registration is rejected', async () => {
  const originalFindUnique = prisma.user.findUnique;
  const originalCreate = prisma.user.create;

  prisma.user.findUnique = async () => null;
  prisma.user.create = async () => {
    throw new Error('create should not be called for admin roles');
  };

  try {
    const req = { body: { name: 'Root Admin', email: 'admin@example.com', password: 'secret123', role: 'admin' } };
    const res = createMockResponse();

    await authController.register(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.success, false);
    assert.match(res.payload.message.toLowerCase(), /admin|unsupported|role/i);
  } finally {
    prisma.user.findUnique = originalFindUnique;
    prisma.user.create = originalCreate;
  }
});

test('user cannot escalate their privileges through profile updates', async () => {
  const originalFindUnique = prisma.user.findUnique;
  const originalUpdate = prisma.user.update;

  prisma.user.findUnique = async () => ({
    id: 'user-1',
    role: 'CUSTOMER',
    name: 'Alice',
    email: 'alice@example.com',
    workerProfile: null,
    phone: null,
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  prisma.user.update = async () => {
    throw new Error('update should not be called when role is attempted');
  };

  try {
    const req = { user: { id: 'user-1' }, body: { role: 'ADMIN', phone: '+91 99999 11111' } };
    const res = createMockResponse();

    await userController.updateProfile(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.success, false);
    assert.match(res.payload.message.toLowerCase(), /role/i);
  } finally {
    prisma.user.findUnique = originalFindUnique;
    prisma.user.update = originalUpdate;
  }
});

test('successful login establishes the expected auth state', async () => {
  const originalFindUnique = prisma.user.findUnique;
  const originalCompare = require('bcryptjs').compare;
  require('bcryptjs').compare = async () => true;

  prisma.user.findUnique = async () => ({
    id: 'user-login-1',
    email: 'login@example.com',
    name: 'Login User',
    phone: '+91 00000 00000',
    role: 'CUSTOMER',
    avatarUrl: null,
    isActive: true,
    isEmailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    passwordHash: 'hash'
  });

  try {
    const req = { body: { email: 'login@example.com', password: 'secret123' } };
    const res = createMockResponse();

    await authController.login(req, res);

    assert.ok(res.payload);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.user.role, 'Customer');
  } finally {
    prisma.user.findUnique = originalFindUnique;
    require('bcryptjs').compare = originalCompare;
  }
});

test('failed login does not establish an authenticated session', async () => {
  const storage = createStorage();
  const browserWindow = {
    localHireApp: {
      loginUser: () => ({ success: true, user: { id: 'fake', email: 'fake@example.com', role: 'Customer' } })
    }
  };
  const fakeFetch = async () => ({
    ok: false,
    json: async () => ({ success: false, message: 'Invalid credentials' })
  });

  const context = {
    window: browserWindow,
    localStorage: storage,
    sessionStorage: createStorage(),
    fetch: fakeFetch,
    URLSearchParams,
    console,
    document: { addEventListener: () => {} }
  };

  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'api.js'), 'utf8'), context);

  const result = await context.window.localHireAPI.login('bad@example.com', 'badpassword');

  assert.equal(result.success, false);
  assert.equal(storage.getItem('localHire_session'), null);
  assert.equal(storage.getItem('localHire_token'), null);
});

test('logout clears the client auth state', async () => {
  const storage = createStorage();
  const browserWindow = {
    localHireApp: {
      logoutUser: () => {
        storage.removeItem('localHire_session');
      },
      getCurrentUser: () => null
    },
    location: { pathname: '/pages/auth.html' }
  };

  storage.setItem('localHire_session', JSON.stringify({ id: 'u1', role: 'Customer' }));
  storage.setItem('localHire_token', 'abc123');

  browserWindow.localStorage = storage;
  browserWindow.sessionStorage = createStorage();

  const context = {
    window: browserWindow,
    localStorage: storage,
    sessionStorage: browserWindow.sessionStorage,
    console,
    document: { addEventListener: () => {} }
  };

  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'app.js'), 'utf8'), context);
  context.window.handleLogout();

  assert.equal(storage.getItem('localHire_session'), null);
  assert.equal(storage.getItem('localHire_token'), null);
});

function createMockResponse() {
  const res = {
    statusCode: null,
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
  return res;
}
