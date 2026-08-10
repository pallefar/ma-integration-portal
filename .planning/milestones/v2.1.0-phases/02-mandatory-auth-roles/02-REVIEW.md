---
phase: 02-mandatory-auth-roles
reviewed: 2026-07-31T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - db.json
  - db/schema.sql
  - db/sessions.js
  - db/store.js
  - public/js/transitions.js
  - scripts/set-admin-password.js
  - server.js
  - start.bat
  - start.command
  - test/auth-route-inventory.test.js
  - test/role-enforcement.test.js
  - test/session-lifecycle.test.js
findings:
  critical: 2
  warning: 5
  info: 2
  total: 9
status: resolved
---

# Phase 02: Code Review Report

**Reviewed:** 2026-07-31T00:00:00Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** resolved

**Fix pass (2026-07-31):** All 2 Critical + all 5 Warning findings fixed and committed (see per-finding `**Status:**` lines below and `test/role-enforcement.test.js` for the regression tests added). The 2 Info findings are unchanged/deferred — see their entries below. `npm test` — 32/32 passing (25 baseline + 7 new regression tests for CR-01/CR-02/WR-01/WR-02).

## Summary

Reviewed the diff introduced by Phase 2 (Mandatory Auth & Roles) against `53ff0aedd403f91fbc860176cb212792b5953129^`: the new consolidated `/api` gate, opaque SQLite-backed sessions (`db/sessions.js`, `db/schema.sql`'s `sessions` table), the coarse `ROLE_WRITE_POLICY` capability map, the self password-change endpoint, `scripts/set-admin-password.js`, the client fetch-wrapper redirect-on-401 in `transitions.js`, and the `DEMO_OPEN=1` demo launchers.

The fail-closed session gate itself (AUTH-01) is sound and well tested (`test/auth-route-inventory.test.js` proves every registered `/api/*` route 401s unauthenticated, and that `DEMO_OPEN=1` is the sole escape hatch). However, two concrete authorization gaps were found in the write-side role enforcement and in the admin-route gating that **undo the security goal this phase is building toward** — both are provable against the actual route table, not hypothetical, and neither is covered by the new test suite. Several secondary robustness/observability gaps around session lifecycle and credential rotation were also found.

## Critical Issues

### CR-01: `ROLE_WRITE_POLICY`'s `/api/assessment` prefix accidentally grants `employee` DELETE rights on assessments and assessment instances

**Status:** fixed (commit `bff4298`) — `roleAllowedForWrite()` now matches boundary-safely (`path === prefix || path.startsWith(prefix + '/')`) and rules may pin `methods: [...]`; the self-service `/api/assessment` and `/api/assessment-instances` entries are `exact + POST-only`, so `DELETE /api/assessments/:id` and `DELETE /api/assessment-instances/:id` fall through to `DEFAULT_WRITE_ROLES` (no `employee`). Regression tests added in `test/role-enforcement.test.js` (CR-01 unit + 2 integration tests).

**File:** `server.js:172-190` (policy table + `roleAllowedForWrite`), consumed at `server.js:210-241` (the `/api` gate)

**Issue:** `roleAllowedForWrite()` matches policy entries with `path.startsWith(r.prefix)`. The entry

```js
{ prefix: '/api/assessment', roles: ['admin', 'hrbp', 'pmo', 'employee'] }, // covers /api/assessment + /api/assessment-instances
```

is a plain string prefix, so it *also* matches every route whose path merely begins with the literal characters `/api/assessment`, including:

- `DELETE /api/assessments/:id` (server.js:1751) — deletes an assessment **definition**
- `DELETE /api/assessment-instances/:id` (server.js:1935) — explicitly commented `// DELETE an instance (admin cleanup)`

Both routes are destructive, admin/PMO-intent operations, yet because `'/api/assessments/xyz'.startsWith('/api/assessment')` and `'/api/assessment-instances/xyz'.startsWith('/api/assessment')` are both `true`, an authenticated `employee` session — the exact role this phase's design (D-04/D-05) set out to restrict to a narrow, explicit self-service allowlist — can now issue `DELETE /api/assessments/:id` or `DELETE /api/assessment-instances/:id` and have it succeed. This directly contradicts the policy table's own header comment ("the ONLY prefixes 'employee' may write to today") and the inline comment on the DELETE route itself ("admin cleanup").

Concretely: an authenticated `employee-demo` session can delete any assessment template's stored assessment record or any submitted assessment instance belonging to any other user, in an app whose stated purpose is handling MNPI (retention lists, readiness assessments are called out in the codebase as "the most sensitive data in the app" at server.js:1910-1911).

This gap exists precisely because `ROLE_WRITE_POLICY` is a naive `startsWith` prefix table with no path-boundary check, and none of the added tests (`test/role-enforcement.test.js`) exercise `DELETE /api/assessments/:id` or `DELETE /api/assessment-instances/:id` for the `employee` role — only `POST /api/pulses` (intended) and `POST /api/questions` (correctly rejected) are covered.

**Fix:** Add a path-boundary check so a prefix only matches at a `/` boundary or full string, AND split the self-service entry so it does not swallow the plural/instance-delete routes:

```js
const ROLE_WRITE_POLICY = [
  { prefix: '/api/admin', roles: ['admin'] },
  { prefix: '/api/pulses', roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  { prefix: '/api/employees/complete-lesson', roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  { prefix: '/api/employees/uncomplete-lesson', roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  // Boundary-safe: matches POST /api/assessment and POST/DELETE under
  // /api/assessment-instances, but NOT /api/assessments (plural, admin CRUD).
  { prefix: '/api/assessment-instances', roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  { prefix: '/api/assessment', roles: ['admin', 'hrbp', 'pmo', 'employee'], exact: true },
  { prefix: '/api/auth/change-password', roles: ['admin', 'hrbp', 'pmo', 'employee'] },
];

function roleAllowedForWrite(role, path) {
  const rule = ROLE_WRITE_POLICY.find(r =>
    r.exact ? path === r.prefix : (path === r.prefix || path.startsWith(r.prefix + '/'))
  );
  const allowed = rule ? rule.roles : DEFAULT_WRITE_ROLES;
  return allowed.includes(role);
}
```

Then, separately, remove `employee` from `DELETE /api/assessment-instances/:id`'s allowed roles by giving that one route its own method-aware rule (or add a method check), since only the create case (`POST /api/assessment-instances`, self-submission) was ever intended for employees — the delete case is admin cleanup per its own comment. At minimum, add a regression test asserting `employee` gets 403 on `DELETE /api/assessments/:id` and `DELETE /api/assessment-instances/:id`.

---

### CR-02: `GET /api/admin/download-zip` lost its admin-role requirement — any authenticated user can now reach it

**Status:** fixed (commit `48dff92`) — the `/api` gate now checks `ROLE_WRITE_POLICY` on every method for `/api/admin/*` paths (`requiresRoleCheck = isWrite || pathMatchesPrefix(fullPath, '/api/admin')`), not just writes. Regression tests added in `test/role-enforcement.test.js` (employee and hrbp sessions both get 403 on `GET /api/admin/download-zip`).

**File:** `server.js:400-418` (route), `server.js:210-241` (the consolidated `/api` gate)

**Issue:** Before this phase, `/api/admin/*` was gated for **every HTTP method** (see the diff's removed code): `isAdminPath` was checked regardless of `isWrite`, and under `PORTAL_AUTH` required `sess.role === 'admin'` (or the token) for both reads and writes.

The new consolidated gate only consults `ROLE_WRITE_POLICY` (which has `{ prefix: '/api/admin', roles: ['admin'] }`) when `isWrite` is true:

```js
const isWrite = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
...
if (isWrite && !roleAllowedForWrite(req.portalUser.role, req.baseUrl + req.path)) {
  return res.status(403).json({ error: 'Your role cannot perform this action.' });
}
```

`app.get('/api/admin/download-zip', ...)` (server.js:400) is a `GET`, so `isWrite` is `false` and the role check is skipped entirely — the handler itself also does not call `isAdminRequest(req)` anywhere. The only thing now standing between an authenticated non-admin user and this endpoint is "a session exists at all." Concretely: the seeded `employee-demo` account (role: `employee`), or any `hrbp`/`pmo` session, can now `GET /api/admin/download-zip` and receive the full application source archive — a capability that was previously admin-only in every prior auth posture this codebase has shipped (PORTAL_AUTH mode *and* ADMIN_TOKEN-only mode both restricted it).

`test/auth-route-inventory.test.js` only proves *unauthenticated* access 401s; it does not test role escalation on this (or any) admin-prefixed GET route, so this regression is invisible to the current 25/25-passing suite.

**Fix:** Extend the gate's role check to admin-prefixed paths regardless of method, not just writes:

```js
const fullPath = req.baseUrl + req.path;
const requiresRoleCheck = isWrite || fullPath.startsWith('/api/admin');
if (requiresRoleCheck && !roleAllowedForWrite(req.portalUser.role, fullPath)) {
  return res.status(403).json({ error: 'Your role cannot perform this action.' });
}
```

This naturally reuses the existing `{ prefix: '/api/admin', roles: ['admin'] }` entry for reads too. Add a test asserting a non-admin session gets 403 (not 200) on `GET /api/admin/download-zip`.

## Warnings

### WR-01: Neither self-service password change nor the first-run admin-password script revokes existing sessions

**Status:** fixed (commit `71c654b`) — both `POST /api/auth/change-password` and `scripts/set-admin-password.js` now call `sessions.deleteAllSessionsForUser()` immediately after persisting the new hash; the self-service endpoint re-issues a fresh session/cookie for the current caller only. Regression test added in `test/role-enforcement.test.js`.

**File:** `server.js:333-351` (`POST /api/auth/change-password`), `scripts/set-admin-password.js:63-102` (`run()`)

**Issue:** `db/sessions.js` exposes `deleteAllSessionsForUser(conn, username)` specifically for this purpose (its own docstring calls it "Admin offboarding action"), but neither credential-rotation path calls it. After a password change, every previously-issued session token for that user (other tabs, other devices, or — critically — a token an attacker already stole via a leaked cookie) remains valid for up to 12h. This defeats the standard security rationale for rotating a credential after suspected compromise, which is the exact scenario `scripts/set-admin-password.js`'s own D-10 warning is designed to respond to (rotating off the publicly-known demo password).

**Fix:** Call `sessions.deleteAllSessionsForUser(getConnection(), user.username)` immediately after persisting the new hash in both places. For the self-service endpoint, consider re-issuing a fresh session/cookie for the *current* caller only so they aren't logged out by their own password change.

### WR-02: `POST /api/auth/change-password` has no attempt throttle, unlike `/api/auth/login`

**Status:** fixed (commit `2ef543b`) — `change-password` now calls `loginThrottled('change-password:' + req.portalUser.username)` before verifying `currentPassword`, mirroring `/api/auth/login`'s 8-attempts/minute cap. Keyed by username (not IP) so callers behind the same proxy/NAT don't share a bucket. Regression test added in `test/role-enforcement.test.js`.

**File:** `server.js:333-351`

**Issue:** `/api/auth/login` is protected by `loginThrottled()` (8 attempts/minute per IP) specifically because `scrypt` is expensive and repeated guessing should be capped before the hashing work runs. `change-password` performs the identical `hashPassword()` + `timingSafeEqualStr()` verification of `currentPassword` but has no equivalent throttle, so a caller who already holds a valid session (e.g. a stolen cookie without the password) can attempt unlimited current-password guesses.

**Fix:** Reuse `loginThrottled()` (keyed by `req.portalUser.username` or IP) before computing `hashPassword(currentPassword, ...)` in this handler.

### WR-03: No startup warning when `DEMO_OPEN=1` is active, despite it disabling ALL `/api` authentication

**Status:** fixed (commit `f54b784`) — added the exact `console.warn('[security] DEMO_OPEN=1 — ...')` suggested by this finding, right next to the existing `ADMIN_TOKEN` warning. Manually verified via `DEMO_OPEN=1 node -e "require('./server.js')"`.

**File:** `server.js:136-138` (`isOpenMode`), contrast with `server.js:98-101` (existing `ADMIN_TOKEN` warning)

**Issue:** The codebase already logs a loud `console.warn` when `ADMIN_TOKEN` is unset ("write/admin API endpoints are OPEN"). `DEMO_OPEN=1` is strictly more consequential — it disables the entire mandatory session gate for every `/api/*` route, reads included — yet there is no equivalent `console.warn` anywhere DEMO_OPEN is consulted or at server startup. An operator who mistakenly carries `DEMO_OPEN=1` into a real-deal deployment (e.g. by copying `start.bat`/`start.command` verbatim, which set it unconditionally) gets zero server-side signal in the logs that authentication is fully bypassed.

**Fix:** Add, near the existing `ADMIN_TOKEN` warning:
```js
if (process.env.DEMO_OPEN === '1') {
  console.warn('[security] DEMO_OPEN=1 — ALL /api authentication and authorization is DISABLED. Never set this for a real-deal deployment.');
}
```

### WR-04: Session `ip` metadata will record the reverse proxy's address, not the client's, in the deployment topology this feature targets

**Status:** fixed (commit `02f4114`) — added an opt-in `TRUST_PROXY` env var wired to `app.set('trust proxy', ...)`, left OFF by default (Express's own safe default) so an unbounded `X-Forwarded-For` chain is never trusted unconditionally. Operators behind a reverse proxy set `TRUST_PROXY` to their actual hop count/address; a `[security]` console.warn fires when set, same as this finding's alternative recommendation ("or document that operators must set it").

**File:** `server.js:289-292` (`sessions.createSession(..., ip: req.ip, ...)`), `db/schema.sql:296-304` (new `sessions.ip` column)

**Issue:** This phase adds an `ip` column to the new `sessions` table specifically to record which client created a session (forensic/audit value). It is populated from Express's `req.ip`. `CLAUDE.md` documents this app's production target as "self-hosted Node.js servers" behind "TLS termination" (i.e. a reverse proxy) — but nowhere does `server.js` call `app.set('trust proxy', ...)`. Without it, `req.ip` under a reverse-proxy deployment resolves to the proxy's own address for every request, so every row in the new `sessions` table will carry the same useless `ip` value in exactly the deployment this feature is meant to support. (The pre-existing `loginThrottled(req.ip)` throttle has the same blind spot, collapsing all users behind the proxy into one shared attempt-counter bucket.)

**Fix:** Configure `app.set('trust proxy', ...)` appropriately for the target reverse-proxy topology (e.g. `'loopback'` or a specific proxy count/IP), or document that operators must set it, before relying on `req.ip` for either the session audit trail or the login throttle.

### WR-05: `ROLE_WRITE_POLICY`'s prefix design is inherently order/substring-fragile beyond CR-01's specific instance

**Status:** fixed (commit `bff4298`, bundled with CR-01) — `pathMatchesPrefix()` (`path === prefix || path.startsWith(prefix + '/')`) replaced the unbounded `startsWith(prefix)` match for every rule in `ROLE_WRITE_POLICY`, not just the `/api/assessment` entries, closing the general "a future route silently inherits an existing prefix's roles" class of bug this finding describes. A dedicated live-route-inventory walk (in the spirit of `test/auth-route-inventory.test.js`) was not added separately — the CR-01 regression tests exercise the specific boundary case this review flagged; a broader route-inventory assertion is left as a follow-up if a future phase adds more prefix-adjacent routes.

**File:** `server.js:168-190`

**Issue:** Related to CR-01 but broader: `.find()` returns the *first* matching entry and matching is unbounded `startsWith`, so any future endpoint added under an existing prefix's namespace (e.g. a new `/api/assessment-templates` write route, or `/api/pulses-export`) will silently inherit that prefix's role list rather than falling through to `DEFAULT_WRITE_ROLES`, with no warning or test failure to catch it. This is a structural fragility in the policy table, not just the one CR-01 bug.

**Fix:** Once CR-01 is fixed with boundary-aware matching (`path === prefix || path.startsWith(prefix + '/')`), also add a lightweight assertion/test that walks every *actual* registered write route and confirms it resolves to the expected role set — similar in spirit to `test/auth-route-inventory.test.js`'s live route-inventory approach — so a future added route can't silently drift under an existing prefix.

## Info

### IN-01: `transitions.js`'s "Real-login handshake" comment still references the vestigial `PORTAL_AUTH` flag

**File:** `public/js/transitions.js:171-173`

**Issue:** `// Real-login handshake (only active on PORTAL_AUTH=1 deployments; the open demo gets { authEnabled:false } and nothing changes).` This comment predates this phase's redesign. Server-side, `PORTAL_AUTH` is now explicitly documented as "vestigial; not used to gate anything below" (server.js:122) — the actual gating condition for this client code path is `DEMO_OPEN` (via `/api/auth/me`'s `authEnabled` field). The stale reference to `PORTAL_AUTH=1` as the gating condition will mislead a future reader trying to reason about when this redirect-to-login logic engages.

**Fix:** Update the comment to reference `DEMO_OPEN` / `authEnabled` instead of `PORTAL_AUTH=1`.

### IN-02: `hashPassword` and `timingSafeEqualStr` are duplicated verbatim between `server.js` and `scripts/set-admin-password.js`

**File:** `server.js:104-108,125-127`, `scripts/set-admin-password.js:31-39`

**Issue:** The script's own comment explains *why* it reimplements rather than `require()`s from `server.js` (avoiding server.js's module-load side effects), which is a reasonable trade-off — but it means the two hashing implementations can silently drift (e.g. if `scrypt`'s cost parameters or key length are ever tuned in one copy and not the other, password hashes set by the script would become unverifiable by the server's login route, or vice versa).

**Fix:** Extract both functions into a small dependency-free module (e.g. `lib/password-hash.js`, requiring only `crypto`) that both `server.js` and `scripts/set-admin-password.js` import, preserving the "no server.js side effects" property while eliminating the duplication risk.

---

_Reviewed: 2026-07-31T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
