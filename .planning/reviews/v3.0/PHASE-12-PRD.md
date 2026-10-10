# Phase 12 — Data-Layer Integrity & Performance — PRD / locked decisions (orchestrator, 2026-10-10)

Input for `/gsd-plan-phase 12 --prd` (research/UI-spec skipped). Requirements: DATA-01..06, QUAL-01, QUAL-02.
Depends on Phase 11. Evidence: R1-07, R2-01, R2-02, R2-03, R2-08, R2-10, R5-01..R5-05, R5-14, PLAN-REVIEW PR-09/13/20/21,
`.planning/reviews/v3.0/R2-ops-data-deploy.md`, `R5-quality.md`. Budgets are fixed now (not at plan time) and may not be loosened
without a recorded decision.

## Problem (measured by the review)
`writeDb()` rewrites and audits EVERY row of EVERY collection on each write (99.96 % of audit rows byte-identical; 6,220 rows /
3.6 MB per click at 1k tasks + 5k RAID; median write 86–97 ms); `readDb()` loads all 43 collections per request (134 call
sites; GET /api/raid 1.6 MB unpaginated; DD page = 18 requests/load; event-loop p99 1.9 s under 40 clients); steerco pack and
pdf-parse block the event loop 2–4 s for any role; no schema versioning; audit is one append-only file with no retention
or tamper evidence; 16 test files write the real data/audit.db + runtime.db; JS is cached 30 days behind hand-edited `?v=`.

## Locked decisions
**D-12-01 Dirty-row writes (DATA-01).** `db/store.js writeDb()`: non-versioned collections skip UPDATE + audit delta when the
serialized row equals the prior raw; versioned collections drop the "untouched row re-UPDATE + delta" branch; pure reorders
update `seq` only (persisted, no blob rewrite, no audit delta). Preserve: Phase 8 audit-inside-the-immediate-transaction
(CR-01), Phase 9 version WHERE semantics and CR-01 conflict-body filtering, untouched rows never clobber a concurrent
writer. Proof: one changed record ⇒ exactly one audit row on the 1,000-task / 5,000-RAID deal; median write ≤ 40 ms
(baseline 86–97 ms); `npm run soak` (0 lost, 0 committedButUnaudited) and the whole Phase 9 contract suite pass UNCHANGED.
**D-12-02 Reads (DATA-02).** `readCollections([...names])` (single prepared SELECT per collection, same row shape as readDb);
convert the hot GET handlers (raid, integration-tasks, notifications, synergies/rollup, dd/*, org/*, reports, dashboards) and
write handlers that only need a few collections. Server-side filter + paging for RAID and tasks (`?status&owner&workstream&
phase&q&limit&offset`; response keeps the existing array shape when no query params are sent — non-breaking; with `limit` it
returns `{items,total}`). DD workspace one-request endpoint `GET /api/dd/workspace` (all areas, clearance-filtered) and the
DD page uses it (18 → 1). Budgets: 10 users × 3 list reads at volume p95 ≤ 300 ms (baseline 483 ms); event-loop p99 ≤ 100 ms
under the 40-client review profile (baseline 1,921 ms).
**D-12-03 Schema versions + integrity (DATA-03).** `PRAGMA user_version` per database file; ordered migrations
`db/migrations/<family>/NNN-<slug>.js` applied inside `openDbFile()` under `BEGIN IMMEDIATE`; `PRAGMA quick_check` on open for
non-audit files; a failed migration/check marks the instance not-ready (exposed as a process-level `readiness` object that
`/healthz` already reports — `/readyz` itself is Phase 20); migration of the legacy single audit file is migration #1 of the
audit family. Test: a seeded old-version file migrates at boot; a deliberately broken migration keeps the instance not-ready.
**D-12-04 Audit partitions (DATA-04, supersedes AUD-02).** Per-deal audit partitions `data/audit/<dealId>.db` (real-mode data
dir aware) with hash-chained rows (`prev_hash`,`row_hash` = sha256 over canonical JSON of the row + prev_hash); control-plane
events stay in `audit.db`. Admin actions (routes + CLI under scripts/): **seal** (partition chmod 0400, SHA-256 of file recorded
as a control-plane security event), **export** (JSONL), **verify** (`scripts/audit-verify.js` walks the chain), **purge**
(refused unless a sealed export exists AND the retention period — config, default "never" — has elapsed; each step a control-
plane event). The admin audit viewer queries across partitions (+ control events). Existing legacy rows: migration moves
per-deal rows into partitions when the deal still exists, otherwise they stay in a read-only `legacy` partition. NEVER
auto-purge. Document the MNPI purge path and retention decision (TE legal owns the period) in DEPLOYMENT.md.
**D-12-05 CPU isolation (DATA-05).** Steerco pack rendering and pdf-parse run in a `worker_thread` (or child process) behind a
1-in-flight-per-route guard (second concurrent request → 429 + Retry-After, never queued unboundedly); during a pack render
other requests' event-loop p99 ≤ 50 ms (baseline 2,397 ms blocked); the permanent "pack unavailable on this platform" 503 carries
a body marker the client busy-retry does NOT retry.
**D-12-06 Test signal (DATA-06).** Loopback binding is DONE (b6911cf). Add: a guard in db/dbFiles.js that under
`NODE_TEST_CONTEXT` refuses the default `data/` paths (fail loudly) and fix the 16 leaking test files (MA_AUDIT_DB_PATH etc.);
`.github/workflows/test.yml` (ubuntu + windows, Node 22, `node --test`; no TE-IT dependency); an npm script that runs suite
twice + soak smoke. Also a regression test that `GET /healthz` reports the readiness object.
**D-12-07 Cache-bust by content (QUAL-01).** Replace hand-edited `?v=` stamps with a serve-time rewrite: HTML responses get
`?v=<content-hash>` for local js/css (hash cached per file by mtime; HTML stays `no-cache`); keep static assets long-cached;
update test/asset-cache-bust.test.js to assert hash == stamp (and fails if the rewrite is removed). No build step.
**D-12-08 Smoke harness (QUAL-02).** `scripts/smoke/` Playwright + axe-core (resolved from the local npx cache or a documented
global install; NOT added to node_modules) driven by `npm run smoke`: login, dashboard/deal-home, execution, due-diligence, org,
admin Users in real-deal lane at 1440 and 390; prints axe critical/serious counts (informational now, gating in Phase 19);
excluded from release zips later. Later UI phases append their pages.

## Out of scope
Authorization policy (done in 11), module switch (15), IL features (17/18), `/readyz` + graceful shutdown (20), i18n/a11y
fixes (19), real CI provider beyond the workflow file.

## Acceptance
1. 1k-task/5k-RAID deal: create one record ⇒ exactly 1 audit row, median write ≤ 40 ms; reorder persists with 0 audit rows.
2. GET /api/raid?limit=50 returns {items,total}; no params ⇒ unchanged array; DD page makes 1 request; p95 ≤ 300 ms and
   event-loop p99 ≤ 100 ms under the review profiles (scripts committed under scripts/perf/).
3. Old-version DB files (control/runtime/deal/audit) migrate at boot; broken migration ⇒ not-ready.
4. Seal ⇒ read-only + control event; verify detects a flipped byte; purge refused without sealed export/retention; viewer spans partitions.
5. Pack render does not stall other requests (p99 ≤ 50 ms); second concurrent pack ⇒ 429.
6. Suite 20× consecutive green; no test touches data/audit.db|runtime.db; asset stamp == content hash test; workflow file present; smoke harness runs green once.
7. `npm run soak` + Phase 9/10 contract suites + Phase 9/10 walks unchanged; demo showcase unchanged.
