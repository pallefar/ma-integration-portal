---
phase: 3
slug: deal-isolation-audit-log-write-validation
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-01
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 03-RESEARCH.md ## Validation Architecture — the planner fills the Per-Task Verification Map.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, zero new deps — established Phase 1) |
| **Config file** | none — `npm test` runs bare `node --test` |
| **Quick run command** | `node --test test/<relevant>.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds (32 existing tests in ~0.3s; expect ~50+ after this phase) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/<relevant>.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (filled by planner) | | | ISO-01..03, AUD-01..02, VAL-01..02 | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/deal-isolation.test.js` — stubs for ISO-01/ISO-03: request resolves to exactly one DB; two deals share no rows; non-member session refused
- [ ] `test/demo-gating.test.js` — stubs for ISO-02: time-travel/XP endpoints no-op or 403 against a deal session
- [ ] `test/audit-log.test.js` — stubs for AUD-01/AUD-02: deal write produces append-only entry with who/what/when/before/after; deal deletion leaves trail intact
- [ ] `test/write-validation.test.js` — stubs for VAL-01/VAL-02: malformed payload 400s with clear error; unknown fields stripped; script-bearing free-text round-trips inert
- [ ] Existing `npm test` (32 tests) must stay green — Phase 1 store semantics (__snapshot merge) and Phase 2 auth/role suite are the regression floor

*Framework already installed — node:test.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Deal switcher UI: member sees switcher, selects deal, pages render that deal's data | ISO-03 | Browser navigation/render not covered by node:test | Login as member, switch deal, verify page data; non-member sees no deal in switcher |
| Demo showcase unchanged end-to-end after split migration | ISO-01 | Visual/UX parity judgment across pages | Boot DEMO_OPEN=1 after migration; walk dashboard/employee/admin pages against pre-split behavior |
| Admin audit viewer renders and filters | AUD-01 | Small UI, browser-only | Admin console → audit tab; filter by deal/user/date |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (bare `node --test` — the `node --test test/` dir form mis-parses on Node 22.18, use explicit files or bare)
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
