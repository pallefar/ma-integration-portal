---
phase: 02-mandatory-auth-roles
plan: 02
subsystem: auth
tags: [express, better-sqlite3, sessions, crypto, node-test, rbac]

requires:
  - phase: 02-mandatory-auth-roles (plan 01)
    provides: "Consolidated fail-closed /api gate, SQLite sessions table, req.portalUser identity, isOpenMode(req) seam"
provides:
  - "AUTH-02: coarse ROLE_WRITE_POLICY capability map enforced in the gate's write branch — a role outside its allowed prefixes is rejected 403, before the route handler runs"
  - "D-11: X-Admin-Token resolves to an attributed identity ({username:'admin-token', role:'admin'}), not an anonymous bypass"
  - "D-12: seeded employee-demo account (role: employee) in both db.json and the live SQLite store, making the non-admin role-rejection path testable and real-deal-usable"
  - "D-09: POST /api/auth/change-password (self-service, any role) + scripts/set-admin-password.js (first-run admin secret CLI, warns on the known demo password per D-10)"
  - "lockedDown(req)/isAdminRequest(req) fully request-aware — every call site converted"
affects: [02-03, phase-3-audit-log, phase-4-clean-room]

tech-stack:
  added: []
  patterns:
    - "ROLE_WRITE_POLICY: path-PREFIX default-allow table (not a hand-annotated per-route list) — unlisted prefixes fall through to DEFAULT_WRITE_ROLES (admin/hrbp/pmo), employee is opt-in-only via an explicit self-service allowlist"
    - "Gate passes req.baseUrl + req.path (not bare req.path) to roleAllowedForWrite — Express strips the /api mount prefix from req.path inside app.use('/api', ...), so ROLE_WRITE_POLICY's /api/... prefixes must be matched against the reconstructed full path"
    - "Integration tests boot the real app against a temp SQLite DB seeded via the existing migrate-db-json-to-sqlite.js runner, with db/store.js's initDb() monkeypatched (in-memory only, not the file) so server.js's own no-arg initDb() call at require-time doesn't reopen the live default DB"

key-files:
  created:
    - test/role-enforcement.test.js
    - scripts/set-admin-password.js
  modified:
    - server.js
    - db.json
    - data/ma-portal.db

key-decisions:
  - "ROLE_WRITE_POLICY prefixes are written as full '/api/...' paths (matching the plan's own unit-test acceptance criteria and this file's route registrations 1:1) — the gate reconstructs the full path via req.baseUrl + req.path rather than changing the table to mount-relative prefixes, since 02-RESEARCH.md/02-PATTERNS.md's worked examples and the plan's literal unit-test assertions (roleAllowedForWrite('hrbp', '/api/admin/x')) both assume the /api-prefixed form."
  - "D-12's employee-demo account was seeded into BOTH db.json (the frozen fixture) and the LIVE data/ma-portal.db (SQLite, the actual source of truth since Phase 1) — seeding only db.json would satisfy the plan's literal grep acceptance criterion but would not make a real employee login actually work, which is D-12's stated purpose ('the role test needs a non-admin subject to log in as')."
  - "The X-Admin-Token break-glass identity is resolved in the SAME code path as the session lookup (an if/else feeding the same req.portalUser assignment + the same downstream ROLE_WRITE_POLICY check) rather than an early-return bypass, so a token-authenticated request goes through identical role-check logic to a session-authenticated one — no special-cased authorization path to audit separately."
  - "scripts/set-admin-password.js reimplements hashPassword()/timingSafeEqualStr() locally rather than requiring server.js, so rotating the admin password never triggers server.js's own module-load side effects (RAG index build, its own initDb() against the default path)."

requirements-completed: [AUTH-02, AUTH-03, AUTH-04]

coverage:
  - id: D1
    description: "Every write endpoint enforces the caller's role via ONE consolidated ROLE_WRITE_POLICY capability check — an hrbp/pmo session is rejected 403 on an admin-only write, an employee session is rejected 403 outside the explicit self-service allowlist, and admin is never blocked for role reasons"
    requirement: "AUTH-02"
    verification:
      - kind: unit
        ref: "test/role-enforcement.test.js#AUTH-02 (unit): roleAllowedForWrite enforces the coarse capability map"
        status: pass
      - kind: integration
        ref: "test/role-enforcement.test.js#AUTH-02 (integration): an hrbp session writing to an /api/admin/* route gets 403"
        status: pass
      - kind: integration
        ref: "test/role-enforcement.test.js#AUTH-02 (integration): an employee session writing to a non-self-service route gets 403"
        status: pass
      - kind: integration
        ref: "test/role-enforcement.test.js#AUTH-02 (integration): an employee session IS allowed to write to a self-service route"
        status: pass
      - kind: integration
        ref: "test/role-enforcement.test.js#AUTH-02 (integration): an admin session writing to an /api/admin/* route is not 403"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-11: an X-Admin-Token request resolves to a stable, attributed identity ({username:'admin-token', role:'admin'}), not an anonymous bypass, so Phase 3's audit log can attribute break-glass actions"
    requirement: "AUTH-04"
    verification:
      - kind: integration
        ref: "test/role-enforcement.test.js#D-11: an X-Admin-Token request resolves to the attributed admin-token identity and is allowed on admin routes"
        status: pass
    human_judgment: false
  - id: D3
    description: "AUTH-04: identity/role resolvable server-side on every request, read exclusively from req.portalUser (never a client-supplied header/body/cookie claim), and req.portalUser is explicitly null (not undefined) under isOpenMode, with the role check never consulted in that mode"
    requirement: "AUTH-04"
    verification:
      - kind: integration
        ref: "test/role-enforcement.test.js#AUTH-04: a request with a valid session exposes req.portalUser.username/.role via /api/auth/me"
        status: pass
      - kind: integration
        ref: "test/role-enforcement.test.js#AUTH-04: role is read exclusively server-side — a client-supplied role claim (header/body) is never honored"
        status: pass
      - kind: integration
        ref: "test/role-enforcement.test.js#AUTH-04 (D-02): an isOpenMode request is not gated on role/session at all (req.portalUser === null, never consulted)"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-09/D-10: a logged-in user can change their own password (self-service, any role); an operator can set a real admin password via a first-run CLI, which warns loudly if the admin account is still on the publicly-known demo password"
    requirement: "AUTH-03"
    verification:
      - kind: manual_procedural
        ref: "manual round-trip against a temp SQLite DB: POST /api/auth/change-password returns 401 with no session, 401 with the wrong current password, 200 with the correct one; a follow-up POST /api/auth/login proves the old demo password then fails and the new password succeeds"
        status: pass
      - kind: manual_procedural
        ref: "manual round-trip: scripts/set-admin-password.js run() against a temp DB emits the '[security] admin account was still on the known demo password' warning on first run (admin holds TEdemo!2026), does NOT warn on a second run (already rotated), and each rotation is verifiable via a direct hash comparison"
        status: pass
    human_judgment: false
  - id: D5
    description: "Regression: the Plan 01 fail-closed gate + session-lifecycle suite remain green after this plan's write-branch and lockedDown(req) conversion changes"
    requirement: "AUTH-01"
    verification:
      - kind: integration
        ref: "node --test (bare, full suite) — 25/25 passing (16 prior + 9 new in test/role-enforcement.test.js)"
        status: pass
    human_judgment: false

duration: 26min
completed: 2026-07-24
status: complete
---

# Phase 2 Plan 2: Coarse Role-Write Enforcement, Attributed Break-Glass Identity & Account Safety Summary

**A path-prefix `ROLE_WRITE_POLICY` capability check wired into the Plan 01 gate's write branch (AUTH-02), an attributed `X-Admin-Token` identity (D-11), a seeded `employee-demo` account (D-12), and self password-change + a first-run admin-secret CLI (D-09/D-10)**

## Performance

- **Duration:** 26 min
- **Started:** 2026-07-24T09:15:00Z (approx.)
- **Completed:** 2026-07-24T09:41:00Z
- **Tasks:** 2 completed
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- Every write endpoint now enforces the caller's role through ONE coarse `ROLE_WRITE_POLICY` capability map (path-prefix default-allow table, not 90 hand-annotated routes per D-05) — an hrbp/pmo session gets 403 writing to `/api/admin/*`, an employee session gets 403 outside the explicit self-service allowlist (`/api/pulses`, lesson completion, `/api/assessment*`, its own password change), and admin is never blocked for role reasons (AUTH-02).
- Found and fixed a real bug during integration testing: inside `app.use('/api', ...)`, Express strips the `/api` mount prefix from `req.path` — passing bare `req.path` to `roleAllowedForWrite` would have silently never matched any `ROLE_WRITE_POLICY` prefix, falling every write through to the admin/hrbp/pmo default regardless of path (i.e. the whole role gate would have been a no-op for path-based restriction, confirmed by a failing test before the fix). The gate now passes `req.baseUrl + req.path`.
- `X-Admin-Token` requests now resolve to a stable, attributed identity (`{username: 'admin-token', role: 'admin', sessionId: null}`) instead of the Plan 01 interim state (401ing unauthenticated) — Phase 3's audit log can attribute break-glass actions to a named identity, never an anonymous one (D-11).
- `lockedDown()` is now fully request-aware (`lockedDown(req)`); both remaining call sites (the admin-only assessment-instances list, the respondent-name-stripping in the assessment-status rollup) were converted — `grep -c "lockedDown()" server.js` is 0.
- A demo `employee-demo` account (role: `employee`) was seeded into both `db.json` (the frozen fixture) and the live `data/ma-portal.db` SQLite store, so AUTH-02's non-admin rejection path is testable end-to-end AND a real employee login actually works (D-12).
- `POST /api/auth/change-password` lets any authenticated role (including employee) rotate their own password, verified against the existing scrypt hash with a 401 on mismatch and a minimum 8-character new password.
- `scripts/set-admin-password.js` gives an operator a one-shot CLI (mirroring the existing `migrate-db-json-to-sqlite.js` precedent) to set a real admin password before real-deal use, warning loudly when the admin account is still on the publicly-known demo password and `DEMO_OPEN` is not set (D-09/D-10).

## Task Commits

Each task was committed atomically:

1. **Task 1: Coarse ROLE_WRITE_POLICY, break-glass identity, employee seed & role test** - `2aa470c` (feat)
2. **Task 2: Self password-change endpoint + first-run admin-secret script** - `7c28a0e` (feat)

## Files Created/Modified

- `server.js` - `ROLE_WRITE_POLICY`/`DEFAULT_WRITE_ROLES`/`roleAllowedForWrite(role, path)` (exported on `module.exports` alongside `app`); gate write-branch 403; D-11 attributed admin-token identity; `lockedDown(req)`/`isAdminRequest(req)` fully request-aware (both call sites converted); `POST /api/auth/change-password`
- `db.json` - seeded `employee-demo` user (role: employee, scrypt salt/hash, same demo-password family as the other 3 seeded accounts)
- `data/ma-portal.db` - the same `employee-demo` row seeded into the live SQLite `users` table (the actual source of truth since Phase 1) so a real login works, not just the frozen fixture; also carries Plan 01's prior session-table schema/churn from earlier testing
- `test/role-enforcement.test.js` (NEW) - AUTH-02 unit test for `roleAllowedForWrite` + 8 integration tests (role rejection/allowance across hrbp/employee/admin, D-11 admin-token identity, AUTH-04 identity resolution and client-claim rejection, isOpenMode bypass) booting the real app against a temp SQLite DB
- `scripts/set-admin-password.js` (NEW) - one-shot CLI to rotate the admin account's password (D-09), with a loud demo-password warning (D-10)

## Decisions Made

- **ROLE_WRITE_POLICY prefixes stayed `/api/...`-prefixed** (matching the plan's own unit-test acceptance criteria and 02-RESEARCH.md's worked table) — the fix for the mount-relative `req.path` bug was in the GATE (reconstruct the full path via `req.baseUrl + req.path`), not in the table, since changing the table to mount-relative prefixes would have broken the plan's literal `roleAllowedForWrite('hrbp', '/api/admin/x')` unit-test expectations.
- **`employee-demo` was seeded into the LIVE SQLite store, not just `db.json`.** The plan's file list only named `db.json`, but Phase 1 established that `db.json` is a frozen, read-only fixture and `data/ma-portal.db` is the actual source of truth — seeding only the fixture would satisfy a literal grep check but not deliver D-12's stated purpose (a real employee account to log in as). Per this execution's own instructions ("if a task legitimately changes ... data/ma-portal.db, stage only that intended file and explain it in the commit body"), this was treated as in-scope for faithfully implementing D-12, not a Rule-4 architectural change.
- **Integration tests use a temp SQLite DB, not the live one**, seeded via the existing `migrate-db-json-to-sqlite.js` runner (same pattern `test/concurrent-write.test.js` already established). Because `server.js`'s own top-level `initDb()` call (no path argument) would otherwise reopen the default `data/ma-portal.db` the instant `server.js` is required — silently discarding the test's temp DB — `db/store.js`'s exported `initDb` function is monkeypatched in-memory (not its source file) before requiring `server.js`, so a no-arg call after the test's own `initDb(tempPath)` is a harmless no-op returning the existing connection.
- **`X-Admin-Token` and session-cookie authentication resolve identity through the same downstream code path** (an if/else populating the same `req.portalUser`, both flowing into the identical `roleAllowedForWrite` check) rather than an early-return bypass for the token — this keeps exactly one authorization code path to reason about/audit, consistent with D-05's "one consolidated capability check."
- **`scripts/set-admin-password.js` reimplements `hashPassword`/`timingSafeEqualStr` locally** rather than requiring `server.js`, so rotating the admin password never triggers `server.js`'s module-load side effects (RAG index build, binding a live DB connection at the default path) just to run a CLI utility — mirrors `migrate-db-json-to-sqlite.js`'s own precedent of not requiring `server.js`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed mount-relative `req.path` breaking every `ROLE_WRITE_POLICY` prefix match**
- **Found during:** Task 1, while running the new integration tests (discovered via a failing assertion: an hrbp session got 200 instead of 403 on an admin-only route, and — inversely — an employee session got 403 on the self-service allowlist it should have been allowed on)
- **Issue:** Inside `app.use('/api', ...)`, Express strips the mount prefix from `req.path` (verified live: for a request to `/api/pulses`, `req.path === '/pulses'`, `req.baseUrl === '/api'`). The plan's own research/pattern examples (and this plan's `ROLE_WRITE_POLICY` table) wrote prefixes as full `/api/...` paths and called `roleAllowedForWrite(role, req.path)` — bare `req.path` would never match any prefix, silently falling every write through to `DEFAULT_WRITE_ROLES` regardless of the actual route.
- **Fix:** The gate now calls `roleAllowedForWrite(req.portalUser.role, req.baseUrl + req.path)`, reconstructing the full path so the table's `/api/...` prefixes match as written.
- **Files modified:** `server.js`
- **Verification:** `test/role-enforcement.test.js`'s 4 role-rejection/allowance integration tests all pass; confirmed the bug reproduced exactly (hrbp 200 instead of 403, employee 403 instead of allowed) before the fix and resolved cleanly after.
- **Committed in:** `2aa470c` (Task 1 commit)

**2. [Rule 2 - Missing Critical] Seeded `employee-demo` into the live SQLite store, not just `db.json`**
- **Found during:** Task 1, while implementing D-12
- **Issue:** The plan's `files_modified` list named only `db.json` for the employee seed, but Phase 1 made `data/ma-portal.db` (SQLite) the actual source of truth — `db.json` is a frozen, read-only fixture no live code path reads. Seeding only `db.json` would pass a literal grep-based acceptance check but would not deliver a working employee login, which D-12 explicitly calls for.
- **Fix:** Seeded the identical `employee-demo` user (same salt/hash) into both `db.json` and the live `data/ma-portal.db` via `db/store.js`'s `readDb()`/`writeDb()`.
- **Files modified:** `db.json`, `data/ma-portal.db`
- **Verification:** `node -e "..."` confirms `employee-demo` present with `role: 'employee'` in both; a manual login round-trip (via the change-password test harness) authenticates as `employee-demo` successfully.
- **Committed in:** `2aa470c` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing-critical-functionality)
**Impact on plan:** Both fixes were necessary for AUTH-02 to actually function (the path bug would have made role enforcement a silent no-op) and for D-12 to deliver its stated purpose (a real, loggable employee account). No scope creep — no architectural changes, no new files beyond what the plan specified.

## Issues Encountered

None beyond the two auto-fixed deviations above, which surfaced naturally while writing and running the new tests (not a separate debugging detour).

## User Setup Required

None - no external service configuration required. Operators who want to rotate the admin password before a real-deal deployment should run `ADMIN_PASSWORD='...' node scripts/set-admin-password.js` (or omit the env var for an interactive prompt) — this is a manual operational step, not something this plan wires into a launcher automatically (out of scope; D-09 only requires the mechanism to exist).

## Next Phase Readiness

- Plan 03 (client-side 401-on-read redirect, launcher `DEMO_OPEN=1` wiring) can build directly on this plan's gate — the write-branch role check and the `X-Admin-Token` identity resolution are both stable and tested.
- Phase 3's audit log (AUD-01) now has a fully attributed identity for EVERY write path, including the `X-Admin-Token` break-glass mechanism (`{username: 'admin-token', role: 'admin'}`), closing the gap 02-RESEARCH.md's Pitfall 4 flagged.
- Phase 4's clean-room work can refine `ROLE_WRITE_POLICY`'s coarse map into field-level rules without re-deriving the gate architecture — the single capability-check seam is exactly where that refinement plugs in.
- No blockers. Full `node --test` suite: 25/25 passing (16 from Phase 1 + Plan 01, 9 new in `test/role-enforcement.test.js`).

## Self-Check: PASSED

- FOUND: test/role-enforcement.test.js
- FOUND: scripts/set-admin-password.js
- FOUND: .planning/phases/02-mandatory-auth-roles/02-02-SUMMARY.md
- FOUND commit: 2aa470c (Task 1)
- FOUND commit: 7c28a0e (Task 2)
- Full `node --test` suite: 25/25 passing

---
*Phase: 02-mandatory-auth-roles*
*Completed: 2026-07-24*
