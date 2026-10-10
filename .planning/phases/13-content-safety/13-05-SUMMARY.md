---
phase: 13-content-safety
plan: 05
subsystem: database-migrations
tags: [SAFE-01, migration, sanitizer, demo-db, rule-5]
requires: [13-01]
provides:
  - "deal-family migration 002-resanitize-html (FIELD_PATHS, resanitizeRecord)"
  - "scripts/regenerate-demo-db.js (migrate.js rule-5 regeneration)"
  - "data/demo.db at user_version 2"
key-files:
  created:
    - db/migrations/deal/002-resanitize-html.js
    - scripts/regenerate-demo-db.js
    - test/resanitize-migration.test.js
  modified:
    - data/demo.db
    - test/schema-migrations.test.js
    - test/healthz-readiness.test.js
status: complete
actuals:
  tasks: 2
  commits: 3
---

# Phase 13 Plan 05: Legacy stored-HTML re-sanitize migration Summary

Ordered, idempotent deal-family migration `002-resanitize-html` re-sanitizes every stored htmlField value (pages.body, pages.layout[].data.html, courses modules[].lessons[].body — string or language map) with the 13-01 parser sanitizer, rewriting only changed rows; the committed `data/demo.db` is regenerated at `user_version` 2 in its own commit.

## Commits

| Commit | What |
| ------ | ---- |
| `8b8b4cb` | migration 002 + `scripts/regenerate-demo-db.js` + `test/resanitize-migration.test.js` |
| `1bcb8fb` | `data/demo.db` regenerated ALONE (rule 5) |
| `5ac6308` | version pins, log-contract fix, nested/scope/inventory tests |

## Regeneration output (scripts/regenerate-demo-db.js)

```
regenerate-demo-db: data/demo.db user_version 0 (latest 2) sha256 63d552c4c4d8e301752d5f47b7f82b4fd391ee7d32534e7ea0b808cdcba805a8
[migrate] deal/002 resanitize-html demo.db: 0 value(s) changed in 0 row(s)
regenerate-demo-db: data/demo.db user_version 2 sha256 dba5812085c93cdf4e0e55c9dee141984cf5d5eb408887d0e9e221dacf1fecb3
```

- Zero changed values (3 pages + 9 lessons, `<p>`-only as inventoried) — the file differs from the previous one only by `user_version` and SQLite page bookkeeping.
- `integrity_check` ok; checkpoint TRUNCATE; no `-wal` content; `data/control.db` untouched (sha256 identical before/after both full-suite runs).

## Behaviour

- `up()` iterates `pages` and `courses`, sanitizes every string leaf beneath each mapped path (matching the write path's "tagging a container propagates to every string leaf"), and writes only rows with at least one changed value, using `JSON.stringify(record)` (the store's serialization). Unchanged rows' `data` bytes are identical.
- No audit rows (boot-time system repair). Log: one summary line per file + `collection/id/path sha256 before -> after` per changed value; never content. Non-demo files are tagged by a name digest (`deal-file#xxxxxxxx`) so the boot-sweep contract "logs name no deal id" holds.
- Runner semantics unchanged: v1 -> 2 inside BEGIN IMMEDIATE; fresh files stamped 2 without `up()`; a committed file at v0 is `committed-file-needs-regeneration` until regenerated.
- Excluded with reason (PD-6): banners and slides (plain text via textContent).

## Version assertions updated

- `test/healthz-readiness.test.js:119` and `:127` (and the test title) — literal `1` -> `migrate.latestVersion('deal')`. Line 119 (the per-file `userVersion` check) also failed and was changed; the plan named only :127.
- `test/schema-migrations.test.js:201` — demo.db literal `1` -> `migrate.latestVersion('deal')`.
- Control-family / runtime / committed-control-implied assertions unchanged.

## Verification

- `node --test test/resanitize-migration.test.js test/schema-migrations.test.js test/healthz-readiness.test.js`: 30/30.
- Full `node --test` run twice: tests 1508, pass 1508, fail 0 (base was 1500; +8 new). `git status --porcelain -- data public/sent_emails` empty; demo.db/control.db sha256 identical before/after.
- Dev boot against the committed data/demo.db (child without NODE_TEST_CONTEXT) answers `/healthz` 200 with `versions.deal.version` 2 (not implied) and does not change the file's bytes.

## Deviations from Plan

1. **[Rule 1 - interpretation] Version bump.** The plan says changed rows get their record version "bumped by the store's own rule". The store's rule stamps `version` only on `VERSIONED_COLLECTIONS` members; `pages` and `courses` are last-writer-wins documents (D-06) and are not members, so no version is stamped (a test asserts none is invented). The bump (`comparableVersion + 1`) is coded behind `VERSIONED_COLLECTIONS.has(table)` so it applies if either table is ever versioned.
2. **[Rule 1 - bug] Log named the deal file.** The first version logged the file basename, which broke the existing boot-sweep contract (healthz-readiness: logs name no deal id). Fixed to `demo.db` / `deal-file#<digest>`.
3. **Dev-boot side effect (pre-existing).** A boot's `openDbFile` chmods `data/demo.db` to 0600 locally (git ignores the mode); not caused by this plan.

## Notes (plan W-4)

- (b) Phase 23 CERT-02/03 byte-identity baselines must be computed from the regenerated `data/demo.db` (sha256 `dba58120...fecb3`), not the pre-13-05 file.
- (c) Release builds that copy `data/demo.db` (git-archive turnkey zips) are unaffected beyond shipping the regenerated file; no build-script changes.
- T-13-44: volume deal-file migration timing is for 13-14.

## Known Stubs

None.

## Threat Flags

None — no new network/auth/file surface.

## Self-Check: PASSED

- 002 module, regeneration script, test file present; commits `8b8b4cb`, `1bcb8fb`, `5ac6308` exist; `data/demo.db` at user_version 2.
