const prisma = require('../config/prisma');

// @desc    Get system-wide governance metrics
// @route   GET /api/admin/metrics
// @access  Private (Admin)
exports.getMetrics = async (req, res) => {
  try {
    const [
      totalUsers,
      totalWorkers,
      totalCustomers,
      totalJobs,
      activeJobs,
      completedJobs,
      totalApplications
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: 'WORKER' } }),
      prisma.user.count({ where: { role: 'CUSTOMER' } }),
      prisma.jobPost.count(),
      prisma.jobPost.count({ where: { status: { in: ['OPEN', 'QUOTED', 'ASSIGNED', 'IN_PROGRESS'] } } }),
      prisma.jobPost.count({ where: { status: 'COMPLETED' } }),
      prisma.jobApplication.count()
    ]);

    res.json({
      success: true,
      metrics: {
        totalUsers,
        totalWorkers,
        totalCustomers,
        totalJobs,
        activeJobs,
        completedJobs,
        totalApplications
      }
    });
  } catch (error) {
    console.error('[Admin Controller] getMetrics error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving admin metrics' });
  }
};

// @desc    Get all users for admin listing
// @route   GET /api/admin/users
// @access  Private (Admin)
exports.getAllUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        avatarUrl: true,
        isActive: true,
        isEmailVerified: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({ success: true, count: users.length, users });
  } catch (error) {
    console.error('[Admin Controller] getAllUsers error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving user accounts' });
  }
};

// @desc    Delete a user account
// @route   DELETE /api/admin/users/:id
// @access  Private (Admin)
exports.deleteUser = async (req, res) => {
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'User account removed successfully' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    console.error('[Admin Controller] deleteUser error:', error);
    res.status(500).json({ success: false, message: 'Server error removing user' });
  }
};

// @desc    Delete/Moderate a job post
// @route   DELETE /api/admin/jobs/:id
// @access  Private (Admin)
exports.deleteJob = async (req, res) => {
  try {
    await prisma.jobPost.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Job post removed successfully' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Job post not found' });
    }
    console.error('[Admin Controller] deleteJob error:', error);
    res.status(500).json({ success: false, message: 'Server error moderating job post' });
  }
};
