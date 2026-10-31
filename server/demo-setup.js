// Prepare a fresh IN_PROGRESS booking for the demo
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // Check current state
  const bookings = await p.booking.findMany({
    where: { customer: { email: 'customer@localhire.dev' } },
    include: { worker: { select: { name: true, email: true } }, customer: { select: { name: true } } },
    orderBy: { createdAt: 'desc' }
  });
  
  console.log('Current bookings:');
  bookings.forEach(b => console.log(`  ${b.id.slice(0,8)} | ${b.status} | W: ${b.worker?.name} | Rs. ${b.agreedPrice}`));

  const inProg = bookings.find(b => b.status === 'IN_PROGRESS');
  if (inProg) {
    console.log('\n✅ Already have IN_PROGRESS booking:', inProg.id.slice(0,8));
    return;
  }

  // Move a REQUESTED booking to IN_PROGRESS
  const requested = bookings.find(b => b.status === 'REQUESTED');
  if (requested) {
    await p.booking.update({ where: { id: requested.id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    console.log('\n✅ Moved to IN_PROGRESS:', requested.id.slice(0,8), '| W:', requested.worker?.name, '| Rs.', requested.agreedPrice);
    return;
  }

  // No bookings to use — create one
  const customer = await p.user.findFirst({ where: { email: 'customer@localhire.dev' } });
  const worker = await p.user.findFirst({ where: { email: 'electrician@localhire.dev' } });
  if (!customer || !worker) { console.log('Missing users'); return; }

  const newBooking = await p.booking.create({
    data: {
      bookingNumber: `BK-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`,
      customerId: customer.id,
      workerId: worker.id,
      agreedPrice: 500,
      scheduledAt: new Date(),
      timeSlot: 'Morning',
      status: 'IN_PROGRESS',
      startedAt: new Date()
    }
  });
  console.log('\n✅ Created new IN_PROGRESS booking:', newBooking.id.slice(0,8), '| Rs. 500');
}

main().catch(console.error).finally(() => p.$disconnect());
