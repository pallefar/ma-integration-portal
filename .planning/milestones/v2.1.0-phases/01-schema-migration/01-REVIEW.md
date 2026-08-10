---
phase: 01-schema-migration
reviewed: 2026-07-24T03:35:27Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - db/store.js
  - db/collections.js
  - db/schema.sql
  - scripts/migrate-db-json-to-sqlite.js
  - server.js
  - test/concurrent-write.test.js
  - test/migration-roundtrip.test.js
  - package.json
  - .gitignore
findings:
  critical: 3
  warning: 3
  info: 4
  total: 10
status: resolved
---

# Phase 1: Code Review Report

**Reviewed:** 2026-07-24T03:35:27Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Reviewed the db.json → SQLite migration: `db/store.js` (readDb/writeDb snapshot-diff merge), `db/collections.js` (38-key inventory), `db/schema.sql`, `scripts/migrate-db-json-to-sqlite.js`, the `server.js` persistence swap, and the two new `node:test` suites.

The good news first, since this is a novel and load-bearing piece of infrastructure: parameterization is clean (no string-concatenated SQL anywhere in the reviewed files — table names are always sourced from the hardcoded `ARRAY_COLLECTIONS` whitelist, never from request input), the 38-key array/singleton classification is verified byte-for-byte correct against the live `db.json` (ran a script confirming all 38 keys classify correctly and no array item lacks an id/username), the migration script is genuinely read-only on its source (confirmed no write call touches `--source`), it builds at a temp path and only renames on success, `--verify` does a real canonical-JSON deep diff plus row-count parity, and the `server.js` persistence swap is clean — no leftover `fs.readFileSync(DB_FILE)`/`_dbCache` code paths remain, and the global error handler / process guards make `writeDb()` throwing safe rather than crash-prone.

However, the flagship novel mechanism — `writeDb()`'s snapshot-diff merge in `db/store.js` — has two provable correctness bugs, both reproduced below with runnable repro scripts, not just reasoning:

1. **Pure reordering of an array collection is silently dropped** (`/api/questions/reorder` returns "success" but the persisted order never changes), and more generally, **inserting an item anywhere but the tail of an array desynchronizes `seq` for the untouched trailing items**, corrupting reconstructed order.
2. **A row explicitly deleted by one writer can be silently resurrected** by a second writer whose in-memory snapshot was read before the delete and is written back unchanged (classic delete-vs-stale-edit conflict; the merge only guards against losing concurrent *adds*, not against resurrecting deletes).

Both bugs trace back faithfully to the reference implementation in `01-RESEARCH.md`'s "Code Examples" section (same content-diff design), so this is a design-level gap inherited from the accepted pattern, not an implementer deviation — but it still needs to be closed in `db/store.js` before this ships, since it is directly reachable via at least one existing endpoint (`/api/questions/reorder`) and via any two admins editing/deleting concurrently (a realistic scenario given `server.js:341-361` already has an `await` of a multi-second AI API call sitting between its `readDb()` and `writeDb()` call).

Also flagged: the migration script's "clean up stale sidecar files from a prior aborted run" logic is dead code (the temp filename is always unique, so it never finds anything from a *previous* run to clean up), and the pattern it fails to catch isn't covered by `.gitignore` either — a crashed migration leaves an un-ignored full data dump sitting in `data/`. The documented test-run command (`node --test test/`) does not work on the Node version this project targets (reproduced below); there is no `npm test` script either.

## Critical Issues

### CR-01: `writeDb()` diffs by content only, so reordering/position changes are silently not persisted

**File:** `db/store.js:142-149`
**Issue:** The per-item upsert is gated purely on whether the serialized JSON *content* changed (`beforeMap.get(id) !== serialized`). It never compares the item's *position* (`seq`) against what's actually stored. Two concrete failure modes, both reproduced by running the code (not just reasoned through):

1. **Reorder-only writes are a complete no-op.** `server.js:507-536` (`POST /api/questions/reorder`) reads `db.questions`, rearranges the same item objects into a new order, and calls `writeDb(db)`. Since no item's content changed, `beforeMap.get(id) === serialized` for every item → zero `upsert.run()` calls are issued for the entire collection. The endpoint responds `{ success: true, questions: db.questions }` (a genuinely reordered in-memory array), but the very next `readDb()` (e.g. the next page load) returns the *original* order, because `seq` was never rewritten in SQLite. Repro:
   ```
   db.questions = [q1,q2,q3]; writeDb(db);          // seed
   db2 = readDb(); db2.questions = [q3,q1,q2]; writeDb(db2);
   readDb().questions.map(q=>q.id)  // => ['q1','q2','q3']  (unchanged — bug)
   ```
2. **Inserting anything but at the tail corrupts order for untouched trailing items.** When a new item is inserted at index `k`, its `seq` becomes `k`, but the items that were previously at index `k..n` (content unchanged) keep their *old* `seq` values — colliding with the new item's `seq` and with each other's now-wrong positions. Repro:
   ```
   db.questions = [q1,q2,q3]; writeDb(db);           // seq: q1=0,q2=1,q3=2
   db2 = readDb();
   db2.questions = [q1, qNew, q2, q3];  writeDb(db2); // intended order q1,qNew,q2,q3
   readDb().questions.map(q=>q.id)  // => ['q1','q2','qNew','q3']  (wrong — qNew got seq=1, colliding with q2's stale seq=1)
   ```

**Fix:** The snapshot needs to carry enough information to detect position changes, not just content changes — simplest correct fix is to stop skipping unchanged items entirely and always issue the upsert (correctness over the micro-optimization; performance is out of scope for this phase per the review brief):
```javascript
afterArr.forEach((item, i) => {
  const id = idOf(item);
  afterIds.add(id);
  const serialized = JSON.stringify(item);
  upsert.run(id, projectIdOf(item), i, serialized); // always write — keeps seq in sync with position
});
```
If the "skip unchanged" optimization must be kept, the snapshot must also record each row's `seq` at read time (`snapshot[key] = new Map(rows.map(r => [r.id, { data: r.data, seq: r.seq }]))`) and the skip condition must additionally require `beforeMap.get(id).seq === i`.

---

### CR-02: A row explicitly deleted by one writer can be resurrected by a concurrent writer's stale, content-unchanged snapshot

**File:** `db/store.js:126-171`
**Issue:** The merge only protects concurrent *additions* to the same collection (per the file's own doc comment and the two existing tests). It does not protect a *delete* against a second writer who read the collection before the delete happened and writes back an array that still contains the now-deleted item unchanged. Because the item's content is identical to what that writer's own snapshot saw, the skip-if-unchanged path (see CR-01) means no `upsert.run()` fires for it — but it also isn't in the delete writer's own deleted-id set, so nothing removes it either. Net effect: the deleted row comes back. Reproduced:
```javascript
db.pulses = [{id:'p1',rating:5}, {id:'p2',rating:3}]; writeDb(db);

const reqA = readDb();               // admin A: about to delete p2
const reqB = readDb();               // admin B: about to edit p2 (stale)
reqA.pulses = reqA.pulses.filter(p => p.id !== 'p2');
reqB.pulses = reqB.pulses.map(p => p.id === 'p2' ? {...p, rating: 1} : p);

writeDb(reqA);   // A's delete commits — p2 removed
writeDb(reqB);   // B's stale edit commits second

readDb().pulses  // => [{id:'p1',...}, {id:'p2', rating:1}]  — p2 is BACK, with B's stale edit applied
```
This is directly reachable in production: the app has ~20 `DELETE` endpoints (employees, HRBPs, alerts, communications, RAID entries, pulses via collection edits, etc.) and `server.js:341-361` shows a real endpoint (`POST /api/rag/upload`, or similar) that holds a `readDb()` result across an `await` of a multi-second external API call before calling `writeDb()` — exactly the kind of window that makes this race realistic, not just theoretical.

**Fix:** At minimum, before silently keeping an "unchanged from my snapshot" item, check whether it is still present in the live table; if it has been deleted since this request's own read and the item is otherwise unmodified from that request's perspective, honor the delete rather than resurrecting it:
```javascript
afterArr.forEach((item, i) => {
  const id = idOf(item);
  afterIds.add(id);
  const serialized = JSON.stringify(item);
  const seenBefore = beforeMap.get(id);
  if (seenBefore === undefined) {
    upsert.run(id, projectIdOf(item), i, serialized); // genuinely new
  } else if (seenBefore !== serialized) {
    upsert.run(id, projectIdOf(item), i, serialized); // this request intentionally edited it — last-write-wins is an accepted tradeoff
  }
  // else: unchanged from this request's own view — do NOT re-upsert; if it's gone from
  // the live table (deleted by someone else), leave it deleted rather than resurrecting it.
});
```
This is naturally satisfied by simply never re-inserting unchanged rows (i.e. never calling `upsert.run()` for the `seenBefore === serialized` branch at all) — which conflicts with the CR-01 fix's "always upsert" suggestion. Reconcile the two fixes together: track position separately from content (e.g. a cheap `UPDATE ... SET seq=? WHERE id=?` for unchanged-content items whose position moved) rather than using "always upsert" as a blunt fix for CR-01.

## Warnings

### WR-01: Migration's "stale file cleanup" is dead code, and the temp-file pattern it targets isn't gitignored

**File:** `scripts/migrate-db-json-to-sqlite.js:69-73`
**Issue:** The temp path is generated fresh every run (`Date.now()-${crypto.randomBytes(4)}`), so the very next line's cleanup loop —
```javascript
for (const ext of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(tmpPath + ext); } catch (e) { /* ignore */ }
}
```
— can never find a file matching `tmpPath` from a *prior* run, because `tmpPath` is unique to *this* run. The comment ("Clean up any stale sidecar files that might exist from a prior aborted run") describes intent this code cannot fulfill. If a migration crashes after `insertAll()` starts but before the final rename (e.g. `idOf()` throws on a malformed source item), the partially-written `.{basename}.migrating-*.tmp` (+ `-wal`/`-shm`) file is left behind in `data/` permanently — and none of the existing `.gitignore` patterns (`data/*.db-wal`, `data/*.db-shm`, `data/*.db.bak`) match that filename shape, so a stray `git add -A`/`git add data/` after a failed migration run could commit a full, uncontrolled data dump (potentially containing employee PII) to the repository.
**Fix:** Either glob-clean genuinely stale temp files at the start of a run (`fs.readdirSync(outDir).filter(f => f.startsWith('.' + path.basename(resolvedOut) + '.migrating-')).forEach(f => fs.unlinkSync(...))`), and/or add `data/.*.migrating-*.tmp*` to `.gitignore` so an orphaned artifact can never be accidentally committed regardless of whether the cleanup logic runs.

### WR-02: Documented test-run command doesn't work; no `npm test` script exists either

**File:** `package.json`, `test/concurrent-write.test.js:11-12`, `test/migration-roundtrip.test.js:5-6`
**Issue:** Both test file headers instruct `Run via node --test test/`. Reproduced in this environment (Node v22.18.0, which satisfies `package.json`'s `"engines": {"node": ">=22"}`):
```
$ node --test test/
# Error: Cannot find module '/Users/karstenhaldan/M&A/test'
...
not ok 1 - test
```
`node --test test` (no trailing slash) fails identically; only the argument-less `node --test` (relying on default discovery) or an explicit glob (`node --test 'test/*.test.js'`) actually run the suite. Separately, `package.json` has no `"test"` script at all, so `npm test` does nothing useful (falls back to npm's default "no test specified" no-op/failure) despite two real test suites now existing in the repo.
**Fix:** Add a working `"test": "node --test test/"`-equivalent script once the working invocation is confirmed for the target Node/CI version (e.g. `"test": "node --test"` if that's what actually works in CI), and correct the file-header comments in both test files to match whatever is verified to work — don't leave a documented command that fails when run as documented.

### WR-03: `writeDb()` trusts `data.__snapshot` without validating it matches the current database

**File:** `db/store.js:126-129`
**Issue:** `const before = (data && data.__snapshot) || {};` — if `__snapshot` is missing (e.g. a future caller constructs a plain object instead of going through `readDb()`), the merge silently degrades to "treat every existing id in the payload as unchanged, no id gets deleted" rather than erroring. Likewise, nothing stops a caller from holding a `readDb()` result captured against one database path (e.g. before `initDb()` is re-pointed at a different file, as the test suites do) and later calling `writeDb()` against a different open connection — the diff would be computed against a snapshot describing a different dataset with no warning. Not currently exploited anywhere in `server.js` (all ~90 call sites correctly thread the object straight from `readDb()` to `writeDb()`), but the contract is unenforced and the failure mode is silent data-integrity corruption rather than a thrown error.
**Fix:** Fail loudly if `data.__snapshot` is absent (`if (!data || !data.__snapshot) throw new Error('writeDb(): data was not produced by readDb() — missing __snapshot')`) rather than silently defaulting to `{}`.

## Info

### IN-01: `DB_FILE` constant in `server.js` is now dead code

**File:** `server.js:17`
**Issue:** `const DB_FILE = path.join(__dirname, 'db.json');` is declared and referenced only inside a comment (`server.js:252`) — no executable code path reads or writes through it anymore (confirmed via grep: no `fs.readFileSync(DB_FILE)` / `fs.writeFileSync(DB_FILE...)` remain). Harmless, but it's dead code that could mislead a future reader into thinking it's still load-bearing.
**Fix:** Remove the constant, or rename/comment it explicitly as "kept only for the comment below referencing the archived path" if there's a reason to keep the literal.

### IN-02: `writeDb()` doc comment overstates the "no SQL issued" guarantee

**File:** `db/store.js:122-124`, `126-140`
**Issue:** The doc comment says "Collections with zero delta are skipped entirely (no SQL issued for them)." In fact, `conn.prepare(...)` for both the upsert and delete statement is called unconditionally for every one of the 33 array collections on every `writeDb()` call, regardless of whether that collection has any delta — only the `.run()` execution is conditional. `PREPARE` is itself a round-trip to SQLite's parser/planner. Not a functional bug (performance is out of scope for this review), but the comment is inaccurate and could mislead future reasoning about the system's actual behavior.
**Fix:** Either hoist the prepared statements out of the per-write loop (prepare once at `initDb()` time, keyed by collection) so the comment becomes true, or correct the comment to say "no `INSERT`/`DELETE` executed" rather than "no SQL issued."

### IN-03: `db.json` will silently drift from the live SQLite database with no signal to future maintainers

**File:** `server.js:14-17`, `scripts/migrate-db-json-to-sqlite.js` (header comment)
**Issue:** Comments describe `db.json` as a "dormant, read-only archive" / "pre-migration snapshot," which is accurate at migration time, but nothing calls this out as a *moving target problem*: from the moment `data/ma-portal.db` starts receiving live writes, `db.json` is a frozen point-in-time copy that will progressively diverge from the real data (new pulses, employees, etc. only exist in SQLite). A future maintainer unfamiliar with this migration who opens `db.json` expecting "the data" could draw wrong conclusions, and the migration test suite (`test/migration-roundtrip.test.js`, `test/concurrent-write.test.js`) both hardcode `db.json` as their `SOURCE_PATH` fixture — fine for testing the *migration script's* correctness in isolation, but worth a comment noting `db.json` is a frozen fixture for these tests, not "the source of truth" going forward.
**Fix:** No code change required; add a one-line comment near the top of `db.json`-referencing code (or a `data/README` note) clarifying it is a frozen point-in-time snapshot that will diverge from `data/ma-portal.db` over time, to prevent future confusion.

### IN-04: `foreign_keys = ON` pragma has no effect — schema defines no foreign keys

**File:** `db/store.js:73`, `db/schema.sql`
**Issue:** `db.pragma('foreign_keys = ON')` is set on every `initDb()` call, but `schema.sql` defines no `REFERENCES`/`FOREIGN KEY` constraints anywhere (per the file's own comment, `project_id` is deliberately just an indexed metadata column, not an FK to a `projects` table). The pragma is currently a no-op. Not harmful, but worth a one-line comment noting it's forward-looking (e.g. for a future phase that does add FK constraints) so it doesn't look like an oversight.
**Fix:** Add a short comment, or drop the pragma until it's actually needed.

---

_Reviewed: 2026-07-24T03:35:27Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
