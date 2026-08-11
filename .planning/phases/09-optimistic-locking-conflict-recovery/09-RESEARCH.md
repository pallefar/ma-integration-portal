# Phase 9: Optimistic Locking & Conflict Recovery - Research

**Researched:** 2026-08-11
**Domain:** In-repo optimistic concurrency control (SQLite JSON-blob storage layer + Express write routes + vanilla-JS fetch wrapper)
**Confidence:** HIGH (storage/route mechanics — read and hands-on tested against live code); MEDIUM (client dialog UX mechanics — reasoned from code, not yet built); LOW (none — no claims left unverified/uncited without a flag)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Conflict granularity**
- **D-01:** **Strict per-record version.** One version per record; ANY save based on a stale version gets a 409 — even when the concurrently-changed fields don't overlap with the incoming patch. No per-field version map, no server-side auto-merge: a merged state no single user reviewed is worse for MNPI data than an extra one-click 409. Matches CONC-02's letter (one version in the blob, one WHERE clause). — **Reversibility:** costly — moving to field-aware later means adding per-field version bookkeeping to every record blob and reshaping the 409 body contract the client dialog consumes.
- **D-02:** **Uniform check, no exemptions.** Quick single-field actions (kanban status flips, checkbox toggles) go through the same version check as full edits. No last-write-wins carve-outs — an exemption would reintroduce the silent-clobber class this phase closes, and the coverage test stays simple (one rule, zero documented exceptions).

**409 recovery UX**
- **D-03:** **Compare dialog + one-click reapply.** On 409 the user sees a shared conflict dialog: side-by-side of the fields they changed — their value vs what's now on the server — with exactly two actions: **"Apply my changes anyway"** (re-submits their patch against the fresh version, one click) and **"Discard mine, keep theirs"**. In-progress form state is never lost, discarded, or navigated away (extends Ph8 D-08's form-preservation principle from contention to conflict).
- **D-04:** **Attribution shown.** The conflict surface says who made the competing change and when — "Changed by karen 2 min ago" — sourced from the record's audit context and carried in the 409 response body. The viewer is already a deal member with access to the record; no new exposure. At 15-person scale the right resolution is often a conversation, and the name enables it.
- **D-05:** **One shared component, wrapper-detected.** The Phase 8 fetch wrapper in `public/js/transitions.js` detects 409s on same-origin `/api` writes and renders one shared conflict dialog from the 409 body. **The wrapper must NEVER silently auto-retry a 409** (that machinery is for 503 contention only — a conflict is a user decision). No per-page wiring is required to ship; every current and future write surface inherits the contract, mirroring Ph8's uniform-contract pattern. — **Reversibility:** reversible — pages can later layer tailored conflict views over the shared one without changing the server contract.

**Versioning scope**
- **D-06:** **All co-edited deal-data collections.** The version check covers every deal-data collection with the field-patch upsert pattern — the five CONC-02-named (RAID entries, integration tasks, DD findings, synergy initiatives, org decisions) **plus** DD request items, org positions, flight-risk entries, and any siblings the planner enumerates from the route inventory. CMS/settings singletons and whole-document admin blobs (pages, menus, courses, settings) are **excluded** — they are admin-edited documents, not co-edited records, and demo-mode showcase mechanics write them constantly. A coverage test (in the mold of Ph8's `test/busy-503-contract.test.js`) asserts every in-scope upsert route enforces the version check so a future route cannot ship unprotected.
- **D-07:** **Control plane deferred to Phase 12.** Deal members/grants/user-admin writes keep their Ph8 state (serialized `.immediate`, wholesale-replace, last-writer-wins). Phase 12's COLLAB-01 invite/clearance model reshapes these flows anyway; versioning them now is double work. The Ph8 flag — `updateDealMembers()` wholesale-replace semantics need caller-side retry-with-fresh-read (documented in `test/control-plane-serialization.test.js` header) — is carried forward as an explicit input to Phase 12 planning.

**Version mechanics & edges**
- **D-08:** **409 on stale delete.** Deleting a record based on a stale version gets the same 409 + conflict surface ("karen updated this 2 min ago — still delete?"), with confirm-delete as the reapply action. Destroying an MNPI record someone just changed deserves the second look; keeps D-02's no-exemptions rule intact.
- **D-09:** **Lazy version adoption — no migration.** A record without a version field is treated as version 0; the first successful write stamps the incremented version into the blob. Reads pass versions through untouched. No migration script, no boot-time backfill: the committed `demo.db` and existing deal DBs stay byte-identical until genuinely written — no WAL-trap risk, no turnkey-bundle churn, and legacy records gain protection the moment two people co-edit one. — **Reversibility:** reversible — a later backfill can still be run if uniform stamping is ever wanted.

### Claude's Discretion
- Version field name/location inside the record blob, increment semantics, and the exact WHERE-clause enforcement mechanics in `db/store.js` `writeDb()` (route-level precheck vs writeDb-level enforcement vs both — CONC-02 requires the WHERE clause to be load-bearing; the rest is implementation).
- 409 response body shape (current record + version + actor/time), and how the client threads the loaded version through forms and quick actions.
- Conflict dialog visual design (should feel native to the existing modal/toast patterns; textContent-only per house XSS rules).
- How "Apply my changes anyway" is implemented client-side (re-fire the original patch with the fresh version).
- Interplay details with the Ph8 silent 503 retry (a 503-retried request re-sends the same version — safe by Ph8's CR-01 fix since nothing persisted; ensure the wrapper's 409 branch is checked before/independent of the 503 branch).
- Coverage-test mechanics and how conversions (finding→RAID/task) are treated (they create new records — creates carry no version precondition).

### Deferred Ideas (OUT OF SCOPE)
- Control-plane conflict detection (deal members/grants) → Phase 12 COLLAB-01 — carries the Ph8 flag: `updateDealMembers()` wholesale-replace means concurrent-addition survival needs caller-side retry-with-fresh-read.
- Per-field version map / field-aware merge — revisit only if strict-record 409s prove too noisy in real use.
- Presence / "someone else is editing" indicators — realtime collaboration territory, Phase 12+ if ever.
- Stale-form warning polling ("this record changed while your modal is open") — nice-to-have on top of the 409 contract, not this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONC-02 | "A user whose edit to a co-edited record (RAID entry, integration task, DD finding, synergy initiative, org decision) is based on stale data has that write rejected with a 409, and the UI offers a reload-and-reapply path rather than silently clobbering — optimistic locking enforced in the SQL WHERE clause (version carried in the record's JSON blob)." [VERIFIED: .planning/REQUIREMENTS.md:12] | Standard Stack + Architecture Patterns 1-2 establish the JSON-blob + `json_extract()` WHERE-clause mechanism is achievable with the installed `better-sqlite3@13.0.1`, hands-on verified. Common Pitfalls 1-9 enumerate every concrete implementation hazard found by reading the actual ~20-route inventory and the storage layer. Validation Architecture maps all three of the phase's success criteria to concrete test files. Pitfall 8 flags that "org decision" (named in the requirement text) has no mutable write path today — a scope clarification the planner should carry into task breakdown. |
</phase_requirements>

## Summary

Phase 9 adds no new library and no new database file — it is a targeted extension of three pieces of code Phase 8 already hardened: `db/store.js`'s generic `writeDb()` snapshot-diff merge, the ~20 field-patch upsert/delete routes in `server.js` that share one `if (b.id) { find, mutate in place, writeDb(db) }` shape, and the single fetch-wrapper interception point in `public/js/transitions.js`. All three are read in full below; none needs a rewrite, all three need a surgical, uniform addition.

The load-bearing technical fact this research establishes hands-on: **SQLite's `json_extract()` works inside an `UPDATE ... WHERE` clause against the existing `data TEXT` column**, verified directly against the installed `better-sqlite3@13.0.1` in this sandbox (see Code Examples). This means CONC-02's literal requirement — "version carried in the record's JSON blob, enforced in the SQL WHERE clause" — is achievable **without a schema migration and without a new column**, which is exactly what D-09's "lazy adoption, no migration, `demo.db` stays byte-identical until genuinely written" decision requires. No `ALTER TABLE`, no boot-time backfill, no touching `db/schema.sql`'s `CREATE TABLE IF NOT EXISTS` blocks.

The second load-bearing fact: because every route re-reads the database at the top of the request (`const db = readDb()`), the server's own view of a record is **always current**, never stale — so the "staleness" CONC-02 must catch can only be detected by comparing the **client's own remembered version** (something the client must now send back on every write) against the server's freshly-read value. That comparison needs to happen in **two places, not one**: a route-level precheck (client version vs. this request's own `readDb()` snapshot) for a fast, informative 409 in the common case, and the SQL `WHERE json_extract(data,'$.version') = ?` clause **at the moment `writeDb()`'s `.immediate` transaction actually executes**, to close the cross-process race window Phase 8's multi-process WAL model introduced (a second OS process can write between this request's `readDb()` and its `writeDb()`). Relying on only the route-level check would silently reopen exactly the class of bug CONC-01 closed for same-collection races.

**Primary recommendation:** Add a `version` (integer) field to the record's own JSON blob, stamped by `writeDb()` itself (not by route handlers) so every in-scope collection gets uniform, centrally-enforced behavior; add `updatedBy`/`updatedAt` to the same blob (not sourced from `audit.db`, which structurally excludes demo-mode writes — see Pitfall 10) for D-04's attribution; enforce the WHERE-clause check inside `writeDb()`'s existing `.immediate` transaction, gated by a new `VERSIONED_COLLECTIONS` set (mirroring `db/auditHook.js`'s existing `AUDITED_DB_KINDS` precedent) so CMS/admin collections stay untouched; surface conflicts as a **distinguishable** 409 body (existing 409s already exist in this codebase for unrelated business rules — see Pitfall 1) that the `transitions.js` wrapper detects by a body marker, never by status code alone.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Version stamping on write | API / Backend (`db/store.js` `writeDb()`) | Database / Storage (JSON blob column) | Centralizing the increment inside `writeDb()` — not in each of the ~20 route handlers — is the only way D-06's coverage test can assert "every in-scope route is protected" structurally rather than by convention. |
| Stale-write detection (WHERE-clause enforcement) | Database / Storage (SQLite `json_extract()` in the `UPDATE`/`DELETE` statement) | API / Backend (`writeDb()` orchestrates it) | Must execute inside the `.immediate` transaction to be race-free against Phase 8's multi-process writers — a JS-level-only check (outside the transaction) cannot close that window. |
| Fast/informative 409 precheck | API / Backend (route handler, before mutation) | — | Gives the client a useful body (current record + attribution) without paying for a failed transaction; the WHERE-clause check remains load-bearing as the actual race-closer. |
| 409 detection + shared dialog rendering | Browser / Client (`public/js/transitions.js` fetch wrapper) | — | One interception point already exists for 503s (Phase 8); D-05 locks this as the single place a 409 branch belongs — no per-page wiring. |
| Attribution data ("changed by X, N min ago") | Database / Storage (record blob's own `updatedBy`/`updatedAt`) | — | `audit.db` structurally excludes demo-mode writes (`AUDITED_DB_KINDS = Set(['deal','control'])` — verified, see Pitfall 10); blob-embedded attribution works uniformly for demo and real deals with no cross-database query. |
| Write validation of the new `version` field | API / Backend (`validators/*.js` zod schemas) | — | `z.object(shape)` strips unknown keys by default (verified in `validators/index.js:8-10`) — a client-supplied `version` is silently dropped unless every in-scope schema explicitly declares it. |
| Coverage gate (no route ships unprotected) | API / Backend (a new `test/optimistic-locking-contract.test.js`) | — | Mirrors the exact structural-scan + live-route-inventory + real-behavior + negative-control shape of `test/busy-503-contract.test.js` (Phase 8's own precedent). |

## Standard Stack

No new package is introduced this phase. Every mechanism below already exists in the repo at the pinned version shown; the work is additive code in three existing files.

### Core (existing, no new dependencies)
| Library | Installed Version | Purpose in this phase | Why no alternative needed |
|---------|---------|---------|--------------|
| `better-sqlite3` | 13.0.1 [VERIFIED: package.json:17] | `json_extract()`/`json_extract(data,'$.version')` inside `UPDATE`/`DELETE` WHERE clauses — the CONC-02-mandated enforcement point | Bundles SQLite's JSON1 extension; confirmed working hands-on against this exact installed version (see Code Examples) — no separate JSON library or ORM needed |
| `zod` | 4.4.3 [VERIFIED: package.json + `node -e "console.log(require('zod/package.json').version)"`] | Bounds/type-check the new `version` field on every in-scope upsert schema | Already the sole validation layer (`validators/*.js`); adding one field to existing schemas, not a new dependency |
| `node:test` | Node built-in [VERIFIED: package.json:`"test": "node --test"`] | The coverage-gate test and the cross-process proof test | Already the test runner for `test/busy-503-contract.test.js` and every Phase 8 concurrency test |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSON-embedded `version` field + `json_extract()` WHERE clause | A dedicated `version INTEGER` column added via schema migration | Faster (indexable) per general SQLite guidance [CITED: general optimistic-locking pattern discussion], but requires `ALTER TABLE` + backfill, directly contradicting D-09's locked "no migration, `demo.db` byte-identical until genuinely written" decision. Rejected — not compatible with the locked decision. |
| Body-embedded version field (client re-sends `version` in the JSON PATCH payload) | HTTP `If-Match` conditional-request header + `ETag` response header | The `If-Match`/`ETag` pattern is the REST-standard mechanism for optimistic concurrency [CITED: general REST API guidance]. Rejected for this phase — every existing upsert route already threads its precondition data through the JSON body (`b.id`, `b.title`, …), and CONTEXT.md's own wording ("version carried in the record's JSON blob") locks the body-embedded approach; introducing header-based conditional requests would be a second, inconsistent mechanism sitting next to the body-driven one every other field already uses. |
| Attribution sourced from `audit.db` | Attribution embedded in the record blob (`updatedBy`/`updatedAt`) | `audit.db` only records `'deal'`/`'control'` kind writes (`db/auditHook.js:55` `AUDITED_DB_KINDS = new Set(['deal', 'control'])` [VERIFIED: db/auditHook.js:55], `'demo' is deliberately excluded` per the same file's own comment) — sourcing attribution from audit.db would silently have no data for any demo-mode record. Blob-embedded is recommended (see Pitfall 10). |

**Installation:** None — no `npm install` required this phase.

## Package Legitimacy Audit

**Not applicable this phase.** No external package is added, upgraded, or newly relied upon — every mechanism (JSON1/`json_extract`, zod schema fields, `node:test`) is already installed and pinned in `package.json`, verified above. The Package Legitimacy Gate protocol is skipped per its own scope ("whenever this phase installs external packages").

## Architecture Patterns

### System Architecture Diagram

```
 Browser (public/js/*.js pages, e.g. execution.js)
   │
   │ fetch('/api/raid', { method:'POST', body: JSON.stringify({ id, title, version }) })
   ▼
 public/js/transitions.js  — ma-fetch-wrapper (single interception point, Phase 8 precedent)
   │  window.fetch override: attemptFetch(input, init, url, method, attempt)
   │
   ├─ res.status === 503 (contention) ──► existing bounded silent retry (D-07, Ph8) — UNCHANGED
   │
   ├─ res.status === 409 AND body.conflict === true (NEW, Ph9) ──► render shared conflict dialog
   │                                                                 from body.currentRecord/
   │                                                                 currentVersion/changedBy/
   │                                                                 changedAt — NEVER auto-retried
   │
   └─ everything else ──► pass through unchanged (pages already no-op on !res.success bodies —
                            see Pitfall 12; a plain 409 unrelated to conflicts, e.g. the existing
                            "deal has no data" 409, must NOT trigger the dialog — see Pitfall 1)
   │
   ▼
 server.js — one of ~20 field-patch upsert routes, e.g. POST /api/raid (line 4208)
   │  const db = readDb();               // ALWAYS current — server never trusts a stale in-memory copy
   │  const item = lane.find(r => r.id === b.id);
   │  if (item.version !== undefined && b.version !== undefined && b.version !== item.version) {
   │    return res409ConflictBody(item, ...);   // FAST PATH — no transaction attempted
   │  }
   │  ...mutate item fields from b...
   │  writeDb(db);                        // may STILL throw a conflict — see below
   ▼
 db/store.js — writeDb(data)
   │  conn.transaction(payload => { ... }).immediate     // BEGIN IMMEDIATE — Phase 8's race-free lock
   │
   │  for each VERSIONED collection's UPDATE-branch row:
   │    UPDATE <collection> SET data = ?
   │      WHERE id = ?
   │        AND (json_extract(data,'$.version') IS NULL     -- lazy adoption (D-09): legacy row, no version yet
   │             OR json_extract(data,'$.version') = ?)      -- the version THIS caller believed was current
   │
   │    changes === 0 AND row still exists  ──► THROW a typed conflict (aborts whole .immediate txn,
   │                                              nothing partially commits — see Pitfall 6)
   │    changes === 0 AND row now deleted   ──► existing CR-02 no-resurrect no-op (pre-Ph9 behavior,
   │                                              UNLESS this collection also protects update-into-delete
   │                                              — see Open Questions)
   │    changes === 1                        ──► commit; audit append still runs INSIDE this same
   │                                              transaction (Ph8 CR-01 fix, unchanged by Ph9)
   ▼
 server.js central error middleware (line 6923, sibling to the existing 503 handler)
   │  isConflictError(err) ──► 409 { conflict: true, currentRecord, currentVersion, changedBy, changedAt }
   │  isBusyError(err)     ──► 503 Retry-After: 1        (UNCHANGED, Ph8)
   ▼
 back to the browser's conflict dialog (or success)
```

### Recommended Project Structure
No new top-level modules. Changes land inside the existing file set:
```
db/
├── store.js          # writeDb(): version-check + stamp inside the .immediate transaction, gated by VERSIONED_COLLECTIONS
├── collections.js     # add VERSIONED_COLLECTIONS export (mirrors AUDITED_DB_KINDS precedent in auditHook.js)
server.js               # ~20 upsert/delete routes: route-level precheck + conflict-body construction; new central 409 middleware
validators/*.js         # add version: z.number().int().nonnegative().optional() to every in-scope Upsert schema (workstream.js, dd.js, org.js)
public/js/transitions.js # ma-fetch-wrapper: new 409 branch beside the existing 503 branch
public/js/[shared].js    # NEW: one shared conflict-dialog component (textContent-only, styled like the existing give-up toast)
test/
└── optimistic-locking-contract.test.js  # NEW: coverage gate, mirrors busy-503-contract.test.js's 4-part recipe
```

### Pattern 1: Central version enforcement gated by a named set (not per-route logic)
**What:** `db/auditHook.js` already solved "which collections get an extra behavior" with `AUDITED_DB_KINDS = new Set(['deal', 'control'])` (a kind-level set) — Phase 9's analog is a **collection-level** set, since the scope boundary here is per-collection (D-06's named list), not per-database-kind.
**When to use:** Inside `writeDb()`'s per-collection loop (`db/store.js:326-370`), so the check is structurally impossible to skip for a listed collection and structurally impossible to accidentally apply to an excluded one (CMS/settings singletons aren't `ARRAY_COLLECTIONS` items being version-checked at all).
**Example:**
```javascript
// Source: reasoned from db/auditHook.js:55 (AUDITED_DB_KINDS precedent, verified read)
//         and db/store.js:326-370 (writeDb()'s existing per-collection loop, verified read)
const VERSIONED_COLLECTIONS = new Set([
  'raidEntries', 'customRaidEntries',
  'integrationTasks', 'customIntegrationTasks',
  'synergyInitiatives', 'customSynergyInitiatives',
  'ddFindings', 'ddRequestItems',
  'orgPositions', 'orgFlightRisks',
  // orgDecisions deliberately excluded — append-only, no update/delete route exists (Pitfall 8)
]);
```

### Pattern 2: Two-layer conflict check (precheck + WHERE-clause), not either alone
**What:** A route-level check (`b.version !== item.version`, both from this request's own `readDb()`) gives a fast, cheap, informative 409 in the common single-process case. The SQL `WHERE json_extract(...)` check inside `writeDb()`'s `.immediate` transaction is the one that is actually race-free against Phase 8's multi-process model, because it evaluates against **whatever is on disk at the moment the transaction runs**, not against a value read moments earlier by a possibly-now-stale in-process snapshot.
**When to use:** Every in-scope write. Never rely on the precheck alone — it silently reopens a cross-process TOCTOU window between this request's `readDb()` and its `writeDb()` call, the exact class of race CONC-01 (Phase 8) closed for same-collection additions.
**Example:**
```javascript
// Source: verified against installed better-sqlite3@13.0.1 in this sandbox
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec('CREATE TABLE t(id TEXT PRIMARY KEY, data TEXT)');
db.prepare('INSERT INTO t VALUES (?,?)').run('a', JSON.stringify({ id: 'a', version: 3, name: 'x' }));

const upd = db.prepare(
  "UPDATE t SET data=? WHERE id=? AND (json_extract(data,'$.version') IS NULL OR json_extract(data,'$.version') = ?)"
);
// Correct expected version -> succeeds
upd.run(JSON.stringify({ id: 'a', version: 4, name: 'y' }), 'a', 3).changes; // === 1
// Stale expected version -> 0 rows affected, no silent overwrite
upd.run(JSON.stringify({ id: 'a', version: 5, name: 'z' }), 'a', 3).changes; // === 0
```

### Pattern 3: Conflict-body construction must respect existing area-clearance gates
**What:** For DD findings (and any other area-gated collection), the 409 body's `currentRecord` must pass through the SAME `accessPolicy.hasAreaGrant()` / `ddAreaRefused()` check the GET routes already apply (`server.js` line ~4193-4199's `reportRaidRows()` is the precedent shape) before being echoed to the client — a race where the record's `area` field concurrently changed to one the caller isn't cleared for must not leak the full current record.
**When to use:** Building the conflict response for any of the three area-gated collections (`ddFindings`, `ddRequestItems`, and `orgPositions`/`orgFlightRisks`'s `hr`-area gate).
**Example:** Reuse the exact same gate function the route's own read path already calls, applied to the just-fetched current record before serializing it into the 409 body — do not add a second, parallel clearance check.

### Anti-Patterns to Avoid
- **Reintroducing a second retry-interception point in transitions.js:** D-05 locks ONE shared wrapper for both 503 and 409 handling. A page-specific 409 handler would fragment the contract exactly the way Ph8's D-05 (uniform 503 contract) was designed to prevent.
- **Comparing versions only at the route-precheck layer:** correct for the common case, silently unsafe under Phase 8's multi-process model (see Pattern 2).
- **Sourcing "changed by" attribution from `audit.db`:** works for real deals, silently empty for every demo-mode record (Pitfall 10).
- **Treating `changes === 0` from the WHERE-clause UPDATE as always meaning "conflict":** it also means "row concurrently deleted" — these need different handling and a disambiguating SELECT (Pitfall 5).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-field merge / CRDT-style auto-merge | A field-aware diff/merge engine | Strict per-record version + 409 (locked D-01) | Explicitly rejected by the user for MNPI data — "a merged state no single user reviewed is worse... than an extra one-click 409" (09-CONTEXT.md D-01) |
| A second retry/backoff mechanism for 409 | A new jittered-retry loop parallel to the existing 503 one | The existing `transitions.js` wrapper's single interception point, with a 409 branch that renders (never retries) | D-05 locks one shared wrapper; a second mechanism would fragment the uniform contract Phase 8 already established for 503 |
| Conflict-body construction | Ad hoc per-route JSON shaping | One shared response builder (mirrors `res.status(503).json({ error: ... })`'s single central-middleware shape at `server.js:6923-6938`) | Keeps the 409 body shape identical across all ~20 routes so the ONE client-side dialog component can render any of them without per-page branching |
| Attribution lookup | A query against `audit.db` per conflict | `updatedBy`/`updatedAt` fields co-located in the record's own JSON blob, stamped by the same code path that stamps `version` | Single source, single write, works in demo mode where `audit.db` has nothing (Pitfall 10) |

**Key insight:** every piece this phase needs is already a documented pattern somewhere in this exact codebase (409-sibling-of-503 middleware, a `*_DB_KINDS`/`*_COLLECTIONS`-style gating set, a single client-side interception point, a coverage-test recipe). The job is disciplined reuse of those shapes, not new architecture.

## Common Pitfalls

### Pitfall 1: Two existing, UNRELATED 409 responses already exist in this codebase
**What goes wrong:** `server.js` already returns `409` for "this deal has no data yet" (steerco pack, line 6043) and "unrecognized stage value" (synergy stage, line 3984). If the `transitions.js` wrapper's new 409-detection branch triggers the conflict dialog on status code alone, clicking "Generate pack" on an empty deal (or an unrelated stage-migration edge case) would incorrectly pop up "someone else changed this."
**Why it happens:** 409 is a generic HTTP status; this codebase already uses it for business-rule refusals unrelated to optimistic locking.
**How to avoid:** The 409 body for a genuine version conflict MUST carry a distinguishing marker (e.g. `{ conflict: true, ... }`) that ONLY the optimistic-locking path emits; the wrapper checks for that marker's presence, never status code alone.
**Warning signs:** A coverage test that greps for `status(409)` without also checking the body shape would pass even if this discrimination is missing — write the coverage test to assert the marker's presence specifically on in-scope routes' conflict path.

### Pitfall 2: zod strips unknown keys by default — the version field is silently dropped without a schema change
**What goes wrong:** `validators/index.js:8-10` documents (verified in that file's own header comment) that `z.object(shape)` strips unknown keys by default in the installed zod v4. If a client sends `{ id, title, version: 3 }` to `POST /api/raid` today, `RaidUpsertSchema` (verified, `validators/workstream.js:311-327`, no `version` field declared) silently strips `version` before the route handler ever sees `req.body.version`.
**Why it happens:** This is the validation layer's own documented default-deny stance — a feature, not a bug, but every one of the ~20 in-scope schemas needs the explicit addition.
**How to avoid:** Add `version: z.number().int().nonnegative().optional()` to every in-scope Upsert schema (`RaidUpsertSchema`, `TaskUpsertSchema`, `SynergyUpsertSchema`, DD findings/request-items schemas in `validators/dd.js`, org positions/flight-risk schemas in `validators/org.js`) as part of the same change that adds the route-level precondition check — these two changes ship together or the precondition check silently never fires.
**Warning signs:** A version-conflict test that posts a stale version and expects a 409 will instead see a 200 success if the schema strips the field — a false green.

### Pitfall 3: DELETE routes take no body/version input today — a new input channel is required
**What goes wrong:** All in-scope `DELETE /api/<collection>/:id` routes (verified: `server.js:5784` `/api/raid/:id`, `:3090` `/api/integration-tasks/:id`, `:4941` `/api/org/flight-risk/:id`, `:4492` `/api/org/positions/:id`, `:5481` `/api/dd/findings/:id`) are registered with `EmptyBodySchema` (`z.object({})`, which strips everything) and read no `req.body`/`req.query` field at all today.
**Why it happens:** These routes were built delete-only, with no precondition concept.
**How to avoid:** D-08 requires 409-on-stale-delete. A query-string parameter (e.g. `DELETE /api/raid/:id?expectedVersion=N`) is the conventional fit — DELETE requests are commonly sent without a body from `fetch()` call sites in this codebase's own pages (verified: `execution.js:1038` `fetch('/api/raid/' + id, { method: 'DELETE' })`, no body). Every DELETE call site across every page also needs updating to pass the version it currently holds.
**Warning signs:** A stale-delete test that expects 409 silently gets 200/404 because the version never reached the server.

### Pitfall 4: The server always re-reads current state — staleness can ONLY be detected by comparing against the CLIENT's remembered version
**What goes wrong:** Every route does `const db = readDb()` at the top of the handler — this is always the CURRENT database state, never what the client last fetched. A route-level check that compares `item.version` (current) against... itself would never detect anything.
**Why it happens:** The read-modify-write-per-request pattern this codebase uses (documented in `db/store.js`'s own header, verified) re-reads fresh on every request by design (this is what makes it safe against same-collection races, per D-04's comment).
**How to avoid:** The client MUST send back the version it believes is current (the value from its last GET or its last successful write's response) as part of the write payload; the route compares THAT against the freshly-read `item.version`.
**Warning signs:** A "conflict never fires" bug where two browser tabs racing an edit both get 200 — the classic silent-clobber CONC-02 exists specifically to close.

### Pitfall 5: `changes === 0` from the WHERE-clause UPDATE cannot distinguish "stale version" from "row concurrently deleted"
**What goes wrong:** `UPDATE ... WHERE id=? AND json_extract(data,'$.version')=?` returns `changes: 0` in BOTH cases — a version mismatch, and a row that no longer exists (already covered by the pre-Phase-9 CR-02 no-resurrect comment, verified `db/store.js:274-277`). These need different handling: the first is a genuine 409 conflict with a compare dialog; the second may be a distinct "this record was deleted" surface (an open question — see below).
**Why it happens:** SQL `UPDATE`'s affected-row-count is a single boolean signal, not a reason code.
**How to avoid:** On `changes === 0`, run a `SELECT data FROM <collection> WHERE id=?` inside the SAME `.immediate` transaction (free of extra race risk since the write lock is already held) to determine whether the row still exists and, if so, its current full state for the conflict-dialog body.
**Warning signs:** A conflict dialog that renders with `currentRecord: null` for a row that's actually just been edited by someone else (mis-attributed as "deleted" when it's really "stale").

### Pitfall 6: `writeDb()` is a WHOLE-DATABASE-OBJECT operation — a conflict on one row must abort the ENTIRE transaction, not partially apply
**What goes wrong:** `writeDb(data)` loops over all 38 `ARRAY_COLLECTIONS` in one `.immediate` transaction (verified `db/store.js:326-370`). If a version check is only evaluated at the moment each row's UPDATE statement runs, a conflict on collection B's row could be detected AFTER collection A's rows in the same call already executed their own INSERT/UPDATE/DELETE statements — those would then be rolled back too (correct, since it's one transaction), but only if the conflict is signaled via a THROW that propagates before `applyWrite`'s transaction body returns, exactly like the existing D-11 "no anonymous audit row" throw already does (verified `db/store.js:414-427`).
**Why it happens:** The existing snapshot-diff merge has no early-exit; every collection's loop body runs unconditionally today.
**How to avoid:** Either (a) validate every version precondition across all collections BEFORE performing any mutation (two-pass), or (b) throw immediately on the first conflict, mirroring the existing D-11 actor-check throw pattern — since in practice these routes only ever touch one record in one collection per call, (b) is simpler and structurally consistent with existing code.
**Warning signs:** A partial-commit bug only reachable by an endpoint that mutates two different version-checked collections in one `writeDb()` call — check whether any in-scope route does this (current inventory suggests none do, but the coverage test should assert it structurally, not just today's observed shape).

### Pitfall 7: Demo/custom dual-lane collections need BOTH table names in scope
**What goes wrong:** Three of the five CONC-02-named collections have a demo-mode shadow lane selected by `settings.demoMode` (verified: `raidLane()` at `server.js:4063-4068` returns `db.customRaidEntries` when `demoMode === false`, else `db.raidEntries`; same pattern for `taskLane()` and `synergyLane()`). If `VERSIONED_COLLECTIONS` only lists `raidEntries` and not `customRaidEntries`, every real-deal (non-demo) RAID write silently escapes the version check entirely.
**Why it happens:** The demo/custom split is a routing decision made in `db/collections.js` (both route to the `demo` physical file per `COLLECTION_TARGETS`, verified) that is orthogonal to, but easy to forget when composing, a NEW per-collection gating set.
**How to avoid:** `VERSIONED_COLLECTIONS` must list all 10 in-scope table names explicitly: `raidEntries`, `customRaidEntries`, `integrationTasks`, `customIntegrationTasks`, `synergyInitiatives`, `customSynergyInitiatives`, `ddFindings`, `ddRequestItems`, `orgPositions`, `orgFlightRisks` (the last four have no demo/custom shadow — verified via each lane helper's own "NO demoMode/isCustom branch" code comment).
**Warning signs:** A coverage test that only checks demo-mode behavior would pass while real-deal writes on the SAME UI feature stay unprotected — test both lanes explicitly.

### Pitfall 8: `org/decisions` is append-only — CONC-02's naming has no mutable write path to protect
**What goes wrong:** `POST /api/org/decisions` (verified, `server.js:4766-4806`) NEVER searches for or mutates an existing decision — its own comment states "Append-only (D-13/T-06-28): ALWAYS push a NEW entry... no route anywhere exposes an update or delete path for a decision." CONC-02's requirement text names "org decision" as one of the five example collections, but there is nothing to lock — a decision can never be edited by two people at once because it can never be edited at all.
**Why it happens:** The requirement's illustrative list was written before this research confirmed the collection's actual mutability.
**How to avoid:** Treat this as satisfied vacuously — document it explicitly in the coverage test as a deliberate exemption (with a comment citing this finding) rather than silently omitting `orgDecisions` and leaving a future reader to wonder if it was missed.
**Warning signs:** A future developer "fixing" the coverage test to add `orgDecisions` to `VERSIONED_COLLECTIONS` would be adding dead code — there is no update branch for the version check to ever run against.

### Pitfall 9: The word "version" is already used for two unrelated concepts elsewhere in the same objects
**What goes wrong:** `template.version` (assessment templates, verified `server.js:2702,2787`) and `entry.version` inside a synergy initiative's nested `baselines[]` array (verified `server.js:3355,3532`) already exist. Adding a NEW top-level `item.version` to a `synergyInitiatives` record does not collide (different path: `item.version` vs `item.baselines[].version`), but a future reader skimming code could easily confuse the two.
**Why it happens:** "version" is a natural, overloaded word; this codebase already had two independent uses before Phase 9.
**How to avoid:** Add a one-line comment at the point the optimistic-lock `version` field is introduced on each schema, disambiguating it from the pre-existing nested usage where both exist on the same object type (synergy initiatives specifically).
**Warning signs:** A code review comment asking "wait, is this the baseline version or the lock version?" — cheap to prevent with one comment, expensive to debug later.

### Pitfall 10: `audit.db` structurally excludes demo-mode writes — do not source attribution from it
**What goes wrong:** `db/auditHook.js:55` (verified, read in full): `const AUDITED_DB_KINDS = new Set(['deal', 'control']);` with the file's own comment: "`'demo'` is deliberately excluded (demo writes carry no compliance value...)". If D-04's "changed by karen, 2 min ago" attribution is implemented as a query against `audit.db`, every demo-mode conflict dialog would render with no attribution data at all — silently degraded UX in exactly the mode most likely to be used for a walkthrough/demo of this very feature.
**Why it happens:** Audit logging and optimistic-locking attribution are DIFFERENT concerns that happen to want the same underlying fact ("who changed this last") — but audit.db was built to answer a compliance question, not a UI question, and deliberately doesn't cover demo mode.
**How to avoid:** Stamp `updatedBy`/`updatedAt` directly into the record's own JSON blob (the SAME write path that stamps `version`), independent of whether this write is audited. Works uniformly for demo and real-deal data with zero cross-database query.
**Warning signs:** A UAT/demo walkthrough of this feature (very likely to happen in demo mode) shows a conflict dialog with a blank "changed by" field.

### Pitfall 11: The 409 recovery flow must NOT be an automatic wrapper-level retry, unlike 503
**What goes wrong:** The existing 503 handling in `transitions.js` (verified, lines 136-147) automatically re-fires the SAME request on a timer. If a 409 branch is added by copying this shape, it would silently violate D-05's explicit "the wrapper must NEVER silently auto-retry a 409 (that machinery is for 503 contention only — a conflict is a user decision)."
**Why it happens:** The 503 branch is the only existing precedent in this file, and its retry loop is structurally the closest-looking code to copy from.
**How to avoid:** The 409 branch renders the dialog and returns — the ONLY re-fire path is the user clicking "Apply my changes anyway," which the dialog code (not the wrapper's automatic retry loop) constructs as a fresh `fetch()` call with the refreshed version.
**Warning signs:** A test asserting "409 is never retried automatically" (the direct behavioral analog of `test/client-busy-retry.test.js`'s 503 assertions) is the concrete gate for this — write it explicitly, don't just eyeball the code.

### Pitfall 12: The wrapper cannot see which form fields the user visually changed — only which JSON keys the request payload carries
**What goes wrong:** The compare dialog (D-03) needs to show "the fields they changed — their value vs what's now on the server." The `transitions.js` wrapper only has access to `init.body` (the JSON string of the request) and the 409 response body (server's current record) — it has no DOM access to know which form fields the user visually edited versus which were merely present in the payload unchanged.
**Why it happens:** The wrapper is a `fetch()` interception point, not page-aware code.
**How to avoid:** This actually aligns well with how these routes already work — every in-scope route only mutates fields where `b[k] !== undefined` (verified across every route read above), so "the fields the user changed" IS exactly "the keys present in the request's JSON body" for this codebase's existing upsert convention. The dialog can intersect `Object.keys(JSON.parse(init.body))` against the server's current record.
**Warning signs:** A dialog that shows every field on the record (not just the ones the user's payload touched) as "your value vs theirs," creating noise for fields the user never touched.

## Code Examples

Verified patterns, run directly against this repo's installed dependencies:

### JSON-embedded version check in a WHERE clause (the CONC-02-mandated mechanism)
```javascript
// Source: hands-on verification in this session against installed better-sqlite3@13.0.1
// (package.json:17). Confirms json_extract() is available (JSON1 compiled in) with
// no additional flag or extension load required.
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec('CREATE TABLE t(id TEXT PRIMARY KEY, data TEXT)');
db.prepare('INSERT INTO t VALUES (?,?)').run('a', JSON.stringify({ id: 'a', version: 3, name: 'x' }));

// Read the embedded version without a dedicated column:
const row = db.prepare("SELECT json_extract(data,'$.version') as v FROM t WHERE id='a'").get();
// row.v === 3

// Enforce it as the UPDATE's precondition:
const upd = db.prepare(
  "UPDATE t SET data=? WHERE id=? AND (json_extract(data,'$.version') IS NULL OR json_extract(data,'$.version') = ?)"
);
upd.run(JSON.stringify({ id: 'a', version: 4, name: 'y' }), 'a', 3).changes; // 1 — matched, applied
upd.run(JSON.stringify({ id: 'a', version: 5, name: 'z' }), 'a', 3).changes; // 0 — stale, rejected
```

### Existing precedent this phase mirrors: central error-middleware sibling pattern
```javascript
// Source: server.js:6909-6938 (Phase 8's central 503 middleware, verified read in full).
// The 409 conflict middleware is this pattern's direct sibling, mounted alongside it,
// distinguishing on a typed error (e.g. `err.isConflict`) the same way isBusyError(err)
// distinguishes SqliteError.code:
app.use((err, req, res, next) => {
  if (isBusyError(err)) {
    if (res.headersSent) return next(err);
    res.set('Retry-After', '1');
    return res.status(503).json({ error: 'Server is busy. Please try again.' });
  }
  next(err);
});
// Ph9's sibling (new): checks a distinguishing conflict-error type, responds
// { conflict: true, currentRecord, currentVersion, changedBy, changedAt } — see Pitfall 1
// for why the `conflict: true` marker (not status code alone) matters.
```

### Existing precedent this phase extends: the fetch wrapper's single interception point
```javascript
// Source: public/js/transitions.js:136-156 (verified read in full — the exact file/lines
// the 409 branch must be added beside, per D-05).
const attemptFetch = (input, init, url, method, attempt) => origFetch(input, init).then((res) => {
  if (res.status === 503 && isApi(url)) { /* existing bounded retry, unchanged */ }
  // NEW (Ph9): a 409 branch belongs HERE, checked for isApi(url) and the body's
  // `conflict: true` marker (async — requires res.clone().json(), mirroring the
  // existing 401 branch's res.clone().json() pattern two lines below) — never
  // recursing into attemptFetch(), unlike the 503 branch above.
  if (res.status !== 401 || !isApi(url)) return res;
  // ...
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Last-write-wins (every existing upsert route, pre-Phase-9) | Optimistic locking via per-record version + 409 | This phase (CONC-02) | Silent clobbers on co-edited MNPI records become a recoverable, visible conflict instead |
| Single-process assumption in storage layer | Multi-process WAL write-serialization (Phase 8, CONC-01) | Phase 8, already shipped | Phase 9's conflict check MUST be race-free against a SECOND OS process, not just same-process JS ordering — this is why the WHERE-clause layer (not the route-precheck alone) is load-bearing |

**Deprecated/outdated:** None — this is a net-new capability layered onto an already-current storage architecture (Phase 8's WAL multi-process model), not a replacement of an outdated pattern.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Query-string (`?expectedVersion=N`) is the right input channel for DELETE preconditions, rather than a DELETE request body | Pitfall 3 | Low — either channel works technically; if the planner instead chooses a body-based DELETE, every DELETE call site still needs the same update, just with a different payload shape. This is explicitly Claude's Discretion per 09-CONTEXT.md, not a locked decision — flagged here so the planner makes it deliberately rather than by accident. |
| A2 | Update-into-an-already-deleted-row should ALSO surface a 409 (not silently stay a no-op, as it is pre-Phase-9) | Pitfall 5, Open Questions | Medium — if left as a silent no-op, a user who submits an edit to a just-deleted record gets a false "success" response with no indication their edit did nothing; 09-CONTEXT.md's D-08 only explicitly locks the DELETE-vs-stale-version case, not this UPDATE-vs-concurrent-delete case, so this is a genuine open question for the planner/discuss, not decided in this research. |
| A3 | The general REST guidance on 409 body shape and `If-Match`/ETag conventions (WebSearch results) reflects broadly current practice, not tied to a specific dated source | Standard Stack, Alternatives Considered | Low — used only as generic corroboration that a version-in-body 409 pattern is a recognized, non-exotic approach; the actual design is dictated by this codebase's own locked decisions (09-CONTEXT.md), not by the web search. |

## Open Questions (RESOLVED)

1. **RESOLVED by PD-4 (09-01-PLAN.md planner_decisions): an UPDATE into a concurrently-deleted row surfaces a 409 (scoped to versioned collections only), replacing the CR-02 silent no-op.** — Does an UPDATE against a just-deleted record surface a 409, or stay the existing silent no-op?
   - What we know: D-08 explicitly locks the DELETE-based-on-stale-version case (409 + confirm-delete reapply). The symmetric case — an UPDATE arriving for a record someone else just DELETED — is not explicitly addressed in 09-CONTEXT.md's decisions; the PRE-Phase-9 code comment (`db/store.js:274-277`, "CR-02... does NOT resurrect it") treats this as an intentional, accepted silent no-op today.
   - What's unclear: Whether D-02's "no exemptions" spirit extends to this case (making it also a 409, since it's the same underlying "someone else changed state you didn't know about" class) or whether it's out of scope since D-06's "field-patch upsert pattern" language centers on updates, not this specific interaction with concurrent deletes.
   - Recommendation: Bring this to the planner as an explicit decision point (likely resolved in discuss-phase or as Claude's Discretion during planning) — cheap to decide either way, but should be a DELIBERATE choice given it changes user-visible behavior (false "success" vs. an extra 409) for what may be a rare but real edge case in a ~15-person deal team.

2. **RESOLVED by PD-3 (09-01-PLAN.md planner_decisions): exact 409 conflict body shape locked once, constructed identically by every in-scope route's conflict path.** — Exact shape of the 409 conflict-distinguishing marker and full response body
   - What we know: 09-CONTEXT.md explicitly delegates "409 response body shape (current record + version + actor/time)" to Claude's Discretion. Pitfall 1 establishes it MUST be distinguishable from the two pre-existing, unrelated 409 responses in this codebase.
   - What's unclear: The exact field names/shape (this research proposes `{ conflict: true, currentRecord, currentVersion, changedBy, changedAt }` as a reasoned starting point, not a locked contract).
   - Recommendation: Planner should lock the exact shape once, in one place, and every in-scope route's conflict path constructs it identically (mirroring the existing central-503-middleware precedent's single fixed shape).

## Environment Availability

Skipped — this phase introduces no new external dependency, service, runtime, or CLI tool. Every mechanism used (SQLite JSON1 via `better-sqlite3`, zod, `node:test`) is already installed and verified present in this environment (see Standard Stack).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (Node built-in) [VERIFIED: `package.json` `"test": "node --test"`] |
| Config file | none — `node --test` auto-discovers `test/*.test.js` |
| Quick run command | `node --test test/optimistic-locking-contract.test.js` |
| Full suite command | `npm test` (`node --test`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONC-02 (criterion 1) | A stale-version write to a co-edited record is rejected with 409, not silently applied | integration (structural scan + real behavior + negative control, mirroring `test/busy-503-contract.test.js`'s 4-part recipe) | `node --test test/optimistic-locking-contract.test.js` | ❌ Wave 0 |
| CONC-02 (criterion 2) | On 409 the client sees a reload-and-reapply path that preserves in-progress form state | client-side (node:vm sandbox, mirroring `test/client-busy-retry.test.js`'s harness) | `node --test test/client-conflict-dialog.test.js` | ❌ Wave 0 |
| CONC-02 (criterion 3) | Two users editing DIFFERENT records concurrently both succeed — the lock is per-record, not per-collection | cross-process (spawned children, reusing `test/concurrency-busy-retry.test.js`'s mechanic — Phase 8 research documented that in-process contention simulation DEADLOCKS, so this MUST be a real spawned-process proof, not a mocked/unit one) | `node --test test/optimistic-locking-cross-process.test.js` | ❌ Wave 0 |
| D-08 (stale delete) | Deleting a record based on a stale version gets the same 409 + conflict surface | integration, same file as criterion 1 | `node --test test/optimistic-locking-contract.test.js` | ❌ Wave 0 |
| D-06 (coverage) | Every in-scope upsert/delete route enforces the version check; no future route escapes it silently | structural (live route-inventory scan, mirroring `validators/index.js`'s `findUnvalidatedWriteRoutes()` pattern) | same file as criterion 1 | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/optimistic-locking-contract.test.js` (fast, no cross-process spawn)
- **Per wave merge:** full suite (`npm test`, includes the cross-process proof — slower, mirrors Phase 8's soak-adjacent tests)
- **Phase gate:** Full suite green before `/gsd-verify-work`; consider also re-running `npm run soak` (Phase 8's real-server multi-process harness) since this phase's cross-process correctness claim (criterion 3) benefits from the same proof style Phase 8 used for CONC-01.

### Wave 0 Gaps
- [ ] `test/optimistic-locking-contract.test.js` — covers CONC-02 criterion 1, D-08, D-06 (structural coverage gate + real 409 behavior + negative control)
- [ ] `test/client-conflict-dialog.test.js` — covers CONC-02 criterion 2 (node:vm sandbox harness, mirroring `test/client-busy-retry.test.js`; note that harness's own documented gotcha — "sandbox uses REAL setTimeout; swap the context global for a recording fake when testing waits" — likely doesn't apply here since the conflict dialog has no retry timer, but verify)
- [ ] `test/optimistic-locking-cross-process.test.js` — covers CONC-02 criterion 3 (spawned-child-process harness, reusing `test/concurrency-busy-retry.test.js`'s mechanic; in-process simulation is documented to deadlock — do not attempt it)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new auth surface — writes already require an authenticated session per Phase 2 |
| V3 Session Management | no | Unaffected by this phase |
| V4 Access Control | yes | Existing `accessPolicy.hasAreaGrant()` / `ddAreaRefused()` gates (verified read across `server.js`'s DD/org routes) must be applied to the 409 conflict body's `currentRecord`, not just to the original GET/write path — see Architecture Pattern 3 |
| V5 Input Validation | yes | New `version` field on every in-scope zod schema: `z.number().int().nonnegative().optional()` — bounds/type-checked like every other field, never trusted as an arbitrary string |
| V6 Cryptography | no | No new cryptographic surface |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client-forged `version` value used to bypass the conflict check | Tampering | The WHERE-clause comparison is always against the REAL current on-disk value — a forged version can at most cause an otherwise-normal write to succeed or fail; it cannot corrupt data beyond what the caller's existing role/write-validation permissions already allow. Bound the field's type/range regardless, to prevent type-confusion inside `json_extract()`'s comparison. |
| Conflict body leaking a record's current state to a caller whose area clearance changed mid-race | Information Disclosure | Reuse the existing `accessPolicy`/`ddAreaRefused()` gate on the conflict body's `currentRecord`, exactly as the GET route already does — see Architecture Pattern 3 |
| Thundering-herd retry amplification if 409s were (incorrectly) auto-retried | Denial of Service | D-05 explicitly forbids auto-retry on 409 (user-driven reapply only) — see Pitfall 11; this is a design decision this research reinforces, not a new mitigation to build |
| SQL injection via the version parameter inside `json_extract()`'s WHERE clause | Tampering | Parameterized query (`?` placeholder, verified in the hands-on example above) — never string-concatenated into the SQL, matching every other prepared statement already in `db/store.js` |

## Sources

### Primary (HIGH confidence — read in full this session)
- `db/store.js` (451 lines, read in full) — `writeDb()`'s snapshot-diff merge, the exact UPDATE statement CONC-02's WHERE clause modifies
- `db/dbFiles.js` (120 lines, read in full) — pragma contract, busy_timeout, confirms `better-sqlite3` version via connection open path
- `db/auditHook.js` (210 lines, read in full) — `AUDITED_DB_KINDS` precedent, confirms demo-mode audit exclusion (Pitfall 10)
- `db/collections.js` (130 lines, read in full) — `ARRAY_COLLECTIONS`, `SINGLETON_KEYS`, the demo/custom `COLLECTION_TARGETS` routing
- `db/schema.sql` (365 lines, read substantially) — confirms `id/project_id/seq/data` shape for every array table, no existing version column
- `validators/index.js` (354 lines, read in full) — the strip-unknown-keys-by-default zod behavior (Pitfall 2), the coverage-gate (`findUnvalidatedWriteRoutes`) pattern to imitate
- `validators/workstream.js` (partial, RaidUpsertSchema section read) — confirms no `version` field exists on any current upsert schema
- `server.js` (partial, ~600 lines across multiple reads: raid/tasks/synergies/org/DD routes, central error middleware, isBusyError) — confirms the uniform `if (b.id) { find, mutate, writeDb }` shape across ~18 identified routes, confirms 2 pre-existing unrelated 409 usages (Pitfall 1), confirms `org/decisions` append-only (Pitfall 8)
- `public/js/transitions.js` (167 lines, `ma-fetch-wrapper` section read in full) — the exact interception point D-05 requires the 409 branch to land beside
- `public/js/execution.js` (partial, RAID/synergy write call sites read) — confirms pages already no-op on non-`success` JSON bodies (Pitfall 12), confirms DELETE calls send no body today (Pitfall 3)
- Hands-on `node -e` test against installed `better-sqlite3@13.0.1` in this sandbox — confirms `json_extract()` works as a WHERE-clause predicate exactly as needed, with zero additional configuration

### Secondary (MEDIUM confidence)
- [HTTP 409 Error (Conflict): Meaning, Causes, and Fixes](https://iproyal.com/blog/http-409-error/) — general 409 semantics
- [Optimistic Concurrency in EF Core 10: ASP.NET Core Web API Guide](https://codewithmukesh.com/blog/concurrency-control-optimistic-locking-efcore/) — version-field + 409-body pattern corroboration
- [SQLite json_extract: Complete Function Documentation (JSON1)](https://www.dbpro.app/learn/sqlite/sqlite-json-extract-function) — `json_extract()` in WHERE clauses, general corroboration of the hands-on-verified behavior
- [Database Locking Techniques with Ent](https://entgo.io/blog/2021/07/22/database-locking-techniques-with-ent/) — general optimistic-locking-with-version-column pattern description

### Tertiary (LOW confidence)
- None retained — every claim above is either read directly from this repo's own source this session, hands-on tested against the installed dependency, or corroborated by a secondary source and clearly labeled.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependency; every version verified against `package.json`/installed packages directly
- Architecture: HIGH — every mechanism (writeDb() shape, route pattern, fetch wrapper, error middleware) read in full this session; the two-layer conflict-check design is reasoned from that verified code, not assumed
- Pitfalls: HIGH — every pitfall traces to a specific, cited line range read this session (existing 409s, zod strip-unknown-keys, dual-lane collections, append-only decisions, audit.db demo exclusion) — these are concrete, checkable findings, not generic advice
- Open questions: correctly flagged as genuinely undecided (not research gaps papered over) — both are explicit Claude's Discretion or ambiguous-scope items per 09-CONTEXT.md itself

**Research date:** 2026-08-11
**Valid until:** No external expiry driver (in-repo research, no library version drift risk) — re-verify only if `db/store.js`, `server.js`'s route inventory, or `db/collections.js` change materially before planning executes.
