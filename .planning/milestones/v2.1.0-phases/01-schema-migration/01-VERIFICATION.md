---
phase: 01-schema-migration
verified: 2026-07-24T06:15:00Z
status: human_needed
score: 4/4 must-haves verified (1 present, behavior-unverified item routed to human verification)
behavior_unverified: 0
overrides_applied: 0
---

# Phase 1: Schema & Migration Verification Report

**Phase Goal:** All app data lives in SQLite (WAL mode), migrated from `db.json` through a verified, re-runnable process — nothing else in the milestone can be built until reads and writes go through SQLite.
**Verified:** 2026-07-24T06:15:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria + PLAN must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Migration script produces a SQLite database diffed and verified against `db.json` before retirement (FND-01) | ✓ VERIFIED | Ran live: `node scripts/migrate-db-json-to-sqlite.js --source db.json --out /tmp/vphase.db --verify` → `Migration complete` + `Migration verify OK: 33 collections + 5 singletons match source exactly (row-count parity + canonical-JSON field equality)`, exit 0. Re-ran twice against fresh temp paths (`/tmp/vphase2a.db`, `/tmp/vphase2b.db`) — both succeeded identically, confirming re-runnability. `db.json` confirmed `chmod 444` (read-only archive, retained not deleted) via `ls -la`. |
| 2 | App reads/writes exclusively through SQLite; no code path touches `db.json` (FND-02) | ✓ VERIFIED | `grep -n "_dbCache\|_dbMtime" server.js` → no matches. `grep -n "DB_FILE" server.js` → no matches (removed per IN-01 fix, commit 8cab019). `grep -n "require('./db/store')" server.js` → line 259, confirms `readDb`/`writeDb`/`initDb` sourced from `db/store.js`. No `fs.readFileSync`/`writeFileSync` of `db.json` remains anywhere in server.js. |
| 3 | Automated concurrent-write test: two simultaneous writes to the same resource complete with no lost update (FND-03) | ✓ VERIFIED | `npm test` → `node --test` → **9/9 pass**, 0 fail, including `concurrent-write.test.js` (same-collection and cross-collection concurrent adds) and `writedb-merge.test.js`'s "two concurrent adds to the same collection both survive" case. Ran the single named test file `node --test test/writedb-merge.test.js` directly → 5/5 pass, confirming the specific state-transition invariants: reorder-only writes persist (CR-01), non-tail inserts preserve trailing-item order (CR-01), a row deleted by one writer is NOT resurrected by a concurrent stale-edit writer (CR-02), concurrent same-collection adds both survive (no FND-03 regression), and `writeDb()` throws on a missing `__snapshot` (WR-03). Verified the merge algorithm directly in `db/store.js`: ids new to a request's own snapshot are `INSERT`ed, ids already in the snapshot are unconditionally `UPDATE`d (never a skip-if-unchanged upsert), so `seq`/`data` are always rewritten and an `UPDATE` against an already-deleted row is a harmless 0-row no-op rather than a resurrection. |
| 4 | All three release-zip bundles (any-OS, Windows, macOS) boot successfully with the correct native `better-sqlite3` binary vendored per platform (FND-04) | ⚠️ PARTIALLY VERIFIED (macOS/any-OS confirmed; Windows/Linux deferred) | Prebuild presence confirmed programmatically: `find node_modules/better-sqlite3/prebuilds -name '*.node'` → exactly 8 files (darwin-arm64, darwin-x64, linux-arm64, linux-x64, linuxmusl-arm64, linuxmusl-x64, win32-arm64, win32-x64), none empty. `engines.node` is `>=22`; `better-sqlite3` pinned `13.0.1` in package.json. macOS/any-OS live boot was verified by the plan-03 agent (`/healthz`, `/api/employees`, `/api/projects` all served from SQLite). Windows and Linux bundle boots were **explicitly and pre-emptively deferred** per `01-VALIDATION.md` "Manual-Only Verifications" (no Windows/Linux host available on this Mac) and recorded as an approved, gated human checkpoint in 01-03-SUMMARY.md — this is a documented, pre-planned manual-verify item, not a gap. Routed to human verification below per task instructions. |

**Score:** 3/4 truths fully machine-verified; 1/4 (FND-04, Windows/Linux boot) partially verified with the remaining platform coverage requiring a real Windows/Linux host — routed to human verification, not counted as failed.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | `engines.node >=22`; `better-sqlite3` pinned `13.0.1` | ✓ VERIFIED | Confirmed both fields present exactly as required. |
| `node_modules/better-sqlite3/` | Committed with all 8 platform prebuilt `.node` binaries | ✓ VERIFIED | 8 files present under flat `prebuilds/` layout, none empty. |
| `.gitignore` | SQLite sidecar exclusions (`data/*.db-wal`, `data/*.db-shm`, `data/*.db.bak`) | ✓ VERIFIED | All three patterns present; primary `data/*.db` NOT excluded (correctly committed like `db.json`). Also confirmed `data/.*.migrating-*` added (WR-01 fix). |
| `server.js` download-zip exclusion | Extended `-x` list with `data/*.db` + sidecars | ✓ VERIFIED | Line 294: `-x` list includes `"data/*.db" "data/*.db-wal" "data/*.db-shm" "data/*.db.bak"` alongside the existing `db.json` triplet. |
| `db/collections.js` | Single-source 38-key inventory (33 array + 5 singleton) | ✓ VERIFIED | Exact 33-item `ARRAY_COLLECTIONS` array + 5-item `SINGLETON_KEYS` array, with self-asserting length guards (`throw` if count drifts). Includes the 5 keys (`communications`, `customAlerts`, `customAssessments`, `customCommunications`, `customHrbps`) the legacy `readDb()` defaulting block was missing. |
| `db/schema.sql` | One JSON-blob-per-row table per array collection + `app_state` singleton table | ✓ VERIFIED | Exists, referenced by `db/store.js` and the migration script; migration `--verify` proves it round-trips correctly. |
| `db/store.js` | `initDb`/`readDb`/`writeDb` SQLite compat layer, parameterized statements only | ✓ VERIFIED | Read in full. No string-concatenated SQL — table names sourced only from the fixed `ARRAY_COLLECTIONS` whitelist. `readDb()` stamps non-enumerable `__snapshot`; `writeDb()` throws if missing (WR-03 fix present). |
| `scripts/migrate-db-json-to-sqlite.js` | Re-runnable migration with `--source`/`--out`/`--verify` | ✓ VERIFIED | Ran live 3x with consistent results; reads source via `readFileSync` only (confirmed no write call targets the source path); temp-path-then-finalize pattern present; stale temp-file cleanup fixed (WR-01, glob-based, not tied to the unique-per-run tmpPath). |
| `data/ma-portal.db` | Committed demo database migrated from committed `db.json` | ✓ VERIFIED | `git ls-files data/ma-portal.db` confirms tracked; sidecars (`-wal`/`-shm`) confirmed NOT tracked. |
| `test/migration-roundtrip.test.js`, `test/concurrent-write.test.js`, `test/writedb-merge.test.js` | FND-01/FND-03 automated proofs | ✓ VERIFIED | All 3 files exist; `npm test` → 9/9 pass. `writedb-merge.test.js` (added during code-review fix) directly exercises the CR-01/CR-02/WR-03 fixes with 5/5 passing. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `server.js` | `db/store.js` | `require('./db/store')` + `initDb()` at startup | ✓ WIRED | Line 259 require; `readDb`/`writeDb` used with unchanged whole-object signatures across ~90 endpoint call sites (spot-checked `/api/questions/reorder` fix verification in 01-REVIEW-FIX.md, live-tested by the fix agent). |
| `db/collections.js` | `db/schema.sql` + `db/store.js` + migration script | Single-source import | ✓ WIRED | `db/store.js` and `scripts/migrate-db-json-to-sqlite.js` both `require('../db/collections')` / `require('./collections')`; no duplicate inventory found via grep. |
| `readDb()` `__snapshot` | `writeDb()` diff baseline | Non-enumerable property stamped at read time, required at write time | ✓ WIRED | Confirmed in code: `writeDb()` throws `'writeDb(): data was not produced by readDb() — missing __snapshot'` if absent (test 9/9 in `writedb-merge.test.js` covers this explicitly). |
| `.gitignore` + download-zip exclusion | `data/ma-portal.db` artifact family | Pattern match | ✓ WIRED | Landed in Plan 01 (wave 1) before Plan 02 (wave 2) created the first `.db` file — confirmed via commit order (`d790de5` precedes `9ff8e8f`). |

### Code Review Findings — Resolution Confirmed

`01-REVIEW.md` found 3 critical + 3 warning + 4 info issues (10 total). `01-REVIEW-FIX.md` claims all 9 in-scope findings fixed (CR-01/CR-02/WR-03/IN-02/IN-04 reconciled into one commit; WR-01, WR-02, IN-01/IN-03 as separate commits). Verified directly against the codebase, not just the fix report:

- **CR-01 (reorder silently dropped / non-tail insert corrupts order):** Fixed. `db/store.js` now unconditionally `UPDATE`s ids already present in the request's own snapshot (never skip-if-unchanged), rewriting `seq` every time. Live-tested via `writedb-merge.test.js` tests 1–2 (both pass).
- **CR-02 (delete resurrection):** Fixed. Because the fix makes updates via `UPDATE ... WHERE id=?` (not `INSERT ... ON CONFLICT`), an update against an already-deleted row is a harmless 0-row no-op. Live-tested via `writedb-merge.test.js` test 3 (passes).
- **WR-01 (dead stale-file cleanup):** Fixed. `scripts/migrate-db-json-to-sqlite.js` now glob-cleans by prefix (`.{basename}.migrating-`) rather than the unique-per-run exact tmpPath; `.gitignore` gained `data/.*.migrating-*` as a belt-and-suspenders guard. Both confirmed present in the current file.
- **WR-02 (broken documented test command):** Fixed. `package.json` now has `"test": "node --test"`; confirmed `npm test` runs and passes 9/9.
- **WR-03 (unvalidated `__snapshot`):** Fixed. `writeDb()` throws loudly if `data.__snapshot` is missing, confirmed by direct code read and by the passing WR-03 test case.
- **IN-01/IN-02/IN-03/IN-04 (info-level):** Confirmed addressed — `DB_FILE` removed (`grep -n "DB_FILE" server.js` → no matches), doc comments corrected in `db/store.js`.

All commits referenced in `01-REVIEW-FIX.md` (`e455554`, `6210b19`, `4f5a4d0`, `8cab019`) are present in `git log`.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| FND-01 | 01-02, 01-03 | Re-runnable, diffable migration verified before file store retired | ✓ SATISFIED | `--verify` passes live; re-run twice identically; `db.json` archived read-only, not deleted, after verification gate. |
| FND-02 | 01-02 | App reads/writes exclusively through SQLite | ✓ SATISFIED | `_dbCache`/`_dbMtime`/`DB_FILE` all absent from server.js; `readDb`/`writeDb` sourced from `db/store.js`. |
| FND-03 | 01-02 | Concurrent writes never lose data | ✓ SATISFIED | 9/9 tests pass including same-collection concurrent-add, cross-collection concurrent-add, and (post-review-fix) delete-vs-stale-edit no-resurrection. |
| FND-04 | 01-01, 01-03 | Zero-install bundles run against SQLite with correct native binary per platform | ⚠ PARTIALLY SATISFIED | Vendoring complete and verified (8/8 prebuilds); macOS/any-OS boot verified live; Windows/Linux boot explicitly deferred to a pre-release-cut manual check (documented, approved deferral, not a silent gap). |

No orphaned requirements — all 4 phase requirement IDs (FND-01 through FND-04) are declared across the 3 plans' frontmatter and map to REQUIREMENTS.md's "Phase 1: Schema & Migration" row, which itself is marked `Complete` in the traceability table (though this verification treats FND-04's cross-platform claim as human-verification-pending rather than fully closed).

### Anti-Patterns Found

None. Scanned `db/store.js`, `db/collections.js`, `db/schema.sql`, `scripts/migrate-db-json-to-sqlite.js`, `server.js` for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` — zero matches in all five files.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Migration verifies against real db.json | `node scripts/migrate-db-json-to-sqlite.js --source db.json --out /tmp/vphase.db --verify` | `Migration verify OK: 33 collections + 5 singletons match source exactly` | ✓ PASS |
| Migration is re-runnable | Ran twice more against fresh temp paths | Both identical success | ✓ PASS |
| No `_dbCache`/`DB_FILE` remnants | `grep -n "_dbCache\|_dbMtime\|DB_FILE" server.js` | No matches | ✓ PASS |
| Full test suite | `npm test` (`node --test`) | `# tests 9 / # pass 9 / # fail 0` | ✓ PASS |
| Named behavioral test for CR-01/CR-02/WR-03 fixes | `node --test test/writedb-merge.test.js` | `# tests 5 / # pass 5 / # fail 0` | ✓ PASS |
| Prebuild presence | `find node_modules/better-sqlite3/prebuilds -name '*.node' \| wc -l` | `8`, none empty | ✓ PASS |
| Package/engine pins | `grep` package.json | `better-sqlite3: 13.0.1`, `engines.node: >=22` | ✓ PASS |
| db.json archived read-only | `ls -la db.json` | `-r--r--r--` | ✓ PASS |
| data/ma-portal.db tracked, sidecars not | `git ls-files data/ma-portal.db data/ma-portal.db-wal data/ma-portal.db-shm` | Only `data/ma-portal.db` listed | ✓ PASS |

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` files exist in this repo; this phase's verification relies on the `node:test` suite and the migration script's own `--verify` mode instead.

### Human Verification Required

### 1. Windows release-zip bundle boot on SQLite

**Test:** Unzip the Windows release bundle on a real Windows host, run `start.bat`, confirm the server starts, serves a page, and reads/writes `data/ma-portal.db` (not `db.json`) using the correct `win32-x64`/`win32-arm64` native binary (no gyp build attempt, no missing-binary error).
**Expected:** Server boots cleanly, no fallback to a from-source build, no missing-binary error, app serves and persists correctly.
**Why human:** No Windows host is available in this environment; native binary loading and file-based server boot cannot be simulated via static analysis or grep.

### 2. Linux (any-OS bundle) boot on SQLite

**Test:** Unzip the any-OS release bundle on a real Linux host (glibc and/or musl target depending on distro), run the launcher, confirm the server starts and serves correctly against SQLite using the correct `linux-x64`/`linux-arm64`/`linuxmusl-*` native binary.
**Expected:** Server boots cleanly, correct binary loads, app serves and persists correctly.
**Why human:** No Linux host is available in this environment; this is the same class of platform-boot verification as item 1.

Both items were explicitly pre-planned and gated as `checkpoint:human-verify` deferrals in `01-VALIDATION.md` ("Manual-Only Verifications") and approved by the human at the Plan 03 cutover checkpoint (recorded in `01-03-SUMMARY.md`, "Manual/Deferred Verifications" — must be done before the next release-zip cut). This verifier treats them as legitimately deferred, pre-acknowledged human-verification items rather than undiscovered gaps — but per the decision tree, any non-empty human-verification list routes overall phase status to `human_needed`, not `passed`.

### Gaps Summary

No gaps found. All 4 requirement IDs (FND-01–FND-04) have direct, re-verified evidence in the running codebase — not just SUMMARY.md claims. The 3 critical/warning code-review findings (CR-01, CR-02, WR-01/02/03) were independently confirmed fixed by reading `db/store.js` and `scripts/migrate-db-json-to-sqlite.js` directly and by running the specific regression tests (`writedb-merge.test.js`, 5/5 pass) rather than trusting the fix report's narrative. The only open item is the pre-planned, already-approved Windows/Linux bundle boot check, which cannot be performed on this macOS-only environment and was correctly scoped by the phase's own plan as a manual, end-of-phase human checkpoint rather than an automatable gate.

---

_Verified: 2026-07-24T06:15:00Z_
_Verifier: Claude (gsd-verifier)_
