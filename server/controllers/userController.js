const prisma = require('../config/prisma');
const path = require('path');
const { supabaseAdmin } = require('../config/supabase');
const { stopWorkerTracking } = require('../trackingState');

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const slugify = (value) => String(value || 'other')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'other';

const ensureCategory = async (categoryName) => {
  const name = String(categoryName || 'Other').trim() || 'Other';
  let category = await prisma.serviceCategory.findFirst({
    where: {
      OR: [
        { name },
        { slug: slugify(name) }
      ]
    }
  });

  if (!category) {
    category = await prisma.serviceCategory.create({
      data: {
        name,
        slug: slugify(name),
        description: `Auto-created category for ${name}`
      }
    });
  }

  return category;
};

const formatWorker = (user) => {
  const profile = user.workerProfile;
  const categoryName = profile?.primaryCategory?.name || 'General';
  const skills = (profile?.skills || []).map((skill) => skill.skillName).filter(Boolean);
  const availabilityLabel = profile?.availabilities?.length
    ? 'Available Today'
    : 'Available Today';

  return {
    id: user.id,
    _id: user.id,
    name: user.name,
    email: user.email,
    role: 'Worker',
    avatarUrl: user.avatarUrl,
    phone: user.phone,
    category: categoryName,
    subCategory: profile?.primaryCategory?.name || '',
    hourlyRate: toNumber(profile?.hourlyRate),
    rating: toNumber(profile?.rating),
    reviewsCount: Number(profile?.reviewsCount || 0),
    completedJobsCount: Number(profile?.completedJobsCount || 0),
    bio: profile?.bio || '',
    skills,
    experience: `${Number(profile?.experienceYears || 0)} years`,
    experienceYears: Number(profile?.experienceYears || 0),
    businessName: profile?.businessName || '',
    serviceRadiusKm: Number(profile?.serviceRadiusKm || 20),
    isVerified: profile?.verificationStatus === 'VERIFIED',
    verificationStatus: profile?.verificationStatus,
    availability: availabilityLabel,
    location: {
      address: profile?.serviceAddress || 'Nearby',
      radiusKm: profile?.serviceRadiusKm || 20
    },
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
};

// @desc    Get workers with optional search, category & geospatial filters
// @route   GET /api/users/workers
// @access  Public
exports.getWorkers = async (req, res) => {
  try {
    const { q, category, maxPrice, lat, lng } = req.query;
    const radiusInput = req.query.maxDistanceKm ?? req.query.radiusKm;
    const radiusKm = radiusInput === undefined || radiusInput === '' ? 20 : Number(radiusInput);
    const hasLat = lat !== undefined && lat !== null && lat !== '';
    const hasLng = lng !== undefined && lng !== null && lng !== '';
    if (hasLat !== hasLng) {
      return res.status(400).json({ success: false, message: 'Latitude and longitude must be supplied together.' });
    }

    const latNum = hasLat ? Number(lat) : null;
    const lngNum = hasLng ? Number(lng) : null;
    if ((hasLat && (!Number.isFinite(latNum) || latNum < -90 || latNum > 90)) ||
        (hasLng && (!Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180))) {
      return res.status(400).json({ success: false, message: 'Latitude or longitude is out of range.' });
    }
    if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 100) {
      return res.status(400).json({ success: false, message: 'Search radius must be between 1 and 100 km.' });
    }

    const maxPriceNum = maxPrice !== undefined && maxPrice !== null && maxPrice !== '' ? Number(maxPrice) : null;
    if (maxPriceNum !== null && (!Number.isFinite(maxPriceNum) || maxPriceNum < 0)) {
      return res.status(400).json({ success: false, message: 'Maximum price must be a non-negative number.' });
    }

    const freshSince = new Date(Date.now() - 15 * 60 * 1000);
    let locationRows;
    if (hasLat) {
      locationRows = await prisma.$queryRaw`
        SELECT wl."workerProfileId",
               ST_Distance(wl."location", ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)::geography) / 1000.0 AS "distanceKm",
               ST_Y(wl."location"::geometry) AS "latitude",
               ST_X(wl."location"::geometry) AS "longitude"
        FROM "WorkerLocation" wl
        JOIN "WorkerProfile" wp ON wp."id" = wl."workerProfileId"
        JOIN "User" u ON u."id" = wp."userId"
        JOIN "ServiceCategory" sc ON sc."id" = wp."primaryCategoryId"
        WHERE wl."isAvailable" = true
          AND wl."sharingEnabled" = true
          AND wl."location" IS NOT NULL
          AND wl."lastLocationUpdate" >= ${freshSince}
          AND u."isActive" = true
          AND ST_DWithin(wl."location", ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)::geography, ${radiusKm * 1000})
          AND (${category || null}::text IS NULL OR lower(sc."name") = lower(${category || null}::text))
          AND (${maxPriceNum}::numeric IS NULL OR wp."hourlyRate" <= ${maxPriceNum})
        ORDER BY "distanceKm" ASC
      `;
    } else {
      locationRows = await prisma.workerLocation.findMany({
        where: {
          isAvailable: true,
          sharingEnabled: true,
          lastLocationUpdate: { gte: freshSince },
          workerProfile: {
            user: { isActive: true },
            ...(category ? { primaryCategory: { name: { equals: category, mode: 'insensitive' } } } : {}),
            ...(maxPriceNum !== null ? { hourlyRate: { lte: maxPriceNum } } : {})
          }
        },
        select: { workerProfileId: true }
      });
    }

    const locationByProfileId = new Map(locationRows.map((row) => [row.workerProfileId, row]));
    const profileIds = [...locationByProfileId.keys()];
    if (profileIds.length === 0) {
      return res.json({ success: true, count: 0, workers: [] });
    }

    const workerUsers = await prisma.user.findMany({
      where: { role: 'WORKER', isActive: true, workerProfile: { id: { in: profileIds } } },
      include: {
        workerProfile: {
          include: {
            primaryCategory: true,
            skills: true
          }
        }
      }
    });

    const qLower = String(q || '').trim().toLowerCase();
    const workers = workerUsers
      .filter((user) => user && user.workerProfile)
      .map((user) => {
        const worker = formatWorker(user);
        const locationRow = locationByProfileId.get(user.workerProfile.id);
        worker.availability = 'Available now';
        if (hasLat && locationRow) {
          worker.distanceKm = Math.round(Number(locationRow.distanceKm) * 10) / 10;
          worker.mapLocation = {
            latitude: Math.round(Number(locationRow.latitude) * 100) / 100,
            longitude: Math.round(Number(locationRow.longitude) * 100) / 100
          };
        }
        return worker;
      })
      .filter((worker) => {
        if (maxPriceNum !== null && worker.hourlyRate > maxPriceNum) return false;
        if (!qLower) return true;
        return [worker.name, worker.category, worker.bio, ...(worker.skills || [])]
          .some((value) => String(value || '').toLowerCase().includes(qLower));
      });

    if (hasLat) workers.sort((left, right) => left.distanceKm - right.distanceKm);
    return res.json({ success: true, count: workers.length, workers });
  } catch (error) {
    console.error('[User Controller] getWorkers error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving workers', error: error.message });
  }
};

// @desc    Get worker by ID
// @route   GET /api/users/workers/:id
// @access  Public
exports.getWorkerById = async (req, res) => {
  try {
    const rawId = req.params.id;
    let worker = null;

    try {
      worker = await prisma.user.findUnique({
        where: { id: rawId },
        include: {
          workerProfile: {
            include: {
              primaryCategory: true,
              skills: true
            }
          }
        }
      });
    } catch (e) {
      // Invalid UUID format or lookup exception
      worker = null;
    }

    // Fallback for legacy mock IDs (w1, w2, w3, etc.)
    if (!worker || worker.role !== 'WORKER') {
      const mockEmailMap = {
        w1: 'electrician@localhire.dev',
        w2: 'electrician@localhire.dev',
        w3: 'cleaner@localhire.dev',
        w4: 'plumber@localhire.dev',
        w5: 'driver@localhire.dev',
        w6: 'freelancer@localhire.dev',
        w7: 'electrician@localhire.dev'
      };
      const fallbackEmail = mockEmailMap[rawId];
      if (fallbackEmail) {
        worker = await prisma.user.findFirst({
          where: { email: fallbackEmail, role: 'WORKER' },
          include: {
            workerProfile: {
              include: {
                primaryCategory: true,
                skills: true
              }
            }
          }
        });
      }
      if (!worker && typeof rawId === 'string' && rawId.startsWith('w')) {
        worker = await prisma.user.findFirst({
          where: { role: 'WORKER' },
          include: {
            workerProfile: {
              include: {
                primaryCategory: true,
                skills: true
              }
            }
          }
        });
      }
    }

    if (!worker || worker.role !== 'WORKER') {
      return res.status(404).json({ success: false, message: 'Worker profile not found' });
    }

    res.json({ success: true, worker: formatWorker(worker) });
  } catch (error) {
    console.error('[User Controller] getWorkerById error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving worker profile', error: error.message });
  }
};

exports.getMyLocationSharing = async (req, res) => {
  try {
    const profile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.id },
      select: {
        id: true,
        locationSharing: {
          select: {
            isAvailable: true,
            sharingEnabled: true,
            lastLocationUpdate: true
          }
        }
      }
    });

    if (!profile) {
      return res.status(404).json({ success: false, message: 'Worker profile not found.' });
    }

    return res.json({
      success: true,
      location: profile.locationSharing || {
        isAvailable: false,
        sharingEnabled: false,
        lastLocationUpdate: null
      }
    });
  } catch (error) {
    console.error('[User Controller] getMyLocationSharing error:', error);
    return res.status(500).json({ success: false, message: 'Could not retrieve location-sharing settings.' });
  }
};

exports.updateMyLocationSharing = async (req, res) => {
  try {
    const { sharingEnabled, isAvailable, latitude, longitude, accuracy } = req.body || {};
    if (typeof sharingEnabled !== 'boolean' || typeof isAvailable !== 'boolean') {
      return res.status(400).json({ success: false, message: 'sharingEnabled and isAvailable must be booleans.' });
    }

    const profile = await prisma.workerProfile.findUnique({
      where: { userId: req.user.id },
      select: { id: true }
    });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Worker profile not found.' });
    }

    const isSharingAndAvailable = sharingEnabled && isAvailable;
    let locationData = {
      latitude: null,
      longitude: null,
      lastLocationUpdate: null
    };

    if (isSharingAndAvailable) {
      const lat = Number(latitude);
      const lng = Number(longitude);
      const accuracyValue = accuracy === undefined || accuracy === null ? null : Number(accuracy);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
        return res.status(400).json({ success: false, message: 'Valid latitude and longitude are required while sharing location.' });
      }
      if (accuracyValue !== null && (!Number.isFinite(accuracyValue) || accuracyValue < 0 || accuracyValue > 5000)) {
        return res.status(400).json({ success: false, message: 'Location accuracy must be between 0 and 5000 meters.' });
      }
      locationData = {
        latitude: lat,
        longitude: lng,
        lastLocationUpdate: new Date()
      };
    }

    const location = await prisma.workerLocation.upsert({
      where: { workerProfileId: profile.id },
      create: {
        workerProfileId: profile.id,
        ...locationData,
        isAvailable,
        sharingEnabled
      },
      update: {
        ...locationData,
        isAvailable,
        sharingEnabled
      },
      select: {
        isAvailable: true,
        sharingEnabled: true,
        lastLocationUpdate: true
      }
    });

    if (!sharingEnabled || !isAvailable) {
      stopWorkerTracking(req.user.id, 'Worker location sharing or availability was turned off.');
    }

    return res.json({ success: true, location });
  } catch (error) {
    console.error('[User Controller] updateMyLocationSharing error:', error);
    return res.status(500).json({ success: false, message: 'Could not update location-sharing settings.' });
  }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    const forbiddenRoleFields = ['role', 'roles', 'privileges', 'permissions', 'isAdmin', 'admin'];
    const attemptedForbiddenField = forbiddenRoleFields.find((field) => Object.prototype.hasOwnProperty.call(req.body, field));

    if (attemptedForbiddenField) {
      return res.status(400).json({
        success: false,
        message: 'Role and privilege updates are not allowed through the profile endpoint.'
      });
    }

    const { category, hourlyRate, experience, phone, skills, bio, availability, location, name } = req.body;
    // NOTE: 'rating' and 'reviewsCount' are intentionally excluded — they are managed only by reviewController.
    const userId = req.user.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { workerProfile: { include: { skills: true } } }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const userUpdate = {};
    if (name) userUpdate.name = String(name).trim();
    if (phone) userUpdate.phone = String(phone).trim();

    const profileUpdate = {};
    if (category) {
      const categoryRecord = await ensureCategory(category);
      profileUpdate.primaryCategoryId = categoryRecord.id;
    }
    if (hourlyRate !== undefined) profileUpdate.hourlyRate = Number(hourlyRate);
    if (bio !== undefined) profileUpdate.bio = String(bio).trim();
    if (experience !== undefined) {
      const match = String(experience).match(/\d+/);
      profileUpdate.experienceYears = match ? Number(match[0]) : 0;
    }
    if (location !== undefined) {
      profileUpdate.serviceAddress = typeof location === 'string' ? location : (location?.address || location || 'Nearby');
    }
    if (availability !== undefined) {
      profileUpdate.serviceAddress = profileUpdate.serviceAddress || String(availability).trim();
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...userUpdate,
        ...(user.workerProfile
          ? {
              workerProfile: {
                update: profileUpdate
              }
            }
          : {
              workerProfile: {
                create: {
                  ...profileUpdate,
                  primaryCategoryId: profileUpdate.primaryCategoryId || (await ensureCategory('Other')).id,
                  businessName: user.name,
                  verificationStatus: 'UNVERIFIED'
                }
              }
            })
      },
      include: {
        workerProfile: {
          include: {
            primaryCategory: true,
            skills: true
          }
        }
      }
    });

    if (Array.isArray(skills)) {
      const normalized = [...new Set(skills.map((skill) => String(skill).trim()).filter(Boolean))];
      const profileId = updatedUser.workerProfile?.id;
      if (profileId) {
        await prisma.professionalSkill.deleteMany({ where: { workerProfileId: profileId } });
        if (normalized.length > 0) {
          await prisma.professionalSkill.createMany({
            data: normalized.map((skillName) => ({ workerProfileId: profileId, skillName }))
          });
        }
      }
    }

    const refreshedUser = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        workerProfile: {
          include: {
            primaryCategory: true,
            skills: true
          }
        }
      }
    });

    const responseUser = refreshedUser && refreshedUser.workerProfile ? formatWorker(refreshedUser) : {
      id: refreshedUser.id,
      _id: refreshedUser.id,
      name: refreshedUser.name,
      email: refreshedUser.email,
      role: refreshedUser.role === 'WORKER' ? 'Worker' : refreshedUser.role === 'ADMIN' ? 'Admin' : 'Customer',
      avatarUrl: refreshedUser.avatarUrl,
      phone: refreshedUser.phone,
      createdAt: refreshedUser.createdAt,
      updatedAt: refreshedUser.updatedAt
    };

    res.json({ success: true, user: responseUser });
  } catch (error) {
    console.error('[User Controller] updateProfile error:', error);
    res.status(500).json({ success: false, message: 'Server error updating profile', error: error.message });
  }
};

exports.uploadAvatar = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: User authentication required.' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided.' });
    }

    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, message: 'Supabase Storage is not configured on the server.' });
    }

    // Determine safe extension based on MIME type
    const mimeMap = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp'
    };
    const ext = mimeMap[req.file.mimetype.toLowerCase()] || 'jpg';
    const fileName = `${userId}/avatar-${Date.now()}.${ext}`;

    // Upload to Supabase Storage bucket 'profile-photos'
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('profile-photos')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true
      });

    if (uploadError) {
      console.error('[User Controller] Supabase Storage upload error:', uploadError);
      return res.status(500).json({
        success: false,
        message: 'Failed to upload photo to storage.',
        error: uploadError.message
      });
    }

    // Retrieve public URL for the uploaded photo
    const { data: urlData } = supabaseAdmin.storage
      .from('profile-photos')
      .getPublicUrl(fileName);

    const publicUrl = urlData?.publicUrl;
    if (!publicUrl) {
      return res.status(500).json({ success: false, message: 'Could not resolve public photo URL.' });
    }

    // Update User.avatarUrl in Prisma / Supabase DB
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: publicUrl },
      include: {
        workerProfile: {
          include: {
            primaryCategory: true,
            skills: true
          }
        }
      }
    });

    const formatted = updatedUser.workerProfile ? formatWorker(updatedUser) : {
      id: updatedUser.id,
      _id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role === 'WORKER' ? 'Worker' : updatedUser.role === 'ADMIN' ? 'Admin' : 'Customer',
      avatarUrl: updatedUser.avatarUrl,
      phone: updatedUser.phone,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt
    };

    res.json({
      success: true,
      message: 'Profile photo uploaded successfully!',
      avatarUrl: publicUrl,
      user: formatted
    });
  } catch (error) {
    console.error('[User Controller] uploadAvatar error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error processing profile photo upload',
      error: error.message
    });
  }
};

exports.deleteAvatar = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: User authentication required.' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
      include: {
        workerProfile: {
          include: {
            primaryCategory: true,
            skills: true
          }
        }
      }
    });

    const formatted = updatedUser.workerProfile ? formatWorker(updatedUser) : {
      id: updatedUser.id,
      _id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role === 'WORKER' ? 'Worker' : updatedUser.role === 'ADMIN' ? 'Admin' : 'Customer',
      avatarUrl: null,
      phone: updatedUser.phone,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt
    };

    res.json({
      success: true,
      message: 'Profile photo removed successfully.',
      user: formatted
    });
  } catch (error) {
    console.error('[User Controller] deleteAvatar error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error removing profile photo',
      error: error.message
    });
  }
};
