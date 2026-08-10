---
phase: 06-org-design-talent-retention
plan: 08
subsystem: ui
tags: [sqlite, wal-checkpoint, i18n, browser-automation, xss-safe-rendering, demo-seed]

# Dependency graph
requires:
  - phase: 06-org-design-talent-retention (Plan 07)
    provides: clearance-scoped org rollup, two-tier deal-home panel, flight-risk owner nudge (D-22) that this plan's seed and live walks exercise
provides:
  - Hand-tuned demo org lane (current + target org, decision log, flight-risk register) over the five existing demo employees, seeded via an idempotent, WAL-checkpointed script
  - Five org.dec_* decision-label i18n keys in EN/DE/ZH/CS
  - Live-walk closure of the org workspace: tree interaction, search-at-depth, state switch, decision history, critical border accent, three widths, two languages, and the clean-room contract proven at both the API-body and rendered-markup layers
  - Live-walk closure of the demonstration-showcase regression check: dashboard/execution/employee-portal unregressed, critical severity chip visually distinct through BOTH conversion paths, corrected due-diligence conversion-note wording, RAID log both-directions proof for a differently-cleared member
  - Five real bugs found and fixed by the live walks that a 555-test green suite did not catch (F1-F5)
affects: [07-imo-reporting-exports]

# Actuals (#2632)
actuals:
  tokens: 13750
  tasks: 3
  commits: 6

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "applyI18n() local re-apply-after-render helper (org.js), mirroring the existing idiom in execution.js/assessments.js/dashboard.js/app.js/employee.js — any client-render function that builds DOM after transitions.js's one-time [data-i18n] pass must re-invoke it"
    - "seeded-once guard (seededPositionIds) for default-expansion state, preventing an unconditional per-render seed from undoing a user's manual collapse in the same tick"
    - "Target-state UI (decisions fetch, decision badge, Decisions history toggle) gated behind the already-resolved capabilities.targetOrgDesign flag, matching the flight-risk register's 'no request, no denial event' discipline — UI-SPEC's 'never inserted into the DOM' contract for uncleared members, not merely hidden"

key-files:
  created:
    - scripts/seed-org-demo.js
  modified:
    - data/demo.db
    - test/org-positions.test.js
    - test/org-summary.test.js
    - public/js/org.js
    - public/org.html
    - public/js/deal-home.js
    - public/dashboard.html

key-decisions:
  - "Task 2's five live-walk findings (F1 tree-collapse no-op, F2 dynamic content never re-translated, F3 decision fetch/badge/toggle leaked to uncleared members, F4 decision badge occluded card content, F5 seeded flight-risk owner was a display name not a username) were auto-fixed and re-walked per Rule 1/2, not deferred — the checkpoint's own instructions require a failed step to be fixed and re-walked, not recorded as an observation"
  - "Task 3's two conversion-path checks (flight-risk register -> RAID, pre-existing DD-finding -> RAID) were run on a scratch real deal created for the walk, since demo sessions are not deal-bound and the org workspace's clearance surfaces fail closed in demo mode by design; the scratch deal was deleted at teardown and both committed databases (control.db, demo.db) were verified logically identical to HEAD, with any incidental WAL sidecar drift byte-restored before commit"
  - "D-23's deliberate absence of a staleness signal on the flight-risk register is restated here per the plan's objective: 06-CONTEXT.md flags that Phase 7's reporting requirement refers to 'the staleness signals and equivalents,' so Phase 7 may find this missing and need to decide whether to add it then"

patterns-established:
  - "Live-walk checkpoints on this project are non-negotiable evidence gates: a fully green node --test suite has now hidden a total-breakage bug in three consecutive phases (Phase 5 Plan 08's orphaned toggle, and this plan's F1/F3/F4), so the two-checkpoint browser-automation structure this plan and 05-08 established is the standing pattern for any wave that ships a new page or a recursive/dynamic renderer"

requirements-completed: [ORG-01, ORG-02, ORG-03]

coverage:
  - id: D1
    description: "Hand-tuned demo org seed (current + target org, five-value decision log with a genuine reversal, flight-risk register with unmitigated critical/high and one mitigated entry) plus five decision-label i18n keys in EN/DE/ZH/CS, idempotent and WAL-checkpointed"
    requirement: ORG-01
    verification:
      - kind: unit
        ref: "test/org-positions.test.js — seed script checkpoint ordering, idempotent-delete-before-insert, seeded-content and i18n-coverage direct-query proofs"
        status: pass
      - kind: unit
        ref: "test/org-summary.test.js — cache-stamp assertion updated for the F2 fix"
        status: pass
    human_judgment: false
  - id: D2
    description: "Live walk of the org workspace: tree expand/collapse, search-at-depth with ancestor force-expansion, current/target switch, decision history with both rationales, critical border accent, three widths (desktop/768/375), two languages (DE/ZH), empty console throughout, and the clean-room contract proven at both the raw org-summary response body and the rendered deal-home markup (0 occurrences uncleared, exactly 1 cleared, target switch absent from uncleared markup, hand-crafted target-state request refused)"
    requirement: ORG-01
    verification:
      - kind: automated_ui
        ref: "06-08 Task 2 browser-automation walk, recorded below — zero console errors across the full walk; markup query counts 0 (uncleared) / 1 (cleared) confirmed"
        status: pass
    human_judgment: true
    rationale: "Rendering, layout at three widths, i18n text-expansion behavior, and the absence-vs-zero markup-query distinction are observable only in a real browser against a running server — no source assertion reaches them, and this project's history (Phase 5 Plan 08) shows a green suite can miss a total-breakage bug of exactly this class."
  - id: D3
    description: "Live walk of the demonstration-showcase regression check: dashboard gauge count matches the prior baseline, synergy card and RAID row interaction, employee portal academy/leaderboard, empty console, critical severity chip visually distinct from high through BOTH the flight-risk and the pre-existing due-diligence conversion paths, corrected due-diligence conversion-note wording, and the RAID log's both-directions proof for a differently-cleared member"
    requirement: ORG-03
    verification:
      - kind: automated_ui
        ref: "06-08 Task 3 browser-automation walk, recorded below — 11/11 steps pass, gauge count 29 exact match, zero console/pageerrors/HTTP>=400"
        status: pass
    human_judgment: true
    rationale: "The critical-vs-high severity distinction is a CSS rendering fact confirmed only by eye through two independent conversion code paths; the showcase-regression comparison against a prior phase's recorded baseline is a human judgment call about what counts as a difference worth investigating, not a value a test assertion can express."

duration: ~95min
completed: 2026-08-08
status: complete
---

# Phase 6 Plan 8: Demo Org Seed, Four-Language Decision Labels, and the Two Closing Live Walks Summary

**Hand-tuned demo org lane (current + target org, five-value decision log, flight-risk register) seeded over the five real demo employees with a WAL-checkpointed idempotent script, four-language decision labels, and two live browser walks that together found and closed five real rendering/leakage bugs a 555-test green suite did not catch.**

## Performance

- **Duration:** ~95 min
- **Started:** 2026-08-08T00:06:46+02:00 (Task 1 commit)
- **Completed:** 2026-08-08T00:58:20+02:00 (last commit, Task 2 regression tests) + both checkpoint walks
- **Tasks:** 3 (1 auto, 2 checkpoint:human-verify)
- **Files modified:** 7 (`scripts/seed-org-demo.js` created; `data/demo.db`, `test/org-positions.test.js`, `test/org-summary.test.js`, `public/js/org.js`, `public/org.html`, `public/js/deal-home.js`, `public/dashboard.html` modified)

## Accomplishments

- Task 1: `scripts/seed-org-demo.js` seeds a hand-tuned CURRENT org (root MD vacant, VP Eng/Sales/Finance, a Director, a vacant Senior Engineer seat) and a visibly different TARGET design (Director layer removed, Sales+Finance merged into one Commercial function) over the five real demo employees, headcount delta -2 (4 → 2 occupied). Decision log spans all five `ORG_DECISION_TYPES` values with a genuine reversal (in-selection → redeploy, both rationales intact). Flight-risk register seeded with one unmitigated critical entry (the direct retention counterpart to the existing "key sensing R&D engineers approached by competitors" RAID risk — D-15's concrete overlap, left unconverted), one unmitigated high entry, and one mitigated entry. Five `org.dec_*` decision-label keys landed in EN/DE/ZH/CS. Idempotent via an allowlist delete of its own `orgseed_`-prefixed ids; ends with a truncating `wal_checkpoint` before close, verified by a non-empty `git diff` against `data/demo.db` and a byte-identical second run.
- Task 2 (live walk, org workspace + clean-room contract): five real bugs found by the browser-automation walk, fixed, and re-walked — see Deviations below. Re-walk passed all 8 required steps. **USER APPROVED.**
- Task 3 (live walk, showcase regression + critical severity badge): all 11 required steps passed on first walk with no further fixes needed. **USER APPROVED — "Approved — 11/11".**

## Task Commits

1. **Task 1: The hand-tuned demo org seed and the four-language decision labels** - `1f14674` (feat)
2. **Task 2: Live walk — the org workspace and the clean-room contract at markup level** - findings fixed in `f085d7d` (fix, F1), `fed4efe` (fix, F3+F4), `b8a6366` (fix, F2), `6de7159` (fix, F5), regression tests in `bb2bc0a` (test)
3. **Task 3: Live walk — demonstration-showcase regression and the critical severity badge** - no code changes required; all 11 steps passed on first walk

**Plan metadata:** commit pending below (docs: complete 06-08 plan)

_Note: Task 2's checkpoint required five fix-and-rewalk cycles before approval — see Deviations. Task 3 required none._

## Files Created/Modified

- `scripts/seed-org-demo.js` - Hand-tuned demo org seed script: current + target org, decision log, flight-risk register, four-language i18n keys, idempotent allowlist-delete, truncating WAL checkpoint
- `data/demo.db` - Seeded `orgPositions`, `orgDecisions`, `orgFlightRisks` rows and the five `org.dec_*` translation keys across four languages
- `test/org-positions.test.js` - Seed-script structural/content tests (Task 1) plus nine regression tests covering walk findings F1, F2, F3, F4, F5 (Task 2)
- `test/org-summary.test.js` - Cache-stamp assertion updated as a direct consequence of the F2 cache-bust fix
- `public/js/org.js` - F1 (seeded-once expansion guard), F2 (`applyI18n()` re-apply-after-render), F3 (decisions fetch/badge/toggle gated behind `capabilities.targetOrgDesign`), F4 (decision badge moved into layout flow via `.org-node-decision-wrap`)
- `public/org.html` - F4 (`.org-node-decision-wrap` CSS rule replacing `position:absolute` occlusion)
- `public/js/deal-home.js` - F2 (`window.applyPortalI18n()` call after `renderDealHome()`'s render pass)
- `public/dashboard.html` - F2 (cache-stamp bump)

## Decisions Made

- D-18's staleness note: **restated per the plan's explicit requirement.** D-23 deliberately ships no staleness signal on the flight-risk register. 06-CONTEXT.md flags that Phase 7's reporting requirement refers to "the staleness signals and equivalents" — Phase 7 may find this missing and will need to decide whether to add a staleness signal to the flight-risk register then. Not a defect of this plan; a deferred decision surfaced now so it is not rediscovered as a surprise.
- Task 3's conversion-path checks (flight-risk → RAID, DD-finding → RAID) were run against a scratch real deal created for the walk rather than the demo showcase itself, because demo sessions are not deal-bound and the org workspace's clearance-scoped surfaces fail closed in demo mode by design — there is no demo-mode path to a differently-cleared session exercising the org register's provenance-based RAID filter. The scratch deal was deleted at teardown; both committed databases (`data/control.db`, `data/demo.db`) were diffed against `HEAD` after teardown and confirmed logically identical (any incidental WAL-sidecar drift byte-restored before the final commit).
- Task 2's five findings were fixed inline and re-walked rather than deferred, per the checkpoint's own explicit instruction that a failed step "must have been fixed and re-walked, not recorded as an observation."

## Deviations from Plan

### Auto-fixed Issues (found during Task 2's live walk)

**1. [Rule 1 - Bug] F1: org tree collapse toggle is a silent no-op at depth 0/1**
- **Found during:** Task 2 live walk (tree expand/collapse step)
- **Issue:** `seedDefaultExpansion()` called `expandedIds.add()` unconditionally for every depth-0/1 node on every `renderTree()` pass. The collapse toggle's own click handler did `expandedIds.delete(id)` immediately followed by `renderTree()`, so the delete was undone in the same tick — the toggle glyph flipped but the child never actually collapsed.
- **Fix:** Seeded-once guard (`seededPositionIds`) — a position id is added to `expandedIds` at most once, ever, so a manual collapse survives every later re-render.
- **Files modified:** `public/js/org.js`
- **Verification:** Source-level regression test (once-only guard regex); re-walked live, collapse now sticks.
- **Committed in:** `f085d7d`

**2. [Rule 1 - Bug] F2: dynamic org/deal-home content never re-translated after render**
- **Found during:** Task 2 live walk (German/Chinese width-and-i18n step)
- **Issue:** Decision badges, history pills, deal-home org-panel decision-type rows, and current/target switch labels are all built by client-side render functions that run AFTER `transitions.js`'s one-time `[data-i18n]` pass already fired. On a fresh load with a non-EN language already stored, all of that content stayed in English forever. The current/target switch labels also carried no `data-i18n` attribute at all despite the UI-SPEC's Copywriting Contract listing them as translated.
- **Fix:** Added a local `applyI18n()` re-apply-after-render helper to `org.js` (mirroring the existing idiom in execution.js/assessments.js/dashboard.js/app.js/employee.js), called after every `renderTree()`/`renderStateSwitch()` pass; added the same `window.applyPortalI18n()` call to `deal-home.js`'s `renderDealHome()`. Tagged the switch labels with `org.switch_current`/`org.switch_target` and added real DE/ZH/CS translations to the seed's `NEW_LABELS`.
- **Files modified:** `public/js/org.js`, `public/js/deal-home.js`, `public/dashboard.html` (cache stamp), `scripts/seed-org-demo.js`, `test/org-summary.test.js` (cache-stamp assertion)
- **Verification:** Re-ran the seed script against the committed demo database (idempotent, verified via the standing WAL-checkpoint trap check); re-walked live in German and Chinese — badges and switch labels translate correctly at both widths.
- **Committed in:** `b8a6366`

**3. [Rule 2 - Missing Critical] F3: decision fetch/badge/toggle leaked to uncleared members**
- **Found during:** Task 2 live walk (clean-room contract markup step)
- **Issue:** `GET /api/org/decisions` was fetched unconditionally alongside the capabilities probe, writing a console 403 on every ordinary page load for an uncleared caller even though the response was always discarded. Worse, the decision badge and "Decisions" history toggle rendered unconditionally too — contradicting UI-SPEC Design Tension 3's own DOM contract that target-state UI (switch control, target-state tree render, decision badges, flight-risk register tab) is never inserted into the DOM for an uncleared member, not merely hidden.
- **Fix:** Gated the decisions fetch, the decision badge, and the Decisions history toggle all behind the already-resolved `capabilities.targetOrgDesign`, matching the flight-risk register's existing "no request, no denial event" discipline.
- **Files modified:** `public/js/org.js`
- **Verification:** Source-level regression tests confirming the fetch and both DOM constructs live inside the same guard; re-walked live as an uncleared member — zero console 403s, decision badge/toggle absent from markup.
- **Committed in:** `fed4efe`

**4. [Rule 1 - Bug] F4: decision badge occluded card content**
- **Found during:** Task 2 live walk (768px/375px width step)
- **Issue:** The decision badge was `position:absolute`, top-right of the card — fully occluding the Delete button on every card at 1280/768px (~620-656px² intersection), colliding with the Decisions button for longer labels (DE "Freigesetzt"), and covering the occupant name at 375px (~636-665px²).
- **Fix:** Moved the badge into layout flow via a new `.org-node-decision-wrap` right-aligned line above the interactive row, so it can never overlap interactive controls or text regardless of label length or viewport width.
- **Files modified:** `public/js/org.js`, `public/org.html`
- **Verification:** Re-walked live at 768px and 375px in EN/DE/ZH — no occlusion at any width or language.
- **Committed in:** `fed4efe` (same commit as F3 — both found and fixed together)

**5. [Rule 1 - Bug] F5: seeded flight-risk owner was a display name, not a username**
- **Found during:** Task 2 live walk (flight-risk owner nudge check)
- **Issue:** `orgSummaryFor()`'s `mine.unmitigatedFlightRisks` count compares `String(r.owner || '').trim() === req.portalUser.username` — the same literal-username convention every other owner-scoped field in this app follows. The seed wrote `owner: 'Karen Peterson'` (the display name) for all three flight-risk entries, which can never equal the session username `karen` — so the D-22 owner nudge never fired regardless of how the demo was walked.
- **Fix:** Seed now stores `BASELINE_ACTOR` (the literal username `'karen'`), consistent with the decisions' own `decidedBy: BASELINE_ACTOR` convention already used elsewhere in the same script. Re-ran the seed against the committed demo database.
- **Files modified:** `scripts/seed-org-demo.js`, `data/demo.db`
- **Verification:** Re-verified the WAL trap (`wal_checkpoint(TRUNCATE)`, non-empty `git diff --stat`, no stray `-wal`/`-shm` sidecars, every other table byte-identical before/after — row counts unchanged at 10/6/3 for orgPositions/orgDecisions/orgFlightRisks); re-walked live as `karen` — owner nudge now fires.
- **Committed in:** `6de7159`

**6. [Regression coverage] Nine tests added for F1-F5**
- Added to `test/org-positions.test.js` to prevent the five findings from silently regressing: F1's once-only expansion guard (source regex), F3's capability-gated decisions fetch/badge/toggle (source-level, no DOM/jsdom harness in this repo — matches every other org.js test in this file), F5's `orgSummaryFor()` behavioral proof against the committed demo database, plus extended source-level coverage for F2's `applyI18n()` calls and F4's non-absolute badge positioning.
- **Committed in:** `bb2bc0a`

---

**Total deviations:** 5 auto-fixed bugs/missing-critical (1 missing critical — F3's DOM-contract leak — plus 4 bugs: F1, F2, F4, F5), all found live and closed within the same checkpoint cycle before approval.
**Impact on plan:** All five fixes were necessary for correctness (F1, F2, F4, F5) or clean-room compliance (F3). None were scope creep — every fix closes a gap the plan's own `<how-to-verify>` steps explicitly required to pass. No architectural changes; all Rule 1/2 auto-fixes.

## Issues Encountered

None beyond the five findings documented above as deviations — both checkpoints resolved to approval within this session, no unresolved blockers.

## Live Walk Records

### Task 2 — Org workspace + clean-room contract (re-walk after fixes)

All 8 required steps passed on re-walk:
1. Tree expand/collapse, search-at-depth with ancestor force-expansion, current/target state switch — all work.
2. Decision history shows both rationales of the reversed decision (in-selection → redeploy).
3. Unmitigated critical entry shows its border accent on the tree card.
4. Browser console EMPTY of errors for the entire walk.
5. Tree renders correctly at 768px and 375px; decision badge unclipped in German, not collapsed in Chinese.
6. Uncleared member: restricted key absent from raw org-summary response body; restricted container appears ZERO times in rendered markup; current/target switch absent from markup entirely.
7. Cleared member: restricted container appears EXACTLY ONCE.
8. Hand-crafted target-state request from the uncleared session was refused.

**Resolution: USER APPROVED.**

### Task 3 — Demonstration-showcase regression + critical severity badge

All 11 required steps passed on first walk, no fixes needed:
1. Dashboard gauges and KPI tiles render; gauge count **29** — exact match against the 04-08 numeric baseline, cross-proven via git-diff showing the dashboard gauge inventory untouched since that baseline was recorded.
2. Synergy card expand/collapse, RAID status-cycle, and RAID filter all respond to interaction on the execution tab.
3. Employee portal renders academy (3 modules) and leaderboard (5 entries).
4. Demo RAID register: 6 rows intact, unchanged.
5. Browser console EMPTY of errors/pageerrors/HTTP≥400 throughout the entire showcase walk.
6. Critical severity chip proven visually distinct through BOTH conversion paths: flight-risk register → RAID conversion (scratch real deal) AND the pre-existing due-diligence → RAID conversion path (scratch real deal) — critical renders `rgb(156,42,23)`/font-weight 900 versus high's `rgb(192,57,43)`/800, visually distinct side-by-side.
7. Due-diligence conversion note reads "Creates a linked Day-1 task and/or RAID entry, visible only to members cleared for this area." — the corrected wording; the old whole-deal-team wording is absent.
8. Both-directions RAID-log proof, live, for a differently-cleared member (financial-only clearance): RAID log returned 2 rows, NOT empty — excludes the hr-provenance retention entry while keeping the manual and financial entries. An empty log would have been the failure mode this filter design exists to avoid; it was not empty.
9. Suite: 555/555 throughout.

**Adaptation disclosed:** Steps 6 and 8 were run against a scratch real deal created for the walk (demo sessions are not deal-bound; the org register's clearance-scoped surfaces fail closed in demo mode by design, so there is no demo-mode path to a differently-cleared RAID-filter check). The scratch deal was deleted at teardown; `data/control.db` and `data/demo.db` were verified logically identical to `HEAD` after teardown, with any incidental WAL-sidecar drift byte-restored before this plan's commits.

**Resolution: USER APPROVED — "Approved — 11/11".**

## Suite Trajectory

547 (baseline, end of Plan 07) → 547 + 4 Task 1 tests → 555 (+9 Task 2 regression tests for F1-F5, one pre-existing test `test/org-summary.test.js`'s cache-stamp assertion updated as a direct consequence of F2's cache-bust, not counted as new) → **555/555 final, zero failures.**

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 6 (Org Design & Talent Retention) is functionally complete: all three requirements (ORG-01, ORG-02, ORG-03) delivered and demonstrated end-to-end in both the demonstration showcase and live browser walks against a real deal.
- The demonstration showcase is confirmed unregressed by this phase's shared-file edits (`.raid-lvl.critical` in `public/execution.html`, the corrected conversion note in `public/js/due-diligence.js`, the provenance-based outbound RAID filter).
- **Deferred flag for Phase 7:** D-23 deliberately ships no staleness signal on the flight-risk register. 06-CONTEXT.md notes Phase 7's reporting requirement refers to "the staleness signals and equivalents" — Phase 7 should decide at planning time whether the flight-risk register needs a staleness signal alongside the existing synergy-staleness pattern, or whether its append-only decision log already provides sufficient recency evidence.
- Phase completion verification (final orchestrator-level checks, ROADMAP.md phase-status flip) is owned by the orchestrator's verification flow, not this plan.

---
*Phase: 06-org-design-talent-retention*
*Completed: 2026-08-08*

## Self-Check: PASSED

All 8 files created/modified by this plan confirmed present on disk; all 6 task commits (`1f14674`, `f085d7d`, `fed4efe`, `b8a6366`, `6de7159`, `bb2bc0a`) confirmed present in git history.
