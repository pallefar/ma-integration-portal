---
phase: 08-concurrency-storage-foundation
reviewed: 2026-08-10T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - db/auditHook.js
  - db/controlStore.js
  - db/dbFiles.js
  - db/store.js
  - package.json
  - public/js/transitions.js
  - scripts/soak.js
  - server.js
  - test/busy-503-contract.test.js
  - test/client-busy-retry.test.js
  - test/concurrency-busy-retry.test.js
  - test/control-plane-serialization.test.js
  - test/db-file-layout.test.js
  - test/reports-pack.test.js
findings:
  critical: 1
  warning: 5
  info: 2
  total: 8
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-08-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Reviewed the full diff for Phase 8 (busy_timeout tuning, `.immediate` locking on
db/store.js's writeDb() + db/auditHook.js's writeAuditBatch() + db/controlStore.js's
five read-modify-write functions, the central `isBusyError()` → 503 Retry-After
middleware with its 9 local catch-site guards and 4 async next() forwards, the
client-side silent-retry + give-up toast in transitions.js, and the scripts/soak.js
multi-process harness). All 5 targeted test files plus a manual `SOAK_DURATION_MS=8000
SOAK_PROCESSES=2 node scripts/soak.js` run were executed and pass; no test
regressions were found, `git status --porcelain data/` stayed clean after the soak
run, and no orphaned soak processes were left behind.

The structural design is sound and the documented reasoning throughout is unusually
careful. However, tracing the FULL write path (deal-commit → separate audit-append →
central 503 → client auto-retry) surfaced one genuine data-integrity BLOCKER: the
new client-side silent retry, introduced by this exact phase, can turn the
already-accepted "deal write committed but its audit row failed" trade-off into a
silently duplicated MNPI business record, because the retried request mints a brand
new server-side id rather than replaying an idempotent write. This was not caught by
`scripts/soak.js`'s own verification because its load generator does not replay a
failed write the way the real browser client does. Several secondary concurrency
gaps (an unguarded dedup-then-create race on deal creation, an unguarded `seq`
race, and a Windows file-unlock race on deal deletion) round out the warnings —
none of them were touched by this phase, but all sit adjacent to the exact class of
bug (unguarded read-then-write on MNPI control-plane data) this phase closed
elsewhere, so the coverage gap is worth flagging.

## Critical Issues

### CR-01: The new client-side auto-retry can silently duplicate a committed write when only the (separate) audit append is contended

**File:** `db/store.js:319-401` (writeDb), `db/auditHook.js:96-129` (writeAuditBatch),
`server.js:6560-6578` (representative write route, `POST /api/pulses`),
`public/js/transitions.js:78-124` (the new client retry)

**Issue:**

`writeDb()` commits the deal-level write in its OWN `.immediate` transaction first
(`db/store.js:319-375`), then — only after that has already committed — dispatches
the audit batch as a **second, independent** transaction against the shared,
process-wide `audit.db` connection (`db/store.js:381-401`, `db/auditHook.js:96-129`).
This second write is explicitly NOT wrapped in a try/catch (by design — see both
files' own "no-swallow" comments): if it hits `SQLITE_BUSY*` (audit.db is one file
shared by **every deal and every route** in the whole deployment, so it is the
single most contended file in the system under concurrent multi-process load — far
more contended than any individual deal's own file), the error propagates uncaught
all the way to server.js's new central middleware, which 503s the **whole request**.

At this point the deal-level row (e.g. a new pulse, a new RAID item, a new
assessment, …) has **already committed** — the client is being told "this failed"
about a write that, server-side, fully succeeded except for its audit entry.

This phase's own new client wrapper (`public/js/transitions.js:95-106`) sees that
503 on a same-origin `/api` write with a re-sendable string body and **automatically
retries the identical request**, invisibly to the user. The retried request re-runs
the whole route handler from scratch: `readDb()` again, and — critically — mints a
**brand-new server-side id** via `newId(...)` (e.g. `server.js:6567`,
`id: newId('pulse')`), then `writeDb()`s that as a genuinely new row. This pattern
(`newId()` minted fresh per handler invocation, no client-supplied idempotency key)
is the standard shape for effectively every write route in this app — db/store.js's
own module header describes "~90 endpoint call sites" using this exact whole-object
`readDb()`/`writeDb()` contract.

Net effect: the user sees exactly one success response, but the database now
contains **two** rows for what was one user action — the first committed-but-
unaudited (an MNPI record with literally no compliance trail, since it was never
audited and the id was never returned to any client) and the second committed-and-
audited (the one the user sees). For a financial collection (synergies, RAID cost/
benefit fields) this directly double-counts figures rolled up into steerco exports
and the PDF pack — a materially incorrect outcome for a real-acquisition financial
report, not just a cosmetic duplicate.

This directly contradicts `db/auditHook.js:110-115`'s own stated safety argument
("writeDb()'s snapshot-diff merge re-applies an identical payload idempotently, converging
to the same state, so the 503-then-retry the client already performs costs nothing
beyond the wait"). That argument is true for `writeDb()` called twice with the exact
same `data` object/snapshot **within one request** — it does not hold across an
HTTP-level retry that re-executes application logic and mints a fresh id, which is
exactly what happens here. Nothing in this phase's diff — including
`scripts/soak.js`'s verification pass — actually exercises this path: the soak
harness's own load generator (`scripts/soak.js:238-314`, `doWrite()`) does **not**
retry a refused write with the identical payload the way the real client does; a
refused attempt is simply bucketed as `refused` and the loop moves on with a new,
distinct correlator on the next iteration. So the harness's "PASS" cannot and does
not detect this class of bug.

Before this phase, an uncaught busy error on the audit append fell through to the
existing generic 500 handler, with no systematic client-side auto-retry at all — a
user might or might not manually resubmit. This phase specifically (a) gave this
exact failure category a distinct, retry-inviting 503 signal and (b) added an
automatic, invisible, identical-payload client retry — which is what turns a
previously rare/manual-retry-dependent edge case into a systematic, invisible
duplicate-creation mechanism. This is squarely inside this phase's own new surface
area, not a pre-existing issue.

**Fix:**

There is no single one-line fix here — this needs a design decision — but two
concrete directions, in order of surgical-ness:

1. Smallest mitigation: retry the audit append itself, in-process, a bounded number
   of times with a short backoff **before** giving up, inside `writeAuditBatch()` /
   `writeDb()`'s audit-dispatch block — this shrinks (does not eliminate) the window
   in which a client-visible 503 can follow an already-committed deal write:
   ```js
   // db/store.js, replacing the direct auditHook.writeAuditBatch(...) call
   let auditAttempts = 0;
   while (true) {
     try {
       auditHook.writeAuditBatch(auditHook.getAuditConnection(), { actor, dealId: scoped.dealId || null, dbKind: auditKind, request: scoped.request || null, ts: new Date().toISOString(), rows: deltas });
       break;
     } catch (auditErr) {
       auditAttempts++;
       if (!isBusyError(auditErr) || auditAttempts >= 3) throw auditErr;
       // brief synchronous backoff before retrying the audit append only
     }
   }
   ```
2. Structural fix: give write routes an idempotency key (client-generated UUID sent
   with the write, stored on the row, checked before insert) so a retried request
   with the same key updates/no-ops instead of inserting a second row. This is the
   only fix that closes the gap completely, but it is a larger, cross-cutting change
   (touches the ~90 write call sites, or at minimum the highest-value ones —
   pulses, RAID, synergies, assessments) and should be scoped as its own follow-up
   rather than folded into this phase's closeout.

At minimum, this needs to be an explicit, escalated decision (accept the residual
duplicate-row risk with eyes open, documented alongside D-10's existing trade-off
note; or take option 1/2 above) rather than left as an implicit consequence of
combining D-07's client retry with D-10's audit trade-off.

## Warnings

### WR-01: `POST /api/deals`'s duplicate-create guard is a cross-process TOCTOU race

**File:** `server.js:766-792`, `db/controlStore.js:221-230` (`findUnfinishedDealFor`),
`db/controlStore.js:155-184` (`createDeal`)

**Issue:** `findUnfinishedDealFor()` (a read) and `createDeal()` (a write) are two
separate, unwrapped database operations. Within a single process this is
effectively atomic (no `await` between them), but under the exact multi-process
deployment model this phase newly makes safe, two different `node server.js`
processes can both run `findUnfinishedDealFor()` (each sees "no existing unfinished
deal"), then both call `createDeal()`, producing two distinct deal registry rows
(each with its own provisioned database file) for what the operator intended as one
wizard submission — precisely the double-deal scenario the G-04-8 dedup guard
(`server.js:768-778`) exists to prevent, just not closed against the process
boundary this phase's own architecture introduces. This sits directly adjacent to
the five functions D-09 wrapped in `.immediate` for exactly this class of race, but
was not itself in scope.

**Fix:** Wrap the check-then-create as one `.immediate` transaction on `control.db`
(mirroring the shape already used by `updateDealMembers()` etc. in
`db/controlStore.js`), or accept the residual risk explicitly and document it next
to D-09's own scope note.

### WR-02: `createDeal()`'s `seq` assignment is an unguarded read-then-write

**File:** `db/controlStore.js:155-183`, `db/control-schema.sql:37-42`

**Issue:** `createDeal()` computes `seqRow = SELECT COALESCE(MAX(seq), -1) + 1 …`
and then `INSERT`s using that value, with no `.immediate` wrapping. `seq` has no
`UNIQUE` constraint (`db/control-schema.sql:40`, `seq INTEGER NOT NULL`), so two
concurrent `createDeal()` calls across processes can both read the same `MAX(seq)`
and commit with identical `seq` values. This does not lose data (both deals persist
under their own unique `id`), but it silently breaks the stable creation-order sort
`listDeals()` (`ORDER BY seq`) relies on for admin-facing deal listings, and is the
same unguarded-read-then-write shape D-09 fixed for the five sibling functions in
this same file.

**Fix:** Wrap the seq-read + insert in a `.immediate` transaction, same pattern as
`updateDealMembers()`.

### WR-03: `deleteDeal()` can throw an uncaught, non-503 filesystem error under concurrent access, especially on Windows

**File:** `db/controlStore.js:367-377`

**Issue:** `deleteDeal()` is not wrapped in `.immediate` (reasonable — it's a plain
DELETE, not a lost-update-prone read-modify-write) but it also unlinks the deal's
`.db`/`-wal`/`-shm` files with only an `ENOENT`-tolerant catch:
```js
for (const ext of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(targetPath + ext); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
```
On Windows, an open file cannot be unlinked at all (this exact constraint is called
out in `closeConnection()`'s own doc comment a few lines above in this same file).
If a **different** process (this phase's whole point is that there can be one) still
holds the deal's file open at the moment of deletion — e.g. mid-write on a request
that started just before the delete — this throws an `EBUSY`/`EPERM`-style fs error.
`isBusyError()` only recognizes `err.code` starting with `SQLITE_BUSY`, so this
fs error is NOT caught by the phase's new central 503 middleware; it falls through
to the generic 500 handler, breaking the phase's own "every write path uniformly
503s under contention" contract for this one path, and doing so specifically on the
Windows deployment target this project's turnkey release supports.

**Fix:** Either explicitly catch and re-map Windows file-lock errors (`EBUSY`,
`EPERM`) to the same 503 contract in this function (or in server.js's catch site
around it), or document this as an accepted gap alongside D-09's stated scope
(archival via `archiveDeal()` is already the recommended non-destructive path).

### WR-04: The central busy-error middleware doesn't guard `res.headersSent`

**File:** `server.js:6916-6923` vs. the very next handler, `server.js:6926-6930`

**Issue:** The new central 503 middleware:
```js
app.use((err, req, res, next) => {
  if (isBusyError(err)) {
    res.set('Retry-After', String(retryAfterSeconds));
    return res.status(503).json({ error: 'Server is busy. Please try again.' });
  }
  next(err);
});
```
does not check `res.headersSent` before calling `res.status(...)`, unlike the final
generic handler immediately below it (`if (res.headersSent) return next(err);`).
No route currently reachable in this diff throws a busy error after already calling
`res.send()`/`res.json()`, so this is latent rather than actively triggered today —
but it is the direct sibling of a handler that DOES guard this, in the same file,
and any future route that streams a response before a later SQLite write (e.g. a
future large export that flushes partial output) would hit
`ERR_HTTP_HEADERS_SENT` inside error-handling middleware itself.

**Fix:**
```js
app.use((err, req, res, next) => {
  if (isBusyError(err)) {
    if (res.headersSent) return next(err);
    res.set('Retry-After', '1');
    return res.status(503).json({ error: 'Server is busy. Please try again.' });
  }
  next(err);
});
```

### WR-05: `isRetryableBody()` only inspects `init.body`, not a `Request` object's own body

**File:** `public/js/transitions.js:89-91, 117-124`

**Issue:**
```js
const isRetryableBody = (init) => init.body === undefined || init.body === null || typeof init.body === 'string';
```
This correctly handles every current caller in this codebase (every `/api` write
passes `body` via the `init` object as a `JSON.stringify(...)` string — confirmed,
no `FormData`/`Request` usage found anywhere under `public/js/`). But if any future
caller invokes `window.fetch(new Request(url, { method, body }))` (passing a
pre-built `Request` whose body is a stream), `init` would be `{}`/undefined and this
check would judge the retry "safe" even though the original `Request`'s body stream
was already consumed by the first `origFetch()` call — a retry would then send an
empty/broken body or throw. This is the one app-wide fetch wrapper (loaded on every
page), so it's worth hardening even though nothing currently exercises the gap.

**Fix:** Also treat `input instanceof Request` as non-retryable (or explicitly clone
it), e.g.:
```js
const isRetryableBody = (input, init) => {
  if (typeof Request !== 'undefined' && input instanceof Request) return false;
  return init.body === undefined || init.body === null || typeof init.body === 'string';
};
```

## Info

### IN-01: `scripts/soak.js`'s `BASE_PORT` collision window

**File:** `scripts/soak.js:167`

**Issue:** `BASE_PORT = 4100 + (process.pid % 400)` reduces but does not eliminate
the chance of two concurrent soak runs on the same host picking overlapping port
ranges (two different PIDs can share the same `% 400` residue). The file's own
comment acknowledges this as "unlikely," which is accurate, but worth noting if this
script is ever wired into a CI environment that might run several soak jobs in
parallel on one runner.

**Fix:** Optionally derive the port offset from `crypto.randomInt()` instead of
`pid % 400` for a larger, less collision-prone range, or bind to port `0` and read
back the assigned port (would require reworking the peer-URL wiring workers use).

### IN-02: Multiple give-up toasts can visually stack

**File:** `public/js/transitions.js:58-76`

**Issue:** `showBusyGiveUpToast()` always creates a new fixed-position element at
`bottom: 2rem; right: 2rem`. If two different in-flight writes both exhaust their
retry budget around the same time (plausible under sustained contention — exactly
the scenario this phase targets), two toasts stack exactly on top of each other for
their 5s lifetime, rather than being deduplicated or offset.

**Fix:** Track whether a give-up toast is currently visible and either reuse/refresh
it or stagger new ones (offset `bottom` by an index), rather than unconditionally
appending a new `<div>` per failed write.

---

_Reviewed: 2026-08-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
