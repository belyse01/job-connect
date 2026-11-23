# JobConnect

JobConnect is a full-stack job marketplace that connects **job seekers** with **employers**, with an
**administrator** keeping the platform in order. It ships as a small, dependency-light app you can run
locally in one command.

## Roles

| Role | What they can do |
| --- | --- |
| **Job seeker** (`seeker`) | Register, search and filter approved jobs, read job details, apply with a CV and cover letter, track application status. |
| **Employer** (`employer`) | Register a company, submit vacancies with salary, location and requirements, close/delete listings, review candidates and CVs, mark applications as shortlisted, selected or rejected. |
| **Administrator** (`admin`) | Review submitted vacancies and approve or reject them, platform stats, search and filter users, suspend/reactivate or delete accounts, close or remove listings. |

## How a hire flows

1. A company registers an employer account under its company name.
2. The company posts a vacancy with title, salary, location, description and requirements.
3. An administrator reviews the vacancy and approves or rejects it. Job seekers only see approved listings.
4. A job seeker searches approved vacancies and reads the details.
5. The seeker applies with a CV (PDF, DOC or DOCX up to 2 MB) and an optional cover letter.
6. The company reviews each application, including the CV and cover letter.
7. The company decides: **shortlisted**, **selected** or **rejected**. The seeker sees the status in *My applications*.

## Tech stack

- **Backend:** Node.js + Express 5, with the built-in `node:sqlite` database (no native modules).
- **Frontend:** Plain HTML, CSS and JavaScript served by the same Express server (no build step).
- **Auth:** scrypt password hashing, random bearer tokens stored in a `sessions` table.
- **Data:** SQLite file at `backend/data/jobconnect.db`, created and seeded automatically on first run.

> `node:sqlite` requires Node.js **22.5+** (tested on Node 24).

## Run it

```bash
npm run setup      # installs the backend dependencies
npm start          # http://localhost:4000
```

These run from the project root and forward to the `backend/` package. Open
<http://localhost:4000> in your browser. The API and the client are served from the same origin.

To develop with auto-reload: `npm run dev` (uses `node --watch`).

To start over with fresh demo data, stop the server and delete `backend/data/`. It is re-seeded the next
time the server starts.

## Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Job seeker | `seeker@jobconnect.local` | `Seeker123!` |
| Employer | `employer@jobconnect.local` | `Employer123!` |
| Administrator | `admin@jobconnect.local` | `Admin123!` |

The seed also creates three approved vacancies and one pending vacancy at *Northwind Labs*, plus one
application, so every dashboard has something to show — including the administrator's approval queue.
The login screen has one-click buttons for each demo account.

## Project structure

```
backend/
  src/
    server.js          Express app, static hosting, error handling
    db.js              SQLite schema + first-run seed
    security.js        Password hashing and token creation
    auth.js            Session lookup and role middleware
    routes/
      auth.js          Register, login, logout, current user
      jobs.js          Public job search, employer job CRUD, per-job applications
      applications.js  Apply, my applications, review decisions
      employer.js      Employer overview and application inbox
      admin.js         Stats, user management, job moderation
  data/                SQLite database (git-ignored, auto-created)
frontend/               Browser client (served at /)
  index.html
  styles.css
  app.js
```

## API overview

All write endpoints expect JSON. Authenticated requests use `Authorization: Bearer <token>`.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/stats` | public | Public counters shown on the home page (open jobs, companies, seekers, applications) |
| `POST` | `/api/auth/register` | public | Create a seeker or employer account |
| `POST` | `/api/auth/login` | public | Sign in, returns token + user |
| `POST` | `/api/auth/logout` | signed in | Revoke the current session |
| `GET` | `/api/auth/me` | signed in | Current user |
| `GET` | `/api/jobs` | public | Approved, open jobs; filters `q`, `location`, `type`, `category` |
| `GET` | `/api/jobs/:id` | public | Job detail (+ `hasApplied` for seekers; pending/rejected visible to owner and admin) |
| `POST` | `/api/jobs` | employer | Submit a vacancy for administrator review |
| `PATCH` | `/api/jobs/:id` | owner/admin | Edit a vacancy (employer edits return to review) |
| `PATCH` | `/api/jobs/:id/status` | owner/admin | Open or close an approved vacancy |
| `DELETE` | `/api/jobs/:id` | owner/admin | Delete a vacancy |
| `GET` | `/api/jobs/:id/applications` | owner/admin | Applicants for one job |
| `POST` | `/api/applications` | seeker | Apply with a CV (`{ name, type, data }`, base64) and cover letter |
| `GET` | `/api/applications` | seeker | My applications |
| `GET` | `/api/applications/:id` | candidate/owner/admin | Full application detail |
| `GET` | `/api/applications/:id/cv` | candidate/owner/admin | Download the submitted CV |
| `PATCH` | `/api/applications/:id` | owner employer/admin | Set status: `pending`, `shortlisted`, `selected`, `rejected` |
| `GET` | `/api/employer/overview` | employer | Dashboard stats and job posts |
| `GET` | `/api/employer/applications` | employer | All applications to my jobs |
| `GET` | `/api/admin/stats` | admin | Platform counters and recent activity |
| `GET` | `/api/admin/users` | admin | Users; filters `role`, `q` |
| `PATCH` | `/api/admin/users/:id` | admin | Suspend/reactivate a user |
| `DELETE` | `/api/admin/users/:id` | admin | Delete a user and their data |
| `GET` | `/api/admin/jobs` | admin | All listings, including pending and rejected |
| `PATCH` | `/api/admin/jobs/:id` | admin | Approve/reject (`{ moderation }`) or open/close (`{ status }`) a listing |
| `DELETE` | `/api/admin/jobs/:id` | admin | Remove a listing |

## Notes and limitations

- Sessions expire after 7 days; suspending a user revokes their sessions immediately.
- Uploaded CVs are stored in `backend/data/uploads/` and are only served to the candidate, the job's
  employer and administrators. Removing `backend/data/` clears both the database and uploaded files.
- The demo seed uses a fixed administrator account. A production build would add admin invitations,
  company verification, email verification, password reset and pagination for large tables.
- The frontend is intentionally framework-free so the whole app runs without a build tool.
