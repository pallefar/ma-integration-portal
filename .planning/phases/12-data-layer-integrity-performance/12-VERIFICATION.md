---
phase: 12-data-layer-integrity-performance
verified: 2026-10-10T21:45:00Z
verified_commit: a53d9b324c8fe4fb8a86688837952fbb2f2a6eef
verification: automated, Fable-reviewed
verifier_model: Claude Fable 5.1 (gsd-verifier, independent of executors; Fable reviewers 12-REVIEW / 12-REVIEW-B were also Fable 5.1)
status: gaps_found
score: 5/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification: false
suite: { tests: 1458, pass: 1458, fail: 0, cancelled: 0, runs: 1, duration_s: 141, host_load_1m: "28 -> 66 (another agent's node --test ran concurrently)" }
decision_coverage: { honored: 0, total: 0, not_honored: [], note: "gate could not parse 12-CONTEXT.md decisions block (prose, not list) — warning only" }
gaps:
  - truth: "SC2 / PRD acceptance 2 / DATA-02: event-loop p99 <= 100 ms under the 40-client review profile"
    status: failed
    reason: "The committed 3-run profile measures 86.3 / 112.2 / 133.0 ms (evidence/perf.log, PD-13 requires every run); runs 2-3 are over budget. No code on HEAD changes the RAID write/list cost the profile exposes (12-REVIEW-FIX touched durability, not this path). Not re-measured by the verifier: host load 13-66 during this verification, and the budget may only be measured on a quiet host."
    artifacts:
      - path: "db/store.js"
        issue: "POST /api/raid parses + re-serialises the whole loaded RAID lane per write (~13 ms main-thread at 5.3k rows per evidence/perf-summary.md)"
      - path: "server.js"
        issue: "GET /api/raid unparameterised body: SELECT + json_extract + SHA-1 ETag over a 1.7-3 MB body on the main thread"
    missing:
      - "Orchestrator decision recorded in PRD/ROADMAP (PRD: budgets may not be loosened without a recorded decision): (1) single-record write path for RAID/task create/update/delete, or (2) cheap ETag / Buffer send on the list, or (3) restate the profile (fresh deal per run or the paged form) — then `npm run perf -- --assert` must print PERF PASS on a quiet host in all 3 runs"
  - truth: "PRD acceptance 7: Phase 9/10 walks unchanged"
    status: partial
    reason: "Phase 9 walk (normal lane) 320 PASS / 30 FAIL — all 30 are the `asset-stamps` scenario pinning numeric hand stamps that D-12-07 replaced by content hashes (evidence/phase9-walk.log). The behaviour that scenario protects (the page requests the current asset, never a stale one) is proven by stronger invariants on HEAD: test/asset-cache-bust.test.js, test/asset-stamp-unit.test.js, scenario contentHashStamps, and this verifier's live probe (20/20 stamps == sha256(served bytes), WR-B01 404s)."
    artifacts:
      - path: "scripts/uat/phase9-scenarios (asset-stamps)"
        issue: "asserts 'one numeric stamp', 'stamp matches page on disk', 'stamp > pre-gap value' — superseded by D-12-07"
    missing:
      - "Either update the Phase 9 asset-stamps scenario to the content-hash contract (gap-closure edit, re-run `phase9-walk.js` to 350/0) or accept via a VERIFICATION override (suggested below)"
warnings:
  - "SC1 latency clause: verifier's `write-latency.js --assert` on HEAD measured POST /api/raid median 40.8 ms (p95 55.9) vs budget 40 — FAIL by 0.8 ms at host load 13-22 while another full suite ran on the same disk. Same-day measurements on the same tree: 27.6 ms (12-REVIEW-FIX, --n=41, load 55) and 14.3 ms pre-WR-01. WR-01 (synchronous=FULL + fullfsync on audit files) consumed most of the margin; the budget now holds only on a quiet host. Counts are load-independent and verified (1.0 row/create, 0/reorder). Re-measure on a quiet host; consider recording the WR-01 cost against the budget."
  - "SC5 cold start: scripts/perf/pack-isolation.js warms up before measuring (deliberately excludes 'cold worker start + canvas/font load'), and GET /api/reports/pack calls getReportPack() — a lazy require of lib/reportPack (+ @napi-rs/canvas) ON THE MAIN THREAD — on first use. The verifier observed ONE 2,628 ms /healthz stall during the first pack render of a fresh process (host load 34; steady-state rounds measured 10.8-20.9 ms p99 by the committed script). D-12-05's 'during a pack render p99 <= 50 ms' is proven for the steady state only; the first render per process is not covered. Suggested: load the renderer probe inside the worker (or at boot, off the request path) and add a cold-start round to pack-isolation.js."
  - "SC7 soak on HEAD: `npm run soak` was NOT re-run by the verifier (host load 30-66; the concurrent refresh agent is re-running it). evidence/soak.log (8,403 acked / 0 lost / 0 committed-but-unaudited / chain check 10) was produced on the pre-fix tree e76c29c+. The fix tree changed audit durability (FULL+fullfsync) and migration fail-closed only; the store-level atomicity the soak proves was re-proven live here (busy + sealed partition roll the deal write back; identical retry writes exactly once)."
  - "QUAL-02 browser smoke and the Phase 9/10 Playwright walks were not re-executed by the verifier (Playwright, host load); SC8 relies on test/smoke-harness.test.js (in the 1458) + evidence/smoke.log from the pre-fix tree."
  - "data/demo.db-shm and control.db-shm mtimes moved during this verification (23:28) while the committed bytes stayed identical to HEAD — consistent with the concurrent perf harness's read-only `openReadOnlySnapshot` opens of the committed files, not with a write."
suggested_overrides:
  - must_have: "PRD acceptance 7: Phase 9 walks unchanged (asset-stamps scenario)"
    reason: "D-12-07 replaced numeric hand stamps with content hashes by locked decision; the scenario's three numeric assertions are superseded, its intent is covered by test/asset-cache-bust.test.js + contentHashStamps + the verifier's live probe"
    accepted_by: "<orchestrator/user>"
    accepted_at: "<ISO timestamp>"
human_verification: []
---

# Phase 12: Data-Layer Integrity & Performance — Verification Report

**Phase goal (ROADMAP):** Writes and audit rows are proportional to what changed and reads to what was asked; schemas evolve safely; the audit has a retention model; heavy CPU work cannot freeze the portal; the test suite is a signal you can trust and the UI has a smoke net.
**Verified commit:** `a53d9b3` (plans 12-01..12-15 + Fable review fixes `2a19082..a197b79` merged) · **Verified:** 2026-10-10 21:45Z · **Status:** gaps_found · **Re-verification:** no (initial)

## Executive verdict

The data layer does what the contracts say, and the verifier re-proved it on this tree rather than reading summaries: 1458/1458 tests green in one run under heavy host load; a store-level probe on an isolated real-mode tree showed one create = exactly one chained audit row, a reorder = zero rows with byte-identical blobs, a BUSY or SEALED partition rolls the deal write back and the identical retry lands exactly once; a live HTTP probe on an isolated `MA_MODE=real` server showed v0 deal files migrating at boot, a garbage `control.db` keeping the instance not-ready and fail-closed, CR-01 case-variant ids answering a uniform 404 everywhere, the seal → export → purge gates in the documented order, `audit-verify --all` with `sealed-sha=match`, clean-room holding through the paged list / `q` / DD workspace / CSV export for an uncleared member, every `?v=` stamp equal to sha256 of the served bytes with dot-segment spellings answered 404, and the second concurrent pack refused 429. Three mutations of the highest-risk guards (audit append outside the transaction, version WHERE removed, clearance skipped on the paged list) were each killed by the named proof tests in a throwaway copy. All 16 review findings are fixed (15) or accepted with a reason (1), each with a regression test.

**Two items keep the phase from `passed`, both already reported honestly by plan 12-14 and unchanged on HEAD:** the 40-client event-loop p99 budget (≤ 100 ms) fails in runs 2-3 of the committed profile (112 / 133 ms) — a real DATA-02 / SC2 / acceptance-2 miss that needs a recorded orchestrator decision, not a measurement artefact; and PRD acceptance 7's literal "Phase 9 walks unchanged" conflicts with D-12-07 (30 numeric-stamp assertions now fail by design). Two warnings are new from this verification: the write-latency budget's margin is nearly gone after WR-01 (40.8 ms measured under contention), and the pack's first render per process loads the renderer on the main thread outside what the committed measurement covers (one 2.6 s stall observed).

## Observable truths (ROADMAP SC1–8)

| # | Truth | Status | Evidence (verifier's own runs unless marked) |
|---|---|---|---|
| SC1 | 1k-task / 5k-RAID deal: one created record → exactly one audit row; median write ≤ 40 ms | ⚠ UNCERTAIN (counts ✓, latency not confirmed) | `write-latency.js --assert` on HEAD: audit rows/create **1.0** (RAID and task), reorder **0** rows + order persisted ✓; medians RAID **40.8 ms** (p95 55.9) ✗ by 0.8 ms, task 11.0 ms ✓ — host load 13-22 with a concurrent full suite on the same disk. Same tree earlier: 27.6 ms (12-REVIEW-FIX). Store probe at small volume: +1 / +0 / +0 (reorder) exact. |
| SC2 | RAID/task lists page + filter server-side; DD workspace one request; 10×3 p95 ≤ 300 ms; event-loop p99 ≤ 100 ms under the 40-client profile | ✗ FAILED (p99 clause) | Live: `/api/raid` no params → bare array (33); `?limit=5` → `{items:5,total:33}`; `?limit=abc` → 400 `{error:'Invalid list query.'}`; `/api/integration-tasks?limit=5` → `{items,total}`; `/api/dd/workspace` one response with areas/itemsByArea/findingsByArea/mine ✓. p95 145-158 ms (evidence/perf.log, pre-fix tree) ✓. **p99 86.3 / 112.2 / 133.0 ms ✗** (evidence/perf.log + perf-summary.md; PD-13 = every run). Not re-measured (host load). |
| SC3 | Every DB file reports a schema version; seeded old-version file (incl. legacy audit) migrates at boot; broken migration ⇒ not-ready | ✓ VERIFIED | Live: `/healthz` → `versions: control/deal/runtime/audit = 1`; a registered deal file reset to `user_version=0` is at **1 after boot with no request**; garbage `control.db` → instance listens, `/healthz` **503 not-ready** `{family:control, reason:integrity-check-failed}`, login → 503 (never 2xx), no path/id in the body. `legacy-audit-migration.js --rows 3000`: 750 partitions, 2265+559+176 rows accounted, `audit-verify --all` 752 files OK. Suite: schema-migrations (broken migration sticky not-ready, two-process single run, backup refusal), audit-legacy-migration (crash rerun idempotent, WR-02 fail-closed ×2). |
| SC4 | Hash-chained per-deal partitions; seal → SHA-256 control event + read-only; CLI verify; purge refused without sealed export + retention; viewer across partitions | ✓ VERIFIED | Live: audited write creates `audit/<dealId>.db`; seal on ACTIVE deal → 409 `deal-active`; after archive: seal → 200, file **0400**, `sha256 == fs sha256 == the ONE audit-partition-sealed event`, re-seal idempotent (`alreadySealed:true`, no 2nd event), status `sealed:true fileMatchesSeal:true writable:false`; purge → 409 `not-sealed` (before seal) → 409 `no-sealed-export` → export 200 NDJSON (+ `-export-started`, `-exported` events) → purge 409 `retention-never`; `audit-verify --all` exit 0 `sealed-sha=match`; store probe: flipped byte → CLI exit 1 `row-hash-mismatch`; viewer `?deal=` rows tagged `control` + `<dealId>`. CR-01: 6 case-variant spellings → uniform 404, file mode unchanged, non-admin 403. Mutation M1 (append outside txn) killed by partitions (c)/(i). |
| SC5 | Pack render leaves other requests' p99 ≤ 50 ms; second concurrent request refused or queued | ✓ VERIFIED (steady state; cold-start warning) | `pack-isolation.js --assert` on HEAD: 3 rounds A=200 `%PDF-`, B=**429 Retry-After=5**, worst event-loop p99 **20.9 ms** (budget 50, baseline 2,397). Live probe: 200 PDF (226 kB) + 429, slot released (next render 200). ⚠ one 2,628 ms `/healthz` stall during the FIRST render of a fresh process — `getReportPack()` lazy-requires the renderer on the main thread; the committed script warms up first (see warnings). Client never retries `retryable:false` 503: client-busy-retry + cpu-isolation tests (in suite). |
| SC6 | 20 consecutive green runs; no test writes `data/audit.db`/`runtime.db`; changed asset without bumped stamp fails the suite; GitHub Actions on ubuntu + windows | ✓ VERIFIED | Verifier: 1 run 1458/1458 on HEAD; `data/audit.db` (86 MB, mtime 16:59) and `runtime.db` (14:16) untouched by the 23:26 run; committed `demo.db`/`control.db` sha256 == `git show HEAD:` after everything. evidence/gate.log 20×1445 (pre-fix tree). test-isolation-guard (default-path open fails loudly), asset-cache-bust negative control (invariant FAILS with the rewrite removed), ci-workflow (text: ubuntu-24.04 + windows-latest, Node 22, read-only token, no install). Workflow execution unverified until first push (CERT-05, accepted). |
| SC7 | `npm run soak` (0 lost, 0 committed-but-unaudited) and the Phase 9 contract suite pass unchanged; reorders persist via sequence without audit rows | ⚠ UNCERTAIN (soak on HEAD not re-run) | `git diff --name-status 88cab66..HEAD -- test/`: none of `optimistic-locking-*`, `concurrency-*`, `busy-503-contract`, `clearance-write-paths`, `denial-audit`, `no-get-mutates`, `read-policy-*` modified; all green in the 1458. Reorder: 0 rows + persisted (store probe, write-latency). Soak: evidence/soak.log PASS on pre-fix tree; refresh pending on HEAD. Mutation M2 (version WHERE) killed by 5 Phase-9/12 tests. |
| SC8 | One command runs the browser smoke harness (browser + axe) over the first IL pages; excluded from release zips | ✓ VERIFIED (structural + prior run) | `package.json` `smoke`; `.gitattributes` `scripts/smoke/ export-ignore` (+ `scripts/perf/` after IN-B05); test/smoke-harness.test.js (registry, widths, export-ignore via `git archive`, zero-install resolver) in the 1458; evidence/smoke.log 12 visits / 0 errors. Browser run not repeated by the verifier. |

**Score:** 5/8 verified · 2 uncertain (SC1 latency, SC7 soak-on-HEAD) · 1 failed (SC2 p99)

## PRD acceptance 1–7, requirements, decisions

| Item | Verdict | Where proven |
|---|---|---|
| Acc 1 | counts ✓ / latency ⚠ | SC1 |
| Acc 2 | ✗ p99 (paging, DD one-request, p95 ✓) | SC2 |
| Acc 3 | ✓ | SC3 |
| Acc 4 | ✓ | SC4 |
| Acc 5 | ✓ (cold-start ⚠) | SC5 |
| Acc 6 | ✓ | SC6 (+ smoke SC8) |
| Acc 7 | ✗ partial — walks: Phase 10 runner 695/0 and Phase 9 `--demo-open` 18/0 ✓; Phase 9 normal 320/30, all 30 = `asset-stamps` (D-12-07 conflict, override suggested) | gaps |
| DATA-01 | ✓ (latency ⚠) | SC1, SC7 |
| DATA-02 | ✗ | SC2 |
| DATA-03 | ✓ | SC3 |
| DATA-04 | ✓ | SC4; DEPLOYMENT.md audit-trail section (purge path, TE legal owns retention, never auto-purge; `routes (g)` structural no-timer test) |
| DATA-05 | ✓ (cold-start ⚠) | SC5 |
| DATA-06 | ✓ | SC6 |
| QUAL-01 | ✓ | live stamps probe 20/20 + WR-B01 404s; asset-cache-bust + asset-stamp-unit |
| QUAL-02 | ✓ | SC8 |
| D-12-01..08 | 01 ✓ · 02 ⚠ (PD-20 recorded narrowing of the write-handler clause + p99 gap) · 03 ✓ · 04 ✓ · 05 ✓ · 06 ✓ · 07 ✓ · 08 ✓ | 12-VALIDATION.md inventory cross-checked against the code paths exercised above |
| PD-1..31 | all honoured as recorded in 12-VALIDATION.md; PD-1/PD-7/PD-9/PD-10/PD-12/PD-17/PD-24/PD-27/PD-29 re-proven live by this verifier | — |

## Verifier's own runs (not taken from summaries)

| Check | Command | Result |
|---|---|---|
| Full suite | `node --test` (HEAD, load 28→66) | 1458 pass / 0 fail / 0 cancelled, 141 s |
| Store probe | isolated `MA_MODE=real` tree, `db/store` + `auditHook` + `audit-verify.js` | 11/11: +1/+0/+0 rows; BUSY → `SQLITE_BUSY` after 1.1 s, deal row absent, retry → exactly once; SEALED → `AUDIT_PARTITION_SEALED`, row absent; flipped byte → CLI exit 1; control chain verifies |
| HTTP probe | isolated `MA_MODE=real` `node server.js` child ×3 | 22/23 — the one miss is the probe's own `refs > 20` threshold (20 refs, 0 mismatches); every product assertion passed |
| write-latency | `scripts/perf/write-latency.js --assert` | RAID median 40.8 ms ✗ (budget 40), tasks 11.0 ✓, 1.0 row/create, reorder 0 — contended host |
| pack-isolation | `scripts/perf/pack-isolation.js --assert` | PASS: worst p99 20.9 ms, B=429 in 3/3 rounds |
| legacy migration | `scripts/perf/legacy-audit-migration.js --rows 3000` | REHEARSAL verify=OK, accounting=OK, 752 files verify, scratch removed |
| Mutation M1 | copy: audit append moved after COMMIT | partitions (c) + (i) FAIL → guard is load-bearing |
| Mutation M2 | copy: version WHERE replaced by `(? IS NOT NULL OR 1)` | 5 tests FAIL (CR-01 a/b/d, WR-04 c, dirty-rows rollback) → guard is load-bearing |
| Mutation M3 | copy: paged RAID list bypasses clearance | raid-list-query (e)(f)(i)(k) FAIL → clearance-before-paging is load-bearing |
| Committed DBs | sha256 vs `git show HEAD:data/{demo,control}.db` | identical before and after every run |
| Not run | `npm run soak`, `npm run perf` load-40, `npm run smoke`, Phase 9/10 walks | host load 13-66 throughout; concurrent refresh agent re-running them; evidence/ figures (pre-fix tree) used and labelled as such |

## Review remediation (12-REVIEW + 12-REVIEW-B → 12-REVIEW-FIX)

16 findings: CR-01 (case-variant seal of an active deal) **fixed** `2a19082` and re-proven live here (6 variants → 404, exact id → 200, active → 409 deal-active); WR-01 durability `15d989d` (FULL+fullfsync on audit files — see latency warning); WR-02 fail-closed migration `739a648` (precheck before backup; tests WR-02 ×2); WR-03 export attempts audited `145f5c1` (re-proven: `-export-started` + `-exported`); IN-01 `/healthz` count removed `da61b1a` (re-proven: no `files`); IN-02, IN-03; WR-B01 terminal HTML middleware `c2d8f2a` (re-proven: 4 non-canonical spellings → 404); WR-B02 `npm run perf` asserts `713cbd9`; WR-B03, IN-B01..B05 fixed; IN-B06 accepted with reason (fail-closed malformed `clearanceArea`, DEPLOYMENT.md). No finding deferred without a reason/phase. Suite 1445 → 1458.

## Anti-pattern scan (diff `88cab66..HEAD`, excluding `.planning`, `node_modules`)

No TODO/FIXME/XXX/TBD/HACK in phase-changed source; the two "coming soon" hits in `public/js/employee.js` are pre-existing demo copy, not phase-12 code. No `.skip`/`.todo` in phase tests except a platform-conditional `t.skip` (symlink creation) and a win32-gated case in `audit-partitions (j)`. Test quality: expected values come from independent re-statements (e.g. `expectedVisible()` rule, byte-identity against `JSON.stringify` of rows read straight from the file, sha256 recomputed by the test), not from the system under test; negative controls exist for the stamp invariant and the perf runner; mutation checks above confirm the proofs are load-bearing.

## Gaps summary

1. **SC2 / DATA-02 / acceptance 2 — load-40 event-loop p99 (BLOCKER for `passed`).** 86.3 / 112.2 / 133.0 ms vs ≤ 100 ms in every run. Root cause profiled by 12-14: a RAID write re-parses/re-serialises the whole loaded lane; the unparameterised list hashes and encodes a 1.7–3 MB body per call. Fix direction is a recorded decision among the three options in `evidence/perf-summary.md`; the budget may not be loosened silently (PRD).
2. **Acceptance 7 — Phase 9 `asset-stamps` scenario (WARNING-level, decision needed).** Literal conflict with D-12-07; intent proven. Update the scenario or record the suggested override.

## Residual risks for Phase 23 (release / certification)

- Write-latency budget margin after WR-01: ~40 ms median on a contended laptop disk; on the shared host measure with `--n=41` on a quiet machine and record the number beside CERT-02.
- Pack cold start: first render per process loads the renderer on the main thread (one 2.6 s stall observed); steady state is 11–21 ms p99. Move the probe/require into the worker or boot.
- CI workflow executes for the first time on push (ubuntu-24.04 glibc ≥ 2.38 floor, windows read-only-attribute semantics for sealed partitions untested).
- Accepted residuals carried in DEPLOYMENT.md: tail truncation of an unsealed partition undetectable (T-12-73); MNPI remains in the control audit after a purge (T-12-124, TE legal); malformed `clearanceArea` hidden from admin too (IN-B06).
- Suite flakes under extreme host load (soak-correlator orphaned grandchildren, two login/read-policy HTTP suites) — recorded in evidence/gate-attempt*.log; none fired in this verification's run.

---
_Verified: 2026-10-10T21:45:00Z · Verifier: Claude Fable 5.1 (gsd-verifier) · Nothing committed; only this file written._
