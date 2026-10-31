const dotenv = require('dotenv');
const connectDB = require('./config/db');
const User = require('./models/User');
const Job = require('./models/Job');

dotenv.config();

const mockWorkers = [
  {
    name: 'Sarah Jenkins',
    email: 'sarah@example.com',
    password: 'password123',
    role: 'Worker',
    category: 'Tutor',
    subCategory: 'Mathematics & Science',
    experience: '5 years',
    rating: 4.9,
    reviewsCount: 124,
    hourlyRate: 500,
    availability: 'Available Today',
    skills: ['Calculus', 'Physics', 'Exam Prep'],
    bio: 'Experienced high-school physics and math tutor. I make complex subjects easy to understand with engaging visual examples.',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=SarahJ',
    location: {
      type: 'Point',
      coordinates: [74.5057, 15.8368],
      address: 'Tilakwadi (1.2 km)'
    }
  },
  {
    name: 'Marcus Chen',
    email: 'marcus@example.com',
    password: 'password123',
    role: 'Worker',
    category: 'Electrician',
    subCategory: 'Residential & Commercial',
    experience: '8 years',
    rating: 4.8,
    reviewsCount: 89,
    hourlyRate: 400,
    availability: 'Available Tomorrow',
    skills: ['Wiring', 'Panel Upgrades', 'Lighting'],
    bio: 'Licensed electrician ready to help with any residential or light commercial electrical needs. Quick response times.',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Marcus',
    location: {
      type: 'Point',
      coordinates: [74.5165, 15.8569],
      address: 'Camp Area (3.5 km)'
    }
  },
  {
    name: 'Elena Rodriguez',
    email: 'elena@example.com',
    password: 'password123',
    role: 'Worker',
    category: 'Cleaner',
    subCategory: 'Deep Cleaning',
    experience: '3 years',
    rating: 4.7,
    reviewsCount: 210,
    hourlyRate: 300,
    availability: 'Available Next Week',
    skills: ['Move-in/out', 'Organization', 'Eco-friendly'],
    bio: 'Detail-oriented cleaner using 100% eco-friendly products. Let me make your home sparkle so you can relax.',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Elena1',
    location: {
      type: 'Point',
      coordinates: [74.5204, 15.8732],
      address: 'Sadashiv Nagar (5.0 km)'
    }
  },
  {
    name: 'James Wilson',
    email: 'james@example.com',
    password: 'password123',
    role: 'Worker',
    category: 'Plumber',
    subCategory: 'Emergency Repairs',
    experience: '12 years',
    rating: 4.9,
    reviewsCount: 342,
    hourlyRate: 500,
    availability: 'Available Now',
    skills: ['Pipe Repair', 'Water Heaters', 'Clogs'],
    bio: 'Master plumber with over a decade of experience. Specializing in resolving emergency leaks and installations efficiently.',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=James',
    location: {
      type: 'Point',
      coordinates: [74.5215, 15.8407],
      address: 'Shahapur (2.1 km)'
    }
  },
  {
    name: 'Maya Patel',
    email: 'maya@example.com',
    password: 'password123',
    role: 'Worker',
    category: 'Driver',
    subCategory: 'Personal & Deliveries',
    experience: '4 years',
    rating: 4.6,
    reviewsCount: 76,
    hourlyRate: 250,
    availability: 'Available Today',
    skills: ['Airport Runs', 'Errands', 'Safe Driving'],
    bio: 'Reliable personal driver with a pristine driving record. Available for local errands or airport transportation.',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Maya',
    location: {
      type: 'Point',
      coordinates: [74.4980, 15.8115],
      address: 'Udyambag (0.8 km)'
    }
  }
];

const seedData = async () => {
  try {
    await connectDB();
    console.log('[Seed] Connected to MongoDB');

    await User.deleteMany();
    await Job.deleteMany();
    console.log('[Seed] Cleared existing users and jobs');

    // Create Workers
    const createdWorkers = [];
    for (const w of mockWorkers) {
      const user = await User.create(w);
      createdWorkers.push(user);
    }
    console.log(`[Seed] Created ${createdWorkers.length} worker accounts`);

    // Create Customer
    const customer = await User.create({
      name: 'Alice Customer',
      email: 'alice@example.com',
      password: 'password123',
      role: 'Customer',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alice'
    });
    console.log('[Seed] Created customer account: alice@example.com');

    // Create Admin
    const admin = await User.create({
      name: 'System Admin',
      email: 'admin@localhire.com',
      password: 'adminpassword123',
      role: 'Admin',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin'
    });
    console.log('[Seed] Created admin account: admin@localhire.com');

    // Create Mock Jobs
    const jobs = [
      {
        title: 'Need urgent sink pipe repair',
        category: 'Plumber',
        budget: '₹400 - ₹600',
        urgency: 'Today',
        status: 'Open',
        description: 'My kitchen sink pipe burst and is leaking heavily. Need someone who can come fix it today.',
        customer: customer._id,
        location: {
          type: 'Point',
          coordinates: [74.4977, 15.8497],
          address: 'Nehru Nagar (1.5 km)'
        }
      },
      {
        title: 'Weekly calculus tutoring for high schooler',
        category: 'Tutor',
        budget: '₹500/hr',
        urgency: 'This week',
        status: 'Open',
        description: 'Looking for an experienced math tutor to help my son prepare for his AP Calculus exam. Needs to be in-person.',
        customer: customer._id,
        location: {
          type: 'Point',
          coordinates: [74.5100, 15.8300],
          address: 'Angol (4.2 km)'
        }
      },
      {
        title: 'Install 2 ceiling fans and chandelier',
        category: 'Electrician',
        budget: '₹800',
        urgency: 'This week',
        status: 'In Progress',
        assignedWorker: createdWorkers[1]._id, // Marcus Chen
        description: 'Just moved in, need an electrician to safely install two ceiling fans and a heavy dining room chandelier.',
        customer: customer._id,
        location: {
          type: 'Point',
          coordinates: [74.5200, 15.8200],
          address: 'Vadgaon (3.0 km)'
        }
      }
    ];

    await Job.insertMany(jobs);
    console.log(`[Seed] Created ${jobs.length} mock jobs`);

    console.log('[Seed] Seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('[Seed] Error during seeding:', error);
    process.exit(1);
  }
};

seedData();
