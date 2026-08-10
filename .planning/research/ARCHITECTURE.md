# Architecture Research — v2.2.0 Shared-Host Multi-User Concurrency

**Domain:** Multi-process/multi-user concurrency for an existing Express + better-sqlite3 M&A integration portal
**Researched:** 2026-08-10
**Confidence:** HIGH for all claims grounded directly in `db/store.js`/`db/resolver.js`/`db/dbFiles.js`/`server.js`; MEDIUM (verified against sqlite.org's own WAL documentation) for general SQLite multi-process locking behavior; explicitly flagged where this research corrects the premise stated in the research question.

## Key Finding: The "in-process only" premise needs a precise correction

The question's framing — *"the `__snapshot` merge is in-process only; multiple OS processes writing the same SQLite file would reintroduce the Phase-1 lost-update race"* — is **half right and the half that's wrong matters a lot for the recommendation below.**

Reading `db/store.js` line by line: `writeDb()`'s lost-update protection comes from comparing **the ids in this request's own `readDb()` snapshot** against **the ids in the payload being written**, then issuing real `INSERT`/`UPDATE`/`DELETE` statements *by id* inside one SQLite transaction against the **live, current file** — never against a second in-memory cache of "current state." Nothing about that algorithm's correctness depends on the reader and the writer being the same OS process. It depends on:

1. `readDb()` reading the actually-current committed rows (true under WAL for any process, same or different, via the wal-index — this is exactly what WAL is *for*), and
2. `writeDb()`'s transaction being atomic against the live file (true for any process, via SQLite's own cross-process locking, which is what `journal_mode=WAL` + `busy_timeout=5000` in `db/dbFiles.js`'s `openDbFile()` already configure).

Trace the classic scenario with two different **processes**: Process A reads `[1,2,3]`, deletes id 2 in its own JS memory, writes `[1,3]` — A's snapshot has `{1,2,3}`, so it deletes id 2 (an id neither request "invented," it's the same id in the shared file). Concurrently, Process B (different OS process) also read `[1,2,3]` and adds id 4, writing `[1,2,3,4]`. B's snapshot also has `{1,2,3}` — for id 2, B still thinks it's a normal `UPDATE`; when B's transaction runs (whenever SQLite's writer lock lets it in, possibly *after* A committed), the `UPDATE ... WHERE id=2` affects **0 rows** because A already deleted it — exactly the documented "harmless 0-row no-op rather than a resurrection" (`db/store.js` comment on `CR-02`). Id 4, new to B's snapshot, inserts cleanly. **No corruption, no lost update, regardless of which process ran which request.**

**What genuinely *is* single-process-only** is the `__snapshot` **object itself** — a JS `Map` living in one process's heap, non-enumerably attached to one `readDb()` call's return value (`db/store.js` lines 239–253). That object cannot be handed to a *different* process without serializing it (Maps aren't JSON-native) — but nothing in the current architecture ever tries to. Each request's `readDb()` → mutate → `writeDb()` cycle already runs start-to-finish in whichever single process handled that HTTP request. Scaling to N OS processes doesn't require moving the snapshot across a process boundary; it only requires that N processes independently doing this cycle against **the same file** stay correct — which is exactly what SQLite's own WAL cross-process locking is designed to guarantee, and does, without any code change.

**Where the "WAL corruption" risk is real:** not from "too many processes," but from **network/shared filesystems** with unreliable POSIX advisory-lock semantics (classic NFS, some clustered/Docker-Desktop-on-Windows bind-mount edge cases) — SQLite's own documentation is explicit that WAL requires the filesystem to honor `fcntl` locks correctly, which a local disk (ext4/APFS/NTFS) or a cloud-VM's local/attached block volume does, and a network filesystem often doesn't. This distinction — *same-host-local-disk is safe, distributed/network storage is not* — drives the container-shape caveat under Option B below.

This finding reshapes the whole evaluation: **Option A (broker) is not required to close a real correctness gap that Options B/C would otherwise reopen.** It's an *availability/throughput* choice (single write path, simpler mental model, one place to add a request queue) with real costs, not a *safety* requirement. Evaluate it on those terms.

---

## System Overview — Current (v2.1.0, verified against code)

```text
┌───────────────────────────────────────────────────────────────────┐
│  Single Node process ("node server.js", app.listen() behind        │
│  require.main === module)                                          │
│                                                                      │
│  Express routes ──► dealResolverMiddleware (db/resolver.js)         │
│         │              resolves control.db / demo.db / deals/<id>.db│
│         │              binds ONE connection via AsyncLocalStorage   │
│         ▼                                                           │
│  route handler: readDb() → mutate in JS memory → writeDb(data)      │
│         │              (db/store.js — whole-object facade,          │
│         │               __snapshot diff-merge inside one txn)       │
│         ▼                                                           │
│  connectionCache: Map<resolvedPath, better-sqlite3 handle>          │
│  (process-local; one handle per file per process)                   │
└──────────────────────────┬───────────────────────────────────────--┘
                            ▼
   data/control.db  data/demo.db  data/runtime.db  data/audit.db
   data/deals/<id>.db   (WAL mode, busy_timeout=5000, one host, one disk)
```

Confirmed facts used throughout this document (all read directly from source):
- `server.js` already has `/healthz` (line 665), SIGTERM/SIGINT graceful shutdown with `server.close()` + a 10s hard-kill fallback and `requestTimeout`/`headersTimeout`/`keepAliveTimeout` tuning (lines 6857–6879), and an explicit note that `uncaughtException` is currently **log-only**, flagged in its own comment as needing to become "log-then-exit, let the supervisor restart" for a *supervised* production deploy — directly relevant to any multi-process shape.
- `db/dbFiles.js`'s `openDbFile()` is the **single pragma contract** for every SQLite file the app opens: `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000` — already the correct baseline for cross-process safety, not something that needs inventing.
- `db/resolver.js` binds one connection per request via `AsyncLocalStorage`, refusing membership **at bind time** (never a post-hoc filter) — this is the property that must survive whichever concurrency option is chosen; none of the three options below touch it.
- Sessions (`db/sessions.js`) are a dedicated hashed-token table, **not** part of the whole-object `readDb()`/`writeDb()` collection API — already multi-process-safe by the same WAL mechanism, no special handling needed.
- No `express-session`/`cluster` module dependency exists today (`package.json`: only `better-sqlite3`, `compression`, `express`, `pdf-parse`, `zod`). Any multi-process shape is new plumbing, not a toggle.

---

## Option A — Single-Writer Broker

**Shape:** N "web" processes handle HTTP + reads directly (each opens its own connection to the shared file, same as today, just N of them). Every **write** is proxied to one dedicated writer process that is the *only* process ever calling the real `writeDb()`.

### Integration points against `db/store.js`

- The ~90 existing call sites (`readDb()`/`writeDb()`) must **not** change (matches the codebase's existing D-03 zero-call-site-change discipline). The seam is inside `db/store.js` itself: at process startup, an env var (e.g. `WRITER_ROLE=writer|worker`) selects which implementation `writeDb` resolves to — the real transactional function (writer process) or an RPC stub that forwards to the writer (worker process). `readDb()` stays local/unchanged in every process — reads never need to leave the process, because WAL gives every process's own connection a live, current view of the writer's last commit (no extra staleness beyond ordinary request timing).
- **The real new cost:** the `__snapshot` `Map` captured by a worker's `readDb()` call must cross the process boundary to reach the writer, because `writeDb()`'s diff needs it. Maps aren't JSON-serializable — a worker-side client must convert each collection's snapshot `Map` to an array of `[id, rawJson]` pairs before sending, and the writer-side server must reconstruct it as a `Map` before calling the *real* `writeDb(data)`. This is genuinely new serialization plumbing, not a thin proxy — it's the one piece of engineering this option requires that B does not.
- Transport: recommend a **Unix domain socket** on the host running both writer and workers (measured ~30–45% lower p99 latency than TCP loopback, no port to manage, filesystem-permission-scoped — fits self-managed-host and single-node-container shapes where a socket path/volume is shared). Fall back to loopback TCP (`127.0.0.1:PORT`) only where a shared socket path isn't practical (e.g. some Windows self-managed configurations).
- The audit hook (`db/auditHook.js`) currently runs **inside** `writeDb()` in-process, reading `actor`/`request` off the AsyncLocalStorage-bound context. Under Option A that context (actor identity, request metadata) must also cross the RPC boundary to the writer process — another concrete addition, not automatic.

### New / modified components
- New: `db/writerServer.js` (Unix-socket listener in the writer process; calls the real `writeDb()`), `db/writerClient.js` (worker-process stub that serializes `data` + `__snapshot` + audit `actor`/`request`, sends, awaits result/error).
- Modified: `db/store.js` (dispatch seam for `writeDb`), process bootstrap (`server.js` or a new launcher) to start one writer + N workers.

### Build order
1. Extract the `writeDb`-dispatch seam with a **same-process fake RPC** (function call, not a socket) first — prove the seam introduces zero behavior change against the existing suite before touching transport.
2. Build the Unix-socket writer server/client with a length-prefixed JSON protocol; writer boots first and lazily opens db files exactly like the resolver does today.
3. Convert deployment to N workers + 1 writer (via `cluster`, or N `systemd` instances + one dedicated writer instance) routed through the client.
4. Add reconnect/backoff and a write-path 503 when the writer is unreachable (a *new* failure mode this option introduces — see tradeoffs).
5. Soak-test contention; verify audit rows still land correctly with the cross-process actor context.

### Survival verdict
- **Zero-install turnkey zip:** SURVIVES. Still one committed `.db` file per deal, no external DB server — the "writer" is just another `node server.js`-family process from the same codebase; a launcher script can start two Node processes instead of one.
- **Demo showcase:** SURVIVES unaffected — demo mode doesn't need multi-writer semantics and can either stay single-process or transparently route through the same broker with no behavior change.

### Honest costs
- **New single point of failure for writes**: if the writer process dies, every deal's writes 503 until it's restarted, whereas today a crash only affects the request that caused it.
- Extra network hop on every write (latency), a real new serialization layer (Map↔array bridging) that is a plausible source of subtle bugs, and a second process to supervise, health-check, and graceful-shutdown *in the correct order* (workers must drain before the writer, or in-flight write RPCs hang against a dead socket).
- **Buys little at this app's actual concurrency profile.** Its main benefit — avoiding `SQLITE_BUSY` contention under heavy concurrent writes — addresses a load level (many simultaneous writers) this app (an Integration Lead + a handful of workstream leads on one active deal) is unlikely to reach. See Option B's throughput analysis.

---

## Option B — Cross-Process Advisory Lock (native SQLite WAL write-serialization, hardened)

**Shape:** N OS processes (via Node `cluster`, N `systemd`-supervised instances, or N container replicas on **one host with local/attached disk**) each open their own `better-sqlite3` connection to the same file — exactly today's per-request `readDb()`→mutate→`writeDb()` cycle, just run concurrently by multiple processes. Coordination is SQLite's own engine-level writer lock (already active via WAL), hardened with two small, additive changes.

### Integration points against `db/store.js`

- **No change needed** to `db/resolver.js` or the `connectionCache` — each process's cache is already process-local, and that's correct: it just avoids reopening a file twice within one process, and doesn't conflict with a second process's own cache/connection to the same file.
- **Two targeted changes inside `writeDb()`:**
  1. Force `conn.transaction(applyWrite)` to acquire the write lock at transaction *start* rather than escalating mid-transaction: better-sqlite3 exposes this as `.immediate` on the transaction function (`conn.transaction(applyWrite).immediate(data)`). This fails fast under contention instead of the default deferred-then-upgrade behavior, which is the standard recommendation for any write-heavy multi-process SQLite app.
  2. Wrap the call with a small busy-retry helper: catch `err.code === 'SQLITE_BUSY'`, retry with jittered backoff a few times (the existing `busy_timeout=5000` already retries at the C level before throwing; this adds an app-level fallback and, on final failure, maps to an HTTP `503` + `Retry-After` rather than a bare `500`).
- No change to the `__snapshot` merge algorithm itself — per the Key Finding above, it already works correctly for N processes because each process's snapshot never leaves that process.

### New / modified components
- Modified: `db/store.js` (`.immediate()` + busy-retry wrapper — small, additive, no call-site changes).
- New (optional): `db/busyRetry.js` helper module.
- New: a process-supervisor config (systemd unit template with multiple instances behind a proxy, or a `cluster`-module primary). **No new IPC layer, no new broker process.**

### Build order
1. Add `.immediate()` + busy-retry to `writeDb()`. Write a **new test class** that opens two real `better-sqlite3` connections to the same temp file from two Node processes (or two worker threads as a proxy) and hammers concurrent writes — this is a genuinely new test category; Phase 1's tests only ever exercised one process.
2. Run the app as N real OS processes locally (`node server.js` × 3 sharing one `data/` dir behind a small round-robin proxy) and soak-test.
3. Layer the version-column optimistic-locking change on top (see below — independent of A/B/C).
4. Wire into the target deployment shape: systemd multi-instance + nginx `upstream`, or `cluster`-module workers.

### Throughput cost
Negligible at this app's scale. SQLite full write serialization (every writer takes turns) costs almost nothing when each write is a small single-collection diff (sub-millisecond to low-single-digit-ms) and the realistic write rate is a handful of named users occasionally saving a task/RAID entry/synergy update — several orders of magnitude below SQLite's documented sustained-write ceiling on local SSD/NVMe (SQLite's own WAL documentation and cross-checked general guidance both describe multi-writer serialization, not multi-writer parallelism — writes queue briefly, they don't corrupt or block indefinitely given a sane `busy_timeout`).

### Survival verdict
- **Zero-install turnkey zip:** SURVIVES. Identical file-per-deal committed-`.db` model; the shipped executable's *shape* doesn't change — it's just runnable as N copies.
- **Demo showcase:** SURVIVES unaffected — demo mode never needed multi-process writes, but would be safe for free if ever run that way.

### The one sharp edge to flag for the container/platform shape
This option is **host-local only**: every writer process must share the *same local filesystem* (real POSIX/NTFS advisory locking). It is explicitly **not** safe over NFS or most network-attached/shared-cluster filesystems, and — critically for a container platform — **not safe with N>1 replicas each on a different node with their own disk** (a Kubernetes `Deployment` with `replicas: 3` and no shared volume silently diverges into three independent copies of the data with no coordination at all; even a shared `ReadWriteMany` volume is usually NFS-backed, which is exactly the unreliable-locking case). **Recommendation for the container shape under Option B: pin to `replicas: 1`** with a persistent local/attached volume — this is not a limitation invented for this milestone, it's the existing single-process story unchanged, just running in a container. N>1 replica horizontal scaling is *only* safely achievable under Option A (broker, still single-writer under the hood) or Option C (Postgres).

---

## Option C — Postgres Migration

**Shape:** Replace `better-sqlite3`/`db/store.js`'s internals with a Postgres-backed store.

### What breaks, concretely

- **The whole-object `readDb()`/`writeDb()` signature.** The ~90 call sites depend on getting a full in-memory array per collection and handing back a mutated version wholesale. Two paths:
  - **C1 (facade-preserving):** Reimplement `writeDb()`'s internals against Postgres using the *same* id-diff algorithm (SELECT all rows per collection table ordered by `seq`; INSERT/UPDATE/DELETE by id inside one `BEGIN`/`COMMIT`) — preserves all ~90 call sites unchanged. This is the **only realistic path** without a full route-by-route rewrite.
  - **C2 (Postgres-native):** Rewrite every write endpoint to do targeted `UPDATE ... WHERE id=$1` calls instead of whole-collection round-trips — architecturally cleaner, but touches every one of the ~90 write endpoints individually. **Out of scope for this milestone**; a future initiative in its own right.
  - Recommend C1 as the only viable scope if C is ever chosen.
- **`__snapshot` merge → row-level concurrency.** Under C1 the same diff algorithm ports almost verbatim (it's just SQL dialect). Postgres's real advantage is that `UPDATE ... SET data=$1, version=version+1 WHERE id=$2 AND version=$3` is the idiomatic, first-reached-for pattern there — but this exact pattern is equally achievable on SQLite (see the optimistic-locking section below). **Postgres is not required to get optimistic locking** — that's a separate, portable feature, not a reason to migrate.
- **File-per-deal → schema/row scoping.** SQLite's one-file-per-deal model gives *free* physical isolation: a bug literally cannot cross-deal-write because the connection was never opened against another deal's file (`db/resolver.js`'s bind-time refusal, the app's core MNPI-isolation property). Postgres has no per-file analog. Two options:
  - **Schema-per-deal** (`CREATE SCHEMA deal_xyz`, per-request `SET search_path`) is the closer analog — a connection literally can't see another deal's tables without an explicit path change, preserving "can't accidentally open the wrong deal" *by construction*.
  - **Shared tables + a `deal_id` column filtered in every query** is the common multi-tenant SaaS pattern, but reintroduces exactly the bug class `db/resolver.js` was built to make structurally impossible — a missed `WHERE deal_id=?` becomes a cross-deal MNPI leak discoverable only by code review, not by the architecture. Given this app's explicit MNPI/clean-room framing, **recommend schema-per-deal over shared-table-with-deal_id** if C is ever pursued — this is a real, non-obvious migration cost a superficial "just add a column" plan would silently give up.
- **Committed `.db` + zero-install turnkey zips.** **Breaks outright.** A turnkey zip today ships a portable Node + the app + a committed SQLite file — no server process to install. Postgres requires a *separately running database server*, an entirely different binary outside Node's process model. The closest zero-install analogs (bundling a portable Postgres + auto-`initdb`, or an embedded/WASM Postgres like pglite) are exotic and unproven for this app's needs — a new engineering surface on their own, not a drop-in swap.
- **The demo showcase's committed `demo.db`.** The demo's whole value proposition — a double-click showcase with pre-seeded, git-committed, diffable data — is SQLite-native. A Postgres dump/restore step is a materially worse showcase experience for a sales artifact that today "just works." Realistic path: **keep demo mode on SQLite permanently**, matching PROJECT.md's own "demo mode is a maintained deliverable" constraint, and make Postgres an opt-in backend *only* for real-deal mode on the container/platform shape.

### New / modified components
- New: `db/pgStore.js` (Postgres-backed C1 facade), a driver-selection seam (`STORAGE_BACKEND=sqlite|postgres`) in `db/store.js`, a real versioned migration runner (Postgres schema changes are a first-class ops concern SQLite's ad hoc `CREATE TABLE IF NOT EXISTS`-on-open never had to be), connection pooling (`pg`/`pg-pool` — Postgres connections are expensive relative to SQLite's in-process handle; every process needs a *pool*, not one handle per file).
- **Must-port, currently overlooked if scoped narrowly:** `db/auditHook.js`, `db/sessions.js`, `db/controlStore.js` are raw hand-written SQLite SQL *outside* the whole-object facade (`?` placeholders, `PRAGMA` calls, SQLite-specific `ON CONFLICT` syntax) — none of it is portable verbatim to Postgres. This is real, easy-to-underestimate scope.

### Build order (only if pursued)
1. Stand up Postgres + pooling in dev/CI.
2. Build `db/pgStore.js` behind the identical facade signature; prove one collection's CRUD round-trips against the existing suite by swapping the store under it.
3. Port `auditHook.js`/`sessions.js`/`controlStore.js` to Postgres dialect.
4. Design schema-per-deal provisioning + a real migration runner.
5. Add the backend-selection seam; keep SQLite as the demo/app-only default.
6. Full regression suite against the Postgres backend.
7. Container image + connection-string/secret wiring + a readiness check that verifies Postgres reachability, not just process liveness.
8. Rebuild backup/restore tooling — SQLite's "copy the file" story disappears; need `pg_dump`/managed-snapshot tooling instead.

### Survival verdict
- **Zero-install turnkey zip:** **DOES NOT SURVIVE** for real-deal mode as currently defined (self-managed/app-only shapes) — a Postgres decision either retires those shapes for real-deal mode or requires redefining "app-only" as "app + operator-provisioned Postgres," a scope decision this research surfaces rather than assumes.
- **Demo showcase:** should stay on SQLite regardless of this decision — not a Postgres migration, a *dual-backend* addition, which is why PROJECT.md itself already flags this as bump-to-v3.0-scale scope, not a v2.2.0-sized change.

---

## Optimistic Locking (version column) — layers onto any of the three, independently

`PROJECT.md` names this as a **separate** deliverable ("optimistic locking on co-edited records — version + 409 + reload UX") from the multi-writer architecture decision, and it should be planned that way: it's a business-level co-edit-conflict UX, not a storage-engine safety mechanism. SQLite's write lock (Options A/B) already guarantees the *database* can't be corrupted by concurrent writers; it does nothing to stop User A's stale read from silently overwriting User B's just-saved edit with old data — that's what optimistic locking is for.

- **Schema:** add `version INTEGER NOT NULL DEFAULT 1` per mutable row (or reuse an `updated_at` timestamp — an integer version is simpler to reason about and compare).
- **Read path:** every GET response includes the row's current `version`.
- **Write path:** the client echoes back the version it last read. Inside `writeDb()`'s existing per-item diff loop, the branch that currently does an unconditional `UPDATE key SET ... WHERE id=?` (id already in this request's own snapshot) becomes `UPDATE key SET ..., version=version+1 WHERE id=? AND version=?` (binding the version this request's snapshot captured). `better-sqlite3` exposes `.changes` (rows affected): **0 changes** now means one of two things that must be *distinguished*, not conflated — the row was concurrently **deleted** (today's existing `CR-02` no-op case, harmless) or its **version moved** (a genuine co-edit conflict needing a 409). A follow-up `SELECT` to tell these apart is the one real addition to the merge algorithm's per-item branch.
- **This is identical work on SQLite (Options A/B) or Postgres (Option C)** — Postgres's `UPDATE ... WHERE id=$1 AND version=$2 RETURNING *` is the same shape, just idiomatic Postgres syntax. Postgres is not needed to get this feature; it should not factor into the A/B/C decision at all.
- Sequence this as its **own phase, after** the concurrency-architecture decision is locked in (since it touches the same `writeDb()` per-item loop Option A/B would also touch), but its design is unaffected by which of A/B/C wins.

---

## TLS / Reverse-Proxy Termination (self-managed shape)

Recommend TLS terminate at a reverse proxy (nginx or Caddy) in front of the Node process(es), **not** inside `server.js`. Rationale: automatic cert renewal (Let's Encrypt/Caddy), a natural multiplexing point for N `server.js` instances behind one public `:443` (which Option B already needs anyway for load distribution), a natural place for rate limiting (a stated milestone goal) and compression (today's `compression` middleware could then be dropped or kept as defense-in-depth), and keeping cert/secret material off the Node process entirely.

Concrete, currently-missing hardening step: `server.js`'s `app.listen(PORT, ...)` binds all interfaces by default. Behind a reverse proxy it should bind **loopback only** (`127.0.0.1:PORT`), and `app.set('trust proxy', ...)` needs to be set correctly so `req.ip` (already used in session-creation audit metadata, and needed for rate limiting) reflects the real client, not the proxy.

For the container/platform shape, TLS more commonly terminates at the platform's own ingress/load balancer (outside this app's control); the container itself should serve plain HTTP internally under the same "bind loopback, trust the proxy" posture, enforced by the platform rather than a hand-rolled nginx config.

## Container Config Contract

- **Env vars:** extend the existing `PORT`, `PUBLIC_BASE_URL`, `DEMO_OPEN`, `MA_CONTROL_DB_PATH`/`MA_RUNTIME_DB_PATH`/`MA_AUDIT_DB_PATH`/`MA_DEMO_DB_PATH`/`MA_DEALS_DIR` family (already overridable per `db/dbFiles.js`) with `NODE_ENV=production`, real session/secret config (retiring `ADMIN_TOKEN`), `STORAGE_BACKEND` (only relevant if Option C is ever added), a single `DATA_DIR` root (today `db/dbFiles.js` hardcodes `path.join(__dirname, '..', 'data')` — needs to become the base for a container's mounted volume, e.g. `/data`), and `TRUST_PROXY=1`.
- **Health/readiness:** `/healthz` already exists (`server.js:665`) but should be split per standard container-probe convention: `/healthz` = liveness (process responsive), `/readyz` = readiness (confirm storage is actually openable/writable — a trivial `SELECT 1` against `control.db` — and migrations are complete, not just "the process started").
- **Migration-on-boot:** today's `openDbFile()` runs `CREATE TABLE IF NOT EXISTS` idempotently on every open — fine for SQLite's schema-is-just-a-file model, but not a real migration system (no versioning, no story for altering a table that already has real deal data in it). Recommend a lightweight migration runner (`schema_migrations` table + numbered `.sql` files applied at startup before `app.listen()`) **regardless of which storage option is chosen** — the version-column addition above *is itself* a schema migration with no formal mechanism today to apply to an already-deployed deal's `.db` file. Mandatory if Option C is ever pursued.
- **Volume for deal DBs:** the container image must be stateless (only the committed `demo.db`/`control.db` seed pair baked in) with `DATA_DIR` mounted as a persistent volume. Per Option B's edge case above, that volume must be a single-writer-accessible local/attached (RWO) volume with `replicas: 1`, unless a broker (A) or Postgres (C) is introduced specifically to unlock N>1 replicas safely.

## Graceful Shutdown / Restart With In-Flight Writes

`server.js` already does this correctly for the single-process case (lines 6857–6879): `server.close()` on SIGTERM/SIGINT stops accepting new connections, lets in-flight requests finish, with a 10s hard-kill fallback. Because `better-sqlite3` is a **synchronous** binding, a write that has already entered `conn.transaction()` cannot be left half-committed by a signal arriving mid-call — Node's event loop won't even process the SIGTERM handler until the current synchronous call stack (including the transaction) returns. This is a genuine, non-obvious strength of the driver choice worth stating explicitly: it's already shutdown-safe by construction.

- **Option B (N processes, no broker):** each process's shutdown is identical to today's story, unchanged. The only new requirement is a **rolling restart** at the supervisor level (stop process 1, wait for health, start its replacement, then process 2, …) rather than `killall` — zero new application-level engineering.
- **Option A (broker):** shutdown ordering now matters — read workers must drain (stop accepting HTTP) *before* the writer drains, or writes already in flight when the writer exits first will hang against a dead socket rather than fail fast.
- **Option C (Postgres):** the Node process(es) side is simple (identical shutdown + `pool.end()`), but Postgres itself becomes a separate lifecycle entirely (its own graceful stop) — the platform's or systemd's job, outside this app's process boundary.
- `server.js`'s current `uncaughtException`/`unhandledRejection` handlers are explicitly **log-only** today, with an existing code comment noting this needs to become log-then-exit for a *supervised* deploy so the supervisor restarts a process left in an undefined state. This becomes load-bearing under any multi-process shape (A or B) — flag as a required change, not optional polish.

---

## Recommendation

### Default: **Option B** (native SQLite multi-process WAL write-serialization, hardened with `.immediate()` transactions + busy-retry/503), single-host, `replicas: 1` for the container shape — plus the version-column optimistic-locking layer as its own additive phase.

| | Option A: Broker | **Option B: Native WAL (recommended)** | Option C: Postgres |
|---|---|---|---|
| Correctness vs. Phase-1 lost-update race | Preserved (by construction, same as B) | **Preserved** — no code change needed to the merge algorithm itself | Preserved, different mechanism |
| New components | Writer process + IPC layer + serialization bridge | **None** — `.immediate()` + retry wrapper inside existing `writeDb()` | New store module, pooling, migration runner, ported audit/session/control modules |
| Call-site changes (~90 sites) | None (facade dispatch seam) | **None** | None if C1; all 90 if C2 (out of scope) |
| Horizontal (N>1 host/replica) scaling | Yes, still single-writer under the hood | **No — pinned to one host/one disk** | Yes, natively |
| Throughput ceiling at this app's scale | Comfortably sufficient | **Comfortably sufficient** (writes are small, users are few) | Comfortably sufficient, headroom to spare |
| New failure mode | Writer-process outage = app-wide write outage | **None new** | DB-server outage = app-wide outage (same class, different process) |
| Zero-install turnkey zip | Survives | **Survives** | Does not survive as currently defined |
| Demo showcase | Survives unaffected | **Survives unaffected** | Survives only if kept on a separate SQLite path (dual-backend) |
| Container/platform replica count | N (via broker) | **1** (unless paired with A or C later) | N |
| Engineering cost this milestone | Medium-high (new protocol, serialization) | **Low** (two small, targeted `writeDb()` changes + process supervision) | High (new backend, schema-per-deal, migration runner, dual-backend facade) |
| Version impact | v2.2.0 | **v2.2.0** | Likely v3.0 (per PROJECT.md's own flag) |

**Why B and not A:** the Key Finding above shows the broker isn't required for correctness — SQLite's own cross-process locking already extends the existing lost-update fix to N processes with zero changes to the merge algorithm. A buys horizontal (multi-host) scaling and a single write-serialization choke point this app's realistic concurrency (an IL + a handful of workstream leads on one active deal) doesn't need, at the cost of a new failure mode, new IPC/serialization plumbing, and added write latency. Keep it as a documented **future escape hatch** — reach for it only if write volume or a genuine multi-host requirement ever actually materializes.

**Why B and not C:** Postgres is the architecturally "correct" long-term answer for true multi-writer, multi-host scaling and idiomatic row-level locking — but it breaks the zero-install turnkey-zip and app-only shapes outright, requires a schema-per-deal redesign to preserve the MNPI isolation property `db/resolver.js` currently gives for free, and forces either retiring those deployment shapes or building a dual-backend facade — a substantially larger scope than the rest of this milestone. PROJECT.md itself already anticipates this ("a Postgres decision may reshape scope and bump the version to v3.0"); the recommendation here is that v2.2.0 does not need to make that trade, because Option B satisfies the milestone's actual stated deployment shapes (self-managed host, container/platform *at replica=1*, app-only) without it.

**Honest tradeoff being accepted:** Option B caps the container/platform shape at a single replica per deal-serving instance and does not enable multi-host horizontal scaling. If TE's shared host ever needs true multi-replica horizontal scaling (not just multi-user concurrency on one host), that is a real future migration (to A or C) — not a limitation this research recommends papering over, but one that matches PROJECT.md's stated shape ("a shared internal host," not a distributed cluster) closely enough to defer deliberately.

### Suggested phase build order for the milestone

1. **Concurrency architecture decision + proof.** Lock in Option B; build the new two-process (or N-process) soak test proving `.immediate()` + busy-retry holds under realistic load. This gates everything below.
2. **Storage-layer hardening.** `.immediate()` transactions + busy-retry/503 mapping in `writeDb()`; migration-runner scaffold (`schema_migrations` table); `DATA_DIR` env-overridable path; loopback-bind + `trust proxy` correctness; `uncaughtException` switched to log-then-exit for supervised deploys.
3. **Optimistic locking.** Version column migration + conditional `UPDATE`/409 distinguishing "deleted" from "conflicted" + client reload UX — the user-facing deliverable PROJECT.md names explicitly.
4. **Multi-process runtime.** Process-supervisor config (systemd unit template or `cluster` primary/worker wiring), rolling-restart runbook, N-process soak/load test.
5. **Self-managed host deployment.** Reverse proxy (nginx/Caddy) + TLS + loopback binding + backup/restore tooling (file-copy + WAL-checkpoint-aware) + secrets management retiring `ADMIN_TOKEN`.
6. **Container/platform shape.** Dockerfile, `/readyz` split from `/healthz`, volume contract, `replicas: 1` documented as a hard constraint, CI image build.
7. **Workstream-lead collaboration + deal-setup wizard enhancements.** Sequenced last — depends on the multi-user-safe storage layer and sessions-at-scale being solid first; lower architectural risk, mostly UI + extending the existing membership/clearance model.
8. **Deferred, not this milestone:** Postgres dual-backend — revisit only if a concrete need for N>1-replica horizontal write scaling emerges, or TE IT mandates a managed-Postgres platform and the zero-install/app-only shapes are explicitly retired or kept SQLite-only.

## Sources

- `db/store.js`, `db/resolver.js`, `db/dbFiles.js`, `db/sessions.js`, `server.js` (this repository) — read directly, HIGH confidence.
- [Write-Ahead Logging — sqlite.org](https://www.sqlite.org/wal.html) — official WAL semantics (multiple readers + one writer, cross-process, `busy_timeout` retry behavior) — MEDIUM confidence (verified/cross-checked).
- [SQLITE_BUSY / concurrent writers discussion — DeepWiki (better-sqlite3)](https://deepwiki.com/WiseLibs/better-sqlite3/3.4-wal-mode-and-performance-tuning) — MEDIUM confidence.
- [The Node.js Developer's Guide to Unix Domain Sockets](https://nodevibe.substack.com/p/the-nodejs-developers-guide-to-unix) — Unix-socket vs. TCP-loopback latency figures cited for Option A's transport choice — MEDIUM confidence.

---
*Architecture research for: v2.2.0 Shared-Host Multi-User milestone*
*Researched: 2026-08-10*
