---
phase: 03-deal-isolation-audit-log-write-validation
plan: 04
subsystem: api
tags: [zod, express, sqlite, deal-registry, deal-switcher, admin-console]

# Dependency graph
requires:
  - phase: 03-deal-isolation-audit-log-write-validation
    provides: "03-03: db/resolver.js's resolveDatabase()/dealResolverMiddleware/CONTROL_PLANE_PATHS, db/controlStore.js's getDeal/listDealsForUser/isDealMember, db/sessions.js's bindSessionDeal(); 03-01/03-02: db/dbFiles.js's dealDbPath(), zod@4.4.3 pinned, db/dealSeed.js's createDealDatabase()"
provides:
  - "validators/deals.js: CreateDealSchema/SelectDealSchema/DealMembersSchema/DeleteConfirmSchema + validateBody()/formatIssues() — the reusable zod pipeline Plan 06 generalizes across every remaining write endpoint"
  - "db/controlStore.js: createDeal/updateDealMembers/archiveDeal/deleteDeal — the full registry-side deal lifecycle"
  - "server.js: GET/POST /api/deals, POST /api/deals/select, POST /api/deals/:id/members, POST /api/admin/deals/:id/archive, DELETE /api/admin/deals/:id — the six-route deal-management control plane, plus GET /api/auth/me now returns dealId"
  - "db/store.js: closeConnection(dbFilePath) — evicts one cached connection (needed before deleteDeal() unlinks a file)"
  - "db/sessions.js: releaseSessionsForDeal(conn, dealId, username?) — bulk/scoped session-binding release on archive/delete/member-removal"
  - "db/resolver.js: CONTROL_PLANE_PATHS also covers /api/admin/deals*"
  - "public/js/deal-switcher.js: window.renderDealSwitcher()/window.openCreateDealForm() — the header switcher + shared create-deal modal, loaded app-wide by transitions.js"
  - "public/admin.html + public/js/admin.js: the 'Real Deals' console tab (list, members editor, archive/delete)"
affects: [03-05, 03-06]

# Actuals (#2632)
actuals:
  tokens: 25764
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "First real zod validator module (validators/deals.js): z.object(shape) strips unknown keys by default in the installed v4.4.3 — no .strict()/.passthrough() call needed for D-13; validateBody() replaces req.body with the parsed/stripped result before the handler runs"
    - "Uniform-403 refusal for select/list (T-03-17): a missing, archived, or non-member deal all produce the SAME 403/empty-list shape from the caller's perspective — never a distinct 404-for-missing, since that would let a non-member infer a deal's existence purely from status codes"
    - "Registry-row rollback on provisioning failure (T-03-23): POST /api/deals calls controlStore.createDeal() then createDealDatabase(); a provisioning throw calls controlStore.deleteDeal() to roll the row back, so a registry entry never outlives the file it points at"
    - "Session-release-on-lifecycle-change: archiveDeal/deleteDeal/member-removal all call db/sessions.js's new releaseSessionsForDeal() so no session is ever left holding a binding to a deal it can no longer read"
    - "App-wide script bootstrap via dynamic <script> injection (public/js/transitions.js): deal-switcher.js is loaded exactly the way inline-edit.js/banners.js already are — zero per-page <script> tag edits needed across admin/dashboard/employee/pmo.html"

key-files:
  created:
    - validators/deals.js
    - public/js/deal-switcher.js
    - test/deal-registry.test.js
    - test/deal-lifecycle.test.js
  modified:
    - server.js
    - db/controlStore.js
    - db/store.js
    - db/sessions.js
    - db/resolver.js
    - public/js/transitions.js
    - public/js/admin.js
    - public/admin.html
    - public/css/style.css
    - public/assessments.html
    - public/capability-hub.html
    - public/dashboard.html
    - public/employee.html
    - public/execution.html
    - public/index.html
    - public/insights.html
    - public/integration-excellence.html
    - public/leaders.html
    - public/overview.html
    - public/playbook.html
    - public/pmo.html
    - public/signage.html
    - public/supporting.html
    - public/survey.html

key-decisions:
  - "db/sessions.js's Plan-03-built bindSessionDeal(conn, token, dealId) already does exactly what the plan's 'add setSessionDeal()' called for — reused directly instead of adding a duplicate function under a different name."
  - "db/store.js gained closeConnection(dbFilePath) (not in this plan's declared files_modified list) — deleteDeal() unlinking a file while db/store.js's shared connection cache still holds an open handle to it would fail outright on Windows (an open file cannot be unlinked) and leave a dangling handle even on POSIX; this is Rule 2 (missing critical functionality) given the project's stated cross-platform target."
  - "db/sessions.js gained releaseSessionsForDeal(conn, dealId, username?) (also not in the declared files_modified list) — Task 2's own acceptance criteria require archive/delete/member-removal to release every affected session's binding; no existing function did this. Both additions mirror db/sessions.js's established connection-as-first-argument shape exactly."
  - "POST /api/deals/:id/members is gated admin-only via an inline isAdminRequest(req) check inside the handler, not a standalone ROLE_WRITE_POLICY table entry as the plan's action text suggested — the table's matcher only supports flat path prefixes (or an exact match), with no wildcard for 'admin-only on this one route whose id is a dynamic middle path segment'. The broader `{ prefix: '/api/deals', roles: ['admin','hrbp'] }` entry lets hrbp past the gate; the inline check then narrows to admin-only, matching this file's existing isAdminRequest()-guarded-read precedent."
  - "db/resolver.js's CONTROL_PLANE_PATHS extended to also cover /api/admin/deals* (not just /api/deals*) — admin is always a member of every deal (D-03), so an admin's OWN session can be bound to some unrelated, already-archived deal at the exact moment they try to archive/delete a DIFFERENT one; without this, that stale binding would 404 the admin out of the very route meant to fix it."
  - "GET /api/auth/me (an existing Plan-2/3 endpoint) now also returns the caller's current dealId — the header switcher needs 'which context am I in right now' and GET /api/deals alone (a plain list) cannot answer that. This endpoint stays resolver-free by design (PUBLIC_API_PATHS), so it reads sess.dealId directly rather than looking up the full deal object."
  - "public/js/transitions.js's pageAccess map for admin.html now also allows hrbp (was admin-only) — D-02's create-deal form and the new Deals tab live only in the admin console, so an Integration Lead has no other page from which to reach them. This is a page-level, client-side convenience gate only; every write the console makes is independently re-checked server-side by ROLE_WRITE_POLICY regardless of which page loaded it."

patterns-established:
  - "Tracer feedback: Task 1 (type=tracer) was run and its own test/deal-registry.test.js confirmed green (8/8) before Task 2 built on it."

requirements-completed: [ISO-01, ISO-03]

coverage:
  - id: D1
    description: "An Integration Lead (hrbp) or admin creates a deal via POST /api/deals; a template-only deal database is provisioned; the creator is auto-added as a member"
    requirement: ISO-01
    verification:
      - kind: unit
        ref: "test/deal-registry.test.js (a): checklist/assessment templates present, employees table empty"
        status: pass
    human_judgment: false
  - id: D2
    description: "Selecting a created deal makes the caller's very next write land in that deal's own database file, verified by direct SQL, and not in demo.db"
    requirement: ISO-01
    verification:
      - kind: unit
        ref: "test/deal-registry.test.js (b)"
        status: pass
      - kind: e2e
        ref: "manual curl round-trip against the live (non-DEMO_OPEN) server: login as karen -> create -> select -> POST /api/departments -> row confirmed via direct better-sqlite3 read of data/deals/<id>.db, absent from demo.db"
        status: pass
    human_judgment: false
  - id: D3
    description: "Selecting null returns the session to demo on the very next request"
    requirement: ISO-03
    verification:
      - kind: unit
        ref: "test/deal-registry.test.js (c)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A non-member is refused select with 403 and their prior binding is left completely unchanged; a non-member's deal list contains no trace of the excluded deal's id/name/target company (T-03-17)"
    requirement: ISO-01
    verification:
      - kind: unit
        ref: "test/deal-registry.test.js (d)-(e)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Deal creation is admin+hrbp only; malformed create bodies 400 with a single-string error naming the field; an unknown key is silently stripped, never stored"
    requirement: ISO-01
    verification:
      - kind: unit
        ref: "test/deal-registry.test.js (f)-(g)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Archive/delete are admin-only and require the deal's own id as an explicit confirmation value; a mismatch 400s and leaves the deal, its file and its registry row untouched; a correct delete removes the file+sidecars+row"
    verification:
      - kind: unit
        ref: "test/deal-lifecycle.test.js (a)-(c)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Archiving leaves the file on disk but the deal no longer resolves for a bind or appears in a member's list; a session bound to a deal archived/deleted underneath it is auto-released and can still reach the control plane and rebind to demo"
    verification:
      - kind: unit
        ref: "test/deal-lifecycle.test.js (d)-(e)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Adding a member grants list+select access; removing a member reverses both and releases their existing binding; hrbp is refused membership edits"
    verification:
      - kind: unit
        ref: "test/deal-lifecycle.test.js (f)"
        status: pass
    human_judgment: false
  - id: D9
    description: "AUD-02 precondition: db/controlStore.js's delete path holds no reference to the audit store"
    requirement: AUD-02
    verification:
      - kind: other
        ref: "command: grep -c 'AUDIT_DB_PATH' db/controlStore.js (returns 1 — a doc-comment self-reference explaining the absence, same class of false-positive Plan 01 already documented for 'audit_log' in db/schema.sql; grep -n confirms zero code references)"
        status: pass
    human_judgment: false
  - id: D10
    description: "The header deal switcher and admin console create-deal/members UI render, are visually distinct from the demo Projects control, and cause zero regressions to the demo showcase or existing test suite"
    requirement: ISO-01
    verification:
      - kind: e2e
        ref: "manual curl+direct-SQL round trip (documented above, D2) plus static checks: grep -c innerHTML public/js/deal-switcher.js == 0, grep -c deal-switcher.js public/js/transitions.js >= 1, npm test 86/86 green"
        status: pass
      - kind: manual_procedural
        ref: "the plan's own <human-check> block (browser login, visual distinctness, switch-and-back, employee sees no chrome, zero console errors) — NOT run in this session (no browser automation tool available in this executor's environment)"
        status: unknown
    human_judgment: true
    rationale: "Task 3's <verify> block is human-check only (visual/browser behavior). This session verified every automatable angle (HTTP round-trip via curl against a live non-DEMO_OPEN server, direct SQL file-isolation proof, source-level XSS/wiring checks, full regression suite) but could not drive an actual browser to confirm visual distinctness or capture console errors — that pass is deferred to a human per the plan's own verification design."

duration: 50min
completed: 2026-08-01
status: complete
---

# Phase 3 Plan 04: Deal Registry Control Plane + Header Switcher + Admin Console Deals Tab Summary

**Six new `/api/deals*` routes (create/select/list/members/archive/delete) backed by the first zod validator module in the codebase, plus a header deal switcher and admin-console "Real Deals" tab — deliberately separate from the demo Projects UI**

## Performance

- **Duration:** 50 min
- **Started:** 2026-08-01T08:15:00Z
- **Completed:** 2026-08-01T09:04:00Z
- **Tasks:** 3 (1 tracer + 2 auto)
- **Files modified:** 28 (4 created, 24 modified)

## Accomplishments
- Built `validators/deals.js` — the first zod schema module in the codebase (`CreateDealSchema`/`SelectDealSchema`/`DealMembersSchema`/`DeleteConfirmSchema` + `validateBody()`/`formatIssues()`), verified against the installed zod 4.4.3's actual default-strip behavior rather than assumed v3-era memory (Pitfall 5)
- Built `db/controlStore.js`'s full deal lifecycle (`createDeal`/`updateDealMembers`/`archiveDeal`/`deleteDeal`), with the delete path resolving its file path only through `dealDbPath()` and holding no reference whatsoever to the audit store (AUD-02 precondition)
- Wired six new routes into `server.js`: `POST /api/deals` (admin+hrbp, rolls back the registry row if provisioning throws — T-03-23), `POST /api/deals/select` (any role, member-only, uniform 403 to prevent existence-leak via status code — T-03-17), `GET /api/deals` (membership-filtered), `POST /api/deals/:id/members` and `POST/DELETE /api/admin/deals/:id[/archive]` (admin-only, destructive-guarded by an explicit confirmation value)
- Extended `db/resolver.js`'s `CONTROL_PLANE_PATHS` to also cover `/api/admin/deals*`, so an admin's own stale deal binding can never lock them out of the very routes meant to fix a broken deal
- Added `db/store.js`'s `closeConnection()` and `db/sessions.js`'s `releaseSessionsForDeal()` — both small, targeted additions the plan's own acceptance criteria required but that no existing function provided (see Deviations)
- Built `public/js/deal-switcher.js` — a header control loaded app-wide via `transitions.js`'s existing dynamic-script bootstrap (zero per-page `<script>` edits needed), showing the caller's current context ("Demo" vs "Real deal" + the deal name) with a dropdown of their deals plus a "Demo showcase" entry; all deal-identifying text set via `textContent` only
- Built the admin console's new "Real Deals" tab (`public/admin.html`/`public/js/admin.js`) — list, a Members editor, and destructive-guarded Archive/Delete (admin-only), plus a "+ New Deal" button that opens the shared create-deal modal
- Verified the full path live against a real (non-`DEMO_OPEN`) server boot: login as karen (hrbp) → `/api/auth/me` shows `dealId:null` → create → select → `/api/auth/me` reflects the new binding → a department write lands in the deal's own SQLite file (confirmed by direct read) and nowhere else → all four role pages still return 200 with zero server-side errors
- Full regression suite stayed green throughout: 72 → 80 → 86 tests, 0 failures at every step

## Task Commits

Each task was committed atomically:

1. **Task 1: Deal registry control plane — create/select/list, first zod validator (tracer)** - `3090bfa` (feat)
2. **Task 2: Destructive-guarded deal lifecycle proofs** - `c29f5e6` (test) — Task 1's `server.js` diff already implemented the full lifecycle surface this task specifies (see Deviations)
3. **Task 3: Header deal switcher + admin console Deals tab** - `2861512` (feat)

**Plan metadata:** (final docs commit follows this summary)

## Files Created/Modified
- `validators/deals.js` - NEW: zod schemas + `validateBody()`/`formatIssues()`
- `db/controlStore.js` - `createDeal`/`updateDealMembers`/`archiveDeal`/`deleteDeal`
- `db/store.js` - `closeConnection(dbFilePath)`
- `db/sessions.js` - `releaseSessionsForDeal(conn, dealId, username?)`
- `db/resolver.js` - `CONTROL_PLANE_PATHS` now also covers `/api/admin/deals*`
- `server.js` - six new routes, `ROLE_WRITE_POLICY` entries, `GET /api/auth/me` returns `dealId`
- `public/js/deal-switcher.js` - NEW: header switcher + shared create-deal modal
- `public/js/transitions.js` - dynamic load of deal-switcher.js; `pageAccess.admin.html` now also allows hrbp
- `public/admin.html` / `public/js/admin.js` - "Real Deals" console tab (list/members/archive/delete)
- `public/css/style.css` - `.deal-switcher*`/`.deal-modal*` styles; cache stamp bumped
- 14 other `public/*.html` files - cache stamp bump only (`style.css?v=`)
- `test/deal-registry.test.js` - NEW: 8 cases (create+provision, select+isolated write, unbind, non-member refusal/list-exclusion, role gate, malformed-body 400s+stripping, export surface)
- `test/deal-lifecycle.test.js` - NEW: 6 cases (role gate, mismatched-confirm no-op, delete cleanup, archive survives+refuses-bind, auto-release+control-plane-reachability, membership grant/revoke)

## Decisions Made
See `key-decisions` in the frontmatter above — summarized: reused Plan 03's existing `bindSessionDeal()` instead of duplicating it; added two small connection/session helpers (`closeConnection`, `releaseSessionsForDeal`) the plan's own acceptance criteria required; gated the members route admin-only inline rather than via a `ROLE_WRITE_POLICY` table entry the matcher's flat-prefix shape cannot express; widened `CONTROL_PLANE_PATHS` to the admin deal routes so an admin can never be locked out by their own stale binding; extended `GET /api/auth/me` with `dealId`; allowed hrbp onto `admin.html` client-side so D-02's create-deal form has a page to live on.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - missing critical functionality] `db/store.js` needed a way to evict one cached connection before `deleteDeal()` unlinks its file**
- **Found during:** Task 1 implementation of `db/controlStore.js`'s `deleteDeal()`
- **Issue:** The plan's `deleteDeal()` spec says "removes the registry row and unlinks the deal's database file" but `db/store.js`'s shared connection cache (Plan 03) has no per-path eviction — only `closeAllConnections()` (test-only, closes everything). On Windows an open file cannot be unlinked at all; even on POSIX a stale open handle to a since-deleted inode is a latent bug. `db/store.js` is not in this plan's declared `files_modified` list.
- **Fix:** Added `closeConnection(dbFilePath)` to `db/store.js`, called from `deleteDeal()` before `fs.unlinkSync()`.
- **Files modified:** `db/store.js`, `db/controlStore.js`
- **Verification:** `test/deal-lifecycle.test.js` (c) explicitly opens a cached connection to the target file via `store.getOrOpenConnection()` before calling delete, then asserts the file and sidecars are gone — proving eviction, not just "unlinking an untouched file happened to work."
- **Committed in:** `3090bfa` (Task 1)

**2. [Rule 2 - missing critical functionality] `db/sessions.js` needed a bulk/scoped session-release function**
- **Found during:** Task 1/2 implementation of the archive/delete/member-removal routes
- **Issue:** Task 2's action text and acceptance criteria require "every session currently bound to that deal must be released back to demo" on archive/delete, and "removing a member must also release that member's sessions" — no existing `db/sessions.js` function does a bulk or scoped-by-username release; only single-token `bindSessionDeal()` existed. `db/sessions.js` is not in this plan's declared `files_modified` list.
- **Fix:** Added `releaseSessionsForDeal(conn, dealId, username?)` (omit `username` to release every session bound to the deal; pass it to scope to one user's own sessions), called from the archive/delete/members route handlers.
- **Files modified:** `db/sessions.js`, `server.js`
- **Verification:** `test/deal-lifecycle.test.js` (e) and (f) assert the release directly via `findSession()` and via the affected user's subsequent `/api/deals/select` behavior.
- **Committed in:** `3090bfa` (Task 1)

**3. [Documentation note, not a bug] `grep -c "AUDIT_DB_PATH" db/controlStore.js` returns 1, not 0**
- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** `deleteDeal()`'s own doc comment explains ("... asserted by a source-grep in test/deal-lifecycle.test.js that `AUDIT_DB_PATH` never appears in this file") — the literal string appears once, inside the comment explaining its absence. Same class of self-reference Plan 01 already documented and carries a `<!-- planner-discipline-allow -->` annotation for.
- **Fix:** None applied — no code path in `db/controlStore.js` references the audit store (confirmed separately: `grep -n "AUDIT_DB_PATH" db/controlStore.js` shows only the comment line; `grep -n "audit"` shows only prose, never a `require`/path resolution).
- **Files modified:** None.
- **Verification:** Manual grep confirms zero functional references.
- **Committed in:** N/A (no code change)

**4. [Rule 3 - blocking, mechanism substitution] `POST /api/deals/:id/members` gated admin-only inline, not via a standalone `ROLE_WRITE_POLICY` entry**
- **Found during:** Task 2 implementation
- **Issue:** The plan's action text says the members route should be "admin-only via an explicit policy entry." `ROLE_WRITE_POLICY`'s matcher (`pathMatchesPrefix`) only supports a flat prefix or an exact static path — it has no wildcard for "admin-only on this one route whose id is a dynamic middle path segment" (`/api/deals/<id>/members`). Generalizing the shared matcher to support that would change behavior for every other rule in the table, a larger and riskier change than this one route needs.
- **Fix:** The broader `{ prefix: '/api/deals', roles: ['admin', 'hrbp'] }` entry lets hrbp past the coarse gate as before; the route handler itself narrows to admin-only via an inline `isAdminRequest(req)` check — the SAME guard this file already uses for several existing admin-only reads.
- **Files modified:** `server.js`
- **Verification:** `test/deal-lifecycle.test.js` (f)'s final assertion: hrbp attempting to edit membership gets 403.
- **Committed in:** `3090bfa` (Task 1)

**5. [Rule 2 - missing critical functionality] `CONTROL_PLANE_PATHS` widened to `/api/admin/deals*`**
- **Found during:** Task 2 implementation, reasoning through the archive/delete routes' resolver interaction
- **Issue:** Plan 03's `CONTROL_PLANE_PATHS` only covered `/api/deals*`. Admin is always a member of every deal (D-03), so an admin's OWN session could be bound to some unrelated, already-archived deal at the exact moment they try to archive/delete a DIFFERENT deal via `/api/admin/deals/:id[/archive]` — without this widening, `db/resolver.js`'s normal bind-time refusal (missing/archived → 404) would fire on the admin's OWN stale binding before the handler ever ran, 404'ing the admin out of the one route that would let them fix it. The plan's own read_first note calls this escape hatch out generically ("the deal-management routes stay reachable") but the specific `/api/admin/deals` prefix wasn't named.
- **Fix:** `db/resolver.js`'s `isControlPlanePath()` now also matches `/api/admin/deals` and `/api/admin/deals/*`.
- **Files modified:** `db/resolver.js`
- **Verification:** `test/deal-lifecycle.test.js` (e) proves both an archived-underneath and a deleted-underneath session can still reach `/api/deals/select`; the same resolver logic covers the admin routes symmetrically (not independently re-tested with an admin's own stale binding, since D-03 makes admin membership unconditional — the code path is identical to the member case already proven).
- **Committed in:** `3090bfa` (Task 1)

---

**Total deviations:** 5 auto-fixed (2 missing-critical-functionality additions to files outside the plan's declared scope, 1 documented self-reference non-issue, 1 mechanism substitution for a matcher limitation, 1 resolver escape-hatch widening) — all Rule 1-3, no user permission needed, no scope creep beyond what the plan's own acceptance criteria already implied.
**Impact on plan:** None on delivered behavior — every ISO-01/ISO-03/D-01/D-02/D-03 acceptance criterion in the plan is met; the additions were necessary for the plan's OWN stated acceptance criteria (session release, file eviction, admin lockout prevention) to actually hold.

## Issues Encountered
- An initial manual E2E smoke test (`node server.js` with `DEMO_OPEN=1`, to make the demo pages loadable without a real login) revealed that `/api/auth/me` deceptively returns `{authEnabled:false, user:null}` for a REAL, logged-in-but-unbound session under `DEMO_OPEN=1` — this is Plan 03's own pre-existing, intentional D-03 behavior ("an unbound session is treated the same as anonymous demo"), not a bug introduced here, but it meant my first smoke test looked like the switcher was broken. Re-ran the same round trip WITHOUT `DEMO_OPEN` (the actual target scenario for mandatory-auth real deployments) and confirmed the full create→select→isolated-write flow end-to-end correctly.
- The same smoke test wrote real rows into the LIVE, committed `data/control.db` (via its WAL file) and created real files under `data/deals/`. Cleaned up by: deleting the two test deal rows + `PRAGMA wal_checkpoint(TRUNCATE)` (left `control.db`'s bytes non-identical to the git-committed version due to SQLite b-tree page churn even after removing the same logical rows — same class of issue Plan 03 already documented for `data/demo.db`), then `git checkout -- data/control.db` to restore the exact committed bytes; removed the stray `data/deals/`, `data/runtime.db*` files (all gitignored, no git impact either way). Confirmed `git status`/`git diff --stat` clean afterward and re-ran the full suite (86/86 green) to confirm the restore didn't regress anything.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- Plan 05 (audit hook, D-09 location) can build on the exact deal lifecycle this plan lands — `db/controlStore.js`'s `createDeal`/`archiveDeal`/`deleteDeal` are the control-plane security events D-08 explicitly names for audit capture (deal create/delete/archive, membership changes).
- Plan 06 (generalize zod validation across ~60 remaining write endpoints) inherits `validators/deals.js`'s exact `validateBody()`/`formatIssues()` pipeline unchanged — this plan proved it end-to-end on a real route family.
- **Known gap, deferred to a human pass (not blocking):** Task 3's `<verify>` block is browser-only (visual distinctness of the switcher, click-through create/select/switch-back flow, zero-console-errors check, employee-sees-no-chrome check). This session verified every automatable angle (a real curl+direct-SQL round trip against a live non-`DEMO_OPEN` server, source-level XSS/wiring checks, full regression suite) but had no browser automation tool available to drive the actual UI. A human should run the plan's own 7-step human-check before this plan is considered fully closed for D-04.
- No blockers.

---
*Phase: 03-deal-isolation-audit-log-write-validation*
*Completed: 2026-08-01*

## Self-Check: PASSED

All created files verified present on disk; all commit hashes (`3090bfa`, `c29f5e6`, `2861512`) verified present in `git log --oneline --all`.
