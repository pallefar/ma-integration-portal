---
gsd_state_version: 1.0
milestone: v2.0.1
milestone_name: milestone
current_phase: 5
current_phase_name: Synergy Value Capture
status: planning
stopped_at: Phase 5 UI-SPEC approved
last_updated: "2026-08-06T04:04:38.662Z"
last_activity: 2026-08-06
last_activity_desc: Phase 5 UI-SPEC approved — ready to plan
progress:
  total_phases: 7
  completed_phases: 4  # 1-4 executed; Phase 1 formal close deferred to release-cut (01-VERIFICATION.md still untracked)
  total_plans: 22
  completed_plans: 22
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-23)

**Core value:** An Integration Lead can run one real TE acquisition end-to-end in this app — from due diligence through 100 days — without keeping a parallel spreadsheet.
**Current focus:** Phase 05 — Synergy Value Capture

## Current Position

Phase: 5 — Synergy Value Capture
Plan: Not started
Status: Ready to plan
Last activity: 2026-08-06 — Phase 5 discuss complete (23 decisions), 05-CONTEXT.md written

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 19
- Average duration: - min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 2 | 3 | - | - |
| 03 | 6 | - | - |
| 4 | 10 | - | - |

**Recent Trend:**

- Last 5 plans: none yet
- Trend: N/A

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 15min | 2 tasks | 6 files |
| Phase 01 P02 | 25min | 3 tasks | 8 files |
| Phase 01 P03 | 20min | 2 tasks | 1 files |
| Phase 02 P01 | 22min | 2 tasks | 6 files |
| Phase 02 P02 | 26min | 2 tasks | 6 files |
| Phase 02 P03 | 6min | 2 tasks | 3 files |
| Phase 03 P01 | 17min | 3 tasks | 10 files |
| Phase 03 P02 | 35min | 3 tasks | 7 files |
| Phase 03 P03 | 65min | 3 tasks | 16 files |
| Phase 03 P04 | 50min | 3 tasks | 28 files |
| Phase 03 P05 | ~70min | 3 tasks | 9 files |
| Phase 03 P06 | ~2h | 3 tasks | 16 files |
| Phase 04 P01 | 45min | 3 tasks | 10 files |
| Phase 04 P02 | 40min | 3 tasks | 6 files |
| Phase 04 P03 | 50min | 3 tasks | 9 files |
| Phase 04 P04 | ~55min | 3 tasks | 6 files |
| Phase 04 P05 | 35min | 2 tasks | 6 files |
| Phase 04 P06 | ~40min | 3 tasks | 6 files |
| Phase 04 P07 | ~85min | 3 tasks | 22 files |
| Phase 04 P08 | ~70min | 3 tasks | 8 files |
| Phase 04 P09 | 18min | 2 tasks | 6 files |
| Phase 04 P10 | 45min | 2 tasks | 6 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmapping: Merged research's suggested F2 (Deal-Resolver + Audit) and F3 (Write Validation) phases into a single Phase 3, since F3 was itself identified as "a natural byproduct of the routes/ split happening table-by-table in F0-F2" and is thin on its own (2 requirements) — avoids a phase whose success criteria would read as pure technical tasks.
- Roadmapping: Org Design & Talent Retention placed after Due Diligence Workspace (not in parallel with it) because its sensitive-data access rule reuses the accessPolicy.js clean-room pattern DD establishes, per research guidance — avoids inventing the pattern twice.
- Roadmapping: REQUIREMENTS.md's own traceability section stated "30 total" v1 requirements, but a direct count of unique v1 requirement IDs in the file is 32 (FND×4, AUTH×4, ISO×3, AUD×2, VAL×2, DD×5, SYN×5, RPT×4, ORG×3). Traceability updated to reflect the true count of 32; flagging here in case "30" was a deliberate earlier scope decision that got silently dropped.
- [Phase ?]: better-sqlite3 committed to node_modules with all 8 platform prebuilds; engines.node bumped >=20->>=22 to match its declared floor
- [Phase ?]: .gitignore + admin download-zip export both pre-emptively exclude the SQLite artifact family (.db-wal/.db-shm/.db.bak, plus .db in the zip export) before wave 2 creates the first .db file (T-01-02)
- [Phase ?]: db/store.js writeDb() uses a snapshot-tagged transactional merge (readDb() stamps a non-enumerable __snapshot; writeDb diffs against that request's own snapshot, not live DB state) — this is what closes the same-collection concurrent-write lost-update race (FND-03)
- [Phase ?]: users collection items lack an id field (only username) — db/store.js's idOf() falls back to username for internal SQLite row-keying; does not affect the stored JSON or the round-trip diff
- [Phase ?]: Cutover approved on partial platform coverage: macOS/any-OS bundle boot confirmed live, all 8 native prebuilds verified, migration --verify green, node --test 4/4; Windows/Linux bundle boots deferred to a manual pre-release-cut check (not possible on this Mac).
- [Phase ?]: db.json archived via chmod 444 (read-only, retained not deleted) rather than rename/move -- minimal, fully-reversible action producing no git diff; server.js already treats it as a dormant archive reference since Plan 02.
- [Phase ?]: Phase 2 Plan 1: AUTH-02 write-role enforcement intentionally deferred to Plan 02 -- this plan's gate write branch is permissive (matches today's behavior) via a named isWrite hook, avoiding a write regression before ROLE_WRITE_POLICY exists
- [Phase ?]: Phase 2 Plan 1: lockedDown()/isAdminRequest(req) request-aware conversion and X-Admin-Token attributed identity (D-11) left for Plan 02 per its own explicit acceptance criteria -- not touched in Plan 01 to avoid duplicating/conflicting work
- [Phase ?]: ROLE_WRITE_POLICY prefixes stay /api/-prefixed; gate reconstructs the full path via req.baseUrl + req.path (Express strips the mount prefix from req.path inside app.use('/api', ...))
- [Phase ?]: employee-demo (D-12) seeded into both db.json and the live data/ma-portal.db SQLite store, since db.json is a frozen fixture and SQLite is the actual source of truth since Phase 1
- [Phase ?]: X-Admin-Token (D-11) resolves req.portalUser through the same code path as session cookies, feeding the identical ROLE_WRITE_POLICY check rather than an early-return bypass
- [Phase ?]: Phase 2 Plan 3: Merged the authRequired-redirect logic into the existing admin-token window.fetch wrapper (single coherent wrapper) rather than a standalone second IIFE, per the plan's acceptance criterion that window.fetch not be reassigned via two independent stacked patches
- [Phase ?]: zod approved through blocking-human Package Legitimacy Gate (colinhacks/zod, 986M downloads/month, no postinstall script, MIT, 4.4.3=latest); pinned flat like better-sqlite3
- [Phase ?]: Phase 3 Plan 01: control.db/runtime.db/audit.db exclusion lists (.gitignore + admin download-zip) landed before any of those files can exist (D-07/T-03-01), matching the Phase 1 .db precedent
- [Phase ?]: Phase 3 Plan 01: secret-bearing settings fields (geminiApiKey, databaseConfig.connectionDetails) placed in gitignored runtime.db's app_state rather than the committed control.db
- [Phase ?]: Phase 3 Plan 02: D-05 checkpoint approved as-specified — control/demo/runtime classification stands; ISO-03 retires only the flag+shadow-array real-vs-demo switch, demo's own Projects/Custom-M&A switching survives inside demo.db as a showcase feature
- [Phase ?]: Phase 3 Plan 02: split-db-into-control-demo-deals.js run for real against data/ma-portal.db, producing committed data/control.db + data/demo.db (D-07) and gitignored data/runtime.db; source file byte length/mtime confirmed unchanged
- [Phase ?]: Phase 3 Plan 02: db/dealSeed.js uses allowlist-direction copy (DEAL_SEED_COLLECTIONS) not a denylist, so future collections added in Phase 4-7 never silently leak demo data into a new real deal
- [Phase ?]: Phase 3 Plan 03: consolidated /api gate rewired end-to-end (session-bound resolver, control/runtime/demo cutover, DEMO_ONLY_PREFIXES hard-gate) landed as one integrated server.js diff across Task 1's commit since the gate could not be split incrementally without a non-booting intermediate state; Tasks 2-3 contributed their remaining distinct files
- [Phase ?]: Phase 3 Plan 03: accounts (users) removed from db/collections.js ARRAY_COLLECTIONS and db/schema.sql entirely, reachable only via new db/controlStore.js — a deal-bound request's own connection can structurally never read/write the account store
- [Phase ?]: Phase 3 Plan 04: deal registry control plane (6 routes) built on Plan 03's resolver/controlStore; db/store.js gained closeConnection() and db/sessions.js gained releaseSessionsForDeal() (outside the plan's declared file scope but required by its own acceptance criteria); CONTROL_PLANE_PATHS widened to /api/admin/deals* so an admin's own stale binding can never lock them out of archive/delete
- [Phase ?]: Phase 3 Plan 04: header deal switcher (public/js/deal-switcher.js) loaded app-wide via transitions.js's existing dynamic-script bootstrap; admin.html pageAccess widened to allow hrbp client-side (D-02's create-deal form has no other page to live on); GET /api/auth/me extended with dealId
- [Phase ?]: Phase 3 Plan 04: Task 3's browser-only human-check verification was not run in this session (no browser automation tool available) — verified every automatable angle instead (live curl+direct-SQL E2E round trip, source-level XSS/wiring checks, 86/86 regression); a human should complete the plan's 7-step browser check before D-04 is fully closed
- [Phase ?]: Phase 3 Plan 05: D-09 checkpoint approved as-specified — dedicated gitignored/zip-excluded data/audit.db, store-layer writeDb() hook (not cross-database triggers), best-effort post-commit semantics with loud audit-write-failure surfacing, tamper-evidence deferred to shared-host milestone
- [Phase ?]: Phase 3 Plan 05: db/resolver.js's bound context extended with actor/request derived from req.portalUser at bind time — the audit hook reads it via AsyncLocalStorage with zero new writeDb() parameter across ~90 call sites; an audited write with no resolved actor throws rather than logging anonymously (D-11), except the one legitimate DEMO_OPEN=1 open-mode bypass on session-revoke-all, which mirrors D-08's demo-writes-unaudited rule instead of crashing
- [Phase ?]: Phase 3 Plan 05: security events recorded directly from server.js via db/auditHook.js's recordSecurityEvent(), never through db/controlStore.js, so that module's zero-reference-to-audit.db guarantee (AUD-02) is never put at risk; CONTROL_PLANE_PATHS widened to /api/admin/audit mirroring Plan 04's admin-lockout-prevention precedent for /api/admin/deals*
- [Phase ?]: Phase 3 Plan 06: Tasks 1+2 landed in one commit (c0f9a6c) — the generic fail-closed validationMiddleware could not be mounted incrementally without breaking every pre-existing test exercising a not-yet-scheduled write route, matching Plan 03's own consolidated-gate precedent; Task 3 (HTML tagging, 0cf5a0f) was independent
- [Phase ?]: Phase 3 Plan 06: WRITE_SCHEMAS keyed on Express route-TEMPLATE strings (not runtime paths) with a boundary-safe regex matcher, so one resolveSchema() serves both request-time lookup and the coverage check reading the live route inventory's own ':id'-style templates
- [Phase ?]: Phase 3 Plan 06: htmlField() tagging kept deliberately narrow — only lesson.body, the richtext page-layout block's data.html, and the legacy page.body — verified against actual client-side render paths rather than tagging every plausibly-markup field, since sanitizing an untagged plain-text field would itself be a data-integrity bug
- [Phase ?]: Phase 4 Plan 01: grantedAreas() checks deal truthiness before the admin/hrbp role shortcut (coordinator-requested hardening) — closes a latent fail-open with zero behavior change for any real caller
- [Phase ?]: Phase 4 Plan 01: an unknown item id and an uncleared-area item share one refusal path (assertAreaGrant with areaId: null, never granted to any role) — the DD-04 uniform-403 anti-enumeration property is structural, not a second branch
- [Phase ?]: Phase 4 Plan 01: db/accessPolicy.js holds zero audit dependency by design — every dd-access-denied event is recorded from server.js's refuseDdArea() choke point, mirroring db/controlStore.js's AUD-02 isolation precedent
- [Phase ?]: Phase 4 Plan 02: GET /api/deals/:id/grants narrowed inline to admin+hrbp (Rule 1/2 auto-fix) — ROLE_WRITE_POLICY only role-gates writes and /api/admin*-prefixed GETs; left unguarded, any authenticated role could have read any deal's membership + per-area clearance map by id
- [Phase ?]: Phase 4 Plan 02: a grant naming a username absent from deal.members is refused (400, no memberGrants entry created) — clearance can never exist without membership
- [Phase ?]: Phase 4 Plan 02: removing a member from deal.members intentionally leaves their memberGrants entry in place (not pruned) — safe by construction since grantedAreas() is only consulted after the bind-time membership check has already passed
- [Phase ?]: Phase 4 Plan 03: Tax area's ownerHint folds into Finance (no dedicated Tax role in the interface contract's seven role strings), mirroring 04-RESEARCH.md's identical ws_finance fold-in
- [Phase ?]: Phase 4 Plan 03: GET /api/dd/request-templates is deliberately unfiltered by accessPolicy (a template carries no MNPI); only the instantiate route, which creates real area-scoped items, is clearance-gated
- [Phase ?]: Phase 4 Plan 03: a SQLite write against a git-committed WAL-mode *.db file must PRAGMA wal_checkpoint(TRUNCATE) before close, or the write lands only in the gitignored -wal sidecar and the tracked file stays byte-unchanged
- [Phase ?]: DD findings register (DD-02) + one-click conversion to Day-1 task/RAID entry (DD-03): RAID_LEVELS extended to four levels in both independent copies (server.js + validators/workstream.js) with an anti-drift test; DD_AREA_WORKSTREAM (D-25) hard-coded mapping; conversion is a NEW route (not from-remediation), clearance-checked before read, dedup by dd-finding:<id> source, bidirectional linkedTaskIds/linkedRaidIds <-> source
- [Phase ?]: Phase 4 Plan 05: vdrLink folds into the existing POST /api/dd/request-items upsert route (not a dedicated route) — the item's clean-room area guard already covers the reference with zero new access-control code
- [Phase ?]: Phase 4 Plan 05: zod's z.string().url() alone accepts javascript: URLs (verified live against zod@4.4.3) — an explicit .refine() on the parsed protocol is what actually restricts vdrLink.url to http/https
- [Phase ?]: Phase 4 Plan 05: a data-room access grant (POST /api/deals/:id/vdr-grants) is written ONLY as a recordSecurityEvent — no separate collection, so the append-only audit log IS the compliance record and survives deletion of the deal it describes
- [Phase ?]: Phase 4 Plan 6: WIZARD_ASSESSMENT_SUBJECTS uses subject 'integration-leader' (verified against seeded template data), not the plan text's literal 'il'
- [Phase ?]: Phase 4 Plan 6: latestAssessInstanceFor() filters strictly on status==='submitted' — a pending row can never feed a score/band/compatibility calc
- [Phase ?]: Phase 4 Plan 6: createDeal() stamps a setup skeleton at creation time (basics/team already done); updateDealSetup() does a shallow merge into deal.setup mirroring setDealMemberGrants()'s caller-computes/store-persists shape
- [Phase ?]: [Phase 4 Plan 07] Every error show-path in deal-wizard.js cleared display to '' instead of an explicit visible value, silently swallowing every server-rejected step's message (found via live UAT, fixed with VISIBLE_ERROR_DISPLAY='block' + a regression test)
- [Phase ?]: [Phase 4 Plan 07] The new-deal setup wizard (WIZ-01) is the ONLY path into real-deal creation — the Phase-3 minimal create-deal modal (openCreateDealForm) is retired entirely, not left dormant
- [Phase ?]: [Phase 4 Plan 08] GET /api/dd/summary carries no explicit role gate (mirrors existing DD list routes) — every number is already scoped through filterByAreaGrant()/grantedAreas() before any tally runs
- [Phase ?]: [Phase 4 Plan 08] public/js/dashboard.js's two pre-existing DOMContentLoaded handlers converted to named functions (initDemoDashboard()/initReadinessStrip()) via a minimal opening/closing-line-only edit, proven unchanged internally by git diff, so a deal-bound dispatcher could gate both without auditing ~2400 lines of demo rendering
- [Phase ?]: [Phase 4 Plan 08, user decision at checkpoint] D-22 amended to match the actual Phase-3 resolver: an archived deal is a full freeze (no reads, no writes, no listing, for anyone) not read-only-with-retained-access as originally written; no code changed, decision text corrected
- [Phase ?]: G-04-10 closed: DealSetupSchema's step made optional with a refine enforcing 'name a step, or mark completion with no step data'; the setup route's completion-only branch passes existing steps through unchanged instead of fabricating a stamp for a skipped step.
- [Phase ?]: G-04-8 closed: server-side duplicate-create guard (createdBy + exact name + exact target + outstanding setup) plus client-side resume-on-entry bootstrap using setup.steps as the cursor; source-level, live browser walk deferred to user

### Pending Todos

None yet.

### Blockers/Concerns

- ⚠️ [Phase 7] PDF-generation approach for this vanilla-JS/no-build-step stack — needs concrete implementation research.
- ⚠️ [Phase 4] Exact workstream-lead role taxonomy (ws_lead_hr, ws_lead_legal, etc.) — Phase 2 shipped the coarse role set (admin/hrbp/pmo/employee); finer taxonomy still needed before Phase 4's access-policy config.
- ⚠️ [Release-cut] Phase 1 Windows/Linux bundle boots + Phase 1 formal close (`/gsd-verify-work 1`) still deferred; 01-VERIFICATION.md remains untracked.
- ⚠️ [Phase 3] Phase 2 left the `isOpenMode(req)` seam and `sessions.ip` (TRUST_PROXY opt-in) for Phase 3 to bind to the deal-resolver (`DEMO_OPEN && req.isDemo`) and the audit log respectively.
- ⚠️ [Traceability] phase.complete warned: HOST-01..03 / HARD-01..03 (v2-deferred) appear in REQUIREMENTS.md body but not its Traceability table.
- [Phase 3 Plan 04] D-04 deal switcher browser human-check PARTIALLY closed by orchestrator via Playwright (2026-08-01, :3335 admin session): switcher pill renders + visually distinct, dropdown lists Demo showcase + "+ New real deal", create-deal modal opens with isolation notice, ZERO console errors. Still open for /gsd-verify-work 3: in-browser create→select→switch-back round-trip + employee-sees-no-chrome check.
- [Phase 3 Plan 05] D-10 admin Audit Log tab browser check CLOSED by orchestrator via Playwright (2026-08-02, :3337 admin login): tab renders under Compliance group, 50 entries with timestamp/op/collection#id/actor(role)/deal + collapsible before-after, actor filter returns only matching rows, pagination present, zero console errors.
- [Phase 4 Plan 07, out of scope] public/js/transitions.js's pageAccess gate races the login-role handshake on the first navigation after a browser's active role changes (pre-existing, app-wide, not introduced by this plan) — every write route is independently role-checked server-side regardless (confirmed live: pmo session got 403 from POST /api/deals/wizard/basics); a future phase should consider hardening the handshake ordering
- [Phase 4, deferred by user decision] Post-close read-only access for archived deals is NOT implemented — an archived deal is a full freeze today (no reads/writes/listing for anyone, per db/resolver.js's uniform 403 + listDealsForUser()'s exclusion filter). If a real deal ever needs retained-member read access after archiving, it requires: (1) resolveDatabase() distinguishing GET from write for an archived deal's bind, (2) listDealsForUser() including archived deals for a retained member with a status flag, (3) not force-releasing every session at archive time. Captured in 04-CONTEXT.md's amended D-22, not scheduled.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260801-fj5 | Hide Post-Merger splash screen via guarded early return (keep code) | 2026-08-01 | f2a0484 | [260801-fj5-hide-post-merger-splash-screen-via-guard](./quick/260801-fj5-hide-post-merger-splash-screen-via-guard/) |
| 2 | Fix infinite reload loop (admin role hidden by demo roleVisibility) — flicker on / after mandatory auth | 2026-08-01 | 13d6cb9 | — |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Shared Host | HOST-01/02/03 (shared hosting, multi-process SQLite hardening, TE SSO) | Deferred to v2 | Requirements gate 2026-07-23 |
| Later Hardening | HARD-01/02/03 (SQLCipher, automated test suite, frontend monolith refactor) | Deferred to v2 | Requirements gate 2026-07-23 |

## Session Continuity

Last session: 2026-08-06T04:04:38.648Z
Stopped at: Phase 5 UI-SPEC approved
Resume file: .planning/phases/05-synergy-value-capture/05-UI-SPEC.md
