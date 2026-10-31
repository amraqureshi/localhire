const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const prisma = require('../config/prisma');
const userController = require('../controllers/userController');
const appController = require('../controllers/appController');
const jobController = require('../controllers/jobController');

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

test('Batch A: user cannot alter rating or reviewsCount through profile updates', async () => {
  const originalFindUnique = prisma.user.findUnique;
  const originalUpdate = prisma.user.update;

  let capturedProfileUpdate = null;

  prisma.user.findUnique = async () => ({
    id: 'user-worker-1',
    role: 'WORKER',
    name: 'Bob Worker',
    email: 'bob@example.com',
    workerProfile: {
      id: 'profile-1',
      primaryCategoryId: 'cat-1',
      hourlyRate: 50,
      rating: 4.5,
      reviewsCount: 10,
      skills: []
    }
  });

  prisma.user.update = async ({ data }) => {
    capturedProfileUpdate = data.workerProfile?.update;
    return {
      id: 'user-worker-1',
      role: 'WORKER',
      name: 'Bob Worker',
      email: 'bob@example.com',
      workerProfile: {
        id: 'profile-1',
        primaryCategoryId: 'cat-1',
        rating: 4.5,
        reviewsCount: 10,
        hourlyRate: data.workerProfile?.update?.hourlyRate || 50,
        skills: []
      }
    };
  };

  try {
    const req = {
      user: { id: 'user-worker-1' },
      body: { hourlyRate: 75, rating: 5.0, reviewsCount: 9999 }
    };
    const res = createMockResponse();

    await userController.updateProfile(req, res);

    assert.equal(res.payload.success, true);
    assert.equal(capturedProfileUpdate.hourlyRate, 75);
    assert.equal(capturedProfileUpdate.rating, undefined);
    assert.equal(capturedProfileUpdate.reviewsCount, undefined);
  } finally {
    prisma.user.findUnique = originalFindUnique;
    prisma.user.update = originalUpdate;
  }
});

test('Batch A: unauthorized customer cannot accept quotes on another customer job', async () => {
  const originalFindUnique = prisma.jobApplication.findUnique;

  prisma.jobApplication.findUnique = async () => ({
    id: 'app-1',
    jobId: 'job-1',
    workerId: 'worker-1',
    job: { id: 'job-1', customerId: 'real-customer-id' },
    worker: { id: 'worker-1', name: 'Pro Worker' }
  });

  try {
    const req = {
      user: { id: 'attacker-customer-id', role: 'Customer' },
      params: { id: 'app-1' }
    };
    const res = createMockResponse();

    await appController.acceptQuote(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.success, false);
    assert.match(res.payload.message.toLowerCase(), /only the customer who posted the job/i);
  } finally {
    prisma.jobApplication.findUnique = originalFindUnique;
  }
});

test('Batch A: unauthorized user cannot change job status', async () => {
  const originalFindUnique = prisma.jobPost.findUnique;

  prisma.jobPost.findUnique = async () => ({
    id: 'job-1',
    customerId: 'owner-customer-id',
    status: 'OPEN'
  });

  try {
    const req = {
      user: { id: 'different-user-id', role: 'Customer' },
      params: { id: 'job-1' },
      body: { status: 'CANCELLED' }
    };
    const res = createMockResponse();

    await jobController.updateJobStatus(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.success, false);
    assert.match(res.payload.message.toLowerCase(), /only the customer who posted this job/i);
  } finally {
    prisma.jobPost.findUnique = originalFindUnique;
  }
});

test('Batch A: escapeHTML prevents script execution through dangerous characters', () => {
  const context = { window: {}, document: { addEventListener: () => {} }, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'app.js'), 'utf8'), context);
  const escapeHTML = context.window.escapeHTML;

  assert.equal(typeof escapeHTML, 'function');
  const maliciousInput = '<script>alert("XSS")</script><img src="x" onerror="alert(1)">';
  const escaped = escapeHTML(maliciousInput);

  assert.equal(escaped.includes('<script>'), false);
  assert.equal(escaped.includes('onerror='), true);
  assert.equal(escaped.includes('<img'), false);
  assert.equal(escaped.includes('&lt;script&gt;'), true);
  assert.equal(escaped.includes('&lt;img'), true);
});
