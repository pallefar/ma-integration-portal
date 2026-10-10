# Phase 11: Authorization & Clean-Room Closure - Context

**Gathered:** 2026-10-10
**Status:** Ready for planning
**Source:** PRD Express Path (.planning/reviews/v3.0/PHASE-11-PRD.md)

<domain>
## Phase Boundary

Every read and write is authorized for who the caller is: an explicit read policy (fail-closed, coverage-tested),
admin-only configuration/content surface, clean-room clearance enforced on task/RAID write/delete/409 paths (404 for
invisible records), no GET that mutates, rate-bounded denial auditing, personal-data read limits, canonical-path gating.
Requirements: AUTHZ-01..05. Out of scope: module switch (Phase 15), sanitizer/CSP/egress (13), deal files (14), audit
partitioning (12), IL membership management (22).

</domain>

<decisions>
## Implementation Decisions

LOCKED (full wording in PHASE-11-PRD.md): **D-11-01** ROLE_READ_POLICY on the canonical path, fail-closed, coverage test,
demo store lenient; **D-11-02** config surface admin-only + public-subset GET /api/settings + deal-level values via
POST /api/deals/:id/setup; **D-11-03** assertRecordVisibleOr404 on task/RAID write/delete/status-flip/conversion paths +
CLEARANCE_SCOPED_COLLECTIONS extension (closes Phase 9 UF-2); **D-11-04** get-or-create → POST + instrumented no-GET-mutates
test; **D-11-05** rate-bounded denial security events; **D-11-06** pulses/hrbps personal-data limits; **D-11-07** every gate on
lib/requestPath.js canonical path with variant tests.

### Claude's Discretion
Module/file layout of the policy table and helper, exact role matrix details beyond the PRD draft (document the final table
in DEPLOYMENT.md), test organisation, how client call sites adapt (hide controls that would 403; list them), error strings.

</decisions>

<canonical_refs>
- `.planning/reviews/v3.0/PHASE-11-PRD.md`; `.planning/REQUIREMENTS.md` (AUTHZ-01..05); `.planning/ROADMAP.md` Phase 11 SC1–4
- `.planning/reviews/v3.0/R1-security.md` (R1-02, R1-05, R1-15, R1-16), `R3-modules-admin-control.md` (F-1, F-2), Phase 9 `09-SECURITY.md` (UF-2), Phase 10 `10-REVIEW.md` (CR-01 lesson), `10-SECURITY.md`
- `server.js` (gate, ROLE_WRITE_POLICY, DEMO_ONLY_PREFIXES, conflictIfStale callers, task/RAID/synergy/org/dd routes, settings/menus/pages routes), `lib/requestPath.js`, `db/accessPolicy.js`, `db/collections.js`, `test/auth-route-inventory.test.js`, `validators/*`, `scripts/list-unvalidated-routes.js`
</canonical_refs>

<specifics>
Test helpers: `test/helpers/listen-local.js`, `test/helpers/seed-identity.js`, `test/helpers/held-version.js`; Playwright harness pattern scripts/uat/phase10-walk.js; isolated MA_* temp paths only.
</specifics>

<deferred>
Module-level switch (15), AI egress flag (13), membership UI (22), read-policy UI for employees beyond hiding controls.
</deferred>

---
*Phase: 11-authorization-clean-room-closure*
