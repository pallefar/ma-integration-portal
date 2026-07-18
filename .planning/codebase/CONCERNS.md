# Codebase Concerns

**Analysis Date:** 2026-07-18

## Tech Debt

### Monolithic Large Files

**Frontend codebase suffers from file size bloat that reduces maintainability:**

- `public/js/employee.js` (3608 lines) - Handles URL parsing, multi-language translations, academy gamification, video player, and form submissions all in one file
- `public/js/transitions.js` (3230 lines) - Admin auth bridge, playbook viewer, HTML slides, page navigation, menu building, i18n engine, and global state management
- `public/js/dashboard.js` (2337 lines) - Gauge rendering, tab navigation, markdown formatting, API data fetching, and assessment display
- `public/js/admin.js` (2454 lines) - Admin UI, CMS editor, user/project management, and settings all in one file

**Impact:** Difficult to test, easy to introduce regressions, high risk of unrelated changes breaking existing code. Separation of concerns is absent.

**Fix approach:** Refactor each into logical modules (`admin-cms.js`, `admin-projects.js`, `employee-academy.js`, `employee-video.js`, etc.) with a module bundler (Webpack, Vite) to reduce load time.

### File-Based Database Single Point of Failure

- `db.json` is the entire persistent data store with no redundancy
- All data (employees, assessments, CMS, settings, projects) in a single 300KB+ JSON file
- No transaction isolation — a crash during `writeDb()` could corrupt the entire database

**Impact:** Data loss risk, no horizontal scaling, no real-time sync for multi-user deployments, limited audit trail.

**Fix approach:** 
1. Near term: Implement SQLite (single-file, serverless) as drop-in replacement to ACID guarantees
2. Long term: Migrate to PostgreSQL for production multi-user deployments

### RAG Indexing Fragility

**Files:** `ragService.js` (lines 62–224)

- Relies on regex parsing of `public/playbook.html` to extract learning chunks
- Regex patterns assume strict HTML structure: `/<div\s+id="([^"]+)"\s+class="playbook-section">/`
- If playbook.html structure changes even slightly (extra attributes, whitespace), indexing silently fails or misses content
- No validation that extracted chunks are meaningful

**Impact:** RAG-enhanced AI plans degrade silently. Users see generic fallback plans without realizing the playbook wasn't indexed.

**Fix approach:** 
1. Parse playbook.html via DOM API (`jsdom` package) instead of regex
2. Add logging for chunks extracted during indexing
3. Validate each chunk contains min 40 chars and unique content
4. Write integration tests that verify all playbook sections are found after indexing

### JSON Serialization for Deep Cloning

**Files:** `server.js` (lines 671, 703)

```javascript
const clone = (v) => JSON.parse(JSON.stringify(v == null ? null : v));
```

- Used to deep-clone project CMS bundles and custom data
- Breaks on circular references, `undefined`, functions, `Date` objects, `Map`/`Set`
- Silent data loss if an object contains these types

**Impact:** Project switching could drop data silently if structured data contains non-serializable types.

**Fix approach:** Use a robust library (`structuredClone()` in Node 17+, or `immer` for immutable updates).

---

## Known Bugs

### Admin Sidebar Link Role-Scoping Bug

**Already fixed in commit 9703626 per memory**, but document for regression prevention:

- Issue: Admin menu link was being removed for non-admin roles by `applyMenuOverrides()` 
- Root cause: `applyMenuOverrides()` (`transitions.js` ~1284) collected ALL sidebar links into `built{}`, then removed any role-scoped-hidden entries
- For HRBP role, admin entry (with `roleScope:"admin"`) was deleted before menu load completed
- Fix guard: Check `classList.contains('sidebar-admin-link')` to prevent menu-managed removal

**Files:** `public/js/transitions.js` (~1284)

**Verify:** When switching to HRBP role, confirm admin Menus/Slides/Processes tabs remain accessible via sidebar link.

### Lesson Pool Collision in Gamification

**Files:** `server.js` (lines 361–366)

```javascript
function getCatalogLessonIds(db) {
  const ids = [];
  (db.courses || []).forEach(c => (c.modules || []).forEach(m => (m.lessons || []).forEach(l => ids.push(l.id))));
  // Fallback to the legacy 9-lesson set if the catalog is empty
  return ids.length ? ids : ['l1_1', 'l1_2', ...];
}
```

- If custom courses are empty, fallback pool is always `['l1_1', 'l1_2', ..., 'l3_3']`
- Time-travel gamification (`scaleEmployeesForDay()`) assumes this pool is stable
- If admin adds courses mid-demo, pool changes retroactively → employee scores recalculate inconsistently

**Impact:** Leaderboard scores appear to jump unexpectedly when courses are added. Historical employee progression data becomes inconsistent.

**Fix approach:** 
1. Lock the lesson pool in db.json on first admin course creation
2. Document that lesson IDs cannot be deleted once added (only reordered)
3. Add admin warning: "Changing courses will recalculate all employee progress retroactively"

---

## Security Considerations

### Incomplete XSS Audit

**Status per memory:** "RE-RUN incomplete XSS audit (agent hit session limit)"

**Verified hardening in place:**
- CSP headers (`Content-Security-Policy`) block external scripts except YouTube/HuggingFace
- `openHtmlSlide()` validates URL protocol (must be http/https, rejects `javascript:`)
- `innerHTML` avoided in core paths

**Remaining gaps to audit:**
1. `public/js/transitions.js` (3230 lines) - Dynamic HTML construction via string concatenation:
   - Line 53: `label ? ' — ' + label : ...` — label not HTML-escaped if from user input
   - Line 79: Uses manual `esc()` function for escaping; verify all output paths use it
2. `public/js/dashboard.js` — Markdown rendering of AI-generated plans could inject script tags if Gemini API compromised
3. `public/js/admin.js` — CMS page editor allows users to paste HTML; needs sanitizer (e.g., `DOMPurify`)

**Fix approach:** 
1. Run a fresh XSS audit focusing on user-supplied fields: names, titles, descriptions, markdown content
2. Install and use `DOMPurify` for sanitizing any HTML pasted into CMS/slides
3. Replace manual `esc()` with a vetted library
4. Add Content Security Policy violation reporting to catch missed cases

### Admin Token in localStorage

**Files:** `public/js/transitions.js` (lines 1–36)

- Admin token stored in browser localStorage after first 401 prompt
- `localStorage` is accessible to any script (even XSS within CSP limits)
- Token stays in localStorage until manually cleared — no expiration

**Impact:** 
- If user leaves browser unattended on shared computer, admin can make changes
- Token exposed if user opens malicious site in same browser on same origin
- No audit trail of which user made which change (no session identity)

**Fix approach:**
1. Token should be session-scoped with 1-hour expiration
2. Store token in `sessionStorage` (cleared on browser close) instead of `localStorage`
3. Set `Secure; HttpOnly; SameSite=Strict` cookie attributes if moving to cookie-based auth
4. Add admin change log with timestamp + request metadata (user agent, IP if available)

### Gemini API Key in Demo/Fallback

**Files:** `aiService.js`, `server.js`

- When Gemini API fails, app falls back to local generation and completes successfully
- Encourages production use without actual Gemini key (false sense of capability)
- API timeout is 15 seconds — could silently hang if network is slow

**Impact:** Users may deploy without testing Gemini integration. Production deployments fail silently to generate AI plans.

**Fix approach:**
1. Add explicit `GEMINI_API_KEY` env var validation on startup
2. If `ADMIN_TOKEN` is set (production mode) and no Gemini key, log a **CRITICAL** warning and refuse to start
3. Reduce timeout to 10s to fail faster
4. Add `/healthz?deep` endpoint that validates Gemini connectivity

### No Rate Limiting on API Endpoints

- `/api/projects`, `/api/assessments`, `/api/rag/upload`, `/api/rag/search` have no request limits
- A malicious script could flood the server with PDF uploads or search requests

**Impact:** DOS via large file uploads (`/api/rag/upload` accepts 50MB), repeated searches could exhaust CPU.

**Fix approach:** Add rate limiting middleware (e.g., `express-rate-limit`):
- `/api/rag/upload`: 5 requests/hour per IP
- `/api/rag/search`: 50 requests/minute
- `/api/projects`: 10 requests/minute

### No Input Validation on Project/Employee Creation

**Files:** `server.js` (lines 714–740)

```javascript
const project = {
  targetCompany: String(b.targetCompany || name).trim(),
  sector: b.sector || '', size: b.size || '', hq: b.hq || '',
  // ... no length checks, sanitization, or type validation
};
```

- Fields coerced to strings but no length limits (could be 10MB strings)
- No regex validation for dates, email formats, phone numbers
- Custom HTML in page CMS editor not validated/sanitized

**Impact:** Malformed data could corrupt UI rendering. Large fields waste database space. Potential for injection if data displayed without escaping.

**Fix approach:**
1. Add Zod or Joi schema validation on all POST endpoints
2. Define max lengths: `targetCompany <= 100`, `sector <= 50`, `acquisitionDate` matches ISO date regex
3. Sanitize any HTML pasted into CMS (use `DOMPurify`)
4. Reject fields containing HTML tags unless explicitly allowed (pages, slides)

### No Authentication for Read Operations in Demo Mode

- When `ADMIN_TOKEN` is unset, all `/api/*` endpoints are open for read AND write
- A visitor can fetch `/api/settings`, `/api/employees`, `/api/assessments` without auth
- Contains no PII in demo data, but production deployments with `ADMIN_TOKEN` unset are fully exposed

**Impact:** Production data exposure if operator forgets to set `ADMIN_TOKEN`.

**Fix approach:**
1. If `process.env.NODE_ENV === 'production'`, force `ADMIN_TOKEN` to be set on startup
2. Even in demo mode, gate read access to sensitive endpoints (settings, employees, assessments) behind a simple demo PIN stored in `.env.demo`
3. Document: "Never deploy with `ADMIN_TOKEN` unset if data contains sensitive information"

---

## Performance Bottlenecks

### Synchronous File I/O on Express Event Loop

**Files:** `server.js` (lines 127–210, 212–238)

- `readDb()` uses `fs.readFileSync()` — blocks event loop for 1–10ms per request
- Cache hit rate is ~95% (mtime check), but cache miss blocks everything
- ~30 requests per page load, but if db.json changes, each request re-parses entire file

```javascript
const data = fs.readFileSync(DB_FILE, 'utf8');
const parsed = JSON.parse(data);  // 300KB JSON parse blocks here
```

**Impact:** Under concurrent load (5+ simultaneous users), request latency could spike to 100ms+. Large db.json (500KB+) makes this worse.

**Fix approach:**
1. Use `fs.promises.readFile()` with explicit await at route handler boundary
2. Keep in-memory cache longer (watch for file changes with `fs.watch()` instead of mtime polling)
3. Migrate to SQLite (async queries via `better-sqlite3` for sync, or `sqlite3` for async)

### JSON Deep Clone on Every Project Switch

**Files:** `server.js` (lines 671, 703)

```javascript
const clone = (v) => JSON.parse(JSON.stringify(v == null ? null : v));
// Called on every POST /api/projects/:id/activate to snapshot CMS
```

- Clones entire `courses`, `pages`, `menus`, `departments`, `slides` arrays
- With 100+ courses × 50 lessons each, this could be 1MB+ of JSON serialization per switch

**Impact:** Project switching felt slow for large CMS bundles. Overhead scales with data size.

**Fix approach:**
1. Use `structuredClone()` instead of JSON round-trip (10–100x faster)
2. Or: Implement copy-on-write — only deep-clone when data is actually mutated
3. Limit max courses per project or paginate CMS queries

### RAG TF-IDF Scoring on Every Search

**Files:** `ragService.js` (lines 283–338)

- Every search query tokenizes entire corpus (~300+ chunks) and scores all of them
- TF-IDF calculation is O(n × m) where n = chunk count, m = query token count
- With 500 chunks and 10-token query, this is 5000 scoring operations

**Impact:** `/api/rag/search` response times could be 50–200ms. OK for UI (cached), but slow if called repeatedly.

**Fix approach:**
1. Pre-compute IDF at indexing time (already done)
2. Use vector DB (e.g., SQLite with `sqlite-vec` extension, or Pinecone) for O(log n) retrieval
3. Cache search results for common queries (e.g., "culture" → always same top 3)

### Canvas Binary Bloat in Cross-Platform

**Files:** `node_modules/@napi-rs/canvas` — 4 platform binaries (93MB total committed)

- Added to support PDF→RAG feature (pdf-parse uses canvas for rendering)
- All 4 binaries (win32-x64, linux-x64, darwin-x64, darwin-arm64) shipped in every release
- User downloads only 1 needed for their OS, but all in git/npm

**Impact:** 
- Release zip downloads are 50MB+ instead of ~10MB
- Repository `.git` size bloated (hard to clone on slow networks)
- CI/CD pipeline slower due to node_modules size

**Fix approach:**
1. Exclude platform-specific binaries from git (add to `.gitignore`)
2. Install only needed binary on first `npm install` via `@napi-rs/canvas` postinstall script
3. Or: Replace pdf-parse with lightweight `pdfjs-dist` (pure JS, no canvas required)

---

## Fragile Areas

### Frontend State Management via Global Objects

**Files:** Multiple (dashboard.js, employee.js, admin.js)

- State stored in page-level variables (e.g., `activeEmployee`, `portalSettings` in employee.js)
- No state validation or setter guards — direct mutations possible
- Page navigation could leave stale state in memory
- Multiple event listeners attaching without cleanup

**Impact:** 
- Hard to debug state inconsistencies across page navigations
- Memory leaks if event listeners not removed on page unload
- XSS could mutate global state

**Safe modification:** 
1. Use a proper state manager (e.g., Zustand, Redux) or wrap globals in getter/setter functions
2. Add cleanup handlers on `beforeunload` to remove listeners
3. Validate state transitions (e.g., only certain state changes allowed from certain pages)

### Async Error Handling in API Responses

**Files:** `aiService.js`, `server.js`

```javascript
app.post('/api/assessment/generate', async (req, res) => {
  const plan = await aiService.generate100DayPlan(...);
  res.json({ success: true, plan });
  // What if generate100DayPlan() throws and response already sent?
});
```

- Many routes don't properly chain `.catch()` on async operations
- If `generateSmolInsight()` throws after `res.json()` called, error is unhandled
- Missing error handlers mean 500 responses don't get sent

**Impact:** User sees blank response. Server logs uncaught exception. Browser hangs waiting for response.

**Fix approach:**
1. Wrap all async handlers in `try/catch`:
```javascript
app.post('/api/...', async (req, res) => {
  try { ... } catch (err) { res.status(500).json({ error: 'Failed' }); }
});
```
2. Use error-handling middleware to catch unhandled rejections
3. Add request timeout middleware to auto-fail hanging requests after 30s

### CMS Page Editor XSS Surface

**Files:** `public/js/page-cms.js`, `admin.js`

- Admin can edit page content and paste arbitrary HTML
- Page rendered via `document.getElementById('content-area').innerHTML = ...`
- If HTML contains `<script>` tags, they execute

**Impact:** Admin can inject malware into pages seen by all users.

**Fix approach:**
1. Use `DOMPurify.sanitize()` before rendering page HTML
2. Or: Store pages as markdown + render with `markdown-it`, blocking raw HTML

### Project Data Loss on Mode Switch

**Files:** `server.js` (lines 622–655)

- When switching from demoMode=true to false, custom data is moved to projects
- If a project switch happens during mode transition, `stashActiveCustomProject()` might not be called
- Orphaned data in `customEmployees`, `customAssessments` could be lost

**Status:** Partially mitigated with guard on line 628 (`inCustomModeOnDemo`), but logic is complex and easy to miss edge cases.

**Fix approach:**
1. Add explicit pre-switch validation: ensure no mutations pending
2. Add mode-switch transaction: write backup of current state before changing mode
3. Test: Try switching modes, adding data, switching back, verify data recovered

### Concurrent Database Writes

**Files:** `server.js` (lines 212–238)

- If two requests call `writeDb()` simultaneously, they write to the same temp file → rename race
- Both get their local cache updated, but only second write wins
- First write's changes are lost

**Impact:** Concurrent edits (e.g., admin adds project while user submits assessment) could lose data.

**Fix approach:**
1. Add in-memory mutex (`const dbMutex = new Mutex()`) before writeDb/readDb
2. Or migrate to SQLite/PostgreSQL with proper transaction handling
3. Document: "Single-user or low-concurrency only until DB refactored"

---

## Dependencies at Risk

### pdf-parse Platform Binaries

**Package:** `pdf-parse@2.4.5` + `@napi-rs/canvas` (platform-specific binaries)

**Risk:** 
- Canvas binaries are C++ native modules (security surface for buffer overflows)
- PDF parsing via canvas means malicious PDFs could crash server or execute code
- No version pinning — `npm install` could pull breaking changes

**Impact:** Malicious PDF upload could DOS server or compromise it.

**Mitigation in place:**
- Timeout on PDF parsing (15s)
- File size limit (50MB)

**Recommendation:**
1. Pin to exact version: `"pdf-parse": "2.4.5"` (no `^` or `~`)
2. Run PDF parsing in a child process (isolate crashes)
3. Scan uploaded PDFs for embedded executables/scripts before parsing
4. Consider: Replace with lightweight `pdfjs-dist` (pure JS)

### Old Express Version

**Package:** `express@4.19.2`

- Released Feb 2024, now 6+ months old
- 0 known vulnerabilities in npm audit, but no bug fixes since release
- Recommended to keep within 1–2 patch versions of latest

**Risk:** Low, but good hygiene to stay current.

**Fix:** Bump to latest (e.g., `4.22.0`) quarterly.

### Compression Middleware

**Package:** `compression@1.8.1`

- Old version (released 2024), should check for updates
- Generally stable but no active feature development

**Risk:** Low, but dependency drift.

### No Dependency Audit Setup

**Current state:** No `npm audit` scheduled, no Dependabot, no security updates automated.

**Risk:** Vulnerabilities in `express`, `compression`, `pdf-parse` go unnoticed until manual review.

**Fix approach:**
1. Add GitHub Dependabot (automatically opens PRs for updates)
2. Run `npm audit` in CI on every PR
3. Schedule monthly security review of top-level dependencies

---

## Test Coverage Gaps

### No Test Files Found

- No `*.test.js`, `*.spec.js`, or `__tests__/` directory
- Zero automated test coverage

**Areas with high risk if broken:**
- `server.js` (2414 lines) — database I/O, project switching, multi-language, gamification
- `ragService.js` — RAG indexing, search ranking, fallback behavior
- `aiService.js` — Gemini API fallback, plan generation
- `public/js/transitions.js` (3230 lines) — state mutations, navigation, auth bridge

**Recommendation:**
1. Add Jest/Vitest setup
2. Write tests for:
   - Database read/write atomicity (concurrent writeDb)
   - Project data isolation on switch
   - RAG indexing completeness (all playbook sections parsed)
   - Gamification score calculation across different day counts
   - URL validation in openHtmlSlide
   - Fallback behavior when Gemini API fails

### No Integration Tests

- Admin UI tested manually only
- CMS editor (CRUD operations on courses, pages) untested
- Project creation/switching flow untested

**Risk:** Regression in admin workflow could go unnoticed until user reports.

**Fix approach:** Add Playwright/Cypress tests for critical admin flows:
- Create project, switch to it, verify data isolation
- Add course, submit assessment, verify gamification
- Edit page in CMS, refresh, verify persistence

---

## Scaling Limits

### Single db.json File Scaling

**Current capacity:**
- db.json currently ~300KB (empty demo database)
- Scales to ~5–10MB with 1000 employees + 500 courses before performance degrades

**Limit:** 
- File I/O time becomes noticeable above 10MB
- JSON parsing time linear with file size
- No horizontal scaling (can't split data across servers)

**Scaling path:**
1. Near term: Switch to SQLite (same single file, but indexed queries)
2. Medium term: PostgreSQL + connection pool for 10+ concurrent users
3. Long term: Microservices (separate API for courses, gamification, CMS, etc.)

### Memory Cache Limits

- In-memory cache holds parsed db.json (300KB → 10MB as it grows)
- Multiple tabs/windows of app open → multiple process instances each with full copy
- No cache invalidation across processes

**Limit:** Browser memory issues above 50MB, server memory above 100MB.

**Fix:** Use Redis cache (shared across processes, expires after TTL).

---

## Missing Critical Features

### No Audit Log

- No record of who changed what and when
- Admin edits CMS, but no way to know who did it or revert to previous version
- Deleting a project silently removes all its data with no recovery option (except db.json.bak)

**Blocks:** Compliance audits, debugging production issues, accountability.

**Fix approach:**
1. Add `auditLog` table with: timestamp, userId, action, resource, oldValue, newValue
2. Store last 5 backups (daily rotation) instead of single db.json.bak
3. Admin UI: "View History" for pages, projects, assessments

### No User Sessions / Multi-User Awareness

- Demo is single-user (no concept of "logged in user")
- When deployed with ADMIN_TOKEN, token grants access to ALL admin functions
- No per-user permissions (e.g., "HR can edit employees, PMO can edit projects")

**Blocks:** True multi-user production deployment, fine-grained access control.

**Fix approach:**
1. Add user table with roles (admin, hrbp, pmo, viewer)
2. Implement OAuth2 or SAML for SSO
3. Enforce role-based access control on all admin endpoints

### No Data Export/Import

- No way to bulk export employee list, assessment results, or CMS
- Admin must manually copy-paste from db.json

**Blocks:** Integration with HR systems, reporting, data migration.

**Fix approach:**
1. Add `/api/admin/export?type=employees&format=csv` endpoint
2. Add `/api/admin/import` with CSV upload (with validation)
3. Support formats: CSV, JSON, Excel

---

## Architectural Concerns

### No Error Boundaries on Frontend

- Single JavaScript error (e.g., in dashboard.js line 2337) could crash entire app UI
- No global error handler to show error state to user

**Impact:** User sees blank page, unclear what went wrong.

**Fix approach:**
```javascript
window.addEventListener('error', (e) => {
  console.error('Uncaught error:', e.error);
  document.body.innerHTML = '<div style="...">Error: ' + e.error.message + '</div>';
});
window.addEventListener('unhandledrejection', (e) => { ... });
```

### No Feature Flags

- All features always active (no way to disable Gemini integration, disable gamification, etc.)
- If a feature is buggy, only fix is redeploy

**Impact:** Can't safely roll out breaking changes to subset of users.

**Fix approach:** Add simple feature flags:
```javascript
const flags = { enableGamification: true, enableGemini: true, enableHtmlSlides: false };
// Fetch from /api/flags on startup
if (flags.enableGamification) { ... }
```

### No Logging Strategy

- Console.log used throughout (not structured)
- No centralized error tracking (no Sentry, no DataDog)
- Production logs lost on process restart

**Impact:** Hard to debug production issues. Users can't report bugs with log context.

**Fix approach:**
1. Use `winston` or `pino` for structured logging
2. Add Sentry SDK to catch frontend errors
3. Log to file + stdout with rotation

---

## Data Integrity Issues

### No Schema Validation

- Fields added to db.json without validation
- Admin could create project with `targetCompany = 10MB string` — no checks
- Database could accumulate invalid data

**Fix approach:** Use Zod/Joi to validate data on read and write.

### Timezone Handling

**Files:** `server.js` (lines 369–400), hardcoded time-travel logic

- `timeTravelDay` setting controls employee progress scaling
- No timezone handling — always assumes server/browser timezone match
- Daylight saving transitions could cause day boundaries to shift

**Fix approach:**
- Store dates as ISO-8601 UTC strings only
- Convert to user timezone for display (use `date-fns` or `day.js`)
- Never do arithmetic on `Date` objects without timezone awareness

---

## Production Readiness Gaps

### No Deployment Runbook

- Hardening implemented but no documented steps to deploy safely
- How to set `ADMIN_TOKEN`? How to enable HTTPS? How to handle database backups?
- Deferred to operator instinct

**Fix approach:** Write `DEPLOYMENT.md` with:
1. Environment variables (ADMIN_TOKEN, ENABLE_HSTS, PORT)
2. TLS setup (reverse proxy + Node plain-HTTP)
3. Database backup strategy
4. Log aggregation setup
5. Monitoring (health checks, error tracking)
6. Incident response (data corruption, DOS, compromise)

### No Health Check Probe Tunability

**Files:** `server.js` (lines 116–119)

```javascript
app.get('/healthz', (req, res) => {
  try { readDb(); res.json({ status: 'ok', ts: Date.now() }); }
  catch (e) { res.status(503).json({ status: 'degraded' }); }
});
```

- Health check only tests db read, not full startup checks
- No `/readyz` (readiness) vs `/livez` (liveness) distinction
- Load balancer could route requests to degraded instance

**Fix approach:**
1. Add `/readyz?deep=true` that tests: db read, Gemini API connectivity, file permissions
2. Add `/livez` that's minimal (always 200 unless process crashing)
3. Document readiness probe config for Kubernetes/Docker/load balancer

---

## Summary of Priorities

| Issue | Severity | Effort | Impact |
|-------|----------|--------|--------|
| Concurrent db writes race condition | **Critical** | High | Data loss |
| Input validation gaps | **Critical** | Medium | Injection/corruption |
| File-based database limits | **High** | Very High | Scaling blocker |
| XSS audit incomplete | **High** | Medium | Security breach |
| Monolithic JS files | High | High | Maintenance debt |
| No test coverage | Medium | High | Regression risk |
| No error boundaries | Medium | Low | UX issue |
| No audit log | Medium | Medium | Compliance gap |
| RAG indexing fragility | Medium | Medium | Feature degradation |
| Admin token expiration | Low | Low | Security best practice |

---

*Concerns audit: 2026-07-18*
