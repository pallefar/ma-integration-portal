# Phase 11 Soak Fix Summary (verifier gap G-1)

**Status:** complete. `npm run soak` passes again with IN-02 kept; harness-only fix, `server.js` untouched.

## Cause

Review fix IN-02 (`feed9c9`, D-11-06) makes a real-deal `POST /api/pulses` file the pulse under the
session account's display name and ignore the body `employeeName`. `scripts/soak.js` carried its
per-write correlator in `employeeName`, so (a) the exactness check reported every acknowledged write
as mismatched (`acknowledged=894 missing=0 mismatched=894`) and (b) the refused-write attribution map
(the committed-but-unaudited detector, the Phase 8 CR-01 proof) was keyed on a value the server no
longer stores.

## What changed

| Commit | Change |
|---|---|
| `d91ff88` | `scripts/soak.js`: correlator travels in `comment` as `soak-load\|<correlator>` (server preserves it verbatim for every role; `TEXT_MAX` 4000, value is ~25 ASCII chars). Body `employeeName` is the worker account display name via one shared `workerAccountName(i)` (also used by `createAccount`). Exactness asserts `row.employeeName === workerAccountName(w.workerIndex)` and `row.comment === w.payload.comment`. Attribution map renamed `pulseIdByCorrelator`, keyed on the correlator parsed from `comment`. Every D-15 check, threshold and invariant is unchanged. |
| `d91ff88` | `test/soak-correlator.test.js` (new, 4 tests): three static guards on `scripts/soak.js` (correlator in `comment` not `employeeName`; exactness uses the account name; attribution keyed on the comment correlator) plus a real smoke run of the harness. |
| `5112d89` | `DEPLOYMENT.md`, "Controls the portal hides": documents the `access` map keys outside the read table: `assessmentInstances` (admin), `configWrite` (admin), `helpdesk` (admin/hrbp/pmo, not employee), `timeTravel` (admin/hrbp/pmo, only when the session has no deal binding). Also names the 14 read-probe keys and their source (`ACCESS_PROBES`). Per-role values were computed from `lib/readPolicy.js` + `roleAllowedForWrite`, not assumed. `test/deployment-role-matrix.test.js` passes unchanged. |
| `8ea220f` | Evidence README regeneration line is now `SOAK_DURATION_MS=60000 SOAK_WRITE_INTERVAL_MS=250 npm run soak`, with a one-line note (nearly full disk, audit amplification, Phase 12 DATA-01 removes it). Evidence logs untouched. |

## Soak output

`SOAK_DURATION_MS=20000 SOAK_WRITE_INTERVAL_MS=250 npm run soak` (3 processes), exit 0:

```
soak: load phase complete — acknowledged=872 refused=0 unexpected=0 | conflict-lane: acknowledged=74 conflict409=155 refused503=0
  [PASS] every acknowledged write present in the final database and exact: acknowledged=872 missing=0 mismatched=0
  [PASS] ... refused=0 committedButUnaudited(genuine violation post-CR-01)=0 committedAndAudited(genuine violation)=0
  [PASS] PRAGMA integrity_check ok on every touched file: deal=ok, control=ok, audit=ok
  [PASS] audit trail matches acknowledged writes one-to-one (both directions): acknowledged=872 auditRows=872 missingFromAudit=0 duplicateInAudit=0 extraInAudit=0
  [PASS] conflict-probe RAID record version reconciles exactly ...: initialVersion=1 conflictAcknowledged=74 expectedFinalVersion=75 actualFinalVersion=75
soak: PASS — acknowledged-write invariant held under sustained real load.
```

`SOAK_PROCESSES=4 SOAK_DURATION_MS=20000 SOAK_WRITE_INTERVAL_MS=250`, exit 0:

```
soak: load phase complete — acknowledged=1118 refused=0 unexpected=0 | conflict-lane: acknowledged=73 conflict409=226 refused503=0
  [PASS] every acknowledged write present in the final database and exact: acknowledged=1118 missing=0 mismatched=0
  [PASS] audit trail matches acknowledged writes one-to-one (both directions): acknowledged=1118 auditRows=1118 missingFromAudit=0 duplicateInAudit=0 extraInAudit=0
  [PASS] conflict-probe RAID record version reconciles exactly ...: initialVersion=1 conflictAcknowledged=73 expectedFinalVersion=74 actualFinalVersion=74
soak: PASS — acknowledged-write invariant held under sustained real load.
```

All 10 D-15 checks PASS in both runs.

## Regression guard

- `test/soak-correlator.test.js`: 4/4 pass. Against the pre-fix `scripts/soak.js` all 4 fail
  (mutation check: old file restored temporarily, then the fixed file put back and re-run).
- The smoke test runs the harness with `SOAK_DURATION_MS=6000 SOAK_WRITE_INTERVAL_MS=400
  SOAK_PROCESSES=2` in a private `TMPDIR`, asserts exit 0, `missing=0 mismatched=0` and no `[FAIL]`,
  and asserts the harness removed its own scratch dir. Measured about 7 s wall alone, well under 50 MB
  of scratch (a few hundred rows plus WAL, deleted on exit).
- Full suite: `node --test` = **1262 tests, 1262 pass, 0 fail** (1258 at base + 4 new).
- `git status --porcelain data/ public/sent_emails/` empty at every commit.

## Deviations from plan

None. One note: the refused-write attribution path is only exercised for real when a 503 occurs;
neither light run produced a refused write (`refused=0`), so that path is covered by the static guard
and by the unchanged logic, not by a live refusal in these runs.

## Could not do / caveats

- The smoke test adds about 7 s to the suite (inside the 8 s bound), run in parallel with other files;
  a heavily loaded CI host could stretch it, so it carries a 90 s test timeout.
- The harness picks its base port from `process.pid`; a collision with an unrelated listener is
  possible but pre-existing and not changed here.

<worktree_metadata>
{"agent_id":"11-soak-fix","worktree_path":"/Users/karstenhaldan/M&A/.claude/worktrees/agent-a810ba4abd05d002a","branch":"worktree-agent-a810ba4abd05d002a","expected_base":"e6a502140ba2491ccf47908bdda4cb5c7ae56423"}
</worktree_metadata>
