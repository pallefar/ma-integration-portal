# Phase 4: Due Diligence Workspace - Research

**Researched:** 2026-08-02
**Domain:** DD request/findings workspace + guided deal-setup wizard, layered on Phase 3's deal-resolver/audit/validation foundation
**Confidence:** HIGH (implementation mechanics — everything reuses verified Phase 3 code paths) / MEDIUM (DD checklist content — synthesized from general M&A practice, not a single authoritative source)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Clean-room access model**
- **D-01:** Need-to-know is modeled as **per-deal area grants on the member record** — each deal member entry grows a `ddAreas: []` list. NO new global roles. — Reversibility: costly.
- **D-02:** Grants/revokes are made by **IL + admin**, deal-scoped; every grant/revoke is recorded as a D-08 security event in the audit log.
- **D-03:** A member without need-to-know for an area experiences **invisibility, not a lock**: uncleared areas are omitted from list responses server-side (no enumeration); direct API probes get the uniform 403 and the **denial itself is audited**.

**New-deal setup wizard (WIZ-01)**
- **D-04:** v1-mandatory wizard core: **deal basics → team/access → readiness-assessment kickoff**. Workstream scope, timeline markers, VDR/DD kickoff are skippable-with-nudge, completable later from a deal-home setup checklist.
- **D-05:** **Create early, resume later** — the deal is created (and audited) after Basics+Team; remaining steps become a setup checklist on the deal home. No all-or-nothing wizard transaction.
- **D-06:** The wizard is a **full-page flow** (IL/admin only) with a step rail; "+ New real deal" in the switcher navigates there. Model on the demo side's existing intake-wizard pattern. The Phase-3 minimal create-deal modal is superseded by this flow.
- **D-07:** Wizard validation: **validate on step-advance** — "Next" submits the step, server zod errors render inline next to their fields, step hard-blocks until valid. One validation source of truth.

**Readiness assessments in the wizard**
- **D-08:** The assessment step is **mandatory and creates all three instances** — acquirer-org readiness + target-org readiness + IL readiness — with owners and due dates assigned in the wizard. Templates are already seeded into every deal by Phase 3's D-06 template-only seeding.
- **D-09:** Gating is **create + assign, track on deal home** — the deal is usable (DD can start) immediately; deal home shows assessment completion prominently until done. NO hard lock on assessment completion.

**DD lists & findings structure**
- **D-10:** Functional areas use a **dedicated DD area list**: Legal, Financial, Tax, HR, IT, Commercial, Operations, Compliance/ESG. This is the clean-room access unit and the list-organization unit. Areas map to ws_* workstreams at conversion time. — Reversibility: costly.
- **D-11:** Findings carry **RAID-consistent severity** (critical/high/medium/low) so converted findings pass severity straight into RAID entries.
- **D-12:** Conversion (DD-03) is **one-click, linked both ways**: buttons on a finding create a pre-filled Day-1 task and/or RAID entry via the existing `from-remediation` linkage; the finding keeps references to what it spawned and vice versa.
- **D-13:** New deals get a **seeded standard DD request checklist** (curated common M&A diligence items, ~8–15 per area) via the D-06 template mechanism; the IL prunes/extends per deal.
- **D-14:** Request items use the **full request lifecycle**: open → requested → received → reviewed → closed, plus a `blocked` flag.
- **D-15:** **Overdue is computed** (due date vs status), never a manual flag — highlighted in area lists and rolled up on the deal home.
- **D-16:** Contributor model: **area-cleared members contribute** — any member with the area grant can add/edit items and findings in that area and update status on items they own; IL+admin everywhere. Every write is audited regardless.

**VDR references & access grants (DD-05)**
- **D-17:** VDR links attach **per request-item** (URL + folder/index ref); area views aggregate their items' links. The app never stores documents.
- **D-18:** VDR access grants are **structured records** — {who, VDR area/folder ref, granted-by, date, note} — written as D-08 security events.

**Deal home & notifications**
- **D-19:** The deal home is the **existing dashboard page adapting when deal-bound** (no new route): setup checklist, assessment completion, DD progress by area with overdue rollup, replacing demo-only panels.
- **D-20:** **No activity feed this phase** — an IL-visible feed is explicitly deferred (Phase 3's D-10). Deal home shows status rollups only.
- **D-21:** Owner nudges are **in-app only** — badge + banner (reusing the existing banner system) for assigned owners while their items are open/overdue. No email until real infra exists.

**Deal archive behavior**
- **D-22:** Archived deals become a **read-only freeze with member access retained** — cleared members keep read access for post-close reference; writes are refused (the Phase-3 resolver already refuses archived-deal binds for writes). Audit trail unaffected.

### Claude's Discretion
- Exact seeded DD checklist content per area (researcher should source a standard M&A diligence request list; planner locks the item set). — **Addressed below in "Seeded DD Request Checklist Content".**
- DD data placement inside the deal database (new collections in the deal file — naming/shape follows the blob-per-row convention).
- Wizard step-rail UI details and deal-home panel layout (vanilla-JS conventions, existing glassmorphism styles).
- How `ddAreas` grants interact with the admin Deals tab UI (extend the existing tab).

### Deferred Ideas (OUT OF SCOPE)
- IL-scoped audit/activity feed on the deal home (deferred again; Phase 3 D-10 deferral upheld by D-20).
- Email notifications for owners (needs real mail infra; shared-host milestone).
- Configurable per-deal DD area taxonomy (rejected for v1; fixed list per D-10).
- Live client-side wizard validation rules (rejected duplicate rule set per D-07).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DD-01 | IL creates/manages DD request lists organized by functional area, each item with owner/status/due date | New `ddRequestItems` blob-per-row collection (Architecture Patterns); lifecycle enum + overdue computation (Pitfalls); seeded checklist content below |
| DD-02 | IL records DD findings with severity, functional area, owner | New `ddFindings` collection; severity enum MUST match RAID's (see Pitfall: RAID severity gap) |
| DD-03 | Finding converts to Day-1 task and/or RAID entry via `from-remediation` linkage | Existing `/api/integration-tasks/from-remediation` route pattern generalized — see Pitfall: the existing route is assessment-specific, not directly reusable as-is |
| DD-04 | Clean-room restriction: only need-to-know users read an area's items/findings, server-side, with denials audited | `ddAreas` grant model (D-01), reuse of resolver's uniform-403 anti-enumeration pattern (WR-02 precedent), `recordSecurityEvent()` for denials |
| DD-05 | VDR link-out + access-grant record, no document storage | Per-item `vdrLink` field + `recordSecurityEvent()`-backed grant records (D-17/D-18) |
| WIZ-01 | Guided new-deal setup wizard: basics, team, readiness kickoff, scope, timeline | pmo.html's existing "Custom M&A Setup Wizard" stepper pattern (Code Examples); new pending-assessment-instance capability gap (Pitfalls) |
</phase_requirements>

## Summary

Phase 4 is almost entirely an *extension* of Phase 3's already-built, already-tested machinery — there is no new storage engine, no new auth model, and no new package to vet. Every DD collection (`ddRequestItems`, `ddFindings`, `dealMemberGrants` or equivalent) follows the exact blob-per-row `(id, project_id, seq, data)` shape `db/schema.sql` already defines for every other collection, gets registered in `db/collections.js`'s `ARRAY_COLLECTIONS`, and is added to `db/dealSeed.js`'s `DEAL_SEED_COLLECTIONS` allowlist if (and only if) it needs template seeding (the DD checklist templates do; live `ddRequestItems`/`ddFindings` instances do not — they start empty per deal, same as `integrationTasks`). Every new write route registers a zod schema in a new `validators/dd.js` (and `validators/wizard.js`) module via `registerSchema()`, or `test/write-validation-coverage.test.js` fails the suite by construction — this is not optional, it is enforced. Every write to a real deal database is already audited automatically by `db/store.js`'s `writeDb()` hook with zero new code; only the *security events* (grants/revokes/denials, D-02/D-18) need explicit `recordSecurityEvent()` call sites, following the exact pattern Phase 3 Plan 05 established for deal-lifecycle events.

The one genuinely new architectural piece is the **need-to-know filter** (DD-04): a small, reusable server-side check — "does this member have the `ddAreas` grant for area X on this deal?" — that must run in front of every DD list/read/write handler, in front of the finding-conversion routes, and (per ROADMAP's Phase 6 dependency note) should be built as a small standalone module so Phase 6's flight-risk register can reuse the exact same pattern rather than re-inventing it. Two real, non-obvious gaps surfaced during code inspection that the planner must account for: (1) the existing RAID severity enum (`low`/`medium`/`high`) has no `critical` level, so DD-11's "severity passes straight into RAID" cannot literally hold without extending that enum; (2) the existing `POST /api/assessment-instances` route only creates a *completed, scored* submission — it has no concept of a pending/assigned instance with an owner and due date, which is exactly what the wizard's mandatory assessment-kickoff step (D-08) needs to create. Both are addressed in Pitfalls below with a recommended fix.

**Primary recommendation:** Extend the existing blob-per-row/validators/audit-hook machinery verbatim for every new DD/wizard write route; build the need-to-know check as one small reusable module (not inline per-route logic); extend `RAID_LEVELS` to include `critical` rather than lossy-mapping DD severity down to RAID's 3-level scale; and add a genuinely new "pending assessment instance" capability (owner/dueDate/status fields) rather than trying to force the wizard's assessment-kickoff step through the existing completed-submission-only route.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DD request list CRUD (DD-01) | API/Backend (`server.js` + `db/store.js`) | Browser (vanilla JS render) | Blob-per-row collection, same as every existing workstream/RAID/synergy route |
| DD findings + conversion (DD-02/DD-03) | API/Backend | Browser | Reuses `from-remediation`-style dedup-by-`source` pattern; conversion logic is server-side |
| Need-to-know filtering + denial audit (DD-04) | API/Backend (new `db/accessPolicy.js`-style module) | — | Must run server-side only, per the locked "not just hidden in the UI" requirement; reused verbatim by Phase 6 (ROADMAP dependency note) |
| VDR link/grant records (DD-05) | API/Backend | Database (`audit.db` for grant events) | No document storage tier at all — deliberately out of scope |
| Setup wizard UI (WIZ-01) | Browser/Frontend (full-page vanilla JS, no SSR) | API/Backend (validation pipeline) | Static HTML page + JS state machine, modeled on `pmo.html`'s existing stepper; every step write is a normal validated API call |
| Assessment kickoff (D-08) | API/Backend (new pending-instance capability) | Browser (wizard step 3 UI) | Requires a schema/route change, not just a UI addition — see Pitfalls |
| Deal home adaptation (D-19) | Browser/Frontend (`dashboard.js`) | API/Backend (new rollup endpoints, e.g. DD progress by area) | `dashboard.js` currently has zero deal-awareness — greenfield work this phase |
| Owner nudges (D-21) | Browser/Frontend (existing banner system) | API/Backend (computed overdue rollup) | Reuses `public/js/banners.js`'s existing dismissible-banner mechanism; no new notification infra |

## Standard Stack

### Core

No new runtime dependencies. This phase extends the exact stack Phase 3 already vetted and installed:

| Library | Version | Purpose | Why Standard (here) |
|---------|---------|---------|--------------|
| `zod` | 4.4.3 `[VERIFIED: package.json]` | Schema validation for every new write route | Already the project's single validation library (`validators/index.js`); Phase 3's `WRITE_SCHEMAS` coverage gate (`test/write-validation-coverage.test.js`) will fail the suite if a new DD/wizard route ships without a registered schema |
| `better-sqlite3` | 13.0.1 `[VERIFIED: package.json]` | Blob-per-row storage for new DD collections | Already the project's only DB driver; new collections use the identical `(id, project_id, seq, data)` table shape `db/schema.sql` defines for every existing collection |
| `express` | ^4.19.2 `[VERIFIED: package.json]` | Route registration | No change |

### Supporting

None — no PDF/canvas/compression concerns touch this phase.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Blob-per-row DD collections | A normalized relational schema (dedicated `ddArea` FK column, indexed) | Rejected: `db/schema.sql`'s own header comment explicitly forbids normalizing individual fields into typed columns for this milestone ("Do NOT normalize... explicitly out of scope") — consistency with every other collection matters more than query performance at this data volume |
| Per-route validation middleware | The existing generic path-resolved `validationMiddleware` | Not a real choice — `validators/index.js` already generalizes this; a new per-route middleware would be a regression to the pre-Plan-06 pattern |

**Installation:** None required — zero new packages.

## Package Legitimacy Audit

**Not applicable this phase.** No new external packages are introduced. Every write route, storage collection, validator module, and audit call site reuses `zod`, `better-sqlite3`, and `express` — all already installed, pinned, and approved through the Package Legitimacy Gate in Phase 1 (`better-sqlite3`) and Phase 3 (`zod`).

## Architecture Patterns

### System Architecture Diagram

```
Browser (wizard.html / dashboard.html)
   │
   │  fetch('/api/deals', {POST})            ← wizard step 1-2 (existing D-02 route)
   │  fetch('/api/assessment-instances/pending', {POST})  ← NEW: wizard step 3 kickoff
   │  fetch('/api/dd/request-items', {GET/POST})          ← NEW: DD-01
   │  fetch('/api/dd/findings', {GET/POST})               ← NEW: DD-02
   │  fetch('/api/dd/findings/:id/convert', {POST})       ← NEW: DD-03
   ▼
Consolidated /api gate (server.js, unchanged shape)
   │  (a) identity resolution → (b) dealResolverMiddleware (binds deals/<id>.db)
   │  (c) isDemoOnlyPath check → (d) ROLE_WRITE_POLICY role check
   │  (e) validationMiddleware (zod, per registered WRITE_SCHEMAS entry)
   ▼
Route handler (server.js, new DD section)
   │
   ├─► NEW: need-to-know check (db/accessPolicy.js-style module)
   │      reads req.dealContext.dealId + req.portalUser.username
   │      looks up deal.memberGrants[username].ddAreas (or equivalent)
   │      — omits uncleared areas from list responses (D-03: invisibility)
   │      — 403 + recordSecurityEvent('dd-access-denied') on a direct probe
   │
   ├─► readDb()/writeDb() (db/store.js, UNCHANGED)
   │      — resolves the AsyncLocalStorage-bound deal connection
   │      — writeDb()'s existing snapshot-diff automatically produces the
   │        AUD-01 audit-log entry for every DD write — zero new audit code
   │        needed for ordinary CRUD, only for D-02/D-18 security events
   │
   └─► db/auditHook.js#recordSecurityEvent()
          — explicit call sites for: grant-area, revoke-area, dd-access-denied,
            vdr-access-grant (D-02/D-18), matching Phase 3's deal-create/
            deal-archive/deal-members-update call-site pattern exactly
```

### Recommended Project Structure

```
db/
├── accessPolicy.js       # NEW: hasAreaGrant(deal, username, area), filterByGrant()
│                          #   — reused verbatim by Phase 6 (ORG-03 flight-risk register)
validators/
├── dd.js                 # NEW: request-item/finding/conversion schemas, registerSchema() calls
├── wizard.js              # NEW: wizard step schemas (basics/team/assessment-kickoff/scope/timeline)
public/
├── deal-wizard.html       # NEW: full-page wizard (D-06), step-rail modeled on pmo.html's stepper
├── js/
│   ├── deal-wizard.js     # NEW: switchStep()-style state machine (see Code Examples)
│   ├── dashboard.js       # MODIFIED: deal-bound branch (D-19) — currently zero deal-awareness
│   └── deal-switcher.js   # MODIFIED: "+ New real deal" navigates to deal-wizard.html (D-06), not the modal
```

### Pattern 1: Blob-per-row DD collections, added to the existing inventory

**What:** Two new `ARRAY_COLLECTIONS` entries — `ddRequestItems`, `ddFindings` — plus a template collection `ddRequestTemplates` (seeded, mirroring `checklistTemplates`/`assessmentTemplates`).
**When to use:** Any new business-data collection this phase.
**Verified shape (from the file that defines every existing table):**
```sql
-- Source: db/schema.sql:25-30 (alerts table, representative of every collection)
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_project ON alerts(project_id);
```
`ddRequestItems`/`ddFindings`/`ddRequestTemplates` follow this exact shape — `id`/`project_id`/`seq` as metadata columns, everything else (area, owner, status, due date, severity, VDR link, `source`/`linkedTaskId`/`linkedRaidId` cross-references) inside the `data` JSON blob, per `db/schema.sql`'s own header instruction: "Do NOT normalize individual fields into typed columns."

**Registration required (or the app throws at boot):**
```js
// Source: db/collections.js:62-67 — the completeness assertion every new
// collection must satisfy
if (ARRAY_COLLECTIONS.length !== 32) {
  throw new Error(`db/collections.js: expected 32 array collections, got ${ARRAY_COLLECTIONS.length}`);
}
```
Adding `ddRequestItems`/`ddFindings`/`ddRequestTemplates` to `ARRAY_COLLECTIONS` means this literal count assertion (`!== 32`) must be updated to the new total — the planner's task list must include this, not just the array append (a stale count throws on server boot).

### Pattern 2: Template-only seeding for the DD checklist (D-13)

**What:** `ddRequestTemplates` joins `checklistTemplates`/`assessmentTemplates`/`processCatalog` in `db/dealSeed.js`'s `DEAL_SEED_COLLECTIONS` allowlist so every new deal inherits the curated ~80-item checklist; a new `POST /api/dd/request-items/instantiate` route (mirroring the verified `/api/integration-tasks/instantiate` pattern) turns template rows into live per-deal `ddRequestItems`.
**Verified allowlist mechanism (why this is additive, zero-risk):**
```js
// Source: db/dealSeed.js:25
const DEAL_SEED_COLLECTIONS = ['checklistTemplates', 'assessmentTemplates', 'processCatalog'];
```
This is an *allowlist*, not a denylist (the file's own header comment explains why: a denylist would silently leak any newly-added collection into every future deal). Adding `'ddRequestTemplates'` to this array is the only change needed for seeding — `createDealDatabase()`'s loop already iterates whatever is in this list.
**Verified instantiate-and-dedup pattern to mirror:**
```js
// Source: server.js:2598-2625 — POST /api/integration-tasks/instantiate
// (dedup by a `source: 'template:' + tpl.id + ':' + item.id` string so
// re-running after adding template items only creates the NEW ones)
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
    // ... create + push
  });
  if (created.length) writeDb(db);
  res.json({ success: true, created: created.length });
});
```
`POST /api/dd/request-items/instantiate` should follow this exact shape against `ddRequestTemplates` → `ddRequestItems`.

### Pattern 3: The need-to-know filter as a standalone module (DD-04)

**What:** A single `db/accessPolicy.js` (or `lib/accessPolicy.js`) exporting something like `hasAreaGrant(deal, username, area)` and `filterByAreaGrant(items, deal, user)`, consulted by every DD list/read/write handler.
**Why standalone, not inline:** ROADMAP.md's own Phase 6 dependency line states this explicitly: *"Depends on: Phase 4 (reuses the clean-room access-policy pattern established there rather than inventing a second one)"* `[CITED: .planning/ROADMAP.md]`. Writing the check inline in the DD route handlers means Phase 6's flight-risk register (ORG-03) either duplicates the logic or has to retrofit an extraction later — building it as one small, well-named module now avoids both.
**Anti-enumeration precedent to follow (verified, already proven in Phase 3):**
```js
// Source: db/resolver.js:88-99 — the uniform-403 pattern DD-04's denial
// behavior (D-03) must match: no distinct 404-for-missing vs 403-for-
// not-a-member, so a caller cannot enumerate existence from status codes.
const deal = controlStore.getDeal(dealId);
if (!deal || deal.status === 'archived' || !controlStore.isDealMember(dealId, req.portalUser)) {
  throw new DealAccessError(403, 'You are not a member of that deal.');
}
```
DD-04's own list-response filtering (D-03: "invisibility, not a lock") is a *different* mechanism from this — this pattern is only for the *direct API probe* case DD-04 also names ("cannot read that area's DD requests or findings via a direct API call... the denial itself is audited").

### Pattern 4: Security-event call sites for grants/revokes/denials (D-02/D-18)

**What:** Every `ddAreas` grant, revoke, VDR access grant, and access denial is a `recordSecurityEvent()` call, following the exact shape Phase 3 Plan 05 established for deal lifecycle events.
**Verified call-site pattern to mirror:**
```js
// Source: server.js:701-705 — deal-create's security event, the pattern
// every new D-02/D-18 event (grant-area, revoke-area, vdr-access-grant,
// dd-access-denied) should copy verbatim
auditHook.recordSecurityEvent({
  actor: req.portalUser, action: 'deal-create', dealId: deal.id, subject: deal.id,
  before: null, after: deal, request: requestMeta(req),
});
```
`recordSecurityEvent()` throws if `actor` has no `username` (`db/auditHook.js:127-129`) — this is by design (D-11's "attributed-actor-or-throw" contract) and requires no new handling; every DD/wizard route runs behind the resolver, which always resolves a real `req.portalUser` for a deal-bound request (never null, unlike the one documented `DEMO_OPEN` exception in Plan 05's session-revoke-all).

### Pattern 5: The wizard step-rail (D-06), modeled on the existing demo intake wizard

**What:** `pmo.html`'s "Custom M&A Setup Wizard" is the exact precedent CONTEXT.md's D-06 points at ("Model on the demo side's existing intake-wizard pattern").
**Verified structure to copy:**
```html
<!-- Source: public/pmo.html:41-58 -->
<div id="pmo-onboarding-wizard" class="card card-glass" ...>
  <div class="wizard-header">...</div>
  <div class="wizard-step-badge">Step <span id="current-step-num">1</span> of 4</div>
  <div class="wizard-progress-bar-container">
    <div id="wizard-step1-fill" ...></div>
    <div id="wizard-step2-fill" ...></div>
    ...
  </div>
</div>
<div class="wizard-step" id="wizard-step-1" style="display: block;">...</div>
<div class="wizard-step" id="wizard-step-2" style="display: none;">...</div>
```
```js
// Source: public/js/pmo.js:957-977 — the state machine to copy for the
// new deal wizard's step rail (5-7 steps per D-04/WIZ-01 instead of 4)
let currentWizStep = 1;
function switchWizStep(stepNum) {
  currentWizStep = stepNum;
  document.getElementById('current-step-num').textContent = stepNum;
  document.querySelectorAll('.wizard-step').forEach(step => { /* hide all */ });
  document.getElementById(`wizard-step-${stepNum}`).style.display = 'block';
  // update progress-bar fills 1..N
}
```
D-07 (validate on step-advance) means each step's form-submit handler must `fetch()` the step's own endpoint and only call `switchWizStep(next)` on a 2xx — inline zod error strings (already field-path-prefixed, per `formatIssues()`) render next to the matching field on a 400, exactly like `validators/index.js`'s existing `{ error: "field.path: message" }` shape.

### Anti-Patterns to Avoid
- **Re-deriving the demo/custom shadow-lane branch (`db.settings.demoMode === false ? customX : x`) inside new DD route handlers:** every existing lane-helper (`taskLane()`, `synergyLane()`, `raidLane()`, `assessLane()`) carries this branch, but it is a *demo-mode-only* mechanic (Custom-M&A showcase toggle) that is structurally inert inside a real deal's own database file — a deal's fresh `settings` singleton (`db/dealSeed.js:90-95`) never sets `demoMode`, so the branch always evaluates to the plain-collection-name side. New DD lane helpers (e.g. `ddRequestLane(db)`) should be a flat `db.ddRequestItems = db.ddRequestItems || []; return db.ddRequestItems;` with NO demoMode branch at all — copying the branch into new code would be dead code that also risks a future maintainer wiring it up incorrectly.
- **Changing `deal.members`'s array-of-username-strings shape to carry the `ddAreas` grant:** see the dedicated Pitfall below — this breaks tested, working code across `db/controlStore.js`, `db/resolver.js`, `public/js/deal-switcher.js`, and `public/js/admin.js`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Write-payload validation | A second ad hoc `if (!x) return 400` chain in DD/wizard route handlers | `registerSchema()` into a new `validators/dd.js`/`validators/wizard.js`, resolved automatically by the already-mounted `validationMiddleware` | Phase 3 Plan 06 already built the generic, fail-closed, path-resolved pipeline; a route with no registered schema 500s loudly rather than silently accepting unvalidated input — this is the enforcement mechanism, not a convention to remember |
| Audit logging for ordinary DD CRUD | A manual `recordSecurityEvent()`/audit-row call after every `writeDb()` in the DD handlers | Nothing — `db/store.js`'s `writeDb()` hook already produces the AUD-01 before/after row automatically for any write against a `'deal'`-kind resolved database | Only D-02/D-18's named *security events* (grant/revoke/denial/VDR-grant) need an explicit `recordSecurityEvent()` call; ordinary DD item/finding CRUD is covered for free |
| Access-denial anti-enumeration | A bespoke 403-vs-404 distinction for DD area probes | The verified uniform-403 pattern (`db/resolver.js:88-99`, `WR-02`) | A distinct status code per failure mode is exactly the T-03-17 enumeration risk Phase 3 already closed once; DD-04 must not reopen it |
| HTML/XSS sanitization for any new free-text DD field (finding notes, item descriptions) | A new sanitizer | `htmlField()`/`applySanitization()` from `validators/index.js` — but ONLY if the field is actually rendered as raw HTML somewhere; otherwise leave it as plain text (VAL-02's own documented discipline) | Phase 3 Plan 06's tagging is deliberately narrow (3 fields total, verified against actual render paths) — tagging a DD field that renders via `textContent` would be a data-integrity bug, not a security fix |
| Deal-id / path-traversal validation | A second regex check in the wizard's create-deal step | `dbFiles.dealDbPath()`'s existing `DEAL_ID_RE` validation | Already the single sanctioned path-builder; the wizard's "create early" (D-05) step reuses the existing `POST /api/deals` route verbatim, not a new deal-creation code path |

**Key insight:** This phase's entire backend surface is additive registration into machinery Phase 3 already built and tested (100/116/122 tests green across its plans) — the risk is not "building the wrong mechanism" but "forgetting to register with an existing one" (a missing `WRITE_SCHEMAS` entry, a missing `ARRAY_COLLECTIONS` count bump, a missing `DEAL_SEED_COLLECTIONS` entry). Each of these fails LOUD (boot-time throw or 500), which is a feature, not a risk to route around.

## Common Pitfalls

### Pitfall 1: RAID's severity enum has no `critical` level — D-11 cannot literally hold without a schema change
**What goes wrong:** DD-11 requires findings to carry `critical/high/medium/low` severity "so converted findings pass severity straight into RAID entries" — but the existing RAID severity enum only has three levels.
**Why it happens:** RAID was built before DD existed; nobody anticipated a 4-level severity scale feeding into it.
**Verified evidence:**
```js
// Source: server.js:2752
const RAID_LEVELS = ['low', 'medium', 'high'];
// Source: validators/workstream.js:139
const RAID_LEVELS = ['low', 'medium', 'high']; // duplicated constant, not shared
```
**How to avoid:** Extend `RAID_LEVELS` (both the `server.js:2752` copy and the `validators/workstream.js:139` copy — they are NOT a shared constant today, a second pre-existing gap worth closing while touching this) to `['low', 'medium', 'high', 'critical']`. This is a strictly additive enum change — no existing RAID entry has (or could have had) `severity: 'critical'`, so no migration is needed. Do NOT lossy-map DD `critical` → RAID `high` at conversion time; D-11's own wording ("pass straight into") indicates the user wants a faithful transfer, not a downgrade.
**Warning signs:** A finding with `severity: 'critical'` either fails validation on `/from-remediation`-style conversion, or silently downgrades to `high` in the created RAID entry — either behavior contradicts D-11.

### Pitfall 2: The wizard's assessment-kickoff step needs a capability that does not exist yet — a "pending" assessment instance
**What goes wrong:** D-08 requires the wizard to "create all three [assessment] instances... with owners and due dates assigned" as a kickoff action, tracked-but-not-blocking (D-09) until someone actually completes them. The existing `POST /api/assessment-instances` route only creates a **completed, scored** submission.
**Why it happens:** the assessment feature was built for the demo's self-service "take this assessment now" flow, which has no concept of "assigned but not yet taken."
**Verified evidence:**
```js
// Source: server.js:2363-2392 — POST /api/assessment-instances always
// computes scores from `responses` and sets status: 'submitted'
app.post('/api/assessment-instances', (req, res) => {
  const { templateId, rater, respondentName, respondentRole, responses, retakeOf } = req.body || {};
  const db = readDb();
  const template = (db.assessmentTemplates || []).find(t => t.id === templateId);
  if (!template) return res.status(404).json({ error: 'Assessment template not found.' });
  const scoresBlock = scoreAssessmentInstance(template, responses); // requires responses NOW
  const instance = { id: newId('ainst'), ..., status: 'submitted', ... };
  ...
});
```
There is no `owner`, `dueDate`, or non-`'submitted'` `status` anywhere in the current instance shape (`server.js:2334-2338`'s `publicAssessInstance()` strips only `responses`, confirming the shape has nothing else to strip).
**How to avoid:** Add a genuinely new capability — either (a) a new field set (`owner`, `dueDate`, `status: 'pending'|'submitted'`) on the existing `assessmentInstances` collection with a new `POST /api/assessment-instances/assign` route that creates a pending, response-less instance, later completed by the existing submit route (matched by id, not created fresh), or (b) a parallel lightweight `assessmentAssignments` collection the deal-home tracks separately from instances. Option (a) keeps `/api/assessment-status`'s existing rollup logic (which already reads `latest.dimensionScores` etc.) working with one small `if (inst.status !== 'submitted') return { ...entry, satisfied: false, pending: true }`-style branch; option (b) is cleaner but means the status-rollup route must merge two collections. Flag this as a design decision for the planner to lock, not an implementation detail — it changes what `POST /api/assessment-instances` accepts.
**Warning signs:** The wizard's assessment step either can't create anything until owners actually sit down and answer every question (contradicting D-09's "no hard lock"), or is forced to fabricate placeholder `responses` to satisfy the existing route (corrupting real assessment data).

### Pitfall 3: `deal.members` is a flat array of username strings everywhere — do not change its shape to carry `ddAreas`
**What goes wrong:** D-01's literal wording ("each deal member entry grows a `ddAreas: []` list") could be read as changing `members` from `string[]` to an array of `{username, ddAreas}` objects. Every existing consumer treats it as a flat string array.
**Why it happens:** D-01 was written before this code was inspected line-by-line; the intent (need-to-know per member) doesn't require this specific storage shape.
**Verified evidence:**
```js
// Source: db/controlStore.js:107-113 — isDealMember() reads members as Array<string>
function isDealMember(dealId, user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const deal = getDeal(dealId);
  if (!deal) return false;
  return Array.isArray(deal.members) && deal.members.includes(user.username);
}
// Source: public/js/admin.js:2485, 2522 — admin UI edits members as a
// comma-separated username string
const typed = window.prompt('Members (comma-separated usernames):', (d.members || []).join(', '));
subEl.textContent = (d.targetCompany || '') + ' · ' + (d.members || []).length + ' member(s)';
```
`db/resolver.js`'s bind-time membership check, `sessions.releaseSessionsForDeal()`'s member-removal loop (`server.js:760-761`, iterating a `Set` built from `existing.members || []`), and `public/js/deal-switcher.js` all share this same "members is `string[]`" assumption.
**How to avoid:** Add a NEW, additive field to the deal record instead — e.g. `deal.memberGrants: { [username]: { ddAreas: string[] } }` — keyed by username, populated/updated only for members who actually hold an area grant. This satisfies D-01's intent ("need-to-know... on the member record" — a per-member grant, associatively keyed by the same username `members` already uses) with zero changes to any of the four verified call sites above. Present this as the recommended shape to the planner; it is the lower-risk reading of D-01, not a deviation from it.
**Warning signs:** `isDealMember()`, the deal-switcher's membership list, or the admin Deals-tab member editor silently breaking (e.g. `.includes(username)` failing against an array of objects) — these have no direct test coverage of the *shape* assumption, only of the membership *behavior*, so a shape change could pass existing tests while breaking these call sites at runtime.

### Pitfall 4: DD areas don't map 1:1 onto the existing 8 workstreams
**What goes wrong:** D-10 says "Areas map to ws_* workstreams at conversion time" (for DD-03's task/RAID conversion, which needs a `workstreamId`), but the DD area list (Legal, Financial, Tax, HR, IT, Commercial, Operations, Compliance/ESG) and the verified existing workstream list don't align cleanly.
**Verified existing workstream list:**
```
Source: data/demo.db checklistTemplates.ctpl_day1_100.workstreams (read via better-sqlite3, this session)
[{"id":"ws_imo",...},{"id":"ws_hr",...},{"id":"ws_it",...},{"id":"ws_finance",...},
 {"id":"ws_legal",...},{"id":"ws_sales",...},{"id":"ws_ops",...},{"id":"ws_comms",...}]
```
**Recommended mapping (flag for planner confirmation, not locked by any decision):**

| DD Area | Recommended `ws_*` | Note |
|---------|---------------------|------|
| Legal | `ws_legal` | Direct match |
| Financial | `ws_finance` | Direct match |
| Tax | `ws_finance` | No dedicated tax workstream exists — folded into Finance |
| HR | `ws_hr` | Direct match |
| IT | `ws_it` | Direct match |
| Commercial | `ws_sales` | Closest existing label ("Sales & Customers") |
| Operations | `ws_ops` | Direct match |
| Compliance/ESG | `ws_legal` | Closest existing label ("Legal & Compliance") — ESG-specific items are a stretch fit; `ws_imo` is the fallback if the planner prefers governance-owned |

**How to avoid:** Hard-code this mapping as a small constant (mirroring `REMEDIATION_WS` at `server.js:2630-2633`) rather than leaving it as an ad hoc per-conversion choice — the two ambiguous rows (Tax, Compliance/ESG) should be confirmed with the user during planning, not silently decided.

### Pitfall 5: `dashboard.js` has zero deal-awareness today — D-19 is greenfield, not a small patch
**What goes wrong:** Assuming the deal-home adaptation is a small conditional branch on top of existing dashboard logic.
**Verified evidence:** `grep -n "dealId\|isDemo\|deal-switcher\|demoMode" public/js/dashboard.js` returns zero matches — none of dashboard.js's rendering logic currently checks whether the caller is deal-bound.
**How to avoid:** Plan D-19 as new work: fetch `/api/auth/me` (the same call `public/js/deal-switcher.js:244` already makes) to get `dealId`, branch the page's initial render path on it, and build the new setup-checklist/assessment-completion/DD-progress panels as genuinely new dashboard sections — not a retrofit of existing demo-panel code.
**Warning signs:** A plan that estimates D-19 as "extend the existing deal-bound rendering" will underestimate scope — there is no existing deal-bound rendering to extend.

### Pitfall 6: The literal `/api/integration-tasks/from-remediation` route is assessment-specific — D-12's "reuse" means reuse the pattern, not the endpoint
**What goes wrong:** Reading D-12 ("via the existing `from-remediation` linkage") as "call the existing route from the new finding-conversion button."
**Verified evidence:**
```js
// Source: server.js:2634-2665 — the route takes an assessmentTemplateId,
// not a finding, and derives tasks from `tpl.remediation[]` entries keyed
// by dimensionId — there is no finding-shaped input path here at all
app.post('/api/integration-tasks/from-remediation', (req, res) => {
  const { assessmentTemplateId } = req.body || {};
  ...
  (tpl.remediation || []).forEach(r => {
    const score = (latest.dimensionScores || {})[r.dimensionId];
    if (typeof score !== 'number' || score >= 80) return;
    const source = 'remediation:' + tpl.id + ':' + r.dimensionId;
    ...
```
**How to avoid:** Build a new route (e.g. `POST /api/dd/findings/:id/convert`) that follows the SAME *pattern* — `source`-string dedup (`'dd-finding:' + finding.id`), pre-filled task/RAID fields, bidirectional reference storage (finding gains `linkedTaskId`/`linkedRaidId`; task/RAID entry gains `source: 'dd-finding:' + finding.id'`) — rather than trying to route DD findings through the existing assessment-specific handler. This is the correct reading of "reusing the existing remediation linkage": reuse the *linkage pattern* (dedup-by-source, bidirectional reference), not the literal endpoint.

### Pitfall 7: `ARRAY_COLLECTIONS.length !== 32` throws at boot — adding collections without bumping the assertion breaks the app immediately
**What goes wrong:** Adding `ddRequestItems`/`ddFindings`/`ddRequestTemplates` to the `ARRAY_COLLECTIONS` array without updating the hard-coded count check.
**Verified evidence:**
```js
// Source: db/collections.js:62-64
if (ARRAY_COLLECTIONS.length !== 32) {
  throw new Error(`db/collections.js: expected 32 array collections, got ${ARRAY_COLLECTIONS.length}`);
}
```
**How to avoid:** Every task that adds a collection to `ARRAY_COLLECTIONS` must update this literal number in the same commit (32 → 35 for three new DD collections) — this is a deliberate tripwire (per the file's own header comment, it exists so a later phase "cannot silently go unclassified"), not a bug to route around.

## Code Examples

### Registering a new write-route schema (the pattern every new DD/wizard route follows)
```js
// Source: validators/deals.js:34-42, 73-81 — the exact pattern to copy for
// validators/dd.js's request-item/finding schemas
const CreateDealSchema = z.object({
  name: z.string().trim().min(1, 'Deal name is required.').max(NAME_MAX, `...`),
  targetCompany: z.string().trim().min(1, '...').max(NAME_MAX, `...`),
  members: z.array(z.string().trim().min(1).max(USERNAME_MAX)).default([]),
});
registerSchema('POST', '/api/deals', CreateDealSchema);
```

### Deal-record seeding at creation time (what a DD checklist item template looks like once instantiated)
```js
// Source: db/dealSeed.js:44-104 — createDealDatabase()'s existing loop
// (unchanged; ddRequestTemplates just joins DEAL_SEED_COLLECTIONS)
const DEAL_SEED_COLLECTIONS = ['checklistTemplates', 'assessmentTemplates', 'processCatalog', 'ddRequestTemplates'];
```

## Seeded DD Request Checklist Content (D-13)

Curated ~10 items per area across the 8 locked DD areas (D-10), synthesized from standard M&A due diligence practice `[ASSUMED — not verified against a single authoritative checklist source; sanity-check with the user before locking as final seed content, per CONTEXT.md's own instruction that "the planner locks the item set"]`. Each becomes one `ddRequestTemplates` row (`{id, area, text, ownerHint}`), mirroring `checklistTemplates`' existing `items[]` shape.

**Legal:** Certificate of incorporation / good standing; articles of association & amendments; cap table and shareholder register; top 20 material contracts by value; litigation/dispute history (5 yrs, open + settled); IP register (patents/trademarks/copyrights/domains) + assignment agreements; real estate leases & property title; regulatory licenses & permits; change-of-control clauses in key contracts; outstanding guarantees/liens/security interests.

**Financial:** Audited financial statements (3 fiscal years); management accounts (trailing 12 months); revenue by customer/product (top-20 concentration); AR/AP aging schedules; debt schedule & loan covenants; capex history & forward plan; working-capital / normalized net-debt analysis; related-party transactions; off-balance-sheet liabilities & contingencies; budget-vs-actual variance (trailing 12 months).

**Tax:** Corporate tax returns (3 years, all jurisdictions); transfer pricing documentation & intercompany agreements; tax audit history & open assessments; VAT/sales-tax filings & compliance status; tax loss carryforwards & deferred tax assets; tax-sharing / tax-indemnification agreements; withholding-tax positions on cross-border payments; R&D tax-credit claims & substantiation; payroll tax compliance records; advance pricing agreements / tax rulings.

**HR:** Organization chart with reporting lines; employment agreements — executives & key employees; compensation/benefits summary by role/level; employee handbook & HR policies; union / works-council agreements & CBAs; pending employment litigation or grievances; headcount by function/location with tenure; severance & change-of-control (golden-parachute) terms; pension/retirement plan obligations; workplace safety & compliance incident history.

**IT:** IT systems inventory (ERP/CRM/core apps); network architecture & infrastructure diagram; cybersecurity policies & incident history (3 yrs); data-privacy compliance status (GDPR/CCPA as applicable); software licenses & vendor contracts; disaster-recovery / business-continuity plan; source-code ownership & escrow arrangements; cloud-hosting agreements & SLAs; access-control & identity-management practices; open IT integration/separation dependencies (TSAs).

**Commercial:** Top-20 customer contracts & revenue concentration; customer churn/retention analysis; sales pipeline & backlog; pricing policies & discount structures; distribution/channel-partner agreements; competitive positioning & market-share analysis; customer-satisfaction/NPS data; key-account change-of-control consent requirements; marketing & brand-asset inventory; product roadmap & R&D pipeline.

**Operations:** Manufacturing/production facility list & capacity utilization; supply-chain map & key supplier contracts; quality-management certifications (ISO / industry-specific); inventory levels & turnover; equipment/asset register & condition assessment; health & safety compliance records; business-continuity / single-point-of-failure risks; logistics & distribution network; outsourced/third-party operational dependencies; capacity-expansion plans & constraints.

**Compliance/ESG:** Environmental permits & compliance history; sustainability/ESG reporting & targets; anti-bribery & corruption (ABC) policy & training records; export-control & trade-sanctions compliance; data-protection/privacy compliance program; regulatory investigations or enforcement actions (open/closed); DEI metrics & initiatives; product-safety/regulatory certifications; whistleblower/ethics-hotline records; carbon-footprint/emissions disclosures.

*(Total: 80 items across 8 areas, within D-13's 8-15-per-area target.)*

## State of the Art

Not applicable — this phase extends an internal, purpose-built architecture (Phase 1-3), not a public library whose best practices shift over time. No "old vs current approach" table is meaningful here.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The 80-item seeded DD checklist content (10 per area) | Seeded DD Request Checklist Content | Low — D-13 already expects the IL to prune/extend per deal; wrong items are a one-time editing cost, not a structural bug |
| A2 | `ws_legal` is the best-fit workstream for the Compliance/ESG DD area (vs. `ws_imo`) | Pitfall 4 | Low — only affects which workstream a converted Day-1 task lands under; easily changed post-hoc since it's just a field value |
| A3 | `Tax` DD area folds into `ws_finance` at conversion (no dedicated tax workstream exists) | Pitfall 4 | Low — same as A2 |
| A4 | The recommended `deal.memberGrants: {username: {ddAreas}}` shape (additive, not replacing `members`) is what D-01 intends | Pitfall 3 | Medium — if the user actually wants `members` itself restructured, the planner needs to confirm this reading with the user before implementation, since it affects 4+ verified call sites |
| A5 | Option (a) from Pitfall 2 (extend `assessmentInstances` with `owner`/`dueDate`/`status:'pending'`) is preferable to a parallel `assessmentAssignments` collection | Pitfall 2 | Medium — both are workable; this is a real design decision, not a fact, and should be confirmed during planning |

## Open Questions

1. **Does D-01's "member entry grows a `ddAreas` list" require changing `deal.members`'s array-of-strings shape, or is an additive per-username `memberGrants` map an acceptable reading?**
   - What we know: 4+ existing call sites (`db/controlStore.js`, `db/resolver.js`, `public/js/deal-switcher.js`, `public/js/admin.js`) treat `members` as `string[]` with no test coverage of the shape assumption itself.
   - What's unclear: whether the user's intent in D-01 was literally "the member array's own elements become richer objects" or just "grants live somewhere associated with membership."
   - Recommendation: confirm with the user during planning (or via a `checkpoint:human-verify` on the first task that touches this) before choosing; Pitfall 3 above recommends the additive map.

2. **Does the wizard's assessment-kickoff step need `assessmentInstances` schema changes (owner/dueDate/pending status), or a parallel lightweight collection?**
   - What we know: the existing route only creates completed submissions; D-08/D-09 need a pending, assignable, trackable instance.
   - What's unclear: which shape the deal-home's "assessment completion" rollup (D-09) should read from — one collection with a status branch, or two collections merged at read time.
   - Recommendation: planner should pick one explicitly (Pitfall 2 leans toward extending the existing collection) rather than leaving it implicit in a task description.

3. **Should the DD-area → workstream mapping (Pitfall 4) be user-confirmed before the planner locks it, given Tax and Compliance/ESG have no clean 1:1 match?**
   - Recommendation: surface the mapping table in the plan and get explicit confirmation, since it's baked into every converted task/RAID entry going forward (D-10's own "costly to reverse" reversibility note applies here too, transitively).

## Security Domain

### Applicable ASVS Categories (Level 1, per `.planning/config.json`)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No change | Already enforced by the Phase-2 mandatory-auth gate; every new route sits behind it automatically |
| V3 Session Management | No change | Sessions/resolver unchanged this phase |
| V4 Access Control | **Yes — core to this phase** | New `db/accessPolicy.js` need-to-know check (DD-04); reuse the verified uniform-403 anti-enumeration pattern (`db/resolver.js:88-99`); never a client-side-only filter |
| V5 Input Validation | Yes | `zod` via `registerSchema()`/`validationMiddleware` — no ad hoc checks in new handlers |
| V6 Cryptography | No change | No new secrets/tokens introduced this phase |
| V7 Error Handling & Logging | Yes | Every access denial for a DD area is a `recordSecurityEvent()` call (D-04's explicit "the denial itself is audited") — this is a logging requirement, not optional |
| V8 Data Protection | Yes | DD content is MNPI by definition; the need-to-know filter is the data-protection control; VDR link-outs (DD-05) deliberately avoid ever storing the sensitive document itself |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Broken object-level access control — a cleared member's session used to probe an area they lack `ddAreas` for | Elevation of Privilege / Information Disclosure | Server-side `hasAreaGrant()` check before every DD read/write, uniform 403 (never a distinguishing 404), denial audited (D-03/D-04) |
| Enumeration via response-code or timing differences between "area exists but you're not cleared" and "area doesn't exist" | Information Disclosure | Uniform 403 for both cases, mirroring the verified `db/resolver.js:88-99` deal-level precedent |
| IDOR on `PATCH /api/dd/request-items/:id` — an area-cleared member for area X editing an item that actually belongs to area Y they aren't cleared for | Tampering / Elevation of Privilege | The access-policy check must read the ITEM's own stored `area` field (not a client-supplied one) before allowing a write, not just check the caller has *some* grant on the deal |
| A finding→task/RAID conversion silently exposing MNPI-severity data to a wider audience than the finding itself (e.g. a `critical` Legal finding converting into a RAID entry no area filter protects) | Information Disclosure | Confirm with the user during planning whether converted tasks/RAID entries inherit any area-based visibility restriction, or whether task/RAID visibility is deliberately broader (current RAID/tasks routes have no area-based read restriction today) — flagged as an open design question, not resolved by existing decisions |

## Sources

### Primary (HIGH confidence — verified in this session via Read/Bash against the actual repo)
- `db/schema.sql`, `db/collections.js`, `db/dealSeed.js`, `db/resolver.js`, `db/controlStore.js`, `db/auditHook.js`, `db/dbFiles.js` — read in full this session
- `validators/index.js`, `validators/deals.js`, `validators/workstream.js` (grep) — read this session
- `server.js` (multiple ranges: gate/ROLE_WRITE_POLICY lines 260-590, deal registry lines 640-840, assessment/task/synergy/RAID lines 2259-2870) — read this session
- `public/js/deal-switcher.js`, `public/js/execution.js`, `public/pmo.html` (wizard markup), `public/js/pmo.js` (wizard state machine), `public/admin.html` (Deals tab), `public/js/admin.js` (grep) — read this session
- `data/demo.db` (`checklistTemplates`, `assessmentTemplates` rows) — queried directly via `better-sqlite3` this session
- `.planning/phases/03-deal-isolation-audit-log-write-validation/{03-CONTEXT.md,03-03-SUMMARY.md,03-05-SUMMARY.md,03-06-SUMMARY.md}`, `.planning/todos/pending/new-deal-setup-wizard.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/config.json` — read this session

### Secondary (MEDIUM confidence)
- General M&A due-diligence checklist structure (workstream grouping: financial/legal/tax/HR/IT/commercial/operational/regulatory) — cross-referenced across several industry-blog sources via WebSearch, consistent enough across sources to trust the *grouping*, not any single source's exact item wording

### Tertiary (LOW confidence — flagged for validation)
- The specific ~80 seeded DD checklist item texts (Seeded DD Request Checklist Content section) — synthesized from general M&A practice knowledge, not copied verbatim from one authoritative checklist; explicitly marked `[ASSUMED]` per CONTEXT.md's own instruction that the planner/user locks the final item set

## Metadata

**Confidence breakdown:**
- Standard stack / architecture extension mechanics: HIGH — every pattern is a verified, already-tested Phase 3 code path, read directly this session
- DD checklist seed content: MEDIUM/LOW — grouping is well-established M&A practice, exact item wording is synthesized and needs a sanity pass
- Gaps identified (RAID severity, pending assessment instances, members shape): HIGH confidence these gaps are real (verified via direct source reads), MEDIUM confidence on the recommended fix being the user's preferred one — flagged as Open Questions

**Research date:** 2026-08-02
**Valid until:** Effectively indefinite for the architecture-extension findings (tied to this specific codebase's own code, not an external library's release cycle) — re-verify only if Phase 4 planning is deferred long enough for a subsequent phase to touch the same files first.
