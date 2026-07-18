<!-- refreshed: 2026-07-18 -->
# Architecture

**Analysis Date:** 2026-07-18

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    Browser Frontend Layer                    │
│                  (Multi-role Web Application)                │
├──────────────────┬──────────────────┬───────────────────────┤
│  Role Portals    │   Admin Console  │   Slide Viewers       │
│  (dashboard,     │  (admin.html,    │  (playbook overlay,   │
│   employee,      │   admin-cms.js)  │   html-slide modal)   │
│   pmo, etc.)     │                  │                       │
└────────┬─────────┴────────┬─────────┴──────────┬────────────┘
         │                  │                     │
         ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│               Shared Frontend Layer                          │
│      (transitions.js, banners.js, i18n, page-layout)       │
│  `public/js/transitions.js`, `public/js/banners.js`        │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Express.js Backend                          │
│                    `server.js`                               │
│  ┌──────────────┬──────────────┬──────────────────────┐    │
│  │ REST API     │ File I/O     │ Auth Gate & Security │    │
│  │ (/api/*)     │ (db.json)    │ (ADMIN_TOKEN)        │    │
│  └──────────────┴──────────────┴──────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
         │                  │
         │                  ▼
         │          ┌─────────────────┐
         │          │  File Database  │
         │          │  `db.json`      │
         │          │ (in-memory      │
         │          │  cache + disk)  │
         │          └─────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│            Backend Services & Integrations                   │
│  ┌──────────────┬──────────────┬──────────────────────┐    │
│  │ RAG Service  │ AI Service   │ PDF Parse            │    │
│  │ (ragService) │ (Gemini API) │ (admin uploads)      │    │
│  └──────────────┴──────────────┴──────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| **Express Server** | Route requests, auth gate, REST endpoints, static file serving | `server.js` |
| **Frontend Router** | Role-based page access, navigation, SPA transitions | `public/js/transitions.js` |
| **Dashboard** | Integration Leader portal: KPIs, 100-day roadmap, coaching desk | `public/js/dashboard.js`, `public/dashboard.html` |
| **Employee Portal** | Acquired employee onboarding, academy progress, gamification | `public/js/employee.js`, `public/employee.html` |
| **PMO Console** | Project steering, timeline gates, blocker management | `public/js/pmo.js`, `public/pmo.html` |
| **Admin Console** | CMS management, settings, user data, project/department CRUD | `public/js/admin.js`, `public/js/admin-cms.js`, `public/admin.html` |
| **Database Layer** | In-memory cache + atomic file writes, project/CMS isolation | `server.js` (readDb/writeDb) |
| **RAG Service** | Playbook indexing and retrieval for guardrails | `ragService.js` |
| **AI Service** | Gemini API integration + local fallback plan generator | `aiService.js` |
| **Security Layer** | Constant-time token comparison, CSP headers, admin auth gate | `server.js` (lines 18-113) |

## Pattern Overview

**Overall:** Hybrid MPA/SPA with role-based access, file-driven database, and backend AI integration.

**Key Characteristics:**
- **Multi-role Portal**: Different HTML pages per role (admin, pmo, dashboard, employee, etc.) served from Express static
- **Client-Side Routing & Transitions**: Page navigation intercepted by transitions.js for SPA-like slide transitions + tab switching within pages
- **File-Based State**: JSON database at `db.json` with in-memory cache keyed on mtime; atomic writes via temp + rename
- **Project Isolation**: Each M&A project owns its own workspace bundle (employees, assessments, comms) + CMS content (courses, pages, menus)
- **Per-Page CMS**: Sidebar/menu/banner configuration managed per project; fetched at page load via `/api/menus`, `/api/banners`, `/api/pages`
- **Admin Token Gating**: Optional `ADMIN_TOKEN` env var guards all POST/PUT/DELETE + /api/admin/* routes; constant-time comparison prevents timing attacks
- **Responsive Glassmorphism UI**: Single `public/css/style.css` + inline styles; supports desktop + mobile via flexbox/grid + CSS variables
- **i18n via CMS**: Translations stored in `db.json.i18n.strings[lang][key]`; DOM elements with `data-i18n="key"` hydrated by app-global script

## Layers

**Presentation Layer:**
- Purpose: Role-based HTML pages + SPA-like transitions
- Location: `public/*.html`, `public/js/*.js`, `public/css/style.css`
- Contains: DOM templates, event listeners, fetch calls to /api
- Depends on: REST API via `/api/...`
- Used by: Browsers (admin, pmo, hrbp, supporting, employee roles)

**Navigation & Access Control Layer:**
- Purpose: Role-based page redirection, access guard, SPA transitions
- Location: `public/js/transitions.js` (lines 112–149 access control)
- Contains: Active role tracking, page-access map, logout/redirect on 403
- Depends on: localStorage (active_demo_role), sessionStorage (access_denied_message)
- Used by: All frontend pages

**API & Business Logic Layer:**
- Purpose: REST endpoints for projects, departments, processes, CMS, i18n, settings
- Location: `server.js` (lines 262–1400+)
- Contains: CRUD endpoints, temporal simulation (time-travel), project/CMS isolation logic
- Depends on: File database (db.json), optional Gemini API key
- Used by: Frontend via fetch(/api/...)

**Data Persistence Layer:**
- Purpose: Atomic read/write of JSON state, mtime-based cache invalidation
- Location: `server.js` (readDb lines 127–210, writeDb lines 212–238)
- Contains: JSON parsing, backup creation, collision-safe ID generation
- Depends on: fs module, db.json file
- Used by: All API endpoints

**Service Layer (Optional):**
- Purpose: AI plan generation, PDF RAG indexing
- Location: `aiService.js`, `ragService.js`
- Contains: Gemini API calls, local fallback plan template, playbook text extraction
- Depends on: Gemini API key (optional), playbook.html content
- Used by: Dashboard (AI plan tab), Admin (RAG PDF upload)

## Data Flow

### Primary Request Path: Dashboard Load → KPI Display

1. Browser navigates to `/dashboard.html` (`public/dashboard.html`)
2. HTML loaded, transitions.js runs access control (line 112–149), role localStorage checked
3. `dashboard.js` DOMContentLoaded (lines ~100+) fires:
   - `fetch('/api/settings')` → server reads `db.json`, returns `publicSettings()` (excludes API key)
   - `fetch('/api/questions')` → returns survey questions grouped by dimension (culture/talent/value)
   - `fetch('/api/projects')` → lists all projects, active project ID
   - `fetch('/api/departments')` → returns functional integration tracks
   - `fetch('/api/lessons')` → all course lessons for employee progress tracking
4. Dashboard renders 7 tabs (KPIs, Roadmap, Onboarding, Welcome Kit, Culture, Coaching, Transformation)
5. On tab click → `fetch('/api/pages?slug=...')` for CMS-authored content, or in-memory UI render

### Secondary Flow: Admin Settings Update

1. Admin.html loads, `admin.js` fetches `/api/settings`
2. Admin edits form (targetCompany, sector, time-travel day, etc.)
3. Form POST to `/api/settings` with X-Admin-Token header (transitions.js bridge, line 15–17)
4. Server checks ADMIN_TOKEN via constant-time compare (line 97–101)
5. If valid, writes to db.json via atomic writeDb (temp file + rename)
6. All clients polling /api/* endpoints see updated data on next fetch

### Project Switching Flow

1. Admin creates new project via `/api/projects` POST with intake form
2. Server generates time-sortable project ID (prefix_<timestamp>_<random>), creates fresh workspace
3. Server calls `stashActiveCustomProject()` (save current to old project), `applyCmsToTopLevel()` (swap in new CMS)
4. Front-end observes activeProjectId change, re-fetches `/api/settings`, dashboard re-renders with new company name
5. All per-project data (employees, assessments, menus, departments, processes) swapped atomically in memory + persisted

### Playbook Slide Viewer Modal

1. User clicks element with `data-playbook-slide="N"` attribute
2. transitions.js listener (line 68–70) captures click, calls `openPlaybookSlide(N)`
3. Modal overlay (`.playbook-modal-overlay`) created in-DOM with iframe src=`/playbook/hr-ma-guidebook.pdf#page=N`
4. Escape key or close button removes overlay

## Key Abstractions

**Project Abstraction:**
- Purpose: Isolate each M&A deal's workspace (employees, assessments, communications) + CMS content
- Examples: `db.projects[]`, `/api/projects`, `/api/projects/:id/activate`
- Pattern: Each project holds `data {}` (workspace) + `cms {}` (content); active project's data loaded into live custom lane; CMS swapped into top-level when activated

**Role-Based Access:**
- Purpose: Control page visibility + data filtering per user role
- Examples: `pageAccess` map in transitions.js (line 127–135), sidebar menu built per role in dashboard.js
- Pattern: localStorage `active_demo_role` checked on page load; if not in pageAccess, redirect to /

**Temporal Simulation (Time-Travel):**
- Purpose: Demo mode showing Day 1, 30, 60, 90, 100+ snapshots of employee progress, pulses, scores
- Examples: `/api/settings/time-travel` POST, `scaleEmployeesForDay()`, `getPulsesForDay()` in server.js
- Pattern: `db.settings.timeTravelDay` stored; when fetching employees/pulses/scores, scaled helpers apply day-specific transformations

**CMS Bundle Snapshotting:**
- Purpose: Each project owns independent courses, pages, menus, departments, processes, slides
- Examples: `snapshotCms()` (line 670–680), `stashActiveProjectCms()` (line 693–695), `applyCmsToTopLevel()` (line 682–691)
- Pattern: Before project switch, save live CMS to `activeProject.cms`; when activating new project, copy its CMS into top-level db

**i18n String Lookup:**
- Purpose: Multi-language UI without client-side template engines
- Examples: `db.i18n.strings[lang][key]`, DOM `data-i18n="key"` hydrated by global i18n bootstrap script
- Pattern: Admin updates `/api/i18n` (POST with lang + key + value), client polls on load, fills all `[data-i18n]` nodes

## Entry Points

**Server Entry:**
- Location: `server.js` line 11–12
- Triggers: `npm start` → `node server.js`
- Responsibilities: Express app init, PORT/PUBLIC_BASE_URL from env, middleware stack (compression, CSP headers, JSON body parsing, static files)

**Frontend Landing:**
- Location: `/` → `public/overview.html` (server.js line 62–65)
- Triggers: Browser navigates to /
- Responsibilities: Hero section with "Enter Portal" CTA linking to `/index.html` (role-selector grid)

**Role Portal Entry:**
- Location: `/index.html` → role grid, click role card
- Triggers: Click `.demo-role-card` (index.html line 52–84)
- Responsibilities: Set `localStorage.active_demo_role`, navigate to role-specific page (e.g., `/dashboard.html` for hrbp)

**Role-Specific Page Init:**
- Location: Each `public/{role}.html` (e.g., `public/dashboard.html`)
- Triggers: Browser loads page after role selection
- Responsibilities: transitions.js runs access control; page-specific JS (e.g., dashboard.js) DOMContentLoaded fetches API data

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop; all database operations serialized (no write concurrency)
- **Global state:** Module-level singletons in server.js: `_dbCache`, `_dbMtime` (read cache); `ADMIN_TOKEN` (env var). Frontend: `localStorage` (active_demo_role, admin_token), `sessionStorage` (per-session flags)
- **Circular imports:** None detected; backend has no module-to-module requires except ragService/aiService at server top-level
- **ID Collision:** Addressed by `newId(prefix)` (line 243–244): combines `Date.now().toString(36)` (sortable timestamp) + 4 random hex bytes. Two creates in same millisecond used to collide; now collision probability << 1e-6
- **Cache Invalidation:** File mtime-based; readDb() checks `fs.statSync(DB_FILE).mtimeMs` and re-parses only if changed (line 132–133)
- **Request Timeouts:** Gemini API calls wrapped in AbortSignal.timeout(15000) (aiService.js line 59); PDF parse limited to 50mb (server.js line 55)
- **Graceful Degradation:** Gemini API failure falls back to local template-based plan generator (aiService.js line 91); RAG search failure returns empty snippets array (ragService.js line ~200)

## Anti-Patterns

### Hardcoded Demo IDs in Seed Data

**What happens:** Seeded projects/departments hardcoded in readDb() (e.g., 'proj_demo', 'dept_sales'); if demo workflow differs, must edit server code to update seed.

**Why it's wrong:** Makes it hard to reset or customize the demo without code changes; makes per-project data isolation less obvious to new contributors.

**Do this instead:** Move seed data to a separate `public/seed.json`; import at server startup in readDb(). Add admin endpoint to reset to seed state via POST `/api/admin/reset-seed` (behind ADMIN_TOKEN).

### Session/User Identity Missing

**What happens:** No login/authentication; role determined solely by localStorage `active_demo_role` user can self-set (line 115–124 transitions.js). Anyone can impersonate any role.

**Why it's wrong:** In production, a single-user demo this is fine; in multi-user, any user can see/modify any other user's project data by changing localStorage.

**Do this instead:** Implement server-side session management (e.g., express-session + MemoryStore for demo, or real auth for prod). Store `userId` + `role` in server session; POST `/api/login` with credentials; return session ID as HttpOnly cookie. Guard `/api/projects` endpoints to filter to current user's projects only.

### Per-Page State Duplication in CSS/JS

**What happens:** Tab content often lives inline in dashboard.html as hidden divs (e.g., `#tab-roadmap`, `#tab-onboarding`), each with its own JS event listeners. On tab switch, show/hide + re-fetch data for that tab.

**Why it's wrong:** Large pages (dashboard.js is 2337 lines) become hard to navigate; refactoring one tab risks breaking another; responsive CSS media queries apply to all tabs even if hidden.

**Do this instead:** Split each dashboard tab into a separate module (e.g., `js/dashboard-tabs/kpi-tab.js`, `js/dashboard-tabs/roadmap-tab.js`). Each exports a render(state) function + event map. Dashboard.js imports all tabs, renders active one, manages fetch/re-render on tab switch.

## Error Handling

**Strategy:** Backend throws on fatal I/O errors (e.g., db.json parse failure); returns HTTP error codes with JSON error messages. Frontend logs to console; shows user-facing toast or error banner (banners.js line ~50+).

**Patterns:**
- readDb() parse failure: Throws if db.json exists but is unreadable, preventing silent wipe (line 202–206)
- writeDb() failure: Throws "Failed to persist database" so Express returns 500 instead of falsely claiming success (line 236)
- Gemini API timeout: Caught, logged, falls back to local plan generator (aiService.js line 88–92)
- File upload errors: Try/catch in /api/slides/upload and /api/media POST; returns 400 or 500 with error text (server.js line 901–909, 1144–1148)
- Frontend 401 on write: Admin token prompt fires (transitions.js line 26–31); user retries with token

## Cross-Cutting Concerns

**Logging:** console.log/error in server.js for startup, API events, DB ops (see lines 93, 305, 321, 330). No structured logging library; output to stdout for container/platform capture.

**Validation:** Minimal; server-side only on POST bodies (e.g., "name required" checks, line 718, 791). No client-side validation library; HTML5 required/pattern attributes used sparingly.

**Authentication:** Optional X-Admin-Token header via constant-time compare (line 97–101). Env var `ADMIN_TOKEN` controls gate; unset = open (dev/demo). Transitions.js stores token in localStorage, adds header to same-origin /api requests (line 14–24).

**Authorization:** Page-level only (roleAccess map in transitions.js line 127–135). No per-resource authorization; if user passes role gate, can read all data for that role. Future: add `data.roleScope` checks in backend (planned but not implemented).

**Localization:** i18n strings stored in `db.json.i18n.strings[lang]` as flat key-value (e.g., `{ "en": { "landing.title": "Post-Merger Integration Portal" } }`). Client polls `/api/i18n` on load; JavaScript loop fills all DOM elements with `[data-i18n="key"]`. Fallback to key name if translation missing.

---

*Architecture analysis: 2026-07-18*
