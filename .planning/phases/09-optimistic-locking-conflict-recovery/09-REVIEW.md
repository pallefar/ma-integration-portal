---
phase: 09-optimistic-locking-conflict-recovery
reviewed: 2026-08-11T00:00:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - db/collections.js
  - db/store.js
  - public/css/style.css
  - public/due-diligence.html
  - public/execution.html
  - public/js/due-diligence.js
  - public/js/execution.js
  - public/js/org.js
  - public/js/transitions.js
  - public/org.html
  - scripts/soak.js
  - server.js
  - test/client-conflict-dialog.test.js
  - test/optimistic-locking-contract.test.js
  - test/optimistic-locking-cross-process.test.js
  - test/org-flight-risk-conversion.test.js
  - test/synergy-staleness.test.js
  - validators/dd.js
  - validators/org.js
  - validators/workstream.js
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
---

# Phase 09: Code Review Report

**Reviewed:** 2026-08-11
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

Phase 9 adds a well-reasoned two-layer optimistic-locking scheme (a fast route-level
precheck in `conflictIfStale()` plus a race-free per-row `WHERE`-clause check inside
`writeDb()`'s `.immediate` transaction) and a matching client-side conflict-recovery
dialog in `public/js/transitions.js`. The code is heavily commented, self-aware of its
own edge cases (lazy version adoption, stale-delete, 503-vs-409 separation, audit-trail
reconciliation in `scripts/soak.js`), and the route-level precheck layer correctly
threads DD's per-record area clearance through `conflictIfStale()`'s `clearanceFilter`
option.

However, the **second, actually-race-free layer never received the same clearance
treatment**: when the real cross-process race fires (the exact scenario Phase 8's
multi-process WAL model and this phase both exist to handle), `db/store.js`'s
`makeConflictError()` echoes the full, unfiltered current record into the 409 response,
and `server.js`'s central 409 middleware forwards it verbatim — with no area-clearance
check at all. For `ddFindings`/`ddRequestItems` (both in `VERSIONED_COLLECTIONS`, both
gated per-record by an 8-way area clearance grant), this is a real clean-room leak of
MNPI content under exactly the deployment/contention conditions this milestone was
built around. This is the phase's own named risk ("MNPI leak-safety of 409 bodies") and
it is not closed.

Two further, lower-severity UX defects were found in the client conflict-recovery
wiring: `public/js/execution.js`'s synergy write handlers and
`public/js/org.js`'s `convertFlightRisk()` fire a blocking `window.alert()` /
inline-error banner on every non-success response, including genuine 409 conflicts —
double-messaging the user on top of the shared conflict dialog, contradicting the
"[Rule 1]" no-double-message convention `org.js`'s own position-delete handler already
implements for the identical situation.

## Critical Issues

### CR-01: Cross-process version-conflict 409 leaks unfiltered DD record content across clearance areas

**File:** `db/store.js:433-471` (conflict throw), `server.js:7198-7218` (central 409 middleware)
**Issue:**

Two independent conflict layers exist for a versioned write:

1. **Route-level precheck**, `conflictIfStale()` (`server.js:433-453`). Callers for the
   two per-record-area-gated DD collections pass an explicit `clearanceFilter` (e.g.
   `server.js:5485-5487`, `5519-5521`, `5716-5718`, `5746-5748`, `5826-5828`) that
   nulls out `currentRecord` when the caller lacks `hasAreaGrant(deal, user,
   record.area)` for the record's *current* area. This layer only fires when the
   client supplied a `version` that already mismatches this handler's own fresh read.

2. **`WHERE`-clause layer**, inside `writeDb()`'s `.immediate` transaction
   (`db/store.js:433-471` for update, `494-519` for delete). This is the layer the
   code's own comments call "the actually race-free layer" — it fires whenever
   *another process* commits a conflicting write between this request's `readDb()`
   and this request's `writeDb()` call, which is precisely the multi-process WAL
   contention window Phase 8 introduced and this phase is documented as needing to
   close safely. On a mismatch it throws `makeConflictError({ ..., currentRecord:
   current, ... })` where `current = JSON.parse(row.data)` — the **full, untouched
   stored record**, with no clearance filtering of any kind.

   `server.js`'s central 409 middleware (`server.js:7211-7218`) catches this via
   `isConflictError(err)`/`err.conflictDetail` and responds with
   `conflictBody(detail)` directly — it has no knowledge of `accessPolicy`, the
   deal, the caller, or the record's area, so it cannot apply (and does not attempt
   to apply) any clearance filter.

Because `ddFindings` and `ddRequestItems` are both in `VERSIONED_COLLECTIONS`
(`db/collections.js:140-146`) and both use **per-record** area clearance (a deal
member can be granted `financial` but not `legal`, for example — see
`db/accessPolicy.js`'s `hasAreaGrant`), any real cross-process race that changes a
record's `area` (an explicitly supported "move an item between areas" operation, per
`server.js:5497-5498`/`5727`) — or any race that simply lands between another writer's
commit and this caller's own `writeDb()` — can result in the full `title`/`text`/
`notes`/`owner` content of an area the caller is **not cleared for** being echoed
straight back to them in the 409 response body. This is a genuine clean-room
segregation breach for MNPI-grade DD content, reachable via the exact multi-process
deployment shape (SQLite WAL, `replicas:1`+ shared host) this application is built to
run.

No route wraps its `writeDb()` call in a try/catch that re-applies the same
`clearanceFilter` before letting the conflict error reach the central middleware
(confirmed: no `try`/`catch` exists around any DD write route in `server.js`), and no
test exercises this path — `test/optimistic-locking-cross-process.test.js` only drives
`raidEntries` (not area-gated) through `db/store.js` directly, and
`test/optimistic-locking-contract.test.js`'s clearance test (`optimistic-locking-
contract (22, direct)`, line 975) calls `conflictIfStale()` directly, never the
`WHERE`-clause/central-middleware path.

**Fix:** Give `db/store.js`'s conflict throw (and/or the central 409 middleware) a way
to know which collections require per-record clearance filtering and who the caller
is, so the `WHERE`-clause layer's `currentRecord` gets the identical treatment the
precheck layer already gives it. The simplest shape that fits the existing
architecture: extend `runWithDb()`'s context (already available inside the transaction
via `requestDbStorage.getStore()`, see `scoped` at `db/store.js:325`) to carry an
optional `areaClearanceFilter(collectionKey, record)` hook set by `db/resolver.js` (or
by the route itself before calling `writeDb()`), and have `makeConflictError()`/the
throw sites at `db/store.js:456-462` and `506-513` run `current` through it before
attaching it to `conflictDetail`:

```js
// db/store.js, inside the versioned throw sites:
const current = JSON.parse(row.data);
const areaFilter = scoped && scoped.areaClearanceFilter;
const visibleRecord = areaFilter ? areaFilter(key, current) : current;
throw makeConflictError({
  conflictKind: 'version', collection: key, recordId: id,
  currentRecord: visibleRecord,
  currentVersion: current.version !== undefined ? current.version : null,
  changedBy: current.updatedBy || null, changedAt: current.updatedAt || null,
});
```

with `server.js`'s DD routes setting `req.dealContext`'s (or an equivalent
per-request) `areaClearanceFilter` the same way they already build the
`clearanceFilter` passed to `conflictIfStale()`, so both layers share one filtering
rule instead of only one of them enforcing it. At minimum, add a
`test/optimistic-locking-cross-process.test.js`-style real-multi-process test for
`ddFindings`/`ddRequestItems` that asserts the `WHERE`-clause conflict's
`currentRecord` is withheld for an uncleared caller, mirroring contract test (22) but
through the actual race path.

## Warnings

### WR-01: Synergy write handlers double-message the user on a 409 conflict

**File:** `public/js/execution.js:22-24` (`synAlertFailure`), and call sites at
`public/js/execution.js:428, 819, 861, 892, 923, 955, 991, 1031`
**Issue:** `synAlertFailure(res)` unconditionally shows a blocking `window.alert(...)`
whenever a synergy write's response is not `{success:true, ...}`. It does not exempt a
409 conflict body (`res.conflict === true`), so on every real version conflict for
`synergyInitiatives`/`customSynergyInitiatives` (stage change, confirm-current,
generate-phasing, header realized-input, per-month grid cell edits, rebaseline,
cost-entry add/delete) the user is shown **both** the shared conflict-recovery dialog
rendered by `public/js/transitions.js`'s fetch wrapper (`showConflictDialog()`) **and**
a native, blocking `window.alert()` with a generic/unrelated message — e.g.
`"That action could not be completed. Please try again."`, since the conflict body
carries no `error` field for `synAlertFailure` to surface.

This is the exact double-messaging failure mode `public/js/org.js` explicitly guards
against for its own position-delete flow — see the `[Rule 1]` comment at
`public/js/org.js:600-608`: *"a stale-delete 409 is already fully handled by the
shared conflict dialog ... this generic inline banner must not ALSO fire for that
case, or the user sees two contradictory messages for one refusal."* The synergy
write paths in `execution.js` never received the equivalent guard.

**Fix:** Exempt the conflict case in `synAlertFailure()` (and the two inline
`window.alert(res && res.error)` call sites at lines 861/892/923 that don't go through
it), mirroring `org.js`'s pattern:

```js
function synAlertFailure(res) {
  if (res && res.conflict === true) return; // handled by the shared conflict dialog
  window.alert((res && res.error) || 'That action could not be completed. Please try again.');
}
```

### WR-02: `convertFlightRisk()` double-messages the user on a 409 conflict

**File:** `public/js/org.js:947-979` (specifically `967-970`)
**Issue:** Same defect as WR-01, isolated to one function: `convertFlightRisk()`'s
error branch (`if (!result.ok) { showConvertError(...); return; }`) calls
`showConvertError()` unconditionally, without checking
`result.data && result.data.conflict === true`, unlike its sibling `deleteBtn` handler
in the same file (`public/js/org.js:600-608`) which explicitly implements this guard.
A stale-version conversion attempt therefore shows both the shared conflict dialog and
the inline `"Could not convert that flight-risk entry."` banner.

**Fix:**

```js
if (!result.ok) {
  if (!(result.data && result.data.conflict === true)) {
    showConvertError((result.data && result.data.error) || 'Could not convert that flight-risk entry.');
  }
  return;
}
```

## Info

### IN-01: `conflictIfStale()`'s `changedBy`/`changedAt` are never clearance-filtered (documented, but worth flagging)

**File:** `server.js:444-450`
**Issue:** `conflictIfStale()` applies `options.clearanceFilter` only to
`currentRecord`; `changedBy`/`changedAt` are always read from the unfiltered `record`
regardless of the caller's clearance for the record's area. Route comments (e.g.
`server.js:5508-5518`) document this as intentional — "the response still carries the
version and attribution ... but no field value from the item" — so an uncleared
caller learns that *someone* edited a record in an area they cannot see, and roughly
when, but not who or what. This is a deliberate, reasoned trade-off, not an oversight,
but it is metadata leakage across a clean-room boundary (a username, correlated with
timing, in an area the caller has no grant for) and is worth a second look given the
same threat model that motivates CR-01 above — confirm this is an accepted risk rather
than an unreviewed one.
**Fix:** No code change required if this is confirmed as an accepted trade-off;
otherwise thread `changedBy`/`changedAt` through the same `clearanceFilter` (returning
`null` for both when the filter denies) for consistency with `currentRecord`.

---

_Reviewed: 2026-08-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
