<!-- GSD:project-start source:PROJECT.md -->

## Project

**M&A Integration Portal — Real-Deal Milestone**

A TE Connectivity M&A integration portal that today demonstrates post-merger integration capability, being turned into a tool TE actually runs live acquisitions on. The primary operator is the Integration Lead / IMO, who manages a deal from due diligence through the first 100 days; workstream leads join once it moves to a shared host. The existing demonstration showcase is kept intact as a separate, cleanly-separated mode.

**Core Value:** An Integration Lead can run one real TE acquisition end-to-end in this app — from due diligence through 100 days — without keeping a parallel spreadsheet.

### Constraints

- **Security**: Real acquisition data is MNPI (material non-public information) — target names pre-announcement, valuations, retention lists, named org designs. Mandatory auth, audit trail and clean-room segregation are legal and compliance controls, not features. This is what makes foundation-first non-negotiable.
- **Tech stack**: Vanilla JS, no framework, no build step, Express backend. Established across ~23,400 lines of frontend; introducing a framework or bundler is a separate decision, not a side effect of this milestone.
- **Deployment**: Runs laptop-local today via the zero-install bundle, moving to a shared internal host soon. This is why SQLite (single file, ACID, no server infrastructure) fits, and why the data layer must be concurrency-safe from day one rather than retrofitted.
- **Compatibility**: The demonstration showcase must survive intact — demo mode is a maintained deliverable, not legacy. Both modes ship from one codebase.
- **Dependencies**: No TE IT dependency this milestone — no SSO, no HRIS integration. The app must remain independently runnable.
- **Timeline**: No fixed date. Quality over speed; foundation-first sequencing is comfortable.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- JavaScript (Node.js) - Server backend and shared utilities
- HTML5/CSS3 - Frontend pages and UI templates (`public/*.html`)
- JavaScript (Client-side) - Frontend interactivity and page logic (`public/js/*.js`)
- JSON - Data storage and configuration (`db.json`, CMS bundles)

## Runtime

- Node.js >=20 (minimum requirement per `package.json`; currently v22.18.0 in use)
- Cross-platform: Windows (win32-x64-msvc), macOS (darwin-x64, darwin-arm64), Linux (linux-x64-gnu, linux-arm64-gnu)
- npm (v10.9.3)
- Lockfile: `package-lock.json` present
- **Dependencies committed:** `node_modules/` is intentionally committed (not ignored) to enable zero-install: `node server.js` runs with no `npm install`

## Frameworks

- Express.js 4.19.2 - Web server and REST API framework (`server.js`)
- Vanilla JavaScript - No framework; direct DOM manipulation and custom page modules
- HTML templating - Static `.html` files served from `public/`
- Not detected - No test runner configuration (jest, vitest, playwright, etc.)
- No build tool - Static asset serving via Express `express.static()` with cache headers
- Development: `npm run dev` opens browser + starts `node server.js`
- Production: `npm run start` runs `node server.js`

## Key Dependencies

- `express` 4.19.2 - HTTP server, routing, static middleware
- `compression` 1.8.1 - gzip compression middleware for response optimization
- `pdf-parse` 2.4.5 - PDF text extraction for RAG training uploads
- `@napi-rs/canvas` v0.1.80 (multi-platform binaries: win32-x64-msvc, darwin-x64, darwin-arm64, linux-x64-gnu, linux-arm64-gnu) - Canvas rendering for PDF export features (admin only)
- Transformers.js - Locally vendored at `public/vendor/transformers/` (transformers.min.js + 4 ONNX WASM files; repointed from CDN to `/vendor/transformers/transformers.min.js` in `public/js/dashboard.js` and `public/js/transitions.js`)

## Configuration

- `PORT` - Server port (default: 3000)
- `PUBLIC_BASE_URL` - Public base URL for links (default: `http://localhost:${PORT}`)
- `ADMIN_TOKEN` - Shared secret for state-changing API endpoints (POST/PUT/DELETE) and `/api/admin/*` routes. When unset (dev/demo), write endpoints are open; when set (production), requires `X-Admin-Token` header via constant-time SHA-256 comparison
- `ENABLE_HSTS` - Set to '1' to enable HSTS header (production behind TLS only)
- No build tool config (webpack, vite, rollup, etc.)
- Static asset serving via Express middleware with conditional cache headers:
- Default: File-based JSON storage at `db.json` (~300KB)
- In-memory cache keyed on file mtime to avoid re-parsing on every request (~30 reads per page load)
- Atomic writes via temp file + rename to prevent corruption on crash
- Rolling backup: `db.json.bak` preserved before each write
- Content-Security-Policy (CSP) - Allows 'unsafe-inline'/'unsafe-eval' for inline scripts + Transformers.js WASM; blocks external script injection, data exfil, object/embed, framing, form hijack
- X-Content-Type-Options: nosniff
- X-Frame-Options: SAMEORIGIN
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: Disables geolocation, microphone, camera
- HSTS: Optional (controlled by `ENABLE_HSTS` env var, meaningful only behind TLS)

## Platform Requirements

- Node.js >=20
- npm (bundled with Node.js)
- macOS/Windows/Linux; zip utility required for admin `/api/admin/download-zip` feature
- Optional: Git (for version control)
- Node.js >=20
- No additional system dependencies; Canvas binaries are pre-compiled in node_modules for win32-x64, darwin-x64, darwin-arm64, linux-x64-gnu
- ~150MB disk space for committed node_modules
- TLS termination recommended (for HSTS + secure deployments; app runs plain HTTP by default)
- Self-hosted Node.js servers (internal VPN/SSO with ADMIN_TOKEN)
- Turnkey releases: Windows + macOS bundles with portable Node.js v22.23.1 in `ma-integration-portal/node/` (built outside git via `git archive`)

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- JavaScript files: camelCase (e.g., `app.js`, `dashboard.js`, `transitions.js`, `banners.js`, `inline-edit.js`)
- HTML files: kebab-case (e.g., `admin.html`, `survey.html`, `employee.html`)
- Service modules: camelCase ending in "Service" (e.g., `aiService.js`, `ragService.js`)
- camelCase, descriptive verb + noun pattern
- Examples: `rebuildQuestions()`, `updateSliderDisplay()`, `renderSurvey()`, `getSliderStatus()`, `openPlaybookSlide()`
- Async functions: same camelCase pattern (e.g., `generate100DayPlan()`)
- camelCase for all local variables and parameters
- Descriptive names reflecting intent: `currentStep`, `questionsByDimension`, `loadingOverlay`, `fetchPromise`
- Boolean prefixes: `is`, `has`, `can`, `should` (e.g., `isEditMode`, `allAnswered`, `isAllowed`, `isPmoPage`)
- UPPER_SNAKE_CASE for module-level constants
- Examples: `STOP_WORDS`, `ADMIN_TOKEN`, `PORT`, `PUBLIC_BASE_URL`, `DB_FILE`, `ICON`, `LANG_KEY`
- Long-lived API paths: UPPER_SNAKE_CASE (e.g., `CSP` for security headers)
- Prefixed snake_case format: `{prefix}_{identifier}` or `{prefix}_{timestamp}_{hex}`
- Project IDs: `proj_demo`, `proj_*`
- Department IDs: `dept_sales`, `dept_product`, `dept_finance`
- Upload IDs: `upload_*` (collision-resistant: timestamp + random bytes)
- Lesson IDs: `l1_1`, `l1_2` (course_lesson pattern)
- Banner/storage keys: `banner_dismissed_{id}_r{revision}`
- kebab-case or camelCase for consistency
- Descriptive and functional: `dashboard-main-view`, `gauge-culture-fill`, `chk-local-hr-exists`
- Form inputs often use `chk-` prefix for checkboxes
- kebab-case: `page-banner`, `survey-question-box`, `slider-wrapper`, `edit-active-border`
- Modifier pattern: `{base}--{modifier}` (e.g., `page-banner--info`, `page-banner--warning`)
- State classes: `active`, `complete`, `pending`, `disabled`

## Code Style

- No automatic formatter configured (no Prettier, ESLint)
- 2-space indentation (observed in minified sections)
- Line length: variable (files up to 157KB committed)
- Semicolons: required at statement ends (CommonJS and client code)
- No ESLint or formal linting setup
- Code follows implicit conventions observed across files
- Security comments inline (see "Comments" section)
- No formal imports (vanilla JS, no module bundler)
- Files loaded via `<script>` tags in order of dependency
- Global namespace pollution accepted (window.* assignments)
- Not used; all requires are relative paths

## Error Handling

- Try/catch blocks for synchronous operations
- `.catch()` chains for Promise-based operations
- Two-tier logging: `console.error()` for internal errors, HTTP status codes for API responses
- API failures gracefully degrade (e.g., Gemini API timeout → local expert engine)
- Missing database returns fresh skeleton rather than null
- Silent failures for non-critical data (banner loading)
- `console.error()` for failures that halt execution or require action
- `console.warn()` for recoverable issues or security notes
- `console.log()` for informational messages (API calls, processing steps)

## Logging

- Informational: `console.log('Processing RAG PDF upload request: "${fileName}"...')`
- Warnings: `console.warn('[security] ADMIN_TOKEN not set — write/admin API endpoints are OPEN.')`
- Errors: `console.error('Error reading database file:', error)`
- Template strings with context included
- `console.log()` - Processing steps, API calls, info
- `console.warn()` - Recoverable failures, security notes, missing optional config
- `console.error()` - Unrecoverable failures, exceptions

## Comments

- JSDoc block at file header explaining module purpose and key concepts
- Inline comments above complex logic (security, performance, non-obvious algorithms)
- Inline comments explaining WHY, not WHAT (code should be self-documenting)
- Marked with `[security]` prefix
- Explain mitigation strategy, not just the risk
- Examples: CSP config, auth gates, XSS defenses, timing attacks
- Not systematically used (no TypeScript)
- Function headers use plain comment blocks when significant
- No inline `@param`, `@return` tags observed

## Function Design

- Small utility functions: 5-20 lines (e.g., `pick()`, `roleOk()`, `getSliderStatus()`)
- Mid-sized handlers: 30-80 lines (e.g., `render()`, `updateGauge()`)
- Complex logic: split across multiple functions (e.g., survey rendering across `rebuildQuestions()`, `renderSurvey()`, `updateUI()`)
- Positional parameters for required args (1-3 typical)
- Object destructuring for config objects: `{ fileName, fileData } = req.body`
- No varargs (...args) observed; arrays used explicitly
- Explicit return statements; implicit `undefined` accepted for side-effect functions
- Falsy returns used to signal no-op (e.g., early returns in event handlers)
- Success/error objects for API responses: `{ success: true/false, data: ..., error: ... }`
- `async`/`await` syntax used consistently in new code
- Promise chains (.then/.catch) used in legacy/simple paths
- Timeouts applied to external API calls:

## Module Design

- CommonJS on server: `module.exports = { functionName, anotherFunction };`
- Global window object on client: `window.openPlaybookSlide = openPlaybookSlide;`
- Not used; imports are direct
- All client-side modules wrapped in `(function () { ... })()` to avoid global scope pollution
- Except where global API is intentional (e.g., `window.openPlaybookSlide = openPlaybookSlide;`)
- Example from `banners.js`:

## State Management

- `localStorage` for persistent state (role, language, banners, edit mode, active assessment)
- `sessionStorage` for session-scoped state (dismissed banners, access denial messages)
- In-memory variables for page state (currentStep, responses, cache)
- No state management library (Redux, Zustand, etc.)
- In-memory cache with mtime invalidation (`_dbCache`, `_dbMtime`) for db.json
- Single source of truth: `db.json` file
- Atomic writes via temp file + rename to prevent corruption

## Security Patterns

- Use `textContent` instead of `innerHTML` for user-controlled data
- Example: `el.textContent = title;` (never `el.innerHTML = title;`)
- URL validation before iframe assignment:
- Header-only token passing: `X-Admin-Token` header (never query string)
- Timing-safe comparison using SHA-256 hash to fixed length
- Conditional gate: open in demo (no ADMIN_TOKEN set), required in production
- Secrets stripped from API responses before sending to client
- Example:
- Rolling backup on every write: `db.json.bak` keeps last good state
- Atomic writes prevent truncation: write to `.tmp`, then rename

## API Response Format

- 200 OK - Success
- 400 Bad Request - Validation error
- 401 Unauthorized - Auth required
- 500 Internal Server Error - Server fault

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text

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

- **Multi-role Portal**: Different HTML pages per role (admin, pmo, dashboard, employee, etc.) served from Express static
- **Client-Side Routing & Transitions**: Page navigation intercepted by transitions.js for SPA-like slide transitions + tab switching within pages
- **File-Based State**: JSON database at `db.json` with in-memory cache keyed on mtime; atomic writes via temp + rename
- **Project Isolation**: Each M&A project owns its own workspace bundle (employees, assessments, comms) + CMS content (courses, pages, menus)
- **Per-Page CMS**: Sidebar/menu/banner configuration managed per project; fetched at page load via `/api/menus`, `/api/banners`, `/api/pages`
- **Admin Token Gating**: Optional `ADMIN_TOKEN` env var guards all POST/PUT/DELETE + /api/admin/* routes; constant-time comparison prevents timing attacks
- **Responsive Glassmorphism UI**: Single `public/css/style.css` + inline styles; supports desktop + mobile via flexbox/grid + CSS variables
- **i18n via CMS**: Translations stored in `db.json.i18n.strings[lang][key]`; DOM elements with `data-i18n="key"` hydrated by app-global script

## Layers

- Purpose: Role-based HTML pages + SPA-like transitions
- Location: `public/*.html`, `public/js/*.js`, `public/css/style.css`
- Contains: DOM templates, event listeners, fetch calls to /api
- Depends on: REST API via `/api/...`
- Used by: Browsers (admin, pmo, hrbp, supporting, employee roles)
- Purpose: Role-based page redirection, access guard, SPA transitions
- Location: `public/js/transitions.js` (lines 112–149 access control)
- Contains: Active role tracking, page-access map, logout/redirect on 403
- Depends on: localStorage (active_demo_role), sessionStorage (access_denied_message)
- Used by: All frontend pages
- Purpose: REST endpoints for projects, departments, processes, CMS, i18n, settings
- Location: `server.js` (lines 262–1400+)
- Contains: CRUD endpoints, temporal simulation (time-travel), project/CMS isolation logic
- Depends on: File database (db.json), optional Gemini API key
- Used by: Frontend via fetch(/api/...)
- Purpose: Atomic read/write of JSON state, mtime-based cache invalidation
- Location: `server.js` (readDb lines 127–210, writeDb lines 212–238)
- Contains: JSON parsing, backup creation, collision-safe ID generation
- Depends on: fs module, db.json file
- Used by: All API endpoints
- Purpose: AI plan generation, PDF RAG indexing
- Location: `aiService.js`, `ragService.js`
- Contains: Gemini API calls, local fallback plan template, playbook text extraction
- Depends on: Gemini API key (optional), playbook.html content
- Used by: Dashboard (AI plan tab), Admin (RAG PDF upload)

## Data Flow

### Primary Request Path: Dashboard Load → KPI Display

### Secondary Flow: Admin Settings Update

### Project Switching Flow

### Playbook Slide Viewer Modal

## Key Abstractions

- Purpose: Isolate each M&A deal's workspace (employees, assessments, communications) + CMS content
- Examples: `db.projects[]`, `/api/projects`, `/api/projects/:id/activate`
- Pattern: Each project holds `data {}` (workspace) + `cms {}` (content); active project's data loaded into live custom lane; CMS swapped into top-level when activated
- Purpose: Control page visibility + data filtering per user role
- Examples: `pageAccess` map in transitions.js (line 127–135), sidebar menu built per role in dashboard.js
- Pattern: localStorage `active_demo_role` checked on page load; if not in pageAccess, redirect to /
- Purpose: Demo mode showing Day 1, 30, 60, 90, 100+ snapshots of employee progress, pulses, scores
- Examples: `/api/settings/time-travel` POST, `scaleEmployeesForDay()`, `getPulsesForDay()` in server.js
- Pattern: `db.settings.timeTravelDay` stored; when fetching employees/pulses/scores, scaled helpers apply day-specific transformations
- Purpose: Each project owns independent courses, pages, menus, departments, processes, slides
- Examples: `snapshotCms()` (line 670–680), `stashActiveProjectCms()` (line 693–695), `applyCmsToTopLevel()` (line 682–691)
- Pattern: Before project switch, save live CMS to `activeProject.cms`; when activating new project, copy its CMS into top-level db
- Purpose: Multi-language UI without client-side template engines
- Examples: `db.i18n.strings[lang][key]`, DOM `data-i18n="key"` hydrated by global i18n bootstrap script
- Pattern: Admin updates `/api/i18n` (POST with lang + key + value), client polls on load, fills all `[data-i18n]` nodes

## Entry Points

- Location: `server.js` line 11–12
- Triggers: `npm start` → `node server.js`
- Responsibilities: Express app init, PORT/PUBLIC_BASE_URL from env, middleware stack (compression, CSP headers, JSON body parsing, static files)
- Location: `/` → `public/overview.html` (server.js line 62–65)
- Triggers: Browser navigates to /
- Responsibilities: Hero section with "Enter Portal" CTA linking to `/index.html` (role-selector grid)
- Location: `/index.html` → role grid, click role card
- Triggers: Click `.demo-role-card` (index.html line 52–84)
- Responsibilities: Set `localStorage.active_demo_role`, navigate to role-specific page (e.g., `/dashboard.html` for hrbp)
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

### Session/User Identity Missing

### Per-Page State Duplication in CSS/JS

## Error Handling

- readDb() parse failure: Throws if db.json exists but is unreadable, preventing silent wipe (line 202–206)
- writeDb() failure: Throws "Failed to persist database" so Express returns 500 instead of falsely claiming success (line 236)
- Gemini API timeout: Caught, logged, falls back to local plan generator (aiService.js line 88–92)
- File upload errors: Try/catch in /api/slides/upload and /api/media POST; returns 400 or 500 with error text (server.js line 901–909, 1144–1148)
- Frontend 401 on write: Admin token prompt fires (transitions.js line 26–31); user retries with token

## Cross-Cutting Concerns

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
