---
phase: 9
slug: optimistic-locking-conflict-recovery
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-11
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

Filled by Plan 07 (Task 3) against what was actually built across all seven plans of this
phase, not against what was originally planned — see the "as-executed" notes inline where the
executed shape diverged from 09-RESEARCH.md's own Validation Architecture section.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node's built-in runner) |
| **Config file** | none — `node --test` auto-discovers `test/*.test.js`; no `.mocharc`/`jest.config` in this repo |
| **Quick run command** | `node --test test/optimistic-locking-contract.test.js` |
| **Full suite command** | `npm test` (`node --test`, discovers every `test/*.test.js`) |
| **Estimated runtime** | quick command ~1s (964ms observed, 52 subtests); full suite ~9.7s (9691ms observed, 861/861 after the gap closure; 9.5s and 775/775 before it); `npm run soak` ~15-20s at `SOAK_DURATION_MS=15000` (smoke config) or ~2min at the default `SOAK_PROCESSES=3`/`SOAK_DURATION_MS=120000` release-gate config; the full browser walk (`scripts/uat/phase9-walk.js`, 25 scenarios + integrity) takes a few minutes and the demo run well under a minute (the walk is a phase-gate proof, not part of the commit loop) |

---

## Sampling Rate

- **After every task commit:** `node --test test/optimistic-locking-contract.test.js` (fast, no cross-process spawn — ~1s)
- **After every plan wave:** `npm test` (full suite, includes the cross-process proof — ~9.5s)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Phase gate:** `npm run soak` (Phase 8's real-server multi-process harness, extended by this plan to be conflict-aware) — zero lost writes, zero violations, one-to-one audit reconciliation, 409 count reported as its own line
- **Max feedback latency:** ~10 seconds (the full suite, the slowest sampling point on the commit/wave cadence — the soak is phase-gate-only, not part of the commit loop)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | CONC-02 | T-09-01 / T-09-02 / T-09-03 / T-09-04 / T-09-08 | A stale-version RAID write is rejected 409 (fixed body, no leaked detail, transactional rollback); a current-version write succeeds and bumps the version by exactly one | integration | `node --test test/optimistic-locking-contract.test.js` | ❌ W0 (file created this task) | ✅ green |
| 09-01-02 | 01 | 1 | CONC-02 | T-09-05 / T-09-06 / T-09-07 | The client's 409 branch never auto-retries; the conflict dialog renders every dynamic value via `textContent`, never markup | unit (node:vm-adjacent, structural grep) | `node --test test/client-xss-sinks.test.js` | ✅ (pre-existing) | ✅ green |
| 09-01-03 | 01 | 1 | CONC-02 | T-09-02 | Two real OS processes racing the SAME record produce exactly one commit and one typed conflict; two racing DIFFERENT records both commit — per-record, not per-collection, granularity | e2e (spawned cross-process) | `node --test test/optimistic-locking-cross-process.test.js` | ❌ W0 (file created this task) | ✅ green |
| 09-02-01 | 02 | 2 | CONC-02 | T-09-09 / T-09-12 | Integration-task and synergy-initiative main upserts enforce the version precondition before any field assignment; the query-channel bounds check rejects a non-integer/negative value with 400 before any mutation | integration | `node --test test/optimistic-locking-contract.test.js` | ✅ | ✅ green |
| 09-02-02 | 02 | 2 | CONC-02 | T-09-10 / T-09-11 | All seven synergy sub-routes enforce the same precondition; the pre-existing unrecognized-stage 409 stays provably distinguishable from a conflict 409 | integration + structural | `node --test test/optimistic-locking-contract.test.js` | ✅ | ✅ green |
| 09-03-01 | 03 | 2 | CONC-02 | T-09-13 | The diff-list's edge states (empty/partial/overflow/long-text/non-string) render via `textContent` only, no markup sink introduced | unit (regression) | `node --test test/client-xss-sinks.test.js` | ✅ (pre-existing) | ✅ green |
| 09-03-02 | 03 | 2 | CONC-02 | T-09-14 / T-09-15 / T-09-16 | A second conflict re-renders in place (never a stacked overlay, never an auto-retry); a marker-less 409 passes through untouched | unit (node:vm sandbox) | `node --test test/client-conflict-dialog.test.js` | ❌ W0 (file created this task) | ✅ green |
| 09-03-03 | 03 | 2 | CONC-02 | T-09-13 / T-09-14 | Visual/interactive correctness of the rendered dialog (diff rows, orange-only-on-apply, form preservation, in-flight/error states, viewport widths, attribution fallback) | manual (human browser walk — see Manual-Only Verifications) | none — `type="checkpoint:human-verify" gate="blocking"` | n/a | ✅ APPROVED by user 2026-08-11 |
| 09-04-01 | 04 | 3 | CONC-02 | T-09-17 / T-09-18 / T-09-19 / T-09-21 | DD finding/request-item conflict bodies pass through the same area-clearance filter the route's own read path applies; `conflictIfStale()` runs strictly after `ddAreaRefused()` (anti-enumeration ordering) | integration + structural | `node --test test/optimistic-locking-contract.test.js` | ✅ | ✅ green |
| 09-04-02 | 04 | 3 | CONC-02 | T-09-20 | A stale finding-to-task/RAID convert rolls back the finding update, the task insert, the RAID insert and the audit append together — no orphan rows | integration | `node --test test/optimistic-locking-contract.test.js` | ✅ | ✅ green |
| 09-05-01 | 05 | 4 | CONC-02 | T-09-22 / T-09-23 / T-09-25 | Org-position/flight-risk conflict bodies are gated by the route's uniform `hr` area grant; the version precheck sits before `positionGraphFailure()`; the org-decisions append-only exemption is recorded in code with a cited reason | integration + structural | `node --test test/optimistic-locking-contract.test.js` | ✅ | ✅ green |
| 09-05-02 | 05 | 4 | CONC-02 | T-09-24 | A stale flight-risk-to-task/RAID convert rolls back the entry update, the task insert, the RAID insert and the audit append together — no orphan rows | integration | `node --test test/optimistic-locking-contract.test.js` | ✅ | ✅ green |
| 09-06-01 | 06 | 5 | CONC-02 | T-09-26 / T-09-27 / T-09-28 | All seven in-scope DELETE routes enforce `?expectedVersion=`; the two DD delete routes carry the same clearance filter as their POST siblings; every precheck sits after its route's role/area gate | integration + structural | `node --test test/optimistic-locking-contract.test.js` | ✅ | ✅ green |
| 09-06-02 | 06 | 5 | CONC-02 | T-09-29 / T-09-30 | The stale-delete dialog is itself the destructive confirmation (no `window.confirm()` stacked on it); the destructive action only re-fires on a human click, never a timer | unit (node:vm sandbox) + structural grep | `node --test test/client-conflict-dialog.test.js` | ✅ | ✅ green |
| 09-06-03 | 06 | 5 | CONC-02 | T-09-26 / T-09-28 | The four client delete call sites that genuinely have UI (RAID/task/synergy/org position) thread the held record's version as `?expectedVersion=` | integration (regression) | `npm test` | ✅ | ✅ green |
| 09-07-01 | 07 | 6 | CONC-02 | T-09-31 / T-09-32 / T-09-33 | A future route on a versioned collection that skips the version precheck fails the suite by default (structural scan, not a hand-maintained list); a missing demo/custom lane fails the suite; the two pre-existing unrelated 409s are provably distinguishable from a conflict, asserted as live behavior | structural (source scan) + integration (dual-lane) | `node --test test/optimistic-locking-contract.test.js` | ✅ | ✅ green |
| 09-07-02 | 07 | 6 | CONC-02 | T-09-34 | Per-record granularity is proven by real spawned processes on three collections plus a cross-collection case; the soak's reconciliation classifies 409 as its own outcome — never acknowledged, never lost | e2e (spawned cross-process) + e2e (real multi-process soak) | `node --test test/optimistic-locking-cross-process.test.js`; `npm run soak` | ✅ | ✅ green |
| 09-07-03 | 07 | 6 | CONC-02 | T-09-35 | This validation contract reflects what was actually built (executed SUMMARYs), not what was originally planned; compliance flags set only when the sign-off checklist genuinely passes | structural (frontmatter schema validation) | `node "$HOME/.claude/gsd-core/bin/gsd-tools.cjs" query frontmatter.validate .planning/phases/09-optimistic-locking-conflict-recovery/09-VALIDATION.md --schema validation` | n/a | ✅ green |
| 09-08-01 | 08 | 1 | CONC-02 | T-09-36 / T-09-37 | (tracer, R7 F-1) A never-edited RAID entry's first concurrent flip is caught: the client sends `version: 0`, the second writer gets 409 + dialog, the first writer's value survives; in real-deal mode an update with no precondition is refused 400 with exactly `{error, versionRequired}` | integration + e2e (real browser, two contexts) | `node --test test/optimistic-locking-precondition.test.js`; walk `--scenario raid-f1` | ❌ W0 (file created this task) | ✅ green (walk 2026-10-10: raid-f1 PASS) |
| 09-08-02 | 08 | 1 | CONC-02 | T-09-36 / T-09-37 | RAID delete path sends `expectedVersion` (0 for a never-edited record); a version-less delete is refused 400 `versionRequired`; entry survives both refusals | integration + e2e | `node --test test/optimistic-locking-precondition.test.js test/client-version-precondition.test.js`; walk `--scenario raid-delete-f1 --scenario api-version-required` | ❌ W0 (`test/client-version-precondition.test.js` created this task) | ✅ green (raid-delete-f1, api-version-required PASS) |
| 09-08-03 | 08 | 1 | CONC-02 | T-09-39 / T-09-40 | The test helper only fills an ABSENT precondition (never masks a client that omits it; H1 cross-checks the 23-route table against server.js); walk harness never opens the committed databases; the six RAID-affected suites are repaired; soak baseline sends `version: 0` | integration + structural | `node --test test/optimistic-locking-precondition.test.js test/optimistic-locking-contract.test.js test/dd-findings.test.js`; `npm test`; `SOAK_DURATION_MS=15000 npm run soak` | ❌ W0 (`test/helpers/held-version.js` created this task) | ✅ green |
| 09-09-01 | 09 | 2 | CONC-02 | T-09-36 / T-09-41 / T-09-40 | (tracer) Integration-task and synergy families refuse a version-less write 400 and enforce the stale check; their suites swept onto the held-version helper | integration | `node --test test/optimistic-locking-contract.test.js` + the synergy/task suites named in 09-09-PLAN Task 1; `npm test` | ✅ | ✅ green |
| 09-09-02 | 09 | 2 | CONC-02 | T-09-36 / T-09-40 | Org positions / flight-risk / flight-risk convert refuse a version-less write; org suites swept | integration | `node --test test/optimistic-locking-contract.test.js` + the org suites named in 09-09-PLAN Task 2; `npm test` | ✅ | ✅ green |
| 09-09-03 | 09 | 2 | CONC-02 | T-09-36 / T-09-44 / T-09-40 | DD request items, findings and convert refuse a version-less write with the same clearance parity as the 409 branch; remaining suites swept; cross-process + soak unchanged | integration + e2e (spawned) | `node --test test/optimistic-locking-contract.test.js` + the DD suites named in 09-09-PLAN Task 3; `npm test`; `node --test test/optimistic-locking-cross-process.test.js`; `SOAK_DURATION_MS=15000 npm run soak` | ✅ | ✅ green |
| 09-10-01 | 10 | 3 | CONC-02 | T-09-36 / T-09-42 / T-09-44 | (tracer) The strict rule is unconditional inside `conflictIfStale()` — no per-route opt-out can reappear; the CR-01 clearance arming order survives the new 400 return | integration + structural | `node --test test/optimistic-locking-precondition.test.js`; `node --test test/optimistic-locking-contract.test.js`; `npm test` | ✅ | ✅ green |
| 09-10-02 | 10 | 3 | CONC-02 | T-09-43 / T-09-44 / T-09-45 | Per-route proof of the 400 plus the probe edges: type-confusion values (`null`, `"1"`, -1, 1.5, empty/non-numeric query) are refused (body and `?expectedVersion=`); ordering (two stale holders reapplying in either order yield exactly one 200 and one fresh 409); idempotency (replayed success -> 409, replayed delete -> 404); adjacency (stored version 2: a precondition of 1 or 3 -> 409 with `currentVersion` 2, only 2 -> 200) | integration + e2e (spawned) | `node --test test/optimistic-locking-precondition.test.js`; `npm test`; `node --test test/optimistic-locking-cross-process.test.js`; `npm run soak` | ✅ | ✅ green |
| 09-11-01 | 11 | 2 | CONC-02 | T-09-47 / T-09-48 / T-09-50 | (tracer, R7 F-2) The wrapper holds the original call's promise: after "Apply my changes anyway" the page shows the SERVER's state, with no false self-conflict | unit (node:vm) + e2e (browser) | `node --test test/client-conflict-dialog.test.js test/client-busy-retry.test.js test/client-xss-sinks.test.js test/client-version-precondition.test.js`; walk `--scenario raid-f2-apply` | ✅ | ✅ green (raid-f2-apply PASS) |
| 09-11-02 | 11 | 2 | CONC-02 | T-09-46 / T-09-47 / T-09-48 | Session semantics: delete/deleted variants, bounded queue, settle-once, double clicks, network retry; a conflicted write is never auto-resubmitted | unit (node:vm) | `node --test test/client-conflict-dialog.test.js test/client-busy-retry.test.js test/client-xss-sinks.test.js`; `npm test` | ✅ | ✅ green |
| 09-11-03 | 11 | 2 | CONC-02 | T-09-46 / T-09-47 / T-09-50 | Browser proof on the RAID surface: apply, delete-anyway, third writer (in-place re-render), different records (no dialog) | e2e (browser) | walk `--scenario raid-f2-apply --scenario raid-f2-delete-anyway --scenario third-writer --scenario different-records` | ✅ | ✅ green (all four PASS) |
| 09-12-01 | 12 | 3 | CONC-02 | T-09-36 / T-09-49 | (tracer, R7 F-1 on tasks) A never-edited integration task's first co-edit is caught; Discard shows THEIRS, not the stale local copy | unit + e2e (browser) | `node --test test/client-version-precondition.test.js`; walk `--scenario task-f1-never-edited --scenario task-discard-keeps-theirs` | ✅ | ✅ green (both PASS) |
| 09-12-02 | 12 | 3 | CONC-02 | T-09-36 / T-09-49 / T-09-38 | Every remaining client call site sends the held version via `window.maVersionOf`; every page has a re-read path after a settled conflict | unit + structural | `node --test test/client-version-precondition.test.js test/client-conflict-dialog.test.js test/client-xss-sinks.test.js`; `npm test` | ✅ | ✅ green |
| 09-12-03 | 12 | 3 | CONC-02 | T-09-17 / T-09-49 / T-09-38 | Browser proof: synergy sub-route F-1, synergy header F-2, DD no refresh under the open dialog, org delete-anyway | e2e (browser) | walk `--scenario task-f1-never-edited --scenario task-discard-keeps-theirs --scenario synergy-stage-never-edited --scenario synergy-realized-f2 --scenario dd-f2 --scenario org-delete-anyway-f2` | ✅ | ✅ green (all six PASS) |
| 09-13-01 | 13 | 3 | CONC-02 | T-09-50 / T-09-53 | (tracer, R7 F-3) A synergy stage conflict shows a real "Stage" diff row (mine vs theirs), end to end | unit + e2e (browser) | `node --test test/client-conflict-dialog.test.js`; walk `--scenario synergy-stage-f3` | ✅ | ✅ green (synergy-stage-f3 PASS) |
| 09-13-02 | 13 | 3 | CONC-02 | T-09-50 / T-09-53 | Neutral panel when the payload cannot be compared (never "no conflicting fields" when it cannot tell), per-month phasing cells, display labels instead of raw keys | unit + e2e (browser) | `node --test test/client-conflict-dialog.test.js test/client-xss-sinks.test.js`; walk `--scenario confirm-current-neutral-f3 --scenario phasing-month-f3 --scenario labels-f5` | ✅ | ✅ green (all three PASS) |
| 09-13-03 | 13 | 3 | CONC-02 | T-09-17 / T-09-50 / T-09-51 / T-09-52 | Withheld-record variant (clearance-aware copy, null `currentRecord`), real 4xx reason on reapply (textContent only), deleted-variant fix (no contradictory attribution), UI-SPEC amendments, widths | unit + e2e (browser) | `node --test test/client-conflict-dialog.test.js test/client-xss-sinks.test.js test/client-busy-retry.test.js`; `npm test`; walk `--scenario withheld-f4 --scenario reapply-4xx-f4 --scenario deleted-variant-f7 --scenario dialog-widths` | ✅ | ✅ green (all four PASS) |
| 09-14-01 | 14 | 4 | CONC-02 | T-09-48 / T-09-54 / T-09-55 | (tracer, R7 F-6) RAID delete asks with the in-app confirm which becomes the stale-delete dialog on a 409 — one overlay, no native `confirm()`, no DELETE before the confirm click | unit + e2e (browser) | `node --test test/client-conflict-dialog.test.js test/client-xss-sinks.test.js`; walk `--scenario raid-delete-f1 --scenario delete-confirm-raid` | ✅ | ✅ green (both PASS) |
| 09-14-02 | 14 | 4 | CONC-02 | T-09-48 / T-09-55 / T-09-56 | The other four delete paths use the same confirm; Escape/overlay-click cancel sends nothing; double clicks send one DELETE; structural guard forbids a native `confirm()` on a versioned delete | unit + structural | `node --test test/client-conflict-dialog.test.js test/client-version-precondition.test.js test/synergy-cost.test.js test/client-xss-sinks.test.js`; `npm test` | ✅ | ✅ green |
| 09-14-03 | 14 | 4 | CONC-02 | T-09-54 / T-09-55 / T-09-56 | Browser proof on every delete surface at two widths (UI-SPEC amendment A8) | e2e (browser) | walk `--scenario raid-f2-delete-anyway --scenario org-delete-anyway-f2 --scenario delete-confirm-raid --scenario delete-confirm-surfaces --scenario confirm-widths` | ✅ | ✅ green (all five PASS) |
| 09-15-01 | 15 | 5 | CONC-02 | T-09-41 / T-09-57 | (tracer, R5-03) `transitions.js` carries a new `?v=` stamp on every page, guarded by a test, and a real browser requests it | structural + e2e (browser) | `node --test test/asset-cache-bust.test.js`; walk `--scenario asset-stamps` | ❌ W0 (`test/asset-cache-bust.test.js` created this task) | ✅ green (asset-stamps PASS) |
| 09-15-02 | 15 | 5 | CONC-02 | T-09-41 / T-09-57 | style.css (incl. login.html), execution.js, org.js, due-diligence.js carry new stamps on every referencing page | structural + e2e | `node --test test/asset-cache-bust.test.js`; `npm test`; walk `--scenario asset-stamps` | ✅ | ✅ green |
| 09-15-03 | 15 | 5 | CONC-02 | T-09-58 | Documentation made accurate: 09-01 truths (per-record, client precondition, 409-clearance), UAT item 2 expectation, WINDOWS org position-edit entry; each new truth names a real test | structural (frontmatter schema) + ledger status | `node "$HOME/.claude/gsd-core/bin/gsd-tools.cjs" query frontmatter.validate .planning/phases/09-optimistic-locking-conflict-recovery/09-01-PLAN.md --schema plan`; `node "$HOME/.claude/gsd-core/bin/gsd-tools.cjs" windows status` | n/a | ✅ green |
| 09-16-01 | 16 | 6 | CONC-02 | T-09-39 / T-09-59 | (tracer) One clean walk of all 25 scenarios on an isolated real-deal instance plus a demo-open smoke; committed databases hash-identical before/after both runs | e2e (browser, two contexts per scenario) | `PLAYWRIGHT_PATH=… node scripts/uat/phase9-walk.js --out .planning/phases/09-optimistic-locking-conflict-recovery/walk-evidence`; `… --demo-open --out …/walk-evidence/demo` | ✅ (`scripts/uat/phase9-scenarios/f9-demo.js` created this task) | ✅ green (350 PASS / 0 FAIL; demo 18 PASS / 0 FAIL) |
| 09-16-02 | 16 | 6 | CONC-02 | T-09-60 | This contract is re-signed against the evidence: every coverage row below names a passing test or scenario from the 2026-10-10 run; WINDOWS #1 closed | structural (frontmatter schema + ledger) | `node "$HOME/.claude/gsd-core/bin/gsd-tools.cjs" query frontmatter.validate .planning/phases/09-optimistic-locking-conflict-recovery/09-VALIDATION.md --schema validation`; `node "$HOME/.claude/gsd-core/bin/gsd-tools.cjs" windows status` | n/a | ✅ green |
| 09-16-03 | 16 | 6 | CONC-02 | T-09-39 | Final gate on the final tree: full suite, unmodified cross-process proof, asset-cache-bust, full-length soak; `git status --porcelain data/` empty | integration + e2e (spawned, real multi-process) | `npm test`; `node --test test/optimistic-locking-cross-process.test.js test/asset-cache-bust.test.js`; `npm run soak` | ✅ | ✅ green (numbers under "Final gate — 2026-10-10") |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling-continuity check:** the only task lacking an `<automated>` command is 09-03-03 (a
`type="checkpoint:human-verify" gate="blocking"` task by design — a human browser walk cannot be
automated). It is sandwiched by 09-03-02 (automated) before it and 09-04-01 (automated) after it —
no run of three or more consecutive tasks lacks automated verification.

**Sampling continuity across the gap closure (09-08..09-16, re-checked 2026-10-10):** every one of
the 26 gap-closure tasks carries at least one `<automated>` command (a `node --test` file, `npm test`,
a `phase9-walk.js --scenario` run, or a `gsd-tools` validation). The human walk that 09-03-03 needed
is no longer a gap-closure dependency: plan 09-16 replaced every pending manual row with two-context
browser scenarios (see Manual-Only Verifications). No run of consecutive tasks lacks automated
verification, so the rule holds for all 44 rows.

**As-executed deviations from 09-RESEARCH.md's own Phase Requirements → Test Map:**
- 09-04-01's `<verify>` names `node --test test/dd-clearance.test.js`, a file that does not exist
  in this codebase. The executing plan ran the full existing DD test suite (7 files, 78 tests)
  instead, satisfying the acceptance criterion's actual intent ("every pre-existing DD clearance
  test still passes unmodified") — recorded in 09-04-SUMMARY.md's Decisions Made.
- The structural coverage gate (D-06) was NOT complete until Plan 07 (09-07-01) reshaped the
  accumulated per-plan structural checks (tests 16/25/35/44 in
  `test/optimistic-locking-contract.test.js`) into one generic live-source scan with a reasoned
  allow-list — 09-RESEARCH.md's Phase Requirements → Test Map row for D-06 pointed at "same file
  as criterion 1" from Wave 0 onward, which was true in spirit (the file existed and grew
  per-plan structural assertions) but the GENERIC, future-route-catching form only exists as of
  Plan 07.

**As-executed notes for the gap closure (09-08..09-16):**
- The walk's `dialog-widths` scenario originally resized one 1440-wide page to 390 in place and
  failed once (`edit @390` page-level overflow, with the dialog itself fully inside the viewport) in
  the full-length run while passing 3/3 in isolation. Classified as a scenario defect (layout measured
  mid-reflow after a programmatic resize), fixed by loading a fresh tab per width; the whole walk was
  re-run, and the committed results are from that single clean run (350 PASS / 0 FAIL).
- The demo smoke uses a signed-in session with NO deal binding (the lane `DEMO_OPEN=1` exempts, which
  resolves to `demo.db`), plus cookie-less API calls for the anonymous lane. A cookie-less *browser*
  tab loops `execution.html -> login.html -> /` because the header deal switcher fetches
  `/api/deals`, a control-plane path that is never open. That behaviour is unchanged since v2.1.0
  (`public/js/deal-switcher.js` and the control-plane path table are untouched by this phase) and is
  recorded in `deferred-items.md`, not fixed here.

## Gap closure coverage (plans 09-08..09-16)

Every row names at least one test that is green in `npm test` (861/861, 2026-10-10) and at least one
walk scenario that PASSED in the committed evidence run
(`walk-evidence/results.json`: 350 PASS / 0 FAIL, plus `walk-evidence/demo/results.json`: 18 PASS / 0 FAIL).

### UAT gaps (09-UAT.md `## Gaps`)

| Gap | Truth | Automated tests | Walk scenarios (PASS) |
|-----|-------|-----------------|-----------------------|
| 1 | First concurrent edit of a never-edited record is rejected 409 (R7 F-1) | `optimistic-locking-precondition.test.js` (U1-U6, T-table 23/23, E-adjacency), `client-version-precondition.test.js`, `optimistic-locking-contract.test.js` | `raid-f1`, `raid-delete-f1`, `api-version-required`, `task-f1-never-edited`, `synergy-stage-never-edited` |
| 2 | After Apply / Delete anyway the page shows the server's state, no false self-conflict (R7 F-2) | `client-conflict-dialog.test.js` (held-promise sessions), `client-version-precondition.test.js` | `raid-f2-apply`, `raid-f2-delete-anyway`, `third-writer`, `different-records`, `task-discard-keeps-theirs`, `synergy-realized-f2`, `dd-f2`, `org-delete-anyway-f2` |
| 3 | The dialog shows a correct field diff and never claims "no conflicting fields" when it cannot tell (R7 F-3/F-5) | `client-conflict-dialog.test.js`, `client-xss-sinks.test.js` | `synergy-stage-f3`, `confirm-current-neutral-f3`, `phasing-month-f3`, `labels-f5` |
| 4 | A caller whose clearance no longer covers the record is told so truthfully and sees the real reason on reapply (R7 F-4) | `client-conflict-dialog.test.js`, `optimistic-locking-contract.test.js` (clearance-filtered 409 bodies) | `withheld-f4`, `reapply-4xx-f4` |
| 5 | A stale delete is confirmed by the destructive dialog alone, no stacked native prompt (R7 F-6) | `client-conflict-dialog.test.js` (CF1-CF11, C5 structural guard), `synergy-cost.test.js` | `delete-confirm-raid`, `delete-confirm-surfaces`, `confirm-widths`, `raid-delete-f1`, `raid-f2-delete-anyway` |
| 6 | The deleted-record variant is internally consistent (R7 F-7) | `client-conflict-dialog.test.js` | `deleted-variant-f7`, `dialog-widths` |
| 7 | Phase documentation is accurate (R7 docs) | `gsd-tools frontmatter.validate 09-01-PLAN.md --schema plan` valid; the three added truths' 19 verbatim test names exist in `test/` (09-15 Task 3) | `different-records`, `withheld-f4` (cited by the amended truths); WINDOWS #3 records the org position-edit gap |

### ROADMAP success criteria SC4-SC9

| SC | Criterion (short) | Automated tests | Walk scenarios (PASS) |
|----|-------------------|-----------------|-----------------------|
| SC4 | Never-edited record's first co-edit caught (`version: 0`); real-deal version-less update refused 400 | `optimistic-locking-precondition.test.js`, `client-version-precondition.test.js` | `raid-f1`, `task-f1-never-edited`, `synergy-stage-never-edited`, `api-version-required` |
| SC5 | After Apply / Delete anyway the page shows the server's state; no DD refresh under the dialog | `client-conflict-dialog.test.js` | `raid-f2-apply`, `raid-f2-delete-anyway`, `dd-f2`, `synergy-realized-f2`, `org-delete-anyway-f2` |
| SC6 | Truthful dialog: diff for non-mirroring payloads, clearance-aware copy, real 4xx reason, labels, no contradictory deleted attribution | `client-conflict-dialog.test.js`, `client-xss-sinks.test.js` | `synergy-stage-f3`, `confirm-current-neutral-f3`, `phasing-month-f3`, `labels-f5`, `withheld-f4`, `reapply-4xx-f4`, `deleted-variant-f7`, `dialog-widths` |
| SC7 | A stale delete is one in-app prompt, native `confirm()` gone | `client-conflict-dialog.test.js` (C5 structural guard) | `delete-confirm-raid`, `delete-confirm-surfaces`, `confirm-widths` |
| SC8 | Every changed `public/js|css` file carries a new `?v=` stamp; `login.html` loads the current `style.css` stamp | `asset-cache-bust.test.js` (11 tests) | `asset-stamps` |
| SC9 | Docs accurate: 09-01 truths each with a test, UI-SPEC deleted-variant literals, UAT item-2 corrected, WINDOWS records the org position-edit gap | `frontmatter.validate 09-01-PLAN.md` valid; named truth tests in `optimistic-locking-contract.test.js` / `optimistic-locking-cross-process.test.js` / `client-version-precondition.test.js` | `different-records`, `withheld-f4` (the two amended truths cite them), `raid-f1` / `task-f1-never-edited` (client precondition truth) |

### Demo showcase (CLAUDE.md: demo mode is a maintained deliverable; D-09 leniency)

| Behaviour | Evidence |
|-----------|----------|
| Anonymous cookie-less API writes without a version succeed (RAID create + status update, task status update), no `versionRequired` | `demo-smoke` PASS (`walk-evidence/demo/results.json`) |
| `/execution.html` loads for a deal-less demo session; a task status flip and a RAID status flip each answer 200, open no `.conflict-modal-overlay`, and no captured response carries `versionRequired` or 409 | `demo-smoke` PASS, screenshots `walk-evidence/demo/demo-task-flip.png`, `demo-raid-flip.png` |
| Committed `data/demo.db*` and `data/control.db*` unchanged by both runs | `data-integrity` PASS in both results files; `git status --porcelain data/` empty after the final gate |

---

## Wave 0 Requirements

- [x] `test/optimistic-locking-contract.test.js` — created in Plan 01, Task 1 (the tracer's four
      proofs on `POST /api/raid`); grown by every subsequent plan; reshaped into the four-part
      coverage gate by Plan 07 — covers CONC-02 criterion 1, D-08 (stale delete), D-06 (coverage)
- [x] `test/optimistic-locking-cross-process.test.js` — created in Plan 01, Task 3 (three RAID
      cases); extended by Plan 07 with integration-task/synergy-initiative cases and one
      cross-collection case — covers CONC-02 criterion 3 (per-record, not per-collection,
      granularity, proven by real spawned OS processes per 09-RESEARCH.md's own documented
      Phase-8 in-process-deadlock finding)
- [x] `test/client-conflict-dialog.test.js` — created in Plan 03, Task 2 (node:vm sandbox harness,
      mirroring `test/client-busy-retry.test.js`'s own harness shape); extended by Plan 06 with the
      destructive stale-delete variant — covers CONC-02 criterion 2 (reload-and-reapply path,
      form-state preservation, never-auto-retries)

All three files identified as MISSING in 09-RESEARCH.md's own Wave 0 Gaps section were created
inside this phase, exactly as that section anticipated — no additional Wave 0 infrastructure
task was needed beyond what each plan's own Task 1 already created.

Gap-closure additions (09-08..09-16):

- [x] `test/optimistic-locking-precondition.test.js` — created in 09-08 Task 1; the strict
      "version-less write is refused 400 `versionRequired`" rule per route (23-entry table), type
      confusion, adjacency, ordering and idempotency edges (09-10) — covers SC4
- [x] `test/client-version-precondition.test.js` — created in 09-08 Task 2; every client call site
      sends the held version via `window.maVersionOf` (0 for a never-edited record) — covers SC4
- [x] `test/helpers/held-version.js` — created in 09-08 Task 3; `installHeldVersionFetch()` fills only
      an ABSENT precondition, and H1 cross-checks its route table against `server.js`
- [x] `test/asset-cache-bust.test.js` — created in 09-15 Task 1; fails on an unstamped tag, a page
      with a different stamp, or a stamp not newer than the frozen v2.1.0 / pre-bump values — covers SC8
- [x] `scripts/uat/phase9-walk.js` + `scripts/uat/phase9-scenarios/*.js` — the browser-evidence
      mechanism (two real Chromium contexts per scenario against an isolated real-deal server on
      temp copies of the databases, committed DB hashes checked before/after); `--demo-open` mode and
      `f9-demo.js` added by 09-16. Evidence: `walk-evidence/results.json`, `walk.log`, `demo/`.

---

## Manual-Only Verifications

Every row that was pending is now performed by an automated two-context browser scenario
(plan 09-16, 2026-10-10, GD-13). A "manual" row therefore remains only where a scenario cannot
reach the surface; the one such surface is recorded as an honest exception.

| Behavior | Requirement | Was manual because | Now performed by (all PASS 2026-10-10) |
|----------|-------------|--------------------|----------------------------------------|
| Visual/interactive walk of the conflict-compare dialog: field-diff rows, orange-only-on-apply-and-mine-border, form preservation on discard, in-flight/error states, viewport widths, attribution fallback | CONC-02 | No browser inside an autonomous worktree execution | Originally APPROVED by the user 2026-08-11 (09-03 Task 3). Replayed by `raid-f1`, `raid-f2-apply`, `third-writer`, `labels-f5`, `dialog-widths` (1440 + 390, three variants each, both actions visible and inside the viewport in every screenshot judged), `confirm-widths`. **Exception:** the 1024px width of the original row is not exercised by the walk (it runs 1440 and 390); the dialog uses one responsive shell, and the 1440/390 screenshots bracket it |
| Two-tab conflict walk on `execution.html` integration-task and synergy-initiative edit surfaces, incl. two DIFFERENT records showing no dialog | CONC-02 | Same | `task-f1-never-edited`, `task-discard-keeps-theirs`, `synergy-stage-never-edited`, `synergy-realized-f2`, `different-records`, `one-tab-no-self-conflict` |
| Two-tab conflict walk on `due-diligence.html` finding/request-item surfaces | CONC-02 | Same | `dd-f2` (area-filtered `currentRecord`, no DD refresh under the open dialog) |
| Two-tab conflict walk on `org.html` position edit surface | CONC-02 | Same | **Exception, not performable:** `org.html` has no position-edit UI (only expand, Decisions and Delete; recorded as WINDOWS #3, routed to Phase 18). The conflict contract for position edits is proven at the API by `optimistic-locking-contract.test.js`; the org destructive path is walked by `org-delete-anyway-f2` |
| Two-tab destructive-delete walk on `execution.html` (RAID/task/synergy) and `org.html` (position) | CONC-02 / D-08 | Same | `raid-delete-f1`, `raid-f2-delete-anyway`, `org-delete-anyway-f2`, `delete-confirm-raid`, `delete-confirm-surfaces` (task, initiative, cost entry, org position: one in-app confirm each, no DELETE before the confirm click, no native dialog), `confirm-widths` |

None of the rows above blocks `nyquist_compliant`: each is covered by a PASS from the committed run
or is an explicitly recorded exception with a stated proof route.

---

## Final gate — 2026-10-10 (plan 09-16 Task 3, on the final tree, base `2b4ef69` + the 09-16 commits)

| Check | Result |
|-------|--------|
| `npm test` | **861 tests, 861 pass, 0 fail**, 9691 ms (before the gap closure: 779). Run once; no failure, so the 09-08 known-flake rule was not needed |
| `node --test test/optimistic-locking-cross-process.test.js` (file unmodified since 09-07, `5d188f8`) + `test/asset-cache-bust.test.js` | 18/18 pass (7 spawned-process cases + 11 stamp tests), 0 fail |
| `npm run soak` (default: 3 real server processes, 120 s) | **PASS.** acknowledged = 4097, refused (clean 503) = 18 (0.4 %), unexpected = 0; every acknowledged write present and exact (missing 0, mismatched 0); committed-but-unaudited = 0; audit trail 1:1 (4097 rows, missing 0, duplicate 0, extra 0); `PRAGMA integrity_check` ok on deal, control and audit; conflict lane: acknowledged 407, **409 = 909**, 503 = 2, probe record version reconciles exactly (1 -> 408) and final content matches the highest acknowledged write |
| Browser walk, real-deal instance (committed `walk-evidence/results.json`) | **350 PASS / 0 FAIL** across the 25 registered scenarios, `one-tab-no-self-conflict` and `data-integrity`; one earlier run had a single `dialog-widths` FAIL, classified as a scenario defect and fixed (see As-executed notes), then the whole walk re-run clean |
| Browser walk, `--demo-open` (committed `walk-evidence/demo/results.json`) | 18 PASS / 0 FAIL (`demo-smoke`, `data-integrity`) |
| `git status --porcelain data/` after tests, soak and both walks | prints nothing — committed databases untouched |
| Screenshot review | Every screenshot the walk produced (33 at the real-deal walk, 2 in the demo run) was opened and judged: in all 10 narrow (390 px) captures the modal sits inside the viewport with both actions visible (Discard/Apply, Cancel/Delete anyway, Close); the 1440 px captures show the same dialogs at desktop width. The 390 px set and the demo pair are committed; the 1440 px set (23 files, 4.5 MB) is kept out of git per the plan's size rule |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — 43 of 44 tasks carry an
      `<automated>` command (the 18 original tasks: 17; the 26 gap-closure tasks: 26); the one
      without (09-03-03) is the phase's `type="checkpoint:human-verify" gate="blocking"` task, by
      design not automatable, APPROVED by the user 2026-08-11 and replayed by the walk scenarios.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — see the note under
      the Per-Task Verification Map above.
- [x] Wave 0 covers all MISSING references — all three test files 09-RESEARCH.md's own Wave 0
      Gaps section named were created inside this phase, and the gap closure's own new files
      (precondition test, client-precondition test, held-version helper, cache-bust test, walk
      harness) are listed under "Gap-closure additions" (see Wave 0 Requirements above).
- [x] Every UAT gap (1-7) and every ROADMAP success criterion SC4-SC9 maps to a green test and a
      PASS walk scenario from the 2026-10-10 evidence run (see "Gap closure coverage").
- [x] Final gate on the final tree is green: 861/861, cross-process unmodified 18/18 with the
      cache-bust test, soak PASS (0 lost, 0 committed-but-unaudited), `data/` untouched (see
      "Final gate — 2026-10-10").
- [x] No watch-mode flags — every `<automated>` command in this phase is a one-shot `node --test`
      or `npm test`/`npm run soak` invocation; none use `--watch`.
- [x] Feedback latency < 10s (commit-loop cadence; the phase-gate soak is a separate, slower,
      intentionally-real-time proof, not part of the per-task/per-wave sampling loop).
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-08-11; re-signed 2026-10-10 after the gap closure (09-08..09-16) against the
committed walk evidence and the final gate above. Two exceptions are recorded rather than hidden: the
org.html position-edit surface does not exist (WINDOWS #3, proven at the API instead) and the walk does
not exercise a 1024 px width (1440 and 390 bracket the single responsive dialog shell).
