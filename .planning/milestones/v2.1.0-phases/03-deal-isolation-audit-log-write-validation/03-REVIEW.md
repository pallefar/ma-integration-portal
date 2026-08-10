---
phase: 03-deal-isolation-audit-log-write-validation
reviewed: 2026-08-02T00:00:00Z
depth: standard
files_reviewed: 39
files_reviewed_list:
  - .gitignore
  - db/audit-schema.sql
  - db/auditHook.js
  - db/collections.js
  - db/control-schema.sql
  - db/controlStore.js
  - db/dbFiles.js
  - db/dealSeed.js
  - db/resolver.js
  - db/runtime-schema.sql
  - db/schema.sql
  - db/sessions.js
  - db/store.js
  - lib/sanitizeHtml.js
  - package.json
  - public/admin.html
  - public/css/style.css
  - public/js/admin.js
  - public/js/deal-switcher.js
  - public/js/transitions.js
  - scripts/list-unvalidated-routes.js
  - scripts/set-admin-password.js
  - scripts/split-db-into-control-demo-deals.js
  - server.js
  - test/audit-log.test.js
  - test/audit-security-events.test.js
  - test/db-artifact-exclusion.test.js
  - test/db-file-layout.test.js
  - test/db-split-migration.test.js
  - test/deal-isolation.test.js
  - test/deal-lifecycle.test.js
  - test/deal-registry.test.js
  - test/deal-resolver.test.js
  - test/deal-seed.test.js
  - test/demo-only-gating.test.js
  - test/migration-roundtrip.test.js
  - test/role-enforcement.test.js
  - test/session-lifecycle.test.js
  - test/write-validation-coverage.test.js
  - test/write-validation.test.js
  - test/xss-sanitization.test.js
  - validators/assessment.js
  - validators/cms.js
  - validators/deals.js
  - validators/index.js
  - validators/people.js
  - validators/settings.js
  - validators/workstream.js
findings:
  critical: 2
  warning: 3
  info: 1
  total: 6
status: resolved
fixed:
  - id: CR-01
    commit: 6f77e9f
    summary: restored missing `const db = readDb();` in POST /api/rag/upload
  - id: CR-02
    commit: b8dde3c
    summary: isOpenMode() short-circuit now runs validationMiddleware instead of skipping it (test added in 2945da8)
  - id: WR-01
    commit: 97e1347
    summary: queryAudit() orders DESC so the default page/pagination surfaces most-recent activity
  - id: WR-02
    commit: 8e7df78
    summary: resolveDatabase() returns a uniform 403 for missing/archived/non-member deals
  - id: WR-03
    commit: c656422
    summary: revoke-sessions and download-zip added to CONTROL_PLANE_PATHS
  - id: IN-01
    commit: 77624f4
    summary: deal switcher shows "Deal no longer available" instead of a contradictory "Demo showcase" label
fixed_at: 2026-08-02T00:00:00Z
verification:
  npm_test: "122/122 passed (baseline 116/116 + 6 new regression tests)"
  cr02_repro: "DEMO_OPEN=1 POST /api/i18n with {lang:123,key:null,value:{x:1},junk:'field'} now returns 400 (confirmed live, was 200 before the fix)"
---

# Phase 3: Code Review Report

**Reviewed:** 2026-08-02T00:00:00Z
**Depth:** standard
**Files Reviewed:** 39 source files (+ 20 test files read for cross-reference)
**Status:** resolved — all 6 findings fixed (2 critical, 3 warning, 1 info); see `fixed:` list in frontmatter for commit hashes. `npm test`: 122/122 passed.

## Summary

Phase 3 delivers a well-designed and carefully-documented deal-isolation/audit/validation architecture: the session-bound resolver refuses at bind time rather than filtering at read time (closing the cross-deal-leak class of bug by construction), the audit hook's actor-required-or-throw contract prevents anonymous compliance rows, `dealDbPath()`'s regex-validated id prevents path traversal into `data/deals/`, and the write-validation pipeline's schema-registry coverage gate (`findUnvalidatedWriteRoutes`) is a genuinely strong guardrail against a route silently shipping unvalidated. The 116-test suite is green and exercises the isolation/audit/validation guarantees convincingly.

Two real defects surfaced by direct code tracing (not caught by the existing test suite, since neither route/scenario is exercised by any test file):

1. `POST /api/rag/upload` is completely broken — a regression from this phase's own refactor, not a pre-existing bug.
2. The consolidated `/api` gate's `DEMO_OPEN=1` short-circuit bypasses the entire write-validation/sanitization pipeline this phase built, for every write route in the app, not just the auth/role checks it is documented to bypass.

Both are traced end-to-end below with exact line numbers. Three further logic/consistency issues are documented as warnings.

## Critical Issues

### CR-01: `POST /api/rag/upload` throws `ReferenceError: db is not defined` on every call — feature completely broken

**Status: RESOLVED** (commit `6f77e9f`) — restored `const db = readDb();` before the first `db.` reference; regression test added in `test/rag-upload.test.js` proves the happy path persists a real row (read back directly out of demo.db).

**File:** `server.js:890-948` (specifically lines 916, 924, 934, 935)

**Issue:** Before this phase, this handler read `const db = readDb(); const apiKey = db.settings.geminiApiKey || '';` (verified in the pre-phase-3 revision via `git show 9fda4b5497f82bfb42fc1781c06102aebfb0cf2d^:server.js`). Commit `333da21` ("session-bound resolver replaces the demoMode flag/shadow-array switch") correctly moved the secret lookup to `controlStore.getSecretSettings()` (line 916, since `geminiApiKey` now lives in `runtime.db`) but **deleted the `const db = readDb();` line without updating the three call sites below it that still reference `db`**:

```js
const apiKey = controlStore.getSecretSettings().geminiApiKey || '';   // line 916 — db never assigned
...
db.ragUploads = db.ragUploads || [];        // line 924 — ReferenceError: db is not defined
...
db.ragUploads.push(newUpload);              // line 934
writeDb(db);                                // line 935
```

`db` is not declared anywhere in this handler's scope, and `server.js` has no module-level `db` variable (verified: `grep -n "^const db\|^let db\|^var db" server.js` matches nothing but the `dbFiles` import). Every invocation of this route throws a `ReferenceError` inside the `try` block, is caught by the handler's own `catch`, logged, and returns `500 { success:false, error: 'Failed to process and train RAG model.' }`. The PDF text extraction, the AI Insight review (a real Gemini API call, if configured), and everything up to this point in the handler run and are silently thrown away — the upload record is never persisted and the RAG index is never retrained, regardless of file content or configuration.

No test file references `/api/rag/upload` (`grep -rln "rag/upload" test/` returns nothing), so this regression passed the full 116-test suite undetected.

**Fix:** Restore the read before the first `db.` reference:
```js
const db = readDb();
db.ragUploads = db.ragUploads || [];
```
placed before line 924 (any point after the try block's start and before the first `db.` use is fine — `apiKey` itself no longer needs `db`).

---

### CR-02: `DEMO_OPEN=1` silently bypasses the entire write-validation/sanitization pipeline (VAL-01/VAL-02), not just auth/authz

**Status: RESOLVED** (commit `b8dde3c`, test `2945da8`) — the `isOpenMode(req)` branch now routes through `validators.validationMiddleware` instead of returning `next()` directly. Live-confirmed: `DEMO_OPEN=1 POST /api/i18n` with `{lang:123,key:null,value:{x:1},junk:'field'}` now returns 400 (was 200 before the fix).

**File:** `server.js:403-437` (consolidated `/api` gate)

**Issue:** The gate's `isOpenMode(req)` branch returns `next()` directly, before the write-validation middleware is ever reached:

```js
resolver.dealResolverMiddleware(req, res, () => {
    if (isOpenMode(req)) { req.portalUser = null; return next(); }   // line 404 — short-circuits everything below
    if (!req.portalUser) return res.status(401)...
    ...
    if (requiresRoleCheck && !roleAllowedForWrite(...)) return res.status(403)...
    validators.validationMiddleware(req, res, next);                 // line 437 — never reached under DEMO_OPEN
});
```

The console warning this phase added (`server.js:180-182`) and every doc comment describe `DEMO_OPEN=1` as disabling "ALL /api authentication and authorization" — but the actual effect, as written, is broader: it also disables the shape validation, unknown-key stripping, string-length bounding (D-13), and HTML sanitization (VAL-02/D-15) that `validators/index.js#validationMiddleware` provides for *every* write route in the app, including `/api/pages`, `/api/courses/:courseId/lessons` (the two known HTML-sanitized fields), and every admin-only write (`/api/admin/migrate-db`, `/api/settings`, etc. — role checks are also skipped in this mode, so these become reachable with zero session at all).

This directly contradicts `validators/settings.js`'s own stated guarantee ("D-14: the same pipeline validates this route whether the caller is demo-bound or deal-bound") for the specific case of an unauthenticated `DEMO_OPEN` caller, and it is a real instance of the "routes bypassing the validation pipeline" class this review was specifically asked to check for. `test/role-enforcement.test.js`'s own `AUTH-04` test (`DEMO_OPEN` bypasses role/session entirely) proves the intentional auth bypass but never asserts anything about payload shape/sanitization, so this gap is untested.

Concrete consequence: under `DEMO_OPEN=1`, any anonymous caller can `POST /api/pages` (or any of the ~65 other write routes) with an unbounded payload and unsanitized HTML in the two write-time-tagged fields (`PageUpsertSchema.body`, `PageBlockDataSchema.html`) — the write-time regex sanitizer (`lib/sanitizeHtml.js`) never runs. The render-time `sanitize()` re-application in `public/js/page-layout.js` is a genuine second layer of defense for those two specific fields, but every *other* write-time protection (bounded string lengths, unknown-key stripping, enum constraints) is lost entirely for the whole request class, and an unbounded/malformed value can reach handlers that assume a validated shape — e.g. `server.js:2000`'s `provider.toUpperCase()` in `/api/admin/migrate-db` will throw a `TypeError` (caught generically, 500) if `provider` is not a string, which only the (now-bypassed) `MigrateDbSchema` would normally have rejected with a clean 400.

**Fix:** Run `validators.validationMiddleware` even in open-mode, or move the `isOpenMode` short-circuit to after validation instead of before it:
```js
resolver.dealResolverMiddleware(req, res, () => {
    if (isOpenMode(req)) {
      req.portalUser = null;
      return validators.validationMiddleware(req, res, next);
    }
    ...
```
(Validation doesn't depend on `req.portalUser`, so this reordering is safe.)

## Warnings

### WR-01: Admin audit log viewer's pagination is inverted relative to its own labels, and the default (first-loaded) page shows the OLDEST rows, not the most recent

**Status: RESOLVED** (commit `97e1347`) — `queryAudit()` now orders `DESC`, so offset=0 is the most recent page and the existing "← Newer"/"Older →" button wiring is now correct without touching admin.html; `admin.js`'s `rows.slice().reverse()` was removed. New regression test asserts the default page contains the highest-id rows.

**File:** `db/auditHook.js:165`, `public/js/admin.js:2681-2684`, `public/admin.html:165-167`

**Issue:** `queryAudit()` orders `ORDER BY id ASC LIMIT ? OFFSET ?` — ascending by autoincrement id, i.e. oldest-first. `renderAuditLog()` (`admin.js:2615`) does `rows.slice().reverse()` to display each fetched *page* most-recent-first, but pagination itself operates on the ascending-ordered full table:

- `auditOffset = 0` (the tab's default, initial load) fetches the **50 oldest** rows in the whole table — for any deployment with more than 50 accumulated audit rows, an admin opening the Audit Log tab does not see recent activity at all, only ancient history (reversed within that stale batch).
- The "← Newer" button (`btn-audit-prev`) **decreases** `auditOffset`, which moves *toward* the oldest rows (`offset=0`).
- The "Older →" button (`btn-audit-next`) **increases** `auditOffset`, which moves *toward* the most recent rows (since higher offset = higher id = later in time).

Both the default view and the two pagination buttons are backwards relative to what an admin investigating recent activity (the primary use case for a D-10 compliance/audit viewer) would expect, and relative to their own labels. This is not a data-loss bug (every row is still reachable via filters/paging or the `to`/`from` date filters), but for a deployment with meaningful audit history it means the default view of the one screen built for incident investigation is the least useful one, and clicking "Older →" actually surfaces newer events.

**Fix:** Either (a) sort the SQL query `DESC` and adjust offset semantics so `offset=0` is "most recent 50", or (b) keep `ASC` but compute an initial offset of `max(0, totalCount - AUDIT_PAGE_SIZE)` for the default view and swap the two buttons' offset deltas so "Older →" decreases and "← Newer" increases. Add a test asserting the first page rendered (no filters) contains the highest-id rows, not the lowest.

---

### WR-02: `db/resolver.js#resolveDatabase()` distinguishes 404 (deal missing/archived) from 403 (not a member) — contradicting this phase's own documented "uniform 403" anti-enumeration rule

**Status: RESOLVED** (commit `8e7df78`) — both branches now throw the same 403 with `/api/deals/select`'s own message. Test updated to assert 403 (not 404) for both the missing-deal and archived-deal cases.

**File:** `db/resolver.js:76-85` vs. `server.js:709-727` (`POST /api/deals/select`)

**Issue:** `POST /api/deals/select`'s own comment explicitly states: *"A refusal (missing/archived/non-member) is a uniform 403 in every case — a distinct 404-for-missing vs 403-for-non-member would let a caller enumerate which deal ids exist purely from the status code, exactly what T-03-17 forbids for a pre-announcement target's very existence."* — and its code matches that (`server.js:722`, single `403` branch covering all three cases).

`resolveDatabase()` — which runs on *every subsequent request* a deal-bound session makes, not just at select time — does the opposite:
```js
if (!deal || deal.status === 'archived') {
  throw new DealAccessError(404, 'That deal no longer exists.');   // distinguishable from...
}
if (!controlStore.isDealMember(dealId, req.portalUser)) {
  throw new DealAccessError(403, 'You are not a member of that deal.');  // ...this
}
```
In practice this is only reachable for a session that was *already* legitimately bound to a deal that has since been archived/deleted (an attacker cannot get their own session bound to an arbitrary deal id, since `bindSessionDeal` is only ever called from the uniformly-403'd select endpoint or the membership-release paths), so the practical enumeration risk is low. It is nonetheless a real inconsistency between the two enforcement points implementing the same "can this session see this deal" rule, and worth closing so the codebase doesn't have two different answers to the same anti-enumeration requirement it documented for itself.

**Fix:** Have `resolveDatabase()` return the same uniform 403 for both the missing/archived and non-member cases (a caller resolving deal *content* has no legitimate need to distinguish the two either).

---

### WR-03: `POST /api/admin/users/:username/revoke-sessions` and `GET /api/admin/download-zip` are not in `resolver.js`'s `CONTROL_PLANE_PATHS`, unlike the precedent already set for `/api/admin/audit` — an admin with a stale deal binding gets a confusing 404 from an action that has nothing to do with any deal

**Status: RESOLVED** (commit `c656422`) — both routes added to `CONTROL_PLANE_PATHS`, mirroring the `/api/admin/audit` precedent. Noted side effect: since a control-plane path always resolves to `req.isDemo=false`, `DEMO_OPEN`'s full auth bypass no longer applies to `revoke-sessions` specifically (matching the same pre-existing property `/api/admin/audit` already had) — `test/role-enforcement.test.js`'s `AUTH-04` probe was retargeted to `/api/admin/migrate-db` (an ordinary, non-control-plane admin write route) to preserve its original intent.

**File:** `db/resolver.js:31-43`, `server.js:2010-2028`, `server.js:852-874`

**Issue:** `db/resolver.js`'s own comment explains exactly why `/api/admin/audit` was added to `CONTROL_PLANE_PATHS`: *"the admin audit viewer must stay reachable regardless of the admin's OWN current deal binding... a missing/archived stale binding must never lock the admin out of the one place they can inspect the trail."* The same reasoning applies unchanged to `POST /api/admin/users/:username/revoke-sessions` (operates on `runtime.db`'s sessions table only, never calls `readDb()`/`writeDb()`) and `GET /api/admin/download-zip` (touches the filesystem directly, never calls `readDb()`/`writeDb()`) — neither route uses the resolved deal database at all, yet both are gated behind `dealResolverMiddleware`'s bind-time check because they are not control-plane paths. If the calling admin's own session happens to be bound to a deal that has since been archived or deleted, both routes 404 with `"That deal no longer exists."` — a confusing error for an action unrelated to any deal, and (per WR-02 above) a status code the codebase elsewhere avoids handing back specifically to prevent leaking deal-existence information. The admin can self-recover by calling `/api/deals/select` with `dealId: null` first, so this is not a hard lockout, but it is inconsistent with the fix already applied for the structurally identical `/api/admin/audit` case, and is easy to miss under load.

**Fix:** Add both paths (or a broader `/api/admin/users` prefix and `/api/admin/download-zip`) to `CONTROL_PLANE_PATHS`, mirroring the `/api/admin/audit` precedent — or, more generally, audit every `/api/admin/*` route for whether it actually calls `readDb()`/`writeDb()` and only require deal resolution for the ones that do.

## Info

### IN-01: `deal-switcher.js` can render a mismatched "Real deal" badge with the "Demo showcase" name if the session's bound deal isn't in the caller's own deal list

**Status: RESOLVED** (commit `77624f4`) — trivial, zero-risk cosmetic fix: falls back to "Deal no longer available" instead of "Demo showcase" when `currentDealId` is set but not found in the caller's deal list.

**File:** `public/js/deal-switcher.js:256-276`

**Issue:** `renderDealSwitcher()` computes `currentDeal = currentDealId ? deals.find(d => d.id === currentDealId) : null` against the caller's own `GET /api/deals` response (membership-filtered, active-only). If the session's server-side `dealId` (from `/api/auth/me`) points at a deal that is archived (and therefore excluded from `listDealsForUser()`'s active-only filter) or one the caller lost membership to since their last page load, `currentDeal` is `undefined` while `currentDealId` is still truthy — the trigger renders with the `deal-switcher--real` "Real deal" state badge but the name label falls back to `'Demo showcase'` (`currentDeal ? currentDeal.name : 'Demo showcase'`), producing a self-contradictory "Real deal / Demo showcase" chip. Purely cosmetic — the server independently re-enforces membership on every actual API call (`db/resolver.js`) — but worth a small guard (e.g. show the raw `currentDealId` or a "deal no longer available" label instead of "Demo showcase" when `currentDealId` is set but not found in `deals`).

---

_Reviewed: 2026-08-02T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
