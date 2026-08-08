---
phase: 06-org-design-talent-retention
reviewed: 2026-08-08T05:44:26Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - db/accessPolicy.js
  - db/collections.js
  - db/schema.sql
  - public/dashboard.html
  - public/due-diligence.html
  - public/execution.html
  - public/js/deal-home.js
  - public/js/due-diligence.js
  - public/js/org.js
  - public/org.html
  - scripts/seed-org-demo.js
  - server.js
  - test/dd-findings.test.js
  - test/migration-roundtrip.test.js
  - test/org-access-policy.test.js
  - test/org-decisions.test.js
  - test/org-flight-risk-audit.test.js
  - test/org-flight-risk-conversion.test.js
  - test/org-import.test.js
  - test/org-positions.test.js
  - test/org-summary.test.js
  - test/raid-access-filter.test.js
  - test/synergy-stage.test.js
  - validators/org.js
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-08-08T05:44:26Z
**Depth:** standard
**Files Reviewed:** 21 (of the 23 listed; `data/demo.db` is a binary and was not read directly — it was reviewed via `scripts/seed-org-demo.js`, its sole writer, per the review instructions)
**Status:** issues_found

## Summary

Reviewed the Phase 6 org-design/talent-retention surface: the `/api/org/*` route family in `server.js` (positions CRUD + graph guards, append-only decisions, the flight-risk register with its D-03 read audit, the capability probe, copy-to-target, the bulk importer, and the clearance-scoped summary rollup), the rewritten `GET /api/raid` provenance filter (`resolveRaidEntryClearanceArea`), `validators/org.js`, the client surfaces (`public/js/org.js`, `public/js/deal-home.js`), and the accompanying test suites.

This is an unusually well-defended phase. Every authz boundary I attempted to break (tier-1 `hr`-area-grant vs tier-2 `isAdminOrIlRequest` governance gate, the target-state read gate, the D-03 audit's two halves, the restricted-tier structural-absence contract on `GET /api/org/summary`, the graph-integrity guard on every write path including import and copy-to-target, the X-Admin-Token break-glass exclusion on governance routes) is independently proven by an existing test, usually with a four-identity matrix (admin / hrbp / hr-granted-pmo / ungranted-pmo) asserting both the 200/403 split and a before/after row-count delta. I could not find an authz bypass in this phase's own code — unusual given this project's stated per-phase track record, but borne out by tracing every route by hand against its test coverage.

The findings below are genuine gaps that fall through those authz nets: two data-integrity/referential-validation gaps and one accepted-but-real MNPI exposure path that is worth surfacing prominently even though it is deliberately tested and documented in the code as an intentional trade-off.

## Warnings

### WR-01: `POST /api/org/positions` never validates that `employeeId` names a real employee

**File:** `server.js:4037-4078`
**Issue:** Both the create branch (line 4069: `employeeId: b.employeeId || null`) and the update branch (line 4058: `if (b.employeeId !== undefined) item.employeeId = b.employeeId || null;`) accept any string up to 120 chars (bounded only by `validators/org.js`'s `z.string().trim().max(ID_MAX)`) with **zero existence check** against the deal's employee roster. This is inconsistent with the sibling route `POST /api/org/flight-risk`, which explicitly validates the reference two lines apart (`server.js:4527` and `:4542`: `if (!employeeList.find((e) => e.id === b.employeeId)) return res.status(404)...`), and with `POST /api/org/positions/import`, which only ever writes an `employeeId` it resolved or created itself.

Concretely: any `hr`-grant-cleared caller (tier 1 — not just admin/IL) can `POST /api/org/positions` with `{ "employeeId": "emp_does_not_exist" }` via a direct API call (not reachable through the UI, since `buildEmployeeSelect()` only offers real ids, but fully reachable via curl/Postman) and get a 201/200. The resulting position then:
- Renders on the tree with the raw id string as the "occupant" (`public/js/org.js:535`: `employeeNameFor(...) || node.position.employeeId`), since `employeeNameFor()` returns `''` for a non-match and the `||` falls back to the id.
- Silently counts as "occupied" in `orgSummaryFor()`'s headcount tally (`server.js:4691`, a bare truthy check on `p.employeeId`), inflating `currentHeadcount`/`targetHeadcount` for a person who does not exist in the roster.
- Is picked up by `DELETE /api/employees/:id`'s orphan guard (`server.js:5522`) only by coincidence of id equality — a red herring since the id was never real to begin with.

**Fix:** Mirror the flight-risk route's check in both branches of `POST /api/org/positions`:
```js
if (b.employeeId) {
  const employeeExists = employeeRosterLane(db).some((e) => e.id === b.employeeId);
  if (!employeeExists) return res.status(404).json({ error: 'That employee could not be found.' });
}
```
placed before the graph-failure check on both the create and update paths.

### WR-02: The flight-risk register's `owner` field is free text with no default from the caller's own identity — repeats the exact class of bug this phase's own seed script had to fix

**File:** `public/js/org.js:974-1034` (form), `server.js:4507-4566` (write route)
**Issue:** `GET /api/org/summary`'s `mine.unmitigatedFlightRisks` (the field `renderFlightRiskNudge()` in `public/js/deal-home.js` keys D-22's owner nudge on) is computed by exact string equality: `String(r.owner || '').trim() === myUsername` (`server.js:4733`). The stored `owner` value comes entirely from `ownerInput.value` in `buildFlightRiskForm()` — a plain, unprefilled `<input type="text">` with placeholder `'Owner (required)'` and no default value. Neither the client nor the server (`server.js:4549`: `owner: String(b.owner || '').trim()`) ever populates it from the signed-in session's own username (available client-side as `window.__portalUser.username`, set by `public/js/transitions.js:201`, but never referenced anywhere in `org.js`).

This is precisely the mistake `scripts/seed-org-demo.js`'s own comment (lines 230-241) documents having been caught and fixed for the seed data: "this previously read 'Karen Peterson' (the display name) — a value that can never equal any session's username — so karen's own `mine.unmitigatedFlightRisks` stayed 0 no matter how the demo was walked." The seed data is now fixed, but the live entry form that a real operator uses has the identical failure mode: any IL who types their display name, a nickname, or even their own username with different casing/whitespace than their literal session username silently defeats the "mine" nudge for every entry they create — with no error, no warning, and no way to discover the mismatch short of the nudge simply never appearing.

**Fix:** Prefill `ownerInput.value` from `window.__portalUser && window.__portalUser.username` when the form is built (falling back to the current empty-string behavior if `window.__portalUser` is unavailable, e.g. on a PORTAL_AUTH-disabled demo deployment), and/or have the server default `owner` to `req.portalUser.username` when the field is omitted, mirroring how `decidedBy` is already stamped server-side on `POST /api/org/decisions` rather than trusted from the client.

### WR-03: Deleting a converted DD finding retroactively declassifies its derived RAID entry to the whole deal

**File:** `server.js:3877-3890` (`resolveRaidEntryClearanceArea`), proven and accepted by `test/raid-access-filter.test.js` test (f)
**Issue:** `GET /api/raid`'s new provenance filter resolves an entry's clearance area by following `entry.source` (`dd-finding:<id>` or `org-flightrisk:<id>`) back to its origin. When the origin no longer exists — e.g. a Legal-area DD finding is deleted via `DELETE /api/dd/findings/:id` after having been converted into a RAID entry — `resolveRaidEntryClearanceArea()` returns `null`, and `GET /api/raid`'s filter (`area === null || accessPolicy.hasAreaGrant(...)`) treats `null` as **unfiltered, visible to every deal member**. `test/raid-access-filter.test.js` test (f) exercises this exact scenario and asserts it as the intended behavior, with the code comment explicitly weighing this against the alternative failure mode (an orphaned link becoming permanently invisible to everyone, including admin).

This is a deliberate, documented, tested trade-off, not an oversight — but it is worth surfacing as a residual finding given this project's explicit MNPI/clean-room charter: any `pmo`/`hrbp` member cleared to delete DD findings (the DD write surface is `admin, hrbp, pmo` per `ROLE_WRITE_POLICY`, `server.js:315`) can, by deleting a converted finding (intentionally or by routine cleanup), cause previously Legal/Financial/Tax-restricted content that still lives verbatim in the RAID entry's `title`/`notes` to become visible to every deal member, including `employee`-role members, with no re-confirmation prompt and no audit trail distinguishing "declassified via deletion" from "was always unrestricted."

**Fix (if this residual risk is judged unacceptable on revisit):** Refuse the finding delete (or require an explicit override) while a RAID entry still references it via `source`, or have the delete cascade a redaction/removal of the derived RAID entry's `title`/`notes` rather than merely orphaning the link. If the current trade-off is intentional and stands, at minimum log a distinguishable audit event when `resolveRaidEntryClearanceArea()` resolves an orphaned `dd-finding:` source to `null` on a read, so a security review can retroactively detect how many reads happened under the widened, unintended audience.

## Info

### IN-01: `positions.employeeId` and `flightRisks.employeeId` are validated inconsistently across the org surface

**File:** `server.js` (positions routes vs. flight-risk routes)
**Issue:** Beyond WR-01's specific gap, the broader pattern worth naming for future maintainers: `POST /api/org/flight-risk` and `POST /api/org/positions/import` both validate `employeeId` against the live roster before writing; `POST /api/org/positions` does not. A future reviewer skimming only the flight-risk route could reasonably (and incorrectly) assume the same discipline holds everywhere in this file.
**Fix:** Once WR-01 is fixed, consider extracting a single `assertEmployeeExists(db, employeeId)` helper (returning a 404 response or throwing) used by all three write paths, so the three call sites can never independently drift again.

### IN-02: `org.html` carries no `pageAccess` entry in `public/js/transitions.js`, unlike every other role-gated page except `due-diligence.html`

**File:** `public/js/transitions.js:145-177` (not in this phase's file list, but composes directly with the new `org.html`)
**Issue:** Every server-side control for the org surface is correctly clearance/role-gated (verified above), and this mirrors `due-diligence.html`'s existing, explicitly-documented precedent (`transitions.js:168-176`) of leaving MNPI-clearance-scoped pages off the role-based client convenience gate on purpose. However, unlike `due-diligence.html`, `org.html` carries **no comment of its own** explaining this choice — a future maintainer scanning `pageAccess` for "which pages have no entry and why" would have to infer the org page falls under the same rationale rather than being simply forgotten.
**Fix:** Add a one-line comment next to the `due-diligence.html` explanation in `pageAccess` (or beside `org.html`'s own routes) stating that `org.html` is deliberately absent for the identical reason — per-deal-member clearance (`hr`-area grant / `current`-state-open), not role, gates this page, matching `due-diligence.html`.

---

_Reviewed: 2026-08-08T05:44:26Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
