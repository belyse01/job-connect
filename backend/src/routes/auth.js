const express = require('express');
const db = require('../db');
const { hashPassword, verifyPassword, createToken } = require('../security');
const { publicUser, requireAuth } = require('../auth');

const router = express.Router();
const SESSION_DAYS = 7;

function startSession(userId) {
  const token = createToken();
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`
  ).run(token, userId);
  return token;
}

/**
 * POST /api/auth/register
 * Job seekers and employers can self-register. Administrators are seeded.
 */
router.post('/register', (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const role = String(body.role || '');
  const company = String(body.company || '').trim();

  if (name.length < 2) {
    return res.status(400).json({ error: 'Please enter your full name.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }
  if (!['seeker', 'employer'].includes(role)) {
    return res.status(400).json({ error: 'Choose whether you are a job seeker or an employer.' });
  }
  if (role === 'employer' && !company) {
    return res.status(400).json({ error: 'Company name is required for employers.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const result = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, role, company)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(name, email, hashPassword(password), role, role === 'employer' ? company : null);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ token: startSession(user.id), user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  if (user.suspended) {
    return res.status(403).json({ error: 'This account has been suspended by an administrator.' });
  }

  res.json({ token: startSession(user.id), user: publicUser(user) });
});

router.post('/logout', requireAuth, (req, res) => {
  const token = (req.headers.authorization || '').slice(7).trim();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
