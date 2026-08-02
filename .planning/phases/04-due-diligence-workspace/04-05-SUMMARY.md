---
phase: 04-due-diligence-workspace
plan: 05
subsystem: api
tags: [express, better-sqlite3, zod, access-control, audit-log, mnpi, vdr]

# Dependency graph
requires:
  - phase: 04-due-diligence-workspace (Plan 01)
    provides: db/accessPolicy.js's DD_AREAS/DD_AREA_IDS/filterByAreaGrant()/assertAreaGrant(), the ddRequestItems collection, ddRequestLane()/publicDdItem()/refuseDdArea()/ddAreaRefused() uniform-403 pattern
  - phase: 04-due-diligence-workspace (Plan 02)
    provides: the '/api/deals' ROLE_WRITE_POLICY entry (admin+hrbp) the vdr-grants route inherits unchanged, and the recordSecurityEvent()/before-after audit call shape the grants route already established
provides:
  - "vdrLink field on ddRequestItems rows — { url, folderRef, label, updatedAt, updatedBy } or null, at most ONE per item, set/cleared through the existing POST /api/dd/request-items upsert"
  - "GET /api/dd/vdr-links — the area-level aggregate of every item's data-room reference, clean-room filtered, omitting an uncleared area entirely"
  - "POST /api/deals/:id/vdr-grants — a structured, audited data-room access-grant record (vdr-access-grant security event), no separate collection"
  - "applyVdrLink() (server.js) — the single write path stamping updatedAt/updatedBy server-side and replacing the stored reference wholesale"
  - "public/js/due-diligence.js: per-item VDR reference editor, per-area 'Data room references' list, and the admin/hrbp-only 'Record data-room access grant' workspace-header form"
affects: [04-06-PLAN, 04-07-PLAN, 04-08-PLAN]

# Actuals (#2632)
actuals:
  tokens: 12590
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Replace-wholesale-never-merge reference field: vdrLink is not an array and is never appended to — applyVdrLink() always overwrites the stored object in full, so re-posting the same reference is naturally idempotent by construction rather than by a dedup check"
    - "Server-stamped provenance via undeclared schema keys: VdrLinkSchema does not declare updatedAt/updatedBy at all — zod's default unknown-key stripping does the work of ignoring a caller-supplied value, and the route handler is the only place either field is ever written"
    - "Access-grant-as-pure-audit-event: POST /api/deals/:id/vdr-grants writes no row to any collection — the compliance record IS the recordSecurityEvent() call, so it inherits the audit store's append-only, deal-deletion-survives properties for free"

key-files:
  created:
    - test/dd-vdr.test.js
  modified:
    - server.js
    - validators/dd.js
    - validators/deals.js
    - public/js/due-diligence.js
    - public/due-diligence.html

key-decisions:
  - "vdrLink folds into the EXISTING POST /api/dd/request-items upsert route rather than a dedicated route — matches the interface contract exactly and means the item's clean-room area guard (ddAreaRefused()) already covers the reference with zero new access-control code."
  - "The url is validated with z.string().url() PLUS an explicit .refine() checking the parsed protocol is http/https — verified live against the installed zod@4.4.3 that .url() alone accepts any scheme including javascript: (confirmed by a standalone node -e probe before writing the schema), so the bare .url() check would NOT have closed T-04-27 on its own."
  - "GET /api/dd/vdr-links does ONE aggregate fetch client-side (not one per area) — the server already groups by area, so public/js/due-diligence.js's load() adds exactly one more fetch to the Promise.all() alongside the existing per-area items/findings fetches."
  - "vdrRef on the access-grant record is a free-text operator-typed area/folder reference, deliberately distinct from vdrLink.url on the item — the grant records WHICH PART of the data room someone can see (a compliance decision), not a clickable pointer; conflating the two would have made the grant route accept a URL it has no reason to validate as one."

patterns-established:
  - "The route-inventory reflection test/auth-route-inventory.test.js established (walking app._router.stack for /api-prefixed routes) is reused verbatim (not re-derived) to prove a negative — no upload-shaped route exists — establishing this as the codebase's standard mechanism for 'a route category must never contain X' proofs, not just 'every route requires auth'."
  - "Source-inspection-by-marker-string: a test locates a named code SECTION by searching for its own header comment strings (not line numbers) and asserts a list of forbidden tokens (fs.writeFile, multer, req.files, ...) is absent from that substring — resilient to unrelated edits elsewhere in server.js, brittle only to a renamed section header, which is itself a meaningful signal worth a test failure."

requirements-completed: [DD-05]

coverage:
  - id: D1
    description: "A DD request item carries a reference to TE's own virtual data room (URL + folder/index ref), settable/clearable through the existing item upsert route, server-stamped with who/when, and replacing (never duplicating) any prior reference"
    requirement: "DD-05"
    verification:
      - kind: integration
        ref: "test/dd-vdr.test.js#dd-vdr (a): setting a reference on an item reads back with a server-stamped updatedAt and updatedBy"
        status: pass
      - kind: integration
        ref: "test/dd-vdr.test.js#dd-vdr (b): posting the same reference twice leaves exactly one reference, not a duplicate"
        status: pass
      - kind: integration
        ref: "test/dd-vdr.test.js#dd-vdr (c): an explicit vdrLink: null clears a previously-set reference"
        status: pass
      - kind: integration
        ref: "test/dd-vdr.test.js#dd-vdr (e): a caller-supplied updatedBy is ignored in favour of the session identity"
        status: pass
    human_judgment: false
  - id: D2
    description: "A vdrLink whose url is not an absolute http/https URL (non-web scheme or a relative path) is refused with a 400 naming the field, and the prior stored value is left unchanged"
    requirement: "DD-05"
    verification:
      - kind: integration
        ref: "test/dd-vdr.test.js#dd-vdr (d): a non-http scheme and a relative path are each refused with a 400 naming the field, leaving the stored value unchanged"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/dd/vdr-links aggregates every referenced item per functional area, clean-room filtered exactly like every other DD list route: only areas the caller is cleared for, and an uncleared area is omitted entirely rather than returned empty"
    requirement: "DD-05"
    verification:
      - kind: integration
        ref: "test/dd-vdr.test.js#dd-vdr (f): the aggregate route returns only areas the caller is cleared for"
        status: pass
      - kind: integration
        ref: "test/dd-vdr.test.js#dd-vdr (g): the aggregate route omits an area entirely when the caller lacks it, rather than returning it with an empty link list"
        status: pass
    human_judgment: false
  - id: D4
    description: "A data-room access grant (who, which VDR area/folder, granted by whom, when, optional note) is recorded as ONE attributed vdr-access-grant audit security event; a grant naming a username outside the deal's members is refused; two grants recorded back to back both persist as distinct rows"
    requirement: "DD-05"
    verification:
      - kind: integration
        ref: "test/dd-vdr.test.js#dd-vdr (h): an IL records a grant and exactly one vdr-access-grant audit row appears, carrying the actor, deal id, subject and record"
        status: pass
      - kind: integration
        ref: "test/dd-vdr.test.js#dd-vdr (j): a username outside the deal's members is refused with a 400 and no audit row appears"
        status: pass
      - kind: integration
        ref: "test/dd-vdr.test.js#dd-vdr (k): two grants recorded back to back both persist as two distinct audit rows with distinct subjects"
        status: pass
    human_judgment: false
  - id: D5
    description: "The access-grant route is limited to admin/hrbp — a pmo session is refused"
    requirement: "DD-05"
    verification:
      - kind: integration
        ref: "test/dd-vdr.test.js#dd-vdr (i): a pmo session is refused the access-grant route"
        status: pass
    human_judgment: false
  - id: D6
    description: "The app never accepts, stores or serves a diligence document itself — no upload-shaped write route exists under the DD path prefix, and the DD section of server.js contains no filesystem-write primitive"
    requirement: "DD-05"
    verification:
      - kind: integration
        ref: "test/dd-vdr.test.js#dd-vdr (l): the DD workspace never accepts, stores or serves a diligence document — no upload-shaped write route under the DD path prefix"
        status: pass
      - kind: other
        ref: "test/dd-vdr.test.js#dd-vdr (m): source inspection — the DD section of server.js performs no filesystem write"
        status: pass
    human_judgment: false
  - id: D7
    description: "The per-item VDR reference editor, per-area reference list, and the admin/hrbp-only access-grant form render in public/js/due-diligence.js — a stored URL is re-checked for scheme at render time before ever becoming an anchor, and every other value is textContent-only"
    verification:
      - kind: other
        ref: "grep -c innerHTML public/js/due-diligence.js == 0; grep -c noopener public/js/due-diligence.js == 2"
        status: pass
    human_judgment: true
    rationale: "No browser automation tool was available this session to visually confirm the rendered page. The zero-innerHTML/scheme-re-check-at-render/noopener properties are source-verified, but actual in-browser rendering (the per-item editor's save/clear flow, the per-area list layout, the grant form's role-gated visibility and confirmation line) has not been visually confirmed against a live server — matches the same human_judgment deferral pattern Plans 01-04 used for their own UI additions."

duration: ~35min
completed: 2026-08-02
status: complete
---

# Phase 4 Plan 5: Due-Diligence VDR Reference and Access-Grant Summary

**A DD request item can point at TE's own virtual data room (URL + folder ref, at most one per item, server-stamped), an area view aggregates every reference it is cleared to show, and every data-room access grant is an audited security event — the app never accepts, stores or serves a document itself.**

## Performance

- **Duration:** ~35 min of active work
- **Tasks:** 2 (both completed)
- **Files modified:** 6 (1 created, 5 modified)
- **Commits:** 2 task commits + this docs commit

## Accomplishments

- Extended `DdRequestItemUpsertSchema` (`validators/dd.js`) with `VdrLinkSchema`: an absolute http/https URL (verified live that zod's bare `.url()` accepts `javascript:` and needed an explicit `.refine()` on the parsed protocol), a required folder/index reference, and an optional label — `updatedAt`/`updatedBy` are deliberately UNDECLARED so a caller-supplied value is stripped by zod's default unknown-key behavior rather than needing an explicit reject
- Built `applyVdrLink()` (`server.js`): the single write path for `vdrLink` on both the create and update branches of `POST /api/dd/request-items` — replaces the stored reference wholesale (never merges/appends), stamps `updatedAt`/`updatedBy` server-side, clears on an explicit `null`, leaves the field untouched when the key is absent
- Added `GET /api/dd/vdr-links`: walks `ddRequestLane()`, keeps only items with a non-null `vdrLink`, runs the result through `filterByAreaGrant()` (the SAME clean-room filter every other DD list route uses), groups by `DD_AREAS` order/labels, and OMITS an area with no referenced item entirely (never returns it with an empty `links` array)
- Added `POST /api/deals/:id/vdr-grants` (`server.js`) + `VdrGrantSchema` (`validators/deals.js`): inherits the SAME admin+hrbp `/api/deals` `ROLE_WRITE_POLICY` entry the clean-room grants route already uses; refuses a `username` outside `deal.members` with a 400 (no fabricated compliance record); writes exactly ONE `recordSecurityEvent({ action: 'vdr-access-grant' })` — there is no separate collection, the audit log IS the record
- Extended `public/js/due-diligence.js`: a per-item data-room reference editor (URL/folder/label/clear), a per-area "Data room references" list from the aggregate route, and an admin/hrbp-only "Record data-room access grant" form in the workspace header — every rendered URL is re-checked for an http/https scheme at RENDER time (following `transitions.js`'s `openHtmlSlide` precedent) before ever becoming a clickable anchor, and the anchor carries `rel="noopener noreferrer"`
- Proved the whole slice — including a document-storage negative proof (no upload-shaped route under `/api/dd`, and no filesystem-write primitive anywhere in the DD section of `server.js`) — through 13 new integration tests in `test/dd-vdr.test.js`, all passing through the real HTTP stack against isolated temp databases

## Task Commits

Each task was committed atomically:

1. **Task 1: Per-item data-room reference and the area aggregate view** - `4e6072d` (feat)
2. **Task 2: Audited data-room access-grant records, and proof the app stores no documents** - `c5214c5` (feat)

## Files Created/Modified

- `test/dd-vdr.test.js` (new) - 13 integration tests: item-level vdrLink round-trip/idempotency/clearing/scheme-refusal/provenance-stamping (a-e), the aggregate's cleared-only/omit-uncleared-entirely shape (f-g), the access-grant route's attribution/role-gate/non-member-refusal/concurrent-persistence (h-k), and the document-storage proof (l-m)
- `server.js` (modified) - `applyVdrLink()`, `vdrLink` wiring into both branches of `POST /api/dd/request-items`, `GET /api/dd/vdr-links`, `POST /api/deals/:id/vdr-grants`
- `validators/dd.js` (modified) - `VdrLinkSchema`, folded into `DdRequestItemUpsertSchema`, exported for reuse
- `validators/deals.js` (modified) - `VdrGrantSchema`, registered for `POST /api/deals/:id/vdr-grants`
- `public/js/due-diligence.js` (modified) - `updateVdrLink()`, `safeVdrUrl()`, `renderVdrLinkEditor()`, `renderVdrLinksList()`, `recordVdrGrant()`, `renderVdrGrantForm()`, the `GET /api/auth/me` role/dealId bootstrap; cache stamp bumped
- `public/due-diligence.html` (modified) - `#dd-vdr-grant` header container, new CSS classes for the editor/list/grant form, `due-diligence.js` cache stamp bumped to `?v=1784700002`

## Decisions Made

- **`vdrLink` folds into the existing item upsert route, not a dedicated route** — matches the interface contract exactly and means the item's clean-room area guard (`ddAreaRefused()`) already covers the reference with zero new access-control code to write or test.
- **`.url()` alone is insufficient for scheme restriction** — verified live via a standalone `node -e` probe against the installed `zod@4.4.3` that `z.string().url()` accepts `javascript:alert(1)` (it only requires the value to parse as *some* absolute URL). The explicit `.refine()` checking `new URL(val).protocol` is what actually closes T-04-27, not the bare `.url()` call.
- **One aggregate fetch client-side, not one per area** — `GET /api/dd/vdr-links` already groups server-side by cleared area, so `due-diligence.js`'s `load()` adds exactly one more `fetch()` to its existing `Promise.all()`.
- **`vdrRef` on the access-grant record is a free-text reference, not the item's `vdrLink.url`** — the grant records a compliance decision about WHICH PART of the data room someone may see, deliberately distinct from the clickable per-item pointer; conflating the two would have made the grant schema validate a URL it has no reason to.
- **The client-side access-grant form landed in Task 1's commit** rather than Task 2's — both live in the same `public/js/due-diligence.js` section and were authored together in one pass; the server-side route it posts to (`POST /api/deals/:id/vdr-grants`) landed in Task 2 as planned. Documented under Deviations below since the plan's task split assigned the client form to Task 2's text.

## Deviations from Plan

### Auto-fixed Issues

None — no Rule 1-4 auto-fixes were needed; every acceptance criterion was met by the code as designed against the interface contract.

### Task-boundary note (not a Rule 1-4 deviation)

**Client-side access-grant form authored in Task 1's commit instead of Task 2's**
- **What happened:** The plan's action text assigns the "Record data-room access grant" workspace-header form to Task 2. It was built and committed alongside Task 1's per-item VDR editor instead, since both additions live in the same file section (`public/js/due-diligence.js`'s header/per-item rendering) and were authored in one continuous pass.
- **Why this is not a Rule 1-4 fix:** No bug, missing functionality, blocker, or architectural change was involved — this is purely which commit a piece of already-planned UI code landed in. The route it posts to (`POST /api/deals/:id/vdr-grants`) was added in Task 2's commit exactly as planned, so the feature only became functional once Task 2 landed — Task 1's commit alone contains dead client code with no live endpoint to call, which is the same pattern Phase 4 Plan 02 explicitly precedented (that plan's Tasks 1+3 landed in one commit for the identical reason: both touched the same shared file and were authored together).
- **Verification:** `npm test` green at every commit boundary (178/178 after Task 1, 184/184 after Task 2); `grep -c innerHTML public/js/due-diligence.js` = 0 and `grep -c noopener` = 2 hold after both commits.

---

**Total deviations:** 0 Rule 1-4 auto-fixes; 1 task-boundary note (documented above, no functional or security impact).
**Impact on plan:** None on correctness or scope — every acceptance criterion in both tasks was met exactly as specified.

## Issues Encountered

None beyond the audit-log column-name lookup documented implicitly above (`row_id`/`after_json`, not `subject`/`after` — matched against `test/dd-grants.test.js`'s own established usage before writing the Task 2 audit-row assertions, so no test churn resulted).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `applyVdrLink()`'s replace-wholesale/server-stamped-provenance shape and `GET /api/dd/vdr-links`'s area-aggregate-with-omission pattern are stable for any later plan that needs a similar "at most one reference per row, clean-room filtered" surface.
- The UI's live in-browser click-through (per-item editor save/clear, per-area list layout, grant form role-gated visibility and its confirmation/error line) is deferred to `04-UAT.md` per this plan's own coverage entry — no browser automation tool was available this session, matching the same deferral pattern Plans 01-04 used for their own UI additions.
- No blockers for 04-06.

---
*Phase: 04-due-diligence-workspace*
*Completed: 2026-08-02*

## Self-Check: PASSED

All files created/modified by this plan exist on disk and both task commits are present in git history:

- FOUND: test/dd-vdr.test.js
- FOUND: server.js
- FOUND: validators/dd.js
- FOUND: validators/deals.js
- FOUND: public/js/due-diligence.js
- FOUND: public/due-diligence.html
- FOUND commit: 4e6072d (Task 1)
- FOUND commit: c5214c5 (Task 2)

`npm test` = 184/184 (171 baseline + 13 new). `node scripts/list-unvalidated-routes.js` exits 0. `node -e "require('./server.js')"` boots clean.
