---
phase: 04-due-diligence-workspace
reviewed: 2026-08-02T10:04:42Z
depth: standard
files_reviewed: 34
files_reviewed_list:
  - db/accessPolicy.js
  - db/collections.js
  - db/controlStore.js
  - db/ddRequestTemplateSeed.js
  - db/dealSeed.js
  - db/schema.sql
  - server.js
  - validators/dd.js
  - validators/deals.js
  - validators/wizard.js
  - validators/assessment.js
  - validators/workstream.js
  - scripts/seed-dd-request-templates.js
  - public/js/deal-home.js
  - public/js/deal-wizard.js
  - public/js/due-diligence.js
  - public/js/dashboard.js
  - public/js/deal-switcher.js
  - public/js/admin.js
  - public/js/transitions.js
  - public/deal-wizard.html
  - public/due-diligence.html
  - public/dashboard.html
  - public/admin.html
  - test/dd-workspace.test.js
  - test/dd-access-policy.test.js
  - test/dd-grants.test.js
  - test/dd-seed.test.js
  - test/dd-findings.test.js
  - test/dd-vdr.test.js
  - test/dd-summary.test.js
  - test/deal-wizard.test.js
  - test/deal-wizard-page.test.js
  - test/deal-seed.test.js
findings:
  critical: 1
  warning: 2
  info: 3
  total: 6
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-08-02T10:04:42Z
**Depth:** standard
**Files Reviewed:** 34
**Status:** issues_found

## Summary

The core clean-room primitive (`db/accessPolicy.js`) and its use across every
`/api/dd/*` route is well-built: `filterByAreaGrant()`/`assertAreaGrant()` are
applied consistently on every list and by-id DD route, the by-id 403 is
byte-identical for "unknown id" vs. "uncleared area" (verified live and by
`test/dd-workspace.test.js` (g) / `test/dd-findings.test.js` (f)), the
`GET /api/dd/summary` aggregate filters before tallying, the VDR URL is
scheme-restricted both at write (`.refine()` on the parsed protocol) and at
render (`safeVdrUrl()` in `due-diligence.js`), `RAID_LEVELS` stays in sync
between `server.js` and `validators/workstream.js` (proven by a source-level
test), and the pre-fixed `GET /api/deals/:id/grants` disclosure now carries an
explicit inline `admin`/`hrbp` check with a regression test. No `innerHTML`
(or other markup-assignment sink) was introduced by any new file in this
phase. The DD write surface never touches the filesystem (proven by
`test/dd-vdr.test.js` (l)/(m)).

However, the WIZ-01 "assign + complete-in-place" readiness-assessment
mechanic introduces a real authorization gap: a pending assessment instance's
id is exposed unrestricted to any deal member via `GET /api/assessment-status`,
and the completion route (`POST /api/assessment-instances` with `instanceId`)
never verifies the caller is the row's assigned owner before promoting it to
`submitted`. Combined, any deal member — including the `employee` role, and
certainly `pmo` — can fabricate the completion of another member's assigned
readiness assessment, corrupting a record this app itself uses to gate
100-Day Roadmap access. This is flagged as Critical below. Two further
Warning/Info items round out the review.

## Critical Issues

### CR-01: Any deal member can fabricate another member's assigned readiness assessment (no ownership check on instanceId completion)

**File:** `server.js:2573-2607` (completion route), `server.js:2687-2725` (unrestricted id disclosure)
**Issue:**
`POST /api/assessment-instances/assign` (server.js:2650) creates a `pending`
row carrying an `owner` field (a free-text name, e.g. `"karen"`) — the
person the Integration Lead intended to complete that specific readiness
assessment. `POST /api/assessment-instances` (server.js:2573) then lets that
row be completed **in place** by supplying its `instanceId`:

```js
if (instanceId) {
  const lane = assessLane(db);
  const pending = lane.find(i => i.id === instanceId);
  if (!pending) return res.status(404).json({ error: 'Assessment instance not found.' });
  if (pending.status !== 'pending') {
    return res.status(400).json({ error: 'This assessment instance is not pending completion.' });
  }
  pending.rater = (template.raterModes || ['self']).includes(rater) ? rater : (pending.rater || 'self');
  pending.respondentRole = String(respondentRole || '').slice(0, 60);
  pending.respondentName = String(respondentName || '').slice(0, 120);
  pending.responses = responses;
  Object.assign(pending, scoresBlock);
  pending.status = 'submitted';
  ...
```

There is **no check anywhere in this branch that `req.portalUser.username`
(or any session identity) matches `pending.owner`**. Any caller who can reach
this route with a valid `instanceId` can complete (and thereby permanently
close, per the `pending.status !== 'pending'` guard on re-use) an assessment
that was assigned to someone else, self-attributing an arbitrary
`respondentName`/`respondentRole`/`rater` and an arbitrary score.

The `instanceId` is not a secret: `GET /api/assessment-status` (server.js:2687)
has **no role or ownership gate at all** (unlike `latestInstance`, which is
name-stripped for non-admins under `lockedDown()`), and unconditionally
returns every template's `pending` array to any authenticated deal member:

```js
const pending = visible
  .filter(i => i.templateId === t.id && i.status === 'pending')
  ...
  .map(i => ({ id: i.id, owner: i.owner || '', dueDate: i.dueDate || '' }));
...
const entry = { ..., pending };
```

**Failure scenario:** Karen (hrbp, Integration Lead) assigns herself the
`integration-leader` readiness template via the wizard. Pmo (a workstream
lead on the same deal, role `pmo`) calls `GET /api/assessment-status`, reads
`bySubject['integration-leader'].pending[0].id`, then `POST
/api/assessment-instances` with that `instanceId` and fabricated high scores.
The row is now `submitted`, `satisfied` flips to `true`, the
`dashboard.phase.plan` gate unlocks, and Karen's own attempt to actually
complete her assignment later 400s ("not pending completion") — she never
learns her assignment was silently closed by someone else, under a
respondent identity she never chose. `pmo` is not a privileged role for this
purpose; per `ROLE_WRITE_POLICY`, even `employee` can reach `POST
/api/assessment-instances` (self-service rule, server.js ~line 278), so an
acquired-company employee added to a deal for onboarding purposes could do
the same to any pending row in that deal, including one assigned to the IL.

No test in `test/deal-wizard.test.js` or elsewhere exercises "a different
user completes someone else's pending instance" — every test that touches
the `instanceId` path uses the SAME session that created the assignment.

**Fix:** Verify the caller's identity against `pending.owner` before allowing
completion (or, if `owner` is meant to stay a free-text label rather than a
username, add a `assignedTo: req.portalUser.username` field at assign-time
and require it to match `req.portalUser.username` — or restrict completion of
a *specific instanceId* to admin/hrbp plus the session that appears to be the
named owner). At minimum, `GET /api/assessment-status`'s `pending` array
should not expose `id` (the only thing needed to exploit this) to every deal
member if only the assignee is meant to act on it.

```js
// server.js, inside the `if (instanceId)` branch, before any mutation:
const isOwner = String(pending.owner || '').trim() &&
  String(pending.owner || '').trim() === req.portalUser.username;
if (!isOwner && !['admin', 'hrbp'].includes(req.portalUser.role)) {
  return res.status(403).json({ error: 'You are not the assigned owner of this assessment.' });
}
```

## Warnings

### WR-01: Pending-assessment `owner` names bypass the endpoint's own "no personal data unless admin" rule

**File:** `server.js:2687-2725`
**Issue:** `GET /api/assessment-status` has an explicit, documented rule:
"In any locked-down posture the status rollup carries scores/bands only — no
respondent names ... unless the requester is an admin" (`stripNames`,
applied only to `latestInstance` via `statusInstance()`). The new `pending`
array added in this phase carries `owner` (a person's name/handle)
unconditionally — `stripNames` is never consulted for it:

```js
const pending = visible
  .filter(i => i.templateId === t.id && i.status === 'pending')
  ...
  .map(i => ({ id: i.id, owner: i.owner || '', dueDate: i.dueDate || '' }));
```

Whether or not "who is assigned this pending task" is as sensitive as "who
submitted this rating," it is the same category of personal data the
existing rule was written to gate, and the new field silently reintroduces
it for every non-admin caller in a locked-down posture. This is also the
exact field CR-01 depends on to identify a target — closing this exposure
would meaningfully narrow that attack surface even without CR-01's fix.
**Fix:** Route `pending`'s `owner` field through the same `stripNames` check
`statusInstance()` already applies, or gate the whole `pending` array to
admin/hrbp/the assigned owner.

### WR-02: `source` on DD request items/findings is caller-writable and doubles as the template-instantiate dedup key

**File:** `validators/dd.js:71` (`source: z.string().trim().max(SOURCE_MAX).optional()`), `server.js:3329-3355` (`POST /api/dd/request-items/instantiate`)
**Issue:** `DdRequestItemUpsertSchema` accepts an arbitrary `source` string on
create. `POST /api/dd/request-items/instantiate` treats `source` as its
dedup key:

```js
const source = 'ddtemplate:' + tpl.id + ':' + tplItem.id;
if (lane.some((i) => i.source === source)) return;  // silently skipped, no error
```

A DD writer (admin/hrbp/pmo — the roles allowed to POST `/api/dd/*`) can
manually create an item whose `source` collides with a future
`'ddtemplate:<templateId>:<templateItemId>'` value. Instantiating the
standard checklist afterward will silently skip that item forever — the
`created`/`skipped` counters returned to the UI make it *look* successful
(no error surfaces), and `due-diligence.js`'s "Load standard checklist"
button gives no indication a specific item was suppressed. This requires an
already-trusted DD-writer role to exploit and is low-impact (self-sabotage
or accidental data loss of one checklist line, not a cross-role privilege
escalation), so it is scored Warning rather than Critical, but it is a real
and silent way to lose a compliance-checklist item with no error path.
**Fix:** Do not accept a caller-supplied `source` on the public
create/upsert schema — strip it from `DdRequestItemUpsertSchema` and let only
server-generated code paths (instantiate, and — for RAID — the finding
conversion route) set it.

## Info

### IN-01: DD `dueDate` accepts any ≤10-char string, not a validated calendar date

**File:** `validators/dd.js:68` (`dueDate: z.string().trim().max(DUE_DATE_MAX).optional()`), `server.js:3117-3120` (`computeOverdue()`)
**Issue:** `dueDate` is bounded by length only, not format. `computeOverdue()`
guards with `DD_DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/`, which accepts
syntactically-shaped-but-invalid dates (e.g. `'2024-13-40'`) and silently
treats anything that doesn't match the regex as never-overdue. This never
crashes and has no security impact, but a malformed due date (typo'd via the
`<input type="date">` UI is unlikely, but the API accepts any string) will
silently and permanently suppress the overdue flag for that item with no
error surfaced anywhere.
**Fix:** Either validate the date format in the zod schema (`.regex()` /
`.refine()` with a real calendar check) or leave as-is if the risk is
accepted — recommend at minimum a schema-level format regex to match the
length bound already present.

### IN-02: `due-diligence.html` is absent from `transitions.js`'s `pageAccess` map

**File:** `public/js/transitions.js:141-166`
**Issue:** Every other deal-bound page added or touched in this phase
(`deal-wizard.html`) has an explicit `pageAccess` entry; `due-diligence.html`
has none, so the client-side page-access gate imposes no role restriction on
navigating to it (any role can load the page). This is very likely
intentional — DD area clearance is per-deal-member via `memberGrants`, not
role-based, so a `pmo`/`employee` deal member legitimately granted an area
should be able to reach the page — and the server-side `filterByAreaGrant()`
still governs what data actually renders. Flagging only because every other
new page in this phase got an explicit map entry and this one's absence
looks more like an oversight than a documented decision; a one-line comment
matching the `deal-wizard.html` entry's style would remove the ambiguity for
the next reader.
**Fix:** Either add an explicit (permissive) `pageAccess` entry with a
comment explaining the deliberate omission of a role restriction, or leave
as-is with a comment at the map's declaration site.

### IN-03: `respondentName`/`rater`/`respondentRole` on assessment completion are entirely caller-supplied, not session-derived

**File:** `server.js:2595-2597`
**Issue:** Pre-existing pattern (not introduced by this phase) but newly
load-bearing now that WIZ-01 attaches an `owner` obligation to a pending row:
`pending.respondentName = String(respondentName || '').slice(0, 120)` takes
the value directly from the request body, never from `req.portalUser`. Once
CR-01 is fixed (ownership enforced), consider also stamping
`respondentName`/`rater` from the session identity by default for the
`instanceId` completion path specifically, so the record of who actually
completed an assigned obligation cannot itself be spoofed by the legitimate
owner impersonating someone else on the same team.
**Fix:** Not required for this phase to ship, but worth tracking alongside
CR-01's fix since the same code path is involved.

---

_Reviewed: 2026-08-02T10:04:42Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
