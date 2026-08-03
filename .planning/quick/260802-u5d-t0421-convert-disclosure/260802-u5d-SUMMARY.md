---
quick_id: 260802-u5d
slug: t0421-convert-disclosure
subsystem: security
tags: [dd-findings, clean-room, disclosure, textContent, node-test]

# Dependency graph
requires:
  - phase: 04-dd-workspace
    provides: DD findings register, one-click convert control, clearance-filtered DD routes
provides:
  - Clean-room disclosure on the DD finding convert control (T-04-21 closure)
  - Cache-busted script tag for public/js/due-diligence.js
  - Source-level regression test locking the disclosure in place
affects: [security-phase-4-reverify]

actuals:
  tokens: 883
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Client-side security disclosures verified by source-level node:test assertions (matching the existing dd-vdr (m) pattern), since a UI-only control has no server-observable side effect an HTTP test could catch."

key-files:
  created: []
  modified:
    - public/js/due-diligence.js
    - public/due-diligence.html
    - test/dd-findings.test.js

key-decisions:
  - "Built the disclosure the T-04-21 threat register already promised, rather than implementing clearance-filtering of /api/raid and /api/integration-tasks. The stronger filter was explicitly deferred by the user as new scope requiring its own design decision (who should see a converted finding, given conversion's whole purpose is to move an item into the shared execution lane)."
  - "Disclosure renders unconditionally for every finding row (not just unconverted ones), since an already-converted finding still documents where its content went."

requirements-completed: []

coverage:
  - id: D1
    description: "Convert control (Create Day-1 task / Create RAID entry buttons) now renders a textContent-only disclosure naming the whole-deal-team audience, addressing the T-04-21 accepted-risk condition."
    verification:
      - kind: unit
        ref: "test/dd-findings.test.js#dd-findings (p): the convert control discloses the whole-deal-team audience via textContent, not markup"
        status: pass
    human_judgment: true
    rationale: "Source/test-level proof only covers that the string exists and is wired via textContent. Actual visual rendering, placement, and legibility in the live finding row must be confirmed in a browser — the executing agent has no browser. Orchestrator will UAT this live before re-running /gsd-secure-phase 4."
  - id: D2
    description: "Cache stamp on public/due-diligence.html bumped from ?v=1784700003 to ?v=1784800003 so browsers with the old script cached actually receive the disclosure."
    verification:
      - kind: other
        ref: "grep -c \"due-diligence.js?v=1784800003\" public/due-diligence.html -> 1"
        status: pass
    human_judgment: false

duration: ~10min (across two commits, 18:06-18:08 local)
completed: 2026-08-03
status: complete
---

# Quick Task 260802-u5d: Convert-Control Clean-Room Disclosure (T-04-21) Summary

**Added a textContent-only disclosure to the DD finding convert control naming the whole-deal-team audience, plus a source-level regression test — closing the accepted-risk condition `/gsd-secure-phase 4` flagged as unmet.**

## Performance

- **Tasks:** 2/2 completed
- **Files modified:** 3 (`public/js/due-diligence.js`, `public/due-diligence.html`, `test/dd-findings.test.js`)
- **Commits:** 2 (`541dc08`, `b5b4632`)

## Accomplishments

- `public/js/due-diligence.js`'s `convertRow` block now appends a `span.dd-finding-convert-note` (via the file's existing `el()` helper's `text:` property, so it is `textContent`-only) after both convert buttons and any `dd-finding-linked` badges, reading: *"Visible to the whole deal team once created — not only members cleared for this area."* It renders for every finding row unconditionally, regardless of `hasTask`/`hasRaid`, so an operator sees it before converting AND an already-converted finding still documents where its content went.
- Added a minimal `.dd-finding-convert-note` style rule (block, small italic dim text) to `public/due-diligence.html`'s existing scoped `<style>` block, matching the page's established inline-style convention (no new CSS file, no framework).
- Bumped the script cache stamp `public/due-diligence.js?v=1784700003` -> `?v=1784800003` in `public/due-diligence.html:74`, avoiding the exact stale-cache regression this project shipped before (precedent commit `290645f`).
- Added `test/dd-findings.test.js`'s `dd-findings (p)`, a source-level assertion (mirroring the existing `dd-vdr (m)` pattern) that `public/js/due-diligence.js` contains the whole-deal-team disclosure text AND that the line assigning it uses the `text:` property, not a markup sink.

## Task Commits

1. **Task 1: Add the disclosure to the convert control** - `541dc08` (fix) — JS disclosure span + accompanying CSS legibility rule
2. **Task 2: Cache stamp + regression test** - `b5b4632` (fix) — cache-stamp bump + `dd-findings (p)` regression test

_No separate plan-metadata commit was made — see final commit below for STATE/SUMMARY bookkeeping._

## Files Created/Modified

- `public/js/due-diligence.js` - Appends the T-04-21 clean-room disclosure span to every finding row's convert control (textContent via `el()`'s `text:`)
- `public/due-diligence.html` - Adds `.dd-finding-convert-note` style rule; bumps the script's cache-busting query param
- `test/dd-findings.test.js` - New `dd-findings (p)` source-level regression test

## Decisions Made

- Built the disclosure (informed-consent control) rather than the stronger outbound clearance filter on `/api/raid`/`/api/integration-tasks`, per explicit user direction — the filter is deferred, out of scope, and needs its own design decision about who should see a converted finding.
- Disclosure always renders (not conditional on conversion state) so it functions both as a pre-decision warning and a post-conversion record.

## Deviations from Plan

None - plan executed exactly as written. No Rule 1-4 auto-fixes were needed; the two tasks matched the plan's scope precisely.

## Issues Encountered

None. The one risk called out in the task brief — confirming the new test actually fails pre-fix — was explicitly verified: the disclosure code was temporarily removed from `public/js/due-diligence.js` (via a working-copy backup/restore, no extra commit), `dd-findings (p)` was re-run in isolation and failed with `AssertionError: the finding-row convert control must disclose that conversion makes the entry visible to the whole deal team (T-04-21) — this text has been removed or reworded`, then the fix was restored (file diffed byte-identical against the committed version afterward) and the full suite re-run green.

## Verification Results

- `npm test` -> **240/240** (239 baseline + `dd-findings (p)`).
- `grep -c innerHTML public/js/due-diligence.js` -> `0`.
- `grep -c "due-diligence.js?v=1784800003" public/due-diligence.html` -> `1`.
- `node scripts/list-unvalidated-routes.js` -> exit `0` ("Every registered write route has a schema in WRITE_SCHEMAS.").
- `data/` was never touched; `git status --short data/` is empty.

**Not verified (out of scope for this agent, no browser available):** actual visual rendering of the disclosure in a live browser. Per the plan's explicit constraint, the orchestrator will confirm this live in Playwright before re-running `/gsd-secure-phase 4`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for the orchestrator's live Playwright confirmation that the disclosure renders visibly on the finding row.
- Ready for `/gsd-secure-phase 4` re-run once rendering is confirmed — this closes the last of the 60 T-04-* threats (59 were already closed; T-04-21 was the sole blocker).
- The deferred hardening item (clearance-filtering `/api/raid` and `/api/integration-tasks` for DD-sourced entries) remains logged for a later phase per the user's explicit scope decision; not tracked as a blocker here.

## Self-Check: PASSED

All modified/created files confirmed present on disk (`public/js/due-diligence.js`, `public/due-diligence.html`, `test/dd-findings.test.js`, this SUMMARY). Both commit hashes (`541dc08`, `b5b4632`) confirmed present in `git log --oneline --all`.

---
*Quick task: 260802-u5d-t0421-convert-disclosure*
*Completed: 2026-08-03*
