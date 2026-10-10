---
phase: 12-data-layer-integrity-performance
part: B (read paths, workers, stamps, tooling — plans 12-01/03/04/05/07/09/10/11/15)
reviewed: 2026-10-10T00:00:00Z
base: 88cab66 (pre-12-01)  head: e76c29c
model: Claude Fable 5.1 (second-opinion reviewer, different model than the executors)
depth: deep (cross-file trace + isolated live probes)
files_reviewed: 38
files_reviewed_list:
  - lib/listQuery.js
  - lib/assetStamp.js
  - lib/isolatedTask.js
  - lib/workers/serve.js
  - lib/workers/pdf-text-worker.js
  - lib/workers/report-pack-worker.js
  - server.js (static/HTML region 293-389; rag upload 2512-2596; assessment-status 4209-4348; tasks 4356-4642; synergies 5060-5215; RAID 5690-6012, 7879-7899; org 6100-6215, 6584-6620, 6720-6730, 6960-7057; DD 7091-7400, 7455-7540, 7724-7786; notifications 7789-7877; reports 7917-8267; employees 8333-8356; error middleware 9140-9254)
  - public/js/due-diligence.js
  - public/js/transitions.js (985-1095)
  - db/store.js (290-476 read API)
  - db/dbFiles.js (170-200, 300-366 test-isolation guard)
  - db/dealSeed.js (51-80)
  - scripts/test-gate.js
  - .github/workflows/test.yml
  - .gitattributes
  - scripts/smoke/run.js, scripts/smoke/pages.js
  - scripts/perf/run-all.js, list-reads.js, pack-isolation.js, lib/instrumented-server.js, lib/scratch-deal.js, lib/volume-deal.js
  - test/raid-list-query.test.js, tasks-list-query.test.js (headers), read-collections.test.js (headers), read-sets-execution.test.js, read-sets-org-reports.test.js, dd-workspace-batch.test.js, cpu-isolation.test.js, asset-cache-bust.test.js, test-isolation-guard.test.js, perf-harness-guards.test.js, ci-workflow.test.js
findings:
  critical: 0
  warning: 3
  info: 6
  total: 9
status: issues_found
---

# Phase 12 — Code Review Report, Part B (read paths, workers, stamps, tooling)

**Scope:** D-12-02 proportional reads + list query, D-12-05 CPU isolation, D-12-06 test signal/CI/gate, D-12-07 content-hash stamps, D-12-08 smoke harness, and every converted `server.js` handler. Part A (data/audit core, `12-REVIEW.md`) is not duplicated here.
**Method:** full read of every file above; each converted handler body diffed against the pre-phase baseline (`88cab66:server.js`) with comments stripped; a static scan of every `readCollections(...)` call site against the `db.<key>` / helper touches in its handler; isolated live probes (fresh `mkdtemp`, all `MA_*` overridden, `app.listen(0)`, `test/helpers/deal-fixture.js`, server closed and temp dir removed) for the stamper path handling, projection type edge cases, list paging edges, HEAD/ETag behaviour and the `CollectionNotLoadedError` wire body. No source or test file was modified.

## Executive verdict

**No CRITICAL or HIGH finding.** The clean-room property survives the new read paths: in both list routes visibility runs over the projection *before* filter, `total` and page (verified live and by the suite's existence-oracle tests); the projection-side provenance rule is literally the same function the whole-db readers use, and the live probe confirms the two paths agree even for malformed stamps (object / boolean `clearanceArea` → hidden from everyone, fail-closed). The DD workspace seeds its by-area maps only from granted ids. Every converted handler is a read-set substitution with no semantic change (baseline diff shows identical logic, 404-before-409 ordering, version precondition and audit calls intact). Worker slots are released on every exit path. The test-isolation guard is sound for the leak it was built against and its exemption is scoped to exactly `data/control.db`.

What should be fixed before this ships: one VERIFIED hole in the content-hash stamp invariant (non-normalised dot-segment HTML paths bypass the stamping middleware and are served with the stale hand stamps), and one PLAUSIBLE evidence gap in the perf runner (`npm run perf` can print `PERF PASS` while the 429 contract has regressed). The rest is low-severity robustness.

---

## CRITICAL

None.

## HIGH

None.

## MEDIUM

### WR-B01 — HTML stamp invariant bypass: dot-segment HTML paths fall through to `express.static` with stale hand stamps
**Status:** VERIFIED (isolated live probe)
**Files:** `server.js:321-350` (`publicFileForRequest`, HTML middleware), `server.js:375-389` (`express.static`)
**Scenario:** The HTML middleware returns `next()` whenever `publicFileForRequest()` rejects the path (any `..` segment, any dot-segment, any `/vendor/` prefix). `express.static` (the `send` module) then *normalises* the same path and happily serves the file. So a request whose raw path is not normalised reaches the real HTML with the hand-written stamps the phase explicitly says are "never trusted".
**Repro (raw `http.request`, no client normalisation):**
```
GET /x/../index.html        -> 200, Cache-Control: no-cache, body contains  transitions.js?v=1791900001   (hand stamp, 10 digits)
GET /vendor/../execution.html -> 200,                                        transitions.js?v=1791900001
GET /index.html             -> 200,                                          transitions.js?v=f0eabd798b4f0d1d (content hash)
```
Browsers normalise dot segments before sending, so the practical reach is non-browser clients, scripted fetches and any proxy that forwards the path as-is — but it is exactly the T-12-20 gap (a page pointing at a 30-day-cached stale concurrency/authz client) and it falsifies the documented invariant "every HTML response is rewritten". The `asset-cache-bust` suite cannot see it because `fetch` normalises.
**Fix direction:** make the HTML middleware terminal for every `.html` request: normalise first (`path.posix.normalize(decoded)`), and when `publicFileForRequest()` still returns null answer `404` (or `next()` into a handler that cannot serve HTML) instead of falling through; alternatively mount `express.static` with a `setHeaders`/filter that refuses `.html` so only `sendHtml()` can ever emit a page. Add a raw-socket probe (as above) to `test/asset-cache-bust.test.js`.
**Contract:** D-12-07 / PD-17 ("stamp == hash of served bytes" for every HTML response), T-12-20.

### WR-B02 — `npm run perf` can print `PERF PASS` while the 429 / 200-PDF contract has regressed
**Status:** PLAUSIBLE (code trace)
**Files:** `package.json` (`"perf": "node scripts/perf/run-all.js"`), `scripts/perf/run-all.js:114-149`, `scripts/perf/pack-isolation.js:235-247`, `scripts/perf/list-reads.js:88,135`
**Scenario:** `run-all.js` forwards `--assert` to the scripts only when it was itself invoked with `--assert`; `npm run perf` does not pass it. Without `--assert`, `pack-isolation.js` prints `FAIL: … concurrent pack B was 200, expected 429` and **exits 0**, and `list-reads.js` ignores non-200 responses for its exit code. `run-all.js` then judges only the parsed latency numbers (`budgetMs`), so a run in which the one-in-flight guard silently stopped working (both packs render, p99 still fine on a quiet host) or the list route 500s on some requests ends with `PERF PASS`. 12-14 is documented to assert on that last line.
**Fix direction:** `"perf": "node scripts/perf/run-all.js --assert"` (or have `run-all.js` always forward `--assert`), and additionally fail a script in `run-all.js` when its output contains a line beginning `FAIL:`/`OVER BUDGET` or when `non-200:` is non-zero.
**Contract:** PRD acceptance 5 ("second concurrent pack ⇒ 429") and 2 (p95 budget) evidence rule, D-12-05.

### WR-B03 — `isolatedTask` lease allows a second `run()` that orphans the first job and can terminate the shared worker
**Status:** PLAUSIBLE (code trace; no shipped route does this today)
**File:** `lib/isolatedTask.js:126-146, 164-176`
**Scenario:** `lease.run()` only checks `released`/`held`; it does not check `pending`. A second `run()` on the same lease (or a `run()` issued after a timeout but before `release()`) calls `dispatch()` again, which overwrites `pending`. Job 1's reply is then ignored (`pending !== job`), its promise never settles (caller hangs for ever — no timeout settles it because `settle()` is a no-op for a non-pending job), and when job 1's timer fires it calls `discard(w)` and terminates the worker that job 2 is using, failing job 2 with `worker exited unexpectedly`. The module's own header promises "a poisoned worker can never wedge the route"; a misuse this cheap should be refused loudly.
**Fix direction:** in `run()`, `if (pending) return Promise.reject(new BusyTaskError(name))`; in the timeout callback, only `discard(w)` when `pending === job`.
**Contract:** D-12-05 "hard one-in-flight bound".

## LOW

### IN-B01 — Worker-side protocol: a non-cloneable or missing result crashes the worker instead of being reported
**Status:** PLAUSIBLE
**File:** `lib/workers/serve.js:22-27`
`.then(onFulfilled, onRejected)` — an exception inside `onFulfilled` (`out.result` on `undefined`, or `parentPort.postMessage` throwing `DataCloneError`) is **not** caught by the sibling `onRejected`; it becomes an unhandled rejection in the worker, the thread dies, the main side sees `exit` and respawns. Functionally safe (the caller still gets a `TaskWorkerError`), but it costs a respawn per occurrence and contradicts the comment "a handler failure is reported, never thrown". Fix: chain a trailing `.catch()` that posts `{ id, ok:false, error }`, and guard `out && out.result`.

### IN-B02 — Test-isolation guard: case-variant spelling on a case-insensitive filesystem is not inside `data/`
**Status:** PLAUSIBLE (theoretical; not an accidental-default vector)
**File:** `db/dbFiles.js:313-345`
`path.relative()` and Node's JS `fs.realpathSync` are case-preserving, so `/Users/…/m&a/DATA/runtime.db` is judged outside `<repo>/data` on APFS/NTFS. The guard's threat (a test that *forgets* an override and hits the default `path.join(__dirname,'..','data')`) always uses the canonical spelling, so this does not weaken the R5-04 fix; noting it so nobody later relies on the guard against a deliberately mis-cased path. `fs.realpathSync.native` would close it on macOS.

### IN-B03 — `rewriteAsset` round-trips the file through UTF-8
**Status:** PLAUSIBLE
**File:** `lib/assetStamp.js:103,161`
A JS/CSS file that carries a stamped reference *and* an invalid UTF-8 byte sequence (e.g. a Latin-1 comment) would be served with U+FFFD substitutions. The stamp still equals the served bytes (self-consistent), but served ≠ on-disk. All current assets are valid UTF-8; cheap guard: `Buffer.from(text,'utf8').equals(raw.buf)` check before using the decoded text, else leave the file unrewritten with a one-time warning.

### IN-B04 — Two read-only opens of committed database files bypass the `openDbFile` choke point
**Status:** VERIFIED (code)
**Files:** `db/dealSeed.js:60` (`new Database(templateSourcePath, { readonly:true })`, default template = `DEMO_DB_PATH`), `scripts/perf/lib/scratch-deal.js:33`
Both are read-only and `scratch-deal.js` already cleans up the `-wal/-shm` sidecars a read-only WAL open can create beside the committed file; `dealSeed.js` does not. Under `node --test` the template is the temp `demo.db`, so the test-isolation guard is not undermined; the perf runner (not under the runner) legitimately reads `data/demo.db`. Note it as the known exception list for the "every open passes through openDbFile" claim in `db/dbFiles.js:305`.

### IN-B05 — `scripts/perf/**` ships in release zips
**Status:** VERIFIED (`.gitattributes`)
Only `scripts/smoke/` is `export-ignore`. The perf scripts spawn servers, open the committed `demo.db`/`control.db` read-only and write to `os.tmpdir()`; they are developer tooling with no runtime role. Phase 21 extends `.gitattributes` — add `scripts/perf/ export-ignore` there.

### IN-B06 — Malformed `clearanceArea` values are hidden from everyone, admin included
**Status:** VERIFIED (live probe)
Rows with `clearanceArea: {x:1}` or `true` disappear from `GET /api/raid` and `GET /api/reports/export?dataset=raid` for admin and uncleared pmo alike; projection path and whole-db path agree (fail-closed, consistent). Only reachable by writing to the deal file directly (zod enum guards the API). Acceptable; documenting so a future "admin cannot see a row" report is diagnosed quickly rather than treated as a leak in the other direction.

---

## Checked and sound

- **Clean-room ordering in the list routes** (`server.js:4462-4477`, `5972-6012`; `lib/listQuery.js`): visibility over the projection → exact filters → `q` → `total` → page. `q` over `title`/`notes` of restricted rows answers 0; `total` counts visible rows only; ETag is per-caller body so a 304 cannot cross identities. Suite tests (i)/(e) in both `*-list-query` files assert this with multi-identity fixtures (admin, hrbp, pmo with none/legal/hr grants — not admin-only).
- **One provenance rule, two read shapes**: `clearanceAreaFromProvenance()` is the shared core of `raidRowVisible`/`taskRowVisible`/`resolveTaskClearanceArea`/`resolveRaidEntryClearanceArea`; non-string projected scalars fall back to parsing the row (`typeof` guard), null/undefined finding areas and duplicate finding ids resolve identically on both paths (traced + probed).
- **Byte-identical unparameterised body**: `data TEXT NOT NULL` in every table; no SQL-side JSON mutation in `db/store.js` (no `json_set`), so `raw === JSON.stringify(parsed)`; `res.type('application/json').send()` yields the same `charset=utf-8` header as `res.json()`; `json spaces` is unset. Test (a)/(b) assert bytes, not shape.
- **Zod list parser**: query values that arrive as arrays/objects (`status[]=`, repeated keys, `limit[a]=`) are rejected by `z.string()`; `offset` without `limit` → 400; one fixed `{ error: 'Invalid list query.' }` body; `DIGITS` (max 9) bounds `offset`; `LIMIT_MAX = 200`; `q` ≤ 200 chars, evaluated with JS `toLowerCase().includes` (no LIKE, no regex from input). Unknown keys ignored by design.
- **No SQL interpolation of user input**: `readProjection()` field names come only from route constants, are regex-validated (`/^[A-Za-z][A-Za-z0-9_]{0,63}$/`) and bound as `'$.' + field` parameters — one `json_extract(data, ?)` per line (Phase 9 structural rule honoured).
- **`CollectionNotLoadedError`**: non-enumerable throwing accessors; the wire body is the fixed `{ error: 'Internal server error' }` (probed), never the message naming the collection. Static scan of all 30 `readCollections` call sites: every `db.<key>` / lane helper touched is inside the declared set (`orgSummaryFor` touches decisions/flight-risks only inside the `hr` branch, matching the route's set choice; `employeesBody` touches `courses` only when `req.isDemo`).
- **Converted write handlers** (`POST/DELETE /api/raid`, `/api/integration-tasks`, `/api/dd/request-items`, `/api/dd/findings`, `/api/org/positions`): baseline diff shows read-set substitution only — `assertRecordVisibleOr404` before `conflictIfStale`, clearance-filtered 409 echo, version precondition, audit, 404 byte-identity all unchanged. Suite (k)/(g)/(e) re-prove 201/200/409/404/DELETE on the new sets.
- **DD workspace** (`server.js:7171-7200`): per-area maps seeded only from `grantedAreas()`; rows filtered by `filterByAreaGrant()` before grouping; `mine` from the filtered arrays; one `dd-findings-read` row per real-deal load; identical builders to the per-area routes (suite deep-equals every array). Client `load()` issues exactly one DD request and tolerates a non-object/403 body.
- **Error-middleware ordering**: 404 (RecordNotFound) → non-retryable 503 (`DbNotReadyError`, fixed body, no `Retry-After`) → sealed 409 → busy 503 → conflict 409 → generic 500; each guards `headersSent`. Client `isPermanentUnavailable()` keys on the body marker `retryable:false`, returns the response without retry or give-up toast; 409 handling still keys on `conflict:true`.
- **Workers**: `tryAcquire()` is synchronous and precedes any `await`; `release()` in `finally` on every path (success, 409 empty deal, worker failure, busy-forward); timeout terminates and respawns; idle worker `unref`'d; worker modules require nothing but their renderer (source-asserted); real-mode gate on the crash hook repeated inside the worker; payload bounded by `express.json 50mb` + `LARGE_BLOB_MAX` + 60 s job ceiling; `new Uint8Array(buffer)` copies so the transferred `ArrayBuffer` is never a pool slab.
- **Asset stamper path safety**: strict segment whitelist, explicit `.`/`..` rejection, resolved-path prefix check before any read; cycle guard terminates (static cycle test over `public/`); inserted text is only `[0-9a-f]{16}` so the HTML rewrite is not an XSS surface; dynamic `'?v=' + n` references untouched; HEAD carries no body; ETag/304 works; lockdown gate precedes the HTML middleware and `login.html` is served rewritten while everything else stays 403 (suite, child process, real mode).
- **Test-isolation guard**: lexical + nearest-existing-realpath comparison, `..` and symlinked spellings refused (suite), inert without `NODE_TEST_CONTEXT`, the `MA_TEST_ALLOW_COMMITTED_CONTROL_DB=1` exemption matches exactly `data/control.db` by identity (never `-wal`, runtime, audit, demo, deals, real); real-mode `[security]` refusal still wins. Audit partitions and lifecycle opens go through `openDbFile`.
- **CI workflow**: `permissions: contents: read`, no secrets, no install step, `actions/*@v4` only, `timeout-minutes: 20`, `fail-fast: false`, ubuntu pinned for the glibc floor. Fork PRs get the read-only token and no secrets — no pwn-request surface. `test-gate.js` treats a missing `# fail` summary, a timeout or a non-zero exit as failure; the `NODE_TEST_CONTEXT` recursion guard is tested.
- **Smoke harness**: real-mode server on a `mkdtemp` `MA_DATA_DIR`, bootstrap admin with a generated rotated secret (redacted from output), tools resolved only from outside the repo and never installed, committed `data/*.db` hashed before/after and `git status` of `data/` compared, server child killed and temp dir removed on every path including signals, refuses with < 1 GB free.
- **Perf harness safety**: `assertScratchEnv` refuses any `MA_*` path inside `<repo>/data` and any missing path; committed DBs copied via read-only `backup()`; disk check; cleanup on `finally` + signals (unit-tested).

## Not covered

- Did not re-run the full suite or the perf/soak scripts on this host (load/disk constraints); numbers in the SUMMARYs are taken as reported. Did run targeted isolated probes only.
- Windows / ubuntu execution of the workflow (acknowledged as unverified by 12-15).
- Playwright smoke run and axe results (tooling only; no runtime effect).
- `@napi-rs/canvas` / `pdf-parse` loading inside a `worker_thread` on linux-arm64 and win32 (probed by the executors on darwin-arm64 only).
- pdf-parse worst-case CPU on adversarial PDFs beyond the 60 s terminate-and-respawn ceiling (bounded, not characterised).
- Part A territory: dirty-row `writeDb`, audit partitions/chain, migrations/readiness (`12-REVIEW.md`).

---

_Reviewed: 2026-10-10_
_Reviewer: Claude Fable 5.1 (gsd-code-reviewer, second opinion — Part B)_
_Depth: deep_
