---
phase: 13-content-safety
plan: QUICK-egress
subsystem: security
tags: [audit, egress, demo-open, break-glass, cache-control, log-hygiene]
status: complete
closes: [T-13-13, SC-04, SC-05]
requires: [13-SECURITY.md (Fable audit)]
key-files:
  modified:
    - server.js
    - test/egress-settings.test.js
    - test/caching-safe07.test.js
    - test/media-upload-safety.test.js
actuals:
  tasks: 3
  commits: 1
---

# Phase 13 Quick: egress audit gap (T-13-13) + SC-04 + SC-05

Under `DEMO_OPEN=1` the break-glass `X-Admin-Token` can now change the instance egress switch with
exactly one attributed `egress-settings-changed` audit row; an audit failure leaves the setting unwritten.
The `/API/...` 404 carries `no-store`; the media upload failure log names only the error code.

Base `297cf2b`, commit `5a329aa`.

## What changed (server.js, three regions only)

### 1. T-13-13 [MEDIUM] - `POST /api/admin/egress`

Root cause (as audited): the `/api` gate resolves the token to the `admin-token` identity, then the
open-mode branch sets `req.portalUser = null`; the route re-admits the token via `isAdminRequest()`,
persisted via `egress.set()`, then `recordSecurityEvent({ actor: null })` threw -> 500, change applied,
no row.

- **Actor:** `req.portalUser || (isAdminRequest(req) ? { username: 'admin-token', role: 'admin', sessionId: null, dealId: null } : null)`.
  This is byte-for-byte the shape the `/api` gate assigns the token (`server.js` gate, the `admin-token-use`
  event), so the identity is the same stable break-glass name everywhere. The token value is never written.
- **Audit order decision - audit FIRST, then write.** `after` is computed locally from `before` + the
  patch's known boolean keys (the same overlay `lib/egress.js set()` stores), the event is recorded, and only
  then `egress.set(patch)` runs. A failed audit (no actor, audit.db unavailable/busy) throws with nothing
  persisted: an egress change can no longer exist unaudited. The two stores (runtime.db setting, audit.db
  chain) are separate connections, so true atomicity is not available; audit-first picks the safe failure
  direction.
- **Residual of audit-first, closed:** if the setting write fails/is busy AFTER the audit row, the audit
  log would claim a change that did not happen. The catch records a best-effort compensating
  `egress-settings-change-failed` event (same actor/before/after) and rethrows the original error, so the
  existing 503 (busy) / 500 mapping is unchanged. This new action name is the one addition beyond the brief;
  it is two lines inside the same handler.
- 403 (non-admin / anonymous / wrong token) and 400 (no egress key, unknown key, non-boolean) are unchanged.

### 2. SC-04 [info] - `/API/...` 404 guard
`res.set('Cache-Control', 'no-store')` before the fixed `{"error":"Not found"}` 404 (the guard answers before
the `/api` no-store middleware). The `no-store` static-order test in `caching-safe07` keys on the middleware
string and is unaffected.

### 3. SC-05 [info] - media failure log
`POST /api/media`: `console.error('Media upload failed:', e)` -> logs `e.code` only (validated against
`/^[A-Z0-9_]{1,40}$/`, else `unknown`). The response body (`{ error: 'Media upload failed.' }`) and the
`isBusyError(e) -> throw e` branch are unchanged.

## Sibling sweep (same bug class: `isAdminRequest` re-admission + `recordSecurityEvent` on `req.portalUser`)

| Site | Verdict |
|---|---|
| `POST /api/admin/egress` | the bug - fixed |
| `POST /api/deals/:id/members` (`isAdminRequest` then `actor: req.portalUser`) | NOT affected: `/api/deals/*` is `CONTROL_PLANE` (`db/resolver.js isControlPlanePath`) -> `req.isDemo` false -> never open mode -> `req.portalUser` stays the token identity |
| `POST /api/admin/users/:username/revoke-sessions` (`refuseNonAdmin` then audit) | NOT affected: `/api/admin/users/*` is control-plane; the audit call is additionally guarded by `if (req.portalUser)` |
| `POST /api/settings` (`isAdminRequest`, no audit call) | n/a - no `recordSecurityEvent` |
| `GET /api/admin/csp-violations`, `/api/admin/egress` GET | read-only, no audit call (token still 200 - asserted) |
| remaining `recordSecurityEvent(actor: req.portalUser)` sites (account, deal-lifecycle, org/DD read events, report export) | control-plane or real-deal-DB routes, never open-mode reachable; none re-admit via `isAdminRequest` |

Slide upload / slide delete / media delete handlers: no `console.*` of an fs error object (slide upload's
catch is silent; media delete swallows by design) - nothing further to fix for SC-05.

## Tests added (all new rows red on `297cf2b`'s server.js, green now)

- `test/egress-settings.test.js`
  - `demo-open + X-Admin-Token (T-13-13): POST /api/admin/egress -> 200 and exactly one egress-settings-changed row, actor admin-token, before/after; csp-violations with the token is 200`
    (also: anon and wrong-token POST -> 403 with nothing stored/audited; token value absent from the audit rows; anon csp-violations 403)
  - `demo-open + X-Admin-Token (T-13-13): a failed audit write leaves the setting UNCHANGED (non-200); a failed setting write is logged as egress-settings-change-failed; a retry then succeeds`
    (child process only: an `NODE_OPTIONS=--require` preload in the temp dir wraps `auditHook.recordSecurityEvent`
    for the egress event / `controlStore.setEgressSettings`, switched by a flag file; no helper change)
- `test/caching-safe07.test.js`: `SAFE-07 (a) / SC-04: the non-canonical /API/... 404 guard ... carries Cache-Control: no-store` (`/API/auth/mode`, `/Api/raid`, `/%61pi/auth/mode`)
- `test/media-upload-safety.test.js` (the "test you must amend" - the media suite): `media-upload-safety (h) / SC-05: a failed upload logs the error CODE only ...`
  (patches `fs.writeFileSync` to throw an `ENAMETOOLONG` carrying the path, spies `console.error`; asserts no file-name/path text and nothing written)

All isolated `MA_*` temp paths; no server touched committed `data/*.db`; `git status --porcelain data/ public/sent_emails/` empty.

## Verification

- Targeted: `node --test test/egress-settings.test.js test/caching-safe07.test.js test/media-upload-safety.test.js` -> 48/48 pass.
- Red check: with `server.js` reverted to base, exactly the 4 new rows fail.
- Full suite (worktree root, backgrounded): **`# tests 1709  # pass 1708  # fail 0  # skipped 1  EXIT=0`** (base 1705 + 4 new rows).

## Deviations from the brief

1. **Added `egress-settings-change-failed` event** (see section 1) so audit-first cannot leave a row for a change that did not occur. Brief asked "BEFORE (or transactionally with)"; the compensating row is the cheapest way to keep the log truthful across two separate SQLite connections. Easy to drop if undesired.
2. The brief's actor literal omits `dealId: null`; the gate's token identity includes it, so the full gate shape is used (the audit writer reads only `username/role/sessionId`).
3. Media log: `e.code` is validated rather than printed raw (a hostile/odd code string can never carry a name).

## Out of scope (unchanged)
SC-01 (docs, 13-14), SC-02 media quota (Phase 14 plan 14-03), SC-03 anonymous read of egress booleans in demo-open (document only), SC-06/07/08.

## Self-Check: PASSED
- `server.js`, the three test files and this SUMMARY exist; commit `5a329aa` is on `worktree-agent-ad1888c204bc2ad6e`.
- No unexpected deletions; STATE.md / ROADMAP.md untouched.
