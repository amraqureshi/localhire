const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const prisma = require('./config/prisma');
const { ensureAuthorizedChatParticipants } = require('./controllers/chatController');
const { activeTracking, setSocketServer, stopBookingTracking, stopWorkerTracking } = require('./trackingState');

dotenv.config({ path: path.resolve(__dirname, '.env') });

// ─── Startup environment guard ────────────────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET environment variable is not set.');
  console.error('[FATAL] Set it in server/.env before starting the server.');
  console.error('[FATAL] Generate a safe value: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('[FATAL] DATABASE_URL environment variable is not set.');
  process.exit(1);
}
// ─────────────────────────────────────────────────────────────────────────────

// Import Routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const jobRoutes = require('./routes/jobRoutes');
const appRoutes = require('./routes/appRoutes');
const chatRoutes = require('./routes/chatRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const adminRoutes = require('./routes/adminRoutes');
const escrowRoutes = require('./routes/escrowRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

const app = express();
const server = http.createServer(app);

const bookingTrackingRoom = (bookingId) => `booking:${bookingId}`;

const mapRole = (role) => {
  switch (role) {
    case 'WORKER':
      return 'Worker';
    case 'ADMIN':
      return 'Admin';
    default:
      return 'Customer';
  }
};

const isValidCoordinate = (value, min, max) => Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;

const isWorkerLocationSharingEnabled = async (workerId) => {
  const profile = await prisma.workerProfile.findUnique({
    where: { userId: String(workerId) },
    select: { locationSharing: { select: { sharingEnabled: true } } }
  });
  return Boolean(profile?.locationSharing?.sharingEnabled);
};

const persistWorkerLocation = async ({ bookingId, workerId, latitude, longitude }) => {
  if (!bookingId || !workerId || !isValidCoordinate(latitude, -90, 90) || !isValidCoordinate(longitude, -180, 180)) {
    return false;
  }

  try {
    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: String(workerId) }
    });

    if (!workerProfile) {
      return false;
    }

    const result = await prisma.workerLocation.updateMany({
      where: { workerProfileId: workerProfile.id, sharingEnabled: true },
      data: {
        latitude: Number(latitude),
        longitude: Number(longitude),
        lastLocationUpdate: new Date()
      }
    });

    return result.count > 0;
  } catch (error) {
    console.error('[Socket Tracking] Worker location persistence failed:', error.message);
    return false;
  }
};

const verifyBookingTrackingAccess = async ({ bookingId, userId, role }) => {
  if (!bookingId || !userId) {
    return { authorized: false, reason: 'Missing bookingId or userId', booking: null };
  }

  try {
    const booking = await prisma.booking.findUnique({
      where: { id: String(bookingId) },
      select: {
        id: true,
        status: true,
        customerId: true,
        workerId: true
      }
    });

    if (!booking) {
      return { authorized: false, reason: 'Booking not found', booking: null };
    }

    if (!['CONFIRMED', 'DISPATCHED', 'IN_PROGRESS'].includes(booking.status)) {
      stopBookingTracking(bookingId, 'Booking is no longer active.');
      return { authorized: false, reason: 'Location is available only for accepted active bookings', booking };
    }

    if (role === 'Worker' && booking.workerId !== userId) {
      return { authorized: false, reason: 'Only the assigned worker may manage this booking tracking', booking };
    }

    if (role === 'Customer' && booking.customerId !== userId) {
      return { authorized: false, reason: 'Only the booking owner may subscribe to this booking location', booking };
    }

    if (role !== 'Worker' && role !== 'Customer') {
      return { authorized: false, reason: 'Role not authorized for tracking', booking };
    }

    return { authorized: true, reason: 'Authorized', booking };
  } catch (error) {
    console.error('[Socket Tracking] Access verification failed:', error);
    return { authorized: false, reason: 'Server error validating booking access', booking: null };
  }
};

// Middleware
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

const parseAllowedOrigins = () => {
  const envOrigins = (process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return new Set([
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...envOrigins
  ]);
};

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. mobile apps, curl, or file:// where origin is 'null')
    if (!origin || origin === 'null') {
      return callback(null, true);
    }
    const allowed = parseAllowedOrigins();
    if (allowed.has(origin)) {
      return callback(null, true);
    }
    // In development mode, allow any local port on localhost / 127.0.0.1
    if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
};

app.use(cors(corsOptions));

// Socket.io initialization
const io = new Server(server, {
  cors: corsOptions
});
setSocketServer(io);

io.use(async (socket, next) => {
  const headerToken = socket.handshake.headers.authorization;
  const socketToken = socket.handshake.auth?.token;
  const rawToken = typeof socketToken === 'string' ? socketToken : (typeof headerToken === 'string' ? headerToken : '');
  const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7) : rawToken;

  if (!token) {
    return next(new Error('Socket auth failed: missing token'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: String(decoded.id) },
      select: { id: true, role: true }
    });

    if (!user) {
      return next(new Error('Socket auth failed: user not found'));
    }

    socket.user = {
      id: user.id,
      role: mapRole(user.role)
    };
    return next();
  } catch (error) {
    console.error('[Socket Auth] Token verification failed:', error.message);
    return next(new Error('Socket auth failed: invalid token'));
  }
});

// Socket.io connection logic
io.on('connection', (socket) => {
  console.log(`[Socket] User connected: ${socket.id}`);

  if (socket.user?.id) {
    socket.join(`user:${socket.user.id}`);
  }

  socket.on('join_room', async (roomId) => {
    if (!roomId || typeof roomId !== 'string') {
      socket.emit('chat:error', { message: 'Invalid chat room reference.' });
      return;
    }

    const userIds = roomId.split('_').filter(Boolean);
    if (userIds.length !== 2) {
      socket.emit('chat:error', { message: 'Chat room is not linked to a valid conversation.' });
      return;
    }

    const [participantA, participantB] = userIds;
    const otherUserId = String(socket.user.id) === String(participantA) ? participantB : participantA;

    const auth = await ensureAuthorizedChatParticipants(socket.user.id, otherUserId);
    if (!auth.authorized) {
      socket.emit('chat:error', { message: auth.message });
      return;
    }

    socket.join(roomId);
    socket.data.chatRoom = roomId;
    console.log(`[Socket] Socket ${socket.id} joined authorized room: ${roomId}`);
  });

  socket.on('send_message', async (data) => {
    try {
      if (!data || !data.roomId || !data.content) {
        socket.emit('chat:error', { message: 'Message content and room are required.' });
        return;
      }

      const senderId = String(socket.user.id);
      const roomParticipants = String(data.roomId).split('_').filter(Boolean);
      const otherUserId = roomParticipants.find((id) => String(id) !== senderId);

      if (!otherUserId) {
        socket.emit('chat:error', { message: 'Could not resolve the recipient for this chat room.' });
        return;
      }

      const auth = await ensureAuthorizedChatParticipants(senderId, otherUserId);
      if (!auth.authorized) {
        socket.emit('chat:error', { message: auth.message });
        return;
      }

      const content = String(data.content).trim();
      if (!content) {
        socket.emit('chat:error', { message: 'Message content cannot be empty.' });
        return;
      }

      const [user1Id, user2Id] = [senderId, otherUserId].sort();
      const conversation = await prisma.conversation.upsert({
        where: { user1Id_user2Id: { user1Id, user2Id } },
        update: { lastMessageAt: new Date() },
        create: { user1Id, user2Id, lastMessageAt: new Date() }
      });

      const message = await prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          senderId,
          receiverId: otherUserId,
          content,
          isRead: false
        }
      });

      const payload = {
        id: message.id,
        roomId: data.roomId,
        senderId,
        receiverId: otherUserId,
        content: message.content,
        createdAt: message.createdAt,
        isRead: message.isRead,
        conversationId: message.conversationId
      };

      io.to(data.roomId).emit('receive_message', payload);
      io.to(`user:${senderId}`).emit('conversation:updated', { conversationId: conversation.id, message: payload });
      io.to(`user:${otherUserId}`).emit('conversation:updated', { conversationId: conversation.id, message: payload });
    } catch (error) {
      console.error('[Socket Chat] Message save failed:', error);
      socket.emit('chat:error', { message: 'Failed to send message. Please try again.' });
    }
  });

  const handleBookingJoin = async ({ bookingId } = {}) => {
    const { authorized, reason, booking } = await verifyBookingTrackingAccess({
      bookingId,
      userId: socket.user?.id,
      role: socket.user?.role
    });

    if (!authorized) {
      socket.emit('tracking:error', { bookingId, message: reason });
      return;
    }

    const room = bookingTrackingRoom(bookingId);
    socket.join(room);
    socket.data.trackingRoom = room;

    if (socket.user.role === 'Worker') {
      if (!(await isWorkerLocationSharingEnabled(socket.user.id))) {
        socket.emit('tracking:error', { bookingId, message: 'Enable location sharing before starting tracking.' });
        return;
      }

      if (!activeTracking.has(bookingId)) {
        activeTracking.set(bookingId, {
          bookingId,
          workerId: socket.user.id,
          customerId: booking.customerId,
          startedAt: new Date().toISOString(),
          lastLocation: null,
          status: 'ACTIVE'
        });
      }

      const current = activeTracking.get(bookingId);
      const statePayload = {
        bookingId,
        active: true,
        workerId: socket.user.id,
        customerId: booking.customerId,
        startedAt: current.startedAt,
        lastLocation: current.lastLocation,
        message: 'Worker joined booking tracking room.'
      };
      io.to(room).emit('tracking:state', statePayload);
      return;
    }

    if (socket.user.role === 'Customer') {
      if (!(await isWorkerLocationSharingEnabled(booking.workerId))) {
        stopBookingTracking(bookingId, 'Worker has stopped sharing location.');
      }

      const liveState = activeTracking.get(bookingId);
      let initialLocation = liveState?.lastLocation || null;

      if (!initialLocation && booking?.workerId) {
        try {
          const wp = await prisma.workerProfile.findUnique({
            where: { userId: String(booking.workerId) },
            select: {
              locationSharing: {
                select: { latitude: true, longitude: true, lastLocationUpdate: true, sharingEnabled: true }
              }
            }
          });
          const sharedLocation = wp?.locationSharing;
          const isFresh = sharedLocation?.lastLocationUpdate && Date.now() - new Date(sharedLocation.lastLocationUpdate).getTime() <= 15 * 60 * 1000;
          if (sharedLocation?.sharingEnabled && isFresh && sharedLocation.latitude != null && sharedLocation.longitude != null) {
            initialLocation = {
              latitude: Number(sharedLocation.latitude),
              longitude: Number(sharedLocation.longitude),
              timestamp: sharedLocation.lastLocationUpdate.toISOString()
            };
          }
        } catch (err) {
          console.warn('[Socket Tracking] Worker location lookup failed:', err.message);
        }
      }

      socket.emit('tracking:state', {
        bookingId,
        active: !!liveState,
        workerId: liveState?.workerId || booking.workerId,
        customerId: liveState?.customerId || booking.customerId,
        lastLocation: initialLocation,
        startedAt: liveState?.startedAt || null,
        message: liveState ? 'Tracking is active.' : (initialLocation ? 'Worker base location found. Live updates will follow when worker departs.' : 'Tracking has not started for this booking yet.')
      });
      return;
    }
  };

  const handleWorkerLocationUpdate = async ({ bookingId, latitude, longitude, accuracy, timestamp } = {}) => {
    const { authorized, reason, booking } = await verifyBookingTrackingAccess({
      bookingId,
      userId: socket.user?.id,
      role: socket.user?.role
    });

    if (!authorized) {
      socket.emit('tracking:error', { bookingId, message: reason });
      return;
    }

    if (socket.user.role !== 'Worker') {
      socket.emit('tracking:error', { bookingId, message: 'Only the assigned worker can send location updates' });
      return;
    }

    if (String(socket.user.id) !== String(booking.workerId)) {
      socket.emit('tracking:error', { bookingId, message: 'Spoofed worker ID rejected' });
      return;
    }

    if (!(await isWorkerLocationSharingEnabled(socket.user.id))) {
      stopWorkerTracking(socket.user.id);
      socket.emit('tracking:error', { bookingId, message: 'Location sharing is disabled.' });
      return;
    }

    let trackingState = activeTracking.get(bookingId);
    if (!trackingState) {
      trackingState = {
        bookingId,
        workerId: socket.user.id,
        customerId: booking.customerId,
        startedAt: new Date().toISOString(),
        lastLocation: null,
        status: 'ACTIVE'
      };
      activeTracking.set(bookingId, trackingState);
      socket.join(bookingTrackingRoom(bookingId));
    } else if (trackingState.workerId !== socket.user.id) {
      socket.emit('tracking:error', { bookingId, message: 'No active tracking session for this booking' });
      return;
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!isValidCoordinate(lat, -90, 90) || !isValidCoordinate(lng, -180, 180)) {
      socket.emit('tracking:error', { bookingId, message: 'Valid latitude and longitude are required' });
      return;
    }

    const persisted = await persistWorkerLocation({
      bookingId,
      workerId: socket.user.id,
      latitude: lat,
      longitude: lng
    });

    trackingState.lastLocation = {
      latitude: lat,
      longitude: lng,
      accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
      timestamp: timestamp || new Date().toISOString()
    };
    trackingState.lastUpdated = new Date().toISOString();
    trackingState.lastPersistedToDb = persisted ? new Date().toISOString() : trackingState.lastPersistedToDb || null;

    const payload = {
      bookingId,
      workerId: socket.user.id,
      customerId: booking.customerId,
      location: trackingState.lastLocation,
      lastUpdated: trackingState.lastUpdated,
      status: trackingState.status,
      persistedToDb: persisted
    };

    io.to(bookingTrackingRoom(bookingId)).emit('worker:location:changed', payload);
    io.to(bookingTrackingRoom(bookingId)).emit('tracking:location', payload);
  };

  const handleBookingLeave = async ({ bookingId } = {}) => {
    const { authorized, reason, booking } = await verifyBookingTrackingAccess({
      bookingId,
      userId: socket.user?.id,
      role: socket.user?.role
    });

    if (!authorized) {
      socket.emit('tracking:error', { bookingId, message: reason });
      return;
    }

    const room = bookingTrackingRoom(bookingId);
    socket.leave(room);

    if (socket.user.role === 'Worker') {
      const trackingState = activeTracking.get(bookingId);
      if (trackingState && trackingState.workerId === socket.user.id) {
        activeTracking.delete(bookingId);
        io.to(room).emit('tracking:stopped', {
          bookingId,
          workerId: socket.user.id,
          customerId: booking.customerId,
          message: 'Worker stopped sharing live location.'
        });
      }
    }
  };

  // Real-time tracking events (supporting both Phase 5 spec and existing frontend aliases)
  socket.on('booking:join', handleBookingJoin);
  socket.on('tracking:subscribe', handleBookingJoin);
  socket.on('tracking:start', handleBookingJoin);

  socket.on('worker:location:update', handleWorkerLocationUpdate);
  socket.on('tracking:update', handleWorkerLocationUpdate);

  socket.on('booking:leave', handleBookingLeave);
  socket.on('tracking:stop', handleBookingLeave);

  socket.on('disconnect', () => {
    const room = socket.data.trackingRoom;
    if (!room || socket.user?.role !== 'Worker') {
      console.log(`[Socket] User disconnected: ${socket.id}`);
      return;
    }

    const bookingId = room.replace('booking:', '');
    const trackingState = activeTracking.get(bookingId);
    if (trackingState && trackingState.workerId === socket.user.id) {
      activeTracking.delete(bookingId);
      io.to(room).emit('tracking:stopped', {
        bookingId,
        workerId: socket.user.id,
        message: 'Worker disconnected and stopped live location sharing.'
      });
    }

    console.log(`[Socket] Worker disconnected from tracking room: ${room}`);
  });
});

// API Status Route
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'LocalHire API is running live' });
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/applications', appRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/escrow', escrowRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/notifications', notificationRoutes);

// ── Static Frontend Serving ──────────────────────────────────────────────────
const publicDirectory = path.resolve(__dirname, '..', 'public');
app.use(express.static(publicDirectory));

// Fallback to index.html for client-side navigation
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(publicDirectory, 'index.html'));
});
// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Server] Port ${PORT} is already in use. Stop the stale process and try again.`);
      console.error('[Server] Example: Get-NetTCPConnection -LocalPort 5000 | Stop-Process -Id $_.OwningProcess -Force');
      process.exit(1);
    }

    console.error('[Server] Unhandled server error:', err);
    process.exit(1);
  });

  server.listen(PORT, () => {
    console.log(`[Server] LocalHire API server running on port ${PORT}`);
  });
};

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  server,
  io,
  activeTracking,
  bookingTrackingRoom,
  mapRole,
  stopBookingTracking,
  stopWorkerTracking,
  verifyBookingTrackingAccess
};
