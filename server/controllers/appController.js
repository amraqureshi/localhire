const prisma = require('../config/prisma');

const statusMap = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn'
};

const formatApplication = (application) => ({
  id: application.id,
  jobId: application.jobId,
  workerId: application.workerId,
  workerName: application.worker?.name || 'Unknown Worker',
  workerAvatar: application.worker?.avatarUrl || '',
  quote: Number(application.quoteAmount || 0),
  message: application.coverMessage || '',
  status: statusMap[application.status] || 'Pending'
});

// @desc    Submit a quote/application for a job
// @route   POST /api/applications
// @access  Private (Worker)
exports.createApplication = async (req, res) => {
  try {
    const jobId = req.body.jobId || req.body.job;
    const quote = Number(req.body.quote ?? 0);
    const message = req.body.message || '';

    if (!jobId) {
      return res.status(400).json({ success: false, message: 'Job ID is required' });
    }

    if (!Number.isFinite(quote) || quote <= 0) {
      return res.status(400).json({ success: false, message: 'Quote must be a valid positive number' });
    }

    const jobExists = await prisma.jobPost.findUnique({ where: { id: String(jobId) } });
    if (!jobExists) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    const existing = await prisma.jobApplication.findFirst({
      where: {
        jobId: String(jobId),
        workerId: req.user.id
      }
    });

    if (existing) {
      return res.status(400).json({ success: false, message: 'You have already submitted a quote for this job' });
    }

    const app = await prisma.jobApplication.create({
      data: {
        jobId: String(jobId),
        workerId: req.user.id,
        quoteAmount: Number.isFinite(quote) ? quote : 0,
        coverMessage: String(message),
        status: 'PENDING'
      },
      include: {
        worker: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            email: true,
            role: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      application: formatApplication(app)
    });
  } catch (error) {
    console.error('[Application Controller] createApplication error:', error);
    res.status(500).json({
      success: false,
      message: error && error.message ? error.message : 'Server error submitting application'
    });
  }
};

// @desc    Get applications for a job (Customer view)
// @route   GET /api/applications/job/:jobId
// @access  Private
exports.getApplicationsForJob = async (req, res) => {
  try {
    const apps = await prisma.jobApplication.findMany({
      where: { jobId: req.params.jobId },
      include: {
        worker: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            email: true,
            role: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = apps.map(formatApplication);
    res.json({ success: true, count: formatted.length, applications: formatted });
  } catch (error) {
    console.error('[Application Controller] getApplicationsForJob error:', error);
    res.status(500).json({ success: false, message: 'Server error getting job applications' });
  }
};

// @desc    Get applications submitted by logged-in worker
// @route   GET /api/applications/worker/me
// @access  Private (Worker)
exports.getWorkerApplications = async (req, res) => {
  try {
    const apps = await prisma.jobApplication.findMany({
      where: { workerId: req.user.id },
      include: {
        job: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = apps.map((application) => ({
      id: application.id,
      jobId: application.jobId,
      jobTitle: application.job?.title || '',
      quote: Number(application.quoteAmount || 0),
      message: application.coverMessage || '',
      status: statusMap[application.status] || 'Pending'
    }));

    res.json({ success: true, count: formatted.length, applications: formatted });
  } catch (error) {
    console.error('[Application Controller] getWorkerApplications error:', error);
    res.status(500).json({ success: false, message: 'Server error getting worker applications' });
  }
};

// @desc    Accept a quote proposal
// @route   PUT /api/applications/:id/accept
// @access  Private (Customer)
exports.acceptQuote = async (req, res) => {
  try {
    const app = await prisma.jobApplication.findUnique({
      where: { id: req.params.id },
      include: {
        job: true,
        worker: true
      }
    });

    if (!app) {
      return res.status(404).json({ success: false, message: 'Quote proposal not found' });
    }

    if (app.job.customerId !== req.user.id && req.user.role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Only the customer who posted the job can accept quotes.' });
    }

    const updatedApp = await prisma.jobApplication.update({
      where: { id: req.params.id },
      data: { status: 'ACCEPTED' }
    });

    await prisma.jobPost.update({
      where: { id: app.jobId },
      data: { status: 'IN_PROGRESS' }
    });

    res.json({
      success: true,
      message: 'Quote accepted successfully! Job status updated to In Progress.',
      application: formatApplication({
        ...updatedApp,
        worker: app.worker
      })
    });
  } catch (error) {
    console.error('[Application Controller] acceptQuote error:', error);
    res.status(500).json({ success: false, message: 'Server error accepting quote' });
  }
};
