const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
const STATUSES = ['pending', 'shortlisted', 'selected', 'rejected'];

const uploadDir = path.join(__dirname, '..', '..', 'data', 'uploads');
const MAX_CV_BYTES = 2 * 1024 * 1024;
const CV_TYPES = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

function saveCv(cv) {
  if (!cv || typeof cv !== 'object' || !cv.data) {
    return { error: 'Please attach your CV (PDF, DOC or DOCX, up to 2 MB).' };
  }

  const name = String(cv.name || '').trim().slice(0, 120) || 'cv';
  const type = String(cv.type || '').trim();
  const extension = CV_TYPES[type];
  if (!extension) {
    return { error: 'Your CV must be a PDF, DOC or DOCX file.' };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cv.data)) {
    return { error: 'The CV file could not be read. Please try again.' };
  }

  const buffer = Buffer.from(cv.data, 'base64');
  if (!buffer.length) return { error: 'The CV file is empty.' };
  if (buffer.length > MAX_CV_BYTES) {
    return { error: 'Your CV must be 2 MB or smaller.' };
  }

  const storedName = `${crypto.randomUUID()}${extension}`;
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, storedName), buffer);
  return { name, storedName, type };
}

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
 * POST /api/applications — a job seeker applies to an approved, open job with
 * their CV and application information.
 */
router.post('/', requireAuth, requireRole('seeker'), (req, res) => {
  const jobId = Number(req.body?.job_id);
  const coverLetter = String(req.body?.cover_letter || '').trim().slice(0, 5000);

  const job = db
    .prepare("SELECT * FROM jobs WHERE id = ? AND status = 'open'")
    .get(jobId);
  if (!job) return res.status(404).json({ error: 'This job is not open for applications.' });
  if (job.moderation !== 'approved') {
    return res.status(404).json({ error: 'This job is not open for applications.' });
  }

  const already = db
    .prepare('SELECT id FROM applications WHERE job_id = ? AND seeker_id = ?')
    .get(jobId, req.user.id);
  if (already) return res.status(409).json({ error: 'You have already applied to this job.' });

  const cv = saveCv(req.body?.cv);
  if (cv.error) return res.status(400).json({ error: cv.error });

  let result;
  try {
    result = db
      .prepare(
        `INSERT INTO applications (job_id, seeker_id, cover_letter, cv_name, cv_path, cv_type)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(jobId, req.user.id, coverLetter, cv.name, cv.storedName, cv.type);
  } catch (error) {
    fs.rmSync(path.join(uploadDir, cv.storedName), { force: true });
    throw error;
  }

  res.status(201).json({ application: applicationWithJob(result.lastInsertRowid) });
});

/**
 * GET /api/applications/:id — full application detail for the employer (or
 * administrator) evaluating the candidate.
 */
router.get('/:id', requireAuth, (req, res) => {
  const application = db
    .prepare(
      `SELECT a.*, j.title AS job_title, j.company, j.location, j.type,
              j.employer_id, u.name AS seeker_name, u.email AS seeker_email
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN users u ON u.id = a.seeker_id
       WHERE a.id = ?`
    )
    .get(req.params.id);

  if (!application) return res.status(404).json({ error: 'Application not found.' });

  const allowed =
    req.user.role === 'admin' ||
    req.user.id === application.seeker_id ||
    req.user.id === application.employer_id;
  if (!allowed) return res.status(403).json({ error: 'You do not have access to this application.' });

  res.json({ application });
});

/**
 * GET /api/applications/:id/cv — download a candidate's CV. Only the candidate,
 * the employer who owns the job, and administrators may read it.
 */
router.get('/:id/cv', requireAuth, (req, res) => {
  const application = db
    .prepare(
      `SELECT a.seeker_id, a.cv_name, a.cv_path, j.employer_id
       FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.id = ?`
    )
    .get(req.params.id);

  if (!application) return res.status(404).json({ error: 'Application not found.' });

  const allowed =
    req.user.role === 'admin' ||
    req.user.id === application.seeker_id ||
    req.user.id === application.employer_id;
  if (!allowed) return res.status(403).json({ error: 'You do not have access to this CV.' });
  if (!application.cv_path) return res.status(404).json({ error: 'No CV was attached.' });

  const filePath = path.join(uploadDir, application.cv_path);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'This CV file is no longer available.' });
  }

  res.download(filePath, application.cv_name || 'cv.pdf');
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
