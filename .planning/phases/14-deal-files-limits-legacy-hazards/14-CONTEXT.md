# Phase 14: Deal Files, Limits & Legacy Hazards - Context

**Gathered:** 2026-10-11
**Status:** Ready for planning once Phase 13 closes (13-12..14 open at writing)
**Source:** PRD Express Path (.planning/reviews/v3.0/PHASE-14-PRD.md)

<domain>
## Phase Boundary
Deal files (communications, media, slides) move from the shared static tree to a per-deal store beside the deal database,
readable only through `GET /api/files/<kind>/<fileId>.<ext>` (session, membership bind, the owner's read rule, windowed read
audit) and removed by the DATA-04 purge path and deal deletion; legacy `/sent_emails` and `/uploads` are not served in
real-deal mode (demo keeps them); body limits are per route from a measured default; `download-zip` is gone and the
reset/migrate/custom-lane footguns cannot fire inside a deal. Requirements SAFE-04, SAFE-05, SAFE-08.
</domain>

<decisions>
## Implementation Decisions
LOCKED D-14-01..08 (full wording, numbers, acceptance in PHASE-14-PRD.md): `<DEALS_DIR>/<dealId>.files/` store, lane by
RESOLVED STORE (deal-bound ⇒ store in every mode, demo store unchanged, real-mode non-deal ⇒ 409 `dealRequired`), no new table;
three gated GET routes, server-minted names, strict per-kind regex, no-store/nosniff/CORP, per-type sandbox CSPs, no
Range/ETag; resolver-bound lookup (wrong deal ⇒ 404), READ rows mirroring the owner collections + drift test, `deal-file-read`
before the bytes, ≤ 1 row per (actor, deal, kind, file) per 15 min; media gets the slide allowlist/10 MiB/quota contract in
every mode; `removeDealFiles` inside `purgePartition` and before `deleteDeal`; one identity-based static guard (Phase 15 seam
named, not built); default body 2 MiB, exactly three large-body routes at 16 MiB parsed after auth, `urlencoded` removed, fixed
413 `body-too-large`; `download-zip` + card deleted everywhere; real-mode unmount of new-ma/migrate-db; custom-lane switches
demo-store-only; demo-store new-ma wipe narrowed to unreferenced lane files.
### Claude's Discretion
Module layout and helper names, how `lib/slideUpload.js` becomes per-kind (slide bodies byte-identical), the windowed read
auditor (extend `lib/denialAudit.js` or a sibling), exact regexes/id prefixes within D-14-02, demo-lane dir-override env names,
walk/smoke scenario design, plan/wave split (suggested: store + comm route + audit tracer; media/slide writes; static guard;
body limits; SAFE-08 + admin console; purge/delete + DEPLOYMENT.md; walks, smoke and the listed contract-test amendments).
</decisions>

<canonical_refs>
- `.planning/reviews/v3.0/PHASE-14-PRD.md`, `.planning/REQUIREMENTS.md` (SAFE-04/05/08, mode contract, DATA-04), `.planning/
  ROADMAP.md` Phase 14 SC1–3; reviews R1 (R1-06/10), R2 (R2-12), R3 (F-3, §1.2, §4.2(b)), R5 (R5-06/08), PLAN-REVIEW
  (PR-14/25/26), `PHASE-13-PRD.md` (D-13-04/05)
- `server.js` (lockdown :276, parsers :295-309, slides mount :402-437, `.html` terminal :439-454, static :479, DEMO_ONLY :916,
  gatePolicy :935, real-mode unmount :968, gate :1011-1129, deal delete :2368, audit purge :2538, download-zip :2610, settings
  :2940, new-ma :3082, projects :3218-3296, slide upload :3414, media :3643-3686, migrate-db :3874, comms :9063-9160)
- `db/dbFiles.js` (DEALS_DIR :112, DEAL_ID_RE :147, dealDbPath :204, assertTestIsolation :383), `db/resolver.js` (:48,
  :87-120), `db/controlStore.js` :566, `db/auditLifecycle.js` :568, `lib/readPolicy.js`, `lib/requestPath.js`,
  `lib/slideUpload.js`, `lib/denialAudit.js`, `validators/cms.js` (:19, :237-280), `validators/settings.js` (:215-219)
- `public/admin.html` (:24, :504, :522, :674-701), `public/js/admin.js` (:120-136, :1938, :2036-2058, :2185, :2978),
  `public/js/transitions.js` openHtmlSlide :1188-1245, `scripts/audit-admin.js`, `scripts/smoke/pages.js`, the Phase 13 runner
  (13-12), `DEPLOYMENT.md` (§Roles READ table, §Audit trail 3)
</canonical_refs>

<specifics>
Helpers: test/helpers/listen-local.js, seed-identity.js, deal-fixture.js, route-inventory.js; isolated MA_* temp paths (the
store follows MA_DEALS_DIR); MA_MODE=real → data/real. Measured: Save-all 310,234 B (1,076 keys × 4); org import at 500 rows
≤ 167,918 B; 10 MiB decoded = 13,981,016 B base64; demo guidebook 6,321,279 B. Never call POST /api/settings/new-ma against the
repo tree; never start a server on committed data/*.db; hash committed DBs (and real-lane `public/`) around every walk.
</specifics>

<deferred>
Module gate/page rules/`/` fallback (15); showcase chrome + Projects tab (16/17); unbound lane for non-file routes (17);
clearance-scoped attachments (18); file rate limits, logs, knob validation, read-auditor SIGTERM flush, `/readyz` disk (20);
file-dir backup/restore (21); employee inbox (22); removing the custom lanes; per-deal RAG; video + Range; AV scanning.
</deferred>

---
*Phase: 14-deal-files-limits-legacy-hazards*
