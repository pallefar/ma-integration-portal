---
phase: 12-data-layer-integrity-performance
plan: 04
subsystem: infra
tags: [worker_threads, event-loop, performance, report-pack, pdf-parse, rate-limiting, perf-harness]

requires:
  - phase: 08-concurrency-storage-foundation
    provides: "central 503 contention contract + client busy-retry wrapper (transitions.js attemptFetch); D-03 storage stays synchronous on the main thread"
  - phase: 11-authorization-and-access-hardening
    provides: "read policy for the pack and rag routes, no-get-mutates GET gate (kept unchanged)"
provides:
  - "lib/isolatedTask.js: lease-based one-in-flight worker_thread runner (refuse, never queue; timeout terminate + respawn; unref'd while idle)"
  - "GET /api/reports/pack renders in lib/workers/report-pack-worker.js; second concurrent request -> 429 + Retry-After: 5"
  - "POST /api/rag/upload parses PDFs in lib/workers/pdf-text-worker.js behind the same guard"
  - "permanent 'PDF pack generation is unavailable on this host platform' 503 carries retryable:false; client does not retry or toast it"
  - "scripts/perf/lib/instrumented-server.js + server-child.js: isolated, event-loop-instrumented server harness reused by every Phase 12 perf script"
  - "scripts/perf/pack-isolation.js: PRD acceptance 5 measurement"
affects: [12-02 write-latency perf script, 12-11 pack route data reads, 12-03 asset stamper (transitions.js stamp), 12-15 test gate]

actuals:
  tokens: 19200
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "CPU-bound request work runs in a persistent unref'd worker_thread behind a lease; a second concurrent caller is refused 429, never queued"
    - "worker modules require only worker_threads + their render library (no db/fs/net) - asserted by source scan"
    - "permanent-failure 503s carry a body marker (retryable:false); clients key on the marker, never the status alone"
    - "perf scripts take two independent event-loop measures (histogram + heartbeat) and assert on the larger"

key-files:
  created:
    - lib/isolatedTask.js
    - lib/workers/serve.js
    - lib/workers/report-pack-worker.js
    - lib/workers/pdf-text-worker.js
    - scripts/perf/lib/server-child.js
    - scripts/perf/lib/instrumented-server.js
    - scripts/perf/pack-isolation.js
    - test/cpu-isolation.test.js
    - test/perf-harness-guards.test.js
  modified:
    - server.js
    - public/js/transitions.js
    - test/client-busy-retry.test.js
    - test/asset-cache-bust.test.js
    - "public/*.html (18 pages: transitions.js ?v= stamp 1791800101 -> 1791900001)"

key-decisions:
  - "Both workers ship in thread mode (PD-14): @napi-rs/canvas and pdf-parse were probed inside a worker_thread on this host and load and run there; the process-mode fallback is NOT built and asking for it throws rather than silently running in-process"
  - "Lease object instead of a boolean tryAcquire: release() is idempotent and per-lease, so a late double release can never free a slot a newer request now holds"
  - "A refused second request is 429 + Retry-After: 5 with a fixed body, never queued (ROADMAP SC5 'refused or queued' -> refused)"
  - "The rag slot is freed right after the CPU-bound parse (before the network-bound AI review); a finally also releases on every error path"

patterns-established:
  - "createIsolatedTask({name, workerFile}) -> tryAcquire() -> lease.run(payload, transferList) -> lease.release()"
  - "Worker modules are just serveWorker(async (payload) => ({ result, transfer }))"

requirements-completed: [DATA-05]

duration: 35min
completed: 2026-10-10
status: complete
---

# Phase 12 Plan 04: CPU isolation (pack render + pdf-parse) Summary

**The steerco pack render and pdf-parse now run in persistent worker threads behind a one-in-flight-per-route guard (second concurrent request refused 429 + Retry-After), measured event-loop p99 of 6-15 ms during a render on a quiet host versus a 240-1,008 ms full stall in-process; the permanent "pack unavailable" 503 carries `retryable:false` and is no longer retried.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-10-10
- **Tasks:** 3 (Task 1 was `type="tracer"`; its automated verify re-ran green before expansion)
- **Files modified:** 31 vs base (9 created, 4 non-HTML modified, 18 HTML stamp bumps)

## Accomplishments

- **Pack render off the loop.** `GET /api/reports/pack` assembles the clearance-filtered model on the main thread (unchanged), posts it to `lib/workers/report-pack-worker.js`, and gets the PDF bytes back as a transferred ArrayBuffer. Filename/Content-Disposition, the 409 empty-deal answer and the single `report-pack-generated` audit event are unchanged; portability cases (a)-(d) in `test/reports-pack.test.js` pass with no edits.
- **One in flight, never queued.** A second concurrent pack request gets `429` + `Retry-After: 5` + `{ error: 'A steering committee pack is already being generated. Try again in a few seconds.' }`; the slot is released on success, on the 409 path and after a worker failure (proved in `test/cpu-isolation.test.js`). `POST /api/rag/upload` has the same guard (`{ success:false, error:'Another PDF is being processed. Try again in a few seconds.' }`).
- **Permanent 503 is not contention.** The pack route's "unavailable on this host platform" 503 carries `retryable:false`; `transitions.js` peeks the body only when `res.clone` exists and returns it at once (1 fetch, no wait, no "not saved" toast). Every pre-existing busy-retry case passes unedited.
- **Reusable perf harness.** `scripts/perf/lib/instrumented-server.js` forks an isolated real server with event-loop-delay instrumentation, refuses `data/` paths and < 1 GB free, and is what `pack-isolation.js` (and the other Phase 12 perf scripts) build on.

## Worker mode that shipped (PD-14, checker W-9)

| Task | Worker module | Mode shipped | Probe |
|------|---------------|--------------|-------|
| report-pack | `lib/workers/report-pack-worker.js` (`@napi-rs/canvas`) | **thread** | canvas + `lib/reportPack` loaded in a `worker_thread` on darwin-arm64 / Node 22.18.0; real pack rendered 200 `%PDF-`; locked in as a permanent test ("PD-14 probe: the pack renderer runs INSIDE a worker_thread") |
| rag-pdf | `lib/workers/pdf-text-worker.js` (`pdf-parse` 2.4.5 / pdfjs-dist) | **thread** | extracted "Integration Guidelines Test PDF" inside a `worker_thread`; no pdfjs fake-worker or dynamic-import error; permanent test ("PD-14 probe: pdf-parse loads and extracts text INSIDE a worker_thread") |

`mode: 'process'` (child_process.fork) is therefore **not implemented** — the plan reserved it for a probe failure, which did not happen. `createIsolatedTask({ mode: 'process' })` throws "not implemented" so a future platform failure fails loudly instead of silently running on the main thread. **Residual risk:** only darwin-arm64 was probed. The other shipped platforms (win32-x64, linux-x64) were not run here; if a worker load fails there, the pack/rag routes return the generic 500 (and the pack still has its 503 gate for a missing canvas binding). The first thing to do on such a platform is implement process mode behind the same API.

## Measured event-loop delay during a pack render (PRD acceptance 5)

Data set: deal with 40 RAID rows (400-char notes) + 30 tasks, real write routes, 25 ms `GET /api/auth/me` pinger, 5 ms event-loop sampling (an idle loop already reads ~5.5-6 ms; figures are NOT adjusted down, so the 50 ms budget is the strict one). Host: darwin-arm64, 11 CPUs, shared with other executors.

**Before** — base tree `88cab66` (in-process render), same script with `--baseline`, `PERF_SERVER_ROOT` pointing at a symlinked scratch tree holding the base `server.js` (5 rounds):

| Round | render | server loop stall (heartbeat) | client ping max |
|-------|--------|-------------------------------|-----------------|
| 1 | 239.8 ms | 238.6 ms | 215.4 ms |
| 2 | 313.8 ms | 312.8 ms | 294.7 ms |
| 3 | 355.3 ms | 333.1 ms | 337.1 ms |
| 4 | 1008.0 ms | 1001.0 ms | 989.8 ms |
| 5 | 401.9 ms | 387.6 ms | 376.8 ms |

The whole render is one uninterrupted main-thread stall (the review's 2,397 ms was a larger/slower measurement of the same effect). Note: Node's `monitorEventLoopDelay` histogram **missed** the stall in rounds 2 and 4 (histogram max 13.9 / 25.3 ms against a real 313 / 1,001 ms stall) — which is why the harness now also keeps a plain 5 ms heartbeat and asserts on the larger of the two.

**After** — `node scripts/perf/pack-isolation.js --assert` (final committed script), exit 0:

```
warm-up pack: 200, 473678 bytes
idle (1 s, pinger only): eld p50 5.7 p99 6.4 max 16.6 ms (heartbeat p99 6.8 max 16.6) | ping p99 5.9 ms

round 1: render 166.5 ms (A=200 %PDF-, B=429 Retry-After=5) | event loop p50 5.7 p95 5.8 p99 10.6 max 10.6 ms [histogram p99 6.5 max 6.5; heartbeat p99 10.6 max 10.6] | ping p99 3.6 max 3.6 ms (6 pings) | rss 294 MB
round 2: render 141.8 ms (A=200 %PDF-, B=429 Retry-After=5) | event loop p50 5.7 p95 5.8 p99 6.0 max 6.0 ms [histogram p99 6.0 max 6.0; heartbeat p99 5.9 max 5.9] | ping p99 3.2 max 3.2 ms (5 pings) | rss 296 MB
round 3: render 133.6 ms (A=200 %PDF-, B=429 Retry-After=5) | event loop p50 5.5 p95 5.7 p99 5.7 max 5.7 ms [histogram p99 5.7 max 5.7; heartbeat p99 5.7 max 5.7] | ping p99 1.6 max 1.6 ms (5 pings) | rss 298 MB

worst round: event loop p99 10.6 ms, max 10.6 ms (budget p99 <= 50 ms; baseline blocked 2397 ms)
PASS: every round event-loop p99 <= 50 ms, second concurrent request refused 429 + Retry-After.
```

Other passing runs of the same script during development: worst-round p99 14.9 / 14.2 / 9.1 / 6.1 ms. In every passing run the concurrent pack B was `429 Retry-After=5` and pack A a valid `%PDF-`.

**Honest caveat — this host was CPU-starved for part of the session** (1-min load average 20-27 on 11 CPUs: other executors' suites, a Swift build, headless Chrome). Two runs made under that load FAILED the 50 ms assertion (worst-round p99 84.5 ms and 133.5 ms; renders stretched to 2.1-2.7 s). Those runs also showed an *idle* floor of p99 23-43 ms / max 55 ms with only the pinger running, i.e. they measure OS scheduling noise, not the code. The script prints a WARNING when load exceeds the CPU count so a loaded-host failure is not mistaken for a regression. **The verifier should re-run `node scripts/perf/pack-isolation.js --assert` on a quiet host.**

## Task Commits

1. **Task 1 (tracer): pack render in a worker end to end** - `ea31fde` (feat)
2. **Task 2: pdf-parse in a worker + non-retryable 503 marker** - `28fc13d` (feat)
3. **Task 3: instrumented-server harness + pack-isolation.js** - `91e2cab` (feat)

**Plan metadata:** committed with this SUMMARY (docs).

Tracer gate: Task 1's automated verify (`cpu-isolation`, `reports-pack`, `busy-503-contract`, then full suite 1277/1277) re-ran green; logged "Tracer verified end-to-end — expanding" and continued (per the dispatch's tracer policy).

## Files Created/Modified

- `lib/isolatedTask.js` - lease-based single-slot worker_thread runner; BusyTaskError/TaskTimeoutError/TaskWorkerError
- `lib/workers/serve.js` - worker-side request/response loop (requires only worker_threads)
- `lib/workers/report-pack-worker.js` - `buildPack(model)` inside the worker; bytes transferred back
- `lib/workers/pdf-text-worker.js` - pdf-parse `getText()` inside the worker; document destroyed per job
- `server.js` - pack route (guard, worker render, `retryable:false`, `finally` release) and rag upload route (guard, worker parse); two `createIsolatedTask` instances next to their handlers
- `public/js/transitions.js` - `isPermanentUnavailable()` peek ahead of the busy-retry decision
- `scripts/perf/lib/server-child.js`, `scripts/perf/lib/instrumented-server.js`, `scripts/perf/pack-isolation.js` - perf harness
- `test/cpu-isolation.test.js` (22 cases: task contract, 200/429/409/500, rag 200/429/500, permanent 503 body, worker-graph and test-hook source scans), `test/perf-harness-guards.test.js` (5), `test/client-busy-retry.test.js` (+3), `test/asset-cache-bust.test.js` (frozen table)

## Decisions Made

- thread mode for both workers; process mode deliberately not built (see above).
- 429 refusal, not a queue (ROADMAP SC5 allowed either; D-12-05 "never queued unboundedly").
- The model crosses to the worker by structured clone and the PDF comes back transferred; the worker never touches SQLite, audit or the network (asserted by a source scan of all three worker files).
- The `retryable:false` peek happens only when `Response.clone` exists, so the existing harness fakes (status + headers only) keep byte-for-byte Phase 8 behaviour.

## Deviations from Plan

### Auto-fixed / judgement calls

**1. [Rule 3 - Blocking] Lease object instead of a bare `tryAcquire()` boolean + `run()`**
- **Found during:** Task 1 design
- **Issue:** with a boolean slot, request A's late `release()` (after its `run` settled and request B had acquired) would free B's slot, letting two renders overlap.
- **Fix:** `tryAcquire()` returns a lease (or null); `lease.run()` / `lease.release()` are per-lease and idempotent. `task.inFlight()` and `close()` remain. Tested ("release is idempotent and per-lease").
- **Files:** lib/isolatedTask.js, server.js, test/cpu-isolation.test.js. **Commit:** ea31fde

**2. [Rule 3 - Blocking] Crash test hook gated on the main thread (and repeated in the worker), carried in the payload**
- **Issue:** a worker thread reads a *copy* of `process.env` taken when it was spawned, so toggling `MA_TEST_PACK_WORKER_THROW` mid-test would never reach a live persistent worker.
- **Fix:** server.js evaluates `MA_TEST_PACK_WORKER_THROW === '1' && MA_MODE !== 'real'` and sends `testThrow` in the job; the worker also re-checks `MA_MODE !== 'real'`. Source-asserted (T-12-35). **Commit:** ea31fde

**3. [Plan intent] Added `lib/workers/serve.js` (not in files_modified)**
- Shared 25-line request/response loop so each worker is only its render function and the worker require graph stays free of `child_process`. **Commit:** ea31fde

**4. [Plan intent] rag slot freed after the parse, before the AI review**
- The plan said "release in finally"; a `finally` release is kept on every error path, plus an early `lease.release()` right after the CPU-bound parse so a slow Gemini round trip does not hold the "PDF being processed" slot. Idempotent, so no double-free. **Commit:** 28fc13d

**5. [Rule 2 - Critical] Heartbeat cross-check added to the perf harness**
- **Found during:** Task 3 baseline runs — `monitorEventLoopDelay` reported a 7-25 ms max for windows where the client plainly saw a 300-1,000 ms stall. An assertion on the histogram alone could pass spuriously.
- **Fix:** server-child keeps a 5 ms `setInterval` heartbeat; `--assert` uses the larger of histogram p99 and heartbeat p99. **Commit:** 91e2cab

**6. [Rule 1 - Bug] Scratch cleanup race in pack-isolation.js**
- A SIGINT arriving while the normal exit path was already cleaning up returned early and exited over it (scratch dir left behind); a signal during server boot also left the booting child alive to recreate files. Fixed with one shared cleanup promise + `killAllInstrumentedServers()` before the rm; verified by sending SIGINT mid-run (exit 130, 0 scratch dirs, 0 orphan children). **Commit:** 91e2cab

**7. [Gate requirement] 18 HTML pages + `test/asset-cache-bust.test.js` touched**
- `transitions.js` changed, so its `?v=` stamp was bumped 1791800101 -> 1791900001 on all 18 pages and the frozen table updated (as the dispatch instructed, "until 12-03 replaces hand stamps"). **Merge note for the orchestrator:** 12-03 owns the HTML/stamp mechanism and the cache-bust test; expect textual conflicts in those 18 pages and `test/asset-cache-bust.test.js`, and prefer 12-03's side — if hand stamps survive anywhere, the only requirement is that the transitions.js stamp differs from 1791800101. **Commit:** 28fc13d

**8. [Additive] `test/perf-harness-guards.test.js`**
- Locks the T-12-37 rules (data/ refusal, < 1 GB refusal, scratch-dir cleanup present). **Commit:** 91e2cab

**9. [Ordering] `retryable:false` landed in the Task 1 commit**
- The server.js hunk sits next to the pack-route 503; the client half and its tests are in Task 2.

**Total deviations:** 9 (none architectural). **Impact:** none on the route contracts; the portability tests, busy-503-contract, no-get-mutates, rag-upload and client-conflict-dialog suites pass unedited.

## Issues Encountered

- Host CPU starvation during measurement (see caveat above) — handled by the load WARNING, the idle-floor line and a re-run on a quieter window.
- `audit-security-events` known flake: did not appear in any of the 4 full-suite runs.

## Verification

- Final full suite: `node --test` -> **1292 tests, 1292 pass, 0 fail** (base 1262; +30 new cases), ~24 s on a quiet window (107 s once while the host was saturated).
- `node scripts/perf/pack-isolation.js --assert` -> exit 0 (output above).
- `git status --porcelain data/ public/sent_emails/` empty at every commit; no `.db`/-wal/-shm staged; no STATE.md/ROADMAP.md changes.

## Known Stubs

None.

## Threat Flags

None - no new endpoints or auth paths; the two existing routes gained a refusal status. Workers add an in-process boundary only (model in, bytes out); perf scripts fork servers against `os.tmpdir()` scratch only.

## Self-Check: PASSED

- Created files exist: lib/isolatedTask.js, lib/workers/{serve,report-pack-worker,pdf-text-worker}.js, scripts/perf/lib/{server-child,instrumented-server}.js, scripts/perf/pack-isolation.js, test/cpu-isolation.test.js, test/perf-harness-guards.test.js.
- Commits present: ea31fde, 28fc13d, 91e2cab.
