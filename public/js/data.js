// Mock Data for LocalHire
// Demo data is isolated from real auth. The live app must authenticate against the backend,
// and no mock auth state may be created in browser storage.

const DEMO_AUTH_ENABLED = false;

const mockWorkers = [
  {
    id: 'w1',
    name: 'Sarah Jenkins',
    category: 'Tutor',
    subCategory: 'Mathematics & Science',
    experience: '5 years',
    rating: 4.9,
    reviewsCount: 124,
    hourlyRate: 500,
    location: 'Tilakwadi (1.2 km)',
    lat: 15.8368, // Belagavi coordinates
    lng: 74.5057,
    availability: 'Available Today',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=SarahJ',
    skills: ['Calculus', 'Physics', 'Exam Prep'],
    bio: 'Experienced high-school physics and math tutor. I make complex subjects easy to understand with engaging visual examples.',
  },
  {
    id: 'w2',
    name: 'Marcus Chen',
    category: 'Electrician',
    subCategory: 'Residential & Commercial',
    experience: '8 years',
    rating: 4.8,
    reviewsCount: 89,
    hourlyRate: 400,
    location: 'Camp Area (3.5 km)',
    lat: 15.8569,
    lng: 74.5165,
    availability: 'Available Tomorrow',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Marcus',
    skills: ['Wiring', 'Panel Upgrades', 'Lighting'],
    bio: 'Licensed electrician ready to help with any residential or light commercial electrical needs. Quick response times.',
  },
  {
    id: 'w3',
    name: 'Elena Rodriguez',
    category: 'Cleaner',
    subCategory: 'Deep Cleaning',
    experience: '3 years',
    rating: 4.7,
    reviewsCount: 210,
    hourlyRate: 300,
    location: 'Sadashiv Nagar (5.0 km)',
    lat: 15.8732,
    lng: 74.5204,
    availability: 'Available Next Week',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Elena1',
    skills: ['Move-in/out', 'Organization', 'Eco-friendly'],
    bio: 'Detail-oriented cleaner using 100% eco-friendly products. Let me make your home sparkle so you can relax.',
  },
  {
    id: 'w4',
    name: 'James Wilson',
    category: 'Plumber',
    subCategory: 'Emergency Repairs',
    experience: '12 years',
    rating: 4.9,
    reviewsCount: 342,
    hourlyRate: 500,
    location: 'Shahapur (2.1 km)',
    lat: 15.8407,
    lng: 74.5215,
    availability: 'Available Now',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=James',
    skills: ['Pipe Repair', 'Water Heaters', 'Clogs'],
    bio: 'Master plumber with over a decade of experience. Specializing in resolving emergency leaks and installations efficiently.',
  },
  {
    id: 'w5',
    name: 'Maya Patel',
    category: 'Driver',
    subCategory: 'Personal & Deliveries',
    experience: '4 years',
    rating: 4.6,
    reviewsCount: 76,
    hourlyRate: 250,
    location: 'Udyambag (0.8 km)',
    lat: 15.8115,
    lng: 74.4980,
    availability: 'Available Today',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Maya',
    skills: ['Airport Runs', 'Errands', 'Safe Driving'],
    bio: 'Reliable personal driver with a pristine driving record. Available for local errands or airport transportation.',
  },
  {
    id: 'w6',
    name: 'David Kim',
    category: 'Freelancer',
    subCategory: 'Web Design',
    experience: '6 years',
    rating: 5.0,
    reviewsCount: 45,
    hourlyRate: 600,
    location: 'Remote',
    lat: null, // Remote worker, no specific coord
    lng: null,
    availability: 'Available Tomorrow',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=David',
    skills: ['UI/UX', 'Figma', 'Webflow'],
    bio: 'Creative web designer helping local businesses establish strong digital presences with modern, converting websites.',
  }
];

const mockJobs = [
  {
    id: 'j1',
    title: 'Need urgent sink pipe repair',
    category: 'Plumber',
    budget: '₹400 - ₹600',
    location: 'Nehru Nagar (1.5 km)',
    postedTime: '2 hours ago',
    status: 'Open',
    urgency: 'Today',
    customerName: 'Alex B.',
    description: 'My kitchen sink pipe burst and is leaking heavily. Need someone who can come fix it today.'
  },
  {
    id: 'j2',
    title: 'Weekly calculus tutoring for high schooler',
    category: 'Tutor',
    budget: '₹500/hr',
    location: 'Angol (4.2 km)',
    postedTime: '5 hours ago',
    status: 'Open',
    urgency: 'This week',
    customerName: 'Samantha T.',
    description: 'Looking for an experienced math tutor to help my son prepare for his AP Calculus exam. Needs to be in-person.'
  },
  {
    id: 'j3',
    title: 'Install 2 ceiling fans and chandelier',
    category: 'Electrician',
    budget: '₹800',
    location: 'Vadgaon (3.0 km)',
    postedTime: '1 day ago',
    status: 'In Progress',
    urgency: 'This week',
    customerName: 'Michael R.',
    description: 'Just moved in, need an electrician to safely install two ceiling fans and a heavy dining room chandelier.'
  }
];

// Helper to initialize local storage if empty
function initializeStorage() {
  if (!localStorage.getItem('localHire_users')) {
    // Seed initial mock workers as registered users
    const initialUsers = mockWorkers.map(w => ({
      ...w,
      email: w.name.split(' ')[0].toLowerCase() + '@example.com',
      password: 'password123',
      role: 'Worker',
      favorites: []
    }));
    
    // Add one mock customer
    initialUsers.push({
      id: 'c1',
      name: 'Alice Customer',
      email: 'alice@example.com',
      password: 'password123',
      role: 'Customer',
      favorites: []
    });

    localStorage.setItem('localHire_users', JSON.stringify(initialUsers));
  }
  
  if (!localStorage.getItem('localHire_jobs')) {
    localStorage.setItem('localHire_jobs', JSON.stringify(mockJobs));
  }
  
  if (!localStorage.getItem('localHire_applications')) {
    localStorage.setItem('localHire_applications', JSON.stringify([]));
  }
}

initializeStorage();

// Data access functions
// Helper to calculate distance using Haversine formula (km)
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  const distance = R * c; 
  return distance.toFixed(1); // Return with 1 decimal place
}

window.localHireApp = {
  // DB Access
  getUsers: () => JSON.parse(localStorage.getItem('localHire_users') || '[]'),
  
  getWorkers: () => {
    const currentUser = window.localHireApp.getCurrentUser();
    if (currentUser && currentUser.role === 'Worker') {
      return [];
    }
    const users = window.localHireApp.getUsers();
    return users.filter(u => u.role === 'Worker' && u.category); // Must have category to be a valid worker profile
  },
  
  getJobs: () => JSON.parse(localStorage.getItem('localHire_jobs') || '[]'),
  
  // Auth & Session
  getCurrentUser: () => {
    const sessionUser = sessionStorage.getItem('localHire_session');
    if (sessionUser) {
      return JSON.parse(sessionUser);
    }

    const legacySession = localStorage.getItem('localHire_session');
    if (legacySession) {
      localStorage.removeItem('localHire_session');
      localStorage.removeItem('localHire_token');
      sessionStorage.removeItem('localHire_session');
      sessionStorage.removeItem('localHire_token');
    }

    return null;
  },
  
  loginUser: (email, password) => {
    if (!DEMO_AUTH_ENABLED) {
      return { success: false, message: 'Demo authentication is disabled. Use the backend auth flow.' };
    }

    const users = window.localHireApp.getUsers();
    const user = users.find(u => u.email === email && u.password === password);
    if (user) {
      // Don't store password in session
      const { password, ...sessionUser } = user;
      sessionStorage.setItem('localHire_session', JSON.stringify(sessionUser));
      localStorage.removeItem('localHire_session');
      localStorage.removeItem('localHire_token');
      return { success: true, user: sessionUser };
    }
    return { success: false, message: 'Invalid email or password' };
  },

  registerUser: (userData) => {
    if (!DEMO_AUTH_ENABLED) {
      return { success: false, message: 'Demo registration is disabled. Use the backend auth flow.' };
    }

    const users = window.localHireApp.getUsers();
    if (users.some(u => u.email === userData.email)) {
      return { success: false, message: 'Email already exists' };
    }
    
    const newUser = {
      id: 'u_' + Date.now(),
      name: userData.name,
      email: userData.email,
      password: userData.password,
      role: userData.role,
      favorites: [],
      // Defaults for workers
      ...(userData.role === 'Worker' ? {
        category: '', subCategory: '', experience: '', rating: 0, reviewsCount: 0, 
        hourlyRate: 0, location: '', availability: '', skills: [], bio: '',
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userData.name.replace(/\s/g, '')}`
      } : {})
    };

    users.push(newUser);
    localStorage.setItem('localHire_users', JSON.stringify(users));
    
    // Auto login
    const { password, ...sessionUser } = newUser;
    sessionStorage.setItem('localHire_session', JSON.stringify(sessionUser));
    localStorage.removeItem('localHire_session');
    localStorage.removeItem('localHire_token');
    
    return { success: true, user: sessionUser };
  },

  logoutUser: () => {
    sessionStorage.removeItem('localHire_session');
    sessionStorage.removeItem('localHire_token');
    localStorage.removeItem('localHire_session');
    localStorage.removeItem('localHire_token');
  },

  updateUserProfile: (userId, updates) => {
    const users = window.localHireApp.getUsers();
    const index = users.findIndex(u => u.id === userId);
    if (index !== -1) {
      users[index] = { ...users[index], ...updates };
      localStorage.setItem('localHire_users', JSON.stringify(users));
      
      // Update session if it's the current user
      const currentUser = window.localHireApp.getCurrentUser();
      if (currentUser && currentUser.id === userId) {
        const { password, ...sessionUser } = users[index];
        sessionStorage.setItem('localHire_session', JSON.stringify(sessionUser));
      }
      return true;
    }
    return false;
  },

  toggleFavorite: (customerId, workerId) => {
    const users = window.localHireApp.getUsers();
    const index = users.findIndex(u => u.id === customerId);
    if (index !== -1) {
      const isFav = users[index].favorites.includes(workerId);
      if (isFav) {
        users[index].favorites = users[index].favorites.filter(id => id !== workerId);
      } else {
        users[index].favorites.push(workerId);
      }
      localStorage.setItem('localHire_users', JSON.stringify(users));
      
      // Update session
      const currentUser = window.localHireApp.getCurrentUser();
      if (currentUser && currentUser.id === customerId) {
        const { password, ...sessionUser } = users[index];
        sessionStorage.setItem('localHire_session', JSON.stringify(sessionUser));
      }
      return !isFav; // Return true if it was added
    }
  },

  getUserLocation: () => JSON.parse(localStorage.getItem('localHire_userLocation') || 'null'),
  
  setUserLocation: (lat, lng) => {
    localStorage.setItem('localHire_userLocation', JSON.stringify({ lat, lng, timestamp: Date.now() }));
    // Note: in the new Users DB, we process distances dynamically on render rather than saving back to DB
  },
  
  saveJob: (job) => {
    const jobs = window.localHireApp.getJobs();
    jobs.unshift({ ...job, id: 'j' + Date.now(), postedTime: 'Just now', status: 'Open' });
    localStorage.setItem('localHire_jobs', JSON.stringify(jobs));
  },
  
  getApplications: () => JSON.parse(localStorage.getItem('localHire_applications') || '[]'),
  
  saveApplication: (app) => {
    const apps = window.localHireApp.getApplications();
    apps.unshift({ ...app, id: 'a' + Date.now(), appliedTime: new Date().toISOString() });
    localStorage.setItem('localHire_applications', JSON.stringify(apps));
  },
  
  getApplicationsForWorker: (workerId) => {
    const apps = window.localHireApp.getApplications();
    return apps.filter(a => a.workerId === workerId);
  },
  
  getApplicationsForJob: (jobId) => {
    const apps = window.localHireApp.getApplications();
    return apps.filter(a => a.jobId === jobId);
  },
  
  getWorkerById: (id) => {
    const users = window.localHireApp.getUsers();
    return users.find(u => u.id === id && u.role === 'Worker');
  },
  
  calculateDistance // Export helper
};
