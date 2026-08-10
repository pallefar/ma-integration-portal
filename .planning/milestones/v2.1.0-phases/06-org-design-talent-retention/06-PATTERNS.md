# Phase 6: Org Design & Talent Retention - Pattern Map

**Mapped:** 2026-08-06
**Files analyzed:** 15 (new + modified)
**Analogs found:** 15 / 15

This phase is domain-greenfield but structurally precedented — every new file
below has an exact or near-exact analog already in this repo (per RESEARCH.md
"Standard Stack: no new libraries"). This document does not re-derive facts
already established in 06-RESEARCH.md/06-CONTEXT.md/06-UI-SPEC.md; it cites
and packages them for the planner.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `db/collections.js` (edit) | config/registry | CRUD registration | itself, `ddFindings`/`ddRequestItems` entries | exact |
| `db/schema.sql` (edit) | migration | CRUD | `ddFindings`/`ddRequestItems` tables (lines 165-187) | exact |
| `db/dealSeed.js` (no new entries) | config | batch/seed | `DEAL_SEED_COLLECTIONS` allowlist reasoning (unchanged) | exact (by omission) |
| `validators/org.js` (new) | validator | request-response | `validators/dd.js` | exact |
| `server.js` — `/api/org/positions*` routes (new) | controller/route | CRUD | `/api/dd/request-items*` + `/api/dd/findings*` sections | exact |
| `server.js` — `/api/org/decisions` routes (new) | controller/route | event-driven (append-only log) | Phase 5 baseline-history pattern (D-12) + `isAdminOrIlRequest` gate at `server.js:3790` | role-match |
| `server.js` — `/api/org/flight-risk` routes (new) | controller/route | CRUD + read-audit | `/api/dd/findings` (CRUD) + NEW read-audit shape (no exact precedent, see Shared Patterns) | role-match |
| `server.js` — `POST /api/org/flight-risk/:id/convert` (new) | controller/route | event-driven (conversion) | `POST /api/dd/findings/:id/convert` (`server.js:4282-4361`) | exact |
| `server.js` — `GET /api/org/summary` (new) | controller/route | request-response (rollup) | `GET /api/dd/summary` (`server.js:4375-4417`) | exact |
| `server.js` — `GET /api/raid` outbound filter (edit, D-17) | controller/route | transform (clearance filter) | `filterByAreaGrant`/`ddAreaRefused` shape, but needs NEW provenance-resolution logic (Pitfall 1) | partial — do not copy verbatim |
| `public/org.html` (new) | page/template | request-response | `public/due-diligence.html` | exact |
| `public/js/org.js` (new) | component/page-controller | CRUD + streaming-render (tree) | `public/js/due-diligence.js` | exact |
| `public/js/deal-home.js` (edit) | component | request-response (fan-out render) | itself — `renderDiligence()` + `renderStaleSynergyNudge()` | exact |
| `public/js/due-diligence.js` (edit, 1-line copy fix) | component | — | itself, `.dd-finding-convert-note` string (line 325) | exact |
| `public/execution.html` (edit, CSS) | component/style | — | itself, `.raid-lvl` rule block (lines 114-115) | exact |
| `data/demo.db` (edit, D-18 seed) | migration/seed | batch | Phase 5 synergy seed script + WAL-checkpoint discipline | exact |
| `test/org-*.test.js` (new, 6 files) | test | — | `test/dd-access-policy.test.js`, `test/dd-findings.test.js`, `test/synergy-stage.test.js` | exact |

## Pattern Assignments

### `db/collections.js` + `db/schema.sql` (config/registry, CRUD)

**Analog:** `db/collections.js` lines 17-73 (itself) + `db/schema.sql` lines 165-187 (`ddFindings`/`ddRequestItems`)

**The complete edit set — all THREE files must move together:**

1. **`db/collections.js`** — add each new collection name (e.g. `orgPositions`,
   `orgDecisions`, `flightRiskEntries` — naming is planner's discretion per
   CONTEXT.md) into the `ARRAY_COLLECTIONS` array (alphabetically, matching
   existing style), **and bump the hard assertion**:
   ```javascript
   if (ARRAY_COLLECTIONS.length !== 35) {   // MUST become the new count
     throw new Error(`db/collections.js: expected 35 array collections, got ${ARRAY_COLLECTIONS.length}`);
   }
   ```
   This assertion **throws at module load** if the count doesn't match — a
   forgotten bump crashes the entire app on boot, not a silent bug.
   `COLLECTION_TARGETS` is auto-derived from `ARRAY_COLLECTIONS` (loop at
   lines 97-100, routes every entry to `'demo'`) — no separate edit needed
   there, but its own completeness assertion (lines 105-111) will also throw
   if a new key is somehow left unclassified.

2. **`db/schema.sql`** — one `CREATE TABLE IF NOT EXISTS <name>` + one
   `CREATE INDEX ... ON <name>(project_id)` pair per new collection, copied
   verbatim from the `ddFindings` exemplar:
   ```sql
   CREATE TABLE IF NOT EXISTS ddFindings (
     id TEXT PRIMARY KEY,
     project_id TEXT,
     seq INTEGER NOT NULL,
     data TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_ddFindings_project ON ddFindings(project_id);
   ```
   Blob-per-row shape — no normalized `area`/`status`/`severity` columns,
   per this file's own header rule (guard at the application layer only).

3. **`db/dealSeed.js`** — **explicitly DO NOT add the new collections to
   `DEAL_SEED_COLLECTIONS`** (currently `['checklistTemplates',
   'assessmentTemplates', 'processCatalog', 'ddRequestTemplates']`, line 31).
   This is an allowlist, not a denylist — a real deal must start with an
   EMPTY org lane by design (same reasoning as `ddRequestItems`/`ddFindings`,
   which are also absent from this list). `test/deal-seed.test.js` proves
   the allowlist programmatically against the full current inventory — no
   code change needed there, but the planner should be aware a new
   collection is correctly invisible to that test until/unless intentionally
   added.

### `validators/org.js` (validator, request-response)

**Analog:** `validators/dd.js` (full file, 176 lines)

**Imports pattern** (lines 1-15):
```javascript
'use strict';
const { z } = require('zod');
const { registerSchema, EmptyBodySchema } = require('./index');
const { DD_AREA_IDS } = require('../db/accessPolicy'); // if org needs the same area-id enum anywhere
```

**Upsert-by-id core pattern** (lines 82-113, `DdRequestItemUpsertSchema`) —
copy this shape for `OrgPositionUpsertSchema`/`OrgDecisionSchema`/
`FlightRiskEntryUpsertSchema`:
```javascript
const OrgPositionUpsertSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX).optional(),
  title: z.string().trim().min(1, 'Position title is required.').max(TEXT_MAX).optional(),
  level: z.string().trim().max(120).optional(), // D-08: free text, no z.enum()
  reportsToId: z.string().trim().max(120).nullable().optional(),
  employeeId: z.string().trim().max(120).nullable().optional(),
  state: z.enum(['current', 'target']).optional(), // D-06
}).refine((data) => data.id || (data.title && data.title.trim()), {
  message: 'Position title is required.', path: ['title'],
});

registerSchema('POST', '/api/org/positions', OrgPositionUpsertSchema);
registerSchema('DELETE', '/api/org/positions/:id', EmptyBodySchema);
```
**Every `z.string()` needs an explicit `.max()`** — a repo-wide grep
(`grep -rn "z\.string()" validators/ | grep -vc "max("`) fails the suite
otherwise, scoped across all of `validators/`, not just this new file.

**Conversion-schema pattern** (lines 154-164, `DdFindingConvertSchema`) —
copy verbatim shape for the flight-risk conversion route:
```javascript
const DdFindingConvertSchema = z.object({
  toTask: z.boolean().optional(),
  toRaid: z.boolean().optional(),
}).refine((data) => data.toTask === true || data.toRaid === true, {
  message: 'At least one of toTask or toRaid must be true.',
  path: ['toTask'],
});
registerSchema('POST', '/api/dd/findings/:id/convert', DdFindingConvertSchema);
```

**Enforcement backstop:** `test/write-validation-coverage.test.js` fails the
whole suite on any write route (`POST`/`PUT`/`DELETE`) with no
`registerSchema()` call — every new `/api/org/*` write route MUST be
registered here or the suite goes red, not silently unvalidated.

### `server.js` — new `/api/org/positions*` routes (controller, CRUD)

**Analog:** `/api/dd/findings` CRUD block, `server.js:4193-4262`

**Core CRUD pattern** (upsert-by-id, guard-before-mutate):
```javascript
app.get('/api/org/positions', (req, res) => {
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const state = req.query.state === 'target' ? 'target' : 'current';
  // D-07: current is open to any deal member; target requires the hr grant.
  if (state === 'target' && !accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    return res.status(403).json({ error: 'You are not cleared for the target org design.' });
  }
  const lane = orgPositionsLane(db).filter((p) => p.state === state);
  res.json(lane);
});

app.post('/api/org/positions', (req, res) => {
  // D-04 tier-1: any area-cleared (hr-granted) member may create/maintain
  // org structure — NOT restricted to isAdminOrIlRequest.
  const deal = controlStore.getDeal(req.dealContext.dealId);
  if (!accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    return res.status(403).json({ error: 'You are not cleared to edit org structure.' });
  }
  // ...upsert-by-id, mirroring POST /api/dd/findings's shape exactly
});
```
**Critical note (D-07, the phase's flagged highest-leak-risk spot):** the
list filter keys on **both** the collection AND the `state` field — a
`GET /api/org/positions?state=target` from an uncleared session MUST be
refused server-side regardless of what client JS constructs (UI-SPEC
Tension 3, RESEARCH.md Anti-Pattern list, Phase-4-Wave-2 precedent at the
old `server.js:446` GET-role-check gap).

### `server.js` — new `/api/org/decisions` routes (controller, event-driven append-only log)

**Analog:** D-04 tier-2 authz shape, `server.js:3788-3796` (Phase 5's
re-baseline route, the exact reusable call the planner should copy verbatim
per CONTEXT.md D-04 and RESEARCH.md's Pattern 1)

```javascript
// D-15/D-04 (Phase 6): re-baselining is restricted to admin and the
// Integration Lead (hrbp), enforced server-side. [pattern comment carried
// forward from server.js:479-486's original]
app.post('/api/org/decisions', (req, res) => {
  if (!isAdminOrIlRequest(req)) {
    return res.status(403).json({ error: 'Only the Integration Lead or admin may record a decision.' });
  }
  const deal = controlStore.getDeal(req.dealContext.dealId);
  // D-02: decisions are restricted content — gate on the hr area too, not just the role
  if (!accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    return res.status(403).json({ error: 'You are not cleared for organisation decisions.' });
  }
  // append-only insert into orgDecisions — NEVER an update/overwrite
});
```
**Append-only shape:** D-13 explicitly follows Phase 5's D-12 baseline
history pattern — a flat, write-only collection; "current decision" is
computed client- or server-side as the latest entry for a `positionId`,
never stored redundantly on the position row. No file:line citation exists
for a literal precedent beyond this reasoning (RESEARCH.md Pattern 3 — "no
new code pattern to invent, just a new collection with the same shape
discipline").

**`isAdminOrIlRequest` — the exact function to reuse, verbatim** (`server.js:495`):
```javascript
function isAdminOrIlRequest(req) {
  return !!(req.portalUser && req.portalUser.sessionId !== null && ['admin', 'hrbp'].includes(req.portalUser.role));
}
```
Note the `sessionId !== null` check — deliberately excludes the
`X-Admin-Token` break-glass path (WR-01 fix). Do not re-decide this
exclusion; carry it forward unmodified (RESEARCH.md Pattern 1).

### `server.js` — new `/api/org/flight-risk` routes (controller, CRUD + NEW read-audit)

**Analog (CRUD half):** `/api/dd/findings` block, `server.js:4178-4262`
**Analog (read-audit half — NEW code, no existing precedent):**
`refuseDdArea()` (`server.js:3973-3990`) for the denial shape;
`db/auditHook.js#recordSecurityEvent()` (lines 126-141) for the call itself.

```javascript
app.get('/api/org/flight-risk', (req, res) => {
  const deal = controlStore.getDeal(req.dealContext.dealId);
  if (!accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    auditHook.recordSecurityEvent({
      actor: req.portalUser, action: 'org-flightrisk-denied', dealId: req.dealContext.dealId,
      subject: null, before: null, after: null, request: requestMeta(req),
    });
    return res.status(403).json({ error: 'You are not cleared for the flight-risk register.' });
  }
  // D-03: audit the SUCCESSFUL read too — zero precedent for this in the
  // codebase (grepped all ~49 app.get() handlers, zero recordSecurityEvent
  // calls). Scoped to THIS register only — reading open-tier org data must
  // write ZERO audit rows.
  auditHook.recordSecurityEvent({
    actor: req.portalUser, action: 'org-flightrisk-read', dealId: req.dealContext.dealId,
    subject: null, before: null, after: null, request: requestMeta(req),
  });
  res.json(flightRiskLane(readDb()));
});
```

**Write-tier-2 gate** — same `isAdminOrIlRequest(req)` + `hasAreaGrant`
double-check as the decisions route above (D-04).

**Known, accepted labeling inaccuracy (do not "fix" — out of scope):**
`recordSecurityEvent()` hardcodes `db_kind: 'control'` literally
(`db/auditHook.js:136`, verified `INSERT_SQL` params) even though the
schema comment documents `'control' | 'runtime' | 'demo' | 'deal'`. A
flight-risk read is conceptually `'deal'`-scoped but will record as
`'control'`. Functionally harmless today (`queryAudit()` never filters on
`db_kind`) — flag it in the plan as a known gap, do not spend a task fixing
it (RESEARCH.md Pitfall 4, Assumptions Log A2).

### `server.js` — `POST /api/org/flight-risk/:id/convert` (controller, event-driven conversion)

**Analog:** `POST /api/dd/findings/:id/convert`, `server.js:4282-4361` — copy
this route's structure exactly (dedupe-by-`source`, bidirectional link
arrays, one write at the end):

```javascript
app.post('/api/org/flight-risk/:id/convert', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const entry = flightRiskLane(db).find((e) => e.id === req.params.id);
  if (!accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) { /* refuse, D-02 */ }

  // A1 (RESEARCH.md Assumptions Log): use a NEW source prefix, distinct
  // from 'dd-finding:<id>' — e.g. 'org-flightrisk:<id>' — naming is the
  // planner's call, but it MUST be distinguishable so D-17's RAID-outbound
  // filter (below) can tell the two provenances apart.
  const source = 'org-flightrisk:' + entry.id;
  let task = null, raidEntry = null, mutated = false;

  if (b.toTask) {
    const tLane = taskLane(db);
    task = tLane.find((t) => t.source === source) || null;
    if (!task) { task = { id: newId('task'), title: entry.person, /* ... */ source, createdAt: new Date().toISOString() }; tLane.push(task); mutated = true; }
    if (!entry.linkedTaskIds.includes(task.id)) { entry.linkedTaskIds.push(task.id); mutated = true; }
  }
  if (b.toRaid) {
    const rLane = raidLane(db);
    raidEntry = rLane.find((r) => r.source === source) || null;
    if (!raidEntry) {
      raidEntry = {
        id: newId('raid'), type: 'risk', title: entry.person,
        severity: entry.riskLevel, // D-16: copied verbatim, all four RAID levels reused
        source, createdAt: new Date().toISOString(),
      };
      rLane.push(raidEntry); mutated = true;
    }
    if (!entry.linkedRaidIds.includes(raidEntry.id)) { entry.linkedRaidIds.push(raidEntry.id); mutated = true; }
  }
  if (mutated) writeDb(db);
  res.json({ success: true, task, raid: raidEntry, entry });
});
```

### `server.js` — `GET /api/org/summary` (controller, request-response rollup)

**Analog:** `GET /api/dd/summary`, `server.js:4375-4417` — this is the
literal mirror D-21 names.

**Core pattern** (filter-before-tally, restricted key structurally absent):
```javascript
app.get('/api/org/summary', (req, res) => {
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const grantedSet = new Set(accessPolicy.grantedAreas(deal, req.portalUser));

  const currentPositions = orgPositionsLane(db).filter((p) => p.state === 'current');
  const response = {
    open: {
      currentHeadcount: currentPositions.filter((p) => p.employeeId).length,
      openPositions: currentPositions.filter((p) => !p.employeeId).length,
    },
  };

  // D-01/D-20: only assign `restricted` when granted — JSON.stringify
  // naturally omits a key that was never assigned. NEVER
  // `response.restricted = grantedSet.has('hr') ? {...} : null`.
  if (grantedSet.has('hr')) {
    const targetPositions = orgPositionsLane(db).filter((p) => p.state === 'target');
    response.restricted = {
      targetHeadcount: targetPositions.filter((p) => p.employeeId).length,
      headcountDelta: /* target - current, D-19's most-asked number */ 0,
      byDecisionType: {}, // tally D-14's 5 values from orgDecisions' derived-current pass
      unmitigatedHighCriticalFlightRisks: flightRiskLane(db).filter(
        (e) => ['high', 'critical'].includes(e.riskLevel) && !e.mitigation
      ).length,
    };
  }
  res.json(response);
});
```
See RESEARCH.md Open Question 2 for the filter-once-tally-multiple structure
recommendation (mirroring `GET /api/dd/summary`'s exact shape).

### `server.js` — `GET /api/raid` outbound filter (D-17, controller, transform)

**This is NOT a copy of `filterByAreaGrant` — do not reuse it directly.**
RESEARCH.md Pitfall 1 (verified against live `data/demo.db`): RAID entries
carry `workstreamId`, never `.area`; `filterByAreaGrant`'s
`granted.has(item.area)` check silently empties the RAID lane for EVERY
caller including admin if called naively.

**Current unfiltered route** (`server.js:3847-3849`, what exists today):
```javascript
app.get('/api/raid', (req, res) => {
  res.json(raidLane(readDb()));
});
```

**The correct new shape (provenance-based, `db/accessPolicy.js` or inline
in server.js's RAID section)** — verbatim from RESEARCH.md's Code Examples
section:
```javascript
function resolveRaidEntryClearanceArea(entry, db) {
  if (!entry.source) return null; // unlinked entry — no clearance gate applies
  const ddMatch = /^dd-finding:(.+)$/.exec(entry.source);
  if (ddMatch) {
    const finding = ddFindingsLane(db).find((f) => f.id === ddMatch[1]);
    return finding ? finding.area : null;
  }
  const flightRiskMatch = /^org-flightrisk:(.+)$/.exec(entry.source);
  if (flightRiskMatch) return 'hr'; // D-02: flight-risk clearance is always the hr grant
  return null;
}

app.get('/api/raid', (req, res) => {
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const visible = raidLane(db).filter((entry) => {
    const area = resolveRaidEntryClearanceArea(entry, db);
    return area === null || accessPolicy.hasAreaGrant(deal, req.portalUser, area);
  });
  res.json(visible);
});
```
**DO NOT invert `DD_AREA_WORKSTREAM` to key off `workstreamId`** — it is a
lossy many-to-one map (`financial`+`tax` → `ws_finance`; `legal`+
`complianceEsg` → `ws_legal`), verified by inspection.

**Companion fix (same commit, `execution.html:114-115`):**
```css
.raid-lvl.critical{ color:#C0341D; font-weight:900; }
```
Reuses `.page-banner--critical`'s existing color (`style.css:8174-8175`) —
`RAID_LEVELS` was widened to 4 in Phase 4 but this CSS rule set was never
extended; a `critical` DD-finding conversion is already live and unstyled
today, independent of this phase (RESEARCH.md Pitfall 2).

**Companion fix (same commit, `public/js/due-diligence.js:325`):**
```javascript
// OLD (becomes false the moment this route ships D-17):
text: 'Visible to the whole deal team once created — not only members cleared for this area.',
// NEW (UI-SPEC Copywriting Contract):
text: 'Visible only to members cleared for this register.',
```

### `public/org.html` + `public/js/org.js` (page + component, request-response / CRUD)

**Analog:** `public/due-diligence.html` (shell) + `public/js/due-diligence.js` (behavior)

**Page-local `<style>` block idiom** (`due-diligence.html:11-42`, copy the
block structure, not the literal rules):
```html
<link rel="stylesheet" href="/css/style.css?v=1784600001">
<script src="/js/transitions.js?v=1784700004"></script>
<style>
  .org-wrap{ max-width:1100px; margin:0 auto; } /* matches .dd-wrap */
  .org-hero{ margin-bottom:1.25rem; }
  .org-hero h1{ font-size:1.9rem; color:var(--te-dark-teal); margin:0 0 .35rem; }
  /* ...page-scoped rules only, no new CSS file */
</style>
```
No `pageAccess` entry in `public/js/transitions.js` — see IN-02 precedent
below.

**IIFE wrapper + JSDoc header idiom** (`due-diligence.js:1-21`):
```javascript
/**
 * Org workspace (ORG-01/02/03) — renders exactly the position tree the
 * server returned for the signed-in caller. [... phase-specific doc,
 * mirroring due-diligence.js's own doc-comment structure describing what
 * T-04-06/T-04-01-equivalent disciplines this file follows]
 */
(function () {
  'use strict';
  var STATUSES = [ /* ... */ ];
  // ...
})();
```

**`textContent`-only element helper** — `due-diligence.js` never assigns
`innerHTML` anywhere; every DOM string write goes through a small `el()`
helper building elements and setting `.textContent`/`.text` properties.
Copy this discipline verbatim for `org.js` — MNPI content (position titles,
occupant names, decision rationale, flight-risk mitigation text) must never
pass through an `innerHTML` sink.

### `public/js/deal-home.js` (component, request-response fan-out)

**Analog:** itself — `renderDiligence()` (lines ~146-181) for the panel
shape, `renderStaleSynergyNudge()` (lines ~193-238) for the nudge shape,
`renderDealHome()`'s `Promise.all` (lines ~260-284) for the fan-out.

**Fan-out is currently 4 fetches, not 3** (verified, `deal-home.js:267-271`)
— add a 5th:
```javascript
Promise.all([
  fetch('/api/deals').then(r => r.json()).catch(() => []),
  fetch('/api/assessment-status').then(r => r.json()).catch(() => null),
  fetch('/api/dd/summary').then(r => r.json()).catch(() => null),
  fetch('/api/synergies/rollup').then(r => r.json()).catch(() => null),
  fetch('/api/org/summary').then(r => r.json()).catch(() => null),   // NEW
]).then(function (results) {
  // ...
  renderOrgPanel(wrap, results[4]);
  renderFlightRiskNudge(wrap, results[4]);
});
```

**Panel render pattern** — copy `renderDiligence()`'s shape (never a
client-side list of "every possible" value; renders only what the response
contains):
```javascript
function renderOrgPanel(wrap, summary) {
  var section = el('div', { className: 'card deal-home-section' });
  section.appendChild(el('h2', { className: 'deal-home-section-title', text: 'Organisation' }));
  var openDiv = el('div', { className: 'org-summary-open' }); // tag-level, per D-20/Tension 3
  // ...current headcount, open positions rows, .deal-home-readiness-row style
  section.appendChild(openDiv);
  if (summary && summary.restricted !== undefined) {
    var restrictedSection = document.createElement('section'); // DIFFERENT TAG than open's <div>
    restrictedSection.className = 'org-summary-restricted';
    // ...target headcount, delta (bold+red only if negative), decision counts, flight-risk count
    section.appendChild(restrictedSection);
  }
  wrap.appendChild(section);
}
```

**Nudge pattern** — copy `renderStaleSynergyNudge()`'s shape as a PATTERN,
not shared code (its own comment: "NEVER called, imported or extended" for
a second nudge — write an independent `renderFlightRiskNudge()`):
```javascript
function renderFlightRiskNudge(wrap, summary) {
  var mine = (summary && summary.restricted && summary.restricted.mine &&
              summary.restricted.mine.unmitigatedCount) || 0;
  if (mine <= 0) return;
  var heading = findSectionHeading(wrap, 'Organisation'); // reuse the existing helper
  // badge + .page-banner.page-banner--warning + window.makeBannerDismissible,
  // exact call signature as renderStaleSynergyNudge, distinct DOM ids
  // (#org-risk-nudge-badge / #org-risk-nudge-banner)
}
```

## Shared Patterns

### Authentication / Clearance gate (D-01, D-02, D-07)

**Source:** `db/accessPolicy.js` (full module, esp. `grantedAreas()` lines
85-92, `hasAreaGrant()` lines 97-99, `filterByAreaGrant()` lines 104-107,
`assertAreaGrant()`/`AreaAccessError` lines 52-63, 113-115)

**Apply to:** every `/api/org/*` route, and the new D-17 RAID filter.

The module's own header comment (lines 1-6) explicitly names this phase as
its anticipated second consumer — "rather than inventing a second
row/area-level access-policy pattern." **No new grant dimension** (D-02) —
reuse the existing `hr` DD area key verbatim for org decisions/target-state/
flight-risk clearance.

```javascript
function grantedAreas(deal, user) {
  if (!user) return [];
  if (!deal) return [];
  if (user.role === 'admin' || user.role === 'hrbp') return DD_AREA_IDS.slice();
  const grant = deal.memberGrants && deal.memberGrants[user.username];
  const ddAreas = grant && Array.isArray(grant.ddAreas) ? grant.ddAreas : [];
  return ddAreas.filter((a) => DD_AREA_ID_SET.has(a));
}
```

### Tier-2 write authz (D-04)

**Source:** `server.js:495` (`isAdminOrIlRequest`) + `server.js:3790` (call site)
**Apply to:** every org-decision write, every flight-risk-entry create/edit.

```javascript
function isAdminOrIlRequest(req) {
  return !!(req.portalUser && req.portalUser.sessionId !== null && ['admin', 'hrbp'].includes(req.portalUser.role));
}
```
Test precedent for a grep-level guard on this pattern: `test/synergy-stage.test.js`
lines 846-874 ("grep-level guard — isAdminOrIlRequest is defined once...",
"WR-01 — isAdminOrIlRequest excludes the X-Admin-Token break-glass
identity"). Write an equivalent set of assertions in `test/org-decisions.test.js`.

### Denial-side audit (existing pattern) + read-side audit (NEW, D-03)

**Source:** `server.js:3973-3990` (`refuseDdArea`) for denial shape;
`db/auditHook.js:126-141` (`recordSecurityEvent`) for the call itself.

```javascript
function refuseDdArea(req, res, areaId) {
  auditHook.recordSecurityEvent({
    actor: req.portalUser, action: 'dd-access-denied', dealId: req.dealContext.dealId, subject: areaId,
    before: null, after: null, request: requestMeta(req),
  });
  const err = new accessPolicy.AreaAccessError();
  res.status(err.status).json({ error: err.message });
}
```
For D-03's genuinely-new successful-read half, there is **zero existing
call site to copy** (verified: 0 of ~49 `app.get()` handlers call
`recordSecurityEvent`) — write it directly against the same function,
`action: 'org-flightrisk-read'`, `before: null, after: null`. Scope this to
the flight-risk register ONLY — reading current-state org positions or the
`/api/org/summary` rollup must write zero audit rows (D-03's "scoped to
that register only").

### Duplicated enums move together (D-14, D-16)

**Source:** `RAID_LEVELS` (2 copies: `server.js:3845` +
`validators/workstream.js`) and `SYN_STAGES` (3 copies: `server.js`,
`validators/workstream.js`, `public/js/execution.js:54`), each with an
anti-drift test.

**Apply to:** D-14's 5-value decision vocabulary (`retain`, `redeploy`,
`in-selection`, `redundant`, `open`) — this is a BRAND NEW enum (closer to
`SYN_STAGES`'s situation than `RAID_LEVELS`'s reuse case, per RESEARCH.md
Open Question 1), so declare an independent copy in each of: `server.js`,
`validators/org.js`, and (recommended) `public/js/org.js` as a JS array
even if only used to build `<option>` tags — this gives the anti-drift test
something concrete to assert against.

**Anti-drift test template** — `test/synergy-stage.test.js` lines 76-92:
```javascript
test('org-decisions (a): server.js, validators/org.js and public/js/org.js all hold the identical ordered vocabulary', () => {
  const expected = ['retain', 'redeploy', 'in-selection', 'redundant', 'open'];
  assert.deepStrictEqual(app.ORG_DECISION_TYPES, expected);
  assert.deepStrictEqual(orgValidators.ORG_DECISION_TYPES, expected);
  const clientSrc = fs.readFileSync('public/js/org.js', 'utf8');
  const match = clientSrc.match(/var ORG_DECISION_TYPES\s*=\s*(\[[^\]]*\]);/);
  assert.ok(match, 'public/js/org.js must declare a var ORG_DECISION_TYPES = [...] array literal');
  // ...deepStrictEqual all three
});
```

D-16 (flight-risk severity) is the OPPOSITE case — REUSE `RAID_LEVELS`
verbatim, zero new enum, zero new copies, zero new i18n keys; the existing
2-copy anti-drift test in `test/dd-findings.test.js` (lines 310-320) already
covers it and needs no change.

### No `pageAccess` entry for a clearance-gated page (D-12, IN-02)

**Source:** `public/js/transitions.js` lines 145-184 comment block

`due-diligence.html` deliberately has NO entry in the `pageAccess` map — DD
area access (and now org access) is per-deal-member clearance, not
role-based, so a role-based page gate would incorrectly block a legitimately
cleared `pmo`/`employee` deal member. **Apply verbatim to `org.html`: add NO
entry.** The server-side clearance check on every `/api/org/*` route is the
actual control; the page loading is not.

### Server-computed rollup, restricted key structurally absent (D-19, D-20, D-21)

**Source:** `GET /api/dd/summary`, `server.js:4375-4417`

```javascript
// T-04-45: filter BEFORE any tally is computed.
const items = accessPolicy.filterByAreaGrant(ddRequestLane(db), deal, req.portalUser);
// D-16/T-04-46: seeded ONLY for areas the caller is granted — an uncleared
// area gets no entry at all (never a zero row).
```
Apply this exact discipline to `GET /api/org/summary`'s `restricted` key —
`if (grantedSet.has('hr')) response.restricted = {...}`, never a ternary to
`null`.

### The WAL-checkpoint trap (D-18, carried forward — fired in every prior
phase touching a committed `.db`)

Before committing the D-18 hand-tuned demo seed:
```bash
sqlite3 data/demo.db "PRAGMA wal_checkpoint(TRUNCATE);"
git diff --stat data/demo.db   # must be non-empty; git status alone is insufficient
```
A write to a committed WAL-mode `.db` can land only in the gitignored
`-wal` sidecar, leaving the tracked file byte-unchanged and `git status`
clean.

### Test harness template (D-03's flight-risk audit tests)

**Source:** `test/dd-access-policy.test.js` (full file) — boots the real app
against an isolated temp `control/runtime/demo/deals/audit` DB quintet via
`process.env.MA_*_DB_PATH` overrides, calls `auditHook.queryAudit({dealId,
limit: 500})`, filters by `action`, asserts row counts before/after a probe.
Copy this harness shape directly for `test/org-flight-risk-audit.test.js`.

## No Analog Found

None — every file in this phase's scope has at least a role-match analog
(see table above). The closest to "no analog" is the D-03 successful-read
audit call site and the D-17 provenance-based RAID filter, both of which
are NEW logic per RESEARCH.md's own framing ("the risk is entirely in
applying an existing primitive to a shape it wasn't built for") — flagged
inline above rather than listed here, since a structural analog (the
denial-audit call shape; `filterByAreaGrant`'s general mechanics) does
exist even though the code itself must be new.

## Metadata

**Analog search scope:** `db/`, `validators/`, `server.js` (DD + RAID +
synergy + employees sections), `public/js/` (deal-home.js,
due-diligence.js, transitions.js, execution.js), `public/*.html`
(due-diligence.html, execution.html), `test/` (dd-access-policy,
dd-findings, synergy-stage)
**Files scanned:** ~15 read directly this session (full or targeted), plus
grep passes across `server.js`, `validators/`, `public/js/`
**Pattern extraction date:** 2026-08-06
