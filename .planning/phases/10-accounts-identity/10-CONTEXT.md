# Phase 10: Accounts & Identity - Context

**Gathered:** 2026-10-10
**Status:** Ready for planning
**Source:** PRD Express Path (.planning/reviews/v3.0/PHASE-10-PRD.md)

<domain>
## Phase Boundary

Real people get real accounts and a real-deal host cannot run on published credentials: explicit real-deal mode
(`MA_MODE=real`) on its own gitignored data directory, first-admin bootstrap, admin user management, role/disable
effective on the next request, forced rotation + stronger hashing, proxy-safe throttle + Secure cookie, self-service
password/sessions UI, demo-credential lockdown (incl. the demo-open anonymous redirect loop), 0600/0700 files.
Requirements: ACCT-01..07, COLLAB-02, OPS-08. Out of scope: IL membership management (Phase 22), read/write
authorization policy (Phase 11), audit partitioning (Phase 12), CSP/sanitizer (Phase 13), shutdown/config module (Phase 20).

</domain>

<decisions>
## Implementation Decisions

The PRD file is the authoritative statement; every item below is LOCKED (see PHASE-10-PRD.md for full wording):
- **D-10-01** Mode contract: MA_MODE=real + own data dir (`MA_DATA_DIR`, default data/real/, 0700, gitignored) seeded on first boot from the committed control.db minus demo accounts + a demo.db copy; committed files never opened for writing in real mode (assert + test); real-deal creation against the committed control path refused outside real mode; MA_*_PATH overrides still win.
- **D-10-02** `scripts/bootstrap-admin.js` (create-if-none, password from env/TTY never argv, mustChangePassword, cli:<os-user> security event); set-admin-password.js re-pointed.
- **D-10-03** Admin-only user CRUD under /api/admin/users (list, create w/ one-time temp password, PATCH role/name/disabled, reset-password); no delete; last-admin guard; zod; audited; never return hash/salt.
- **D-10-04** Role + disabled re-read from control.db per request (COLLAB-02); disabled → 401 + revoke.
- **D-10-05** mustChangePassword gate (only me/change-password/logout allowed) + client redirect; scrypt N=131072 self-describing hash + lazy rehash; min length 12 in real mode.
- **D-10-06** Per-username AND per-IP sliding throttle with backoff, bounded map; Secure cookie decoupled from ENABLE_HSTS (req.secure or https PUBLIC_BASE_URL); HSTS without includeSubDomains by default; document TRUST_PROXY/PUBLIC_BASE_URL/ENABLE_HSTS; reword stale ADMIN_TOKEN warning.
- **D-10-07** Header-menu "Change password" modal + "My sessions" list/end-session (GET /api/auth/sessions, DELETE /api/auth/sessions/:id own-only); works at 390 px.
- **D-10-08** Demo credentials unusable in real mode: seed w/o demo accounts; boot+login guard serving only login/auth/healthz if any account verifies a demo password; login.html shows demo panel only when new unauthenticated GET /api/auth/mode says demo-open/dev; fix WINDOWS #4 anonymous redirect loop in demo-open.
- **D-10-09** All DB files/dirs 0600/0700 under any umask (test under umask 022).
- **D-10-10** compression ≥1.8.2 (re-commit node_modules); DEPLOYMENT.md/README rewritten for the three modes + bootstrap.

### Claude's Discretion
Route/module file layout, helper names, exact error strings (EN, textContent only), test file organisation, how the
mode/data-dir resolution is threaded through db/dbFiles.js, UI visual details within existing admin-console and
`.deal-modal` patterns (judge at 1440 and 390 px; no UI-SPEC authored — UI contract is the PRD + existing patterns).

</decisions>

<canonical_refs>
## Canonical References

- `.planning/reviews/v3.0/PHASE-10-PRD.md` — locked decisions and acceptance
- `.planning/REQUIREMENTS.md` — ACCT-01..07, COLLAB-02, OPS-08 + "Mode contract"
- `.planning/reviews/v3.0/R1-security.md` (R1-01, R1-08, R1-12, R1-13), `R2-ops-data-deploy.md` (R2-05, R2-06), `PLAN-REVIEW.md` (PR-17, PR-23)
- `.planning/ROADMAP.md` Phase 10 success criteria
- `DEPLOYMENT.md`, `start-real-deal.command`, `start-real-deal.bat`, `scripts/set-admin-password.js`, `db/dbFiles.js`, `db/sessions.js`, `db/controlStore.js`, `server.js` auth section, `public/login.html`, `public/js/transitions.js` (header/menu), `public/admin.html`/`admin.js`
- `.planning/phases/09-optimistic-locking-conflict-recovery/WINDOWS.md` equivalents: `.planning/WINDOWS.md` #4 (demo-open redirect loop)

</canonical_refs>

<specifics>
## Specific Ideas

Temp password shown once in a modal with copy-to-clipboard; Users tab lists username/name/role/status/last-login; test harness reuse: `test/helpers/listen-local.js`, MA_* temp paths, Playwright via /Users/karstenhaldan/.npm/_npx/e41f203b7505f1fb/node_modules/playwright (harness pattern in scripts/uat/phase9-walk.js).

</specifics>

<deferred>
## Deferred Ideas

IL-managed membership (Phase 22), MFA/SSO (Out of Scope), password history/breach check, per-account lockout notifications, admin deletion of users (disable only).

</deferred>

---

*Phase: 10-accounts-identity*
*Context gathered: 2026-10-10 via PRD Express Path*
