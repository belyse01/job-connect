const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

router.use(requireAuth, requireRole('employer'));

/**
 * GET /api/employer/overview — dashboard data for the signed-in employer.
 */
router.get('/overview', (req, res) => {
  const jobs = db
    .prepare(
      `SELECT j.*,
              (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS application_count,
              (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'pending') AS pending_count
       FROM jobs j
       WHERE j.employer_id = ?
       ORDER BY j.created_at DESC, j.id DESC`
    )
    .all(req.user.id);

  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS applications,
         COALESCE(SUM(CASE WHEN a.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
         COALESCE(SUM(CASE WHEN a.status = 'shortlisted' THEN 1 ELSE 0 END), 0) AS shortlisted,
         COALESCE(SUM(CASE WHEN a.status = 'selected' THEN 1 ELSE 0 END), 0) AS selected
       FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE j.employer_id = ?`
    )
    .get(req.user.id);

  res.json({
    jobs,
    stats: {
      openJobs: jobs.filter((job) => job.status === 'open' && job.moderation === 'approved').length,
      totalJobs: jobs.length,
      pendingModeration: jobs.filter((job) => job.moderation === 'pending').length,
      applications: totals.applications,
      pending: totals.pending,
      shortlisted: totals.shortlisted,
      selected: totals.selected,
    },
  });
});

/**
 * GET /api/employer/applications — every application across the employer's jobs.
 */
router.get('/applications', (req, res) => {
  const applications = db
    .prepare(
      `SELECT a.*, j.title AS job_title, u.name AS seeker_name, u.email AS seeker_email
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN users u ON u.id = a.seeker_id
       WHERE j.employer_id = ?
       ORDER BY a.created_at DESC, a.id DESC`
    )
    .all(req.user.id);

  res.json({ applications });
});

module.exports = router;
