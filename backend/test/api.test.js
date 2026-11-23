/* API tests for auth, permissions and the hiring flow. Run with `npm test`. */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point the database at a throwaway directory before anything loads db.js.
process.env.JC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jobconnect-test-'));
process.env.NODE_ENV = 'test';
// Keep the shared in-memory counters out of the way; one test enables them.
process.env.JC_RATE_LIMIT = 'off';

const app = require('../src/server');
const db = require('../src/db');
const { hashToken } = require('../src/security');
const { resetRateLimits } = require('../src/rate-limit');

const ADMIN = { email: 'admin@jobconnect.local', password: 'Admin123!' };

let server;
let base;
let counter = 0;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  // Windows keeps the SQLite file locked briefly after close.
  fs.rmSync(process.env.JC_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function request(pathname, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function login(email, password) {
  const { status, data } = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  assert.equal(status, 200, `expected login to succeed for ${email}`);
  return data;
}

async function register(role, overrides = {}) {
  counter += 1;
  const email = overrides.email || `${role}${counter}@example.com`;
  const body = {
    name: overrides.name || `Test ${role} ${counter}`,
    email,
    password: 'Password123!',
    role,
    company: role === 'employer' ? overrides.company || `Company ${counter}` : '',
    ...overrides,
  };
  const { status, data } = await request('/api/auth/register', { method: 'POST', body });
  assert.equal(status, 201, `expected registration to succeed: ${JSON.stringify(data)}`);
  return { ...data, email, password: body.password };
}

const VALID_JOB = {
  title: 'Backend Engineer',
  location: 'Remote',
  type: 'Full-time',
  category: 'Engineering',
  salary: '100,000',
  description: 'Build and maintain the JobConnect API and its data layer.',
  requirements: 'Three years of Node.js and SQL experience.',
};

async function createJob(token, overrides = {}) {
  const { status, data } = await request('/api/jobs', {
    method: 'POST',
    token,
    body: { ...VALID_JOB, title: `Backend Engineer ${++counter}`, ...overrides },
  });
  assert.equal(status, 201, `expected job creation to succeed: ${JSON.stringify(data)}`);
  return data.job;
}

function cv() {
  return {
    name: 'cv.pdf',
    type: 'application/pdf',
    data: Buffer.from('%PDF-1.4 test cv').toString('base64'),
  };
}

/* ------------------------------------------------------------------ */
/* Registration and sessions                                           */
/* ------------------------------------------------------------------ */

test('registration rejects invalid input', async () => {
  const shortPassword = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Ada', email: 'ada@example.com', password: 'short', role: 'seeker' },
  });
  assert.equal(shortPassword.status, 400);

  const badRole = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Ada', email: 'ada2@example.com', password: 'Password123!', role: 'admin' },
  });
  assert.equal(badRole.status, 400);

  const noCompany = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Ada', email: 'ada3@example.com', password: 'Password123!', role: 'employer' },
  });
  assert.equal(noCompany.status, 400);
});

test('an account can register, sign in, read itself and sign out', async () => {
  const account = await register('seeker');

  const session = await login(account.email, account.password);
  assert.equal(session.user.email, account.email);

  const me = await request('/api/auth/me', { token: session.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, account.email);
  assert.equal(me.data.user.password_hash, undefined, 'password hash must never be returned');

  const logout = await request('/api/auth/logout', { method: 'POST', token: session.token });
  assert.equal(logout.status, 200);
  assert.equal((await request('/api/auth/me', { token: session.token })).status, 401);
});

test('wrong passwords and duplicate emails are rejected', async () => {
  const account = await register('seeker');

  const wrong = await request('/api/auth/login', {
    method: 'POST',
    body: { email: account.email, password: 'NotThePassword1!' },
  });
  assert.equal(wrong.status, 401);

  const duplicate = await request('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Someone Else',
      email: account.email,
      password: 'Password123!',
      role: 'seeker',
    },
  });
  assert.equal(duplicate.status, 409);
});

test('suspending an account revokes its session and blocks sign-in', async () => {
  const account = await register('seeker');
  const session = await login(account.email, account.password);
  const admin = await login(ADMIN.email, ADMIN.password);

  const suspend = await request(`/api/admin/users/${account.user.id}`, {
    method: 'PATCH',
    token: admin.token,
    body: { suspended: true },
  });
  assert.equal(suspend.status, 200);

  assert.equal((await request('/api/auth/me', { token: session.token })).status, 401);
  const blocked = await request('/api/auth/login', {
    method: 'POST',
    body: { email: account.email, password: account.password },
  });
  assert.equal(blocked.status, 403);
});

test('session tokens are stored only as hashes', async () => {
  const account = await register('seeker');
  const session = await login(account.email, account.password);

  const rows = db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').all(account.user.id);
  assert.ok(rows.length > 0, 'session rows should exist');
  assert.ok(
    rows.every((row) => row.token_hash !== session.token),
    'the raw token must never be stored'
  );
  assert.ok(
    rows.some((row) => row.token_hash === hashToken(session.token)),
    'the stored hash should match the issued token'
  );
});

test('a password reset changes the password and ends existing sessions', async () => {
  const account = await register('seeker');
  const session = await login(account.email, account.password);

  const forgotten = await request('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: account.email },
  });
  assert.equal(forgotten.status, 200);
  const token = forgotten.data.devResetToken;
  assert.ok(token, 'development mode should return a reset token');

  // Unknown addresses get the same answer and no token.
  const unknown = await request('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'nobody@example.com' },
  });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.data.devResetToken, undefined);

  const reset = await request('/api/auth/reset-password', {
    method: 'POST',
    body: { token, password: 'BrandNewPass1!' },
  });
  assert.equal(reset.status, 200);

  assert.equal((await request('/api/auth/me', { token: session.token })).status, 401);

  const oldPassword = await request('/api/auth/login', {
    method: 'POST',
    body: { email: account.email, password: account.password },
  });
  assert.equal(oldPassword.status, 401);

  const newPassword = await request('/api/auth/login', {
    method: 'POST',
    body: { email: account.email, password: 'BrandNewPass1!' },
  });
  assert.equal(newPassword.status, 200);

  const reused = await request('/api/auth/reset-password', {
    method: 'POST',
    body: { token, password: 'AnotherPass1!' },
  });
  assert.equal(reused.status, 400);
});

test('repeated sign-in attempts are rate limited', async () => {
  process.env.JC_RATE_LIMIT = 'on';
  resetRateLimits();
  try {
    const email = 'rate-limit@example.com';
    let last;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      last = await request('/api/auth/login', {
        method: 'POST',
        body: { email, password: 'WrongPassword1!' },
      });
    }
    assert.equal(last.status, 429);
    assert.ok(last.data.error);
  } finally {
    process.env.JC_RATE_LIMIT = 'off';
    resetRateLimits();
  }
});

/* ------------------------------------------------------------------ */
/* Job permissions                                                     */
/* ------------------------------------------------------------------ */

test('only employers can post jobs and new posts wait for moderation', async () => {
  const seeker = await register('seeker');
  const employer = await register('employer');

  const forbidden = await request('/api/jobs', {
    method: 'POST',
    token: seeker.token,
    body: VALID_JOB,
  });
  assert.equal(forbidden.status, 403);

  const job = await createJob(employer.token);
  assert.equal(job.moderation, 'pending');

  const publicList = await request(`/api/jobs?q=${encodeURIComponent(job.title)}`);
  assert.equal(publicList.status, 200);
  assert.equal(publicList.data.jobs.length, 0, 'pending jobs must not be public');

  const admin = await login(ADMIN.email, ADMIN.password);
  const approve = await request(`/api/admin/jobs/${job.id}`, {
    method: 'PATCH',
    token: admin.token,
    body: { moderation: 'approved' },
  });
  assert.equal(approve.status, 200);

  const approvedList = await request(`/api/jobs?q=${encodeURIComponent(job.title)}`);
  assert.equal(approvedList.data.jobs.length, 1);
  assert.equal(approvedList.data.jobs[0].id, job.id);
});

test("employers cannot edit, close or delete another employer's job", async () => {
  const owner = await register('employer');
  const other = await register('employer');
  const job = await createJob(owner.token);

  const edit = await request(`/api/jobs/${job.id}`, {
    method: 'PATCH',
    token: other.token,
    body: { ...VALID_JOB, title: 'Hijacked title' },
  });
  assert.equal(edit.status, 403);

  const close = await request(`/api/jobs/${job.id}/status`, {
    method: 'PATCH',
    token: other.token,
    body: { status: 'closed' },
  });
  assert.equal(close.status, 403);

  const remove = await request(`/api/jobs/${job.id}`, {
    method: 'DELETE',
    token: other.token,
  });
  assert.equal(remove.status, 403);

  const applicants = await request(`/api/jobs/${job.id}/applications`, {
    token: other.token,
  });
  assert.equal(applicants.status, 403);
});

test('an employer edit sends an approved job back to review', async () => {
  const employer = await register('employer');
  const admin = await login(ADMIN.email, ADMIN.password);
  const job = await createJob(employer.token);

  await request(`/api/admin/jobs/${job.id}`, {
    method: 'PATCH',
    token: admin.token,
    body: { moderation: 'approved' },
  });

  const edited = await request(`/api/jobs/${job.id}`, {
    method: 'PATCH',
    token: employer.token,
    body: { ...VALID_JOB, title: `${job.title} (updated)` },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.job.moderation, 'pending');
});

/* ------------------------------------------------------------------ */
/* Applications and review permissions                                 */
/* ------------------------------------------------------------------ */

test('a seeker applies once with a CV and only the owner can review it', async () => {
  const employer = await register('employer');
  const otherEmployer = await register('employer');
  const seeker = await register('seeker');
  const admin = await login(ADMIN.email, ADMIN.password);
  const job = await createJob(employer.token);

  await request(`/api/admin/jobs/${job.id}`, {
    method: 'PATCH',
    token: admin.token,
    body: { moderation: 'approved' },
  });

  const applied = await request('/api/applications', {
    method: 'POST',
    token: seeker.token,
    body: { job_id: job.id, cover_letter: 'I would like this role.', cv: cv() },
  });
  assert.equal(applied.status, 201);
  const applicationId = applied.data.application.id;
  assert.equal(applied.data.application.status, 'pending');

  const duplicate = await request('/api/applications', {
    method: 'POST',
    token: seeker.token,
    body: { job_id: job.id, cover_letter: 'Again', cv: cv() },
  });
  assert.equal(duplicate.status, 409);

  // Only the job's employer (or an admin) may move the application.
  const hijack = await request(`/api/applications/${applicationId}`, {
    method: 'PATCH',
    token: otherEmployer.token,
    body: { status: 'selected' },
  });
  assert.equal(hijack.status, 403);

  const seekerDecision = await request(`/api/applications/${applicationId}`, {
    method: 'PATCH',
    token: seeker.token,
    body: { status: 'selected' },
  });
  assert.equal(seekerDecision.status, 403);

  const invalid = await request(`/api/applications/${applicationId}`, {
    method: 'PATCH',
    token: employer.token,
    body: { status: 'hired' },
  });
  assert.equal(invalid.status, 400);

  const shortlisted = await request(`/api/applications/${applicationId}`, {
    method: 'PATCH',
    token: employer.token,
    body: { status: 'shortlisted' },
  });
  assert.equal(shortlisted.status, 200);
  assert.equal(shortlisted.data.application.status, 'shortlisted');
});

test('application details and CVs are limited to the candidate, owner and admin', async () => {
  const employer = await register('employer');
  const outsider = await register('employer');
  const seeker = await register('seeker');
  const otherSeeker = await register('seeker');
  const admin = await login(ADMIN.email, ADMIN.password);
  const job = await createJob(employer.token);

  await request(`/api/admin/jobs/${job.id}`, {
    method: 'PATCH',
    token: admin.token,
    body: { moderation: 'approved' },
  });
  const applied = await request('/api/applications', {
    method: 'POST',
    token: seeker.token,
    body: { job_id: job.id, cv: cv() },
  });
  const applicationId = applied.data.application.id;

  assert.equal((await request(`/api/applications/${applicationId}`, { token: seeker.token })).status, 200);
  assert.equal((await request(`/api/applications/${applicationId}`, { token: employer.token })).status, 200);
  assert.equal((await request(`/api/applications/${applicationId}`, { token: admin.token })).status, 200);

  assert.equal((await request(`/api/applications/${applicationId}`, { token: outsider.token })).status, 403);
  assert.equal((await request(`/api/applications/${applicationId}`, { token: otherSeeker.token })).status, 403);

  const ownerCv = await fetch(`${base}/api/applications/${applicationId}/cv`, {
    headers: { Authorization: `Bearer ${employer.token}` },
  });
  assert.equal(ownerCv.status, 200);

  const outsiderCv = await request(`/api/applications/${applicationId}/cv`, { token: outsider.token });
  assert.equal(outsiderCv.status, 403);
});

test('a seeker cannot apply to a job that is not approved', async () => {
  const employer = await register('employer');
  const seeker = await register('seeker');
  const job = await createJob(employer.token);

  const applied = await request('/api/applications', {
    method: 'POST',
    token: seeker.token,
    body: { job_id: job.id, cv: cv() },
  });
  assert.equal(applied.status, 404);
});

/* ------------------------------------------------------------------ */
/* Admin contact inbox                                                 */
/* ------------------------------------------------------------------ */

test('the contact inbox is admin-only and supports search and deletion', async () => {
  const seeker = await register('seeker');
  const admin = await login(ADMIN.email, ADMIN.password);

  const created = await request('/api/contact', {
    method: 'POST',
    body: {
      name: 'Grace Hopper',
      email: 'grace@example.com',
      subject: 'General question',
      message: 'I would like to know how employer verification is handled.',
    },
  });
  assert.equal(created.status, 201);

  assert.equal((await request('/api/admin/messages', { token: seeker.token })).status, 403);
  assert.equal((await request('/api/admin/messages')).status, 401);

  const list = await request('/api/admin/messages?q=Grace', { token: admin.token });
  assert.equal(list.status, 200);
  const message = list.data.messages.find((m) => m.email === 'grace@example.com');
  assert.ok(message, 'the new message should be listed');

  const single = await request(`/api/admin/messages/${message.id}`, { token: admin.token });
  assert.equal(single.status, 200);

  const removed = await request(`/api/admin/messages/${message.id}`, {
    method: 'DELETE',
    token: admin.token,
  });
  assert.equal(removed.status, 200);
  assert.equal(
    (await request(`/api/admin/messages/${message.id}`, { token: admin.token })).status,
    404
  );
});
