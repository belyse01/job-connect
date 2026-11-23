const path = require('node:path');
const express = require('express');

const db = require('./db');
const authRoutes = require('./routes/auth');
const jobRoutes = require('./routes/jobs');
const applicationRoutes = require('./routes/applications');
const employerRoutes = require('./routes/employer');
const adminRoutes = require('./routes/admin');
const contactRoutes = require('./routes/contact');

const app = express();
const PORT = process.env.PORT || 4000;

// Behind a reverse proxy every request shares one address; opt in to X-Forwarded-For
// so rate limiting and logs see the real client.
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

// Clean up sessions that have already expired.
db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();

// Application submissions include a base64-encoded CV, so allow a little more
// than the 2 MB file limit plus the rest of the JSON payload.
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'jobconnect-api' });
});

// Public counters shown on the marketing home page.
app.get('/api/stats', (_req, res) => {
  const count = (sql) => db.prepare(sql).get().count;
  res.json({
    stats: {
      jobs: count("SELECT COUNT(*) AS count FROM jobs WHERE status = 'open' AND moderation = 'approved'"),
      companies: count("SELECT COUNT(DISTINCT company) AS count FROM jobs WHERE moderation = 'approved'"),
      employers: count("SELECT COUNT(*) AS count FROM users WHERE role = 'employer' AND suspended = 0"),
      seekers: count("SELECT COUNT(*) AS count FROM users WHERE role = 'seeker' AND suspended = 0"),
      applications: count('SELECT COUNT(*) AS count FROM applications'),
    },
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/employer', employerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/contact', contactRoutes);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

// Serve the plain HTML/CSS/JS client from the frontend folder.
const frontendDir = path.join(__dirname, '..', '..', 'frontend');
app.use(express.static(frontendDir));

app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must be valid JSON.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

// Only bind a port when run directly; tests import the app and listen themselves.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`JobConnect API running at http://localhost:${PORT}`);
  });
}

module.exports = app;
