---
phase: 05-synergy-value-capture
plan: 08
subsystem: database
tags: [vanilla-js, synergy-tracker, demo-seed, sqlite, i18n, wal-checkpoint, playwright]

# Dependency graph
requires:
  - phase: 05-synergy-value-capture (plan 02)
    provides: "scripts/migrate-synergy-stages.js's openDbFile() + prepared-statement + TRUNCATE-checkpoint shape this plan's seed script follows exactly; the four syn.st_* stage i18n keys already landed so this plan's own key list does not repeat them"
  - phase: 05-synergy-value-capture (plan 07)
    provides: "renderCostSection()/renderTaskProgress()/renderSynRollup()/renderStaleSynergyNudge() — every client surface this plan's seed data exercises, plus the D-18 unconfirmed-split sentence this plan's follow-up tweak makes non-degenerate"
provides:
  - "scripts/seed-synergy-demo.js: hand-tuned five-initiative demo seed (D-10) spanning all four SYN-03 stages, full 3-year ramped phasing per row, a second baseline beneath the pinned deal case, a deliberately stale confirmation stamp, cost entries + a planned figure, and task-lane-resolved taskIds — idempotent, TRUNCATE-checkpointed, bound by the same T-05-42 forward-booking rule as every live write path"
  - "the remaining new i18n label keys this phase's client introduced, landed across all four shipped languages (EN/DE/ZH/CS) in both committed databases"
  - "public/js/execution.js div-nesting fix (0e778f5) closing a dead-on-load synergy card interaction bug introduced by 05-07's task-progress insert, caught only by the live wave-8 regression walk"
  - "a follow-up seed tweak (0a88dc9) giving syn_seed_5 a non-zero realized value so the D-18 rollup sentence shows a real, non-zero unconfirmed figure instead of a degenerate $0.0M"
  - "two signed-off human checkpoints: the demo-showcase regression walk (approved, one real bug found and fixed) and the live Synergy Tracker walk including both backstop behaviours (approved, zero issues)"
affects: [Phase 5 close, Phase 7 RPT-04 (staleness-signal reporting, SYN-05 dependency), any future phase's demo showcase reference]

# Actuals (#2632)
actuals:
  tokens: 10100   # chars/4 over git diff 9ac1ab7..0a88dc9 (seed-synergy-demo.js + execution.js fix + VALIDATION.md); excludes binary .db diffs
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Demo seed math mirrors server.js's ramp functions via a LOCAL replica (never require('../server')), matching this codebase's established shared-pure-function-without-a-stateful-require idiom (validators/workstream.js's isValidCalendarDate precedent) — requiring server.js from a script would trigger its require()-time initDb(DEMO_DB_PATH) side effect against the real committed database before the script's own openDbFile() call runs"
    - "Seeded taskIds are resolved from the target database's own integration-task lane at seed time (title-substring lookup, never hard-coded ids) so a linked id can never dangle even if a future re-seed changes the literal task ids (T-05-44)"
    - "A seed script is bound by the identical forward-booking rule (T-05-42) the server enforces on every live request — realized value is filled only into phasing rows whose month has already arrived by wall-clock, computed with the identical monthHasArrived() the server itself uses"
    - "chmod-444-locked committed databases (data/ma-portal.db, archived per its 'retain not delete' policy) are unlocked/written/re-locked around a script run, restoring the .db, -shm and -wal sidecars to their original 444 permission afterward — matches Plan 02's own precedent for the identical file"

key-files:
  created:
    - scripts/seed-synergy-demo.js
  modified:
    - data/demo.db
    - data/ma-portal.db
    - public/js/execution.js
    - .planning/phases/05-synergy-value-capture/05-VALIDATION.md

key-decisions:
  - "The five seeds are hand-tuned, not the mechanical stage-migration carry-over: one initiative per SYN-03 stage with a second at 'committed', so all four stage-pill colours are visibly exercised without the viewer creating anything (D-10)."
  - "Dev-test debris (a stray 'Curl check' row left in data/demo.db by an earlier live-verification session) is deleted by the seed script's own idempotent allowlist-delete pass — the maintained demo showcase carries exactly the five named rows, never accumulating verification-session leftovers."
  - "syn_seed_5's startMonth was moved 5 months earlier (2026-03 -> 2025-10) in a follow-up tweak rather than raising its runRateM, to keep the $3M/yr licence-retirement run-rate narratively intact — the cost curve's shallow first-year ramp (0.30 at month 12) was rounding every early-window per-month targetM to $0.0M at roundSynergyMoney's one-decimal precision regardless of fill ratio, so pushing the already-arrived window later into the row's own ramp (where the per-month slice finally clears the rounding threshold) was the more surgical fix."
  - "The div-nesting bug (0e778f5) was found by the human regression walk, not by the 358-test suite — every emitted markup string was present and correct in isolation, so a source-level/string-match test could not have caught that the DOM nesting itself was wrong; only a live parse-and-query in a real browser exposed the null querySelector('.syn-expand-toggle')."

patterns-established:
  - "A seed-data follow-up tweak that changes only a data-shape input (startMonth) rather than a business-rule parameter (runRateM) is preferred when a rounding artifact, not an underlying magnitude, is the actual defect — keeps the fabricated showcase numbers narratively coherent with each initiative's stated scope."

requirements-completed: [SYN-01, SYN-02, SYN-03, SYN-04, SYN-05]

coverage:
  - id: D1
    description: "Five hand-tuned demo synergy initiatives seeded across all four SYN-03 stages, each with full ramped phasing, realized value filled only into already-arrived months, at least one second baseline, one deliberately stale confirmation stamp, cost entries + planned figure, and task-lane-resolved taskIds"
    requirement: SYN-01
    verification:
      - kind: unit
        ref: "npm test (358/358 green) plus one-off node assertions: distinct-stage count = 4, no seeded phasing row with a future month carries realizedM > 0, every taskIds entry resolves against integrationTasks — re-run and reconfirmed at plan completion"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every remaining new i18n label key this phase introduced (deal-case label, re-baseline/confirm-current/stale-badge labels, four rollup labels, section headings, empty-state strings) present across all four shipped languages (EN/DE/ZH/CS) in the demo database's translation row"
    requirement: SYN-05
    verification:
      - kind: unit
        ref: "scripts/seed-synergy-demo.js NEW_LABELS explicit per-language values (no English-fallback reliance); npm test green"
        status: pass
    human_judgment: false
  - id: D3
    description: "Seed script idempotency and git-visibility: a second run produces byte-identical output; the TRUNCATE WAL checkpoint makes the write visible in git diff --stat rather than hiding in a WAL sidecar; both data/demo.db and data/ma-portal.db committed"
    requirement: SYN-01
    verification:
      - kind: unit
        ref: "md5 comparison before/after a second script run (byte-identical); git diff --stat data/ (both files non-zero); git status --porcelain data/ (no WAL/shm sidecar staged)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Demo-showcase regression walk: all 14 demo pages render with zero console errors across all 4 languages, IL dashboard gauges and PMO synergy gauge unaffected, execution page tabs (tasks/RAID) functional"
    verification: []
    human_judgment: true
    rationale: "Live browser rendering, console-error absence, and cross-language raw-key absence cannot be proven by a static or source-level check — this is the plan's own designated regression checkpoint, run FIRST per the Phase 4 precedent."
  - id: D5
    description: "Wave-8 regression finding: 05-07's task-progress insert left a stray closing div that over-closed .syn-card, silently killing every synergy card's interaction wiring on load (querySelector('.syn-expand-toggle') returned null) — found live, fixed inline (0e778f5), re-walked and confirmed clean"
    verification: []
    human_judgment: true
    rationale: "The 358-test suite was fully green throughout — every markup string was present in isolation, so only a live DOM parse-and-query in a real browser could expose that the nesting itself, not any individual string, was wrong. Documented as this plan's own concrete instance of 'a green suite could not catch this class of bug.'"
  - id: D6
    description: "Live Synergy Tracker walk: both backstop behaviours (expansion state surviving a re-render; clean initial load with no broken interim state), plus stages, caret menu, phasing grid, ramp generation, baselines, cost, task progress, staleness, four-tile rollup, mobile layout, and the deal-home nudge on a real deal"
    verification: []
    human_judgment: true
    rationale: "Expansion-state persistence across a re-render and the absence of a broken initial-load state are explicitly called out in the plan as backstop behaviours no static or source-level check can prove — this walk is the only evidence that exists for them."
  - id: D7
    description: "Follow-up seed tweak: syn_seed_5 (the deliberately stale initiative) now carries a non-zero realized value ($0.3M) in already-arrived months, so the D-18 rollup sentence renders 'realized $0.9M, of which $0.3M unconfirmed' instead of the degenerate 'of which $0.0M unconfirmed' observed during the approved walk"
    requirement: SYN-05
    verification:
      - kind: other
        ref: "sqlite3 data/demo.db SELECT SUM(realizedM) (gross=0.9M) and per-row realizedM for syn_seed_5 (0.3M); one-off future-month-realized assertion re-run (0 violations); npm test 358/358; second run of the script byte-identical (idempotency preserved)"
        status: pass
    human_judgment: false

duration: ~57 min (05-07 completion 9ac1ab7 -> this plan's final commit 0a88dc9, spanning the two human checkpoints)
completed: 2026-08-06
status: complete
---

# Phase 5 Plan 8: Demo Seed, Regression Walk, Live Synergy Walk Summary

**Hand-tuned five-initiative demo seed (`scripts/seed-synergy-demo.js`) landing all four confidence stages, ramped phasing, a second baseline, staleness, cost entries and task links into both committed databases, plus two approved human checkpoints — one of which caught a real dead-on-load bug the 358-test suite could not see, and a small follow-up tweak giving the D-18 unconfirmed sentence a non-zero figure to show.**

## Performance

- **Duration:** ~57 min (05-07 completion `9ac1ab7` -> this plan's final commit `0a88dc9`), spanning two blocking human-verification checkpoints
- **Tasks:** 3 (seed script, demo-showcase regression walk, live Synergy Tracker walk)
- **Files modified:** 5 (`scripts/seed-synergy-demo.js` created; `data/demo.db`, `data/ma-portal.db`, `public/js/execution.js`, `05-VALIDATION.md` modified)

## Accomplishments
- `scripts/seed-synergy-demo.js` — hand-tuned five demo synergy initiatives spanning all four `SYN-03` stages (idea, validated, committed x2, captured), each with a full 3-year ramped phasing schedule computed with a local replica of `server.js`'s own ramp math, realized value filled only into already-arrived months (T-05-42), a second baseline on `syn_seed_3` (re-baselined post supplier-audit), a deliberately stale (66-day) confirmation stamp on `syn_seed_5`, cost entries + a planned figure on `syn_seed_4`, and task-lane-resolved `taskIds` on `syn_seed_1`
- Every remaining new i18n label key this phase introduced landed across all four shipped languages (EN/DE/ZH/CS) in both committed databases, with explicit (not English-fallback) translations throughout
- Dev-test debris (`syn_msh7nneof2d34ad3` "Curl check") removed from `data/demo.db` by the seed script's own idempotent allowlist-delete pass
- `.planning/phases/05-synergy-value-capture/05-VALIDATION.md` updated: Per-Task Verification Map marked executed, `wave_0_complete: true`
- **Demo-showcase regression walk (Task 2) — APPROVED.** 14 pages walked in headless Chrome as admin and karen, zero console errors after the fix below, all 4 languages scanned for raw i18n keys (zero found), IL dashboard gauges and PMO synergy gauge unaffected, execution tabs (tasks/RAID) functional
- **A real bug found and fixed during the regression walk (`0e778f5`).** `05-07`'s commit `7436723` inserted `renderTaskProgress(s)` and a meta-closing `</div>` but left the following `'</div></div>'` unchanged — over-closing `.syn-head`, which then made the next `</div>` close `.syn-card` early, so `.syn-track`/`.syn-expand-toggle`/`.syn-detail` parsed as SIBLINGS of the card. `card.querySelector('.syn-expand-toggle')` returned `null`, throwing on `.addEventListener` and aborting the entire per-card wiring loop — **every synergy card's interactions were dead on load.** The 358-test suite stayed green throughout because every markup string was present and correct in isolation; only a live DOM parse-and-query exposed that the nesting itself was wrong. Fixed by replacing `'</div></div>'` with `'</div>'`.
- **Live Synergy Tracker walk (Task 3) — APPROVED.** Both backstop behaviours confirmed live: expansion state on card A survived a full write+re-render round trip triggered by editing card B; initial load landed promptly (494ms) with no broken interim state. Stage menu, phasing grid (arrived-editable vs future-locked), ramp generation, baselines (deal case pinned first, PMO role correctly denied the re-baseline button), cost entries, non-interactive task progress, staleness badge + confirm-current, four-tile rollup, 40-row/51-input/31-locked-span grid structure, and mobile (390px) layout all verified with zero console errors
- **Follow-up tweak (`0a88dc9`), user-approved after the walk.** `syn_seed_5`'s `startMonth` moved 5 months earlier (2026-03 -> 2025-10) so its already-arrived window reaches further into its own cost-curve ramp, where the per-month slice finally clears `roundSynergyMoney`'s one-decimal rounding threshold — `realizedM` is now $0.3M (previously $0.0M despite an 0.85 fill ratio), all within already-arrived months. Gross realized across the five seeds is now $0.9M, of which $0.3M is the unconfirmed (stale) portion — the D-18 rollup sentence now reads a real, non-zero figure instead of "of which $0.0M unconfirmed"

## Task Commits

Each task was committed atomically:

1. **Task 1: Hand-tuned demo seed and the remaining i18n keys** — `5f790de` (feat)
2. **Task 2: Demo-showcase regression walk (blocking checkpoint)** — approved; bug found and fixed in `0e778f5` (fix)
3. **Task 3: Live Synergy Tracker walk, including both backstop behaviours (blocking checkpoint)** — approved; no code changes required
4. **Follow-up: syn_seed_5 non-zero realized value for the D-18 sentence** — `0a88dc9` (fix)

**Plan metadata:** commit pending (this SUMMARY + STATE.md + ROADMAP.md + REQUIREMENTS.md)

## Files Created/Modified
- `scripts/seed-synergy-demo.js` — hand-tuned five-initiative demo seed, local ramp-math replica, i18n key landing, idempotent + TRUNCATE-checkpointed
- `data/demo.db` — five synergyInitiatives rows rewritten, dev-test debris removed, i18n keys added, follow-up realized-value tweak
- `data/ma-portal.db` — identical rewrite (unlocked/written/re-locked around the chmod-444 archive policy)
- `public/js/execution.js` — div-nesting fix closing `.syn-head` correctly instead of over-closing into `.syn-card`
- `.planning/phases/05-synergy-value-capture/05-VALIDATION.md` — Per-Task Verification Map marked executed, `wave_0_complete: true`

## Decisions Made
- Hand-tuned (not mechanically mapped) seed distribution across all four stages — see Key Decisions in frontmatter
- Dev-test debris deleted via an idempotent allowlist pass rather than left in the showcase
- Follow-up tweak adjusted `startMonth`, not `runRateM`, to preserve the initiative's narratively-coherent $3M/yr run-rate while clearing the rounding threshold — see Key Decisions in frontmatter for the full rationale
- The div-nesting bug fix was applied inline by the orchestrator during the regression walk (not deferred) since it blocked every synergy card interaction — re-walked live to confirm the fix before approving Task 2

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed dead-on-load synergy card interaction wiring**
- **Found during:** Task 2 (demo-showcase regression walk)
- **Issue:** 05-07's commit `7436723` left a stray `'</div></div>'` that over-closed `.syn-head`, causing the next `</div>` to close `.syn-card` early and orphan `.syn-track`/`.syn-expand-toggle`/`.syn-detail` as card siblings — `card.querySelector('.syn-expand-toggle')` returned `null`, throwing on `.addEventListener` and aborting the entire per-card wiring loop for every synergy card
- **Fix:** Replaced the stray `'</div></div>'` with `'</div>'` in `public/js/execution.js`
- **Files modified:** `public/js/execution.js`
- **Verification:** Live re-walk in headless Chrome — zero console errors, all card interactions wired; full suite remained 358/358 (the bug was invisible to it)
- **Committed in:** `0e778f5`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary correctness fix caught only by the mandated live regression walk — no scope creep. The requested follow-up seed tweak (`0a88dc9`) was an explicit user request made after checkpoint approval, not a deviation.

## Issues Encountered
- `syn_seed_5`'s original `startMonth` (2026-03) produced a `realizedM` of exactly $0.0M despite an 0.85 fill ratio, because the cost curve's shallow first-year ramp rounds every early-window per-month `targetM` below `roundSynergyMoney`'s one-decimal threshold — resolved by moving `startMonth` 5 months earlier so the already-arrived window reaches further into the row's own ramp (see Key Decisions).

## User Setup Required
None — no external service configuration required.

## Known Stubs
None — all five demo seed initiatives are fully populated with real (fabricated-but-complete) phasing, baseline, cost, task-link and staleness data; every surface this phase built is exercised by real data, not a placeholder.

## Next Phase Readiness
- Phase 5 (Synergy Value Capture) is now fully executed: 8/8 plans, all five `SYN-01..05` requirements demonstrably satisfied on real seeded data, demonstration showcase unregressed (one live-caught bug fixed), both backstop behaviours have explicit human evidence
- `data/demo.db` and `data/ma-portal.db` both carry the hand-tuned seed + the follow-up tweak; both committed with a TRUNCATE WAL checkpoint so the change is visible in git, not hidden in a sidecar
- Suite: 358/358 green throughout, including after the follow-up tweak
- No blockers carried forward from this plan; standing project-level items (Phase 1 formal close, HOST/HARD traceability gaps, the deferred `/api/raid` clearance filter) remain tracked in STATE.md's Blockers/Concerns section, unaffected by this plan

---
*Phase: 05-synergy-value-capture*
*Completed: 2026-08-06*

## Self-Check: PASSED

All modified/created files confirmed present on disk (`scripts/seed-synergy-demo.js`, `data/demo.db`, `data/ma-portal.db`, `public/js/execution.js`, `05-VALIDATION.md`, this SUMMARY). All three referenced commits (`5f790de`, `0e778f5`, `0a88dc9`) confirmed in `git log`. Full suite green: 358/358.
