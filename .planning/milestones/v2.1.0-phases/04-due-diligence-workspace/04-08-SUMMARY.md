---
phase: 04-due-diligence-workspace
plan: 08
subsystem: api
tags: [express, better-sqlite3, dashboard, vanilla-js, dd, clean-room, mnpi]

# Dependency graph
requires:
  - phase: 04-due-diligence-workspace (Plan 01-05)
    provides: "db/accessPolicy.js's DD_AREAS/grantedAreas()/filterByAreaGrant(), server.js's ddRequestLane()/ddFindingsLane()/computeOverdue() and the whole /api/dd/* request-item + findings surface this plan's rollup aggregates"
  - phase: 04-due-diligence-workspace (Plan 06)
    provides: "GET /api/assessment-status's pending/bySubject readiness rollup and deal.setup's six-step skeleton (db/controlStore.js's createDeal()/updateDealSetup())"
  - phase: 04-due-diligence-workspace (Plan 07)
    provides: "/deal-wizard.html — the resume target for an outstanding setup step; the display-visibility lesson (never clear an error/status element's display to '') applied here by never leaving a show-path ambiguous"
provides:
  - "server.js route GET /api/dd/summary — the clearance-scoped DD rollup: per-area item/finding counts, overdue rollups (reusing computeOverdue()), and the caller's own owned/assigned counts (mine)"
  - "public/js/deal-home.js — window.renderDealHome(dealId): setup checklist, readiness completion, diligence progress panels, zero markup-assignment sinks, no reference to the audit route"
  - "public/js/dashboard.js's deal-bound dispatcher — a single new DOMContentLoaded listener that branches on GET /api/auth/me's dealId; the two pre-existing demo initializers (now named initDemoDashboard()/initReadinessStrip()) are unchanged internally and run ONLY on the no-bound-deal path"
  - "public/js/due-diligence.js's owner nudge — a count badge plus a dismissible banner (via the existing window.makeBannerDismissible mechanism, session-scoped dismissal key) for an owner with open/overdue assigned rows"
  - "04-CONTEXT.md's D-22 amended to match the actual Phase-3 resolver behavior (archived deals are a full freeze, not read-only-with-retained-access) — user decision, no code changed"
affects: []

# Actuals (#2632)
actuals:
  tokens: 11126
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Filter-before-tally aggregation: GET /api/dd/summary runs accessPolicy.filterByAreaGrant() on both the request-item and finding lanes BEFORE any count loop touches them, then seeds the per-area accumulator map ONLY for granted area ids (an uncleared area gets no map entry at all) — the same 'omit entirely, never zero' discipline every other DD list route already applies, now proven to hold through an AGGREGATE response, not just a list."
    - "Named-function conversion for a minimal-diff feature branch on a legacy monolith file: to add a deal-bound early-exit ahead of ~2400 lines of pre-existing demo rendering in public/js/dashboard.js without moving or re-reading any of that code, the two existing anonymous document.addEventListener('DOMContentLoaded', () => {...}) callbacks were converted to named function declarations (initDemoDashboard()/initReadinessStrip()) by changing ONLY their opening and closing lines; a single new dispatcher listener registered ahead of them calls the named functions conditionally. git diff over the full commit proves zero changes anywhere inside either body — the technique adds a branch without auditing or risking the body it branches around."
    - "Aggregate-response leak prevention, proven at two layers: an uncleared area is absent from GET /api/dd/summary's own JSON (server-side, T-04-45/T-04-46) AND absent from the rendered deal-home DOM (client-side, since public/js/deal-home.js holds no fallback list of 'every possible area' to draw a placeholder from) — the coordinator's live UAT (pmo granted only legal+hr) confirmed both layers independently hold the same invisibility property."

key-files:
  created:
    - public/js/deal-home.js
    - test/dd-summary.test.js
  modified:
    - server.js
    - public/js/dashboard.js
    - public/dashboard.html
    - public/js/due-diligence.js
    - public/due-diligence.html
    - .planning/phases/04-due-diligence-workspace/04-CONTEXT.md

key-decisions:
  - "GET /api/dd/summary is deliberately unguarded by an explicit role check, mirroring GET /api/dd/request-items and GET /api/dd/findings — every number it returns is already scoped through filterByAreaGrant()/grantedAreas() before any tally runs, so any deal member (not just admin/hrbp) can safely call it. This is a different read shape from GET /api/deals/:id/grants (Plan 02, narrowed to admin/hrbp) because that route returns EVERY member's clearance map unfiltered by the caller's own grant; this route only ever reports the caller's own view."
  - "public/js/dashboard.js's two pre-existing DOMContentLoaded handlers were converted to named functions (initDemoDashboard(), initReadinessStrip()) rather than left as anonymous callbacks, so a single new dispatcher could gate both — including the readiness-strip's OWN /api/assessment-status fetch — behind one identity check. This was necessary to satisfy the plan's 'skip the demo assessment fetch entirely' requirement for a deal-bound session; a partial guard covering only the first listener would have left the second one running an unnecessary fetch and DOM writes into the (correctly hidden) demo main-view on every deal-bound page load."
  - "[User decision, 2026-08-02, wave 8 checkpoint] D-22 AMENDED to match the actual Phase-3 resolver code rather than rearchitecting the code to match the (factually incorrect) decision text. Verified live: db/resolver.js's resolveDatabase() throws a uniform 403 for a session bound to ANY archived deal on every non-control-plane request — reads included, no read/write distinction — and db/controlStore.js's listDealsForUser() filters archived deals out of every member's list. An archived deal is therefore a full freeze (no reads, no writes, no listing) for everyone, not 'read-only with retained access' as 04-CONTEXT.md originally stated. No code was touched to produce this amendment — db/resolver.js, the archive route, and listDealsForUser() are all untouched by this plan. See 04-CONTEXT.md's D-22 for the full amendment text and the struck original."

patterns-established:
  - "A large legacy single-listener page controller can gain a new early-exit branch (new mode, new gate, new persona) via the minimal named-function conversion technique above WITHOUT reading or re-verifying its existing body — the git diff itself becomes the proof that nothing inside was touched."

requirements-completed: [DD-01, DD-02, WIZ-01]

coverage:
  - id: D1
    description: "GET /api/dd/summary returns per-area item/finding counts, overdue rollups and the caller's own owned/assigned counts, scoped to the caller's clean-room clearance"
    requirement: "DD-01"
    verification:
      - kind: integration
        ref: "test/dd-summary.test.js#dd-summary (a): an IL sees all eight areas with correct per-status counts"
        status: pass
      - kind: manual_procedural
        ref: "Coordinator live UAT (:3403): GET /api/dd/summary returned areas [\"legal\",\"hr\"] only for pmo granted only those two areas"
        status: pass
    human_judgment: false
  - id: D2
    description: "An uncleared DD area is entirely absent from the rollup response (never returned with zero counts) — the same invisibility property every DD list route already holds, now proven for an AGGREGATE"
    requirement: "DD-01"
    verification:
      - kind: integration
        ref: "test/dd-summary.test.js#dd-summary (b): a member cleared for exactly two areas sees exactly two entries; the other six are entirely absent"
        status: pass
      - kind: manual_procedural
        ref: "Coordinator live UAT (:3403): pmo's rendered deal home showed exactly Legal and HR; Financial/Tax/IT/Commercial/Operations/Compliance-ESG completely absent, not greyed, not locked, not zero-count"
        status: pass
    human_judgment: false
  - id: D3
    description: "`totals` sums only the areas actually returned to the caller, never the deal's true totals — an uncleared area's items cannot inflate or otherwise be inferred from the aggregate"
    requirement: "DD-01"
    verification:
      - kind: integration
        ref: "test/dd-summary.test.js#dd-summary (c): totals equal the sum of the returned areas, not the deal's true totals"
        status: pass
    human_judgment: false
  - id: D4
    description: "Overdue is computed at response time via the shared computeOverdue() helper (never a second implementation) and never counts a closed item regardless of due date"
    requirement: "DD-01"
    verification:
      - kind: integration
        ref: "test/dd-summary.test.js#dd-summary (d)/(e): a past-due non-closed item counts as overdue exactly once; a closed past-due item never counts"
        status: pass
      - kind: manual_procedural
        ref: "Coordinator live UAT (:3403): a legal item with dueDate 2026-01-15 / status open rendered \"Legal 1 item 1 overdue 0 findings\" against the live date"
        status: pass
    human_judgment: false
  - id: D5
    description: "Findings are tallied by all four severities (including critical) per area, plus an open-findings count and a total"
    requirement: "DD-02"
    verification:
      - kind: integration
        ref: "test/dd-summary.test.js#dd-summary (f): findings are tallied by each of the four severities, including critical"
        status: pass
    human_judgment: false
  - id: D6
    description: "`mine` counts only rows owned by the calling username, within the caller's own cleared areas — an owner's own open/overdue items and open findings"
    requirement: "DD-01"
    verification:
      - kind: integration
        ref: "test/dd-summary.test.js#dd-summary (g): mine counts only rows owned by the calling username, within the caller's own cleared areas"
        status: pass
    human_judgment: false
  - id: D7
    description: "An empty deal (zero items, zero findings) returns a well-formed, fully-zeroed response — never a missing key or an error"
    requirement: "DD-01"
    verification:
      - kind: integration
        ref: "test/dd-summary.test.js#dd-summary (h): a deal with no items and no findings returns zeroed structures, never a missing key or an error"
        status: pass
    human_judgment: false
  - id: D8
    description: "A deal-bound session sees the deal home (setup checklist with a resume link into the wizard, readiness-assessment completion per subject with owner/due-date for pending instances, diligence progress per area) instead of the demo dashboard"
    requirement: "WIZ-01"
    verification:
      - kind: integration
        ref: "test/dd-summary.test.js#dd-summary (source): the deal-home module fetches the rollup routes / delegation source assertions"
        status: pass
      - kind: manual_procedural
        ref: "Coordinator live UAT (:3403): rendered DONE Deal Basics / DONE Team & Access / OUTSTANDING (x4), a \"Setup incomplete — resume setup\" affordance, three readiness assessments each Pending, and a diligence-progress panel; zero console errors"
        status: pass
    human_judgment: false
  - id: D9
    description: "A demo-bound session (no deal binding) renders EXACTLY as it did before this plan — the demo showcase is unchanged, including its own readiness strip and every gauge/tab"
    requirement: "WIZ-01"
    verification:
      - kind: other
        ref: "git diff bc55bfb..HEAD -- public/js/dashboard.js: the two pre-existing DOMContentLoaded bodies (initDemoDashboard()/initReadinessStrip()) show zero changed lines anywhere inside them — only their opening/closing lines were touched to convert them into named functions"
        status: pass
      - kind: manual_procedural
        ref: "Coordinator live UAT (:3403), admin with no bound deal: #deal-home computed display:none, #dashboard-main-view display:block, target name intact, 29 gauge elements, readiness strip present, Functional Integration Tracks present, no setup-checklist text leaking, zero console errors"
        status: pass
    human_judgment: false
  - id: D10
    description: "An owner with open/overdue assigned DD items sees an in-app badge and a dismissible banner naming counts only (never an area, item title or another person); dismissal is session-scoped, not permanent"
    requirement: "WIZ-01"
    verification:
      - kind: integration
        ref: "test/dd-summary.test.js#dd-summary (source): the due-diligence script raises the owner nudge through the shared banner mechanism"
        status: pass
      - kind: manual_procedural
        ref: "Coordinator's checkpoint approval covers this as part of the overall 'Everything passed' verdict, but the coordinator's own itemized evidence list (6 numbered items) did not separately quote a specific observation of the badge/banner rendering or its dismiss behavior the way it did for the other six checks"
        status: unknown
    human_judgment: true
    rationale: "The coordinator approved the checkpoint and stated everything passed, but their detailed evidence writeup did not itemize this specific sub-check (original how-to-verify step 4) the way it itemized the other six. Recorded honestly rather than inferred as independently confirmed — a verifier should treat this as covered by the general approval, not by a specific quoted observation, and may wish to re-confirm the badge/banner visually if that distinction matters."
  - id: D11
    description: "There is no activity feed anywhere on the deal home (D-20 stays deferred) and the deal-home module never references the admin audit route"
    requirement: "WIZ-01"
    verification:
      - kind: integration
        ref: "test/dd-summary.test.js#dd-summary (source): the deal-home module contains no reference to the audit route"
        status: pass
      - kind: manual_procedural
        ref: "Coordinator live UAT (:3403): no feed anywhere on the deal home"
        status: pass
    human_judgment: false

duration: ~70min
completed: 2026-08-02
status: complete
---

# Phase 4 Plan 8: Deal Home, DD Rollup & Owner Nudge (DD-01/DD-02/WIZ-01) Summary

**A clearance-scoped `GET /api/dd/summary` rollup feeding a new deal-home dashboard (setup checklist, readiness completion, diligence progress) and an in-app owner nudge — with the demo showcase proven byte-identical via a minimal-diff named-function conversion, not a rewrite, of `public/js/dashboard.js`'s two pre-existing initializers.**

## Performance

- **Duration:** ~70 min
- **Tasks:** 3 (all completed — Task 3 was a `checkpoint:human-verify` gate, approved by the coordinator's live browser UAT)
- **Files modified:** 7 (2 created, 5 modified) across the code, plus `04-CONTEXT.md` amended per the checkpoint's D-22 finding
- **Commits:** 3 task commits + this docs commit

## Accomplishments

- Built `GET /api/dd/summary` (`server.js`): filters both the request-item and finding lanes through `accessPolicy.filterByAreaGrant()` BEFORE any tally runs, seeds the per-area accumulator map ONLY for granted area ids (an uncleared area gets no entry at all — never a zero row), reuses the existing `computeOverdue()` helper for overdue counts (one implementation, never a second copy that could disagree with the item routes), and derives `mine` from the SAME already-filtered rows matched against the caller's own username. Needed no schema registration (a read route) — confirmed via `node scripts/list-unvalidated-routes.js` rather than assumed.
- Built `public/js/deal-home.js`: an IIFE module exporting `window.renderDealHome(dealId)` that renders three panels — a setup checklist (from `GET /api/deals`, the caller's own deal, with a resume link into `/deal-wizard.html` when any of the six wizard steps is outstanding), readiness-assessment completion (from `GET /api/assessment-status`'s already-ordered `bySubject`, including owner/due-date for pending instances, never presented as a blocker), and diligence progress (from this plan's own `GET /api/dd/summary`, one row per returned area with its overdue count highlighted and a findings count calling out the critical tally). Zero markup-assignment sinks anywhere in the file; zero reference to the admin audit route (no activity feed, D-20).
- Turned `public/js/dashboard.js`'s two pre-existing anonymous `DOMContentLoaded` handlers into named functions (`initDemoDashboard()`, `initReadinessStrip()`) by changing ONLY their opening/closing lines, then added a single new dispatcher listener ahead of them that resolves `GET /api/auth/me` and either shows `#deal-home` + delegates to `renderDealHome()`, or calls both named functions unchanged — so a deal-bound session performs NONE of the demo path's network calls (including the readiness strip's own separate `/api/assessment-status` fetch), and a demo-bound session runs the exact same code it always did. `git diff` over the whole commit proves zero lines changed inside either body.
- Added `#deal-home` (hidden by default) to `public/dashboard.html` immediately after the existing empty-state block, a scoped `<style>` block for the new panels, and bumped both changed script tags to `?v=1784700001` (`transitions.js` already carried that stamp from Plan 07). Added the owner nudge to `public/js/due-diligence.js` — a count badge next to the workspace title plus a dismissible banner raised through the EXISTING `window.makeBannerDismissible` mechanism with its session-scoped (not permanent) dismissal-key convention, naming counts only, never an area/item/person — and bumped `public/due-diligence.html`'s own script-tag cache stamp in a follow-up commit after catching that the first commit had missed it.
- 13 new tests in `test/dd-summary.test.js`: 8 integration cases proving the rollup's clearance scoping, overdue computation, findings tally and `mine` counts end-to-end over real HTTP, plus 5 source-level assertions proving the wiring (deal-home fetches the right routes, no markup sink, no audit-route reference, dashboard delegates rather than renders, due-diligence raises the nudge through the shared mechanism).
- **Checkpoint (Task 3):** the coordinator ran the full 7-step browser verification live against a running server (`:3403`) rather than delegating it back to me (I have no browser tool). Every check passed, including the one that mattered most — the demo showcase (admin, no bound deal) rendered exactly as before: `#deal-home` computed `display:none`, `#dashboard-main-view` `display:block`, target name intact, 29 gauge elements, readiness strip present, zero console errors. The clean-room invisibility property was independently confirmed at BOTH layers: the API response (`areas: ["legal","hr"]` only, for a caller granted only those two) and the rendered DOM (uncleared areas completely absent, not greyed/locked/zeroed).

## Task Commits

Each task was committed atomically:

1. **Task 1: The clearance-scoped DD rollup endpoint** - `2261b35` (feat)
2. **Task 2: The deal home and the owner nudge** - `f11cc17` (feat)
3. **Fix: cache-stamp bump missed in Task 2's commit** - `290645f` (fix)

Task 3 (the `checkpoint:human-verify` gate) required no code commit — it was a verification-only gate, run live by the coordinator against a running server, and approved.

## Files Created/Modified

- `server.js` (modified) — `GET /api/dd/summary`
- `public/js/deal-home.js` (new) — `window.renderDealHome()`: setup checklist, readiness completion, diligence progress panels
- `public/js/dashboard.js` (modified) — the deal-bound dispatcher; `initDemoDashboard()`/`initReadinessStrip()` (named-function conversion of the two pre-existing handlers, bodies unchanged)
- `public/dashboard.html` (modified) — `#deal-home` container, `deal-home.js` script tag, scoped `<style>` block, cache stamps bumped to `?v=1784700001`
- `public/js/due-diligence.js` (modified) — `renderOwnerNudge()`/`loadOwnerNudge()`
- `public/due-diligence.html` (modified) — cache stamp bumped to `?v=1784700003` for the due-diligence.js change
- `test/dd-summary.test.js` (new) — 13 tests: 8 integration + 5 source-level
- `.planning/phases/04-due-diligence-workspace/04-CONTEXT.md` (modified) — D-22 amended (see Decisions Made)

## Decisions Made

- **`GET /api/dd/summary` carries no explicit role gate** — every number is already scoped through `filterByAreaGrant()`/`grantedAreas()`, mirroring the existing DD list routes; this is a caller-scoped read, unlike `GET /api/deals/:id/grants` (Plan 02, narrowed to admin/hrbp because THAT route returns every member's clearance map unfiltered).
- **Both pre-existing `dashboard.js` handlers were converted to named functions**, not just the first one, so the dispatcher could gate the readiness strip's own separate fetch too — satisfying the plan's "skip the demo assessment fetch entirely" requirement for a deal-bound session.
- **[User decision, checkpoint] D-22 amended to match the code, not the other way around.** See the "D-22 amendment" section below for the full finding and reasoning.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `public/due-diligence.html`'s cache stamp was missed in Task 2's commit**
- **Found during:** post-Task-2 self-review, before returning the checkpoint
- **Issue:** `public/js/due-diligence.js` gained the owner-nudge code in Task 2's commit, but its loading page's script-tag cache stamp was not bumped — Phase 3 previously shipped a stale-cache bug by skipping exactly this step (04-CONTEXT.md's own named precedent, cited in this plan's own warnings).
- **Fix:** Bumped `public/due-diligence.html`'s script tag from `?v=1784700002` to `?v=1784700003` in a follow-up commit.
- **Files modified:** `public/due-diligence.html`
- **Verification:** `grep -rln "due-diligence.js" public/*.html` confirms only `public/due-diligence.html` loads it; `npm test` stayed green (224/224) throughout.
- **Committed in:** `290645f`

### D-22 amendment (user decision, not a Rule 1-4 auto-fix)

While preparing the Task 3 checkpoint I verified 04-CONTEXT.md's D-22 ("Archived deals become a read-only freeze with member access retained... writes are refused") directly against the actual Phase-3 code and found it factually wrong:

- `db/resolver.js`'s `resolveDatabase()` (line 97): `if (!deal || deal.status === 'archived' || !controlStore.isDealMember(dealId, req.portalUser)) throw new DealAccessError(403, ...)` — ONE branch, with no read/write distinction. The function never inspects `req.method` for access-control purposes (only for the audit-request-meta object, line 143).
- `db/controlStore.js`'s `listDealsForUser()` (line 98) filters archived deals out of every member's deal list entirely.
- The archive route additionally force-releases every session bound to the archived deal back to demo, at archive time.

Net effect: an archived deal is completely unreachable through the app — no reads, no writes, no listing, for anyone, admin included (except the dedicated `/api/admin/deals*` control-plane surface used to archive/unarchive/delete it). This is a materially different (and stricter) behavior than "read-only with retained access."

This is a Rule-4-shaped finding (fixing it for real would mean reopening Phase 3's resolver/session-release/list-filtering design — cross-cutting, outside this plan's declared file scope), so I surfaced it at the checkpoint rather than unilaterally fixing or leaving it silently wrong. **User decision: amend the decision text to match the code; do not touch the code.** Reasoning given: the current fail-closed behavior is the safer direction for MNPI, and post-close read access is a convenience rather than a compliance requirement.

04-CONTEXT.md's D-22 has been amended in place (original text struck, amendment dated and attributed) — see that file for the full text. No code was changed to produce this amendment: `db/resolver.js`, the archive route, and `listDealsForUser()` are all untouched by this plan. The future-enhancement shape (if ever needed) is recorded there and in STATE.md, not lost.

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking) + 1 user-decided documentation amendment (D-22, no code change)
**Impact on plan:** Both are narrow. The cache-stamp fix prevents a known stale-cache failure mode this codebase has hit before. The D-22 amendment corrects a pre-existing (Phase 3-era) documentation/code mismatch discovered during this plan's own checkpoint prep — it changes no behavior, since the code was already doing the stricter, safer thing; only the written decision now says so accurately.

## Issues Encountered

**UAT WAL trap (coordinator-reported, for future verifiers).** During the coordinator's live checkpoint verification, a test deal was created against the running server. `data/control.db`'s committed blob has `deals: []`, and `git status` initially showed the tree clean — but the write had landed un-checkpointed in the gitignored `data/control.db-wal` sidecar (16512 bytes). Anything that later triggered a `PRAGMA wal_checkpoint` against that connection (a clean server restart, another write, etc.) would have silently folded the throwaway UAT deal into the committed `control.db` blob, corrupting the demo-safe baseline with a UAT artifact and being invisible to `git status` right up until that checkpoint happened. The coordinator cleaned it up the same way Plan 03's own precedent describes: removed the `-wal`/`-shm` sidecars, `git checkout -- data/control.db`, deleted the orphaned `data/deals/<id>.db*` files, and verified after (`deals: []`, `users: 4`, tree clean, `npm test` 224/224 — confirmed independently by me as well, immediately before writing this summary). **Anyone doing a live UAT walk against a committed WAL-mode SQLite file in this repo should checkpoint-and-verify (or discard the WAL sidecars) before trusting `git status` alone** — this is the same class of gotcha Plan 03's own summary already flagged for `data/demo.db`/`data/control.db`, now confirmed to recur for a live UAT session specifically.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 4 (Due Diligence Workspace) is now complete — all 8 plans done: DD request items + clean-room access (01-02), findings register + one-click conversion (03), workstream-lead area grants (02), VDR link references (05), the new-deal setup wizard server- and client-side (06-07), and this plan's deal home + rollup + owner nudge (08).
- `GET /api/dd/summary`'s aggregation pattern (filter-before-tally, omit-not-zero) is the reusable shape for any future rollup over MNPI-bearing per-area data — Phase 6's flight-risk register (already flagged in db/accessPolicy.js's own header comment as the next consumer of this clean-room primitive) should follow it.
- The named-function-conversion technique for adding an early-exit branch to a large legacy single-listener file (proven here on `public/js/dashboard.js`) is available for any future phase that needs to branch a monolithic demo-showcase page on a new persona/mode without re-auditing its existing body.
- D-22's amendment is the one open item carried forward: post-close read-only access for archived deals remains a captured-but-unscheduled future enhancement (see STATE.md and 04-CONTEXT.md's D-22 for the concrete shape if ever prioritized).
- No blockers for milestone close. Per the project's release-per-milestone policy (PROJECT.md Constraints), the next step after this phase's formal transition is `/gsd-verify-work 4`, then eventual milestone completion and a GitHub release cutting all remaining phases together — confirm with the user before touching remote `main` (all commits in this phase are local-only, matching this project's established workflow).

---
*Phase: 04-due-diligence-workspace*
*Completed: 2026-08-02*
