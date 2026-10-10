---
phase: 10-accounts-identity
reviewed: 2026-10-10T00:00:00Z
depth: deep
files_reviewed: 12
files_reviewed_list:
  - server.js
  - lib/credentialLockdown.js
  - lib/loginThrottle.js
  - lib/passwords.js
  - validators/users.js
  - db/controlStore.js
  - db/realDataDir.js
  - scripts/bootstrap-admin.js
  - scripts/set-admin-password.js
  - public/login.html
  - public/change-password.html
  - public/js/login.js
findings:
  critical: 1
  warning: 2
  info: 3
  total: 6
resolution:
  fixed: 5
  resolved_by_rationale: 1
  open: 0
fixed_at: 2026-10-10
status: clean
---

> **Resolution (2026-10-10, gsd-code-fixer):** all 6 findings closed — 5 fixed with
> a proving test, 1 (IN-03) resolved by rationale. Suite 1038 → 1055, all green at
> every commit. Per-finding `status:` lines below.

# Phase 10: Code Review Report

**Reviewed:** 2026-10-10
**Depth:** deep (security-first; range `943fe2f..HEAD`)
**Files Reviewed:** 12 of 28 in scope
**Status:** clean (was issues_found; all findings resolved 2026-10-10 — see per-finding status)

## Summary

Reviewed the credential core (lib/passwords.js, lib/loginThrottle.js, lib/credentialLockdown.js), the auth/admin-user routes and the consolidated `/api` gate in server.js, validators/users.js, the guarded account writes in db/controlStore.js, the real-data-dir seeding, both CLI scripts and the login/change-password pages. The scrypt format, strict parameter bounds, timing-safe compare, dummy-hash equalisation, zod mass-assignment stripping, BEGIN IMMEDIATE last-admin guard, session revocation on reset/disable, argv-free CLI secrets, lockdown-before-body-parser ordering and textContent-only DOM are all sound.

One CRITICAL authorization bypass was found by call-chain tracing: Express routes are matched case-insensitively while the gate's admin-prefix check is case-sensitive, so a non-admin session can read `/api/Admin/users`. Two WARNINGs concern enumeration (admin-role leak via Retry-After) and the lazy-rehash rule.

**Coverage limit:** context budget ran out before reading public/js/account-menu.js (sessions UI), public/js/admin.js Users tab, deal-switcher.js, transitions.js redirect logic, the launchers and docs. Those files are NOT cleared by this review; items touching them are marked SUSPECTED.

## Critical Issues

### CR-01: Case-variant path bypasses the admin-prefix role check on `/api/admin/*` reads

**File:** `server.js:401-403` (pathMatchesPrefix), `server.js:771-774` (gate), `server.js:1255-1267` (GET /api/admin/users has no inline role check)
**Issue:** Express routing is case-insensitive by default (`app.set('case sensitive routing')` is never called), so `GET /api/Admin/users` is dispatched to `app.get('/api/admin/users')`. The consolidated gate reconstructs `fullPath = req.baseUrl + req.path`, which preserves the client's case, and `pathMatchesPrefix(fullPath, '/api/admin')` does a case-sensitive `startsWith`. For a GET, `requiresRoleCheck = isWrite || pathMatchesPrefix(...)` is therefore **false**, the role check is skipped, and the handler (which trusts the gate entirely) returns every account: username, name, role, disabled, lastLoginAt.
**Failure scenario:** Any authenticated `employee`/`pmo`/`hrbp` session on a real-deal host sends `GET /api/Admin/users` → 200 with the full account roster (who the admins are, who last logged in) — exactly the CR-02 class this phase claimed to close. The same case-trick very likely reaches `GET /api/Admin/download-zip` and any other admin GET. SUSPECTED (not traced): `isDemoOnlyPath(fullPath)` and `ROLE_WRITE_POLICY` prefix matching share the root cause, so `/api/Admin/...` writes may also fall through to whatever `roleAllowedForWrite` returns when no policy matches.
**Verification:** static call-chain trace; live probe not executed (budget). Repro: `curl -b ma_session=<employee> http://localhost:3000/api/Admin/users`.
**Fix:**
```js
// server.js, before any route is registered:
app.set('case sensitive routing', true);   // unknown-case paths now 404
// AND defence in depth in the gate:
const fullPath = (req.baseUrl + req.path).toLowerCase();
// AND an inline guard on every /api/admin/users* handler:
if (!isAdminRequest(req)) return res.status(403).json({ error: 'Admin only.' });
```
Add a regression test: non-admin `GET /api/Admin/users`, `/API/admin/users`, `/api/admin/Users` all → 403/404.

**status: fixed** — `d33a8fb`. `app.set('case sensitive routing', true)` before the first
middleware; new `lib/requestPath.js#pathForms()` returns every canonical spelling (raw +
once-decoded, `//` collapsed, trailing slash stripped, each as-is + lowercased; dot segments /
bad escapes / backslash refused). The consolidated gate (`gatePolicy`), `db/resolver.js`'s
control-plane (never-open) list and the credential-lockdown allowlist all take the most
restrictive answer across forms (closing, beyond the review, a trailing-slash
`/api/admin/download-zip/` DEMO_OPEN bypass via the resolver and exact-match
`DEMO_ONLY_PREFIXES` trailing-slash misses). Non-canonical mount spellings (`/API`, `//api`,
`%61pi`) answer JSON 404. Inline `isAdminRequest` re-check on all five `/api/admin/users*`
handlers. `strict routing` deliberately left off (trailing slash is normalised instead; avoids
breaking id-concatenated client URLs). Test: `test/path-canonical-gate.test.js` (8 tests) loops
over `ROLE_WRITE_POLICY`, `DEMO_ONLY_PREFIXES`, `MUST_CHANGE_ALLOWED_PATHS`,
`CONTROL_PLANE_PATHS`, `LOCKDOWN_STATIC_ALLOWLIST` and every registered `GET /api/admin*`
route × variants (case, `//`, `%2F`, encoded letter, trailing slash, GET+HEAD) × admin /
hrbp / pmo / employee / anonymous.

## Warnings

### WR-01: Retry-After discloses which usernames are enabled admins

**File:** `server.js:830-848` (throttleOptionsFor / ADMIN_MAX_BACKOFF_MS=5 min vs THROTTLE_WINDOW_MS=15 min), `server.js:862-866` (sendThrottled), `server.js:911`
**Issue:** The account-keyed backoff ceiling is 5 min for an enabled admin and 15 min for everyone else (unknown, disabled, non-admin). After ~10 failures the computed delay hits the ceiling, so `Retry-After: 300` vs `Retry-After: 900` tells an attacker, per username, "this is a live admin account" — contradicting T-10-30 ("throttled answer identical whether the name exists or not"). The body is identical; the header is not.
**Fix:** Return the same Retry-After regardless of role (e.g. always report the non-admin ceiling, or report `min(retryAfter, 60)` as a UX hint) while still *enforcing* the role-specific delay server-side; or drop the role split and recover locked admins via the documented restart path only.

**status: fixed** — `a1553a7`. Masking only the header would leave the second channel (the
moment the 429 lifts: 300 s vs 900 s), so the ceiling itself is uniform: every account name
backs off to at most 5 minutes (T-10-55's admin-unlock goal kept); `throttleOptionsFor()`
ignores the account. DEPLOYMENT.md + `lib/loginThrottle.js` recovery text updated. Tests:
`test/login-throttle.test.js` — identical options for every account shape; HTTP sequence for
`admin` vs an unknown name identical in status, body and Retry-After.

### WR-02: Lazy rehash fires on any parameter difference, including stronger-than-current (cost downgrade)

**File:** `lib/passwords.js:104` (`needsRehash = n !== N || r !== r || p !== p`), `server.js:942-960`
**Issue:** A hash stored with N=262144 (e.g. produced by a future bump then a rollback, or a hand-tuned host) is reported `needsRehash:true` and rewritten at N=131072 on next login — a silent downgrade. The intent "no downgrade" is not enforced. Also note: legacy bare-hex accounts (N=16384) verify ~8x faster than `dummyVerify` (N=131072), so until their first successful login their *existence* is timing-distinguishable; acceptable for dev/demo (real mode locks such copies down) but worth a comment.
**Fix:** `needsRehash = parsed.n < N || parsed.r < r || parsed.p < p || format === 'legacy'`.

**status: fixed** — `ab5e62f`. `isWeakerThanCurrent()`: rehash only when some dimension is
below `CURRENT_PARAMS` and none is above (a mixed hash is kept — rewriting it would lower a
dimension); legacy always rehashes; the legacy-timing note is recorded in the code. Test:
`test/bootstrap-admin.test.js` (WR-02) — predicate for stronger N/r, end-to-end verify for
stronger p, mixed, weaker N, weaker r (async + sync). Side observation, not changed:
`boundsOk()` admits N·r exactly at the 256 MiB ceiling (e.g. N=262144,r=8) which Node's
scrypt then refuses — a future cost bump must raise `MAXMEM` with it.

## Info

### IN-01: Sessions list `current` flag compares a stored token hash with `req.portalUser.sessionId`
**File:** `server.js:1131-1140`
**Issue:** `r.tokenHash === req.portalUser.sessionId` implies `sessionId` *is* the token hash. The list returns `id: r.id` (good) — confirm `publicSession` never includes `tokenHash`, and that `endOwnSession` keys on `id` scoped by username (it does take both). SUSPECTED only; account-menu.js not reviewed.

**status: fixed** — `a501727`. Confirmed no defect (`findSession()` reports the token hash as
`sessionId`; only the derived public id is serialised; `endOwnSession` is username-scoped).
Invariant comment added at the comparison; `test/self-sessions.test.js` IN-01 pins
`sessionId === hashToken(token)`, `id === publicSessionId(hash) !== hash`, and the HTTP list
exposing `{id, current:true}` without `tokenHash`.

### IN-02: Failure path adds a fixed 400 ms delay but success path does not
**File:** `server.js:928`
**Issue:** Harmless (success is observable anyway) but the delay is additive, not an equaliser; the real equaliser is `dummyVerify`. Consider removing to avoid implying a timing guarantee it does not provide.

**status: fixed** — `0e511d9`. Delay removed; comment names the real equaliser (dummyVerify)
and the rate limit (throttle). Test: `test/login-throttle.test.js` IN-02 (no `setTimeout` in
the login handler, direct 401, `dummyVerify` retained).

### IN-03: Lockdown allowlist omits `/css/account.css` and `/js/transitions.js`
**File:** `lib/credentialLockdown.js:32-40`
**Issue:** Verified login.html and change-password.html reference only allowlisted assets (`style.css`, `favicon.ico`, `te-logo.png`, own JS) — correct today. The 10-09 cross-check test must stay mandatory; any future `<link>` added to either page silently breaks the locked host's login page.

**status: resolved-by-rationale** — no code change needed. The finding's own requirement is
already met: `test/lockdown-asset-allowlist.test.js` reads the single
`LOCKDOWN_STATIC_ALLOWLIST` source and both shipped pages (plus the stylesheets they link) and
fails on drift in either direction; it is part of the default `node --test` run, so it gates
every commit. Adding `account.css`/`transitions.js` to the allowlist would widen the locked
surface for assets neither page loads. (CR-01's `d33a8fb` additionally made the allowlist match
the exact canonical spelling only.)

---

_Reviewed: 2026-10-10_
_Reviewer: Claude (gsd-code-reviewer, Fable 5.1)_
_Depth: deep — partial coverage, see Summary_
