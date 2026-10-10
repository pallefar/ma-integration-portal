# Phase 12 — carry-ins to later phases

Open items from `12-SECURITY.md` (SC-nn, AR-12-nn), `12-VERIFICATION.md` and `12-REVIEW-FIX.md`. A phase's planner reads its row.

| # | Item | Source | Owner phase | What the owner must do |
|---|------|--------|-------------|------------------------|
| 1 | Archiving a deal releases member sessions whose next write lands in the shared demo copy, unaudited (new door into the unbound-session seam, Phase 11 carry-in #2) | SC-02 (medium) | **17** (+ re-test **23**) | Real mode has no unbound data lane; archived-deal sessions get a "deal closed" state, never the demo lane. |
| 2 | A sealed partition whose trailing rows (incl. the seal row) were truncated shows `sealed:false` with no tamper event; only `audit-verify` / re-seal flag it | SC-01 (low) | **20** | Record a tamper event when a previously sealed partition reads unsealed; keep fail-closed. |
| 3 | Export backpressure leaks one `once('close')` listener per drained chunk (`MaxListenersExceededWarning` on a 12 MB export) | SC-04 (info) | **20** | One listener per export. |
| 4 | `/api` list responses carry no `Cache-Control` (ETag is per-caller) | SC-05 | **13** (SAFE-07 `no-store`) | Covered by D-13-06. |
| 5 | `/healthz` is unauthenticated and reveals which schema families are open (fixed tokens) | SC-06 | **20** (`/readyz`) | Decide minimal public body vs authenticated detail. |
| 6 | `scripts/perf/lib/volume-deal.js` opens a DB directly outside the `openDbFile` choke point (scratch copy only, export-ignored) | SC-03 | **20** | Route through the guard-aware helper. |
| 7 | Write-latency margin after WR-01 (`synchronous=FULL` + `fullfsync` on macOS): 40.8 ms measured on a contended disk vs the 40 ms budget (27.6 / 14.3 quiet) | verifier warning | **12 refresh / 21** | Re-measure quiet; if over, drop `fullfsync` but keep `FULL`; record the cost in DEPLOYMENT.md. |
| 8 | Pack renderer cold start: `getReportPack()` lazy-requires on the main thread once (one 2.6 s `/healthz` stall seen on a fresh process) | verifier warning | **20** | Warm the renderer in the worker at boot (bounded) or document. |
| 9 | 40-client event-loop p99: RAID create still parses/re-stringifies the whole lane (~13 ms main thread at 5.3k rows) and unparameterized `GET /api/raid` pays a SHA-1 ETag + UTF-8 encode of 1.7–3 MB | 12-14 finding 1 | **12 (decision pending) / 18** | Fresh-deal-per-run profile applied; if still over: store single-record write path + cheap ETag; UI paging in 18. |
| 10 | `scripts/test-gate.js` / suite tightens committed `data/control.db` mode to 0600 (bytes unchanged) | 12-14 finding 4 | **21** | Document in the release notes; release zips take bytes from `git archive`. |
