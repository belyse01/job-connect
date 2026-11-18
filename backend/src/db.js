const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { hashPassword } = require('./security');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'jobconnect.db'));
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('seeker', 'employer', 'admin')),
    company       TEXT,
    suspended     INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    employer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    company     TEXT    NOT NULL,
    location    TEXT    NOT NULL,
    type        TEXT    NOT NULL DEFAULT 'Full-time',
    category    TEXT    NOT NULL DEFAULT 'General',
    salary      TEXT,
    description TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS applications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id       INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    seeker_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cover_letter TEXT,
    status       TEXT    NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'reviewed', 'accepted', 'rejected')),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (job_id, seeker_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_employer ON jobs(employer_id);
  CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id);
  CREATE INDEX IF NOT EXISTS idx_applications_seeker ON applications(seeker_id);
`);

// Seed a usable demo system the first time the database is created.
const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();

if (count === 0) {
  const insertUser = db.prepare(
    `INSERT INTO users (name, email, password_hash, role, company)
     VALUES (?, ?, ?, ?, ?)`
  );

  const admin = insertUser.run(
    'System Administrator',
    'admin@jobconnect.local',
    hashPassword('Admin123!'),
    'admin',
    null
  );
  const employer = insertUser.run(
    'Ada Okafor',
    'employer@jobconnect.local',
    hashPassword('Employer123!'),
    'employer',
    'Northwind Labs'
  );
  const seeker = insertUser.run(
    'Musa Bello',
    'seeker@jobconnect.local',
    hashPassword('Seeker123!'),
    'seeker',
    null
  );

  const insertJob = db.prepare(
    `INSERT INTO jobs (employer_id, title, company, location, type, category, salary, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const jobs = [
    ['Frontend Developer', 'Northwind Labs', 'Lagos, Nigeria', 'Full-time', 'Engineering', '₦350,000 - ₦500,000 / month',
      'Build accessible, responsive interfaces with HTML, CSS and JavaScript. You will work with designers and backend engineers to ship product features and keep the design system healthy.'],
    ['Customer Support Specialist', 'Northwind Labs', 'Remote', 'Part-time', 'Customer Success', '₦120,000 / month',
      'Be the first friendly voice customers hear. Handle tickets, calls and live chat, document repeat issues and help the team improve the help centre.'],
    ['Data Analyst', 'Northwind Labs', 'Abuja, Nigeria', 'Full-time', 'Data', '₦400,000 - ₦600,000 / month',
      'Turn product and business questions into dashboards and experiments. Strong SQL required; Python and a BI tool are a plus.'],
  ];

  for (const job of jobs) {
    insertJob.run(employer.lastInsertRowid, ...job);
  }

  db.prepare(
    `INSERT INTO applications (job_id, seeker_id, cover_letter, status)
     VALUES (1, ?, ?, 'reviewed')`
  ).run(
    seeker.lastInsertRowid,
    'I have three years of experience shipping React and vanilla JavaScript products and would love to join Northwind Labs.'
  );

  void admin;
}

module.exports = db;
