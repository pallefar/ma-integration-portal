---
phase: 10-accounts-identity
reviewed: 2026-10-10T12:00:00Z
depth: deep
scope: client/launchers/docs (part 2 — files 10-REVIEW.md did not reach)
files_reviewed: 17
files_reviewed_list:
  - public/js/account-menu.js
  - public/css/account.css
  - public/js/admin.js
  - public/js/admin-users.js
  - public/css/admin-users.css
  - public/admin.html
  - public/js/transitions.js
  - public/js/deal-switcher.js
  - public/js/login.js
  - public/login.html
  - public/js/change-password.js
  - public/change-password.html
  - start-real-deal.command
  - start-real-deal.bat
  - DEPLOYMENT.md
  - README.md
  - .gitignore
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: issues_found
---

# Phase 10: Code Review Report — part 2 (client, launchers, docs)

**Reviewed:** 2026-10-10
**Depth:** deep — full current files + `git diff 943fe2f HEAD` per path; every doc claim checked against code
**Files Reviewed:** 17 (the Users tab lives in `public/js/admin-users.js` + `admin-users.css`, not in `admin.js`; both were read in full)
**Status:** issues_found (0 critical / 2 warning / 4 info)

This report complements `10-REVIEW.md` (CR-01 case-variant admin prefix, WR-01 Retry-After, WR-02 rehash) and does not repeat those. Finding IDs use the `C` prefix.

## Summary

No BLOCKER in this scope. What was traced and found sound:

- **XSS / DOM injection** — every username, name, role, IP, user-agent, timestamp and server error string in `account-menu.js`, `admin-users.js`, `login.js`, `change-password.js` reaches the DOM via `createElement`/`textContent`/`setAttribute`; no `innerHTML`/`insertAdjacentHTML` with server data anywhere in the new client code. `data-username`/`data-user` are attribute sets, not markup.
- **Temp password handling** — lives only in a read-only input (`admin-users.js:189-226`), blanked on every close path via `onClose`; never in `localStorage`/`sessionStorage`, URL, history or logs; the only persistence is the admin's clipboard after an explicit Copy.
- **Redirects / open redirect** — `login.js` has no `next`/`returnTo` parameter at all; `landingFor()` returns only `/` or `/change-password.html`. The three-page graph (login → change-password → `/`, transitions.js handshake → change-password, change-password → login on `!me.user`) has no cycle: `change-password.html` does not load `transitions.js`, and `transitions.js` 403-marker and 401 handlers skip both pages. The WINDOWS #4 demo-open loop is closed by `deal-switcher.js:136-145` (no `/api/deals` call without a user) and `login.js` never redirecting an anonymous visitor.
- **CSRF / clickjacking** — session cookie is `SameSite=Strict` (`server.js:885`), all state-changing calls are JSON `fetch`; `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` (`server.js:161,175`) are set before the lockdown middleware (`:216`), so the locked 403 page and login page carry them too.
- **accountsWritable gating** — hidden/disabled controls (`#btn-users-add` display:none, row actions not rendered, `Change password` `disabled`+`aria-disabled`, `#admin-tab-btn-users` display:none for non-admin) are UX only; a console-triggered call hits the server's own `committedControlDb` 403 / `/api/admin` role prefix. Consistent across the three client policies.
- **Error leakage** — final handler returns `{error:'Internal server error'}` (`server.js:7802-7806`); client `errorText()` shows only `error`/`message` strings the server deliberately sends.
- **Launchers** — `MA_MODE=real` is exported before `exec`/`node` in both; `DEMO_OPEN` is never set; every `%~dp0`/`$NODE_CMD` expansion is quoted, so an install path containing `&` or spaces (this very repo is `M&A`) is safe, including the `echo` of the bootstrap hint. `scripts/bootstrap-admin.js` defaults `MA_MODE=real` itself (`:199`), so running the hint from a fresh terminal lands on the real data dir.
- **Docs vs code** (verified): three modes and selectors; `MA_MODE` non-`real` values and `MA_MODE=real`+`DEMO_OPEN=1` refused at boot (`db/dbFiles.js:65-75`); `--force-reset-admin` exists, forces rotation and revokes sessions (`bootstrap-admin.js:148-170`); `set-admin-password.js` reads `ADMIN_PASSWORD`/TTY and refuses the committed db; throttle numbers (5 free / 1 s base / 15 min cap / 50 per source / admin cap 5 min) match `server.js:830-847`; `HSTS_INCLUDE_SUBDOMAINS=1` matches `:187`; `data/real/*` excluded from download-zip (`:1833`) and gitignored; 0600/0700 strict-fatal only in real mode (`dbFiles.js:247`); lockdown remedy matches `server.js:935-940`; `start.*` set `DEMO_OPEN=1`.
- **UAT evidence honesty** — `scripts/uat/phase10-walk.js` exits 1 on any FAIL (`:432`), records thrown scenarios as FAIL, passes the bootstrap password only through env, strips inherited `MA_*`/`DEMO_OPEN`/`ADMIN_TOKEN` from the child env, and byte-compares the committed `.db` + `-wal` before/after.

## Warnings

### WR-C01: One-time temporary password can be lost by an accidental dismiss, and the modal returns focus nowhere

**File:** `public/js/admin-users.js:126-127` (Escape), `:137` (overlay click), `:189-199` (temp modal opened with `trigger=null`, `onClose` blanks the value)
**Issue:** The temp-password modal is the *only* place the credential is ever shown, yet it shares the generic shell: a stray click on the scrim (easy at 390 px, where the overlay padding is 0.75 rem) or an Escape keypress closes it and `onClose` wipes the value before the admin has copied it. There is no confirm and no "show again". The admin's only recovery is **Reset password**, which generates a second credential, writes a second audit event and (for an existing user) revokes that user's sessions — a side-effect-bearing retry for a UI slip. Separately the modal is opened with `trigger=null`, so on close focus falls to `<body>` (keyboard/screen-reader users lose their place in the table).
**Failure scenario:** Admin creates `alice`, reaches for Copy on a phone, taps the scrim → modal gone, password gone; admin resets `alice` → audit shows create + reset within seconds; on a real reset of an active user, their sessions are killed twice.
**Fix:**
```js
// openModal(opts): honour opts.sticky — the temp-password modal passes it
var onKeydown = function (e) {
  if (e.key === 'Escape') { e.stopPropagation(); if (!(opts && opts.sticky)) closeModal(); return; }
  ...
};
overlay.addEventListener('click', function (e) {
  if (e.target === overlay && !(opts && opts.sticky)) closeModal();
});
// openTempPasswordModal(username, tempPassword, headline, trigger):
var shell = openModal(headline, ..., trigger, { sticky: true, onClose: function () { input.value = ''; } });
```
and pass the Add/Reset button as `trigger` from `openAddUser` / `openResetPassword` so focus returns to the row. Keep Done as the single explicit close. Add a browser check to `scripts/uat/phase10-scenarios/users-tab.js`: Escape and scrim click leave the temp modal open.

### WR-C02: Locked decision D-10-10 (`compression ≥ 1.8.2`) is not delivered; the tree still ships 1.8.1

**File:** `node_modules/compression/package.json` (`version: 1.8.1`), `DEPLOYMENT.md` (Known limitations: "ships `compression@1.8.1`; the fixed `1.8.2` is pending the dependency-legitimacy age gate"), `10-CONTEXT.md` D-10-10 ("compression ≥1.8.2 (re-commit node_modules)" — LOCKED)
**Issue:** The PRD locks the bump as part of this phase; the code does not contain it and the phase is being closed with the advisory (GHSA-vc2v-76pw-4v95, memory growth on premature close) still open on the first host that will be shared and multi-user. DEPLOYMENT.md is honest about it, so this is a scope/decision gap rather than a doc contradiction — but ROADMAP/PRD still read as if the phase delivers it. SUSPECTED: nothing in the phase SUMMARY files explicitly re-scopes D-10-10 to Phase 21/REL-02.
**Fix:** Either commit `compression@1.8.2` (re-commit `node_modules/compression` only; the fix is a few lines in `index.js` and verifiable by diff) in this phase, or record the deferral where the decision lives (PRD D-10-10 amendment + ROADMAP Phase 10 success criteria + REQUIREMENTS) so the verifier and the milestone audit do not count it as delivered. Do not leave the only record in a "Known limitations" paragraph.

## Info

### IN-C01: Real-deal launchers do not clear an inherited `DEMO_OPEN`

**File:** `start-real-deal.command:651,672-674`, `start-real-deal.bat:711,731-733`
**Issue:** Both launchers correctly never *set* `DEMO_OPEN`, but neither clears one inherited from the shell/profile (`export DEMO_OPEN=1` in a `.zshrc`, or a `setx` on Windows after a demo session). `db/dbFiles.js:75` then throws at boot — fail-closed, good — but the 3-second browser-open timer in both launchers still fires, so the operator sees a dead tab and (on macOS) an error only in the Terminal pane behind it.
**Fix:** `unset DEMO_OPEN` / `set "DEMO_OPEN="` immediately after the `MA_MODE=real` line, with the existing `[security]` comment extended to say the launcher *clears* it; optionally delay the browser-open until `/healthz` answers.

### IN-C02: DEPLOYMENT.md "Self-service" overstates the dev/demo gating

**File:** `DEPLOYMENT.md` ("Both are disabled with an explanatory note on the dev/demo committed database"), `public/js/account-menu.js:216,249-254,310-313`
**Issue:** Only **Change password** is disabled; **My sessions** stays active in dev/demo and lists the caller's sessions (IP, user agent, times) read-only, with the End-session buttons omitted. The code behaviour is the intended one (header comment lines 10-14); the doc is wrong.
**Fix:** "Change password is disabled with an explanatory note; My sessions still lists sessions but offers no End session."

### IN-C03: Users list can go stale with no in-page refresh path

**File:** `public/js/admin-users.js:498-500` (`if (!host || state.loading) return`), `:516-524` (`openTab` is one-shot)
**Issue:** `loadUsers()` silently drops a call while a previous load is in flight, and the tab button only loads once per page life. After a create/edit/reset that lands while the initial load is still pending (slow host, 503 retry in the Phase 8 wrapper), the new state is never fetched and there is no refresh control — only a full page reload. Narrow race, but the operator has no way to notice it.
**Fix:** Queue instead of drop (`state.pending = true` → re-run after the in-flight load resolves), and let a second click on the Users tab call `loadUsers()` again.

### IN-C04: Real-deal lane still renders demo chrome (evidence observation)

**File:** `.planning/phases/10-accounts-identity/evidence/users-tab-390.jpg` (header shows "DEMO ACTIVE", "DEMO · Demo showcase" switcher, "Role: IMO Admin Console" selector) — SUSPECTED pre-existing, outside Phase 10 files
**Issue:** On a `MA_MODE=real` host the shared header still shows the demo-mode badge, the demo project switcher and the client-side role selector. None of it grants access (server-verified role wins), but on an MNPI host it is misleading and the role dropdown invites users to "switch" to something the server will refuse. Not introduced by this phase; recording it so the mode-aware chrome work (Phase 20 config module / Phase 19 i18n) can pick it up.
**Fix:** Hide `.demo-*` chrome and the role selector when `/api/auth/mode` says `mode:'real'`; track as a backlog item rather than a Phase 10 defect.

---

_Reviewed: 2026-10-10_
_Reviewer: Claude (gsd-code-reviewer, Fable 5.1) — part 2 of 2_
_Depth: deep_
