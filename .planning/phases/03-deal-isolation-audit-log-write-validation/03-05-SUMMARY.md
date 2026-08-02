---
phase: 03-deal-isolation-audit-log-write-validation
plan: 05
subsystem: database
tags: [sqlite, audit-log, compliance, better-sqlite3, express, admin-console]

# Dependency graph
requires:
  - phase: 03-deal-isolation-audit-log-write-validation
    provides: "03-01: db/audit-schema.sql (append-only ABORT triggers) + db/dbFiles.js's AUDIT_DB_PATH/AUDIT_SCHEMA_PATH; 03-03: db/store.js's AsyncLocalStorage request-scoped context + writeDb()'s existing snapshot-diff (beforeMap/afterArr) + db/resolver.js's dealResolverMiddleware; 03-04: the deal registry routes (create/select/members/archive/delete) and db/sessions.js's releaseSessionsForDeal()"
provides:
  - "db/auditHook.js: getAuditConnection()/writeAuditBatch()/recordSecurityEvent()/queryAudit()/AUDITED_DB_KINDS — the independent audit.db connection and its full read/write API"
  - "db/store.js: writeDb() now dispatches a per-row before/after delta batch to the audit hook after its own transaction commits, with ZERO signature change — resolved automatically from the request-bound AsyncLocalStorage context db/resolver.js populates"
  - "db/resolver.js: the bound context now carries actor/request (derived from req.portalUser at bind time), and CONTROL_PLANE_PATHS covers /api/admin/audit"
  - "server.js: recordSecurityEvent() call sites for every D-08 event family + GET /api/admin/audit (D-10)"
  - "public/admin.html + public/js/admin.js: the admin-only 'Audit Log' viewer tab (deal/actor/date-range filters, expandable before/after)"
affects: []

# Actuals (#2632)
actuals:
  tokens: 17600
  tasks: 3
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Store-layer audit hook, not SQLite triggers with a cross-database link (db/auditHook.js): db/store.js's writeDb() already computes the exact before/after values during its existing snapshot-diff merge — the hook reuses them and writes to an INDEPENDENT second connection to audit.db, never a cross-database link onto a deal handle, per 03-RESEARCH.md's verified WAL/cross-file-atomicity finding"
    - "Actor threaded via AsyncLocalStorage, not a new writeDb() parameter: db/resolver.js's dealResolverMiddleware captures req.portalUser into the SAME bound context db/store.js already resolves per request — zero changes to any of the ~90 existing readDb()/writeDb() call sites"
    - "Attributed-actor-or-throw (D-11): an audited write/event with no resolved actor throws rather than logging anonymously — except the one legitimate DEMO_OPEN=1 open-mode bypass (session-revoke-all), where a null actor means there is no real security boundary to begin with, mirroring D-08's own 'demo writes are NOT audited' rule instead of crashing a legitimate request"
    - "Security events routed through db/auditHook.js directly from server.js, never through db/controlStore.js — keeps that module holding zero reference to audit.db so AUD-02 (the trail survives a deal's own deletion) holds by construction, not by convention"

key-files:
  created:
    - db/auditHook.js
    - test/audit-log.test.js
    - test/audit-security-events.test.js
  modified:
    - db/store.js
    - db/resolver.js
    - server.js
    - public/admin.html
    - public/js/admin.js
    - test/deal-isolation.test.js

key-decisions:
  - "D-09 checkpoint (Task 1) approved as-specified by the user via the orchestrator, 2026-08-01: dedicated gitignored/zip-excluded data/audit.db physically outside every deal file, append-only via the existing Plan 03-01 ABORT triggers, full before/after row JSON, store-layer writeDb() hook (not triggers), best-effort post-commit semantics with loud audit-write-failure surfacing, tamper-evidence/hash-chaining deferred to the shared-host milestone."
  - "AUDITED_DB_KINDS = {'deal', 'control'} even though no control-plane route currently calls writeDb() (they all go through db/controlStore.js's direct-SQL accessor) — if a future control-plane write path is ever routed through writeDb(), it is audited by construction rather than silently falling through an incomplete list."
  - "db/resolver.js's CONTROL_PLANE_PATHS widened to also cover /api/admin/audit, mirroring Plan 04's own precedent for /api/admin/deals* — the viewer's handler never reads req.dealContext at all (it talks to audit.db directly), so an admin's own stale/archived deal binding must never lock them out of the one place they can inspect the trail."
  - "recordSecurityEvent() is called directly from server.js at each D-08 event site, never from db/controlStore.js, so that module's own AUD-02 guarantee (zero reference to audit.db) is never put at risk by a future edit to the security-event call sites."
  - "Login and logout are NOT recorded as D-08 security events (self logout is explicitly named as ordinary in the plan; login isn't in D-08's event list at all), and deal SELECT is not audited either (D-08 names create/archive/delete/membership-change, not select) — followed the plan's own literal event list rather than a broader reading."

patterns-established:
  - "Tracer feedback gate: Task 2 (type=tracer) was committed, its own test/audit-log.test.js (8/8) plus the full regression suite (94/94) were run and confirmed green, and an explicit human-verify checkpoint was returned and cleared before Task 3 (the expansion — server.js call sites + admin viewer) began."

requirements-completed: [AUD-01, AUD-02]

coverage:
  - id: D1
    description: "A deal-bound session's insert, update and delete each produce one attributed audit row (actor username/role, deal id, collection, row id) with the correct action name"
    requirement: AUD-01
    verification:
      - kind: unit
        ref: "test/audit-log.test.js#audit-log (a): insert, update, delete on a deal database each produce one attributed audit row..."
        status: pass
    human_judgment: false
  - id: D2
    description: "Full before/after row JSON per entry: a first insert's before is SQL NULL (never the string 'null'), an update carries both, a delete's after is SQL NULL"
    requirement: AUD-01
    verification:
      - kind: unit
        ref: "test/audit-log.test.js#audit-log (b): the insert row's before is SQL NULL and its after parses back to the exact stored item..."
        status: pass
    human_judgment: false
  - id: D3
    description: "Empty writes produce zero audit rows; two writes to the same row inside one write batch window are distinguished by autoincrement id, never merged; rows from one batch share a timestamp and read back in stable ascending-id order"
    requirement: AUD-01
    verification:
      - kind: unit
        ref: "test/audit-log.test.js#audit-log (c)/(d)/(e)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Demo writes never produce an audit row, regardless of how many rows changed (D-08)"
    verification:
      - kind: unit
        ref: "test/audit-log.test.js#audit-log (f)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Deleting a deal (via the real Plan 04 delete route) leaves every one of its audit rows present and readable"
    requirement: AUD-02
    verification:
      - kind: unit
        ref: "test/audit-log.test.js#audit-log (g)"
        status: pass
    human_judgment: false
  - id: D6
    description: "An audited write resolved with no attributed actor throws rather than writing an anonymous row (D-11)"
    verification:
      - kind: unit
        ref: "test/audit-log.test.js#audit-log (h)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Every D-08 control-plane action (deal create/archive/delete/membership-change, password change, admin session-revoke-all, break-glass token use) produces exactly one attributed audit row; a break-glass token use is attributed to the stable token identity, never a null actor"
    verification:
      - kind: unit
        ref: "test/audit-security-events.test.js#audit-security-events (a)/(b)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The admin audit viewer is 403 for hrbp/pmo/employee and 200 for admin; its deal/actor/date-range filters each narrow the result set correctly and results stay ordered by ascending id"
    requirement: AUD-01
    verification:
      - kind: unit
        ref: "test/audit-security-events.test.js#audit-security-events (c)/(d)"
        status: pass
    human_judgment: false
  - id: D9
    description: "No registered route under /api/admin/audit accepts a method that could modify or remove a row, and a direct UPDATE/DELETE against a live audit_log row raises in the running system (Plan 03-01's triggers are live at runtime, not just in the schema file)"
    requirement: AUD-02
    verification:
      - kind: unit
        ref: "test/audit-security-events.test.js#audit-security-events (e)/(f)"
        status: pass
    human_judgment: false
  - id: D10
    description: "The admin console's new Audit Log tab renders the filterable table, is visible only to admin, and causes zero regressions to the demo showcase or the existing test suite"
    verification:
      - kind: unit
        ref: "grep -c innerHTML-with-interpolated-audit-data public/js/admin.js == 0 (every dynamic value set via textContent); npm test 100/100 green"
        status: pass
      - kind: manual_procedural
        ref: "the plan's own D-10 verification line ('browser rendering verified at the end-of-phase human check') — NOT run in this session (no browser automation tool available in this executor's environment, matching Plan 04's identical precedent)"
        status: unknown
    human_judgment: true
    rationale: "Filter wiring, viewer access control, and no-XSS-surface were all verified automatically (HTTP-level fetch tests + source-level textContent-only check). Actual visual rendering/click-through of the new tab in a real browser was not driven in this session — deferred to a human pass, same as Plan 04's own deal-switcher UI."

duration: ~70min active (excludes the multi-hour pause between Task 2's commit and the human-verify checkpoint clearing)
completed: 2026-08-02
status: complete
---

# Phase 3 Plan 05: Store-Layer Audit Hook + D-08 Security Events + Admin Audit Viewer Summary

**A store-layer `writeDb()` hook that reuses the existing snapshot-diff to write attributed, append-only before/after entries into a physically separate `audit.db`, plus `recordSecurityEvent()` call sites for every D-08 control-plane action and a filterable admin-only audit viewer**

## Performance

- **Duration:** ~70 min active work (Task 1 checkpoint: instant; Task 2 tracer: ~40 min including an 8-case test file; a human-verify pause of several hours between Task 2's commit and its clearance; Task 3: ~25 min)
- **Started:** 2026-08-01T10:56:00Z (approx, first file reads)
- **Completed:** 2026-08-02T03:15:56Z (final commit)
- **Tasks:** 3 (1 checkpoint + 1 tracer + 1 auto)
- **Files modified:** 9 (3 created, 6 modified)

## Accomplishments
- D-09 checkpoint cleared: the audit store's location (dedicated gitignored/zip-excluded `data/audit.db`, physically outside every deal file), mechanism (store-layer hook, not cross-database triggers) and best-effort semantics (post-commit, loud-failure-surfacing, tamper-evidence deferred) approved as-specified before any history accumulated
- Built `db/auditHook.js` — an independent connection to `audit.db` (never a cross-database link onto a deal handle, verified by a zero-count grep for the SQL keyword that names that link mechanism), with `writeAuditBatch()` (one transaction per `writeDb()` call), `recordSecurityEvent()` (one row per named control-plane action), and `queryAudit()` (D-10's filterable read path, ordered by ascending autoincrement id, hard-capped at 500 rows)
- Extended `db/store.js`'s `writeDb()` to collect a per-row before/after delta list during its EXISTING snapshot-diff merge, with ZERO change to its signature — the audit dispatch happens only after the source transaction has committed (a rolled-back write never produces an audit row), and throws if an audited context resolves with no actor rather than logging anonymously
- Extended `db/resolver.js`'s bound AsyncLocalStorage context with `actor`/`request`, derived from `req.portalUser` at bind time — this is how the request-bound identity reaches the audit hook with no new parameter threaded through the ~90 existing `readDb()`/`writeDb()` call sites
- Wired `recordSecurityEvent()` into `server.js` at every D-08 event family: break-glass `X-Admin-Token` use (every request, attributed to the stable token identity), self password-change, admin session-revoke-all (self logout stays unaudited by design), and the deal create/archive/delete/membership-change routes from Plan 04 — routed directly from `server.js`, never through `db/controlStore.js`, so that module's AUD-02 guarantee (zero reference to `audit.db`) is never put at risk
- Added `GET /api/admin/audit` (D-10), inheriting admin-only enforcement from the existing `ROLE_WRITE_POLICY` `/api/admin` rule for every method (CR-02); widened `db/resolver.js`'s `CONTROL_PLANE_PATHS` to cover this route so an admin's own stale/archived deal binding can never lock them out of it
- Built the admin console's new "Audit Log" tab (`public/admin.html` + `public/js/admin.js`) — a compact, filterable (deal/actor/date-range) list with an expandable before/after view, admin-only both client-side (tab hidden until the caller's real role is confirmed) and server-side (independently re-enforced), every value rendered via `textContent` only
- Full regression suite stayed green throughout: 86 → 94 → 100 tests, 0 failures at every step, including a real regression `test/role-enforcement.test.js`'s own pre-existing AUTH-04/D-02 case caught (see Deviations) and a pre-existing `test/deal-isolation.test.js` fix required by the new actor-required contract

## Task Commits

Each task was committed atomically:

1. **Task 1: Confirm the audit store's location and semantics (D-09 checkpoint)** — no commit (decision recorded; approved by user via orchestrator, 2026-08-01)
2. **Task 2: Store-layer audit hook — one deal write, one attributable append-only entry (tracer)** - `425ca28` (feat) — held for an explicit human-verify checkpoint before Task 3 began; cleared (verified by user via orchestrator)
3. **Task 3: Control-plane security events and the admin-only audit viewer** - `99f1925` (feat)

**Plan metadata:** (final docs commit follows this summary)

## Files Created/Modified
- `db/auditHook.js` - NEW: `getAuditConnection()`/`writeAuditBatch()`/`recordSecurityEvent()`/`queryAudit()`/`AUDITED_DB_KINDS`
- `db/store.js` - `writeDb()` collects per-row deltas during its existing merge, dispatches to the hook post-commit, throws on a missing actor for an audited write
- `db/resolver.js` - bound context gains `actor`/`request`; `CONTROL_PLANE_PATHS` covers `/api/admin/audit`
- `server.js` - `recordSecurityEvent()` call sites (break-glass token use, password-change, session-revoke-all, deal create/members/archive/delete); new `GET /api/admin/audit`; `requestMeta(req)` helper
- `public/admin.html` - new "Audit Log" tab nav button + panel (filters, list, before/after `<details>`)
- `public/js/admin.js` - `loadAuditLog()`/`renderAuditLog()`/filter wiring/admin-role poll; `admin.js`'s own cache stamp bumped `1784300020` → `1784600010`
- `test/audit-log.test.js` - NEW: 8 cases (a–h) covering AUD-01/AUD-02/D-08/D-11 at the storage layer
- `test/audit-security-events.test.js` - NEW: 6 cases (a–f) covering D-08/D-10/AUD-02 at the HTTP/route layer
- `test/deal-isolation.test.js` - `runAsDeal()` helper extended with `actor`/`request` (deviation, see below)

## Decisions Made
See `key-decisions` in the frontmatter above — summarized: D-09 approved as-specified; `AUDITED_DB_KINDS` includes `'control'` even though unreachable via `writeDb()` today (future-proofing, not dead code); `CONTROL_PLANE_PATHS` widened for the same admin-lockout-prevention reason Plan 04 already established; security events recorded from `server.js` directly, never `db/controlStore.js`; login/logout/deal-select deliberately NOT audited (not in D-08's literal event list).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking regression] `test/deal-isolation.test.js`'s `runAsDeal()` helper broke under the new actor-required contract**
- **Found during:** Task 2 full-suite regression run (`npm test`)
- **Issue:** `test/deal-isolation.test.js` (a pre-existing Plan 03 test, not in this plan's declared `files_modified`) calls `store.runWithDb()` directly with a hand-built context, bypassing `db/resolver.js`'s real middleware — its writes against a `'deal'`-kind context therefore resolved with no `actor`, and `writeDb()`'s new "audited write with no actor throws" behavior (this plan's own Task 2 acceptance criterion) turned two of its passing test cases into failures.
- **Fix:** `runAsDeal()` now derives `actor`/`request` from its `fakeReq.portalUser` the exact same way `db/resolver.js`'s `dealResolverMiddleware` does for a real request. Also added `MA_AUDIT_DB_PATH` to this file's temp-dir env overrides, isolating its audit rows from the live `data/audit.db` (this suite previously had no reason to touch `audit.db` at all).
- **Files modified:** `test/deal-isolation.test.js`
- **Verification:** `node --test test/deal-isolation.test.js` green (4/4); full suite green.
- **Committed in:** `425ca28` (Task 2)

**2. [Rule 1 - bug] `session-revoke-all`'s `recordSecurityEvent()` call assumed a non-null actor, breaking a legitimate `DEMO_OPEN=1` bypass**
- **Found during:** Task 3 full-suite regression run — `test/role-enforcement.test.js`'s existing AUTH-04/D-02 case ("an isOpenMode request is not gated on role/session at all") turned a 200 into a 500
- **Issue:** `/api/admin/users/:username/revoke-sessions` is NOT a `CONTROL_PLANE_PATH`, so under `DEMO_OPEN=1` with no session at all it resolves to `demo.db` and legitimately executes with `req.portalUser === null` (D-02's open-mode bypass skips the role/session gate entirely). The new `recordSecurityEvent()` call there required a non-null actor and threw.
- **Fix:** Guarded the call with `if (req.portalUser)` — skipping the security-event record in that specific case mirrors D-08's own "demo writes are NOT audited" rule rather than crashing an otherwise-legitimate demo-mode request. The other five call sites were left throwing-on-missing-actor by design: password-change already 401s before reaching its call, and the four deal routes are themselves `CONTROL_PLANE_PATHS` (so `isOpenMode()` can never bypass them) — confirmed unreachable with a null actor, not defensively guarded, per D-11's "throw loudly on a real bug" intent.
- **Files modified:** `server.js`
- **Verification:** `node --test test/role-enforcement.test.js` green (all cases); full suite green (100/100).
- **Committed in:** `99f1925` (Task 3)

---

**Total deviations:** 2 auto-fixed (1 blocking regression fix in a pre-existing test the new actor contract broke, 1 real bug in a new call site's null-actor handling). Both caught by the plan's own regression-suite acceptance criterion, not silently introduced.
**Impact on plan:** None on delivered behavior — every AUD-01/AUD-02/D-08/D-09/D-10/D-11 acceptance criterion in the plan is met; both fixes were necessary for the plan's own "npm test (bare) green" acceptance criterion to actually hold.

## Issues Encountered
None beyond the two deviations above (both caught and fixed within the same task's own regression pass, before that task's commit).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- Plan 06 (generalize zod validation across the ~60 remaining write endpoints, VAL-01/VAL-02) has no dependency on this plan's audit mechanism and can proceed independently.
- **Known gap, deferred to a human pass (not blocking, same precedent as Plan 04's deal-switcher UI):** the admin Audit Log tab's actual browser rendering/click-through (visual layout, filter interaction, expandable before/after readability) was not driven in this session — no browser automation tool available. Every automatable angle (HTTP-level route/filter/attribution tests, source-level textContent-only XSS check, full regression suite) was verified. A human should confirm the tab renders and filters correctly before this plan is considered fully closed for D-10.
- No blockers. Phase 3 is now at 5/6 plans complete (Plan 06 remains: generalized zod write validation).

---
*Phase: 03-deal-isolation-audit-log-write-validation*
*Completed: 2026-08-02*

## Self-Check: PASSED

All created files verified present on disk; commit hashes (`425ca28`, `99f1925`) verified present in `git log --oneline --all`.
