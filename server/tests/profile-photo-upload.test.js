const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const prisma = require('../config/prisma');
const { supabaseAdmin } = require('../config/supabase');

test('Phase 3: Profile Photo Upload Security & Storage Integration', async (t) => {
  let testCustomer = null;
  let testWorker = null;
  const testEmailCustomer = `test-cust-avatar-${Date.now()}@example.com`;
  const testEmailWorker = `test-worker-avatar-${Date.now()}@example.com`;

  t.after(async () => {
    // Cleanup created users
    if (testCustomer) {
      await prisma.user.delete({ where: { id: testCustomer.id } }).catch(() => {});
    }
    if (testWorker) {
      await prisma.workerProfile.deleteMany({ where: { userId: testWorker.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: testWorker.id } }).catch(() => {});
    }
  });

  await t.test('Supabase Storage profile-photos bucket is configured and accessible', async () => {
    assert.ok(supabaseAdmin, 'supabaseAdmin client must be initialized');
    const { data, error } = await supabaseAdmin.storage.getBucket('profile-photos');
    assert.ifError(error);
    assert.equal(data.name, 'profile-photos');
    assert.equal(data.public, true);
    assert.equal(data.file_size_limit, 5242880);
    assert.ok(data.allowed_mime_types.includes('image/jpeg'));
    assert.ok(data.allowed_mime_types.includes('image/png'));
    assert.ok(data.allowed_mime_types.includes('image/webp'));
  });

  await t.test('Customer profile photo upload, retrieval, and replacement', async () => {
    // 1. Create a customer
    testCustomer = await prisma.user.create({
      data: {
        email: testEmailCustomer,
        passwordHash: 'dummy_hash_for_test',
        name: 'Test Avatar Customer',
        role: 'CUSTOMER'
      }
    });

    // 2. Upload test photo to Supabase Storage under user-scoped path
    const fakeImageBuffer = Buffer.from('fake-jpeg-binary-content-for-testing');
    const fileName = `${testCustomer.id}/avatar-test-${Date.now()}.jpg`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('profile-photos')
      .upload(fileName, fakeImageBuffer, {
        contentType: 'image/jpeg',
        upsert: true
      });
    assert.ifError(uploadError);

    // 3. Obtain public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('profile-photos')
      .getPublicUrl(fileName);
    assert.ok(urlData?.publicUrl, 'Public URL must be returned');

    // 4. Update customer avatarUrl in database
    const updated = await prisma.user.update({
      where: { id: testCustomer.id },
      data: { avatarUrl: urlData.publicUrl }
    });
    assert.equal(updated.avatarUrl, urlData.publicUrl);

    // 5. Test replacement
    const replacementFileName = `${testCustomer.id}/avatar-test-2-${Date.now()}.png`;
    const { error: repUploadError } = await supabaseAdmin.storage
      .from('profile-photos')
      .upload(replacementFileName, Buffer.from('replacement-image'), {
        contentType: 'image/png',
        upsert: true
      });
    assert.ifError(repUploadError);

    const { data: repUrlData } = supabaseAdmin.storage
      .from('profile-photos')
      .getPublicUrl(replacementFileName);

    const replaced = await prisma.user.update({
      where: { id: testCustomer.id },
      data: { avatarUrl: repUrlData.publicUrl }
    });
    assert.equal(replaced.avatarUrl, repUrlData.publicUrl);
    assert.notEqual(replaced.avatarUrl, updated.avatarUrl);
  });

  await t.test('Worker profile photo upload and persistence with workerProfile', async () => {
    // 1. Create a category
    let cat = await prisma.serviceCategory.findFirst({ where: { slug: 'other' } });
    if (!cat) {
      cat = await prisma.serviceCategory.create({
        data: { name: 'Other', slug: 'other', description: 'General services' }
      });
    }

    // 2. Create worker with profile
    testWorker = await prisma.user.create({
      data: {
        email: testEmailWorker,
        passwordHash: 'dummy_worker_hash',
        name: 'Test Avatar Worker',
        role: 'WORKER',
        workerProfile: {
          create: {
            primaryCategoryId: cat.id,
            hourlyRate: 50,
            experienceYears: 3,
            verificationStatus: 'VERIFIED'
          }
        }
      },
      include: { workerProfile: true }
    });

    const fileName = `${testWorker.id}/avatar-worker-${Date.now()}.webp`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from('profile-photos')
      .upload(fileName, Buffer.from('fake-webp-image'), {
        contentType: 'image/webp',
        upsert: true
      });
    assert.ifError(uploadError);

    const { data: urlData } = supabaseAdmin.storage
      .from('profile-photos')
      .getPublicUrl(fileName);

    const updatedWorker = await prisma.user.update({
      where: { id: testWorker.id },
      data: { avatarUrl: urlData.publicUrl },
      include: { workerProfile: true }
    });

    assert.equal(updatedWorker.avatarUrl, urlData.publicUrl);
    assert.ok(updatedWorker.workerProfile, 'WorkerProfile must remain intact');
  });

  await t.test('Unauthorized user cannot update another user profile picture', async () => {
    // Ensure user A cannot overwrite user B's avatarUrl without auth
    const victim = testCustomer;
    assert.ok(victim);

    // Simulated attack attempt with wrong credentials should fail in controller logic
    const reqWithoutAuth = { user: null };
    const { uploadAvatar } = require('../controllers/userController');
    let statusCode = 0;
    let resData = null;
    const res = {
      status: (code) => {
        statusCode = code;
        return {
          json: (data) => { resData = data; }
        };
      }
    };

    await uploadAvatar(reqWithoutAuth, res);
    assert.equal(statusCode, 401, 'Request without authentication must return 401');
    assert.equal(resData?.success, false);
  });
});

