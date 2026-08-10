# Phase 2: Mandatory Auth & Roles - Research

**Researched:** 2026-07-24
**Domain:** Promoting an existing opt-in scrypt/HMAC-cookie login (`PORTAL_AUTH=1`) to mandatory-by-default fail-closed auth, adding coarse role-gated writes and a revocable SQLite sessions table, on an Express 4 app with zero build step and committed `node_modules`.
**Confidence:** HIGH — every claim below is grounded in a direct read of `server.js`, `db/store.js`, `db/schema.sql`, `db/collections.js`, `public/js/transitions.js`, `public/login.html`, `start.bat`/`start.command`, and `db.json`'s seeded `users`, plus a live route-introspection test run against this repo's actual installed Express 4.22.2, cross-checked against OWASP guidance where cited.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Mandatory vs open demo (the central reconciliation)**
- **D-01:** Auth is **fail-closed by default** — inverts today's "open unless `PORTAL_AUTH=1`". With no explicit demo-open signal, every `/api/*` endpoint (reads included) requires a valid session. This is the MNPI-safe default: unauthorized *read* is the compliance event, so an operator can never accidentally serve real deal data open. — **Reversibility:** costly — inverting the default touches the gate middleware and every deployment/launcher assumption; the demo bundles must opt into open mode.
- **D-02:** The demo showcase runs in an **explicit demo-open mode** (a clear env flag / setting, e.g. `DEMO_OPEN=1` or the existing demo-mode signal) that keeps `:3000` open and frictionless. Default (flag unset) = auth mandatory. The demo release bundles/launchers set this flag; real-deal deployments never do.
- **D-03:** Forward-compatibility with Phase 3: the demo-open decision must be structured so Phase 3's deal-resolver can bind it to data — **a real-deal database is ALWAYS auth-required; only `demo.db` may honor demo-open.** Phase 2 implements the flag; Phase 3 ties it to the resolved database. Do not hard-code assumptions that block that.

**Role model granularity (AUTH-02)**
- **D-04:** Coarse **role → resource-group capability map**, enforced by ONE middleware on every write endpoint. Roles = the existing `admin`, `hrbp` (Integration Leader), `pmo`, `employee`. Coarse mapping: admin = all; IL/pmo = deal-operations writes; employee = self-only. Per-workstream and field-level clean-room rules are **deferred to Phase 4** — do NOT build per-resource fine-grained permissions now (would be built twice). — **Reversibility:** reversible — the coarse map is additive; Phase 4 refines it.
- **D-05:** "Every write endpoint enforces role" is satisfied by routing all writes through the single capability check (not by hand-annotating ~90 endpoints). Reads are gated for authentication (D-01) but coarse role-filtering of read *payloads* (which records a role may see) is Phase 4 clean-room territory, except where an endpoint already hands back admin-only data (preserve today's `lockedDown()`/`isAdminRequest()` guards).

**Session revocation model (AUTH-03)**
- **D-06:** Replace the stateless HMAC-signed cookie with an **opaque token → row in a SQLite `sessions` table** (id/token, username, role, created, expires, optional user-agent/ip). Today's cookie expires but cannot be revoked; a table makes revocation real now that Phase 1 gave us SQLite. — **Reversibility:** costly — changes the session representation and the cookie contract; every request now does a sessions-table lookup.
- **D-07:** Revocation scope = **logout deletes the session row + an admin action "revoke all sessions for a user"** (offboarding). Absolute expiry — keep the existing 12h TTL, no sliding/refresh this phase. Per-device session list = deferred (adds UI scope).
- **D-08:** Tighten the session cookie: `HttpOnly` (already), `SameSite=Strict` (was `Lax`), `Secure` when HSTS/TLS. This addresses the CSRF exposure of cookie-based state-changing requests (research-flagged) and the CONCERNS.md "admin token in localStorage" note — sessions move fully to the HttpOnly cookie, not localStorage.

**Account management scope**
- **D-09:** Scope = **login (existing) + logged-in user can change their own password + a first-run/env mechanism to set the REAL admin password** so real-deal mode never ships with the publicly-known demo password (`TEdemo!2026`). Full user-CRUD admin UI = **deferred**. — **Reversibility:** reversible.
- **D-10:** The seeded demo accounts (admin/karen/pmo with the known demo password) stay for demo mode; real-deal mode requires the first-run admin secret to be set (fail-closed if a real deployment still has the demo password — warn loudly at minimum).

### Claude's Discretion
- The `sessions` table schema and indexing; opaque-token generation (`crypto.randomBytes`) and lookup.
- Consolidating the TWO overlapping `/api` gate middlewares (server.js ~148 write/admin gate + ~174 session gate) into one coherent gate — currently redundant.
- CSRF specifics beyond `SameSite=Strict` (double-submit token? origin check?) — research to recommend; Strict is the baseline.
- Exact demo-open flag name and how the demo launchers/bundles set it.
- Whether `req.portalUser`/`isAdminRequest()`/`lockedDown()` are refactored or extended; preserve their call sites' behavior.
- How the first-run admin secret is delivered (env var vs forced-change-on-first-login).

### Deferred Ideas (OUT OF SCOPE)
- Per-workstream / field-level clean-room read filtering — Phase 4 (DD-04, clean-room).
- Auth-event audit logging (login/logout/revoke/failed-attempt) — Phase 3 (AUD-01/02); Phase 2 just exposes the session identity.
- Full user-CRUD admin UI (create/edit/delete/assign-role) — later slice.
- Per-device session list + individual revoke + sliding expiry — later (D-07).
- TE SSO (SAML/OIDC) — v2 HOST-03, explicitly out of milestone.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Authentication is mandatory — no `/api/*` endpoint serves data or accepts a write without a valid authenticated session (verified against a full route inventory, read endpoints included) | "Route Inventory Mechanism" pattern below (`app._router.stack` walk, verified live against this repo's Express 4.22.2) + "Validation Architecture" unauthenticated-401 sweep test design |
| AUTH-02 | Every write endpoint enforces the caller's role, rejecting actions outside that role | "Coarse Role → Resource-Group Map" pattern + concrete `ROLE_WRITE_POLICY` table derived from the actual 60 existing write routes |
| AUTH-03 | Sessions are revocable and expire, backed by a `sessions` table; passwords are stored hashed (existing `scryptSync`) with `SameSite=Strict` session cookies | "Sessions Table Design" pattern (dedicated table, hashed-token storage, indexed lookup, revoke-by-username, lazy+startup expiry cleanup) |
| AUTH-04 | A signed-in user's role and identity are resolvable server-side on every request for audit and access decisions | Consolidated gate sets `req.portalUser = {username, role, sessionId}` on every authenticated request; Pitfall 4 below flags the `ADMIN_TOKEN` identity gap this creates |
</phase_requirements>

## Summary

The hard part of this phase's authentication is already built and sound: `server.js` has scrypt password hashing, a login-throttle, and a signed session cookie. What's missing is (1) making that mechanism the *only* mode instead of an opt-in behind `PORTAL_AUTH=1`, (2) replacing the stateless signed cookie with a real, revocable server-side session (a SQLite table now exists to hold it, per Phase 1), and (3) adding actual role differentiation to writes — today, once `PORTAL_AUTH=1` is set, *any* authenticated session (admin, hrbp, or pmo) can call *any* of the ~60 non-admin write endpoints identically; there is no role gate beyond the single `/api/admin/*` prefix.

The single highest-leverage finding is that Express 4's `app._router.stack` can be walked to programmatically enumerate every registered route (method + path) with zero new dependencies — verified live against this repo's actual `express@4.22.2` install. That gives AUTH-01 a concrete, automatable "full route inventory" proof: enumerate all `/api/*` routes, exclude the small explicit public allowlist (`/auth/login`, `/auth/logout`, `/auth/me`), fire an unauthenticated request at every remaining route+method, and assert 401. This requires one small, low-risk refactor first: `server.js` currently calls `app.listen()` unconditionally with no `module.exports` — it must export `app` and guard `app.listen()` behind `require.main === module` so a test file can `require('../server.js')` and drive it without a real process start.

The second major finding is that this codebase already has, for free, two of the three standard defenses against cookie-based CSRF: it never sets CORS headers (so a cross-origin browser fetch with `Content-Type: application/json` fails Express's implicit CORS check before the mutating request is even sent), and every write path already requires `application/json` bodies that a classic HTML `<form>` cannot produce. Combined with `SameSite=Strict` (D-08, locked) and the OWASP-endorsed Fetch Metadata (`Sec-Fetch-Site`) header check, no new CSRF-token library is needed — this matches Phase 1's stack research (`STACK.md`) and current OWASP guidance (cited below).

The third finding worth flagging early to the planner: three of the four roles in the coarse map (`admin`, `hrbp`, `pmo`) have real seeded login accounts (`db.json.users`); **`employee` does not** — no employee-role account is seeded anywhere, and today's employee-initiated writes (`/api/pulses`, lesson completion, self-assessment submission) go through the same "any authenticated session" gate as everything else, with no session at all in demo mode. AUTH-02's "employee = self-only" bucket therefore has no real account to bind ownership to yet. This is flagged as an Open Question, not silently assumed away.

**Primary recommendation:** Consolidate the two existing `/api` middlewares (server.js ~148, ~174) into one gate that (a) allowlists exactly three auth-bootstrap paths, (b) checks a small `isOpenMode(req)` seam (today: `process.env.DEMO_OPEN === '1'`; Phase 3 will AND this with `req.isDemo`), (c) resolves the session via a hashed-token lookup against the new `sessions` table (replacing HMAC decode) and sets `req.portalUser`, and (d) on writes only, checks role against a small explicit `ROLE_WRITE_POLICY` table keyed by path prefix (admin-only vs. deal-ops vs. self-service-allowlist) rather than annotating ~90 routes individually.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Session authentication (cookie verify, mandatory gate) | API / Backend | — | `server.js` middleware; no client-side trust boundary exists or should exist for this |
| Session storage & revocation | Database / Storage | API / Backend | New `sessions` SQLite table (Phase 1's `better-sqlite3`); API layer owns lookup/insert/delete logic via `db/store.js`-adjacent helpers |
| Coarse role→write authorization | API / Backend | — | Single consolidated middleware; must never be enforced client-side only (today's admin-token prompt is UX sugar, not a security boundary) |
| Password hashing | API / Backend | — | `crypto.scryptSync`, already correct; no change to primitive |
| Login/logout/session UX (redirect-to-login, click-to-fill demo accounts) | Browser / Client | Frontend Server (SSR — N/A, no SSR tier in this app) | `public/login.html`, `public/js/transitions.js`'s `/api/auth/me` probe; this app has no SSR tier, so "frontend server" concerns collapse into the static Express file server, which does no auth-aware rendering |
| CSRF defense (SameSite, no-CORS, Fetch Metadata) | API / Backend | Browser / Client | Cookie attributes and header checks are server-set; the browser enforces them, but the app never emits CORS headers, which is itself a backend-tier decision (absence of `cors` middleware) |
| Demo-open bypass flag | API / Backend | CDN / Static (N/A) | Env var read at request time in the gate middleware; launcher scripts (`start.bat`/`start.command`) are the operational tier that sets it, not a runtime tier |

## Standard Stack

### Core

No new runtime dependency is required for this phase. Every mechanism (opaque token generation, hashing, session table) is achievable with Node's built-in `crypto` module and the `better-sqlite3` driver already installed in Phase 1.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `crypto` (Node built-in) | Node ≥20, project targets ≥22 [VERIFIED: package.json `engines.node` and codebase grep] | `randomBytes(32)` for opaque session tokens, `createHash('sha256')` for token-at-rest hashing, `scryptSync` (already in use) for passwords | Zero dependency, already the app's established pattern for `hashPassword()`/`timingSafeEqualStr()`; no reason to add a session/JWT library for an internal single-process app |
| `better-sqlite3` | 13.0.1, already committed [VERIFIED: `node_modules`/`package.json` present in repo] | Backing store for the new `sessions` table | Already the Phase 1 driver; a `sessions` table is one more `CREATE TABLE` in the same file, same connection |
| Express `app._router.stack` (built-in, no package) | Bundled with `express@4.22.2` [VERIFIED: live introspection test run against this repo's actual installed Express — `node -e` script produced correct `{method, path}` list for `app.get`/`app.post`/`app.delete` registrations] | Programmatic route inventory for AUTH-01's verification sweep | Zero new dependency; `express-list-endpoints` (npm, confirmed on registry, v7.1.1) exists but is unnecessary — the raw introspection is ~15 lines and this project's stated constraint is "no new heavy deps if avoidable" |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None required | — | — | Everything in this phase is achievable with what's already installed. `express-rate-limit` (recommended in `STACK.md` for later hardening) is **not required this phase** — CONTEXT.md's canonical refs explicitly say keep the existing `_loginAttempts` throttle "sound." Do not add it as a side effect of this phase. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `app._router.stack` walk | `express-list-endpoints` npm package | Package adds a dependency (and a `node_modules` footprint in a repo that ships `node_modules` in every release zip) for something ~15 lines of code already does, verified working against this exact Express version. Reject. |
| Hand-rolled opaque token + SQLite table | `express-session` + `connect-sqlite3` | `STACK.md` (Phase 1 research) already rejected this: adds a dependency and a store-selection decision for something a single `sessions` table plus a `req.cookies`-style parse already does statelessly. The existing `readSession()`/`makeSessionToken()` shape is trivially adapted (see Code Examples). Reject — consistent with Phase 1's decision. |
| `SameSite=Strict` + no-CORS + Fetch Metadata | `csrf-csrf` (double-submit token library, confirmed on npm registry per `STACK.md`, v4.0.3) | Adds a dependency, a token-generation-and-verification code path, and (per its own docs) is designed for Express 5 with only "also usable" support on Express 4. Not needed while every write is same-origin JSON `fetch()` with no classic `<form>` POST anywhere in the app (verified: no `<form method=post action=/api` pattern found; all writes go through `fetch()` in `public/js/*.js`). Revisit only if a future phase adds classic form posts or exposes the app beyond an internal network without a same-site guarantee. |

**Installation:** None — no `npm install` needed for this phase.

## Package Legitimacy Audit

**No new external packages are introduced by this phase.** Every mechanism (opaque tokens, hashing, sessions table, route introspection, role gate) uses Node's `crypto` built-in, the already-installed `better-sqlite3`, and Express's own `_router.stack`. Package Legitimacy Gate is not applicable — there is nothing new to run `gsd-tools query package-legitimacy check` against.

If the planner later decides to adopt `express-rate-limit` (STACK.md's "later hardening" suggestion) or a CSRF-token library, run the gate at that time; do not pre-approve them here since they're explicitly out of this phase's scope.

## Architecture Patterns

### System Architecture Diagram

```
Browser (public/*.html + public/js/*.js)
  │
  │ fetch('/api/...')  — same-origin, cookie sent automatically (no explicit
  │                       credentials:'include' needed — same-origin fetch
  │                       includes cookies by default) [VERIFIED: codebase grep,
  │                       no `credentials:` option present on any /api fetch call]
  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Express app — ONE consolidated /api gate (replaces today's TWO)      │
│                                                                        │
│  0. Public allowlist: /auth/login, /auth/logout, /auth/me  → next()  │
│  1. isOpenMode(req)?  (env DEMO_OPEN=1 today; Phase 3 will AND       │
│     this with req.isDemo from the deal-resolver)                     │
│       yes → req.portalUser = null; next()   [demo showcase stays open]│
│       no  → continue to step 2                                       │
│  2. Resolve session: hash cookie token (SHA-256) → SELECT sessions   │
│     WHERE token_hash=? AND expires_at > now()                        │
│       miss/expired → 401 { authRequired: true }                      │
│       hit  → req.portalUser = { username, role, sessionId }  (AUTH-04)│
│  3. Write? (POST/PUT/PATCH/DELETE)                                    │
│       role not in ROLE_WRITE_POLICY[pathPrefix] → 403                │
│       else → next()                                                  │
│  4. Route handler (unchanged business logic)                         │
└─────────────────────────────────────────────┬───────────────────────┘
                                                │
                                                ▼
                                   db/store.js (readDb/writeDb, unchanged)
                                   + NEW: db/sessions.js (dedicated table,
                                     bypasses the whole-object snapshot merge —
                                     hot-path, per-request, would churn
                                     __snapshot for no reason)
```

### Recommended Project Structure

No new top-level directories are required — this is a promotion/hardening phase on an already-small file set. Two small new files fit the existing flat style:

```
server.js                  # gate middleware consolidated here (or extracted, planner's call —
                            #   CONTEXT.md leaves "whether req.portalUser/isAdminRequest/lockedDown
                            #   are refactored or extended" to discretion; given server.js is
                            #   already ~3,200 lines and ARCHITECTURE.md's Phase F1 slot names a
                            #   routes/ split as a LATER phase, do the minimal-diff version here:
                            #   keep the gate inline, but as ONE middleware, not two)
db/
├── store.js                # unchanged whole-object readDb/writeDb
├── sessions.js              # NEW: dedicated session CRUD — createSession(), findSession(token),
                             #   deleteSession(token), deleteAllSessionsForUser(username),
                             #   pruneExpiredSessions() — small direct-SQL helpers against the
                             #   SAME open connection as store.js (see Pitfall 2 below)
├── schema.sql               # + one new CREATE TABLE sessions (...)
scripts/
└── set-admin-password.js    # NEW: first-run/CLI mechanism for D-09 (env var OR forced prompt —
                             #   planner's call; a small script matches this repo's existing
                             #   scripts/migrate-db-json-to-sqlite.js precedent)
test/
├── auth-route-inventory.test.js   # NEW: AUTH-01 sweep (see Validation Architecture)
├── role-enforcement.test.js       # NEW: AUTH-02
└── session-lifecycle.test.js      # NEW: AUTH-03 (create/revoke/expire)
```

### Pattern 1: Route Inventory Mechanism (AUTH-01's "full route inventory" proof)

**What:** Walk `app._router.stack` to collect every `{method, path}` Express has registered, filter to the `/api` prefix, subtract the three legitimate public paths, then fire an unauthenticated request at every remaining route (substituting `:param` segments with a dummy literal) and assert 401.

**When to use:** Exactly once, as the AUTH-01 verification test — and re-run automatically in CI/pre-commit sense (via `npm test`) so a future endpoint added without going through the gate is caught immediately, not just at planning time.

**Verified example (ran directly against this repo's installed `express@4.22.2`):**
```javascript
// Source: direct execution in this repo, node -e '...' — output matched exactly
function listApiRoutes(app) {
  const out = [];
  const stack = (app._router && app._router.stack) || [];
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter(m => layer.route.methods[m]);
      for (const m of methods) {
        if (layer.route.path.startsWith('/api')) {
          out.push({ method: m.toUpperCase(), path: layer.route.path });
        }
      }
    }
    // NOTE: this app registers every route as a top-level app.METHOD() call —
    // no express.Router() sub-mounting exists today (verified: zero
    // `express.Router()` matches in server.js), so a recursive descent into
    // layer.handle.stack for nested routers is NOT needed for THIS codebase.
    // If a future phase (e.g. the routes/ split named in ARCHITECTURE.md)
    // introduces express.Router()-mounted sub-apps, this function must be
    // extended to recurse into layer.handle.stack when layer.name === 'router'
    // — flag this as a known evolution point, not a bug.
  }
  return out;
}
```

**Test sketch (AUTH-01):**
```javascript
// test/auth-route-inventory.test.js
const test = require('node:test');
const assert = require('node:assert');

// Requires server.js to export `app` and guard app.listen() behind
// require.main === module (see Pitfall 1) — without this, requiring
// server.js today starts a real listener as a side effect.
const app = require('../server.js');

const PUBLIC_API_PATHS = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/me']);

test('AUTH-01: every /api/* route (read or write) rejects an unauthenticated request', async (t) => {
  const server = app.listen(0); // ephemeral port
  const { port } = server.address();
  const routes = listApiRoutes(app).filter(r => !PUBLIC_API_PATHS.has(r.path));
  assert.ok(routes.length > 0, 'route inventory must not be empty — a 0-length list would make this test vacuously pass');
  for (const { method, path } of routes) {
    const url = `http://127.0.0.1:${port}${path.replace(/:[a-zA-Z]+/g, 'x')}`;
    const res = await fetch(url, { method }); // Node 22 global fetch — zero new dependency
    assert.strictEqual(res.status, 401, `${method} ${path} must 401 unauthenticated, got ${res.status}`);
  }
  server.close();
});
```

### Pattern 2: Sessions Table Design (AUTH-03)

**What:** A dedicated SQLite table, NOT riding the `ARRAY_COLLECTIONS`/JSON-blob-per-row pattern in `db/schema.sql`/`db/collections.js`. Reasoning: that pattern exists to make `readDb()`/`writeDb()`'s whole-object snapshot-diff merge work (Phase 1's FND-03 concurrency fix) — sessions are looked up on **every single request**, not read-modify-written as part of a business-object CRUD flow, and forcing every session lookup through `readDb()`'s full 33-collection reconstruction would be wasteful and would pollute `__snapshot` with session churn that has nothing to do with FND-03's actual guarantee. `ARCHITECTURE.md`'s own Phase F1 slot agrees: "Session store... Add a `sessions` table... now that SQLite exists," listed as new schema, not appended to the existing collection inventory.

**Schema (dedicated table, added to `db/schema.sql`):**
```sql
-- Session tokens are stored HASHED (SHA-256), never in plaintext — if the
-- SQLite file is ever exfiltrated (backup, stolen laptop), a raw session
-- table dump does not hand an attacker live, directly-usable session
-- tokens for every currently-logged-in user. This mirrors password-hash
-- practice and is explicit OWASP guidance for session identifiers.
-- Source: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,   -- sha256(raw opaque token), hex
  username    TEXT NOT NULL,
  role        TEXT NOT NULL,
  created_at  TEXT NOT NULL,      -- ISO-8601
  expires_at  TEXT NOT NULL,      -- ISO-8601, created_at + 12h, ABSOLUTE (D-07: no sliding)
  user_agent  TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);
CREATE INDEX IF NOT EXISTS idx_sessions_expires  ON sessions(expires_at);
```

**Token generation + lookup:**
```javascript
// db/sessions.js — small direct-SQL helpers, NOT the readDb/writeDb whole-object API.
// Requires db/store.js to export its module-level connection (add a
// `getConnection()` export alongside initDb/readDb/writeDb — today the `db`
// variable is private to the module) so this file shares the SAME open
// connection/pragmas rather than opening a second handle on the same file.
const crypto = require('crypto');

function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url'); // 256 bits entropy, URL-safe
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createSession(conn, { username, role, ttlMs, userAgent, ip }) {
  const token = newSessionToken();
  const now = new Date();
  conn.prepare(
    `INSERT INTO sessions (token_hash, username, role, created_at, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(hashToken(token), username, role, now.toISOString(),
        new Date(now.getTime() + ttlMs).toISOString(), userAgent || null, ip || null);
  return token; // raw token goes in the cookie; only the hash is ever persisted
}

function findSession(conn, token) {
  const row = conn.prepare(
    `SELECT username, role, expires_at FROM sessions WHERE token_hash = ?`
  ).get(hashToken(token));
  if (!row) return null;
  if (new Date(row.expires_at) <= new Date()) return null; // lazy expiry — see below
  return { username: row.username, role: row.role };
}

function deleteSession(conn, token) {
  conn.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token));
}
function deleteAllSessionsForUser(conn, username) { // D-07 "revoke all for a user"
  conn.prepare(`DELETE FROM sessions WHERE username = ?`).run(username);
}
function pruneExpiredSessions(conn) {
  conn.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(new Date().toISOString());
}

module.exports = { createSession, findSession, deleteSession, deleteAllSessionsForUser, pruneExpiredSessions };
```

**Expiry cleanup — lazy-on-read is sufficient, no cron needed:** `findSession()` already treats a past-`expires_at` row as a miss (D-03/AUTH-03's "revoked/expired session immediately stops authorizing" is satisfied the instant `expires_at` passes, without a background sweep). Physically deleting stale rows is only a table-bloat concern, not a security one — call `pruneExpiredSessions()` once at server startup (in `initDb()`) and once opportunistically inside the login handler (cheap, and traffic is a handful of users per `ARCHITECTURE.md`'s "Scaling Considerations"). This matches the app's existing minimalism (no interval timers, no job scheduler exist anywhere in the codebase today).

**Revoke-all-for-a-user (D-07 admin action):** `deleteAllSessionsForUser()` is a single indexed `DELETE ... WHERE username = ?` — trivial given the `idx_sessions_username` index. Wire this to a new `/api/admin/users/:username/revoke-sessions` endpoint (admin-role-gated) rather than folding it into the deferred full user-CRUD.

### Pattern 3: Coarse Role → Resource-Group Map (AUTH-02)

**What:** Today, exactly ONE write path (`/api/admin/migrate-db`) plus the `/api/admin/*` prefix is admin-gated; **all other 59 write routes accept any authenticated session identically** [VERIFIED: codebase grep — `grep -n "isAdminRequest\|role ===" server.js` returns only the two `/api/admin` gate checks and the two read-endpoint guards at lines 1789/1833; zero per-route role checks exist on any POST/PUT/DELETE handler]. AUTH-02 is therefore net-new differentiation, not a promotion of existing per-route logic.

A path-prefix policy table (mirroring the `RESOURCE_POLICY` shape `ARCHITECTURE.md` already sketches for Phase 4's clean-room, but coarser and write-only per D-04/D-05) is the correct minimal shape:

```javascript
// Consulted only for isWrite === true (reads stay gated on session-existence alone, D-05).
// Default (no match) = admin, hrbp, pmo (today's actual behavior for the 59
// non-admin write routes — this is additive, not a regression for those roles).
const ROLE_WRITE_POLICY = [
  { prefix: '/api/admin',   roles: ['admin'] },       // migrate-db etc. — already admin-only today

  // Self-service allowlist: the ONLY routes 'employee' may call, and only
  // when the write targets the caller's own record (ownership check TBD —
  // see Pitfall 5, no employee accounts exist yet to bind ownership to).
  { prefix: '/api/pulses',                     roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  { prefix: '/api/employees/complete-lesson',  roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  { prefix: '/api/employees/uncomplete-lesson',roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  { prefix: '/api/assessment',                 roles: ['admin', 'hrbp', 'pmo', 'employee'] }, // covers /api/assessment, /api/assessment-instances

  // Everything else under /api that accepts writes today (projects, employees
  // roster CRUD, integration-tasks, raid, synergies, departments, processes,
  // CMS: courses/pages/menus/slides/media/banners, settings, communications,
  // alerts, questions, hrbps, dashboard/reorder-widgets) — no explicit entry
  // needed; falls through to the default below.
];
const DEFAULT_WRITE_ROLES = ['admin', 'hrbp', 'pmo'];

function roleAllowedForWrite(role, path) {
  const rule = ROLE_WRITE_POLICY.find(r => path.startsWith(r.prefix));
  const allowed = rule ? rule.roles : DEFAULT_WRITE_ROLES;
  return allowed.includes(role);
}
```

**Why a default-allow-list instead of enumerating all 59 routes:** D-05 explicitly rejects hand-annotating ~90 endpoints. Because today's actual behavior for `hrbp`/`pmo` on all 59 non-admin, non-self-service routes is already "any session may write" — encoding that as a *default* (rather than 59 explicit entries) means adding this table is a genuinely small, low-risk diff, and any future endpoint added without an explicit prefix entry is safe-by-default at the `hrbp`/`pmo`/`admin` level (never silently open to `employee`, since `employee` is opt-in-only via the explicit allowlist).

### Anti-Patterns to Avoid
- **Hand-annotating every route with `requireRole(...)`:** D-05 explicitly forbids this. It also doesn't scale — the next 4 milestone phases (DD, synergy, org design, reporting) will add dozens more routes, and per-route annotation is exactly the "every new endpoint must remember" failure mode `ARCHITECTURE.md`'s Anti-Pattern 1 already names for the `demoMode` ternary problem. Use the path-prefix table instead.
- **Treating `lockedDown()` as a zero-argument global flag going forward:** today it's `function lockedDown() { return !!ADMIN_TOKEN || PORTAL_AUTH; }` — a static boolean. Under D-01/D-02/D-03, "locked down" becomes **per-request** (`isOpenMode(req)` can vary by whether `DEMO_OPEN` is set, and in Phase 3 by which database was resolved). Keeping `lockedDown()` as a no-arg global function will silently misbehave the moment Phase 3 adds real-deal vs. demo distinction. Change its signature to take `req` now, even though Phase 2 only reads the env var — this is the concrete mechanism D-03's "do not hard-code assumptions that block that" is asking for.
- **Storing raw session tokens in the `sessions` table:** see Pattern 2 — hash before persisting, exactly as passwords already are.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Route enumeration for the AUTH-01 proof | A hand-maintained list of every `/api/*` path in a comment or config file | `app._router.stack` introspection (Pattern 1) | A hand-maintained list drifts the moment a new endpoint is added — the whole point of AUTH-01 is that the check is *generated from the actual registered routes*, not from a document someone forgot to update |
| CSRF token issuance/verification | A custom double-submit-cookie implementation | `SameSite=Strict` (D-08, already locked) + the app's existing no-CORS posture + a `Sec-Fetch-Site` header check (see Common Pitfalls / Security Domain) | This app's actual attack surface (same-origin JSON `fetch()` only, no classic forms, no CORS headers ever set) is already well-covered by these free, standard, browser-enforced mechanisms; a hand-rolled token scheme adds an entire storage/verification surface for a threat this app's transport shape already mostly closes |
| Session token generation/comparison | A custom random-string generator or a non-constant-time string `===` compare | `crypto.randomBytes(32)` (256 bits, cryptographically secure) + `crypto.timingSafeEqual` (already used elsewhere in this file for `X-Admin-Token` comparison — reuse `timingSafeEqualStr()`) | Node's `crypto` module is the correct primitive source; this app already has the constant-time-compare pattern established at `server.js` line 104 — reuse it for the new token-hash comparison path too |
| Password hashing | Anything other than what's already there | `crypto.scryptSync` (unchanged, already OWASP-endorsed per Phase 1's `STACK.md`) | Not touched this phase — D-09/D-10 only add self-password-change and first-run-secret UX around the existing primitive |

**Key insight:** This phase's entire scope is achievable by composing Node's built-in `crypto`, the already-installed `better-sqlite3`, and Express's own introspection — every "don't hand-roll" entry above is really "don't reach for a library either," which is the correct call for a zero-build-step, committed-`node_modules` app where every dependency is permanent weight in every release zip.

## Common Pitfalls

### Pitfall 1: `server.js` cannot be required without starting a real listener
**What goes wrong:** The AUTH-01 route-inventory test (and any future integration test) needs to `require()` the Express `app` object without a real network listener already bound — but `server.js` today unconditionally calls `const server = app.listen(PORT, ...)` at module load with no `module.exports` at all [VERIFIED: codebase grep — `grep -n "app.listen\|module.exports" server.js` returns only line 3042's unconditional listen, no exports].
**Why it happens:** The file was written as a single-entrypoint script, not a requireable module — reasonable for a laptop-local demo app that has never needed automated tests against its HTTP surface before Phase 1.
**How to avoid:** Add `module.exports = app;` and wrap the existing `app.listen(...)` call in `if (require.main === module) { ... }`. This is a two-line, behavior-preserving change: `node server.js` (every launcher, every deployment) still binds `PORT` exactly as today, because `require.main === module` is true for the direct-invocation case; only a `require('../server.js')` from a test file gets the app object without a bound listener.
**Warning signs:** If this refactor is skipped, the AUTH-01 test file will either bind the real `PORT` (colliding with a running dev server) or fail to import cleanly.

### Pitfall 2: A second SQLite connection to the same file is unnecessary risk, not just waste
**What goes wrong:** If `db/sessions.js` is written to open its own `new Database(DEFAULT_DB_PATH)` independently of `db/store.js`'s module-level `db` singleton, the app now has two open handles to the same WAL-mode file, each needing its own pragma setup (`journal_mode=WAL`, `busy_timeout`, etc.) — easy to get out of sync, and pointless given `better-sqlite3` connections are cheap to share within one Node process.
**Why it happens:** `db/store.js` today does not export its connection (`db` is a private module variable; only `initDb`/`readDb`/`writeDb`/`idOf`/`projectIdOf`/`DEFAULT_DB_PATH` are exported).
**How to avoid:** Add a `getConnection()` export to `db/store.js` (a one-line addition: `function getConnection() { return requireDb(); } ... module.exports = { ..., getConnection };`) and have `db/sessions.js` call it rather than opening a second `Database` instance.
**Warning signs:** Two different `busy_timeout` values in logs, or WAL-mode lock contention that shouldn't exist for a single-process app.

### Pitfall 3: Client-side GET 401s are not handled today — only write 401s are
**What goes wrong:** `public/js/transitions.js`'s `fetch()` wrapper only intercepts 401 responses for **non-GET** requests (`if (res.status === 401 && isApi(url) && method !== 'GET' ...)` — line 26) to prompt for an `X-Admin-Token`. Under D-01's fail-closed default, GET requests to `/api/menus`, `/api/settings`, `/api/employees`, etc. will now also 401 for an unauthenticated caller — and nothing in the current client code redirects or recovers from that; `.then(r => r.json())` on a 401 response silently parses the `{error, authRequired:true}` body as if it were the expected data shape, since `fetch()` does not reject on non-2xx status.
**Why it happens:** The only existing "am I logged in" check is the separate `/api/auth/me` probe (transitions.js lines 156–178), which redirects to `/login.html` if `me.user` is falsy — but this is an async, best-effort, fire-and-forget probe that races against every other page-load `fetch()` call on the same page. There is no guarantee it resolves and redirects *before* e.g. `dashboard.js`'s own `DOMContentLoaded` handler fires its own GET requests.
**How to avoid:** This is a real client-side gap the planner must address, not just a server-side change. Recommend extending the existing fetch wrapper to redirect to `/login.html` on ANY `authRequired:true` 401 from `/api/*` (GET included), not just prompt-for-token on writes — this makes the redirect deterministic per-request rather than racing a single page-load probe. Flag as an explicit task; do not assume the existing `/api/auth/me` probe alone is sufficient once GETs are also gated.
**Warning signs:** Pages rendering with empty/broken widgets instead of redirecting to login when a session has expired mid-session (the 12h TTL will make this a real, not theoretical, occurrence).

### Pitfall 4: `ADMIN_TOKEN` bearer requests have no resolvable identity — a gap against AUTH-04
**What goes wrong:** AUTH-04 requires "a signed-in user's role and identity are resolvable server-side on every request." Today's `X-Admin-Token` mechanism (a shared secret, not a per-user credential) satisfies "role" (implicitly admin) but has no `username` at all — `isAdminRequest()` returns a boolean, not an identity. If Phase 2 keeps `ADMIN_TOKEN` as an alternate way to authenticate (e.g., for the non-interactive `/api/admin/download-zip` and `/api/admin/migrate-db` ops flows), every such request either has no `req.portalUser.username` or needs a synthetic one.
**Why it happens:** `ADMIN_TOKEN` predates the login system and was designed for a single shared ops secret, not per-user attribution — it was never meant to carry identity.
**How to avoid:** Two options, present both to the planner rather than picking silently: (a) retire `X-Admin-Token` as a write-authorizing mechanism entirely now that login is mandatory, keeping it (if at all) only for the two non-interactive `/api/admin/*` ops endpoints with a synthetic stable identity (`{username: 'admin-token', role: 'admin'}`) so AUTH-04's "resolvable identity" holds even for scripted access; or (b) retire it outright and require the two ops endpoints to also go through a real admin login session. Given Phase 3's AUD-01 will need to attribute every write to a real actor, option (a)'s synthetic identity is the minimum viable fix if the token mechanism is kept at all — but confirm with the user whether `ADMIN_TOKEN` is still needed once login is mandatory (D-01 through D-10 never mention its fate).
**Warning signs:** Any write attributed to `null`/`undefined` username in a future audit log.

### Pitfall 5: The `employee` role has no seeded account to enforce "self-only" against
**What goes wrong:** `db.json.users` seeds exactly three accounts — `admin`, `karen` (role `hrbp`), `pmo` (role `pmo`) [VERIFIED: direct read of `db.json`'s `users` array]. There is no `employee`-role account anywhere. Today's employee-initiated writes (`POST /api/pulses`, `/api/employees/complete-lesson`, self-assessment submission) have never required a session at all — they work purely off the employee's `localStorage.active_demo_role` client-side state, with no server-verified identity. AUTH-02's "employee = self-only" bucket therefore describes a capability that has no real account, and no ownership-check mechanism (what does "self" even bind to without a stable per-employee login?), to enforce against yet.
**Why it happens:** Full user-CRUD (which would let an admin provision individual employee accounts) is explicitly deferred per D-09.
**How to avoid:** Do not silently invent employee account provisioning to make the coarse map "work" — that's out of this phase's locked scope. Recommend treating the self-service endpoints (Pattern 3's allowlist) as reachable by `admin`/`hrbp`/`pmo` sessions on an employee's behalf (matching today's actual behavior — an HRBP or admin session currently submits these on behalf of the demo), and list `employee` as accepted-if-present but currently unreachable in production since no employee accounts exist. Surface this explicitly to the user as a scope question rather than assuming.
**Warning signs:** A role-enforcement test that tries to log in as `role: 'employee'` and can't, because no such account exists to test against.

### Pitfall 6: The whole-object `readDb()`/`writeDb()` snapshot merge must never see session rows
**What goes wrong:** If a future contributor "helpfully" adds `sessions` to `ARRAY_COLLECTIONS` in `db/collections.js` (matching the other 33 collections' pattern) instead of keeping it a dedicated table, every `readDb()` call now reconstructs the entire sessions table into the whole-object result, and every `writeDb()` call runs the snapshot-diff merge against it — massively increasing the read/write cost of the ~90 endpoints that call `readDb()`/`writeDb()` for unrelated business data, and (worse) exposing session rows to `res.json(db)`-style whole-object serialization unless something remembers to non-enumerable-hide it exactly like `__snapshot` already is.
**Why it happens:** `ARRAY_COLLECTIONS` is the established, well-documented pattern in this codebase (`db/collections.js`'s own header comment says it's the "single source of truth... do NOT duplicate the inventory anywhere else") — it's the path of least resistance to extend, even though it's wrong for this specific table.
**How to avoid:** Keep `sessions` OUT of `ARRAY_COLLECTIONS`/`db/schema.sql`'s per-collection block; add it as its own `CREATE TABLE` (Pattern 2) with its own small direct-SQL module (`db/sessions.js`), exactly as `db/collections.js`'s own file-header comment implies for anything that isn't a whole-object collection.
**Warning signs:** `db/collections.js`'s startup assertion (`if (ARRAY_COLLECTIONS.length !== 33) throw ...`) firing after a well-intentioned but wrong addition.

## Code Examples

### Consolidated `/api` gate (replaces server.js's two middlewares at ~148 and ~174)
```javascript
// Source: derived from this codebase's server.js ~142-194, adapted per D-01..D-08
function isOpenMode(req) {
  // Phase 2: global env flag only. Phase 3 note (D-03): this will become
  // `process.env.DEMO_OPEN === '1' && req.isDemo` once the deal-resolver
  // attaches req.isDemo — keep this as a named function, not an inlined
  // boolean, specifically so that extension is a one-line diff here.
  return process.env.DEMO_OPEN === '1';
}

const PUBLIC_API_PATHS = new Set(['/auth/login', '/auth/logout', '/auth/me']);

app.use('/api', (req, res, next) => {
  if (PUBLIC_API_PATHS.has(req.path)) return next();

  if (isOpenMode(req)) { req.portalUser = null; return next(); } // demo showcase (D-02)

  const cookieToken = readSessionCookie(req); // parse `ma_session` cookie value only
  const sess = cookieToken ? sessions.findSession(db.getConnection(), cookieToken) : null;
  if (!sess) return res.status(401).json({ error: 'Login required.', authRequired: true });
  req.portalUser = sess; // { username, role } — AUTH-04

  const isWrite = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  if (isWrite && !roleAllowedForWrite(sess.role, req.path)) {
    return res.status(403).json({ error: 'Your role cannot perform this action.' });
  }
  next();
});

// isAdminRequest()/lockedDown() become request-aware (Anti-Pattern above):
function isAdminRequest(req) { return !!(req.portalUser && req.portalUser.role === 'admin'); }
function lockedDown(req) { return !isOpenMode(req); } // "locked down" == NOT demo-open, under D-01's fail-closed default
```

### Login handler adapted for the sessions table (D-06/D-08)
```javascript
// Source: derived from server.js's existing app.post('/api/auth/login', ...) (~208-228)
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (loginThrottled(req.ip || req.socket.remoteAddress || '?')) {
    return res.status(429).json({ error: 'Too many attempts — try again in a minute.' });
  }
  const db = readDb();
  const user = (db.users || []).find(u => u.username === String(username || '').trim().toLowerCase());
  const computed = hashPassword(password || '', user && user.salt ? user.salt : DUMMY_SALT);
  const ok = !!(user && user.hash && timingSafeEqualStr(computed, user.hash));
  if (!ok) return setTimeout(() => res.status(401).json({ error: 'Invalid username or password.' }), 400);

  const token = sessions.createSession(dbConn.getConnection(), {
    username: user.username, role: user.role, ttlMs: SESSION_TTL_MS,
    userAgent: req.get('user-agent'), ip: req.ip,
  });
  const cookie = ['ma_session=' + token, 'Path=/', 'HttpOnly', 'SameSite=Strict', // D-08: Strict, was Lax
    'Max-Age=' + Math.floor(SESSION_TTL_MS / 1000)];
  if (process.env.ENABLE_HSTS === '1') cookie.push('Secure');
  res.setHeader('Set-Cookie', cookie.join('; '));
  res.json({ success: true, user: { username: user.username, name: user.name || user.username, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => {
  const token = readSessionCookie(req);
  if (token) sessions.deleteSession(dbConn.getConnection(), token); // D-07: logout deletes the row
  res.setHeader('Set-Cookie', 'ma_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ success: true });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Stateless HMAC-signed cookie (`ma_session=<payload>.<hmac>`), decoded and verified in-process, cannot be revoked before its 12h expiry | Opaque token in the cookie, hashed and looked up against a SQLite `sessions` table on every request | This phase (D-06) | Revocation becomes possible (logout, admin "revoke all for a user" — D-07); adds one indexed SQLite lookup per authenticated request (sub-millisecond per Phase 1's `STACK.md` benchmarking notes on `better-sqlite3`) |
| `PORTAL_AUTH=1` opt-in; default is fully open | Fail-closed by default; `DEMO_OPEN=1` opt-in keeps the showcase open | This phase (D-01/D-02) | Inverts every deployment assumption — launcher scripts must be updated to set the new flag, or the demo release bundles will start requiring login unexpectedly |
| `SameSite=Lax` session cookie | `SameSite=Strict` | This phase (D-08) | No functional impact for this app specifically — verified there is no cross-site entry point into the app (no email deep-links, no third-party embeds; CSP already sets `frame-ancestors 'self'`) that would rely on `Lax`'s "top-level GET navigation" carve-out. [ASSUMED — no cross-site inbound-link flow was found in this codebase, but this is a negative claim based on absence, not an exhaustive audit of every possible entry point; flag for user confirmation if any future integration (e.g., an email notification linking into a specific deal page) is planned.] |
| Any authenticated session (any role) can write to any of 59 non-admin routes | Coarse role gate: `admin`=all, `hrbp`/`pmo`=deal-ops (default), `employee`=explicit self-service allowlist only | This phase (D-04/D-05, AUTH-02) | Net-new restriction — no regression for `admin`/`hrbp`/`pmo` (their access is unchanged), but is the first time `employee` differs from the other three roles at all |

**Deprecated/outdated:**
- The `PORTAL_AUTH` env var name likely becomes vestigial once login is mandatory-by-default (there's no more "opt into login" — login is always on unless demo-open). Recommend the planner decide whether to keep `PORTAL_AUTH` as a no-op for backward compatibility with any existing deployment scripts, or retire it. Not locked in CONTEXT.md's decisions — flag for the plan.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `SameSite=Strict` has no negative UX impact on this app because there is no cross-site inbound-link flow (no email deep-links, no third-party embeds) that depends on `Lax`'s top-level-navigation carve-out | State of the Art table | If a future notification/email feature links directly into a specific deal page from an external mail client, `SameSite=Strict` would silently drop the session cookie on that first navigation, forcing an unexpected re-login — low severity (user just logs in again), but worth a UX note if email-linking is ever added |
| A2 | `PORTAL_AUTH` env var becomes vestigial and its fate (kept as no-op vs. retired) is undecided | State of the Art / Deprecated | Low risk either way — purely a naming/cleanup decision, not a security or functional gap |
| A3 | `ADMIN_TOKEN` should either be retired or given a synthetic stable identity for AUD-01 (Phase 3) attribution — not locked in CONTEXT.md's D-01..D-10 | Pitfall 4 | If left as-is (boolean-only, no identity), Phase 3's audit log will have unattributed writes for any ops-script use of `/api/admin/*` via token; low likelihood given these are two low-frequency ops endpoints, but a real gap against AUTH-04's "resolvable identity on every request" if ADMIN_TOKEN continues to authorize writes elsewhere |
| A4 | `employee`-role coarse-map enforcement is currently unreachable/untestable because no employee account exists in seed data, and provisioning one is out of this phase's scope (deferred user-CRUD) | Pitfall 5 | If the user actually expects real per-employee login this milestone, this is a scope gap that needs to surface during `/gsd-plan-phase`'s discussion, not silently be treated as "not applicable" |

**If this table is empty:** N/A — see above.

## Open Questions

1. **Should `ADMIN_TOKEN` (the shared-secret write gate) survive mandatory login, and if so, with what identity?**
   - What we know: `ADMIN_TOKEN` predates the login system, has no per-user identity, and today satisfies write access identically to any authenticated session on the 59 non-admin routes plus admin-only on `/api/admin/*`. CONTEXT.md's D-01 through D-10 never mention it.
   - What's unclear: Whether it's still needed for non-interactive ops flows (the two `/api/admin/*` endpoints), or should be retired now that login is mandatory.
   - Recommendation: Ask the user directly during planning; default to keeping it ONLY for `/api/admin/*` with a synthetic `{username:'admin-token', role:'admin'}` identity if kept at all (Pitfall 4).

2. **How should employee-initiated self-service writes (pulses, lesson completion, self-assessment) behave under the coarse role map given no employee accounts exist?**
   - What we know: Today these work with zero server-side identity check at all (client-side role selection only). AUTH-02's "employee = self-only" bucket has nothing to bind "self" to.
   - What's unclear: Whether this milestone actually needs real employee accounts (contradicting D-09's "full user-CRUD deferred"), or whether these routes should simply stay reachable by `admin`/`hrbp`/`pmo` acting on an employee's behalf (matching today's behavior) with `employee` as a forward-compatible but currently-unused allowed role.
   - Recommendation: Surface to the user in discuss-phase; Pitfall 5's "treat as unreachable-for-now" is the lowest-risk default that doesn't expand scope.

3. **Does `/api/auth/me` stay unauthenticated by design, or does its response payload need trimming under fail-closed?**
   - What we know: It's the mechanism the client uses to detect "am I logged in" without erroring — it must stay reachable without a session (verified: `login.html` calls it before any login attempt).
   - What's unclear: Nothing security-relevant — its response today (`{authEnabled, user: {username, name, role} | null}`) already reveals no sensitive data to an unauthenticated caller.
   - Recommendation: Keep it on the public allowlist exactly as today; no change needed beyond confirming it stays in `PUBLIC_API_PATHS`.

## Environment Availability

No new external tool, service, or runtime dependency is introduced by this phase.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js `crypto` module | Opaque token generation, hashing | ✓ | Node ≥20 built-in [VERIFIED: `package.json engines.node >=22`, installed `v22.18.0`] | — |
| `better-sqlite3` | `sessions` table storage | ✓ | 13.0.1, already committed to `node_modules` [VERIFIED: repo grep] | — |
| Node global `fetch` (for the AUTH-01 test's HTTP driver) | Route-inventory sweep test | ✓ | Stable since Node 18; confirmed present in installed v22.18.0 | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node's built-in `node:test` [VERIFIED: `package.json` `"test": "node --test"`, confirmed working via direct run — 9/9 passing across the 3 existing Phase 1 test files] |
| Config file | none — bare `node --test` auto-discovers `test/*.test.js` |
| Quick run command | `node --test test/auth-route-inventory.test.js` (or any single new file) |
| Full suite command | `node --test` (bare — **`node --test test/` does NOT work** on this project's Node v22.18.0, per the existing precedent comment in `test/concurrent-write.test.js`; always invoke bare) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Every registered `/api/*` route (GET included) rejects an unauthenticated request with 401, verified against a live-generated route inventory | integration | `node --test test/auth-route-inventory.test.js` | ❌ Wave 0 |
| AUTH-02 | A session with role `hrbp` (or `pmo`) is rejected (403) when calling a write route restricted to `admin` (e.g. `/api/admin/migrate-db`); a session with role `employee` is rejected on a non-self-service write | unit/integration | `node --test test/role-enforcement.test.js` | ❌ Wave 0 |
| AUTH-03 | A created session authorizes a request; after `deleteSession()` (logout) or `deleteAllSessionsForUser()` (admin revoke), the same token immediately 401s; an artificially-expired row (`expires_at` in the past) also 401s | unit | `node --test test/session-lifecycle.test.js` | ❌ Wave 0 |
| AUTH-04 | A request with a valid session has `req.portalUser.username` and `.role` populated and correct; an `isOpenMode(req)` request has `req.portalUser === null` (explicit, not undefined) | unit | covered inside `test/role-enforcement.test.js` or a small dedicated assertion in `session-lifecycle.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the specific new/changed test file for that task (e.g. `node --test test/session-lifecycle.test.js` after implementing the sessions table)
- **Per wave merge:** `node --test` (bare, full suite — currently 3 files/9 tests from Phase 1; Phase 2 adds 3 more files)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/auth-route-inventory.test.js` — covers AUTH-01; depends on the `module.exports = app` + `require.main === module` refactor (Pitfall 1) landing first
- [ ] `test/role-enforcement.test.js` — covers AUTH-02, AUTH-04
- [ ] `test/session-lifecycle.test.js` — covers AUTH-03, AUTH-04
- [ ] Framework install: none — `node:test` is built-in, already proven working in this repo

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | yes | `crypto.scryptSync` password hashing (unchanged, already correct per Phase 1's `STACK.md`), constant-time credential comparison (`timingSafeEqualStr`, already present), login throttle (already present, kept per D-09/canonical refs), fail-closed default (D-01, new this phase) |
| V3 Session Management | yes | Opaque, high-entropy (256-bit) session tokens stored hashed server-side (Pattern 2), absolute 12h expiry (D-07), server-side revocation via a real table (D-06/D-07), `HttpOnly`+`SameSite=Strict`+`Secure`-when-HSTS cookie attributes (D-08) — directly maps to OWASP's Session Management Cheat Sheet guidance on hashed-at-rest tokens and server-enforced absolute timeouts [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html] |
| V4 Access Control | yes | Coarse role→resource-group map enforced server-side in a single consolidated middleware (Pattern 3), never trusting client-supplied role claims — role comes only from the server-side session lookup, never from a request header or body field |
| V5 Input Validation | partial — out of scope this phase (VAL-01/02 are Phase 3) | Not addressed here beyond what already exists; do not expand scope |
| V6 Cryptography | yes | `crypto.randomBytes(32)` for session tokens (CSPRNG, adequate entropy), SHA-256 for token-at-rest hashing (Pattern 2), `scrypt` for passwords (unchanged) — no custom crypto primitives introduced |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Session fixation / token theft via DB exfiltration | Information Disclosure | Hash session tokens at rest (Pattern 2) — a leaked `sessions` table row cannot be replayed directly; only the raw cookie value (never persisted) authorizes |
| CSRF on state-changing `/api` writes via a cookie-authenticated session | Spoofing / Tampering | `SameSite=Strict` (D-08) + this app's existing no-CORS posture (a cross-origin `fetch()` with `Content-Type: application/json` fails the browser's CORS preflight before reaching the server, since no `Access-Control-Allow-Origin` header is ever set [VERIFIED: codebase grep — zero `cors`/`Access-Control` references in `server.js`]) + an optional `Sec-Fetch-Site` header check on writes (`reject if present and === 'cross-site'`, OWASP-endorsed [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html], with fallback-to-Origin-header for the small percentage of non-Fetch-Metadata-sending clients — do not fail open on absence) |
| Privilege escalation via role tampering | Elevation of Privilege | Role is read exclusively from the server-side session lookup (`req.portalUser.role`, resolved from the `sessions` table row), never trusted from a client-supplied header/cookie field/body value |
| Timing attack on session token / password comparison | Information Disclosure | Reuse the app's existing `timingSafeEqualStr()` (SHA-256-then-`crypto.timingSafeEqual`) pattern for any new token comparison, exactly as already done for `X-Admin-Token` and password hashes |
| Demo-open flag accidentally set on a real-deal deployment | Information Disclosure (the exact MNPI-leak scenario this milestone exists to prevent) | D-03 forward-compat note: Phase 2's `isOpenMode()` seam must be structured so Phase 3 can AND it with `req.isDemo` from the deal-resolver — this phase alone cannot fully close this risk (no per-database distinction exists yet), but must not foreclose Phase 3's ability to close it |

## Sources

### Primary (HIGH confidence)
- `/Users/karstenhaldan/M&A/server.js` (lines 1–260, 1770–1850, 3042) — direct read, current auth/session/gate implementation and route registrations
- `/Users/karstenhaldan/M&A/db/store.js`, `db/schema.sql`, `db/collections.js` — direct read, Phase 1's SQLite persistence patterns
- `/Users/karstenhaldan/M&A/public/js/transitions.js` (lines 1–36, 150–178) — direct read, client-side auth bridge and `/api/auth/me` probe
- `/Users/karstenhaldan/M&A/public/login.html`, `db.json` (`users` array) — direct read, seeded accounts and login page's own `/api` dependencies
- `/Users/karstenhaldan/M&A/start.bat`, `start.command` — direct read, demo launcher env-var propagation
- Live `node -e` introspection of `app._router.stack` against this repo's actually-installed `express@4.22.2` — empirically verified, not training-data recall
- `node --test` run against this repo's existing 3 test files (9/9 passing) — empirically verified test framework behavior
- `/Users/karstenhaldan/M&A/.planning/research/STACK.md`, `ARCHITECTURE.md`, `.planning/codebase/CONCERNS.md` — prior-phase research, internal source of truth

### Secondary (MEDIUM confidence)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) — server-side revocation, absolute timeout, hashed-token-at-rest guidance
- [OWASP Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) — Fetch Metadata (`Sec-Fetch-Site`) as an OWASP-endorsed CSRF mitigation with Origin-header fallback
- [MDN: Sec-Fetch-Site header](https://developer.mozilla.org/docs/Web/HTTP/Headers/Sec-Fetch-Site) — header semantics reference

### Tertiary (LOW confidence)
- None — every claim in this document is either a direct codebase read, a live empirical tool run, or a cited official source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, every mechanism verified against installed versions/built-ins
- Architecture: HIGH — consolidated gate and role-map design are direct extensions of code read in this session, cross-checked against `ARCHITECTURE.md`'s Phase F1 slot
- Pitfalls: HIGH — all 6 pitfalls are grounded in specific grep/read findings in this exact codebase, not generic auth-migration folklore

**Research date:** 2026-07-24
**Valid until:** 30 days (stable domain — no fast-moving external dependency; re-verify if `express` or `better-sqlite3` versions change, or if Phase 3's deal-resolver design shifts the `isOpenMode()` contract)
