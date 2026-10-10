---
phase: 10-accounts-identity
plan: 05
subsystem: auth
tags: [forced-rotation, login-throttle, secure-cookie, hsts, lazy-rehash, credential-lockdown, mnpi]

requires:
  - phase: 10-accounts-identity
    provides: "10-01: lib/passwords.js (verifyPassword -> {ok, needsRehash}, KNOWN_DEMO_PASSWORDS, checkNewPassword), dbFiles.IS_REAL_MODE / isCommittedControlDbActive, ensureRealDataDir; 10-03: req.portalUser.mustChangePassword via resolveSessionIdentity, user routes, publicAccount"
  - phase: 08-concurrency-storage-foundation
    provides: "isBusyError guard + central 503 middleware"
provides:
  - "403 {mustChangePassword:true} fence: a must-change session can use only /api/auth/me, /logout, /change-password"
  - "lib/loginThrottle.js: sliding-window + exponential-backoff + bounded-map throttle with per-call ceiling"
  - "per-account ('u:'/'cp:') + per-source ('ip:') sign-in throttling; identical generic 429 + Retry-After; admin backoff capped at 5 min"
  - "sessionCookieHeader / clearedSessionCookieHeader / isSecureCookieContext (Secure independent of ENABLE_HSTS)"
  - "HSTS max-age=31536000, includeSubDomains only with HSTS_INCLUDE_SUBDOMAINS=1; shared-source TRUST_PROXY warning; truthful ADMIN_TOKEN warning"
  - "lazy rehash of legacy hashes to scrypt N=2^17 on successful sign-in (never against the committed control.db)"
  - "lib/credentialLockdown.js: frozen LOCKDOWN_STATIC_ALLOWLIST (single source), boot scan, login-time detection, 403 middleware"
affects: [10-06, 10-08, 10-09, phase-11, phase-22]

actuals:
  tokens: 22400
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "one throttle module, two instances (account vs source), per-call ceiling instead of a third instance"
    - "lockdown allowlist is one exported frozen constant that both the middleware and the cross-check test read"
    - "boot-time behaviours (warnings, lockdown banner) are proven with child processes or a console.warn capture around require"

key-files:
  created:
    - lib/loginThrottle.js
    - lib/credentialLockdown.js
    - test/forced-rotation.test.js
    - test/login-throttle.test.js
    - test/auth-transport.test.js
    - test/password-rehash.test.js
    - test/credential-lockdown.test.js
  modified:
    - server.js
    - test/user-admin.test.js

key-decisions:
  - "Lockdown answers 403 (never 503) so the client's silent busy-retry never engages; it is mounted BEFORE the body parsers so a locked host does not parse 50 MB bodies"
  - "Login looks the account up BEFORE the throttle check (a PK read, no scrypt) only so the account key can carry the admin 5-minute ceiling; unknown/disabled/other roles get the default"
  - "A correct password clears only the account key; the source window keeps sliding"
  - "Shared-source warning has one once-per-process flag shared by the boot and the runtime trigger, so an https PUBLIC_BASE_URL plus forwarded headers still logs exactly one line"
  - "Submitted account names in the backoff log line are sanitised (printable ASCII, 80 chars) so a client cannot forge log structure"

patterns-established:
  - "Every session Set-Cookie goes through sessionCookieHeader()/clearedSessionCookieHeader(); the clearing cookie repeats Secure so it matches the cookie it clears"
  - "Fence + gate ordering in the /api gate: 401 -> mustChangePassword 403 -> demo-only -> role"

requirements-completed: [ACCT-04, ACCT-05, ACCT-07]

coverage:
  - id: D1
    description: "Forced rotation (PRD acceptance 2): a temp/reset-password session is fenced to me/logout/change-password with 403 {mustChangePassword:true} until it rotates; the fresh session works"
    requirement: ACCT-04
    verification:
      - kind: integration
        ref: "test/forced-rotation.test.js"
        status: pass
    human_judgment: false
  - id: D2
    description: "Per-account/per-source throttle (PRD acceptance 4): alice x9 does not block bob; correct password while locked is 429; unknown name indistinguishable; identical 429 body with Retry-After; bounded map; admin ceiling 5 min"
    requirement: ACCT-05
    verification:
      - kind: unit
        ref: "test/login-throttle.test.js (lib on a fake clock, throttleOptionsFor)"
        status: pass
      - kind: integration
        ref: "test/login-throttle.test.js (HTTP alice/bob/ghost)"
        status: pass
      - kind: integration
        ref: "test/role-enforcement.test.js WR-02"
        status: pass
    human_judgment: false
  - id: D3
    description: "Transport: Secure cookie under TRUST_PROXY + X-Forwarded-Proto https and https PUBLIC_BASE_URL independent of ENABLE_HSTS; HSTS without includeSubDomains unless opted in; shared-source and ADMIN_TOKEN warnings"
    requirement: ACCT-05
    verification:
      - kind: integration
        ref: "test/auth-transport.test.js"
        status: pass
    human_judgment: false
  - id: D4
    description: "Lazy rehash: legacy hash -> N=131072 + salt null on successful sign-in, never on failure, never against the committed control.db; new/reset/changed/bootstrap hashes are N=131072"
    requirement: ACCT-04
    verification:
      - kind: integration
        ref: "test/password-rehash.test.js"
        status: pass
    human_judgment: false
  - id: D5
    description: "Demo-credential lockdown (PRD acceptance 3): hand-copied committed control.db in real mode serves only login assets, /api/auth/*, /healthz; banner; lifts only after all four demo accounts rotate; dev mode never locked; committed files unchanged"
    requirement: ACCT-07
    verification:
      - kind: integration
        ref: "test/credential-lockdown.test.js"
        status: pass
    human_judgment: false

duration: 70min
completed: 2026-10-10
status: complete
---

# Phase 10 Plan 05: Authentication hardening and demo-credential lockdown Summary

**Temporary passwords are server-fenced to one route until rotated, sign-in throttling is per account and per source (admin backoff capped at 5 minutes), the session cookie is Secure whenever the request or PUBLIC_BASE_URL is https, legacy hashes are lazily upgraded to scrypt N=2^17, and a real-mode host booted on a hand-copied committed control.db serves nothing but the login page until every published demo password has been changed.**

## Performance

- **Duration:** ~70 min
- **Completed:** 2026-10-10
- **Tasks:** 3 (1 tracer + 2 auto/tdd)
- **Files:** 9 (7 created, 2 modified); 1566 insertions, 40 deletions
- **Suite:** 945 base -> 982 tests, 0 failures, 2 consecutive full runs green; `git status --porcelain data/` empty

## Accomplishments

- **Forced rotation (D-10-05, T-10-27):** in the consolidated `/api` gate, immediately after the 401 and before the demo-only and role checks, a session whose account carries `mustChangePassword` receives `403 {error, mustChangePassword:true}` for every path except `/api/auth/change-password` (`MUST_CHANGE_ALLOWED_PATHS`). `/me`, `/logout`, `/login`, `/mode` are public paths that never reach the gate. The open-mode branch above stays first. Proven with create -> temp login -> fenced `/api/raid` + `/api/auth/sessions` + POST -> `/me` 200 with the flag -> logout -> rotate -> fresh cookie unfenced, old cookie 401.
- **Throttle (D-10-06, T-10-28..31, T-10-55):** `lib/loginThrottle.js` (`createThrottle`) replaces the per-IP `_loginAttempts` map and `loginThrottled()` (both deleted). `accountThrottle` (5 free failures, 1 s doubling to 15 min) is keyed on the submitted name, `sourceThrottle` (50 free failures) on `req.ip`; both are consulted before any scrypt work; one 429 body for known, unknown and disabled names with a `Retry-After`. Change-password keeps its own `cp:<user>` key, so WR-02's 9th-attempt-429 still holds. Map bounded at 10,000 entries with pruning. `throttleOptionsFor` gives enabled admin accounts a 5-minute ceiling; entering backoff logs one `[security] sign-in backoff engaged for <key> from <ip>` per episode.
- **Transport (D-10-06, T-10-32):** `isSecureCookieContext` / `sessionCookieHeader` / `clearedSessionCookieHeader` are the only producers of `Set-Cookie` (login, change-password re-issue, logout, DELETE own current session). HSTS is `max-age=31536000`, plus `; includeSubDomains` only under `HSTS_INCLUDE_SUBDOMAINS=1`. Boot and first-forwarded-request `[security]` warning when an https `PUBLIC_BASE_URL` or forwarded headers appear with `TRUST_PROXY` unset. The false "API endpoints are OPEN" ADMIN_TOKEN warning is gone; a truthful one is logged only when the token is set (and never contains it).
- **Lazy rehash (D-10-05, T-10-36):** after a successful verify with `needsRehash` and `!isCommittedControlDbActive()`, the hash is replaced with the current format (`salt: null`) before the session is created; busy -> central 503, any other error -> logged without secrets and sign-in continues.
- **Lockdown (D-10-08b, T-10-34/35):** `lib/credentialLockdown.js` exports the frozen `LOCKDOWN_STATIC_ALLOWLIST` (seven names, one source), `createLockdown`, `lockdownMiddleware`. In real mode `server.js` scans `controlStore.listUsers()` synchronously at boot (enabled accounts verified against `KNOWN_DEMO_PASSWORDS`), logs one `[security] CREDENTIAL LOCKDOWN` banner naming the offenders, and mounts the middleware before the body parsers, `/` and `express.static`. A login with a published password adds the account and forces `mustChangePassword`; change-password removes it; the lockdown lifts when the set is empty. Locked answers are 403: JSON `{credentialLockdown:true}` for `/api/*`, a fixed HTML page otherwise.

## Task Commits

1. **Task 1 (tracer): forced rotation gate** - `b4ff1ce`
2. **Task 2: throttle, Secure cookie, HSTS, warnings, lazy rehash** - `0995320`
3. **Task 3: demo-credential lockdown** - `d0cbc40`

## Tracer feedback gate

After the tracer commit the full suite (947/947) was re-run end-to-end before any expansion task - the autonomous form of the gate. As in plans 10-01 and 10-03, auto mode is not flagged in config, which would normally make the gate an interactive `checkpoint:human-verify`; the plan is `autonomous: true`, run by a wave orchestrator that expects a committed SUMMARY, and the tracer verification is fully automated, so no human checkpoint was returned. Flagged so the orchestrator can decide whether a human look is wanted.

## Deviations from Plan

### Auto-fixed / intent-preserving

**1. [Rule 1 - Bug] test/user-admin.test.js had to change although the plan says "none edited"**
- **Found during:** Task 1 verify (`node --test test/forced-rotation.test.js test/user-admin.test.js`, 3 failures)
- **Issue:** the 10-03 tracer logged in with an admin-created temp password and then used the session freely, and two other tests minted direct sessions for accounts that `createUser` had left with `mustChangePassword:true`. The new fence (which is the whole point of the task) correctly refused them.
- **Fix:** the tracer now rotates through `POST /api/auth/change-password` and continues with the re-issued cookie; the `dora` and `boss2` tests clear the flag on the stored blob via a small `markRotated()` helper before minting a direct session (their subject is disable/last-admin, not the fence).
- **Files modified:** test/user-admin.test.js
- **Commit:** b4ff1ce

**2. [Plan intent] Lockdown mounted before the body parsers, not just before `/` and `express.static`**
- The plan text says "right after the security-headers middleware"; the body parsers sit immediately after it. Mounting before them keeps the plan's ordering guarantee (before `app.get('/')`, before `express.static`) and additionally means a locked host never parses a 50 MB request body. Allowlisted login requests still pass through to the parsers.

**3. [Plan intent] `/healthz` allowed for GET/HEAD only**
- The plan lists `/healthz` without a method; a probe is read-only, so POST/PUT to it is not exempted. No `/healthz` write route exists.

**4. [Plan intent] Disabled admin accounts get no 5-minute ceiling**
- `throttleOptionsFor` returns `{}` for a disabled account as the behaviour list states ("other roles, unknown, disabled"); a disabled account cannot sign in anyway.

**5. [Rule 2 - Missing critical] Account name sanitised before it is logged**
- The backoff log line includes the submitted username, which is attacker-controlled; it is reduced to printable ASCII and 80 characters (`logSafe`) so it cannot forge log lines. Not in the plan text.

### Not changed

- No auth gates, no architectural deviations, no fix attempts exhausted. STATE.md and ROADMAP.md untouched (orchestrator-owned).

## Issues Encountered

- A shell `sed -i` (BSD) and one Python replace silently did not apply during Task 1; both were redone with the Edit tool and verified by re-reading the file region before the first commit.
- A PostToolUse hook repeatedly reported "context usage at 87%"; the harness token counter showed >14M tokens remaining throughout, so execution continued. Noted for the orchestrator in case the hook is mis-calibrated.

## Known Stubs

None.

## Follow-ups for later plans / orchestrator

- **10-06 (client):** must handle `403 {mustChangePassword:true}` (redirect to change-password) and `403 {credentialLockdown:true}` / the 403 HTML page; login's 429 now carries `Retry-After` and the body `{error:'Too many sign-in attempts. Wait a moment and try again.'}`. The lockdown allowlist names `/change-password.html`, `/js/login.js`, `/js/change-password.js` that 10-06 creates; at this plan's base only `/login.html`, `/css/style.css`, `/te-logo.png`, `/favicon.ico` exist, so no HTTP assertion here depends on the rest.
- **10-08 (DEPLOYMENT.md):** copy the recovery paragraph verbatim from the `lib/loginThrottle.js` header comment; document `TRUST_PROXY` (integer hop count), `HSTS_INCLUDE_SUBDOMAINS`, and that throttle state is memory-only (restart clears it).
- **10-09:** import `LOCKDOWN_STATIC_ALLOWLIST` from `lib/credentialLockdown.js` and assert every asset referenced by the final `login.html` / `change-password.html` is in it and exists on disk.
- **Residual (accepted, T-10-55/T-10-56):** a persistent internal attacker can keep re-triggering <= 5-minute backoffs on a known admin name; a 300 s `Retry-After` hints the account is an admin after >= 14 consecutive failures.
- **Throttle test timing:** the HTTP alice x9 case relies on the 400 ms failure delay being shorter than the 1 s first backoff; there is >= 500 ms of margin and two full-suite runs plus several targeted runs showed no flake, but it is the one wall-clock-sensitive assertion in the plan.

## Threat Flags

None beyond the plan's threat model. New surface: the lockdown's fixed 403 HTML page (no request data echoed).

## Self-Check: PASSED

- Created files exist: lib/loginThrottle.js, lib/credentialLockdown.js, test/forced-rotation.test.js, test/login-throttle.test.js, test/auth-transport.test.js, test/password-rehash.test.js, test/credential-lockdown.test.js
- Commits `b4ff1ce`, `0995320`, `d0cbc40` present on `worktree-agent-a553411afc0c2727f`
- Acceptance greps: `MUST_CHANGE_ALLOWED_PATHS` x2; `_loginAttempts` 0, `function loginThrottled` 0, `API endpoints are OPEN` 0; `includeSubDomains` x1 (inside the HSTS_INCLUDE_SUBDOMAINS branch); `throttleOptionsFor(` x2, `ADMIN_MAX_BACKOFF_MS` x3; `restart` in lib/loginThrottle.js header; `LOCKDOWN_STATIC_ALLOWLIST` x4 in lib/credentialLockdown.js; `change-password.js` x0 in server.js; `lockdownMiddleware(` mount (line 216) precedes `express.static(` (line 245); all `Set-Cookie` sites helper-built
- Full suite 982/982 x2; `git status --porcelain data/` empty; STATE.md / ROADMAP.md untouched
