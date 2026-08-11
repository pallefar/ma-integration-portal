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
| **Estimated runtime** | quick command ~1s (964ms observed, 52 subtests); full suite ~9.5s (9551ms observed, 775/775); `npm run soak` ~15-20s at `SOAK_DURATION_MS=15000` (smoke config) or ~2min at the default `SOAK_PROCESSES=3`/`SOAK_DURATION_MS=120000` release-gate config |

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

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling-continuity check:** the only task lacking an `<automated>` command is 09-03-03 (a
`type="checkpoint:human-verify" gate="blocking"` task by design — a human browser walk cannot be
automated). It is sandwiched by 09-03-02 (automated) before it and 09-04-01 (automated) after it —
no run of three or more consecutive tasks lacks automated verification.

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

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|--------------------|
| Full visual/interactive walk of the conflict-compare dialog: field-diff rows at zero/one/four/many, orange-only-on-apply-and-mine-border, form preservation on discard, in-flight/error states, viewport widths (1440/1024/375px), attribution fallback | CONC-02 | No browser is available inside an autonomous worktree execution; structural (grep) and node:vm-sandboxed checks give high confidence in the underlying logic but cannot exercise real rendering/click-through | Plan 03's Task 3 eight-step two-window walk on `execution.html` (see 09-03-PLAN.md Task 3 / 09-03-SUMMARY.md CHECKPOINT REACHED section for the verbatim steps) — **completed and APPROVED by the user 2026-08-11**, and per 09-03-SUMMARY.md this walk also covered the RAID-path two-tab checks Plans 01 and 02 had each deferred |
| Two-tab conflict walk on `execution.html`'s integration-task and synergy-initiative edit surfaces (edit the same task/initiative in two tabs, confirm the dialog on the second save, confirm no dialog on two DIFFERENT records) | CONC-02 | Same — no browser in this autonomous execution; Plan 03's approved walk covered the RAID path specifically, not confirmed to have covered tasks/synergies | Two browser tabs on `execution.html`; edit an integration task (or synergy initiative) in tab A, save, then edit the SAME record in tab B — tab B must show the conflict dialog; editing two DIFFERENT records in both tabs must show no dialog. Recommended before the phase's UAT closes (09-02-SUMMARY.md D10) |
| Two-tab conflict walk on `due-diligence.html`'s finding/request-item edit surfaces | CONC-02 | Same — no browser in this autonomous execution | Two browser tabs on `due-diligence.html`; edit the same finding or request item in both tabs — the second save must show the conflict dialog with the area-filtered `currentRecord`. Recommended before the phase's UAT closes (09-04-SUMMARY.md D7) |
| Two-tab conflict walk on `org.html`'s position edit surface | CONC-02 | Same — no browser in this autonomous execution | Two browser tabs on `org.html`; edit the same position in both tabs — the second save must show the conflict dialog. Recommended before the phase's UAT closes (09-05-SUMMARY.md D8) |
| Two-tab destructive-delete walk on `execution.html` (RAID/task/synergy) and `org.html` (position) | CONC-02 / D-08 | Same — no browser in this autonomous execution | Two browser tabs; edit a record in tab A and save, then delete that SAME record in tab B — tab B must show the destructive-variant conflict dialog and the record must still exist until confirm is clicked; deleting an untouched record must still work in one click with no dialog. Recommended before the phase's UAT closes (09-06-SUMMARY.md D3) |

None of the pending (not-yet-performed) rows above block this phase's `nyquist_compliant`
determination — Plan 03's Task 3 walk (the one `type="checkpoint:human-verify" gate="blocking"`
task in the whole phase) is the only one that was load-bearing for a plan to merge, and it is
APPROVED. The remaining rows are recommended human spot-checks each plan's own SUMMARY.md
carried forward as a documented gap, not a merge-blocking gate — every plan's core mechanism is
independently proven by the automated HTTP-level and structural tests in the Per-Task
Verification Map above.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — 17 of 18 tasks carry an
      `<automated>` command; the 18th (09-03-03) is the phase's one
      `type="checkpoint:human-verify" gate="blocking"` task, by design not automatable, and is
      APPROVED.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — see the note under
      the Per-Task Verification Map above.
- [x] Wave 0 covers all MISSING references — all three test files 09-RESEARCH.md's own Wave 0
      Gaps section named were created inside this phase (see Wave 0 Requirements above).
- [x] No watch-mode flags — every `<automated>` command in this phase is a one-shot `node --test`
      or `npm test`/`npm run soak` invocation; none use `--watch`.
- [x] Feedback latency < 10s (commit-loop cadence; the phase-gate soak is a separate, slower,
      intentionally-real-time proof, not part of the per-task/per-wave sampling loop).
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-08-11
