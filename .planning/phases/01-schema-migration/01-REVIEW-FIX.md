---
phase: 01-schema-migration
fixed_at: 2026-07-24T05:47:00Z
review_path: .planning/phases/01-schema-migration/01-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 1: Code Review Fix Report

**Fixed at:** 2026-07-24T05:47:00Z
**Source review:** .planning/phases/01-schema-migration/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9 (CR-01, CR-02, WR-01, WR-02, WR-03, IN-01, IN-02, IN-03, IN-04)
- Fixed: 9
- Skipped: 0

Note: CR-01, CR-02, WR-03, IN-02, and IN-04 were reconciled and applied as
ONE coherent commit to `db/store.js` because the review explicitly warned
that fixing CR-01 and CR-02 independently (e.g. "always upsert") would
resurrect the other bug. This is a single logical fix, listed once below
with all five finding IDs.

## Fixed Issues

### CR-01 / CR-02 / WR-03 / IN-02 / IN-04: writeDb() snapshot-tagged insert/update merge

**Files modified:** `db/store.js`
**Commit:** e455554
**Applied fix:** Replaced the content-only skip-if-unchanged upsert with a
merge keyed on whether the id was present in THIS request's own
`__snapshot`: ids new to the snapshot get a plain `INSERT`; ids already in
the snapshot get an unconditional `UPDATE ... SET project_id=?, seq=?,
data=? WHERE id=?` (never a skip, never an upsert). This makes reorders and
non-tail inserts persist (CR-01, `seq` is now always rewritten for
snapshot-known ids) while a concurrently-deleted row's `UPDATE` becomes a
harmless 0-row no-op instead of resurrecting it (CR-02). Also added a hard
throw in `writeDb()` when `data.__snapshot` is missing instead of silently
defaulting to `{}` (WR-03), corrected the doc comment that claimed "no SQL
issued" for zero-delta collections when in fact `prepare()` always runs
(IN-02), and added a comment explaining the currently-no-op
`foreign_keys = ON` pragma is forward-looking since `schema.sql` defines no
FK constraints yet (IN-04).

**Verification:** `test/writedb-merge.test.js` was added with 5 new
assertions. Confirmed 4 of 5 fail against the pre-fix code (reorder-persist,
non-tail-insert-order, delete-vs-stale-edit-no-resurrection, and the
WR-03 throw) and all 5 pass after the fix; the 5th (concurrent same-collection
adds) was already passing pre-fix and continues to pass post-fix, proving no
regression of the existing FND-03 guarantee. Full suite: 9/9 green
(`npm test`). Live end-to-end: booted `server.js`, called
`POST /api/questions/reorder` with a real reversed order, confirmed a fresh
`GET /api/questions` (i.e. a fresh `readDb()`) reflects the new order, then
restored the original order to leave the demo database unmutated.

---

### WR-01: Migration's stale temp-file cleanup

**Files modified:** `scripts/migrate-db-json-to-sqlite.js`, `.gitignore`
**Commit:** 6210b19
**Applied fix:** The old cleanup unlinked `tmpPath` itself, which is unique
to the current run (`Date.now()` + random suffix) and therefore could never
match a file left behind by a *prior* crashed run. Replaced with a
`readdirSync(outDir)` glob-filter on the shared `.{basename}.migrating-`
prefix, removing every match at the start of a run regardless of the random
suffix that generated it. Added `data/.*.migrating-*` to `.gitignore` as a
belt-and-suspenders guard against ever committing an orphaned partial data
dump.

**Verification:** Seeded two fake stale sidecar files
(`.x.db.migrating-1234-abcd.tmp` + `-wal`) in a scratch output directory,
ran `node scripts/migrate-db-json-to-sqlite.js --source db.json --out
/tmp/wr01test/x.db --verify`, confirmed both stale files were removed and
the migration still reported `Migration verify OK: 33 collections + 5
singletons match source exactly`.

---

### WR-02: Working `npm test` script + corrected test-run comments

**Files modified:** `package.json`, `test/concurrent-write.test.js`,
`test/migration-roundtrip.test.js`
**Commit:** 4f5a4d0
**Applied fix:** Confirmed on this Node v22.18.0 that `node --test test/`
fails (`Cannot find module '.../test'`) while bare `node --test` (default
discovery) works. Added `"test": "node --test"` to `package.json` and
corrected both existing test file header comments (previously documenting
the broken `node --test test/` invocation) to state the working command.

**Verification:** `npm test` runs and reports `# pass 9 / # fail 0`.

---

### IN-01 / IN-03: Removed dead `DB_FILE` const, added db.json drift note

**Files modified:** `server.js`
**Commit:** 8cab019
**Applied fix:** Removed the unused `const DB_FILE = path.join(__dirname,
'db.json')` (grep-confirmed no executable code path referenced it, only a
stale comment) and expanded the surrounding comment block to explicitly
flag `db.json` as a frozen, point-in-time migration snapshot that will
progressively drift from the live `data/ma-portal.db` as the app receives
writes, and to note it now exists only as a fixture for the migration test
suite. Updated the second stale `DB_FILE`-referencing comment near the
`readDb`/`writeDb` require to match.

**Verification:** `grep -n "DB_FILE" server.js` returns no matches;
`node -c server.js` passes; booted the server and confirmed `/healthz`
returns `{"status":"ok",...}`.

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-07-24T05:47:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
