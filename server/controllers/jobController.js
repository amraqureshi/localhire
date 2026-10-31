const prisma = require('../config/prisma');

const slugify = (value) => String(value || 'other')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'other';

const normalizeStatus = (status) => {
  const value = String(status || 'OPEN').toUpperCase();
  const map = {
    OPEN: 'Open',
    QUOTED: 'Quoted',
    ASSIGNED: 'Assigned',
    IN_PROGRESS: 'In Progress',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
    EXPIRED: 'Expired',
    'IN PROGRESS': 'In Progress'
  };
  return map[value] || 'Open';
};

const normalizeUrgency = (urgency) => {
  const value = String(urgency || 'FLEXIBLE').toLowerCase();
  if (value.includes('today') || value === 'emergency_today') return 'Today';
  if (value.includes('week') || value === 'this_week') return 'This week';
  return 'Flexible';
};

const normalizeUrgencyEnum = (urgency) => {
  const value = String(urgency || 'FLEXIBLE').toLowerCase();
  if (value.includes('today') || value === 'emergency_today') return 'EMERGENCY_TODAY';
  if (value.includes('week') || value === 'this_week') return 'THIS_WEEK';
  return 'FLEXIBLE';
};

const parseBudgetNumbers = (rawBudget) => {
  const text = String(rawBudget || '').trim();
  if (!text) return { min: null, max: null };
  const matches = text.match(/\d+(?:\.\d+)?/g) || [];
  if (matches.length === 0) return { min: null, max: null };
  const numbers = matches.map(Number);
  return {
    min: numbers[0] ?? null,
    max: numbers[1] ?? numbers[0] ?? null
  };
};

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

const formatJob = (job) => {
  const minBudget = job.budgetMin != null ? Number(job.budgetMin) : null;
  const maxBudget = job.budgetMax != null ? Number(job.budgetMax) : null;
  const budgetText = minBudget !== null
    ? (maxBudget !== null && maxBudget !== minBudget ? `₹${minBudget} - ₹${maxBudget}` : `₹${minBudget}`)
    : (job.budget ? String(job.budget) : 'Flexible');
  const locationValue = job.address || job.location || { address: 'Local service request' };

  return {
    id: job.id,
    _id: job.id,
    title: job.title,
    description: job.description,
    category: job.category?.name || 'Other',
    budget: budgetText,
    urgency: normalizeUrgency(job.urgency),
    status: normalizeStatus(job.status),
    customerName: job.customer?.name || 'Anonymous',
    customerId: job.customer?.id || null,
    location: locationValue,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
};

// @desc    Get all jobs with optional filters
// @route   GET /api/jobs
// @access  Public
exports.getJobs = async (req, res) => {
  try {
    const { q, category, status } = req.query;

    const where = {};

    if (category) {
      where.category = {
        OR: [
          { name: category },
          { slug: slugify(category) }
        ]
      };
    }

    if (status) {
      where.status = String(status).toUpperCase();
    }

    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { category: { is: { name: { contains: q, mode: 'insensitive' } } } }
      ];
    }

    const jobs = await prisma.jobPost.findMany({
      where,
      include: {
        customer: true,
        category: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = jobs.map(formatJob);
    res.json({ success: true, count: formatted.length, jobs: formatted });
  } catch (error) {
    console.error('[Job Controller] getJobs error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving jobs', error: error.message });
  }
};

// @desc    Get single job by ID
// @route   GET /api/jobs/:id
// @access  Public
exports.getJobById = async (req, res) => {
  try {
    const job = await prisma.jobPost.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        category: true
      }
    });

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job post not found' });
    }

    res.json({
      success: true,
      job: formatJob(job)
    });
  } catch (error) {
    console.error('[Job Controller] getJobById error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving job details', error: error.message });
  }
};

// @desc    Create new job post
// @route   POST /api/jobs
// @access  Private (Customer)
exports.createJob = async (req, res) => {
  try {
    const { title, description, category, budget, urgency, location, lat, lng } = req.body;

    if (!title || !description) {
      return res.status(400).json({ success: false, message: 'Title and description are required' });
    }

    const categoryRecord = await ensureCategory(category || 'Other');
    const budgetNumbers = parseBudgetNumbers(budget);
    const urgencyValue = normalizeUrgencyEnum(urgency);

    const job = await prisma.jobPost.create({
      data: {
        customerId: req.user.id,
        categoryId: categoryRecord.id,
        title: String(title).trim(),
        description: String(description).trim(),
        urgency: urgencyValue,
        status: 'OPEN',
        budgetMin: budgetNumbers.min !== null ? budgetNumbers.min : null,
        budgetMax: budgetNumbers.max !== null ? budgetNumbers.max : null,
        scheduledDate: null,
        scheduledSlot: null,
        addressId: null
      },
      include: {
        customer: true,
        category: true
      }
    });

    const jobPayload = {
      ...formatJob(job),
      customerName: req.user.name,
      customerId: req.user.id,
      category: categoryRecord.name,
      budget: budget || (budgetNumbers.min !== null ? (budgetNumbers.max !== null && budgetNumbers.max !== budgetNumbers.min ? `${budgetNumbers.min} - ${budgetNumbers.max}` : `${budgetNumbers.min}`) : 'Flexible'),
      location: location || { address: 'Local service request' }
    };

    res.status(201).json({ success: true, job: jobPayload });
  } catch (error) {
    console.error('[Job Controller] createJob error:', error);
    res.status(500).json({ success: false, message: 'Server error creating job post', error: error.message });
  }
};

const VALID_JOB_STATUSES = ['OPEN', 'QUOTED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED'];

// @desc    Update job status (e.g. Open -> In Progress -> Completed)
// @route   PUT /api/jobs/:id/status
// @access  Private
exports.updateJobStatus = async (req, res) => {
  try {
    const { status, assignedWorkerId } = req.body;

    const existingJob = await prisma.jobPost.findUnique({ where: { id: req.params.id } });
    if (!existingJob) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (existingJob.customerId !== req.user.id && req.user.role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Only the customer who posted this job or an Admin can change its status.' });
    }

    const nextStatus = status ? String(status).toUpperCase() : existingJob.status;
    if (!VALID_JOB_STATUSES.includes(nextStatus)) {
      return res.status(400).json({ success: false, message: `Invalid status. Valid values: ${VALID_JOB_STATUSES.join(', ')}` });
    }

    const job = await prisma.jobPost.update({
      where: { id: req.params.id },
      data: {
        status: nextStatus
      },
      include: {
        customer: true,
        category: true
      }
    });

    res.json({
      success: true,
      job: {
        ...formatJob(job),
        assignedWorkerId: assignedWorkerId || null
      }
    });
  } catch (error) {
    console.error('[Job Controller] updateJobStatus error:', error);
    res.status(500).json({ success: false, message: 'Server error updating job status', error: error.message });
  }
};
