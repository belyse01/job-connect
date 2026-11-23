const express = require('express');
const db = require('../db');
const { rateLimit } = require('../rate-limit');

const router = express.Router();

// Contact is public, so cap how many messages one address can send.
const contactLimiter = rateLimit({ name: 'contact', max: 5, windowMs: 60 * 60 * 1000 });

const SUBJECTS = ['General question', 'Job seeker support', 'Employers & hiring', 'Report a listing', 'Privacy request'];

/**
 * POST /api/contact — store a message from the public contact page.
 */
router.post('/', contactLimiter, (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const subject = String(body.subject || 'General question').trim();
  const message = String(body.message || '').trim();

  if (name.length < 2) {
    return res.status(400).json({ error: 'Please enter your name.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (!SUBJECTS.includes(subject)) {
    return res.status(400).json({ error: 'Please choose a valid topic.' });
  }
  if (message.length < 20) {
    return res.status(400).json({ error: 'Message must be at least 20 characters long.' });
  }

  db.prepare('INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)').run(
    name,
    email,
    subject,
    message
  );

  res.status(201).json({ ok: true });
});

module.exports = router;
