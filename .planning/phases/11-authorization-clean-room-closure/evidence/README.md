# Phase 11 evidence (plan 11-08)

Everything here is reproducible from `scripts/uat/phase10-walk.js` (scenario module
`scripts/uat/phase10-scenarios/authz-phase11.js`), `scripts/uat/phase9-walk.js` and
`scripts/soak.js`. All data is synthetic (accounts `p11.*`, a deal named "Phase 11
evidence deal"); no credential is logged or typed before a screenshot. The runner
sha256-guards the committed `data/demo.db` / `data/control.db` (+ `-wal`) and
`git status --porcelain -- data` around every run: both unchanged in every log below.

Regenerate (nothing is installed; Playwright comes from the pre-existing npx cache):

```
export PLAYWRIGHT_PATH=/Users/karstenhaldan/.npm/_npx/e41f203b7505f1fb/node_modules/playwright
E=.planning/phases/11-authorization-clean-room-closure/evidence
node scripts/uat/phase10-walk.js --scenario authzRoleMatrix --scenario cleanRoom404 --scenario denialAuditBounded --lane real --out $E   # walk.log -> phase11-real.log
node scripts/uat/phase10-walk.js --scenario demoShowcaseUnchanged --out $E                                                              # walk.log -> phase11-demo.log
node scripts/uat/phase10-walk.js --out <scratch dir>                                                                                    # every lane; log -> phase10-walk.log
node scripts/uat/phase9-walk.js --out <scratch dir>   and   --demo-open                                                                 # -> phase9-walk*.log
SOAK_DURATION_MS=60000 SOAK_WRITE_INTERVAL_MS=250 npm run soak                                                                          # -> soak.log
```

The soak line uses a 60 s run at a 250 ms write interval on purpose: this host's disk is nearly full and each acknowledged write is amplified in the audit file (the default 120 s / 100 ms run writes about 5 GB); Phase 12 DATA-01 removes the amplification.

The runner writes `walk.log` + `results.json` into `--out` on every run; the logs here
were renamed by hand and `results.json` was dropped (the log carries the same rows).
Screenshots are JPEG q28 (the Phase 10 runner shot is q60; the evidence cap is 1200 KB
for the whole directory and ~40 page shots do not fit at q60). Every page is CHECKED at
1440 and 390 whether or not it is shot (the shot lists below say which).

## Logs

| File | What it proves | Result |
|---|---|---|
| `phase11-real.log` | real lane: `authzRoleMatrix`, `cleanRoom404`, `denialAuditBounded` | 154 PASS / 0 FAIL |
| `phase11-demo.log` | dev + demo-open lanes: `demoShowcaseUnchanged` | 193 PASS / 0 FAIL |
| `phase10-walk.log` | the FULL Phase 10 runner, all six lanes, with the Phase 11 scenarios plugged in; the Phase 10 scenarios are unchanged | 523 PASS / 0 FAIL |
| `phase9-walk.log` | `node scripts/uat/phase9-walk.js` | 350 PASS / 0 FAIL |
| `phase9-walk-demo-open.log` | `node scripts/uat/phase9-walk.js --demo-open` | 18 PASS / 0 FAIL |
| `soak.log` | `npm run soak` (see the note at its top: lighter write rate, the default rate fills this host's disk) | PASS: 2901 acknowledged, 0 lost, audit 1:1, 17 bounded 503, 0 committed-but-unaudited |

### Demo showcase unchanged: measured against the pre-Phase-11 tree

`demoShowcaseUnchanged` was also run, byte-identical, against a `git archive` of
`13a6da0` (the last Phase 10 commit, before any Phase 11 code): 193 PASS / 0 FAIL.
Compared step by step with the run on this tree: **193 steps on each side, 0 steps
only on one side, 0 status differences.** The only detail-level differences (17
rows, all for the non-admin dev accounts and the anonymous demo-open caller) are the
intended Phase 11 changes: `GET /api/settings` returns 24 allowlisted keys instead of
26 (the secret-bearing `databaseConfig` and key flag are withheld, 11-02), and the
rendered page text of non-admin sessions is 16 characters shorter on every page and
128 characters shorter on `/admin.html` (the "Edit Content" toggle and the
configuration cards are hidden for roles that cannot write them, 11-07). One
observation is common to both trees: a cookie-less visit to `/admin.html` in
demo-open makes one `GET /api/deals` that answers 401 on its way to `/login.html`
(the Phase 10 contract); the scenario treats that single 401 as the redirect mechanism
for that one page only.

## Screenshots (JPEG, 1440 x 900 and 390 x 844)

| File | Scenario / lane | Shows |
|---|---|---|
| `p11-employee-employee-1440.jpg`, `-390.jpg` | `authzRoleMatrix` @ real | the employee portal for an `employee` bound to the real deal; the page load raises 0 refused responses (the roster and communications panels are not requested for this role, 11-07) |
| `p11-pmo-pmo-1440.jpg`, `-390.jpg` | `authzRoleMatrix` @ real | the PMO console for a `pmo` (workstream lead) bound to the real deal, 0 refused responses on load |
| `p11-hrbp-dashboard-1440.jpg`, `-390.jpg` | `authzRoleMatrix` @ real | the leader dashboard and deal setup checklist for the Integration Leader (`hrbp`), 0 refused responses on load |
| `p11-hrbp-admin-1440.jpg`, `-390.jpg` | `authzRoleMatrix` @ real | the admin console as `hrbp`: configuration and content tabs and cards hidden (11-07) |
| `p11-admin-admin-1440.jpg` | `authzRoleMatrix` @ real | the admin console as `admin`, for comparison |
| `p11-cleanroom-board-cleared-1440.jpg` | `cleanRoom404` @ real | execution board (Risks and Decisions) of a `pmo` holding the `hr` grant: the converted `P11-CLEANROOM-QX7` RAID entry is shown |
| `p11-cleanroom-board-uncleared-1440.jpg` | `cleanRoom404` @ real | the same deal, a `pmo` without the grant: no such entry (task pane and RAID pane both checked) |
| `p11-dev-admin-{dashboard,employee,pmo}-{1440,390}.jpg`, `p11-dev-admin-{execution,admin}-1440.jpg` | `demoShowcaseUnchanged` @ dev | the published demo `admin` account on the showcase pages |
| `p11-demo-open-anon-dashboard-{1440,390}.jpg`, `p11-demo-open-anon-pmo-390.jpg`, `p11-demo-open-anon-admin-1440.jpg` | `demoShowcaseUnchanged` @ demo-open | the cookie-less visitor: dashboard, PMO page, and the admin console's `/login.html` landing |

## Acceptance map

| PRD acceptance | Browser / API evidence (this directory) |
|---|---|
| 1 employee refused / served | `phase11-real.log` rows "acceptance 1: employee GET ... -> 403/200", pulses rows; `p11-employee-*` |
| 2 config writes admin-only, deal setup route, no secret in settings | rows "acceptance 2: pmo|hrbp POST ... -> 403", "...deal-level values via the deal setup route -> 200", "...keys are a subset of the public allowlist" |
| 3 clean-room 404 | `cleanRoom404@real` rows (10 write/delete shapes on the task and the RAID entry, with version none / 0 / 999), `p11-cleanroom-board-*` |
| 4 no GET mutates | row "acceptance 4: ... get-or-create" (employee POST resolves own record, GET never 200); instrumented test in `test/no-get-mutates.test.js` |
| 5 variant paths | rows "acceptance 5: employee GET /api/Synergies ... is never 200" (12 spellings), "pmo POST ... never 2xx" (6) |
| 6 rate-bounded denial audit; demo and earlier walks unchanged | `denialAuditBounded@real` (20 probes -> 1 row; after the window total count == 20, 2 rows 62 s apart); `phase11-demo.log`, `phase10-walk.log`, `phase9-walk*.log`, `soak.log` |

Rows prefixed `OBSERVATION (not an assertion)` in `phase11-real.log` are measurements of
navigation targets outside Phase 11's landing-page contract; they are quoted as findings
F-1 to F-4 in `11-08-SUMMARY.md` (F-1/F-2: admin console, F-3: due-diligence and org pages,
F-4: the employee helpdesk form).
