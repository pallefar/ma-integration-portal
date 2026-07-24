---
phase: 2
slug: mandatory-auth-roles
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-24
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `02-RESEARCH.md` §Validation Architecture. Framework = `node:test` (proven in Phase 1: 9/9 green).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built-in; `package.json` already has `"test": "node --test"`) |
| **Config file** | none — bare `node --test` auto-discovers `test/*.test.js` |
| **Quick run command** | `node --test test/session-lifecycle.test.js` (single file) |
| **Full suite command** | `node --test` (BARE — `node --test test/` does NOT work on Node v22.18.0; always bare) |
| **Estimated runtime** | ~5–15 seconds |

---

## Sampling Rate

- **After every task commit:** the new/changed test file for that task
- **After every plan wave:** `node --test` (bare, full suite — 3 Phase-1 files + 3 new Phase-2 files)
- **Before `/gsd-verify-work`:** full suite green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 2-xx | gate | 0 | AUTH-01 | fail-closed default | Every registered `/api/*` route (GET included) 401s unauthenticated, checked against a LIVE-generated route inventory (app._router.stack); `/api/auth/login` + `/api/auth/me` are the only exempt routes | integration | `node --test test/auth-route-inventory.test.js` | ❌ W0 | ⬜ pending |
| 2-xx | roles | 0 | AUTH-02 | role escalation | hrbp/pmo session → 403 on an admin-only write (e.g. /api/admin/migrate-db); seeded employee session → 403 on a non-self-service write | integration | `node --test test/role-enforcement.test.js` | ❌ W0 | ⬜ pending |
| 2-xx | sessions | 0 | AUTH-03 | session revocation | token authorizes; after logout deleteSession() OR admin deleteAllSessionsForUser() the same token immediately 401s; an expires_at-in-the-past row also 401s | unit | `node --test test/session-lifecycle.test.js` | ❌ W0 | ⬜ pending |
| 2-xx | sessions/roles | 0 | AUTH-04 | identity resolution | valid session → req.portalUser.username + .role populated & correct; open-mode request → req.portalUser === null (explicit) | unit | in role-enforcement.test.js / session-lifecycle.test.js | ❌ W0 | ⬜ pending |
| 2-xx | gate | 0 | AUTH-01 (demo) | demo-open vs fail-closed | with demo-open flag set → open GET works without session; flag unset → same GET 401s | integration | in auth-route-inventory.test.js | ❌ W0 | ⬜ pending |
| 2-xx | sessions | 0 | AUTH-03 | token-at-rest | sessions table stores a HASH of the token, never the plaintext token (a leaked .db can't replay live sessions) | unit | in session-lifecycle.test.js | ❌ W0 | ⬜ pending |

*Task IDs are `2-xx` placeholders — the planner assigns concrete IDs; the requirement→test mapping is the binding contract.*

---

## Wave 0 Requirements

- [ ] Prerequisite refactor: `server.js` → `module.exports = app` + guard `app.listen()` behind `require.main === module` (enables route introspection + in-process testing without binding a port). Must land before `test/auth-route-inventory.test.js`.
- [ ] `test/auth-route-inventory.test.js` — AUTH-01 (unauthenticated 401 sweep over the live route inventory + demo-open behavior)
- [ ] `test/role-enforcement.test.js` — AUTH-02 + AUTH-04 (role rejection, identity resolution)
- [ ] `test/session-lifecycle.test.js` — AUTH-03 + AUTH-04 (create/authorize/logout/admin-revoke/expire; hashed-token-at-rest)
- [ ] Seed one demo `employee`-role account (per D-12) so the AUTH-02 employee path has a subject
- [ ] Framework install: none — `node:test` built-in, proven in Phase 1

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Client redirects to /login.html on a 401 read (fail-closed GET-gating) | AUTH-01 (UX) | Requires a real browser session/redirect flow; the automated sweep asserts the 401, not the client redirect | In fail-closed mode with no session, load a portal page → browser should redirect to /login.html rather than render a blank/broken page. Verify transitions.js handles 401 on reads, not just writes. |
| Demo bundle stays open under the new fail-closed default | AUTH-01 (demo) | Depends on the release launcher (start.bat/start.command) setting the demo-open flag | Boot the demo bundle via its launcher → :3000 serves without a login prompt (demo-open flag set by the launcher). |

*If none of the automated tests can cover the browser redirect, it is a `checkpoint:human-verify`.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
