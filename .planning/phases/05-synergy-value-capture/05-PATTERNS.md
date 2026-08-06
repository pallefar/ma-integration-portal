# Phase 5: Synergy Value Capture - Pattern Map

**Mapped:** 2026-08-06
**Files analyzed:** 9 (server.js, validators/workstream.js, public/js/execution.js, public/execution.html,
public/js/deal-home.js, scripts/migrate-synergy-stages.js [new], data/demo.db + data/ma-portal.db seed rows,
5 new test/*.test.js files)
**Analogs found:** 9 / 9 (every file has a same-repo analog; no external-pattern fallback needed)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `server.js` (extend `synergyLane` section, add 5 sub-routes) | route/controller | CRUD + request-response | `server.js:784-816` `POST /api/deals/:id/members` (dedicated sub-route + inline authz-narrowing) | exact |
| `server.js` (`isAdminOrIlRequest` helper) | middleware/utility | request-response | `server.js:468-473` `isAdminRequest()` | exact |
| `server.js` (arrived-month check) | utility | transform | `server.js:3200-3205` `computeOverdue()` | exact |
| `validators/workstream.js` (extend `SynergyUpsertSchema`, add `MONTH_RE`/`PhasingRowSchema`, add 5 new schemas + `registerSchema()` calls) | config/validator | request-response | `validators/workstream.js:100-131` (existing `FromRemediationSchema`/`SynergyUpsertSchema` registration block) + `validators/dd.js:34-42` (`isValidCalendarDate` refine idiom) | exact |
| `public/js/execution.js` (rewrite `renderSynergy()`, stage control, grid, baseline list, cost list, task-progress, rollup) | component/view | CRUD + request-response | itself — `renderSynergy()` (lines 216-285), `.ex-add` mini-form pattern (lines 181-201, 380-397), status-cycle handler (250-259) | exact (same file, extend in place) |
| `public/execution.html` (new `.syn-*` CSS for grid/baseline/cost/stage-menu) | config (page-local styles) | — | `public/execution.html:72-74` `.ex-add` CSS block; existing `.syn-card`/`.syn-track`/`.syn-fill` (lines 21-33) | exact |
| `public/js/deal-home.js` (new `renderStaleSynergyNudge()`) | component/view | request-response | `public/js/due-diligence.js:526-576` `renderOwnerNudge()`/`loadOwnerNudge()` — PATTERN only, not a call (see Shared Patterns) | role-match (different DOM-construction idiom, same behavioral pattern) |
| `scripts/migrate-synergy-stages.js` (new one-off migration) | migration | batch/file-I/O | `scripts/seed-dd-request-templates.js` (openDbFile + prepared statements + `wal_checkpoint(TRUNCATE)`) | exact |
| `test/synergy-phasing.test.js`, `test/synergy-cost.test.js`, `test/synergy-stage.test.js`, `test/synergy-tasks.test.js`, `test/synergy-staleness.test.js` (new) | test | request-response (HTTP integration) | `test/dd-findings.test.js` (full harness: temp-DB-trio env vars, `newSession`/`bindDeal`/`cookieHeader` inline helpers, two-identity 200/403 proof shape) | exact |

## Pattern Assignments

### `server.js` — new sub-routes (generate-phasing, stage, rebaseline, confirm-current, cost-entries)

**Analog:** `server.js:784-816` `POST /api/deals/:id/members`, and the base upsert handler being extended, `server.js:3037-3102`.

**Imports/wiring — none needed.** All new routes live in the same file, same section (`server.js:3033-3104` today), using functions already in scope (`readDb`, `writeDb`, `newId`, `synergyLane`).

**Full current handler being extended (read in full)** — `server.js:3037-3102`:
```js
function synergyLane(db) {
  const isCustom = db.settings && db.settings.demoMode === false;
  if (isCustom) { db.customSynergyInitiatives = db.customSynergyInitiatives || []; return db.customSynergyInitiatives; }
  db.synergyInitiatives = db.synergyInitiatives || [];
  return db.synergyInitiatives;
}
const SYN_STATUSES = ['identified', 'validated', 'planned', 'executing', 'realized']; // → becomes 4-value 'idea'..'captured', D-07/D-11

app.get('/api/synergies', (req, res) => {
  res.json(synergyLane(readDb()));
});

app.post('/api/synergies', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const lane = synergyLane(db);
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : Math.max(0, Math.round(n * 10) / 10); };
  if (b.id) {
    const item = lane.find(s => s.id === b.id);
    if (!item) return res.status(404).json({ error: 'Initiative not found.' });
    if (b.title !== undefined && !String(b.title).trim()) {
      return res.status(400).json({ error: 'Initiative title cannot be empty.' });
    }
    ['title', 'owner', 'workstreamId', 'notes'].forEach(k => { if (b[k] !== undefined) item[k] = String(b[k] || '').slice(0, 300); });
    if (b.category !== undefined) item.category = b.category === 'cost' ? 'cost' : 'revenue';
    if (b.targetM !== undefined) item.targetM = num(b.targetM);
    if (b.realizedM !== undefined) item.realizedM = num(b.realizedM);
    if (b.status !== undefined) item.status = b.status;
    writeDb(db);
    return res.json({ success: true, initiative: item });
  }
  const title = String(b.title || '').trim();
  const item = {
    id: newId('syn'), title: title.slice(0, 300),
    category: b.category === 'cost' ? 'cost' : 'revenue',
    targetM: num(b.targetM), realizedM: num(b.realizedM),
    owner: String(b.owner || '').slice(0, 120),
    workstreamId: String(b.workstreamId || 'ws_imo').slice(0, 60),
    status: SYN_STATUSES.includes(b.status) ? b.status : 'identified', // → 'idea' under D-07/D-11
    notes: String(b.notes || '').slice(0, 600),
    createdAt: new Date().toISOString()
  };
  lane.push(item);
  writeDb(db);
  res.status(201).json({ success: true, initiative: item });
});

app.delete('/api/synergies/:id', (req, res) => {
  const db = readDb();
  const lane = synergyLane(db);
  const filtered = lane.filter(s => s.id !== req.params.id);
  if (filtered.length === lane.length) return res.status(404).json({ error: 'Initiative not found.' });
  if (db.settings && db.settings.demoMode === false) db.customSynergyInitiatives = filtered;
  else db.synergyInitiatives = filtered;
  writeDb(db);
  res.json({ success: true });
});
```

**Auth/gate pattern (D-15 re-baseline authz, D-08 stage gate) — copy this exact shape**, `server.js:790-816`:
```js
// D-03: membership edits are admin-only. ROLE_WRITE_POLICY's flat prefix
// table has no wildcard for "admin+hrbp on /api/deals in general, but
// admin-only on this one dynamic-:id-segment route" — the broader
// '/api/deals' policy entry above lets an hrbp session past the gate, so
// this handler narrows to admin-only itself via the same isAdminRequest()
// guard several existing admin-only reads already use in this file.
app.post('/api/deals/:id/members', (req, res) => {
  if (!isAdminRequest(req)) return res.status(403).json({ error: 'Only admin can manage deal membership.' });
  const dealId = req.params.id;
  const existing = controlStore.getDeal(dealId);
  if (!existing) return res.status(404).json({ error: 'Deal not found.' });
  const before = new Set(existing.members || []);
  const updated = controlStore.updateDealMembers(dealId, req.body.members);
  // ...mutation, then writeDb-equivalent, then response
});
```

`isAdminRequest()` — the exact style D-15's new `isAdminOrIlRequest()` must mirror, `server.js:468-473`:
```js
function isAdminRequest(req) {
  const supplied = req.get('X-Admin-Token') || '';
  if (ADMIN_TOKEN && supplied && timingSafeEqualStr(supplied, ADMIN_TOKEN)) return true;
  if (req.portalUser && req.portalUser.role === 'admin') return true;
  return false;
}
```
New helper to add near it (RESEARCH.md's own recommended shape, verified-consistent with this precedent):
```js
function isAdminOrIlRequest(req) {
  return !!(req.portalUser && ['admin', 'hrbp'].includes(req.portalUser.role));
}
```

**"Arrived month" check (D-06) — copy this exact shape**, `server.js:3200-3205` `computeOverdue()`:
```js
function computeOverdue(item) {
  if (!item || item.status === 'closed') return false;
  const due = item.dueDate;
  if (typeof due !== 'string' || !DD_DUE_DATE_RE.test(due)) return false;
  return due < new Date().toISOString().slice(0, 10);
}
```
Use real wall-clock `new Date()` uniformly (demo AND real-deal) — no `timeTravelDay` branch, per RESEARCH.md Finding #12.

**Error handling pattern** (matches both analogs above): `404` for missing resource (`if (!item) return res.status(404)...`), `400` for a stated validation/business-rule rejection (`return res.status(400).json({ error: '<verbatim reason>' })` — this exact string is what UI-SPEC's `window.alert(reason)` contract surfaces), `403` for authz rejection. One `writeDb(db)` call per route, at the end, after all validation.

---

### `validators/workstream.js` — extend `SynergyUpsertSchema`, add `MONTH_RE`, add 5 new sub-route schemas

**Analog:** the file's own existing registration block, `validators/workstream.js:100-131`, plus the date-validator `.refine()` idiom at `validators/dd.js:34-42`.

**Imports pattern** (top of file, already present — no changes needed):
```js
const { z } = require('zod');
const { registerSchema, EmptyBodySchema } = require('./index.js'); // adjust to actual import shape already in file
```

**Existing registration block being extended** (lines 110-131):
```js
const SYN_STATUSES = ['identified', 'validated', 'planned', 'executing', 'realized']; // → 4-value, D-07/D-11, MUST change in lockstep with server.js:3043 and public/js/execution.js:28

const SynergyUpsertSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX).optional(),
  title: z.string().trim().min(1, 'Initiative title is required.').max(NAME_MAX).optional(),
  category: z.string().trim().max(20).optional(),
  targetM: z.union([z.number(), z.string().max(20)]).optional(),
  realizedM: z.union([z.number(), z.string().max(20)]).optional(),
  owner: z.string().trim().max(NAME_MAX).optional(),
  workstreamId: z.string().trim().max(60).optional(),
  status: z.enum(SYN_STATUSES).optional(),
  notes: z.string().trim().max(TEXT_MAX).optional(),
}).refine((data) => data.id || (data.title && data.title.trim()), {
  message: 'Initiative title is required.',
  path: ['title'],
});
registerSchema('POST', '/api/synergies', SynergyUpsertSchema);
registerSchema('DELETE', '/api/synergies/:id', EmptyBodySchema);
```

**Date/month-shape `.refine()` idiom to copy for the new `MONTH_RE` validator** — `validators/dd.js:34-42, 88-91`:
```js
const DUE_DATE_SHAPE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function isValidCalendarDate(value) {
  const m = DUE_DATE_SHAPE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}
// applied via:
dueDate: z.string().trim().max(DUE_DATE_MAX)
  .refine((val) => val === '' || isValidCalendarDate(val), {
    message: 'Due date must be a valid YYYY-MM-DD calendar date.',
  }).optional(),
```
New helper (RESEARCH.md's recommended exact shape):
```js
const MONTH_SHAPE_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
function isValidMonth(value) { return MONTH_SHAPE_RE.test(value); }
```

**RAID triplication precedent (D-26) — the exact comment-style warning to replicate for the stage-vocabulary rename**, `validators/workstream.js:139-147`:
```js
// D-26: four levels — an INDEPENDENT COPY of server.js's own RAID_LEVELS
// (the RAID route handler's field guard), not a shared import. The two MUST
// move together...
const RAID_LEVELS = ['low', 'medium', 'high', 'critical'];
```

**Validation registration is mandatory-fail-closed** — every new sub-route needs its own `registerSchema()` call in the SAME commit (Pitfall 4). No error-handling excerpt needed here since a missing registration produces its own 500 automatically (`validators/index.js:330`).

---

### `public/js/execution.js` — rewrite `renderSynergy()` + stage control + new sub-sections

**Analog:** itself (same file, extend in place) — the existing `renderSynergy()` (lines 216-285), the status-cycle wraparound handler being REPLACED (lines 250-259), and the `.ex-add` mini-form pattern (used 3× already: task-add lines 181-201, synergy-add ~lines 360-370, raid-add lines 380-397).

**Module-level constants being widened (D-07/D-11 — must change in lockstep with `server.js:3043` and `validators/workstream.js:114`)**, lines 26-30:
```js
var state = { tasks: [], template: null, wsFilter: null, synergies: [], raid: [], raidFilter: null };
var SYN_STATUSES = ['identified', 'validated', 'planned', 'executing', 'realized']; // → ['idea','validated','committed','captured']
var SYN_LABELS = { identified: 'Identified', validated: 'Validated', planned: 'Planned', executing: 'Executing', realized: 'Realized' };
var SYN_COLORS = { identified: '#8a8f92', validated: '#475569', planned: '#C77700', executing: '#167987', realized: '#3f7a37' };
```

**Full current `renderSynergy()` — the render function being rewritten**, lines 216-285 (rollup card + per-card render + status-cycle + realized-input + delete handlers) — READ IN FULL above; reuse its `esc()`/`applyI18n()`/`workstreams()` helpers, its `state.synergies` array, its `fetch('/api/synergies', {method:'POST', ...})` call shape, and its `document.querySelectorAll('#syn-list .syn-card').forEach(...)` wiring-after-innerHTML-assignment idiom (must be kept identically for every new interactive element: build the whole markup string first, assign to `innerHTML`, THEN attach listeners by querying the just-assigned DOM).

**Status-cycle handler being REPLACED (D-08/D-09 stage-gate model — do not carry the wraparound forward)**, lines 250-259:
```js
card.querySelector('.syn-status').addEventListener('click', function () {
  var item = state.synergies.find(function (s) { return s.id === id; });
  if (!item) return;
  var next = SYN_STATUSES[(SYN_STATUSES.indexOf(item.status) + 1) % SYN_STATUSES.length];
  fetch('/api/synergies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, status: next }) })
    .then(function (r) { return r.json(); })
    .then(function (res) { if (res && res.success) { item.status = next; renderSynergy(); applyI18n(); } });
});
```
New stage-pill click must instead call the new `POST /api/synergies/:id/stage` route and, on a `!res.success` (400), surface `window.alert(res.error)` verbatim per UI-SPEC's Copywriting Contract error-state row — never silently no-op.

**`.ex-add` mini-form pattern — copy this exact shape for the cost-entry add form (D-20)**, lines ~360-397 (synergy-add + raid-add both shown):
```js
document.getElementById('raid-add-btn').addEventListener('click', function () {
  var title = document.getElementById('raid-new-title').value.trim();
  if (!title) return;
  fetch('/api/raid', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: document.getElementById('raid-new-type').value,
      title: title,
      severity: document.getElementById('raid-new-sev').value,
      owner: document.getElementById('raid-new-owner').value.trim()
    })
  }).then(function (r) { return r.json(); }).then(function (res) {
    if (res && res.success) {
      state.raid.push(res.entry);
      document.getElementById('raid-new-title').value = '';
      renderRaid();
    }
  });
});
```

**Delete-with-confirm pattern (reuse for cost-entry delete, D-20)**, lines 272-282:
```js
card.querySelector('.ex-del').addEventListener('click', function () {
  if (!window.confirm('Delete this initiative?')) return;
  fetch('/api/synergies/' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res && res.success) {
        state.synergies = state.synergies.filter(function (s) { return s.id !== id; });
        renderSynergy(); applyI18n();
      }
    });
});
```

**Error handling pattern:** every write handler follows `.then(res => { if (res && res.success) { ...local state update...; renderX(); applyI18n(); } })` — no `else` branch exists today for a rejected write in this file (delete/status-cycle silently no-op on failure). UI-SPEC's new Copywriting Contract explicitly requires this phase's new writes to add the missing `else { window.alert(res.error || 'failed'); }` branch — this is a NEW requirement layered onto the existing pattern, not something to copy verbatim from today's code.

---

### `public/execution.html` — new `.syn-*` CSS

**Analog:** existing `.ex-add` block, `public/execution.html:72-74`:
```css
.ex-add{ display:flex; gap:.5rem; flex-wrap:wrap; align-items:center; background:var(--card-bg,#fff); border:1px dashed var(--border-color); border-radius:10px; padding:.7rem .9rem; margin-bottom:1.5rem; }
.ex-add input, .ex-add select{ padding:.45rem .7rem; border:1.5px solid var(--border-color); border-radius:8px; font-family:inherit; font-size:.82rem; }
.ex-add input[type="text"]{ flex:1; min-width:200px; }
```
Follow this exact declaration density/shape for `.syn-grid`, `.syn-grid-row`, `.syn-grid-locked`, `.syn-stage-menu`, `.syn-baselines`, `.syn-cost-list`, `.syn-stale-badge`, `.syn-rollup-tiles` — page-local `<style>` block, not `public/css/style.css` (per UI-SPEC's stack-constraint note). Exact color/spacing values are specified in `05-UI-SPEC.md`'s Color/Spacing/Component-Contract sections — do not invent new values.

---

### `public/js/deal-home.js` — new `renderStaleSynergyNudge()`

**Analog (pattern, not a shared call):** `public/js/due-diligence.js:526-576` `renderOwnerNudge()` + `loadOwnerNudge()`.

**IMPORTANT — do not literally extend or call this function.** Per RESEARCH.md Finding #7 / Pitfall 2, `renderOwnerNudge()` is scoped to DOM selectors (`.dd-hero h1`, `.main-content`) that exist ONLY on `due-diligence.html`. Author a NEW function inside `deal-home.js`, following the PATTERN below, targeting `deal-home.js`'s own DOM (`#deal-home`'s section headings, `el()`-built nodes — see deal-home.js's own `textContent`-only, `createElement`-based idiom, NOT `execution.js`'s `innerHTML` string-concat idiom).

**Full pattern to replicate** — `public/js/due-diligence.js:526-570`:
```js
function renderOwnerNudge(mine) {
  if (!mine) return;
  var total = (mine.openItems || 0) + (mine.openFindings || 0);
  var overdue = mine.overdueItems || 0;
  if (total <= 0) return;

  var titleEl = document.querySelector('.dd-hero h1');
  if (titleEl && !document.getElementById('dd-nudge-badge')) {
    var badge = document.createElement('span');
    badge.id = 'dd-nudge-badge';
    badge.style.cssText = 'display:inline-block;margin-left:.6rem;font-size:.68rem;font-weight:800;padding:.15rem .55rem;border-radius:999px;background:#C77700;color:#fff;vertical-align:middle;';
    badge.textContent = String(total);
    titleEl.appendChild(badge);
  }

  if (document.getElementById('dd-nudge-banner')) return;
  try {
    if (sessionStorage.getItem('dd_nudge_dismissed') === 'true') return;
  } catch (e) { /* sessionStorage unavailable — fall through and still show it */ }

  var main = document.querySelector('.main-content') || document.querySelector('main');
  if (!main) return;

  var banner = document.createElement('div');
  banner.id = 'dd-nudge-banner';
  banner.className = 'page-banner page-banner--warning';
  banner.setAttribute('role', 'status');
  var body = document.createElement('div');
  body.className = 'page-banner-body';
  var msg = document.createElement('span');
  msg.className = 'page-banner-msg';
  var text = 'You have ' + total + (total === 1 ? ' open due-diligence item assigned to you' : ' open due-diligence items assigned to you');
  if (overdue > 0) text += ', ' + overdue + ' overdue';
  text += '.';
  msg.textContent = text;
  body.appendChild(msg);
  banner.appendChild(body);
  main.insertBefore(banner, main.firstChild);
  if (typeof window.makeBannerDismissible === 'function') {
    window.makeBannerDismissible(banner, 'dd_nudge_dismissed', 'session');
  }
}

function loadOwnerNudge() {
  return fetch('/api/dd/summary').then(function (r) { return r.json(); }).then(function (summary) {
    renderOwnerNudge(summary && summary.mine);
  }).catch(function () { /* best-effort — the nudge simply stays absent */ });
}
```
Adapt: `renderStaleSynergyNudge(mineStaleCount)` counting the caller's own stale-flagged synergy initiatives (mirroring `mine`-scoping — server should return a caller-scoped count, not require the client to filter), a distinct badge/banner id (`syn-stale-nudge-badge`/`syn-stale-nudge-banner`), a distinct dismissal key (`'synergy_stale_nudge_dismissed'`), and the target heading inside `deal-home.js`'s own rendered sections (e.g. append the badge onto the section title element `renderDiligence`/new-panel builds, or the container's own `<h1>` if present in `dashboard.html`'s deal-home area — verify exact selector at implementation time since `deal-home.js` currently builds no top-level heading itself, only per-panel `<h2>`s via its `el()` helper).

**`deal-home.js`'s own DOM-construction idiom (use this, not `innerHTML`)** — `public/js/deal-home.js:53-59`:
```js
function el(tag, opts) {
  var node = document.createElement(tag);
  opts = opts || {};
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  return node;
}
```
This file's own header comment states its `textContent`-only discipline explicitly (never assign markup) — the new nudge function should honor the same discipline even though it is adapting a pattern from a file (`due-diligence.js`) that uses raw `createElement`+`textContent` too (so no conflict — both already avoid `innerHTML`).

**Wiring into the existing fetch chain** — `public/js/deal-home.js:190-212` `renderDealHome()`'s `Promise.all([...]).then(...)` is the exact place to add a 4th fetch (`/api/synergies` or a lightweight new summary endpoint) and a 4th render call, following the same best-effort `.catch(() => fallback)` per-fetch pattern already used for the other three.

---

### `scripts/migrate-synergy-stages.js` (new one-off migration)

**Analog:** `scripts/seed-dd-request-templates.js` — confirmed pattern: `openDbFile()` (`db/dbFiles.js`) to open `DEMO_DB_PATH` directly, prepared-statement writes, `conn.pragma('wal_checkpoint(TRUNCATE)')` at line 50 before exit.

**Core pattern to copy (shape, not exact content — read the source file directly at implementation time for the literal statements):** open both `data/demo.db` and `data/ma-portal.db` via `openDbFile()`, `SELECT`/rewrite each `synergyInitiatives` row's `status`→`stage` per the D-07 map, hand-tune per D-10, rewrite each `.db`'s `app_state['i18n']` row to add `syn.st_idea`/`syn.st_committed` and retire the 3 obsolete keys × 4 languages, then **end with `conn.pragma('wal_checkpoint(TRUNCATE)')` before `conn.close()`** — this is the exact step that prevents the WAL trap (Pitfall 3) from silently swallowing the migration.

**Error handling:** none needed beyond a top-level try/catch that logs and exits non-zero — this is an operator-run script, not a request handler; no response-formatting concerns.

---

### `test/synergy-*.test.js` (5 new files)

**Analog:** `test/dd-findings.test.js` — full harness read above (lines 1-68).

**Imports + isolated-DB-trio bootstrap pattern — copy verbatim, changing only the temp-dir prefix**, lines 20-43:
```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-synergy-<name>-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = '';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const auditHook = require('../db/auditHook.js');

const app = require('../server.js');
const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
```

**Inline helper-duplication convention (do NOT extract to a shared module — confirmed no `test/helpers.js` exists)**, lines 46-68:
```js
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }
function registerDeal(deal) {
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(deal.id, dealSeq++, deal.status || 'active', JSON.stringify(deal));
}
function freshDeal(id, overrides) {
  return {
    id, name: id, targetCompany: id + ' Co', members: ['karen', 'pmo'], memberGrants: {},
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(), ...overrides,
  };
}
```

**Two-identity 200/403 authz proof shape — copy this exact structure for SYN-03's D-15 re-baseline test**, `test/dd-findings.test.js:191-236` (pattern, condensed):
```js
const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
// karen (hrbp) → 200 on the privileged action
const res = await fetch(`${base}/api/synergies/${id}/rebaseline`, {
  method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
  body: JSON.stringify({ reason: 'quarterly reforecast' }),
});
assert.strictEqual(res.status, 200);
// pmo → 403 on the SAME action, SAME payload
const pmoRes = await fetch(`${base}/api/synergies/${id}/rebaseline`, {
  method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
  body: JSON.stringify({ reason: 'quarterly reforecast' }),
});
assert.strictEqual(pmoRes.status, 403);
```
This is the exact shape memory flags as the CR-01 lesson: prove the refusal is on the AUTHZ axis by using the identical payload against two identities, not by mutating the payload.

## Shared Patterns

### Server-side authz, never UI-only hiding (DD-04 precedent)
**Source:** `server.js:790-797` (comment) + `server.js:468-473` (`isAdminRequest()`)
**Apply to:** the new `POST /api/synergies/:id/rebaseline` route (D-15) — the client-side button-hiding in `execution.js` (per UI-SPEC §3, gated on `window.__portalUser.role`) is cosmetic only; the route itself must independently reject via a server-side inline check (`isAdminOrIlRequest()`), never trusting the client's decision to show/hide the button.

### Fail-closed request validation (VAL-01)
**Source:** `validators/index.js:318-339` (`validationMiddleware`, quoted fail-closed error message)
**Apply to:** every one of the 5 new sub-routes plus the extended `SynergyUpsertSchema` — a route with no `registerSchema()` call 500s automatically; this is a forcing function, not optional hygiene. Land the schema registration in the SAME commit/task as the route.

### Automatic audit trail via whole-row `writeDb()` serialization
**Source:** `db/store.js:287-389` (`writeDb()`'s before/after whole-row JSON diff, quoted in RESEARCH.md Finding #8)
**Apply to:** all new fields/arrays (`phasing[]`, `baselines[]`, `costEntries[]`, `taskIds[]`, `lastConfirmedAt`) — zero new audit code required; `writeDb(db)` already captures every new key automatically.

### Triplicated-enum lockstep discipline (D-26 RAID precedent)
**Source:** `validators/workstream.js:139-147` (comment on `RAID_LEVELS`)
**Apply to:** the D-07/D-11 stage-vocabulary rename across all three copies (`server.js:3043`, `validators/workstream.js:114`, `public/js/execution.js:28-30`) — change all three in the SAME task/commit; never a 4th independent copy anywhere new code is added.

### `.ex-add` mini-form (used 3× already: task-add, synergy-add, raid-add)
**Source:** `public/js/execution.js:181-201` (task-add), `~360-370` (synergy-add), `380-397` (raid-add); CSS at `public/execution.html:72-74`
**Apply to:** the new cost-entry add form (D-20) — reuse this exact form/CSS/handler shape, no new form pattern invented (UI-SPEC's own Component Contract §4 states this explicitly).

### Deal-scoped `settings` singleton (`app_state` table)
**Source:** `db/dealSeed.js:91-102`, `db/collections.js:16,60-66`
**Apply to:** D-03's `synergyHorizonYears` (default 3) and D-17's `synergyStaleDays` (default 30) — add as two new optional fields on the per-deal `settings` singleton, read via `db.settings.synergyStaleDays || 30`; also requires adding both keys to `validators/settings.js`'s `SettingsUpdateSchema` (`validators/settings.js:65-86`) or they will be silently stripped (zod `z.object` strips unknown keys by default).

## No Analog Found

None — every file this phase touches has a same-repo, same-session-verified analog (per RESEARCH.md's exhaustive Verified Ground-Truth Findings). The one genuinely greenfield piece is the ramp auto-fill percentage math itself (D-05's curve generation) — RESEARCH.md confirms "no analog yet" for this specific algorithm (Architecture Patterns section); it should be implemented as three fixed lookup tables per D-05's named checkpoints, not modeled after any existing code (there is none to model after), but its *housing* (a new sub-route following Pattern 1) does have an analog.

## Metadata

**Analog search scope:** `server.js` (synergy + deals + DD sections), `validators/workstream.js`, `validators/dd.js`, `validators/settings.js`, `public/js/execution.js`, `public/js/due-diligence.js`, `public/js/deal-home.js`, `public/execution.html`, `db/store.js`, `db/dealSeed.js`, `db/collections.js`, `scripts/seed-dd-request-templates.js`, `test/dd-findings.test.js`, `test/role-enforcement.test.js`
**Files scanned:** 14 (all read in full or targeted-range this session; no re-reads of already-loaded ranges)
**Pattern extraction date:** 2026-08-06
