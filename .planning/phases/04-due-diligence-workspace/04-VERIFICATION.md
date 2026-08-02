---
phase: 04-due-diligence-workspace
verified: 2026-08-02T19:10:00Z
status: passed
score: 12/12 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 4: Due Diligence Workspace Verification Report

**Phase Goal:** A new deal enters the app through a guided setup wizard (basics, team, readiness assessments, scope, timeline), and the IL can run due diligence inside it, with pre-close information restricted to those with need-to-know.
**Verified:** 2026-08-02T19:10:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

Truths are the 5 ROADMAP Success Criteria (numbered 0-4) plus the 6 requirement statements (DD-01..05, WIZ-01), collapsed to unique claims and cross-checked directly against code, not against SUMMARY prose.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-0 | New deal is created through a guided wizard (basics -> team/access -> readiness-assessment kickoff w/ acquirer+target+IL instances -> scope -> timeline), every write validated+audited | ✓ VERIFIED | `public/deal-wizard.html` (7-step panel/rail) + `public/js/deal-wizard.js` calls `POST /api/deals/wizard/basics`, `POST /api/deals`, `POST /api/deals/select`, `POST /api/assessment-instances/assign` (x3), `POST /api/deals/:id/setup` (scope/timeline/ddKickoff) — all routes exist in `server.js` (confirmed by grep + `node scripts/list-unvalidated-routes.js` exit 0). `test/deal-wizard.test.js` (23/23) and `test/deal-wizard-page.test.js` prove the full server-side and client-source wiring. Live-browser click-through of the wizard is one of the 10 checkpoints running in parallel via `04-UAT.md` (see Human Verification section) — not blocking here per task scope. |
| SC-1 / DD-01 | IL creates/manages a DD request list organized by functional area, item w/ owner, status, due date | ✓ VERIFIED | `GET/POST /api/dd/request-items`, `GET/DELETE /api/dd/request-items/:id` in `server.js:3201-3337`; `db/accessPolicy.js` defines the 8-area taxonomy (`DD_AREAS`); 80-item seeded standard checklist in `db/ddRequestTemplateSeed.js` + `POST /api/dd/request-items/instantiate`. Proven by `test/dd-workspace.test.js` and `test/dd-seed.test.js`, both part of the passing 230/230 suite. |
| SC-2 / DD-02, DD-03 | IL records a finding (severity/area/owner) and converts to Day-1 task and/or RAID entry via the remediation linkage | ✓ VERIFIED | `GET/POST /api/dd/findings`, `POST /api/dd/findings/:id/convert` (`server.js:3431-3612`) implement bidirectional dedup-by-source conversion (`dd-finding:<id>` source string), reusing `POST /api/integration-tasks/from-remediation`'s exact shape (not the same route — see note below) with `DD_AREA_WORKSTREAM` mapping and `RAID_LEVELS` extended to 4 levels (`['low','medium','high','critical']`, confirmed identical in both `server.js:3082` and `validators/workstream.js:147`). `test/dd-findings.test.js` (15 tests) proves severity fidelity end to end, no downgrade. |
| SC-3 / DD-04 | Uncleared user cannot read an area's DD requests/findings via direct API call even with a valid session; filtering server-side; denial itself is audited | ✓ VERIFIED | `db/accessPolicy.js`'s `grantedAreas()/filterByAreaGrant()/assertAreaGrant()` gate every DD list/by-id route; `refuseDdArea()` records a `dd-access-denied` security event before every uniform 403 (unknown-id and uncleared-area share one code path — anti-enumeration). Confirmed live in code and by `test/dd-access-policy.test.js`, `test/dd-workspace.test.js` (g), `test/dd-findings.test.js` (e/f/o). Per-deal grant/revoke surface (`GET/POST /api/deals/:id/grants`) confirmed admin+hrbp-gated. |
| SC-4 / DD-05 | DD item carries a reference + access-grant record pointing at TE's VDR; app never stores the document | ✓ VERIFIED | `vdrLink` field on request items (URL+folder/label, server-stamped provenance, wholesale-replace), `GET /api/dd/vdr-links` aggregate (clean-room filtered, omits uncleared areas), `POST /api/deals/:id/vdr-grants` (audited `vdr-access-grant` event, no stored collection). `test/dd-vdr.test.js` (13 tests) includes an explicit negative proof: no upload-shaped route under `/api/dd`, no filesystem-write primitive in the DD section of `server.js`. |
| WIZ-01 (full) | Deal created after mandatory core (basics+team); remaining steps resume from deal-home checklist; every write flows through validation+audit | ✓ VERIFIED | `db/controlStore.js`'s `createDeal()` stamps a `setup` skeleton with basics/team pre-done; `updateDealSetup()` mirrors `updateDealMembers()`'s read-modify-write shape; `POST /api/deals/:id/setup` records a `deal-setup-update` audit event. `public/js/deal-home.js` renders the setup checklist with a resume link into `/deal-wizard.html`. Confirmed wired into `public/js/dashboard.js`'s deal-bound dispatcher (named-function conversion of the two demo initializers, `git diff` proves their bodies untouched). `test/deal-wizard.test.js` (p) proves the full ordered walk end-to-end. |
| CR-01 fix | The code-review-flagged authz bug (any deal member could complete another's pending readiness assessment) is actually fixed in running code, not just claimed fixed | ✓ VERIFIED | Read `server.js:2573-2625` directly: the `instanceId` completion branch now checks `req.portalUser.role` is `admin`/`hrbp` OR `req.portalUser.username === pending.owner.trim()`, else 403 `"You are not the assigned owner of this assessment."`, BEFORE any mutation. Regression tests `deal-wizard (t)`/(u)/(v)/(w) in `test/deal-wizard.test.js` independently re-run (23/23 pass) confirm the fix plus WR-01 (owner-name stripping) and IN-03 (session-stamped respondentName). |
| D-22 amendment | The archived-deal decision is recorded as amended (not implemented as originally written) | ✓ VERIFIED | `04-CONTEXT.md`'s D-22 shows the original text struck through and a dated 2026-08-02 amendment explaining `db/resolver.js:97` has no read/write distinction for archived deals (full freeze, not read-only). No code change was needed or made; this is a documentation correction confirmed against the actual resolver code, which the verifier independently re-read and confirms matches the amendment's description (single `throw` branch, no `req.method` check for access purposes). |
| Test suite | 230/230 passing, matching the SUMMARY's final claimed count | ✓ VERIFIED | `npm test` run independently by this verifier: `# tests 230 / # pass 230 / # fail 0`. `node scripts/list-unvalidated-routes.js` exits 0 (every registered write route has a zod schema). |
| No stub/debt markers | Files touched by this phase carry no unresolved TODO/FIXME/XXX/placeholder-as-stub markers | ✓ VERIFIED | Grepped `db/accessPolicy.js`, `validators/dd.js`, `validators/wizard.js`, `public/due-diligence.html`, `public/deal-wizard.html`, `public/js/due-diligence.js`, `public/js/deal-wizard.js`, `public/js/deal-home.js`, `db/controlStore.js`, `server.js`, `public/js/dashboard.js` for `TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER\|not yet implemented`. Only hits are legitimate HTML `placeholder=` input attributes and a demo `.placeholder-card`/`.placeholder-badge` CSS class (pre-existing "locked module" UI, unrelated to this phase's stub-detection concern). Zero `innerHTML` in any of the three phase-specific client JS files. |
| Route wiring | Every DD/wizard route referenced by the client actually exists live in Express | ✓ VERIFIED | Direct grep of `server.js` confirms all 21 `/api/dd/*`, `/api/deals/:id/{grants,vdr-grants,setup}`, `/api/deals/wizard/basics`, and `/api/assessment-instances{,/assign}` routes exist at the line numbers the summaries claim. `test/deal-wizard-page.test.js` additionally proves this via a route-inventory reflection test. |

**Score:** 12/12 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `db/accessPolicy.js` | Clean-room need-to-know filter module | ✓ VERIFIED | Exists, exports `DD_AREAS`/`DD_AREA_IDS`/`grantedAreas`/`hasAreaGrant`/`filterByAreaGrant`/`assertAreaGrant`/`AreaAccessError`; used across all DD routes in `server.js` |
| `validators/dd.js` | DD schemas registered in WRITE_SCHEMAS | ✓ VERIFIED | `DdRequestItemUpsertSchema`, `DdFindingUpsertSchema`, `DdFindingConvertSchema`, `InstantiateDdRequestsSchema`, `VdrLinkSchema` all present |
| `validators/wizard.js` | Wizard schemas | ✓ VERIFIED | `WizardBasicsSchema`, `DealSetupSchema`, `DEAL_SETUP_STEPS`, `DEAL_TYPES` present, registered |
| `public/due-diligence.html` + `public/js/due-diligence.js` | DD workspace page | ✓ VERIFIED | Both exist, 26.5KB JS file, zero `innerHTML`, fetches every DD route |
| `public/deal-wizard.html` + `public/js/deal-wizard.js` | 7-step wizard page | ✓ VERIFIED | Both exist, 18.3KB HTML / 26.4KB JS, wired to every server-side wizard route |
| `public/js/deal-home.js` | Deal-home rollup panels | ✓ VERIFIED | Exists, exports `window.renderDealHome`, fetches `/api/deals`, `/api/assessment-status`, `/api/dd/summary`, zero markup-sink assignment |
| `db/controlStore.js` (`setDealMemberGrants`/`getDealMemberGrants`/`updateDealSetup`) | Grant + setup-state store mutators | ✓ VERIFIED | Present, mirrors `updateDealMembers()`'s read-modify-write shape |
| `db/ddRequestTemplateSeed.js` + `scripts/seed-dd-request-templates.js` | 80-item seeded checklist | ✓ VERIFIED | Present; `data/demo.db` carries the seeded row (confirmed via prior plan's own verified diff, not re-derived here) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `public/js/due-diligence.js` | `GET/POST /api/dd/{areas,request-items,findings,vdr-links,summary}` | `fetch()` | WIRED | All 14 fetch call sites resolve to routes that exist in `server.js` |
| `public/js/deal-wizard.js` | `POST /api/deals/wizard/basics`, `POST /api/deals`, `.../select`, `.../setup`, `POST /api/assessment-instances/assign` | `postJson()`/`getJson()` helpers | WIRED | All resolve to live routes; confirmed by `test/deal-wizard-page.test.js`'s route-inventory reflection test |
| `public/js/deal-home.js` | `GET /api/dd/summary`, `GET /api/assessment-status`, `GET /api/deals` | `fetch()` | WIRED | All three resolve to live routes |
| `public/js/dashboard.js` dispatcher | `window.renderDealHome()` | direct call, gated on `GET /api/auth/me`'s `dealId` | WIRED | Named-function conversion confirmed by reading the dispatcher; `git diff` (per SUMMARY, independently spot-checked here) shows the two demo initializer bodies untouched |
| `server.js`'s DD routes | `db/accessPolicy.js` | `require('./db/accessPolicy')`, `filterByAreaGrant()`/`assertAreaGrant()` calls | WIRED | Confirmed present on every list/by-id DD route read |
| `POST /api/assessment-instances` (instanceId branch) | ownership check | inline `req.portalUser.role`/`.username` check | WIRED | Confirmed present at `server.js:2573-2625`, before any mutation — this is the CR-01 fix |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DD-01 | 04-01, 04-03 | DD request lists by functional area, owner/status/due date | ✓ SATISFIED | Routes + seeded checklist confirmed live |
| DD-02 | 04-04 | DD findings register (severity/area/owner) | ✓ SATISFIED | Findings CRUD confirmed live |
| DD-03 | 04-04 | Finding conversion to Day-1 task/RAID via remediation linkage | ✓ SATISFIED (see note) | Convert route confirmed live; reuses the from-remediation *pattern* (dedup-by-source, bidirectional link) via a new route rather than calling the same function — functionally equivalent, tested end to end |
| DD-04 | 04-01, 04-02, 04-04 | Clean-room access control, audited denials | ✓ SATISFIED | Confirmed live across every DD route + grants control plane |
| DD-05 | 04-05 | VDR reference + access-grant, no document storage | ✓ SATISFIED | Confirmed live, including the negative document-storage proof |
| WIZ-01 | 04-06, 04-07, 04-08 | Guided setup wizard, create-early, resumable setup | ✓ SATISFIED | Confirmed live server + client, deal-home resume link |

No orphaned requirements found — REQUIREMENTS.md's phase-4 mapping (lines 121-126) matches exactly the six requirement IDs claimed across the 8 plans.

### Anti-Patterns Found

None blocking. Grep for debt markers (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) across all files this phase created or modified in the DD/wizard subsystem returned zero unresolved markers — the only "placeholder" hits are legitimate HTML input `placeholder=` attributes and a pre-existing demo CSS class unrelated to this phase. Zero `innerHTML` in `due-diligence.js`, `deal-wizard.js`, `deal-home.js`.

### Code Review Gate (already run, findings verified fixed by this verifier independently)

`04-REVIEW.md` found 1 Critical (CR-01: cross-user readiness-assessment completion — a real authorization bug) + 2 Warning + 3 Info. `04-REVIEW-FIX.md` claims all 6 fixed across 5 commits. This verifier independently re-read the actual CR-01 fix in `server.js:2573-2625` (not just the SUMMARY's description of it) and independently re-ran `test/deal-wizard.test.js` (23/23 pass, including the four regression tests `(t)`/`(u)`/`(v)`/`(w)` added for CR-01/WR-01/IN-03). Confirmed fixed, not merely claimed fixed.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite passes | `npm test` | 230/230, 0 failures | ✓ PASS |
| Every write route has a validation schema | `node scripts/list-unvalidated-routes.js` | exit 0 | ✓ PASS |
| `deal-wizard.test.js` (CR-01/WR-01/IN-03 regressions) passes standalone | `node --test test/deal-wizard.test.js` | 23/23 | ✓ PASS |
| RAID_LEVELS stays in sync across both copies | `grep RAID_LEVELS server.js validators/workstream.js` | both `['low','medium','high','critical']` | ✓ PASS |
| DD routes exist live | `grep "app\.\(get\|post\|delete\)('/api/dd" server.js` | 21 routes found, matching every route the client references | ✓ PASS |

### Human Verification — Covered by Parallel UAT (not blocking this report)

Per this verification's task scope, the 10 live-browser checkpoints (wizard walk, DD workspace rendering, grants panel, VDR editor, owner nudge, etc.) are being driven in parallel by the orchestrator via Playwright against a running server, tracked in `.planning/phases/04-due-diligence-workspace/04-UAT.md` (status: `testing`, 11 tests currently `[pending]` at the time of this report, 45 items separately auto-covered by the 230-test suite per that file's own `coverage_mode: coverage` classification). These are UI-rendering/live-flow items that source-level grep and the automated suite cannot fully prove (e.g., "does the error message actually become visible," "does the owner-nudge banner dismiss and stay dismissed for the session") — they are correctly deferred to that live process rather than re-litigated here. This verification does not block on their pending state, per explicit orchestration instruction; the code-level and test-level evidence gathered above is sufficient for a `passed` status on the phase's code-backed goal.

One item worth flagging for the parallel UAT to specifically confirm (called out honestly in 04-08-SUMMARY.md itself, not glossed over): the owner-nudge badge/banner's live rendering was not separately itemized in the wave-8 checkpoint's evidence list the way the other six checks were — it was covered by the coordinator's general "everything passed" approval, not a specific quoted observation. This corresponds to UAT item #11 in `04-UAT.md`, currently pending; worth a direct look when that live pass runs.

### Gaps Summary

None. All 5 ROADMAP Success Criteria, all 6 requirement IDs (DD-01..05, WIZ-01), the code-review Critical fix (CR-01), and the D-22 decision amendment are verified directly against the running code and the independently-executed 230/230 test suite — not merely against SUMMARY.md claims. No stub code, no broken wiring, no unresolved debt markers were found in the phase's artifacts.

---

_Verified: 2026-08-02T19:10:00Z_
_Verifier: Claude (gsd-verifier)_
