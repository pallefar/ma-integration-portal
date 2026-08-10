# Phase 2: Mandatory Auth & Roles - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Make authentication mandatory (not opt-in behind an env var), enforce the caller's role on every write, and make sessions revocable + expiring via a `sessions` table in SQLite. This is a PROMOTE-AND-HARDEN phase, not a greenfield auth build: a real login already exists (`PORTAL_AUTH=1` — scrypt hashing, HMAC-signed session cookie with TTL, login throttle, three seeded roles) and is sound; the work is enforcement, a real session store, coarse role gating, and safe defaults.

**In scope:** AUTH-01 (auth mandatory on every `/api/*` endpoint incl. reads), AUTH-02 (every write enforces role), AUTH-03 (revocable + expiring sessions via a `sessions` table; scrypt hashes; `SameSite` tightening), AUTH-04 (identity + role resolvable server-side on every request).

**Explicitly NOT this phase:** per-workstream / field-level clean-room access control is **Phase 4** (keep roles coarse); the demo/real *data* file-per-deal split is **Phase 3**; full user-CRUD admin UI is deferred; audit logging of auth events is **Phase 3** (AUD-01/02) — but Phase 2 must expose a stable session identity Phase 3 can record.
</domain>

<decisions>
## Implementation Decisions

### Mandatory vs open demo (the central reconciliation)
- **D-01:** Auth is **fail-closed by default** — inverts today's "open unless `PORTAL_AUTH=1`". With no explicit demo-open signal, every `/api/*` endpoint (reads included) requires a valid session. This is the MNPI-safe default: unauthorized *read* is the compliance event, so an operator can never accidentally serve real deal data open. — **Reversibility:** costly — inverting the default touches the gate middleware and every deployment/launcher assumption; the demo bundles must opt into open mode.
- **D-02:** The demo showcase runs in an **explicit demo-open mode** (a clear env flag / setting, e.g. `DEMO_OPEN=1` or the existing demo-mode signal) that keeps `:3000` open and frictionless. Default (flag unset) = auth mandatory. The demo release bundles/launchers set this flag; real-deal deployments never do.
- **D-03:** Forward-compatibility with Phase 3: the demo-open decision must be structured so Phase 3's deal-resolver can bind it to data — **a real-deal database is ALWAYS auth-required; only `demo.db` may honor demo-open.** Phase 2 implements the flag; Phase 3 ties it to the resolved database. Do not hard-code assumptions that block that.

### Role model granularity (AUTH-02)
- **D-04:** Coarse **role → resource-group capability map**, enforced by ONE middleware on every write endpoint. Roles = the existing `admin`, `hrbp` (Integration Leader), `pmo`, `employee`. Coarse mapping: admin = all; IL/pmo = deal-operations writes; employee = self-only. Per-workstream and field-level clean-room rules are **deferred to Phase 4** — do NOT build per-resource fine-grained permissions now (would be built twice). — **Reversibility:** reversible — the coarse map is additive; Phase 4 refines it.
- **D-05:** "Every write endpoint enforces role" is satisfied by routing all writes through the single capability check (not by hand-annotating ~90 endpoints). Reads are gated for authentication (D-01) but coarse role-filtering of read *payloads* (which records a role may see) is Phase 4 clean-room territory, except where an endpoint already hands back admin-only data (preserve today's `lockedDown()`/`isAdminRequest()` guards).

### Session revocation model (AUTH-03)
- **D-06:** Replace the stateless HMAC-signed cookie with an **opaque token → row in a SQLite `sessions` table** (id/token, username, role, created, expires, optional user-agent/ip). Today's cookie expires but cannot be revoked; a table makes revocation real now that Phase 1 gave us SQLite. — **Reversibility:** costly — changes the session representation and the cookie contract; every request now does a sessions-table lookup.
- **D-07:** Revocation scope = **logout deletes the session row + an admin action "revoke all sessions for a user"** (offboarding). Absolute expiry — keep the existing 12h TTL, no sliding/refresh this phase. Per-device session list = deferred (adds UI scope).
- **D-08:** Tighten the session cookie: `HttpOnly` (already), `SameSite=Strict` (was `Lax`), `Secure` when HSTS/TLS. This addresses the CSRF exposure of cookie-based state-changing requests (research-flagged) and the CONCERNS.md "admin token in localStorage" note — sessions move fully to the HttpOnly cookie, not localStorage.

### Account management scope
- **D-09:** Scope = **login (existing) + logged-in user can change their own password + a first-run/env mechanism to set the REAL admin password** so real-deal mode never ships with the publicly-known demo password (`TEdemo!2026`). Full user-CRUD admin UI = **deferred**. — **Reversibility:** reversible.
- **D-10:** The seeded demo accounts (admin/karen/pmo with the known demo password) stay for demo mode; real-deal mode requires the first-run admin secret to be set (fail-closed if a real deployment still has the demo password — warn loudly at minimum).

### Resolved after research (2026-07-24, from 02-RESEARCH.md open questions)
- **D-11:** `ADMIN_TOKEN` write-bypass SURVIVES mandatory login but as an **attributed break-glass identity** — treat `X-Admin-Token` requests as a distinct, logged identity (e.g. `admin-token`/automation), not an anonymous bypass, so Phase 3's audit log can attribute its actions. Preserves existing admin/CI tooling while making it accountable.
- **D-12:** Implement the `employee = self-only` capability rule AND **seed one demo employee account** so AUTH-02's non-admin role-rejection path is actually testable (the role-enforcement test needs a non-admin subject). Minimal demo-data change.
- Also from research (builder must cover, not user decisions): (a) the client `fetch()` wrapper (public/js/transitions.js) currently handles 401 only on WRITES — under fail-closed GET-gating it MUST handle 401 on reads too (redirect to /login.html) or pages silently blank; (b) `/api/auth/me` stays public by design (confirmed); (c) AUTH-01 route inventory needs the prerequisite refactor: `server.js` must `module.exports = app` and guard `app.listen()` behind `require.main === module` (today it binds unconditionally with no exports).

### Claude's Discretion (builder/researcher decides)
- The `sessions` table schema and indexing; opaque-token generation (crypto.randomBytes) and lookup.
- Consolidating the TWO overlapping `/api` gate middlewares (server.js ~148 write/admin gate + ~174 session gate) into one coherent gate — currently redundant.
- CSRF specifics beyond `SameSite=Strict` (double-submit token? origin check?) — research to recommend; Strict is the baseline.
- Exact demo-open flag name and how the demo launchers/bundles set it.
- Whether `req.portalUser`/`isAdminRequest()`/`lockedDown()` are refactored or extended; preserve their call sites' behavior.
- How the first-run admin secret is delivered (env var vs forced-change-on-first-login).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The existing auth implementation (promote/harden, don't rebuild)
- `server.js` §auth (lines ~94-242) — `ADMIN_TOKEN` gate, `PORTAL_AUTH` login, `makeSessionToken`/`readSession` (HMAC signed cookie), `hashPassword` (scrypt), the TWO `app.use('/api', ...)` gates (~148 write/admin, ~174 session), `lockedDown()`, `isAdminRequest()`, login throttle, `/api/auth/login|logout|me`.
- `db/store.js` — Phase 1 SQLite store; the `sessions` table is added to `db/schema.sql` + `db/collections.js`. Note: `users` items are keyed by `username` (no `id`) per `idOf()`.
- `db/schema.sql`, `db/collections.js` — where the `sessions` table/collection is registered (38-key inventory pattern).

### Project + milestone context
- `.planning/PROJECT.md` — MNPI constraint (mandatory auth is a legal control, not a feature), demo/real separation requirement, key decisions (promote PORTAL_AUTH not rebuild).
- `.planning/REQUIREMENTS.md` — AUTH-01..04 exact wording.
- `.planning/ROADMAP.md` §"Phase 2" — goal + success criteria.
- `.planning/research/STACK.md` — auth-hardening notes (scrypt sound; gaps = role-enforcement middleware, session revocability via a sessions table, SameSite=Strict).
- `.planning/research/ARCHITECTURE.md` — the bounded `RESOURCE_POLICY` middleware idea (Phase 2 lays the coarse version; Phase 4 refines to clean-room).
- `.planning/codebase/CONCERNS.md` — "Admin token in localStorage" + "No user sessions/multi-user awareness" (this phase closes both).
- `.planning/phases/01-schema-migration/01-CONTEXT.md` — the demo/real-separation decisions this phase's mode flag must stay forward-compatible with.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `hashPassword(pw, saltHex)` — scrypt, keep as-is (server.js ~138).
- `readSession(req)` / `makeSessionToken(user)` — HMAC cookie; **replace** with opaque-token + sessions-table lookup (D-06), keeping the `{username, role}` return shape so `req.portalUser` consumers don't change.
- The `/api/auth/login|logout|me` endpoints (server.js ~208-242) — extend: login creates a session row; logout deletes it; add self password-change.
- Login throttle `_loginAttempts` (~198) + `DUMMY_SALT` constant-time login (~206-222) — sound, keep.
- `isAdminRequest()` / `lockedDown()` (~185-194) — keep semantics; extend for the coarse role map.

### Established Patterns
- The whole-object `readDb()`/writeDb()` + the new `__snapshot` merge (Phase 1) — a `sessions` collection either rides this or (better for churn) gets its own small direct-SQL helpers in `db/store.js`; discretion.
- Two overlapping `/api` middlewares gate writes/admin then sessions — consolidate into one gate (D-04/D-05).
- `res.json(db)` serializes the whole read-model to clients — the `__snapshot` is already non-enumerable (Phase 1) so it won't leak; keep any new session internals non-serialized too.

### Integration Points
- `public/js/transitions.js` — the client fetch bridge sends `X-Admin-Token`; login redirects to `/login.html`. Client must handle the now-mandatory 401 → redirect-to-login flow in default (non-demo) mode.
- `public/login.html` — existing login page with click-to-fill demo accounts; keep for demo mode.
- Demo release bundles / `start.bat`/`start.command` — must set the demo-open flag so the showcase stays open under the new fail-closed default.
</code_context>

<specifics>
## Specific Ideas

- Real-deal mode must fail closed: with no demo-open flag AND no valid session, every `/api/*` (read or write) returns 401 — verified against a full, programmatically-generated route inventory (AUTH-01's success criterion).
- Do not ship real-deal mode on the known demo password — first-run admin secret required (D-09/D-10).
- Sessions carry a stable identity (username + session id) that Phase 3's audit log will record.
</specifics>

<deferred>
## Deferred Ideas

- Per-workstream / field-level clean-room read filtering — Phase 4 (DD-04, clean-room).
- Auth-event audit logging (login/logout/revoke/failed-attempt) — Phase 3 (AUD-01/02); Phase 2 just exposes the session identity.
- Full user-CRUD admin UI (create/edit/delete/assign-role) — later slice.
- Per-device session list + individual revoke + sliding expiry — later (D-07).
- TE SSO (SAML/OIDC) — v2 HOST-03, explicitly out of milestone.

</deferred>

---

*Phase: 2-Mandatory Auth & Roles*
*Context gathered: 2026-07-24*
