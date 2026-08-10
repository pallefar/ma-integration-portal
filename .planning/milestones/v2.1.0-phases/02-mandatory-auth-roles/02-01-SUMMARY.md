---
phase: 02-mandatory-auth-roles
plan: 01
subsystem: auth
tags: [express, better-sqlite3, sessions, crypto, node-test]

requires:
  - phase: 01-schema-migration
    provides: "SQLite (better-sqlite3, WAL) persistence layer via db/store.js — the sessions table rides the same shared connection"
provides:
  - "Fail-closed-by-default /api gate (D-01) with an explicit DEMO_OPEN=1 escape hatch (D-02)"
  - "Opaque-token, hashed-at-rest SQLite sessions table replacing the stateless HMAC cookie (D-06)"
  - "req.portalUser = {username, role, sessionId} identity resolved server-side on every authenticated request (AUTH-04)"
  - "server.js as a requireable module (module.exports = app + require.main === module guard)"
  - "Session revocation: logout, admin revoke-all-for-user, absolute 12h expiry (D-07)"
affects: [02-02, 02-03, phase-3-audit-log]

tech-stack:
  added: []
  patterns:
    - "isOpenMode(req) named seam — Phase 3 will AND this with req.isDemo so a real-deal database is never open regardless of DEMO_OPEN"
    - "Dedicated direct-SQL table (db/sessions.js) outside the ARRAY_COLLECTIONS whole-object CRUD pattern, sharing db/store.js's single connection via getConnection()"

key-files:
  created:
    - db/sessions.js
    - test/auth-route-inventory.test.js
    - test/session-lifecycle.test.js
  modified:
    - server.js
    - db/store.js
    - db/schema.sql

key-decisions:
  - "D-01/D-02/D-03 implemented via isOpenMode(req) as a named function (not an inlined boolean) so Phase 3 can extend it without touching every call site"
  - "D-06: session tokens are 256-bit crypto.randomBytes values; only crypto.createHash('sha256') hashes are persisted — the raw token exists only in the response cookie and the caller's memory"
  - "D-07: absolute 12h expiry, no sliding/refresh; expiry enforced lazily in findSession() so revocation is immediate with zero background sweep required for correctness (pruneExpiredSessions is purely a table-bloat cleanup)"
  - "D-08: SameSite=Strict (was Lax) on the session cookie"
  - "AUTH-02 (write-time role enforcement) intentionally deferred to Plan 02 — this plan's gate write branch is permissive (any authenticated role may write), matching today's actual behavior, to avoid a write regression while the ROLE_WRITE_POLICY table doesn't exist yet"
  - "lockedDown()/isAdminRequest(req) call sites at ~1789/~1833 and the request-aware lockedDown(req) conversion are explicitly left for Plan 02 (per 02-02-PLAN.md's own acceptance criteria expecting to find and convert the remaining no-arg call sites) — not touched here"

requirements-completed: [AUTH-01, AUTH-03, AUTH-04]

coverage:
  - id: D1
    description: "Every /api/* route (GET reads included) rejects an unauthenticated request with 401, proven against a live-generated route inventory; DEMO_OPEN=1 keeps the showcase open"
    requirement: "AUTH-01"
    verification:
      - kind: integration
        ref: "test/auth-route-inventory.test.js#AUTH-01: every /api/* route (read or write) rejects an unauthenticated request with 401"
        status: pass
      - kind: integration
        ref: "test/auth-route-inventory.test.js#AUTH-01/D-02: DEMO_OPEN=1 keeps a sample route open; unsetting it restores the fail-closed default"
        status: pass
    human_judgment: false
  - id: D2
    description: "Sessions are revocable (logout, admin revoke-all-for-user) and expire absolutely (12h), backed by a dedicated sessions table with tokens hashed (SHA-256) at rest"
    requirement: "AUTH-03"
    verification:
      - kind: unit
        ref: "test/session-lifecycle.test.js#session-lifecycle: create -> find resolves {username, role}; logout (deleteSession) immediately revokes it"
        status: pass
      - kind: unit
        ref: "test/session-lifecycle.test.js#session-lifecycle: admin deleteAllSessionsForUser revokes every live session for that user"
        status: pass
      - kind: unit
        ref: "test/session-lifecycle.test.js#session-lifecycle: a row whose expires_at is in the past is never returned by findSession"
        status: pass
      - kind: unit
        ref: "test/session-lifecycle.test.js#session-lifecycle (D-06): the sessions table stores only the SHA-256 hash of the token, never the raw token"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every authenticated request resolves req.portalUser = {username, role, sessionId} server-side; an open-mode request has req.portalUser === null explicitly"
    requirement: "AUTH-04"
    verification:
      - kind: unit
        ref: "test/session-lifecycle.test.js#session-lifecycle (AUTH-04): findSession returns exactly the {username, role, sessionId} shape the gate assigns to req.portalUser"
        status: pass
      - kind: manual_procedural
        ref: "manual curl round-trip: login -> session cookie authorizes GET /api/menus (200) -> logout -> same cookie 401s"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-07-24
status: complete
---

# Phase 2 Plan 1: Requireable Server + Sessions Table + Consolidated Fail-Closed Gate Summary

**Fail-closed-by-default `/api` gate backed by a SQLite sessions table (SHA-256-hashed opaque tokens), replacing the opt-in `PORTAL_AUTH` HMAC cookie, with `req.portalUser` identity resolved server-side on every request**

## Performance

- **Duration:** 22 min
- **Started:** 2026-07-24T07:04:23+02:00 (phase plan finalized)
- **Completed:** 2026-07-24T07:26:27+02:00
- **Tasks:** 2 completed
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- Every `/api/*` route (reads included) now rejects an unauthenticated request with 401 by default — proven against a live, programmatically-generated route inventory (`app._router.stack` walk), not a hand-maintained list that would drift.
- `DEMO_OPEN=1` is the one explicit escape hatch that keeps the showcase open; unsetting it immediately restores fail-closed, verified by a round-trip test.
- The stateless, unrevocable HMAC-signed session cookie was replaced with an opaque 256-bit token backed by a dedicated SQLite `sessions` table — only the SHA-256 hash of the token is ever persisted, so a leaked `data/ma-portal.db` cannot be replayed as a live session.
- Sessions are now genuinely revocable and expire absolutely: logout deletes the row immediately, an admin can revoke every session for a user in one call (`POST /api/admin/users/:username/revoke-sessions`), and a past-expiry row is an immediate miss with zero background sweep required for correctness.
- `server.js` is now a requireable module (`module.exports = app`, `app.listen()` guarded behind `require.main === module`) — `node server.js` behavior is unchanged for every existing launcher/deployment, while test files can drive the app against an ephemeral port.
- `req.portalUser = { username, role, sessionId }` is resolved server-side on every authenticated request; an open-mode request gets `req.portalUser === null` explicitly (not `undefined`).

## Task Commits

Each task was committed atomically:

1. **Task 1: Requireable server + sessions table + consolidated fail-closed gate** - `53ff0ae` (feat)
2. **Task 2: Session revocation, absolute expiry & admin revoke-all** - `710cd3a` (feat)

_Both tasks were `tdd="true"` (Task 1) / test-covered (Task 2) — the test file for each task was authored and verified green as part of the same commit, per the plan's task ordering (implementation + its proving test land together, not as separate RED/GREEN commits, since these are integration/lifecycle proofs rather than a strict unit-level RED-GREEN cycle)._

## Files Created/Modified

- `server.js` - Consolidated the two overlapping `/api` gate middlewares into ONE fail-closed gate; added `isOpenMode(req)`, `PUBLIC_API_PATHS`, `readSessionCookie(req)`; rewrote login/logout/me against the sessions table with `SameSite=Strict`; added `module.exports = app` + `require.main === module` listen guard; added the `POST /api/admin/users/:username/revoke-sessions` offboarding endpoint; startup + opportunistic-on-login `pruneExpiredSessions()` calls; retired the HMAC session functions (`makeSessionToken`/`readSession`/`signSessionPayload`/`AUTH_SECRET`)
- `db/sessions.js` - New dedicated SQLite session store: `createSession`/`findSession`/`deleteSession`/`deleteAllSessionsForUser`/`pruneExpiredSessions` + internal `newSessionToken`/`hashToken`, sharing `db/store.js`'s single connection
- `db/store.js` - New `getConnection()` export so `db/sessions.js` shares the module's single SQLite handle instead of opening a second one
- `db/schema.sql` - New `sessions` table (`token_hash` PK, `username`, `role`, `created_at`, `expires_at`, `user_agent`, `ip`) + `idx_sessions_username`/`idx_sessions_expires`, explicitly commented as outside the `ARRAY_COLLECTIONS` inventory
- `test/auth-route-inventory.test.js` - AUTH-01: live route-inventory unauthenticated-401 sweep + DEMO_OPEN toggle round-trip
- `test/session-lifecycle.test.js` - AUTH-03/AUTH-04: create/authorize/logout/admin-revoke-all/expiry/hashed-at-rest/identity-shape

## Decisions Made

- **AUTH-02 (write-time role enforcement) intentionally deferred to Plan 02.** This plan's gate write branch is permissive by design (any authenticated role may write, matching today's actual behavior for admin/hrbp/pmo on the 59 non-admin write routes) — the plan's own task description calls for a "hook" here, not the full `ROLE_WRITE_POLICY` implementation, to avoid a write regression while that table doesn't exist yet.
- **`lockedDown()`/`isAdminRequest(req)` left largely as-is, with one minimal compatibility fix.** `isAdminRequest(req)`'s `PORTAL_AUTH` branch previously called the now-retired `readSession(req)` (HMAC decode) — this was swapped to read `req.portalUser.role === 'admin'` (the new session-gate-set identity) so the function doesn't reference a deleted function. `lockedDown()` itself is deliberately left as a no-arg function referencing `ADMIN_TOKEN`/`PORTAL_AUTH` (not yet request-aware) — Plan 02's own acceptance criteria explicitly expects to find and convert the remaining no-arg call sites (`grep -c "lockedDown()" server.js` returns 0 only *after* Plan 02), so converting it here would duplicate/conflict with Plan 02's scoped work.
- **`ADMIN_TOKEN` (`X-Admin-Token`) is not handled in the new consolidated gate.** Per the plan's exact target gate shape (02-PATTERNS.md/02-RESEARCH.md), the D-11 "attributed break-glass identity" for `X-Admin-Token` is explicitly Plan 02's task (`{username: 'admin-token', role: 'admin'}`). In the interim (until Plan 02 lands within this same phase), an `X-Admin-Token` request without a session now 401s like any other unauthenticated request — an intentional, wave-sequenced transient state, not a regression left in production.
- **`/api/auth/me`'s `authEnabled` flag now reflects `isOpenMode(req)`** (`false` in DEMO_OPEN mode, `true` otherwise) rather than the retired `PORTAL_AUTH` toggle — response shape (`{authEnabled, user}`) is unchanged, only the underlying signal source changed, consistent with login now always being available (D-01).
- **PORTAL_AUTH env var kept, but non-gating.** Declared for backward compatibility with any existing deployment scripts; no code path uses it to make an authorization decision (the plan's explicit instruction to "leave the env var name tolerated but non-gating").

## Deviations from Plan

None - plan executed exactly as written (Tasks 1 and 2, including their acceptance criteria and threat-model mitigations, per D-01, D-02, D-03, D-06, D-07, D-08).

## Issues Encountered

None. One local verification note: an unrelated `npx remotion studio` process was already listening on port 3000 in this environment, which briefly returned misleading 200s during an early manual boot-test attempt against the wrong port; re-run against `PORT=3999` confirmed the real behavior (401 unauthenticated, 200 after login, 401 again after logout).

## User Setup Required

None - no external service configuration required. (Note for operators: launchers/deployments that want the demo showcase to stay open must set `DEMO_OPEN=1` — this is Plan 03's scope, not yet wired into `start.bat`/`start.command`.)

## Next Phase Readiness

- Plan 02 (AUTH-02 role enforcement, D-11 admin-token identity, D-09/D-10 password management, D-12 employee seed) can now build directly on the consolidated gate, `req.portalUser`, and the `isWrite` hook this plan left in place.
- Plan 03 (client-side 401-on-read redirect, launcher `DEMO_OPEN=1` wiring) can build on the `authRequired: true` 401 shape already returned by the gate.
- Phase 3's audit log has a stable `req.portalUser.sessionId` to record against.
- No blockers. The one known interim gap (admin-only read guards at ~1789/~1833 not yet request-aware; `X-Admin-Token` not yet handled in the gate) is explicitly scoped to Plan 02 and does not affect this plan's own AUTH-01/03/04 completion.

## Self-Check: PASSED

- FOUND: db/sessions.js
- FOUND: test/auth-route-inventory.test.js
- FOUND: test/session-lifecycle.test.js
- FOUND: .planning/phases/02-mandatory-auth-roles/02-01-SUMMARY.md
- FOUND commit: 53ff0ae (Task 1)
- FOUND commit: 710cd3a (Task 2)
- Full `node --test` suite: 16/16 passing (9 Phase-1 + 2 auth-route-inventory + 5 session-lifecycle)

---
*Phase: 02-mandatory-auth-roles*
*Completed: 2026-07-24*
