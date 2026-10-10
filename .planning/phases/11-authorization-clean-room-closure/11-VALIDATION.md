---
phase: 11
slug: authorization-clean-room-closure
status: signed-off
nyquist_compliant: true
deferrals: []
suite: { tests: 1187, pass: 1187, fail: 0, runs: 1 }
soak: { verdict: PASS, acknowledged: 2901, lost: 0, audit_rows: 2901, bounded_503: 17, committed_but_unaudited: 0, config: "3 processes / 120 s / 250 ms write interval" }
runner: { pass: 523, fail: 0, lanes: 6, phase11_real: "154 PASS / 0 FAIL", phase11_demo: "193 PASS / 0 FAIL" }
phase9_walk: { normal: "350 PASS / 0 FAIL", demo_open: "18 PASS / 0 FAIL" }
signed: 2026-10-10
plan: 11-08
---

# Phase 11 - Validation (Authorization & Clean-Room Closure)

Signed against the written contract: `.planning/reviews/v3.0/PHASE-11-PRD.md` (acceptance 1-6),
ROADMAP Phase 11 success criteria SC1-4, requirements AUTHZ-01..05 and the locked decisions
D-11-01..07 in `11-CONTEXT.md`, with the orchestrator's binding amendments (`11-AMENDMENTS.md`).
Every PASS names a test file (and test name where one exists) or an evidence file. Anything not
proven is under "Open items".

Evidence directory: `.planning/phases/11-authorization-clean-room-closure/evidence/` (`README.md`
maps every file to its scenario and acceptance item and gives the regeneration commands). The Phase
10 runner exits 0 over all six lanes with the Phase 11 scenarios plugged in and the Phase 10 scenarios
unchanged; committed `data/demo.db` + `data/control.db` (+ `-wal`) sha256 and `git status --porcelain
-- data` are unchanged in every log. `node --test`: 1187/1187 (1055 at the Phase 10 close, 1181 at the
base of this plan, +6 here). Browser evidence is a re-runnable script, so it can be regenerated after
review fixes with the commands in `evidence/README.md`.

## PRD acceptance

| # | Acceptance | Verdict | Proof |
|---|------------|---------|-------|
| 1 | Real deal, `employee`: 403 on synergies, RAID, tasks, roster, communications, org, DD, reports, others' pulses; 200 on courses/lessons/notifications/own pulse | PASS | `test/read-policy-matrix.test.js` ("matrix: real deal" (role x route, PRD acceptance 1; a refusal is the fixed body with no data), "tracer: employee is refused /api/synergies and /api/synergies/rollup in a real deal; staff keep 200", "matrix: /api/pulses" (employee reads its own pulse and none of a colleague's named data)); `test/personal-data-reads.test.js` ("PRD acceptance 1 (pulses): 200 on own pulse, no named data for others' pulses, every role"); scenario `authzRoleMatrix` @ real (`phase11-real.log`: 8 refused GETs, 3 served GETs, pulses own-only, 0 refused responses on `employee.html` at 1440 and 390; shots `p11-employee-employee-1440/-390.jpg`) |
| 2 | `pmo`/`hrbp` 403 on POST settings/menus/pages/banners/slides/media/i18n; `hrbp` edits deal-level values via the setup route; `GET /api/settings` for non-admins holds no secret | PASS | `test/config-admin-only.test.js` ((a) demo store, (b) real deal, (c) admin unaffected, (d) spelling variants, (e)/(f) time-travel exception); `test/deal-settings-setup.test.js` ((a) hrbp member sets all five values, (b) pmo/employee 403 + non-member 404, (c) bounds, (g) audit event); `test/settings-public-subset.test.js` ((a) allowlist has no secret, (b)-(d) every non-admin lane, (e) admin unchanged, (f) client-read drift scan); scenario `authzRoleMatrix` (7 POST rows x 2 roles -> 403, hrbp setup -> 200, rollup reports 25, allowlist subset per role); shots `p11-hrbp-admin-1440/-390.jpg` (console with configuration hidden) vs `p11-admin-admin-1440.jpg` |
| 3 | Uncleared member: 404 on read/update/status-flip/delete of an `hr` task and RAID entry, 404 (not 409) with a stale version, no record field in any response; cleared member and admin unaffected; conversions work | PASS | `test/clearance-write-paths.test.js` ("clearance-write-paths (tracer)" (uncleared member POST {id, version} on an hr task -> 404), "clearance-write-paths (Task 2, default lane)", "clearance-write-paths (Task 2, custom lane demoMode:false)", "clearance-write-paths (Task 2): conversions", "clearance-write-paths (Task 3): store WHERE-layer conflict with NO armed filter", "clearance-write-paths (Task 3, structural gate)" (every conflictIfStale() caller passes a clearanceFilter)); scenario `cleanRoom404` @ real (10 write/delete shapes on the task and the RAID entry, incl. version none / 0 / 999 -> 404 body identical to a missing id; lists omit both records; cleared member reads both; IL record unchanged afterwards; conversion idempotent; both execution boards - shots `p11-cleanroom-board-cleared-1440.jpg` shows the entry, `-uncleared-1440.jpg` does not) |
| 4 | Every registered GET route has a read-policy entry (the build fails on an unlisted one); no GET mutates (instrumented) | PASS | `test/read-policy-coverage.test.js` ("coverage: every registered GET /api route has a ROLE_READ_POLICY rule", "coverage: negative control" (a synthetic unlisted GET route is reported as uncovered), "coverage: every ROLE_READ_POLICY rule governs at least one registered GET route", "coverage live: a deal-bound pmo GET to an unlisted /api path is refused 403 by the gate (not 404)"); `test/no-get-mutates.test.js` ("no GET mutates: every registered GET route, real-deal admin AND demo-store admin, writes nothing outside the audit trail", three negative controls, "static: no app.get() handler in server.js calls writeDb()", "AUTHZ-04: every registered route uses only GET or an explicit write method; every write route has a registered schema"); `test/get-or-create-post.test.js` ("GET /api/employees/get-or-create no longer exists: never 2xx and creates nothing, in every lane"); scenario `authzRoleMatrix` rows "acceptance 4: ... get-or-create" |
| 5 | Variant paths (`/api/Synergies`, `//api/raid`, `%73`...) get the canonical verdict | PASS | `test/path-canonical-gate.test.js` ("CR-01 live: ROLE_READ_POLICY x variants", "CR-01 live: ROLE_WRITE_POLICY x variants"); `test/config-admin-only.test.js` (d); `test/denial-audit.test.js` ("live variants: /api/Synergies, /api/synergies/ and /api//synergies are recorded under the SAME canonical route/template"); scenario `authzRoleMatrix` (12 GET spellings as employee never 200; 6 POST spellings as pmo never 2xx) |
| 6 | Denials produce rate-bounded audit rows (<= 1 / 60 s per actor+route+reason); suite green; demo suite and Phase 9/10 walks unchanged | PASS | `test/denial-audit.test.js` ("tracer: anonymous GET /api/synergies x5 -> 401 x5 -> exactly ONE access-denied row", "live: a refused probe cannot flood audit.db" (60 denials across 3 templates produce one row per key), "unit: <= 1 row per key per window across many windows; counts always add up"); scenario `denialAuditBounded` @ real (fresh actor + route, amendment 6: 20 probes -> exactly 1 row; after the window 2 rows 62 s apart with total count 20); suite 1187/1187; `phase11-demo.log` 193/0 and identical step-for-step to the same scenario on the pre-Phase-11 tree; `phase10-walk.log` 523/0; `phase9-walk.log` 350/0; `phase9-walk-demo-open.log` 18/0; `soak.log` PASS |

## ROADMAP success criteria

| SC | Verdict | Proof |
|----|---------|-------|
| SC1 every `/api` read route has a declared role policy, an unlisted route fails the coverage test, `employee` refused synergies/RAID/tasks/roster/communications/pulses/org | PASS | `test/read-policy-coverage.test.js`; `test/read-policy-matrix.test.js`; `test/personal-data-reads.test.js`; scenario `authzRoleMatrix`; DEPLOYMENT.md "Roles and what they can read" held to `lib/readPolicy.js` by `test/deployment-role-matrix.test.js` ("the documented read table matches lib/readPolicy.js row for row, in order") |
| SC2 `pmo`/`hrbp` cannot write instance settings, menus, pages, banners, slides, media, i18n, AI keys; deal-level values go through the deal setup route | PASS | `test/config-admin-only.test.js`; `test/deal-settings-setup.test.js`; `test/settings-public-subset.test.js`; `test/deployment-role-matrix.test.js` ("every route in the documented admin-only write table is refused to non-admins for POST and DELETE, and allowed to admin", "the documented deal-level bounds are the schema bounds"); scenario `authzRoleMatrix` |
| SC3 outside a record's clearance area: not found on read, update, status-flip, delete of tasks and RAID, never a body, 409 echo or silent overwrite; no GET changes state | PASS | `test/clearance-write-paths.test.js`; `test/task-access-filter.test.js`; `test/raid-access-filter.test.js`; `test/no-get-mutates.test.js`; scenario `cleanRoom404`; evidence boards |
| SC4 every 401/403 and clearance-404 is a rate-bounded security event with actor, route, reason | PASS | `test/denial-audit.test.js` (live rows for `no-session`, `must-change-password`, `demo-only`, `role-write`, `role-read`, `deal-access`, `clearance-404`, `credential-lockdown`); scenario `denialAuditBounded` |

## Requirements

| ID | Verdict | Proof |
|----|---------|-------|
| AUTHZ-01 | PASS | `test/read-policy-coverage.test.js`; `test/read-policy-matrix.test.js`; `test/personal-data-reads.test.js`; `test/path-canonical-gate.test.js`; `test/client-authz-hiding.test.js`; scenario `authzRoleMatrix` |
| AUTHZ-02 | PASS | `test/config-admin-only.test.js`; `test/settings-public-subset.test.js`; `test/deal-settings-setup.test.js`; `test/client-authz-hiding.test.js` (config controls hidden); `test/deployment-role-matrix.test.js` |
| AUTHZ-03 | PASS | `test/clearance-write-paths.test.js`; `test/task-access-filter.test.js`; `test/raid-access-filter.test.js`; `test/optimistic-locking-contract.test.js` (unchanged, green); scenario `cleanRoom404` |
| AUTHZ-04 | PASS | `test/get-or-create-post.test.js`; `test/no-get-mutates.test.js` (instrumented every-GET drive, two lanes, negative controls; write-method and schema sweep) |
| AUTHZ-05 | PASS | `test/denial-audit.test.js`; scenario `denialAuditBounded` |

## Locked decisions

| Decision | Verdict | Proof |
|----------|---------|-------|
| D-11-01 `ROLE_READ_POLICY` on the canonical path, fail-closed, coverage test, demo store lenient | PASS | `test/read-policy-coverage.test.js`; `test/read-policy-matrix.test.js` ("demo store stays lenient: an employee session bound to no deal still reads /api/synergies", "matrix: demo store stays lenient"); `phase11-demo.log` (showcase unchanged vs `13a6da0`) |
| D-11-02 config surface admin-only, public subset, deal values on the setup route | PASS | `test/config-admin-only.test.js`; `test/settings-public-subset.test.js`; `test/deal-settings-setup.test.js`; scenario `authzRoleMatrix` |
| D-11-03 `assertRecordVisibleOr404` before `conflictIfStale`, `CLEARANCE_SCOPED_COLLECTIONS` extended | PASS | `test/clearance-write-paths.test.js` (structural: "every by-id task/RAID write route and both conversion routes call assertRecordVisibleOr404(req, db, deal, ...) before conflictIfStale", "CLEARANCE_SCOPED_COLLECTIONS covers the four task/RAID lanes ..."); scenario `cleanRoom404` |
| D-11-04 get-or-create -> POST; no GET mutates (instrumented) | PASS | `test/get-or-create-post.test.js`; `test/no-get-mutates.test.js`; scenario `authzRoleMatrix` ("acceptance 4/5: employee POST /api/employees/get-or-create resolves ONLY its own account-derived record") |
| D-11-05 rate-bounded denial security events | PASS | `test/denial-audit.test.js`; scenario `denialAuditBounded`. Adaptation recorded in 11-04-SUMMARY: the counter is written as the next row (audit_log is append-only by trigger), not by updating the first |
| D-11-06 pulses/hrbps personal-data limits; policy table in DEPLOYMENT.md | PASS | `test/personal-data-reads.test.js` ("real deal: employee sees only its own; pmo own + aggregate; hrbp/admin everything; legacy never own"); `test/read-policy-matrix.test.js`; DEPLOYMENT.md "Roles and what they can read" + `test/deployment-role-matrix.test.js`; scenario `authzRoleMatrix` (pulse rows) |
| D-11-07 canonical path on every gate, variants for every prefix family touched | PASS | `test/path-canonical-gate.test.js`; `test/read-policy-matrix.test.js` ("readAllowsForms is canonical-anchored"); `test/config-admin-only.test.js` (d); scenario `authzRoleMatrix` (acceptance 5 rows) |

## Deviations & discretion calls (this plan)

1. **Phase 10 runner output not committed in full.** The full Phase 10 run writes ~30 screenshots
   (1.1 MB on its own) into `--out`; it was run into a scratch directory and only its log is kept
   (`phase10-walk.log`), so the evidence directory stays under the 1200 KB cap.
2. **Screenshots are JPEG q28 and subsampled.** Every page is checked at 1440 and 390; only a subset is
   shot (listed in `evidence/README.md`).
3. **Soak at a lighter write rate.** The default `npm run soak` (100 ms interval) filled this host's
   disk: the pre-existing O(N)-audit-rows-per-write amplification produced a 5.5 GB `audit.db`
   (6.78 M rows in ~90 s; identical on the pre-Phase-11 tree, so not a Phase 11 regression) and the run
   died with `SQLITE_FULL`. The verdict recorded here is the same script with
   `SOAK_WRITE_INTERVAL_MS=250` (D-14 sanctions the knob). Finding F-5.
4. **Scenario assertions are on behaviour.** The only table the scenarios read is the declared
   `PUBLIC_SETTINGS_KEYS` allowlist; every other expectation is a status, a body field or a visible
   string, so they stay valid after review fixes.
5. **`demoShowcaseUnchanged` measured against the previous tree.** The same scenario file ran against a
   `git archive` of `13a6da0` and the two result sets were compared step by step (no step on one side
   only, no status difference).
6. **Navigation observations are not assertions.** Page-level role gates were outside Phase 11 (11-07
   hand-off); the runner records what a role meets when it follows a visible link as
   `OBSERVATION` rows (findings F-1 to F-3) rather than as red checks.

## Open items

- **F-1 / F-2 / F-3 (client, found by the real-lane walk, not caused by Phase 11):** an `employee` who
  follows the always-visible "Admin Console" link lands on `admin.html` and the page load raises six
  `403`s (`/api/assessments`, `/api/employees`, `/api/hrbps`, `/api/communications`, `/api/projects`,
  `/api/processes`); a `pmo` on `admin.html` raises one (`GET /api/hrbps`, `admin.js`, not behind
  `maCan('hrbps')`); an `employee` on `due-diligence.html` / `org.html` raises three each. No data is
  shown, but "no 403 raised by a visible control" does not hold for these links. Detail and repro in
  `11-08-SUMMARY.md`.
- **F-4 (pre-existing, 11-07 hand-off):** the employee helpdesk form posts to
  `/api/communications/send`, which the write policy has never allowed for `employee`; the 403 is
  followed by the success message. Needs a product decision (self-service allowlist entry or remove).
- **F-5 (pre-existing, Phase 12 scope):** every write audits every row of each collection it touches,
  so `audit.db` grows quadratically under load (`pulses`: 6.7 M `update` rows for 3 474 inserts).
- **Review-fix re-run:** a Fable review of Phase 11 ran concurrently; this evidence describes the tree
  at the base of this plan. Re-run `evidence/README.md`'s commands after any fixes and refresh the
  counts above.
- **Visual judgement:** layout after hidden cards/tabs (11-07 coverage, `human_judgment`) is evidenced
  by screenshots an agent viewed; a human eye on `p11-hrbp-admin-1440.jpg` / `p11-employee-*` remains
  the verifier's call.
