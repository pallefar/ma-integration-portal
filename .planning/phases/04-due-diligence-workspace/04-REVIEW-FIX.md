---
phase: 04-due-diligence-workspace
fixed_at: 2026-08-02T16:11:22Z
review_path: .planning/phases/04-due-diligence-workspace/04-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 4: Code Review Fix Report

**Fixed at:** 2026-08-02T16:11:22Z
**Source review:** .planning/phases/04-due-diligence-workspace/04-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (1 Critical, 2 Warning, 3 Info — `fix_scope: all`)
- Fixed: 6
- Skipped: 0

All fixes were applied and committed inside an isolated git worktree
(`/tmp/sv-04-reviewfix-bC1D0b`, branch `gsd-reviewfix/04-4943`), then
fast-forward-merged onto `main`. Test suite verified after every single fix:
baseline 224/224 -> final 230/230 (6 new regression tests, zero regressions).

## Fixed Issues

### CR-01: Any deal member can fabricate another member's assigned readiness assessment (no ownership check on instanceId completion)

**Files modified:** `server.js`, `test/deal-wizard.test.js`
**Commit:** `d86b79c`
**Applied fix:** Added a server-side ownership check inside the `if (instanceId)`
branch of `POST /api/assessment-instances`, before any mutation of the pending
row. The caller must either be an elevated role (`admin`/`hrbp`) or have a
session username matching `pending.owner` (trimmed) — otherwise the route now
403s with `"You are not the assigned owner of this assessment."`. Verified
against the actual live identity fields (`req.portalUser.username`,
`req.portalUser.role`) rather than assuming the review's illustrative patch
verbatim; the check is skipped only when `req.portalUser` is `null` (anonymous
`DEMO_OPEN` mode — no real identity, no MNPI content in the demo lane), fail
closed everywhere else. Added regression tests `deal-wizard (t)` (non-owner
403, real owner still succeeds) and `deal-wizard (u)` (hrbp elevated-override
still works) to `test/deal-wizard.test.js`.

### WR-01: Pending-assessment `owner` names bypass the endpoint's own "no personal data unless admin" rule

**Files modified:** `server.js`, `test/deal-wizard.test.js`
**Commit:** `ba0c840`
**Applied fix:** The `pending` array built in `GET /api/assessment-status` now
gates the `owner` field the same way `statusInstance()` already gates
`respondentName` (via the existing `stripNames` flag): `owner` is visible only
to admin/hrbp or to the session whose username matches the row's `owner`
value; every other caller sees `owner: ''`. `id` and `dueDate` stay
unconditionally visible (CR-01's ownership check is what actually governs who
can act on a pending row, so leaking the id alone is no longer exploitable).
Added regression test `deal-wizard (v)`, which verifies hrbp and the real
assignee both still see the true owner value while an unrelated `employee`
deal member sees it stripped — proving `public/js/deal-home.js`'s legitimate
"Owner: X" display keeps working for the callers who should see it.

### WR-02: `source` on DD request items/findings is caller-writable and doubles as the template-instantiate dedup key

**Files modified:** `validators/dd.js`, `test/dd-workspace.test.js`
**Commit:** `8a40597`
**Applied fix:** Removed the `source` field from `DdRequestItemUpsertSchema`
entirely (`z.object(shape)` strips unknown keys by default, so this alone is
sufficient — no `.strict()` needed). Confirmed via grep that no legitimate
client path (`public/js/due-diligence.js`) ever sends `source`; only
server-computed paths (`POST /api/dd/request-items/instantiate`'s
`'ddtemplate:<templateId>:<itemId>'` dedup key, and the finding-conversion
route's own `'dd-finding:<findingId>'` key, which uses a separate schema that
never declared `source`) still set it. Removed the now-unused `SOURCE_MAX`
constant. Added regression test `dd-workspace (i)`, proving a caller-supplied
`source` on create is stripped and never stored.

### IN-01: DD `dueDate` accepts any ≤10-char string, not a validated calendar date

**Files modified:** `validators/dd.js`, `test/dd-workspace.test.js`
**Commit:** `1f7bb72`
**Applied fix:** Added a `.refine()` to the `dueDate` field backed by a real
calendar-date check (`isValidCalendarDate()`), which validates the
`YYYY-MM-DD` shape, the month range, and the day range against the actual
number of days in that month/year (leap years included, via the
`Date.UTC(y, m, 0)` "day 0 of next month" trick). An empty string is still
accepted (clears the due date, matching `due-diligence.js`'s
`<input type="date">` client behavior); the existing 10-char length bound is
preserved. Added regression test `dd-workspace (j)`: `'2024-13-40'` is now
refused with a 400, a real leap-year date (`'2024-02-29'`) is accepted, and
clearing via `''` still works.

### IN-02: `due-diligence.html` is absent from `transitions.js`'s `pageAccess` map

**Files modified:** `public/js/transitions.js`, `public/due-diligence.html`
**Commit:** `0beb481`
**Applied fix:** Documentation-only, per the review's own recommended
alternative — no restrictive `pageAccess` entry was added (that would break
legitimate cleared pmo/employee deal members, per the constraint). Added an
explicit comment at the end of the `pageAccess` map declaration explaining
that `due-diligence.html`'s absence is deliberate: DD access is per-deal-member
area clearance enforced server-side (`db/accessPolicy.js`), not role-based.
Bumped `due-diligence.html`'s `transitions.js` cache-stamp
(`?v=1784700001` -> `?v=1784700004`) per this project's cache-busting
convention. `transitions.js` is shared by 18 HTML pages; since this change is
comment-only with zero runtime behavior difference, only `due-diligence.html`
(the page this finding is about) was bumped — the other 17 consumers were
intentionally left untouched.

### IN-03: `respondentName`/`rater`/`respondentRole` on assessment completion are entirely caller-supplied, not session-derived

**Files modified:** `server.js`, `test/deal-wizard.test.js`
**Commit:** `97dda14`
**Applied fix:** On the `instanceId` completion path specifically (only),
`pending.respondentName` is now stamped from `req.portalUser.username` rather
than the request body, so the verified owner (per CR-01's check, which now
runs first) cannot complete their own assignment while claiming to be a
different teammate. Falls back to the caller-supplied value only in anonymous
`DEMO_OPEN` mode (no real identity to stamp). The non-`instanceId` (ad-hoc
self-service submission) path was left untouched, per the constraint. Added
regression test `deal-wizard (w)`, proving a fabricated `respondentName` in
the request body is ignored and the session username is stored instead.

## Skipped Issues

None — all 6 in-scope findings were fixed.

---

_Fixed: 2026-08-02T16:11:22Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
