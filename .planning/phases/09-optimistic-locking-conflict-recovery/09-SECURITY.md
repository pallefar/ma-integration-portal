---
phase: 9
slug: optimistic-locking-conflict-recovery
status: SECURED
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_total: 61
threats_closed: 61
threats_open: 0
asvs_level: 1
block_on: high
audited: 2026-10-10
audited_at: 0f56e6a
auditor: gsd-security-auditor (Claude Fable 5.1)
---

# Phase 9 — Security

> Per-phase security contract: threat register, accepted risks, unregistered flags and audit trail.
> Scope: every `<threat_model>` row of plans 09-01..09-07 (original) and 09-08..09-16 (gap closure),
> plus 09-REVIEW.md Round 1 (CR-01, WR-01/02, IN-01) and Round 2 (WR-03/04, IN-02..05).
> Verification method: ASVS L1 — every `mitigate` control located in the code on `main` at `0f56e6a`
> (file:line), every `accept` rationale re-read for current validity, every `transfer` target confirmed
> to exist as a tracked requirement. SUMMARY claims were not used as evidence.

---

## Verification performed

| Check | Result |
|-------|--------|
| `node --test test/optimistic-locking-contract.test.js test/optimistic-locking-precondition.test.js` | 84/84 pass |
| `node --test test/client-conflict-dialog.test.js test/client-xss-sinks.test.js test/client-version-precondition.test.js test/asset-cache-bust.test.js test/optimistic-locking-cross-process.test.js` | 95/95 pass |
| `git status --porcelain data/` | empty (committed DBs untouched) |
| `git diff dec3400..HEAD -- package.json package-lock.json` | empty (no dependency change this phase) |
| `grep -n innerHTML public/js/transitions.js` | first hit at :1118 — outside the wrapper region (:1–:1104) |
| `grep -n "confirm(" public/js/transitions.js` | only :3447 — outside the wrapper region |
| Walk evidence `walk-evidence/results.json` | 350 PASS / 0 FAIL; no credential strings in results/log |
| Soak (`npm run soak`) | not re-run by the auditor; 09-VALIDATION.md:234 records the final-tree PASS (ack 4097, 409 = 909, lost 0, committed-but-unaudited 0, audit 1:1); the 409-classification code was verified in `scripts/soak.js` |

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| browser → `/api` versioned write routes | Untrusted `version` body key / `?expectedVersion=` query; 23 routes | MNPI record patches + precondition |
| server 409/400 bodies → browser | `conflictBody()` echoes a record's current state; `versionRequired` 400 is a fixed literal | MNPI field values (clearance-filtered for DD), version, attribution |
| route handler → `db/store.js` transaction | Expected version crosses into the SQL WHERE clause as a bound parameter | integers only |
| second OS process → same SQLite file | Phase 8 WAL multi-process window the WHERE layer closes | committed rows |
| 409 body → conflict dialog DOM | Other users' MNPI free text rendered client-side | textContent only |
| held promise → page code | wrapper decides what each page's write promise resolves to | own-session responses only |
| walk harness → committed `data/*.db` | boots real servers on temp copies | sha256-checked, never written |

## Threat Register

Severity order critical > high > medium > low; `block_on: high`. Verdict legend: CLOSED = control found and
judged effective at L1; CLOSED (accepted) = rationale recorded in the Accepted Risks log below and still
valid; CLOSED (transferred) = tracked requirement exists.

| Threat ID | Category | Severity | Disposition | Evidence (file:line) | Verdict |
|-----------|----------|----------|-------------|----------------------|---------|
| T-09-01 | Tampering | medium | mitigate | `validators/workstream.js:369` RaidUpsertSchema `version: z.number().int().nonnegative().optional()`; all 15 versioned POST schemas carry it (workstream.js:97,182,196,215,269,302,314,329,369; dd.js:99,152,174; org.js:62,178,203); `server.js:516` strict `===` backstop; precondition E-invalid | CLOSED |
| T-09-02 | Tampering | high | mitigate | `db/store.js:394-403` `versionMatchSql` ends `= ?`; `:452`, `:471`, `:527` pass `expectedVersion` as a bound arg; contract structural test `:267-273` (every `json_extract` line carries `?`) | CLOSED |
| T-09-03 | Info Disclosure | high | mitigate | `server.js:377-387` `conflictBody()` fixed 7-key shape; `:7288-7295` central 409 middleware reads only `err.conflictDetail`, never `err.message`/stack; `:7290` `headersSent` guard | CLOSED |
| T-09-04 | Info Disclosure | high | mitigate | `server.js:468-476`, `:517` `options.clearanceFilter` applied to `currentRecord`; DD callers `:5560`, `:5594`, `:5791`, `:5821`, `:5901`; RAID `:4444` passes none (premise narrowed — see UF-2) | CLOSED |
| T-09-05 | DoS | medium | mitigate | `public/js/transitions.js:1048-1055` 409 branch returns `holdConflict()`/`res`; no `delay()`, no `attemptFetch` re-entry; dialog test `:229` (zero wrapper retries) | CLOSED |
| T-09-06 | Info Disclosure | low | accept | 09-01-PLAN register + 09-CONTEXT D-04; `server.js:523-524` — see AR-09-01 | CLOSED (accepted) |
| T-09-07 | Tampering (XSS) | high | mitigate | wrapper region `transitions.js:1-1104` has zero `innerHTML`/`insertAdjacentHTML`/`document.write` (first `innerHTML` at `:1118`); values via `textContent` `:303-311`, `:797`, `:805-810` | CLOSED |
| T-09-08 | Repudiation | high | mitigate | `db/store.js:364` `applyWrite = conn.transaction(...)`; conflict throws `:480`, `:490`, `:532` inside the body; audit append `:594-617` is the final step of the same transaction; cross-process (same record) test; soak check 8 (`scripts/soak.js:633-650`) | CLOSED |
| T-09-09 | Tampering | medium | mitigate | `server.js:419-433` `parseExpectedVersion()` `^\d+$`, `Number.isInteger`, `>= 0`, `invalid` → `:498-500` fixed 400; contract (11), (36) | CLOSED |
| T-09-10 | Spoofing | medium | mitigate | contract (15) live negative control — unrecognized-stage 409 carries no `conflict:true` | CLOSED |
| T-09-11 | Info Disclosure | medium | accept | 09-02-PLAN register; rationale holds for synergy initiatives and manually-created tasks; narrowed for converted tasks (see UF-2 / AUTHZ-03) — AR-09-02 | CLOSED (accepted) |
| T-09-12 | Tampering | high | mitigate | `server.js:3216` (tasks) and `:3845` (synergies) precheck precedes the first field assignment; contract (1), (5), (9), (12), (13) assert the stored record is unchanged after a 409 | CLOSED |
| T-09-13 | Tampering (XSS) | high | mitigate | `transitions.js:303-311` `setConflictDiffValue` — `textContent` / `JSON.stringify` for objects; `:797` labels via `textContent` | CLOSED |
| T-09-14 | DoS | medium | mitigate | `transitions.js:525-529` `rerender` re-renders in place; `:514-516` reapply only from a click; dialog test `:348` + HP6 (fetch-call count) | CLOSED |
| T-09-15 | Spoofing | medium | mitigate | `transitions.js:1050` `body.conflict === true` gate; dialog test `:253` marker-less 409 passes through | CLOSED |
| T-09-16 | Info Disclosure | low | mitigate | `transitions.js:223` single `activeConflictSession`; `:237-242` overlay removed on settle; every exit (`:682`, `:707`, `:726`, `:762`, `:828`, `:925`, `:929`, `:942`) routes through `settleConflictSession`; HP12 | CLOSED |
| T-09-17 (DD `currentRecord`) | Info Disclosure | high | mitigate | route layer `server.js:5560-5562`, `:5594-5596`, `:5791-5793`, `:5821-5823`, `:5901-5903` filter on `record.area` (current); WHERE layer `db/store.js:203-207` `conflictVisibleRecord()` + `db/collections.js:164` `CLEARANCE_SCOPED_COLLECTIONS` fail-closed; contract (22), CR-01 (a)–(d) | CLOSED |
| T-09-17 (attribution) | Info Disclosure | low | accept | `server.js:523-524`, `db/store.js:200-202`, `transitions.js:697-698` — who/when disclosed, never what; 09-REVIEW IN-01 — AR-09-03 | CLOSED (accepted) |
| T-09-18 | Info Disclosure | high | mitigate | `server.js:5562` `publicDdItem(record)` inside the filter; `:5617` same projection on the 200; contract (21) key-set parity | CLOSED |
| T-09-19 | Info Disclosure | medium | mitigate | `server.js:5553`, `:5591`, `:5789`, `:5817`, `:5892` `ddAreaRefused()` strictly before `conflictIfStale()`; contract (25) structural | CLOSED |
| T-09-20 | Tampering | high | mitigate | `server.js:5901` precheck before `source`/lanes are touched; single transaction `db/store.js:364`; contract (23) orphan-row check | CLOSED |
| T-09-21 | Tampering | medium | mitigate | `validators/dd.js:99`, `:152`, `:174` | CLOSED |
| T-09-22 | Info Disclosure | medium | mitigate | `server.js:4594-4596` `hr` grant → `:4622` precheck (positions); `:5128`/`:5138` → `:5156` (flight-risk); `:5236`/`:5243` → `:5259` (convert) | CLOSED |
| T-09-23 | Tampering | high | mitigate | `server.js:4612-4626` precheck before the shallow-merge candidate and `positionGraphFailure()`; contract (30), (35) | CLOSED |
| T-09-24 | Tampering | high | mitigate | `server.js:5259` precheck before task/RAID lanes; contract (33) orphan-row check | CLOSED |
| T-09-25 | Repudiation | medium | mitigate | `server.js:5051-5063` recorded exemption; `db/collections.js:131-139`; contract Part 2 (`:200`) + (31); allow-list entry `:168` | CLOSED |
| T-09-26 | Tampering | medium | mitigate | DELETE routes `server.js:3269`, `:3988`, `:4036`, `:4748`, `:5220`, `:5594`, `:5791`, `:6122` all via `conflictIfStale()` → `parseExpectedVersion()`; contract (36)–(44), (43) | CLOSED |
| T-09-27 | Info Disclosure | high | mitigate | `server.js:5594-5596`, `:5791-5793` DD DELETE filters identical to POST siblings; contract (44) structural | CLOSED |
| T-09-28 | EoP | high | mitigate | DD DELETE `:5553`/`:5789` clearance first; org DELETE `:4736-4738`, `:5208-5214` role + `hr` first; task/RAID/synergy DELETE have no clearance gate to precede (Phase 11 AUTHZ-03) | CLOSED |
| T-09-29 | DoS | medium | mitigate | `transitions.js:740` click-bound; `:593` `inFlight`; HP8 / CF8 | CLOSED |
| T-09-30 | Repudiation | medium | mitigate | no `window.confirm` in `:1-1104` (only `:3447`, outside); `:732-733`; CF11 + client-version-precondition C5 | CLOSED |
| T-09-31 | Tampering | high | mitigate | contract test `:131-194`: live `server.js` brace-matched scan, reasoned allow-list, allow-list rot check in both directions | CLOSED |
| T-09-32 | Tampering | high | mitigate | `db/collections.js:140-155` size `=== 10` + `ARRAY_COLLECTIONS` membership throw; contract Part 2 (`:200`, `:225`), Part 3 dual-lane (`:1771-1835`) | CLOSED |
| T-09-33 | Spoofing | medium | mitigate | contract (4), (15) assert against live responses of both pre-existing 409 routes | CLOSED |
| T-09-34 | Repudiation | high | mitigate | `scripts/soak.js:315-324` 409 as its own outcome class; `:596-650` checks 6–8 (version reconcile, highest-writer content, audit membership); 09-VALIDATION.md:234 final-tree PASS | CLOSED |
| T-09-35 | Repudiation | medium | mitigate | `09-VALIDATION.md` frontmatter `nyquist_compliant: true`, per-task map incl. `09-16-03`, coverage tables `:139-160` | CLOSED |
| T-09-36 | Tampering | high | mitigate | `server.js:507-512` `record && req.isDemo !== true` → 400 `versionRequired`; `db/resolver.js:137` sole setter; precondition U1–U4, T-table 23/23, P3/P5, S1; client C3/C4 (`maVersionOf` ×19 execution.js, ×5 org.js, ×5 due-diligence.js) | CLOSED |
| T-09-37 | Info Disclosure | medium | mitigate | `server.js:509` `{ error, versionRequired: true }`; `:499`, `:504` one-key literals; P3 exact key set | CLOSED |
| T-09-38 (400 existence oracle) | Info Disclosure | medium | transfer | `.planning/REQUIREMENTS.md:42` AUTHZ-03 — "filtered by clean-room clearance on read, write, delete and 409 bodies"; `:181` Phase 11, Pending; 09-08-PLAN GD-14 | CLOSED (transferred) |
| T-09-38 (re-read after withheld) | Info Disclosure | low | mitigate | `execution.js:49-50` `reloadAfterConflict` → `load()` → `GET /api/integration-tasks` `server.js:3195-3202` `reportTaskRows()` clearance-filtered | CLOSED |
| T-09-39 | Tampering | high | mitigate | `scripts/uat/phase9-walk.js:69-78` sha256 of `demo.db*`/`control.db*`; `:262-264` temp copies; `:361` `data-integrity` check; `git status --porcelain data/` empty at HEAD | CLOSED |
| T-09-40 | Repudiation | low | mitigate | `test/helpers/held-version.js:1-25` fills only an absent precondition; required by 22 non-contract suites + the precondition suite (self-test H1/H2); not by contract/cross-process/client-* suites | CLOSED |
| T-09-41 | DoS | medium | mitigate | `server.js:396` message ends "Reload the page and try again."; `transitions.js?v=1791628622` on 18 pages; asset-cache-bust green (see UF-1 residual) | CLOSED |
| T-09-42 | Tampering | medium | mitigate | `server.js:468` "clearanceFilter is the ONLY option"; rule in the function body `:480-527`; precondition S1 structural | CLOSED |
| T-09-43 | Tampering | high | mitigate | zod `version` on all 15 POST schemas (see T-09-01); query parse `server.js:429-431`; strict `===` `:516`; precondition E-invalid (null/string/negative/fractional body; empty/non-numeric/negative/fractional query — all 400, record unchanged) | CLOSED |
| T-09-44 | Info Disclosure | medium | mitigate | `server.js:489-496` arming precedes `:497` parse and every return; CR-01 (c), (c2) | CLOSED |
| T-09-45 | DoS | low | accept | `db/resolver.js:137`; precondition T-demo, U2 — AR-09-04 | CLOSED (accepted) |
| T-09-46 | DoS | medium | mitigate | `transitions.js:957` `CONFLICT_QUEUE_CAP = 20`; `:968` overflow returns the raw 409; HP10 | CLOSED |
| T-09-47 | Info Disclosure / Tampering | high | mitigate | `transitions.js:233-248` settle-once, resolves only `session.resolve`; `:526`, `:531`, `:600` settled guards drop late responses; HP2/HP3/HP9/HP11 | CLOSED |
| T-09-48 | Tampering | high | mitigate | `transitions.js:514-516`, `:592-594` `inFlight`; re-fire only from `:842`, `:740`, `:689` click handlers; no timer in any session path; HP8, CF8, dialog test `:229` | CLOSED |
| T-09-49 | Tampering / Integrity | medium | mitigate | `execution.js:49-50` `reloadAfterConflict` (10 call sites); `org.js:614`, `:994` conflict-guarded re-reads; walk `task-discard-keeps-theirs` PASS; C3a | CLOSED |
| T-09-50 | Tampering (XSS) | medium | mitigate | `transitions.js:636` `modal.textContent = ''` rebuild; `:344-354` fixed label table; `:392` `hasOwnProperty`; `:360-370` humaniser on `String(key)`; zero `innerHTML` in `:1-1104`; DT6 | CLOSED |
| T-09-51 | Info Disclosure | high | mitigate | `transitions.js:667` `isWithheld` (`=== null`) evaluated before delete/edit variants; `:693-708` no rows, no Apply/Delete-anyway, Close only; DT8/DT9; walk `withheld-f4` | CLOSED |
| T-09-52 | Tampering (XSS) / Disclosure | medium | mitigate | `transitions.js:171` cap 200; `:484-488` trim, one period stripped, `slice(0, 200)`; `:748`, `:852` `textContent`; DT10, DT12b | CLOSED |
| T-09-53 | Info Disclosure | low | mitigate | `transitions.js:400-429` `buildConflictRows` reads only the payload and `body.currentRecord`; no request issued | CLOSED |
| T-09-54 | Tampering (XSS) | medium | mitigate | `transitions.js:1098` `String(message)`; `:674` `title.textContent`; CF9 | CLOSED |
| T-09-55 | Tampering | high | mitigate | `transitions.js:680-683` Cancel → `settle(null)`; `:925`, `:929` Escape/overlay → `originalRes` (null in confirm state); `:1088` refuses while a dialog is active; CF2, CF10 | CLOSED |
| T-09-56 | Tampering | medium | mitigate | `transitions.js:593-594`; CF8 | CLOSED |
| T-09-57 | Tampering / Integrity | high | mitigate | stamps `transitions.js?v=1791628622` (18 pages), `execution.js`/`due-diligence.js` `1791628622`, `org.js` `1791625638` — all strictly newer than the frozen pre-phase values; asset-cache-bust 11/11; walk `asset-stamps` PASS. Residual UF-1 (low) | CLOSED |
| T-09-58 | Repudiation | low | mitigate | `git show --stat 610c68f` — `09-01-PLAN.md` 38 insertions, 0 deletions | CLOSED |
| T-09-59 | Info Disclosure | low | accept | `walk-evidence/` = 11 screenshots + results.json + walk.log from temp-copy runs; no credential strings present — AR-09-05 | CLOSED (accepted) |
| T-09-60 | Repudiation | medium | mitigate | `09-VALIDATION.md:135-160` every gap/SC row names a green test and a PASS scenario; `results.json` 350 PASS / 0 FAIL | CLOSED |
| T-09-SC (npm installs) | Tampering | high | accept | `git diff dec3400..HEAD -- package.json package-lock.json` empty; `09-RESEARCH.md:94-96` — AR-09-06 | CLOSED (accepted) |
| T-09-SC (Playwright for the walk) | Tampering | low | accept | `package.json` has no playwright entry; used only by `scripts/uat/phase9-walk.js` via the npx cache — AR-09-07 | CLOSED (accepted) |

**Totals:** 61 unique threat IDs (64 register rows incl. multi-facet IDs) — 61 closed, 0 open.
`threats_open` (OPEN with severity ≥ high) = **0**.

## 09-REVIEW findings — disposition check

| Finding | Status in code | Evidence |
|---------|----------------|----------|
| CR-01 (WHERE-layer 409 leaked unfiltered DD record) | fixed | `server.js:489-496` arming; `db/store.js:203-207`, `:482`, `:534`; `db/collections.js:164`; contract CR-01 (a)–(d) |
| WR-01 / WR-02 (double-messaging) | fixed | `execution.js:901`, `:933`, `:965` guarded by `reloadAfterConflict`; `org.js:614`, `:994` |
| IN-01 (attribution across clearance) | accepted | AR-09-03 |
| WR-03 (exit during in-flight reapply) | fixed | `transitions.js:919` `exitLocked = () => session.inFlight`; `:519`, `:597` exit buttons disabled; WR03a–c |
| WR-04 (non-numeric stored version) | fixed | `db/collections.js:189-191` `comparableVersion`; SQL mirror `db/store.js:394`; `:430`, `:483`, `:526`, `:535`; `server.js:515`; `transitions.js:14`; WR-04 (a)–(c) |
| IN-02 (comment overstated guarantee) | fixed (comment) | `transitions.js:251-256` |
| IN-03 (body/query disagreement) | fixed | `server.js:422-425` `mismatch` → `:502-505` fixed one-key 400; `transitions.js:453-458` rewrites both channels; IN-03 (a)/(b), client IN03 |
| IN-04 (focus trap) | fixed | `transitions.js:858-896`, `:922-926`; IN04a–c |
| IN-05 (503 double-message) | fixed | `transitions.js:1034`, `:554-558`; IN05a/b |

## Accepted Risks

| ID | Threat | Rationale | Accepted by | Date | Auditor note |
|----|--------|-----------|-------------|------|--------------|
| AR-09-01 | T-09-06 | 409 `changedBy` is a fellow deal member's username shown to a caller who already holds the record (D-04); it is what makes resolution a conversation at 15-person scale | Karsten (D-04, 2026-08-11) | 2026-08-11 | still valid |
| AR-09-02 | T-09-11 | Synergy initiatives and manually-created tasks are visible to every deal member who can reach the Execution Hub; echoing them to the caller who just wrote them adds nothing. For tasks/RAID CONVERTED from a clean-room source the premise is narrower than the code (they carry `clearanceArea`, reads are filtered) — that facet is the pre-existing write-path gap tracked as REQUIREMENTS AUTHZ-03 (Phase 11); Phase 9 did not widen it (UF-2) | planner 09-02 (2026-08-11); narrowed by this audit | 2026-10-10 | valid with the UF-2 caveat |
| AR-09-03 | T-09-17 (attribution) / IN-01 | A withheld DD record still discloses who changed it and when, never what — the dialog needs the fact of the conflict to be truthful; metadata only, values withheld | orchestrator (09-REVIEW resolution, 2026-08-11) | 2026-08-11 | confirmed at this gate |
| AR-09-04 | T-09-45 | `req.isDemo === true` is set only by `db/resolver.js:137` for the demo store; demo stays lenient so the committed `demo.db` is never force-stamped (D-09) | planner 09-10 | 2026-10-10 | still valid |
| AR-09-05 | T-09-59 | Committed walk evidence is synthetic data on temp copies of the demo/control DBs using only the published demo credentials | planner 09-16 | 2026-10-10 | still valid (no credential strings in the files) |
| AR-09-06 | T-09-SC (npm) | No package installed, upgraded or newly relied upon this phase | planner 09-01..07 | 2026-08-11 | verified empirically (empty diff) |
| AR-09-07 | T-09-SC (Playwright) | Pre-existing npx-cache install used only by the UAT walk; not in package.json, not in the turnkey runtime path | planner 09-08 | 2026-10-10 | still valid |

## Unregistered flags

New attack surface or residuals found by this audit that no plan's threat model names. Neither is HIGH;
neither counts toward `threats_open`.

| ID | Severity | Finding | Evidence | Recommended action |
|----|----------|---------|----------|--------------------|
| UF-1 | low | `public/js/transitions.js` was modified in five commits AFTER its cache stamp `1791628622` was set (`522eb1b`): `013b691`, `a6ef9e7`, `a5f6f4b`, `c343aa8`, `a2caf0c` — 85 insertions / 4 deletions (IN-03 both-channel rewrite, IN-04 focus trap, IN-05 busy banner). A browser that cached the `522eb1b` build under the same stamp keeps it. Only un-released local commits share the stamp (any pre-phase client holds an older stamp, so T-09-57's registered vector is still closed), and `test/asset-cache-bust.test.js` cannot see post-bump edits because its table is frozen at pre-09-15 values. `execution.js`/`due-diligence.js`/`org.js` stamps are at or after their last change. | `git log 522eb1b..HEAD -- public/js/transitions.js`; `git log -S'transitions.js?v=1791628622' -- public/*.html` | Bump the `transitions.js` `?v=` stamp on all 18 pages before the v2.2.0 release cut (or in the next commit touching it); consider a test that asserts each asset's stamp commit is not older than the asset's last-change commit. |
| UF-2 | medium (pre-existing; transferred) | Tasks and RAID entries converted from a DD finding / flight-risk entry carry a clean-room `clearanceArea` (`server.js:4376-4395` `resolveTaskClearanceArea`, `:4403` `reportTaskRows`, `:4420` `reportRaidRows`) and are filtered on every read/export, but `POST /api/integration-tasks` (`:3205`), `POST /api/raid` (`:4435`) and their DELETE siblings have no clearance gate. A write-role deal member without the area grant who already knows such a record's id therefore receives the full converted record in the 409 body (`:517-525`, no `clearanceFilter` at `:3216`/`:4444`) — exactly as the existing 200 body already returns it (`:3236` `{ success, task }`, `:4459` `entry: item`). Phase 9 adds no disclosure beyond the pre-existing 200 path; ids are non-enumerable (`:886-888`) and never listed to an uncleared caller. The plans' premise "tasks/RAID are not area-gated" (T-09-04, T-09-11) is stale for converted records. | REQUIREMENTS.md:42 AUTHZ-03 explicitly covers "write, delete and 409 bodies"; `:181` Phase 11 Pending; 09-08-PLAN GD-14 | Phase 11 AUTHZ-03 planner: extend `conflictIfStale()` callers for task/RAID with a `clearanceFilter` built from `resolveTaskClearanceArea`/the RAID twin, and add `integrationTasks`/`customIntegrationTasks`/`raidEntries`/`customRaidEntries` to a provenance-aware `CLEARANCE_SCOPED_COLLECTIONS` rule so the WHERE layer fails closed for them too. No action required for Phase 9 close. |

## Audit Trail

| Date | Event | Result |
|------|-------|--------|
| 2026-08-11 | Round 1 code review | CR-01 (WHERE-layer DD leak) found and fixed `fb20b2b`; WR-01/02 fixed `0acb509`; IN-01 accepted |
| 2026-10-10 | Round 2 code review (gap closure) | WR-03 `522eb1b`, WR-04 `013b691`, IN-02 `a6ef9e7`, IN-03 `a5f6f4b`, IN-04 `c343aa8`, IN-05 `a2caf0c` — all fixed |
| 2026-10-10 | Security gate (this document) at `0f56e6a` | SECURED — 61/61 closed, `threats_open: 0`; UF-1 (low) and UF-2 (medium, pre-existing, → AUTHZ-03) recorded as non-blocking flags |
