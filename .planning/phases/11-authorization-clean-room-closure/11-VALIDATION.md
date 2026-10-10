---
phase: 11
slug: authorization-clean-room-closure
status: signed-off
nyquist_compliant: true
deferrals: []
suite: { tests: 1258, pass: 1258, fail: 0, runs: 1 }
soak: { verdict: PASS, acknowledged: 2226, lost: 0, audit_rows: 2226, bounded_503: 1, committed_but_unaudited: 0, config: "3 processes / 60 s / 250 ms write interval (SOAK_DURATION_MS=60000 SOAK_WRITE_INTERVAL_MS=250)" }
runner: { pass: 655, fail: 0, lanes: 6, phase11_real: "284 PASS / 0 FAIL", phase11_demo: "195 PASS / 0 FAIL", prefix_sensitivity: "93 FAIL on d927233 (pre-fix), 0 FAIL on this tree" }
phase9_walk: { normal: "350 PASS / 0 FAIL", demo_open: "18 PASS / 0 FAIL" }
signed: 2026-10-10
refreshed: 2026-10-10 (after the Phase 11 review fixes; plan 11-08 refresh)
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
-- data` are unchanged in every log. **This sign-off was refreshed after the Phase 11 review fixes**
(`11-REVIEW.md` / `11-REVIEW-CLIENT.md`, fixed by `11-REVIEW-FIX-S.md` / `11-REVIEW-FIX-C.md`): every
number and log named below describes the tree after them. `node --test`: **1258/1258** (1055 at the
Phase 10 close, 1181 at the base of plan 11-08, 1187 at its first sign-off, 1258 now). The first
sign-off's numbers (154 / 193 / 523 for the real lane, the demo lanes and the full runner, a 120 s soak
with 2901 writes) are superseded. See "Review remediation" below for the finding-by-finding map.

## PRD acceptance

| # | Acceptance | Verdict | Proof |
|---|------------|---------|-------|
| 1 | Real deal, `employee`: 403 on synergies, RAID, tasks, roster, communications, org, DD, reports, others' pulses; 200 on courses/lessons/notifications/own pulse | PASS | `test/read-policy-matrix.test.js` ("matrix: real deal" (role x route, PRD acceptance 1; a refusal is the fixed body with no data), "tracer: employee is refused /api/synergies and /api/synergies/rollup in a real deal; staff keep 200", "matrix: /api/pulses" (employee reads its own pulse and none of a colleague's named data)); `test/personal-data-reads.test.js` ("PRD acceptance 1 (pulses): 200 on own pulse, no named data for others' pulses, every role"); scenario `authzRoleMatrix` @ real (`phase11-real.log`: 8 refused GETs, 3 served GETs, pulses own-only, 0 refused responses on `employee.html` at 1440 and 390, the deal record is `{id,name,status}` with none of dealSizeM / synergyTargetM / memberGrants / members / setup (CR-01); shots `p11-employee-employee-1440/-390.jpg`) |
| 2 | `pmo`/`hrbp` 403 on POST settings/menus/pages/banners/slides/media/i18n; `hrbp` edits deal-level values via the setup route; `GET /api/settings` for non-admins holds no secret | PASS | `test/config-admin-only.test.js` ((a) demo store, (b) real deal, (c) admin unaffected, (d) spelling variants, (e)/(f) time-travel exception); `test/deal-settings-setup.test.js` ((a) hrbp member sets all five values, (b) pmo/employee 403 + non-member 404, (c) bounds, (g) audit event); `test/settings-public-subset.test.js` ((a) allowlist has no secret, (b)-(d) every non-admin lane, (e) admin unchanged, (f) client-read drift scan); scenario `authzRoleMatrix` (7 POST rows x 2 roles -> 403, hrbp setup -> 200, rollup reports 25, allowlist subset per role); shots `p11-hrbp-admin-1440/-390.jpg` (console with configuration hidden) vs `p11-admin-admin-1440.jpg` |
| 3 | Uncleared member: 404 on read/update/status-flip/delete of an `hr` task and RAID entry, 404 (not 409) with a stale version, no record field in any response; cleared member and admin unaffected; conversions work | PASS | `test/clearance-write-paths.test.js` ("clearance-write-paths (tracer)" (uncleared member POST {id, version} on an hr task -> 404), "clearance-write-paths (Task 2, default lane)", "clearance-write-paths (Task 2, custom lane demoMode:false)", "clearance-write-paths (Task 2): conversions", "clearance-write-paths (Task 3): store WHERE-layer conflict with NO armed filter", "clearance-write-paths (Task 3, structural gate)" (every conflictIfStale() caller passes a clearanceFilter)); scenario `cleanRoom404` @ real (10 write/delete shapes on the task and the RAID entry, incl. version none / 0 / 999 -> 404 body identical to a missing id; lists omit both records; cleared member reads both; IL record unchanged afterwards; conversion idempotent; both execution boards - shots `p11-cleanroom-board-cleared-1440.jpg` shows the entry, `-uncleared-1440.jpg` does not) |
| 4 | Every registered GET route has a read-policy entry (the build fails on an unlisted one); no GET mutates (instrumented) | PASS | `test/read-policy-coverage.test.js` ("coverage: every registered GET /api route has a ROLE_READ_POLICY rule", "coverage: negative control" (a synthetic unlisted GET route is reported as uncovered), "coverage: every ROLE_READ_POLICY rule governs at least one registered GET route", "coverage live: a deal-bound pmo GET to an unlisted /api path is refused 403 by the gate (not 404)"); `test/no-get-mutates.test.js` ("no GET mutates: every registered GET route, real-deal admin AND demo-store admin, writes nothing outside the audit trail", three negative controls, "static: no app.get() handler in server.js calls writeDb()", "AUTHZ-04: every registered route uses only GET or an explicit write method; every write route has a registered schema"); `test/get-or-create-post.test.js` ("GET /api/employees/get-or-create no longer exists: never 2xx and creates nothing, in every lane"); scenario `authzRoleMatrix` rows "acceptance 4: ... get-or-create" |
| 5 | Variant paths (`/api/Synergies`, `//api/raid`, `%73`...) get the canonical verdict | PASS | `test/path-canonical-gate.test.js` ("CR-01 live: ROLE_READ_POLICY x variants", "CR-01 live: ROLE_WRITE_POLICY x variants"); `test/config-admin-only.test.js` (d); `test/denial-audit.test.js` ("live variants: /api/Synergies, /api/synergies/ and /api//synergies are recorded under the SAME canonical route/template"); scenario `authzRoleMatrix` (12 GET spellings as employee never 200; 6 POST spellings as pmo never 2xx) |
| 6 | Denials produce rate-bounded audit rows (<= 1 / 60 s per actor+route+reason); suite green; demo suite and Phase 9/10 walks unchanged | PASS | `test/denial-audit.test.js` ("tracer: anonymous GET /api/synergies x5 -> 401 x5 -> exactly ONE access-denied row", "live: a refused probe cannot flood audit.db" (60 denials across 3 templates produce one row per key), "unit: <= 1 row per key per window across many windows; counts always add up"); scenario `denialAuditBounded` @ real (fresh actor + route, amendment 6: 20 probes -> exactly 1 row; after the window 2 rows 62 s apart with total count 20; WR-01: 25 DD by-id probes, 25 org-decision probes and 25 flight-risk probes by an uncleared pmo -> 1 row each, after the window one folded row, 25 in total); suite 1258/1258; `phase11-demo.log` 195/0, equal to the pre-Phase-11 tree step for step except the intended review changes (evidence README); `phase10-walk.log` 655/0; `phase9-walk.log` 350/0; `phase9-walk-demo-open.log` 18/0; `soak.log` PASS |

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

## Deviations & discretion calls (plan 11-08, first pass and refresh)

1. **Phase 10 runner output not committed in full.** The full Phase 10 run writes ~30 screenshots
   (1.1 MB on its own) into `--out`; it was run into a scratch directory and only its log is kept
   (`phase10-walk.log`), so the evidence directory stays under the 1200 KB cap.
2. **Screenshots are JPEG q28 and subsampled.** Every page is checked at 1440 and 390; only a subset is
   shot (listed in `evidence/README.md`). The refresh dropped four first-pass shots to make room for the
   two logged-in dev-lane shots of the non-admin demo accounts (IN-C04).
3. **Soak at a lighter write rate and a shorter window.** The default `npm run soak` (100 ms interval,
   120 s) filled this host's disk: the pre-existing O(N)-audit-rows-per-write amplification produced a
   5.5 GB `audit.db` (6.78 M rows in ~90 s; identical on the pre-Phase-11 tree, so not a Phase 11
   regression) and the run died with `SQLITE_FULL`. `db/store.js` and `db/auditHook.js` are byte-identical
   to the pre-review tree, so the amplification is unchanged and was not re-measured. The verdict recorded
   here is the same script with `SOAK_DURATION_MS=60000 SOAK_WRITE_INTERVAL_MS=250` (D-14 sanctions the
   knobs). Finding F-5, Phase 12 scope.
4. **`scripts/soak.js` correlator moved from `employeeName` to `comment` (refresh).** Review fix IN-02
   makes a real deal stamp a pulse's `employeeName` from the signed-in account, so the harness could no
   longer match its writes by that field: its exactness check reported `mismatched=1842` and its "a
   cleanly-refused write left nothing committed" lookup would have passed vacuously. The correlator now
   rides in `comment` (stored verbatim). This is a harness change, not a product change; the first,
   failing run and the reason are quoted at the top of `soak.log`.
5. **Scenario assertions are on behaviour.** The only table the scenarios read is the declared
   `PUBLIC_SETTINGS_KEYS` allowlist; every other expectation is a status, a body field or a visible
   string. After the review fixes the module asserts the NEW contract (page gate by verified role, projected
   deal record, bounded clearance denials, reserved sources); no assertion was loosened.
6. **Navigation observations became assertions (refresh).** Page-level role gates were outside Phase 11 at
   the first pass and were recorded as `OBSERVATION` rows (findings F-1 to F-4). The review fixes added
   the gates, so the module now asserts them. Two `OBSERVATION` rows remain, as measurements of product
   calls that are not Phase 11 contract: the employee's `GET /api/settings` still carries `targetCompany`
   (Phase 17), and the IL dashboard in a real deal shows the deal home, so its Communications Desk is not
   built (F-R1 in `11-08-REFRESH-SUMMARY.md`).
7. **The new rows were shown to be sensitive.** The same module, run against an archive of `d927233` (the
   head before the review fixes), fails 93 rows (`evidence/prefix-sensitivity.log`), one cluster per
   finding; on this tree it fails none.
8. **`demoShowcaseUnchanged` measured against the previous tree.** The module as committed at `e6a5021`
   ran against an archive of `13a6da0` and against this tree and the result sets were compared step by
   step: 188 steps on both sides, 5 only on the old side (page content of pages the verified role is now
   sent home from), 3 status differences (all WR-C01, intended), 13 detail differences (settings key count
   26 -> 24, rendered text 16 / 28 / 128 characters shorter for non-admins; 11-02, 11-07, IN-C04).

## Review remediation

Every finding of `11-REVIEW.md` (server side, Part A) and `11-REVIEW-CLIENT.md` (client side, Part B) with
its disposition, the fixing commit and the proof: a test name (file in `test/`) and/or rows of the
evidence logs (`phase11-real.log` = R, `phase11-demo.log` = D). Reports: `11-REVIEW-FIX-S.md`,
`11-REVIEW-FIX-C.md`.

### Part A: server side (FIXER S)

| Finding | Sev | Disposition | Commit | Test (name) and evidence |
|---|---|---|---|---|
| CR-01 deal registry record unprojected to employee / pmo | critical | fixed | `d86cd81` | `test/deal-record-projection.test.js` ("CR-01: GET /api/deals ...", "POST /api/deals/select echoes the SAME per-role projection", "(unit) projectDealForRole ...", "(static) every deal-registry exit in server.js goes through the projection", two vm renders); `test/read-policy-matrix.test.js` ("matrix (WR-04 a): ALL-roles routes ..."); R: 12 `CR-01` rows (employee exactly `{id,name,status}`, pmo `{id,name,targetCompany,status}`, hrbp full, none of dealSizeM / synergyTargetM / memberGrants / members / setup, select echo) |
| WR-01 DD / org clearance denials not rate-bounded | high | fixed | `5df9fea` | `test/denial-audit.test.js` ("live WR-01 (DD by-id): ... ONE dd-access-denied row; the folded count is written", "live WR-01 (org): ...", "unit WR-01: a legacy-named clearance denial ...", "structural WR-01: no DD/org clearance refusal writes its own unbounded audit row any more"); R: 9 `WR-01:` rows in `denialAuditBounded` (25 probes -> 1 row each; after the window 1 first + 1 folded row, total 25, reason `dd-clearance` / `org-clearance`) |
| WR-02 reserved `source` planted by an uncleared member; conversion adopts it | high | fixed | `9a96835` | `test/clearance-write-paths.test.js` ("(WR-02): a client-supplied reserved provenance source is refused (400) on task AND RAID create and update", "(WR-02): a record planted with a matching source (no server stamp) is never adopted"); R: `cleanRoom404` WR-02 rows (6 reserved spellings x pmo / hrbp / admin -> 400, free-text control 201, nothing planted, the conversion returns the genuine task whose title derives from the finding) |
| WR-03 restricted get-or-create honoured body role / department / company | medium | fixed | `3ba8515` | `test/get-or-create-post.test.js` ("WR-03 (Phase 11 review): the restricted lane never takes role / department / company from the body ..."); R: `WR-03:` row (forged values replaced by `Specialist` / `Operations` / the deal's target) |
| WR-04 test gaps that let CR-01 / WR-01 / WR-02 pass green | medium | fixed | `95e5ca2` (a, b), `9a96835` (c), `5df9fea` (d) | `test/read-policy-matrix.test.js` ("matrix (WR-04 a) ..."), `test/no-get-mutates.test.js` ("no GET mutates (WR-04 b): every registered GET route as pmo AND employee, real deal and demo store ..."), the WR-02 and WR-01 tests above |
| IN-01 restricted task ids echoed through `GET /api/synergies` | low | fixed | `2098b73` | `test/clearance-write-paths.test.js` ("(IN-01): GET /api/synergies and the synergies export drop restricted task ids ..."); R: `IN-01:` rows (IL and cleared member see the id, the uncleared pmo does not) |
| IN-02 pulse `employeeName` free text | low | fixed | `feed9c9` | `test/personal-data-reads.test.js` ("IN-02: in a real deal POST /api/pulses files the pulse under the author's account name ..."); R: `IN-02:` row; soak harness adapted (deviation 4) |
| IN-03 setup write committed before its audit event | low | **accepted** with reason (target Phase 20) | `d818d7f` | DEPLOYMENT.md "Known limitations"; no code change (a plain overwrite of the same values; the central 503 + the client's silent retry re-applies it and writes the event) |
| IN-04 exact write rule + trailing slash answered 500 | low | fixed | `72e0616` | `test/get-or-create-post.test.js` ("IN-04 (Phase 11 review): a trailing-slash spelling behaves exactly like the canonical path; other variants answer 404, never a 500 diagnostic"); R: two `IN-04:` rows |
| IN-05 stale policy rationale; `day1Date` format | low | fixed (rationale already reworded by 11-07) | `dd0b316` | `test/deal-settings-setup.test.js` ("IN-05 (Phase 11 review): BOTH day1Date fields ... take an ISO YYYY-MM-DD date or empty, nothing else"); R: 2 `IN-05:` rows (`not-a-date`, `2026-13-45` -> 400) |

### Part B: client side (FIXER C)

| Finding | Sev | Disposition | Commit | Test (name) and evidence |
|---|---|---|---|---|
| WR-C01 page gate bypassed by path-based role + ungated staff loaders | high | fixed (reachability changes need a human confirmation, see "Open items") | `104a75e` | `test/client-authz-hiding.test.js` ("WR-C01 (vm): the page gate uses the SERVER-VERIFIED role ...", "(vm) the roles a page is for keep it", "(vm) a returning browser with a verified role is gated synchronously", "(vm) demo-open keeps the path-derived personas", loader rows for admin.js, admin-cms.js, pmo.js, execution.js); R: `employee opens /admin.html | /pmo.html | /due-diligence.html | /org.html | /dashboard.html | /supporting.html | /execution.html` and `pmo opens /admin.html` -> sent home, 0 refused; `hrbp opens /employee.html | /pmo.html | /supporting.html` -> sent home; D: `karen` / `pmo` sent-home rows |
| WR-C02 helpdesk ticket shows "Inquiry Received!" after a 403 | high | fixed (the real employee helpdesk channel is **deferred to Phase 22**) | `cb68e20` | `test/client-authz-hiding.test.js` ("WR-C02 (server): `helpdesk` follows the write table ...", "(vm) a refused / failed ticket never shows \"Inquiry Received!\" ...", "(vm) the helpdesk card is hidden ...", "(source) the submit handler is wired to submitHelpdeskTicket ..."); R: 3 `WR-C02:` rows (card hidden, no `/api/communications` request on load, forced ticket 403 and no success message) |
| WR-C03 `assessments.html` 3 refused instance requests per load | medium | fixed | `b36ce5e` | `test/client-authz-hiding.test.js` ("WR-C03 (server): `assessmentInstances` mirrors the admin-only read rule ...", "WR-C03 (vm): assessments.js does not request the instance list for a role refused it ..."); R: 6 `WR-C03:` rows (hrbp and pmo: stays, no instance request, 0 refused) |
| WR-C04 due-diligence / org pages ungated | medium | fixed | `104a75e` | `test/client-authz-hiding.test.js` ("WR-C04 (vm): due-diligence.html and org.html are gated on the dd / org capability, not a role", "(vm) due-diligence.js and org.js send no request ...", "(source) the two stale IN-02 ... justifications are gone"); R: employee sent home from both, pmo and hrbp stay, 0 refused |
| WR-C05 `dashboard.js` changed without a `?v=` bump; guard did not track it | medium | fixed | `d2f3b25` | `test/asset-cache-bust.test.js` (frozen table extended to every Phase-11 client file; `dashboard.js` stamp `1791800101`) |
| WR-C06 suite could not detect a client/server capability-key drift | medium | fixed | `3b96d69` | `test/client-authz-hiding.test.js` ("WR-C06: every capability key the client asks about is a key the server actually serves on /api/auth/me"; re-anchored `guardBefore` / `guarded` rows) |
| WR-C07 targeted communications to a real-deal employee are invisible to them | medium | fixed as a sender-side note; the employee "own messages" projection **deferred to Phase 22** | `140f8b2` | `test/client-authz-hiding.test.js` ("WR-C07 (vm): a real-deal composer shows \"Employees can't read in-app messages yet.\" once ...", "(source) the three recipient pickers ... carry the note"); R: `WR-C07:` rows for the PMO desk and the admin dispatcher; observation F-R1 (the IL dashboard call site is not reached in a real deal) |
| IN-C01 Day pill offered in real deals | low | fixed | `0b3e068` | `test/client-authz-hiding.test.js` ("IN-C01 (server): `timeTravel` is true only on the demo store for a role the write table lists ...", "(vm) maHideUnless ...", "(source) the Day pill is gated right where it is mounted ..."); R: `the Day pill (time machine) is not offered in a real deal` on every landing page at both widths, no time-travel POST; D: the pill is still offered on the showcase dashboard (admin, karen, pmo, anon) |
| IN-C02 `signage.html` 403s and throws for an employee | low | fixed | `75bfc24` | `test/client-authz-hiding.test.js` ("IN-C02 (vm): signage does not request the roster when the map refuses it ...", "(vm) a refused or non-array roster body is never iterated", "(vm) demo-open loads ..."); R: `employee opens /signage.html` stays, 0 refused, no page error |
| IN-C03 flash before the config controls hide | low | fixed for the rail tabs; header-pill residual **deferred to Phase 15** | `6df61b5` | `test/client-authz-hiding.test.js` ("IN-C03 (source) ...", "IN-C03 (vm) the hidden-by-default tabs are revealed for configWrite ..."); R: `IN-C03:` rows (hrbp 0 of 8 visible, admin 8 of 8); `p11-hrbp-admin-*.jpg` |
| IN-C04 logged-in demo store hides config controls from hrbp / pmo | low | documented, no code (by decision D-11-02) | none | D: access-map rows (`configWrite` admin only, `timeTravel` true, reads true), `p11-dev-karen-dashboard-1440.jpg`, `p11-dev-pmo-pmo-1440.jpg` |
| IN-C05 `?empId=` binding change on the welcome link | low | accepted (reviewer judgement stands) | none | `11-REVIEW-FIX-C.md`; R: `acceptance 4/5: employee POST get-or-create resolves ONLY its own account-derived record` |
| IN-C06 academy lesson checkboxes POST a demo-only route | low | **deferred to Phase 15** (module switch) | none | not reachable in a fresh real deal (no courses) |
| IN-C07 demo-open `admin.html` redirects to `/login.html` (401 on `GET /api/deals`) | low | **deferred to CERT-03 / Phase 20** (pre-existing, demo-lane presentation decision) | none | D: the one 401 the scenario treats as the redirect mechanism, identical on `13a6da0` |

## Open items

- **Reachability changes needing the user's confirmation (WR-C01, from FIXER C).** Because the page gate
  now uses the verified role, these pages are no longer reachable by URL: the Integration Leader (`hrbp`)
  from `employee.html`, `pmo.html`, `supporting.html`; an `employee` from `dashboard.html`,
  `supporting.html` (and every staff page); a `pmo` from `admin.html`. They match the sidebar each role
  already gets; the change does not touch the open demonstration (demo personas always pass). Reversing
  any one is a one-line `pageAccess` edit in `public/js/transitions.js`. Asserted as the intended contract
  in `phase11-real.log` and `phase11-demo.log`.
- **F-1 / F-2 / F-3 / F-4 (found by the first real-lane walk): resolved** by WR-C01 / WR-C04 (`104a75e`)
  and WR-C02 (`cb68e20`); the matching `OBSERVATION` rows are now assertions. The employee helpdesk is
  honest (no false success) but still has no working channel: Phase 22.
- **F-5 (pre-existing, Phase 12 scope):** every write audits every row of each collection it touches, so
  `audit.db` grows quadratically under load; the default soak cannot run on a small disk. Unchanged by the
  review fixes (store and audit hook are byte-identical to the pre-review tree). The capped parameters are
  required until Phase 12.
- **F-6 (info):** demo copy shows in real-deal portals ("NEXTGEN SENSORS INTEGRATION", the persona line, a
  "DEMO" badge on the admin Projects page). Later UI phase.
- **F-R1 (info, no user impact):** the `window.maAddEmployeeInboxNote` call in `dashboard.js` sits inside
  `initDemoDashboard()`, which a deal-bound session never runs, so the IL has no in-app composer on the
  dashboard in a real deal and the sender-side note is dead code there. The two reachable composers (PMO
  desk, admin dispatcher) carry it. Phase 22 builds the real messaging surface.
- **F-R2 (info):** the employee sidebar still lists "Admin Console" (and the showcase links); following
  it now sends the employee home with the access-denied message instead of loading a page of 403s.
  Hiding the link per role belongs with the Phase 15 module switch.
- **F-R3 (deferred, FIXER S observation):** `targetCompany`, withheld from the employee deal record, is
  still part of the public settings allowlist and the shell header: a product call for Phase 17.
- **Visual judgement:** layout after hidden cards/tabs (11-07 coverage, `human_judgment`) is evidenced by
  screenshots an agent viewed (`p11-hrbp-admin-1440.jpg`, `p11-employee-*`, the two dev non-admin shots);
  a human eye remains the verifier's call.
