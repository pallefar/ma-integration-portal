# Phase 8: Concurrency & Storage Foundation - Research

**Researched:** 2026-08-10
**Domain:** SQLite WAL multi-process write serialization (better-sqlite3), Express error-handling, client-side retry UX, multi-process test harness design
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Architecture (locked upstream — research + requirements, not re-decided here)**
- **D-01:** Option B — native SQLite multi-process WAL write-serialization. No broker, no Postgres, host-local, `replicas: 1`. — Reversibility: one-way.
- **D-02:** The `readDb()`/`writeDb()` whole-object API and its snapshot-diff merge semantics are preserved exactly — the ~90 endpoint call sites do not change.

**Busy-wait strategy**
- **D-03:** Everything stays synchronous: `BEGIN IMMEDIATE` transactions with `busy_timeout ≈ 1000ms` doing the waiting inside SQLite. `writeDb()` keeps its sync signature. — Reversibility: costly.
- **D-04:** Accepted consequence: a contended write blocks that process's event loop for up to ~1s. Rare and bounded at ~15-person deal-team scale; do not add async machinery to avoid it this phase.
- **D-05:** Server-side contention budget is ~1 second total, then give up with `503 Retry-After` — implemented via the busy_timeout, not an app-level retry loop.

**Contention UX & retry policy**
- **D-06:** SQLITE_BUSY → 503 + Retry-After mapped in ONE central Express error middleware, covering every write path (writeDb, sessions, controlStore, audit). New endpoints inherit the contract for free; a coverage test should assert it.
- **D-07:** Client behavior: silent auto-retry in a global fetch hook in `public/js/transitions.js`. 2–3 retry attempts honoring Retry-After; the user never sees routine contention.
- **D-08:** If client retries also exhaust: error toast via the existing banner/toast pattern — "Server is busy — your change was not saved. Please try again." Form/page state preserved.

**Serialization scope**
- **D-09:** The `.immediate()` + bounded-busy-wait treatment applies to every SQLite file the app writes — deal DBs, `demo.db`, `control.db`, `runtime.db` (sessions), `audit.db` — including direct-SQL writers that bypass `writeDb()` (`db/sessions.js`, `db/controlStore.js`, `db/auditHook.js`). One shared helper inside the existing single pragma contract (`db/dbFiles.js`).
- **D-10:** Audit keeps its no-swallow contract under contention: if the audit.db append stays busy after the wait, the whole request fails 503. Client retry re-applies the write; acceptable because writeDb() re-application of identical content is idempotent. — Reversibility: one-way if relaxed.
- **D-11:** Uniform 503 contract on all writes, control-plane included (login/session creation, deal registry, user admin). No endpoint-specific special cases.

**Soak-test shape**
- **D-12:** Two proof artifacts: (a) a fast bounded multi-process test committed into `node --test` — 2 spawned Node child processes calling `db/store.js` `writeDb()` directly against one shared deal file, hundreds of interleaved writes, zero-loss assertion; (b) a standalone soak harness (`npm run soak`) run at phase-gate and release.
- **D-13:** The soak harness boots real `server.js` processes on separate ports over the same `data/` directory and drives authenticated API writes — proving the whole path end-to-end.
- **D-14:** Soak defaults: 2–3 processes, ~2 minutes, mixed reads/writes across co-edited collections; process count/duration/write rate configurable via env/flags.
- **D-15:** Pass criteria = the acknowledged-write invariant: every write acknowledged as success is present and exact in the final DB; every rejected write got a clean bounded 503; `PRAGMA integrity_check` passes; the audit trail matches acknowledged writes 1:1. Bounded 503s are allowed — they are the design working.

### Claude's Discretion
- Exact `busy_timeout` value within the ~1s budget, `Retry-After` value and jitter, client retry backoff details.
- Internal shape of the shared retry/open helper in `db/dbFiles.js`.
- Soak harness process-orchestration details (spawn mechanics, port allocation, teardown).
- How the demo/turnkey "behaves identically" criterion is verified (existing suite green + demo boot check is acceptable).

### Deferred Ideas (OUT OF SCOPE)
- WAL checkpoint management / unbounded `-wal` growth under multi-process load — Phase 10 (Runtime Hardening).
- Health/readiness endpoints and migration-on-boot — Phase 10 (DEPLOY-03).
- Rolling-restart runbook and process-supervisor config — Phases 10–11.
- Optimistic locking (version + 409 + reload-and-reapply UX) — Phase 9 (CONC-02); Phase 8's 503 path is contention, not conflict — keep the two signals distinct.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONC-01 | Concurrent writers — whether overlapping requests in one process or separate processes on the same host — serialize safely with no lost updates, via immediate write transactions and busy-retry (SQLite WAL cross-process locking; the Option-B storage-layer change). | Architecture Patterns 1–3 (the `.immediate()` API, verified multi-process wait/succeed behavior, central-middleware error-forwarding gap); Common Pitfalls 1–6 (local try/catch swallow sites, async-handler forwarding gap, single-process test deadlock trap, `controlStore.js`'s unwrapped read-modify-write gap, SQLITE_BUSY_SNAPSHOT, toast-helper correction); Validation Architecture (fast test + coverage test + soak harness mapped to CONC-01 directly); Code Examples (verified `.immediate()` change, pragma change, central middleware, spawn-based test pattern, env-var override pattern for the soak harness). |
</phase_requirements>

## Summary

Phase 8 implements Option B (native SQLite WAL multi-process write-serialization) exactly as CONTEXT.md's 15 decisions lock it down. The mechanical core is genuinely small — two call-site changes (`conn.transaction(fn)` → `.immediate` variant, `busy_timeout` 5000→~1000) and one new Express error-middleware branch — but this research surfaces several **non-obvious gaps between the locked decisions and the current codebase** that materially change the plan's task list:

1. **91 of server.js's 93 write routes are plain synchronous handlers** — Express 4 auto-forwards a thrown error from a sync handler to the error middleware for free. But **8 of those routes wrap their write call in a local `try/catch` that already converts any error (including a future SQLITE_BUSY) into a hand-written `res.status(500).json(...)`** — these must be found and patched (re-throw or pass through) or D-06's "one central middleware covers every write path" claim is false for those 8 routes. One concrete instance verified: `server.js:2447-2450` (assessment save).
2. **`public/js/banners.js` is not a generic toast API.** It is a CMS-driven, server-fetched page-banner system (`GET /api/banners?slug=`). The only client-side `showToast()` in the codebase lives in `public/js/dashboard.js`, is page-scoped (not `window`-exposed, not loaded app-wide). D-08's "give-up toast" needs a small new helper — the natural home is `public/js/transitions.js` itself, which already hosts a `makeBannerDismissible()` DOM helper and is loaded on every page.
3. **A single-process simulation of concurrent writers does not reproduce real contention.** Verified empirically this session: two `better-sqlite3` connections in the *same* Node process, one holding an open `BEGIN IMMEDIATE` lock and the other waiting on `busy_timeout`, **deadlock** — the lock-release code (a `setTimeout` callback) can never run while the busy-wait blocks the single JS thread. Real separate OS processes do not have this problem (verified: a spawned child process's writer correctly waited and succeeded once the other process committed). This directly validates why D-12(a) specifies **real spawned Node child processes**, not an in-process simulation — and is a pitfall to explicitly warn the plan against.
4. **`db/controlStore.js`'s read-modify-write functions** (`updateDealMembers`, `setDealMemberGrants`, `updateUser`, `updateDealSetup`, `archiveDeal`) issue their `SELECT` and their `UPDATE` as two **separate autocommit statements**, not one explicit transaction. Under concurrent control-plane writes to the same deal/user row this is a silent last-writer-wins overwrite that **never throws SQLITE_BUSY at all** (each individual statement is fast; the race is at the application-logic level between two statements, not at the SQLite lock level). D-09 scopes "every SQLite file the app writes... including the direct-SQL writers" — this is a legitimate gap the plan should decide whether to close (wrap each read+write pair in `.immediate()`) even though full field-level merge safety for control-plane blobs remains explicitly out of Phase 8/9 scope.

**Primary recommendation:** Do the two-line storage change exactly as D-03 specifies, but scope Task planning around three concrete, verifiable work items beyond it: (a) an audit-and-fix pass over the ~8 local `try/catch` blocks in server.js that currently swallow write errors, (b) a new small app-wide toast helper in `transitions.js` (not a reuse of `banners.js`), and (c) an explicit decision + fix for `controlStore.js`'s unwrapped read-modify-write functions.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Write-lock acquisition + bounded busy-wait | Database/Storage (`db/dbFiles.js`, `db/store.js`, `db/auditHook.js`, `db/sessions.js`, `db/controlStore.js`) | — | SQLite's own WAL locking is the serialization mechanism; nothing above the storage layer needs to know contention happened until it fails |
| SQLITE_BUSY → 503 Retry-After mapping | API/Backend (`server.js` central error middleware) | — | The only place that knows both "this was a write" and "the client needs an HTTP-level signal"; must not live in the storage layer (no `res` object there) |
| Client silent auto-retry + give-up toast | Browser/Client (`public/js/transitions.js`) | — | The existing app-wide same-origin fetch interceptor already lives here; a second interceptor elsewhere would race it |
| Multi-process concurrency proof (fast suite test) | Database/Storage (spawned Node processes calling `db/store.js` directly) | — | Proves the storage-layer guarantee in isolation from HTTP/auth machinery, keeps it fast enough for `npm test` |
| Multi-process concurrency proof (soak harness) | cross-tier (spawns real `server.js` processes, drives via HTTP) | API/Backend | Must prove the *whole* path (auth, validation, audit, busy-wait, 503) end-to-end per D-13, so it necessarily exercises every tier |
| Audit no-swallow under contention | Database/Storage (`db/auditHook.js`) + API/Backend (propagation) | — | The storage layer must let a busy audit write throw; the API layer must let that throw become the request's 503, not a separately-caught 500 |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 13.0.1 (pinned, already installed) | Synchronous SQLite driver — the app's only DB layer | Already the project's sole DB dependency since Phase 1/3; no alternative under consideration. Registry latest is 13.0.3 [VERIFIED: `npm view better-sqlite3 version` this session] — no upgrade needed, `.transaction(fn).immediate` API is stable across 13.x patch releases [VERIFIED: `node_modules/better-sqlite3/lib/methods/transaction.js`, read this session]. |

No new runtime dependency is needed for this phase — the entire concurrency mechanism (`BEGIN IMMEDIATE`, `busy_timeout`) is a built-in SQLite/better-sqlite3 pragma and transaction-mode feature, not a library.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:test` (built-in) | Node 22.18.0 | Test runner for the fast bounded multi-process suite test and the 503-contract coverage test | Already the project's only test framework (`node --test`, no Jest/Mocha) |
| `node:child_process` (built-in) | Node 22.18.0 | Spawning real Node processes for D-12(a)'s fast test and D-13's soak harness | No third-party process-orchestration library needed — `spawn()`/`fork()` cover D-14's process-count/duration knobs |
| global `fetch` (built-in) | Node 22.18.0 | Driving HTTP requests against a real listening `server.js` in tests | Already the established pattern in `test/role-enforcement.test.js` (`app.listen(0)` + native `fetch`) — no `supertest` dependency exists in this project and none should be added |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SQLite `busy_timeout` blocking wait | An app-level async retry loop (poll/backoff around `writeDb()`) | Rejected by D-03: converts ~90 synchronous call sites to `await`, reintroduces the missed-await bug class. Not recommended even as a fallback. |
| `db.transaction(fn).immediate` | Manual `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` statements | The `.transaction()` API already handles rollback-on-throw and nested-savepoint semantics correctly [VERIFIED: `node_modules/better-sqlite3/lib/methods/transaction.js`] — hand-rolling this loses that safety net for one line of savings. |
| `supertest` for the soak harness's HTTP driving | Native `fetch` against `app.listen(0)` | This project has zero `supertest` usage anywhere in `test/` [VERIFIED: grep across `test/*.js`] — introducing it for one phase breaks consistency for no functional gain, since D-13 needs *real listening processes* (not an in-process supertest agent) anyway. |

**Installation:** None required — no new packages.

## Package Legitimacy Audit

No external packages are being introduced this phase. `better-sqlite3` (already pinned at 13.0.1) is the only dependency this phase touches, and it is an existing, previously-vetted project dependency — not a new install. No `npm install` step is needed; this table is intentionally empty.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────┐
                         │  Browser (public/js/transitions.js)      │
                         │  same-origin /api fetch interceptor       │
                         │  (already injects auth headers)           │
                         └───────────────┬────────────────────────┘
                                         │ fetch('/api/...', {method:'POST',...})
                                         ▼
                         ┌─────────────────────────────────────────┐
                         │  Express app (server.js)                  │
                         │  ~93 write routes, 91 sync / 4 async       │
                         │  route handler calls writeDb()/            │
                         │  controlStore.*()/sessions.*() synchronously│
                         └───────────────┬────────────────────────┘
                     throws SqliteError  │  (sync handler: Express 4
                     {code:'SQLITE_BUSY'}│   auto-forwards; async handler:
                                         │   needs explicit next(err))
                                         ▼
                         ┌─────────────────────────────────────────┐
                         │  NEW: central error middleware (D-06)      │
                         │  if err.code startsWith 'SQLITE_BUSY':      │
                         │    res.set('Retry-After', N)                │
                         │    res.status(503).json({error: generic})   │
                         │  else: falls through to existing            │
                         │  final 500 handler (server.js:6839)         │
                         └───────────────┬────────────────────────┘
                                         │ 503 + Retry-After
                                         ▼
                         ┌─────────────────────────────────────────┐
                         │  transitions.js fetch wrapper (D-07)       │
                         │  on 503: wait Retry-After, retry (2-3x)    │
                         │  on exhaustion: give-up toast (D-08),      │
                         │  form/page state preserved                 │
                         └─────────────────────────────────────────┘

  ── storage layer, reached from every write route above ──────────────
   db/dbFiles.js  openDbFile()  ← single pragma contract (journal_mode
        WAL, synchronous NORMAL, foreign_keys ON, busy_timeout ~1000)
        │
        ├─ db/store.js       writeDb()          conn.transaction(fn).immediate
        ├─ db/auditHook.js   writeAuditBatch()   conn.transaction(fn).immediate (currently default/deferred — change)
        ├─ db/auditHook.js   recordSecurityEvent() bare autocommit .run() (busy_timeout alone governs, no .immediate needed)
        ├─ db/sessions.js    bare autocommit .run() calls (single-statement — no .immediate needed)
        └─ db/controlStore.js  mix: some bare single-statement writes (fine),
             several unwrapped SELECT-then-UPDATE pairs (updateDealMembers,
             setDealMemberGrants, updateUser, updateDealSetup, archiveDeal) —
             NOT protected by busy_timeout at all today; a genuine gap, see
             Common Pitfalls #6.
```

### Recommended Project Structure

No new directories. Changes land in existing files:

```
db/
├── dbFiles.js       # busy_timeout 5000 → ~1000 (D-03/D-05); this is the ONLY pragma-contract file
├── store.js         # writeDb()'s conn.transaction(fn) → .immediate variant
├── auditHook.js      # writeAuditBatch()'s conn.transaction(fn) → .immediate variant
├── sessions.js       # no change needed (single-statement autocommits)
└── controlStore.js  # DECISION NEEDED: wrap read-modify-write pairs in .immediate() transactions
server.js            # 1 new central error-handling branch (near existing final handler, line ~6839)
                      #   + audit/fix pass over ~8 local try/catch blocks that swallow write errors
public/js/
└── transitions.js   # new: retry hook in the existing fetch wrapper + a new small toast helper
test/
├── concurrency-busy-retry.test.js   # NEW — D-12(a) fast bounded multi-process test
└── busy-503-contract.test.js        # NEW — D-06 coverage test, mirrors write-validation-coverage.test.js
scripts/
└── soak.js                          # NEW — D-12(b)/D-13/D-14 standalone soak harness
package.json                         # add "soak": "node scripts/soak.js" script
```

### Pattern 1: `.immediate()` transaction variant

**What:** `better-sqlite3`'s `db.transaction(fn)` returns a function object carrying `.default`, `.deferred`, `.immediate`, `.exclusive` variants — each issues a different `BEGIN` statement (`BEGIN`, `BEGIN DEFERRED`, `BEGIN IMMEDIATE`, `BEGIN EXCLUSIVE` respectively) but shares the same COMMIT/ROLLBACK/SAVEPOINT machinery. Calling `.immediate` does not re-prepare statements each call — the underlying `BEGIN IMMEDIATE` statement is prepared once per `Database` handle and cached in a `WeakMap`.

**When to use:** Every explicit multi-statement write transaction in this app (`writeDb()`, `writeAuditBatch()`). Single-statement autocommit writes (`db/sessions.js`, most of `db/controlStore.js`) do not need it — there is no `BEGIN` to choose a mode for.

**Example (verified against installed source, `node_modules/better-sqlite3/lib/methods/transaction.js`):**
```javascript
// Source: node_modules/better-sqlite3/lib/methods/transaction.js (read this session)
// Current (db/store.js writeDb()):
const applyWrite = conn.transaction((payload) => { /* ... */ });
applyWrite(data);

// Change to:
const applyWrite = conn.transaction((payload) => { /* ... */ }).immediate;
applyWrite(data);
```

**Empirically verified this session** (two `better-sqlite3` connections to the same file, one holding an open `BEGIN IMMEDIATE`, the other calling `.immediate`):
```
B threw: SqliteError code= SQLITE_BUSY message= database is locked
instanceof Database.SqliteError: true
```
`better-sqlite3` throws a `SqliteError` (exported as `Database.SqliteError`) with a `.code` string property set to the exact SQLite result code (`'SQLITE_BUSY'`). This is the value the central error middleware branches on. [VERIFIED: hands-on test this session against `node_modules/better-sqlite3` 13.0.1, `lib/sqlite-error.js`]

### Pattern 2: Real multi-process contention resolves correctly; simulated single-process contention deadlocks

**What:** Verified by spawning two real Node child processes against one shared SQLite file: process A opens `BEGIN IMMEDIATE`, holds it for 700ms (via its own `setTimeout`), then commits; process B (started ~150ms later, `busy_timeout=2000`) calls `.immediate()` and **successfully waits and completes** once A commits (~572ms measured wait).

By contrast, simulating "two concurrent writers" *within one process* using two connections and a `setTimeout` to release the first lock **deadlocks and throws immediately** — because Node is single-threaded and `better-sqlite3` calls are synchronous/blocking; the busy-wait for connection B occupies the only thread, so connection A's release code (a pending timer callback) never gets a chance to run.

**When to use:** This is the reason D-12(a) specifies *spawned Node child processes*, not Promises/timers within one test process, for the fast multi-process suite test.

**Verified output (this session, real child processes):**
```
A: lock acquired at 1786391357212
A: committed at 1786391357914
B: succeeded after waiting ms: 572
```

**Verified output (this session, simulated single-process contention — the anti-pattern):**
```
SqliteError: database is locked
  code: 'SQLITE_BUSY'
```
(thrown synchronously, not after the intended 2000ms `busy_timeout` wait — because the releasing timer never fires)

### Pattern 3: Central error middleware — only catches what reaches it

**What:** Express 4.19.2 (this project's pinned version) auto-forwards a **thrown error from a synchronous route handler** to `next(err)` internally. It does **not** auto-forward a rejected Promise from an async handler — that requires an explicit `.catch(next)` or a `try { } catch (e) { next(e); }`.

**Verified route shape in this codebase:** 93 write routes (`app.post/put/patch/delete`) total; 91 are registered as plain synchronous `(req, res) => {...}` handlers, only 4 as `async (req, res) => {...}` [VERIFIED: `grep -c` against `server.js` this session]. For the 91 sync routes, an uncaught `SqliteError` from `writeDb()` propagates to Express's error-handling chain automatically — **provided nothing locally catches it first**.

**The gap:** 8 `try { ... } catch (e) { ... }` blocks in `server.js` wrap a write call (`writeDb`, `controlStore.*`, or `sessions.*`) within their own scope [VERIFIED: brace-depth-aware scan of `server.js` this session]. A representative, directly-read example:
```javascript
// Source: server.js:2447-2451 (read this session — verbatim)
  try {
    writeDb(db);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to save assessment.' });
  }
```
This swallows a future `SQLITE_BUSY` into a generic 500 with no `Retry-After` header, silently breaking D-11's "uniform 503 contract on all writes" for this route. Every one of the 8 locations needs either (a) an `if (e && e.code && e.code.startsWith('SQLITE_BUSY')) throw e;` re-throw guard before the generic catch body, or (b) removal of the local catch in favor of letting Express's auto-forwarding handle it (only viable where the catch has no other side effect worth keeping, e.g. no rollback logic).

### Anti-Patterns to Avoid

- **Simulating multi-process contention with Promises/timers in one Node process:** deadlocks (verified above) and does not exercise the real code path — always spawn real child processes for the busy-wait proof.
- **Catching a write call locally and converting *any* error to a fixed 500 message:** silently defeats the central-middleware contract for that one route. Only convert errors you can positively identify as *not* contention-related, or re-throw contention errors before the generic handler runs.
- **Echoing `err.message` from a `SqliteError` to the client:** SQLite's own busy message (`"database is locked"`) is harmless but other SQLite errors can leak internal detail (file paths, schema names). The existing final handler already returns a fixed generic string (`'Internal server error'`) for the 500 case [VERIFIED: `server.js:6839-6843`] — the new 503 branch should follow the same discipline, not `res.json({ error: err.message })`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-process write serialization | A custom lockfile / named-mutex / app-level semaphore | SQLite's native WAL locking (`BEGIN IMMEDIATE` + `busy_timeout`) | This is the entire point of Option B — a hand-rolled lock reintroduces the exact IPC-coordination problem the milestone research explicitly rejected as "Option A: Broker" |
| Busy/retry backoff on the server | An async retry-queue with exponential backoff wrapping `writeDb()` | `busy_timeout` pragma (a blocking C-level wait inside SQLite itself) | D-03: keeps `writeDb()` synchronous, zero call-site changes across ~90 endpoints; an app-level retry loop is exactly the "costly reversal" D-03 flags |
| Detecting a contention error | Parsing `err.message` strings (`"database is locked"`, `"database table is locked"`) | `err.code` — a stable string set by `better-sqlite3`'s `SqliteError` class, e.g. `'SQLITE_BUSY'`, `'SQLITE_BUSY_SNAPSHOT'` | `.code` is a documented, stable SQLite result-code string, not a translatable/localizable human message; check `err.code && err.code.startsWith('SQLITE_BUSY')` to also catch the extended `SQLITE_BUSY_SNAPSHOT` code (517) |
| Multi-process HTTP driving for the soak harness | A custom raw-socket HTTP client | Node's built-in global `fetch` (already the established pattern in `test/role-enforcement.test.js`) | No `supertest` or third-party HTTP client exists anywhere in this project's `test/` — introducing one for a single phase breaks stack consistency |

**Key insight:** Every piece of "custom concurrency machinery" this phase might be tempted to build (a lock, a retry queue, a message-parser) already has a correct, battle-tested equivalent one layer down (in SQLite itself or in `better-sqlite3`'s API) — the entire point of Option B is that the app-layer code stays almost unchanged.

## Common Pitfalls

### Pitfall 1: Local `try/catch` blocks swallow the contention signal
**What goes wrong:** A route's own `catch` block converts a `SQLITE_BUSY` `SqliteError` into a hand-written 500 message with no `Retry-After` header, silently violating D-11's uniform-contract requirement for that one route.
**Why it happens:** These blocks predate Phase 8 and were written to catch validation/provisioning failures, not contention — nobody anticipated `writeDb()` throwing a *retryable* error when they were written.
**How to avoid:** Audit every `try { ... writeDb()/controlStore.*()/sessions.*() ... } catch` block in `server.js` (8 found this session via brace-depth scan) and add a re-throw guard for `SQLITE_BUSY*` codes before the generic handling, or route the catch's error through `next(e)` instead of directly to `res.status(500)`.
**Warning signs:** A coverage test (Pattern 3's `busy-503-contract.test.js`, mirroring `test/write-validation-coverage.test.js`'s route-enumeration style) that synthetically throws a `SqliteError('database is locked', 'SQLITE_BUSY')` from inside a stubbed write call and drives every registered write route — any route that returns something other than 503+Retry-After fails the test.

### Pitfall 2: Async route handlers don't auto-forward errors in Express 4
**What goes wrong:** The 4 `async (req, res) => {...}` routes in `server.js` will NOT automatically forward a thrown/rejected error to the central middleware the way the other 91 synchronous routes do — Express 4 (unlike Express 5) has no built-in async-error forwarding.
**Why it happens:** Express 4.19.2 is pinned [VERIFIED: `package.json`]; its auto-catch behavior only wraps the synchronous call to the handler function itself, not any Promise it returns.
**How to avoid:** Verify each of the 4 async handlers either already has a `.catch(next)`/`try{}catch(e){next(e)}` shape, or add one as part of this phase's audit — don't assume "central middleware covers every write path" is true for these without checking.
**Warning signs:** The same coverage test from Pitfall 1 will catch this too if it drives every write route (sync and async) uniformly.

### Pitfall 3: Simulating concurrency within a single test process deadlocks instead of proving anything
**What goes wrong:** A test that opens two `better-sqlite3` connections in one Node process and tries to simulate a "concurrent" second writer via a `setTimeout`-delayed release will **hang or throw immediately** instead of exercising the real busy-wait/retry path — because the busy-wait itself blocks the only thread, preventing the release timer from ever firing.
**Why it happens:** `better-sqlite3` is fully synchronous; Node is single-threaded. Two connections in the same process cannot truly "overlap" execution the way two OS processes can.
**How to avoid:** D-12(a)'s fast suite test and D-13's soak harness must both spawn **real `child_process` instances** (verified working pattern this session — see Pattern 2's code example), never simulate the second writer with Promises/timers in-process.
**Warning signs:** A test that "passes" suspiciously fast, or that throws `SQLITE_BUSY` even though `busy_timeout` should have given it seconds to succeed.

### Pitfall 4: `db/controlStore.js`'s read-modify-write functions have no lock-acquisition protection at all
**What goes wrong:** Functions like `updateDealMembers()`, `setDealMemberGrants()`, `updateUser()`, `updateDealSetup()`, `archiveDeal()` each do a `getDeal(dealId)` (autocommit SELECT) followed by a separate autocommit `UPDATE ... WHERE id = ?` — with no explicit transaction spanning the pair. Two concurrent writers to the *same* deal/user row can silently clobber each other's changes, and this **never throws SQLITE_BUSY** (each individual statement completes fast — the race is at the application level between two statements, not a SQLite lock contention).
**Why it happens:** These functions were written for control.db's ISO-01 isolation, not for concurrent-write safety — they predate this phase's requirement.
**How to avoid:** Verified this session — the exact functions and line ranges:
```javascript
// Source: db/controlStore.js:245-251 (read this session — verbatim)
function updateDealMembers(dealId, members) {
  const deal = getDeal(dealId);
  if (!deal) throw new Error(`db/controlStore.js: updateDealMembers() found no deal '${dealId}'`);
  const updated = { ...deal, members: Array.from(new Set((members || []).map(String))) };
  controlConn().prepare('UPDATE deals SET data = ? WHERE id = ?').run(JSON.stringify(updated), dealId);
  return updated;
}
```
The same shape repeats in `updateUser()` (`db/controlStore.js:67-76`), `setDealMemberGrants()` (`:267-277`), `updateDealSetup()` (`:232-238`), `archiveDeal()` (`:293-299`). Wrapping each function's read+write pair in `conn.transaction((args) => { /* read + write */ }).immediate()` closes the SQL-level gap consistently with D-09's "every SQLite file... including direct-SQL writers" scope. This does **not** add field-level merge safety (two concurrent edits to *different* fields of the same blob still last-writer-wins on the whole blob) — that remains explicitly out of scope (Phase 9's optimistic locking covers RAID/tasks/DD findings/synergy/org decisions, not the deal registry or user accounts).
**Warning signs:** A concurrent `PATCH /api/deals/:id/members` (or similar control-plane write) test where two writers each add a different member and only one addition survives.

### Pitfall 5: `SQLITE_BUSY_SNAPSHOT` is a different code than `SQLITE_BUSY`
**What goes wrong:** A naive `err.code === 'SQLITE_BUSY'` check misses the extended code `SQLITE_BUSY_SNAPSHOT` (517), which SQLite raises specifically when a read transaction tries to upgrade to a write transaction after another connection has already committed changes invalidating its snapshot.
**Why it happens:** `SQLITE_BUSY_SNAPSHOT` is a WAL-mode-specific extended result code, documented but easy to miss if only testing the plain-busy case.
**How to avoid:** [CITED: sqlite.org/rescode.html#busy_snapshot] "SQLITE_BUSY_SNAPSHOT ... occurs on WAL mode databases when a database connection tries to promote a read transaction into a write transaction but finds that another database connection has already written to the database." [CITED: sqlite.org/rescode.html#busy_snapshot] also confirms `busy_timeout` retries do apply to it, since it is an extended code of `SQLITE_BUSY`. Because every write in this app now uses `.immediate()` (never a deferred-then-upgraded transaction), `SQLITE_BUSY_SNAPSHOT` should be rare in the write path specifically — but the central middleware's guard should still be `err.code && err.code.startsWith('SQLITE_BUSY')` rather than an exact string match, as defense in depth.
**Warning signs:** A 500 (not 503) response under heavy write load that a debugger traces back to an uncaught `SqliteError` whose `.code` is `'SQLITE_BUSY_SNAPSHOT'`, not `'SQLITE_BUSY'`.

### Pitfall 6: `banners.js` is not a generic toast API — building on the wrong precedent
**What goes wrong:** CONTEXT.md's canonical_refs calls out "`public/js/banners.js` toast pattern — D-08's give-up error surface," but `banners.js` is a **CMS-driven, server-fetched page-banner system** (`fetch('/api/banners?slug=...')`, admin-configurable, dismissal persisted in `localStorage`) — not a client-generated transient-message API. There is no `window.showToast()` anywhere in the codebase; the only `showToast()` function lives in `public/js/dashboard.js`, is defined inside that file's IIFE, and is **not** exposed on `window` or loaded on every page.
**Why it happens:** The two concepts ("a page banner fetched from the CMS" and "a transient client-side toast for a failed retry") look similar but serve different purposes and live in different files.
**How to avoid:** Build a small new toast helper directly in `public/js/transitions.js` (the file D-07's retry hook already lives in, and the only JS file loaded on every page) — do not attempt to invoke `banners.js`'s CMS-fetch pipeline for a client-generated message, and do not import/expose `dashboard.js`'s page-scoped `showToast()` globally (it's tightly coupled to that page's gamification styling).
**Warning signs:** A give-up toast that silently never renders because `window.showToast` is `undefined` on pages other than the dashboard, or a wasted `fetch('/api/banners?slug=...')` call that has nothing to do with the actual contention error.

## Code Examples

### Central 503 error-middleware branch (new)
```javascript
// Placement: add BEFORE server.js's existing final error handler (line ~6839),
// so it can still fall through to that generic 500 for non-busy errors.
// Source pattern verified against installed better-sqlite3 13.0.1 this session.
const Database = require('better-sqlite3');

app.use((err, req, res, next) => {
  if (err instanceof Database.SqliteError && err.code && err.code.startsWith('SQLITE_BUSY')) {
    const retryAfterSeconds = 1; // Claude's Discretion — exact value within D-05's ~1s budget
    res.set('Retry-After', String(retryAfterSeconds));
    return res.status(503).json({ error: 'Server is busy. Please try again.' }); // never err.message — see Anti-Patterns
  }
  next(err);
});
```

### `.immediate()` transaction change (writeDb, verified API shape)
```javascript
// Source: node_modules/better-sqlite3/lib/methods/transaction.js (read this session)
// db/store.js writeDb() — change:
const applyWrite = conn.transaction((payload) => {
  /* ... existing snapshot-diff body, unchanged ... */
}).immediate;   // was: no .immediate suffix (default = plain BEGIN)

applyWrite(data);
```

### busy_timeout pragma change
```javascript
// Source: db/dbFiles.js openDbFile() (read this session, current value 5000)
conn.pragma('busy_timeout = 1000'); // was: 5000 — D-03/D-05's ~1s budget
```

### Real multi-process test pattern (verified working this session)
```javascript
// Pattern: spawn REAL child processes, never simulate with timers/Promises
// in one process (see Common Pitfalls #3 for why the latter deadlocks).
const { spawn } = require('node:child_process');
// each child requires db/store.js directly and calls writeDb() against the
// SAME shared file path passed as argv — mirrors test/concurrent-write.test.js's
// existing tempDbPath()/cleanupDbFile() helpers for setup/teardown.
```

### Env-var override pattern for the soak harness (verified precedent)
```javascript
// Source: test/audit-log.test.js:26-30 (read this session — verbatim pattern)
// Set BEFORE requiring db/dbFiles.js (module-load-time consts) so every
// spawned server.js process can point at a shared SCRATCH copy of the data
// files, never the live committed data/demo.db or data/control.db:
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
// Pass the SAME env object into each spawn(...) child's `env` option (D-13:
// "same data/ directory" = same set of physical files, not necessarily the
// literal committed data/ folder — using the live committed demo.db/control.db
// as the soak target would dirty git-tracked files every soak run).
```

### HTTP-driving pattern (verified existing precedent)
```javascript
// Source: test/role-enforcement.test.js (read this session — established shape)
const server = app.listen(0);
const port = server.address().port;
const res = await fetch(`http://127.0.0.1:${port}/api/...`, { method: 'POST', /* ... */ });
// D-13's soak harness spawns REAL separate server.js processes with PORT set
// via env (server.js already reads process.env.PORT || 3000, verified), so
// this in-process app.listen(0) pattern is for the FAST suite test only —
// the soak harness needs `spawn('node', ['server.js'], { env: {...PORT, ...MA_*_PATH} })`.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `busy_timeout = 5000`, default (deferred) `BEGIN` in `writeDb()`'s transaction | `busy_timeout ≈ 1000`, `.immediate` transaction variant | This phase (D-03/D-05) | Acquires the write lock upfront, avoiding a mid-transaction upgrade failure class; bounds the contention wait to the phase's chosen budget instead of the prior 5s default |
| Ad-hoc, per-route `res.status(500).json({error:'Failed to ...'})` on any write failure | One central error middleware distinguishing `SQLITE_BUSY*` (503+Retry-After) from everything else (existing generic 500) | This phase (D-06) | New endpoints inherit the 503 contract for free; existing routes need an audit pass to stop swallowing the new error class locally |

**Deprecated/outdated:** None — this phase extends the existing Phase-1/Phase-3 SQLite/WAL architecture rather than replacing anything.

## Runtime State Inventory

Not applicable — Phase 8 is a storage-layer behavior change (lock-acquisition mode + busy-wait duration + error-response contract), not a rename/refactor/migration. No stored data keys, service configs, OS registrations, secret names, or build artifacts reference anything being renamed. **None — verified by reading every touched file's identifiers this session (`db/dbFiles.js`, `db/store.js`, `db/auditHook.js`, `db/sessions.js`, `db/controlStore.js`, `server.js`); no field name, env var name, or file path is being renamed, only pragma values and transaction-mode calls.**

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Exact `Retry-After` value of 1 second (with client-side jitter) is a reasonable default within D-05's "~1 second total" budget | Code Examples, Claude's Discretion per CONTEXT.md | Low — CONTEXT.md explicitly leaves this to Claude's discretion; if too short, clients retry too eagerly under sustained contention, if too long, users perceive lag on a single transient busy event. Easy to tune post-hoc, no architectural risk. |
| A2 | `.immediate()` should also be applied to `db/auditHook.js`'s `writeAuditBatch()` transaction (currently default/deferred) for consistency with D-09's "every SQLite file" scope | Architecture Patterns, System Diagram | Low-medium — if left deferred, audit-batch writes under contention could theoretically hit the SQLITE_BUSY_SNAPSHOT edge case (Pitfall 5) rather than a clean upfront SQLITE_BUSY; functionally the busy_timeout still bounds the wait either way, but the failure mode is less uniform with the rest of the codebase. |
| A3 | `db/controlStore.js`'s unwrapped read-modify-write functions (Pitfall 4) are in-scope for a `.immediate()`-transaction fix in Phase 8, not deferred to Phase 9 | Common Pitfalls #4 | Medium — if the planner defers this, Success Criterion 1 ("no write silently overwrites another") is not fully met for control-plane data (deal membership/clearance changes), even though CONC-01's primary target (RAID/tasks/DD findings via `writeDb()`) is fully covered. This is a scoping judgment call the planner should make explicitly, not silently inherit from this research's recommendation. |

## Open Questions

1. **Should `db/controlStore.js`'s read-modify-write functions be wrapped in `.immediate()` transactions this phase, or explicitly deferred?**
   - What we know: They currently have zero lock-acquisition protection (Pitfall 4) and D-09's scope language ("every SQLite file... including the direct-SQL writers") reads as inclusive of them.
   - What's unclear: Whether the milestone intends CONC-01's "zero lost updates" guarantee to cover control-plane data (deal membership, clearance grants, user accounts) as tightly as deal-record collections, given Phase 9's conflict-detection scope explicitly lists only RAID/tasks/DD findings/synergy/org decisions.
   - Recommendation: Fix it in Phase 8 (the mechanical change is a small, contained wrap of 5 functions) rather than leave a silent gap — flagging it here so the planner makes the call explicitly rather than by omission.

2. **Torn reads in `readDb()` (pre-existing, likely out of scope) — worth flagging without scope-creeping into it.**
   - What we know: `readDb()` issues one `SELECT` per `ARRAY_COLLECTIONS` key as separate autocommit statements, not wrapped in one read transaction — a commit from another writer between two of those SELECTs could produce an internally-inconsistent snapshot (not itself a lost-update, but a consistency subtlety for the snapshot-diff mechanism's `__snapshot` baseline).
   - What's unclear: Whether this predates Phase 8's requirements or is genuinely new risk introduced by shortening `busy_timeout` (it does not — this exists today regardless of Phase 8's changes).
   - Recommendation: Note but do not fix in Phase 8 — this is pre-existing Phase-1/3 behavior, not part of CONC-01's stated scope, and fixing it (wrapping `readDb()` in an explicit read transaction) is a separate, independently-reviewable change.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| better-sqlite3 | Storage layer (all of Phase 8) | ✓ | 13.0.1 (pinned) | — |
| Node.js `node:test` runner | Fast suite test, coverage test | ✓ | v22.18.0 | — |
| Node.js `node:child_process` | Multi-process test + soak harness | ✓ (built-in) | v22.18.0 | — |
| Node.js global `fetch` | Soak harness HTTP driving | ✓ (built-in since Node 18) | v22.18.0 | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none — every dependency needed is already installed or built into Node 22.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test`, v22.18.0 |
| Config file | none — bare `node --test` discovery (project convention, confirmed no `test/` subdirectory arg works on this Node version per `test/concurrent-write.test.js`'s own header comment) |
| Quick run command | `node --test test/concurrency-busy-retry.test.js test/busy-503-contract.test.js` |
| Full suite command | `npm test` (== `node --test`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONC-01 | Two spawned processes writing the same deal's `writeDb()` interleaved, hundreds of writes, zero loss | unit/integration (fast, D-12a) | `node --test test/concurrency-busy-retry.test.js` | ❌ Wave 0 |
| CONC-01 | Every registered write route returns 503+Retry-After on a synthetic SQLITE_BUSY, never a swallowed 500 | coverage | `node --test test/busy-503-contract.test.js` | ❌ Wave 0 |
| CONC-01 | Real `server.js` processes, authenticated API writes, acknowledged-write invariant, `PRAGMA integrity_check`, audit 1:1 match | manual/release-gate (D-12b, D-13, D-14) | `npm run soak` | ❌ Wave 0 |
| CONC-01 | Demo showcase boots and behaves identically after the storage-layer change | smoke | existing suite green + a demo boot check (Claude's Discretion per CONTEXT.md) | ✅ (existing suite) |

### Sampling Rate

- **Per task commit:** `node --test test/concurrency-busy-retry.test.js test/busy-503-contract.test.js` (fast, seconds)
- **Per wave merge:** `npm test` (full suite, currently 687/687 passing baseline)
- **Phase gate:** `npm test` full-suite green + `npm run soak` (2-3 processes, ~2 minutes per D-14) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/concurrency-busy-retry.test.js` — covers CONC-01's fast bounded multi-process proof (D-12a); extends `test/concurrent-write.test.js`'s existing tempDbPath()/cleanupDbFile() helpers but MUST spawn real `child_process` instances (see Common Pitfalls #3) rather than reusing that file's in-process pattern
- [ ] `test/busy-503-contract.test.js` — covers the D-06 uniform-contract coverage requirement; mirrors `test/write-validation-coverage.test.js`'s route-enumeration approach (`app._router.stack`) but needs a runtime stub/mock of the write layer to synthetically throw `SQLITE_BUSY`, not a static schema-registry check
- [ ] `scripts/soak.js` — the standalone soak harness (D-12b/D-13/D-14); no existing precedent for spawning real listening `server.js` processes exists in this repo's `test/` or `scripts/` — this is genuinely new territory, built from the verified building blocks in this document's Code Examples section
- [ ] `package.json` — add `"soak": "node scripts/soak.js"` script entry (currently only `start`, `dev`, `test`)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No direct change | Existing session-token auth (`db/sessions.js`) untouched; only its write path gets busy-wait treatment, same as every other table |
| V3 Session Management | Yes (indirect) | `db/sessions.js`'s single-statement writes are covered by the shared `busy_timeout` pragma change in `db/dbFiles.js` — no session-specific logic changes |
| V4 Access Control | No | Out of scope — no authorization logic changes this phase |
| V5 Input Validation | No | No new user-facing input this phase (the client retry hook operates on HTTP status codes, not user data) |
| V6 Cryptography | No | No new cryptographic material this phase |
| V14 Configuration/Error Handling | Yes | The new 503 response must never echo raw `SqliteError.message` or stack trace to the client — return a fixed generic string, matching the existing final-handler discipline at `server.js:6839-6843` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Internal error detail leaked via 503 response body (SQLite file paths, table names in error message) | Information Disclosure | Fixed generic error string in the central middleware, never `err.message` for `SqliteError` instances (see Anti-Patterns / Code Examples) |
| Thundering-herd retry storm under sustained contention (many clients retrying in lockstep) | Denial of Service (self-inflicted) | D-07's client retry already specifies "honoring Retry-After"; add jitter to the client-side wait (Claude's Discretion) to desynchronize simultaneous retries from multiple browser tabs/users |
| Audit no-swallow contract itself becoming a DoS vector: if `audit.db` write consistently fails under load, every write 503s, effectively denying writes entirely | Denial of Service | This is D-10's explicitly *accepted* trade-off (compliance over availability) — not a bug to fix, but the soak harness's pass criteria (D-15) should specifically verify the audit trail matches acknowledged writes 1:1 even under the soak's bounded 503 rate, catching a regression where this accepted trade-off silently becomes unbounded |
| Control-plane silent overwrite (Pitfall 4) treated as a security-relevant integrity gap, not just a correctness bug — MNPI deal membership/clearance changes silently lost under concurrent admin writes | Tampering (unintentional, but same STRIDE bucket as a integrity violation) | Wrap `db/controlStore.js`'s read-modify-write functions in `.immediate()` transactions (see Pitfall 4/Open Question 1) |

## Sources

### Primary (HIGH confidence)
- `node_modules/better-sqlite3/lib/methods/transaction.js` (v13.0.1, installed) — `.immediate`/`.deferred`/`.exclusive` transaction variant API, read and hands-on tested this session
- `node_modules/better-sqlite3/lib/sqlite-error.js` (v13.0.1, installed) — `SqliteError` class shape, `.code` property, read this session
- `db/dbFiles.js`, `db/store.js`, `db/auditHook.js`, `db/sessions.js`, `db/controlStore.js`, `server.js`, `public/js/transitions.js`, `public/js/banners.js`, `public/js/dashboard.js`, `test/concurrent-write.test.js`, `test/write-validation-coverage.test.js`, `test/audit-log.test.js`, `test/role-enforcement.test.js`, `package.json`, `.planning/config.json` — all read directly this session
- Hands-on empirical tests this session: (1) two-connection single-process busy-lock throw, (2) two real spawned Node processes proving correct wait-then-succeed contention resolution, (3) brace-depth scan of `server.js`'s local try/catch blocks wrapping write calls, (4) sync-vs-async route-handler count via grep

### Secondary (MEDIUM confidence)
- [CITED: sqlite.org/rescode.html#busy_snapshot] — SQLITE_BUSY_SNAPSHOT definition, cause, and busy_timeout applicability
- [CITED: sqlite.org/lang_transaction.html] — DEFERRED vs IMMEDIATE vs EXCLUSIVE transaction lock-timing semantics
- `npm view better-sqlite3 version` (registry check this session) — confirms 13.0.3 latest vs 13.0.1 pinned, no upgrade needed

### Tertiary (LOW confidence)
- None — every claim in this document is either a direct file read, a hands-on test performed this session, or a citation to official SQLite documentation fetched this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, existing pinned version confirmed against registry
- Architecture: HIGH — every integration point (dbFiles.js, store.js, auditHook.js, sessions.js, controlStore.js, server.js error chain, transitions.js) read directly this session, with line-numbered verbatim quotes
- Pitfalls: HIGH — three of the six pitfalls are backed by hands-on empirical tests performed this session (deadlock reproduction, real multi-process success, brace-depth scan results), not just domain knowledge

**Research date:** 2026-08-10
**Valid until:** 30 days (stable domain — SQLite/better-sqlite3 semantics do not shift quickly; codebase-specific findings should be re-verified if `server.js` or `db/controlStore.js` change substantially before planning executes)
