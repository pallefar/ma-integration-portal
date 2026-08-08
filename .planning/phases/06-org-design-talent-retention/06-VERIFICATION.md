---
phase: 06-org-design-talent-retention
verified: 2026-08-08T06:25:00Z
status: human_needed
score: 154/156 must-have truths verified
behavior_unverified: 0
overrides_applied: 0
re_verification: false
prohibitions:
  total: 3
  test_verified: 1
  judgment_flagged: 2
human_verification:
  - test: "Author a position whose `level` value is unusually long (e.g. 60+ chars of free text) and view the org tree at desktop and 375px"
    expected: "The compact level chip wraps or grows without breaking the card layout — no clipped pill, no horizontal page overflow"
    why_human: "UI-SPEC §long-text/unassigned-employees-bucket row is a declared `verification: backstop` item — 'Flagged for executor visual verification rather than assumed'. No summary or walk record evidences a long-level visual check (seeded levels are short; DE/ZH width steps covered translated labels, not authored free text). Per the UI-SPEC's own locked rule (line 595-596), an unevidenced backstop routes to human_needed, never a silent pass."
  - test: "Seed or paste ~40-60 flight-risk entries into the register and scroll the page"
    expected: "The register renders as a page-scrolling list without layout breakage; no pagination expected (deliberately not designed — key-talent volume is tens, not hundreds)"
    why_human: "UI-SPEC §overflow/flight-risk-register row is a declared `verification: backstop` item with the explicit disposition 'Routes to human_needed at verify time if unevidenced'. The approved Task 2/3 walks ran with 3 seeded entries; no high-volume render was ever observed. Structural CSS evidence (flex list, no fixed height, page scroll) is corroborating but the project contract demands observed evidence or a human check."
  - test: "PROHIBITION (judgment, ORG-02 transparency) — read the five decision labels, the record-decision option text, and the redundant/redeploy confirmation dialog in EN and DE"
    expected: "No euphemism: 'Redundant'/'Redeploy' (DE 'Freigesetzt'/'Versetzen', ZH 裁减/调岗, CS Nadbytečný/Přeřadit) used verbatim; the confirm dialog for both types states the legal and severance consequence explicitly"
    why_human: "Judgment-tier prohibitions are never silently passed (ADR-550). NON-AUTHORITATIVE JUDGE VERDICT: SATISFIED — public/js/org.js:426-434 appends 'This is a governance record with legal and severance consequences — confirm before submitting.' exactly for redundant/redeploy; demo.db i18n labels verified in all four languages, none softened. Substantially exercised by the USER-APPROVED Task 2 walk (decision history, DE/ZH labels), but the walk checklist did not name the no-euphemism review explicitly, so it is flagged here rather than absorbed."
  - test: "PROHIBITION (judgment, ORG-03 fairness) — confirm no org surface derives, ranks or defaults a risk level or decision from engagement/gamification data"
    expected: "No org route reads points/badges/XP/leaderboard; no register or tree ordering keyed on them; every determination rests on human-entered rationale/mitigation"
    why_human: "Judgment-tier prohibitions are never silently passed. NON-AUTHORITATIVE JUDGE VERDICT: SATISFIED — zero gamification-field reads in public/js/org.js, the org route block of server.js (3968-4810), and scripts/seed-org-demo.js (grep: points|badge|xp|leaderboard|gamif|completedLessons → no hits in org code paths); test org-import (j) proves imported employees carry no truthy points/badge; risk level and decision type are operator-entered enum fields with no default. Flagged for one-glance human confirmation per policy."
---

# Phase 6: Org Design & Talent Retention — Verification Report

**Phase Goal:** The IL can represent the acquired organisation's structure and manage sensitive people decisions beyond the current flat employee list.
**Verified:** 2026-08-08 (commit range c7e6746..b6a30f0 on main, incl. post-review fixes d5a4ee7/1ea97a7/1a65316/dd53edc)
**Status:** human_needed — zero gaps, zero failed truths; 2 unevidenced UI backstops + 2 judgment-tier prohibitions flagged per the project's own never-silent-pass contract
**Re-verification:** No — initial verification
**Suite:** full `node --test` run once during this verification: **561/561 pass** (matches baseline)

## Goal Achievement — ROADMAP Success Criteria

| # | Success Criterion (roadmap contract) | Status | Evidence |
|---|---|---|---|
| 1 | IL can map roles (role, level, reports-to, mapped employee) beyond the flat employee list | ✓ VERIFIED | Position spine `{id,title,level,reportsToId,employeeId,state}` with `newId('pos')` ids (server.js:4095-4102); GET/POST /api/org/positions (4000, 4051); graph-integrity guards `positionGraphFailure()` (4029) refuse self/unknown/cycle/cross-state parents; bulk paste importer POST /api/org/positions/import (4213) all-or-nothing; employee link is `employeeId` FK, never free text; DELETE /api/employees/:id orphan guard (5573-5581). 98 tests pass across test/org-positions, org-access-policy, org-import, org-decisions. Tree UI live-walked, USER APPROVED (06-08 Task 2). |
| 2 | IL can record a role-selection or redundancy decision against a role or person | ✓ VERIFIED | Append-only `orgDecisions` log, POST /api/org/decisions (4437) gated by `isAdminOrIlRequest(req)` as the handler's literal first statement (4438); entry carries positionId + employeeId + required rationale; decidedBy/decidedAt stamped server-side, schema strips client values (4456-4470); derived-current computed at read time (`derivedDecisionFor`, 4405); five-value vocabulary in three anti-drift-tested copies (test/org-decisions.test.js:407-418). Decision recording live-walked, USER APPROVED. |
| 3 | IL can maintain a flight-risk register (risk level, owner, mitigation) that only authorized roles can read, with access audited | ✓ VERIFIED | GET /api/org/flight-risk (4507): hr-grant gate; denial writes `org-flightrisk-access-denied` audit row (4510-4513); SUCCESSFUL read writes `org-flightrisk-read` audit row (4516-4519) — the codebase's first read-side security event; writes/deletes tier-2 gated to admin/IL (4538-4541, 4612-4615); RAID-level reuse with no new enum; open-tier position reads write zero audit rows (proven by test). 78 tests pass across test/org-flight-risk-audit, org-flight-risk-conversion, raid-access-filter, org-summary. |

**Score:** 154/156 plan-frontmatter truths verified; 0 failed; 2 route to human (unevidenced backstops, below). Prohibitions: 1/3 test-verified, 2/3 judgment-flagged with satisfied judge verdicts.

## Per-Plan Truth Verification

Truths were verified against code (file:line opened, not SUMMARY claims), against the 8 org test files re-run in this session (176/176 pass), and against the two USER-APPROVED live browser walks recorded in 06-08-SUMMARY.md (treated as done per orchestrator directive).

| Plan | Truths | Verified | Notes |
|---|---|---|---|
| 06-01 (position spine, tiered clearance, graph guards) | 15 | 15 | `?state=target` 403 server-side before any row read (server.js:4006-4011); exact-match state normalisation (3996-4005); collections registered in db/collections.js:53-55 + schema.sql (`idx_orgPositions_project`), absent from DEAL_SEED_COLLECTIONS (grep: 0 org matches); UI form states walk-verified |
| 06-02 (tree, search, switch, copy-to-target) | 30 | 29 | Capability probe returns structurally-absent keys (4128-4138); delete blocked with direct-report count; 3 backstop truths: sibling order VERIFIED structurally (see below), search staleness VERIFIED structurally, level chip long-text → HUMAN |
| 06-03 (paste importer, employee linking, orphan guard) | 17 | 17 | All-or-nothing 400 with per-row errors; reportsTo resolves paste-first then lane; email case-insensitive match; orphan guard at 5573-5581; gamification fields untouched (org-import (j)) |
| 06-04 (append-only decision register, vocabulary, tier-2 gate) | 24 | 24 | Role gate is literal first statement (4438); rationale required (schema); form structurally absent for non-IL (org.js:369 inside `capabilities.recordOrgDecisions` branch); dangling-positionId entries retained but excluded from rollups (orgSummaryFor 4753-4766) — Plan 04's flagged assumption resolved by Plan 07 |
| 06-05 (flight-risk register, dual audit) | 26 | 25 | Both audit halves in the route handler, never accessPolicy (4507-4522); four-identity authz + concurrency + encoding round-trip tests pass; WR-02 owner default (4569, 4592) proven by tests j/j2/j3; backstop high-volume render → HUMAN |
| 06-06 (conversion, provenance RAID filter) | 12 | 12 | `org-flightrisk:<id>` source prefix produced in exactly one place (4653); dedupe-by-source no-op re-convert (4662, 4683); severity copied verbatim (4693); provenance filter in GET /api/raid (3913-3916) checks WR-03 `clearanceArea` stamp first (3891, stamped at 4702); `.raid-lvl.critical` rule exists (execution.html:124); corrected conversion-note copy in both due-diligence.js:328 and org.js:918 |
| 06-07 (clearance-scoped rollup, two-tier panel, nudge) | 23 | 23 | Restricted key assigned only inside granted branch by plain assignment (4744-4790) — absent, never zeroed; zero audit rows on summary; section/div tag-level distinction and nudge walk-verified at markup level (0 uncleared / 1 cleared markup query counts, USER APPROVED) |
| 06-08 (demo seed, four-language labels, live walks) | 9 | 9 | Tracked demo.db (WAL sidecar 0 bytes, git clean) queried WAL-less: 10 orgPositions, 6 orgDecisions, 3 orgFlightRisks; i18n keys org.dec_retain/redeploy/in_selection/redundant/open present with explicit EN/DE/ZH/CS values; seed idempotent via `orgseed_%` allowlist delete (seed script:314-316) + `wal_checkpoint`; both walks USER APPROVED (Task 2 re-walked clean after 5 fixes; Task 3 11/11 incl. 29-gauge baseline and both-directions RAID proof) |

### Backstop truths (declared `verification: backstop` — abstain unless evidenced)

| Backstop | Disposition | Evidence |
|---|---|---|
| Sibling positions render in stable, reproducible order | ✓ VERIFIED (structural) | Fully deterministic pipeline: server returns `lane.filter()` over the persisted array (order-preserving, server.js:4012-4013); updates mutate fields in place, never reorder (4079-4083); creates/imports/copy-to-target append; client `buildTree()` pushes in iteration order (org.js:272-287). No sort, no randomness, no time-keyed order anywhere in the path. |
| Search never displays a result set that outlives its own source fetch | ✓ VERIFIED (structural) | The guarded hazard is structurally absent: search performs NO fetch of its own — it synchronously filters the already-fetched tree on each input event (org.js:777-779, comment and code) and every source mutation re-renders through the same state. UI-SPEC itself notes the backstop "guards the staleness invariant should search ever become server-side". |
| Level chip renders correctly with an unusually long authored `level` | ? HUMAN | No fixed width/nowrap on `.org-node-level` (org.html:29) is corroborating, but the UI-SPEC flagged this for visual verification and no walk/summary records one. |
| Flight-risk register renders correctly at high entry volume | ? HUMAN | Page-scroll flex list, no fixed height, no pagination — but walks ran at 3 entries; UI-SPEC row explicitly routes this to human_needed if unevidenced. |

## Prohibitions (must-NOT)

| Prohibition | Tier | Status | Evidence |
|---|---|---|---|
| ORG-02 privacy: no org-lane determination ever written onto the `employees` row or any unrestricted collection | test | ✓ VERIFIED | Real enforcement test: `org-decisions-privacy` (test/org-decisions.test.js:504-539) records a redundant decision then asserts the roster record via GET /api/employees carries no decision/risk-typed key and no vocabulary value in its serialisation; passes. Code: decision entries append only to `orgDecisions` (4474); flight-risk route never touches employees; org.js has zero innerHTML sinks (tested, :545). |
| ORG-02 transparency: no euphemism for redundant/redeploy; consequence stated at record time | judgment | ⚠ FLAGGED — judge verdict SATISFIED (non-authoritative) | org.js:426-434 confirmation sentence; four-language labels verified in demo.db (Redundant/Freigesetzt/裁减/Nadbytečný). Human one-glance confirmation requested (item 3 above). |
| ORG-03 fairness: no risk/decision derived from gamification or behavioural proxies | judgment | ⚠ FLAGGED — judge verdict SATISFIED (non-authoritative) | Zero gamification reads in org routes/UI/seed (grep-proven); org-import (j) test; no default/ordering keyed on engagement data. Human confirmation requested (item 4 above). |

## Key Link Verification

gsd-tools verified 10/16 mechanically; the 6 "failures" were all tool parse artifacts (route-style `from:` fields). All 6 verified manually:

| From | To | Status | Evidence |
|---|---|---|---|
| DELETE /api/employees/:id | orgPositionsLane() | ✓ WIRED | server.js:5576 — occupied-position scan before the removal filter, 400 names count + first title |
| POST /api/org/decisions | isAdminOrIlRequest() | ✓ WIRED | server.js:4438 — literal first statement of the handler |
| GET /api/org/flight-risk | auditHook.recordSecurityEvent() | ✓ WIRED | server.js:4510 (denial) + 4516 (successful read), both in the route handler, none in db/accessPolicy.js |
| GET /api/raid | resolveRaidEntryClearanceArea() | ✓ WIRED | server.js:3913-3916 — per-entry provenance resolution inside the filter predicate |
| POST /api/org/flight-risk/:id/convert | raidLane()/taskLane() | ✓ WIRED | server.js:4660-4711 — dedupe-by-source lookup then push, linkedTaskIds/linkedRaidIds updated in same write |
| GET /api/org/summary | accessPolicy grant lookup | ✓ WIRED | server.js:4750 `hasAreaGrant` (which is `grantedAreas().includes()`, db/accessPolicy.js:97-99), evaluated before the restricted tier is computed |

## Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Real data | Status |
|---|---|---|---|---|
| public/js/org.js | state.positions/employees/decisions/flightRisks | 5-fetch load fan-out (org.js:180-216) → server lanes → SQLite blob collections | Yes — demo.db carries 10/6/3 seeded rows; walks rendered them | ✓ FLOWING |
| public/js/deal-home.js | org summary panel + nudge | fifth fan-out fetch of /api/org/summary → orgSummaryFor() over live lanes | Yes — walk verified markup counts | ✓ FLOWING |
| public/org.html tree | rendered position cards | buildTree(state.positions) | Yes | ✓ FLOWING |

## Requirements Coverage

| Requirement | Source plans | Status | Evidence |
|---|---|---|---|
| ORG-01 | 06-01/02/03/07/08 | ✓ SATISFIED | Position spine + tree + importer + linking + rollup, all test- and walk-proven |
| ORG-02 | 06-04/07/08 | ✓ SATISFIED | Append-only decision log, tier-2 gate, vocabulary, decision counts in rollup |
| ORG-03 | 06-05/06/07/08 | ✓ SATISFIED | Restricted register, dual audit, conversion, provenance RAID filter, owner nudge |

No orphaned requirements: REQUIREMENTS.md maps exactly ORG-01/02/03 to Phase 6; all claimed by plans.

## Post-Review Fixes (landed after the walks — test coverage confirmed, not assumed)

| Fix | Code | Tests genuinely exercising it |
|---|---|---|
| WR-01 employeeId roster validation on position create/update | server.js:4063-4072, 4088-4094 | org-positions (xx) 404-on-bogus + no-row-created; (yy) valid + vacant 201; update-path bogus 404 (test:1277-1358) |
| WR-02 owner defaults to caller's session identity | server.js:4569 (update), 4592 (create) | org-flight-risk (j) default applied; (j2) explicit owner honoured verbatim; (j3) defaulted owner feeds mine.unmitigatedFlightRisks nudge count (test:323-384) |
| WR-03 clearanceArea stamped at conversion; deletion never declassifies | server.js:4702 (stamp), 3891 (resolver checks stamp first) | raid-access-filter (f): entry stays invisible to uncleared member after originating finding deleted, still visible to admin (test:253-277) |

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|---|---|---|---|
| — | No TBD/FIXME/XXX in any of the 23 phase-modified files | — | Clean. All `placeholder` grep hits are legitimate input placeholders or tests asserting placeholder-avoidance; no empty-return stubs, no console-log-only handlers, zero innerHTML in org.js (test-enforced) |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Org test files (positions/access/import/decisions) | `node --test test/org-{positions,access-policy,import,decisions}.test.js` | 98/98 pass | ✓ |
| Org test files (flight-risk/conversion/raid-filter/summary) | `node --test` on the 4 files | 78/78 pass | ✓ |
| Full suite (once, regression evidence) | `node --test` | 561/561 pass, 2.5s | ✓ |
| Demo seed landed in the TRACKED db (WAL trap) | WAL-less copy of data/demo.db queried via better-sqlite3 | 10/6/3 org rows + 4-language decision keys; demo.db-wal is 0 bytes; git status clean | ✓ |

## Probe Execution

No `scripts/*/tests/probe-*.sh` convention exists in this project and no plan declares probes — N/A.

## Human Verification Required

Four items, all listed in frontmatter. None re-flags the two approved live walks. Two are UI backstops the phase's own UI-SPEC contract routes to human_needed when unevidenced (long level chip; high-volume register). Two are judgment-tier prohibitions carrying SATISFIED non-authoritative judge verdicts, flagged per the never-silent-pass rule — each is a one-glance confirmation.

## Gaps Summary

None. Every roadmap success criterion is observably true in the codebase with server-side enforcement (not UI hiding), every artifact exists and is substantive and wired, all 16 key links are connected, the 561-test suite is green, the seed data is in the tracked database file, and the three post-review fixes have genuine test coverage. The only open items are the four low-risk human confirmations above.

---

_Verified: 2026-08-08T06:25:00Z_
_Verifier: Claude (gsd-verifier, Fable 5)_
