---
phase: 12-data-layer-integrity-performance
plan: 10
subsystem: api
tags: [due-diligence, clean-room, batch-read, read-collections, perf, audit]

requires:
  - phase: 12-data-layer-integrity-performance
    provides: "12-05 readCollections/throwing accessors; 12-03 serve-time asset stamping (new due-diligence.js reaches browsers)"
  - phase: 11-authorization-clean-room-closure
    provides: "ROLE_READ_POLICY /api/dd rule, bounded dd-access-denied denial audit, CR-01 filtered 409 echo"
provides:
  - "server.js: GET /api/dd/workspace (areas + per-cleared-area items/findings/links + mine in one response)"
  - "server.js: DD_READ_SET, ddMineFor (shared with /api/dd/summary), ddVdrLinkEntry (shared with /api/dd/vdr-links)"
  - "public/js/due-diligence.js: load() is one fetch; the owner nudge is fed from the same response"
  - "DD GET handlers + request-item/finding create/update on readCollections(DD_READ_SET)"
affects: [12-11, 12-14]

actuals:
  tokens: 10000
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "batch endpoint = the per-area routes' own clearance functions, objects seeded only from granted area ids (uncleared area has no key/count)"
    - "one read-audit row per batch load (subject 'workspace') replaces one per area"

key-files:
  created:
    - test/dd-workspace-batch.test.js
  modified:
    - server.js
    - public/js/due-diligence.js
    - test/client-authz-hiding.test.js

key-decisions:
  - "ddMineFor takes the ALREADY clearance-filtered items/findings (not db, deal, user): both callers filter once anyway, so the builder never filters twice and cannot be fed unfiltered rows by a caller that forgot — documented in its header comment"
  - "The nudge counts are stored as state.summary = { mine } so the existing dd-summary source assertion ('summary.mine') passes unchanged while no summary request remains"
  - "DD_READ_SET stays exactly settings/ddRequestItems/ddFindings; the templates GET reads only ['ddRequestTemplates'] rather than widening the set every other DD route loads"

patterns-established:
  - "vm-executed page test: run the real client file in a Proxy-backed stub DOM and count fetch URLs (stronger than a source scan)"

requirements-completed: [DATA-02]

duration: ~25min
completed: 2026-10-10
status: complete
---

# Phase 12 Plan 10: DD workspace one-request load Summary

**`GET /api/dd/workspace` returns every cleared area's request items, findings and data-room links plus the caller's `mine` counts in one clearance-filtered response; the due-diligence page loads through it (18 `/api/dd/*` requests -> 1), and the DD handlers read only the DD collections.**

## Performance

- **Tasks:** 2 (Task 1 `type="tracer"` — its automated verify and the full suite re-ran green before expansion, per the dispatch policy)
- **Commits:** `fb38120` (workspace + page + suite), `8cd88b3` (handler conversion)
- **Suite:** 1366 at base -> **1374/1374**, 0 failures (host load 35-45 throughout; no flake seen)

## What changed

| Piece | Before | After |
|---|---|---|
| DD page load | `/api/dd/areas` + 2 x 8 per-area list reads + `/api/dd/vdr-links` + `/api/dd/summary` = 18 requests, each a full-deal `readDb()`; every save re-ran the 17 | 1 request (`/api/dd/workspace`), per load and per refresh |
| Read audit per page load | one `dd-findings-read` row per cleared area (8) | exactly one, subject `workspace` (demo: none, as before) |
| DD GET handlers / item+finding upserts | `readDb()` (all collections) | `readCollections(DD_READ_SET)` = settings, ddRequestItems, ddFindings; templates -> `['ddRequestTemplates']` |
| DELETE x2, instantiate, finding convert | `readDb()` | unchanged, with a comment explaining why (rare, multi-lane, already proportional on write via 12-02) |

Response shape: `{ areas, itemsByArea, findingsByArea, vdrLinksByArea, mine }`. The three by-area objects are seeded only from the caller's granted area ids (each present, possibly `[]`), items pass through `publicDdItem`, links through the shared `ddVdrLinkEntry`.

## Clean-room evidence

- **Equality (dd-workspace-batch a):** for hrbp (8 areas) and a financial-only pmo, every per-area array deep-equals the per-area route's response, `areas` equals `/api/dd/areas`, `mine` equals `/api/dd/summary`'s `mine`.
- **Anti-enumeration (b):** the pmo's workspace JSON contains no `"<uncleared-area-id>"` token and no uncleared record text.
- **Read policy (c2):** an employee in a real deal gets 403 and no `areas`/`itemsByArea` keys — covered by the existing `/api/dd` rule, no new policy row (read-policy-coverage and the 11-08 drift test untouched and green).
- **Writes (e):** create/update still carry the Phase 9 version precondition (stale -> 409), an uncleared caller's update/create -> uniform 403 with no record echo, and exactly one new `dd-access-denied` row per refused create (11-REVIEW-FIX-S WR-01 bounded denial audit unchanged).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] test/client-authz-hiding.test.js pinned the page's old first DD request**
- **Found during:** Task 1 full-suite run (1 failure: `WR-C04 (vm)` expected `['/api/auth/me', '/api/dd/areas']`)
- **Issue:** that test boots the real `due-diligence.js` and asserts the exact requests a pmo / demo-open caller makes. The plan's "must pass unchanged" list did not include it, but the changed URL is the plan's own intent (one workspace request).
- **Fix:** one-line expectation change to `['/api/auth/me', '/api/dd/workspace']` with a comment; the assertion's purpose (a refused role sends nothing, pmo/demo-open load as before) is unchanged.
- **Files modified:** test/client-authz-hiding.test.js
- **Commit:** fb38120

**2. [Rule 1 - Contract preservation] `summary.mine` source assertion in test/dd-summary.test.js**
- **Issue:** the unchanged dd-summary source test requires `due-diligence.js` to contain `summary.mine`. Removing the summary fetch would have broken it.
- **Fix:** the page keeps the nudge counts as `state.summary = { mine: ws.mine }` (the workspace's `mine` IS the summary builder's output), so the test passes untouched and no summary request remains.
- **Commit:** fb38120

### Plan-text refinements (intent kept)

- `ddMineFor(db, deal, user)` became `ddMineFor(items, findings, user)` taking pre-filtered rows (see key-decisions). Both `/api/dd/summary` and the workspace compute the filtered rows once for their own needs, so a builder that re-filtered would double the work; the header comment states the precondition.
- Task 1's `<behavior>` source scan is implemented comment-stripped, plus an additional executed run of the real page file in a stub DOM that counts `fetch` URLs (`dd-workspace-batch (d2)`: exactly `['/api/dd/workspace']` among `/api/dd/*`).

## Known Stubs

None.

## Threat Flags

None. The only new surface is the workspace GET, covered by the existing `/api/dd` read-policy rule (T-12-92), built from the per-area clearance functions (T-12-90), with its audit row (T-12-91) and the throwing-accessor guard on handler conversions (T-12-93).

## Not measured here

The browser-network proof for "DD page makes 1 request" and the PRD latency budgets belong to 12-14 on a quiet host; this plan's proof is the executed-page request count and the server-side equality/clearance suite above. The host was loaded (1-min load 35-45) so no latency numbers are claimed.

## Self-Check: PASSED

- test/dd-workspace-batch.test.js present, 8/8 green; server.js `DD_READ_SET` count 11 (>= 6); `grep -c "/api/dd/workspace" public/js/due-diligence.js` >= 1
- commits `fb38120`, `8cd88b3` present
- `git status --porcelain data/ public/sent_emails/` empty; STATE.md / ROADMAP.md untouched; `// Due Diligence workspace (DD-01/DD-04)` and `// In-app notifications — computed on demand` markers verbatim (asserted by dd-vdr (m) and dd-workspace-batch (f))
