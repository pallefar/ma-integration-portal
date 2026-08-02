---
phase: 03-deal-isolation-audit-log-write-validation
verified: 2026-08-02T06:45:00Z
status: passed
score: 5/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Log in as the hrbp/Integration Lead demo account (no DEMO_OPEN). Create a deal from the admin console (already confirmed rendering). Select/switch into it via the header deal switcher. Confirm the header state label changes to the 'Real deal' treatment and that the dashboard/employee pages render that deal's own (empty) data rather than demo content. Then switch back to 'Demo showcase' and confirm the showcase renders exactly as before, with zero console errors on every page touched."
    expected: "Switching into a deal changes the rendered data on the next page load (empty, deal-scoped, not demo content); switching back restores the unmodified demo showcase; zero browser console errors throughout."
    why_human: "This is 03-04-PLAN.md Task 3's own end-of-phase human-check steps 4-5 (browser rendering / visual state after a client-side reload) — grep/static analysis cannot observe rendered DOM state or console output. STATE.md (line 125) explicitly records this as still open: the orchestrator's Playwright pass this session confirmed switcher-renders/create-deal-modal/zero-console-errors (steps 1-3, 7) but did NOT yet drive the actual switch-into/switch-back round trip."
  - test: "Log in as the employee demo account and confirm no deal switcher and no create-deal panel appear anywhere in the UI."
    expected: "An employee-role session sees zero new header chrome and no way to create or manage deals."
    why_human: "03-04-PLAN.md Task 3 human-check step 6 — a visual absence check, not verifiable by grep. Not yet run per STATE.md."
---

> 2026-08-02 update: the human-verification items were executed and PASSED via orchestrator-driven Playwright with live evidence (03-UAT.md, 2/2, source: automated) — deal-switcher round trip incl. create/bind/switch-back with zero demo bleed-through, and employee-no-chrome. Security gate: 03-SECURITY.md threats_open: 0.

# Phase 3: Deal Isolation, Audit Log & Write Validation Verification Report

**Phase Goal:** Real-deal data is physically isolated from demo data, every write to deal data is attributable and audited, and every write is schema-validated before it lands — this is where "real data never shares a store with demo" is actually enforced in code.
**Verified:** 2026-08-02T06:45:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (mapped to ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A request resolves to exactly one database (demo.db or a specific deal's `deals/<id>.db`) before any handler touches data; two different deals' SQLite files share no rows (ROADMAP SC-1) | ✓ VERIFIED | `db/resolver.js#resolveDatabase()`/`dealResolverMiddleware` bind at request start via `AsyncLocalStorage` (`db/store.js#requestDbStorage`); bind-time membership refusal (never a read-time filter) confirmed by `test/deal-resolver.test.js` (8 cases) and `test/deal-isolation.test.js` (4 cases, incl. a concurrent-write case). Full suite green. |
| 2 | Demo-only mechanics (time-travel day-scaling, XP/leaderboards) can only run against `demo.db`; invoking them against a deal session has no effect on that deal's data (ROADMAP SC-2) | ✓ VERIFIED | `server.js` `DEMO_ONLY_PREFIXES`/`isDemoOnlyPath()` refuse with 403 in the one consolidated gate; `test/demo-only-gating.test.js` (5 cases) proves refusal AND byte-identical deal data after a refused call, via direct SQL, not just the response status. |
| 3 | Every write to deal data appears in an append-only audit log recording who/what/when/before/after; deleting a deal leaves its audit trail intact (ROADMAP SC-3) | ✓ VERIFIED | `db/audit-schema.sql`'s `RAISE(ABORT)` triggers make UPDATE/DELETE structurally impossible; `db/auditHook.js`'s store-layer hook (actor-required-or-throw) proven by `test/audit-log.test.js` (8 cases) and `test/audit-security-events.test.js` (6 cases), including a real deal-deletion-survives-audit case. |
| 4 | A write with a malformed payload is rejected with a clear error on every write endpoint (ROADMAP SC-4) | ✓ VERIFIED | `validators/index.js#validationMiddleware` mounted once in the consolidated gate, fails CLOSED for any unschema'd route; `test/write-validation-coverage.test.js` proves every registered write route resolves to a schema against the live route inventory; `test/write-validation.test.js` (9 cases incl. boundary/empty/encoding/ordering/concurrency/demo-vs-deal parity). |
| 5 | Free-text and HTML-bearing fields round-trip through storage and render without executing injected script (ROADMAP SC-5) | ✓ VERIFIED (one documented, accepted residual limitation) | `lib/sanitizeHtml.js` + `htmlField()`/`applySanitization()` tag exactly the 3 fields actually rendered as markup; `test/xss-sanitization.test.js` (5 required cases + 1 explicitly documented `KNOWN RESIDUAL LIMITATION` case for a nested-tag-reconstruction payload — a `verification: backstop` truth in 03-06-PLAN.md's own must_haves, disposed honestly rather than silently passed, matching the pre-existing client-side sanitizer's own limitation). |
| 6 | D-04: a deal member can create a deal, switch into it (rendering that deal's own data), switch back to the demo showcase (unchanged), and an employee sees no switcher/create-deal chrome — all with zero browser console errors | ⚠️ Partially confirmed, human check incomplete | Automated: full HTTP+direct-SQL round trip (create→select→isolated-write) proven by `test/deal-registry.test.js`; source checks (`textContent`-only, script wiring) pass. Browser: orchestrator's Playwright pass this session confirmed switcher renders + is visually distinct + create-deal modal opens + zero console errors (STATE.md line 125) — but did **not** yet drive the actual switch-into-a-deal / switch-back-to-demo round trip or the employee-sees-no-chrome check. STATE.md explicitly records this as still open. Routed to Human Verification below. |

**Score:** 5/6 truths verified (1 routed to human verification — not a code gap, a browser-only check explicitly deferred per `workflow.human_verify_mode: end-of-phase`)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `db/dbFiles.js` | Central path module for control/runtime/audit/deal DBs | ✓ VERIFIED | Exports `CONTROL_DB_PATH`/`RUNTIME_DB_PATH`/`AUDIT_DB_PATH`/`DEMO_DB_PATH`/`DEALS_DIR`/`dealDbPath()`/`openDbFile()`; confirmed present and exported (`test/db-file-layout.test.js`). |
| `db/control-schema.sql`, `db/runtime-schema.sql`, `db/audit-schema.sql` | New schemas for control/runtime/audit DBs | ✓ VERIFIED | All three exist; audit schema's `RAISE(ABORT)` triggers confirmed by grep and by a live UPDATE/DELETE-rejection test. |
| `.gitignore` + download-zip exclusions | `data/runtime.db*`, `data/audit.db*`, `data/deals/` excluded from git AND admin export | ✓ VERIFIED | `.gitignore` lines 36-38; `server.js:872` zip `-x` list includes all three. `git ls-files data/` shows only `control.db`, `demo.db`, `ma-portal.db` tracked — no leak. |
| `scripts/split-db-into-control-demo-deals.js` | Re-runnable, verify-gated 1-to-3 split | ✓ VERIFIED | `runSplit()`/`verifySplit()` present; real split already run against `data/ma-portal.db` producing verify-green `control.db`/`demo.db`/`runtime.db`; `test/db-split-migration.test.js` (8 cases). |
| `db/dealSeed.js` | Template-only, demo-free deal seeding | ✓ VERIFIED | `createDealDatabase()` allowlist-copies exactly 3 template collections + i18n; `test/deal-seed.test.js` proves the FULL collection inventory is empty otherwise (not a hand-picked subset). |
| `db/resolver.js`, `db/store.js` (AsyncLocalStorage), `db/controlStore.js` | Session-bound resolver, request-scoped connection, dedicated control accessor | ✓ VERIFIED | All three exist, wired into the consolidated `/api` gate; `grep -c "app.use('/api'"` server.js == 1 confirms no second overlapping middleware. |
| `server.js` deal routes | `GET/POST /api/deals`, `POST /api/deals/select`, `POST /api/deals/:id/members`, `POST /api/admin/deals/:id/archive`, `DELETE /api/admin/deals/:id` | ✓ VERIFIED | All six routes present; role-gated (admin+hrbp create, admin-only lifecycle); `test/deal-registry.test.js` (8 cases), `test/deal-lifecycle.test.js` (6 cases). |
| `public/js/deal-switcher.js` | Header deal switcher + create-deal modal | ✓ VERIFIED (exists/wired), ⚠️ full click-through UAT open | Dynamically loaded via `public/js/transitions.js:1253-1256`; `grep -c innerHTML` == 0 (textContent-only). Browser click-through partially confirmed (see Truth #6). |
| `db/auditHook.js` | `writeAuditBatch`/`recordSecurityEvent`/`queryAudit`/`getAuditConnection` | ✓ VERIFIED | All present; independent connection to `audit.db` (`grep -c ATTACH` == 0); `queryAudit()` orders `DESC` (WR-01 fix confirmed live). |
| `public/admin.html` + `public/js/admin.js` audit viewer | Admin-only filterable audit tab | ✓ VERIFIED | Tab markup + `loadAuditLog()`/`renderAuditLog()` present and wired; admin-only client + server side; browser rendering closed via orchestrator's Playwright pass (STATE.md line 126). |
| `validators/index.js` + `validators/{deals,cms,workstream,people,assessment,settings}.js` | One zod schema per registered write route | ✓ VERIFIED | All 7 files present; `test/write-validation-coverage.test.js` proves exhaustive coverage against the live route inventory (not a maintained list). |
| `lib/sanitizeHtml.js` | Server-side write-time HTML sanitizer | ✓ VERIFIED | Present, ported from the client-side sanitizer; round-trip proven by `test/xss-sanitization.test.js`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| Consolidated `/api` gate | `dealResolverMiddleware` | Mounted before role check, before `validationMiddleware` | ✓ WIRED | `server.js:403-441` — confirmed order: identity → resolver bind → open-mode → 401 → demo-only-gate → role-check → `validationMiddleware`. |
| `isOpenMode(req)` (DEMO_OPEN=1) | `validationMiddleware` | CR-02 fix | ✓ WIRED | `server.js:409-411` — open-mode branch now routes through `validators.validationMiddleware(req, res, next)` instead of bypassing it (confirmed live, matching 03-REVIEW.md's `CR-02: RESOLVED`). |
| `writeDb()` snapshot-diff merge | `db/auditHook.js#writeAuditBatch()` | Post-commit dispatch, no `writeDb()` signature change | ✓ WIRED | `grep -c "writeAuditBatch" db/store.js` >= 1; audit dispatch happens only after the source transaction commits (proven by a rolled-back-write-produces-no-row test case). |
| `resolveDatabase()` missing/archived/non-member | HTTP status | Uniform 403 (WR-02 fix) | ✓ WIRED | `db/resolver.js:68-95` — both branches now return the same 403, matching `/api/deals/select`'s own documented anti-enumeration rule (confirmed live, matching `WR-02: RESOLVED`). |
| `POST /api/admin/users/:username/revoke-sessions`, `GET /api/admin/download-zip` | `CONTROL_PLANE_PATHS` | WR-03 fix | ✓ WIRED | `db/resolver.js:47,53` — both routes now covered, preventing a confusing 404 from an admin's own stale deal binding. |
| `validators/cms.js` HTML-tagged fields | `lib/sanitizeHtml.js` | `htmlField()`/`applySanitization()` recursion | ✓ WIRED | Confirmed via round-trip test and source check (`grep -c htmlField validators/cms.js` >= 1). |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite green | `npm test` (bare `node --test`) | 122/122 passed, 0 failures | ✓ PASS (independently re-run this session) |
| `POST /api/rag/upload` no longer throws (CR-01) | `node --test test/rag-upload.test.js` | 2/2 passed | ✓ PASS |
| No debt markers in phase-touched files | `grep -n "TBD\|FIXME\|XXX"` across `db/*.js`, `db/*.sql`, `validators/*.js`, `lib/*.js`, relevant scripts, `server.js`, `deal-switcher.js` | No matches | ✓ PASS |
| Leak-prevention lists closed before any protected file could exist | `.gitignore` + download-zip `-x` list grep | All 3 families present in both | ✓ PASS |
| Only `control.db`/`demo.db`/`ma-portal.db` are git-tracked under `data/` | `git ls-files data/ \| grep '\.db$'` | Exactly those 3, no `runtime.db`/`audit.db`/`deals/*` | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| ISO-01 | 03-01, 03-02, 03-03, 03-04 | Real-deal data in a separate SQLite file per deal, physically separate from demo/control | ✓ SATISFIED | Split store + resolver + `deals/<id>.db` per-deal files; `test/deal-isolation.test.js`, `test/deal-registry.test.js` |
| ISO-02 | 03-02, 03-03 | Demo-only mechanics cannot read/mutate any real-deal database | ✓ SATISFIED | `DEMO_ONLY_PREFIXES` hard-gate; `test/demo-only-gating.test.js` |
| ISO-03 | 03-03, 03-04 | A request resolves to exactly one deal/demo database before any handler touches data | ✓ SATISFIED | `dealResolverMiddleware` + `AsyncLocalStorage`; `test/deal-resolver.test.js` |
| AUD-01 | 03-05 | Every write to deal data recorded in an append-only audit log (who/what/when/before/after) | ✓ SATISFIED | `db/auditHook.js`; `test/audit-log.test.js` |
| AUD-02 | 03-01, 03-04, 03-05 | The audit log survives deletion of the deal it describes | ✓ SATISFIED | Physically separate `audit.db`; `deleteDeal()` holds zero reference to it; `test/audit-log.test.js` case (g) |
| VAL-01 | 03-01, 03-04, 03-06 | Every write endpoint validates its input against a schema, rejecting malformed requests | ✓ SATISFIED | `validators/index.js` + 7 resource modules; `test/write-validation-coverage.test.js` (exhaustive) |
| VAL-02 | 03-06 | Free-text and HTML-bearing fields sanitized before storage/render | ✓ SATISFIED | `lib/sanitizeHtml.js`; `test/xss-sanitization.test.js` (with one documented, accepted residual limitation) |

No orphaned requirements: REQUIREMENTS.md maps exactly these 7 IDs to Phase 3, and all 7 appear in at least one plan's `requirements:` frontmatter field, cross-checked above.

### Anti-Patterns Found

None blocking. No `TBD`/`FIXME`/`XXX`/`HACK`/`PLACEHOLDER` markers found in any file touched by this phase. The one deliberately-accepted residual limitation (nested-tag-reconstruction XSS payload surviving the single-pass regex sanitizer) is explicitly documented in `test/xss-sanitization.test.js` and in `03-06-PLAN.md`'s own `must_haves.prohibitions` as a `verification: backstop` item — disposed honestly, not silently passed, and already carried in the phase's own threat register (T-03-36, accepted risk).

### Code Review Findings (03-REVIEW.md)

All 6 findings (2 critical, 3 warning, 1 info) are marked `status: resolved` in `03-REVIEW.md` frontmatter, and this verification independently confirmed all 6 fixes are live in the current code (not just claimed in the review doc):
- **CR-01** (`POST /api/rag/upload` `ReferenceError`) — fixed, `const db = readDb();` restored, regression test `test/rag-upload.test.js` passes.
- **CR-02** (`DEMO_OPEN=1` bypassing write-validation/sanitization) — fixed, `validationMiddleware` now runs in the open-mode branch.
- **WR-01** (audit viewer pagination inverted) — fixed, `queryAudit()` now orders `DESC`.
- **WR-02** (non-uniform 403 vs 404 in `resolveDatabase()`) — fixed, both cases now return the same 403.
- **WR-03** (`revoke-sessions`/`download-zip` missing from `CONTROL_PLANE_PATHS`) — fixed, both added.
- **IN-01** (deal-switcher contradictory "Demo showcase" label) — fixed.

`npm test`: 122/122 passed (independently re-run this session, not merely quoted from the review doc).

### Human Verification Required

See YAML frontmatter `human_verification` above. Both items trace to `03-04-PLAN.md` Task 3's own `<human-check>` block (steps 4-6), deliberately deferred to end-of-phase per `workflow.human_verify_mode: end-of-phase`, and are explicitly recorded as still-open in `STATE.md` (line 125) even after this session's Playwright pass closed steps 1-3 and 7.

### Gaps Summary

No code gaps found. All 7 requirement IDs (ISO-01/02/03, AUD-01/02, VAL-01/02) have working implementations backed by passing automated tests, all 6 code-review findings are fixed and independently re-verified live in the code, and the full 122-test regression suite is green. The single open item is a browser-only UI round-trip check (switch-into-a-deal / switch-back-to-demo / employee-sees-no-chrome) that the plan itself designed as an end-of-phase human checkpoint rather than an automatable test — it is not evidence of a missing or broken capability, only of an unclosed verification step. Routing to `human_needed` rather than `passed` per the verification decision tree (any non-empty human-verification section blocks a `passed` status even when every other truth is verified).

One non-blocking working-tree observation: `data/ma-portal.db` (chmod 444, git-tracked, supposed to be a frozen archive per the Phase-1 precedent) shows a binary diff against its committed content (`git diff --stat` reports changed bytes, same file length) — consistent with the WAL-checkpoint page-churn artifact already documented in 03-03-SUMMARY.md and 03-04-SUMMARY.md for `data/demo.db`/`data/control.db` during live smoke-testing this session, not a code defect. Recommend `git checkout -- data/ma-portal.db` before the phase's final commit so the archived file's bytes match git exactly.

---

_Verified: 2026-08-02T06:45:00Z_
_Verifier: Claude (gsd-verifier)_
