---
phase: 09-optimistic-locking-conflict-recovery
reviewed: 2026-10-10T00:00:00Z
depth: deep
rounds: 2
files_reviewed: 6
files_reviewed_list:
  - server.js
  - public/js/transitions.js
  - public/js/execution.js
  - public/js/org.js
  - public/js/due-diligence.js
  - public/css/style.css
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
  resolved: 6
round_1:
  reviewed: 2026-08-11T00:00:00Z
  depth: standard
  files_reviewed: 19
  findings: { critical: 1, warning: 2, info: 1, total: 4 }
  status: resolved
round_2:
  reviewed: 2026-10-10T00:00:00Z
  depth: deep
  diff_base: aa15538
  findings: { critical: 0, warning: 2, info: 4, total: 6 }
  status: resolved
  fixed_at: 2026-10-10
  fix_commits: { WR-03: 522eb1b, WR-04: 013b691, IN-02: a6ef9e7, IN-03: a5f6f4b, IN-04: c343aa8, IN-05: a2caf0c }
status: clean
---

## Round 1 — original execution (resolved)

_Original frontmatter: reviewed 2026-08-11, depth standard, 19 files, findings critical 1 / warning 2 / info 1 / total 4, status resolved. Body preserved verbatim below._

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

---

## Resolution (2026-08-11, orchestrator — Fable-verified then fixed)

- **CR-01: FIXED** (`fb20b2b`). Verified real before fixing (route precheck filters, storage throw did not).
  Fix shape = the review's own suggestion: `conflictIfStale()` arms `areaClearanceFilter` on the request's
  db context (before its early returns, so it covers no-client-version requests), and `db/store.js`'s two
  'version' throw sites route the echoed record through `conflictVisibleRecord()`. Fail-closed backstop:
  new `CLEARANCE_SCOPED_COLLECTIONS` (`ddFindings`, `ddRequestItems`) in db/collections.js — when no filter
  is armed, `currentRecord` is withheld entirely. Version + attribution stay disclosed (T-09-17).
  Proof: 4 new contract tests "CR-01 (a–d)" — fail-closed backstop, raid regression (full echo kept),
  arming side-effect, and armed-filter parity through a real WHERE-layer conflict.
- **WR-01: FIXED** (`0acb509`). `synAlertFailure()` and the three inline `window.alert(res && res.error)`
  sites now exempt `conflict === true` bodies, mirroring org.js's [Rule 1] guard.
- **WR-02: FIXED** (`0acb509`). `convertFlightRisk()` error branch got the same guard as its sibling
  position-delete handler.
- **IN-01: ACCEPTED RISK.** `changedBy`/`changedAt` attribution across a clearance boundary is the
  documented, deliberate T-09-17 trade-off (route comments + UI-SPEC attribution rule). Flagged for
  `/gsd-secure-phase 9` to confirm at the security gate.

Suite after fixes: 779/779.

---

## Round 2 — gap closure 09-08..09-16

**Reviewed:** 2026-10-10
**Depth:** deep (cross-file: server.js ⇄ db/store.js ⇄ validators/ ⇄ transitions.js ⇄ execution.js/org.js/due-diligence.js)
**Range:** `aa15538..HEAD` — `server.js`, `public/js/transitions.js`, `public/js/execution.js`, `public/js/org.js`, `public/js/due-diligence.js`, `public/css/style.css` (tests/UAT harness read only as evidence)
**Status:** resolved — 0 critical / 2 warning / 4 info found; all 6 fixed (see "Round 2 resolution" below)

### Summary

The gap closure delivers what GD-1..GD-14 promised and the security envelope holds. Verified by reading the code, not the summaries:

- **`versionRequired` rule cannot be bypassed by type confusion.** `parseExpectedVersion()` (`server.js:412-421`) bounds-checks only the query channel; the body channel passes `req.body.version` through untyped. That is safe because the comparison at `server.js:498` is strict `===` against an integer: `"0"`, `null`, `[]`, `{}`, `true`, `-1`, `1e300` and a `?expectedVersion=0&expectedVersion=1` array all fail to match and fall to the 409, never to a pass; `__proto__`/duplicate-key JSON tricks yield `undefined` and hit the 400. Routes that do carry a zod schema (`validators/*.js` `version: z.number().int().nonnegative().optional()`) refuse non-integers with a validation 400 even earlier. No method-override middleware exists; `express.urlencoded` bodies yield strings, which strict-compare as mismatches. A create (`record` falsy) is never refused, per D-06.
- **CR-01 ordering survives the new 400 branch.** `conflictIfStale()` arms `areaClearanceFilter` on the db context at `server.js:477-484` before `parseExpectedVersion()` and before every return; both 400 bodies are fixed two-key / one-key literals that echo nothing. The DD routes (`server.js:5563`, `5793`, and the DELETE siblings) run `ddAreaRefused()` **before** `conflictIfStale()`, so an uncleared caller is refused before the 400 could confirm existence — FA-G3/T-09-38 is narrower than its own wording (it only applies to the task/RAID lanes, which have no clearance gate at all).
- **`req.isDemo === true` is the right fail-closed predicate.** Set only by `db/resolver.js:137` (`resolved.kind === 'demo'`); a request that never passes the resolver has `undefined` and is strict.
- **No new XSS sink.** Every dialog string lands via `textContent`/`createTextNode` (`transitions.js:273-299, 633, 654-655, 672, 702, 741, 751, 759-764, 800`); `session.message` is `String()`-coerced at `:993`; `conflictServerReason()` caps at 200 chars at `:459-463`; `CONFLICT_FIELD_LABELS` uses `hasOwnProperty` at `:380`; `JSON.stringify` for object values at `:296`. `innerHTML` does not appear in the wrapper region.
- **Held-promise state machine:** `settleConflictSession()` is settle-once (`:230-231`), removes overlay + keydown listener only for the shown session (`:233-239`), and queue overflow resolves with the raw 409 (`:869`). The suspected 401-retry deadlock does not exist: `maybePromptForToken()` retries via `origFetch` (`:59`), not via `attemptFetch`, so no second held session can be opened from inside a session. A render throw inside `activateConflictSession()` settles with the original response (`:838-844`), so no session can hang on a rendering failure. `?v=` stamp is uniform (`1791625638` on all 18 pages) and `transitions.js` loads before each page script.

What remains is two robustness warnings in the state machine's interaction with pages, and four informational items.

### Warnings

#### WR-03: Discard / Cancel / Escape / overlay-click while a reapply is on the wire settles the page with the 409 and triggers a re-read that can land BEFORE the irrevocable reapply commits — page state diverges from server state

**status: fixed** (`522eb1b`) — every exit locked while any request of the session is in flight; UI-SPEC amendment A9.

**File:** `public/js/transitions.js:490-496` (`rerender` drops the late result), `:779` (Discard enabled during reapply), `:682` (Cancel enabled during "Delete anyway"), `:826-832` (`exitLocked` only for `confirmState`), `:495-498`; consumers `public/js/execution.js:34-40` (`reloadAfterConflict` → `load()`), `public/js/due-diligence.js:112-117` (`.then(refresh)`), `public/js/org.js:625-630`, `:997-1003`.

**Scenario (verified by tracing, not executed):**
1. User clicks "Apply my changes anyway" → `runConflictReapply()` sets `session.inFlight = true` and sends the POST with the fresh version.
2. Before the response arrives, user presses Escape (or clicks Discard / the overlay). `onKeydown` at `:827-829` checks only `exitLocked()`, which is `session.confirmState && session.inFlight` — false for an edit or stale-delete session — so `settleConflictSession(session, session.originalRes)` runs and resolves the page's promise with the **original 409**.
3. The page's handler sees `conflict === true` and calls `reloadAfterConflict()` / `refresh()` immediately → a GET that can be answered before the reapply's `.immediate` transaction commits (same server, two in-flight requests).
4. The reapply then lands and commits "mine". `rerender()` at `:491` sees `session.settled` and drops it. The page is now showing "theirs" (the state it just re-read) while the server holds "mine" — the exact "silent divergence" class R7 F-1/F-2 were about, now reachable by a user who changes their mind one keypress too late. Next edit in that tab sends the stale version again and false-conflicts (the R7 F-2 symptom).

The code's own rationale for the confirm-state lock at `:547-550` ("the request is irrevocable, and the page must learn how it ended") applies identically to the reapply path but is not applied there. Before 09-11 this was harmless because the caller's promise had already settled with the 409 at dialog-open time; the held-promise design makes the exit *meaningful*, which makes a mid-flight exit a correctness hazard. 09-UI-SPEC E2-loading ("Discard stays enabled") predates the held-promise decision and should be amended, not honoured over correctness.

**Fix:** Lock every exit while any request of the session is in flight, and when the user does exit after a reapply, settle with the reapply's outcome rather than the stale 409:

```js
// transitions.js — activateConflictSession
const exitLocked = () => session.inFlight;            // any variant, any in-flight request
// renderConflictSession — edit + stale-delete variants
discardBtn.disabled = !!session.inFlight; cancelBtn.disabled = !!session.inFlight;
// runConflictReapply — disable the exit button alongside the action button
// and re-enable both in rerender()
```
If E2-loading's "Discard stays enabled" must be kept, the minimum safe alternative is: on an exit while `inFlight`, defer the settle until the in-flight promise resolves and settle with *that* response (2xx → page applies "mine"; 409/4xx → original 409). Add a wrapper test: Apply, then Escape before the mocked reapply resolves, then resolve it 200 → the held promise must resolve with the 200.

#### WR-04 (SUSPECTED reachability): the precheck layer and the WHERE layer disagree on a non-numeric stored `version`, producing a permanently un-reapplyable record

**status: fixed** (`013b691`) — one shared `comparableVersion()` rule across precheck, WHERE layer (SQL mirror), conflict bodies and `maVersionOf`.

**File:** `server.js:497` (precheck: non-number stored version → 0), `db/store.js:421` + `:388` (WHERE layer: non-number prior version → `expectedVersion = null` → `IS NULL OR = NULL` never matches a non-null string), `db/store.js:475` (echoes the raw stored value as `currentVersion`), `public/js/transitions.js:443-445` (reapply sends that raw value back as `version`), `validators/*.js` (`z.number().int()` rejects it → 400), `public/js/transitions.js:15-18` (`maVersionOf` maps it to 0).

**Scenario:** a deal-DB row whose root `version` is a non-integer (e.g. `"v2"`, `1.5`, `true`). Client sends `version: 0` (`maVersionOf` → 0). Precheck: `currentVersion` = 0 → passes. Store: `priorObj.version` not a number → `expectedVersion = null` → the `UPDATE ... WHERE (json_extract IS NULL OR json_extract = NULL)` updates 0 rows → conflict thrown with `currentVersion: "v2"`. Dialog opens; "Apply my changes anyway" → `withFreshVersion()` writes `version: "v2"` → zod 400 → banner "That didn't go through — Invalid input…" — every time. The record cannot be edited or deleted from the UI again. Every validated route today writes integer versions, so this needs a malformed row (an import/wizard path or a hand-edited DB) — hence SUSPECTED, but the two-layer disagreement itself is verified in code, and the WHERE layer's `= NULL` arm is a silent no-match rather than an explicit rule.

**Fix:** make the layers agree on one coercion, in `db/store.js`:
```js
// db/store.js:421 and :518 — same rule as conflictIfStale(): anything that is not a
// non-negative integer is version 0 for comparison purposes
const pv = priorObj && priorObj.version;
const expectedVersion = (Number.isInteger(pv) && pv >= 0) ? pv : null;
// and in the WHERE clause treat a non-integer stored value as NULL:
//   (json_extract(data,'$.version') IS NULL OR typeof(json_extract(data,'$.version')) != 'integer' OR json_extract(data,'$.version') = ?)
```
and in the two throw sites coerce `currentVersion` the same way (`Number.isInteger(current.version) ? current.version : 0`) so the client's reapply can never carry a value zod will refuse. Add one store-level test with a seeded `version: "v2"` row.

### Info

#### IN-02: Page re-read after a settled conflict can run underneath the NEXT queued dialog — comments overstate the guarantee

**status: fixed** (`a6ef9e7`) — comment correction (the review's first option); no behaviour change, rationale below.

**File:** `public/js/transitions.js:241-244` (`resolve` then `openNextQueuedConflict()` synchronously), `public/js/execution.js:95-96` ("can never re-render underneath an open dialog"), `public/js/due-diligence.js:33-36` ("refresh() runs only after the dialog has closed, never underneath it").
**Issue:** `settleConflictSession()` resolves the held promise and then synchronously activates the next queued session, so the page's `.then` (a microtask) runs after the next overlay is already in the DOM. The queued session holds its own `init.body` and 409 body, so the dialog content is unaffected and the DOM under the overlay simply re-renders — harmless today, but the comments in the two page files claim a property the wrapper does not provide. Reachable only when ≥2 conflicts are pending (keyboard focus is not trapped by the overlay, so Tab+Enter on a control behind it can queue a second write).
**Fix:** Either soften the two comments to "runs only after ITS OWN dialog has closed", or in `settleConflictSession()` defer `openNextQueuedConflict()` with `Promise.resolve().then(...)` so the settling page's handler runs first.

#### IN-03: `withFreshVersion()` rewrites only the URL when `?expectedVersion=` is present, but the server prefers a body `version` — latent infinite "the record changed again" loop for any future route carrying both

**status: fixed** (`a5f6f4b`) — both remedies: client rewrites both channels; server refuses disagreeing channels with a fixed 400.

**File:** `public/js/transitions.js:429-451` (comment: "never rewrites both — a query-parameter route's body (if any) is left byte-identical"), `server.js:413-416` (`parseExpectedVersion` reads `req.body.version` FIRST).
**Issue:** No current call site sends both channels, so this is latent. But the comment documents a contract the server does not share: a POST with `?expectedVersion=` and a JSON body containing a stale `version` would reapply with the stale body value every time. Also note the current rule means a DELETE issued with a JSON body (allowed by `express.json`) can carry a body `version` that silently overrides the query.
**Fix:** rewrite both when both exist (`if (parsed && 'version' in parsed) parsed.version = freshVersion`), or make `parseExpectedVersion()` refuse a request that supplies both channels with differing values (400).

#### IN-04: `window.maConfirmDelete()` resolves `null` ("cancelled") without feedback when a dialog is already active

**status: fixed** (`c343aa8`) — focus trap (focus to the safe action on open, Tab wraps, return focus on close); UI-SPEC amendment A10.

**File:** `public/js/transitions.js:983`, consumers `public/js/execution.js:258, 1051, 1094, 1188`, `public/js/org.js:600`.
**Issue:** The pages treat `null` as a user cancel and show nothing. The overlay blocks pointer events, but it does not trap keyboard focus (`aria-modal` alone does not), so Tab + Enter on a delete button behind an open dialog produces a silent no-op. Low impact; worth a focus trap or a one-line banner.
**Fix:** In `activateConflictSession()`, move focus into the modal and keep it there (`modal.tabIndex = -1; modal.focus();` plus a `keydown` Tab guard), or make the refused path visible (reuse the give-up toast with a "Close the open dialog first" message).

#### IN-05: A 503 give-up during a reapply double-messages (toast + dialog banner)

**status: fixed** (`a2caf0c`) — no toast for a dialog reapply; banner reason "the server is busy"; UI-SPEC amendment A11.

**File:** `public/js/transitions.js:929` (`showBusyGiveUpToast()` on retry exhaustion, including with `CONFLICT_REAPPLY_CONTEXT`), `:519-521` (`res.status >= 500` → "the server reported an error").
**Issue:** When a reapply's 503 retries are exhausted the user sees the red "Server is busy — your change was not saved" toast AND the dialog banner "That didn't go through — the server reported an error". Both are true; the toast's "try again" and the banner's "try again" point at different controls. Minor Phase-8/Phase-9 interaction seam.
**Fix:** In `attemptFetch()`, skip `showBusyGiveUpToast()` when `ctx` is a reapply/confirm context and instead map the 503 in `runConflictReapply()`/`runConfirmDelete()` to a dedicated reason (`'the server is busy'`).

---

_Reviewed: 2026-10-10_
_Reviewer: Claude (gsd-code-reviewer, Fable 5.1)_
_Depth: deep_

---

## Round 2 resolution (2026-10-10, gsd-code-fixer — all 6 fixed, one atomic commit each)

- **WR-03: FIXED** (`522eb1b`). `exitLocked()` is now `session.inFlight` for every variant; `runConflictReapply()` disables the session's exit button (Discard / Cancel) alongside the action button, and both click handlers ignore clicks while in flight. A failed reapply re-renders with every control enabled again; a 2xx settles with that response, so the page always learns the reapply's real outcome. Chose the review's primary fix over the "defer the settle" alternative: it keeps one rule (A8's confirm-state lock, generalised) and needs no deferred-settle state. The signed E2/E3-loading rows ("the other action stays enabled" / "Cancel stays enabled") are superseded by **UI-SPEC amendment A9** (no literal change). Proof: `WR03a` (Apply → Escape + overlay + Discard while the mocked reapply is pending → nothing settles, nothing sent; resolving it 200 resolves the held promise with the 200), `WR03b` (failure re-enables), `WR03c` (Delete anyway). No Playwright change needed — the node:vm harness drives the exact state machine and no existing scenario depended on the old behaviour.
- **WR-04: FIXED** (`013b691`). New `comparableVersion()` in `db/collections.js` (non-negative safe integer, else 0) is the single rule used by `conflictIfStale()`'s precheck, `db/store.js`'s expected version and both conflict throw sites' `currentVersion`, and the client's `maVersionOf()`. The WHERE clause mirrors it in SQL (`json_type = 'integer'` + range, else 0 — `json_type` because the value extractor maps JSON `true` to 1); the D-09 missing/null lazy-adoption arm is unchanged. Proof: contract tests `WR-04 (a)` (rule table), `(b)` (rows seeded with `"v2"`, `1.5`, `true`, `-1` are editable again and re-stamp to 1), `(c)` (a WHERE-layer conflict against a malformed stored version reports `currentVersion: 0` and a reapply carrying 0 succeeds).
- **IN-02: FIXED as a documented comment correction** (`a6ef9e7`). Chose the review's first option. Deferring `openNextQueuedConflict()` by one microtask would not deliver the stronger guarantee either — the page's handler chain is several hops long (`res.json()`, then an async GET) — and the underlying behaviour is harmless (a queued session renders only from its own request and 409 bodies). `execution.js`, `due-diligence.js` and `settleConflictSession()` now state the true contract: "after ITS OWN dialog closed". Comment-only, so no test.
- **IN-03: FIXED** (`a5f6f4b`). Both remedies: `withFreshVersion()` rewrites the body `version` too when a query-channel request's JSON body carries one; `parseExpectedVersion()` flags disagreeing channels (`mismatch: true`) and `conflictIfStale()` answers a fixed one-key 400 instead of letting the body silently win (closes the DELETE-with-JSON-body override). Agreeing channels are accepted. Proof: client `IN03`, server `IN-03 (a)/(b)`.
- **IN-04: FIXED** (`c343aa8`). Focus trap rather than a toast: on open focus moves to the first enabled action (always the safe one); Tab / Shift+Tab wrap inside the enabled actions and focus found anywhere else is pulled back in; the modal (`tabIndex = -1`) holds focus while every action is disabled mid-flight; focus returns to the opener on close. This makes the silent `maConfirmDelete` → `null` refusal unreachable by keyboard (the overlay already blocked the pointer). **UI-SPEC amendment A10.** Proof: `IN04a-c`.
- **IN-05: FIXED** (`a2caf0c`). `attemptFetch()` skips the give-up toast for a dialog reapply (`ctx.reapply` without `confirmSession`); `runConflictReapply()` maps a final 503 to the new reason "the server is busy" (other 5xx unchanged). The in-app confirm's first DELETE keeps the toast because its dialog closes on a 503. **UI-SPEC amendment A11** records the new literal. Proof: `IN05a` (banner text, zero toasts, promise still held) and `IN05b` (ordinary write still toasts — Phase 8 D-08 unchanged).

Cache-bust: `transitions.js` `?v=` bumped to `1791628622` on all 18 pages; `execution.js` and `due-diligence.js` bumped on their pages (`org.js` untouched). Suite: 861 → **875/875** (`node --test`), green at every commit.
