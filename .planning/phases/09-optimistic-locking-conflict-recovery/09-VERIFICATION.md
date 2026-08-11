---
phase: 09-optimistic-locking-conflict-recovery
verified: 2026-08-11T12:00:00Z
status: human_needed
score: 9/9 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Two-browser-tab conflict walk on execution.html's integration-task and synergy-initiative edit surfaces (edit the same task/initiative in two tabs, confirm the dialog on the second save; edit two DIFFERENT records and confirm no dialog)."
    expected: "Tab B shows the conflict dialog with a correct field diff on the same-record case; no dialog on the different-record case."
    why_human: "No browser is available inside an autonomous execution. The underlying mechanism is proven at the HTTP level (real spawned cross-process tests for tasks/synergies) and the dialog's rendering logic is proven in a node:vm sandbox, but the actual click-through in two real browser tabs on these specific pages was never performed and is explicitly recorded as a recommended-but-not-yet-performed check in 09-05-SUMMARY.md/09-VALIDATION.md."
  - test: "Two-browser-tab conflict walk on due-diligence.html's finding/request-item edit surfaces."
    expected: "The second save shows the conflict dialog with the area-filtered currentRecord."
    why_human: "Same as above — HTTP-level and structural proof exists (including the CR-01 clearance-filter fix, proven by dedicated tests), but no real-browser two-tab walk was performed on this page."
  - test: "Two-browser-tab conflict walk on org.html's position edit surface."
    expected: "The second save shows the conflict dialog."
    why_human: "Same as above — HTTP-level proof exists, no real-browser walk performed on this page."
  - test: "Two-browser-tab destructive-delete walk on execution.html (RAID/task/synergy) and org.html (position) — edit a record in tab A and save, then delete that same record in tab B."
    expected: "Tab B shows the destructive-variant conflict dialog and the record still exists until confirm is clicked; deleting an untouched record works in one click with no dialog."
    why_human: "The delete-variant dialog's rendering/behavior is proven in a node:vm sandbox (12/12 client-conflict-dialog.test.js cases including the destructive variant) and the server-side stale-delete 409 is proven for all 7 in-scope routes, but no real two-tab browser walk of the delete flow was performed."
  - test: "Developer/UAT review of FA-1: the phase's must_haves.truths for 09-01 were derived by hand from the requirement text (the deterministic edge-probe engine returned `unclassified` for CONC-02), not from the automated edge-probe engine."
    expected: "Confirm the hand-derived truth list is an accurate and complete decomposition of CONC-02's stale-write/reapply/per-record/version-less/update-vs-delete scenarios."
    why_human: "This is a methodology flag the plan itself raised (09-01-PLAN.md FA-1) for developer judgment, not something a grep/test can confirm or deny."
  - test: "Developer/UAT review of FA-2: the update-vs-deleted-record dialog copy (CONFLICT_TITLE_DELETED / CONFLICT_DELETED_INTRO / CONFLICT_CLOSE_LABEL) was authored fresh and was never part of the signed-off 09-UI-SPEC.md Copywriting Contract."
    expected: "Confirm the three ad-hoc literals are acceptable, or route them through a follow-up UI-SPEC amendment."
    why_human: "The plan itself flags this as a deliberate extension beyond the signed contract, for the developer's eye at UAT (09-01-PLAN.md FA-2)."
---

# Phase 9: Optimistic Locking & Conflict Recovery Verification Report

**Phase Goal:** When two people edit the same record, the second save is caught and safely recoverable instead of silently overwriting the first.
**Verified:** 2026-08-11
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

Roadmap Success Criteria (the contract) plus the phase's own must_haves, merged and deduplicated:

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1 — A stale-version write to any of the five named co-edited collections (RAID, integration task, DD finding, synergy initiative, org decision) is rejected with a 409, never silently clobbering the newer version | ✓ VERIFIED | Real HTTP-level tests pass for every one of the ten `VERSIONED_COLLECTIONS` lanes (raidEntries, integrationTasks×2, synergyInitiatives×2, ddFindings, ddRequestItems, orgPositions, orgFlightRisks — `test/optimistic-locking-contract.test.js` tests 1–35). Real spawned-OS-process races prove the SQL `WHERE`-clause layer is the actually race-free enforcement point for RAID/tasks/synergies (`test/optimistic-locking-cross-process.test.js`, 7/7 passing, re-run live). `orgDecisions` is a documented, code-commented append-only exemption (`server.js:4990-5004`) — there is no update/delete route for it anywhere in `server.js` (`grep` confirms only one `app.post('/api/org/decisions', ...)`), so "stale edit" cannot occur for that collection by construction. |
| 2 | SC2 — On a 409 the user sees a reload-and-reapply path that preserves their in-progress edit instead of discarding it | ✓ VERIFIED | `public/js/transitions.js`'s shared `showConflictDialog()`/`withFreshVersion()`/`attemptFetch()` 409 branch, proven behaviorally (not by inspection) in `test/client-conflict-dialog.test.js`: 12/12 passing, re-run live, including "no auto-retry", "apply resubmits with fresh version, otherwise byte-identical", "discard issues no further fetch", "second conflict re-renders in place, never stacks a second overlay", and the destructive stale-delete variant. The live 8-step two-window visual walk (viewports 1440/1024/375px, attribution fallback) was performed and APPROVED by the user 2026-08-11 (09-03-SUMMARY.md), and per that SUMMARY also covered the RAID-path two-tab check. |
| 3 | SC3 — Two users editing different records concurrently both save successfully; the lock bites only on the same record, not the whole collection | ✓ VERIFIED | Proven by real spawned OS processes, not simulation: `optimistic-locking-cross-process (different records)` and `(integration tasks, different records)` both pass live; the `(cross-collection)` case additionally proves the version predicate doesn't serialize unrelated collections. `npm run soak` (15s smoke run, executed live for this verification) confirms the same property under sustained real multi-process load: conflict-lane reconciliation exact (`initialVersion=1 conflictAcknowledged=115 expectedFinalVersion=116 actualFinalVersion=116`), zero lost writes, zero violations. |
| 4 | Enforcement lives in the SQL `WHERE` clause inside `writeDb()`'s `.immediate` transaction, not a JS-level compare (roadmap requirement wording) | ✓ VERIFIED | `db/store.js:388/393` — `UPDATE ... WHERE id = ? AND (json_extract(data,'$.version') IS NULL OR json_extract(data,'$.version') = ?)`, same shape for DELETE. Structural test confirms the bound parameter is never interpolated (`optimistic-locking-contract (structural): ... always binds the expected version as a parameter`). |
| 5 | A conflict's 409 body never leaks clearance-gated record content the caller isn't cleared for, even on the race-only WHERE-clause path (CR-01, code review finding) | ✓ VERIFIED | `db/store.js`'s `conflictVisibleRecord()` + `CLEARANCE_SCOPED_COLLECTIONS` (`ddFindings`, `ddRequestItems`) fail-closed backstop, `server.js`'s `conflictIfStale()` arms `areaClearanceFilter` on the request's db context before its early returns. 4 dedicated "CR-01 (a–d)" tests pass live, proving fail-closed-when-unarmed, raid-regression (full echo preserved for non-scoped collections), arming side-effect, and armed-filter parity through the real WHERE-layer path. Fix commit `fb20b2b` is on `main`. |
| 6 | Every future route on a versioned collection that skips the version check fails the suite by default — the promise is structural, not conventional (D-06) | ✓ VERIFIED | `optimistic-locking-contract (Part 1, structural coverage gate)` — a live regex+brace-matched scan of `server.js`'s actual route handlers, re-run live, passing. Both-direction inventory cross-check (Part 2) also passes. |
| 7 | Stale-delete (D-08) is closed for all seven in-scope collections — deleting based on a stale version is rejected the same way, with a destructive-confirm dialog variant, not a stacked `window.confirm()` | ✓ VERIFIED | All seven `app.delete(...)` routes (RAID, integration tasks, synergy initiatives, org positions, org flight-risk, DD request-items, DD findings) call `conflictIfStale()` before mutation — read directly from `server.js`, matching the structural test's own claim (test 44/9, passing). Client dialog's destructive variant proven behaviorally: 6/12 `client-conflict-dialog.test.js` cases are delete-specific and pass live. |
| 8 | A version conflict aborts the whole `writeDb()` call — nothing that call attempted persists, including multi-collection conversions (finding→task/RAID, flight-risk→task/RAID) | ✓ VERIFIED | Live tests 23/24 (DD finding convert) and 33/34 (flight-risk convert) pass, asserting no orphan task/RAID row and unchanged link arrays on a stale conflict. |
| 9 | An update racing a concurrent delete of the same record is reported to the user, never silently acknowledged as success (backstop truth, PD-4) | ✓ VERIFIED | Real spawned-process test `optimistic-locking-cross-process (update vs delete)` passes live: the losing writer sees a typed `conflictKind: 'deleted'` (never a false `{success:true}`), the surviving row is never resurrected. Client-side rendering of this state (`CONFLICT_TITLE_DELETED` branch in `transitions.js`) exists, though it is one of the two FA-2-flagged ad-hoc literals (see Human Verification). |

**Score:** 9/9 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `db/collections.js` | `VERSIONED_COLLECTIONS` (10 tables) + `CLEARANCE_SCOPED_COLLECTIONS` | ✓ VERIFIED | Both exports present with self-checking invariants (`throw` if count/membership wrong) |
| `db/store.js` | version stamping, WHERE-clause enforcement, `isConflictError`/`makeConflictError`/`conflictVisibleRecord` | ✓ VERIFIED | All present, exported, exercised by 4 CR-01 tests + cross-process tests |
| `server.js` | `conflictBody()`, `conflictIfStale()`, `parseExpectedVersion()`, central 409 middleware, route wiring | ✓ VERIFIED | 26 real `conflictIfStale()` call sites across all in-scope POST/DELETE routes; central 409 middleware at line ~7217 mirrors the 503 sibling pattern |
| `validators/workstream.js`, `validators/dd.js`, `validators/org.js` | `version` field on every relevant schema | ✓ VERIFIED | `version: z.number().int().nonnegative().optional()` present on all task/synergy/DD/org schemas, with explanatory comments about zod's key-stripping pitfall |
| `public/js/transitions.js` | 409 branch, `showConflictDialog()`, destructive variant, in-place re-render | ✓ VERIFIED | All present; 12/12 behavioral tests pass live |
| `public/css/style.css` | `.conflict-modal*` rules incl. edge-state classes | ✓ VERIFIED | Referenced classes (`.conflict-diff-empty`, `.conflict-diff-value-empty`, `.conflict-modal-error`, `.conflict-btn-delete`) exist and are exercised by the client dialog tests |
| `public/js/execution.js`, `public/js/org.js`, `public/js/due-diligence.js` | write/delete call sites thread `version`/`expectedVersion` | ✓ VERIFIED | 5 `expectedVersion` call sites confirmed (RAID, task, synergy, synergy cost-entry, org position) — matches the 4 genuinely-existing UI delete surfaces the plans identified; DD/flight-risk have no delete UI at all (pre-existing product gap, recorded in `.planning/WINDOWS.md` item #2, server-side protection unaffected) |
| `test/optimistic-locking-contract.test.js` | four-part coverage gate + per-collection cases | ✓ VERIFIED | Re-run live: 9/9 structural + dozens of integration cases, all pass |
| `test/optimistic-locking-cross-process.test.js` | real spawned-process races | ✓ VERIFIED | Re-run live: 7/7 pass |
| `test/client-conflict-dialog.test.js` | node:vm sandbox behavioral proof | ✓ VERIFIED | Re-run live: 12/12 pass |
| `scripts/soak.js` | conflict-aware reconciliation | ✓ VERIFIED | Re-run live (15s smoke config): PASS, conflict-lane reconciled exactly, zero violations |
| `09-VALIDATION.md` | filled, signed off | ✓ VERIFIED | `nyquist_compliant: true`, approved 2026-08-11, matches actually-executed plans |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `db/store.js` WHERE-clause throw | `server.js` central 409 middleware | `isConflictError(err)`/`err.conflictDetail` | ✓ WIRED | Middleware at line ~7217 matches the throw sites' error shape |
| `server.js` 409 body | `public/js/transitions.js` 409 branch | `body.conflict === true` marker | ✓ WIRED | `transitions.js:567` — discriminates on body marker, not status code alone; verified by dedicated "marker-less 409 renders no dialog" test |
| `RaidUpsertSchema.version`/task/synergy/DD/org schemas | `req.body.version` → `conflictIfStale()` | zod schema field | ✓ WIRED | Version fields present on every relevant schema; without them zod v4 would silently strip the key (explicitly commented at each declaration) |
| `conflictIfStale()`'s `clearanceFilter` (route precheck) | `db/store.js`'s `areaClearanceFilter` (WHERE-layer throw) | `currentDbContext().areaClearanceFilter` | ✓ WIRED | The CR-01 fix — both layers now share one filtering rule, proven by test (d) "armed-filter parity through a real WHERE-layer conflict" |
| `parseExpectedVersion(req)`'s query-channel | all 7 DELETE routes | `?expectedVersion=` | ✓ WIRED | Confirmed at each of the 7 `app.delete(...)` bodies reading `conflictIfStale(req, res, record)` before mutation |

### Data-Flow Trace (Level 4)

Not applicable in the standard sense (this phase is not rendering dynamic list data) — instead the equivalent trace is the conflict body's `currentRecord` sourced from a real freshly-read DB row (`JSON.parse(row.data)` in `db/store.js`, or `record` freshly read by the route in `conflictIfStale()`), never a static/mock value. Confirmed by direct code inspection at every throw/precheck site.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CR-01 fix (fail-closed clearance filter) | `node --test --test-name-pattern="CR-01" test/optimistic-locking-contract.test.js` | 4/4 pass | ✓ PASS |
| Full suite | `npm test` | 779/779 pass, 0 fail | ✓ PASS |
| Structural coverage gate | `node --test optimistic-locking-contract.test.js` (Parts 1–2 + 16/25/35/44) | 9/9 pass | ✓ PASS |
| Real cross-process races (7 cases incl. update-vs-delete) | `node --test test/optimistic-locking-cross-process.test.js` | 7/7 pass | ✓ PASS |
| Client dialog behavioral proof (incl. delete variant) | `node --test test/client-conflict-dialog.test.js` | 12/12 pass | ✓ PASS |
| Real multi-process conflict-aware soak | `SOAK_DURATION_MS=15000 node scripts/soak.js` | PASS, 115 acknowledged conflict-lane writes reconciled exactly, 244 real 409s, 0 lost/leaked | ✓ PASS |
| WR-01/WR-02 double-message fix | `grep -n "conflict === true" public/js/execution.js public/js/org.js` | 6 guard sites present | ✓ PASS |
| DD/org conflict + exemption HTTP-level cases | `node --test --test-name-pattern` on tests 17-32 | 16/16 pass | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` files exist for this phase; N/A.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CONC-02 | 09-01 through 09-07 (all 7 plans) | Stale co-edited-record writes rejected 409 with reload-and-reapply UI, per-record granularity, SQL WHERE-clause enforcement | ✓ SATISFIED | All roadmap Success Criteria verified above with re-run live evidence; `.planning/REQUIREMENTS.md:60` marks it Complete; no orphaned requirements — CONC-02 is the only ID mapped to Phase 9 in REQUIREMENTS.md |

### Anti-Patterns Found

None. Scanned all phase-modified files (`db/collections.js`, `db/store.js`, `server.js`, `public/js/transitions.js`, `public/css/style.css`, `public/js/execution.js`, `public/js/org.js`, `public/js/due-diligence.js`, `validators/workstream.js`, `validators/dd.js`, `validators/org.js`, `test/optimistic-locking-contract.test.js`, `test/optimistic-locking-cross-process.test.js`, `test/client-conflict-dialog.test.js`, `scripts/soak.js`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/stub patterns. Zero matches. The only `placeholder`-word hits were pre-existing unrelated HTML `placeholder` attributes and a comment describing the italic "(empty)" UI placeholder — not a stub marker.

### Known, Non-Blocking Items (carried forward, not re-litigated)

- **Intermittent pre-existing flake** in `test/audit-security-events.test.js` (occasional 0-vs-1 audit row after a 200, ~1-in-5 full-suite runs) — file untouched by this phase's diff; the live re-run for this verification came back 779/779 clean. Open item for a dedicated debug session, not a Phase 9 gap.
- **Three planned client delete call sites do not exist**: org flight-risk delete and both DD delete surfaces (findings, request-items) have no delete UI anywhere in the app — a pre-existing product gap, not something this phase should invent UI for. Server-side D-08 protection is complete for all seven routes regardless of whether a client surface calls them. Recorded as a deliberate product decision in `.planning/WINDOWS.md` item #2.

## Human Verification Required

4 real-browser two-tab walks were never performed in any autonomous run (server-side and client-rendering mechanisms are both independently proven, but the end-to-end click-through on these specific pages was not), plus 2 developer/UAT review flags the plan itself raised. See frontmatter `human_verification` for the full list:

1. **Two-tab conflict walk — execution.html (tasks/synergies)** — recommended, not yet performed.
2. **Two-tab conflict walk — due-diligence.html (findings/request-items)** — recommended, not yet performed.
3. **Two-tab conflict walk — org.html (positions)** — recommended, not yet performed.
4. **Two-tab destructive-delete walk — execution.html + org.html** — recommended, not yet performed.
5. **FA-1 review** — hand-derived (not engine-derived) must_haves truth list — confirm accuracy.
6. **FA-2 review** — ad-hoc "deleted" dialog copy extends the signed UI-SPEC — confirm acceptable or amend the contract.

None of these block the underlying mechanism, which is independently proven at the HTTP level (real spawned-process races for RAID/tasks/synergies, real HTTP integration tests for DD/org, a real multi-process soak) and at the client-rendering level (node:vm sandbox, 12/12 passing, plus one approved live 8-step visual walk on the RAID path covering all viewport/edge-state considerations). They are recommended additional confidence, explicitly flagged as such by the phase's own SUMMARYs and validation contract — not evidence of a broken feature.

## Gaps Summary

No gaps found. All 9 observable truths derived from the roadmap Success Criteria and the plans' own must_haves are verified with live, re-run evidence — including real spawned-OS-process concurrency proofs (the strongest form of evidence for this phase's core claim) and a real multi-process soak run. The one code-review-found critical issue (CR-01, cross-process 409 clean-room leak) was fixed post-review and the fix is confirmed present and tested in the current codebase. Both review warnings (WR-01/WR-02, double-messaging) are also confirmed fixed. The phase goal — a caught, safely-recoverable second save instead of a silent overwrite — is demonstrably true in the codebase for all five roadmap-named collections plus every other versioned collection in scope.

Status is `human_needed` rather than `passed` solely because of the recommended-but-unperformed real-browser two-tab walks and two self-flagged developer-review items, not because of any detected defect.

---

_Verified: 2026-08-11_
_Verifier: Claude (gsd-verifier)_
