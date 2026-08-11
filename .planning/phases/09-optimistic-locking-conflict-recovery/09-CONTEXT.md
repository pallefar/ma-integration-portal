# Phase 9: Optimistic Locking & Conflict Recovery - Context

**Gathered:** 2026-08-11
**Status:** Ready for planning

<domain>
## Phase Boundary

When two people edit the same record, the second save based on stale data is caught with a **409** and safely recoverable instead of silently overwriting the first (CONC-02). The version travels in the record's JSON blob and is enforced in the SQL WHERE clause. The lock bites per-record only — two users editing different records both save. The reload-and-reapply path preserves the in-progress edit.

In scope: per-record versioning across co-edited deal-data collections, 409 conflict contract (server + client), the shared conflict-recovery UI, stale-delete protection, lazy version adoption for legacy records, coverage test for the contract.

NOT in scope: control-plane conflict detection (members/grants — Phase 12), field-level merge machinery, presence/realtime indicators, WAL/health/deployment work (Phases 10–11). Phase 8's 503 path is **contention**; this phase's 409 is **conflict** — the two signals stay distinct end-to-end.

</domain>

<decisions>
## Implementation Decisions

### Conflict granularity
- **D-01:** **Strict per-record version.** One version per record; ANY save based on a stale version gets a 409 — even when the concurrently-changed fields don't overlap with the incoming patch. No per-field version map, no server-side auto-merge: a merged state no single user reviewed is worse for MNPI data than an extra one-click 409. Matches CONC-02's letter (one version in the blob, one WHERE clause). — **Reversibility:** costly — moving to field-aware later means adding per-field version bookkeeping to every record blob and reshaping the 409 body contract the client dialog consumes.
- **D-02:** **Uniform check, no exemptions.** Quick single-field actions (kanban status flips, checkbox toggles) go through the same version check as full edits. No last-write-wins carve-outs — an exemption would reintroduce the silent-clobber class this phase closes, and the coverage test stays simple (one rule, zero documented exceptions).

### 409 recovery UX
- **D-03:** **Compare dialog + one-click reapply.** On 409 the user sees a shared conflict dialog: side-by-side of the fields they changed — their value vs what's now on the server — with exactly two actions: **"Apply my changes anyway"** (re-submits their patch against the fresh version, one click) and **"Discard mine, keep theirs"**. In-progress form state is never lost, discarded, or navigated away (extends Ph8 D-08's form-preservation principle from contention to conflict).
- **D-04:** **Attribution shown.** The conflict surface says who made the competing change and when — "Changed by karen 2 min ago" — sourced from the record's audit context and carried in the 409 response body. The viewer is already a deal member with access to the record; no new exposure. At 15-person scale the right resolution is often a conversation, and the name enables it.
- **D-05:** **One shared component, wrapper-detected.** The Phase 8 fetch wrapper in `public/js/transitions.js` detects 409s on same-origin `/api` writes and renders one shared conflict dialog from the 409 body. **The wrapper must NEVER silently auto-retry a 409** (that machinery is for 503 contention only — a conflict is a user decision). No per-page wiring is required to ship; every current and future write surface inherits the contract, mirroring Ph8's uniform-contract pattern. — **Reversibility:** reversible — pages can later layer tailored conflict views over the shared one without changing the server contract.

### Versioning scope
- **D-06:** **All co-edited deal-data collections.** The version check covers every deal-data collection with the field-patch upsert pattern — the five CONC-02-named (RAID entries, integration tasks, DD findings, synergy initiatives, org decisions) **plus** DD request items, org positions, flight-risk entries, and any siblings the planner enumerates from the route inventory. CMS/settings singletons and whole-document admin blobs (pages, menus, courses, settings) are **excluded** — they are admin-edited documents, not co-edited records, and demo-mode showcase mechanics write them constantly. A coverage test (in the mold of Ph8's `test/busy-503-contract.test.js`) asserts every in-scope upsert route enforces the version check so a future route cannot ship unprotected.
- **D-07:** **Control plane deferred to Phase 12.** Deal members/grants/user-admin writes keep their Ph8 state (serialized `.immediate`, wholesale-replace, last-writer-wins). Phase 12's COLLAB-01 invite/clearance model reshapes these flows anyway; versioning them now is double work. The Ph8 flag — `updateDealMembers()` wholesale-replace semantics need caller-side retry-with-fresh-read (documented in `test/control-plane-serialization.test.js` header) — is carried forward as an explicit input to Phase 12 planning.

### Version mechanics & edges
- **D-08:** **409 on stale delete.** Deleting a record based on a stale version gets the same 409 + conflict surface ("karen updated this 2 min ago — still delete?"), with confirm-delete as the reapply action. Destroying an MNPI record someone just changed deserves the second look; keeps D-02's no-exemptions rule intact.
- **D-09:** **Lazy version adoption — no migration.** A record without a version field is treated as version 0; the first successful write stamps the incremented version into the blob. Reads pass versions through untouched. No migration script, no boot-time backfill: the committed `demo.db` and existing deal DBs stay byte-identical until genuinely written — no WAL-trap risk, no turnkey-bundle churn, and legacy records gain protection the moment two people co-edit one. — **Reversibility:** reversible — a later backfill can still be run if uniform stamping is ever wanted.

### Claude's Discretion
- Version field name/location inside the record blob, increment semantics, and the exact WHERE-clause enforcement mechanics in `db/store.js` `writeDb()` (route-level precheck vs writeDb-level enforcement vs both — CONC-02 requires the WHERE clause to be load-bearing; the rest is implementation).
- 409 response body shape (current record + version + actor/time), and how the client threads the loaded version through forms and quick actions.
- Conflict dialog visual design (should feel native to the existing modal/toast patterns; textContent-only per house XSS rules).
- How "Apply my changes anyway" is implemented client-side (re-fire the original patch with the fresh version).
- Interplay details with the Ph8 silent 503 retry (a 503-retried request re-sends the same version — safe by Ph8's CR-01 fix since nothing persisted; ensure the wrapper's 409 branch is checked before/independent of the 503 branch).
- Coverage-test mechanics and how conversions (finding→RAID/task) are treated (they create new records — creates carry no version precondition).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & architecture (locked)
- `.planning/REQUIREMENTS.md` — CONC-02 verbatim: 409 on stale co-edited writes, reload-and-reapply UI, "optimistic locking enforced in the SQL WHERE clause (version carried in the record's JSON blob)".
- `.planning/ROADMAP.md` §Phase 9 — goal + the three success criteria (stale write → 409; reload-and-reapply preserves the edit; per-record granularity proven by concurrent different-record saves).
- `.planning/phases/08-concurrency-storage-foundation/08-CONTEXT.md` — Ph8's locked decisions this phase builds on: D-02 (whole-object writeDb API preserved), D-06/D-07/D-08 (503 contract + silent retry + give-up toast), and the explicit 503-vs-409 boundary in its deferred section.

### Storage layer (where the WHERE clause lands)
- `db/store.js` — `writeDb()` snapshot-diff merge: the per-record `update.run(...)` is currently unconditional (Ph8 comment block notes a concurrent delete makes it affect 0 rows without resurrecting — the 0-rows-affected pattern is the natural version-conflict detection point). The audit append now runs INSIDE the write transaction (Ph8 CR-01 fix) — version enforcement must not break that ordering.
- `db/dbFiles.js` — single pragma contract; `.immediate` transactions from Ph8 serialize the check-and-write so version enforcement inside the transaction is race-free by construction.

### Server contract precedent
- `server.js` — `isBusyError()` + central 503 middleware (Ph8): the pattern for a distinct, centrally-mapped error contract; the 409 path is its sibling, not a modification of it. Upsert route shape: `POST /api/raid` (~line 4208) is the representative field-patch update handler (only fields present in the body are applied).
- `test/busy-503-contract.test.js` — the coverage-gate pattern (structural source scan + live route inventory + real behavior proof + negative control) to imitate for the 409 contract.

### Client integration point
- `public/js/transitions.js` — the Ph8 fetch wrapper (`ma-fetch-wrapper:begin/end` sentinels): 503 silent-retry + give-up toast live here; the 409 detection branch and shared conflict dialog land in the same wrapper. 409 must be excluded from the retry path explicitly.
- `test/client-busy-retry.test.js` — the node:vm sandbox harness for testing wrapper behavior (note: sandbox uses REAL setTimeout; swap the context global for a recording fake when testing waits).

### Testing precedent
- `test/concurrency-busy-retry.test.js` + `test/control-plane-serialization.test.js` — spawned-child-process contention harnesses (in-process contention simulation DEADLOCKS — Ph8 research pitfall 3); a cross-process stale-write proof should reuse this mechanic.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Ph8's fetch wrapper in `transitions.js` — single interception point for all same-origin `/api` requests; the 409 branch slots beside the 503 branch.
- Ph8's central error-middleware pattern in `server.js` — a 409 sibling can reuse the shape (fixed generic-safe body, no internal detail echo).
- Audit trail (`audit.db`, actor + ts per write) — the attribution source for D-04's "changed by X, N min ago".
- `test/busy-503-contract.test.js` — the four-part coverage-gate recipe, directly imitable for the 409 contract.
- Ph8's give-up toast styling in `transitions.js` — visual baseline for the conflict dialog (textContent-only).

### Established Patterns
- Field-patch upsert routes: `POST /api/<collection>` with `b.id` → in-place field mutation of the `readDb()` snapshot record, then `writeDb(db)`. The version precondition naturally lives where `b.id` is resolved; ~20 such routes across the co-edited collections.
- Records carry `createdAt` but NO version/updatedAt today — greenfield version field.
- `writeDb()`'s per-record UPDATE is unconditional; CONC-02's WHERE-clause enforcement modifies exactly this statement (Ph8's D-02 preserved the surrounding API).
- Coverage tests that fail the suite when a new route escapes a contract — write-validation (Ph3) and busy-503 (Ph8) precedents.
- `[security]`-prefixed comments explaining mitigations; client IIFE-wrapped; textContent, never markup assignment.

### Integration Points
- `db/store.js` `writeDb()` UPDATE statement — the WHERE-clause version enforcement (0-rows-affected → conflict).
- Upsert route handlers — version precondition extraction from request body + 409 response with current record/attribution.
- `transitions.js` wrapper — 409 detection (never retried) + shared conflict dialog.
- Zod validators (`validators/`) — version field passes through write validation on every in-scope route.

</code_context>

<specifics>
## Specific Ideas

- The 409 body should carry enough for the dialog to render without a second fetch: current record, current version, and the "changed by X at T" attribution.
- "Apply my changes anyway" is deliberately a *reapply against fresh state* — the client re-submits its original patch with the new version, not a forced write with the stale one. Two people who genuinely fight over the same field will see a second 409 with fresh values, which is correct.
- Success criterion 3 (different records don't fight) should be proven with a real cross-process test, not just unit logic — reuse the Ph8 spawned-children harness.

</specifics>

<deferred>
## Deferred Ideas

- Control-plane conflict detection (deal members/grants) → Phase 12 COLLAB-01 — carries the Ph8 flag: `updateDealMembers()` wholesale-replace means concurrent-addition survival needs caller-side retry-with-fresh-read.
- Per-field version map / field-aware merge — revisit only if strict-record 409s prove too noisy in real use.
- Presence / "someone else is editing" indicators — realtime collaboration territory, Phase 12+ if ever.
- Stale-form warning polling ("this record changed while your modal is open") — nice-to-have on top of the 409 contract, not this phase.

</deferred>

---

*Phase: 9-Optimistic Locking & Conflict Recovery*
*Context gathered: 2026-08-11*
