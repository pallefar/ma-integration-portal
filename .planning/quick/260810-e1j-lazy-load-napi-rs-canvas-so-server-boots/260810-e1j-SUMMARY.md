---
phase: quick-260810-e1j
plan: 01
subsystem: infra
tags: [express, node-canvas, portability, boot, pdf]

requires: []
provides:
  - "Lazy-loaded lib/reportPack accessor (getReportPack()) so server.js's module load no longer touches @napi-rs/canvas"
  - "GET /api/reports/pack 503 degradation contract for hosts without a vendored skia binding"
affects: [reports-pack, reports-audit, deployment, release-cut-linux-boot]

actuals:
  tokens: 3582
  tasks: 2
  commits: 1

tech-stack:
  added: []
  patterns:
    - "Lazy require() behind a cached module-scope accessor, with a permanent (process-lifetime) failure cache for a fixed host-capability check — contrasted explicitly with WR-03's transient-failure anti-pattern in the code comment"

key-files:
  created: []
  modified:
    - server.js
    - test/reports-pack.test.js

key-decisions:
  - "getReportPack() caches BOTH the success (module) and the failure (unavailable flag) permanently for the process lifetime — a missing native binding cannot change while the process runs, so retrying would only re-pay a failed module resolution and re-log the same error on every request."
  - "The 503 guard is the route handler's first statement, before readDb()/controlStore.getDeal() and before the recordSecurityEvent() audit call — mirroring how this route family's existing 400/409 refusals never audit."
  - "The [portability] failure log fires at most once per process (on first failed require), not once per rejected request — proven by the sabotaged-loader child-process test asserting exactly one matching stderr line across two consecutive getReportPack() calls."
  - "The ReportPackLanguageSchema module-level const (a SECOND top-level touch of lib/reportPack via reportPack.SUPPORTED_LANGUAGES) was deleted and rebuilt inline in the handler from packLib.SUPPORTED_LANGUAGES, resolved only after the availability guard — deleting only the line-59 require would have left this second load-time touch as an equally-fatal boot crash."

requirements-completed: [QUICK-E1J]

coverage:
  - id: D1
    description: "server.js has no module-load-time path to lib/reportPack — proven both structurally (no top-level require/binding) and behaviorally (require.cache empty after a clean boot)"
    requirement: QUICK-E1J
    verification:
      - kind: unit
        ref: "test/reports-pack.test.js#reports-pack [portability]: (a) server.js has no top-level require of lib/reportPack"
        status: pass
      - kind: integration
        ref: "test/reports-pack.test.js#reports-pack [portability]: (c) a clean host boot leaves lib/reportPack unloaded (require.cache empty)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A host without the vendored skia binding still boots the whole portal; GET /api/reports/pack alone degrades to a 503 with a fixed body, announced exactly once per process via a [portability]-prefixed console.error"
    requirement: QUICK-E1J
    verification:
      - kind: integration
        ref: "test/reports-pack.test.js#reports-pack [portability]: (d) a sabotaged @napi-rs/canvas binding still boots the portal and degrades to null, once, per process"
        status: pass
      - kind: unit
        ref: "test/reports-pack.test.js#reports-pack [portability]: (b) getReportPack() lazily requires and caches the module, and the route refuses with 503 before any audit call"
        status: pass
    human_judgment: false
  - id: D3
    description: "On a host WITH the binding, the pack route is behaviorally unchanged: same PDF, same codename filename, same audit event, same 409 empty-deal refusal, same ?lang= fallback to English"
    requirement: QUICK-E1J
    verification:
      - kind: integration
        ref: "test/reports-pack.test.js#reports-pack route (GET /api/reports/pack) — all 5 pre-existing subtests, unmodified"
        status: pass
      - kind: integration
        ref: "test/reports-audit.test.js (independent consumer of GET /api/reports/pack's audit event)"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-08-10
status: complete
---

# Quick Task 260810-e1j: Lazy-load @napi-rs/canvas's steerco pack module Summary

**server.js no longer touches @napi-rs/canvas at module load — GET /api/reports/pack now acquires lib/reportPack lazily and degrades to a 503 (rather than aborting the whole portal's boot) on hosts, like linux-arm64, without the vendored skia binding.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2
- **Files modified:** 2 (server.js, test/reports-pack.test.js)

## Accomplishments

- Removed the top-level `const reportPack = require('./lib/reportPack')` from server.js's module-load path (server.js:59), replacing it with a lazy, cached `getReportPack()` accessor called only from inside the pack route.
- Deleted the second, equally-fatal top-level touch of the module — `const ReportPackLanguageSchema = z.enum(reportPack.SUPPORTED_LANGUAGES).catch('en')` — and rebuilt language resolution inline in the handler, from the loaded module's own `SUPPORTED_LANGUAGES`, after the availability guard.
- `GET /api/reports/pack`'s first statement now calls `getReportPack()`; when it returns `null`, the route replies `503 { error: 'PDF pack generation is unavailable on this host platform' }` before any DB read or audit call.
- A failed load is cached permanently for the process lifetime and logged exactly once via a `[portability]`-prefixed `console.error`, never re-attempted per request.
- Exported `getReportPack` on `module.exports` so a test can drive the binding-absent path in a child process even on a host where the binding is actually present.
- Added four new `reports-pack [portability]:` test cases (two source-structural, two child-process runtime proofs) that were RED against unmodified `main` and are GREEN after the fix.

## Task Commits

Per the plan, Task 1 (writing the four failing tests) was not committed separately — both files landed in a single atomic commit per the plan's explicit constraint.

1. **Task 1 + Task 2 combined:** `c5d0573` — `fix(quick): lazy-load the steerco pack module so the portal boots without a skia binding`

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified

- `server.js` — removed the top-level `reportPack` require and the module-level `ReportPackLanguageSchema` const; added `reportPackModule`/`reportPackUnavailable` state and `getReportPack()`; made the pack route's first statement the 503 availability guard; changed the `buildPack`/`SUPPORTED_LANGUAGES` call sites to use the locally-resolved `packLib`; exported `getReportPack`.
- `test/reports-pack.test.js` — added `child_process`'s `spawnSync` to the existing require cluster; appended four `[portability]` test cases proving the structural shape (no top-level require, correct getter/guard ordering) and the runtime behavior (clean-host require.cache stays empty; sabotaged-binding host still boots and degrades to `null` with exactly one log line).

## Decisions Made

- Cache the failure permanently for the process lifetime rather than retrying per request — a missing native binding is a fixed host property that cannot change mid-process, so a retry could only re-emit the identical error. Deliberately contrasted in-code with the WR-03 review finding (permanently poisoning a *transient* failure was wrong there; this failure is not transient, so the same "poison once" shape is correct here).
- Kept the existing `.catch('en')` fallback semantics byte-identical, just resolved from `packLib.SUPPORTED_LANGUAGES` instead of the removed module-level `reportPack.SUPPORTED_LANGUAGES` — no local copy of the language list was introduced in server.js, preserving lib/reportPack as the single source of truth (WR-04 discipline).
- Placed the 503 guard before the `try` block entirely, matching how the route's existing 400/409 refusals never write an audit row.

## Deviations from Plan

None — plan executed exactly as written. All four `<read_first>` locations, the exact refusal sentence, the `getReportPack()` shape, and the single-atomic-commit constraint were followed as specified.

## Issues Encountered

None. The suite ran clean on the first attempt after the Task 2 edits; no auto-fix iterations were needed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The portal now boots on any host lacking a vendored skia binding (e.g. linux-arm64), which was the blocker found during milestone-close Linux boot verification.
- `node --test` is 655/655 (up from the 651 baseline, +4 new cases), zero regressions.
- Remaining milestone-close open items (Phase 1 formal close, whole-codebase Fable security review, release cut) are unaffected by and independent of this fix.

---
*Quick task: 260810-e1j*
*Completed: 2026-08-10*
