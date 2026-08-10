# Phase 8: Concurrency & Storage Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-10
**Phase:** 8-Concurrency & Storage Foundation
**Areas discussed:** Contention UX & retry policy, Soak-test shape, Serialization scope, Busy-wait strategy

---

## Contention UX & retry policy

### What should the browser do on 503 Retry-After?

| Option | Description | Selected |
|--------|-------------|----------|
| Silent auto-retry (Recommended) | Global fetch wrapper transparently retries after Retry-After (2–3 attempts); error surfaces only after retries exhaust | ✓ |
| Visible 'saving…' + retry | Same auto-retry with a visible "server busy, retrying…" indicator; touches many pages | |
| Surface the error immediately | "Server busy — try again" on first 503; user retries manually | |

### How much should the server retry internally before the 503?

| Option | Description | Selected |
|--------|-------------|----------|
| Short budget ~1s (Recommended) | Bounded wait totaling ~1 second, then 503; hands longer waits to the client | ✓ |
| Immediate 503, no server retries | First SQLITE_BUSY → 503; client does all retrying | |
| Generous budget ~5s | Server holds up to ~5s; fewer 503s but requests hang and block the event loop | |

### If client retries also exhaust, what does the user see?

| Option | Description | Selected |
|--------|-------------|----------|
| Error toast, edit preserved (Recommended) | Existing banner/toast: "Server is busy — your change was not saved." Form state kept, no reload | ✓ |
| Blocking dialog with Retry button | Modal with Retry/Cancel re-firing the request | |
| Page-level failure state | Generic network-failure handling wherever pages have it | |

### Where should the client-side retry logic live?

| Option | Description | Selected |
|--------|-------------|----------|
| Global hook in transitions.js (Recommended) | The existing app-wide /api fetch interceptor; covers every page and future phases with one change | ✓ |
| New shared module | Opt-in public/js/api-retry.js; coverage risk | |
| Only the co-edited flows | Retrofit just RAID/tasks/DD/synergy/org saves | |

---

## Soak-test shape

### How should the multi-process soak test live in the repo?

| Option | Description | Selected |
|--------|-------------|----------|
| Fast suite test + soak script (Recommended) | Bounded multi-process test in the node --test suite + standalone npm run soak harness for gates/releases | ✓ |
| Suite test only | A few seconds of load only; weaker proof | |
| Standalone harness only | Manual gate runs; regressions undetected between gates | |

### At what level should the tests drive writes?

| Option | Description | Selected |
|--------|-------------|----------|
| Store-level suite, HTTP soak (Recommended) | Suite: child processes call writeDb() directly against a shared deal file. Soak: real server.js processes on separate ports, authenticated API writes end-to-end | ✓ |
| Store-level everywhere | Never proves the HTTP 503/Retry-After contract | |
| HTTP everywhere | Suite test gets slow and brittle | |

### What must be true to PASS?

| Option | Description | Selected |
|--------|-------------|----------|
| Acknowledged-write invariant (Recommended) | Every acknowledged write persists exactly; rejects are clean bounded 503s; integrity_check passes; audit matches 1:1. Bounded 503s allowed | ✓ |
| Zero failures at all | No 503s reach the harness; flaky on slow CI | |
| No-loss only | Skips integrity/audit assertions | |

### Soak harness default scale?

| Option | Description | Selected |
|--------|-------------|----------|
| 2–3 procs, ~2 min, configurable (Recommended) | Mirrors replicas:1 + rolling-restart overlap, with knobs for harder gate runs | ✓ |
| Aggressive default (5+ procs, 10+ min) | Overshoots the deployment model on every run | |
| Fixed 2 processes, no knobs | No way to push harder at a release gate | |

---

## Serialization scope

### Which database files get .immediate() + busy-retry this phase?

| Option | Description | Selected |
|--------|-------------|----------|
| All SQLite files uniformly (Recommended) | Deal/demo via writeDb() plus direct-SQL writers (sessions, control, audit) through one shared helper in db/dbFiles.js | ✓ |
| writeDb() only this phase | Login and audit writes stay unprotected in rolling-restart windows | |
| Deal DBs only | Narrowest reading; control-plane exposed | |

### If the audit.db append stays busy after retries?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep no-swallow: 503 the request (Recommended) | Preserves "no acknowledged action without an audit row" (Phase-3 D-11 MNPI invariant); client retry re-applies idempotently | ✓ |
| Acknowledge write, queue audit | Breaks the audit-before-ack contract | |
| Acknowledge write, log-and-drop | Silently missing audit entries | |

### Uniform 503 contract for control-plane writes?

| Option | Description | Selected |
|--------|-------------|----------|
| Uniform 503 everywhere (Recommended) | One contention contract for every write incl. login/deal-registry/user-admin | ✓ |
| Special-case auth endpoints | Second contract to maintain; login still needs its own retry UX | |

---

## Busy-wait strategy

### How to implement the ~1s server budget with synchronous better-sqlite3?

| Option | Description | Selected |
|--------|-------------|----------|
| Sync: busy_timeout ≈ 1s does the waiting (Recommended) | BEGIN IMMEDIATE waits inside SQLite up to ~1s then throws → 503. writeDb() stays sync, zero call-site changes. Accepted: contended waits block that process's event loop up to ~1s | ✓ |
| Async retry wrapper | ~90 call sites become await writeDb(); missed-await = silent ack-before-write bug class | |
| Sync short-slice retries | Same total block time in slices; more code, no gain | |

### Where does the SQLITE_BUSY → 503 mapping live?

| Option | Description | Selected |
|--------|-------------|----------|
| Central error middleware (Recommended) | One Express error handler for all write paths; future endpoints inherit for free; coverage-test assertable | ✓ |
| Per-route try/catch | ~90 places to keep consistent | |
| You decide | Leave mechanism to planner/executor | |

---

## Claude's Discretion

- Exact busy_timeout value within the ~1s budget; Retry-After value and jitter; client backoff details
- Internal shape of the shared retry/open helper in db/dbFiles.js
- Soak harness process-orchestration mechanics (spawn, ports, teardown)
- How the demo/turnkey "behaves identically" criterion is verified

## Deferred Ideas

- WAL checkpoint management / unbounded -wal growth → Phase 10
- Health/readiness endpoints, migration-on-boot → Phase 10
- Rolling-restart runbook / process supervision → Phases 10–11
- Optimistic locking (409 + reload-and-reapply) → Phase 9 — keep 503 (contention) and 409 (conflict) as distinct signals
