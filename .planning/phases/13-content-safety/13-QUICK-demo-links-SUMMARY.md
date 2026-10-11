---
phase: 13-content-safety
plan: quick-demo-links
subsystem: assessment-ai-plan / committed demo database
tags: [N-03, privacy, demo-db, rc.1-hardening]
status: complete
base: 5c7860702bdf4766fb9201e7a369ee4fcb76d066
---

# Phase 13 Quick Task: remove developer OS username and `file:///` links (finding N-03, LOW)

**One-liner:** the assessment AI-plan template's three playbook links are now root-relative
(`/playbook.html#culture|#talent|#value`) instead of `file:///Users/<developer>/M&A/public/...`, and
the two copies of that text persisted in the committed `data/demo.db` were rewritten in place (plain
prefix replace), with a full-content-dump proof that nothing else changed.

## What changed

| File | Change |
| --- | --- |
| `aiService.js` | lines 312-314 (the "Top 3 Core Playbook Links" block of the fallback/RAG plan template): `file:///Users/<name>/M&A/public/playbook.html#<a>` -> `/playbook.html#<a>` (3 links) |
| `data/demo.db` | 2 cells rewritten: `assessments.data` rowid 1 (`assess_1779394615582`) and rowid 2 (`assess_1779457825402`), 3 links each |
| `test/no-developer-paths.test.js` | new: 3 tests (shipped-source scan, template root-relative assertion, demo.db cell + raw-byte scan on a temp COPY) |

No migration was written or run; `user_version` stays 2; the demo server was never started against the
committed file.

## How `data/demo.db` was changed

1. Scanned a scratch COPY: every table (41), every column, every text/blob cell for `/Users/`. Exactly
   2 cells matched, both `assessments.data`, both valid canonical JSON
   (`JSON.stringify(JSON.parse(s)) === s`), 3 occurrences each, all of the form
   `file:///Users/<name>/M&A/public/`. No other cell (any case) mentioned the account name.
2. Throw-away script (kept in the session scratchpad, not committed) on the copy: plain string replace
   `file:///Users/<name>/M&A/public/` -> `/` in those cells only, inside one `BEGIN IMMEDIATE`
   transaction with `PRAGMA secure_delete=ON` (so the old bytes are zeroed, not left in the page or the
   freelist), then `PRAGMA wal_checkpoint(TRUNCATE)`; `journal_mode` still `wal`, `user_version` still 2,
   `integrity_check` = `ok`, no `-wal`/`-shm` left.
3. The checkpointed single file was copied over `data/demo.db`. `git status --porcelain data/` shows only
   ` M data/demo.db`; no sidecars.

### Diff proof

Both versions dumped (pragmas `user_version`/`application_id`/`journal_mode`/`page_size`/`encoding`,
every `sqlite_master` object's SQL, and every row of every table as sorted JSON incl. rowid):

- dump line count: 640 old / 640 new
- `diff` of the two dumps: exactly 2 changed lines (4 diff lines `<`/`>`), both the two
  `assessments` rows above; every schema line, every pragma line, and every other table's rows are identical
- per changed row: `id`, `project_id`, `seq` equal; `new.data === old.data.replace(prefix, '/')` is true;
  3 prefixes replaced each; both still parse as JSON; resulting links are `/playbook.html#culture`,
  `#talent`, `#value`
- each `data` string is 114 chars shorter (3 x 38) - nothing else
- raw bytes of the new file: 0 occurrences of the account name, 0 of `file:///Users` (old file: 6 / 6)

### sha256 of `data/demo.db`

| | sha256 |
| --- | --- |
| old (HEAD, Phase 13-05 regeneration) | `dba5812085c93cdf4e0e55c9dee141984cf5d5eb408887d0e9e221dacf1fecb3` |
| new | `26a2e5a54a57609865828c4b001b3dc3877f777a9b4fa82d9be44f7008c7db4c` |

File size unchanged (1,310,720 bytes; same page count).

### What pins the old hash

- `test/`, `scripts/`, `db/`, `lib/`, `server.js`, `package.json`: **nothing** pins `dba58120`. The tests that
  guard the committed file (`real-mode-boot`, `resanitize-migration`, `control-plane-*`) compare a before/after
  hash of the same run, so they need no update.
- `.planning/**/evidence/README.md`: no occurrence.
- Historical docs that quote the old hash and were left alone: `13-05-SUMMARY.md`, `13-REVIEW.md`,
  `13-SECURITY.md`. **Carry-in for Phase 23 (CERT-02/03):** byte-identity baselines must be taken from this
  new file (`26a2e5a5...c7db4c`), not from the 13-05 hash.

## Other occurrences (found, left, reported)

`file:///` grep over tracked non-planning `*.js|*.html|*.json|*.md` (node_modules excluded):

| Location | What | Disposition |
| --- | --- | --- |
| `db.json` lines 143, 166 | legacy JSON store; two stored `aiPlan` strings with `file:///Users/<name>/...` | left per brief (legacy, not read by the app) |
| `data/ma-portal.db` | legacy pre-Phase-3 SQLite default; same text | left per brief (legacy) |
| `public/vendor/transformers/transformers.min.js` | the bare `file:///` scheme string inside the library | not a path; ignore |
| `test/safe-html-policy.test.js:230` | `file:///etc/passwd` as a hostile-URL fixture | not a developer path; ignore |

Account-name occurrences that are NOT `file:///` links (outside the brief's `file:///` grep; reported only):

- `scripts/export-session-state.sh:91` - a comment example of the project-dir mangling
  (`/Users/<name>/M&A -> -Users-<name>-M-A`).
- `scripts/smoke/README.md:60` - a note naming a pre-existing local `axe-core` copy path.
- A case-insensitive scan of every tracked non-planning, non-`node_modules` file (binary included) for the
  account name hit exactly five paths: `data/demo.db` (fixed), `data/ma-portal.db`, `db.json`, and the two
  scripts above. `.planning/` carries the path as prose and is excluded by the brief.

None of the three sit in the test's scan scope (`public/ lib/ db/ validators/ aiService.js server.js`), so
they do not fail the new test; they are a two-line comment/doc scrub worth folding into the release-engineering
task (it owns `scripts/`). Both `db.json` and `data/ma-portal.db` are still TRACKED in a PUBLIC repo, so the
account name stays reachable in a source clone and in git history regardless of what the release zips exclude;
`scripts/build-release.sh` does not exist at this base (the release-engineering sibling is creating it), so the
zip exclusion of those two legacy files could not be verified here - recommend that sibling asserts it and
the orchestrator considers `git rm` of the two legacy files as a follow-up.

## Tests

- `node --test test/no-developer-paths.test.js`: 3/3 pass on the changed tree. Negative check: the same test
  pointed at a scratch tree holding HEAD's `aiService.js` + HEAD's `data/demo.db` fails (a2) and (b) with the
  offending cells listed.
- Full suite: see "Full suite" below.

## Deviations from Plan

None - plan executed as written. One note: the brief suggested a JSON parse/re-serialise path; the cells were
already canonical, but the plain string replace was used anyway because it is trivially byte-exact.

## Full suite

`node --test` (whole repo, backgrounded, host load average 100-250, log ends `EXIT=1`):

```
# tests 1712
# pass 1709
# fail 2
# skipped 1
EXIT=1
```

The two failures are both known/timing load flakes unrelated to this change (neither touches `aiService.js`
or `data/demo.db` content), and both pass when re-run ALONE:

- `CONC-01 (end-to-end)` in `test/concurrency-busy-retry.test.js` - re-run alone: 2/2 pass.
- `WR-A06: 200 000 nested <b> / <div> ... in < 100 ms` in `test/sanitize-html.test.js` - a wall-clock
  `< 100 ms` assertion; failed once alone at load ~160, then passed on two further isolated re-runs
  (whole file 32/32). Not on the brief's flake list - recorded here as an additional load-sensitive
  timing test.

`git status --porcelain data/ public/sent_emails/` after the full run: only ` M data/demo.db`. (The suite left a
0-byte `data/control.db-wal` + `-shm` next to the unmodified committed `control.db` - gitignored sidecars from a
test that opens it; no process held them, they were deleted before the commit. `control.db` itself is byte-identical.)

## Self-Check: PASSED

- `aiService.js` has no `file:///` and no `/Users/`; `data/demo.db` sha256 `26a2e5a5...c7db4c`, `user_version` 2,
  `integrity_check` ok; new test file present and green.
