---
phase: 10-accounts-identity
plan: 03
subsystem: auth
tags: [user-admin, identity, sessions, last-admin-guard, collab-02, acct-01, acct-06, mnpi]

requires:
  - phase: 10-accounts-identity
    provides: "10-01: MA_MODE=real contract, lib/passwords.js, GET /api/auth/mode accountsWritable, isCommittedControlDbActive(), controlStore.getAccount/createAccount; 10-02: test/helpers/seed-identity.js"
  - phase: 08-concurrency-storage-foundation
    provides: ".immediate transactions, central 503 middleware + isBusyError guard"
provides:
  - "/api/admin/users list / create / PATCH / reset-password (admin only, zod, audited, last-admin guard, no hash/salt ever returned)"
  - "per-request identity re-read: role + disabled come from control.db on every request (resolveSessionIdentity)"
  - "GET /api/auth/sessions and DELETE /api/auth/sessions/:id (own sessions only, derived ids)"
  - "controlStore.publicAccount() allowlist projection used by login, /api/auth/me and every admin response"
  - "runtime.db account_logins last-sign-in table"
  - "req.portalUser.mustChangePassword (consumed by the 10-05 gate and the 10-06 client)"
affects: [10-05, 10-06, phase-11, phase-22]

actuals:
  tokens: 18600
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "one allowlist projection (publicAccount) for every account object that leaves the process, including audit before/after"
    - "guard evaluated inside the same BEGIN IMMEDIATE transaction as the write (updateAccountGuarded)"
    - "control-plane path predicate (isControlPlanePath) is what keeps account surfaces out of DEMO_OPEN open mode"

key-files:
  created:
    - validators/users.js
    - test/user-admin.test.js
    - test/accounts-writable-gate.test.js
    - test/self-sessions.test.js
    - test/session-identity-reread.test.js
  modified:
    - server.js
    - db/controlStore.js
    - db/sessions.js
    - db/resolver.js
    - db/runtime-schema.sql

key-decisions:
  - "Role and disabled are re-read from control.db on every request; the sessions.role column is kept as written but never trusted (single indexed PK SELECT, <= ~50 rows)"
  - "A missing or disabled account sweeps ALL of that username's sessions from inside the gate, so a re-enabled account needs a fresh sign-in (old cookies never revive)"
  - "Public session id = first 32 hex of sha256('session-id:' + token_hash): stable per session, never equal to a stored value, lookups keyed by the caller's username so a foreign id is a plain 404"
  - "Last sign-in lives in runtime.db account_logins, never in the committed control.db"
  - "/api/auth/change-password joined the control-plane set (never open, never deal-bound) alongside /api/admin/users and /api/auth/sessions*"

patterns-established:
  - "Every committed-control refusal calls dbFiles.isCommittedControlDbActive() directly (helper refuseCommittedControlWrite in server.js) - the same predicate GET /api/auth/mode exposes"
  - "Responses carrying a one-time secret set Cache-Control: no-store"

requirements-completed: [ACCT-01, COLLAB-02, ACCT-06]

coverage:
  - id: D1
    description: "Admin creates a user (one-time temp password), the user signs in with it, a role change binds on the next request with the same cookie (PRD acceptance 2, server half)"
    requirement: ACCT-01
    verification:
      - kind: integration
        ref: "test/user-admin.test.js (tracer)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Disable binds on the next request (401 authRequired) and deletes sessions; re-enable needs a fresh sign-in; deleted account also stops authorizing"
    requirement: COLLAB-02
    verification:
      - kind: integration
        ref: "test/user-admin.test.js (disable), test/session-identity-reread.test.js (account)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Last-enabled-admin cannot be disabled or demoted (409 lastAdmin), self-disable refused, guard inside one .immediate transaction"
    requirement: ACCT-01
    verification:
      - kind: integration
        ref: "test/user-admin.test.js (last-admin guard)"
        status: pass
    human_judgment: false
  - id: D4
    description: "No login/me/admin-users/sessions response or audit row ever carries hash, salt, a stored hash value or a temp password; PATCH is not a mass-assignment surface"
    requirement: ACCT-01
    verification:
      - kind: integration
        ref: "test/user-admin.test.js (deep-scan + audit + mass-assignment), test/self-sessions.test.js (no token hash)"
        status: pass
    human_judgment: false
  - id: D5
    description: "accountsWritable:false <=> POST/PATCH/reset-password/change-password all 403 {committedControlDb:true}; reads still work; committed control.db + -wal unchanged; temp-copy boot is writable (201)"
    requirement: ACCT-01
    verification:
      - kind: integration
        ref: "test/accounts-writable-gate.test.js"
        status: pass
    human_judgment: false
  - id: D6
    description: "Self-service sessions API: own sessions only, derived ids, current flag, end other / end current, foreign id 404, employee allowed, anonymous 401 even under DEMO_OPEN=1, one session-end-own event"
    requirement: ACCT-06
    verification:
      - kind: integration
        ref: "test/self-sessions.test.js"
        status: pass
    human_judgment: false
  - id: D7
    description: "Clearance grant/revoke binds on the member's next request with the same cookie (COLLAB-02 grants half)"
    requirement: COLLAB-02
    verification:
      - kind: integration
        ref: "test/session-identity-reread.test.js (grants), test/dd-grants.test.js"
        status: pass
    human_judgment: false

duration: 50min
completed: 2026-10-10
status: complete
---

# Phase 10 Plan 03: Admin user management, per-request identity and self-service sessions Summary

**An admin can create users with a one-time temporary password, change role or disable them with effect on the user's very next request (the gate re-reads the account from control.db every request), and every user can list and end only their own sessions - with no hash, salt, token hash or temp password ever appearing in a response or audit row.**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-10-10
- **Tasks:** 3 (1 tracer + 2 auto/tdd)
- **Files:** 10 (5 created, 5 modified); 1356 insertions, 9 deletions
- **Suite:** 911 base -> 935 tests, 0 failures, 3 consecutive full runs green; `git status --porcelain data/` empty

## Accomplishments

- **Per-request identity (D-10-04, COLLAB-02):** `resolveSessionIdentity()` in server.js is used by the consolidated `/api` gate and `GET /api/auth/me`. It reads the session, then the account by PK; a missing or disabled account deletes every session of that username and resolves to anonymous (401 `authRequired`). The role in `req.portalUser` is the account's current role; the `sessions.role` snapshot is never used for authorization. This run is the authoritative proof that 10-02's fixtures made strict re-reading safe: the **full suite is green with the real resolver in the gate (913 at Task 1)**.
- **Admin CRUD (D-10-03):** `POST /api/admin/users` (201, temp password generated or supplied and policy-checked, `no-store`), `GET` (sorted, allowlisted, `lastLoginAt`), `PATCH /:username` ({role,name,disabled} only; unknown keys stripped), `POST /:username/reset-password` (hash replaced, `mustChangePassword`, all target sessions deleted). No delete route exists.
- **Last-admin guard:** `controlStore.updateAccountGuarded()` runs the target read, the self-disable check, the "would leave zero enabled admins" check and the write inside ONE `.immediate` transaction. Codes `ACCOUNT_NOT_FOUND` / `SELF_DISABLE` / `LAST_ADMIN` map to 404 / 409 / 409 `{lastAdmin:true}`.
- **No secrets out:** `controlStore.publicAccount()` is an explicit allowlist and backs login, `/api/auth/me`, and every admin response; audit before/after are projected to `{username,name,role,disabled,mustChangePassword}` (`user-create` has only `after`, `user-update` carries `{role,name,disabled}`, `user-password-reset` is subject-only). A deep scan of every JSON body the user-admin suite receives finds no `hash`/`salt` key and no stored hash value.
- **Never open (T-10-13):** `isControlPlanePath()` now also covers the exact `/api/admin/users`, `/api/auth/sessions`, `/api/auth/sessions/*` and `/api/auth/change-password`. Anonymous requests to those 401 even with `DEMO_OPEN=1`; verified by test.
- **Committed-control parity (D-10-01):** every account write calls `dbFiles.isCommittedControlDbActive()` via one helper, the same predicate behind `accountsWritable`; the parity test proves flag and refusals agree on all four writes while the committed file's sha256 and -wal stay unchanged.
- **Self-service sessions (D-10-07 API):** `GET /api/auth/sessions` (newest first, UA truncated to 200, exactly one `current`), `DELETE /api/auth/sessions/:id` (404 for foreign/unknown ids, `{endedCurrent:true}` + clearing cookie for the current one, `session-end-own` event otherwise). `ROLE_WRITE_POLICY` gained an all-roles entry so the employee role is not 403.
- **Last sign-in:** `account_logins` in runtime.db (`recordLogin` after a successful login), never in control.db; `control-schema.sql` is untouched.

## Task Commits

1. **Task 1 (tracer): admin create/patch + per-request identity re-read** - `4bdeea6`
2. **Task 2: list, reset-password, last sign-in, publicAccount responses, parity tests** - `35452e3`
3. **Task 3: self-service sessions API + COLLAB-02 re-read regression** - `93d6907`

## Tracer feedback gate

The tracer's `<verify>` (`node --test test/user-admin.test.js test/write-validation-coverage.test.js test/auth-route-inventory.test.js`, 5/5) and then the full suite (913/913) were re-run end-to-end after the tracer commit and before any expansion task - the autonomous form of the gate. As in 10-01, auto mode is not flagged in config, which would normally make this an interactive `checkpoint:human-verify`; the plan is `autonomous: true`, run by the wave orchestrator that expects a committed SUMMARY, and the tracer's verification is fully automated, so no human checkpoint was returned. Flagged so the orchestrator can decide whether a human look is wanted.

## Deviations from Plan

### Auto-fixed / intent-preserving

**1. [Rule 1 - Bug] Last-admin guard fires only when the patch actually removes an enabled admin**
- **Issue:** the plan text says "throw LAST_ADMIN if the post-patch set of enabled admins would be empty". Taken literally that also refuses an innocent rename of a non-admin whenever the admin set is already empty (possible when the break-glass `admin-token` is the only way in).
- **Fix:** `LAST_ADMIN` is thrown only when the target WAS an enabled admin, ends up not one, and no other enabled admin exists. The invariant "an admin action never reduces the enabled-admin count to zero" is unchanged.
- **Files:** db/controlStore.js - **Commit:** 4bdeea6

**2. [Plan intent] Empty `tempPassword` means "generate one"**
- A blank form field posts `''`; it is treated like an absent value rather than a policy failure. Any non-empty value is held to `passwords.checkNewPassword(realMode)`.

**3. [Plan intent] `controlStore.listAccounts()` is an alias of `listUsers()`**
- The plan lists `listAccounts()` as an artifact while Task 2 text uses `listUsers()`; both exist and return the same rows.

**4. [Test harness] Interactive logins kept under the 8/minute throttle**
- `/api/auth/login` throttles per IP and one test file is one process, so user-admin.test.js uses at most 4 real logins and creates every other identity as a direct session.

No auth gates, no architectural deviations, no fix attempts exhausted.

## Issues Encountered

- A first draft of one test assumed `POST /api/dd/request-items` answers 200; it answers 201. Test-only correction.

## Known Stubs

None.

## Follow-ups for later plans / orchestrator

- `mustChangePassword` is present on `req.portalUser`, in the login response (top-level) and in `/api/auth/me`'s `user` object, but nothing enforces it yet (10-05 gate; 10-06 client redirect and the Users tab / temp-password modal / My sessions UI).
- Audit-after-commit ordering for account create: a busy audit append after `createAccount` returns 503 with the account persisted; a silent client retry then gets 409 "username taken" and the temp password is lost (an admin can use reset-password). Same sequential pattern as the existing control-plane handlers; not changed here. Worth a decision if the 10-06 modal retries automatically.
- `resolveSessionIdentity()` deletes sessions from inside the gate for a disabled/missing account, i.e. a write on what may be a GET; a busy lock there surfaces as the central 503 like any other storage error.
- 10-02's strict-identity fixtures held: no suite needed a change after the real gate landed.

## Threat Flags

None beyond the plan's threat model. New surface: `GET/POST /api/admin/users`, `PATCH /api/admin/users/:username`, `POST /api/admin/users/:username/reset-password`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, all behind the gate (admin-only or caller-keyed) and control-plane (never open). T-10-13..T-10-21 mitigated and covered by tests; T-10-22 accepted as planned.

## Self-Check: PASSED

- Created files exist: validators/users.js, test/user-admin.test.js, test/accounts-writable-gate.test.js, test/self-sessions.test.js, test/session-identity-reread.test.js
- Commits `4bdeea6`, `35452e3`, `93d6907` present on `worktree-agent-ac0f95d89d5d96c8b`
- Acceptance greps: `resolveSessionIdentity(` x5 in server.js (>= 3); `'/api/admin/users'` in db/resolver.js; `account_logins` x1 in db/runtime-schema.sql; `git diff --stat db/control-schema.sql` empty; `publicAccount(` x8 in server.js (>= 3); `'/api/auth/sessions'` x2 in server.js
- Full suite 935/935 x3; `git status --porcelain data/` empty; STATE.md / ROADMAP.md untouched
