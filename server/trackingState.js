const activeTracking = new Map();
let socketServer = null;

const setSocketServer = (io) => {
  socketServer = io;
};

const getSocketServer = () => socketServer;

const broadcastBookingStatus = (bookingId, status, payload = {}) => {
  const key = String(bookingId);
  if (!socketServer) return false;
  socketServer.to(`booking:${key}`).emit('booking:status:changed', {
    bookingId: key,
    status,
    ...payload
  });
  return true;
};

const stopBookingTracking = (bookingId, message = 'Location sharing stopped.') => {
  const key = String(bookingId);
  const state = activeTracking.get(key);
  if (!state) return false;

  activeTracking.delete(key);
  socketServer?.to(`booking:${key}`).emit('tracking:stopped', {
    bookingId: key,
    workerId: state.workerId,
    customerId: state.customerId,
    message
  });
  return true;
};

const stopWorkerTracking = (workerId, message = 'Worker stopped sharing location.') => {
  let stopped = 0;
  for (const [bookingId, state] of activeTracking) {
    if (String(state.workerId) === String(workerId) && stopBookingTracking(bookingId, message)) {
      stopped += 1;
    }
  }
  return stopped;
};

module.exports = {
  activeTracking,
  setSocketServer,
  getSocketServer,
  broadcastBookingStatus,
  stopBookingTracking,
  stopWorkerTracking
};
