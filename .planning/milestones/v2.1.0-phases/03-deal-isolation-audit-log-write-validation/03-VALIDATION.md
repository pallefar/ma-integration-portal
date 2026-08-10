---
phase: 3
slug: deal-isolation-audit-log-write-validation
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: true
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
| 01-T1 | 03-01 | 1 | VAL-01 | T-03-SC | zod passes a blocking-human package-legitimacy gate before install | checkpoint | (human gate — no automated command) | n/a | ⬜ pending |
| 01-T2 | 03-01 | 1 | ISO-01, AUD-02 | T-03-01 | deal/audit/runtime DB families excluded from git AND the download-zip before they exist | integration | `node --test test/db-artifact-exclusion.test.js` | ❌ new | ⬜ pending |
| 01-T3 | 03-01 | 1 | ISO-01, AUD-02 | T-03-02, T-03-03 | four DB kinds open with the Phase-1 pragma set; audit rows survive UPDATE/DELETE attempts; deal ids cannot traverse | integration | `node --test test/db-file-layout.test.js` | ❌ new | ⬜ pending |
| 02-T1 | 03-02 | 2 | ISO-01 | — | one-way D-05 split confirmed before it runs | checkpoint:decision | (human gate — no automated command) | n/a | ⬜ pending |
| 02-T2 | 03-02 | 2 | ISO-01 | T-03-05, T-03-06, T-03-09 | union-parity `--verify` gate; secrets relocated to gitignored runtime.db; source untouched | integration | `node --test test/db-split-migration.test.js` | ❌ new | ⬜ pending |
| 02-T3 | 03-02 | 2 | ISO-02 | T-03-07, T-03-08 | a new deal DB is template-only — every non-seeded collection proven empty across the whole inventory | integration | `node --test test/deal-seed.test.js` | ❌ new | ⬜ pending |
| 03-T1 | 03-03 | 3 | ISO-01, ISO-03 | T-03-10, T-03-12, T-03-13, T-03-15 | one DB per request; bind-time membership refusal; no silent demo downgrade; no ALS context leak | integration | `node --test test/deal-resolver.test.js` | ❌ new | ⬜ pending |
| 03-T2 | 03-03 | 3 | ISO-01 | T-03-11, T-03-16 | two deals share no rows; concurrent cross-deal writes both land; accounts unreachable from a deal-bound request | integration | `node --test test/deal-isolation.test.js` | ❌ new | ⬜ pending |
| 03-T3 | 03-03 | 3 | ISO-02 | T-03-14 | demo-only mechanics 403 for a deal session and leave that deal's data byte-identical | integration | `node --test test/demo-only-gating.test.js` | ❌ new | ⬜ pending |
| 04-T1 | 03-04 | 4 | ISO-01, ISO-03 | T-03-17, T-03-18, T-03-19, T-03-23 | create→select→resolve end-to-end; non-member refused and cannot see the deal exists | integration | `node --test test/deal-registry.test.js` | ❌ new | ⬜ pending |
| 04-T2 | 03-04 | 4 | ISO-01 | T-03-20, T-03-21 | admin-only, confirmation-guarded archive/delete; delete path holds no audit reference | integration | `node --test test/deal-lifecycle.test.js` | ❌ new | ⬜ pending |
| 04-T3 | 03-04 | 4 | ISO-03 | T-03-22 | header deal switcher visually distinct from the demo Projects UI; showcase unchanged | manual | (end-of-phase human check — see Manual-Only Verifications) | n/a | ⬜ pending |
| 05-T1 | 03-05 | 5 | AUD-01, AUD-02 | — | one-way D-09 audit location/mechanism confirmed before history accumulates | checkpoint:decision | (human gate — no automated command) | n/a | ⬜ pending |
| 05-T2 | 03-05 | 5 | AUD-01, AUD-02 | T-03-24, T-03-26, T-03-27 | attributed before/after entry per deal write, post-commit; zero rows for demo; trail survives deal deletion | integration | `node --test test/audit-log.test.js` | ❌ new | ⬜ pending |
| 05-T3 | 03-05 | 5 | AUD-01 | T-03-25, T-03-28, T-03-30 | every D-08 security event recorded; viewer admin-only; no route can alter a row | integration | `node --test test/audit-security-events.test.js` | ❌ new | ⬜ pending |
| 06-T1 | 03-06 | 6 | VAL-01, VAL-02 | T-03-31, T-03-34, T-03-35 | pipeline end-to-end on one route; unknown keys stripped; errors never echo the submitted value | integration | `node --test test/write-validation.test.js` | ❌ new | ⬜ pending |
| 06-T2 | 03-06 | 6 | VAL-01 | T-03-33 | every registered write route resolves to a schema, asserted against the live route inventory | integration | `node --test test/write-validation-coverage.test.js` | ❌ new | ⬜ pending |
| 06-T3 | 03-06 | 6 | VAL-02 | T-03-32, T-03-36 | HTML round-trip stored and rendered inert; plain-text fields verbatim; residual limits documented | integration | `node --test test/xss-sanitization.test.js` | ❌ new | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

No separate Wave 0 is required: this phase's test framework (node:test) is already installed and
every task in every plan authors its own test file **within the same task** that produces the code,
so no task carries a `MISSING` automated verify. The eleven new test files are distributed as:

- Wave 1 — `test/db-artifact-exclusion.test.js`, `test/db-file-layout.test.js`
- Wave 2 — `test/db-split-migration.test.js`, `test/deal-seed.test.js`
- Wave 3 — `test/deal-resolver.test.js`, `test/deal-isolation.test.js`, `test/demo-only-gating.test.js`
- Wave 4 — `test/deal-registry.test.js`, `test/deal-lifecycle.test.js`
- Wave 5 — `test/audit-log.test.js`, `test/audit-security-events.test.js`
- Wave 6 — `test/write-validation.test.js`, `test/write-validation-coverage.test.js`, `test/xss-sanitization.test.js`

Regression floor: the existing `npm test` suite must stay green at every task commit — Phase 1's
`__snapshot` merge and concurrent-write semantics and Phase 2's auth/role/session suites. Plan 03-06
Task 1 deliberately ships its coverage worklist as a **reporter script**, not a red test, so the
suite is green at every commit boundary; Task 2 promotes it into a permanent test once the list is
empty.

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
