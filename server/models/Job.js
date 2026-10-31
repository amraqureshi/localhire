const mongoose = require('mongoose');

const JobSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Please provide a job title'],
      trim: true
    },
    description: {
      type: String,
      required: [true, 'Please provide a job description']
    },
    category: {
      type: String,
      required: [true, 'Please select a job category']
    },
    budget: {
      type: String,
      required: [true, 'Please state a budget or rate range']
    },
    urgency: {
      type: String,
      enum: ['Today', 'This week', 'Flexible'],
      default: 'Flexible'
    },
    status: {
      type: String,
      enum: ['Open', 'In Progress', 'Completed', 'Cancelled'],
      default: 'Open'
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    assignedWorker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [74.5057, 15.8368]
      },
      address: {
        type: String,
        default: ''
      }
    }
  },
  { timestamps: true }
);

JobSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Job', JobSchema);
