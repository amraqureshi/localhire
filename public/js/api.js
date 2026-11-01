// LocalHire Centralized API Client Module
// Uses bearer-token authentication over the real backend and avoids fake localStorage auth fallbacks.

const API_BASE_URL = (typeof window !== 'undefined' && window.location && window.location.origin) ? `${window.location.origin}/api` : '/api';

const getSessionStorage = () => (window.sessionStorage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null));
const getLocalStorage = () => (window.localStorage || (typeof localStorage !== 'undefined' ? localStorage : null));

const clearAuthState = () => {
  const sessionStore = getSessionStorage();
  const localStore = getLocalStorage();

  if (sessionStore) {
    sessionStore.removeItem('localHire_session');
    sessionStore.removeItem('localHire_token');
  }
  if (localStore) {
    localStore.removeItem('localHire_session');
    localStore.removeItem('localHire_token');
  }
};

const getStoredToken = () => {
  const sessionStore = getSessionStorage();
  const sessionToken = sessionStore ? sessionStore.getItem('localHire_token') : null;
  if (sessionToken) return sessionToken;

  const localStore = getLocalStorage();
  const legacyToken = localStore ? localStore.getItem('localHire_token') : null;
  if (legacyToken) {
    clearAuthState();
    return null;
  }

  return null;
};

const getAuthHeaders = () => {
  const token = getStoredToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
};

window.localHireAPI = {
  baseUrl: API_BASE_URL,
  isOnline: false,

  // Check backend server health
  checkHealth: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/health`, { method: 'GET' });
      if (response.ok) {
        window.localHireAPI.isOnline = true;
        return true;
      }
    } catch (e) {
      window.localHireAPI.isOnline = false;
    }
    return false;
  },

  // Auth: Login
  login: async (email, password) => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        clearAuthState();
        if (window.sessionStorage) {
          window.sessionStorage.setItem('localHire_session', JSON.stringify(data.user));
        }
        if (data.token) {
          window.sessionStorage.setItem('localHire_token', data.token);
        }
        return { success: true, user: data.user };
      }
      clearAuthState();
      return { success: false, message: data.message || 'Invalid credentials' };
    } catch (err) {
      console.warn('[API Client] Backend unavailable. No mock authentication is created for failed login attempts.');
      clearAuthState();
      return { success: false, message: 'Unable to reach the LocalHire server.' };
    }
  },

  // Auth: Register
  register: async (userData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        clearAuthState();
        if (window.sessionStorage) {
          window.sessionStorage.setItem('localHire_session', JSON.stringify(data.user));
        }
        if (data.token) {
          window.sessionStorage.setItem('localHire_token', data.token);
        }
        return { success: true, user: data.user };
      }
      clearAuthState();
      return { success: false, message: data.message || 'Registration failed' };
    } catch (err) {
      console.warn('[API Client] Backend unavailable. Registration did not create a mock authenticated session.');
      clearAuthState();
      return { success: false, message: 'Unable to reach the LocalHire server.' };
    }
  },

  // Auth: Get Current User Profile
  getMe: async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/me`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          const sessionStore = getSessionStorage();
          if (sessionStore) {
            sessionStore.setItem('localHire_session', JSON.stringify(data.user));
          }
          return data.user;
        }
      }
      clearAuthState();
      return null;
    } catch (err) {
      console.warn('[API Client] Backend unavailable. Existing auth state was cleared instead of using mock data.');
      clearAuthState();
      return null;
    }
  },

  // User / Profile: Update Profile
  updateProfile: async (updates) => {
    try {
      const res = await fetch(`${API_BASE_URL}/users/profile`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          const sessionStore = getSessionStorage();
          if (sessionStore) {
            sessionStore.setItem('localHire_session', JSON.stringify(data.user));
          }
          return { success: true, user: data.user };
        }
      }
      return { success: false, message: 'Could not update profile' };
    } catch (err) {
      console.warn('[API Client] Backend unavailable. No mock profile update was applied.');
      return { success: false, message: 'Could not update profile' };
    }
  },

  getMyLocationSharing: async () => {
    const res = await fetch(`${API_BASE_URL}/users/location`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Could not retrieve location-sharing settings.');
    return data.location;
  },

  updateMyLocationSharing: async (locationSettings) => {
    const res = await fetch(`${API_BASE_URL}/users/location`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(locationSettings)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Could not update location-sharing settings.');
    return data.location;
  },

  getCurrentLocation: async () => {
    const res = await fetch(`${API_BASE_URL}/users/current-location`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Could not retrieve your selected location.');
    return data.location;
  },

  saveCurrentLocation: async (location) => {
    const res = await fetch(`${API_BASE_URL}/users/current-location`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(location)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Could not save your selected location.');
    return data.location;
  },

  // User / Profile: Upload Avatar (Customer and Worker)
  uploadAvatar: async (file) => {
    try {
      const token = getStoredToken();
      const formData = new FormData();
      formData.append('avatar', file);

      const res = await fetch(`${API_BASE_URL}/users/avatar`, {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          // Content-Type is intentionally omitted so the browser sets the multipart boundary
        },
        body: formData
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (data.user) {
          const sessionStore = getSessionStorage();
          if (sessionStore) {
            sessionStore.setItem('localHire_session', JSON.stringify(data.user));
          }
        }
        return { success: true, avatarUrl: data.avatarUrl, user: data.user, message: data.message };
      }
      return { success: false, message: data.message || 'Avatar upload failed.' };
    } catch (err) {
      console.error('[API Client] uploadAvatar error:', err);
      return { success: false, message: 'Unable to reach the server to upload photo.' };
    }
  },

  // User / Profile: Delete Avatar
  deleteAvatar: async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/users/avatar`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.user) {
          const sessionStore = getSessionStorage();
          if (sessionStore) {
            sessionStore.setItem('localHire_session', JSON.stringify(data.user));
          }
        }
        return { success: true, user: data.user, message: data.message };
      }
      return { success: false, message: data.message || 'Avatar removal failed.' };
    } catch (err) {
      console.error('[API Client] deleteAvatar error:', err);
      return { success: false, message: 'Unable to reach the server to remove photo.' };
    }
  },

  getAddresses: async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/users/addresses`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, addresses: data.addresses || [] };
      }
      return { success: false, message: data.message || 'Unable to load addresses.' };
    } catch (err) {
      console.warn('[API Client] Backend unavailable while loading saved addresses.');
      return { success: false, message: 'Unable to reach the LocalHire server.' };
    }
  },

  createAddress: async (addressData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/users/addresses`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(addressData)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, address: data.address };
      }
      return { success: false, message: data.message || 'Address could not be saved.' };
    } catch (err) {
      console.warn('[API Client] Backend unavailable while creating address.');
      return { success: false, message: 'Unable to reach the LocalHire server.' };
    }
  },

  updateAddress: async (addressId, addressData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/users/addresses/${addressId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(addressData)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, address: data.address };
      }
      return { success: false, message: data.message || 'Address could not be updated.' };
    } catch (err) {
      console.warn('[API Client] Backend unavailable while updating address.');
      return { success: false, message: 'Unable to reach the LocalHire server.' };
    }
  },

  setDefaultAddress: async (addressId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/users/addresses/${addressId}/default`, {
        method: 'PATCH',
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, address: data.address };
      }
      return { success: false, message: data.message || 'Default address could not be updated.' };
    } catch (err) {
      console.warn('[API Client] Backend unavailable while updating default address.');
      return { success: false, message: 'Unable to reach the LocalHire server.' };
    }
  },

  deleteAddress: async (addressId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/users/addresses/${addressId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true };
      }
      return { success: false, message: data.message || 'Address could not be deleted.' };
    } catch (err) {
      console.warn('[API Client] Backend unavailable while deleting address.');
      return { success: false, message: 'Unable to reach the LocalHire server.' };
    }
  },

  tracking: {
    sockets: new Map(),
    watchIds: new Map(),

    getSocket: function () {
      if (typeof window === 'undefined' || !window.io) {
        return null;
      }

      const token = getStoredToken();
      const socketOrigin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : undefined;
      return window.io(socketOrigin, {
        auth: { token },
        transports: ['websocket']
      });
    },

    connect: function (bookingId, handlers = {}) {
      if (!window.io) return null;

      if (!this.sockets.has(bookingId)) {
        const socket = this.getSocket();
        if (!socket) return null;

        socket.on('connect', () => {
          if (handlers.onConnect) handlers.onConnect(socket);
        });

        socket.on('tracking:state', (payload) => {
          if (handlers.onState) handlers.onState(payload);
        });

        socket.on('tracking:location', (payload) => {
          if (handlers.onLocation) handlers.onLocation(payload);
        });

        socket.on('worker:location:changed', (payload) => {
          if (handlers.onLocation) handlers.onLocation(payload);
        });

        socket.on('booking:status:changed', (payload) => {
          if (handlers.onStatusChanged) handlers.onStatusChanged(payload);
        });

        socket.on('tracking:stopped', (payload) => {
          if (handlers.onStopped) handlers.onStopped(payload);
        });

        socket.on('tracking:error', (payload) => {
          if (handlers.onError) handlers.onError(payload);
        });

        this.sockets.set(bookingId, socket);
      }

      return this.sockets.get(bookingId);
    },

    joinBooking: function (bookingId, handlers = {}) {
      const socket = this.connect(bookingId, handlers);
      if (!socket) return null;
      socket.emit('booking:join', { bookingId });
      return socket;
    },

    leaveBooking: function (bookingId, handlers = {}) {
      const socket = this.connect(bookingId, handlers);
      if (!socket) return null;
      socket.emit('booking:leave', { bookingId });
      return socket;
    },

    subscribe: function (bookingId, handlers = {}) {
      const socket = this.connect(bookingId, handlers);
      if (!socket) return null;
      socket.emit('booking:join', { bookingId });
      return socket;
    },

    start: function (bookingId, handlers = {}) {
      const socket = this.connect(bookingId, handlers);
      if (!socket) return null;
      socket.emit('booking:join', { bookingId });
      return socket;
    },

    stop: function (bookingId, handlers = {}) {
      const socket = this.connect(bookingId, handlers);
      if (!socket) return null;
      socket.emit('booking:leave', { bookingId });
      return socket;
    },

    updateLocation: function (bookingId, latitude, longitude, accuracy = null) {
      const socket = this.sockets.get(bookingId);
      if (!socket) return false;
      socket.emit('worker:location:update', {
        bookingId,
        latitude,
        longitude,
        accuracy,
        timestamp: new Date().toISOString()
      });
      return true;
    },

    watchBrowserLocation: function (bookingId, handlers = {}) {
      if (!navigator.geolocation) {
        if (handlers.onError) handlers.onError({ bookingId, message: 'Geolocation is not supported by this browser.' });
        return null;
      }

      if (this.watchIds.has(bookingId)) {
        const previousWatch = this.watchIds.get(bookingId);
        if (previousWatch) navigator.geolocation.clearWatch(previousWatch);
      }

      const watchId = navigator.geolocation.watchPosition((position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        const accuracy = position.coords.accuracy;
        const socket = this.sockets.get(bookingId);
        if (socket) {
          socket.emit('tracking:update', {
            bookingId,
            latitude,
            longitude,
            accuracy,
            timestamp: new Date().toISOString()
          });
        }
        if (handlers.onLocation) handlers.onLocation({ bookingId, latitude, longitude, accuracy });
      }, (error) => {
        if (handlers.onError) handlers.onError({ bookingId, message: error.message || 'Location access was denied.' });
      }, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 15000
      });

      this.watchIds.set(bookingId, watchId);
      return watchId;
    },

    stopBrowserWatch: function (bookingId) {
      const watchId = this.watchIds.get(bookingId);
      if (watchId !== undefined && watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
      }
      this.watchIds.delete(bookingId);
    }
  },

  // Workers / Search (Restricted to Customer / Hire Worker accounts)
  getWorkers: async (queryFilters = {}) => {
    try {
      const queryStr = new URLSearchParams(queryFilters).toString();
      const res = await fetch(`${API_BASE_URL}/users/workers?${queryStr}`, {
        headers: getAuthHeaders()
      });
      if (res.status === 403) {
        console.warn('[API Client] Access forbidden: Worker accounts cannot access the worker directory.');
        return [];
      }
      if (res.ok) {
        const data = await res.json();
        if (data.workers && data.workers.length > 0 && typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem('localHire_users', JSON.stringify(data.workers));
          } catch (e) {}
        }
        return data.workers;
      }
    } catch (err) {
      console.warn('[API Client] Server offline, checking permissions for local workers');
    }
    if (queryFilters.lat !== undefined || queryFilters.lng !== undefined) {
      return [];
    }
    // Fallback: strictly forbid Worker accounts from receiving worker search results
    const currentUser = window.localHireApp ? window.localHireApp.getCurrentUser() : null;
    if (currentUser && currentUser.role === 'Worker') {
      return [];
    }
    let workers = window.localHireApp.getWorkers();
    if (queryFilters.q) {
      const q = queryFilters.q.toLowerCase();
      workers = workers.filter(w =>
        w.name.toLowerCase().includes(q) ||
        w.category.toLowerCase().includes(q) ||
        (w.skills && w.skills.some(s => s.toLowerCase().includes(q))) ||
        (w.bio && w.bio.toLowerCase().includes(q))
      );
    }
    if (queryFilters.category) {
      workers = workers.filter(w => w.category === queryFilters.category);
    }
    if (queryFilters.maxPrice) {
      workers = workers.filter(w => w.hourlyRate <= parseFloat(queryFilters.maxPrice));
    }
    return workers;
  },

  getWorkerById: async (id) => {
    try {
      const res = await fetch(`${API_BASE_URL}/users/workers/${id}`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        return data.worker;
      }
    } catch (err) {
      console.warn('[API Client] Server offline, using local worker lookup');
    }
    return window.localHireApp.getWorkerById(id);
  },

  // Jobs
  getJobs: async (queryFilters = {}) => {
    try {
      const queryStr = new URLSearchParams(queryFilters).toString();
      const res = await fetch(`${API_BASE_URL}/jobs?${queryStr}`);
      if (res.ok) {
        const data = await res.json();
        return data.jobs;
      }
    } catch (err) {
      console.warn('[API Client] Server offline, returning local jobs');
    }
    let jobs = window.localHireApp.getJobs();
    if (queryFilters.category) {
      jobs = jobs.filter(j => j.category === queryFilters.category);
    }
    if (queryFilters.q) {
      const q = queryFilters.q.toLowerCase();
      jobs = jobs.filter(j => j.title.toLowerCase().includes(q) || j.description.toLowerCase().includes(q));
    }
    return jobs;
  },

  getJobById: async (id) => {
    try {
      const res = await fetch(`${API_BASE_URL}/jobs/${id}`);
      if (res.ok) {
        const data = await res.json();
        return data.job;
      }
    } catch (err) {
      console.warn('[API Client] Server offline, returning local job');
    }
    const jobs = window.localHireApp.getJobs();
    return jobs.find(j => j.id === id);
  },

  saveJob: async (jobData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/jobs`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(jobData)
      });
      if (res.ok) {
        const data = await res.json();
        window.localHireApp.saveJob(data.job);
        return data.job;
      }
    } catch (err) {
      console.warn('[API Client] Server offline, saving job locally');
    }
    window.localHireApp.saveJob(jobData);
    return jobData;
  },

  updateJobStatus: async (jobId, status, assignedWorkerId = null) => {
    try {
      const res = await fetch(`${API_BASE_URL}/jobs/${jobId}/status`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status, assignedWorkerId })
      });
      if (res.ok) {
        const data = await res.json();
        return data.job;
      }
    } catch (err) {
      console.warn('[API Client] Server offline, updating job status locally');
    }
    const jobs = window.localHireApp.getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (job) {
      job.status = status;
      if (assignedWorkerId) job.assignedWorker = assignedWorkerId;
      localStorage.setItem('localHire_jobs', JSON.stringify(jobs));
    }
    return job;
  },

  // Bookings (Customer to Worker Direct Hire — PostgreSQL / Prisma Persistence)
  createBooking: async (bookingData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/bookings`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(bookingData)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, booking: data.booking, message: data.message };
      } else {
        return {
          success: false,
          message: data.message || 'Booking request failed on server',
          details: data.details || null,
          error: data.error || null
        };
      }
    } catch (err) {
      console.error('[API Client] Server connection failed during booking:', err);
      return {
        success: false,
        message: 'Could not connect to the API server. Please verify the backend is running and PostgreSQL is connected.'
      };
    }
  },

  getMyBookings: async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/bookings/my`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, bookings: data.bookings || [] };
      } else {
        return {
          success: false,
          bookings: [],
          message: data.message || 'Could not retrieve bookings from database'
        };
      }
    } catch (err) {
      console.warn('[API Client] Server connection failed when retrieving bookings:', err);
      return {
        success: false,
        bookings: [],
        message: 'Database unavailable: Server is offline or PostgreSQL is not connected.'
      };
    }
  },

  getBookingById: async (bookingId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/bookings/${bookingId}`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, booking: data.booking };
      }
      return { success: false, message: data.message };
    } catch (err) {
      return { success: false, message: 'Database connection unavailable' };
    }
  },

  updateBookingStatus: async (bookingId, status, notes = '') => {
    try {
      const res = await fetch(`${API_BASE_URL}/bookings/${bookingId}/status`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status, notes })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, booking: data.booking, message: data.message };
      }
      return { success: false, message: data.message || 'Status update failed' };
    } catch (err) {
      return { success: false, message: 'Database connection unavailable' };
    }
  },

  // Applications / Quotes
  createApplication: async (jobId, quote, message) => {
    try {
      const res = await fetch(`${API_BASE_URL}/applications`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ jobId, job: jobId, quote, message })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        window.localHireApp.saveApplication(data.application);
        return { success: true, application: data.application };
      } else if (data.message) {
        return { success: false, message: data.message };
      }
    } catch (err) {
      console.warn('[API Client] Server offline, applying locally');
    }
    const currentUser = window.localHireApp.getCurrentUser();
    const appData = {
      jobId,
      workerId: currentUser ? currentUser.id : 'w_guest',
      workerName: currentUser ? currentUser.name : 'Guest Worker',
      workerAvatar: currentUser ? currentUser.avatarUrl : '',
      quote,
      message,
      status: 'Pending'
    };
    window.localHireApp.saveApplication(appData);
    return { success: true, application: appData };
  },

  getApplicationsForJob: async (jobId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/applications/job/${jobId}`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        return data.applications;
      }
    } catch (err) {
      console.warn('[API Client] Server offline, getting applications locally');
    }
    return window.localHireApp.getApplicationsForJob(jobId);
  },

  getWorkerApplications: async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/applications/worker/me`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        return data.applications;
      }
    } catch (err) {
      console.warn('[API Client] Server offline, getting worker applications locally');
    }
    const currentUser = window.localHireApp.getCurrentUser();
    return currentUser ? window.localHireApp.getApplicationsForWorker(currentUser.id) : [];
  },

  acceptQuote: async (applicationId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/applications/${applicationId}/accept`, {
        method: 'PUT',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        return { success: true, message: data.message };
      }
    } catch (err) {
      console.warn('[API Client] Server offline, accepting quote locally');
    }
    const apps = window.localHireApp.getApplications();
    const app = apps.find(a => a.id === applicationId);
    if (app) {
      app.status = 'Accepted';
      localStorage.setItem('localHire_applications', JSON.stringify(apps));

      const jobs = window.localHireApp.getJobs();
      const job = jobs.find(j => j.id === app.jobId);
      if (job) {
        job.status = 'In Progress';
        job.assignedWorker = app.workerId;
        localStorage.setItem('localHire_jobs', JSON.stringify(jobs));
      }
    }
    return { success: true, message: 'Quote accepted locally' };
  },

  // Chat / Messages
  sendMessage: async (receiverId, content) => {
    try {
      const res = await fetch(`${API_BASE_URL}/chat/messages`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ receiverId, content })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, message: data.message };
      }
      return { success: false, message: data.message || 'Unable to send message.' };
    } catch (err) {
      console.warn('[API Client] Backend unavailable while sending message.');
      return { success: false, message: 'Unable to reach the LocalHire server.' };
    }
  },

  getMessages: async (otherUserId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/chat/messages/${otherUserId}`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, messages: data.messages || [] };
      }
      return { success: false, messages: [], message: data.message || 'Unable to load chat history.' };
    } catch (err) {
      console.warn('[API Client] Backend unavailable while loading messages.');
      return { success: false, messages: [], message: 'Unable to reach the LocalHire server.' };
    }
  },

  getConversations: async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/chat/conversations`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, conversations: data.conversations || [], count: data.count || 0 };
      }
      return { success: false, conversations: [], message: data.message || 'Unable to load conversations.' };
    } catch (err) {
      console.warn('[API Client] Backend unavailable while loading conversations.');
      return { success: false, conversations: [], message: 'Unable to reach the LocalHire server.' };
    }
  },

  markConversationAsRead: async (conversationIdOrUserId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/chat/conversations/${conversationIdOrUserId}/read`, {
        method: 'PATCH',
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, markedCount: data.markedCount };
      }
      return { success: false, message: data.message };
    } catch (err) {
      console.warn('[API Client] Error marking conversation as read:', err.message);
      return { success: false, message: 'Unable to reach the LocalHire server.' };
    }
  },

  getChatUser: async (userId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/chat/user/${userId}`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return { success: true, user: data.user };
      }
      return { success: false, message: data.message || 'User not found.' };
    } catch (err) {
      console.warn('[API Client] Error fetching chat user info:', err.message);
      return { success: false, message: 'Unable to reach the LocalHire server.' };
    }
  },

  // Reviews
  createReview: async (jobId, workerId, rating, comment) => {
    try {
      const res = await fetch(`${API_BASE_URL}/reviews`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ jobId, workerId, rating, comment })
      });
      if (res.ok) {
        const data = await res.json();
        return { success: true, review: data.review, updatedRating: data.updatedRating };
      }
    } catch (err) {
      console.warn('[API Client] Server offline, adding review locally');
    }
    const reviews = JSON.parse(localStorage.getItem('localHire_reviews') || '[]');
    const currentUser = window.localHireApp.getCurrentUser();
    const revObj = {
      id: 'r_' + Date.now(),
      job: jobId,
      worker: workerId,
      customer: currentUser ? { name: currentUser.name, avatarUrl: currentUser.avatarUrl } : { name: 'Customer' },
      rating: parseFloat(rating),
      comment,
      createdAt: new Date().toISOString()
    };
    reviews.unshift(revObj);
    localStorage.setItem('localHire_reviews', JSON.stringify(reviews));
    return { success: true, review: revObj };
  },

  getWorkerReviews: async (workerId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/reviews/worker/${workerId}`);
      if (res.ok) {
        const data = await res.json();
        return data.reviews;
      }
    } catch (err) {
      console.warn('[API Client] Server offline, loading local reviews');
    }
    const reviews = JSON.parse(localStorage.getItem('localHire_reviews') || '[]');
    return reviews.filter(r => r.worker === workerId);
  },

  // Admin Portal API
  getAdminMetrics: async () => {
    const res = await fetch(`${API_BASE_URL}/admin/metrics`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return data.metrics;
    }
    throw new Error(data.message || 'Failed to fetch admin metrics');
  },

  getAdminUsers: async (params = {}) => {
    const cleanParams = {};
    Object.keys(params).forEach(k => {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
        cleanParams[k] = params[k];
      }
    });
    const query = new URLSearchParams(cleanParams).toString();
    const url = `${API_BASE_URL}/admin/users${query ? '?' + query : ''}`;
    const res = await fetch(url, {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return data;
    }
    throw new Error(data.message || 'Failed to fetch admin users');
  },

  verifyAdminUser: async (userId, status = 'VERIFIED', notes = '') => {
    const res = await fetch(`${API_BASE_URL}/admin/users/${userId}/verify`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status, notes })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return data;
    }
    throw new Error(data.message || 'Failed to update user verification');
  },

  deleteAdminUser: async (userId) => {
    const res = await fetch(`${API_BASE_URL}/admin/users/${userId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return data;
    }
    throw new Error(data.message || 'Failed to delete user');
  },

  getAdminJobs: async (params = {}) => {
    const cleanParams = {};
    Object.keys(params).forEach(k => {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
        cleanParams[k] = params[k];
      }
    });
    const query = new URLSearchParams(cleanParams).toString();
    const url = `${API_BASE_URL}/admin/jobs${query ? '?' + query : ''}`;
    const res = await fetch(url, {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return data;
    }
    throw new Error(data.message || 'Failed to fetch admin jobs');
  },

  flagAdminJob: async (jobId, reason = '', isFlagged = true) => {
    const res = await fetch(`${API_BASE_URL}/admin/jobs/${jobId}/flag`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason, isFlagged })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return data;
    }
    throw new Error(data.message || 'Failed to flag job');
  },

  deleteAdminJob: async (jobId) => {
    const res = await fetch(`${API_BASE_URL}/admin/jobs/${jobId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return data;
    }
    throw new Error(data.message || 'Failed to delete job');
  },

  // Escrow & Milestone Payment API Services
  escrow: {
    getStatus: async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/escrow/status`);
        if (res.ok) {
          return await res.json();
        }
      } catch (err) {
        console.warn('[API Client] Server offline for getStatus');
      }
      return { success: false, mode: 'UNAVAILABLE' };
    },

    fundEscrow: async (jobIdOrBookingId, workerId, amount, paymentMethod, isBooking = false) => {
      try {
        const payload = isBooking
          ? { bookingId: jobIdOrBookingId, workerId, amount, paymentMethod }
          : { jobId: jobIdOrBookingId, workerId, amount, paymentMethod };
        const res = await fetch(`${API_BASE_URL}/escrow/fund`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data) {
          return data;
        }
        return { success: false, message: data?.message || 'Funding escrow failed' };
      } catch (err) {
        console.warn('[API Client] Server offline for fundEscrow');
      }
      return { success: false, message: 'Unable to reach the LocalHire escrow server.' };
    },

    releaseEscrow: async (jobIdOrBookingId, isBooking = false, paymentMethod = 'UPI') => {
      try {
        const payload = isBooking
          ? { bookingId: jobIdOrBookingId, paymentMethod }
          : { jobId: jobIdOrBookingId, paymentMethod };
        const res = await fetch(`${API_BASE_URL}/escrow/release`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data) {
          return data;
        }
        return {
          success: false,
          message: data?.message || 'Escrow release failed'
        };
      } catch (err) {
        console.warn('[API Client] Server offline for releaseEscrow');
      }
      return { success: false, message: 'Unable to reach the LocalHire escrow server.' };
    },

    disputeEscrow: async (jobIdOrBookingId, reason, isBooking = false) => {
      try {
        const payload = isBooking ? { bookingId: jobIdOrBookingId, reason } : { jobId: jobIdOrBookingId, reason };
        const res = await fetch(`${API_BASE_URL}/escrow/dispute`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data) {
          return data;
        }
        return {
          success: false,
          message: data?.message || 'Escrow dispute failed'
        };
      } catch (err) {
        console.warn('[API Client] Server offline for disputeEscrow');
      }
      return { success: false, message: 'Unable to reach the LocalHire escrow server.' };
    },

    refundEscrow: async (jobIdOrBookingId, reason, isBooking = false) => {
      try {
        const payload = isBooking ? { bookingId: jobIdOrBookingId, reason } : { jobId: jobIdOrBookingId, reason };
        const res = await fetch(`${API_BASE_URL}/escrow/refund`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data) {
          return data;
        }
        return {
          success: false,
          message: data?.message || 'Escrow refund failed'
        };
      } catch (err) {
        console.warn('[API Client] Server offline for refundEscrow');
      }
      return { success: false, message: 'Unable to reach the LocalHire escrow server.' };
    },

    getJobEscrow: async (jobId) => {
      try {
        const res = await fetch(`${API_BASE_URL}/escrow/job/${jobId}`, {
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          return data.escrow;
        }
      } catch (err) {
        console.warn('[API Client] Server offline for getJobEscrow');
      }
      return null;
    },

    getBookingEscrow: async (bookingId) => {
      try {
        const res = await fetch(`${API_BASE_URL}/escrow/booking/${bookingId}`, {
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          return data.escrow;
        }
      } catch (err) {
        console.warn('[API Client] Server offline for getBookingEscrow');
      }
      return null;
    },

    getUserLedger: async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/escrow/ledger`, {
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          return data.transactions;
        }
      } catch (err) {
        console.warn('[API Client] Server offline for getUserLedger');
      }
      return [];
    }
  },

  razorpay: {
    getConfig: async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/escrow/razorpay/config`);
        if (res.ok) {
          return await res.json();
        }
      } catch (err) {
        console.warn('[API Client] Server offline for razorpay config');
      }
      return { success: false, keyId: null };
    },

    createOrder: async (bookingId) => {
      try {
        const res = await fetch(`${API_BASE_URL}/escrow/razorpay/create-order`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ bookingId })
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data) {
          return data;
        }
        return {
          success: false,
          message: data?.message || 'Failed to create Razorpay payment order'
        };
      } catch (err) {
        console.warn('[API Client] Error calling razorpay createOrder:', err);
      }
      return { success: false, message: 'Unable to reach the payment server.' };
    },

    verifyPayment: async (verificationData) => {
      try {
        const res = await fetch(`${API_BASE_URL}/escrow/razorpay/verify-payment`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(verificationData)
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data) {
          return data;
        }
        return {
          success: false,
          message: data?.message || 'Payment verification failed'
        };
      } catch (err) {
        console.warn('[API Client] Error calling razorpay verifyPayment:', err);
      }
      return { success: false, message: 'Unable to reach the payment verification server.' };
    }
  }
};

// Check backend status on script load
window.localHireAPI.checkHealth();
