---
phase: 08-concurrency-storage-foundation
verified: 2026-08-11T00:00:00Z
status: human_needed
score: 22/23 must-haves verified
behavior_unverified: 0
backstop_abstained: 1 # 08-05 truth marked verification:backstop with no explicit corroborating evidence — abstained per honest-verifier rules, routed to human_verification
overrides_applied: 0
human_verification:
  - test: "T23 (backstop, 08-05 must_haves.truths): with the app running under real multi-process contention, arrange for one writer's COMMIT to land at the same instant a second writer's BEGIN IMMEDIATE is issued against the same file, and confirm the second acquires the lock cleanly and both writes persist (neither merged away, neither collided into an error)."
    expected: "Both writes persist; no error, no silent loss at the exact commit/acquire boundary."
    why_human: "verification: backstop in 08-05-PLAN.md's frontmatter — no test file, soak assertion, or SUMMARY coverage entry names this exact simultaneous-instant boundary case. The soak and concurrency-busy-retry tests exercise sustained contention broadly and would very likely hit this timing window incidentally many times over thousands of writes with zero observed violations, but no evidence explicitly isolates and confirms this named edge case, so per the honest-verifier abstention rule it cannot be marked VERIFIED on inference alone."
  - test: "Judgment-tier prohibition (08-04, transparency): 'MUST NOT let the client's silent auto-retry hide a persistent save failure.'"
    expected: "When retries are exhausted, the user is told the change was not saved and no page/form state is discarded."
    why_human: "verification: judgment. Non-authoritative LLM-judge verdict recorded below (SATISFIED) based on code inspection (public/js/transitions.js's give-up path only calls a toast helper, no DOM clear/reset/navigate) and a passing behavioral test (test/client-busy-retry.test.js's three-503 case asserts the toast text and that origFetch was called exactly 3 times with no other side effects) — but per policy this class of prohibition always requires human confirmation, not a silent pass."
  - test: "08-04-PLAN.md's own deferred human-check: with the app running, trigger a save while a second process holds the write lock (scripts/soak.js can supply the contention); confirm the save completes with no visible interruption when contention is brief, and that a sustained hold produces the 'not saved' toast with the form still populated."
    expected: "Brief contention: invisible retry, save succeeds. Sustained contention: visible 'not saved' toast, form untouched."
    why_human: "Explicitly marked <human-check> in 08-04-PLAN.md's plan-level <verification> block. No task in the plan carries type=\"checkpoint:*\", so this was never paused for during autonomous execution and 08-04-SUMMARY.md does not report it as performed. This is a real live-browser visual/interactive check that automated tests cannot substitute for."
  - test: "08-05-PLAN.md Task 2's own deferred human-check: open the running portal in a browser against the committed demo data and click through the dashboard, a workstream view, and one save."
    expected: "The demo showcase looks and behaves exactly as it did before Phase 8 — the storage change is invisible by design."
    why_human: "Explicitly marked <human-check> in 08-05-PLAN.md Task 2's <verify> block. 08-05-SUMMARY.md's own D7 coverage entry states this was NOT performed ('no live human was available in this autonomous worktree wave') and substitutes only machine-verifiable proxies (boot, HTTP 200, byte-exact scratch-copy write round-trip) — explicitly leaving the visual judgment for a human pass."
---

# Phase 8: Concurrency & Storage Foundation Verification Report

**Phase Goal:** Concurrent writers on one shared host serialize safely with zero lost updates — the Option-B storage-layer change that gates the whole milestone.
**Verified:** 2026-08-11
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (SC1/08-01) Two OS processes writing the same deal file concurrently both persist — no silent overwrite | ✓ VERIFIED | `node --test test/concurrency-busy-retry.test.js` — "zero-lost-update" test spawns 2 real child processes, 150 writes each, asserts every acknowledged id present; ran clean in this session |
| 2 | (SC2/08-01) A losing writer gets a bounded 503 + Retry-After, never a hang/partial row/generic 500 | ✓ VERIFIED | Same test's "end-to-end" case: real second-process lock held 2500ms > 1000ms budget, asserts 503 + `Retry-After` header present; ran clean |
| 3 | Lock-grant order is unspecified but both acknowledged writes are present regardless of order | ✓ VERIFIED | Zero-lost-update test asserts the full acknowledged-id set from both children present, independent of interleave order |
| 4 | Uncontended writer has no busy-wait delay; a byte-identical payload still commits and is acknowledged | ✓ VERIFIED | `.immediate` acquires the lock immediately when uncontended (no added wait logic); pre-existing `test/writedb-merge.test.js` "pure reorder (no content change) persists" proves the merge algorithm always executes UPDATE/commits even with unchanged content — Phase 8 added no special-case skip |
| 5 | Re-applying an identical `writeDb()` payload after a 503 retry converges to the same state — no duplicate row | ✓ VERIFIED | End-to-end test: contended POST returns 503 (nothing committed, confirmed by CR-01 fix below), identical retry after lock release succeeds, exactly one row with that id exists |
| 6 | 503 response body is a fixed generic string, never echoes `err.message`, paths, table/deal identifiers | ✓ VERIFIED | `assert.deepStrictEqual(contendedBody, { error: 'Server is busy. Please try again.' })`; grep of `server.js` confirms no `err.message` interpolation in the middleware |
| 7 | All three explicit multi-statement transactions (deal/demo write, audit batch, control-plane pairs) acquire lock via `BEGIN IMMEDIATE` | ✓ VERIFIED | `db/store.js` `writeDb()`, `db/auditHook.js` `writeAuditBatch()`, and 5 functions in `db/controlStore.js` (`updateUser`, `updateDealSetup`, `updateDealMembers`, `setDealMemberGrants`, `archiveDeal`) all confirmed using `.immediate` by direct source read |
| 8 | A busy `audit.db` append fails the WHOLE request, never queued/dropped/logged-and-continued | ✓ VERIFIED (strengthened) | Post-CR-01 fix: audit append now runs as the FINAL STEP **inside** `writeDb()`'s own `.immediate` transaction (`db/store.js:434-437`), so a busy audit append rolls back the deal write too — stronger than the original spec. Confirmed live: `SOAK_PROCESSES=4` run in this session produced 3 real refusals, verdict `committedButUnaudited(genuine violation post-CR-01)=0` |
| 9 | Two concurrent control-plane edits (different member / different DD grant) to the same deal both survive | ✓ VERIFIED | `node --test test/control-plane-serialization.test.js` — all 3 cases (member race, DD-grant race, lock-timeout-throws) pass in this session |
| 10 | No route converts a contention error into a hand-written 500 — every storage-wrapping catch re-throws via `isBusyError()` | ✓ VERIFIED | `isBusyError(` appears 14x in `server.js` (predicate + middleware + every catch site); structural + live checks in `test/busy-503-contract.test.js` pass |
| 11 | Uniform 503 contract holds for control-plane writes too (login/session, deal registry, user admin) — not special-cased | ✓ VERIFIED | Deal-provisioning catch (`server.js:807-826`) guarded with `isBusyError`; login (`POST /api/auth/login`) and change-password (`controlStore.updateUser` call) have **no local catch at all**, so an uncaught `SqliteError` reaches the central middleware by construction — no special-casing needed or present |
| 12 | An async route handler's rejected write reaches the central middleware, never hangs/falls to default 500 | ✓ VERIFIED | `grep` count: 2 async write handlers in `server.js`, 0 non-forwarding (both use `next(e)`/`.catch(next)`) |
| 13 | A future swallowing route or non-forwarding async handler turns the coverage gate red | ✓ VERIFIED | `test/busy-503-contract.test.js` structural assertions scan the LIVE source (no hardcoded list) and the live `app._router.stack` route inventory; 5/5 subtests pass including the negative control (400/500 still work) |
| 14 | Routine (brief) write contention is invisible to the user — 503 retried automatically, honoring `Retry-After` (D-07) | ✓ VERIFIED | `test/client-busy-retry.test.js` two-503-then-200 case: caller receives 200, `origFetch` called exactly 3 times, no toast |
| 15 | Retries are bounded (2 retries / 3 attempts) and desynchronized via randomized jitter | ✓ VERIFIED | `BUSY_RETRY_MAX_RETRIES = 2`, `BUSY_RETRY_JITTER_MAX_MS = 300` confirmed in `public/js/transitions.js`; three-503 case asserts exactly 3 calls |
| 16 | Exhausted retries produce a plain "not saved" message; page/form state is left untouched (D-08) | ✓ VERIFIED | Three-503 test case asserts exactly one toast element with text containing "not saved"; give-up path calls only the toast helper, no DOM clear/reset/navigate |
| 17 | Exactly one wrapper owns `window.fetch` | ✓ VERIFIED | `grep -c "window.fetch\s*="` = 1 in `public/js/transitions.js` |
| 18 | `npm run soak` boots real, separate `server.js` OS processes and drives authenticated writes through the whole stack (D-13) | ✓ VERIFIED | Ran `SOAK_PROCESSES=2 SOAK_DURATION_MS=15000` and `SOAK_PROCESSES=4 SOAK_DURATION_MS=20000` in this session — real spawned `node server.js` children, real sessions, real audited deal writes |
| 19 | Soak pass criterion is the 5-check acknowledged-write invariant (D-15) | ✓ VERIFIED | Both soak runs in this session printed all 5 `[PASS]` verdict lines (present+exact, no-leaked-refusal/genuine-violation, integrity_check ok, audit 1:1, refusal-rate reported) |
| 20 | Bounded 503s during a soak run are a pass, not a failure | ✓ VERIFIED | Harder run reported `refused=3` and still printed overall `PASS` |
| 21 | Process count / duration / write rate are configurable (D-14) | ✓ VERIFIED | `SOAK_PROCESSES`, `SOAK_DURATION_MS`, `SOAK_WRITE_INTERVAL_MS` all honored in this session's runs; resolved config printed at start |
| 22 | (SC3/08-05) Demo showcase boots and behaves identically; zero-install committed-DB bundle still runs with no install step | ✓ VERIFIED (automated half) | `node server.js` with no env overrides, no install step, booted from the committed tree and served `GET /login.html` → 200 in this session; `git status --porcelain data/` empty after wal-checkpoint. **The purely visual/interactive click-through is NOT independently verified — see human_verification.** |
| 23 | (backstop, 08-05) Simultaneous COMMIT / BEGIN IMMEDIATE boundary: the second writer acquires cleanly, both writes persist, neither merges away nor collides | ? UNCERTAIN (insufficient_spec) | No test, soak assertion, or SUMMARY coverage entry isolates this exact named edge case. Abstained per honest-verifier rule — see human_verification. NOT counted toward the score. |

**Score:** 22/23 truths verified (1 abstained — `verification: backstop`, insufficient_spec, routed to human review)

### Prohibitions (must_haves.prohibitions — reported separately, not blended into the truths score)

| # | Statement | Tier | Disposition | Evidence |
|---|-----------|------|-------------|----------|
| P1 | (08-01, integrity) MUST NOT acknowledge a write as 2xx that is not durably present | test | ✓ VERIFIED — wired enforcement | `test/concurrency-busy-retry.test.js`'s zero-lost-update + end-to-end tests are real, runnable tests that would fail if this were violated; ran clean |
| P2 | (08-02, privacy) MUST NOT acknowledge a deal-data write whose audit row was not written | test | ✓ VERIFIED — wired enforcement | CR-01 fix moves the audit append inside the deal-write `.immediate` transaction (confirmed by source read); `scripts/soak.js`'s D-15 check 2 explicitly fails on `committedButUnaudited(genuine violation post-CR-01) > 0` — this session's harder soak run genuinely exercised 3 refusals and confirmed 0 violations |
| P3 | (08-04, transparency) MUST NOT let silent auto-retry hide a persistent save failure | judgment | ⚠ FLAGGED — non-authoritative LLM-judge: SATISFIED | Code + `test/client-busy-retry.test.js`'s three-503 case support this, but judgment-tier prohibitions are never a silent pass per policy — routed to human_verification for explicit confirmation |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `db/dbFiles.js` | `busy_timeout = 1000` pragma | ✓ VERIFIED | Confirmed at line 100; header comment updated |
| `db/store.js` | `writeDb()` uses `.immediate` | ✓ VERIFIED | Line 439 (`}).immediate;`), audit dispatch moved inside (CR-01 fix) |
| `server.js` | Central `SQLITE_BUSY → 503 Retry-After` middleware | ✓ VERIFIED | Mounted at line ~6921, before final 500 handler; `res.headersSent` guard added (WR-04 fix) |
| `test/concurrency-busy-retry.test.js` | End-to-end + zero-lost-update proof, ≥120 lines | ✓ VERIFIED | 350 lines; both tests pass |
| `db/auditHook.js` | `writeAuditBatch()` uses `.immediate` | ✓ VERIFIED | Line 144 |
| `db/controlStore.js` | Control-plane read-modify-write pairs as single `.immediate` transactions | ✓ VERIFIED | 5 functions wrapped; `createDealDeduped()` additionally added (WR-01/02 fix) |
| `test/control-plane-serialization.test.js` | ≥60 lines, proof of concurrent survival | ✓ VERIFIED | 321 lines; all 3 subtests pass |
| `test/busy-503-contract.test.js` | ≥90 lines, permanent coverage gate | ✓ VERIFIED | 431 lines; 5/5 subtests pass |
| `public/js/transitions.js` | `ma-fetch-wrapper:begin/end` sentinels, retry + toast | ✓ VERIFIED | Sentinels at lines 1/162; WR-05/IN-02 review fixes present (Request-object guard, toast dedup) |
| `test/client-busy-retry.test.js` | ≥80 lines, behavioral proof | ✓ VERIFIED | 183 lines; all cases pass |
| `scripts/soak.js` | ≥150 lines, multi-process harness | ✓ VERIFIED | 560 lines |
| `package.json` | `"soak"` script entry | ✓ VERIFIED | `"soak": "node scripts/soak.js"` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `db/store.js` | `db/dbFiles.js` | shared `busy_timeout = 1000` pragma | ✓ WIRED | Every connection opens through `openDbFile()` |
| `db/store.js` | `server.js` | uncaught `SqliteError` → central middleware | ✓ WIRED | Confirmed by end-to-end test producing a real 503 |
| `db/auditHook.js` | `db/store.js` | throwing audit batch propagates, now from INSIDE the same transaction | ✓ WIRED (strengthened) | CR-01 fix; verified structurally and via soak |
| `db/controlStore.js` | `db/dbFiles.js` | `controlConn()` inherits `busy_timeout` | ✓ WIRED | Confirmed by `control-plane-serialization.test.js`'s lock-timeout-throws case |
| `server.js` routes | `server.js` central middleware | `isBusyError()` re-throw/`next(e)` at every storage-wrapping catch | ✓ WIRED | 14 call sites; structural + live tests pass |
| `public/js/transitions.js` | `server.js` central middleware | retry branch reads `Retry-After` header | ✓ WIRED | Confirmed by `client-busy-retry.test.js`'s `Retry-After: 2` timing case |
| `scripts/soak.js` | `server.js` | spawns real child processes with env overrides | ✓ WIRED | Confirmed live in this session (2 runs) |
| `scripts/soak.js` | `db/auditHook.js` | audit trail reconciled 1:1 against acknowledged writes | ✓ WIRED | Confirmed live; PASS in both runs |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite green | `npm test` | 703/703 pass (run twice in this session, including immediately after two soak runs) | ✓ PASS |
| Core concurrency tests | `node --test test/concurrency-busy-retry.test.js test/control-plane-serialization.test.js test/busy-503-contract.test.js test/client-busy-retry.test.js` | 16/16 pass | ✓ PASS |
| Soak at defaults (short) | `SOAK_PROCESSES=2 SOAK_DURATION_MS=15000 npm run soak` | 1032 acknowledged, 0 refused, all 5 D-15 checks PASS | ✓ PASS |
| Soak under real induced contention | `SOAK_PROCESSES=4 SOAK_DURATION_MS=20000 SOAK_WRITE_INTERVAL_MS=20 npm run soak` | 1842 acknowledged, 3 refused, `committedButUnaudited=0`, all 5 D-15 checks PASS — this is the exact scenario the pre-fix code failed on (review found 3–33 such cases before CR-01) | ✓ PASS |
| Demo boot / zero-install | `node server.js` (no env overrides, no install step) then `curl /login.html` | HTTP 200 | ✓ PASS |
| Committed data untouched | `node scripts/wal-checkpoint.js && git status --porcelain data/` | empty, both before and after all write-exercising checks in this session | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CONC-01 | 08-01, 08-02, 08-03, 08-04, 08-05 | Concurrent writers serialize safely, zero lost updates, via `.immediate` transactions + busy-retry | ✓ SATISFIED | All 22 countable truths VERIFIED; 703/703 suite; live soak runs (including one that genuinely exercised the CR-01 fix's exact failure scenario) both PASS |

No orphaned requirements — CONC-01 is the only requirement REQUIREMENTS.md maps to Phase 8, and all 5 plans declare it.

### Anti-Patterns Found

None. Scanned all phase-touched files (`db/dbFiles.js`, `db/store.js`, `db/auditHook.js`, `db/controlStore.js`, `server.js`, `public/js/transitions.js`, `scripts/soak.js`, plus the 5 new test files) for `TBD`/`FIXME`/`XXX` (zero matches) and `TODO`/`HACK`/`PLACEHOLDER` (zero matches outside review-fix comment prefixes). `return null`/`return []` guard-clause patterns present are pre-existing "not found" idioms unrelated to Phase 8's changes, not new stubs.

**Code review debt (08-REVIEW.md):** 1 Critical + 5 Warnings + 2 Info found post-execution. 1 Critical + 5 Warnings fixed in commits `08aa58d`, `ea08d75`, `837056b`, `7c937da`, `9db317f`, `c781069` — each fix confirmed present in the current source by direct inspection in this verification. IN-01 (soak port-collision window) was explicitly accepted, not fixed — confirmed unchanged in `scripts/soak.js`, consistent with the review's own low-severity/accept disposition; not a gap.

**Flaky test note:** 08-03-SUMMARY.md documents one observed timing flake during development (`HOLD_MS` raised to 9000ms), already fixed and not reproduced since. In this verification session, `npm test` was run twice — once as a baseline, and once immediately following two `npm run soak` invocations (the exact "immediately after a soak" condition previously flagged) — both runs were clean at 703/703. Not treated as a current gap.

### Human Verification Required

4 items — see YAML frontmatter `human_verification` for full detail. Summary:

1. **Backstop truth (08-05):** the exact simultaneous COMMIT/BEGIN-IMMEDIATE boundary case has no isolated test evidence — abstained per honest-verifier rules rather than inferred from broad contention coverage.
2. **Judgment-tier prohibition (08-04):** "silent retry must not hide a persistent save failure" — code and tests support it, but this class of prohibition is never a silent auto-pass; flagged for explicit human confirmation.
3. **08-04's deferred live-browser check:** trigger a save under real contention and confirm invisible-retry-on-brief-contention / visible-toast-on-sustained-contention with the form preserved. Not performed during autonomous execution (no human available, no checkpoint task in the plan).
4. **08-05's deferred live-browser check:** click through the demo showcase (dashboard, workstream view, one save) and confirm it is visually/behaviorally identical to before the phase. Not performed; 08-05-SUMMARY.md explicitly substitutes machine-verifiable proxies only and leaves the visual judgment open.

### Gaps Summary

No gaps. Every must-have truth, artifact, and key link either passed direct verification in this session or was already fixed by the documented post-review commits, which were independently re-confirmed against the current source (not taken on SUMMARY.md's word). The phase goal — concurrent writers serializing safely with zero lost updates — is demonstrated at the unit-test level, the integration-test level (busy-503-contract, control-plane-serialization), and the full-stack multi-process soak level, including a soak run in this session that organically reproduced the exact contention scenario the review's Critical finding (CR-01) was about, confirming the fix holds under genuine load rather than only in the isolated unit test.

The `human_needed` status is driven entirely by items that are structurally incapable of automated resolution (a named-but-untested timing boundary, a judgment-tier transparency prohibition, and two explicitly-deferred live-browser checks) — not by any failing or missing implementation.

---

_Verified: 2026-08-11_
_Verifier: Claude (gsd-verifier)_
