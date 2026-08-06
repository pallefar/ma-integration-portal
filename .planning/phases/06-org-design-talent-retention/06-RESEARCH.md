# Phase 6: Org Design & Talent Retention - Research

**Researched:** 2026-08-06
**Domain:** Server-side clean-room access control (reused pattern), append-only governance logs, read-audit logging (new), vanilla-JS collapsible tree rendering — all within the existing Express/better-sqlite3/zod stack
**Confidence:** HIGH — every claim below was verified this session by reading the cited file:line or executing the cited command; no library research was needed (this phase adds zero new dependencies)

## Summary

Phase 6 is genuinely greenfield (confirmed: zero matches for `reportsTo`/`orgChart`/`flightRisk`/`redundanc`/`headcount` anywhere in `*.js`/`*.html` outside prose and one seeded RAID row), so the implementation risk is not "will this library work" — there are no new libraries — it is **getting the reused access-control primitive right on a shape it was not built for**. `db/accessPolicy.js`'s `filterByAreaGrant(items, deal, user)` filters on `item.area`, and every RAID entry in this codebase (verified directly against `data/demo.db`) carries `workstreamId`, never `area`. A plan that calls `filterByAreaGrant(raidLane, deal, user)` naively — the most obvious reading of D-17's text — will return an **empty array for every caller, including admin**, because `item.area` is `undefined` on every row and `undefined` is never a member of any granted-areas set. This is not a hypothetical: I read the raw JSON of `raid_seed_1` from `data/demo.db` and confirmed there is no `area` key at all. D-17's outbound filter needs new logic keyed on `entry.source` (parsed back to the originating `ddFindings` row's `.area`, or — new in this phase — a flight-risk provenance prefix gated on the fixed `hr` area), not a drop-in reuse of the existing helper. This is this phase's single highest-risk item and is documented in full under Pitfall 1.

The two pre-existing defects the UI-SPEC flagged are both confirmed exactly as described: `execution.html:115` truly has no `.raid-lvl.critical` rule (only `.high`/`.medium`/`.low`), and it is a **live, reachable** gap — `POST /api/dd/findings/:id/convert` (shipped in Phase 4) already copies a finding's `severity` verbatim into a RAID entry, and `DD_FINDING_SEVERITIES` includes `'critical'`, so a critical DD finding converted today already renders with no color treatment. `due-diligence.js:325`'s exact string is confirmed as the only occurrence of that claim anywhere in the codebase (single grep hit) — it will become false the moment D-17 ships.

D-03's successful-read audit has no precedent (confirmed: zero of the ~49 `app.get(...)` handlers in `server.js` call `recordSecurityEvent`), but `db/auditHook.js#recordSecurityEvent()` is directly usable for it with no schema changes — `before`/`after` are nullable columns (verified against `db/audit-schema.sql`), so a read event with `before: null, after: null` is a first-class row, not a workaround. The cost is one synchronous `better-sqlite3` INSERT per successful read of the flight-risk register — cheap per-call, but D-03 explicitly rejected session-scoped dedupe, so every poll of that register accumulates a row.

D-04's write-authz split (IL/admin only for decisions and flight-risk entries) has an exact, already-tested precedent to reuse verbatim: `isAdminOrIlRequest(req)` at `server.js:495`, used as the first statement of the Phase-5 re-baseline route (`server.js:3790`). No new authz primitive is needed.

None of the 23 locked decisions are un-implementable as written (the class of problem Phase 4's D-22 hit). The closest is D-17, addressed above — it is implementable, but not the way its own phrasing suggests, and the plan must say so explicitly rather than assume `filterByAreaGrant` generalizes for free.

**Primary recommendation:** Treat D-17 as new access-control code, not a reuse of `filterByAreaGrant`; audit the flight-risk register's successful reads via `recordSecurityEvent()` with `db_kind` accepted as `'control'` (a cosmetic mislabel, not a functional gap); and reuse `isAdminOrIlRequest(req)` verbatim for every D-04 write gate.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Org structure CRUD (positions, tree) | API / Backend (`server.js` new `/api/org/positions*` routes) | Browser (`public/js/org.js` pure DOM tree render) | Vanilla-JS SPA-per-page architecture (no framework) — server owns clearance-scoped data, client owns presentation only, per the established `due-diligence.html`/`due-diligence.js` split |
| Decision register (ORG-02) | API / Backend | Browser | Append-only log lives server-side (SQLite blob-per-row); client renders history + form, never computes the derived "current decision" itself |
| Flight-risk register (ORG-03) | API / Backend | Browser | Same split; the clearance gate and the (new) read-audit both must live server-side per D-03/D-04 — a client-side gate would be exactly the "hidden in the UI" failure DD-04/D-04 forbid |
| Clearance decision (D-01/D-02/D-07) | API / Backend (`db/accessPolicy.js`, consumed from `server.js` route handlers) | — | Zero-trust: `grantedAreas()`/`hasAreaGrant()` already run server-side only; this phase is a pure consumer, adds no new tier |
| `/api/raid` outbound filtering (D-17) | API / Backend (`server.js` RAID GET route) | — | Must be server-side by construction — D-20's "absent, not zeroed" contract is unenforceable from the client |
| Deal-home org panel (D-19/D-21) | API / Backend (`GET /api/org/summary`, server-computed tallies) | Browser (`deal-home.js` render-only) | Explicitly re-derived from D-21's own stated rationale: client-side tallying would ship target-state rows to an uncleared client and hide them locally — the same failure DD-04 forbids |
| Database persistence | Database / Storage (`db/schema.sql` + 2-3 new `ARRAY_COLLECTIONS` entries) | — | Existing blob-per-row SQLite pattern; no schema paradigm change |
| Audit of successful reads (D-03) | Database / Storage (`audit.db`, via `db/auditHook.js`) | API / Backend (the route handler call site) | Mirrors the existing denial-audit pattern exactly — new call site, no new storage mechanism |

## User Constraints (from CONTEXT.md)

### Locked Decisions

23 decisions, all chosen explicitly by the user (23/23 recommendations taken) — reproduced in full because this research treats them as fixed inputs, not open questions:

**Sensitivity & clearance model:** D-01 (tiered clean-room — current-state org open, target-state/decisions/flight-risk restricted) · D-02 (clearance unit is the existing `hr` DD-area grant, no new grant dimension) · D-03 (both denials AND successful reads of the flight-risk register audited) · D-04 (write authz split: area-cleared members create/maintain org structure; only IL/admin record decisions or flight-risk entries, enforced server-side as the route's first statement)

**Org structure model:** D-05 (position is a first-class entity — new `orgPositions` collection with `{id, title, level, reportsToId, employeeId|null, state}`) · D-06 (two states — current/target — on one position record via a `state` discriminator) · D-07 (target state restricted, current state open; the list filter keys on `state` AND collection — "the most likely place in the phase for a leak") · D-08 (`level` is free-text with a suggestion datalist, not an enum)

**Populating & visualising:** D-09 (person on a position is a link to an `employees` row, `position.employeeId → employees[].id`; deleting a linked employee must be guarded against orphaning a position) · D-10 (manual add PLUS bulk paste importer, precedent `public/pmo.html`'s `#wiz-roster-raw` textarea) · D-11 (collapsible indented tree of position cards, no boxes-and-lines) · D-12 (new page `public/org.html` + `public/js/org.js`, NO `pageAccess` entry in `transitions.js`, per the IN-02 precedent)

**Decision register (ORG-02):** D-13 (append-only `orgDecisions` log, `{id, positionId, employeeId, type, rationale, decidedBy, decidedAt, effectiveDate}`; current decision is derived as the latest entry, never stored on the position) · D-14 (five-value vocabulary: `retain`, `redeploy`, `in-selection`, `redundant`, `open`; an enum in this repo gets duplicated across copies and MUST move together)

**Flight-risk register (ORG-03):** D-15 (entry carries `mitigation` free text AND one-click bidirectional conversion to a Day-1 task and/or RAID entry, same spine as Phase 4's D-12) · D-16 (risk level reuses RAID's four levels — `low`/`medium`/`high`/`critical` — zero new enum)

**In-phase security closure:** D-17 (outbound clearance-filtering on `/api/raid` closed in this phase — the Phase-4 accepted risk T-04-21 — widening the phase's blast radius into the RAID lane)

**Demo showcase:** D-18 (hand-tuned org lane seed over the 5 existing `data/demo.db` employees, including fictional flight-risk entries, following Phase 5's D-10; ⚠ standing WAL-checkpoint trap applies)

**Deal home & rollups:** D-19 (two-tier org panel: open tier = current headcount + open positions; restricted tier = target headcount, current→target delta, decision-type counts, unmitigated high/critical flight risks) · D-20 (absent entirely for uncleared members — not zeroed, not masked; server omits restricted keys) · D-21 (new `GET /api/org/summary`, server-computed, mirroring `GET /api/dd/summary`) · D-22 (flight-risk owners nudged via the existing deal-home owner-nudge pattern, restricted content itself)

**Explicitly deferred:** D-23 (no staleness signal on the flight-risk register this phase — flagged as a possible Phase-7 RPT-04 gap)

### Claude's Discretion

No area was delegated with "you decide" in CONTEXT.md — all 23 decisions were chosen explicitly. Latitude remains on: the exact `orgPositions` field set beyond what D-05 names; the orphan-guard behaviour on employee delete (**note: the UI-SPEC has since resolved this — see below**); import column-mapping tolerance for D-10; where unassigned employees/vacant positions render in the tree; i18n key naming; and whether `orgPositions`/`orgDecisions`/flight-risk are three collections or fewer.

**UI-SPEC resolution of the orphan-guard discretion item (06-UI-SPEC.md Surface Contract §4):** deleting an employee linked to a position **refuses the delete** (400, not a confirm-then-delete) unless the caller first unlinks the employee or deletes the position. This was CONTEXT.md-delegated discretion; the UI-SPEC (a later-stage artifact) has already made the call. The planner should follow the UI-SPEC's resolution rather than re-opening it, since `DELETE /api/employees/:id` today (verified, `server.js:4638-4648`) has **zero** existing orphan-guard code of any kind to extend — this is new logic either way.

### Deferred Ideas (OUT OF SCOPE)

Staleness signal on the flight-risk register (D-23, flagged for Phase 7) · named org-design scenarios A/B with comparison (rejected under D-06) · fixed `level` enum enabling headcount-by-level rollups (rejected under D-08) · impact×likelihood flight-risk grid (rejected under D-16) · nudging on stalled `in-selection` positions (rejected under D-22) · linking a redundancy decision to synergy cost-to-achieve (never in scope) · a boxes-and-lines org chart view (rejected under D-11) · org data in the Phase 7 export (RPT-01 scope question, not decided here).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORG-01 | The IL can represent the acquired organisation's structure and map roles beyond the current flat employee list | D-05 (`orgPositions` collection, verified greenfield — zero existing collision), D-08 (free-text `level`), D-09 (link to `employees`, verified `GET/POST/DELETE /api/employees` behavior — no role gate on read, `DEFAULT_WRITE_ROLES` on write, zero orphan-guard today), D-11/D-12 (tree UI + new page, verified `due-diligence.html`/`transitions.js` IN-02 precedent) |
| ORG-02 | The IL can record role-selection / redundancy decisions against roles or people | D-13/D-14 (append-only log, 5-value enum — verified this repo's enum-drift pattern applies: 2 copies for RAID_LEVELS, 3 copies for SYN_STAGES, planner must decide how many D-14 needs), D-04 (write authz — verified exact reusable primitive `isAdminOrIlRequest()` at `server.js:495`) |
| ORG-03 | The IL can maintain a key-talent flight-risk register (risk level, owner, mitigation), restricted to authorized roles and audited as sensitive data | D-15/D-16 (register + RAID-level reuse, verified `raid_seed_1` demo data as the concrete linkage example), D-02/D-07 (clearance via existing `hr` area grant, verified `db/accessPolicy.js` API surface), D-03 (read-audit — verified `recordSecurityEvent()` is directly usable, no schema change, zero precedent for auditing a GET today) |

</phase_requirements>

## Standard Stack

**No new dependencies.** This phase adds zero npm packages. Confirmed installed versions already in use, verified via direct invocation this session:

| Library | Installed Version | Role in this phase |
|---------|-------------------|---------------------|
| `better-sqlite3` | 13.0.1 (`node -e "require('better-sqlite3/package.json').version"` → `13.0.1`) | New `orgPositions`/`orgDecisions`/flight-risk tables via `db/schema.sql`, same blob-per-row pattern as every existing collection |
| `zod` | 4.4.3 (`node -e "require('zod/package.json').version"` → `4.4.3`) | New `validators/org.js` module, following `validators/dd.js`'s exact structure |
| Node.js | v22.18.0 (`node --version`) | Runtime; `node --test` is the test runner (no jest/vitest anywhere in this repo) |
| Express | 4.19.2 (per CLAUDE.md / `package.json`, unchanged) | New `/api/org/*` routes in `server.js` |

### Alternatives Considered

None — PROJECT.md §Constraints ("Vanilla JS, no framework, no build step") is a hard, non-negotiable constraint restated in this task's own `<hard_constraints>` block. No chart/UI library, no ORM, no client router was considered or should be recommended.

**Installation:** None required — nothing to install.

## Package Legitimacy Audit

**Not applicable.** This phase installs zero external packages. No `npm view`/registry check was needed or performed.

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```text
Browser (org.html / org.js)
   │
   │ GET /api/org/positions?state=current            (open, any deal member)
   │ GET /api/org/positions?state=target              (restricted — requires hr grant, verified server-side)
   │ POST/DELETE /api/org/positions                    (area-cleared write — D-04 tier 1)
   │ GET/POST /api/org/decisions                        (restricted read+write — D-04 tier 2, IL/admin only on write)
   │ GET/POST /api/org/flight-risk                       (restricted read+write — D-04 tier 2, IL/admin only on write, D-03 read audit)
   ▼
server.js route handlers  ───────────────►  db/accessPolicy.js
   │  1. resolve deal (controlStore.getDeal)     grantedAreas(deal,user) / hasAreaGrant(deal,user,'hr')
   │  2. assert clearance BEFORE reading data     (existing primitive, D-02: reused verbatim, no new grant dimension)
   │  3. (write-tier-2 routes) isAdminOrIlRequest(req) as the FIRST statement — reused from server.js:495 (D-15 precedent)
   │  4. readDb()/writeDb()  ───────────────►  db/store.js  ───────────────►  deals/<id>.db (SQLite, WAL)
   │  5. (successful flight-risk read only)  ─►  db/auditHook.js#recordSecurityEvent()  ───►  audit.db (append-only, separate connection)
   ▼
res.json(...)  — restricted keys OMITTED entirely for an uncleared caller (D-20), never null/zeroed

Separately, in the SAME phase's blast radius (D-17):
Browser (execution.js)  ──GET /api/raid──►  server.js RAID route  ──(NEW filter, see Pitfall 1)──►  raidLane(db)
                                                    │
                                                    └─ for entries whose `source` starts with 'dd-finding:' or
                                                       (new) 'org-flightrisk:' — resolve the ORIGINATING record's
                                                       area/clearance-key and gate on THAT, never on workstreamId
                                                       (workstreamId is lossy for this purpose — see Pitfall 1)
```

### Recommended Project Structure

```
server.js                        # new /api/org/* routes, appended after the existing RAID section (~line 3900),
                                  # mirroring the DD section's own placement and comment-block style
validators/org.js                # NEW — mirrors validators/dd.js exactly: registerSchema() calls, upsert schemas
                                  # with .refine() for create-vs-update field requirements
db/schema.sql                    # + CREATE TABLE for each new collection (2-3, planner's discretion), exemplar
                                  # is ddFindings/ddRequestItems (lines ~165-187)
db/collections.js                # + entries in ARRAY_COLLECTIONS (hard length assertion currently 35 — WILL
                                  # throw on load if the count constant isn't bumped to match)
db/dealSeed.js                   # NOT modified for the new collections (they must NOT be on DEAL_SEED_COLLECTIONS
                                  # — a real deal starts with an empty org lane by design, same as ddRequestItems)
public/org.html                  # NEW — copies due-diligence.html's shell verbatim per D-12/UI-SPEC §1
public/js/org.js                 # NEW — tree render, position editor, paste importer, decision/flight-risk forms
public/js/deal-home.js           # + renderOrgPanel() and renderFlightRiskNudge(), added to the existing
                                  # Promise.all fan-out (verified: currently 4 fetches, not 3 — see Pitfall 6)
public/js/transitions.js         # NO edit to pageAccess map (D-12) — org.html deliberately absent
public/js/due-diligence.js       # 1-line copy edit to the stale .dd-finding-convert-note text (D-17 fallout)
public/execution.html            # + .raid-lvl.critical CSS rule (pre-existing gap this phase's D-17 work touches
                                  # anyway — see Pitfall 2)
data/demo.db                     # D-18 hand-tuned seed — subject to the WAL-checkpoint trap (Pitfall 7)
test/org-*.test.js               # NEW test files, following the dd-*.test.js / synergy-*.test.js naming pattern
```

### Pattern 1: Server-side clearance gate as the route's first statement, reusing existing primitives

**What:** Every restricted-content route resolves the deal, then calls `accessPolicy.assertAreaGrant(deal, req.portalUser, 'hr')` (by-id shape, throws) or `accessPolicy.filterByAreaGrant(items, deal, req.portalUser)` (list shape, silently omits) BEFORE touching any row. For the write-tier-2 routes (decisions, flight-risk create/edit), an additional `isAdminOrIlRequest(req)` check runs as the literal first statement of the handler.
**When to use:** Every new `/api/org/*` route this phase adds.
**Example (verified, `server.js:479-497` — the exact function this phase should reuse, not reimplement):**
```javascript
// D-15: re-baselining is restricted to admin and the Integration Lead
// (hrbp), enforced server-side. [...]
function isAdminOrIlRequest(req) {
  return !!(req.portalUser && req.portalUser.sessionId !== null && ['admin', 'hrbp'].includes(req.portalUser.role));
}

// call site, server.js:3790 (the exact shape D-04's tier-2 routes should copy)
app.post('/api/synergies/:id/rebaseline', (req, res) => {
  if (!isAdminOrIlRequest(req)) return res.status(403).json({ error: '...' });
  // ... only then touch data
});
```
Note the `sessionId !== null` check — this deliberately EXCLUDES the `X-Admin-Token` break-glass path (which sets `role: 'admin'` but `sessionId: null`) per its own WR-01 comment. D-04's rationale ("governance acts with legal and severance consequences") is the same class of reasoning that motivated this exclusion originally — the planner should carry it forward unmodified rather than re-deciding whether break-glass should be allowed to record a redundancy decision.

### Pattern 2: Clearance-scoped server-computed rollup (D-21)

**What:** A single `GET /api/{lane}/summary` route pre-filters every source collection through `accessPolicy.filterByAreaGrant()`/`grantedAreas()` BEFORE any tally runs, then builds a response object whose restricted section is either fully present or fully absent — never partially computed then hidden.
**When to use:** `GET /api/org/summary`, the D-21 route.
**Example (verified, `server.js:4375-4417` — `GET /api/dd/summary`, the exact route D-21 names as its mirror):**
```javascript
app.get('/api/dd/summary', (req, res) => {
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const grantedSet = new Set(accessPolicy.grantedAreas(deal, req.portalUser));

  // T-04-45: filter BEFORE any tally is computed — an uncleared area's rows
  // never reach the counting loops below, so the aggregate itself can carry
  // no residue of an area the caller cannot see.
  const items = accessPolicy.filterByAreaGrant(ddRequestLane(db), deal, req.portalUser);
  const findings = accessPolicy.filterByAreaGrant(ddFindingsLane(db), deal, req.portalUser);
  // ... byArea Map seeded ONLY for granted areas — an uncleared area gets no
  // entry at all (never a zero row), so its absence carries no signal.
});
```
For `GET /api/org/summary`, the open tier (current headcount, open positions) has no clearance gate at all (D-01: current state is open to any deal member) — only the restricted tier (target headcount, delta, decision counts, unmitigated flight risks) needs the `grantedSet.has('hr')` gate, and per D-20 the `restricted` key must be **absent from the JSON entirely**, not `null` or `{}`, when the caller lacks the grant — `JSON.stringify` naturally omits an object key that was never assigned, so the simplest correct implementation is `const response = { open: {...} }; if (grantedSet.has('hr')) response.restricted = {...};` — never `response.restricted = grantedSet.has('hr') ? {...} : null`.

### Pattern 3: Append-only governance log with a derived "current" value (D-13)

**What:** Write-only inserts to a flat collection; "current state" is computed by finding the latest entry for a given foreign key, never stored redundantly on the parent record.
**When to use:** `orgDecisions` (D-13).
**Precedent:** This is explicitly Phase 5's D-12 pattern (baseline history) applied to a new domain — no new code pattern to invent, just a new collection with the same shape discipline. No file:line citation needed beyond D-13's own text, which already names the precedent.

### Anti-Patterns to Avoid

- **Reusing `filterByAreaGrant(raidLane, deal, user)` directly on RAID entries:** RAID entries have no `.area` field (verified against `data/demo.db`'s `raid_seed_1..6` — every row has `workstreamId`, none has `area`). This silently empties the RAID log for every caller. See Pitfall 1 for the correct approach.
- **A disabled-but-visible form control for anything gated by D-04/D-07:** the UI-SPEC (Surface Contract §5, §4) and this phase's own D-04 restate explicitly that server-side authz is the actual gate and any UI-level "disabled" affordance for a restricted control is exactly the class of bug that has hit a review or verification gate in five consecutive phases per STATE.md's accumulated history.
- **A client-side `state=target` fetch gated only by a UI toggle:** the UI-SPEC's Tension 3 names this explicitly — `GET /api/org/positions?state=target` must be refused server-side for an uncleared caller regardless of what the client's JS does or doesn't construct, because Phase 4 Wave 2 already found exactly this class of gap on a different route (`server.js:446` at the time, GET-role-checking limited to `/api/admin`-prefixed paths).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Clearance decisioning for the `hr` area | A new `orgAccess` field/grant dimension | `db/accessPolicy.js`'s existing `grantedAreas()`/`hasAreaGrant()`/`assertAreaGrant()`, keyed on the existing `hr` DD area | D-02 locks this explicitly; a second grant dimension was considered and rejected in CONTEXT.md with the cost stated |
| Write-role restriction for governance acts | A new role-check helper | `isAdminOrIlRequest(req)` (`server.js:495`) | Already exists, already tested (`test/synergy-stage.test.js` "grep-level guard" + WR-01 fix), already excludes the break-glass token path correctly |
| Collapsible tree rendering at 200+ nodes | A layout/graph library, or a CSS boxes-and-lines chart | Pure DOM recursion + a `Set` of expanded ids, per D-11/UI-SPEC §2 | PROJECT.md's vanilla-JS constraint forbids a library; the UI-SPEC's own indent-rail+elevation+level-chip design is proven to convey hierarchy without one |
| CSV/JSON bulk import parsing | A CSV-parsing npm package | Client-side parse into a preview table, reusing `#wiz-roster-raw`'s existing textarea pattern (`public/pmo.html:186`) and the existing write-validation zod pipeline for the actual POST | No new dependency; D-10 explicitly rejects a file-upload path in favor of the existing paste-and-validate flow |
| Audit-log row shape for the new D-03 read event | A parallel/simplified audit table | `db/auditHook.js#recordSecurityEvent()` against the existing `audit_log` table (nullable `before_json`/`after_json`) | The schema already supports a read-shaped row with no schema migration; a second table would fragment the compliance record AUD-02 depends on |
| Enum drift prevention for D-14's 5-value vocabulary | A shared imported constant across server/client (this codebase deliberately never shares JS modules between server and client — verified: SYN_STAGES is copied independently into `server.js`, `validators/workstream.js`, AND `public/js/execution.js`, with a source-level "read three files, assert equal" test as the drift guard, not an import) | An independent copy per layer PLUS a `test/*.test.js` assertion reading all copies via `require()`/regex and diffing them, exact pattern of `test/synergy-stage.test.js`'s "anti-drift" block (line ~69) | This is the established, working pattern in this repo — fighting it with a shared-module import would be inconsistent with every other enum here and isn't what the codebase's no-build-step constraint makes easy anyway |

**Key insight:** Nothing in this phase requires new infrastructure — every pattern it needs (clean-room filtering, append-only logs, server-computed rollups, enum triplication with an anti-drift test, read-side audit via a nullable-column table) already exists in this codebase in a directly reusable or directly mirror-able form. The risk is entirely in applying an existing primitive to a shape it wasn't built for (Pitfall 1) or assuming a precedent transfers when it doesn't quite (Pitfalls 2-6 below), not in needing something new.

## Common Pitfalls

### Pitfall 1: `filterByAreaGrant()` cannot be reused as-is on RAID entries — D-17's actual filter needs provenance resolution

**What goes wrong:** A plan that implements D-17 as "call `accessPolicy.filterByAreaGrant(raidLane(db), deal, req.portalUser)` inside `GET /api/raid`" will pass every code review that checks "is the filter called" but will empty the RAID log for every caller, including admin/hrbp, because `filterByAreaGrant` filters on `item.area` and RAID entries have no `area` field.

**Why it happens:** `db/accessPolicy.js`'s header comment explicitly invites reuse ("every export below is deliberately generic over 'a deal object and a user', not DD-specific in its mechanics") and `filterByAreaGrant`'s signature (`items, deal, user`) looks like it should work on any array. The generic-looking signature masks a field-name assumption that only DD's own collections (`ddRequestItems`, `ddFindings`) satisfy.

**Verified evidence:** `data/demo.db`'s `raid_seed_1` row, read directly: `{id, type, title, severity, probability, owner, workstreamId, status, notes, createdAt}` — no `area` key. `filterByAreaGrant`'s implementation (`db/accessPolicy.js:104-107`): `const granted = new Set(grantedAreas(deal, user)); return items.filter((item) => granted.has(item.area));` — `granted.has(undefined)` is `false` for every possible `granted` set, including the admin/hrbp full-area set, so this filters every RAID entry out for every caller.

**The correct shape, derived from what a RAID entry actually carries:** A RAID entry created via `POST /api/dd/findings/:id/convert` carries `source: 'dd-finding:' + finding.id` (verified, `server.js:4306`) but not the finding's `area` directly. The finding's `area` — the actual clearance key — lives only on the `ddFindings` row itself. `DD_AREA_WORKSTREAM` (`server.js:4282-4285`, `{legal: 'ws_legal', financial: 'ws_finance', tax: 'ws_finance', hr: 'ws_hr', it: 'ws_it', commercial: 'ws_sales', operations: 'ws_ops', complianceEsg: 'ws_legal'}`) is area→workstream and, verified by inspection, **not invertible without loss**: both `financial` and `tax` map to `ws_finance`; both `legal` and `complianceEsg` map to `ws_legal`. A RAID entry carrying `workstreamId: 'ws_finance'` could have originated from either a `financial`- or `tax`-cleared finding, and a caller cleared for one but not the other would be wrongly granted or wrongly refused by a workstreamId-keyed filter roughly half the time this ambiguity applies.

The filter D-17 needs must instead: (1) for an entry whose `source` matches `/^dd-finding:(.+)$/`, look up that finding's `.area` in `ddFindingsLane(db)` and gate on `hasAreaGrant(deal, user, finding.area)`; (2) for an entry whose `source` matches this phase's own new flight-risk conversion prefix (naming is planner's discretion, e.g. `org-flightrisk:<id>`), gate on the fixed `hr` area per D-02 (flight-risk clearance is always the `hr` grant, regardless of workstream); (3) for every other entry (manually created via `POST /api/raid` with no `source`, or `source: ''`), pass it through unfiltered — general RAID entries are not MNPI and D-17's scope is specifically "content republished from restricted DD/org sources," not the whole RAID lane.

**How to avoid:** The plan must add a small resolver function (e.g. in `db/accessPolicy.js` or inline in `server.js`'s RAID section) that maps a RAID entry to its clearance area via `source`-parsing, not via `workstreamId`. This is new code, correctly scoped by D-17's own "accepted cost: this widens the phase's blast radius into the RAID lane" — the widening is real and larger than a one-line filter call.

**Warning signs:** A test asserting "an uncleared user's `GET /api/raid` response excludes converted-from-restricted entries" passing while a SEPARATE test asserting "an admin's `GET /api/raid` response includes ALL entries, converted or not" fails (or is missing) is the signature of the naive-filter bug — it looks correct from the restricted side and silently breaks the open side.

### Pitfall 2: `.raid-lvl.critical` is a live, currently-latent gap this phase's own work will trigger

**What goes wrong:** D-15's flight-risk-to-RAID conversion will produce `severity: 'critical'` entries (D-16 reuses all four RAID levels including critical) that render with no color treatment — visually indistinguishable from an unstyled default — precisely for the entries the register exists to flag as most urgent.

**Why it happens:** `execution.html:114-115` (verified): `.raid-lvl{font-size:.64rem;font-weight:800;} .raid-lvl.high{color:#C0392B;} .raid-lvl.medium{color:#C77700;} .raid-lvl.low{color:#3f7a37;}` — three rules, four possible values (`RAID_LEVELS = ['low','medium','high','critical']`, `server.js:3845`, extended to four in Phase 4's D-11/D-26). The fourth value was added to the enum without a corresponding CSS rule.

**Verified reachability today:** `POST /api/dd/findings/:id/convert` already copies `finding.severity` verbatim (`server.js:4345`, comment confirms "copied VERBATIM — no mapping table, no clamping") and `DD_FINDING_SEVERITIES` already includes `'critical'` (`server.js:4190`) — so a critical DD finding converted via the Phase-4 feature TODAY produces an unstyled RAID badge, independent of anything Phase 6 does. Confirmed via direct query that `data/demo.db` currently has zero `critical`-severity RAID entries (all six seeded rows are `high`/`medium`/`low`), so the gap has not yet surfaced visibly in the demo — but it is not hypothetical.

**How to avoid:** Add `.raid-lvl.critical{color:#C0341D;font-weight:900;}` to `execution.html` (UI-SPEC's exact proposed rule, reusing `.page-banner--critical`'s existing color rather than inventing a fifth palette entry) as part of this phase's D-17 work, since D-17 already puts RAID-lane edits in scope.

**Warning signs:** A UAT walk that only exercises the NEW flight-risk-to-RAID path and never the PRE-EXISTING DD-finding-to-RAID path at `critical` severity would miss that this bug predates Phase 6 and needs a regression test covering both conversion paths.

### Pitfall 3: The stale `due-diligence.js:325` copy is a single, exact string with no siblings — but the fix must land in lockstep with D-17's server change

**What goes wrong:** Shipping D-17's server-side filter without updating the client copy leaves an operator-facing lie: the DD page will keep telling users a converted finding is "visible to the whole deal team... not only members cleared for this area" after that has become false.

**Verified evidence:** Exact string confirmed via grep across `public/` and `server.js`: exactly one occurrence, `public/js/due-diligence.js:325`, `text: 'Visible to the whole deal team once created — not only members cleared for this area.'`. The surrounding comment (`due-diligence.js:318-322`) cites `T-04-21` by name — the same accepted risk D-17 closes — confirming this string is the deliberate, documented UI acknowledgment of the exact gap this phase fixes.

**How to avoid:** UI-SPEC's Copywriting Contract already specifies the corrected wording ("Visible only to members cleared for this register" / D-15's equivalent). Land the string edit in the SAME task/commit as the server-side filter, not a follow-up — a green suite cannot catch a copy-only staleness bug, only a live read or a source-grep assertion can.

### Pitfall 4: D-03's read-audit has zero precedent and needs a NEW call site, but the storage layer requires no changes

**What goes wrong:** Assuming `recordSecurityEvent()` needs new columns or a schema migration before it can log a read event, when it already accepts everything a read event needs.

**Verified evidence:** Grepped every one of `server.js`'s ~49 `app.get(...)` handlers for a `recordSecurityEvent` call within the next 20 lines — zero matches. `db/audit-schema.sql` (verified, lines 39-55): `before_json`/`after_json` are plain nullable `TEXT` columns with no `NOT NULL` constraint and no CHECK constraint on `action`. `recordSecurityEvent({actor, action, dealId, subject, before, after, request})` (`db/auditHook.js:126-141`) already stringifies `before`/`after` to `null` when `undefined`/`null` is passed — a call like `recordSecurityEvent({actor: req.portalUser, action: 'org-flightrisk-read', dealId: ..., subject: null, before: null, after: null, request: requestMeta(req)})` is a fully valid row today, no migration needed.

**One real gap to flag for the planner:** `recordSecurityEvent()` hardcodes `db_kind: 'control'` for every call (`db/auditHook.js:136`, the literal string `'control'` in the `INSERT_SQL` params) — even though the schema comment documents `db_kind` as `'control' | 'runtime' | 'demo' | 'deal'`. A flight-risk read is conceptually a `'deal'`-scoped event, but will be recorded as `'control'`. This does not break anything functionally (`queryAudit()` never filters on `db_kind`, verified `db/auditHook.js:157-172`), but a future admin-audit-viewer feature that DOES filter or facet by `db_kind` will misclassify every D-03 read event. Flag this as an accepted, minor labeling inaccuracy rather than silently reusing `recordSecurityEvent()` without noting it — the planner should not spend a task "fixing" this (it would require adding a `dbKind` parameter and threading it through every existing call site, out of this phase's scope), but should record it as a known, deliberate gap.

**Cost:** One synchronous `better-sqlite3` INSERT (single prepared statement, no transaction wrapper needed for a single row) per successful read. D-03 explicitly rejected session-scoped dedupe, so a UI that polls the flight-risk register (e.g. on every deal-home refresh, if the register's data feeds a nudge) will accumulate one row per poll. This is an accepted design cost per D-03's own text ("a weaker record" was the stated reason to reject dedupe), not a defect — but the planner should ensure the flight-risk register's OWN page load is what triggers this (once per page visit), not a background poll on an unrelated page like deal-home (which reads the SUMMARY rollup, not the register itself, and should not trigger a register-read audit event at all — the summary counts are pre-aggregated server-side and are a materially different disclosure than reading the register's contents).

**Test precedent to follow:** `test/dd-access-policy.test.js` (verified, read in full) is the exact template — it boots the real app against an isolated temp DB trio, calls `auditHook.queryAudit({dealId, limit: 500})` and filters by `action`, and asserts row counts before/after a probe. The same harness pattern should produce `test/org-flight-risk-audit.test.js` proving: a denial writes exactly one `org-flightrisk-denied` row; a successful cleared read writes exactly one `org-flightrisk-read` row; and (per D-03's "scoped to that register only") reading the OPEN-tier org data (current-state positions) writes ZERO audit rows of any kind.

### Pitfall 5: `employees` starts empty in a real deal, and neither its read nor its write route is role- or clearance-gated today

**What goes wrong:** Assuming D-09's employee-link works out of the box because `employees` "already exists" — it exists as a collection, but a real deal's `employees` table is empty by construction (not on `DEAL_SEED_COLLECTIONS`), and neither the read route nor the create/delete routes carry any access restriction today, which matters for how D-09's orphan-guard and D-10's bulk importer should be scoped.

**Verified evidence:** `db/dealSeed.js:31` — `DEAL_SEED_COLLECTIONS = ['checklistTemplates', 'assessmentTemplates', 'processCatalog', 'ddRequestTemplates']` — `employees` is absent, confirmed by direct read of the array. `GET /api/employees` (`server.js:4567-4580`, verified): no role check of any kind — any authenticated deal member reads the full roster; scaling logic (`(isCustom || !req.isDemo) ? employeesList : scaleEmployeesForDay(...)`, line 4578) correctly returns UNSCALED data for a real deal (`req.isDemo` is `false`), confirmed this session by tracing the boolean logic — ISO-02's gamification hard-gate holds for this route. `POST /api/employees` and `DELETE /api/employees/:id` fall through to `ROLE_WRITE_POLICY`'s `DEFAULT_WRITE_ROLES = ['admin', 'hrbp', 'pmo']` (verified, `server.js:278-322` — no `/api/employees`-specific entry exists in the policy table, confirmed by grep) — so `pmo`, not just IL/admin, can create or delete employees, which matters because D-09's orphan-guard must live in the route ANY of those three roles can call, not assume only IL touches it.

`DELETE /api/employees/:id` (verified, `server.js:4638-4648`) is a blind, unconditional `filter()`-and-write with **no existing guard of any kind** — not for org positions (new this phase) and not for any other cross-reference either (e.g. no check against `assessments`/`pulses` that might reference the employee). This confirms the D-09 orphan-guard is genuinely new code with zero precedent to extend in this specific handler, though the codebase has a general 400-refusal idiom elsewhere (e.g. DD-04's day-0 refusals) the planner can model the response shape on.

**How to avoid:** Scope D-10's bulk paste importer to write into `db.employees` (the real-deal path) via the same `POST /api/employees` route pattern (or a dedicated bulk-insert route sharing its validation), not a new employee-storage mechanism. Add the orphan-guard as a lookup against `orgPositions` filtered to `employeeId === id` inside the existing `DELETE /api/employees/:id` handler, refusing with 400 (per UI-SPEC's resolution) before the `filter()` line.

### Pitfall 6: `deal-home.js`'s fan-out is already 4 fetches, not 3 — a "3→4" mental model undercounts

**What goes wrong:** Planning D-19's deal-home panel as "the third of three existing deal-home panels, add a fourth" when the file's own `Promise.all` (verified, `public/js/deal-home.js:267-284`) already fetches FOUR sources (`/api/deals`, `/api/assessment-status`, `/api/dd/summary`, `/api/synergies/rollup`) to render three visible panels PLUS the Phase-5 stale-synergy nudge, which itself consumes the fourth fetch (`/api/synergies/rollup`).

**Verified evidence:** Direct read of `deal-home.js:260-285` — the array literal has four `fetch(...)` calls; `results[3]` (the rollup) feeds `renderStaleSynergyNudge(wrap, rollup)`, a fourth render call alongside the three panel-renders. The file's own header comment says "Renders three panels" — accurate for panels, but the fetch count is four, and Phase 6 adds a fifth fetch (`/api/org/summary`) feeding both the new org panel AND the new flight-risk nudge (mirroring how the rollup fetch already double-duties for panel+nudge in the synergy case).

**How to avoid:** No functional risk here — `Promise.all` handles any array length identically — but the planner's task breakdown and file-diff size estimate for `deal-home.js` should account for the real current shape (4 fetches → 5, one new render function for the panel, one new render function for the nudge reusing `findSectionHeading()`) rather than assuming a smaller existing surface.

### Pitfall 7: The WAL-checkpoint trap applies to D-18's demo seed exactly as it has in every prior phase

**What goes wrong:** A write to `data/demo.db` (a committed, WAL-mode SQLite file) lands only in the gitignored `-wal` sidecar, leaving the tracked `.db` file byte-unchanged and `git status` clean — this has fired in every phase that touched a committed `.db` per STATE.md's accumulated history (Phase 3, 4, and 5 all hit it).

**Verified evidence:** This is a carried-forward, previously-verified finding (03-RESEARCH.md's original WAL/ATTACH investigation, restated and re-confirmed operationally three times since). Not re-verified from first principles this session (no new write was made to demo.db), but the CONTEXT.md's restatement is consistent with `db/auditHook.js`'s own header comment (lines 8-20) describing the same WAL/ATTACH atomicity finding, confirming the underlying mechanism is still accurately understood in this codebase's current state.

**How to avoid:** Before committing the D-18 seed, run `PRAGMA wal_checkpoint(TRUNCATE)` against `data/demo.db` and diff the tracked file against `HEAD` — not just `git status` — before trusting a "clean" working tree.

## Code Examples

### Validator module structure (exact pattern to follow for `validators/org.js`)

```javascript
// Source: validators/dd.js:1-21, 73-113 (verified, read in full this session)
'use strict';
const { z } = require('zod');
const { registerSchema, EmptyBodySchema } = require('./index');
const { DD_AREA_IDS } = require('../db/accessPolicy'); // if org needs the same area-id enum anywhere

const TEXT_MAX = 2000; // every string field needs an explicit .max() — a repo-wide
                        // grep (`grep -rn "z\.string()" validators/ | grep -vc "max("`)
                        // fails the suite otherwise, scoped repo-wide not per-file

// Upsert-by-id shape: id present => update (all other fields optional),
// id absent => create (title/required fields enforced via .refine())
const OrgPositionUpsertSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
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

### D-04 tier-2 write-authz gate (exact reusable call, verified `server.js:495` + `:3790`)

```javascript
app.post('/api/org/decisions', (req, res) => {
  if (!isAdminOrIlRequest(req)) {
    return res.status(403).json({ error: 'Only the Integration Lead or admin may record a decision.' });
  }
  const deal = controlStore.getDeal(req.dealContext.dealId);
  // D-02: decisions are restricted content — gate on the hr area too, not just the role
  if (!accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    return res.status(403).json({ error: 'You are not cleared for organisation decisions.' });
  }
  // ... only then touch orgDecisions
});
```

### D-03 read-audit call (exact shape, verified `db/auditHook.js:126-141` + `server.js:3983-3990`'s denial-path sibling)

```javascript
// Mirrors refuseDdArea()'s shape (server.js:3983-3990) for the denial half;
// this is the NEW successful-read half D-03 requires, with no precedent to
// copy verbatim (zero existing GET route calls recordSecurityEvent).
app.get('/api/org/flight-risk', (req, res) => {
  const deal = controlStore.getDeal(req.dealContext.dealId);
  if (!accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    auditHook.recordSecurityEvent({
      actor: req.portalUser, action: 'org-flightrisk-denied', dealId: req.dealContext.dealId,
      subject: null, before: null, after: null, request: requestMeta(req),
    });
    return res.status(403).json({ error: 'You are not cleared for the flight-risk register.' });
  }
  auditHook.recordSecurityEvent({
    actor: req.portalUser, action: 'org-flightrisk-read', dealId: req.dealContext.dealId,
    subject: null, before: null, after: null, request: requestMeta(req),
  });
  res.json(flightRiskLane(readDb()));
});
```

### D-17 RAID outbound filter — the correct provenance-based shape (new code, not a `filterByAreaGrant` reuse)

```javascript
// NEW helper — RAID entries carry `source`, not `area`; the finding's area
// (or, for a flight-risk conversion, the fixed 'hr' key) must be resolved
// through provenance before a clearance check is possible. Verified against
// server.js:4306 (source = 'dd-finding:' + finding.id, the ONLY existing
// producer of a linked RAID entry's `source` field today) and DD_AREA_WORKSTREAM's
// confirmed lossy inverse (server.js:4282-4285).
function resolveRaidEntryClearanceArea(entry, db) {
  if (!entry.source) return null; // unlinked entry — no clearance gate applies
  const ddMatch = /^dd-finding:(.+)$/.exec(entry.source);
  if (ddMatch) {
    const finding = ddFindingsLane(db).find((f) => f.id === ddMatch[1]);
    return finding ? finding.area : null;
  }
  const flightRiskMatch = /^org-flightrisk:(.+)$/.exec(entry.source); // naming: planner's discretion
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

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| A single `.raid-lvl.{high,medium,low}` 3-rule CSS set | Should be a 4-rule set including `.critical` | Should have changed when `RAID_LEVELS` was widened to 4 in Phase 4 (D-11/D-26) | Currently a live, un-shipped gap this phase's D-17 work should close as a side effect (Pitfall 2) |
| `T-04-21` accepted as deferred risk | D-17 closes it in-phase | This phase (2026-08) | Retro-fixes the Phase-4 instance of the leak, not just prevents a new one |
| `filterByAreaGrant()` used only by DD's own `area`-keyed collections | About to be asked (by D-17's own phrasing) to generalize to RAID's `workstreamId`-keyed collection | This phase | Cannot generalize as-is (Pitfall 1) — needs a provenance-resolution layer instead |

**Deprecated/outdated:** None — this phase does not deprecate or retire anything; it is purely additive except for the two small existing-code fixes (`.raid-lvl.critical`, the stale `due-diligence.js` copy string) both already scoped into D-17's blast radius by the locked decisions.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` (verified: `package.json`'s `"test": "node --test"`; no jest/mocha/vitest/playwright anywhere in `package.json` or `node_modules/.bin`) |
| Config file | none — `node --test` auto-discovers `test/*.test.js` with zero config |
| Quick run command | `node --test test/org-<name>.test.js` (single file, verified pattern used by every existing `*.test.js` — each boots the real app against an isolated temp `control/runtime/demo/deals/audit` DB quintet via `process.env.MA_*_DB_PATH` overrides, per `test/dd-access-policy.test.js:26-31`) |
| Full suite command | `node --test` (verified this session: **374 tests, 374 pass, 0 fail, 2317ms wall time** — run live from repo root) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ORG-01 | A position with `title/level/reportsToId/employeeId/state` can be created, read (current-state, open to any member) and updated | integration | `node --test test/org-positions.test.js` | ❌ Wave 0 |
| ORG-01 | An uncleared member's `GET /api/org/positions?state=target` is refused server-side even with a hand-crafted query string (D-07, the read-boundary Phase-4-Wave-2 precedent explicitly warns about) | integration/security | `node --test test/org-access-policy.test.js` | ❌ Wave 0 |
| ORG-01 | Deleting an employee linked to a position is refused (400) unless unlinked first (D-09 orphan-guard, UI-SPEC-resolved) | integration | `node --test test/org-positions.test.js` | ❌ Wave 0 |
| ORG-02 | A decision write is refused for a non-IL/admin cleared member, even one with `hr` area grant (D-04 tier-2, mirrors the `isAdminOrIlRequest` four-identity precedent in `test/synergy-stage.test.js`) | security | `node --test test/org-decisions.test.js` | ❌ Wave 0 |
| ORG-02 | The 5-value decision vocabulary's server/validator (and client, if a JS array is used per Pitfall's Don't-Hand-Roll row) copies stay in sync — anti-drift assertion mirroring `test/dd-findings.test.js`'s RAID_LEVELS check (line ~310) and `test/synergy-stage.test.js`'s SYN_STAGES 3-copy check | unit | `node --test test/org-decisions.test.js` | ❌ Wave 0 |
| ORG-02 | A position's "current decision" is correctly derived as the latest `orgDecisions` entry, never read from a stored field | unit | `node --test test/org-decisions.test.js` | ❌ Wave 0 |
| ORG-03 | An uncleared member's `GET /api/org/flight-risk` is refused AND writes exactly one denial audit row | security | `node --test test/org-flight-risk-audit.test.js` | ❌ Wave 0 |
| ORG-03 | A cleared member's successful `GET /api/org/flight-risk` writes exactly one `org-flightrisk-read` audit row (D-03's new behavior, no existing precedent — see Pitfall 4) | security | `node --test test/org-flight-risk-audit.test.js` | ❌ Wave 0 |
| ORG-03 | Reading OPEN-tier org data (current positions) writes ZERO audit rows of any kind (D-03's "scoped to that register only," distinguishing it from a lane-wide audit) | security | `node --test test/org-flight-risk-audit.test.js` | ❌ Wave 0 |
| ORG-03 | Flight-risk-to-RAID conversion produces a bidirectionally linked entry, deduped by source, same shape as `test/dd-findings.test.js`'s existing conversion tests | integration | `node --test test/org-flight-risk-conversion.test.js` | ❌ Wave 0 |
| D-17 | An uncleared user's `GET /api/raid` excludes entries whose provenance traces to a restricted area; a CLEARED (or unlinked) entry is still returned — proving the filter doesn't over-filter (Pitfall 1's "naive filter empties the whole lane" failure mode) | security | `node --test test/raid-access-filter.test.js` | ❌ Wave 0 |
| D-17 | An admin session's `GET /api/raid` still returns manually-created (unlinked, `source: ''`) entries — the specific regression Pitfall 1 flags | regression | `node --test test/raid-access-filter.test.js` | ❌ Wave 0 |
| — | `.raid-lvl.critical` CSS rule exists and a critical-severity RAID entry (via either conversion path — DD-finding OR flight-risk) renders with a distinct visual treatment | visual (executor pass, see UI-SPEC's Internationalisation contract) | manual/browser | ❌ Wave 0 |
| D-18 | `data/demo.db`'s committed bytes actually change after the seed script runs (the WAL-checkpoint trap, Pitfall 7) | regression | `git diff --stat data/demo.db` (non-empty after `PRAGMA wal_checkpoint(TRUNCATE)`) | ❌ Wave 0 (script-level check, not a `node:test` file) |

### Sampling Rate

- **Per task commit:** run the single new/touched test file, e.g. `node --test test/org-positions.test.js`
- **Per wave merge:** `node --test` (full suite, verified ~2.3s wall time today — cheap enough to run on every merge)
- **Phase gate:** Full suite green before `/gsd-verify-work` — the existing precedent (STATE.md) is that every prior phase's gate additionally required a LIVE browser walk beyond the green suite (Phase 4's invisible-error-display bug, Phase 5's orphaned-`</div>` bug), both invisible to `node:test`'s source-level assertions. The UI-SPEC's own two `🧪 backstop` rows (flight-risk-register overflow, search-box staleness) and the D-17/Pitfall-1 filter behavior specifically warrant a live walk, not just the automated suite.

### Wave 0 Gaps

- [ ] `test/org-positions.test.js` — covers ORG-01 (CRUD, current/target state filtering, orphan-guard)
- [ ] `test/org-access-policy.test.js` — covers ORG-01/D-07 (the read-boundary security test, modeled on `test/dd-access-policy.test.js`)
- [ ] `test/org-decisions.test.js` — covers ORG-02 (D-04 tier-2 authz, D-14 enum anti-drift, D-13 derived-current logic)
- [ ] `test/org-flight-risk-audit.test.js` — covers ORG-03/D-03 (the genuinely new read-audit behavior — highest-value new test in this phase, since it has zero precedent to copy from)
- [ ] `test/org-flight-risk-conversion.test.js` — covers ORG-03/D-15 (bidirectional link, dedupe-by-source)
- [ ] `test/raid-access-filter.test.js` — covers D-17 (both the under-filtering AND over-filtering failure modes named in Pitfall 1)
- [ ] No framework install needed — `node --test` is already the established runner with zero config

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (new) | Inherited from Phase 2 — every `/api/org/*` route sits behind the existing consolidated auth gate; no new auth surface in this phase |
| V3 Session Management | no (new) | Inherited from Phase 2/3 — `req.portalUser`/`req.dealContext` resolution is unchanged by this phase |
| V4 Access Control | **yes** | `db/accessPolicy.js`'s `grantedAreas()`/`hasAreaGrant()`/`assertAreaGrant()` (reused, D-02) for read/list gating; `isAdminOrIlRequest(req)` (reused, D-04) for the governance-write tier; NEW provenance-resolution logic for D-17 (Pitfall 1) — this is the phase's largest access-control surface and its least precedented piece |
| V5 Input Validation | **yes** | `zod` via `validators/org.js`, registered through `validators/index.js#registerSchema()` — same pipeline as every existing write route; `test/write-validation-coverage.test.js` fails closed on any unregistered write route |
| V6 Cryptography | no | Not applicable — this phase adds no new secrets, tokens, or cryptographic operations |
| V7 Error Handling / Logging | **yes** | D-03's new read-audit path is itself a logging control — the compliance requirement (ORG-03: "audited as sensitive data") IS the ASVS V7 control being satisfied, via `db/auditHook.js#recordSecurityEvent()` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Clean-room bypass via a hand-crafted query string (`?state=target` from a session that never loaded the client JS) | Elevation of Privilege | Server-side `assertAreaGrant`/`hasAreaGrant` check as the route's first data-touching statement — verified this is NOT automatic; Phase 4 Wave 2 found exactly this gap on a different route (`server.js:446` GET-role-check limited to `/api/admin`-prefixed paths at the time) |
| Naive filter reuse that silently under- or over-restricts (Pitfall 1) | Information Disclosure (under-restrict) / Denial of legitimate access (over-restrict, functionally a self-inflicted DoS on a compliance feature) | Provenance-based resolution (source-parsing to the originating restricted record), NOT a field-name-compatible-looking reuse of an existing filter |
| Governance-write authz bypass (an area-cleared-but-non-IL member recording a redundancy decision) | Elevation of Privilege | `isAdminOrIlRequest(req)` as the literal first statement, per D-04's explicit restatement — flagged by CONTEXT.md as the class of bug that has hit a review/verification gate in **five consecutive phases** (STATE.md's accumulated history: CR-01 in Phase 4, the create-path stage-gate bypass in Phase 5) |
| Audit-trail gap on a sensitive read (no record of who looked at the retention list) | Repudiation | D-03's new `recordSecurityEvent()` call on both the denial AND the successful-read path — the successful-read half is the genuinely novel control this phase adds (Pitfall 4) |
| Masked-but-present restricted UI (a disabled control, a zeroed number) leaking existence of hidden data | Information Disclosure | D-20's "absent entirely" rule, already proven live in Phase 4 UAT via raw `innerHTML` grep (T-04-46) — the UI-SPEC's tag-level `<section>`/`<div>` distinction (Tension 3) makes this DOM-grep-assertable for this phase too |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The flight-risk-to-RAID conversion's `source` field will use a NEW prefix convention (e.g. `org-flightrisk:<id>`) distinct from `dd-finding:<id>` | Pitfall 1, Code Examples | If the planner instead reuses `dd-finding:<id>`-shaped sources for flight-risk conversions, the `resolveRaidEntryClearanceArea()` regex in the Code Examples section needs a different discriminator (e.g. checking which lane the id resolves against) — low risk, easily adjusted at plan time, but the exact prefix string is not locked by any CONTEXT.md decision and is genuinely the planner's naming call |
| A2 | `db_kind: 'control'` being hardcoded by `recordSecurityEvent()` for D-03's read-audit events is an acceptable, undocumented-but-harmless labeling inaccuracy rather than something this phase must fix | Pitfall 4 | If a future admin-audit-viewer feature facets by `db_kind`, D-03's read events will be miscategorized as control-plane rather than deal-scoped events; low risk this phase (no current `db_kind`-filtering consumer exists, verified), but worth a one-line note in the plan so it isn't rediscovered as a surprise later |
| A3 | An `employee` role, if ever added to a real deal's `members` list, is intended to read current-state org data on `org.html` (since D-12 deliberately omits a `pageAccess` entry, mirroring `due-diligence.html`'s IN-02 precedent) | Architecture Patterns / Standard Stack | CONTEXT.md does not explicitly discuss `employee`-role access to org.html; this is inferred by direct structural analogy to the DD workspace's own IN-02 precedent, which the CONTEXT.md decisions explicitly invoke for D-12. Low risk — the server-side clearance check (not the page-level gate) is the actual control either way, so even if this inference is wrong, no MNPI leak results, only a possibly-unreachable page for a role that was never expected to use it |

**None of these assumptions concern a core architectural decision** — A1 and A2 are naming/labeling details within the planner's stated discretion, and A3 is a structural inference with no security consequence if wrong (the server-side gate holds regardless).

## Open Questions

1. **Does D-14's decision vocabulary need a client-side JS array copy, or can `org.js`'s `<select>` be static HTML `<option>` tags?**
   - What we know: RAID_LEVELS (D-16's reused enum) has exactly 2 code copies (`server.js`, `validators/workstream.js`) with NO client-side JS array — the client renders severity via `r.severity` used directly as a CSS class/i18n-key suffix (verified, `execution.js:1008-1009`), never through an enumerated list. SYN_STAGES, by contrast, has 3 copies including a client-side `var SYN_STAGES = [...]` (verified, `execution.js:54`) because the client needs to iterate the stage list for its own UI logic (a stage-progression control).
   - What's unclear: Whether `org.js`'s decision-type `<select>` needs the vocabulary as an enumerable JS array (enabling an anti-drift test reading the client copy, matching the SYN_STAGES precedent) or can be five static `<option>` tags with no JS-side list (matching the RAID_LEVELS precedent, where no anti-drift test covers the client at all since there's no client array to drift).
   - Recommendation: Declare a small `ORG_DECISIONS` (or similarly named) JS array in `org.js` even if only used to construct the `<option>` tags — this costs nothing, keeps the codebase's established 3-copy-with-anti-drift-test pattern intact for a NEW enum (as opposed to REUSING an existing one, D-14's situation is closer to SYN_STAGES's "brand new enum" case than D-16's "reuse an existing one" case), and gives the planner a concrete thing to write a `test/org-decisions.test.js` anti-drift assertion against.

2. **Should `GET /api/org/summary`'s restricted-tier flight-risk count be scoped to "high/critical only" at the query layer or the response-shaping layer?**
   - What we know: D-19 names "unmitigated high/critical flight risks" as the specific number the restricted tier reports (not a full breakdown by all four RAID levels).
   - What's unclear: Whether the route should filter the flight-risk collection down to `severity in ('high','critical') AND mitigation is empty` before counting, or fetch the full clearance-scoped set and then filter in the tally step (mirroring `GET /api/dd/summary`'s pattern of filtering the SOURCE array once, then tallying multiple facets from the filtered set).
   - Recommendation: Mirror `GET /api/dd/summary`'s exact structure (filter once via the clearance check, then compute multiple named tallies including but not limited to the high/critical-unmitigated count) — this keeps the org summary route consistent with its own stated mirror and leaves room for the deal-home panel to show additional decision-type counts (D-19 also names those) from the same single filtered pass, rather than two separate queries.

## Environment Availability

No new external dependencies — this section is included for completeness per the researcher protocol but there is nothing to audit. `better-sqlite3` (13.0.1), `zod` (4.4.3), and Node.js (v22.18.0, `node --test`) are already installed and verified working this session (the full 374-test suite ran successfully against the current tree). No new CLI tool, service, runtime, or package manager is introduced by this phase.

## Sources

### Primary (HIGH confidence — read directly this session, file:line cited inline throughout)
- `db/accessPolicy.js` (full file read) — `grantedAreas()`, `hasAreaGrant()`, `filterByAreaGrant()`, `assertAreaGrant()`, `AreaAccessError`, and the module's own header comment naming this phase as its anticipated second consumer
- `db/auditHook.js` (full file read) — `recordSecurityEvent()`, `writeAuditBatch()`, `queryAudit()`, `AUDITED_DB_KINDS`
- `db/audit-schema.sql` (full file read) — `audit_log` table shape, nullable `before_json`/`after_json`, append-only triggers
- `db/collections.js` (full file read) — `ARRAY_COLLECTIONS` (35, hard assertion), `COLLECTION_TARGETS` (confirmed dead-except-for-the-one-time-split-script via grep across the repo), `DEAL_SEED_COLLECTIONS` cross-reference
- `db/dealSeed.js` (full file read) — `DEAL_SEED_COLLECTIONS` allowlist, `createDealDatabase()`
- `db/schema.sql` (header + grep of all `CREATE TABLE` names) — confirmed shared schema between `demo.db` and every `deals/<id>.db`
- `server.js` — RAID section (lines 3826-3898), DD findings/conversion section (4178-4361), DD summary route (4375-4417), employees routes (4560-4648), `scaleEmployeesForDay`/`getPulsesForDay` (1200-1260), `ROLE_WRITE_POLICY`/`roleAllowedForWrite` (278-333), `isAdminRequest`/`isAdminOrIlRequest` (468-497), `refuseDdArea`/`ddAreaRefused` (3973-4009)
- `validators/dd.js` (full file read) — the exact template for `validators/org.js`
- `validators/index.js` (grep) — `registerSchema()`, `WRITE_SCHEMAS`, `resolveSchema()`
- `public/js/deal-home.js` (full file read) — `renderDealHome()`, `Promise.all` fan-out (verified 4 fetches), `renderStaleSynergyNudge()`, `findSectionHeading()`
- `public/js/due-diligence.js` (targeted read, line 300-340) — the exact `.dd-finding-convert-note` string and its `T-04-21` comment
- `public/js/transitions.js` (targeted read, lines 140-184) — `pageAccess` map and the IN-02 comment
- `public/js/execution.js` (grep) — `.raid-lvl` client rendering (confirmed no client-side JS enum array for RAID severity), `SYN_STAGES` client copy
- `public/execution.html` (grep, line 114-115) — the confirmed-missing `.raid-lvl.critical` rule
- `test/dd-access-policy.test.js` (targeted read) — the exact test-harness template for the new D-03 read-audit tests
- `test/dd-findings.test.js` (targeted read, line 300-330) — the exact RAID_LEVELS anti-drift test pattern
- `test/synergy-stage.test.js` (grep) — the SYN_STAGES 3-copy anti-drift test and the `isAdminOrIlRequest` grep-level guard test
- `data/demo.db` (queried live via `better-sqlite3` in a throwaway Node script) — `raidEntries` (all 6 rows' exact JSON shape, confirming no `.area` field), `employees` (5 rows, confirming D-18's count claim), `ddFindings` (confirmed empty — no seeded findings yet)
- `.planning/config.json` (full file read) — confirmed `nyquist_validation: true`, `security_enforcement: true`, `security_asvs_level: 1`
- Live execution of `node --test` (full suite) — 374/374 passing, 2317ms
- Live execution of `node -e "require('zod/package.json').version"` / `require('better-sqlite3/package.json').version` / `node --version`

### Secondary (MEDIUM confidence)
- STATE.md's "Accumulated Context" decisions log — used to corroborate the WAL-checkpoint trap and the "authz bug in five consecutive phases" pattern, both restated (not re-derived) from prior phases' own verified findings

### Tertiary (LOW confidence)
- None — every claim in this document was either read directly from a file this session or executed directly this session. No WebSearch or external documentation lookup was performed or needed (zero new dependencies, all patterns internal to this codebase).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; every version number was confirmed via direct `node -e` execution, not training-data recall
- Architecture: HIGH — every reused primitive (`isAdminOrIlRequest`, `filterByAreaGrant`, `recordSecurityEvent`, `GET /api/dd/summary`'s shape) was read in full or targeted-read this session, with the RAID-entry shape mismatch (Pitfall 1) independently verified against live demo data, not assumed from the decision text
- Pitfalls: HIGH — all 7 pitfalls are grounded in a specific file:line read or a live command execution this session; Pitfall 1 (the highest-severity finding) was cross-checked twice: once via reading `filterByAreaGrant()`'s implementation, once via directly querying `data/demo.db`'s actual RAID row shape

**Research date:** 2026-08-06
**Valid until:** 30 days (stable, brownfield codebase with no external dependency churn — the only decay risk is if `db/accessPolicy.js` or `server.js`'s RAID section changes before this phase is planned/executed, which would need a re-verification of the file:line citations above, not a full re-research)

