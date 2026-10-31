// LocalHire - Razorpay Gateway Configuration & Security Utilities
// Official Razorpay Node.js SDK integration with HMAC SHA256 signature verification.

const Razorpay = require('razorpay');
const crypto = require('crypto');

const getRazorpayCredentials = () => ({
  keyId: process.env.RAZORPAY_KEY_ID || null,
  keySecret: process.env.RAZORPAY_KEY_SECRET || null,
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || null
});

const isRazorpayConfigured = () => {
  const { keyId, keySecret } = getRazorpayCredentials();
  return Boolean(
    keyId &&
    keySecret &&
    !keyId.includes('replace_with') &&
    !keyId.includes('your_') &&
    !keySecret.includes('replace_with') &&
    !keySecret.includes('your_')
  );
};

let razorpayInstance = null;

const getRazorpayInstance = () => {
  if (!isRazorpayConfigured()) return null;
  if (!razorpayInstance) {
    const { keyId, keySecret } = getRazorpayCredentials();
    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret
    });
  }
  return razorpayInstance;
};

// Constant-time string comparison to prevent timing attacks
const safeCompare = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

// Verify payment signature: HMAC SHA256 of order_id + "|" + payment_id
const verifyPaymentSignature = ({ orderId, paymentId, signature }) => {
  if (!orderId || !paymentId || !signature) return false;

  const { keySecret } = getRazorpayCredentials();
  if (!keySecret) return false;

  const payload = `${orderId}|${paymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(payload)
    .digest('hex');

  return safeCompare(expectedSignature, signature);
};

// Verify webhook signature against raw byte body
const verifyWebhookSignature = ({ rawBody, signature }) => {
  if (!rawBody || !signature) return false;

  const { webhookSecret } = getRazorpayCredentials();
  if (!webhookSecret) return false;

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  return safeCompare(expectedSignature, signature);
};

module.exports = {
  getRazorpayCredentials,
  isRazorpayConfigured,
  getRazorpayInstance,
  verifyPaymentSignature,
  verifyWebhookSignature,
  safeCompare
};

