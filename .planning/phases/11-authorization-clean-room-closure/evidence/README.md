# Phase 11 evidence (plan 11-08, refreshed after the Phase 11 review fixes)

Everything here is reproducible from `scripts/uat/phase10-walk.js` (scenario module
`scripts/uat/phase10-scenarios/authz-phase11.js`), `scripts/uat/phase9-walk.js` and
`scripts/soak.js`. All data is synthetic (accounts `p11.*`, a deal named "Phase 11
evidence deal"); no credential is logged or typed before a screenshot. The runner
sha256-guards the committed `data/demo.db` / `data/control.db` (+ `-wal`) and
`git status --porcelain -- data` around every run: both unchanged in every log below.

**This directory describes the tree AFTER the review fixes** (11-REVIEW.md fixed by
11-REVIEW-FIX-S.md, 11-REVIEW-CLIENT.md fixed by 11-REVIEW-FIX-C.md). The first
evidence pass (plan 11-08, commits `c55db97`..`0efd135`) described the tree before them;
`11-08-REFRESH-SUMMARY.md` lists what changed between the two passes.

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

The runner writes `walk.log` + `results.json` into `--out` on every run; the logs here
were renamed by hand and `results.json` was dropped (the log carries the same rows).
Screenshots are JPEG q28 (the Phase 10 runner shot is q60; the evidence cap is 1200 KB
for the whole directory). Every page is CHECKED at 1440 and 390 whether or not it is
shot (the shot lists below say which). The soak is run with the parameters above, NOT its
defaults: the default rate fills this host's disk (11-08-SUMMARY.md F-5).

## Logs

| File | What it proves | Result |
|---|---|---|
| `phase11-real.log` | real lane: `authzRoleMatrix`, `cleanRoom404`, `denialAuditBounded` | 284 PASS / 0 FAIL |
| `phase11-demo.log` | dev + demo-open lanes: `demoShowcaseUnchanged` | 195 PASS / 0 FAIL |
| `phase10-walk.log` | the FULL Phase 10 runner, all six lanes, with the Phase 11 scenarios plugged in; the Phase 10 scenarios are unchanged | 655 PASS / 0 FAIL |
| `phase9-walk.log` | `node scripts/uat/phase9-walk.js` | 350 PASS / 0 FAIL |
| `phase9-walk-demo-open.log` | `node scripts/uat/phase9-walk.js --demo-open` | 18 PASS / 0 FAIL |
| `soak.log` | `SOAK_DURATION_MS=60000 SOAK_WRITE_INTERVAL_MS=250 npm run soak` (3 processes; see the note at its top) | PASS: 2226 acknowledged, 0 lost, audit 1:1, 1 bounded 503, 0 committed-but-unaudited; conflict lane 199 acked / 413 409s, version reconciles exactly |
| `prefix-sensitivity.log` | the SAME scenario module run against the Phase 11 head before the review fixes (`d927233`): the rows that go red | 93 FAIL / 396 PASS there; 0 FAIL on this tree |

(Before the refresh: 154 / 193 / 523 / 350 / 18 and a 120 s soak with 2901 acknowledged writes.)

### The new rows are sensitive: pre-fix tree vs this tree

`prefix-sensitivity.log` is the current `authz-phase11.js`, byte for byte, run in real +
dev + demo-open lanes against an archive of `d927233` (the head before FIXER S and FIXER C).
It goes red on 93 rows, one cluster per review finding: CR-01 (the employee and the pmo
read the full deal record, the target company and the deal size), WR-01 (25 DD / org
probes write 25 audit rows each), WR-02 (reserved sources are created `201`, and the
conversion returns the planted task), WR-03 / IN-02 / IN-04 / IN-05, WR-C01 and WR-C04
(the role is sent nowhere, six refused responses on `admin.html`), WR-C02 (success shown
after a 403), WR-C03 (3 refused instance requests), IN-C01 (the Day pill is offered),
IN-C02 (signage 403), IN-C03 (no hidden-by-default rail tabs), WR-C07 and the dev-lane
access-map and sent-home rows. The same module on this tree: 0 FAIL.

### Demo showcase unchanged: measured against the pre-Phase-11 tree

The PREVIOUS `demoShowcaseUnchanged` (the module as committed at `e6a5021`) was run,
byte-identical, against an archive of `13a6da0` (the last Phase 10 commit, before any
Phase 11 code) and against this tree, and the two result sets were compared step by step
(the two runs are not kept; the numbers are reproducible with the commands above and the
old module from git history):

| | pre-Phase-11 (`13a6da0`) | this tree |
|---|---|---|
| steps | 193 PASS / 0 FAIL | 185 PASS / 3 FAIL (the 3 intended changes below) |

188 steps are on both sides. **5 steps exist only on the pre-Phase-11 side**: the page
content checks of the three pages a verified role is now sent home from. **3 steps differ
in status**, all `stays on the page` and all the intended review change WR-C01: `karen`
(Integration Leader) on `/employee.html` and `/pmo.html`, `pmo` on `/admin.html` are sent
home to `/` (their verified role is not on that page's access list). **13 steps differ
only in detail**: 3 are `GET /api/settings` returning 24 allowlisted keys instead of 26
(11-02, the secret-bearing `databaseConfig` and key flag are withheld), 10 are rendered
page-text lengths: 16 characters shorter for non-admin sessions (the "Edit Content" toggle,
11-07), 128 shorter on `/admin.html` for `karen` (configuration cards hidden) and 28
shorter on `/pmo.html` for `pmo` (the demo-mode switcher, IN-C04). The committed module
now asserts these as the new contract (rows `... is sent home (/) (WR-C01, intended)` and
the `/api/auth/me` access-map rows). The anonymous demo-open lane shows no difference
except the settings key count. One observation is common to both trees: a cookie-less
visit to `/admin.html` in demo-open makes one `GET /api/deals` that answers 401 on its
way to `/login.html` (the Phase 10 contract, finding IN-C07, deferred to CERT-03); the
scenario treats that single 401 as the redirect mechanism for that one page only.

## What changed in the scenario module since the first pass

Behaviour that changed legitimately because of the review fixes is asserted as the NEW
correct behaviour (nothing was loosened; the Phase 10 scenarios and the Phase 9 walk are
untouched and pass unchanged):

| Was (first pass) | Now (assertion) | Finding |
|---|---|---|
| `OBSERVATION`: employee opens `/admin.html` -> 6 refused responses | the employee is sent home (`/`), 0 refused responses; same for `/pmo.html`, `/due-diligence.html`, `/org.html`, `/dashboard.html`, `/supporting.html`, `/execution.html` | WR-C01, WR-C04 |
| `OBSERVATION`: pmo opens `/admin.html` -> `GET /api/hrbps` 403 | the pmo is sent home, 0 refused; `pmo.html`, `execution.html`, `due-diligence.html`, `org.html` stay, 0 refused | WR-C01 |
| (not covered) | the hrbp is sent home from `employee.html`, `pmo.html`, `supporting.html`; keeps `dashboard.html`, `admin.html`, DD, org | WR-C01 |
| `OBSERVATION`: employee helpdesk form -> 403 and "Inquiry Received" | the helpdesk card is hidden for the employee, the page load issues no `/api/communications` request, and a forced submission is refused 403 with the success message NOT shown | WR-C02 |
| (not covered) | `assessments.html` for hrbp and pmo fires no `/api/assessment-instances` request | WR-C03 |
| (not covered) | the Day pill is not offered in a real deal for any role and no `POST /api/settings/time-travel` fires (every landing page, both widths) | IN-C01 |
| `GET /api/deals` only checked for 200 | employee `{id,name,status}`, pmo `{id,name,targetCompany,status}`, hrbp full; no `dealSizeM`, `synergyTargetM`, `memberGrants`, `members`, `setup` for the two lower roles; the select echo is the same record | CR-01 |
| 20 refused reads -> 1 audit row | plus 25 DD by-id probes, 25 org decision probes, 25 flight-risk probes by an uncleared pmo -> 1 row each, and after the window 1 folded row, total 25 | WR-01 |
| `create` with any `source` | reserved sources (`dd-finding:`, `org-flightrisk:`, `template:`, `remediation:`) are 400 on task and RAID create for pmo, hrbp and admin; a planting before the conversion does not change what the conversion returns | WR-02 |
| (not covered) | forged role/department/company in `get-or-create` ignored; trailing-slash POST works; `day1Date` junk is 400; a pulse is attributed to the account name; a restricted task id is absent from `GET /api/synergies` for the uncleared pmo | WR-03, IN-04, IN-05, IN-02, IN-01 |
| (not covered) | the signage kiosk raises no 403 for an employee; the config rail tabs are hidden for hrbp and revealed for admin; the PMO desk and the admin dispatcher carry the sender-side note | IN-C02, IN-C03, WR-C07 |
| dev lane: `stays on the page` for every page | `karen` is sent home from `employee.html` / `pmo.html`, `pmo` from `admin.html`; the `/api/auth/me` access map on the demo store (`configWrite` admin only, `timeTravel` true) and the Day pill on the showcase dashboard | WR-C01, IN-C04, IN-C01 |

Rows prefixed `OBSERVATION (not an assertion)` in `phase11-real.log` are measurements
that are not contract: the employee's `GET /api/settings` still carries `targetCompany`
(a public allowlist key; the withholding is a product call deferred to Phase 17) and the
Integration Leader's `dashboard.html` in a real deal shows the deal home, so the
Communications Desk call site that would carry the WR-C07 note is not reached (finding
F-R1 in `11-08-REFRESH-SUMMARY.md`).

## Screenshots (JPEG, 1440 x 900 and 390 x 844)

| File | Scenario / lane | Shows |
|---|---|---|
| `p11-employee-employee-1440.jpg`, `-390.jpg` | `authzRoleMatrix` @ real | the employee portal for an `employee` bound to the real deal; no helpdesk card, no Day pill, 0 refused responses on load |
| `p11-pmo-pmo-1440.jpg`, `-390.jpg` | `authzRoleMatrix` @ real | the PMO console for a `pmo` (workstream lead) bound to the real deal, 0 refused responses on load, no Day pill |
| `p11-hrbp-dashboard-1440.jpg`, `-390.jpg` | `authzRoleMatrix` @ real | the leader dashboard and deal setup checklist for the Integration Leader (`hrbp`), 0 refused responses on load |
| `p11-hrbp-admin-1440.jpg`, `-390.jpg` | `authzRoleMatrix` @ real | the admin console as `hrbp`: configuration and content tabs and cards hidden from first paint (IN-C03) |
| `p11-admin-admin-1440.jpg` | `authzRoleMatrix` @ real | the admin console as `admin`, for comparison |
| `p11-cleanroom-board-cleared-1440.jpg` | `cleanRoom404` @ real | execution board (Risks and Decisions) of a `pmo` holding the `hr` grant: the converted `P11-CLEANROOM-QX7` RAID entry is shown |
| `p11-cleanroom-board-uncleared-1440.jpg` | `cleanRoom404` @ real | the same deal, a `pmo` without the grant: no such entry (task pane and RAID pane both checked) |
| `p11-dev-admin-{dashboard,employee,pmo}-1440.jpg`, `p11-dev-admin-dashboard-390.jpg`, `p11-dev-admin-admin-1440.jpg` | `demoShowcaseUnchanged` @ dev | the published demo `admin` account on the showcase pages |
| `p11-dev-karen-dashboard-1440.jpg`, `p11-dev-pmo-pmo-1440.jpg` | `demoShowcaseUnchanged` @ dev | the LOGGED-IN demo store as the non-admin published accounts (IN-C04): the Integration Leader's dashboard and the workstream lead's PMO console with the configuration controls hidden |
| `p11-demo-open-anon-dashboard-{1440,390}.jpg`, `p11-demo-open-anon-admin-1440.jpg` | `demoShowcaseUnchanged` @ demo-open | the cookie-less visitor: dashboard, and the admin console's `/login.html` landing |

The first pass also shot `p11-dev-admin-execution-1440`, `p11-dev-admin-{employee,pmo}-390`
and `p11-demo-open-anon-pmo-390`; they were dropped to stay under the 1200 KB cap after the
two non-admin dev shots were added. Those pages are still CHECKED at both widths (the
rows are in `phase11-demo.log`).

## Acceptance map

| PRD acceptance | Browser / API evidence (this directory) |
|---|---|
| 1 employee refused / served | `phase11-real.log` rows "acceptance 1: employee GET ... -> 403/200", pulses rows, the CR-01 deal-record rows; `p11-employee-*` |
| 2 config writes admin-only, deal setup route, no secret in settings | rows "acceptance 2: pmo|hrbp POST ... -> 403", "...deal-level values via the deal setup route -> 200", "...keys are a subset of the public allowlist", IN-05 bounds |
| 3 clean-room 404 | `cleanRoom404@real` rows (10 write/delete shapes on the task and the RAID entry, with version none / 0 / 999), the WR-02 planting rows, `p11-cleanroom-board-*` |
| 4 no GET mutates | row "acceptance 4: ... get-or-create" (employee POST resolves own record, GET never 200); instrumented test in `test/no-get-mutates.test.js` (admin, pmo and employee lanes) |
| 5 variant paths | rows "acceptance 5: employee GET /api/Synergies ... is never 200" (12 spellings), "pmo POST ... never 2xx" (6), IN-04 trailing slash |
| 6 rate-bounded denial audit; demo and earlier walks unchanged | `denialAuditBounded@real` (20 gate probes and 3 x 25 clearance probes -> 1 row each; after the window the folded rows account for every probe); `phase11-demo.log`, `phase10-walk.log`, `phase9-walk*.log`, `soak.log` |
