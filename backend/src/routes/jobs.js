const express = require('express');
const db = require('../db');
const { optionalAuth, requireAuth, requireRole } = require('../auth');

const router = express.Router();

const JOB_FIELDS = ['title', 'location', 'type', 'category', 'salary', 'description'];

function readJobPayload(body) {
  const payload = {};
  for (const field of JOB_FIELDS) {
    payload[field] = String(body?.[field] ?? '').trim();
  }
  return payload;
}

function validateJob(payload) {
  if (payload.title.length < 3) return 'Job title must be at least 3 characters.';
  if (payload.location.length < 2) return 'Please provide a job location.';
  if (payload.description.length < 20) return 'Description must be at least 20 characters.';
  return null;
}

function jobDetail(id) {
  return db
    .prepare(
      `SELECT j.*, u.name AS employer_name, u.email AS employer_email
       FROM jobs j JOIN users u ON u.id = j.employer_id
       WHERE j.id = ?`
    )
    .get(id);
}

/**
 * GET /api/jobs?q=&location=&type=&category=
 * Public list of open jobs with basic search.
 */
router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  const location = String(req.query.location || '').trim();
  const type = String(req.query.type || '').trim();
  const category = String(req.query.category || '').trim();

  const where = ["j.status = 'open'", 'u.suspended = 0'];
  const params = [];

  if (q) {
    where.push('(j.title LIKE ? OR j.description LIKE ? OR j.company LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (location) {
    where.push('j.location LIKE ?');
    params.push(`%${location}%`);
  }
  if (type) {
    where.push('j.type = ?');
    params.push(type);
  }
  if (category) {
    where.push('j.category = ?');
    params.push(category);
  }

  const jobs = db
    .prepare(
      `SELECT j.*, u.name AS employer_name
       FROM jobs j JOIN users u ON u.id = j.employer_id
       WHERE ${where.join(' AND ')}
       ORDER BY j.created_at DESC, j.id DESC`
    )
    .all(...params);

  res.json({
    jobs,
    filters: {
      types: db.prepare('SELECT DISTINCT type AS value FROM jobs ORDER BY type').all(),
      categories: db.prepare('SELECT DISTINCT category AS value FROM jobs ORDER BY category').all(),
    },
  });
});

router.get('/:id', optionalAuth, (req, res) => {
  const job = jobDetail(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  let hasApplied = false;
  if (req.user && req.user.role === 'seeker') {
    hasApplied = Boolean(
      db
        .prepare('SELECT id FROM applications WHERE job_id = ? AND seeker_id = ?')
        .get(job.id, req.user.id)
    );
  }

  res.json({ job, hasApplied });
});

/**
 * POST /api/jobs — employer creates a vacancy.
 */
router.post('/', requireAuth, requireRole('employer'), (req, res) => {
  const payload = readJobPayload(req.body);
  const problem = validateJob(payload);
  if (problem) return res.status(400).json({ error: problem });

  const result = db
    .prepare(
      `INSERT INTO jobs (employer_id, title, company, location, type, category, salary, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      payload.title,
      req.user.company || req.user.name,
      payload.location,
      payload.type || 'Full-time',
      payload.category || 'General',
      payload.salary,
      payload.description
    );

  res.status(201).json({ job: jobDetail(result.lastInsertRowid) });
});

/**
 * PATCH /api/jobs/:id — the owning employer (or an admin) updates a vacancy.
 */
router.patch('/:id', requireAuth, requireRole('employer', 'admin'), (req, res) => {
  const job = jobDetail(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (req.user.role !== 'admin' && job.employer_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only edit your own job posts.' });
  }

  const payload = readJobPayload(req.body);
  const problem = validateJob(payload);
  if (problem) return res.status(400).json({ error: problem });

  let status = job.status;
  if (req.body?.status !== undefined) {
    if (!['open', 'closed'].includes(req.body.status)) {
      return res.status(400).json({ error: 'Status must be either "open" or "closed".' });
    }
    status = req.body.status;
  }

  db.prepare(
    `UPDATE jobs
     SET title = ?, location = ?, type = ?, category = ?, salary = ?, description = ?, status = ?
     WHERE id = ?`
  ).run(
    payload.title,
    payload.location,
    payload.type || 'Full-time',
    payload.category || 'General',
    payload.salary,
    payload.description,
    status,
    job.id
  );

  res.json({ job: jobDetail(job.id) });
});

/**
 * PATCH /api/jobs/:id/status — quick open/closed toggle for the owning employer.
 */
router.patch('/:id/status', requireAuth, requireRole('employer', 'admin'), (req, res) => {
  const job = jobDetail(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (req.user.role !== 'admin' && job.employer_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only manage your own job posts.' });
  }
  const status = req.body?.status;
  if (!['open', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'Status must be either "open" or "closed".' });
  }
  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, job.id);
  res.json({ job: jobDetail(job.id) });
});

router.delete('/:id', requireAuth, requireRole('employer', 'admin'), (req, res) => {
  const job = jobDetail(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (req.user.role !== 'admin' && job.employer_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own job posts.' });
  }
  db.prepare('DELETE FROM jobs WHERE id = ?').run(job.id);
  res.json({ ok: true });
});

/**
 * GET /api/jobs/:id/applications — applications for one of the employer's jobs.
 */
router.get('/:id/applications', requireAuth, requireRole('employer', 'admin'), (req, res) => {
  const job = jobDetail(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (req.user.role !== 'admin' && job.employer_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only view applications for your own jobs.' });
  }

  const applications = db
    .prepare(
      `SELECT a.*, u.name AS seeker_name, u.email AS seeker_email
       FROM applications a JOIN users u ON u.id = a.seeker_id
       WHERE a.job_id = ?
       ORDER BY a.created_at DESC`
    )
    .all(job.id);

  res.json({ job, applications });
});

module.exports = router;
