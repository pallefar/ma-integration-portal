# Phase 4: Due Diligence Workspace - Pattern Map

**Mapped:** 2026-08-02
**Files analyzed:** 14 (new/modified)
**Analogs found:** 12 / 14

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `db/accessPolicy.js` (NEW) | utility/middleware | request-response (access-control filter) | `db/resolver.js` (uniform-403 pattern) | role-match (no direct analog for a *filter* module; resolver is the closest access-control precedent) |
| `validators/dd.js` (NEW) | validator/config | request-response | `validators/deals.js` | exact |
| `validators/wizard.js` (NEW) | validator/config | request-response | `validators/deals.js` | exact |
| `db/collections.js` (MODIFIED — add 3 collections, bump count) | config | CRUD (registration) | itself (existing file, extend in place) | exact |
| `db/dealSeed.js` (MODIFIED — add `ddRequestTemplates` to allowlist) | config/service | batch (seed-copy) | itself (existing file, extend in place) | exact |
| `server.js` — `POST /api/dd/request-items`, `GET /api/dd/request-items`, `PATCH /api/dd/request-items/:id` (NEW routes) | controller/route | CRUD | `server.js:2687-707` (`POST /api/deals`) + `server.js:2759-2794` (`POST /api/raid`, upsert-by-id pattern) | exact (upsert) / role-match (create) |
| `server.js` — `POST /api/dd/request-items/instantiate` (NEW route) | controller/route | batch (template→instance) | `server.js:2598-2625` (`POST /api/integration-tasks/instantiate`) | exact |
| `server.js` — `POST /api/dd/findings`, `GET /api/dd/findings`, `PATCH /api/dd/findings/:id` (NEW routes) | controller/route | CRUD | `server.js:2759-2794` (`POST /api/raid`) | exact |
| `server.js` — `POST /api/dd/findings/:id/convert` (NEW route) | controller/route | event-driven (one-click derived-record creation) | `server.js:2634-2665` (`POST /api/integration-tasks/from-remediation`) | role-match (pattern-reuse per D-12/Pitfall 6, not literal endpoint reuse) |
| `server.js` — `POST /api/deals/:id/grants`, `POST /api/deals/:id/grants/revoke` (NEW routes, D-02) | controller/route | event-driven (security event) | `server.js:749-769` (`POST /api/deals/:id/members`) | exact |
| `server.js` — `POST /api/deals/:id/vdr-grants` (NEW route, D-18) | controller/route | event-driven (security event) | `server.js:749-769` (`POST /api/deals/:id/members`) + `db/auditHook.js#recordSecurityEvent` | exact |
| `server.js` — `POST /api/assessment-instances/assign` (NEW route, D-08/D-24) | controller/route | CRUD (create pending instance) | `server.js:2363-2393` (`POST /api/assessment-instances`) | role-match (new pending-status branch, not a straight copy — see Pitfall 2) |
| `server.js` — `RAID_LEVELS` extension (D-26) | config constant | — | `server.js:2752` + `validators/workstream.js:139` (duplicated constant) | exact — both copies must move together |
| `server.js` — `DD_AREA_WORKSTREAM` mapping constant (D-25) | config constant | — | `server.js:2630-2633` (`REMEDIATION_WS`) | exact |
| `public/deal-wizard.html` (NEW) | page/template | request-response (multi-step form) | `public/pmo.html:41-171` (Custom M&A Setup Wizard markup) | exact |
| `public/js/deal-wizard.js` (NEW) | controller/state-machine | request-response (step-by-step validated POSTs) | `public/js/pmo.js:956-1024` (`switchWizStep`, wizard state) | exact |
| `public/js/deal-switcher.js` (MODIFIED — "+ New real deal" navigates to wizard, D-06) | component | request-response | itself (existing `openCreateDealForm()` at line 40, being superseded) | exact |
| `public/js/dashboard.js` (MODIFIED — deal-bound home, D-19) | component/page-controller | request-response (greenfield render branch) | **No close analog — see "No Analog Found."** | none |
| `public/js/admin.js` (MODIFIED — extend Deals tab with grants UI) | component | CRUD | `public/js/admin.js:2485-2534` (`editDealMembers`) | exact |
| `test/dd-access-policy.test.js`, `test/dd-workspace.test.js`, `test/deal-wizard.test.js` (NEW) | test | — | `test/write-validation-coverage.test.js` + existing `test/*.test.js` (`node:test`) style | exact |

## Pattern Assignments

### `db/accessPolicy.js` (utility, request-response filter) — DD-04

**Analog:** `db/resolver.js` (uniform-403 shape) + `db/controlStore.js#isDealMember` (membership-lookup shape)

**Core pattern to copy — uniform 403, never a distinguishing 404** (`db/resolver.js:88-99`):
```javascript
// WR-02: a uniform 403 for BOTH "deal missing/archived" and "not a
// member" — matching POST /api/deals/select's own documented
// anti-enumeration rule.
const deal = controlStore.getDeal(dealId);
if (!deal || deal.status === 'archived' || !controlStore.isDealMember(dealId, req.portalUser)) {
  throw new DealAccessError(403, 'You are not a member of that deal.');
}
```

**Membership-lookup shape to mirror** (`db/controlStore.js:107-113`):
```javascript
function isDealMember(dealId, user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const deal = getDeal(dealId);
  if (!deal) return false;
  return Array.isArray(deal.members) && deal.members.includes(user.username);
}
```

**Recommended new shape** (per D-23/Pitfall 3 — additive, does NOT touch `deal.members`):
```javascript
// deal.memberGrants: { [username]: { ddAreas: string[] } }
function hasAreaGrant(deal, username, area) {
  if (!deal) return false;
  const grants = deal.memberGrants && deal.memberGrants[username];
  return Array.isArray(grants && grants.ddAreas) && grants.ddAreas.includes(area);
}
function filterByAreaGrant(items, deal, user) {
  if (user.role === 'admin') return items; // IL/admin see everywhere per D-16
  return items.filter(item => hasAreaGrant(deal, user.username, item.area));
}
```
**D-03 invisibility vs D-04 denial:** `filterByAreaGrant()` is used for LIST responses (silently omits uncleared areas — no enumeration). A direct-by-id read/write must call a throwing variant that also fires `recordSecurityEvent('dd-access-denied', ...)` on failure — do not reuse the same function for both call shapes without an explicit audit call site at the throw point.

---

### `validators/dd.js`, `validators/wizard.js` (validator, request-response)

**Analog:** `validators/deals.js` (full file — this is the exemplar the project's own header comments point to)

**Imports + schema + registration pattern** (`validators/deals.js:21-42, 77-81`):
```javascript
const { z } = require('zod');
const { formatIssues, validateBody, registerSchema } = require('./index');

const CreateDealSchema = z.object({
  name: z.string().trim().min(1, 'Deal name is required.').max(NAME_MAX, `...`),
  targetCompany: z.string().trim().min(1, '...').max(NAME_MAX, `...`),
  members: z.array(z.string().trim().min(1).max(USERNAME_MAX)).default([]),
});

registerSchema('POST', '/api/deals', CreateDealSchema);
```
Every new DD/wizard write route (`/api/dd/request-items`, `/api/dd/findings`, `/api/dd/findings/:id/convert`, `/api/deals/:id/grants`, `/api/assessment-instances/assign`, wizard step routes) needs exactly this: a `z.object({...})` schema + one `registerSchema('METHOD', 'path', Schema)` call, or `test/write-validation-coverage.test.js` fails the suite by construction (confirmed enforcement, not a convention).

**Enum pattern to copy for `area`/`severity`/`status` fields** — use `z.enum([...])` mirroring `validators/workstream.js`'s `RaidUpsertSchema` (read that file's `RAID_LEVELS`/status enum usage directly, lines ~130-145, for the exact `z.enum()` call shape).

---

### `db/collections.js` (config, registration) — DD-01/DD-02/D-13

**Analog:** itself — extend the existing `ARRAY_COLLECTIONS` array and bump the completeness assertion in the SAME commit.

**Exact pattern** (`db/collections.js:17-64`):
```javascript
const ARRAY_COLLECTIONS = [
  'alerts', 'assessmentInstances', /* ... */,
  // ADD:
  'ddRequestItems', 'ddFindings', 'ddRequestTemplates',
];
// ...
if (ARRAY_COLLECTIONS.length !== 32) {   // MUST become 35 in the same commit
  throw new Error(`db/collections.js: expected 32 array collections, got ${ARRAY_COLLECTIONS.length}`);
}
```
`COLLECTION_TARGETS` auto-derives `'demo'` for every array entry via the existing `for (const key of ARRAY_COLLECTIONS) COLLECTION_TARGETS[key] = 'demo';` loop — no separate edit needed there, but `ddRequestTemplates`/`ddRequestItems`/`ddFindings` are deal-DB-native collections (created via `db/dealSeed.js`'s schema, not through the demo/control/runtime split script) — confirm with the deal-schema pattern in `db/schema.sql`, not this split-target map, for their actual table creation.

---

### `db/dealSeed.js` (service, batch/template-copy) — D-13

**Analog:** itself — extend `DEAL_SEED_COLLECTIONS`.

**Exact pattern** (`db/dealSeed.js:25`):
```javascript
const DEAL_SEED_COLLECTIONS = ['checklistTemplates', 'assessmentTemplates', 'processCatalog', 'ddRequestTemplates'];
```
This is the ONLY change needed for seeding — `createDealDatabase()`'s existing loop (lines 45-104) already iterates whatever is in this allowlist. Do not touch the loop body.

---

### `server.js` — new DD request-item routes (DD-01)

**Analog A — create-with-security-event shape:** `server.js:687-707` (`POST /api/deals`)
**Analog B — upsert-by-id-or-create shape:** `server.js:2759-2794` (`POST /api/raid`)

**Upsert pattern to copy verbatim** (`server.js:2759-2794`):
```javascript
app.post('/api/raid', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const lane = raidLane(db);
  if (b.id) {
    const item = lane.find(r => r.id === b.id);
    if (!item) return res.status(404).json({ error: 'Entry not found.' });
    if (b.title !== undefined && !String(b.title).trim()) {
      return res.status(400).json({ error: 'Entry title cannot be empty.' });
    }
    ['title', 'owner', 'workstreamId', 'notes'].forEach(k => { if (b[k] !== undefined) item[k] = String(b[k] || '').slice(0, 300); });
    if (b.type !== undefined && RAID_TYPES.includes(b.type)) item.type = b.type;
    if (b.severity !== undefined && RAID_LEVELS.includes(b.severity)) item.severity = b.severity;
    if (b.status !== undefined) item.status = b.status;
    writeDb(db);
    return res.json({ success: true, entry: item });
  }
  const title = String(b.title || '').trim();
  const item = { id: newId('raid'), /* ...fields with enum-guarded defaults... */ };
  lane.push(item);
  writeDb(db);
  res.json({ success: true, entry: item });
});
```
Apply the SAME shape to `ddRequestItems`: a flat `ddRequestLane(db)` helper (per Anti-Pattern note below — NO demoMode branch), enum-guarded `area`/`status` fields, `overdue` computed at read time (D-15) rather than stored.

**Lane-helper anti-pattern warning** (from RESEARCH.md, verified against every existing lane helper e.g. `synergyLane`/`raidLane` at `server.js:2675-2679`, `2745-2749`):
```javascript
// DO NOT copy this branch into new DD lane helpers — it is demo-mode-only
// and structurally inert inside a real deal's own database file:
function raidLane(db) {
  const isCustom = db.settings && db.settings.demoMode === false;
  if (isCustom) { db.customRaidEntries = db.customRaidEntries || []; return db.customRaidEntries; }
  db.raidEntries = db.raidEntries || [];
  return db.raidEntries;
}
// COPY THIS INSTEAD (flat, no branch):
function ddRequestLane(db) {
  db.ddRequestItems = db.ddRequestItems || [];
  return db.ddRequestItems;
}
```

---

### `server.js` — `POST /api/dd/request-items/instantiate` (D-13 template→instance)

**Analog:** `server.js:2598-2625` (`POST /api/integration-tasks/instantiate`) — copy verbatim, substituting collections.
```javascript
app.post('/api/integration-tasks/instantiate', (req, res) => {
  const { checklistTemplateId } = req.body || {};
  const db = readDb();
  const tpl = (db.checklistTemplates || []).find(t => t.id === checklistTemplateId);
  if (!tpl) return res.status(404).json({ error: 'Checklist template not found.' });
  const lane = taskLane(db);
  const created = [];
  (tpl.items || []).forEach(item => {
    const source = 'template:' + tpl.id + ':' + item.id;
    if (lane.some(t => t.source === source)) return;
    // ... build + push task
  });
  if (created.length) writeDb(db);
  res.json({ success: true, created: created.length });
});
```
`POST /api/dd/request-items/instantiate` follows this exact dedup-by-`source` shape against `ddRequestTemplates` → `ddRequestItems`.

---

### `server.js` — `POST /api/dd/findings/:id/convert` (DD-03)

**Analog for the dedup/bidirectional-link PATTERN (not the literal route):** `server.js:2630-2665` (`POST /api/integration-tasks/from-remediation`)
```javascript
const REMEDIATION_WS = {
  dim_governance: 'ws_imo', dim_people: 'ws_hr', /* ... */
};
app.post('/api/integration-tasks/from-remediation', (req, res) => {
  const { assessmentTemplateId } = req.body || {};
  // ...
  (tpl.remediation || []).forEach(r => {
    const source = 'remediation:' + tpl.id + ':' + r.dimensionId;
    if (lane.some(t => t.source === source)) return;
    const task = { id: newId('task'), title: r.advice, workstreamId: REMEDIATION_WS[r.dimensionId] || 'ws_imo', source, /* ... */ };
    lane.push(task); created.push(task);
  });
  if (created.length) writeDb(db);
  res.json({ success: true, created: created.length });
});
```
**Per Pitfall 6, build a NEW route, not a call into this one.** `POST /api/dd/findings/:id/convert` should: (1) look up the finding by id, (2) build `source: 'dd-finding:' + finding.id'`, (3) dedup against `taskLane(db)`/`raidLane(db)` by that source string, (4) write BOTH directions — the created task/RAID entry gets `source`, the finding gains `linkedTaskId`/`linkedRaidId`. Use the `DD_AREA_WORKSTREAM` constant (D-25, mirroring `REMEDIATION_WS`'s literal-object shape) for `workstreamId`.

---

### `server.js` — grant/revoke/VDR-grant/denial security events (D-02/D-18/DD-04)

**Analog:** `server.js:749-769` (`POST /api/deals/:id/members`) — the admin-only membership-edit + security-event pattern.
```javascript
app.post('/api/deals/:id/members', (req, res) => {
  if (!isAdminRequest(req)) return res.status(403).json({ error: 'Only admin can manage deal membership.' });
  const dealId = req.params.id;
  const existing = controlStore.getDeal(dealId);
  if (!existing) return res.status(404).json({ error: 'Deal not found.' });
  const before = new Set(existing.members || []);
  const updated = controlStore.updateDealMembers(dealId, req.body.members);
  const after = new Set(updated.members || []);
  auditHook.recordSecurityEvent({
    actor: req.portalUser, action: 'deal-members-update', dealId, subject: dealId,
    before: Array.from(before), after: Array.from(after), request: requestMeta(req),
  });
  res.json({ success: true, deal: updated });
});
```
D-02 note: grants/revokes are **IL + admin**, not admin-only — the `isAdminRequest(req)` guard here must be widened to also allow the deal's IL (check the resolved `req.portalUser.role` / IL identification the app already uses elsewhere, not copied verbatim).

`db/auditHook.js#recordSecurityEvent()` call shape (`db/auditHook.js:126-141`) — copy exactly for `grant-area`/`revoke-area`/`vdr-access-grant`/`dd-access-denied`:
```javascript
auditHook.recordSecurityEvent({
  actor: req.portalUser, action: 'deal-create', dealId: deal.id, subject: deal.id,
  before: null, after: deal, request: requestMeta(req),
});
```
Note: `recordSecurityEvent()` throws if `actor.username` is missing (`db/auditHook.js:97-99`) — by design, no new handling needed since every DD route runs behind the resolver which always resolves a real actor for a deal-bound request.

---

### `server.js` — `POST /api/assessment-instances/assign` (D-08/D-24, pending instance)

**Analog:** `server.js:2363-2393` (`POST /api/assessment-instances`) — same collection (`assessmentInstances`), NEW status branch, not a copy of the scoring logic.
```javascript
app.post('/api/assessment-instances', (req, res) => {
  const { templateId, rater, respondentName, respondentRole, responses, retakeOf } = req.body || {};
  const db = readDb();
  const template = (db.assessmentTemplates || []).find(t => t.id === templateId);
  if (!template) return res.status(404).json({ error: 'Assessment template not found.' });
  const scoresBlock = scoreAssessmentInstance(template, responses);
  const instance = { id: newId('ainst'), templateId, /* ... */, responses, ...scoresBlock, status: 'submitted', timestamp: new Date().toISOString() };
  assessLane(db).push(instance);
  writeDb(db);
  res.status(201).json({ success: true, instance: publicAssessInstance(instance) });
});
```
**New route per D-24:** `POST /api/assessment-instances/assign` creates a response-less instance with `owner`, `dueDate`, `status: 'pending'` (no `scoreAssessmentInstance()` call — there are no responses yet). The EXISTING submit route (`POST /api/assessment-instances`) must gain a `matchInstanceId`-style parameter so completing a pending instance updates it BY ID (status → `'submitted'`, responses + scores attached) rather than creating a second row — this is a real code change to the existing route, not just a new one; flag it explicitly in the plan's task list.

---

### `server.js` — `RAID_LEVELS` extension (D-26)

**Analog:** the two duplicated definitions themselves.
```javascript
// server.js:2752
const RAID_LEVELS = ['low', 'medium', 'high'];
// validators/workstream.js:139 (grep-verified duplicate, NOT a shared constant)
const RAID_LEVELS = ['low', 'medium', 'high'];
```
Change BOTH to `['low', 'medium', 'high', 'critical']` in the same commit — they are two independent copies, not one shared import.

---

### `server.js` — `DD_AREA_WORKSTREAM` mapping constant (D-25)

**Analog:** `server.js:2630-2633` (`REMEDIATION_WS`) — copy the flat-object-literal shape exactly.
```javascript
const REMEDIATION_WS = {
  dim_governance: 'ws_imo', dim_people: 'ws_hr', dim_culture: 'ws_hr',
  dim_systems: 'ws_it', dim_commercial: 'ws_sales', dim_day1: 'ws_imo'
};
```
New constant (values locked by D-25):
```javascript
const DD_AREA_WORKSTREAM = {
  legal: 'ws_legal', financial: 'ws_finance', tax: 'ws_finance', hr: 'ws_hr',
  it: 'ws_it', commercial: 'ws_sales', operations: 'ws_ops', complianceEsg: 'ws_legal',
};
```

---

### `public/deal-wizard.html` + `public/js/deal-wizard.js` (D-06, WIZ-01)

**Analog:** `public/pmo.html:41-171` (markup) + `public/js/pmo.js:956-1024` (state machine)

**Markup structure to copy** (`public/pmo.html:42-58`):
```html
<div id="pmo-onboarding-wizard" class="card card-glass" style="display: none; border-top: 5px solid var(--te-orange); ...">
  <div class="wizard-header">...<h2 id="wizard-title">Custom M&amp;A Setup Wizard</h2></div>
  <div class="wizard-step-badge">Step <span id="current-step-num">1</span> of 4</div>
  <div class="wizard-progress-bar-container">
    <div id="wizard-step1-fill" style="... background: var(--te-orange); ..."></div>
    <div id="wizard-step2-fill" style="... background: var(--border-color); ..."></div>
    <!-- one -fill div per step -->
  </div>
</div>
<div class="wizard-step" id="wizard-step-1" style="display: block;">...</div>
<div class="wizard-step" id="wizard-step-2" style="display: none;">...</div>
```

**State-machine to copy** (`public/js/pmo.js:963-982`):
```javascript
let currentWizStep = 1;
function switchWizStep(stepNum) {
  currentWizStep = stepNum;
  document.getElementById('current-step-num').textContent = stepNum;
  document.querySelectorAll('.wizard-step').forEach(step => { step.style.display = 'none'; });
  document.getElementById(`wizard-step-${stepNum}`).style.display = 'block';
  for (let i = 1; i <= 4; i++) {
    const fill = document.getElementById(`wizard-step${i}-fill`);
    if (fill) fill.style.backgroundColor = i <= stepNum ? 'var(--te-orange)' : 'var(--border-color)';
  }
}
```
For deal-wizard.js: D-07 (validate-on-step-advance) means the step-N "Next" handler must `fetch()` that step's own endpoint FIRST, only calling `switchWizStep(next)` on a 2xx; on 400, render the zod error strings (already field-path-prefixed per `formatIssues()`) inline next to the matching field instead of duplicating client-side validation rules — do not port `pmo.js`'s own client-side survey-scoring logic (`calculatedScores` etc.), which is demo-only and out of scope here.

Full-page vs modal note: this is a NEW standalone page (`deal-wizard.html`), not a card embedded in an existing page like `pmo-onboarding-wizard` is — copy the wizard-step/progress-bar CSS classes and JS state-machine shape, not the embedding.

---

### `public/js/deal-switcher.js` (MODIFIED — repoint "+ New real deal")

**Analog:** itself — `openCreateDealForm()` (lines 40-99+) is the modal being superseded per D-06.

**Current entry point to repoint** (`public/js/deal-switcher.js:218` area, `createItem.textContent = '+ New real deal'`):
```javascript
createItem.textContent = '+ New real deal';
// current: opens openCreateDealForm() modal (lines 40-99)
// NEW: navigate to /deal-wizard.html instead
```
Keep `openCreateDealForm()`'s field-building pattern (`nameInput`/`targetInput`/`membersInput`, lines 66-98) as the reference for wizard step-1's basics-form fields — same validation bounds (`maxLength = 200` for name/target) should carry over into `validators/wizard.js`'s zod schema.

---

### `public/js/admin.js` (MODIFIED — extend Deals tab with `ddAreas` grants UI)

**Analog:** `public/js/admin.js:2485-2534` (`editDealMembers`)
```javascript
const typed = window.prompt('Members (comma-separated usernames):', (d.members || []).join(', '));
if (typed === null) return;
const members = typed.split(',').map(s => s.trim()).filter(Boolean);
fetch('/api/deals/' + encodeURIComponent(d.id) + '/members', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ members }),
})
  .then(/* ok/body */)
  .then(({ ok, body }) => {
    if (!ok) { alert(body.error || 'Failed to update deal membership.'); return; }
    if (window.adminToast) window.adminToast('Deal membership updated.');
  });
```
Follow the same `window.prompt`-based inline-editor precedent + `membersBtn` button-append pattern (lines 2531-2534) for a new "Grants" button per member row, POSTing to the new `/api/deals/:id/grants` route.

---

## Shared Patterns

### Zod validation registration (applies to EVERY new write route this phase)
**Source:** `validators/deals.js` (whole file, exemplar)
**Apply to:** `validators/dd.js`, `validators/wizard.js` — every DD/wizard POST/PATCH route
```javascript
const Schema = z.object({ /* fields with .trim()/.max()/.enum() */ });
registerSchema('METHOD', '/api/path', Schema);
```
Enforced by `test/write-validation-coverage.test.js` — an unregistered route fails the suite, not a silent gap.

### Security-event audit logging (D-02/D-18/DD-04)
**Source:** `db/auditHook.js#recordSecurityEvent` + `server.js:702-705` call-site pattern
**Apply to:** grant, revoke, vdr-access-grant, dd-access-denied
```javascript
auditHook.recordSecurityEvent({
  actor: req.portalUser, action: '<name>', dealId, subject: <id>,
  before: <prior-or-null>, after: <new-or-null>, request: requestMeta(req),
});
```
Ordinary DD CRUD (request-item/finding creates/edits) needs NO explicit audit call — `db/store.js#writeDb()`'s existing hook covers it automatically for any `'deal'`-kind resolved database.

### Uniform-403 anti-enumeration (DD-04/D-03)
**Source:** `db/resolver.js:88-99`
**Apply to:** any direct-by-id DD read/write that fails the access-policy check — never a distinct 404-vs-403.

### Blob-per-row collection shape (DD-01/DD-02/D-13)
**Source:** `db/schema.sql:25-30` (`alerts` table, representative)
**Apply to:** `ddRequestItems`, `ddFindings`, `ddRequestTemplates` — `(id, project_id, seq, data)`, no normalized columns.

### Flat lane-helper, no demoMode branch
**Source:** anti-pattern documented against `raidLane`/`synergyLane` (`server.js:2745-2749`, `2675-2679`)
**Apply to:** any new `ddRequestLane(db)`/`ddFindingsLane(db)` helper — `db.ddRequestItems = db.ddRequestItems || []; return db.ddRequestItems;` with NO `isCustom`/`demoMode` branch.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `public/js/dashboard.js` deal-bound home branch (D-19) | component/page-controller | request-response | Verified via grep (`dealId\|isDemo\|deal-switcher\|demoMode` → zero matches in dashboard.js) — genuinely greenfield, no deal-aware rendering exists anywhere in this file today. Build as new sections (setup checklist, assessment-completion rollup, DD-progress-by-area panel) fetching `/api/auth/me` for `dealId` (same call `deal-switcher.js:244` already makes), not a retrofit of existing demo panels. |
| Need-to-know filter module shape itself (`db/accessPolicy.js`) | utility | request-response | No prior module in this codebase is a standalone "read this collection, filter by a per-user grant" utility — closest precedents (`db/resolver.js`'s bind-time check, `db/controlStore.js#isDealMember`) are deal-level, not row/area-level. Treat as new code following the *style* (uniform-403, no enumeration) of those two, not a structural copy. |

## Metadata

**Analog search scope:** `db/`, `validators/`, `server.js` (deal/assessment/task/RAID/synergy sections), `public/js/{deal-switcher,pmo,admin,dashboard}.js`, `public/pmo.html`, `db/schema.sql`
**Files scanned:** 12 read in full or targeted ranges this session (see file paths above); `server.js` read across 4 non-overlapping ranges (688-819, 2330-2429, 2590-2689, 2740-2794)
**Pattern extraction date:** 2026-08-02
