const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '.env') });

const connectDB = require('./config/db');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Job = require('./models/Job');
const EscrowTransaction = require('./models/EscrowTransaction');

(async () => {
  try {
    await connectDB();

    const customer = await User.findOne({ email: 'alinbagwan@gmail.com' }).lean();
    const job = await Job.findOne({ _id: '6a71ebe879679016aad57ef6' }).lean();

    if (!customer || !job) {
      console.log('No customer/job found for testing.');
      return;
    }

    const escrow = await EscrowTransaction.create({
      job: job._id,
      customer: customer._id,
      worker: '6a71ed7379679016aad57eff',
      amount: 340,
      currency: 'INR',
      status: 'Escrow_Held',
      paymentMethod: 'UPI / Card (Simulated)',
      transactionRef: `TXN_DEBUG_${Date.now()}`
    });

    console.log('CREATED_ESCROW', JSON.stringify(escrow.toObject(), null, 2));

    const token = jwt.sign({ id: customer._id.toString() }, process.env.JWT_SECRET || 'localhire_super_secret_jwt_key_2026_dev', { expiresIn: '1h' });

    const response = await fetch('http://127.0.0.1:5000/api/escrow/release', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ jobId: job._id.toString() })
    });

    const text = await response.text();
    console.log('STATUS', response.status);
    console.log('BODY', text);
  } catch (error) {
    console.error('DEBUG_ERROR_STACK', error.stack);
    console.error('DEBUG_ERROR_MESSAGE', error.message);
  } finally {
    await mongoose.disconnect();
  }
})();
