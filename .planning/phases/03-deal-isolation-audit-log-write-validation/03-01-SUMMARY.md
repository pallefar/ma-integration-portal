---
phase: 03-deal-isolation-audit-log-write-validation
plan: 01
subsystem: database
tags: [sqlite, zod, better-sqlite3, gitignore, package-legitimacy-gate, audit-log]

# Dependency graph
requires:
  - phase: 01-schema-migration
    provides: db/store.js's initDb() pragma contract (WAL/NORMAL/foreign_keys/busy_timeout) and db/schema.sql's blob-per-row table shape, both reproduced here for the four new database kinds
provides:
  - "db/dbFiles.js: single source of truth for CONTROL_DB_PATH, RUNTIME_DB_PATH, AUDIT_DB_PATH, DEMO_DB_PATH, DEALS_DIR, dealDbPath(dealId), openDbFile(path, schemaPath)"
  - "db/control-schema.sql, db/runtime-schema.sql, db/audit-schema.sql — the three new SQLite schemas"
  - "zod@4.4.3 pinned and committed into node_modules (zero-install preserved)"
  - "git + admin download-zip exclusion of data/runtime.db*, data/audit.db*, data/deals/ before any of those files can exist"
affects: [03-02, 03-03, 03-04, 03-05, 03-06]

# Actuals (#2632)
actuals:
  tokens: 5950
  tasks: 3
  commits: 2

# Tech tracking
tech-stack:
  added: ["zod@4.4.3 (pinned, committed to node_modules)"]
  patterns:
    - "Centralized DB path module (db/dbFiles.js) — every later Phase 3 consumer imports paths from here, never re-derives a path string"
    - "openDbFile(path, schemaPath) generalizes db/store.js's initDb() pragma contract to N files instead of one"
    - "Append-only-by-construction via BEFORE UPDATE/DELETE triggers that RAISE(ABORT), not application-level convention"
    - "Blob-per-row + extracted metadata column (status) for the deals table, matching the existing project_id precedent"

key-files:
  created:
    - db/dbFiles.js
    - db/control-schema.sql
    - db/runtime-schema.sql
    - db/audit-schema.sql
    - test/db-file-layout.test.js
    - test/db-artifact-exclusion.test.js
  modified:
    - package.json
    - package-lock.json
    - .gitignore
    - server.js

key-decisions:
  - "zod approved through the blocking-human Package Legitimacy Gate (colinhacks/zod, 986M downloads/month, no postinstall script, MIT, 4.4.3 = latest) — approved by user via orchestrator, 2026-08-01"
  - "npm install produced a caret range (^4.4.3); pinned flat to match the better-sqlite3 precedent per the plan's explicit instruction"
  - "deals table gets an extra status metadata column (beyond the standard id/project_id/seq/data blob-per-row shape) so admin/IL deal-list filtering doesn't require deserializing every row"
  - "Secret-bearing settings (geminiApiKey, databaseConfig.connectionDetails) placed in runtime.db's app_state rather than the committed control.db, since a secret in a gitignored file was never at risk while one committed to control.db could never be un-leaked from git history"

patterns-established:
  - "Tracer-task feedback gate: Task 3 (type=tracer) was committed then held for an explicit human-verify checkpoint before the plan closed, proving the end-to-end storage slice before Plans 02-06 build on it"

requirements-completed: [ISO-01, AUD-02, VAL-01]

coverage:
  - id: D1
    description: "zod@4.4.3 installed, pinned flat in package.json, committed into node_modules — zero-install preserved"
    requirement: VAL-01
    verification:
      - kind: unit
        ref: "command: node -e \"const {z}=require('zod'); z.object({a:z.string()}).parse({a:'x'})\""
        status: pass
      - kind: other
        ref: "command: grep -c '\"zod\"' package.json (== 1, flat pin, no ^/~)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Real-deal, audit and session database file families excluded from git AND the admin download-zip export before any of those files can exist"
    requirement: ISO-01
    verification:
      - kind: unit
        ref: "test/db-artifact-exclusion.test.js#db-artifact-exclusion: .gitignore excludes data/runtime.db*, data/audit.db*, data/deals/"
        status: pass
      - kind: unit
        ref: "test/db-artifact-exclusion.test.js#db-artifact-exclusion: admin download-zip export excludes the same three families"
        status: pass
    human_judgment: false
  - id: D3
    description: "db/dbFiles.js centralizes all four new database paths and opens each with the Phase-1 pragma contract (WAL/NORMAL/foreign_keys/busy_timeout), idempotently"
    requirement: ISO-01
    verification:
      - kind: unit
        ref: "test/db-file-layout.test.js#db-file-layout: all four db kinds open with the Phase-1 pragma contract"
        status: pass
      - kind: unit
        ref: "test/db-file-layout.test.js#db-file-layout: openDbFile() is idempotent"
        status: pass
      - kind: unit
        ref: "test/db-file-layout.test.js#db-file-layout: db/dbFiles.js exports every documented symbol"
        status: pass
    human_judgment: false
  - id: D4
    description: "control.db's deals table round-trips a row (including its members[] allowlist) through the blob-per-row + status metadata shape"
    verification:
      - kind: unit
        ref: "test/db-file-layout.test.js#db-file-layout: a deals row round-trips through control.db with its members array intact"
        status: pass
    human_judgment: false
  - id: D5
    description: "audit_log rows are append-only by construction — UPDATE and DELETE both rejected via BEFORE triggers, row survives unchanged"
    requirement: AUD-02
    verification:
      - kind: unit
        ref: "test/db-file-layout.test.js#db-file-layout: audit_log rows cannot be UPDATEd or DELETEd (append-only by construction, AUD-02)"
        status: pass
    human_judgment: false
  - id: D6
    description: "dealDbPath() rejects path-traversal / malformed deal ids before they reach the filesystem"
    verification:
      - kind: unit
        ref: "test/db-file-layout.test.js#db-file-layout: dealDbPath() builds the expected path and rejects path-traversal / malformed ids"
        status: pass
    human_judgment: false
  - id: D7
    description: "No regression to the existing Phase 1/2 test suite"
    verification:
      - kind: unit
        ref: "npm test (bare node --test, all 8 files)"
        status: pass
    human_judgment: false

duration: 17min
completed: 2026-08-01
status: complete
---

# Phase 3 Plan 01: Zod Legitimacy Gate + DB Leak Pre-emption + Control/Runtime/Audit Schemas Summary

**Pinned zod@4.4.3 install, git+download-zip exclusion of runtime/audit/deal database families, and a centralized db/dbFiles.js opening three new append-only-capable SQLite schemas (control, runtime, audit) under the Phase-1 pragma contract**

## Performance

- **Duration:** 17 min
- **Started:** 2026-08-01T06:37:45Z
- **Completed:** 2026-08-01T06:54:16Z
- **Tasks:** 3 (1 checkpoint + 2 auto/tracer)
- **Files modified:** 10 (6 created, 4 modified, excluding vendored node_modules/zod/)

## Accomplishments
- Cleared the blocking-human Package Legitimacy Gate for zod (the one new runtime dependency this phase introduces) and installed it pinned flat at 4.4.3, committed into node_modules for zero-install
- Pre-empted the real-deal/audit/session database leak (T-03-01) by extending both `.gitignore` and the admin download-zip `-x` exclusion list with `data/runtime.db*`, `data/audit.db*`, `data/deals/` — landed before Plan 02 can create any of those files
- Built `db/dbFiles.js`, the single source of truth for all four new database paths and the shared `openDbFile()` open/pragma/schema contract, reproducing db/store.js's exact WAL/NORMAL/foreign_keys/busy_timeout pragma set
- Authored the three new schemas: `control-schema.sql` (users + deals + app_state, committed/near-static), `runtime-schema.sql` (sessions + deal_id column + app_state, gitignored/churning), `audit-schema.sql` (append-only audit_log with RAISE(ABORT) triggers, gitignored)
- Proved append-only-by-construction: an UPDATE and a DELETE against an `audit_log` row both raise and leave the row unchanged
- Full regression suite stayed green throughout: 32 → 34 → 40 tests, 0 failures at every step

## Task Commits

Each task was committed atomically:

1. **Task 1: Confirm zod package legitimacy before install** — checkpoint, no commit (approved by user via orchestrator, 2026-08-01)
2. **Task 2: Install and pin zod; pre-empt runtime/audit/deal database leaks** - `9fda4b5` (feat)
3. **Task 3: db/dbFiles.js + control/runtime/audit schemas (tracer)** - `2b3ea4a` (feat)

**Plan metadata:** (final docs commit follows this summary)

## Files Created/Modified
- `db/dbFiles.js` - Centralized path constants + `dealDbPath()` + `openDbFile()` for the four new database kinds
- `db/control-schema.sql` - `users` (verbatim) + `deals` (blob-per-row + status metadata column) + `app_state` (controlSettings), committed/near-static
- `db/runtime-schema.sql` - `sessions` (verbatim + new nullable `deal_id`) + `app_state` (secretSettings), gitignored/churning
- `db/audit-schema.sql` - Explicit-column `audit_log` + `audit_log_no_update`/`audit_log_no_delete` BEFORE triggers, gitignored
- `test/db-file-layout.test.js` - 6 cases: pragma contract x4 kinds, idempotent re-open, deals round-trip, audit append-only proof, path-traversal rejection, export inventory
- `test/db-artifact-exclusion.test.js` - 2 cases: `.gitignore` and download-zip exclusion lists both closed
- `package.json`, `package-lock.json` - zod@4.4.3 pinned flat dependency
- `.gitignore` - new section excluding `data/runtime.db*`, `data/audit.db*`, `data/deals/`
- `server.js` - download-zip `-x` list extended with the same three families + `[security]` comment explaining why the flat `data/*.db` pattern doesn't cover them

## Decisions Made
- zod cleared the Package Legitimacy Gate on registry facts (colinhacks/zod, 986,681,084 downloads/month, no postinstall script, MIT license, 4.4.3 = current `latest`) — approved by the user via the orchestrator, recorded 2026-08-01
- `npm install zod@4.4.3` wrote a caret range (`^4.4.3`) into package.json by default; pinned it flat to `4.4.3` per the plan's explicit instruction to match the `better-sqlite3` precedent
- `deals` table carries an extra `status` metadata column beyond the standard blob-per-row shape (id/project_id/seq/data), since deal-list filtering by status is expected to be far more frequent than writes — mirrors the existing `project_id` extraction rationale
- Secret-bearing settings fields (`geminiApiKey`, `databaseConfig.connectionDetails`) placed in the gitignored `runtime.db`'s `app_state` rather than the committed `control.db` — a secret in a gitignored file was never at risk, whereas one committed to `control.db` could never be un-leaked from git history once pushed

## Deviations from Plan

None requiring a code change — one documented acceptance-criterion discrepancy, already anticipated by the plan itself:

**1. [Documentation note, not a bug] `grep -c "audit_log" db/schema.sql` returns 1, not 0**
- **Found during:** Task 3 acceptance-criteria verification
- **Issue:** The plan's acceptance criteria asserts `grep -c "audit_log" db/schema.sql` is `0`. `db/schema.sql`'s own Phase-1 reservation comment ("do NOT add an audit_log table here") contains the literal substring `audit_log`, so the raw grep count is `1`.
- **Fix:** None applied. No `audit_log` TABLE is defined anywhere in `db/schema.sql` (verified separately with `grep -n "CREATE TABLE.*audit" db/schema.sql`, zero matches) — the table lives entirely in the new `db/audit-schema.sql`, honoring the reservation comment's actual intent. The plan's own acceptance-criteria line carries a `<!-- planner-discipline-allow: audit_log -->` annotation anticipating exactly this self-reference.
- **Files modified:** None — the reservation comment was left untouched, preserving its documentation value per this codebase's "explain WHY" comment convention.
- **Verification:** `grep -n "CREATE TABLE.*audit" db/schema.sql` — zero matches, confirming no table definition exists in that file.
- **Committed in:** N/A (no code change)

---

**Total deviations:** 0 code changes; 1 documented/accepted acceptance-criterion discrepancy (anticipated by the plan's own annotation).
**Impact on plan:** None. No scope creep, no functional gap.

## Issues Encountered
- Initial `assert.throws(..., /abort|RAISE/i, ...)` regex in `test/db-file-layout.test.js` didn't match better-sqlite3's thrown error, whose `.message` is exactly the custom `RAISE(ABORT, '<message>')` text with no literal "abort"/"RAISE" substring — fixed by matching `/append-only/i` against the actual custom message instead. Caught and fixed before the task commit; not a deviation from the plan, just a test-authoring correction.
- `data/ma-portal.db` (the live demo database) showed as dirty in `git status` during this session from an unrelated, pre-existing live admin session row (created 2026-07-31, from prior Phase 2 UAT testing) — not touched by this plan's work, left out of every commit per the orchestrator's explicit instruction.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 02 (deal-resolver middleware, session `deal_id` binding, `db/store.js` ALS/audit-hook extension) can now safely open `control.db`/`runtime.db`/`audit.db` through `db/dbFiles.js` and rely on both leak-prevention lists already being closed.
- Plan 05 (D-09 audit location checkpoint) inherits the `audit.db` schema and append-only guarantee already proven here.
- No blockers. The three schemas intentionally leave connection caching, the deal-resolver, and the audit-capture hook itself to Plan 02/03 per 03-CONTEXT.md's discretion items — nothing in this plan pre-empted that scope.

---
*Phase: 03-deal-isolation-audit-log-write-validation*
*Completed: 2026-08-01*
