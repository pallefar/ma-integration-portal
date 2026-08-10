---
phase: 05-synergy-value-capture
reviewed: 2026-08-06T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - server.js
  - validators/workstream.js
  - validators/settings.js
  - public/js/execution.js
  - public/js/deal-home.js
  - public/execution.html
  - scripts/migrate-synergy-stages.js
  - scripts/seed-synergy-demo.js
  - test/synergy-phasing.test.js
  - test/synergy-stage.test.js
  - test/synergy-cost.test.js
  - test/synergy-tasks.test.js
  - test/synergy-staleness.test.js
findings:
  critical: 3
  warning: 5
  info: 0
  total: 8
status: fixed
fixed_at: 2026-08-06T00:00:00Z
fix_report: 05-REVIEW-FIX.md
---

# Phase 5: Synergy Value Capture — Code Review Report

**Reviewed:** 2026-08-06
**Depth:** standard
**Files Reviewed:** 13
**Status:** fixed — all 8 findings (3 Critical + 5 Warning) fixed, see [05-REVIEW-FIX.md](05-REVIEW-FIX.md)

## Summary

The phase's authorization posture at the outer gate is genuinely solid — every new synergy write route falls through to `DEFAULT_WRITE_ROLES` (admin/hrbp/pmo) with `employee` correctly excluded, `POST /api/synergies/:id/rebaseline` correctly narrows further to admin+hrbp via `isAdminOrIlRequest()` running *before* the 404 lookup (no existence oracle, verified against the test suite's two-identity 200/403 proof), and the forward-booking guard on realized value is enforced through the dedicated per-month route with `monthHasArrived()`, closing the base-upsert bypass path once phasing rows exist. XSS discipline in `execution.js` is careful — every dynamic value that could carry attacker-influenced text goes through `esc()`.

That said, three real BLOCKER-class problems remain, all reachable through completely normal application use (not requiring database tampering):

1. **A missing upper bound on a per-deal setting lets any pmo/hrbp/admin caller crash the single-threaded Node process for every deal on the host** by requesting an absurdly large synergy phasing horizon.
2. **The stage-gate ordinal comparison silently degrades to "just supply a reason" when `item.stage` isn't one of the four recognized values** — completely bypassing the owner/phased-target/realized-value hard gates D-08 is supposed to enforce. This is reachable today because the phase's own new migration script does not cover every storage lane a synergy row can live in.
3. **Regenerating phasing rows on an already-`captured` initiative silently zeroes its realized value with no gate re-check**, leaving the stage badge and the steering-committee rollup disagreeing about whether the initiative's captured-value claim is still true.

Five further WARNING-level issues (a comment/implementation mismatch on the re-baseline authz helper, a numeric-overflow data-corruption path, an unbounded staleness-suppression knob, a migration-coverage gap, and a dead client control) round out the report below.

## Critical Issues

### CR-01: Unbounded `synergyHorizonYears` setting allows any pmo/hrbp/admin caller to crash the shared Node process

**File:** `validators/settings.js:97-98`
**Also:** `server.js:3092-3124` (`generatePhasingRows`), `server.js:3129-3132` (`synergyHorizonYears`)
**Issue:**
`SettingsUpdateSchema.synergyHorizonYears` is `z.union([z.number(), z.string().max(10)]).optional()` — there is no `.max()`/`.int()` bound on the numeric branch. `POST /api/settings` copies this value straight through (`target[key] = req.body[key]`, `server.js:1417`) with no further sanitization, and `roleAllowedForWrite()` has no explicit `/api/settings` entry, so it falls through to `DEFAULT_WRITE_ROLES = ['admin', 'hrbp', 'pmo']` — a workstream-lead `pmo` account, the lowest-trust role with any write access at all, can set it.

`synergyHorizonYears(db)` (`server.js:3129-3132`) accepts any positive finite number with no ceiling, and `generatePhasingRows()` (`server.js:3098-3124`) allocates `Math.max(0, horizonYears | 0) * 12` array rows in a synchronous loop. A caller who does:
```
POST /api/settings { "synergyHorizonYears": 100000000 }
POST /api/synergies/:id/generate-phasing { "runRateM": 1, "startMonth": "2026-01", "curveShape": "linear" }
```
causes the server to synchronously build and JSON-stringify a ~1.2 billion-element array on the request thread. Per this codebase's own documented architecture ("Threading: Single-threaded Node.js event loop"), this hangs/OOM-crashes the *entire* process — every other deal on the shared host goes down with it, not just the caller's own deal. This is exactly the kind of foundation-integrity gap the project's security posture is supposed to prevent (CLAUDE.md: "the data layer must be concurrency-safe from day one" — a single caller taking down every concurrent deal on a shared host is the opposite of that goal).

**Fix:**
```js
// validators/settings.js
synergyHorizonYears: z.union([
  z.number().min(1).max(15),
  z.string().max(10),
]).optional(),
```
and defensively cap the reader too, since the schema alone can't stop a value already stored before this fix ships:
```js
// server.js
function synergyHorizonYears(db) {
  const configured = db.settings && db.settings.synergyHorizonYears;
  const n = typeof configured === 'number' && isFinite(configured) ? configured : 3;
  return Math.min(Math.max(n, 1), 15);
}
```

---

### CR-02: Stage-gate ordinal comparison silently bypasses every D-08 gate when `item.stage` is unrecognized

**File:** `server.js:3617-3655` (`app.post('/api/synergies/:id/stage', ...)`), specifically lines 3626-3637
**Issue:**
```js
const currentOrdinal = STAGE_ORDER[item.stage];   // undefined if item.stage isn't one of the 4 values
const targetOrdinal = STAGE_ORDER[targetStage];    // always valid — schema-enforced

if (targetOrdinal === currentOrdinal) { ... }       // number === undefined -> false
if (targetOrdinal > currentOrdinal) {               // number > undefined -> ALWAYS false (NaN comparison)
  const failure = stageGateFailure(item, targetStage);
  ...
} else {
  // falls in here even for a FORWARD move, if currentOrdinal is undefined
  if (!reason) return res.status(400)...;
  pushBaseline(item, req, reason);
  item.stage = targetStage;   // <-- no gate check ran at all
}
```
`targetOrdinal > currentOrdinal` is `false` whenever `currentOrdinal` is `undefined` (any comparison against `NaN`/`undefined` is `false` in JS), so the handler falls into the "backward move" `else` branch — which requires nothing but a non-empty `reason` string, and runs **`stageGateFailure()` not at all**. Any admin/hrbp/pmo caller can move an initiative straight to `captured` (or `committed`) with `{ targetStage: 'captured', reason: 'x' }`, completely bypassing the owner-required, phased-target-required, and realized-value-in-an-arrived-month gates.

This is reachable through ordinary use today, not just theoretical DB tampering: `scripts/migrate-synergy-stages.js` (this phase's own migration) migrates only the `synergyInitiatives` table (see CR-03/finding WR-04 below) — any row still sitting in the `customSynergyInitiatives` lane (used whenever a deal's `settings.demoMode === false`, `server.js:3054-3059`) that predates this phase keeps its retired `status` field and never gets a `stage` value at all, so `STAGE_ORDER[item.stage]` is `undefined` for it and this bug fires on the very first stage-change request against it.

**Fix:** Treat an unrecognized/absent current stage as an error, not as "assume backward":
```js
const currentOrdinal = STAGE_ORDER[item.stage];
if (currentOrdinal === undefined) {
  return res.status(500).json({ error: 'This initiative carries an unrecognized stage value and cannot be advanced until migrated.' });
}
```
placed before the `targetOrdinal === currentOrdinal` check. Also close the migration-coverage gap (see WR-04) so this state cannot occur in practice.

---

### CR-03: Regenerating phasing on a `captured` initiative silently invalidates the captured-stage invariant with no gate re-check

**File:** `server.js:3534-3563` (`app.post('/api/synergies/:id/generate-phasing', ...)`)
**Issue:**
`generate-phasing` unconditionally does `item.phasing = generatePhasingRows(...)` (line 3544), which produces every row with `realizedM: 0` (line 3120). Nothing in this handler reads or re-validates `item.stage`. An initiative that legitimately reached `captured` (via the dedicated `/stage` route, which *did* enforce "realized value recorded in at least one arrived month") can have its phasing rows regenerated at any later point — the client's `window.confirm()` (execution.js line ~790) is the *only* guard, and it is purely cosmetic; nothing stops a direct `fetch()`/API client from skipping it. After regeneration:
- `synergyRollupFields(item)` (line 3557) recomputes `targetM`/`realizedM` from the fresh all-zero rows, so `realizedM` drops to 0.
- `item.stage` is left as `'captured'`.
- `GET /api/synergies/rollup`'s `grossRealizedM` (fed into the steering-committee-facing rollup tiles, `execution.js` `renderSynRollup()`) silently drops for this initiative, while the stage pill continues to display "Captured".

This is a domain-invariant violation reachable through the feature's own primary, documented workflow ("re-running the ramp after manual edits is a deliberate, client-confirmed destructive action" — the plan's own comment at `server.js:3532-3533` — but the destructiveness is only acknowledged for the phasing rows, not for the stage claim that depends on them).

**Fix:** After regenerating, re-run the same gate the stage route uses and downgrade (with a recorded baseline reason) rather than leaving a stale claim:
```js
item.phasing = generatePhasingRows(...);
...
const rollup = synergyRollupFields(item);
item.targetM = rollup.targetM;
item.realizedM = rollup.realizedM;
if (STAGE_ORDER[item.stage] >= STAGE_ORDER.captured && stageGateFailure(item, item.stage)) {
  pushBaseline(item, req, 'Automatic demotion: phasing regenerated, captured evidence no longer present.');
  item.stage = 'committed';
}
```

## Warnings

### WR-01: `isAdminOrIlRequest()`'s own comment claims it excludes the X-Admin-Token break-glass identity — it does not

**File:** `server.js:479-490` (definition), `server.js:3665-3668` (call site)
**Issue:** The comment above `isAdminOrIlRequest()` states: *"Deliberately does NOT honour the X-Admin-Token break-glass path isAdminRequest() accepts: D-15's rule is about an ATTRIBUTED human role, and an unattributed token would defeat the governance meaning of the baseline record."* But the implementation is:
```js
function isAdminOrIlRequest(req) {
  return !!(req.portalUser && ['admin', 'hrbp'].includes(req.portalUser.role));
}
```
It only inspects `req.portalUser.role`. The consolidated `/api` gate (`server.js:396-402`) sets `req.portalUser = { username: 'admin-token', role: 'admin', sessionId: null, dealId: null }` for a valid `X-Admin-Token` header — so `req.portalUser.role === 'admin'` is true for the break-glass path too, and `isAdminOrIlRequest()` returns `true` for it. The stated exclusion is not implemented; the re-baseline route *is* reachable via the bearer token, contrary to the code's own documented intent. (Impact is partially mitigated because the token identity is still attributed as `'admin-token'` in the resulting baseline entry, but the comment's claim is simply false, and nothing in the test suite exercises this path to catch the drift.)
**Fix:** Either update the comment to reflect actual (and arguably acceptable) behavior, or actually implement the exclusion:
```js
function isAdminOrIlRequest(req) {
  return !!(req.portalUser && req.portalUser.sessionId !== null && ['admin', 'hrbp'].includes(req.portalUser.role));
}
```

### WR-02: `roundSynergyMoney()` silently corrupts stored data to `null` on numeric overflow

**File:** `server.js:3087-3090`
**Issue:**
```js
function roundSynergyMoney(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : Math.max(0, Math.round(n * 10) / 10);
}
```
`SynMoneyUnion` (`validators/workstream.js:138`) accepts a string up to 20 characters, e.g. `"1e400"`. `parseFloat('1e400')` is `Infinity`; `Math.round(Infinity * 10) / 10` is `Infinity`; `Math.max(0, Infinity)` is `Infinity`. This value is used verbatim for `runRateM`, `targetM`, `realizedM`, `costPlannedM`, and cost-entry `amountM` across every route that calls `roundSynergyMoney()` (`POST /api/synergies`, `.../cost-entries`, `.../generate-phasing`, `.../phasing/:month`). `Infinity` serializes through `JSON.stringify()` as `null` (a native JS/JSON quirk), so the persisted row silently gets `"amountM": null` — and on the client, `esc(null)` renders as an empty string (`execution.js`'s `esc()`), producing a cost-entry row with a blank amount and no error surfaced anywhere. This is reachable by any admin/hrbp/pmo caller and corrupts the deal's own recorded figures without any 400/warning.
**Fix:** Reject non-finite results rather than silently passing `Infinity` through:
```js
function roundSynergyMoney(v) {
  const n = parseFloat(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 10) / 10);
}
```

### WR-03: `synergyStaleDays` has no upper bound — an admin/hrbp/pmo caller can permanently suppress the staleness governance signal

**File:** `validators/settings.js:97` (schema), `server.js:3238-3241` (`synergyStaleDays`)
**Issue:** `synergyStaleDays(db)` guards only against non-positive/non-numeric/non-finite values (explicitly, per its own comment, to stop "a hostile value suppress[ing] the signal by making every item permanently fresh" — but that comment only reasons about the near-zero direction). There is no upper bound: `synergyStaleDays: 999999999` is accepted by the schema and honored verbatim by the reader, which has the *identical* effect the code's own comment warns against — every initiative reads as fresh forever, hiding unconfirmed/aging synergy figures from the deal-home nudge and the rollup's unconfirmed-split sentence.
**Fix:** Cap both ends:
```js
function synergyStaleDays(db) {
  const configured = db.settings && db.settings.synergyStaleDays;
  const n = typeof configured === 'number' && isFinite(configured) && configured > 0 ? configured : 30;
  return Math.min(n, 365);
}
```

### WR-04: `scripts/migrate-synergy-stages.js` does not migrate the `customSynergyInitiatives` lane

**File:** `scripts/migrate-synergy-stages.js:76-158`
**Issue:** The migration's SQL is hard-scoped to `SELECT id, data FROM synergyInitiatives` / `UPDATE synergyInitiatives ...` (lines 84-102). `db/collections.js` declares both `synergyInitiatives` and `customSynergyInitiatives` as independent `ARRAY_COLLECTIONS`, and `server.js`'s `synergyLane(db)` (line 3054-3059) reads/writes `customSynergyInitiatives` whenever `db.settings.demoMode === false` for that database. A pre-Phase-5 record living in that lane (the legacy "custom M&A intake" mode) is never touched by this migration — it keeps its retired `status` field, never gets a `stage`, and feeds directly into CR-02's gate-bypass bug on its very first stage-change request. The script is also not wired into server startup or any deploy step (verified: no reference to it anywhere in `server.js` or `package.json`), so an operator upgrading an existing installation past this phase has no automatic prompt to run it at all.
**Fix:** Either migrate both lanes in the same script, or make the gap explicit and fail loudly instead of silently:
```js
for (const table of ['synergyInitiatives', 'customSynergyInitiatives']) {
  const rows = conn.prepare(`SELECT id, data FROM ${table}`).all();
  ...
}
```
and consider calling `migrateSynergyStages()` as an idempotent startup check (or emitting a startup warning when un-migrated rows are detected) rather than relying on a manual one-off invocation.

### WR-05: The header-level "Realized $M" input is always rendered and editable even after phasing rows exist, and always fails when used

**File:** `public/js/execution.js:713`
**Issue:**
```js
+ '<span><span data-i18n="syn.realized_lbl">Realized $M</span>: <input type="number" class="syn-realized-input" min="0" step="0.1" value="' + (s.realizedM || 0) + '"></span>'
```
This header-level input is rendered unconditionally for every initiative card, regardless of `s.phasing.length`. Its change handler (`execution.js:813-829`) POSTs to the base `/api/synergies` upsert with `{ id, realizedM }`. Once an initiative has phasing rows, the server unconditionally refuses this write with 400 (`server.js:3385-3387`, "This initiative is phased — edit targetM/realizedM per month on the phasing grid, not on the initiative directly."), and the client surfaces `window.alert(res.error)` (line 826). Every phased initiative therefore ships a control that is guaranteed to error on use, sitting directly next to the correct read-only rollup figure (`.syn-realized`, line 726) that already shows the same number. This is confusing UX debt introduced by this phase, not a pre-existing issue (the phasing feature itself is new).
**Fix:** Gate the header input's presence/editability on `!(Array.isArray(s.phasing) && s.phasing.length > 0)`, matching the server-side D-04 rule exactly, so a phased card shows the figure read-only instead of an always-failing input.

---

_Reviewed: 2026-08-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
