const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
const STATUSES = ['pending', 'reviewed', 'accepted', 'rejected'];

function applicationWithJob(id) {
  return db
    .prepare(
      `SELECT a.*, j.title AS job_title, j.company, j.location, j.type, j.status AS job_status
       FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.id = ?`
    )
    .get(id);
}

/**
 * POST /api/applications — a job seeker applies to an open job.
 */
router.post('/', requireAuth, requireRole('seeker'), (req, res) => {
  const jobId = Number(req.body?.job_id);
  const coverLetter = String(req.body?.cover_letter || '').trim();

  const job = db.prepare("SELECT * FROM jobs WHERE id = ? AND status = 'open'").get(jobId);
  if (!job) return res.status(404).json({ error: 'This job is not open for applications.' });

  const already = db
    .prepare('SELECT id FROM applications WHERE job_id = ? AND seeker_id = ?')
    .get(jobId, req.user.id);
  if (already) return res.status(409).json({ error: 'You have already applied to this job.' });

  const result = db
    .prepare('INSERT INTO applications (job_id, seeker_id, cover_letter) VALUES (?, ?, ?)')
    .run(jobId, req.user.id, coverLetter);

  res.status(201).json({ application: applicationWithJob(result.lastInsertRowid) });
});

/**
 * GET /api/applications — the signed-in seeker's applications.
 */
router.get('/', requireAuth, requireRole('seeker'), (req, res) => {
  const applications = db
    .prepare(
      `SELECT a.*, j.title AS job_title, j.company, j.location, j.type, j.status AS job_status
       FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.seeker_id = ?
       ORDER BY a.created_at DESC, a.id DESC`
    )
    .all(req.user.id);

  res.json({ applications });
});

/**
 * PATCH /api/applications/:id — the employer moves an application through review.
 */
router.patch('/:id', requireAuth, requireRole('employer', 'admin'), (req, res) => {
  const application = db
    .prepare(
      `SELECT a.*, j.employer_id
       FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.id = ?`
    )
    .get(req.params.id);

  if (!application) return res.status(404).json({ error: 'Application not found.' });
  if (req.user.role !== 'admin' && application.employer_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only review applications for your own jobs.' });
  }

  const status = req.body?.status;
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}.` });
  }

  db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(status, application.id);
  res.json({ application: applicationWithJob(application.id) });
});

module.exports = router;
