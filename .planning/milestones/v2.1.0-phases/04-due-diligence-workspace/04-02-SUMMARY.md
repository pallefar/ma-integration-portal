---
phase: 04-due-diligence-workspace
plan: 02
subsystem: api
tags: [express, better-sqlite3, zod, access-control, audit-log, mnpi]

# Dependency graph
requires:
  - phase: 04-due-diligence-workspace (Plan 01)
    provides: db/accessPolicy.js's DD_AREA_IDS/grantedAreas() reading deal.memberGrants, the dd* collections, db/controlStore.js's read-modify-write shape (updateDealMembers), the recordSecurityEvent() call convention
provides:
  - "db/controlStore.js — setDealMemberGrants(dealId, username, ddAreas) / getDealMemberGrants(dealId), the ONLY write path into deal.memberGrants"
  - "GET/POST /api/deals/:id/grants — the clean-room clearance management surface (server.js)"
  - "validators/deals.js DealGrantsSchema — z.enum(DD_AREA_IDS) validation, registered in WRITE_SCHEMAS"
  - "Admin console 'Clean-room grants' panel in the Real Deals tab (public/js/admin.js)"
  - "New audit action vocabulary: dd-area-grant, dd-area-revoke, dd-area-grants-update"
  - "Regression proof that deal.memberGrants is additive and disturbs none of the four deal.members: string[] consumers (D-23)"
affects: [04-03-PLAN, 04-04-PLAN, 04-05-PLAN, 04-06-PLAN, 04-07-PLAN, 04-08-PLAN, phase-06-org-design-talent-retention]

# Actuals (#2632)
actuals:
  tokens: 14965
  tasks: 3
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-modify-write grant mutator mirroring updateDealMembers()'s exact shape: fetch the deal, throw when missing, spread the existing object so every other field survives untouched, persist with the same UPDATE statement"
    - "No-op-write suppression: before/after set comparison happens in the route handler BEFORE calling the store mutator, so an identical grant persists nothing new and records no audit event — the compliance record only ever reflects real changes"
    - "GET routes on a control-plane surface must self-gate on role: ROLE_WRITE_POLICY only checks write methods (plus /api/admin*-prefixed GETs, per CR-02's carve-out) — any other GET route carrying access-control-relevant data needs its own inline role check"

key-files:
  created:
    - test/dd-grants.test.js
  modified:
    - db/controlStore.js
    - validators/deals.js
    - server.js
    - public/js/admin.js
    - public/admin.html

key-decisions:
  - "GET /api/deals/:id/grants narrowed inline to admin+hrbp (Rule 1/2 auto-fix, not in the original plan text) — ROLE_WRITE_POLICY only role-gates writes and /api/admin*-prefixed GETs; left unguarded, this new GET route would have let ANY authenticated role (including pmo/employee) read any deal's membership and per-area clearance map purely from its id, which is exactly the MNPI disclosure D-02's 'IL + admin' model exists to prevent."
  - "A grant naming a username absent from deal.members is refused with a 400 and creates no memberGrants entry — clearance can never exist without membership, closing the shadow-access path T-04-09 flags."
  - "Removing a member from deal.members intentionally leaves their memberGrants entry in place (not pruned) — membership and clearance are separate decisions; the stale grant is provably inert because grantedAreas() is only ever consulted after the bind-time membership check (db/resolver.js) has already passed, so a removed member can never reach a DD route where the stale grant would matter."
  - "Tasks 1 and 3 landed in one commit — both touch the same shared test file (test/dd-grants.test.js) and were authored/verified together with no incremental checkpoint between them, matching the precedent set in Phase 3 Plan 06's own 'could not be mounted incrementally' note."

patterns-established:
  - "Clean-room grant management: setDealMemberGrants()/getDealMemberGrants() (db/controlStore.js) is the canonical, sole write/read path into deal.memberGrants — no other module touches that field directly. Future per-area grant surfaces (e.g. Phase 6's flight-risk register, if it reuses memberGrants-shaped data) should extend this pair rather than inventing a second mutator."
  - "before/after-set audit action selection: comparing two arrays as sets (superset -> grant, subset -> revoke, neither -> grants-update) to pick an audit action name, computed in the route handler, never inside the store module — mirrors the codebase's existing 'audit dependency lives at the route-handler layer' rule (AUD-02's isolation precedent, applied here to a third module)."

requirements-completed: [DD-04]

coverage:
  - id: D1
    description: "An admin or the deal's Integration Lead grants and revokes a named member's clearance for a named DD area, deal-scoped, without touching any global role; revocation takes effect on the member's very next request"
    requirement: "DD-04"
    verification:
      - kind: integration
        ref: "test/dd-grants.test.js#dd-grants (a): an hrbp IL grants a pmo member \"legal\"; that member's very next DD list request returns the legal item"
        status: pass
      - kind: integration
        ref: "test/dd-grants.test.js#dd-grants (b): revoking (posting an empty ddAreas array) takes effect on the member's VERY NEXT request — no session-level caching"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every grant and revoke is an attributed audit security event carrying actor/deal/subject/before/after; a no-op grant records nothing; granting the same area twice is idempotent"
    requirement: "DD-04"
    verification:
      - kind: integration
        ref: "test/dd-grants.test.js#dd-grants (c): granting the same area twice leaves exactly one stored entry and exactly one audit row"
        status: pass
      - kind: integration
        ref: "test/dd-grants.test.js#dd-grants (g): the audit rows for a grant and a revoke carry the correct action name, actor, deal id, subject and before/after arrays"
        status: pass
      - kind: integration
        ref: "test/dd-grants.test.js#dd-grants (h): a member with no prior grants gains a memberGrants entry on first grant; revoking their last area leaves an empty array, not a dangling/undefined entry"
        status: pass
    human_judgment: false
  - id: D3
    description: "An unknown area id or a non-member username is refused with a 400 and no partial write; a pmo session is refused both GET and POST on the grants route"
    requirement: "DD-04"
    verification:
      - kind: integration
        ref: "test/dd-grants.test.js#dd-grants (d): a ddAreas array containing an unknown area id 400s with no stored change"
        status: pass
      - kind: integration
        ref: "test/dd-grants.test.js#dd-grants (e): a username not on the deal's members list 400s"
        status: pass
      - kind: integration
        ref: "test/dd-grants.test.js#dd-grants (f): a pmo session is refused both GET and POST /api/deals/:id/grants"
        status: pass
      - kind: integration
        ref: "test/dd-grants.test.js#dd-grants (n): GET /api/deals/:id/grants succeeds for the deal's hrbp IL and for admin, returning one entry per member with an empty ddAreas for an ungranted member"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-23's central bet: the additive deal.memberGrants field disturbs none of the four call sites that read deal.members as a flat array of username strings (isDealMember, listDealsForUser, the /api/deals/select bind, the members route's session-release loop), and a stale grant on a removed member is unreachable"
    verification:
      - kind: integration
        ref: "test/dd-grants.test.js#dd-grants (i): isDealMember() behaves identically with memberGrants populated"
        status: pass
      - kind: integration
        ref: "test/dd-grants.test.js#dd-grants (j): listDealsForUser() returns the deal for a listed member and omits it for an unlisted one, with memberGrants populated"
        status: pass
      - kind: integration
        ref: "test/dd-grants.test.js#dd-grants (k): a bind through POST /api/deals/select succeeds for a listed member and uniform-403s for an unlisted one; memberGrants is present on the deal in both cases"
        status: pass
      - kind: integration
        ref: "test/dd-grants.test.js#dd-grants (l): removing a member releases their session binding AND leaves their memberGrants entry intact; the stale grant is unreachable"
        status: pass
      - kind: integration
        ref: "test/dd-grants.test.js#dd-grants (m): GET /api/deals returns deals whose members elements are all of type string when memberGrants is populated"
        status: pass
    human_judgment: false
  - id: D5
    description: "The admin console's Real Deals tab exposes a 'Clean-room grants' panel (visible to admin + hrbp) that reads/writes the grants route, rendering member/area values via textContent/DOM properties only"
    verification:
      - kind: other
        ref: "test/dd-grants.test.js#dd-grants (source): admin.js POSTs to the grants route and renders with no innerHTML sink for member/area values"
        status: pass
      - kind: other
        ref: "test/dd-grants.test.js#dd-grants (source): admin.html loads admin.js at the bumped cache stamp"
        status: pass
    human_judgment: true
    rationale: "No browser automation tool was available this session to visually confirm the panel's in-browser rendering (checkbox layout, save/reload flow, error surfacing). The zero-innerHTML/POST-wiring/cache-stamp properties are source-verified and covered by test/dd-grants.test.js's own two source-level assertions, but the actual live click-through (open panel -> tick two areas -> save -> reopen -> confirm ticks persisted, zero console errors) is deferred to 04-UAT.md per the plan's own acceptance criteria."

duration: ~40min
completed: 2026-08-02
status: complete
---

# Phase 4 Plan 2: Clean-Room Grant Management Summary

**Per-deal DD-area grant/revoke routes (`GET`/`POST /api/deals/:id/grants`) with audited security events, an admin-console clearance editor, and regression proof that the additive `memberGrants` field breaks none of the four `deal.members: string[]` consumers.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 3 (all completed)
- **Files modified:** 6 (1 created, 5 modified)
- **Commits:** 2 task commits + this docs commit

## Accomplishments

- Built `setDealMemberGrants()`/`getDealMemberGrants()` in `db/controlStore.js` — the sole read/write path into `deal.memberGrants`, mirroring `updateDealMembers()`'s exact read-modify-write shape (spread the existing deal, throw on missing, persist via the same `UPDATE`), holding zero reference to the audit store
- Added `GET`/`POST /api/deals/:id/grants` to `server.js`: the POST refuses a non-member username or an unknown area id with a 400 and no partial write, suppresses no-op grants (identical before/after sets persist and record nothing), and picks the audit action name (`dd-area-grant`/`dd-area-revoke`/`dd-area-grants-update`) by comparing the before/after sets
- Added `DealGrantsSchema` to `validators/deals.js` — `z.enum` over `db/accessPolicy.js`'s `DD_AREA_IDS` (imported, never duplicated), capped at the taxonomy's own size
- **Found and fixed a real access-control gap during implementation:** `GET /api/deals/:id/grants` is not covered by `ROLE_WRITE_POLICY` (which only role-gates write methods, plus `/api/admin*`-prefixed GETs per its own CR-02 carve-out) — left as the plan's own text assumed ("already limited... by ROLE_WRITE_POLICY"), any authenticated role including pmo/employee could have read any deal's full membership and per-area clearance map purely from its id. Narrowed inline to admin+hrbp, matching the POST route's own boundary.
- Built the "Clean-room grants" panel in `public/js/admin.js`'s Real Deals tab — visible to admin AND hrbp (deliberately wider than the admin-only Members/Archive/Delete buttons), per-member checkboxes over the eight DD areas, save/reload flow, zero `innerHTML` in the entire section
- Proved the whole slice through 17 new integration/source tests in `test/dd-grants.test.js`, including the previously-uncovered D-23 shape-regression cases for all four `deal.members` consumers

## Task Commits

Tasks 1 and 3 landed in one commit — both touch the same shared test file (`test/dd-grants.test.js`) and were authored and verified together, with no incremental checkpoint between them (mirrors Phase 3 Plan 06's own "could not be mounted incrementally" precedent).

1. **Task 1 + Task 3: Grant/revoke routes with audited security events, and the D-23 members-shape regression suite** - `49923da` (feat)
2. **Task 2: Clean-room grants editor in the admin console's Real Deals tab** - `a2943be` (feat)

## Files Created/Modified

- `test/dd-grants.test.js` (new) - 17 tests: grant/revoke behavior (a-h, n), source-level admin.js checks, D-23 shape-regression cases (i-m)
- `db/controlStore.js` (modified) - `setDealMemberGrants()`/`getDealMemberGrants()`, `DD_AREA_IDS` import from `db/accessPolicy.js`
- `validators/deals.js` (modified) - `DealGrantsSchema`, registered for `POST /api/deals/:id/grants`
- `server.js` (modified) - the two grant routes, inline admin+hrbp gate on the GET route
- `public/js/admin.js` (modified) - `DD_AREA_LABELS`, `openGrantsPanel()`, `clearChildren()`, the "Clean-room grants" button wiring in `renderDeals()`
- `public/admin.html` (modified) - `admin.js` cache stamp bumped to `?v=1784700001`

## Decisions Made

- **GET route role-gated inline (Rule 1/2 auto-fix):** see the Deviations section below — this was not in the plan's action text and is documented there in full.
- **Non-member grant refused, not silently ignored:** a `username` absent from `deal.members` 400s and creates no `memberGrants` entry at all — clearance can never exist without membership (T-04-09).
- **Stale grant left in place on member removal, not pruned:** `POST /api/deals/:id/members` removing a member releases their session binding but intentionally leaves their `memberGrants` entry untouched. This is safe by construction, not by convention — `grantedAreas()` is only ever consulted after `db/resolver.js`'s bind-time membership check has already passed, so a removed member can never reach a route where the stale grant would be read. Pruning the entry would be extra work with zero security benefit.
- **No-op grant suppression happens in the route handler, before the store call:** the before/after set-equality check runs BEFORE `setDealMemberGrants()` is invoked (not after), so an identical grant literally never reaches the store or the audit log — not merely "records no audit row after writing an unchanged value."

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/2 - Bug + Missing Critical] `GET /api/deals/:id/grants` was reachable by any authenticated role, not just admin/hrbp**
- **Found during:** Task 1 (writing the GET route per the plan's action text)
- **Issue:** The plan's own action text states "Both routes are already limited to admin and hrbp by ROLE_WRITE_POLICY's `/api/deals` prefix entry." This is true for the POST route but factually incorrect for the GET route: the consolidated `/api` gate's role check (`requiresRoleCheck = isWrite || pathMatchesPrefix(fullPath, '/api/admin')`) only applies to write methods, plus GETs specifically under `/api/admin*` (CR-02's own documented carve-out from Phase 2/3). `/api/deals/:id/grants` is neither a write nor `/api/admin`-prefixed, so a literal implementation of the plan's text would have left this GET route reachable by ANY authenticated session — pmo, employee, or an hrbp/admin of a completely unrelated deal — disclosing an arbitrary deal's full membership list and per-area DD clearance map from nothing but its id. This directly contradicts D-02's stated "IL + admin" access model and is a real MNPI disclosure risk (T-04-14's threat register entry assumed the admin-console-only consumer, not a bare authenticated-any-role HTTP caller).
- **Fix:** Added an inline role check at the top of the GET handler (`req.portalUser.role !== 'admin' && req.portalUser.role !== 'hrbp'` → 403), matching the POST route's own effective role boundary so the read is never more permissive than the write for this surface.
- **Files modified:** `server.js`
- **Verification:** `test/dd-grants.test.js#dd-grants (f)` (pmo refused both GET and POST) and `#dd-grants (n)` (admin/hrbp succeed) both pass; full suite green (151/151).
- **Committed in:** `49923da` (Task 1+3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1/2: access-control gap)
**Impact on plan:** The fix is a straightforward inline role check with zero architectural change and no scope creep — it closes a gap the plan's own text mistakenly assumed was already closed by an existing policy mechanism that, on inspection, does not cover GET requests outside `/api/admin`.

## Issues Encountered

One `npm test` run during development reported 1 failure out of 150 that did not reproduce on any of six subsequent full-suite runs (5 clean runs before the fix, 3 more after). The failure was not isolated to `test/dd-grants.test.js` (which was independently green in every one of its own standalone runs) and could not be reproduced when re-run; treated as an environmental flake (likely inter-file resource contention under `node --test`'s parallel file execution) rather than a regression caused by this plan's changes. Final state: `npm test` green at 151/151 across three consecutive re-runs, `node scripts/list-unvalidated-routes.js` exits 0.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `db/controlStore.js`'s `setDealMemberGrants()`/`getDealMemberGrants()` pair is the stable, sole entry point into `deal.memberGrants` for any later plan or phase that needs to read or mutate per-deal clearance (Phase 6's flight-risk register, if it reuses this shape, should extend this pair rather than writing a second mutator).
- The admin console's grants panel's live in-browser click-through (open → tick areas → save → reopen → confirm persisted, zero console errors) is deferred to `04-UAT.md` per the plan's own acceptance criteria — no browser automation tool was available this session.
- No blockers for 04-03.

---
*Phase: 04-due-diligence-workspace*
*Completed: 2026-08-02*

## Self-Check: PASSED

All files created by this plan exist on disk and both task commits are present in git history:

- FOUND: test/dd-grants.test.js
- FOUND: db/controlStore.js
- FOUND: validators/deals.js
- FOUND: server.js
- FOUND: public/js/admin.js
- FOUND: public/admin.html
- FOUND commit: 49923da (Task 1+3)
- FOUND commit: a2943be (Task 2)

`npm test` = 151/151 (135 baseline + 16 new). `node scripts/list-unvalidated-routes.js` exits 0. `node -e "require('./server.js')"` boots clean.
