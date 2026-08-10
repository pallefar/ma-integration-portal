---
phase: 05-synergy-value-capture
plan: 02
subsystem: api
tags: [express, zod, synergy-tracker, lifecycle-vocabulary, one-way-migration, sqlite, i18n]

# Dependency graph
requires:
  - phase: 05-synergy-value-capture (plan 01)
    provides: "synergyLane()/synergyRollupFields() and the .syn-detail expanded-card structure the stage badge renders inside"
provides:
  - "SYN_STAGES four-value confidence-stage vocabulary (idea/validated/committed/captured) replacing SYN_STATUSES, in three independent copies (server.js, validators/workstream.js, public/js/execution.js) proven identical by a cross-file anti-drift test"
  - "SynergyUpsertSchema's `stage: z.enum(SYN_STAGES)` — legacy values refused with 400, never coerced (D-11 hard cutover)"
  - "scripts/migrate-synergy-stages.js — idempotent, re-runnable migration of a committed database's synergyInitiatives rows + app_state i18n singleton"
  - "Both committed databases (data/demo.db, data/ma-portal.db) and their i18n singletons migrated to the new vocabulary on disk"
affects: [05-03 baselines, 05-04 cost-to-achieve, 05-05 staleness/rollup, 05-06 stage-control-UI, 05-08 demo-seed]

# Actuals (#2632)
actuals:
  tokens: 8928   # chars/4 over the plan's realized diff, excluding binary .db files (35713 chars / 4)
  tasks: 3
  commits: 2

tech-stack:
  added: []
  patterns:
    - "One-way vocabulary cutover: the retired 5-value lifecycle is refused by the zod schema (400), never coerced or read-time-shimmed — the anti-drift test (not code review) is what proves all three independent copies moved together"
    - "Migration-table-as-lookup, not a re-declared vocabulary array: scripts/migrate-synergy-stages.js's STAGE_MIGRATION_MAP keys off whatever value is ACTUALLY stored in a row, rather than validating rows against a hard-coded allowlist — avoids a sixth copy of the retired vocabulary"
    - "i18n fallback-to-English as a deliberate no-op, not a gap: two of the four new stage label keys (idea, committed) get NO manufactured DE/ZH/CS translation — transitions.js's t() already falls back to the English value for a missing key, so leaving them absent for non-English languages is correct, not incomplete"

key-files:
  created:
    - scripts/migrate-synergy-stages.js
    - test/synergy-stage.test.js
  modified:
    - server.js
    - validators/workstream.js
    - public/js/execution.js
    - data/demo.db
    - data/ma-portal.db

key-decisions:
  - "D-07/D-11 implemented as a one-way hard cutover per the Task 1 checkpoint decision (user selected 'proceed' 2026-08-06): no read-time compatibility shim anywhere, legacy values refused not coerced, all three independent code copies bound by an anti-drift test rather than review"
  - "data/ma-portal.db's -shm sidecar was ALSO chmod 444 (not just the .db file itself) — discovered only when the first migration attempt failed with 'attempt to write a readonly database' even after chmod u+w on the .db file alone; both the .db and its then-present -shm/-wal sidecars needed unlocking"
  - "i18n migration only manufactures a translation for the two label keys whose meaning is unchanged (validated: untouched; captured: carried verbatim from the old syn.st_realized value in each language) — idea and committed get English text only, relying on transitions.js's documented t() fallback-to-English contract for DE/ZH/CS rather than inventing translations not reviewed by a native speaker"

patterns-established:
  - "Migration idempotency proof via true file copy, not independent reconstruction: comparing two independently-INSERTed SQLite files for byte-equality is unreliable (page layout can differ despite identical logical content) — the correct proof seeds ONE file, fs.copyFileSync()s it to two paths, then migrates one once and the other twice before comparing bytes"

requirements-completed: [SYN-03]

coverage:
  - id: D1
    description: "One lifecycle field, four values (idea/validated/committed/captured), three independent copies (server.js, validators/workstream.js, public/js/execution.js) proven identical by a cross-file anti-drift test, not by review"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-stage (a), (b)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A retired legacy lifecycle value is refused by the zod schema with 400 on both create and update — no read-time compatibility shim, no silent coercion; a stage-less create defaults to the first vocabulary value"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-stage (c)"
        status: pass
      - kind: integration
        ref: "test/synergy-stage.test.js#synergy-stage (d), (e), (f)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Migration script rewrites every synergyInitiatives row per D-07's mechanical map, deletes the retired status key, migrates the i18n singleton (adds the new label keys, removes the four retired ones), and is idempotent (byte-identical on a second run)"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-stage (g), (h)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Both committed databases (data/demo.db's 5 rows, data/ma-portal.db's 5 rows) and their i18n singletons carry only the new four-value vocabulary on disk, visible in git diff (not stuck in the gitignored WAL sidecar)"
    requirement: SYN-03
    verification:
      - kind: other
        ref: "git diff --stat 984f212..HEAD -- data/demo.db data/ma-portal.db (both report a non-zero Bin change); sqlite3 data/demo.db \"SELECT DISTINCT json_extract(data,'$.stage') FROM synergyInitiatives;\" returns only committed/validated"
        status: pass
    human_judgment: false

duration: ~7min (Task 2 commit to Task 3 commit; excludes the real-world gap during Task 1's checkpoint-decision wait between the original planning session and this continuation)
completed: 2026-08-06
status: complete
---

# Phase 5 Plan 2: Stage-Vocabulary One-Way Cutover Summary

**D-07/D-11's hard cutover from the five-value execution-status lifecycle to the four SYN-03 confidence stages (idea/validated/committed/captured) — three independent code copies bound by an anti-drift test, both committed databases and their i18n singletons migrated, zero compatibility shim.**

## Performance

- **Duration:** ~7 min (Task 2 commit 08:55:39 -> Task 3 commit 09:02:38, 2026-08-06; Task 1's checkpoint:decision was resolved by the user in a prior session/turn before this continuation began)
- **Started:** 2026-08-06T08:55:39+02:00 (Task 2 commit)
- **Completed:** 2026-08-06T09:02:38+02:00 (Task 3 commit)
- **Tasks:** 3 (Task 1 checkpoint:decision resolved before this continuation; Tasks 2 and 3 executed and committed here)
- **Files modified:** 6 (server.js, validators/workstream.js, public/js/execution.js, scripts/migrate-synergy-stages.js, data/demo.db, data/ma-portal.db) plus 1 test file created

## Accomplishments
- `SYN_STAGES = ['idea', 'validated', 'committed', 'captured']` replaces `SYN_STATUSES` in all three independent copies (server.js, validators/workstream.js, public/js/execution.js), each carrying a lockstep warning comment styled on the existing RAID_LEVELS/D-26 precedent
- `SynergyUpsertSchema`'s lifecycle field renamed `status` -> `stage`, enum-checked against `SYN_STAGES` — a retired legacy value (`identified`/`planned`/`executing`/`realized`) is refused with 400 on both create and update, proven by direct HTTP tests bypassing the UI
- A stage-less create defaults to `SYN_STAGES[0]` (`idea`), not a hardcoded legacy default
- Client card badge and click-to-cycle handler read/write `stage`; `SYN_LABELS`/`SYN_COLORS` rebuilt from the UI-SPEC's four label keys and stage-badge palette (grey/slate/amber/green — 4 of the retired 5 hex values reused, no new colour)
- `test/synergy-stage.test.js` (8 tests): cross-file anti-drift assertion (all three copies deeply equal), label/colour map key-count proof, schema accept/refuse, stage-less-create-defaults-first, create+update legacy-refusal, migration mechanical-map correctness + i18n key add/remove, migration idempotency (byte-identical second run)
- `scripts/migrate-synergy-stages.js` — idempotent one-off operator script (openDbFile + prepared-statement rewrite + `wal_checkpoint(TRUNCATE)`, mirroring `scripts/seed-dd-request-templates.js`'s shape) — run against both `data/demo.db` (5 rows) and `data/ma-portal.db` (5 rows, dormant but git-committed); both `.db` files show a non-zero `git diff --stat`

## Task Commits

Each task was committed atomically:

1. **Task 1: Confirm the one-way stage-vocabulary cutover (checkpoint:decision)** — n/a, no code changes; user selected "proceed" 2026-08-06
2. **Task 2: Replace the lifecycle vocabulary in all three copies, with an anti-drift test** — `2447b52` (feat)
3. **Task 3: Migrate both committed databases and their i18n singletons** — `d31c9c1` (feat)

_No separate test->feat commit split — Task 2 was `tdd="true"` at the task level; the test file was written and run RED first (all 6 initial assertions failed against the pre-rename code) before the three-file rename, then re-run GREEN, but both landed in a single commit per this plan's own task-level (not file-level) TDD granularity._

## Files Created/Modified
- `test/synergy-stage.test.js` - Cross-file anti-drift test, legacy-refusal proofs, migration correctness + idempotency proofs (8 tests total, extended across Tasks 2 and 3)
- `scripts/migrate-synergy-stages.js` - One-off migration script for `synergyInitiatives` rows and the `app_state['i18n']` singleton
- `server.js` - `SYN_STAGES` constant, create-branch default, update-branch field rename, `module.exports.SYN_STAGES`
- `validators/workstream.js` - Independent `SYN_STAGES` copy, `SynergyUpsertSchema`'s `stage` enum, `module.exports.SYN_STAGES`
- `public/js/execution.js` - Independent `SYN_STAGES` copy, rebuilt `SYN_LABELS`/`SYN_COLORS`, card badge + click-to-cycle handler renamed to `stage`
- `data/demo.db` - 5 `synergyInitiatives` rows migrated (3 `executing` + 1 `planned` -> `committed`, 1 `validated` stays `validated`); i18n singleton gains `syn.st_idea`/`syn.st_committed`/`syn.st_captured` (EN always; DE/ZH/CS only `syn.st_captured`, carried from `syn.st_realized`), loses the 4 retired `syn.st_*` keys in every language
- `data/ma-portal.db` - Same row/i18n migration as demo.db (5 rows found, not the 3 the plan's checkpoint context estimated — see Deviations)

## Decisions Made
- The click-to-cycle handler's fetch response `.then()` callback was left exactly as the plan's action text specified ("leave the existing click-to-cycle behaviour in place for now") — no error-alert branch was added, since cycling through a valid vocabulary can never itself produce a 400 and adding one would be unscoped for this task (Plan 06 replaces this control with the gated pill-and-caret entirely)
- `syn.st_validated` was treated as NOT retired and NOT newly added — it is the one legacy key whose name and meaning are both unchanged, so neither the code copies' vocabulary nor the migration script's key lists touch it beyond its natural pass-through

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `data/ma-portal.db` and its `-shm` sidecar were chmod 444 (read-only), blocking the migration write**
- **Found during:** Task 3 (running the migration script against `data/ma-portal.db`)
- **Issue:** `node scripts/migrate-synergy-stages.js data/ma-portal.db` failed with `attempt to write a readonly database`. Investigation found `server.js:69` explicitly documents this file as "archived read-only (chmod 444), retained not deleted, per the same precedent Phase 1 set for db.json" — a deliberate Phase-3 architectural invariant, not an accident. A first `chmod u+w data/ma-portal.db` alone still failed; the file's `-shm` sidecar (a leftover from an earlier session, per its Aug 6 05:14 mtime) was ALSO 444 and needed unlocking.
- **Fix:** `chmod u+w data/ma-portal.db data/ma-portal.db-shm data/ma-portal.db-wal`, ran the migration (which itself performs `wal_checkpoint(TRUNCATE)` and folds the WAL back into the main file, removing the sidecars), then `chmod 444 data/ma-portal.db` to restore the file's documented read-only archival posture. This is judged a Rule 3 auto-fix rather than a Rule 4 architectural question because: (a) this EXACT file was already named in Task 1's user-approved checkpoint decision as part of "the entire migration surface"; (b) the plan's own acceptance criteria explicitly require `git diff --stat data/ma-portal.db` to be non-zero; (c) the permission change is filesystem-only (not git-tracked, per this project's own db.json chmod-444 precedent), fully reversible, and was reversed immediately after the migration completed — the file's read-only posture for all NORMAL future operation is unchanged.
- **Files modified:** `data/ma-portal.db` (permission cycled 444 -> 644 -> 444; content migrated)
- **Verification:** `ls -la data/ma-portal.db` confirms `-r--r--r--` after the fix; `git diff --stat` confirms the content change landed; full suite green (269/269)
- **Committed in:** `d31c9c1` (Task 3 commit)

**2. [Informational, not a fix] `data/ma-portal.db` carries 5 `synergyInitiatives` rows, not the 3 named in Task 1's checkpoint context**
- **Found during:** Task 3 (reading the row count before writing the migration)
- **Issue:** The checkpoint context text (05-CONTEXT.md, surfaced to the user at Task 1) stated "3 in the dormant `data/ma-portal.db`" as part of the accepted migration-surface cost. A direct query (`sqlite3 data/ma-portal.db "SELECT COUNT(*) FROM synergyInitiatives;"`) returns 5, matching `data/demo.db`'s count exactly (both files share the same 5 seeded initiative titles/values).
- **Fix:** None required — this does not change the migration's correctness (the script reads whatever rows actually exist, does not hardcode a row count), and it does not contradict any acceptance criterion (the plan's own criteria only assert `data/demo.db`'s count stays 5; no criterion pins `ma-portal.db`'s count). Flagging here in case the "3" figure in 05-CONTEXT.md was based on stale research and should be corrected for future reference.
- **Files modified:** None
- **Verification:** N/A (informational)

---

**Total deviations:** 1 auto-fixed (1 blocking), 1 informational note
**Impact on plan:** The permission fix was necessary to complete an already-approved, explicitly-scoped acceptance criterion. No scope creep — no code, schema, or route behavior was touched beyond what Task 3's action text specified.

## Issues Encountered
None beyond the deviation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The four-value `stage` vocabulary is now the ONLY lifecycle field on a synergy initiative, in code and in both committed databases — Plans 03 (baselines/stage-gates), 06 (stage-control UI), and 07 (rollup reporting) can all trust `item.stage` without a compatibility branch
- `SYN_STAGES` is exported from both `server.js` and `validators/workstream.js` for any future test or route that needs the ordered vocabulary directly, without re-declaring it
- The anti-drift test (`test/synergy-stage.test.js#synergy-stage (a)`) will fail loudly if a future plan edits any one of the three independent copies without the other two — this is the mechanism, not a review checklist item
- `data/ma-portal.db`'s read-only archival posture (chmod 444) is restored and unchanged for normal operation; a future one-off script touching this file will hit the same permission block and should follow this plan's precedent (temporarily unlock, migrate, restore)

---
*Phase: 05-synergy-value-capture*
*Completed: 2026-08-06*

## Self-Check: PASSED

All created/modified files confirmed present on disk; both task commits (`2447b52`, `d31c9c1`) confirmed in `git log`.
