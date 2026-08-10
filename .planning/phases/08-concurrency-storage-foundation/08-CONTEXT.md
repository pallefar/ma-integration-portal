# Phase 8: Concurrency & Storage Foundation - Context

**Gathered:** 2026-08-10
**Status:** Ready for planning

<domain>
## Phase Boundary

The Option-B storage-layer change that gates the whole v2.2.0 milestone: make concurrent writers — overlapping requests in one process, or separate processes on the same host — serialize safely with **zero lost updates** (CONC-01), prove it with a multi-process soak test, and keep the demo showcase and the zero-install committed-DB turnkey bundle intact and behaviorally identical.

In scope: `.immediate()` write transactions + bounded busy-wait, SQLITE_BUSY → `503 Retry-After` server contract, client-side silent retry, multi-process concurrency proof (suite test + soak harness).

NOT in scope: optimistic locking / 409 conflicts (Phase 9), WAL checkpoint management and health/readiness endpoints (Phase 10), process-supervisor / rolling-restart tooling (Phases 10–11), any collaboration features (Phase 12+).

</domain>

<decisions>
## Implementation Decisions

### Architecture (locked upstream — research + requirements, not re-decided here)
- **D-01:** Option B — native SQLite multi-process WAL write-serialization. No broker, no Postgres, host-local, `replicas: 1`. — **Reversibility:** one-way — reversing means the Option A/C architectures the milestone explicitly rejected; a v3.0-scale redirect per `.planning/research/SUMMARY.md`.
- **D-02:** The `readDb()`/`writeDb()` whole-object API and its snapshot-diff merge semantics are preserved exactly — the ~90 endpoint call sites do not change.

### Busy-wait strategy
- **D-03:** Everything stays **synchronous**: `BEGIN IMMEDIATE` transactions with `busy_timeout ≈ 1000ms` doing the waiting inside SQLite. `writeDb()` keeps its sync signature — zero call-site changes, no missed-await bug class. — **Reversibility:** costly — switching to an async retry wrapper later means converting ~90 call sites to `await` and re-auditing every ack path.
- **D-04:** Accepted consequence, eyes open: a contended write blocks that process's event loop for up to ~1s (all users on that process stall). Rare and bounded at ~15-person deal-team scale; do not add async machinery to avoid it this phase.
- **D-05:** Server-side contention budget is **~1 second total**, then give up with `503 Retry-After` — implemented via the busy_timeout, not an app-level retry loop.

### Contention UX & retry policy
- **D-06:** SQLITE_BUSY → `503` + `Retry-After` header is mapped in **one central Express error middleware**, covering every write path (writeDb, sessions, controlStore, audit). New endpoints in later phases inherit the contract for free; a coverage test should assert it.
- **D-07:** Client behavior: **silent auto-retry** in a global fetch hook in `public/js/transitions.js` (which already intercepts same-origin `/api` fetches to inject auth headers). 2–3 retry attempts honoring `Retry-After`; the user never sees routine contention.
- **D-08:** If client retries also exhaust: **error toast via the existing banner/toast pattern** — "Server is busy — your change was not saved. Please try again." Form/page state preserved (no reload, nothing discarded); the user just saves again.

### Serialization scope
- **D-09:** The `.immediate()` + bounded-busy-wait treatment applies to **every SQLite file the app writes** — deal DBs, `demo.db`, `control.db`, `runtime.db` (sessions), `audit.db` — including the direct-SQL writers that bypass `writeDb()` (`db/sessions.js`, `db/controlStore.js`, `db/auditHook.js`). One shared helper inside the existing single pragma contract (`db/dbFiles.js`), not per-module copies.
- **D-10:** Audit keeps its **no-swallow contract under contention**: if the `audit.db` append stays busy after the wait, the whole request fails 503 — a write is never acknowledged without its audit row (the Phase-3 D-11 MNPI invariant). Client retry re-applies the write; acceptable because `writeDb()` re-application of identical content is idempotent. — **Reversibility:** one-way if relaxed — queuing/dropping audit rows breaks the append-only "audit row exists before ack" compliance contract the Fable security reviews verified.
- **D-11:** **Uniform 503 contract on all writes**, control-plane included (login/session creation, deal registry, user admin). No endpoint-specific special cases; the global client wrapper retries them all identically.

### Soak-test shape
- **D-12:** Two proof artifacts: (a) a **fast bounded multi-process test committed into the `node --test` suite** — ~seconds, 2 spawned Node child processes calling `db/store.js` `writeDb()` directly against one shared deal file, hundreds of interleaved writes, zero-loss assertion — runs on every suite run; (b) a **standalone soak harness** (`npm run soak`) run at phase-gate and release.
- **D-13:** The soak harness boots **real `server.js` processes on separate ports over the same `data/` directory** and drives authenticated API writes — proving the whole path end-to-end: auth, validation, audit, busy-wait, 503/Retry-After.
- **D-14:** Soak defaults: **2–3 processes, ~2 minutes**, mixed reads/writes across the co-edited collections; process count, duration, and write rate configurable via env/flags so a release gate can run it harder.
- **D-15:** Pass criteria = the **acknowledged-write invariant**: every write acknowledged as success is present and exact in the final DB (zero silent loss); every rejected write got a clean bounded 503 (never a hang, partial row, or corruption); `PRAGMA integrity_check` passes; the audit trail matches acknowledged writes 1:1. Bounded 503s are allowed — they are the design working, not a failure.

### Claude's Discretion
- Exact `busy_timeout` value within the ~1s budget, `Retry-After` value and jitter, client retry backoff details.
- Internal shape of the shared retry/open helper in `db/dbFiles.js`.
- Soak harness process-orchestration details (spawn mechanics, port allocation, teardown).
- How the demo/turnkey "behaves identically" criterion is verified (existing suite green + demo boot check is acceptable).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture decision (locked)
- `.planning/research/SUMMARY.md` — the Option-B decision, the A/B/C comparison table, the two-change implementation sketch (`.immediate()` + busy handling), pitfalls #1–#3, and validation checkpoints. This is the research that settled the milestone architecture; Phase 8 implements its "Phase 1 + Phase 2 storage" core.
- `.planning/REQUIREMENTS.md` — CONC-01 wording; Out of Scope (network-filesystem SQLite is explicitly forbidden — DB stays on local disk).
- `.planning/ROADMAP.md` §Phase 8 — goal + the three success criteria (multi-process soak proof, bounded 503 retry signal, demo/turnkey intact).

### Storage layer (the code being changed)
- `db/store.js` — snapshot-diff merge (`writeDb()` uses `conn.transaction()`, currently deferred mode — this is where `.immediate()` lands), connection cache, AsyncLocalStorage request binding, audit dispatch and its no-swallow contract (D-11 comment block).
- `db/dbFiles.js` — the **single pragma contract** (`journal_mode WAL`, `synchronous NORMAL`, `foreign_keys ON`, `busy_timeout 5000` — the 5000 changes here). All new busy-wait behavior goes through this one place.
- `db/auditHook.js` — independent audit.db connection; its writes must get the same treatment (D-09) without creating a require cycle.
- `db/sessions.js`, `db/controlStore.js` — direct-SQL writers to runtime.db/control.db covered by D-09.

### Client integration point
- `public/js/transitions.js` — the app-wide same-origin `/api` fetch interceptor (already injects auth headers); D-07's silent-retry hook lands here.

### Testing precedent
- `test/concurrent-write.test.js` — the existing in-process concurrency test (Phase-1 D-04 races); the new multi-process suite test extends this ground.
- `test/write-validation-coverage.test.js` — the route-coverage-test pattern to imitate for asserting the uniform 503 contract (D-06).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `db/dbFiles.js` `openDbFile()` — every SQLite open in the app already funnels through this one function; adding `.immediate()` defaults/busy_timeout change here reaches all files at once.
- `db/store.js` `connectionCache` — one handle per file per process; the multi-process test must NOT reuse it across processes (that's the point — separate OS processes, separate connections).
- `public/js/banners.js` toast pattern — D-08's give-up error surface.
- `node --test` suite (687 passing) + `npm run soak` slot free in package.json scripts.

### Established Patterns
- Snapshot-diff merge already closes same-collection add/delete races within WAL transactions — cross-process safety needs only lock-acquisition semantics (`IMMEDIATE`) + bounded waits, not merge changes (research-verified).
- Coverage tests that fail the suite when a new route escapes a contract (write validation) — replicate for the 503 contract.
- `[security]`-prefixed comments explaining mitigation strategy — required style for the busy/no-swallow logic.
- WAL gotcha (standing rule): a write to a committed `.db` can land only in the gitignored `-wal` sidecar and `git status` will lie — `wal_checkpoint(TRUNCATE)` + diff against HEAD before committing; the WAL pre-commit hook exists (`755be4f`).

### Integration Points
- `writeDb()`'s `conn.transaction(...)` call — becomes `.immediate()`.
- Express error-handling chain in `server.js` — the central 503 middleware (D-06) mounts after routes.
- `transitions.js` fetch wrapper — client retry (D-07).

</code_context>

<specifics>
## Specific Ideas

- The 503 is deliberately framed as "the design working": the soak pass criteria explicitly allow bounded 503s and assert their cleanliness, rather than demanding zero failures (which would only test retry budgets against generated load and flake on slow CI).
- The soak harness must double as a release-gate tool: same script, harder knobs (env/flags), per D-14.

</specifics>

<deferred>
## Deferred Ideas

- WAL checkpoint management / unbounded `-wal` growth under multi-process load — research pitfall #3, scheduled for Phase 10 (Runtime Hardening).
- Health/readiness endpoints and migration-on-boot — Phase 10 (DEPLOY-03).
- Rolling-restart runbook and process-supervisor config — Phases 10–11.
- Optimistic locking (version + 409 + reload-and-reapply UX) — Phase 9 (CONC-02); Phase 8's 503 path is contention, not conflict — keep the two signals distinct.

</deferred>

---

*Phase: 8-Concurrency & Storage Foundation*
*Context gathered: 2026-08-10*
