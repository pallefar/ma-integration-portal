# Phase 11 — Authorization & Clean-Room Closure — PRD / locked decisions (orchestrator, 2026-10-10)

Input for `/gsd-plan-phase 11 --prd` (research + UI-spec skipped by design; evidence is in the review lanes).
Requirements: AUTHZ-01..05. Depends on Phase 10 (accounts, MA_MODE=real, `lib/requestPath.js` canonical path).
Evidence: R1-02, R1-05, R1-15, R1-16, R3 F-1/F-2 (`.planning/reviews/v3.0/R1-security.md`, `R3-modules-admin-control.md`),
Phase 9 UF-2 (`10`/`09-SECURITY.md`: converted task/RAID 409 bodies lack clearance filtering), Phase 10 CR-01 lesson
(Express matches case-insensitively — every gate must use the canonical path).

## Problem (verified live by the review)
Reads are gated on "has a session" only: an `employee` gets synergy financials, RAID, tasks, roster, comms, pulses
(named ratings/comments), org positions. `pmo`/`hrbp` can write settings (incl. `demoMode`, `geminiApiKey`), menus,
pages, banners, slides, media. A deal member without the `hr` clearance can read/overwrite/delete a restricted
task/RAID record by id and Phase 9's 409 body echoes it (write paths never call the clearance resolver). One GET
(`/api/employees/get-or-create`) writes. No denial is logged.

## Locked decisions
**D-11-01 Read policy.** Add `ROLE_READ_POLICY` (same `{prefix, exact?, methods?, roles}` shape as ROLE_WRITE_POLICY),
matched on the CANONICAL path (`lib/requestPath.js`), evaluated in the consolidated `/api` gate for every GET/HEAD
after identity resolution. Fail-closed default: an unlisted `/api` read route is refused (403 `{error}`) in deal-bound
requests AND a coverage test fails the build when any registered GET route has no policy entry (VAL-01 precedent —
model on test/auth-route-inventory.test.js). Draft policy for REAL deals (deal-bound): `admin` all; `hrbp` (Integration
Leader) all deal data + CMS reads; `pmo` (workstream lead) tasks/RAID/synergies/reports/DD+org within clearance, no admin
or settings secrets; `employee` ONLY: courses/lessons, own assessment instances, own pulse, notifications, welcome/CMS
content needed by the employee portal, own profile — NOT synergies, RAID, tasks, roster, communications, others' pulses,
org, DD, reports, settings secrets. Demo store (`req.isDemo`) keeps today's lenient reads — the showcase must be unchanged.
**D-11-02 Config surface admin-only.** `POST /api/settings`, `/api/menus`, `/api/pages`, `/api/banners*`,
`/api/slides*`, `/api/media*`, `/api/i18n`, `/api/courses*` writes and any AI-key/egress setting are admin-only
(ROLE_WRITE_POLICY entries + inline guard for method-specific cases). `GET /api/settings` returns a PUBLIC SUBSET to
non-admins (strip `geminiApiKey`, `connectionDetails`, any secret-ish field — allowlist, not blocklist). Deal-level
values the IL must be able to change (currency, synergy target, Day-1 date, synergyStaleDays/HorizonYears) move to the
deal's own `POST /api/deals/:id/setup` (extend its zod schema; admin+hrbp members) — the instance settings singleton is
no longer IL-writable.
**D-11-03 Clean-room on task/RAID (and every clearance-carrying record).** One shared helper
`assertRecordVisibleOr404(req, db, deal, record)` (reusing resolveTaskClearanceArea/resolveRaidEntryClearanceArea) called
BEFORE `conflictIfStale` and before any body is built on: task POST (create-with-id/update/status flip), task DELETE,
RAID POST/DELETE, synergy→task link routes, conversion routes. Invisible record ⇒ 404 `{error:'Not found'}` (never 403, no
echo, no 409 body). Extend `CLEARANCE_SCOPED_COLLECTIONS` (db/collections.js) with integrationTasks, raidEntries (+ custom
lanes) using a clearanceArea-aware filter so the store-layer WHERE-conflict backstop fails closed for them too (closes
09-SECURITY UF-2). Reads were already filtered (v2.1.0 F-1) — keep and cover with the new tests.
**D-11-04 No GET mutates.** `GET /api/employees/get-or-create` becomes `POST` with a zod schema (client call sites
updated); add a test that instruments the write paths (store.writeDb + control-plane writers) and drives EVERY registered
GET route as admin — any write fails the test. Static `app.get` handlers that call a writer are fixed or converted.
**D-11-05 Denial audit.** Every 401/403 from the gates and every clearance-404 records a security event
(actor/anonymous, canonical route, method, reason code) via recordSecurityEvent, RATE-BOUNDED (per actor+route+reason
at most one row per 60 s with an incrementing counter in the same row's detail — a probe must not flood audit.db;
audit.db is append-only and already amplification-prone, R1-07/R2-01 — do not add per-request rows).
**D-11-06 Personal data.** `GET /api/pulses` returns named ratings/comments only to admin/hrbp and to the author;
others get aggregate-only. `/api/hrbps` (emails) admin/hrbp. Record the policy table in DEPLOYMENT.md "Roles and what
they can read".
**D-11-07 Canonical path everywhere.** Every new/changed gate uses lib/requestPath.js; tests include case/encoding/
double-slash/trailing-slash variants for every prefix family touched (loop over the tables).

## Out of scope
Module switch (Phase 15), sanitizer/CSP/egress flag (Phase 13), deal files (Phase 14), audit partitioning (Phase 12),
membership management by the IL (Phase 22), UI changes beyond hiding controls that would now 403 (list them).

## Acceptance (demonstrable, tests + one Playwright smoke)
1. Real deal, `employee` session: 403 on /api/synergies, /api/raid, /api/integration-tasks, /api/employees (list),
   /api/communications, /api/org/*, /api/dd/*, /api/reports/*, others' pulses; 200 on courses/lessons/notifications/own pulse.
2. `pmo`/`hrbp` get 403 on POST settings/menus/pages/banners/slides/media/i18n; `hrbp` can still edit deal-level values via
   the setup route; `GET /api/settings` for non-admins contains no secret field (allowlist test).
3. Uncleared member: 404 on read/update/status-flip/delete of an `hr`-area task and RAID entry, 404 (not 409) with a stale
   version, no field of the record in any response; cleared member and admin unaffected; conversions still work.
4. Coverage: every registered GET route has a read-policy entry (test fails on a new unlisted route); no GET mutates (instrumented test).
5. Variant paths (`/api/Synergies`, `//api/raid`, `%2e`…) get the same verdict as the canonical path.
6. Denials produce rate-bounded audit rows (≤1/60 s per actor+route+reason); suite green (1055 base); demo suite + Phase 9/10 walks unchanged.
