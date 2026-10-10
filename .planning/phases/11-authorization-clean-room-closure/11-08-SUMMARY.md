---
phase: 11-authorization-clean-room-closure
plan: 08
subsystem: testing
tags: [authorization, evidence, playwright, uat-runner, clean-room, denial-audit, deployment-docs, drift-test, soak]

requires:
  - phase: 11-authorization-clean-room-closure (11-01..11-07)
    provides: "read policy, admin-only config, clearance 404, denial audit, personal-data reads, POST get-or-create, client capability hiding"
provides:
  - "scripts/uat/phase10-scenarios/authz-phase11.js: authzRoleMatrix, cleanRoom404, denialAuditBounded (real lane) and demoShowcaseUnchanged (dev, demo-open) plugged into the Phase 10 runner"
  - "evidence/: 23 screenshots (1440 / 390) + phase11-real/demo, phase10-walk, phase9-walk(-demo-open), soak logs + README mapping, 1108 KB"
  - "DEPLOYMENT.md 'Roles and what they can read' (read table, admin-only writes, deal setup bounds, personal data, clearance 404, hidden controls, denial-audit bound)"
  - "test/deployment-role-matrix.test.js: doc == lib/readPolicy.js row for row; write table vs the live gate; setup bounds vs the schema"
  - "11-VALIDATION.md: PRD acceptance 1-6, ROADMAP SC1-4, AUTHZ-01..05, D-11-01..07 each mapped to a test name or evidence file"
affects: [phase-11-verification, phase-12 (audit amplification), phase-13, phase-15]

requirements-completed: [AUTHZ-01, AUTHZ-02, AUTHZ-03, AUTHZ-04, AUTHZ-05]

actuals:
  tokens: 19000   # chars/4 over the realized diff (scenario module, test, DEPLOYMENT.md section, VALIDATION, README)
  tasks: 3
  commits: 4      # c55db97, c16f612, 0efd135 + this summary

key-files:
  created:
    - scripts/uat/phase10-scenarios/authz-phase11.js
    - test/deployment-role-matrix.test.js
    - .planning/phases/11-authorization-clean-room-closure/11-VALIDATION.md
    - .planning/phases/11-authorization-clean-room-closure/evidence/
  modified:
    - DEPLOYMENT.md

key-decisions:
  - "Scenarios assert statuses, body fields and visible strings; the only table they read is the declared PUBLIC_SETTINGS_KEYS allowlist, so they stay valid after review fixes"
  - "Demo lanes proven 'unchanged' by running the same scenario on a git archive of 13a6da0 and diffing step by step, not just by a green run"
  - "Navigation targets outside the landing-page contract are recorded as OBSERVATION rows (not red checks) and quoted as findings"
  - "Soak run at SOAK_WRITE_INTERVAL_MS=250 because the default rate fills the host disk via the pre-existing audit amplification"

duration: ~2h
completed: 2026-10-10
status: complete
---

# Phase 11 Plan 08: Authorization evidence, role matrix documentation and sign-off Summary

**Phase 11 is proven in real Chromium sessions: an `employee`, `pmo`, `hrbp` and `admin` each load their pages in a real deal with no refused request, an uncleared member gets a byte-identical 404 on ten task/RAID write shapes while the cleared member's board shows the record, 20 denial probes write one audit row and fold to a total of 20, the showcase renders step-for-step like the pre-Phase-11 tree, and DEPLOYMENT.md's role table is held to `lib/readPolicy.js` by a drift test.**

## Performance

- **Duration:** ~2 h (incl. a disk-full incident, see below)
- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 auto)
- **Commits:** `c55db97`, `c16f612`, `0efd135`
- **Final full suite:** `node --test` -> **1187 tests, 1187 pass, 0 fail** (1181 at the plan base + 6 new)

## Accomplishments

- **Real lane (`phase11-real.log`, 154 PASS / 0 FAIL).** `authzRoleMatrix`: acceptance 1 (8 refused GETs, 3 served GETs, pulses own-only for the employee, no named data for pmo, named for hrbp), acceptance 2 (7 config POSTs x 2 roles -> 403, allowlisted settings subset per role, hrbp edits deal-level values through `POST /api/deals/:id/setup` and the rollup reports them, pmo refused), acceptance 4 live (employee `POST get-or-create` resolves only an `emp_acct_` record, the GET form is never 200), acceptance 5 (12 GET and 6 POST spellings, never 200 / never 2xx), and the page-load network log + screenshots for employee, pmo, hrbp and admin landing pages at 1440 and 390 (no 401/403/5xx, no page error, no bounce).
- **Clean room (`cleanRoom404`).** hrbp files an `hr` DD finding and converts it (idempotent). The uncleared `pmo` gets `404 {"error":"Not found"}`, identical to a missing id, on POST status flip / stale `version: 999` / `version: 0`, DELETE with no version / `expectedVersion=999`, for both the task and the RAID entry; the lists omit both; the cleared member (`hr` grant) reads both; the IL record is unchanged afterwards; the two execution boards differ exactly as they should (shots `p11-cleanroom-board-cleared/uncleared-1440.jpg`).
- **Bounded denial audit (`denialAuditBounded`, amendment 6).** A fresh account and a fresh route: 20 refused reads wrote exactly one `access-denied` row (`role-read`, count 1); after the 60 s window a later denial flushed one folded row (count 19, 62 s later) - total 20 = probes, never more than one row per window.
- **Demo lanes (`phase11-demo.log`, 193 / 0).** The published demo accounts (dev) and the anonymous visitor (demo-open) load the six showcase pages at both widths with no 401/403/5xx and no page error; target company name and welcome-video section present. Run against a `git archive` of `13a6da0` as well: 193 steps on each side, none only on one side, no status difference; the 17 detail differences are exactly the intended 11-02 (24 vs 26 settings keys for non-admins) and 11-07 (16 / 128 chars of hidden controls) changes.
- **Regression walks.** Phase 10 runner, all six lanes: **523 PASS / 0 FAIL** (exit 0, committed DB sha256 and `git status -- data` unchanged); Phase 9 walk **350 / 0**, `--demo-open` **18 / 0**; soak **PASS** (2901 acknowledged, 0 lost/mismatched, audit 1:1, 17 bounded 503, 0 committed-but-unaudited, integrity ok, conflict lane 278 acked / 583 409s version reconciles exactly).
- **DEPLOYMENT.md "Roles and what they can read".** 38 read rows in rule order, admin-only write list, deal-level fields and bounds, pulse/hrbps limits, clearance-404, hidden-controls table, denial-audit bound. `test/deployment-role-matrix.test.js` (6 tests) fails on a dropped, invented, widened, narrowed, reordered or policy-side-drifted row (mutation-checked on the real file).
- **11-VALIDATION.md** signed off.

## Task Commits

1. **Task 1 (tracer): real-lane scenarios + evidence** - `c55db97`
2. **Task 2: demo lanes, baseline diff, Phase 9/10 walks, soak** - `c16f612`
3. **Task 3: DEPLOYMENT.md matrix, drift test, 11-VALIDATION.md** - `0efd135`

## Findings (product, for the orchestrator to route; no product code edited)

| # | Severity | Finding | Repro | Suggested fix |
|---|----------|---------|-------|---------------|
| F-1 | medium (UX, no data shown) | An `employee` follows the always-visible sidebar **Admin Console** link, `admin.html` loads its shell and the page load raises six refused responses: `GET /api/assessments`, `/api/employees`, `/api/hrbps`, `/api/communications`, `/api/projects`, `/api/processes` (all 403) | `authzRoleMatrix` @ real, row `OBSERVATION: employee opens /admin.html`; or sign in as an employee of a real deal and open `/admin.html` | page-level gate on `admin.html` for non-staff roles (or hide the link from `employee`), and gate each loader in `admin.js` on `window.maCanReady(...)` |
| F-2 | low | A `pmo` on `admin.html` raises `GET /api/hrbps` -> 403 (admin.js loads the leader directory without the 11-07 `maCan('hrbps')` guard) | row `OBSERVATION: pmo opens /admin.html` | wait on `maCanReady('hrbps')` before the directory fetch |
| F-3 | low | An `employee` opening `due-diligence.html` raises 3 refused responses (`/api/dd/areas`, `/api/dd/vdr-links`, `/api/dd/summary`) and `org.html` 3 (`/api/org/positions`, `/api/employees`, `/api/org/capabilities`); already flagged by 11-07 | rows `OBSERVATION: employee opens /due-diligence.html` and `/org.html` | page-level role gate or `maCan('dd'|'org')` guards on both pages |
| F-4 | medium (pre-existing) | The employee HR helpdesk form posts to `/api/communications/send`, which the write policy has never allowed for `employee`; the 403 is followed by the page's success message (`.finally`), a false "ticket filed" | row `OBSERVATION: employee helpdesk form` -> `{"status":403,"successMessageShown":true}` | decide: add a self-service allowlist entry for `employee` on that route, or remove / re-wire the form and show the failure |
| F-5 | high for shared host (pre-existing, Phase 12 scope) | Every write audits **every row** of each collection it touches (`db/store.js` writes an `update` delta for all rows in the snapshot, changed or not): O(N) audit rows per write, O(N^2) overall. `npm run soak` at its default rate produced a 5.5 GB `audit.db` (6 783 708 rows: 6 722 789 `update` on `pulses` for 3 474 inserts) in ~90 s and died with `SQLITE_FULL` | `node` harness: POST `/api/pulses` x8 as a bound admin -> audit rows +1, +2, ... +8 per write; identical on `13a6da0`; or `npm run soak` with ~6 GB free | write a delta only for rows whose serialized content changed (the versioned branch already knows this: `candidate !== priorRaw`) |
| F-6 | info (out of Phase 11 scope) | Demo copy shows in real-deal portals: the employee page greets "NEXTGEN SENSORS INTEGRATION" / persona "Alex - Legacy Acquired Cohort"; the admin Projects page carries a "DEMO" badge | `p11-employee-employee-1440.jpg`, `p11-hrbp-admin-1440.jpg` | later UI phase |

No new `403` is raised by any control on the role landing pages in the plan's list (employee.html, pmo.html, dashboard.html for hrbp, admin.html for hrbp and admin, execution.html for pmo and for the cleared member): that is what the real-lane rows assert, and it holds.

## Deviations from Plan

### Judgment calls

**1. [Tracer gate] No interactive human-verify checkpoint after Task 1.** Per the dispatch's policy the tracer's automated `<verify>` was re-run end to end (all three real-lane scenarios, 154 / 0) and expansion continued.

**2. [Evidence cap] Phase 10 runner output kept as a log only; screenshots q28 and subsampled.** The plan says to run the full Phase 10 runner with `--out evidence/`; that alone writes ~1.1 MB of screenshots, so the cap (1200 KB) is met by running it into a scratch directory and committing `phase10-walk.log`. Screenshots use JPEG q28 (own `snap()` in the module; the runner's `ctx.shot` is q60). Every page is checked at both widths; the README lists which are shot. Evidence is 1108 KB (`du -sk`).

**3. [Soak] Lighter write rate.** The default soak could not run on this host (F-5, disk). The recorded verdict is the same script with `SOAK_PROCESSES=3 SOAK_DURATION_MS=120000 SOAK_WRITE_INTERVAL_MS=250` (the D-14 knobs). A 60 s smoke at the same interval passed first (2044 acknowledged, 0 lost). `soak.log` carries the explanation at its top.

**4. [Logs are gitignored] `*.log` is in `.gitignore`.** The evidence logs were force-added (`git add -f`), as `phase10-walk.log` was in Phase 10.

### Auto-fixed issues

**5. [Rule 1 - scenario assertion] Version precondition on convert.** The first `cleanRoom404` run got `400 versionRequired` from `POST /api/dd/findings/:id/convert`: Phase 9 requires the record's version on every by-id write (a never-edited record is version 0). The scenario now sends `version` (read from the finding, 0 when absent). Product behaviour was correct.

**6. [Rule 1 - scenario assertion] Anonymous `/admin.html` in demo-open.** The first demo run flagged `GET /api/deals 401` on the cookie-less admin console. That 401 is the redirect mechanism to `/login.html` (the Phase 10 contract) and is identical on the pre-Phase-11 tree, so for that one page only a 403 counts as a refusal.

### Incident (environment, no repo impact)

The default soak crashed the host disk (F-5). Its three orphaned server children and a 5.1 GB scratch `audit.db` were found and removed (`kill` of the three PIDs started from this worktree, `rm -rf` of the scratch dir under the OS temp directory); nothing outside this worktree's own processes and temp files was touched.

## Known Stubs

None.

## Threat Flags

None. No product file was edited; the new module only reads and drives existing endpoints against isolated `MA_*` temp paths (T-11-70 guard green in every log: committed `data/demo.db` + `data/control.db` (+ `-wal`) sha256 unchanged, `git status --porcelain data/ public/sent_emails` empty). Evidence is synthetic (T-11-71): no credential, e-mail address or secret appears in any log (`grep` clean) and no password was typed before a screenshot.

## Threat model status

| Threat | Disposition | Status |
|--------|-------------|--------|
| T-11-70 committed DBs modified by walks | mitigate | runner sha256 guard + `git status -- data` in every run; temp copies only; empty after the soak and the unit suite |
| T-11-71 credentials / MNPI in evidence | mitigate | synthetic deal and accounts; passwords only in local variables; log grep for `Rot-`, `TEdemo`, `tempPassword`, e-mail domains is empty |
| T-11-72 Playwright supply chain | accept | pre-existing npx cache, nothing installed |

## Notes for the orchestrator

- **Re-run after review fixes.** `evidence/README.md` has the exact commands. Real lane ~3 min (it waits one 60 s audit window), demo lanes ~2 min, full Phase 10 runner ~12 min. Update the counts in the `11-VALIDATION.md` frontmatter afterwards.
- **WINDOWS.md ledger not appended** from this worktree (sibling worktrees share the file): F-1 to F-4 are the entries to fold in (`kind: deviation`), F-5 belongs to Phase 12.
- **The test file `test/deployment-role-matrix.test.js` requires `server.js`** (to read `roleAllowedForWrite`) with every `MA_*` path in a temp dir, so `test/denial-audit.test.js`'s "every server-loading suite isolates the audit db" guard stays green.
- `demoShowcaseUnchanged` lives in the same module and was committed with Task 1 (`c55db97`); it was first run in Task 2.

## Self-Check: PASSED

- FOUND: scripts/uat/phase10-scenarios/authz-phase11.js, test/deployment-role-matrix.test.js, 11-VALIDATION.md, evidence/README.md + 23 screenshots + 6 logs, DEPLOYMENT.md section
- FOUND commits: `c55db97`, `c16f612`, `0efd135`
- `node --test`: 1187 / 1187; `node --test test/deployment-role-matrix.test.js`: 6 / 6
- `du -sk evidence` = 1108 (<= 1200); `git status --porcelain data/ public/sent_emails` empty; no STATE.md / ROADMAP.md changes
