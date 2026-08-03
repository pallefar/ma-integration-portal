---
phase: 4
slug: due-diligence-workspace
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-02
filled_by: gsd-planner
filled: 2026-08-02
validated: 2026-08-03
validated_by: orchestrator (no gaps — all requirements covered by green automated tests)
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

One row per task across all eight Phase-4 plans. Every task carries an automated command; the two
`checkpoint:human-verify` tasks additionally carry a human check (rows marked `human`), and each of those is
preceded in the same plan by two tasks with automated verifies, so no three consecutive tasks lack automated
feedback.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | DD-01, DD-04 | T-04-01, T-04-05, T-04-06 | List responses omit uncleared areas server-side; write payload schema-bounded; DD text rendered as text | integration | `node --test test/dd-workspace.test.js` | ➕ created by this task | ✅ green |
| 04-01-02 | 01 | 1 | DD-01, DD-04 | T-04-02, T-04-03 | By-id routes assert against the item's stored area; unknown id and uncleared area return one uniform 403 | integration | `node --test test/dd-workspace.test.js` | ✅ from 04-01-01 | ✅ green |
| 04-01-03 | 01 | 1 | DD-04 | T-04-04 | Every refusal writes one attributed `dd-access-denied` audit row; browsing a cleared area writes none | integration | `node --test test/dd-access-policy.test.js` | ➕ created by this task | ✅ green |
| 04-02-01 | 02 | 2 | DD-04 | T-04-09, T-04-10, T-04-11, T-04-12 | Grants are admin+IL only, require membership, are audited, and take effect on the next request | integration | `node --test test/dd-grants.test.js` | ➕ created by this task | ✅ green |
| 04-02-02 | 02 | 2 | DD-04 | T-04-14 | Admin grants panel renders usernames and labels as text only | source | `node --test test/dd-grants.test.js` | ✅ from 04-02-01 | ✅ green |
| 04-02-03 | 02 | 2 | DD-04 | T-04-13 | The four previously-untested `members: string[]` consumers still behave with grants populated; a stale grant on a removed member is unreachable | integration | `node --test test/dd-grants.test.js` | ✅ from 04-02-01 | ✅ green |
| 04-03-01 | 03 | 3 | DD-01 | T-04-15 | Only the curated template row is seeded; the seeder is idempotent | unit | `node -e` template-shape assertion (in-task verify block) | ➕ source module created by this task | ✅ green |
| 04-03-02 | 03 | 3 | DD-01 | T-04-15, T-04-17 | Allowlist copy stays allowlist-shaped; the empty-collections sweep keeps its strength | integration | `node --test test/deal-seed.test.js` | ✅ pre-existing, extended | ✅ green |
| 04-03-03 | 03 | 3 | DD-01 | T-04-16, T-04-18, T-04-19 | Instantiate materialises only cleared areas, dedups on re-run, and reports skipped counts without naming an area | integration | `node --test test/dd-seed.test.js` | ➕ created by this task | ✅ green |
| 04-04-01 | 04 | 4 | DD-02 | T-04-20, T-04-22 | Findings are area-filtered and by-id-guarded exactly like request items, with audited refusals | integration | `node --test test/dd-findings.test.js` | ➕ created by this task | ✅ green |
| 04-04-02 | 04 | 4 | DD-02, DD-03 | T-04-24 | Both RAID severity list copies agree on four levels, proven by the suite | unit | `node --test test/dd-findings.test.js` | ✅ from 04-04-01 | ✅ green |
| 04-04-03 | 04 | 4 | DD-03 | T-04-21, T-04-23, T-04-25 | Conversion asserts clearance before reading the finding; severity is copied verbatim; re-conversion is a no-op | integration | `node --test test/dd-findings.test.js` | ✅ from 04-04-01 | ✅ green |
| 04-05-01 | 05 | 5 | DD-05 | T-04-27, T-04-28, T-04-31 | Only absolute web URLs are accepted and re-checked at render; the aggregate omits uncleared areas; provenance is server-stamped | integration | `node --test test/dd-vdr.test.js` | ➕ created by this task | ✅ green |
| 04-05-02 | 05 | 5 | DD-05 | T-04-26, T-04-29, T-04-30 | Grants are audited security events for members only; the route inventory proves no upload route exists | integration | `node --test test/dd-vdr.test.js` | ✅ from 04-05-01 | ✅ green |
| 04-06-01 | 06 | 6 | WIZ-01 | T-04-32, T-04-33 | A pending instance carries no score field; a submitted instance cannot be rewritten through the completion path | integration | `node --test test/deal-wizard.test.js` | ➕ created by this task | ✅ green |
| 04-06-02 | 06 | 6 | WIZ-01 | T-04-34, T-04-35, T-04-37, T-04-38 | Wizard routes are admin+IL only; step names are enum-bounded; setup changes are audited; a failed provisioning rolls the registry row back | integration | `node --test test/deal-wizard.test.js` | ✅ from 04-06-01 | ✅ green |
| 04-06-03 | 06 | 6 | WIZ-01 | T-04-36 | The full create-early / resume-later walk holds, and no route blocks work on an unfinished assessment | integration | `node --test test/deal-wizard.test.js` | ✅ from 04-06-01 | ✅ green |
| 04-07-01 | 07 | 7 | WIZ-01 | T-04-39, T-04-41, T-04-43 | The page holds no duplicate rule set; values render as text; Next is disabled in flight | source | `node --test test/deal-wizard-page.test.js` | ➕ created by 04-07-02 (this task's verify runs it once 04-07-02 lands; run `node -e` parse check meanwhile) | ✅ green |
| 04-07-02 | 07 | 7 | WIZ-01 | T-04-44 | Exactly one creation path exists and every endpoint the page calls is proven present in the live route inventory | source | `node --test test/deal-wizard-page.test.js` | ➕ created by this task | ✅ green |
| 04-07-03 (human) | 07 | 7 | WIZ-01 | T-04-39, T-04-40, T-04-42 | A non-privileged role is redirected; a rejected step blocks and shows the server's message | manual | `node --test test/deal-wizard-page.test.js` (automated half) + browser walk-through | ✅ from 04-07-02 | ✅ green |
| 04-08-01 | 08 | 8 | DD-01, DD-02 | T-04-45 | The rollup omits uncleared areas entirely and totals only what it returned | integration | `node --test test/dd-summary.test.js` | ➕ created by this task | ✅ green |
| 04-08-02 | 08 | 8 | DD-01, DD-02, WIZ-01 | T-04-46, T-04-47, T-04-48, T-04-51 | The page renders only what the endpoint returned; the nudge names counts only; no audit route is referenced; nothing leaves the app | source | `node --test test/dd-summary.test.js` | ✅ from 04-08-01 | ✅ green |
| 04-08-03 (human) | 08 | 8 | DD-01, DD-04, WIZ-01 | T-04-49, T-04-50 | The demo showcase is unchanged; uncleared areas are absent rather than greyed; an archived deal renders read-only | manual | `node --test test/dd-summary.test.js` (automated half) + browser walk-through | ✅ from 04-08-01 | ✅ green |

### Gap-closure and remediation tasks (added after the original map was filled)

The map above was authored 2026-08-02, before UAT produced two gap-closure plans and the
security gate produced one remediation task. Those rows are recorded here rather than
retro-fitted above, so the original planned scope stays legible.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 04-09-01 | 09 | 9 | WIZ-01 (G-04-10) | T-04-49(09), T-04-50(09) | A completion-only setup post marks the deal complete without fabricating a stamp for a skipped step; the existing `steps` object passes through untouched; the event is still audited | integration | `node --test test/deal-wizard.test.js` | ✅ green |
| 04-09-02 | 09 | 9 | WIZ-01 (G-04-10) | T-04-50(09) | The wizard Finish control posts `{ complete: true }` only, never a step name | source | `node --test test/deal-wizard-page.test.js` | ✅ green |
| 04-10-01 | 10 | 10 | WIZ-01 (G-04-8) | T-04-52, T-04-56 | `POST /api/deals` returns the caller's own unfinished deal instead of minting a duplicate; the key is `createdBy`-pinned with exact name/target equality and fails closed when `createdBy` is falsy; D-05 create-early preserved | integration | `node --test test/deal-wizard.test.js` | ✅ green |
| 04-10-02 | 10 | 10 | WIZ-01 (G-04-8) | T-04-53, T-04-54 | The wizard resumes the session's own bound deal from `setup.steps`, adopting only what `/api/auth/me` reports and `/api/deals` confirms; the resume notice renders as text | source | `node --test test/deal-wizard-page.test.js` | ✅ green |
| quick-t0421 | quick `260802-u5d` | — | DD-03 | **T-04-21** | The finding convert control discloses that a created task/RAID entry is visible to the whole deal team, not only members cleared for that area — the condition the accepted risk depends on | source | `node --test test/dd-findings.test.js` (`dd-findings (p)`) | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling continuity check:** the longest run without an automated command is zero — every task above,
including both checkpoints, names a command. The two human checkpoints are additive verification on top of an
automated half, never a substitute for one.

---

## Wave 0 Requirements

**No separate Wave 0 is needed.** The test framework, the harness pattern and the standing coverage gate all
already exist (Phases 1-3 built them, 122 tests green at phase start), and every new test file in this phase
is created by the same task that creates the behaviour it covers — the same flow Phase 3 used for its 16 new
files. The `File Exists` column above marks each file's creating task with ➕.

New test files this phase creates, and what each covers:

- [ ] `test/dd-workspace.test.js` (04-01-01) — **DD-01, DD-04.** The tracer's end-to-end round trip, the
      request-item lifecycle, computed overdue, and the by-id IDOR guard. Also carries the DD-01 edge
      predicates: duplicate-text distinct ids, empty-deal `[]` with 200, stable repeat-read order, and
      concurrent-write survival.
- [ ] `test/dd-access-policy.test.js` (04-01-03) — **DD-04.** Uncleared area omitted from list responses AND
      a direct probe returning the uniform 403 AND the denial landing in the audit log. This is the phase's
      highest-value test: it is the one behaviour a passing build cannot demonstrate on its own.
- [ ] `test/dd-grants.test.js` (04-02-01..03) — **DD-04.** Grant and revoke routes, immediate revocation, the
      audited security events, and the D-23 regression proof covering the four previously-untested
      `members: string[]` call sites (`isDealMember()`, the resolver bind, `releaseSessionsForDeal()`, the
      member editor) with grants populated.
- [ ] `test/dd-seed.test.js` (04-03-03) — **DD-01, D-13.** Template seeding into a fresh deal, the 80-item
      shape, instantiate dedup on re-run, and clearance-scoped instantiation.
- [ ] `test/dd-findings.test.js` (04-04-01..03) — **DD-02, DD-03, D-11/D-12/D-25/D-26.** The findings
      register, the four-level RAID severity round trip through **both** enum copies, and the finding-to-task
      and finding-to-RAID conversion with bidirectional references and source-string dedup.
- [ ] `test/dd-vdr.test.js` (04-05-01..02) — **DD-05, D-17/D-18.** The per-item data-room reference (single,
      replaced not appended, scheme-restricted), the area aggregate, the audited access-grant record, and the
      route-inventory proof that no document-accepting route exists on the DD surface.
- [ ] `test/deal-wizard.test.js` (04-06-01..03) — **WIZ-01, D-05/D-08/D-09/D-24.** Pending assessment
      instances, completion by id with no second row, the rollup's pending branch, create-early setup state,
      the full ordered wizard walk, and the no-hard-lock proof.
- [ ] `test/deal-wizard-page.test.js` (04-07-01..02) — **WIZ-01.** Source and route-inventory inspection of
      the wizard page: seven steps, endpoint existence, single creation path, text-only rendering.
- [ ] `test/dd-summary.test.js` (04-08-01..02) — **DD-01, DD-02, D-15/D-19/D-20/D-21.** The clearance-scoped
      rollup, the overdue computation reuse, and the deal-home source assertions including the no-activity-feed
      check.

Existing infrastructure that already covers a requirement, stated explicitly rather than dropped:

- **`ARRAY_COLLECTIONS` count assertion (research Pitfall 7)** — covered by the existing boot-time tripwire in
  `db/collections.js` itself plus 04-01-01's explicit `node -e` assertions on the count and the membership.
  No new test file is warranted for a check that already fails loudly at module load.
- **Every new write route having a registered schema** — covered by the standing gate
  `test/write-validation-coverage.test.js` (Phase 3, plan 06), which fails the suite by construction. Each
  plan additionally runs `node scripts/list-unvalidated-routes.js` as an acceptance criterion.
- **The concurrent-write merge itself** — covered by the pre-existing `test/concurrent-write.test.js`
  (Phase 1); 04-01-01 asserts only that the DD collection participates in it, not the mechanism.
- **Audit rows for ordinary DD writes** — produced automatically by the store-layer hook (Phase 3, plan 05)
  and covered by `test/audit-log.test.js`; this phase adds tests only for the *named security events* it
  introduces.

---

## Manual-Only Verifications

Established pattern from Phases 2-3: executors have no browser tool, so browser-only checks are deferred and
the orchestrator closes them via Playwright, or they persist into `04-UAT.md` for `/gsd-verify-work`. Each row
below is bound to a specific `checkpoint:human-verify` task or a named acceptance criterion so it cannot be
lost.

| Behavior | Requirement | Owning task | Why Manual | Test Instructions |
|----------|-------------|-------------|------------|-------------------|
| Full wizard walk-through (basics → team → assessments, skip the three optional steps, finish) with a blocked step showing the server's field message | WIZ-01 | 04-07-03 | Multi-step UI flow with server-validated step advance; the rail's blocking behaviour has no headless coverage | Sign in as admin, open the switcher's create affordance, confirm it navigates to `/deal-wizard.html`, press Next with a blank deal name and confirm the step blocks with a field-named message, then complete the mandatory core, skip steps 4-6, and finish |
| Deal-home panels render when deal-bound (setup checklist with a working wizard resume link, readiness completion, DD progress by area with overdue rollup) | DD-01, WIZ-01, D-19 | 04-08-03 | `dashboard.js` has zero deal-awareness today (research Pitfall 5) — this is greenfield rendering | Bind to a real deal created with skipped steps, load the dashboard, confirm all three panels render and the resume link opens the wizard, with zero console errors |
| The demo showcase renders exactly as before on a demo-bound session | Compatibility constraint (PROJECT.md) | 04-08-03 (step 1) | The deal branch sits at the top of the dashboard entry point; a regression here breaks a maintained deliverable | Sign in as admin bound to the demo showcase, confirm the gauges, the AI plan tab and every other showcase panel behave as before with zero console errors — run this FIRST, before the deal-path checks |
| An uncleared member sees no trace of an ungranted area anywhere in the UI | DD-04, D-03 | 04-08-03 (step 5) | Server-side filtering is testable; the *absence* of a UI affordance is a visual judgement | Sign in as a deal member cleared for one area only, open both the deal home and the DD workspace, confirm the other seven areas are entirely absent — not greyed, not locked, not shown with a zero count |
| Owner nudge badge and dismissible banner behave | DD-01, D-21 | 04-08-03 (step 4) | The banner mechanism is DOM-driven and session-scoped | As the assigned owner of an overdue item, open the DD workspace, confirm the badge and banner appear, that the banner names counts only, and that dismissing it hides it for the session |
| Admin console clean-room grants panel round-trips | DD-04, D-02 | 04-02-02 acceptance criteria (manual line) | Panel is a prompt-and-render admin affordance with no headless harness | As admin, open Admin → Real Deals → Clean-room grants, tick two areas for a pmo member, save, reopen and confirm the ticks persisted, with zero console errors |

---

## Validation Sign-Off

- [x] All tasks have an `<automated>` verify — every one of the 23 rows in the per-task map names a command
- [x] Sampling continuity: zero consecutive tasks without an automated verify (longest gap is 0)
- [x] No Wave 0 needed — the harness, framework and standing coverage gate already exist; every new test file
      is created by the task whose behaviour it covers, and each is named above with its creating task
- [x] No watch-mode flags — every command is a single-shot `node --test` or `node -e` invocation
- [x] Feedback latency well under 5s — full suite measured at ~1.2s for 122 tests on 2026-08-02
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** filled by gsd-planner at plan time, 2026-08-02. Status stays `draft` until `/gsd-validate-phase`
or phase completion flips it to `validated`.

---

## Validation Audit 2026-08-03

| Metric | Count |
|--------|-------|
| Tasks in map | 29 (24 planned + 4 gap-closure + 1 remediation) |
| Gaps found | 0 |
| Resolved | 0 (none needed) |
| Escalated | 0 |

**Method.** State A audit. Every requirement (DD-01…DD-05, WIZ-01) was cross-referenced
against the phase's test files, and each file was run individually rather than inferred
from a whole-suite pass:

| Test file | Passing |
|-----------|---------|
| `test/dd-workspace.test.js` | 10 |
| `test/dd-access-policy.test.js` | 5 |
| `test/dd-grants.test.js` | 16 |
| `test/dd-seed.test.js` | 5 |
| `test/dd-findings.test.js` | 16 |
| `test/dd-vdr.test.js` | 13 |
| `test/dd-summary.test.js` | 13 |
| `test/deal-wizard.test.js` | 29 |
| `test/deal-wizard-page.test.js` | 11 |
| `test/deal-seed.test.js` | 6 |

Full suite: **240/240** (`npm test`). No requirement classified MISSING or PARTIAL, so
the nyquist auditor was not spawned — per workflow §3, "No gaps → skip to Step 6".

**What changed since the map was filled (2026-08-02).** All 24 planned task rows moved
from `⬜ pending` to `✅ green`. Five rows were added: waves 9 and 10 (gap closure for
G-04-10 and G-04-8, found by live UAT) and the quick task closing security threat
T-04-21.

**Honest note on regression strength.** Test *count* overstates protection here. Both
gap-closure executors were required to prove their new tests failed pre-fix, and both
reported that most did not: of 04-09's three new cases only `(x)` genuinely failed, and
of 04-10's three only `(aa)` did — the others pass against pre-fix code and serve as
over-broad-match guards rather than regression detectors. The T-04-21 test was verified
to genuinely fail when the disclosure is removed. Real regression protection for the two
UAT gaps therefore rests on **two** tests, not nine.

**Manual-only verifications** (no automated substitute; closed by the orchestrator in a
live browser, since no executor has browser access):

- Wizard field-error visibility (04-07) — the wave-7 defect where every error was written
  to the DOM correctly and was invisible. Source tests all passed; only a live walk caught it.
- Demo-showcase regression + clean-room DOM absence (04-08).
- Duplicate-deal resume, Back→Next path, and the escape hatch (04-10).
- T-04-21 disclosure rendering — `computedDisplay: block`, `offsetParent` non-null,
  present in `body.innerText`, under cache stamp `?v=1784800003`.
