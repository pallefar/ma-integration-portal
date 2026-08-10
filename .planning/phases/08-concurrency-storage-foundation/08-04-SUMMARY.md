---
phase: 08-concurrency-storage-foundation
plan: 04
subsystem: client
tags: [fetch-wrapper, retry, contention-ux, transitions.js, node-vm-test]

# Dependency graph
requires:
  - "server.js central 503 + Retry-After error middleware (08-01)"
provides:
  - "Bounded, jittered client-side auto-retry (up to 2 retries) for a same-origin /api write that returns 503, honoring Retry-After, inside the SAME window.fetch wrapper transitions.js already owns"
  - "A give-up toast (D-08) shown only when retries are exhausted or the request body cannot be safely re-sent, leaving the page/form untouched"
  - "ma-fetch-wrapper:begin / ma-fetch-wrapper:end sentinel comments marking the extraction region for node:vm-based testing of the wrapper"
  - "test/client-busy-retry.test.js — behavioral proof of the retry cap, Retry-After honoring, and give-up toast, run on every node --test / npm test"
affects: []

# Actuals (#2632)
actuals:
  tokens: 3872
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Extending an existing window.fetch override in place rather than installing a second interceptor — sentinel-delimited so a node:vm test can slice and evaluate just that region without loading the rest of the DOM-heavy file"
    - "Recursive attemptFetch(input, init, url, method, attempt) closure re-issuing origFetch with identical input/init on 503, capped at a small literal retry constant with Math.random()-derived jitter on the wait"
    - "node:vm region-slice testing: extract sentinel-delimited source, run it in a fresh vm context per test seeded with a minimal browser global stub set (window/document/localStorage/location/URL/Headers/setTimeout), assert on recorded call count/timing/DOM mutations"

key-files:
  created:
    - test/client-busy-retry.test.js
  modified:
    - public/js/transitions.js

key-decisions:
  - "Built the give-up toast helper as part of Task 1's commit (not deferred to Task 2 as PLAN.md's task split literally suggested) — the 503 give-up branch needed a call target to exist for Task 1's own <verify> region to be a complete, non-dead-ended code path; deferring it would have left an incomplete give-up branch committed under Task 1's name. Both tasks still modify only the two files in files_modified, and every acceptance criterion for both tasks passes. Documented under TDD Gate Compliance below since this reorders Task 2's nominal RED-before-GREEN framing (PLAN.md's own <action> text for Task 2 explicitly specifies 'first build the toast, then create the test' — an implementation-first order the plan itself dictates despite the tdd=\"true\" attribute)."
  - "Retry-After: '0' used in the two-503-then-200 and three-503 test cases (rather than a larger value) to keep the fast suite fast — only the dedicated Retry-After: 2 case exercises a real ~2s wait to prove the timing contract; this is a test-authoring choice, not a change to the wrapper's own fallback/jitter behavior."
  - "isRetryableBody(init) checks init.body is undefined/null/string; a stream or a Request object with a possibly-consumed body falls straight to the give-up path on the FIRST 503 (no retry attempted) rather than risking a corrupt second request, exactly as PLAN.md's <action> specifies."

patterns-established:
  - "ma-fetch-wrapper:begin / ma-fetch-wrapper:end sentinel-comment convention for marking a region of a DOM-load-heavy client file that a node:vm test can extract and evaluate in isolation — reusable by any future test needing to exercise transitions.js control flow without booting a browser."

requirements-completed: [CONC-01]

coverage:
  - id: D1
    description: "A same-origin /api write that 503s twice then succeeds is retried transparently — the caller sees only the eventual 200, origFetch is called exactly 3 times, and no give-up toast is shown."
    requirement: "CONC-01"
    verification:
      - kind: unit
        ref: "test/client-busy-retry.test.js: 'two 503s then 200 — caller sees 200, origFetch called 3 times, no toast'"
        status: pass
    human_judgment: false
  - id: D2
    description: "A same-origin /api write that 503s three times in a row (retry cap reached) resolves to the final 503, origFetch is called exactly 3 times, and exactly one give-up toast containing 'not saved' is appended — the page/form is left untouched (no synchronous DOM removal)."
    requirement: "CONC-01"
    verification:
      - kind: unit
        ref: "test/client-busy-retry.test.js: 'three 503s — caller sees final 503, origFetch called 3 times, exactly one give-up toast'"
        status: pass
    human_judgment: false
  - id: D3
    description: "A 503 on a cross-origin URL, a same-origin non-/api URL, or a 500 on a same-origin /api URL is never retried and never produces a give-up toast — only a same-origin /api 503 is the contention signal this wrapper acts on."
    requirement: "CONC-01"
    verification:
      - kind: unit
        ref: "test/client-busy-retry.test.js: three tests — cross-origin 503, same-origin non-/api 503, and same-origin /api 500 — each asserting exactly 1 origFetch call and 0 appended elements"
        status: pass
    human_judgment: false
  - id: D4
    description: "The retry wait honors a numeric Retry-After header (with jitter added on top), producing a measured inter-call gap of at least the header's value."
    requirement: "CONC-01"
    verification:
      - kind: unit
        ref: "test/client-busy-retry.test.js: 'Retry-After: 2 schedules the retry at least 2000ms after the first attempt' — asserts a real measured gap >= 2000ms between recorded call timestamps"
        status: pass
    human_judgment: false
  - id: D5
    description: "Exactly one wrapper owns window.fetch in public/js/transitions.js; the sentinel-delimited wrapper region contains the 503 branch, reads Retry-After, and contains no page-reload call or CMS banner fetch in the give-up path."
    requirement: "CONC-01"
    verification:
      - kind: other
        ref: "PLAN.md's own <verify> node -e scripts, re-run at plan close: sentinel presence/order + 503/Retry-After regex match inside the region (pass), exactly one 'window.fetch =' assignment in the whole file (pass), no location.reload/\\/api\\/banners inside the sentinel region (pass)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The give-up toast sets its message via textContent only (never markup assignment), so it introduces no new client XSS sink."
    requirement: "CONC-01"
    verification:
      - kind: unit
        ref: "test/client-xss-sinks.test.js — 10/10 pass, unchanged by this plan's addition"
        status: pass
    human_judgment: false
  - id: D7
    description: "Full test suite stays green after this plan's changes — no regression introduced by the extended fetch wrapper or the new test file."
    verification:
      - kind: other
        ref: "npm test — 695/695 pass"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-08-10
status: complete
---

# Phase 8 Plan 4: Client Busy-Retry & Give-Up Toast Summary

**A same-origin `/api` write that hits Phase 8's server-side `503 Retry-After` contention signal now retries silently (up to twice, honoring `Retry-After` with jitter) inside the app's existing `window.fetch` wrapper, and tells the user plainly — with their form still on screen — only if it truly cannot be saved.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-10T20:50:00Z (approx, worktree spawn)
- **Completed:** 2026-08-10T20:52:23Z
- **Tasks:** 2
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments

- `public/js/transitions.js`'s existing `window.fetch` override (the same one that already injects the admin token and handles 401s) gained a `503` branch, sibling to the existing `401` branch, reusing the SAME `isApi(url)` helper — no second interceptor was added.
- The retry is capped at 2 attempts (3 total), waits on the server's `Retry-After` header (falling back to 1s when absent/unparseable) plus up to 300ms of `Math.random()` jitter to desynchronize tabs contending on the same write, and is skipped when the request body is not a string or absent (a stream/consumed-`Request` body is never re-sent).
- A small give-up toast — built fresh in `transitions.js`, not reused from `banners.js` (a CMS-fetched page-banner system) or `dashboard.js`'s page-scoped `showToast()` — fires only when retries are exhausted or the body can't be safely resent. It sets its message via `textContent`, appends to `document.body`, and self-removes after 5s; nothing else on the page is touched.
- The wrapper IIFE is now delimited by `ma-fetch-wrapper:begin` / `ma-fetch-wrapper:end` sentinel comments so a test can extract just that region.
- `test/client-busy-retry.test.js` (new) slices the sentinel region and runs it in `node:vm` against a minimal stubbed browser global set, proving all 6 behaviors from PLAN.md's `<behavior>` block: retry-then-succeed, exhausted-retry give-up, cross-origin/non-`/api`/500 non-retry cases, and `Retry-After` timing.

## Task Commits

Each task was committed atomically:

1. **Task 1: Bounded, jittered silent retry inside the existing fetch wrapper** - `11e1de8` (feat) — includes the give-up toast helper (see Decisions Made / TDD Gate Compliance for why it landed here rather than Task 2)
2. **Task 2: Give-up toast, and a behavioral test that drives the wrapper** - `a20038f` (test) — the test file; the toast implementation itself was already present from Task 1's commit

## Files Created/Modified

- `public/js/transitions.js` - existing `window.fetch` wrapper extended with a `503` retry branch (capped, jittered, `Retry-After`-aware, body-safety-checked) and a new give-up toast helper; sentinel comments added to delimit the region for testing
- `test/client-busy-retry.test.js` (new) - `node:vm`-based behavioral test slicing the sentinel-delimited wrapper region; 6 tests covering every behavior in PLAN.md's `<behavior>` block

## Decisions Made

- The give-up toast helper was built inside Task 1's commit rather than deferred to Task 2 as PLAN.md's literal task split implies. Task 1's `<action>` calls for a complete give-up branch ("Return the final response to the original caller either way") and Task 1's own `<verify>` scripts check the whole sentinel region — leaving the 503 branch's exhausted-retry path with no call target would have made Task 1's commit an incomplete, effectively broken code path under its own name. Both tasks still touch only `public/js/transitions.js` and `test/client-busy-retry.test.js` per `files_modified`, and every acceptance criterion in both tasks passes. See "TDD Gate Compliance" below for how this affects the RED/GREEN framing.
- `Retry-After: '0'` was used in the two-503-then-200 and three-503 test cases to keep those tests fast (jitter-only wait, no real multi-second delay); only the dedicated `Retry-After: 2` test exercises a real ~2-second wait, which is what actually proves the timing contract. This is a test-authoring choice and does not change the wrapper's own fallback (1000ms) or jitter (up to 300ms) constants.
- `isRetryableBody(init)` treats `undefined`/`null`/`string` bodies as safely re-sendable and everything else (a stream, a `FormData`, an already-read `Request`) as not — on the very first 503, an unsafe body skips the retry loop entirely and goes straight to the give-up toast rather than risking a corrupt second request, exactly as PLAN.md's `<action>` specifies.

## TDD Gate Compliance

Task 2 carries `tdd="true"`, but this plan's execution does not follow a strict RED-then-GREEN commit order: Task 1's commit (`11e1de8`, `feat`) includes both the retry branch AND the give-up toast implementation; Task 2's commit (`a20038f`, `test`) adds only the test file, after the implementation it covers already existed and was already green under `node --test`.

This is a deliberate deviation from the canonical RED/GREEN gate sequence, made for two reasons:
1. PLAN.md's own `<action>` text for Task 2 explicitly specifies an implementation-first order ("First, build the give-up surface... Then create `test/client-busy-retry.test.js`") — the plan itself does not describe a test-first sequence for this task, despite the `tdd="true"` attribute.
2. Task 1's `<verify>` scripts operate on the whole sentinel-delimited region and would have been checking an incomplete give-up branch if the toast call were deferred.

No RED phase (a failing test observed before the implementation existed) occurred for this behavior. All 6 tests in `test/client-busy-retry.test.js` passed on first run against the already-committed implementation. This is a full-plan-scope note, not a hidden gap: every behavior in PLAN.md's `<behavior>` block is covered and passing (`node --test test/client-busy-retry.test.js` — 6/6 pass), and the full suite is green (`npm test` — 695/695 pass). The deviation is procedural (commit/test ordering), not a coverage gap.

## Deviations from Plan

### Auto-fixed Issues

None — no bugs found, no missing critical functionality beyond what's covered under "TDD Gate Compliance" and "Decisions Made" above (which are task-boundary/ordering choices, not bug fixes).

**Total deviations:** 1 (task-boundary reordering, documented above — not a Rule 1/2/3 auto-fix, a deliberate execution-order choice consistent with PLAN.md's own action text)

## Issues Encountered

None — both tasks' `<verify>` commands, the full `node --test test/client-busy-retry.test.js` run, the `node --test test/client-xss-sinks.test.js` run, and the full `npm test` run all passed on first attempt. No fix-attempt-limit issues, no auth gates, no checkpoints.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The full round trip (server 503 + Retry-After from 08-01 → client silent retry + give-up toast from this plan) is now in place for CONC-01's contention-invisible-to-the-user requirement.
- `test/client-busy-retry.test.js` exists as named in PLAN.md's `must_haves.artifacts` and is now part of the `npm test` suite going forward.
- No blockers. This plan's `<verification>`'s `<human-check>` item (triggering a real save during a real second process's write-lock hold, using plan 08-05's soak harness) remains a manual end-to-end check for phase-gate/UAT — not exercised by this plan's own automated verification, consistent with PLAN.md's stated split between automated `<verify>` and the phase-level `<human-check>`.

---
*Phase: 08-concurrency-storage-foundation*
*Completed: 2026-08-10*

## Self-Check: PASSED

- FOUND: public/js/transitions.js, test/client-busy-retry.test.js
- FOUND: commit 11e1de8 (Task 1), commit a20038f (Task 2) in `git log --oneline`
