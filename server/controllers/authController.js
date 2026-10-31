const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');

const ALLOWED_PUBLIC_ROLES = new Set(['CUSTOMER', 'WORKER']);

const normalizeRole = (role) => {
  const key = String(role || 'CUSTOMER').trim().toUpperCase();
  return ALLOWED_PUBLIC_ROLES.has(key) ? key : 'CUSTOMER';
};

const normalizePhone = (phone) => {
  const value = String(phone || '').trim();
  return value || '+91 00000 00000';
};

const mapPrismaRole = (role) => {
  switch (role) {
    case 'WORKER':
      return 'Worker';
    case 'ADMIN':
      return 'Admin';
    default:
      return 'Customer';
  }
};

const serializeUser = (user) => ({
  id: user.id,
  _id: user.id,
  email: user.email,
  name: user.name,
  phone: user.phone,
  role: mapPrismaRole(user.role),
  avatarUrl: user.avatarUrl,
  isActive: user.isActive,
  isEmailVerified: user.isEmailVerified,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt
});

// Helper to sign JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d'
  });
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  try {
    const { name, email, password, role, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide name, email, and password' });
    }

    const requestedRole = typeof role === 'string' ? role.trim().toUpperCase() : '';
    if (role !== undefined && requestedRole && !ALLOWED_PUBLIC_ROLES.has(requestedRole)) {
      return res.status(400).json({
        success: false,
        message: 'Public registration is limited to Customer and Worker roles.'
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const userExists = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'User already exists with this email' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const safeRole = normalizeRole(role);
    const user = await prisma.user.create({
      data: {
        name: String(name).trim(),
        email: normalizedEmail,
        passwordHash,
        phone: normalizePhone(phone),
        role: safeRole,
        isActive: true,
        isEmailVerified: true,
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${String(name).replace(/\s/g, '')}`
      }
    });

    const token = generateToken(user.id);
    res.status(201).json({
      success: true,
      token,
      user: serializeUser(user)
    });
  } catch (error) {
    console.error('[Auth Controller] Register Error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration', error: error.message });
  }
};

// @desc    Login user & get token
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = generateToken(user.id);
    res.json({
      success: true,
      token,
      user: serializeUser(user)
    });
  } catch (error) {
    console.error('[Auth Controller] Login Error:', error);
    res.status(500).json({ success: false, message: 'Server error during login', error: error.message });
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: String(req.user.id || req.user._id) } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User profile not found' });
    }

    res.json({
      success: true,
      user: serializeUser(user)
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error fetching user profile' });
  }
};
