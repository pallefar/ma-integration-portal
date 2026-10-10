# Phase 9 — Deferred items (out of scope, discovered during execution)

## D-1. Cookie-less browser entry to a `DEMO_OPEN=1` instance redirect-loops (found in 09-16, 2026-10-10)

**Observed:** On an instance started with `DEMO_OPEN=1`, a browser with NO session cookie that opens
`/execution.html` (or `/`) ends in an endless `login.html -> / -> login.html` navigation loop.

**Cause (traced with request/navigation logging):**
1. `GET /api/auth/me` answers `{authEnabled:false, user:null}` for an anonymous `DEMO_OPEN=1` visitor, so
   the transitions.js login handshake does nothing.
2. The header deal switcher (`public/js/deal-switcher.js`) calls `GET /api/deals`. `/api/deals` is in
   `db/resolver.js` `CONTROL_PLANE_PATHS`, which is never open (D-03), so the server answers 401 with
   `authRequired: true`.
3. The transitions.js fetch wrapper turns any `authRequired` 401 into `window.location.href =
   '/login.html'`; `login.html` sees `authEnabled:false` and bounces to `/`; `/` repeats step 2.

**Not a Phase 9 regression:** `public/js/deal-switcher.js`, the `CONTROL_PLANE_PATHS` table and the
`authRequired` redirect all exist unchanged in `v2.1.0`; nothing in the Phase 9 diff touches them.
A signed-in session with no deal binding (the lane `DEMO_OPEN=1` exempts) works: that is the lane the
09-16 `demo-smoke` scenario drives in a browser, with the anonymous lane covered at the API level.

**Why deferred:** fixing it means deciding what an anonymous demo visitor should see (skip the deal
switcher when `authEnabled:false`, or let `/api/deals` return `[]` in open mode) — a Phase 3/4
demo-lane decision, not part of the optimistic-locking contract.

**Recorded in:** `.planning/WINDOWS.md` (kind `deviation`).
