const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { hashPassword } = require('./security');

// JC_DATA_DIR lets tests (and alternative deployments) point the database and
// uploaded CVs somewhere other than backend/data.
const dataDir = process.env.JC_DATA_DIR
  ? path.resolve(process.env.JC_DATA_DIR)
  : path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

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
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    employer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT    NOT NULL,
    company      TEXT    NOT NULL,
    location     TEXT    NOT NULL,
    type         TEXT    NOT NULL DEFAULT 'Full-time',
    category     TEXT    NOT NULL DEFAULT 'General',
    salary       TEXT,
    description  TEXT    NOT NULL,
    requirements TEXT    NOT NULL DEFAULT '',
    moderation   TEXT    NOT NULL DEFAULT 'pending'
                 CHECK (moderation IN ('pending', 'approved', 'rejected')),
    status       TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS applications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id       INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    seeker_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cover_letter TEXT,
    cv_name      TEXT,
    cv_path      TEXT,
    cv_type      TEXT,
    status       TEXT    NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'shortlisted', 'selected', 'rejected')),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (job_id, seeker_id)
  );

  CREATE TABLE IF NOT EXISTS contact_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL,
    subject    TEXT    NOT NULL,
    message    TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
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

/* -------------------------------------------------------------------- */
/* Migrations for databases created before the approval flow existed.    */
/* -------------------------------------------------------------------- */

const jobColumns = db.prepare('PRAGMA table_info(jobs)').all();
if (!jobColumns.some((column) => column.name === 'requirements')) {
  // Existing listings predate the requirements field; give them a placeholder
  // so the new form and detail views have something to show.
  db.exec("ALTER TABLE jobs ADD COLUMN requirements TEXT NOT NULL DEFAULT ''");
}
if (!jobColumns.some((column) => column.name === 'moderation')) {
  // Any listing that was already live stays visible; only new posts need review.
  db.exec("ALTER TABLE jobs ADD COLUMN moderation TEXT NOT NULL DEFAULT 'approved'");
}

const applicationsSql =
  db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'applications'").get()
    ?.sql || '';

if (!applicationsSql.includes('shortlisted')) {
  // The status CHECK constraint cannot be altered in place, so rebuild the
  // table and translate the old decision names to the new ones.
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE applications_new (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id       INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        seeker_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        cover_letter TEXT,
        cv_name      TEXT,
        cv_path      TEXT,
        cv_type      TEXT,
        status       TEXT    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'shortlisted', 'selected', 'rejected')),
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE (job_id, seeker_id)
      );

      INSERT INTO applications_new (id, job_id, seeker_id, cover_letter, status, created_at)
      SELECT id, job_id, seeker_id, cover_letter,
             CASE status
               WHEN 'reviewed' THEN 'shortlisted'
               WHEN 'accepted' THEN 'selected'
               ELSE status
             END,
             created_at
      FROM applications;
    `);
    db.exec('DROP TABLE applications');
    db.exec('ALTER TABLE applications_new RENAME TO applications');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id);
      CREATE INDEX IF NOT EXISTS idx_applications_seeker ON applications(seeker_id);
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

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
    `INSERT INTO jobs (employer_id, title, company, location, type, category, salary, description, requirements, moderation, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const jobs = [
    ['Frontend Developer', 'Northwind Labs', 'Lagos, Nigeria', 'Full-time', 'Engineering', '₦350,000 - ₦500,000 / month',
      'Build accessible, responsive interfaces with HTML, CSS and JavaScript. You will work with designers and backend engineers to ship product features and keep the design system healthy.',
      '3+ years with HTML, CSS and JavaScript; solid React or similar; a sharp eye for accessibility and responsive design.', 'approved', 'open'],
    ['Customer Support Specialist', 'Northwind Labs', 'Remote', 'Part-time', 'Customer Success', '₦120,000 / month',
      'Be the first friendly voice customers hear. Handle tickets, calls and live chat, document repeat issues and help the team improve the help centre.',
      'Excellent written English; 1 year of customer-facing experience; comfortable with helpdesk tools.', 'approved', 'open'],
    ['Data Analyst', 'Northwind Labs', 'Abuja, Nigeria', 'Full-time', 'Data', '₦400,000 - ₦600,000 / month',
      'Turn product and business questions into dashboards and experiments. Strong SQL required; Python and a BI tool are a plus.',
      'Strong SQL; experience with a BI tool; Python is a plus.', 'approved', 'open'],
    ['Marketing Intern', 'Northwind Labs', 'Lagos, Nigeria', 'Internship', 'Marketing', '₦80,000 / month',
      'Support the marketing team with campaign research, social posts and reporting while learning the full funnel.',
      'Recent graduate or final-year student; strong writing; curiosity about growth marketing.', 'pending', 'open'],
  ];

  for (const job of jobs) {
    insertJob.run(employer.lastInsertRowid, ...job);
  }

  db.prepare(
    `INSERT INTO applications (job_id, seeker_id, cover_letter, status)
     VALUES (1, ?, ?, 'shortlisted')`
  ).run(
    seeker.lastInsertRowid,
    'I have three years of experience shipping React and vanilla JavaScript products and would love to join Northwind Labs.'
  );

  void admin;
}

module.exports = db;
