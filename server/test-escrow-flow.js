// Full end-to-end test of the complete escrow release flow
const http = require('http');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost', port: 5000, ...options,
      headers: { 'Content-Type': 'application/json', ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}), ...(options.headers || {}) }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch(e) { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function main() {
  // 1. Health check
  console.log('=== LocalHire Escrow End-to-End Test ===\n');
  const health = await request({ path: '/api/health', method: 'GET' });
  console.log('1. Server:', health.status === 200 ? '✅ Online' : '❌ Down');

  // 2. Login as customer
  const loginC = await request({ path: '/api/auth/login', method: 'POST' }, { email: 'customer@localhire.dev', password: 'DevPass@2026!' });
  const tokenC = loginC.body.token;
  console.log('2. Customer login:', tokenC ? '✅ OK' : '❌ Failed', '(' + (loginC.body.user && loginC.body.user.name || '') + ')');
  if (!tokenC) { console.log(JSON.stringify(loginC.body).slice(0,200)); return; }

  // 3. Login as worker
  const loginW = await request({ path: '/api/auth/login', method: 'POST' }, { email: 'electrician@localhire.dev', password: 'DevPass@2026!' });
  const tokenW = loginW.body.token;
  console.log('3. Worker login:', tokenW ? '✅ OK' : '❌ Failed', '(' + (loginW.body.user && loginW.body.user.name || '') + ')');

  // 4. Check customer bookings
  const bRes = await request({ path: '/api/bookings/my', method: 'GET', headers: { 'Authorization': 'Bearer ' + tokenC } });
  const allB = bRes.body.bookings || [];
  const inProg = allB.filter(b => b.status === 'IN_PROGRESS');
  console.log('\n4. Customer bookings — total:', allB.length, '| IN_PROGRESS:', inProg.length);

  let testBooking = inProg[0];

  // If no IN_PROGRESS booking, move one from REQUESTED
  if (!testBooking) {
    const requested = allB.filter(b => b.status === 'REQUESTED');
    if (requested.length > 0) {
      console.log('   No IN_PROGRESS found. Moving REQUESTED booking to IN_PROGRESS...');
      const upd = await request(
        { path: `/api/bookings/${requested[0].id}/status`, method: 'PUT', headers: { 'Authorization': 'Bearer ' + tokenW } },
        { status: 'CONFIRMED' }
      );
      console.log('   CONFIRMED:', upd.status);
      const upd2 = await request(
        { path: `/api/bookings/${requested[0].id}/status`, method: 'PUT', headers: { 'Authorization': 'Bearer ' + tokenW } },
        { status: 'IN_PROGRESS' }
      );
      console.log('   IN_PROGRESS:', upd2.status);
      if (upd2.status === 200) {
        testBooking = { ...requested[0], status: 'IN_PROGRESS' };
      }
    }
  }

  if (!testBooking) {
    console.log('\n❌ No booking available to test. Create a booking first.');
    return;
  }

  console.log('   Test booking:', testBooking.id.slice(0,8), '| Worker:', testBooking.worker && testBooking.worker.name, '| Rs.', testBooking.agreedPrice);

  // 5. Release escrow via UPI
  console.log('\n5. Releasing escrow payment (UPI)...');
  const release = await request(
    { path: '/api/escrow/release', method: 'POST', headers: { 'Authorization': 'Bearer ' + tokenC } },
    { bookingId: testBooking.id, paymentMethod: 'UPI' }
  );
  console.log('   HTTP:', release.status, '| Success:', release.body.success);
  console.log('   Message:', release.body.message);
  if (release.body.escrow) {
    console.log('   Invoice:', release.body.escrow.invoiceNumber);
    console.log('   Method:', release.body.escrow.paymentMethod);
    console.log('   Amount:', release.body.escrow.amount);
    console.log('   Status:', release.body.escrow.status);
  }

  // 6. Verify booking is now COMPLETED
  const bRes2 = await request({ path: '/api/bookings/my', method: 'GET', headers: { 'Authorization': 'Bearer ' + tokenC } });
  const updated = (bRes2.body.bookings || []).find(b => b.id === testBooking.id);
  console.log('\n6. Booking status after release:', updated ? updated.status : 'NOT FOUND');

  // 7. Check wallet ledger
  const ledger = await request({ path: '/api/escrow/ledger', method: 'GET', headers: { 'Authorization': 'Bearer ' + tokenC } });
  const txns = ledger.body.transactions || [];
  console.log('\n7. Wallet ledger entries:', txns.length);
  txns.forEach(t => console.log(`   ${t.invoiceNumber} | ₹${t.amount} | ${t.status} | ${t.paymentMethod} | ${t.isSimulated ? 'SIMULATED' : 'LIVE'}`));

  // 8. Final summary
  console.log('\n========================================');
  if (release.body.success) {
    console.log('🎉 FULL ESCROW FLOW WORKS END-TO-END!');
    console.log('\nDemo steps for presentation:');
    console.log('  1. Login as worker → accept booking → start service → mark complete');
    console.log('  2. Login as customer → My Jobs → see green "Approve & Release Payment" button');
    console.log('  3. Click it → select UPI or Cash → Confirm');
    console.log('  4. Payment released, booking marked COMPLETED!');
  } else {
    console.log('⚠️  Release failed:', release.body.message);
  }
}

main().catch(e => console.error('ERROR:', e));
