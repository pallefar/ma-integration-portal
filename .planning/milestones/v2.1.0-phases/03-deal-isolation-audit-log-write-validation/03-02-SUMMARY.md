---
phase: 03-deal-isolation-audit-log-write-validation
plan: 02
subsystem: database
tags: [sqlite, better-sqlite3, migration, data-isolation, mnpi]

# Dependency graph
requires:
  - phase: 03-deal-isolation-audit-log-write-validation
    provides: "03-01: db/dbFiles.js path constants + openDbFile(), control-schema.sql/runtime-schema.sql/audit-schema.sql, zod approved and pinned"
provides:
  - "db/collections.js: COLLECTION_TARGETS (per-collection control|demo|runtime routing map) + SECRET_SETTINGS_FIELDS, load-time completeness-asserted"
  - "scripts/split-db-into-control-demo-deals.js: runSplit()/verifySplit(), the re-runnable, crash-safe, --verify-gated one-way physical split of ma-portal.db into control.db/demo.db/runtime.db"
  - "data/control.db, data/demo.db (committed, D-07) and data/runtime.db (gitignored) — real generated split outputs, verify-green"
  - "db/dealSeed.js: DEAL_SEED_COLLECTIONS + createDealDatabase(dealId, {...}) — template-only, demo-free deal database seeder"
affects: [03-03, 03-04, 03-05, 03-06]

# Actuals (#2632)
actuals:
  tokens: 11413
  tasks: 3
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fan-out migration variant: build N outputs at temp paths, run the --verify union-parity gate against the TEMP paths BEFORE any rename, only finalize on green — extends scripts/migrate-db-json-to-sqlite.js's 1-to-1 temp+rename pattern to a 1-to-N split"
    - "Allowlist-direction template copy (db/dealSeed.js) instead of a denylist over the full collection inventory — stays correct as later phases add new collections without code changes"
    - "Dotted-path secret-field extraction/merge (splitSecretFields/mergeSecretFields) for lifting nested settings fields out of a committed store into a gitignored one"

key-files:
  created:
    - scripts/split-db-into-control-demo-deals.js
    - db/dealSeed.js
    - test/db-split-migration.test.js
    - test/deal-seed.test.js
    - data/control.db
    - data/demo.db
  modified:
    - db/collections.js

key-decisions:
  - "D-05 checkpoint (Task 1): approve-as-specified — control/demo/runtime classification as planned, and ISO-03 retires only the flag+shadow-array real-vs-demo switch; the demo's own Projects/Custom-M&A showcase switching survives inside demo.db as a maintained demonstration feature (approved by user via orchestrator, 2026-08-01)"
  - "Tracer feedback gate (Task 2): after committing the physical split, the executor stopped for an explicit human-verify checkpoint on the real, already-run split before proceeding to Task 3's expansion work — confirmed by user via orchestrator, 2026-08-01"
  - "controlSettings written as an empty placeholder object into control.db's app_state — no such singleton exists pre-split in ma-portal.db; the row is created now so later phases can read/update it without a schema-presence check"
  - "Secret-field extraction is dotted-path-aware but shallow (no array-index support), matching SECRET_SETTINGS_FIELDS's own shape (geminiApiKey, databaseConfig.connectionDetails) — sufficient for the two fields this phase defines, not a general JSONPath implementation"

patterns-established:
  - "verifyModel()'s duplication check queries every non-assigned output for the same table name and treats a non-zero count as a failure when the table happens to exist there (demo/deal schema defines all 33 tables) — a reusable shape if a future split ever adds a fourth target"

requirements-completed: [ISO-01, ISO-02]

coverage:
  - id: D1
    description: "COLLECTION_TARGETS routes every one of the 33 array collections and 5 singleton keys to exactly one of control|demo|runtime, load-time completeness-asserted"
    requirement: ISO-01
    verification:
      - kind: unit
        ref: "command: node -e \"const c=require('./db/collections.js'); const miss=[...c.ARRAY_COLLECTIONS,...c.SINGLETON_KEYS].filter(k=>!c.COLLECTION_TARGETS[k]); if(miss.length) throw new Error('unclassified: '+miss)\" (exit 0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "scripts/split-db-into-control-demo-deals.js splits ma-portal.db into control.db/demo.db/runtime.db with union parity, crash-safe temp+rename, and a hard --verify gate before any rename"
    requirement: ISO-01
    verification:
      - kind: unit
        ref: "test/db-split-migration.test.js#db-split-migration (8 subtests: outputs exist, union round-trip, users isolation, custom* routing, secret-field relocation, idempotence, corrupted-output gate failure, source immutability)"
        status: pass
      - kind: other
        ref: "command: node scripts/split-db-into-control-demo-deals.js --source data/ma-portal.db --out data (real run against the live store, then --verify exits 0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The source database (data/ma-portal.db) is never modified by the split — opened readonly:true/fileMustExist:true, byte length and mtime unchanged after every run"
    verification:
      - kind: unit
        ref: "test/db-split-migration.test.js#db-split-migration (h) the source file mtime and byte length are unchanged after every run"
        status: pass
      - kind: other
        ref: "command: md5sum data/ma-portal.db before/after the real run — identical"
        status: pass
    human_judgment: false
  - id: D4
    description: "The two secret-bearing settings fields (geminiApiKey, databaseConfig.connectionDetails) never reach the committed control.db or demo.db, and are present in runtime.db's secretSettings"
    requirement: ISO-01
    verification:
      - kind: unit
        ref: "test/db-split-migration.test.js#db-split-migration (e) secret fields are absent from control.db and demo.db, present in runtime.db secretSettings"
        status: pass
    human_judgment: false
  - id: D5
    description: "createDealDatabase() seeds a new deal with only checklistTemplates/assessmentTemplates/processCatalog + i18n, and a fresh identity-only settings singleton; every other collection in the full inventory is provably empty"
    requirement: ISO-02
    verification:
      - kind: unit
        ref: "test/deal-seed.test.js#deal-seed (a)-(d): row-count parity, i18n presence, full-inventory emptiness (iterates ARRAY_COLLECTIONS programmatically), settings isolation from source settings keys"
        status: pass
    human_judgment: false
  - id: D6
    description: "createDealDatabase() refuses to overwrite an existing deal database file"
    verification:
      - kind: unit
        ref: "test/deal-seed.test.js#deal-seed (e) a second createDealDatabase() call for the same id throws and leaves the file byte-identical"
        status: pass
    human_judgment: false
  - id: D7
    description: "No regression to the existing test suite; app still reads data/ma-portal.db unchanged (no cutover in this plan)"
    verification:
      - kind: unit
        ref: "npm test (bare node --test, all 12 files)"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-08-01
status: complete
---

# Phase 3 Plan 02: Physical Control/Demo/Runtime Split + Template-Only Deal Seeder Summary

**One-way, verify-gated split of the live SQLite store into control.db/demo.db/runtime.db (control.db + demo.db committed per D-07), plus db/dealSeed.js's allowlist-direction template-only deal database seeder**

## Performance

- **Duration:** 35 min (including two human checkpoints: the D-05 decision gate and the post-tracer feedback gate)
- **Started:** 2026-08-01T06:56:02Z
- **Completed:** 2026-08-01T07:30:49Z
- **Tasks:** 3 (1 checkpoint:decision + 1 tracer + 1 auto)
- **Files modified:** 7 (6 created, 1 modified, excluding node_modules)

## Accomplishments
- Cleared the blocking D-05 one-way reversibility gate: control/demo/runtime classification approved as specified, and the ISO-03 flag+shadow-array mechanism confirmed retired only as the real-vs-demo switch — the demo's own Projects/Custom-M&A showcase switching survives inside demo.db
- Built `db/collections.js`'s `COLLECTION_TARGETS` — the single source of truth routing all 33 array collections + 5 singletons to control/demo/runtime, with a load-time completeness assertion in the same style as the existing two
- Built `scripts/split-db-into-control-demo-deals.js`, a fan-out variant of the Phase-1 migration script: builds control.db/demo.db/runtime.db at temp paths, runs a hard union-parity `--verify` gate against the temp files BEFORE any rename, and only finalizes on green — crash-safe and re-runnable
- Ran the split for real against the live `data/ma-portal.db`, producing committed `data/control.db` + `data/demo.db` (D-07) and gitignored `data/runtime.db`; confirmed the source file's byte length and mtime are unchanged
- Built `db/dealSeed.js`'s `createDealDatabase()` — an allowlist-direction (not denylist) copy of exactly three template collections + i18n + a fresh identity-only settings singleton, proven demo-free across the FULL 33-collection inventory, not a hand-picked subset
- Full regression suite stayed green throughout: 40 → 49 → 55 tests, 0 failures at every step

## Task Commits

Each task was committed atomically:

1. **Task 1: Confirm the one-way store split before it runs (D-05 reversibility gate)** — checkpoint, no commit (approved `approve-as-specified` by user via orchestrator, 2026-08-01)
2. **Task 2: COLLECTION_TARGETS + the fan-out split script with a --verify union-parity gate (tracer)** - `9a6fb8d` (feat) — held for a post-tracer human-verify checkpoint on the real split output before Task 3, confirmed by user via orchestrator
3. **Task 3: db/dealSeed.js — template-only deal databases with zero demo-derived rows** - `5b7cfb8` (feat)

**Plan metadata:** (final docs commit follows this summary)

## Files Created/Modified
- `db/collections.js` - New `COLLECTION_TARGETS` (control|demo|runtime per collection/singleton) + `SECRET_SETTINGS_FIELDS`, completeness-asserted at load time
- `scripts/split-db-into-control-demo-deals.js` - `runSplit()`/`verifySplit()`, CLI `--source`/`--out`/`--verify`; fans out to 3 temp-then-rename outputs with a pre-rename parity gate
- `db/dealSeed.js` - `DEAL_SEED_COLLECTIONS` + `createDealDatabase(dealId, { name, targetCompany, templateSourcePath })`
- `test/db-split-migration.test.js` - 8 cases: outputs exist, union round-trip, users isolation, custom* routing, secret-field relocation, idempotence, corrupted-output gate failure, source immutability
- `test/deal-seed.test.js` - 5 cases: template row-count parity, i18n presence, full-inventory emptiness, settings isolation, overwrite-refusal with byte-identical proof
- `data/control.db`, `data/demo.db` - Real generated split outputs (committed per D-07); `data/runtime.db` generated but gitignored (Plan 03-01's exclusion)

## Decisions Made
- D-05 checkpoint resolved as `approve-as-specified`: the planned control/demo/runtime classification stands, and ISO-03's retirement scope is confirmed to be the real-vs-demo switch only — the demo's internal Projects/Custom-M&A lane-switching feature keeps working inside demo.db as a showcase feature, per the project's "demonstration showcase must survive intact" constraint
- Tracer feedback gate: after physically splitting the live store (a one-way, high-stakes operation), the executor stopped for an explicit human-verify checkpoint before building Task 3 on top of it, rather than silently continuing — confirmed by the user via the orchestrator with independent re-verification (re-ran `--verify`, confirmed git tracking of control.db/demo.db vs. untracked runtime.db, grepped for secret values, re-ran the full suite)
- `controlSettings` is written as an empty placeholder object — no such singleton exists in the pre-split `ma-portal.db`; the app_state row is created now so later phases can read/write it without a presence check
- Secret-field extraction (`splitSecretFields`/`mergeSecretFields`) supports dotted nested paths but not array indices — sufficient for `SECRET_SETTINGS_FIELDS`'s current two entries, not a general JSONPath implementation

## Deviations from Plan

None - plan executed exactly as written (both checkpoints resolved as the plan's primary recommended option; no auto-fixes were needed during either task).

## Issues Encountered

- An early version of the `db-split-migration.test.js` (e) assertion incorrectly expected `demo.db`'s copied `settings.databaseConfig` to be entirely `undefined` after secret extraction; the actual (correct) behavior is that only the `connectionDetails` leaf is deep-deleted, while a sibling non-secret field (`poolSize`) on the same nested object correctly survives. Caught and fixed in the test before the task commit — not a deviation from the plan, a test-authoring correction.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 03 (deal-resolver middleware, session `deal_id` binding, `db/store.js` ALS/audit-hook extension) can now bind a session to `data/deals/<id>.db` via `db/dealSeed.js`'s `createDealDatabase()`, and route reads/writes through `db/dbFiles.js`'s already-established `openDbFile()` contract for control/demo/runtime.
- `COLLECTION_TARGETS` is the routing table the resolver will consult when it needs to know which physical file a given collection lives in (control vs. demo vs. a per-deal file).
- `data/ma-portal.db` still exists, unmodified, and the app still reads it exclusively — this plan produced the split outputs but did NOT cut the app over. That cutover is explicitly Plan 03's job, per this plan's own objective boundary.
- No blockers.

---
*Phase: 03-deal-isolation-audit-log-write-validation*
*Completed: 2026-08-01*

## Self-Check: PASSED

All created files verified present on disk; commit hashes `9a6fb8d` and `5b7cfb8` verified present in `git log --oneline --all`.
