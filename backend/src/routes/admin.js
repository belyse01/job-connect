const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

router.get('/stats', (_req, res) => {
  const count = (sql, ...params) => db.prepare(sql).get(...params).count;

  const stats = {
    seekers: count("SELECT COUNT(*) AS count FROM users WHERE role = 'seeker'"),
    employers: count("SELECT COUNT(*) AS count FROM users WHERE role = 'employer'"),
    suspendedUsers: count('SELECT COUNT(*) AS count FROM users WHERE suspended = 1'),
    pendingJobs: count("SELECT COUNT(*) AS count FROM jobs WHERE moderation = 'pending'"),
    openJobs: count("SELECT COUNT(*) AS count FROM jobs WHERE status = 'open' AND moderation = 'approved'"),
    closedJobs: count("SELECT COUNT(*) AS count FROM jobs WHERE status = 'closed'"),
    rejectedJobs: count("SELECT COUNT(*) AS count FROM jobs WHERE moderation = 'rejected'"),
    applications: count('SELECT COUNT(*) AS count FROM applications'),
    pendingApplications: count("SELECT COUNT(*) AS count FROM applications WHERE status = 'pending'"),
    contactMessages: count('SELECT COUNT(*) AS count FROM contact_messages'),
  };

  const recentApplications = db
    .prepare(
      `SELECT a.id, a.status, a.created_at, j.title AS job_title,
              u.name AS seeker_name, j.company
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN users u ON u.id = a.seeker_id
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 8`
    )
    .all();

  res.json({ stats, recentApplications });
});

router.get('/users', (req, res) => {
  const role = String(req.query.role || '').trim();
  const q = String(req.query.q || '').trim();

  const where = [];
  const params = [];
  if (['seeker', 'employer', 'admin'].includes(role)) {
    where.push('u.role = ?');
    params.push(role);
  }
  if (q) {
    where.push('(u.name LIKE ? OR u.email LIKE ? OR u.company LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const users = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.company, u.suspended, u.created_at,
              (SELECT COUNT(*) FROM jobs j WHERE j.employer_id = u.id) AS job_count,
              (SELECT COUNT(*) FROM applications a WHERE a.seeker_id = u.id) AS application_count
       FROM users u
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY u.created_at DESC, u.id DESC`
    )
    .all(...params)
    .map((user) => ({ ...user, suspended: Boolean(user.suspended) }));

  res.json({ users });
});

router.patch('/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role === 'admin') {
    return res.status(400).json({ error: 'Administrator accounts cannot be suspended.' });
  }
  if (typeof req.body?.suspended !== 'boolean') {
    return res.status(400).json({ error: 'Provide a boolean "suspended" value.' });
  }

  db.prepare('UPDATE users SET suspended = ? WHERE id = ?').run(
    req.body.suspended ? 1 : 0,
    user.id
  );
  if (req.body.suspended) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  }

  res.json({ id: user.id, suspended: req.body.suspended });
});

router.delete('/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role === 'admin') {
    return res.status(400).json({ error: 'Administrator accounts cannot be deleted.' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  res.json({ ok: true });
});

router.get('/jobs', (_req, res) => {
  const jobs = db
    .prepare(
      `SELECT j.*, u.name AS employer_name, u.email AS employer_email,
              (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS application_count
       FROM jobs j JOIN users u ON u.id = j.employer_id
       ORDER BY j.created_at DESC, j.id DESC`
    )
    .all();

  res.json({ jobs });
});

/**
 * PATCH /api/admin/jobs/:id — approve or reject a submitted vacancy, or
 * open/close a listing that is already approved.
 */
router.patch('/jobs/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  const moderation = req.body?.moderation;
  const status = req.body?.status;

  if (moderation !== undefined) {
    if (!['approved', 'rejected'].includes(moderation)) {
      return res.status(400).json({ error: 'Moderation must be either "approved" or "rejected".' });
    }
    db.prepare('UPDATE jobs SET moderation = ? WHERE id = ?').run(moderation, job.id);
    return res.json({ ok: true, moderation });
  }

  if (!['open', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'Status must be either "open" or "closed".' });
  }
  if (status === 'open' && job.moderation !== 'approved') {
    return res.status(400).json({ error: 'Approve this job before opening it.' });
  }
  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, job.id);
  res.json({ ok: true, status });
});

/**
 * GET /api/admin/messages?q= — messages sent through the public contact form.
 */
router.get('/messages', (req, res) => {
  const q = String(req.query.q || '').trim();

  const where = [];
  const params = [];
  if (q) {
    where.push('(m.name LIKE ? OR m.email LIKE ? OR m.subject LIKE ? OR m.message LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const messages = db
    .prepare(
      `SELECT m.* FROM contact_messages m
       ${clause}
       ORDER BY m.created_at DESC, m.id DESC`
    )
    .all(...params);

  res.json({ messages, total: messages.length });
});

/**
 * GET /api/admin/messages/:id — one contact message in full.
 */
router.get('/messages/:id', (req, res) => {
  const message = db.prepare('SELECT * FROM contact_messages WHERE id = ?').get(req.params.id);
  if (!message) return res.status(404).json({ error: 'Message not found.' });
  res.json({ message });
});

/**
 * DELETE /api/admin/messages/:id — remove a message that has been handled.
 */
router.delete('/messages/:id', (req, res) => {
  const result = db.prepare('DELETE FROM contact_messages WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Message not found.' });
  res.json({ ok: true });
});

router.delete('/jobs/:id', (req, res) => {
  const result = db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Job not found.' });
  res.json({ ok: true });
});

module.exports = router;
