---
phase: 10-accounts-identity
plan: 08
subsystem: ops
tags: [launchers, deployment-docs, real-deal-mode, bootstrap-admin, trust-proxy, hsts, dependency-gate, mnpi]

requires:
  - phase: 10-accounts-identity
    provides: "10-01: MA_MODE=real contract, bootstrap-admin, accountsWritable; 10-03: Users CRUD API; 10-04: 0600/0700 files; 10-05: forced rotation, throttle, Secure cookie, HSTS opt-in, credential lockdown"
provides:
  - "start-real-deal.command / .bat export MA_MODE=real before launching node and point first-run operators at scripts/bootstrap-admin.js"
  - "DEPLOYMENT.md rewritten for the three modes, real-deal first run, credential lockdown, proxy/TLS contract, sign-in lockout recovery, files at rest, ADMIN_TOKEN as discouraged break-glass"
  - "README.md three-modes paragraph replacing the stale db.json / ADMIN_TOKEN notes"
  - "test/launcher-mode.test.js: launcher ordering + doc-vs-code agreement"
  - "DEFERRED-REL-02 record for the compression@1.8.2 bump (gate was too-new)"
affects: [10-09, phase-21, REL-02]

actuals:
  tokens: 7000
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "package-legitimacy gate evaluated as a branch (BUMP on OK, recorded DEFER otherwise) — never a halt, never bypassed"
    - "doc/launcher contract tests read the shipped files and cross-check env names against server.js / scripts"

key-files:
  created:
    - test/launcher-mode.test.js
  modified:
    - start-real-deal.command
    - start-real-deal.bat
    - DEPLOYMENT.md
    - README.md

key-decisions:
  - "compression bump DEFERRED (DEFERRED-REL-02): gate verdict SUS/too-new until 2026-10-11T11:17Z; package.json, package-lock.json and node_modules untouched"
  - "DEPLOYMENT.md names ADMIN_PASSWORD (the variable scripts/set-admin-password.js actually reads), not an invented MA_ADMIN_PASSWORD"
  - "Known-limitations section records the open compression advisory so operators are not told the tree is patched"

patterns-established:
  - "Launcher contract is asserted on executable lines only (comments stripped) and on ordering: MA_MODE=real must precede the node launch"

requirements-completed: [ACCT-02, ACCT-03, ACCT-05]

coverage:
  - id: D1
    description: "PRD acceptance 5 (dependency): gate not met -> compression untouched, DEFERRED-REL-02 recorded with verdict, gate date and follow-up owner"
    requirement: ACCT-05
    verification:
      - kind: command
        ref: "gsd-tools package-legitimacy check compression --ecosystem npm (SUS, too-new); git status --porcelain -- package.json package-lock.json node_modules empty"
        status: pass
    human_judgment: false
  - id: D2
    description: "Real-deal launchers export MA_MODE=real before node and tell first-run operators to run bootstrap-admin; demo launchers unchanged"
    requirement: ACCT-02
    verification:
      - kind: unit
        ref: "test/launcher-mode.test.js (launchers x3)"
        status: pass
    human_judgment: false
  - id: D3
    description: "DEPLOYMENT.md / README state the three modes and every operator contract item, with env names and flags cross-checked against the code"
    requirement: ACCT-03
    verification:
      - kind: unit
        ref: "test/launcher-mode.test.js (DEPLOYMENT.md x2, README)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Prose adequacy: operator documentation reads correctly and the Admin console 'Users' tab label matches what plan 10-07 ships"
    requirement: ACCT-03
    human_judgment: true
    rationale: "Wording quality and the 10-07 tab label cannot be asserted by a test in this wave (10-07 is a parallel worktree); verifier/UAT should read the doc against the merged UI"

duration: 25min
completed: 2026-10-10
status: complete
---

# Phase 10 Plan 08: Launchers, deployment docs and the compression bump Summary

**The real-deal launchers now export `MA_MODE=real` and send first-run operators to `scripts/bootstrap-admin.js`, DEPLOYMENT.md and README describe the demo / dev / real-deal modes and the proxy, lockdown and recovery contracts exactly as the server implements them, and the compression 1.8.2 bump is a recorded DEFERRED-REL-02 because the package-legitimacy gate reports `too-new` until 2026-10-11T11:17Z.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-10-10
- **Tasks:** 2 (1 tracer taking the DEFER branch + 1 auto)
- **Files:** 5 changed outside the planning file (1 created, 4 modified)
- **Suite:** 1003 base -> 1009 tests, 0 failures (full `node --test` run at the Task 1 commit: 1003/1003; at the Task 2 commit: 1009/1009); `git status --porcelain data/` empty

## DEFERRED-REL-02

**Task 1 (tracer) took the DEFER branch: the compression bump was NOT performed. `package.json`, `package-lock.json` and `node_modules/` are untouched.**

- **Gate command:** `node ~/.claude/gsd-core/bin/gsd-tools.cjs package-legitimacy check compression --ecosystem npm`
- **Checked:** 2026-10-10T12:32Z
- **Verdict (verbatim):** `SUS`, reasons: `["too-new"]` (the only reason)
- **Signals (verbatim):** exists `true`; publishedAt `2026-09-11T11:16:47.669Z`; weeklyDownloads `44442443`; repoUrl `git+https://github.com/expressjs/compression.git`; deprecated `false`; postinstall `null`; ecosystem `npm`
- **Committed tree today:** `node_modules/compression` is `1.8.1`
- **Gate-clear date:** **2026-10-11T11:17Z** — compression@1.8.2 was published 2026-09-11T11:16:47Z and the tool's age floor is 30 days; the only reason is `too-new`, so the verdict is expected to flip to OK at that instant with no other change.
- **Advisory left open:** GHSA-vc2v-76pw-4v95 (compression memory leak on premature close, HIGH) — threat T-10-48, residual **transferred** (not mitigated) by this deferral.
- **Follow-up owner / vehicle:** the identical Step 1-5 of Task 1 (npm pack into a scratch dir outside the repo; sha512 must equal `sha512-o8vI5RE5A6EVVOd9o41jKp41aJom+QTEO/Bx8MYNjexMo/Bv2WOjUfZr+aL0WnYSgymUy6zeguqLTsIhV0gMvQ==`; copy over `node_modules/compression/` only, keep its nested `node_modules/negotiator`; bump `package.json` to `^1.8.2`; hand-edit the `node_modules/compression` entry in `package-lock.json` and `node_modules/.package-lock.json`; no tree-wide install) is executed **under REL-02 (Phase 21)**, or **earlier as a `/gsd-quick` task as soon as `package-legitimacy check compression` reports OK** (on or after 2026-10-11T11:17Z). Plan 10-09 flags this to the user.
- **Traceability note for the orchestrator (not edited here):** `.planning/REQUIREMENTS.md` REL-02 line ("compression bumped in Phase 10") now needs its traceability updated — the bump is not delivered by Phase 10.
- **When the bump lands:** remove the "`compression` dependency" bullet from DEPLOYMENT.md "Known limitations" in the same change.
- **Not bypassed, not auto-approved:** a deferral installs nothing. Package files and node_modules are byte-identical to the base commit.

## Accomplishments

- **Launchers (D-10-01, T-10-49):** `start-real-deal.command` has `export MA_MODE=real` and `start-real-deal.bat` has `set "MA_MODE=real"`, both before the node launch and without ever setting `DEMO_OPEN` (the server also refuses the combination). The banner replaced the `set-admin-password.js` instruction (wrong on a zero-account host) with: data lives in `data/real` / `MA_DATA_DIR`; create the first admin with `bootstrap-admin.js`; password from prompt or `MA_BOOTSTRAP_PASSWORD`, never argv; change it at first sign-in. `start.command` / `start.bat` untouched.
- **DEPLOYMENT.md (D-10-06, D-10-10):** launcher table kept and extended with a mode column; new "Three modes" comparison; "Real-deal first run" (launcher -> data dir 0700 seeded without demo accounts -> `bootstrap-admin.js` as the service user with the same `MA_DATA_DIR` -> forced rotation, min 12 -> Users tab with one-time temp password, disable-not-delete, last-admin guard -> disk encryption -> backups); `set-admin-password.js` documented after bootstrap; "Files at rest" (0600/0700 under any umask, service user, Windows ACLs, dev warning vs real-mode refusal); "Credential lockdown" (trigger, what is still served, remedy); "Behind a reverse proxy / TLS" (`TRUST_PROXY` integer hop count, subnet warning tied to REL-02, `PUBLIC_BASE_URL` -> Secure cookie, `ENABLE_HSTS` / `HSTS_INCLUDE_SUBDOMAINS`, per-account + per-source throttle, shared-source warning); "Sign-in lockout recovery" (admin backoff cap 5 minutes, memory-only throttle, restart clears it, `--force-reset-admin` with the service stopped); dev/demo accounts read-only (`accountsWritable:false`); `ADMIN_TOKEN` as discouraged break-glass; platform envelope and known limitations retained, plus the open compression advisory.
- **README (D-10-10):** three-modes paragraph pointing to DEPLOYMENT.md; stale `db.json` and "API stays open while ADMIN_TOKEN is unset" notes removed.
- **Tests:** `test/launcher-mode.test.js` (6 tests) asserts `MA_MODE=real` is an executable line preceding the node launch in both launchers (comments stripped), bootstrap-admin is named and set-admin-password is not, demo launchers never mention `MA_MODE`, DEPLOYMENT.md names every required contract item and that bootstrap-admin precedes set-admin-password, README states all three modes, and the env names / flags the doc uses exist in `server.js` / the scripts.

## Task Commits

1. **Task 1 (tracer): DEFERRED-REL-02 record, nothing installed** - `639cd32`
2. **Task 2: launchers select MA_MODE=real; DEPLOYMENT.md and README rewritten; launcher-mode test** - `01e4fa0`
3. **Plan summary** - committed with this file

## Tracer feedback gate

The tracer took the DEFER branch, so its `<verify>` deferral clause was run end to end: `git status --porcelain -- package.json package-lock.json node_modules` empty, `DEFERRED-REL-02` present in this file, `node --test test/auth-route-inventory.test.js` 2/2, and the full suite 1003/1003 before Task 2 started. Auto mode is not flagged in config; the tracer's verification is fully automated and the plan is `autonomous: true`, so no human checkpoint was returned (same call as 10-01/10-03/10-04/10-05). Flagged so the orchestrator can decide whether a human look is wanted.

## Deviations from Plan

**Total deviations:** 0 auto-fixed. The DEFER branch of Task 1 is the plan's own expected branch, not a deviation.

### Plan-vs-reality notes (intent preserved)

- **`ADMIN_PASSWORD`, not `MA_ADMIN_PASSWORD`:** my first DEPLOYMENT.md draft named an environment variable for `set-admin-password.js` that does not exist; the script reads `process.env.ADMIN_PASSWORD`. Corrected before commit and now asserted by the test (doc vs script).
- **Users tab label is written against the plan, not the code:** plan 10-07 (admin Users tab) runs in a parallel worktree, so "Admin console -> Users" in DEPLOYMENT.md/README follows the PRD/plan text and the already-merged `/api/admin/users` API. See coverage D4.
- **Extra test content beyond the plan list:** the plan's doc keyword list is asserted as written; I additionally cross-checked env names/flags against `server.js` and the CLI scripts and asserted launcher ordering, so doc drift from the code fails a test.

## Issues Encountered

- A PostToolUse hook repeatedly reported "context usage at 89%" while the harness counter showed >14.8M tokens remaining (same mis-calibration 10-05 reported); execution continued.

## Known Stubs

None.

## Follow-ups for 10-09 / orchestrator

- **REL-02 traceability:** REQUIREMENTS.md still says compression is bumped in Phase 10; update it (and flag HIGH advisory GHSA-vc2v-76pw-4v95 to the user in 10-09's walkthrough). Executable as a `/gsd-quick` from 2026-10-11T11:17Z.
- **Verify the merged tab label:** after merging 10-07, confirm the admin console tab is titled "Users" (DEPLOYMENT.md, README and `test/launcher-mode.test.js` assume it in prose only; the test asserts the word `Users` appears in the doc, not the UI).
- **10-09 asset check:** `LOCKDOWN_STATIC_ALLOWLIST` assertion remains with 10-09 as planned in 10-05.

## Threat Flags

None. No new network endpoints, auth paths, file access or schema changes; launchers and documentation only. T-10-SC (deferred, nothing installed), T-10-49 (launcher test), T-10-50 (integer hop count documented), T-10-51 (ADMIN_TOKEN as discouraged break-glass) addressed as planned; T-10-48 transferred to REL-02.

## Self-Check: PASSED

- Created/modified files exist: `test/launcher-mode.test.js`, `start-real-deal.command`, `start-real-deal.bat`, `DEPLOYMENT.md`, `README.md`, this SUMMARY
- Commits `639cd32`, `01e4fa0` present on `worktree-agent-aeb0b4d7e77ada2a8`
- Acceptance: `grep -c "MA_MODE=real"` = 3 in each real-deal launcher; `grep -c "MA_MODE"` = 0 in `start.command` and `start.bat`; `grep -c "set-admin-password.js" DEPLOYMENT.md` = 1 and `bootstrap-admin` precedes it; `DEFERRED-REL-02` present; `git status --porcelain -- package.json package-lock.json node_modules` empty
- `bash -n start-real-deal.command` clean; full suite 1009/1009; `git status --porcelain data/` empty; STATE.md / ROADMAP.md / REQUIREMENTS.md untouched
