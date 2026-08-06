---
phase: 5
slug: synergy-value-capture
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-06
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
| *(populated by gsd-planner — one row per task once plans exist)* | | | | | | | | | |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/synergy-model.test.js` — stubs for SYN-01/SYN-02 (phasing rows, derived totals, cost entries)
- [ ] `test/synergy-stages.test.js` — stubs for SYN-03 (4-stage vocabulary, D-08 gates, D-09 demotion reason, baselines)
- [ ] `test/synergy-staleness.test.js` — stubs for SYN-05 (lastConfirmedAt, threshold, rollup split) + SYN-04 linkage
- [ ] Two-identity authz proofs for D-15 re-baseline route (copy the CR-01-style pattern from Phase 4's route-authz tests)

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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
