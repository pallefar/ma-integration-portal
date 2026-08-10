---
phase: 03-deal-isolation-audit-log-write-validation
plan: 03
subsystem: database
tags: [sqlite, async-local-storage, resolver, isolation, cutover, deal-database]

# Dependency graph
requires:
  - phase: 03-deal-isolation-audit-log-write-validation
    provides: "03-01: db/dbFiles.js path constants + openDbFile(), control/runtime/audit-schema.sql; 03-02: db/collections.js COLLECTION_TARGETS, the split outputs (control.db/demo.db/runtime.db), db/dealSeed.js"
provides:
  - "db/store.js: requestDbStorage (AsyncLocalStorage), getOrOpenConnection(path, schemaPath) shared connection cache, runWithDb(context, fn), closeAllConnections(), currentDbContext() — requireDb() now resolves the request-scoped connection first, module singleton fallback unchanged"
  - "db/resolver.js: resolveDatabase(req), dealResolverMiddleware, DealAccessError, CONTROL_PLANE_PATHS — the sole real-vs-demo-vs-deal binding point, bind-time membership refusal (never a read-time filter)"
  - "db/controlStore.js: findUser/updateUser, getDeal/listDealsForUser/isDealMember, getControlSettings/setControlSettings, getSecretSettings/setSecretSettings — the only path to control.db's accounts/deal registry"
  - "db/dbFiles.js: MA_CONTROL_DB_PATH/MA_RUNTIME_DB_PATH/MA_DEMO_DB_PATH/MA_DEALS_DIR env overrides — lets a test boot the real requireable server.js against isolated temp files"
  - "server.js cut over to control.db/runtime.db/demo.db; DEMO_ONLY_PREFIXES hard-gates the showcase-only mechanics; data/ma-portal.db archived read-only"
affects: [03-04, 03-05, 03-06]

# Actuals (#2632)
actuals:
  tokens: 34789
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AsyncLocalStorage-bound connection resolution (db/store.js): db/resolver.js's middleware calls requestDbStorage.run({conn,kind,dealId,dbPath}, next) once per request; requireDb() consults it first, falls back to the module singleton — zero changes to any of the ~90 existing readDb()/writeDb() call sites"
    - "Bind-time membership refusal (Pitfall 3): a non-member/missing/archived deal binding throws DealAccessError BEFORE getOrOpenConnection() is ever called for that file — a bug in a handler can never turn into a cross-deal read/write because the connection was never created"
    - "Env-var path overrides (db/dbFiles.js): MA_CONTROL_DB_PATH etc. default to the real data/ paths in every real deployment, but let a test point the REAL requireable app at an isolated temp trio — reused by three new test files plus a rewritten test/role-enforcement.test.js"
    - "Direct-SQL control accessor (db/controlStore.js) mirrors db/sessions.js's established shape — its own lazily-opened connection (via the shared cache), never a connection-as-first-arg, since its callers (the gate, login) have no request-bound connection in scope"

key-files:
  created:
    - db/resolver.js
    - db/controlStore.js
    - test/deal-resolver.test.js
    - test/deal-isolation.test.js
    - test/demo-only-gating.test.js
  modified:
    - db/store.js
    - db/sessions.js
    - db/dbFiles.js
    - db/collections.js
    - db/schema.sql
    - server.js
    - scripts/set-admin-password.js
    - test/session-lifecycle.test.js
    - test/role-enforcement.test.js
    - test/migration-roundtrip.test.js
    - test/db-split-migration.test.js
  archived:
    - data/ma-portal.db (chmod 444, retained not deleted — Phase-1 precedent)

key-decisions:
  - "The consolidated /api gate could not be wired incrementally across Tasks 1-3's commits without leaving the app in a non-booting intermediate state (login's readDb()/db.users lookup and the resolver binding are both inside the SAME gate function) — server.js's full cutover+gating diff landed in the Task 1 commit; Tasks 2 and 3 contribute their own distinct remaining files (db/collections.js, db/schema.sql, scripts/set-admin-password.js, the archival, and each task's own test file). Documented as a deviation, not silently done."
  - "Identity resolution (session cookie / X-Admin-Token) now happens BEFORE the isOpenMode(req) check in the gate, since isOpenMode depends on req.isDemo which the resolver sets — the bootstrapping inversion 03-PATTERNS.md flagged. A session miss no longer 401s immediately; it stays unresolved until the resolver has run, since DEMO_OPEN may still rescue an anonymous request once its (non-)deal binding is known."
  - "/api/auth/me stays on PUBLIC_API_PATHS (bypasses the resolver entirely, as it always has) and resolves its own session + an inline equivalent of the D-03 open-mode rule (no session, or a session with no deal binding, exempts under DEMO_OPEN) — duplicating that one predicate was cheaper and less risky than routing this one public, resolver-free endpoint through the full gate."
  - "DEAL_SEED_COLLECTIONS (checklistTemplates, assessmentTemplates, processCatalog) are the deliberate exception to ISO-01's 'no shared rows' isolation proof — two deals seeded from the same demo.db template source legitimately share those row ids by design (D-06); test/deal-isolation.test.js asserts this positively rather than silently excluding it."
  - "scripts/set-admin-password.js's `opts.dbPath` test-override parameter is retired in favor of the MA_CONTROL_DB_PATH/MA_RUNTIME_DB_PATH env vars, matching the rest of the codebase's new override convention — no test currently exercises this script, so the API change carries zero test-breakage risk."

patterns-established:
  - "Tracer feedback: Task 1 is type=tracer; its own test/deal-resolver.test.js (7 cases) was run and confirmed green before Task 2 (the cutover) began building on it."

requirements-completed: [ISO-01, ISO-02, ISO-03]

coverage:
  - id: D1
    description: "A request resolves to exactly one database before any handler runs; demo and deal sessions never share rows; a non-member cannot obtain a handle to a deal file"
    requirement: ISO-01
    verification:
      - kind: unit
        ref: "test/deal-resolver.test.js (a)-(e): demo/deal read isolation, non-member 403 with no file created, missing/archived-deal 404, cached-handle adjacency"
        status: pass
      - kind: unit
        ref: "test/deal-isolation.test.js (a)-(b): no shared business-data row ids across every array collection between two deals, or between a deal and demo.db"
        status: pass
    human_judgment: false
  - id: D2
    description: "Two concurrent writes to two different deal databases each land only in their own file, no lost update; the AsyncLocalStorage context never leaks across interleaved requests"
    requirement: ISO-01
    verification:
      - kind: unit
        ref: "test/deal-isolation.test.js (c): concurrent writes to deal_one1/deal_two1 both persist, neither observes the other's row"
        status: pass
      - kind: unit
        ref: "test/deal-resolver.test.js (g): two interleaved runWithDb() contexts with an await between bind and read never cross-leak"
        status: pass
    human_judgment: false
  - id: D3
    description: "Accounts and the deal registry are reached only through db/controlStore.js — a deal-bound request's own connection can never read/write them"
    requirement: ISO-01
    verification:
      - kind: unit
        ref: "test/deal-isolation.test.js (d): a deal-bound readDb() has db.users === undefined; controlStore.findUser('admin') still resolves the real account"
        status: pass
    human_judgment: false
  - id: D4
    description: "With DEMO_OPEN=1, an unauthenticated request still resolves to demo.db and stays open, but a session bound to a real deal is NEVER open; the resolver runs before ROLE_WRITE_POLICY"
    requirement: ISO-03
    verification:
      - kind: unit
        ref: "test/role-enforcement.test.js AUTH-04 (D-02): DEMO_OPEN bypasses session/role entirely for an unbound request"
        status: pass
      - kind: unit
        ref: "test/deal-resolver.test.js (f): a demo-only, role-allowed write against a deal-bound admin session is refused for the resolved database, not the role — proves gate ordering"
        status: pass
    human_judgment: false
  - id: D5
    description: "Demo-only mechanics (time-travel, merit-award, lesson complete/uncomplete) refuse with 403 for any resolved database other than demo.db, enforced once in the gate; a refused call leaves the deal's stored data byte-identical; the showcase still works"
    requirement: ISO-02
    verification:
      - kind: unit
        ref: "test/demo-only-gating.test.js (a): demo-bound time-travel + lesson-complete still succeed, scaling still observable"
        status: pass
      - kind: unit
        ref: "test/demo-only-gating.test.js (b)+(c): all four demo-only endpoints 403 for a deal-bound session; the deal's settings/employee rows are byte-identical via direct SQL afterwards"
        status: pass
      - kind: unit
        ref: "test/demo-only-gating.test.js (d): a deal-bound GET of employees/pulses returns exactly the stored rows, no day-scaling"
        status: pass
      - kind: unit
        ref: "test/demo-only-gating.test.js (e): every DEMO_ONLY_PREFIXES entry maps to a live registered route"
        status: pass
    human_judgment: false
  - id: D6
    description: "data/ma-portal.db is archived read-only and no code path opens it"
    verification:
      - kind: unit
        ref: "command: ls -l data/ma-portal.db shows -r--r--r--"
        status: pass
      - kind: other
        ref: "command: grep -c \"ma-portal.db\" server.js == 0"
        status: pass
    human_judgment: false
  - id: D7
    description: "No regression to the existing test suite; the live app boots and a real login round-trip succeeds against the split stores"
    verification:
      - kind: unit
        ref: "npm test (bare node --test, 21 files, 72 tests)"
        status: pass
      - kind: other
        ref: "command: PORT=3987 node server.js, then a real curl login round-trip against the live data/control.db + data/runtime.db + data/demo.db"
        status: pass
    human_judgment: false

duration: 65min
completed: 2026-08-01
status: complete
---

# Phase 3 Plan 03: Session-Bound Deal Resolver + Store Cutover + Demo-Only Hard-Gate Summary

**AsyncLocalStorage-bound per-request database resolution (db/resolver.js + db/store.js), the app cut over to control.db/runtime.db/demo.db with accounts moved to a dedicated control.db accessor, and DEMO_ONLY_PREFIXES hard-gating the showcase mechanics — replacing the demoMode flag/shadow-array switch entirely**

## Performance

- **Duration:** 65 min
- **Started:** 2026-08-01T07:32:23Z
- **Completed:** 2026-08-01T08:37:03Z
- **Tasks:** 3 (1 tracer + 2 auto)
- **Files modified:** 16 (5 created, 11 modified, excluding node_modules)

## Accomplishments
- Built `db/store.js`'s AsyncLocalStorage-based request-scoped connection resolution (`requestDbStorage`, `getOrOpenConnection`, `runWithDb`, `closeAllConnections`, `currentDbContext`) with ZERO changes to any of the ~90 existing `readDb()`/`writeDb()` call sites — `requireDb()` consults the request context first, falls back to the pre-existing module singleton for server startup/migration scripts/every pre-Phase-3 test
- Built `db/resolver.js` — the sole real-vs-demo-vs-deal binding point: `resolveDatabase(req)` + `dealResolverMiddleware`, with membership refused at BIND TIME (Pitfall 3), never a read-time filter, and never a silent fallback to demo on a failed bind
- Built `db/controlStore.js` — the only path to control.db's accounts and deal registry, mirroring `db/sessions.js`'s established direct-SQL module shape
- Rewired the consolidated `/api` gate: identity resolution now runs BEFORE the open-mode check (the bootstrapping inversion `isOpenMode(req)`'s D-03 extension requires), then the resolver, then open-mode/401/demo-only/role checks in that order
- Cut the live app over to `control.db`/`runtime.db`/`demo.db` — login/logout/`/auth/me`/change-password/admin-revoke-sessions now go through `db/controlStore.js` and a dedicated runtime connection; the four `geminiApiKey` reads and the settings write path now route through `getSecretSettings()`/`setSecretSettings()`
- `db/collections.js`/`db/schema.sql`: `users` removed from `ARRAY_COLLECTIONS` (33→32) and from `db/schema.sql` entirely — accounts are now structurally impossible to reach through a deal/demo connection, not just routing-convention-excluded
- `DEMO_ONLY_PREFIXES`/`isDemoOnlyPath()` hard-gate the showcase-only endpoints in the gate; `scaleEmployeesForDay`/`getPulsesForDay`/`getScaledScores` each gained a single `req.isDemo`-guarded call site
- Archived `data/ma-portal.db` read-only (chmod 444, Phase-1 precedent) after the full suite went green against the split stores; confirmed no remaining code path in `server.js` references the filename
- Added `db/dbFiles.js`'s `MA_*_PATH` env-var overrides so any test can boot the REAL requireable `server.js` against an isolated temp trio instead of the live, committed `data/*.db` — reused across all three new test files plus the rewritten `test/role-enforcement.test.js`
- Full regression suite stayed green throughout: 56 → 64 → 72 tests, 0 failures at every step; a real live boot (`node server.js`) + a real curl login round-trip against the actual `data/control.db`/`data/runtime.db`/`data/demo.db` succeeded end to end

## Task Commits

Each task was committed atomically:

1. **Task 1: Session-bound resolver — one request, one database, end-to-end (tracer)** - `333da21` (feat) — the FULL server.js gate rewrite landed here (see Deviations: the consolidated gate could not be split across commits without an intermediate non-booting state)
2. **Task 2: Cut the app over to the split stores and archive the source** - `c1d8067` (feat)
3. **Task 3: Hard-gate the demo-only mechanics to demo.db** - `c82a827` (test) — the gate code itself already shipped in Task 1's commit; this commit adds the five ISO-02 proof cases

**Plan metadata:** (final docs commit follows this summary)

## Files Created/Modified
- `db/store.js` - AsyncLocalStorage request-scoped connection resolution; `initDb()`/`readDb()` extended, not replaced
- `db/resolver.js` - NEW: `resolveDatabase()`, `dealResolverMiddleware`, `DealAccessError`, `CONTROL_PLANE_PATHS`
- `db/controlStore.js` - NEW: accounts + deal registry + control/secret settings accessors
- `db/sessions.js` - `findSession()` resolves `dealId`; new `bindSessionDeal()`
- `db/dbFiles.js` - `MA_CONTROL_DB_PATH`/`MA_RUNTIME_DB_PATH`/`MA_DEMO_DB_PATH`/`MA_DEALS_DIR` env overrides
- `db/collections.js` - `users` removed from `ARRAY_COLLECTIONS` (33→32) and `COLLECTION_TARGETS`
- `db/schema.sql` - `users` table removed; header comment updated (now demo+deal schema, not ma-portal.db's)
- `server.js` - consolidated gate rewrite, `DEMO_ONLY_PREFIXES`, cutover of login/settings/api-key reads, startup opens control/runtime/demo
- `scripts/set-admin-password.js` - rotates through `db/controlStore.js`, not `readDb()`/`writeDb()`
- `test/deal-resolver.test.js` - NEW: 8 cases (7 required + an export-surface check)
- `test/deal-isolation.test.js` - NEW: 4 cases
- `test/demo-only-gating.test.js` - NEW: 5 cases
- `test/session-lifecycle.test.js`, `test/role-enforcement.test.js`, `test/migration-roundtrip.test.js`, `test/db-split-migration.test.js` - updated for the sessions.deal_id column and `users` leaving the request-bound inventory
- `data/ma-portal.db` - chmod 444 (no git diff — permission bits aren't git-tracked beyond the executable bit)

## Decisions Made
- The consolidated `/api` gate is one function; login's account lookup and the resolver's binding logic live inside the SAME code path. Splitting server.js's diff cleanly across Tasks 1/2/3's commits would have required either leaving the app non-booting at an intermediate commit, or manually reverting/reapplying hunks with real regression risk for zero behavioral benefit — the full server.js diff landed in Task 1's commit instead, with Tasks 2 and 3 each contributing their own distinct remaining files. Documented here rather than silently deviating from the plan's 3-commit structure.
- `/api/auth/me` stays on `PUBLIC_API_PATHS` (bypasses the resolver, as it always has) and resolves its own session inline, applying an equivalent of the D-03 open-mode rule locally rather than routing this one public, resolver-free endpoint through the full gate machinery.
- `DEAL_SEED_COLLECTIONS` (checklistTemplates/assessmentTemplates/processCatalog) are the proven, deliberate exception to the "two deals share no rows" isolation criterion — both inherit identical template ids from demo.db by design (D-06); `test/deal-isolation.test.js` asserts this positively instead of silently excluding it from the isolation loop.
- `scripts/set-admin-password.js`'s prior `opts.dbPath` test-only override is retired in favor of the `MA_CONTROL_DB_PATH`/`MA_RUNTIME_DB_PATH` env vars, matching the codebase-wide override convention `db/dbFiles.js` now establishes — no existing test used the old parameter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking regression] `db/collections.js` dropping `users` from `ARRAY_COLLECTIONS` broke three pre-existing test files that assumed the old shape**
- **Found during:** Task 2 acceptance-criteria verification (`npm test` regression run)
- **Issue:** `test/session-lifecycle.test.js` opened its temp connection against the demo/deal schema (`db/schema.sql`), which lost the `sessions` table's role once `db/sessions.js`'s `findSession()` started unconditionally selecting `deal_id` (a runtime-schema.sql-only column) — every case failed with `no such column: deal_id`. `test/role-enforcement.test.js` monkey-patched `store.initDb` to intercept server.js's bare `initDb()` call, a mechanism this plan's own gate rewrite retires (server.js now always opens three explicit files). `test/db-split-migration.test.js` built its synthetic source database against `db/schema.sql` and asserted `users` rows route to `control.db` via the split — both premises this plan retires (accounts are no longer in `ARRAY_COLLECTIONS` at all, so the split never touches them).
- **Fix:** `test/session-lifecycle.test.js` now opens against `runtime-schema.sql` directly via `store.getOrOpenConnection()`. `test/role-enforcement.test.js` was rewritten to boot the real app against an isolated temp control/runtime/demo trio via the new `MA_*_PATH` env overrides, seeding real accounts directly from `db.json`'s `users` array (since neither the migration nor the split script touches accounts anymore). `test/db-split-migration.test.js`'s synthetic-source builder no longer inserts `users` rows (the table doesn't exist in `db/schema.sql` post-cutover); its "users route to control.db" case was replaced with a proof that NO array collection routes to control.db anymore, and its corrupted-output-gate case now corrupts a `demo.db` `employees` row instead of a `control.db` `users` row.
- **Files modified:** `test/session-lifecycle.test.js`, `test/role-enforcement.test.js`, `test/db-split-migration.test.js`
- **Verification:** `npm test` — all three files green, 72/72 total.
- **Committed in:** `333da21` (session-lifecycle, role-enforcement) and `c1d8067` (db-split-migration)

**2. [Rule 1 - documentation correction] `test/migration-roundtrip.test.js`'s hardcoded "38 collections" assertion**
- **Found during:** Task 2 regression verification
- **Issue:** The test asserted `ARRAY_COLLECTIONS.length + SINGLETON_KEYS.length === 38` — true before this plan, false (37) after `users` left `ARRAY_COLLECTIONS` by design.
- **Fix:** Updated the assertion to 37 and its header/inline comments to explain the count is now 37 of db.json's 38 keys BY DESIGN (accounts moved to control.db), not a coverage gap.
- **Files modified:** `test/migration-roundtrip.test.js`
- **Verification:** `npm test` — green.
- **Committed in:** `c1d8067`

**3. [Documentation note, not a bug] `grep -c "app.use('/api'" server.js` transiently returned 2, not 1**
- **Found during:** Task 1 acceptance-criteria verification
- **Issue:** The gate's own inline comment quoted the literal string `app.use('/api', ...)` while explaining `req.path`'s mount-relative behavior — a grep for the registration string matched both the real registration and its own comment.
- **Fix:** Reworded the comment to describe "the consolidated /api gate above" instead of quoting the literal registration string. `grep -c "app.use('/api'" server.js` now returns exactly 1.
- **Files modified:** `server.js`
- **Verification:** `grep -c "app.use('/api'" server.js` → 1.
- **Committed in:** `333da21`

---

**Total deviations:** 3 code/test-file fixes required by the plan's own architectural change (`users` leaving the request-bound model), 1 cosmetic grep-count self-reference fixed inline. No scope creep beyond what Task 2's own action items already implied for the migration/split test fixtures.
**Impact on plan:** None on the delivered behavior — every ISO-01/02/03 acceptance criterion in the plan is met; the additional test-file updates were necessary to keep `npm test` green, which the plan's own acceptance criteria require.

## Issues Encountered
- An early `node -e` smoke test of `require('../server.js')` (run without the `MA_*_PATH` env overrides, to sanity-check the live module loads) opened the REAL `data/demo.db` and wrote WAL checkpoint metadata to it (same byte length, no logical row change). Restored via `git checkout -- data/demo.db` before any further work — a targeted single-file restore of a file this session itself had touched, not a blanket reset.
- `scripts/split-db-into-control-demo-deals.js`'s `runSplit()`/`readSourceModel()` iterate `ARRAY_COLLECTIONS` to decide what to copy — since `users` is no longer in that list, the split (and the Phase-1 `migrate-db-json-to-sqlite.js` before it) can no longer move account rows at all. This only matters for FRESH test fixtures (the real, already-committed `data/control.db` was populated correctly back in Plan 02, before this change, and needs no re-seeding); every new/updated test in this plan seeds `control.db`'s `users` table directly from `db.json`'s own array instead.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- Plan 04 (deal creation/switcher UI, `/api/deals` routes) can now build directly on `db/resolver.js`'s `CONTROL_PLANE_PATHS` escape hatch and `db/controlStore.js`'s `getDeal`/`listDealsForUser`/`isDealMember` — no resolver changes needed, only new routes gated by `ROLE_WRITE_POLICY`'s existing `{ prefix, roles }` shape (D-02: admin+hrbp create, admin-only delete/archive) and `db/sessions.js`'s new `bindSessionDeal()` for the actual "select a deal" action.
- Plan 05 (audit hook, D-09 location) can build on `db/store.js`'s `readDb()`'s `__dbContext` non-enumerable stamp (kind/dealId/dbPath) and `writeDb()`'s existing snapshot-diff — both already expose everything the store-layer audit hook (03-RESEARCH.md Pattern 3) needs without a second AsyncLocalStorage lookup.
- No blockers.

---
*Phase: 03-deal-isolation-audit-log-write-validation*
*Completed: 2026-08-01*

## Self-Check: PASSED

All created files verified present on disk; all commit hashes (`333da21`, `c1d8067`, `c82a827`) verified present in `git log --oneline --all`.
