// LocalHire - Escrow Transaction Model
// Manages milestone payments, escrow holdings, and settlement payouts between Customers and Workers

const mongoose = require('mongoose');

const EscrowTransactionSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    worker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    amount: {
      type: Number,
      required: [true, 'Escrow transaction requires an amount']
    },
    currency: {
      type: String,
      default: 'INR'
    },
    status: {
      type: String,
      enum: ['Escrow_Held', 'Released', 'Disputed', 'Refunded'],
      default: 'Escrow_Held'
    },
    paymentMethod: {
      type: String,
      default: 'UPI / Card (Simulated)'
    },
    transactionRef: {
      type: String,
      required: true,
      unique: true
    },
    disputeReason: {
      type: String,
      default: ''
    },
    releasedAt: {
      type: Date
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('EscrowTransaction', EscrowTransactionSchema);
