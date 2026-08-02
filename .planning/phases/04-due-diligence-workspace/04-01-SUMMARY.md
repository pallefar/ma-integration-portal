---
phase: 04-due-diligence-workspace
plan: 01
subsystem: api
tags: [express, better-sqlite3, zod, access-control, audit-log, mnpi]

# Dependency graph
requires:
  - phase: 03-deal-isolation-audit-log-write-validation
    provides: db/resolver.js's deal-bound connection binding, db/controlStore.js's getDeal(), db/auditHook.js's recordSecurityEvent()/writeAuditBatch(), validators/index.js's WRITE_SCHEMAS pipeline, the uniform-403 anti-enumeration precedent
provides:
  - "db/accessPolicy.js — the reusable clean-room need-to-know filter (DD_AREAS/DD_AREA_IDS, grantedAreas(), hasAreaGrant(), filterByAreaGrant(), assertAreaGrant(), AreaAccessError)"
  - "Three dd* SQLite collections (ddRequestItems, ddFindings, ddRequestTemplates) registered end-to-end (db/collections.js, db/schema.sql)"
  - "DD request-item CRUD surface: GET /api/dd/areas, GET/POST /api/dd/request-items, GET/DELETE /api/dd/request-items/:id"
  - "Audited dd-access-denied security event on every by-id/write refusal"
  - "public/due-diligence.html + public/js/due-diligence.js — the DD workspace page"
affects: [04-02-PLAN, 04-03-PLAN, 04-04-PLAN, 04-05-PLAN, 04-06-PLAN, 04-07-PLAN, 04-08-PLAN, phase-06-org-design-talent-retention]

# Actuals (#2632)
actuals:
  tokens: 15875
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Clean-room need-to-know filter module (db/accessPolicy.js) — row/area-level access control layered on top of Phase 3's deal-level resolver, deliberately holding no DB connection and no audit dependency of its own"
    - "Uniform-403 anti-enumeration extended from deal-level (db/resolver.js) to row-level: a missing item and an uncleared item share ONE refusal path because a null areaId is never granted to any role, including admin"
    - "refuseDdArea() choke point: every by-id/write area refusal flows through one function that records the dd-access-denied security event THEN sends the response, so the audit call can never be forgotten at a new call site"

key-files:
  created:
    - db/accessPolicy.js
    - validators/dd.js
    - public/due-diligence.html
    - public/js/due-diligence.js
    - test/dd-workspace.test.js
    - test/dd-access-policy.test.js
  modified:
    - db/collections.js
    - db/schema.sql
    - server.js
    - test/migration-roundtrip.test.js

key-decisions:
  - "grantedAreas() checks `deal` truthiness BEFORE the admin/hrbp role shortcut (not after) — a defensive hardening requested by the reviewing coordinator during the tracer checkpoint; closes a latent fail-open where a hypothetical future no-deal call site could have silently granted the highest-privilege roles full access. Zero behavior change for any real caller, since every existing call site always passes a resolved deal object."
  - "An unknown item id and an item in an uncleared area share ONE code path to refusal (assertAreaGrant(deal, user, null) throws AreaAccessError exactly like an uncleared area does) — the uniform-403 anti-enumeration property is structural, not a second branch someone could forget to add."
  - "List routes (GET /api/dd/areas, GET /api/dd/request-items) never call refuseDdArea() or record a denial event — D-03's invisibility rule: a member browsing their own workspace, with uncleared areas silently omitted, is not an access attempt worth auditing. Only a direct by-id probe or a write into an uncleared area produces a dd-access-denied row."
  - "DdRequestItemUpsertSchema's `text`/`area` are unconditionally-present-on-create, optional-on-update, enforced by two zod .refine()s (mirrors validators/workstream.js's TaskUpsertSchema) rather than two separate schemas — one registered route, one rejection path for both create and update."

patterns-established:
  - "Clean-room need-to-know filter (db/accessPolicy.js): grantedAreas()/hasAreaGrant()/filterByAreaGrant()/assertAreaGrant() are the exact interface Phase 6's flight-risk register is expected to reuse rather than inventing a second access-policy pattern."
  - "refuseDdArea() choke-point audit pattern: an audit-then-respond wrapper is the single place a security-relevant refusal can be turned into an HTTP response, so a future new call site cannot add an unaudited refusal without also going through the wrapper."

requirements-completed: [DD-01, DD-04]

coverage:
  - id: D1
    description: "An IL creates a DD request item in a fixed functional area with owner/status/due date and reads it back from the deal's own database"
    requirement: "DD-01"
    verification:
      - kind: integration
        ref: "test/dd-workspace.test.js#dd-workspace (a): an IL creates a legal item and reads it back; a member granted only legal also sees it"
        status: pass
      - kind: integration
        ref: "test/dd-workspace.test.js#dd-workspace (c): duplicate text produces distinct ids; an empty deal returns [] with status 200"
        status: pass
      - kind: integration
        ref: "test/dd-workspace.test.js#dd-workspace (e): two concurrent creates against the same deal both persist"
        status: pass
    human_judgment: false
  - id: D2
    description: "An uncleared deal member sees nothing in DD list responses (server-side omission) and gets a byte-identical uniform 403 for a by-id probe of an uncleared item vs. an unknown item id"
    requirement: "DD-04"
    verification:
      - kind: integration
        ref: "test/dd-workspace.test.js#dd-workspace (b): a member with no area grant at all receives an empty array even though a legal item exists in the same deal"
        status: pass
      - kind: integration
        ref: "test/dd-workspace.test.js#dd-workspace (g): a member cleared for financial gets a byte-identical uniform 403 for an unknown item id and for a legal item they are not cleared for"
        status: pass
      - kind: integration
        ref: "test/dd-workspace.test.js#dd-workspace (h): a member cleared for legal is refused moving their own item into tax without clearance for tax; the item stays in legal"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every refused DD access (by-id probe, uncleared-area write) is recorded as an attributed dd-access-denied security event; ordinary browsing and successful writes are not"
    requirement: "DD-04"
    verification:
      - kind: integration
        ref: "test/dd-access-policy.test.js#dd-access-policy (a): a by-id probe of an uncleared item writes exactly one dd-access-denied row naming the actor, the deal and the area"
        status: pass
      - kind: integration
        ref: "test/dd-access-policy.test.js#dd-access-policy (b): an unknown-id probe writes a dd-access-denied row with a null subject"
        status: pass
      - kind: integration
        ref: "test/dd-access-policy.test.js#dd-access-policy (c): a create attempt into an uncleared area is refused, writes a dd-access-denied row, and creates no item row"
        status: pass
      - kind: integration
        ref: "test/dd-access-policy.test.js#dd-access-policy (d): a cleared member listing their own areas adds zero dd-access-denied rows"
        status: pass
      - kind: integration
        ref: "test/dd-access-policy.test.js#dd-access-policy (e): an admin session's own DD write still produces an ordinary (non-denial) audit row"
        status: pass
    human_judgment: false
  - id: D4
    description: "The DD workspace page (public/due-diligence.html + public/js/due-diligence.js) renders one section per cleared area with its items, textContent-only, holding no client-side list of uncleared areas"
    verification:
      - kind: other
        ref: "grep -c innerHTML public/js/due-diligence.js == 0"
        status: pass
    human_judgment: true
    rationale: "No browser automation tool was available this session to visually confirm the rendered page. The zero-innerHTML/server-driven-area-list properties are source-verified, but actual in-browser rendering (layout, the per-item lifecycle controls, the add-item form) has not been visually confirmed against a live server."

duration: ~45min (excludes a tracer-gate checkpoint pause awaiting coordinator approval between Task 1 and Task 2)
completed: 2026-08-02
status: complete
---

# Phase 4 Plan 1: Due Diligence Workspace Tracer Summary

**The due-diligence data spine and clean-room area filter — DD request items in one of eight fixed functional areas, guarded end-to-end by a reusable need-to-know filter, with every refusal audited.**

## Performance

- **Duration:** ~45 min of active work (a checkpoint pause for coordinator tracer-gate approval sits between Task 1 and Task 2 and is excluded)
- **Tasks:** 3 (all completed)
- **Files modified:** 10 (6 created, 4 modified)
- **Commits:** 3 task commits + this docs commit

## Accomplishments

- Registered `ddRequestItems`, `ddFindings`, `ddRequestTemplates` as SQLite collections (32→35 in `db/collections.js`'s completeness assertion) with matching blob-per-row tables in `db/schema.sql`
- Built `db/accessPolicy.js`, the reusable clean-room need-to-know filter: `DD_AREAS`/`DD_AREA_IDS` (the fixed eight-area taxonomy), `grantedAreas()`, `hasAreaGrant()`, `filterByAreaGrant()` (list-response filtering), `assertAreaGrant()`/`AreaAccessError` (by-id throwing guard)
- Built the full DD request-item route surface in `server.js`: `GET /api/dd/areas`, `GET/POST /api/dd/request-items`, `GET/DELETE /api/dd/request-items/:id` — upsert-by-id, computed `overdue`, an IDOR guard that checks the item's STORED area (never a caller-supplied one) before touching it
- Made "the denial itself is audited" literally true: `refuseDdArea()` records one `dd-access-denied` security event (attributed actor, deal, area) before every uniform 403, while ordinary workspace browsing produces zero denial noise
- Built `public/due-diligence.html` + `public/js/due-diligence.js` — the DD workspace page, rendering only the caller's cleared areas with per-item lifecycle controls, textContent-only (zero `innerHTML`)
- Proved the whole slice through 13 new integration tests across two files, all passing through the real HTTP stack against isolated temp databases

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end "IL creates a Legal DD request item, an uncleared member sees nothing"** - `00f3918` (feat)
2. **Task 2: Request-item lifecycle, computed overdue, and the by-id IDOR guard** - `b0e24f9` (feat)
3. **Task 3: Audit every DD access denial as a security event** - `55df9e5` (feat)

_A tracer feedback-gate checkpoint occurred between Task 1 and Task 2: the coordinator independently re-verified Task 1's claims (re-ran `npm test`/`node --test test/dd-workspace.test.js`, checked the commit diff, confirmed the collections assertion and `deal.members` shape were untouched) before approving continuation — see the coordinator's checkpoint-approval message in this session's transcript for the detailed independent verification._

## Files Created/Modified

- `db/accessPolicy.js` (new) - the clean-room need-to-know filter module
- `validators/dd.js` (new) - `DdRequestItemUpsertSchema` (create+update, two refine()s) + DELETE `EmptyBodySchema`, both registered in `WRITE_SCHEMAS`
- `public/due-diligence.html` (new) - the DD workspace page scaffold
- `public/js/due-diligence.js` (new) - renders cleared areas + items, per-item lifecycle controls, add-item form
- `test/dd-workspace.test.js` (new) - 8 integration tests: create/read-back, grant-scoped visibility, empty-grant emptiness, duplicate-text distinct ids, empty-deal `[]`+200, stable read order, concurrent-write survival, overdue computation, uniform-403 byte-identity, cross-area-move refusal
- `test/dd-access-policy.test.js` (new) - 5 integration tests: denial audit attribution, null-subject unknown-id denial, refused-create persists nothing, zero-denial browsing, admin's-own-write is ordinary not denied
- `db/collections.js` (modified) - `ARRAY_COLLECTIONS` grew 32→35, completeness assertion + header comment updated
- `db/schema.sql` (modified) - three new blob-per-row tables + project indexes
- `server.js` (modified) - `require('./db/accessPolicy')`, `require('./validators/dd')`, `ROLE_WRITE_POLICY` entry for `/api/dd`, the full DD route section (`ddRequestLane`, `computeOverdue`, `publicDdItem`, `refuseDdArea`, `ddAreaRefused`, 5 routes)
- `test/migration-roundtrip.test.js` (modified) - hardcoded ground-truth collection count updated 37→40 (Rule 1 fix, see Deviations)

## Decisions Made

- **grantedAreas() deal-check ordering (coordinator-requested hardening):** moved the `!deal` early-return above the admin/hrbp role shortcut in `db/accessPolicy.js`. This closes a latent fail-open the reviewing coordinator flagged during the tracer checkpoint — today it changes nothing (every real call site always passes a resolved deal object), but it means a future caller that somehow invokes `grantedAreas()` without a resolved deal fails closed for every role, admin/hrbp included, instead of silently granting the highest-privilege roles full access on a null deal.
- **Uniform-403 via a shared null-area path, not a second branch:** an unknown item id and an item in an uncleared area both call `assertAreaGrant(deal, user, areaId)` with the SAME function — `areaId` is just `null` for the missing-item case, and `null` is never a member of any role's granted-area set. This makes the DD-04 anti-enumeration property structural rather than something a future route could accidentally implement inconsistently (the coordinator specifically flagged this as "the highest-value thing you will build in Task 2").
- **No audit dependency inside db/accessPolicy.js:** every audit call (`refuseDdArea()`) lives in `server.js`, never inside the filter module itself — mirrors why `db/controlStore.js` holds no reference to `audit.db` (AUD-02's isolation precedent), verified by a grep-based acceptance criterion (`grep -v "^ *[/*]" db/accessPolicy.js | grep -c "auditHook\|recordSecurityEvent"` → `0`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] test/migration-roundtrip.test.js's hardcoded ground-truth collection count broke on Task 1's own change**
- **Found during:** Task 1 (adding the three dd* collections to `ARRAY_COLLECTIONS`)
- **Issue:** `test/migration-roundtrip.test.js` asserted `ARRAY_COLLECTIONS.length + SINGLETON_KEYS.length === 37` as its "ground-truth inventory" check. Adding `ddFindings`/`ddRequestItems`/`ddRequestTemplates` (32→35 array collections) made this assertion fail — a pre-existing test directly invalidated by this plan's own registration step, not a pre-existing/out-of-scope failure.
- **Fix:** Updated the assertion to `40` (35 array + 5 singleton) and extended the file's header comment to explain that the three new collections predate the frozen `db.json` fixture entirely and so round-trip as empty — the row-count-parity and canonical-JSON-equality logic itself needed no change, since `source[key] || []` already handles an absent fixture key correctly.
- **Files modified:** `test/migration-roundtrip.test.js`
- **Verification:** `npm test` green (127/127 immediately after this fix, before Tasks 2-3 added their own tests)
- **Committed in:** `00f3918` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix) + 1 coordinator-requested hardening (documented above under Decisions Made, not a bug)
**Impact on plan:** The test fix was a necessary, directly-caused correction with zero scope creep. The `grantedAreas()` ordering change is a pure hardening with no observable behavior difference for any real caller — verified by re-running the full suite (135/135) after the change.

## Issues Encountered

None beyond the deviation and hardening documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `db/accessPolicy.js`'s exact interface (`DD_AREAS`, `grantedAreas()`, `hasAreaGrant()`, `filterByAreaGrant()`, `assertAreaGrant()`, `AreaAccessError`) is stable and ready for 04-02 through 04-08 to build on (findings, conversion, VDR links, the setup wizard's DD kickoff, the deal-home rollup) and for Phase 6's flight-risk register to reuse without inventing a second access-policy pattern.
- `ddFindings` and `ddRequestTemplates` are registered as collections/tables but not yet populated by any route — Plan 03 (templates) and Plan 04 (findings) are expected to add their own routes against these same tables, following this plan's `ddRequestLane`-style flat-lane-helper pattern.
- `vdrLink` is intentionally `null` on every item created by this plan (per the interface contract) — Plan 05 is expected to fill it. This is not a stub bug; it is the plan's own documented scope boundary.
- No blockers for 04-02.

---
*Phase: 04-due-diligence-workspace*
*Completed: 2026-08-02*

## Self-Check: PASSED

All files created by this plan exist on disk and all 3 task commits are present in git history:

- FOUND: db/accessPolicy.js
- FOUND: validators/dd.js
- FOUND: public/due-diligence.html
- FOUND: public/js/due-diligence.js
- FOUND: test/dd-workspace.test.js
- FOUND: test/dd-access-policy.test.js
- FOUND: db/collections.js
- FOUND: db/schema.sql
- FOUND: server.js
- FOUND: test/migration-roundtrip.test.js
- FOUND commit: 00f3918 (Task 1)
- FOUND commit: b0e24f9 (Task 2)
- FOUND commit: 55df9e5 (Task 3)

`npm test` = 135/135 (baseline 122 + 13 new). `node scripts/list-unvalidated-routes.js` exits 0. `node -e "require('./server.js')"` boots clean.
