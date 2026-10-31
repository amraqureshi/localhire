const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: true,
      lowercase: true,
      trim: true
    },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minlength: 6,
      select: false
    },
    role: {
      type: String,
      enum: ['Customer', 'Worker', 'Admin'],
      default: 'Customer'
    },
    phone: {
      type: String,
      default: ''
    },
    avatarUrl: {
      type: String,
      default: ''
    },
    // Worker specific fields
    category: {
      type: String,
      default: ''
    },
    subCategory: {
      type: String,
      default: ''
    },
    experience: {
      type: String,
      default: ''
    },
    hourlyRate: {
      type: Number,
      default: 0
    },
    skills: [{
      type: String
    }],
    availability: {
      type: String,
      default: 'Available Today'
    },
    bio: {
      type: String,
      default: ''
    },
    rating: {
      type: Number,
      default: 5.0
    },
    reviewsCount: {
      type: Number,
      default: 0
    },
    favorites: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    // GeoJSON Point location for 2dsphere queries
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

// Index location for geospatial queries
UserSchema.index({ location: '2dsphere' });

// Hash password before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Match user password
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);
