/* JobConnect client — plain JavaScript, no build step. */

const state = {
  token: localStorage.getItem('jc_token') || '',
  user: null,
  view: 'home',
  page: 'home',
  jobId: null,
  authMode: 'login',
  authError: '',
  jobSearch: { q: '', location: '', type: '', category: '' },
  userFilter: { role: '', q: '' },
  messageFilter: { q: '' },
  employerJobFilter: null,
};

const ROLE_LABEL = { seeker: 'Job seeker', employer: 'Employer', admin: 'Administrator' };

const PUBLIC_PAGES = {
  home: 'JobConnect — work worth showing up for',
  jobs: 'Find jobs — JobConnect',
  job: 'Job details — JobConnect',
  companies: 'Companies hiring — JobConnect',
  about: 'About us — JobConnect',
  contact: 'Contact us — JobConnect',
  login: 'Sign in — JobConnect',
  register: 'Create an account — JobConnect',
};

const appEl = () => document.getElementById('app');
const modalEl = () => document.getElementById('modal-root');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fmtDate(value) {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return esc(value);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function markTone(name) {
  let hash = 0;
  for (const char of String(name || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash % 5) + 1;
}

function companyMark(name, size = '') {
  return `<span class="company-mark ${size} tone-${markTone(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
}

const STATUS_LABEL = {
  active: 'Active',
  approved: 'Approved',
  closed: 'Closed',
  open: 'Open',
  pending: 'Pending',
  rejected: 'Rejected',
  selected: 'Selected',
  shortlisted: 'Shortlisted',
  suspended: 'Suspended',
};

function badge(status) {
  return `<span class="badge ${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read that file. Please try again.'));
    reader.readAsDataURL(file);
  });
}

async function downloadCv(applicationId, filename) {
  const res = await fetch(`/api/applications/${applicationId}/cv`, {
    headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not download this CV.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'cv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toast(message, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast show ${type === 'error' ? 'error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.className = 'toast';
  }, 3200);
}

function alertBox(message, type = 'error') {
  return message ? `<div class="alert ${type}">${esc(message)}</div>` : '';
}

function emptyState(title, message) {
  return `<div class="empty"><strong>${esc(title)}</strong>${esc(message)}</div>`;
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401 && state.user) {
      clearSession();
      state.view = 'home';
      render();
    }
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  return data;
}

function clearSession() {
  state.user = null;
  state.token = '';
  localStorage.removeItem('jc_token');
}

function setSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('jc_token', token);
  state.view = defaultView(user.role);
  state.jobSearch = { q: '', location: '', type: '', category: '' };
}

function defaultView(role) {
  if (role === 'employer') return 'employer-overview';
  if (role === 'admin') return 'admin-overview';
  if (role === 'seeker') return 'jobs';
  return 'home';
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

const NAV = {
  seeker: [
    ['jobs', 'Find jobs'],
    ['applications', 'My applications'],
  ],
  employer: [
    ['employer-overview', 'Overview'],
    ['post-job', 'Post a job'],
    ['employer-applications', 'Applications'],
  ],
  admin: [
    ['admin-overview', 'Overview'],
    ['admin-users', 'Users'],
    ['admin-jobs', 'Jobs'],
    ['admin-messages', 'Messages'],
  ],
};

function renderHeader() {
  const nav = document.getElementById('main-nav');
  const account = document.getElementById('account');

  if (!state.user) {
    nav.innerHTML = `
      <button class="nav-link ${state.page === 'home' ? 'active' : ''}" data-route="home">Home</button>
      <button class="nav-link ${state.page === 'jobs' || state.page === 'job' ? 'active' : ''}" data-route="jobs">Find Jobs</button>
      <button class="nav-link ${state.page === 'companies' ? 'active' : ''}" data-route="companies">Companies</button>
      <button class="nav-link ${state.page === 'about' ? 'active' : ''}" data-route="about">About Us</button>
      <button class="nav-link ${state.page === 'contact' ? 'active' : ''}" data-route="contact">Contact Us</button>
      <span class="nav-spacer" aria-hidden="true"></span>
      <button class="btn btn-ghost btn-sm nav-auth" data-auth-mode="login">Login</button>
      <button class="btn btn-primary btn-sm nav-auth" data-auth-mode="register-seeker">Register</button>
    `;
    account.innerHTML = '';
    return;
  }

  const items = NAV[state.user.role] || [];
  nav.innerHTML = items
    .map(
      ([view, label]) =>
        `<button class="nav-link ${state.view === view ? 'active' : ''}" data-nav="${view}">${esc(label)}</button>`
    )
    .join('');

  account.innerHTML = `
    <div class="user-chip">
      <div class="avatar">${esc(initials(state.user.name))}</div>
      <div class="user-meta">
        <strong>${esc(state.user.name)}</strong>
        <span>${esc(ROLE_LABEL[state.user.role] || state.user.role)}</span>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" data-action="logout">Sign out</button>
  `;
}

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

let renderTicket = 0;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '').split('?')[0].trim();
  const [head, second] = raw.split('/').filter(Boolean);
  if (head === 'job' && second && /^\d+$/.test(second)) {
    return { page: 'job', jobId: Number(second) };
  }
  return { page: head in PUBLIC_PAGES ? head : 'home', jobId: null };
}

function hashFor(page, jobId) {
  if (page === 'home') return '#/';
  if (page === 'job') return `#/job/${jobId}`;
  return `#/${page}`;
}

function replaceHash(page) {
  const hash = hashFor(page);
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function go(page, { jobId = null } = {}) {
  const next = page in PUBLIC_PAGES ? page : 'home';
  if (state.user) {
    if (next === 'login' || next === 'register') {
      setView(defaultView(state.user.role));
      return;
    }
    if (next === 'job' && jobId) {
      openJobPage(jobId);
      return;
    }
    const canBrowseJobs = state.user.role === 'seeker' && next === 'jobs';
    setView(canBrowseJobs ? 'jobs' : defaultView(state.user.role));
    if (!canBrowseJobs) toast('The rest of the public pages are visible when you sign out.');
    return;
  }

  const hash = hashFor(next, jobId);
  if (location.hash === hash) {
    state.page = next;
    state.jobId = jobId;
    closeModal();
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }
  location.hash = hash;
}

window.addEventListener('hashchange', () => {
  if (state.user) return;
  const { page, jobId } = parseHash();
  if (page === state.page && jobId === state.jobId) return;
  state.page = page;
  state.jobId = jobId;
  closeModal();
  render();
  window.scrollTo({ top: 0, behavior: 'auto' });
});

async function render() {
  const ticket = ++renderTicket;
  renderHeader();
  try {
    if (!state.user) {
      document.title = PUBLIC_PAGES[state.page] || PUBLIC_PAGES.home;
      await renderPublic(ticket);
    } else {
      document.title = `${ROLE_LABEL[state.user.role]} — JobConnect`;
      if (state.user.role === 'seeker') await renderSeeker(ticket);
      else if (state.user.role === 'employer') await renderEmployer(ticket);
      else await renderAdmin(ticket);
    }
  } catch (err) {
    if (ticket !== renderTicket) return;
    appEl().innerHTML = alertBox(err.message) + `<div class="empty"><strong>Could not load the page</strong>Try refreshing.</div>`;
  }
}

function setView(view) {
  if (state.user) {
    if (view === 'home') view = defaultView(state.user.role);
    state.view = view;
    state.employerJobFilter = null;
  } else {
    return go('home');
  }
  closeModal();
  render();
}

/* ------------------------------------------------------------------ */
/* Auth screen                                                         */
/* ------------------------------------------------------------------ */

function authCard() {
  const mode = state.authMode;
  const isRegister = mode !== 'login';
  const isEmployer = mode === 'register-employer';
  return `
    <div class="panel auth-card" id="auth-card">
      <div class="panel-body">
        <div class="auth-switch">
          <button data-auth-mode="login" class="${mode === 'login' ? 'active' : ''}">Sign in</button>
          <button data-auth-mode="register-seeker" class="${mode === 'register-seeker' ? 'active' : ''}">Register as job seeker</button>
          <button data-auth-mode="register-employer" class="${mode === 'register-employer' ? 'active' : ''}">Register as employer</button>
        </div>
        ${alertBox(state.authError)}
        ${
          isRegister
            ? `
          <form data-form="auth-register">
            <input type="hidden" name="role" value="${isEmployer ? 'employer' : 'seeker'}" />
            <p class="auth-note">${
              isEmployer
                ? 'Register as an employer to post vacancies and review candidates.'
                : 'Register as a job seeker to apply for roles and track your applications.'
            }</p>
            <div class="field">
              <label for="reg-name">Full name</label>
              <input id="reg-name" name="name" autocomplete="name" required placeholder="Your full name" />
            </div>
            <div class="field">
              <label for="reg-email">Email address</label>
              <input id="reg-email" name="email" type="email" autocomplete="email" required placeholder="you@example.com" />
            </div>
            <div class="field">
              <label for="reg-password">Password</label>
              <input id="reg-password" name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters" />
            </div>
            ${
              isEmployer
                ? `<div class="field">
              <label for="reg-company">Company name</label>
              <input id="reg-company" name="company" autocomplete="organization" required placeholder="e.g. Northwind Labs" />
            </div>`
                : ''
            }
            <button class="btn btn-primary btn-block" type="submit">${isEmployer ? 'Register as employer' : 'Register as job seeker'}</button>
          </form>
        `
            : `
          <form data-form="auth-login">
            <div class="field">
              <label for="login-email">Email address</label>
              <input id="login-email" name="email" type="email" autocomplete="email" required placeholder="you@example.com" />
            </div>
            <div class="field">
              <label for="login-password">Password</label>
              <input id="login-password" name="password" type="password" autocomplete="current-password" required placeholder="Your password" />
            </div>
            <button class="btn btn-primary btn-block" type="submit">Sign in</button>
          </form>
        `
        }
        <div class="demo-accounts">
          <p>Demo accounts</p>
          <div class="demo-grid">
            <button class="demo-btn" data-demo="seeker"><strong>Job seeker</strong><span>seeker@jobconnect.local · Seeker123!</span></button>
            <button class="demo-btn" data-demo="employer"><strong>Employer</strong><span>employer@jobconnect.local · Employer123!</span></button>
            <button class="demo-btn" data-demo="admin"><strong>Administrator</strong><span>admin@jobconnect.local · Admin123!</span></button>
          </div>
        </div>
      </div>
    </div>
  `;
}

const CATEGORY_META = {
  Engineering: ['💻', 'Product, platform and frontend teams'],
  Design: ['🎨', 'Product, brand and UX design'],
  Data: ['📊', 'Analytics, BI and data engineering'],
  Marketing: ['📣', 'Growth, content and lifecycle'],
  'Customer Success': ['💬', 'Support, onboarding and account care'],
  Finance: ['💰', 'Accounting, FP&A and payroll'],
  Operations: ['⚙️', 'People, logistics and administration'],
};

function categoryCards(categories) {
  return (categories || [])
    .map((row) => {
      const [icon, blurb] = CATEGORY_META[row.value] || ['📁', 'Open roles in this field'];
      return `
        <button class="category-card" data-category-filter="${esc(row.value)}">
          <span class="category-icon" aria-hidden="true">${icon}</span>
          <span class="category-copy">
            <strong>${esc(row.value)}</strong>
            <span>${esc(blurb)}</span>
          </span>
          <span class="category-arrow" aria-hidden="true">→</span>
        </button>`;
    })
    .join('');
}

function companyTicker(jobs) {
  const names = [...new Set((jobs || []).map((job) => job.company))];
  if (!names.length) return '';
  const item = (name, hidden = false) => `
      <span class="ticker-item"${hidden ? ' aria-hidden="true"' : ''}>
        ${companyMark(name, 'sm')}
        <span>${esc(name)}</span>
        <span class="ticker-arrow" aria-hidden="true">↗</span>
      </span>`;
  const items = names.map((name) => item(name)).join('');
  const staticTicker = names.length === 1;
  return `
    <div class="company-ticker${staticTicker ? ' company-ticker-static' : ''}" aria-label="Companies hiring now">
      <span class="ticker-label"><span class="live-dot" aria-hidden="true"></span>Hiring now</span>
      <div class="ticker-viewport">
        <div class="ticker-track">${items}</div>
        ${staticTicker ? '' : `<div class="ticker-track" aria-hidden="true">${names.map((name) => item(name, true)).join('')}</div>`}
      </div>
      ${staticTicker ? '<button class="ticker-more" data-route="companies">All companies →</button>' : ''}
    </div>`;
}

function companyCards(jobs, { limit = 0 } = {}) {
  const map = new Map();
  for (const job of jobs) {
    const entry = map.get(job.company) || {
      name: job.company,
      roles: 0,
      locations: new Set(),
      categories: new Set(),
      titles: [],
    };
    entry.roles += 1;
    entry.locations.add(job.location);
    entry.categories.add(job.category);
    if (entry.titles.length < 3 && !entry.titles.includes(job.title)) entry.titles.push(job.title);
    map.set(job.company, entry);
  }

  const companies = [...map.values()].sort(
    (a, b) => b.roles - a.roles || a.name.localeCompare(b.name)
  );
  const shown = limit > 0 ? companies.slice(0, limit) : companies;

  return shown
    .map((company) => {
      const locations = [...company.locations];
      const locationText = locations.slice(0, 2).join(' · ');
      const moreLocations = locations.length > 2 ? ` +${locations.length - 2} more` : '';
      return `
      <article class="company-card">
        <div class="company-card-head">
          ${companyMark(company.name, 'lg')}
          <div>
            <h3>${esc(company.name)}</h3>
            <p class="muted small">${esc([...company.categories].slice(0, 2).join(' · '))}</p>
          </div>
        </div>
        <p class="muted small company-locations">📍 ${esc(locationText)}${esc(moreLocations)}</p>
        <ul class="company-roles">
          ${company.titles.map((title) => `<li>${esc(title)}</li>`).join('')}
        </ul>
        <div class="company-card-foot">
          <span class="tag blue">${company.roles} open role${company.roles === 1 ? '' : 's'}</span>
          <button class="btn btn-secondary btn-sm" data-search-q="${esc(company.name)}">View jobs →</button>
        </div>
      </article>`;
    })
    .join('');
}

function aboutSection(stats) {
  return `
    <div class="about-grid">
      <div class="about-copy">
        <span class="how-badge">About JobConnect</span>
        <h2>Hiring should be clear on both sides of the table.</h2>
        <p>JobConnect started with a familiar frustration: applying for a job feels like posting a letter into a void. Listings are vague, salaries stay secret, and a strong candidate can wait weeks without hearing a word back.</p>
        <p>So we built a marketplace with three accountable sides. Job seekers get verified openings and a pipeline they can follow. Employers get a shortlist instead of an inbox. And administrators keep listings accurate and remove anyone gaming the board.</p>
        <ul class="about-points">
          <li>Every listing is tied to a registered employer account.</li>
          <li>Every application carries a status you can follow.</li>
          <li>Every account can be reviewed, suspended or removed by an admin.</li>
        </ul>
        <div class="about-actions">
          <button class="btn btn-primary" data-auth-mode="register-seeker">Join as a job seeker</button>
          <button class="btn btn-secondary" data-auth-mode="register-employer">Hire with us</button>
        </div>
      </div>
      <div class="about-card">
        <h3>What we stand for</h3>
        <ul class="value-list">
          <li><strong>Clarity</strong><span>Pay, location and job type are visible before you apply.</span></li>
          <li><strong>Fairness</strong><span>One listing, one employer — no scraped or duplicate roles.</span></li>
          <li><strong>Follow-through</strong><span>Every application ends in a clear decision, not silence.</span></li>
        </ul>
        <div class="about-stats">
          <div><strong>${stats.jobs}</strong><span>roles open</span></div>
          <div><strong>${stats.companies}</strong><span>companies</span></div>
          <div><strong>${stats.applications}</strong><span>applications</span></div>
        </div>
      </div>
    </div>`;
}

function howItWorks() {
  return `
    <div class="how-grid">
      <div class="how-panel">
        <span class="how-badge">For job seekers</span>
        <h3>From first search to signed offer</h3>
        <ol class="steps">
          <li><span class="step-num">1</span><div><strong>Create a free account</strong><p>Tell us who you are — it takes less than a minute.</p></div></li>
          <li><span class="step-num">2</span><div><strong>Search and filter roles</strong><p>Narrow by keyword, location, job type and category.</p></div></li>
          <li><span class="step-num">3</span><div><strong>Apply with your CV</strong><p>Attach your CV, add a cover letter and submit once.</p></div></li>
          <li><span class="step-num">4</span><div><strong>Track every decision</strong><p>Follow your status: pending, shortlisted, selected or rejected.</p></div></li>
        </ol>
        <button class="btn btn-primary" data-auth-mode="register-seeker">Start as a job seeker</button>
      </div>
      <div class="how-panel dark">
        <span class="how-badge">For employers</span>
        <h3>Post once, review every candidate</h3>
        <ol class="steps">
          <li><span class="step-num">1</span><div><strong>Register your company</strong><p>Create an employer account under your company name.</p></div></li>
          <li><span class="step-num">2</span><div><strong>Publish a vacancy</strong><p>Add the title, salary, location, description and requirements.</p></div></li>
          <li><span class="step-num">3</span><div><strong>Administrator review</strong><p>An admin approves the vacancy before it goes live to job seekers.</p></div></li>
          <li><span class="step-num">4</span><div><strong>Review and decide</strong><p>Read CVs and cover letters, then shortlist, select or reject.</p></div></li>
        </ol>
        <button class="btn btn-light" data-auth-mode="register-employer">Post your first job</button>
      </div>
    </div>`;
}

function applicationJourney() {
  const stages = [
    ['01', 'Applied', 'Your CV and details land with the hiring team.', 'pending'],
    ['02', 'Shortlisted', 'The company moves you into its shortlist.', 'shortlisted'],
    ['03', 'Selected', 'You get the offer and the decision is final.', 'selected'],
    ['04', 'Rejected', 'A clear answer, so you can move on quickly.', 'rejected'],
  ];
  return `
    <div class="journey-panel">
      <div class="journey-head">
        <div>
          <span class="section-kicker">Application journey</span>
          <h2>No more applying into the void</h2>
          <p>Every application has a visible status from the moment you send it to the final decision.</p>
        </div>
        <span class="journey-stamp" aria-hidden="true">Tracked<br /><em>end to end</em></span>
      </div>
      <ol class="journey-track">
        ${stages
          .map(
            ([num, title, copy, status]) => `
          <li class="journey-step">
            <span class="journey-num">${num}</span>
            <div class="journey-body">
              <span class="badge ${status}">${esc(STATUS_LABEL[status])}</span>
              <strong>${esc(title)}</strong>
              <p>${esc(copy)}</p>
            </div>
          </li>`
          )
          .join('')}
      </ol>
    </div>`;
}

function testimonials() {
  const quotes = [
    {
      text: 'I applied to four roles in one evening and could see exactly where each application stood. That transparency made the search far less stressful.',
      name: 'Amara Nwosu',
      role: 'Product designer',
    },
    {
      text: 'We posted a support role and had a shortlist the same week. Reviewing candidates in one dashboard instead of three inboxes saved us hours.',
      name: 'Daniel Eze',
      role: 'Hiring manager, Northwind Labs',
    },
    {
      text: 'Listings are kept accurate and bad actors are removed quickly. It feels like a marketplace that actually respects job seekers.',
      name: 'Tolu Adeyemi',
      role: 'Backend engineer',
    },
  ];
  return quotes
    .map(
      (q) => `
      <figure class="quote-card">
        <div class="stars" aria-label="5 out of 5">★★★★★</div>
        <blockquote>${esc(q.text)}</blockquote>
        <figcaption>
          <span class="avatar">${esc(initials(q.name))}</span>
          <span><strong>${esc(q.name)}</strong><span class="muted small">${esc(q.role)}</span></span>
        </figcaption>
      </figure>`
    )
    .join('');
}

function faqList() {
  const items = [
    ['Is JobConnect free for job seekers?', 'Yes. Creating a seeker account, searching jobs and applying are all free.'],
    ['Do I need an account to browse jobs?', 'You can browse and read every listing without signing in. A free account is only needed to apply and to track your applications.'],
    ['Can I apply to the same job twice?', 'No. Each role accepts one application per candidate, so take a moment on your cover letter before submitting.'],
    ['How do employers see my application?', 'Employers see your name, email, CV, cover letter and the date you applied, and they can mark the application shortlisted, selected or rejected.'],
    ['When does a job appear on the board?', 'Every vacancy is reviewed by an administrator first. Approved jobs go live immediately; rejected ones stay hidden from job seekers.'],
    ['What does the salary field mean?', 'Employers may share a salary range or leave it blank. When it is left blank, the listing says “Salary not disclosed”.'],
  ];
  return items
    .map(
      ([question, answer]) => `
      <details class="faq-item">
        <summary>${esc(question)}</summary>
        <p>${esc(answer)}</p>
      </details>`
    )
    .join('');
}

/* ------------------------------------------------------------------ */
/* Public pages (home / find jobs / companies / about)                 */
/* ------------------------------------------------------------------ */

function hasJobFilters() {
  return Boolean(state.jobSearch.q || state.jobSearch.location || state.jobSearch.type || state.jobSearch.category);
}

function jobSearchParams() {
  return new URLSearchParams(
    Object.entries(state.jobSearch).filter(([key, value]) => key !== 'filters' && value)
  );
}

async function renderPublic(ticket) {
  if (state.page === 'jobs') return renderJobsPage(ticket);
  if (state.page === 'job') return renderJobDetailPage(ticket);
  if (state.page === 'companies') return renderCompaniesPage(ticket);
  if (state.page === 'about') return renderAboutPage(ticket);
  if (state.page === 'contact') return renderContactPage();
  if (state.page === 'login' || state.page === 'register') return renderAuthPage(state.page);
  return renderLanding(ticket);
}

function renderAuthPage(kind) {
  const isLogin = kind === 'login';
  if (isLogin) {
    state.authMode = 'login';
  } else if (state.authMode === 'login') {
    state.authMode = 'register-seeker';
  }

  appEl().innerHTML = `
    <div class="auth-page">
      <div class="auth-page-copy">
        <span class="how-badge">${isLogin ? 'Welcome back' : 'Join JobConnect'}</span>
        <h1>${isLogin ? 'Sign in and pick up where you left off' : 'Create your free JobConnect account'}</h1>
        <p class="lead">${isLogin
          ? 'Your applications and hiring pipeline are waiting for you.'
          : 'One account for job seekers and employers — apply for roles, post vacancies and track every decision in one place.'}</p>
        <ul class="auth-points">
          <li><strong>Job seekers</strong><span>Search verified roles, apply in one click and follow every application.</span></li>
          <li><strong>Employers</strong><span>Publish vacancies and review candidates from a single dashboard.</span></li>
          <li><strong>No fees</strong><span>Creating an account is free, and no credit card is required.</span></li>
        </ul>
        <p class="muted small">${isLogin
          ? 'New here? <button class="link-btn" data-auth-mode="register-seeker">Create a job seeker account</button> or <button class="link-btn" data-auth-mode="register-employer">register as an employer</button>.'
          : 'Already registered? <button class="link-btn" data-auth-mode="login">Sign in instead</button>.'}</p>
      </div>
      ${authCard()}
    </div>
  `;
}

function ctaBand() {
  return `
    <section class="cta-band">
      <div>
        <h2>Ready to make your next move?</h2>
        <p>Create a free account as a job seeker, or start hiring with an employer account. No credit card, no setup fee.</p>
      </div>
      <div class="cta-actions">
        <button class="btn btn-light" data-auth-mode="register-seeker">Find a job</button>
        <button class="btn btn-outline-light" data-auth-mode="register-employer">Post a vacancy</button>
      </div>
    </section>`;
}

function renderContactPage() {
  appEl().innerHTML = `
    <div class="stack">
      <section class="page-hero">
        <span class="eyebrow">Contact us</span>
        <h1>Talk to the JobConnect team</h1>
        <p class="lead">Questions about a listing, your account or hiring? Send us a message and a real person will get back to you.</p>
      </section>

      <div class="contact-grid">
        <form class="panel" data-form="contact">
          <div class="panel-body">
            <h2>Send us a message</h2>
            <p class="muted small">We reply to every message within one business day.</p>
            <div class="form-alert"></div>
            <div class="grid-2">
              <div class="field">
                <label for="contact-name">Full name</label>
                <input id="contact-name" name="name" autocomplete="name" required placeholder="Your full name" />
              </div>
              <div class="field">
                <label for="contact-email">Email address</label>
                <input id="contact-email" name="email" type="email" autocomplete="email" required placeholder="you@example.com" />
              </div>
            </div>
            <div class="field">
              <label for="contact-subject">Topic</label>
              <select id="contact-subject" name="subject">
                <option>General question</option>
                <option>Job seeker support</option>
                <option>Employers &amp; hiring</option>
                <option>Report a listing</option>
                <option>Privacy request</option>
              </select>
            </div>
            <div class="field">
              <label for="contact-message">Message</label>
              <textarea id="contact-message" name="message" required minlength="20" placeholder="How can we help?"></textarea>
              <span class="hint">At least 20 characters. Include the email on your account if you have one.</span>
            </div>
            <button class="btn btn-primary" type="submit">Send message</button>
          </div>
        </form>

        <aside class="contact-side">
          <div class="panel">
            <div class="panel-body">
              <h3>Direct contacts</h3>
              <ul class="contact-list">
                <li><strong>Job seeker support</strong><a href="mailto:support@jobconnect.local">support@jobconnect.local</a></li>
                <li><strong>Employers &amp; hiring</strong><a href="mailto:employers@jobconnect.local">employers@jobconnect.local</a></li>
                <li><strong>Phone</strong><span>+1 (555) 010-2040 · Mon–Fri, 9:00–17:00</span></li>
                <li><strong>Office</strong><span>24 Market Street, Suite 400</span></li>
              </ul>
            </div>
          </div>
          <div class="panel">
            <div class="panel-body">
              <h3>Reporting a listing</h3>
              <p class="small muted">If a role looks misleading, expired or duplicated, send us the link and job title. Administrators review reports and can close or remove the listing.</p>
              <p class="small muted" style="margin-bottom:0">Choose “Report a listing” in the form so it reaches the moderation queue first.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  `;
}

async function renderJobsPage(ticket) {
  const data = await api(`/api/jobs?${jobSearchParams()}`);
  if (ticket !== renderTicket) return;
  state.jobSearch.filters = data.filters;
  const hasFilters = hasJobFilters();
  const total = data.jobs.length;

  appEl().innerHTML = `
    <div class="stack">
      <div class="page-head">
        <div>
          <h1>Find your next job</h1>
          <p>${total} open role${total === 1 ? '' : 's'}${hasFilters ? ' match your search' : ' from verified employers'}.</p>
        </div>
        <button class="btn btn-secondary" data-route="companies">Browse companies</button>
      </div>

      ${searchForm(data.filters)}

      <div class="section-title">
        <div>
          <h2>${hasFilters ? 'Search results' : 'All open roles'}</h2>
          <p class="muted small">Every listing is tied to a registered employer account.</p>
        </div>
        ${hasFilters ? `<button class="btn btn-ghost btn-sm" data-action="clear-search">Clear filters</button>` : ''}
      </div>

      <div class="jobs-grid">
        ${total ? data.jobs.map(jobCard).join('') : emptyState('No jobs match your search', 'Try a different keyword, location or job type.')}
      </div>

      ${ctaBand()}
    </div>
  `;
}

async function renderCompaniesPage(ticket) {
  const [data, statsData] = await Promise.all([api('/api/jobs'), api('/api/stats')]);
  if (ticket !== renderTicket) return;
  const stats = statsData.stats;

  appEl().innerHTML = `
    <div class="stack">
      <section class="page-hero">
        <span class="eyebrow">${stats.companies} compan${stats.companies === 1 ? 'y' : 'ies'} hiring</span>
        <h1>Companies building their next team</h1>
        <p class="lead">Every employer here has a registered account and live vacancies. Open a company to see its roles, locations and categories.</p>
        <ul class="hero-stats">
          <li><strong>${stats.companies}</strong><span>companies</span></li>
          <li><strong>${stats.jobs}</strong><span>open roles</span></li>
          <li><strong>${stats.employers}</strong><span>employer accounts</span></li>
          <li><strong>${stats.applications}</strong><span>applications sent</span></li>
        </ul>
      </section>

      <section>
        <div class="section-title">
          <div>
            <h2>Hiring right now</h2>
            <p class="muted small">Sorted by how many roles each team has open.</p>
          </div>
          <button class="btn btn-ghost btn-sm" data-route="jobs">See all jobs</button>
        </div>
        ${
          data.jobs.length
            ? `<div class="company-grid">${companyCards(data.jobs)}</div>`
            : emptyState('No companies hiring yet', 'New employers appear here as soon as they post a role.')
        }
      </section>

      <section class="how-grid">
        <div class="how-panel">
          <span class="how-badge">For candidates</span>
          <h3>What a company card tells you</h3>
          <ol class="steps">
            <li><span class="step-num">1</span><div><strong>Open roles</strong><p>The number of live vacancies that team is hiring for today.</p></div></li>
            <li><span class="step-num">2</span><div><strong>Locations</strong><p>Where the team hires — on-site cities or remote.</p></div></li>
            <li><span class="step-num">3</span><div><strong>Fields</strong><p>The categories they recruit in, from engineering to support.</p></div></li>
          </ol>
        </div>
        <div class="how-panel dark">
          <span class="how-badge">For employers</span>
          <h3>Get your company listed</h3>
          <p class="lead">Register an employer account, publish your first vacancy, and your company appears on this page with its open roles.</p>
          <div class="cta-actions" style="margin-top: 1.1rem">
            <button class="btn btn-light" data-auth-mode="register-employer">Post a vacancy</button>
          </div>
        </div>
      </section>

      ${ctaBand()}
    </div>
  `;
}

async function renderAboutPage(ticket) {
  const statsData = await api('/api/stats');
  if (ticket !== renderTicket) return;
  const stats = statsData.stats;

  appEl().innerHTML = `
    <div class="stack">
      <section class="page-hero">
        <span class="eyebrow">About us</span>
        <h1>We make hiring legible on both sides of the table</h1>
        <p class="lead">JobConnect is a three-sided job marketplace: seekers find verified roles, employers hire faster, and administrators keep the board fair.</p>
        <ul class="hero-stats">
          <li><strong>${stats.jobs}</strong><span>open roles</span></li>
          <li><strong>${stats.companies}</strong><span>companies hiring</span></li>
          <li><strong>${stats.seekers}</strong><span>job seekers</span></li>
          <li><strong>${stats.applications}</strong><span>applications sent</span></li>
        </ul>
      </section>

      <section>${aboutSection(stats)}</section>

      <section id="how-it-works">
        <div class="section-title">
          <div>
            <span class="section-kicker">Process</span>
            <h2>How JobConnect works</h2>
            <p class="muted small">One platform, two very different days made easier.</p>
          </div>
        </div>
        ${howItWorks()}
      </section>

      <section>
        <div class="section-title"><h2>Loved by both sides of the table</h2></div>
        <div class="quote-grid">${testimonials()}</div>
      </section>

      ${ctaBand()}

      <section>
        <div class="section-title"><h2>Questions, answered</h2></div>
        <div class="faq">${faqList()}</div>
      </section>
    </div>
  `;
}

async function renderLanding(ticket) {
  const params = new URLSearchParams(
    Object.entries(state.jobSearch).filter(([key, value]) => key !== 'filters' && value)
  );
  const [data, statsData] = await Promise.all([api(`/api/jobs?${params}`), api('/api/stats')]);
  if (ticket !== renderTicket) return;
  state.jobSearch.filters = data.filters;
  const stats = statsData.stats;
  const featured = data.jobs.slice(0, 6);
  const hasFilters = Boolean(state.jobSearch.q || state.jobSearch.location || state.jobSearch.type || state.jobSearch.category);

  appEl().innerHTML = `
    <div class="stack landing">
      <section class="landing-hero">
        <span class="hero-ghost" aria-hidden="true">HIRE</span>
        <div class="hero-copy">
          <span class="eyebrow"><span class="eyebrow-dot" aria-hidden="true"></span>No ghost jobs · No fees · Updated daily</span>
          <h1>Work worth<br /><em class="hero-accent">showing up for.</em></h1>
          <p class="lead">Verified roles from real teams, one clean application, and a status you can follow from first click to final decision. Hiring? Find people who deliver.</p>
          <form class="hero-search" data-form="hero-search">
            <div class="hero-search-field">
              <span aria-hidden="true">⌕</span>
              <input name="q" value="${esc(state.jobSearch.q)}" placeholder="Job title, skill or company" aria-label="Search jobs by keyword" />
            </div>
            <div class="hero-search-field">
              <span aria-hidden="true">📍</span>
              <input name="location" value="${esc(state.jobSearch.location)}" placeholder="City or remote" aria-label="Search jobs by location" />
            </div>
            <button class="btn btn-primary" type="submit">Search jobs</button>
          </form>
          <div class="hero-chips">
            <span>Popular:</span>
            <button class="chip" data-search-q="Frontend">Frontend</button>
            <button class="chip" data-search-q="Remote">Remote</button>
            <button class="chip" data-search-q="Data">Data</button>
            <button class="chip" data-search-q="Design">Design</button>
          </div>
          <ul class="hero-proof">
            <li>Free for job seekers</li>
            <li>Every listing verified</li>
            <li>Applications you can track</li>
          </ul>
        </div>
        <div class="hero-side">
          <div class="hero-auth">
            <div class="hero-auth-head">
              <span class="hero-auth-dots" aria-hidden="true"><i></i><i></i><i></i></span>
              <span>Your account</span>
            </div>
            ${authCard()}
          </div>
          <div class="hero-sticker" aria-hidden="true">
            <span class="hero-sticker-star">✳</span>
            <strong>${stats.jobs}</strong>
            <span>role${stats.jobs === 1 ? '' : 's'} live right now</span>
          </div>
        </div>
      </section>

      <div class="hero-statbar">
        <div class="hero-statbar-item"><strong>${stats.jobs}</strong><span>Open roles</span></div>
        <div class="hero-statbar-item"><strong>${stats.companies}</strong><span>Companies hiring</span></div>
        <div class="hero-statbar-item"><strong>${stats.seekers}</strong><span>Job seekers</span></div>
        <div class="hero-statbar-item"><strong>${stats.applications}</strong><span>Applications sent</span></div>
      </div>

      ${companyTicker(data.jobs)}

      <section>
        <div class="section-title">
          <div>
            <span class="section-kicker">Why JobConnect</span>
            <h2>A job board that shows its receipts</h2>
            <p class="muted small">Built for people who are tired of guessing.</p>
          </div>
        </div>
        <div class="feature-grid bento">
          <article class="feature-card tint-ink">
            <span class="feature-icon" aria-hidden="true">🔍</span>
            <h3>Search that respects your time</h3>
            <p>Filter by keyword, location, job type and category. Results update instantly, and every listing shows who is hiring and what it pays.</p>
          </article>
          <article class="feature-card tint-lime">
            <span class="feature-icon" aria-hidden="true">📋</span>
            <h3>No application black holes</h3>
            <p>Every application is stored with its status — pending, shortlisted, selected or rejected — so you always know where you stand.</p>
          </article>
          <article class="feature-card tint-coral">
            <span class="feature-icon" aria-hidden="true">🛡️</span>
            <h3>A marketplace with a referee</h3>
            <p>Administrators review accounts and listings, suspend bad actors and keep closed or misleading jobs off the board.</p>
          </article>
          <article class="feature-card tint-paper">
            <span class="feature-icon" aria-hidden="true">💸</span>
            <h3>Pay before you apply</h3>
            <p>Salary and location sit on the card, not buried in paragraph nine. You decide what is worth your time before writing a word.</p>
          </article>
        </div>
      </section>

      ${
        data.filters.categories.length
          ? `<section>
              <div class="section-title">
                <div>
                  <span class="section-kicker">Explore by field</span>
                  <h2>Browse by category</h2>
                  <p class="muted small">Pick a field to jump straight to matching roles.</p>
                </div>
                <button class="btn btn-ghost btn-sm" data-action="clear-search">View all jobs</button>
              </div>
              <div class="category-grid">${categoryCards(data.filters.categories)}</div>
            </section>`
          : ''
      }

      <section id="latest-jobs">
        <div class="section-title">
          <div>
            <span class="section-kicker">Open right now</span>
            <h2>Latest opportunities</h2>
            <p class="muted small">${data.jobs.length} open job${data.jobs.length === 1 ? '' : 's'}${hasFilters ? ' match your search' : ' right now'}</p>
          </div>
          <button class="btn btn-secondary btn-sm" data-route="jobs">${hasFilters ? 'See all results' : 'Browse all jobs'}</button>
        </div>
        ${searchForm(data.filters)}
        <div class="jobs-grid" style="margin-top: 1rem">
          ${featured.length ? featured.map(jobCard).join('') : emptyState('No jobs match your search', 'Try a different keyword, location or job type.')}
        </div>
        ${data.jobs.length > featured.length ? `<p class="muted small more-note">Showing ${featured.length} of ${data.jobs.length} roles on this page — <button class="link-btn" data-route="jobs">see all open jobs</button>.</p>` : ''}
      </section>

      ${
        data.jobs.length
          ? `<section class="companies-section" id="companies-hiring">
              <div class="section-title">
                <div>
                  <span class="section-kicker">Employers</span>
                  <h2>Companies hiring now</h2>
                  <p class="muted small">Verified employers with live vacancies — see who is hiring before you apply.</p>
                </div>
                <button class="btn btn-secondary btn-sm" data-route="companies">All companies</button>
              </div>
              <div class="company-grid">${companyCards(data.jobs, { limit: 6 })}</div>
            </section>`
          : ''
      }

      <section>
        <div class="section-title">
          <div>
            <span class="section-kicker">Process</span>
            <h2>How JobConnect works</h2>
            <p class="muted small">One platform, two very different days made easier.</p>
          </div>
        </div>
        ${howItWorks()}
      </section>

      <section>${applicationJourney()}</section>

      <section>
        <div class="section-title">
          <div>
            <span class="section-kicker">Voices</span>
            <h2>Loved by both sides of the table</h2>
          </div>
        </div>
        <div class="quote-grid">${testimonials()}</div>
      </section>

      ${ctaBand()}

      <section>
        <div class="section-title">
          <div>
            <span class="section-kicker">FAQ</span>
            <h2>Questions, answered</h2>
          </div>
        </div>
        <div class="faq">${faqList()}</div>
      </section>
    </div>
  `;
}

function searchForm(filters = {}) {
  const { q, location, type, category } = state.jobSearch;
  const typeOptions = (filters.types || [])
    .map((row) => `<option value="${esc(row.value)}" ${type === row.value ? 'selected' : ''}>${esc(row.value)}</option>`)
    .join('');
  const categoryOptions = (filters.categories || [])
    .map((row) => `<option value="${esc(row.value)}" ${category === row.value ? 'selected' : ''}>${esc(row.value)}</option>`)
    .join('');

  return `
    <form class="searchbar" data-form="job-search">
      <div class="field">
        <label for="search-q">Keyword</label>
        <input id="search-q" name="q" value="${esc(q)}" placeholder="Job title, company or skill" />
      </div>
      <div class="field">
        <label for="search-location">Location</label>
        <input id="search-location" name="location" value="${esc(location)}" placeholder="City or remote" />
      </div>
      <div class="field">
        <label for="search-type">Job type</label>
        <select id="search-type" name="type">
          <option value="">Any type</option>
          ${typeOptions}
        </select>
      </div>
      <div class="field">
        <label for="search-category">Category</label>
        <select id="search-category" name="category">
          <option value="">All categories</option>
          ${categoryOptions}
        </select>
      </div>
      <button class="btn btn-primary" type="submit">Search</button>
    </form>
  `;
}

function jobCard(job) {
  return `
    <article class="job-card">
      <div class="job-card-head">
        ${companyMark(job.company)}
        <div class="job-card-title">
          <h3>${esc(job.title)}</h3>
          <div class="company">${esc(job.company)}</div>
        </div>
        <span class="tag blue">${esc(job.type)}</span>
      </div>
      <div class="job-meta">
        <span class="tag">📍 ${esc(job.location)}</span>
        <span class="tag">${esc(job.category)}</span>
      </div>
      <p class="job-desc">${esc(job.description)}</p>
      <div class="job-card-foot">
        <span class="job-card-pay">
          <span class="salary">${job.salary ? esc(job.salary) : 'Salary not disclosed'}</span>
          <span class="muted small">Posted ${fmtDate(job.created_at)}</span>
        </span>
        <button class="btn btn-secondary btn-sm" data-job="${job.id}">View details</button>
      </div>
    </article>
  `;
}

/* ------------------------------------------------------------------ */
/* Seeker                                                              */
/* ------------------------------------------------------------------ */

async function renderSeeker(ticket) {
  if (state.view === 'job-detail') return renderJobDetailPage(ticket);
  if (state.view === 'applications') return renderSeekerApplications(ticket);

  const params = new URLSearchParams(
    Object.entries(state.jobSearch).filter(([key, value]) => key !== 'filters' && value)
  );
  const data = await api(`/api/jobs?${params}`);
  if (ticket !== renderTicket) return;
  state.jobSearch.filters = data.filters;

  appEl().innerHTML = `
    <div class="stack">
      <div class="page-head">
        <div>
          <h1>Welcome back, ${esc(state.user.name.split(' ')[0])}</h1>
          <p>Search open roles and keep track of every application.</p>
        </div>
        <button class="btn btn-secondary" data-nav="applications">My applications</button>
      </div>
      ${searchForm(data.filters)}
      <div class="jobs-grid">
        ${data.jobs.length ? data.jobs.map(jobCard).join('') : emptyState('No jobs match your search', 'Try a different keyword, location or job type.')}
      </div>
    </div>
  `;
}

async function renderSeekerApplications(ticket) {
  const data = await api('/api/applications');
  if (ticket !== renderTicket) return;

  appEl().innerHTML = `
    <div class="stack">
      <div class="page-head">
        <div>
          <h1>My applications</h1>
          <p>Follow the status of every job you have applied to.</p>
        </div>
        <button class="btn btn-secondary" data-nav="jobs">Find more jobs</button>
      </div>
      <div class="panel">
        <div class="table-wrap">
          ${
            data.applications.length
              ? `<table>
                  <thead><tr><th>Job</th><th>Company</th><th>Applied</th><th>Status</th></tr></thead>
                  <tbody>
                    ${data.applications
                      .map(
                        (a) => `
                        <tr>
                          <td><strong>${esc(a.job_title)}</strong><span class="sub">${esc(a.location)} · ${esc(a.type)}</span></td>
                          <td>${esc(a.company)}</td>
                          <td class="nowrap">${fmtDate(a.created_at)}</td>
                          <td>${badge(a.status)}</td>
                        </tr>`
                      )
                      .join('')}
                  </tbody>
                </table>`
              : emptyState('No applications yet', 'Browse open jobs and apply to get started.')
          }
        </div>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Employer                                                            */
/* ------------------------------------------------------------------ */

async function renderEmployer(ticket) {
  if (state.view === 'post-job') return renderPostJob(ticket);
  if (state.view === 'employer-applications') return renderEmployerApplications(ticket);
  return renderEmployerOverview(ticket);
}

async function renderEmployerOverview(ticket) {
  const data = await api('/api/employer/overview');
  if (ticket !== renderTicket) return;
  const { stats, jobs } = data;

  appEl().innerHTML = `
    <div class="stack">
      <div class="page-head">
        <div>
          <h1>${esc(state.user.company || state.user.name)}</h1>
          <p>Manage your vacancies and see how your hiring is going.</p>
        </div>
        <button class="btn btn-primary" data-nav="post-job">Post a job</button>
      </div>

      <div class="stats-grid">
        <div class="stat"><div class="label">Open jobs</div><div class="value accent">${stats.openJobs}</div></div>
        <div class="stat"><div class="label">Awaiting approval</div><div class="value">${stats.pendingModeration}</div></div>
        <div class="stat"><div class="label">Applications</div><div class="value">${stats.applications}</div></div>
        <div class="stat"><div class="label">Shortlisted</div><div class="value">${stats.shortlisted}</div></div>
        <div class="stat"><div class="label">Selected</div><div class="value">${stats.selected}</div></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>Your job posts</h2>
          <span class="muted small">${jobs.length} total</span>
        </div>
        <div class="table-wrap">
          ${
            jobs.length
              ? `<table>
                  <thead><tr><th>Role</th><th>Location</th><th>Applicants</th><th>Status</th><th>Posted</th><th class="actions">Actions</th></tr></thead>
                  <tbody>
                    ${jobs
                      .map(
                        (job) => `
                        <tr>
                          <td><strong>${esc(job.title)}</strong><span class="sub">${esc(job.type)} · ${esc(job.category)}</span></td>
                          <td>${esc(job.location)}</td>
                          <td>${job.application_count}${job.pending_count ? `<span class="sub">${job.pending_count} new</span>` : ''}</td>
                          <td>
                            ${badge(job.moderation)}${job.moderation === 'approved' ? ` ${badge(job.status)}` : ''}
                            ${job.moderation === 'pending' ? '<span class="sub">Not visible to seekers yet</span>' : ''}
                            ${job.moderation === 'rejected' ? '<span class="sub">Fix and repost this role</span>' : ''}
                          </td>
                          <td class="nowrap">${fmtDate(job.created_at)}</td>
                          <td>
                            <div class="actions">
                              <button class="btn btn-secondary btn-sm" data-job-applicants="${job.id}">Applications</button>
                              ${
                                job.moderation === 'approved'
                                  ? `<button class="btn btn-secondary btn-sm" data-toggle-job="${job.id}" data-status="${job.status}">
                                      ${job.status === 'open' ? 'Close' : 'Reopen'}
                                    </button>`
                                  : ''
                              }
                              <button class="btn btn-danger btn-sm" data-delete-job="${job.id}">Delete</button>
                            </div>
                          </td>
                        </tr>`
                      )
                      .join('')}
                  </tbody>
                </table>`
              : emptyState('No job posts yet', 'Post your first vacancy to start receiving applications.')
          }
        </div>
      </div>
    </div>
  `;
}

async function renderPostJob(ticket) {
  const data = await api('/api/employer/overview');
  if (ticket !== renderTicket) return;
  const categories = [...new Set(data.jobs.map((job) => job.category))].filter(Boolean);

  appEl().innerHTML = `
    <div class="stack">
      <div class="page-head">
        <div>
          <h1>Post a job</h1>
          <p>Tell candidates what the role involves. An administrator reviews every vacancy before it goes live.</p>
        </div>
        <button class="btn btn-secondary" data-nav="employer-overview">Back to overview</button>
      </div>

      <div class="panel">
        <div class="panel-body">
          <form data-form="post-job">
            <div class="field">
              <label for="job-title">Job title</label>
              <input id="job-title" name="title" required minlength="3" placeholder="e.g. Backend Engineer" />
            </div>
            <div class="grid-2">
              <div class="field">
                <label for="job-location">Location</label>
                <input id="job-location" name="location" required placeholder="e.g. Lagos, Nigeria or Remote" />
              </div>
              <div class="field">
                <label for="job-type">Job type</label>
                <select id="job-type" name="type">
                  <option>Full-time</option>
                  <option>Part-time</option>
                  <option>Contract</option>
                  <option>Internship</option>
                  <option>Remote</option>
                </select>
              </div>
              <div class="field">
                <label for="job-category">Category</label>
                <input id="job-category" name="category" list="category-list" placeholder="e.g. Engineering" />
                <datalist id="category-list">
                  ${categories.map((c) => `<option value="${esc(c)}"></option>`).join('')}
                  <option value="Engineering"></option>
                  <option value="Design"></option>
                  <option value="Data"></option>
                  <option value="Marketing"></option>
                  <option value="Customer Success"></option>
                  <option value="Finance"></option>
                  <option value="Operations"></option>
                </datalist>
              </div>
              <div class="field">
                <label for="job-salary">Salary (optional)</label>
                <input id="job-salary" name="salary" placeholder="e.g. ₦400,000 / month" />
              </div>
            </div>
            <div class="field">
              <label for="job-description">Description</label>
              <textarea id="job-description" name="description" required minlength="20" placeholder="Responsibilities and what makes this role great…"></textarea>
              <span class="hint">At least 20 characters.</span>
            </div>
            <div class="field">
              <label for="job-requirements">Requirements</label>
              <textarea id="job-requirements" name="requirements" required minlength="10" placeholder="Qualifications, skills and experience the candidate needs…"></textarea>
              <span class="hint">At least 10 characters. Job seekers see this on the listing.</span>
            </div>
            <button class="btn btn-primary" type="submit">Submit for review</button>
          </form>
        </div>
      </div>
    </div>
  `;
}

async function renderEmployerApplications(ticket) {
  const filterId = state.employerJobFilter;
  const data = filterId
    ? await api(`/api/jobs/${filterId}/applications`)
    : await api('/api/employer/applications');
  if (ticket !== renderTicket) return;
  const filteredJobTitle = filterId ? data.job?.title : null;
  const applications = data.applications;

  appEl().innerHTML = `
    <div class="stack">
      <div class="page-head">
        <div>
          <h1>Applications</h1>
          <p>${filteredJobTitle ? `Candidates for “${esc(filteredJobTitle)}”, newest first.` : 'Every candidate who applied to your jobs, newest first.'}</p>
        </div>
        ${
          filteredJobTitle
            ? `<button class="btn btn-secondary" data-action="clear-job-filter">Show all applications</button>`
            : `<button class="btn btn-secondary" data-nav="employer-overview">Back to overview</button>`
        }
      </div>
      <div class="panel">
        <div class="table-wrap">
          ${
            applications.length
              ? `<table>
                  <thead><tr><th>Candidate</th><th>Job</th><th>Applied</th><th>CV</th><th>Status</th><th class="actions">Decision</th></tr></thead>
                  <tbody>
                    ${applications
                      .map(
                        (a) => `
                        <tr>
                          <td><strong>${esc(a.seeker_name)}</strong><span class="sub">${esc(a.seeker_email)}</span></td>
                          <td>${esc(a.job_title || filteredJobTitle || '')}</td>
                          <td class="nowrap">${fmtDate(a.created_at)}</td>
                          <td>
                            <div class="actions">
                              ${a.cv_path ? `<button class="btn btn-secondary btn-sm" data-download-cv="${a.id}" data-cv-name="${esc(a.cv_name || 'cv')}">Download</button>` : '<span class="muted small">None</span>'}
                              <button class="btn btn-ghost btn-sm" data-view-application="${a.id}">View</button>
                            </div>
                          </td>
                          <td>${badge(a.status)}</td>
                          <td>
                            <div class="actions">
                              <button class="btn btn-secondary btn-sm" data-set-status="shortlisted" data-application="${a.id}" ${a.status === 'shortlisted' ? 'disabled' : ''}>Shortlist</button>
                              <button class="btn btn-primary btn-sm" data-set-status="selected" data-application="${a.id}" ${a.status === 'selected' ? 'disabled' : ''}>Select</button>
                              <button class="btn btn-danger btn-sm" data-set-status="rejected" data-application="${a.id}" ${a.status === 'rejected' ? 'disabled' : ''}>Reject</button>
                            </div>
                          </td>
                        </tr>`
                      )
                      .join('')}
                  </tbody>
                </table>`
              : emptyState('No applications yet', 'Applications will appear here as candidates apply to your jobs.')
          }
        </div>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Administrator                                                       */
/* ------------------------------------------------------------------ */

async function renderAdmin(ticket) {
  if (state.view === 'admin-users') return renderAdminUsers(ticket);
  if (state.view === 'admin-jobs') return renderAdminJobs(ticket);
  if (state.view === 'admin-messages') return renderAdminMessages(ticket);
  return renderAdminOverview(ticket);
}

async function renderAdminOverview(ticket) {
  const data = await api('/api/admin/stats');
  if (ticket !== renderTicket) return;
  const s = data.stats;

  appEl().innerHTML = `
    <div class="stack">
      <div class="page-head">
        <div>
          <h1>Administrator console</h1>
          <p>Review submitted vacancies, monitor the marketplace and keep accounts in order.</p>
        </div>
        <div class="actions">
          <button class="btn btn-primary" data-nav="admin-jobs">Review jobs${s.pendingJobs ? ` (${s.pendingJobs})` : ''}</button>
          <button class="btn btn-secondary" data-nav="admin-users">Manage users</button>
          <button class="btn btn-secondary" data-nav="admin-messages">Inbox${s.contactMessages ? ` (${s.contactMessages})` : ''}</button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat"><div class="label">Job seekers</div><div class="value">${s.seekers}</div></div>
        <div class="stat"><div class="label">Employers</div><div class="value">${s.employers}</div></div>
        <div class="stat"><div class="label">Jobs awaiting approval</div><div class="value accent">${s.pendingJobs}</div></div>
        <div class="stat"><div class="label">Open jobs</div><div class="value">${s.openJobs}</div></div>
        <div class="stat"><div class="label">Applications</div><div class="value">${s.applications}</div></div>
        <div class="stat"><div class="label">Pending decisions</div><div class="value">${s.pendingApplications}</div></div>
        <div class="stat"><div class="label">Suspended accounts</div><div class="value">${s.suspendedUsers}</div></div>
        <div class="stat"><div class="label">Contact messages</div><div class="value">${s.contactMessages}</div></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>Recent applications</h2>
          <button class="btn btn-ghost btn-sm" data-nav="admin-jobs">View all jobs</button>
        </div>
        <div class="table-wrap">
          ${
            data.recentApplications.length
              ? `<table>
                  <thead><tr><th>Candidate</th><th>Job</th><th>Company</th><th>Applied</th><th>Status</th></tr></thead>
                  <tbody>
                    ${data.recentApplications
                      .map(
                        (a) => `
                        <tr>
                          <td>${esc(a.seeker_name)}</td>
                          <td>${esc(a.job_title)}</td>
                          <td>${esc(a.company)}</td>
                          <td class="nowrap">${fmtDate(a.created_at)}</td>
                          <td>${badge(a.status)}</td>
                        </tr>`
                      )
                      .join('')}
                  </tbody>
                </table>`
              : emptyState('No applications yet', 'Applications across the platform will show up here.')
          }
        </div>
      </div>
    </div>
  `;
}

async function renderAdminUsers(ticket) {
  const params = new URLSearchParams(Object.entries(state.userFilter).filter(([, v]) => v));
  const data = await api(`/api/admin/users?${params}`);
  if (ticket !== renderTicket) return;
  const { role, q } = state.userFilter;

  appEl().innerHTML = `
    <div class="stack">
      <div class="page-head">
        <div>
          <h1>Users</h1>
          <p>Suspend accounts that break the rules or remove accounts entirely.</p>
        </div>
        <button class="btn btn-secondary" data-nav="admin-overview">Back to overview</button>
      </div>

      <form class="searchbar" data-form="user-search">
        <div class="field">
          <label for="user-q">Search</label>
          <input id="user-q" name="q" value="${esc(q)}" placeholder="Name, email or company" />
        </div>
        <div class="field">
          <label for="user-role">Role</label>
          <select id="user-role" name="role">
            <option value="">All roles</option>
            <option value="seeker" ${role === 'seeker' ? 'selected' : ''}>Job seekers</option>
            <option value="employer" ${role === 'employer' ? 'selected' : ''}>Employers</option>
            <option value="admin" ${role === 'admin' ? 'selected' : ''}>Administrators</option>
          </select>
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <button class="btn btn-primary" type="submit">Filter</button>
        </div>
      </form>

      <div class="panel">
        <div class="table-wrap">
          ${
            data.users.length
              ? `<table>
                  <thead><tr><th>User</th><th>Role</th><th>Joined</th><th>Activity</th><th>Status</th><th class="actions">Actions</th></tr></thead>
                  <tbody>
                    ${data.users
                      .map(
                        (u) => `
                        <tr>
                          <td><strong>${esc(u.name)}</strong><span class="sub">${esc(u.email)}</span></td>
                          <td>${esc(ROLE_LABEL[u.role] || u.role)}${u.company ? `<span class="sub">${esc(u.company)}</span>` : ''}</td>
                          <td class="nowrap">${fmtDate(u.created_at)}</td>
                          <td>${u.role === 'employer' ? `${u.job_count} job${u.job_count === 1 ? '' : 's'}` : u.role === 'seeker' ? `${u.application_count} application${u.application_count === 1 ? '' : 's'}` : '—'}</td>
                          <td>${badge(u.suspended ? 'suspended' : 'active')}</td>
                          <td>
                            ${
                              u.role === 'admin'
                                ? '<span class="muted small">Protected</span>'
                                : `<div class="actions">
                                    <button class="btn ${u.suspended ? 'btn-secondary' : 'btn-danger'} btn-sm" data-toggle-user="${u.id}" data-suspended="${u.suspended ? 1 : 0}">
                                      ${u.suspended ? 'Reactivate' : 'Suspend'}
                                    </button>
                                    <button class="btn btn-secondary btn-sm" data-delete-user="${u.id}">Delete</button>
                                  </div>`
                            }
                          </td>
                        </tr>`
                      )
                      .join('')}
                  </tbody>
                </table>`
              : emptyState('No users found', 'Try clearing the filters.')
          }
        </div>
      </div>
    </div>
  `;
}

async function renderAdminJobs(ticket) {
  const data = await api('/api/admin/jobs');
  if (ticket !== renderTicket) return;

  appEl().innerHTML = `
    <div class="stack">
      <div class="page-head">
        <div>
          <h1>Job listings</h1>
          <p>Approve or reject submitted vacancies, close misleading listings, or remove them.</p>
        </div>
        <button class="btn btn-secondary" data-nav="admin-overview">Back to overview</button>
      </div>
      <div class="panel">
        <div class="table-wrap">
          ${
            data.jobs.length
              ? `<table>
                  <thead><tr><th>Role</th><th>Employer</th><th>Applicants</th><th>Moderation</th><th>Visibility</th><th>Posted</th><th class="actions">Actions</th></tr></thead>
                  <tbody>
                    ${data.jobs
                      .map(
                        (job) => `
                        <tr>
                          <td><strong>${esc(job.title)}</strong><span class="sub">${esc(job.location)} · ${esc(job.type)}</span></td>
                          <td>${esc(job.company)}<span class="sub">${esc(job.employer_email)}</span></td>
                          <td>${job.application_count}</td>
                          <td>${badge(job.moderation)}</td>
                          <td>${job.moderation === 'approved' ? badge(job.status) : '<span class="muted small">Hidden from seekers</span>'}</td>
                          <td class="nowrap">${fmtDate(job.created_at)}</td>
                          <td>
                            <div class="actions">
                              ${
                                job.moderation === 'pending'
                                  ? `<button class="btn btn-primary btn-sm" data-admin-moderate="approved" data-job-id="${job.id}">Approve</button>
                                     <button class="btn btn-danger btn-sm" data-admin-moderate="rejected" data-job-id="${job.id}">Reject</button>`
                                  : job.moderation === 'rejected'
                                    ? `<button class="btn btn-primary btn-sm" data-admin-moderate="approved" data-job-id="${job.id}">Approve</button>`
                                    : `<button class="btn btn-secondary btn-sm" data-admin-moderate="rejected" data-job-id="${job.id}">Reject</button>
                                       <button class="btn btn-secondary btn-sm" data-admin-toggle-job="${job.id}" data-status="${job.status}">
                                         ${job.status === 'open' ? 'Close' : 'Reopen'}
                                       </button>`
                              }
                              <button class="btn btn-danger btn-sm" data-admin-delete-job="${job.id}">Delete</button>
                            </div>
                          </td>
                        </tr>`
                      )
                      .join('')}
                  </tbody>
                </table>`
              : emptyState('No job listings', 'Employers have not posted any jobs yet.')
          }
        </div>
      </div>
    </div>
  `;
}

async function renderAdminMessages(ticket) {
  const params = new URLSearchParams(Object.entries(state.messageFilter).filter(([, v]) => v));
  const data = await api(`/api/admin/messages?${params}`);
  if (ticket !== renderTicket) return;
  const { q } = state.messageFilter;

  appEl().innerHTML = `
    <div class="stack">
      <div class="page-head">
        <div>
          <h1>Contact messages</h1>
          <p>Everything sent through the public contact form. Reply by email, then delete the message.</p>
        </div>
        <button class="btn btn-secondary" data-nav="admin-overview">Back to overview</button>
      </div>

      <form class="searchbar" data-form="message-search">
        <div class="field">
          <label for="message-q">Search</label>
          <input id="message-q" name="q" value="${esc(q)}" placeholder="Name, email, topic or text" />
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <button class="btn btn-primary" type="submit">Search</button>
        </div>
      </form>

      <div class="panel">
        <div class="panel-head">
          <h2>${data.total} message${data.total === 1 ? '' : 's'}</h2>
        </div>
        <div class="table-wrap">
          ${
            data.messages.length
              ? `<table>
                  <thead><tr><th>From</th><th>Topic</th><th>Received</th><th class="actions">Actions</th></tr></thead>
                  <tbody>
                    ${data.messages
                      .map(
                        (m) => `
                        <tr>
                          <td><strong>${esc(m.name)}</strong><span class="sub">${esc(m.email)}</span></td>
                          <td>${esc(m.subject)}<span class="sub">${esc(String(m.message).slice(0, 80))}${String(m.message).length > 80 ? '…' : ''}</span></td>
                          <td class="nowrap">${fmtDate(m.created_at)}</td>
                          <td>
                            <div class="actions">
                              <button class="btn btn-secondary btn-sm" data-message-view="${m.id}">Read</button>
                              <button class="btn btn-danger btn-sm" data-delete-message="${m.id}">Delete</button>
                            </div>
                          </td>
                        </tr>`
                      )
                      .join('')}
                  </tbody>
                </table>`
              : emptyState(
                  q ? 'No matching messages' : 'No messages yet',
                  q ? 'Try a different search term.' : 'Messages from the contact form will appear here.'
                )
          }
        </div>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Job detail modal                                                    */
/* ------------------------------------------------------------------ */

function closeModal() {
  modalEl().innerHTML = '';
}

const INFO_PAGES = {
  contact: {
    title: 'Contact us',
    body: `
      <p>Questions about a listing, your account or hiring? The team reads every message.</p>
      <ul class="contact-list">
        <li><strong>Job seeker support</strong><a href="mailto:support@jobconnect.local">support@jobconnect.local</a></li>
        <li><strong>Employers &amp; hiring</strong><a href="mailto:employers@jobconnect.local">employers@jobconnect.local</a></li>
        <li><strong>Phone</strong><span>+1 (555) 010-2040 · Mon–Fri, 9:00–17:00</span></li>
        <li><strong>Office</strong><span>24 Market Street, Suite 400</span></li>
      </ul>
      <h3>Reporting a listing</h3>
      <p class="small muted">If a role looks misleading, expired or duplicated, email the link and job title to support. Administrators review reports and can close or remove the listing.</p>
      <p class="small muted">We usually reply within one business day. Please include the email address on your account so we can find you faster.</p>`,
  },
  privacy: {
    title: 'Privacy policy',
    body: `
      <p>This policy explains what JobConnect stores and why. It applies to job seekers, employers and administrators.</p>
      <h3>What we collect</h3>
      <ul class="contact-list">
        <li><strong>Account details</strong><span>Your name, email address, password hash and — for employers — your company name.</span></li>
        <li><strong>Activity</strong><span>Jobs you post, applications you send, CVs, cover letters and the status history of each application.</span></li>
      </ul>
      <h3>How we use it</h3>
      <p>Account details are used to sign you in and to show your name to the other side of an application. Application content is visible to the employer who owns the job and to platform administrators for moderation.</p>
      <h3>What we do not do</h3>
      <p>We do not sell your data, run third-party advertising, or share your email with employers you have not applied to.</p>
      <h3>Retention and your choices</h3>
      <p>Data stays while your account is active. You can ask for a copy of your data or for your account to be deleted by emailing <a href="mailto:privacy@jobconnect.local">privacy@jobconnect.local</a>. Deleting your account removes your applications and any jobs you posted.</p>
      <p class="small muted">Last updated: November 2026.</p>`,
  },
};

function openInfoModal(kind) {
  const page = INFO_PAGES[kind];
  if (!page) return;
  modalEl().innerHTML = `
    <div class="modal-backdrop" data-backdrop="1">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="info-modal-title">
        <div class="modal-head">
          <div>
            <h2 id="info-modal-title">${esc(page.title)}</h2>
            <div class="muted small">JobConnect</div>
          </div>
          <button class="modal-close" data-action="close-modal" aria-label="Close">×</button>
        </div>
        <div class="modal-body">${page.body}</div>
      </div>
    </div>`;
}

async function openApplicationModal(applicationId) {
  let application;
  try {
    ({ application } = await api(`/api/applications/${applicationId}`));
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  modalEl().innerHTML = `
    <div class="modal-backdrop" data-backdrop="1">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="application-modal-title">
        <div class="modal-head">
          <div>
            <h2 id="application-modal-title">${esc(application.seeker_name)}</h2>
            <div class="muted small">${esc(application.seeker_email)} · applied ${fmtDate(application.created_at)}</div>
          </div>
          <button class="modal-close" data-action="close-modal" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <dl class="detail-facts">
            <div><dt>Job</dt><dd>${esc(application.job_title)}</dd></div>
            <div><dt>Company</dt><dd>${esc(application.company)}</dd></div>
            <div><dt>Location</dt><dd>${esc(application.location)}</dd></div>
            <div><dt>Status</dt><dd>${badge(application.status)}</dd></div>
          </dl>
          <h3>Cover letter</h3>
          <p class="small muted">${application.cover_letter ? esc(application.cover_letter) : 'No cover letter submitted.'}</p>
          <div class="apply-actions">
            ${
              application.cv_path
                ? `<button class="btn btn-secondary" data-download-cv="${application.id}" data-cv-name="${esc(application.cv_name || 'cv')}">Download CV</button>`
                : '<span class="muted small">No CV attached.</span>'
            }
            <button class="btn btn-secondary" data-set-status="shortlisted" data-application="${application.id}" ${application.status === 'shortlisted' ? 'disabled' : ''}>Shortlist</button>
            <button class="btn btn-primary" data-set-status="selected" data-application="${application.id}" ${application.status === 'selected' ? 'disabled' : ''}>Select</button>
            <button class="btn btn-danger" data-set-status="rejected" data-application="${application.id}" ${application.status === 'rejected' ? 'disabled' : ''}>Reject</button>
          </div>
        </div>
      </div>
    </div>`;
}

async function openMessageModal(messageId) {
  let message;
  try {
    ({ message } = await api(`/api/admin/messages/${messageId}`));
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  modalEl().innerHTML = `
    <div class="modal-backdrop" data-backdrop="1">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="message-modal-title">
        <div class="modal-head">
          <div>
            <h2 id="message-modal-title">${esc(message.subject)}</h2>
            <div class="muted small">${esc(message.name)} · ${esc(message.email)} · ${fmtDate(message.created_at)}</div>
          </div>
          <button class="modal-close" data-action="close-modal" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="message-body">${esc(message.message)}</div>
          <div class="actions" style="margin-top:1rem">
            <a class="btn btn-primary btn-sm" href="mailto:${esc(message.email)}?subject=${encodeURIComponent(`Re: ${message.subject}`)}">Reply by email</a>
            <button class="btn btn-danger btn-sm" data-delete-message="${message.id}">Delete message</button>
          </div>
        </div>
      </div>
    </div>`;
}

function openJobPage(jobId) {
  const id = Number(jobId);
  if (!id) return;
  closeModal();

  if (state.user) {
    if (state.user.role !== 'seeker') {
      toast('Job details are available to job seekers and signed-out visitors.');
      return;
    }
    state.jobId = id;
    state.view = 'job-detail';
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }

  go('job', { jobId: id });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function jobApplyArea(job, hasApplied) {
  const user = state.user;

  if (!user) {
    return `
      <div class="apply-box">
        <h3>Apply for this role</h3>
        <p class="small muted">Create a free job seeker account, or sign in, to apply and track this application.</p>
        <div class="apply-actions">
          <button class="btn btn-primary" data-auth-mode="register-seeker">Create an account</button>
          <button class="btn btn-secondary" data-auth-mode="login">Sign in</button>
        </div>
      </div>`;
  }

  if (user.role !== 'seeker') {
    return `<div class="apply-box"><p class="small muted" style="margin:0">Only job seekers can apply for roles. You are signed in as ${esc(ROLE_LABEL[user.role] || user.role)}.</p></div>`;
  }

  if (hasApplied) {
    return `<div class="apply-box"><div class="alert success" style="margin:0">You have already applied to this job. Track it under <button class="link-btn" data-nav="applications">My applications</button>.</div></div>`;
  }

  return `
    <div class="apply-box">
      <h3>Apply for this job</h3>
      <form data-form="apply" data-job-id="${job.id}">
        <div class="field">
          <label for="apply-cv">CV</label>
          <input id="apply-cv" name="cv" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required />
          <span class="hint">PDF, DOC or DOCX · up to 2 MB.</span>
        </div>
        <div class="field">
          <label for="cover-letter">Cover letter (optional)</label>
          <textarea id="cover-letter" name="cover_letter" placeholder="Tell the employer why you are a great fit…"></textarea>
        </div>
        <div class="form-alert"></div>
        <button class="btn btn-primary btn-block" type="submit">Submit application</button>
      </form>
    </div>`;
}

async function renderJobDetailPage(ticket) {
  const jobId = Number(state.jobId);
  if (!jobId) return go('jobs');

  let payload;
  try {
    payload = await api(`/api/jobs/${jobId}`);
  } catch (err) {
    if (ticket !== renderTicket) return;
    document.title = PUBLIC_PAGES.job;
    appEl().innerHTML = `
      <div class="stack">
        <button class="link-btn back-link" data-route="jobs">← Back to all jobs</button>
        <div class="panel"><div class="panel-body">
          ${emptyState('This job is no longer available', err.message)}
        </div></div>
      </div>`;
    return;
  }

  if (ticket !== renderTicket) return;
  const { job, hasApplied } = payload;
  document.title = `${job.title} at ${job.company} — JobConnect`;

  appEl().innerHTML = `
    <div class="stack">
      <button class="link-btn back-link" data-route="jobs">← Back to all jobs</button>

      <section class="job-detail">
        <article class="panel">
          <div class="panel-body">
            <div class="job-detail-head">
              ${companyMark(job.company, 'lg')}
              <div>
                <h1>${esc(job.title)}</h1>
                <p class="muted" style="margin:0">${esc(job.company)} · 📍 ${esc(job.location)}</p>
              </div>
            </div>

            <div class="job-meta">
              <span class="tag blue">${esc(job.type)}</span>
              <span class="tag">${esc(job.category)}</span>
              <span class="tag">${job.salary ? esc(job.salary) : 'Salary not disclosed'}</span>
              <span class="tag">Posted ${fmtDate(job.created_at)}</span>
            </div>

            <h2>About the role</h2>
            <div class="description">${esc(job.description)}</div>

            <h2>Requirements</h2>
            <div class="description">${esc(job.requirements || 'Requirements will be shared by the employer.')}</div>

            <h2>Posted by</h2>
            <p class="small muted" style="margin:0">${esc(job.employer_name)} · ${esc(job.employer_email)}</p>
          </div>
        </article>

        <aside class="job-detail-side">
          <div class="panel">
            <div class="panel-body">
              <h3>Role summary</h3>
              <dl class="detail-facts">
                <div><dt>Salary</dt><dd>${job.salary ? esc(job.salary) : 'Not disclosed'}</dd></div>
                <div><dt>Job type</dt><dd>${esc(job.type)}</dd></div>
                <div><dt>Category</dt><dd>${esc(job.category)}</dd></div>
                <div><dt>Location</dt><dd>${esc(job.location)}</dd></div>
              </dl>
              ${jobApplyArea(job, hasApplied)}
            </div>
          </div>
        </aside>
      </section>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Event handling                                                      */
/* ------------------------------------------------------------------ */

document.addEventListener('click', async (event) => {
  const target = event.target;

  // Close modal when the backdrop itself (not the dialog) is clicked.
  if (target.classList?.contains('modal-backdrop')) {
    closeModal();
    return;
  }

  const el = target.closest('[data-nav], [data-route], [data-action], [data-demo], [data-auth-mode], [data-job], [data-toggle-job], [data-delete-job], [data-job-applicants], [data-set-status], [data-view-application], [data-download-cv], [data-toggle-user], [data-delete-user], [data-admin-toggle-job], [data-admin-moderate], [data-admin-delete-job], [data-message-view], [data-delete-message], [data-search-q], [data-category-filter], [data-info]');
  if (!el) return;

  if (el.tagName === 'A') event.preventDefault();

  if (el.dataset.route) return go(el.dataset.route);

  if (el.dataset.nav) return setView(el.dataset.nav);

  if (el.dataset.info) {
    openInfoModal(el.dataset.info);
    return;
  }

  if (el.dataset.authMode) {
    state.authMode = el.dataset.authMode;
    state.authError = '';
    const targetPage = state.authMode === 'login' ? 'login' : 'register';
    if (!state.user) {
      state.page = targetPage;
      state.jobId = null;
      replaceHash(targetPage);
    }
    await render();
    if (!state.user) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      document.querySelector('#auth-card input:not([type="hidden"])')?.focus({ preventScroll: true });
    }
    return;
  }

  if (el.dataset.demo) {
    const accounts = {
      seeker: ['seeker@jobconnect.local', 'Seeker123!'],
      employer: ['employer@jobconnect.local', 'Employer123!'],
      admin: ['admin@jobconnect.local', 'Admin123!'],
    };
    const [email, password] = accounts[el.dataset.demo];
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      setSession(data.token, data.user);
      state.authError = '';
      render();
      toast(`Signed in as ${data.user.name}`);
    } catch (err) {
      state.authError = err.message;
      render();
    }
    return;
  }

  const action = el.dataset.action;
  if (action === 'logout') {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* session may already be gone */
    }
    clearSession();
    state.view = 'home';
    state.authMode = 'login';
    state.page = 'home';
    state.jobId = null;
    replaceHash('home');
    render();
    return;
  }
  if (action === 'close-modal') {
    closeModal();
    return;
  }
  if (action === 'go-home-auth') {
    closeModal();
    if (state.user) return setView('home');
    state.page = 'login';
    replaceHash('login');
    await render();
    return;
  }
  if (action === 'home') {
    if (!state.user) return go('home');
    state.view = defaultView(state.user.role);
    closeModal();
    render();
    return;
  }

  if ('searchQ' in el.dataset) {
    state.jobSearch = { ...state.jobSearch, q: el.dataset.searchQ, location: '' };
    return go('jobs');
  }

  if ('categoryFilter' in el.dataset) {
    state.jobSearch = { ...state.jobSearch, category: el.dataset.categoryFilter };
    return go('jobs');
  }

  if (action === 'clear-search') {
    state.jobSearch = { q: '', location: '', type: '', category: '' };
    return go('jobs');
  }

  if (el.dataset.job) return openJobPage(el.dataset.job);

  if (el.dataset.jobApplicants) {
    state.employerJobFilter = Number(el.dataset.jobApplicants);
    state.view = 'employer-applications';
    closeModal();
    return render();
  }

  if (action === 'clear-job-filter') {
    state.employerJobFilter = null;
    return render();
  }

  if (el.dataset.toggleJob) {
    const status = el.dataset.status === 'open' ? 'closed' : 'open';
    try {
      await api(`/api/jobs/${el.dataset.toggleJob}/status`, { method: 'PATCH', body: { status } });
      toast(`Job ${status === 'open' ? 'reopened' : 'closed'}.`);
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  if (el.dataset.deleteJob) {
    if (!confirm('Delete this job and all of its applications? This cannot be undone.')) return;
    try {
      await api(`/api/jobs/${el.dataset.deleteJob}`, { method: 'DELETE' });
      toast('Job deleted.');
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  if (el.dataset.viewApplication) {
    await openApplicationModal(el.dataset.viewApplication);
    return;
  }

  if (el.dataset.downloadCv) {
    try {
      await downloadCv(el.dataset.downloadCv, el.dataset.cvName);
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  if (el.dataset.setStatus) {
    try {
      await api(`/api/applications/${el.dataset.application}`, {
        method: 'PATCH',
        body: { status: el.dataset.setStatus },
      });
      toast(`Application marked as ${STATUS_LABEL[el.dataset.setStatus] || el.dataset.setStatus}.`);
      closeModal();
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  if (el.dataset.toggleUser) {
    const suspended = el.dataset.suspended === '1';
    if (!suspended && !confirm('Suspend this account? The user will be signed out and blocked from signing in.')) return;
    try {
      await api(`/api/admin/users/${el.dataset.toggleUser}`, {
        method: 'PATCH',
        body: { suspended: !suspended },
      });
      toast(suspended ? 'Account reactivated.' : 'Account suspended.');
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  if (el.dataset.deleteUser) {
    if (!confirm('Delete this user and everything they posted? This cannot be undone.')) return;
    try {
      await api(`/api/admin/users/${el.dataset.deleteUser}`, { method: 'DELETE' });
      toast('User deleted.');
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  if (el.dataset.adminModerate) {
    const moderation = el.dataset.adminModerate;
    if (moderation === 'rejected' && !confirm('Reject this vacancy? It will stay hidden from job seekers.')) return;
    try {
      await api(`/api/admin/jobs/${el.dataset.jobId}`, { method: 'PATCH', body: { moderation } });
      toast(moderation === 'approved' ? 'Job approved and live.' : 'Job rejected.');
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  if (el.dataset.adminToggleJob) {
    const status = el.dataset.status === 'open' ? 'closed' : 'open';
    try {
      await api(`/api/admin/jobs/${el.dataset.adminToggleJob}`, { method: 'PATCH', body: { status } });
      toast(`Job ${status === 'open' ? 'reopened' : 'closed'}.`);
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  if (el.dataset.adminDeleteJob) {
    if (!confirm('Delete this job listing? This cannot be undone.')) return;
    try {
      await api(`/api/admin/jobs/${el.dataset.adminDeleteJob}`, { method: 'DELETE' });
      toast('Job deleted.');
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  if (el.dataset.messageView) {
    await openMessageModal(el.dataset.messageView);
    return;
  }

  if (el.dataset.deleteMessage) {
    if (!confirm('Delete this contact message? This cannot be undone.')) return;
    try {
      await api(`/api/admin/messages/${el.dataset.deleteMessage}`, { method: 'DELETE' });
      closeModal();
      toast('Message deleted.');
      if (state.view === 'admin-messages') render();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();

  const kind = form.dataset.form;
  const values = Object.fromEntries(new FormData(form).entries());

  try {
    if (kind === 'auth-login') {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: { email: values.email, password: values.password },
      });
      setSession(data.token, data.user);
      state.authError = '';
      render();
      toast(`Welcome back, ${data.user.name.split(' ')[0]}!`);
      return;
    }

    if (kind === 'auth-register') {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: {
          name: values.name,
          email: values.email,
          password: values.password,
          role: values.role,
          company: values.company || '',
        },
      });
      setSession(data.token, data.user);
      state.authError = '';
      render();
      toast('Account created. Welcome to JobConnect!');
      return;
    }

    if (kind === 'hero-search') {
      state.jobSearch = {
        ...state.jobSearch,
        q: String(values.q || '').trim(),
        location: String(values.location || '').trim(),
      };
      go('jobs');
      return;
    }

    if (kind === 'job-search') {
      state.jobSearch = {
        ...state.jobSearch,
        q: String(values.q || '').trim(),
        location: String(values.location || '').trim(),
        type: values.type || '',
        category: values.category || '',
      };
      go('jobs');
      return;
    }

    if (kind === 'user-search') {
      state.userFilter = { q: String(values.q || '').trim(), role: values.role || '' };
      return render();
    }

    if (kind === 'message-search') {
      state.messageFilter = { q: String(values.q || '').trim() };
      return render();
    }

    if (kind === 'post-job') {
      await api('/api/jobs', {
        method: 'POST',
        body: {
          title: values.title,
          location: values.location,
          type: values.type,
          category: values.category || 'General',
          salary: values.salary,
          description: values.description,
          requirements: values.requirements,
        },
      });
      state.view = 'employer-overview';
      render();
      toast('Job submitted. An administrator will review it shortly.');
      return;
    }

    if (kind === 'apply') {
      const jobId = form.dataset.jobId;
      const alertSlot = form.querySelector('.form-alert');
      const button = form.querySelector('button[type="submit"]');
      const file = form.querySelector('input[type="file"]')?.files?.[0];
      if (!file) {
        if (alertSlot) alertSlot.innerHTML = alertBox('Please attach your CV before submitting.');
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        if (alertSlot) alertSlot.innerHTML = alertBox('Your CV must be 2 MB or smaller.');
        return;
      }
      button.disabled = true;
      button.textContent = 'Submitting…';
      try {
        const cv = {
          name: file.name,
          type: file.type,
          data: await readFileAsBase64(file),
        };
        await api('/api/applications', {
          method: 'POST',
          body: { job_id: Number(jobId), cover_letter: values.cover_letter || '', cv },
        });
        await render();
        toast('Application submitted. Good luck!');
      } catch (err) {
        if (alertSlot) alertSlot.innerHTML = alertBox(err.message);
        button.disabled = false;
        button.textContent = 'Submit application';
      }
    }

    if (kind === 'contact') {
      const alertSlot = form.querySelector('.form-alert');
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Sending…';
      try {
        await api('/api/contact', {
          method: 'POST',
          body: {
            name: values.name,
            email: values.email,
            subject: values.subject,
            message: values.message,
          },
        });
        form.reset();
        if (alertSlot) {
          alertSlot.innerHTML = alertBox(
            'Thanks — your message is with the team. We reply within one business day.',
            'success'
          );
        }
        toast('Message sent.');
      } finally {
        button.disabled = false;
        button.textContent = 'Send message';
      }
    }
  } catch (err) {
    if (kind === 'auth-login' || kind === 'auth-register') {
      state.authError = err.message;
      render();
    } else if (kind === 'post-job') {
      toast(err.message, 'error');
    } else {
      toast(err.message, 'error');
    }
  }
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  const { page, jobId } = parseHash();
  state.page = page;
  state.jobId = jobId;
  if (state.token) {
    try {
      const data = await api('/api/auth/me');
      state.user = data.user;
      state.view = defaultView(data.user.role);
    } catch {
      clearSession();
    }
  }
  render();
}

boot();
