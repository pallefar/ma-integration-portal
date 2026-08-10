---
phase: 5
slug: synergy-value-capture
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-06
validated: 2026-08-06
validated_at_head: daa5af3
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in `node --test`, no runner dependency) |
| **Config file** | none — `test/*.test.js` discovered by glob (existing pattern, 240 tests green) |
| **Quick run command** | `node --test test/<phase-file>.test.js` (single file) |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~2s (full suite ~1.5–2s on local SQLite) |

---

## Sampling Rate

- **After every task commit:** Run the phase's own test file(s): `node --test test/synergy-*.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| T1 (tracer) | 05-01 | 1 | SYN-01 | T-05-02, T-05-03, T-05-04 | Derived totals are not client-writable once phasing exists; horizon read from deal settings, never the body | integration | `node --test test/synergy-phasing.test.js` | ❌ created by this task | ✅ |
| T2 | 05-01 | 1 | SYN-01 | T-05-01 | Arrived-month gate enforced in the handler, proven by a direct fetch that bypasses the UI | integration | `node --test test/synergy-phasing.test.js` | ✅ after T1 | ✅ |
| T3 | 05-01 | 1 | SYN-01 | T-05-01 | Locked cell is a structurally different tag, not a styled state of the editable one | source + integration | `node --test test/synergy-phasing.test.js` | ✅ | ✅ |
| T1 | 05-02 | 2 | SYN-03 | — | Blocking `checkpoint:decision` gating the one-way vocabulary cutover | manual (blocking) | n/a — checkpoint | n/a | ✅ |
| T2 | 05-02 | 2 | SYN-03 | T-05-07, T-05-08 | Legacy vocabulary refused by the enum with no coercion; cross-file anti-drift assertion | unit + integration | `node --test test/synergy-stage.test.js` | ❌ created by this task | ✅ |
| T3 | 05-02 | 2 | SYN-03 | T-05-09, T-05-10 | Idempotent migration ending in a TRUNCATE WAL checkpoint; diff must be visible in git | unit + CLI | `node --test test/synergy-stage.test.js` | ✅ after T2 | ✅ |
| T1 | 05-03 | 3 | SYN-03 | T-05-13, T-05-14 | D-08 gate evaluated across every intervening ordinal; the upsert offers no bypass field | integration | `node --test test/synergy-stage.test.js` | ✅ | ✅ |
| T2 | 05-03 | 3 | SYN-03 | T-05-12, T-05-16, T-05-17 | Two-identity 200/403 re-baseline authz proof; deal-case immutability across three re-baselines | integration | `node --test test/synergy-stage.test.js` | ✅ | ✅ |
| T1 | 05-04 | 4 | SYN-02 | T-05-19, T-05-21 | Cost entries deleted by generated id, never by index; calendar-date refine on the entry date | integration | `node --test test/synergy-cost.test.js` | ❌ created by this task | ✅ |
| T2 | 05-04 | 4 | SYN-04 | T-05-18, T-05-20, T-05-22 | Task ids validated against the bound deal's own lane; completing a task moves neither value nor stage | integration | `node --test test/synergy-tasks.test.js` | ❌ created by this task | ✅ |
| T1 | 05-05 | 5 | SYN-05 | T-05-24, T-05-25 | Allowlist stamping excludes title and notes; the confirmation time comes from the server clock only | unit + integration | `node --test test/synergy-staleness.test.js` | ❌ created by this task | ✅ |
| T2 | 05-05 | 5 | SYN-05 | T-05-26, T-05-27, T-05-28, T-05-30 | Caller-scoped stale count read from the session identity; one clock captured per request | integration | `node --test test/synergy-staleness.test.js` | ✅ after T1 | ✅ |
| T1 | 05-06 | 6 | SYN-03 | T-05-32, T-05-33, T-05-35 | No wraparound stage cycle; no empty-reason request leaves the client; no silent failed write | source | `node --test test/synergy-stage.test.js` | ✅ | ✅ |
| T2 | 05-06 | 6 | SYN-03 | T-05-31, T-05-34 | Role-gated re-baseline button is absent (not disabled) and documented as cosmetic-only | source | `node --test test/synergy-stage.test.js` | ✅ | ✅ |
| T1 | 05-07 | 7 | SYN-02, SYN-04 | T-05-38, T-05-41 | Task-progress indicator is non-interactive by construction — no button, listener, cursor or hover | source | `node --test test/synergy-cost.test.js test/synergy-tasks.test.js` | ✅ | ✅ |
| T2 | 05-07 | 7 | SYN-05 | T-05-36, T-05-37, T-05-40 | Confirm-current is its own button, route and payload; client never recomputes staleness | source | `node --test test/synergy-staleness.test.js` | ✅ | ✅ |
| T3 | 05-07 | 7 | SYN-05 | T-05-39 | Nudge reads only the caller-scoped count; deal-home textContent-only discipline preserved | source | `node --test test/synergy-staleness.test.js` | ✅ | ✅ |
| T1 | 05-08 | 8 | SYN-01..05 | T-05-42, T-05-43, T-05-44 | No seeded realized value in a future month; seed diff visible in git; seeded task links resolve | integration + CLI | `npm test` | ✅ | ✅ |
| T2 | 05-08 | 8 | SYN-01..05 | T-05-46 | Demo-showcase regression walk — runs FIRST, blocking human | manual (blocking human) | n/a — checkpoint | n/a | ✅ |
| T3 | 05-08 | 8 | SYN-01..05 | T-05-36, T-05-37 | Live synergy walk covering both UI-SPEC backstops that no static check can prove | manual (blocking human) | n/a — checkpoint | n/a | ✅ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Final file names, fixed by the plan set (each is created by the first task that needs it, so no
separate Wave 0 pass is required — every plan's own first task carries its scaffold):

- [x] `test/synergy-phasing.test.js` — SYN-01 (ramp generation, derived totals, arrived-month gate, grid source assertions) — created by 05-01 T1
- [x] `test/synergy-stage.test.js` — SYN-03 + the D-07/D-11 cutover (cross-file anti-drift, legacy-value refusal, migration idempotency, D-08 gates, D-09 reason, D-14 deal-case immutability, D-15 two-identity authz) — created by 05-02 T2
- [x] `test/synergy-cost.test.js` — SYN-02 (planned figure, dated entries, add/delete, stable ordering, net benefit) — created by 05-04 T1
- [x] `test/synergy-tasks.test.js` — SYN-04 (linkage, dedupe, multi-initiative sharing, no value/stage side effect) — created by 05-04 T2
- [x] `test/synergy-staleness.test.js` — SYN-05 (stamping allowlist, threshold boundary, single-clock adjacency, rollup split, caller-scoped count, deal-home nudge source assertions) — created by 05-05 T1
- [x] Two-identity 200/403 authz proof for the D-15 re-baseline route, copying `test/dd-findings.test.js`'s shape — same payload, four identities (05-03 T2)
- [x] `scripts/migrate-synergy-stages.js` (05-02 T3) — a Wave-0-adjacent artifact every stage-dependent assertion depends on having run against the fixture databases

*Existing infrastructure (node --test + supertest-style fetch against a booted server) covers all phase requirements — no framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Expand-state survives full-list re-render (UI-SPEC backstop) | SYN-01 | DOM interaction across an innerHTML rebuild — needs a live browser walk (Playwright) | Expand card A, edit realized-value on card B, assert card A still expanded |
| Initial-load blank pane is not a regression (UI-SPEC backstop) | SYN-01 | Perceptual timing check | Open Synergy Tracker tab on demo data; confirm render lands promptly with no broken interim state |
| Demo showcase visual quality after seed hand-tune (D-10) | SYN-01..05 | The demo is judged visually (project constraint) | Multi-width screenshots of the synergy tab with the 5 re-seeded initiatives across all 4 stages |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-08-06

### Post-plan additions (landed after this map was authored)

Nine regression tests were added by the code-review fix pass and the verification
gap closure — none existed when the Per-Task Verification Map above was written.
Each was proven to FAIL against its own pre-fix code before being accepted.

| Origin | Requirement | Secure behavior | Automated command | Status |
|---|---|---|---|---|
| CR-01 | SYN-01 | `synergyHorizonYears` bounded [1,15]; a valid 5 still accepted (D-03 configurability preserved) | `node --test test/synergy-phasing.test.js` | ✅ |
| CR-02 | SYN-03 | Unrecognized stored stage fails closed (409 Conflict, not 500 — a handled state conflict is not a server fault) | `node --test test/synergy-stage.test.js` | ✅ |
| CR-03 | SYN-01/03 | Phasing regeneration auto-demotes when the current stage's gate no longer holds | `node --test test/synergy-phasing.test.js` | ✅ |
| WR-01 | SYN-03 | `isAdminOrIlRequest()` excludes the X-Admin-Token break-glass identity | `node --test test/synergy-stage.test.js` | ✅ |
| WR-02 | SYN-02 | `roundSynergyMoney()` rejects non-finite results (Infinity→null corruption path) | `node --test test/synergy-cost.test.js` | ✅ |
| WR-03 | SYN-05 | `synergyStaleDays` capped at 365 — the staleness signal cannot be permanently suppressed | `node --test test/synergy-staleness.test.js` | ✅ |
| WR-04 | SYN-03 | Migration covers the `customSynergyInitiatives` lane (the gap that made CR-02 reachable) | `node --test test/synergy-stage.test.js` | ✅ |
| WR-05 | SYN-01 | Header realized-input gated on D-04's phased condition | `node --test test/synergy-phasing.test.js` | ✅ |
| **G-05-01** | **SYN-03** | **CREATE path runs the same D-08 gate as every other stage-setting route — enum membership is not a gate** | `node --test test/synergy-stage.test.js` | ✅ |

---

## Validation Audit 2026-08-06

**State A** (VALIDATION.md seeded at plan-phase). Audited at HEAD `daa5af3`.

**Result: no gaps — `nyquist_compliant: true`.** Per the workflow's own §3 rule ("No gaps → skip
to Step 6"), `gsd-nyquist-auditor` was **not** spawned: there was nothing for it to fill.

**Coverage was confirmed by running each phase test file individually**, not by inferring it from a
whole-suite pass — a green aggregate can hide a file that never ran:

| Test file | Requirement | Result |
|---|---|---|
| `test/synergy-phasing.test.js` | SYN-01 | 26 pass, 0 fail |
| `test/synergy-stage.test.js` | SYN-03 | 44 pass, 0 fail |
| `test/synergy-cost.test.js` | SYN-02 | 18 pass, 0 fail |
| `test/synergy-tasks.test.js` | SYN-04 | 12 pass, 0 fail |
| `test/synergy-staleness.test.js` | SYN-05 | 34 pass, 0 fail |
| **Total** | **SYN-01…05 all COVERED** | **134 pass, 0 fail** |

Full suite: **374/374**. Every requirement maps to a dedicated, individually-green test file; the
two-identity 200/403 authz proof and all nine post-plan regression tests are present.

**The five Manual-Only rows are genuinely manual and were all driven live by the orchestrator in
headless Chrome**, not asserted from source: both UI-SPEC backstops (expand-state persistence
across a full-list re-render; initial-load render), the demo-showcase regression walk across 14
pages in 4 languages, and the D-10 seed visual check. The regression walk is what caught the
`0e778f5` div-nesting bug that killed every synergy card interaction while the 358-test suite
stayed green — the standing evidence that a structural DOM defect is invisible to source-level
tests.
