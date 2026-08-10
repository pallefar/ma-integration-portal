# Phase 1: Schema & Migration - Context

**Gathered:** 2026-07-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the `db.json` file store with SQLite (`better-sqlite3`, WAL mode) through a verified, re-runnable migration. All app reads and writes go through SQLite; `db.json` is retired only after the migrated data is proven equivalent. This is the foundation phase — nothing else in the milestone can build until persistence runs on SQLite.

**In scope:** FND-01 (re-runnable/diffable/verified migration), FND-02 (all reads/writes via SQLite WAL), FND-03 (no lost-update on concurrent writes), FND-04 (all three release bundles boot with the correct native binary).

**Explicitly NOT this phase:** the file-per-deal split (control.db/demo.db/deals/<id>.db) is **Phase 3** (ISO-01); mandatory auth is **Phase 2**; write-schema validation is **Phase 3** (VAL-01/02). Phase 1 migrates the existing data structure faithfully — it does not restructure the demo/real lane split.
</domain>

<decisions>
## Implementation Decisions

### Cutover strategy
- **D-01:** Big-bang cutover with a verified archive — run the deterministic migration against a `db.json` snapshot, verify offline, cut over in one step, and keep `db.json` (and its `.bak`) as a read-only archive rather than deleting it. The migration's re-runnability (FND-01) is the safety net, so no live dual-write plumbing is built. — **Reversibility:** reversible — the archived `db.json` plus the re-runnable migration script mean cutover can be re-done from source at any time.
- **D-02:** No live dual-run / parallel-store comparison. Rejected as heavier than justified for a deterministic migration over demo data.

### readDb/writeDb API fate (this is where FND-03 is won)
- **D-03:** Preserve the existing `readDb()` / `writeDb(data)` whole-object signatures as a compatibility layer so the ~3,200-line `server.js` and its ~90 endpoints barely change. — **Reversibility:** costly — the whole-object API is called from dozens of sites; changing the signature later touches every caller.
- **D-04:** Re-implement `writeDb` internals to upsert only the **changed collections inside a single SQLite transaction**, instead of rewriting the entire database. Two concurrent writers touching different collections no longer clobber each other — this satisfies FND-03 (no lost update) without a global refactor. Note for planner: whole-object write semantics alone (even on SQLite) do NOT fix the lost-update race; the per-collection transactional upsert is what closes it. A global write mutex was considered and rejected as it keeps the O(whole-db) write cost.
- **D-05:** Do NOT refactor hot endpoints to targeted per-row writes this phase — deferred; it's meaningful churn in a phase meant to be low-risk foundation. (Deferred idea below.)

### Verification bar (gates retirement of db.json — success criterion 1.1)
- **D-06:** Migration is verified by a **round-trip deep diff plus per-collection row-count parity**: migrate `db.json` → SQLite, reconstruct the full in-memory object from SQLite, assert it deep-equals the original parsed `db.json`, and assert each collection's row count matches. `db.json` is retired (archived) only when this passes. Catches field-level corruption and type-coercion bugs, not just missing rows. — **Reversibility:** reversible.
- **D-07:** No extended parallel-run verification — the deterministic round-trip diff is sufficient; parallel-run was rejected as overkill and depends on the rejected dual-run plumbing.

### Phase-3 schema anticipation
- **D-08:** Migrate into a **single SQLite database this phase**, but design the schema (clean per-collection tables, deal/scope awareness) so Phase 3's split into control/demo/deal files is a mechanical move, not a redesign. Building the multi-file structure now was rejected: deal-isolation plumbing is meaningless and largely untestable before the auth + deal-resolver (Phases 2–3) that give it purpose. — **Reversibility:** costly — the table shape chosen here is what makes (or breaks) a clean Phase-3 split; a poorly-shaped schema forces a re-migration in Phase 3.

### Claude's Discretion (builder/researcher decides)
- Blob-per-collection vs normalized columns per table — research (SUMMARY.md) already says "normalize only what capability areas need"; planner picks the concrete shape, keeping D-08's deal-aware requirement.
- The mtime in-memory cache (`_dbCache`/`_dbMtime`, server.js ~246): whether to keep an in-memory cache over SQLite or query directly (better-sqlite3 is fast). PITFALLS.md flags stale-cache risk — resolve during planning.
- Faithful migration of the existing demo/real lane split — the `custom*` shadow arrays (`customEmployees`, `customIntegrationTasks`, `customRaidEntries`, `customSynergyInitiatives`, `customAssessmentInstances`, `customSettings`, etc.) migrate as-is so the round-trip deep diff (D-06) can pass; Phase 3 restructures them into the file split.
- Handling of the existing `.bak`/`.tmp` atomic-write machinery and the `download-zip` exclusion list (server.js ~411) which already excludes `db.json*` — extend for `.db` files during planning.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### This milestone's research (all directly relevant to Phase 1)
- `.planning/research/STACK.md` — driver choice (`better-sqlite3@13`, sync API rationale, `node:sqlite` rejected until Node 26), WAL/busy_timeout, native-binary bundling, auth-hardening notes. **Flags a build-verification step: confirm the better-sqlite3@13 npm tarball's bundled platform prebuilts before the next turnkey zip release, mirroring the canvas-binary practice.**
- `.planning/research/ARCHITECTURE.md` — file-per-deal target design and where the current `demoMode`-flag + shadow-array mechanism lives (informs D-08's deal-aware schema shaping).
- `.planning/research/PITFALLS.md` — migration pitfalls: schema-shape 1:1 copy trap, one-way migration risk, mtime-cache staleness, JSON deep-clone data loss. Directly informs D-06 and the cache discretion item.
- `.planning/research/SUMMARY.md` — cross-cutting synthesis and the F0→F3 build order.

### Project context
- `.planning/PROJECT.md` — milestone intent, key decisions (file-per-deal, demo/real separation, MNPI constraint).
- `.planning/REQUIREMENTS.md` — FND-01..04 exact wording.
- `.planning/ROADMAP.md` §"Phase 1" — goal and 4 success criteria.
- `.planning/codebase/CONCERNS.md` — pre-existing documented debt this phase resolves (concurrent-write race, JSON deep-clone data loss) and must not regress.

### No external ADRs/specs beyond the above — requirements fully captured in the decisions above.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `readDb()` — `server.js:249-349`. Returns the whole DB object with per-collection defaulting (`parsed.X = parsed.X || []`) and a demo-project self-seed (`proj_demo`). The collection list here (lines 258-328) is the authoritative schema inventory for the migration — 35+ top-level keys. Preserve its signature (D-03).
- `writeDb(data)` — `server.js:351-380`. Atomic temp-file+rename write with a rolling `.bak`. Re-implement internals for transactional per-collection upsert (D-04); keep the atomic/backup guarantees conceptually (SQLite WAL + the archived db.json cover them).
- mtime cache — `server.js:244-247, 254-255, 329-330, 367-368`. `_dbCache`/`_dbMtime`. Decide its fate during planning (discretion).
- Error-path guard — `server.js:332-348`. Already refuses to serve/overwrite an empty DB when a non-empty file fails to parse. Preserve the equivalent "never wipe on read failure" guarantee against SQLite.

### Established Patterns
- Whole-object read-modify-write is used everywhere: endpoints call `const db = readDb()`, mutate `db.someCollection`, then `writeDb(db)`. Comments at `server.js:2052, 2202, 2271` already note the shared-cache mutation hazard — the transactional per-collection writeDb (D-04) is the structural fix.
- `@napi-rs/canvas` platform binaries are already committed for win32-x64/linux-x64/darwin-x64/darwin-arm64 — the exact precedent for vendoring the `better-sqlite3` native binary per platform (FND-04).
- `download-zip` (`server.js:411`) excludes `db.json`/`.tmp`/`.bak` from the admin export — extend the exclusion/inclusion logic for the new `.db` files.

### Integration Points
- Every `/api/*` handler that reads or writes data goes through `readDb`/`writeDb` — keeping those signatures (D-03) is what makes this a contained change.
- `package.json`: deps are `compression, express, pdf-parse`; `engines.node >=20`; local Node is v22.18.0; bundled portable Node is v22.23.1. Adding `better-sqlite3` must keep the zero-install bundle self-contained (committed `node_modules`).
</code_context>

<specifics>
## Specific Ideas

- The migration must be a script that can run against a `db.json` snapshot repeatedly and produce the same result (re-runnable, FND-01) — this property is explicitly what lets the cutover be big-bang (D-01) and skip dual-run.
- Keep `db.json` as a retained read-only archive after cutover, not deleted.
</specifics>

<deferred>
## Deferred Ideas

- Refactoring hot endpoints to targeted per-row SQLite writes (instead of the whole-object compat API) — a real optimization, but out of scope for this low-risk foundation phase (D-05). Candidate for a later hardening pass (relates to v2 HARD-03, the monolithic-file refactor).
- Automated test suite around migration/isolation — v2 HARD-02; Phase 1 writes the concurrent-write test (FND-03) and the round-trip verify (D-06) but not a broader suite.
- SQLCipher at-rest encryption — v2 HARD-01; this milestone relies on OS full-disk encryption.

</deferred>

---

*Phase: 1-Schema & Migration*
*Context gathered: 2026-07-23*
