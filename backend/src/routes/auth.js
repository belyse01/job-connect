const express = require('express');
const db = require('../db');
const {
  hashPassword,
  verifyPassword,
  createToken,
  hashToken,
} = require('../security');
const { publicUser, requireAuth } = require('../auth');
const { rateLimit, emailKey } = require('../rate-limit');

const router = express.Router();
const SESSION_DAYS = 7;
const RESET_MINUTES = 60;

const loginLimiter = rateLimit({
  name: 'login',
  max: 10,
  windowMs: 15 * 60 * 1000,
  key: emailKey,
});
const registerLimiter = rateLimit({ name: 'register', max: 10, windowMs: 60 * 60 * 1000 });
// Requesting a reset is public, so limit it by address only.
const forgotLimiter = rateLimit({ name: 'forgot-password', max: 5, windowMs: 60 * 60 * 1000 });

function startSession(userId) {
  const token = createToken();
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`
  ).run(hashToken(token), userId);
  return token;
}

/**
 * Delivers the reset link. No mail provider is configured yet, so the link is
 * written to the server log; replace this with a real mailer (Resend, SES,
 * SMTP) and the rest of the flow keeps working unchanged.
 */
function sendPasswordResetEmail(email, resetUrl) {
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[password reset] ${email}: ${resetUrl}`);
  }
}

/**
 * POST /api/auth/register
 * Job seekers and employers can self-register. Administrators are seeded.
 */
router.post('/register', registerLimiter, (req, res) => {
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

router.post('/login', loginLimiter, (req, res) => {
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

/**
 * POST /api/auth/forgot-password — always answers 200 so the response cannot be
 * used to discover which email addresses have accounts.
 */
router.post('/forgot-password', forgotLimiter, (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);

  if (!user) return res.json({ ok: true });

  const token = createToken();
  db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(user.id);
  db.prepare(
    `INSERT INTO password_resets (token_hash, user_id, expires_at)
     VALUES (?, ?, datetime('now', '+${RESET_MINUTES} minutes'))`
  ).run(hashToken(token), user.id);

  sendPasswordResetEmail(user.email, `/#/login?reset=${token}`);

  // Without a mail provider the token cannot reach a real inbox, so expose it
  // outside production to keep local development usable.
  const payload = { ok: true };
  if (process.env.NODE_ENV !== 'production') payload.devResetToken = token;
  res.json(payload);
});

/**
 * POST /api/auth/reset-password — exchange a reset token for a new password.
 */
router.post('/reset-password', (req, res) => {
  const token = String((req.body || {}).token || '').trim();
  const password = String((req.body || {}).password || '');

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }
  if (!token) {
    return res.status(400).json({ error: 'This reset link is missing its token.' });
  }

  const reset = db
    .prepare(
      `SELECT r.*, u.id AS account_id
       FROM password_resets r JOIN users u ON u.id = r.user_id
       WHERE r.token_hash = ?`
    )
    .get(hashToken(token));

  if (!reset || reset.used_at) {
    return res.status(400).json({ error: 'This reset link is invalid or has already been used.' });
  }
  if (new Date(`${reset.expires_at}Z`).getTime() < Date.now()) {
    return res.status(400).json({ error: 'This reset link has expired. Request a new one.' });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    hashPassword(password),
    reset.account_id
  );
  db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE token_hash = ?").run(
    reset.token_hash
  );
  // A password change ends every existing session for that account.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.account_id);

  res.json({ ok: true });
});

router.post('/logout', requireAuth, (req, res) => {
  const token = (req.headers.authorization || '').slice(7).trim();
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
