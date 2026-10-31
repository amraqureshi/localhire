// LocalHire - Fictional Development Database Seeder for PostgreSQL
// Seeds comprehensive home services taxonomy, service items, and fictional test accounts.
// DO NOT USE REAL PASSWORDS OR PERSONAL INFORMATION HERE.

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('[Seed] Starting LocalHire PostgreSQL database seeding...');

  if (!process.env.DATABASE_URL) {
    console.error('[Seed] ERROR: DATABASE_URL environment variable is not defined.');
    console.error('[Seed] Ensure .env is populated with your friend\'s PostgreSQL connection string before seeding.');
    process.exit(1);
  }

  // Pre-hash a standard fictional development password
  const devPasswordHash = await bcrypt.hash('DevPass@2026!', 10);

  // 1. Service Categories Taxonomy
  console.log('[Seed] Seeding service categories...');
  const categoriesData = [
    {
      name: 'Electrician',
      slug: 'electrician',
      description: 'Expert residential & commercial wiring, lighting, panel upgrades, and appliance hookups.',
      iconUrl: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=120&q=80',
      displayOrder: 1
    },
    {
      name: 'Plumber',
      slug: 'plumber',
      description: 'Emergency leak repair, pipe installations, drain clearing, and water heater service.',
      iconUrl: 'https://images.unsplash.com/photo-1581244277943-fe4a9c777189?auto=format&fit=crop&w=120&q=80',
      displayOrder: 2
    },
    {
      name: 'Cleaner',
      slug: 'cleaner',
      description: 'Deep residential cleaning, move-in/move-out services, and sanitization.',
      iconUrl: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=120&q=80',
      displayOrder: 3
    },
    {
      name: 'Carpenter',
      slug: 'carpenter',
      description: 'Custom furniture repair, door and lock installations, cabinetry, and wood trim.',
      iconUrl: 'https://images.unsplash.com/photo-1538688525198-9b88f6f53126?auto=format&fit=crop&w=120&q=80',
      displayOrder: 4
    },
    {
      name: 'AC Technician',
      slug: 'ac-technician',
      description: 'Air conditioner servicing, chemical wash, gas refill, and cooling diagnostic repair.',
      iconUrl: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?auto=format&fit=crop&w=120&q=80',
      displayOrder: 5
    },
    {
      name: 'Appliance Repair',
      slug: 'appliance-repair',
      description: 'Washing machine, refrigerator, microwave oven, and kitchen appliance troubleshooting.',
      iconUrl: 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?auto=format&fit=crop&w=120&q=80',
      displayOrder: 6
    },
    {
      name: 'Painter',
      slug: 'painter',
      description: 'Interior & exterior wall painting, waterproof wall coating, and touch-up artistry.',
      iconUrl: 'https://images.unsplash.com/photo-1589939705384-5185137a7f0f?auto=format&fit=crop&w=120&q=80',
      displayOrder: 7
    },
    {
      name: 'Pest Control',
      slug: 'pest-control',
      description: 'Eco-friendly termite treatment, rodent extermination, and general insect protection.',
      iconUrl: 'https://images.unsplash.com/photo-1584467735871-8e85353a8413?auto=format&fit=crop&w=120&q=80',
      displayOrder: 8
    }
  ];

  const categoryMap = {};
  for (const cat of categoriesData) {
    const record = await prisma.serviceCategory.upsert({
      where: { slug: cat.slug },
      update: cat,
      create: cat
    });
    categoryMap[cat.slug] = record;
  }
  console.log(`[Seed] Seeded ${Object.keys(categoryMap).length} categories.`);

  // 2. Service Catalog Items
  console.log('[Seed] Seeding service items...');
  const serviceItemsData = [
    // Electrician
    { categoryId: categoryMap['electrician'].id, title: 'Ceiling Fan Installation', slug: 'ceiling-fan-installation', basePrice: 350.00, priceType: 'FIXED', durationMinutes: 45 },
    { categoryId: categoryMap['electrician'].id, title: 'Switchboard & Socket Repair', slug: 'switchboard-repair', basePrice: 200.00, priceType: 'FIXED', durationMinutes: 30 },
    { categoryId: categoryMap['electrician'].id, title: 'Complete House Wiring Inspection', slug: 'wiring-inspection', basePrice: 600.00, priceType: 'INSPECTION_PLUS_QUOTE', durationMinutes: 90 },
    // Plumber
    { categoryId: categoryMap['plumber'].id, title: 'Tap & Shower Leakage Repair', slug: 'tap-leakage-repair', basePrice: 250.00, priceType: 'FIXED', durationMinutes: 45 },
    { categoryId: categoryMap['plumber'].id, title: 'Blocked Drain Clearance', slug: 'blocked-drain-clearance', basePrice: 400.00, priceType: 'FIXED', durationMinutes: 60 },
    { categoryId: categoryMap['plumber'].id, title: 'Water Tank Fitting & Valve Setup', slug: 'water-tank-fitting', basePrice: 850.00, priceType: 'INSPECTION_PLUS_QUOTE', durationMinutes: 120 },
    // Cleaner
    { categoryId: categoryMap['cleaner'].id, title: 'Deep Kitchen Cleaning', slug: 'deep-kitchen-cleaning', basePrice: 1200.00, priceType: 'FIXED', durationMinutes: 180 },
    { categoryId: categoryMap['cleaner'].id, title: 'Bathroom Sanitation & Tile Scrub', slug: 'bathroom-sanitation', basePrice: 500.00, priceType: 'FIXED', durationMinutes: 90 },
    // AC Technician
    { categoryId: categoryMap['ac-technician'].id, title: 'AC Filter Cleaning & Deep Service', slug: 'ac-filter-deep-service', basePrice: 599.00, priceType: 'FIXED', durationMinutes: 60 },
    { categoryId: categoryMap['ac-technician'].id, title: 'AC Gas Refill & Cooling Check', slug: 'ac-gas-refill', basePrice: 1500.00, priceType: 'INSPECTION_PLUS_QUOTE', durationMinutes: 90 }
  ];

  for (const item of serviceItemsData) {
    await prisma.serviceItem.upsert({
      where: { slug: item.slug },
      update: item,
      create: item
    });
  }
  console.log(`[Seed] Seeded ${serviceItemsData.length} service items.`);

  // 3. Fictional Users (Admin, Customer, and Professionals)
  console.log('[Seed] Seeding fictional accounts...');

  // Admin Account
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@localhire.dev' },
    update: {},
    create: {
      email: 'admin@localhire.dev',
      passwordHash: devPasswordHash,
      name: 'Governance Admin',
      phone: '+91 90000 00001',
      role: 'ADMIN',
      isActive: true,
      isEmailVerified: true,
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=AdminGov'
    }
  });

  // Customer Account
  const customerUser = await prisma.user.upsert({
    where: { email: 'customer@localhire.dev' },
    update: {},
    create: {
      email: 'customer@localhire.dev',
      passwordHash: devPasswordHash,
      name: 'Alice Henderson',
      phone: '+91 90000 00002',
      role: 'CUSTOMER',
      isActive: true,
      isEmailVerified: true,
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=AliceH'
    }
  });

  // Customer Address
  const customerAddress = await prisma.customerAddress.create({
    data: {
      customerId: customerUser.id,
      label: 'Home',
      flatNumber: 'Apt 402, Green Meadows',
      street: '14th Cross, Tilakwadi',
      landmark: 'Near Water Tower',
      city: 'Belagavi',
      state: 'Karnataka',
      postalCode: '590006',
      latitude: 15.8368,
      longitude: 74.5057,
      isDefault: true
    }
  });

  // Professional 1: Electrician
  const electricianUser = await prisma.user.upsert({
    where: { email: 'electrician@localhire.dev' },
    update: {},
    create: {
      email: 'electrician@localhire.dev',
      passwordHash: devPasswordHash,
      name: 'Marcus Chen',
      phone: '+91 90000 00003',
      role: 'WORKER',
      isActive: true,
      isEmailVerified: true,
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=MarcusC',
      workerProfile: {
        create: {
          primaryCategoryId: categoryMap['electrician'].id,
          businessName: 'Chen Electrical Solutions',
          experienceYears: 8,
          hourlyRate: 400.00,
          inspectionFee: 150.00,
          bio: 'Licensed electrician specializing in residential repairs, circuit upgrades, and chandelier installations. Fast response guaranteed.',
          verificationStatus: 'VERIFIED',
          isBackgroundChecked: true,
          isInsured: true,
          licenseNumber: 'ELEC-2021-9988',
          rating: 4.85,
          reviewsCount: 42,
          completedJobsCount: 89,
          serviceRadiusKm: 25,
          serviceAddress: 'Camp Area, Belagavi',
          latitude: 15.8569,
          longitude: 74.5165,
          skills: {
            create: [
              { skillName: 'Rewiring' },
              { skillName: 'Panel Upgrades' },
              { skillName: 'Inverter Setup' },
              { skillName: 'LED Fixtures' }
            ]
          },
          availabilities: {
            create: [
              { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
              { dayOfWeek: 2, startTime: '09:00', endTime: '18:00' },
              { dayOfWeek: 3, startTime: '09:00', endTime: '18:00' },
              { dayOfWeek: 4, startTime: '09:00', endTime: '18:00' },
              { dayOfWeek: 5, startTime: '09:00', endTime: '18:00' },
              { dayOfWeek: 6, startTime: '10:00', endTime: '16:00' }
            ]
          }
        }
      }
    }
  });

  // Professional 2: Plumber
  const plumberUser = await prisma.user.upsert({
    where: { email: 'plumber@localhire.dev' },
    update: {},
    create: {
      email: 'plumber@localhire.dev',
      passwordHash: devPasswordHash,
      name: 'James Wilson',
      phone: '+91 90000 00004',
      role: 'WORKER',
      isActive: true,
      isEmailVerified: true,
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=JamesW',
      workerProfile: {
        create: {
          primaryCategoryId: categoryMap['plumber'].id,
          businessName: 'Wilson Plumbing & Drains',
          experienceYears: 12,
          hourlyRate: 500.00,
          inspectionFee: 200.00,
          bio: 'Master certified plumber with over a decade of hands-on experience handling high-pressure leaks, water tank installations, and blockages.',
          verificationStatus: 'VERIFIED',
          isBackgroundChecked: true,
          isInsured: true,
          licenseNumber: 'PLUMB-2018-4432',
          rating: 4.90,
          reviewsCount: 78,
          completedJobsCount: 140,
          serviceRadiusKm: 20,
          serviceAddress: 'Shahapur, Belagavi',
          latitude: 15.8407,
          longitude: 74.5215,
          skills: {
            create: [
              { skillName: 'Pipe Repair' },
              { skillName: 'Clog Removal' },
              { skillName: 'Water Heaters' },
              { skillName: 'Bathroom Fittings' }
            ]
          }
        }
      }
    }
  });

  // 4. Sample Job Request, Booking, Escrow Payment & Verified Review
  console.log('[Seed] Seeding sample workflow (Job -> Booking -> Escrow -> Review)...');

  const sampleJob = await prisma.jobPost.create({
    data: {
      customerId: customerUser.id,
      categoryId: categoryMap['plumber'].id,
      addressId: customerAddress.id,
      title: 'Emergency: Burst kitchen sink pipe leakage',
      description: 'The kitchen sink pipe has developed a major leak under the basin. Water is pooling under the counter. Need someone today.',
      urgency: 'EMERGENCY_TODAY',
      scheduledDate: new Date(),
      scheduledSlot: 'Today Afternoon (02:00 PM - 05:00 PM)',
      budgetMin: 400.00,
      budgetMax: 700.00,
      status: 'COMPLETED'
    }
  });

  const sampleBooking = await prisma.booking.create({
    data: {
      bookingNumber: 'BK-2026-0001',
      customerId: customerUser.id,
      workerId: plumberUser.id,
      jobPostId: sampleJob.id,
      addressId: customerAddress.id,
      status: 'COMPLETED',
      scheduledAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
      timeSlot: '02:00 PM - 05:00 PM',
      agreedPrice: 550.00,
      actualDurationMin: 50,
      startOtp: '4821',
      completionOtp: '9134',
      startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 23 * 60 * 60 * 1000)
    }
  });

  await prisma.escrowPayment.create({
    data: {
      invoiceNumber: 'INV-2026-0001',
      bookingId: sampleBooking.id,
      customerId: customerUser.id,
      workerId: plumberUser.id,
      subtotalAmount: 550.00,
      platformFee: 27.50, // 5% platform fee
      workerPayoutAmount: 522.50,
      totalAmount: 550.00,
      currency: 'INR',
      status: 'RELEASED_TO_WORKER',
      paymentMethod: 'UPI',
      gatewayProvider: 'SIMULATED_GATEWAY',
      gatewayOrderId: 'order_dev_0001',
      gatewayPaymentId: 'pay_dev_0001',
      heldAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      releasedAt: new Date(Date.now() - 23 * 60 * 60 * 1000)
    }
  });

  await prisma.review.create({
    data: {
      bookingId: sampleBooking.id,
      customerId: customerUser.id,
      workerId: plumberUser.id,
      rating: 5,
      punctuality: 5,
      cleanliness: 5,
      communication: 5,
      comment: 'James was on site within 40 minutes of booking. Replaced the fractured pipe elbow quickly and cleaned up after. Top tier professional!',
      isVerified: true
    }
  });

  console.log('[Seed] Seeding completed successfully!');
  console.log('----------------------------------------------------');
  console.log('Fictional Development Credentials:');
  console.log('  Admin:       admin@localhire.dev       (Password: DevPass@2026!)');
  console.log('  Customer:    customer@localhire.dev    (Password: DevPass@2026!)');
  console.log('  Electrician: electrician@localhire.dev (Password: DevPass@2026!)');
  console.log('  Plumber:     plumber@localhire.dev     (Password: DevPass@2026!)');
  console.log('----------------------------------------------------');
}

main()
  .catch((e) => {
    console.error('[Seed] Error during database seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
