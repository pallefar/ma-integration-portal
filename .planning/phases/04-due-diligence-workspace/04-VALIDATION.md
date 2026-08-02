---
phase: 4
slug: due-diligence-workspace
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-02
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

**Scaffold note:** `04-RESEARCH.md` did not emit a `## Validation Architecture` section, so this file was
seeded from the GSD template by the plan-phase orchestrator (user-approved 2026-08-02) rather than derived
from research. **The planner owns filling in the Per-Task Verification Map, Wave 0 Requirements and
Manual-Only Verifications**, and must set `nyquist_compliant: true` once every task has an automated verify
or a declared Wave-0 dependency — the same flow Phase 3 used.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node core — zero new deps, no build step; established Phases 1–3) |
| **Config file** | none — no config needed; test files live in `test/*.test.js` |
| **Quick run command** | `node --test test/<file>.test.js` (single file) |
| **Full suite command** | `npm test` (= bare `node --test`) |
| **Estimated runtime** | ~1.2 seconds (measured 2026-08-02: 122 tests, 1234ms) |

**Baseline at phase start:** 122/122 passing (21 test files). Any red in this baseline is a regression
introduced by this phase, not pre-existing.

**GOTCHA (carried from Phase 1, still current on Node v22.18.0):** `node --test test/` mis-parses the
directory argument. Use bare `node --test` (the `npm test` script) or an explicit file path — never
`node --test test/`.

**Standing gate (from Phase 3, plan 03-06):** `test/write-validation-coverage.test.js` fails the suite for
any new write route that has no registered zod schema. Every new DD/wizard write route in this phase must
register a schema in `validators/` or the suite goes red by construction.

---

## Sampling Rate

- **After every task commit:** Run the task's own test file — `node --test test/<file>.test.js`
- **After every plan wave:** Run `npm test` (full suite, ~1.2s)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

The suite is fast enough (~1.2s) that there is no reason to sample less often than every task.

---

## Per-Task Verification Map

> **PLANNER: fill this table.** One row per task across all Phase-4 plans. Every task needs either an
> automated command or an explicit Wave-0 dependency; no 3 consecutive tasks may lack an automated verify.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | {DD-0X / WIZ-01} | T-04-XX / — | {expected secure behavior or "N/A"} | unit | `node --test test/{file}.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> **PLANNER: fill this list.** Name the new `test/*.test.js` files this phase creates and which requirement
> each covers. Phase 3 created 16 new test files this way and needed no separate Wave 0.

Candidate coverage areas implied by the phase's requirements and by `04-RESEARCH.md`'s verified pitfalls:

- [ ] Clean-room need-to-know filtering (DD-04) — uncleared area omitted from list responses **and** direct
      API probe returns the uniform 403 **and** the denial is written to the audit log. This is the phase's
      highest-value test: it is the one behavior a passing build cannot demonstrate on its own.
- [ ] DD request-item lifecycle + computed overdue (DD-01, D-14/D-15) — overdue derives from due date vs
      status, never a stored flag.
- [ ] Finding → task/RAID conversion (DD-03, D-12) — bidirectional references, `source`-string dedup
      (re-converting the same finding must not create a duplicate).
- [ ] RAID `critical` severity round-trip (D-26) — a `critical` finding converts to a `critical` RAID entry
      with no downgrade, through **both** enum copies (`server.js`, `validators/workstream.js`).
- [ ] Pending assessment instances (D-24) — assign creates a response-less `status: 'pending'` instance;
      the existing submit route completes it **by id** rather than creating a second instance; the
      `/api/assessment-status` rollup still reports correctly with pending instances present.
- [ ] `deal.memberGrants` additive shape (D-23) — the 4 verified `members: string[]` call sites still behave
      (`isDealMember()`, resolver bind, `releaseSessionsForDeal()`, member editing) with grants populated.
- [ ] VDR link + access-grant records (DD-05, D-17/D-18) — the app stores the reference and the grant record,
      never a document; grants land as D-08 security events.
- [ ] Wizard create-early / resume-later (D-05) — the deal exists and is audited after Basics+Team; the
      remaining steps stay resumable rather than rolling back.
- [ ] `ARRAY_COLLECTIONS` count assertion (research Pitfall 7) — the boot-time tripwire in
      `db/collections.js` must be bumped in the same commit that adds DD collections, or the app throws at
      startup.

*If the planner determines existing infrastructure covers a requirement, say so explicitly rather than
dropping the row.*

---

## Manual-Only Verifications

> **PLANNER: fill this table.** Established pattern from Phases 2–3: executors have no browser tool, so
> browser-only checks are deferred and the orchestrator closes them via Playwright, or they persist into
> `04-UAT.md` for `/gsd-verify-work`.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full wizard walk-through (basics → team → assessments, then resume the skipped steps from the deal-home checklist) | WIZ-01 | Multi-step UI flow with server-validated step advance; no headless coverage of the rail | Log in as admin, "+ New real deal" from the switcher, complete the mandatory core, confirm the deal exists + "Setup incomplete" banner, then finish a skipped step later |
| Deal-home panels render when deal-bound (setup checklist, assessment completion, DD progress by area with overdue rollup) | D-19 | `dashboard.js` has zero deal-awareness today (research Pitfall 5) — this is greenfield rendering | Bind to a real deal, load the dashboard, confirm demo-only panels are replaced and zero console errors |
| Uncleared member sees no trace of an ungranted area in the UI | DD-04 / D-03 | Server-side filtering is unit-testable; the *absence* of UI affordances is a visual check | Log in as a member with a partial grant, confirm ungranted areas are absent (not greyed/locked) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
