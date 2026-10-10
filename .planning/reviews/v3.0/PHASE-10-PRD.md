# Phase 10 — Accounts & Identity — PRD / locked decisions (orchestrator, 2026-10-10)

Authoritative input for `/gsd-plan-phase 10 --prd`. Source evidence: `.planning/reviews/v3.0/R1-security.md`
(R1-01 BLOCKER, R1-08, R1-12, R1-13), `R2-ops-data-deploy.md` (R2-05, R2-06), `PLAN-REVIEW.md` (PR-17, PR-23),
REQUIREMENTS.md "Mode contract". Requirements: ACCT-01..07, COLLAB-02, OPS-08. Depends on Phase 9 (done).

## Why this phase exists
The committed `data/control.db` ships four accounts (admin, karen=hrbp/Integration Leader, pmo, employee-demo) that
all verify the password printed on `public/login.html`; there is NO user create/disable/reset route anywhere; a fresh
host has zero users (lockout); `start-real-deal.*` is `exec node server.js` and is indistinguishable from dev; the deal
registry (target names = MNPI) lives in a committed file in a public repo; sessions snapshot `role` at login so a role
change is inert; login throttle keys on proxy IP; scrypt N=2^14; DB files are 0644.

## Locked decisions
**D-10-01 Mode contract.** `MA_MODE=real` is set ONLY by `start-real-deal.command/.bat`, the (future) service unit and
container image. In real mode the server resolves its data directory to `MA_DATA_DIR` (default `<repo>/data/real/`,
gitignored; must be created `0700`), and on FIRST boot seeds `control.db` there from the committed
`data/control.db` MINUS every demo account (users table emptied; schema + app_state kept) and a copy of `demo.db`.
The committed `data/control.db`/`data/demo.db` are never opened for writing in real mode (assert at boot; test it
with a sha256 before/after). `node server.js` without MA_MODE stays dev/demo (unchanged behaviour; fail-closed unless
`DEMO_OPEN=1`; tests keep using `MA_*_PATH` temp overrides). Creating a real deal against the committed control DB
path (i.e. MA_MODE != real and no MA_CONTROL_DB_PATH override) is refused with a message naming `start-real-deal`.
All existing `MA_*_PATH`/`MA_DEALS_DIR` overrides keep winning over `MA_DATA_DIR`.
**D-10-02 First-admin bootstrap.** `scripts/bootstrap-admin.js` (run on the host as the service user): refuses if any
user exists unless `--force-reset-admin`; takes the password from `MA_BOOTSTRAP_PASSWORD` env or a TTY prompt (never argv);
creates `admin` with `mustChangePassword:true`; writes a control-plane security event `actor:cli:<os-user>`.
`scripts/set-admin-password.js` keeps working but is re-pointed at the active data dir.
**D-10-03 User CRUD (ACCT-01).** New admin-only routes under the existing `/api/admin` prefix (admin for ALL methods):
`GET /api/admin/users` (no hashes/salts ever), `POST /api/admin/users` {username,name,role,tempPassword?} (server generates
a strong temp password if absent and returns it ONCE), `PATCH /api/admin/users/:u` {role?, name?, disabled?},
`POST /api/admin/users/:u/reset-password` (new temp password, `mustChangePassword:true`, revokes sessions). Roles are the
existing four (admin/hrbp/pmo/employee). Username charset `[a-z0-9._-]{3,40}`; no deletion (disable only — audit
integrity). Cannot disable/demote the last enabled admin. Every action → `recordSecurityEvent`. zod schemas in
validators/ (VAL-01 coverage test must stay green).
**D-10-04 Role/disable effective on the next request (COLLAB-02).** `db/sessions.js` snapshots `role`; `findSession` /
the auth gate must re-read the user's CURRENT role + disabled flag from control.db per request (single indexed SELECT)
and treat disabled as 401 + session revoke. A role change takes effect on the user's next request without re-login.
**D-10-05 Forced rotation & hashing (ACCT-04).** `mustChangePassword` users may call only `/api/auth/me`,
`/api/auth/change-password`, `/api/auth/logout` until changed (403 `{mustChangePassword:true}` elsewhere); client
redirects to a change-password screen. New hashes use scrypt `{N:131072,r:8,p:1}` with a self-describing format prefix;
legacy hashes verify and are transparently re-hashed on the next successful login. Min length 12 for NEW passwords
(real mode); demo mode keeps 8.
**D-10-06 Throttle & cookie (ACCT-05).** Replace the per-IP counter with per-(username) AND per-(ip) sliding windows with
exponential backoff and a generic 429; one user's failures never block a different username from the same IP
(proxy-safe); prune expired entries (bounded map). Session cookie `Secure` when `req.secure` (TRUST_PROXY aware) OR
`PUBLIC_BASE_URL` starts with `https://` — decoupled from `ENABLE_HSTS`; HSTS stops sending `includeSubDomains` by default.
Document `TRUST_PROXY`, `PUBLIC_BASE_URL`, `ENABLE_HSTS` in DEPLOYMENT.md. Reword the stale ADMIN_TOKEN boot warning
(server.js ~198) to the truth.
**D-10-07 Self-service (ACCT-06).** Add UI in the shared header menu (all roles): "Change password" modal and "My
sessions" list with end-session (uses `POST /api/auth/change-password`, new `GET /api/auth/sessions`,
`DELETE /api/auth/sessions/:id` own-only). Must work at 390 px.
**D-10-08 Demo credentials unusable in real mode (ACCT-07).** In real mode: (a) seeded without demo accounts (D-10-01);
(b) a boot-time + login-time guard — if ANY enabled account verifies a known demo password, the server serves only
`/login.html`, `/api/auth/*` and `/healthz` and logs a `[security]` banner (belt-and-braces for a hand-copied
control.db); (c) `public/login.html` shows the demo-credentials panel / auto-fill ONLY when `/api/auth/mode` (new,
unauthenticated, returns `{mode:'demo'|'dev'|'real', demoOpen:boolean}`) says demo-open or dev. The unauthenticated
anonymous-tab redirect loop in demo-open mode (WINDOWS #4: deal switcher calls control-plane `/api/deals` → 401 →
login.html → loop) must be fixed here since login.html is being reworked: in demo-open mode login/landing must not
redirect when no session exists.
**D-10-09 Files at rest (OPS-08).** All DB files/dirs created by the app (`openDbFile`, deal DB creation, `data/real`,
audit/runtime) are `0600`/`0700` regardless of umask (explicit `mkdirSync mode` + `chmodSync` after first open incl.
`-wal`/`-shm` where present). Test under `umask 022`.
**D-10-10 Misc.** `compression` bump to ≥1.8.2 (R1-09, re-commit node_modules); DEPLOYMENT.md first-run section
rewritten for MA_MODE=real + bootstrap-admin; README states the three modes. UI: reuse existing admin-console tab
pattern (`data-tab`), `.deal-modal` shell for the modals, no framework; all strings EN via textContent (Phase 19 i18n).

## Out of scope (do not plan)
Invite/membership management by the IL (Phase 22 COLLAB-01); read-policy/authorization changes (Phase 11); SSO; MFA;
audit partitioning (Phase 12); CSP/sanitizer (Phase 13); graceful shutdown/config module (Phase 20).

## Acceptance (must be demonstrable)
1. `MA_MODE=real node server.js` on an empty `data/real/` boots, has zero users, `/api/auth/mode` says real, login page
   shows no demo credentials; `bootstrap-admin` creates the admin; `git status` clean afterward; sha256 of committed
   control.db/demo.db unchanged.
2. Admin creates user → user logs in with temp password → forced to change → role change/disable takes effect on the next
   request; last-admin guard holds; all actions in the audit trail; no response ever contains hash/salt.
3. A real-mode instance whose control DB is hand-copied from the committed one serves only login/auth/healthz.
4. 9 wrong passwords for `alice` do not block `bob` from the same IP; `Secure` cookie under TRUST_PROXY+https; scrypt N=2^17
   new hashes + lazy rehash proven by test.
5. DB files `0600`/dirs `0700` under umask 022; compression ≥ 1.8.2.
6. Suite green (878 base); demo launchers + `node server.js` dev flow unchanged; Playwright smoke of login, change
   password, My sessions, Users tab at 1440/390.
