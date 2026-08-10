# Phase 1: Schema & Migration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-23
**Phase:** 1-Schema & Migration
**Areas discussed:** Cutover strategy, readDb/writeDb API fate, Verification bar, Phase-3 schema anticipation

---

## Cutover strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Big-bang + verified archive | Deterministic re-runnable migration, verify offline, cut over once, keep db.json as read-only archive | ✓ |
| Dual-run behind a flag | Write to both stores in parallel, compare live, then flip | |

**User's choice:** Big-bang + verified archive
**Notes:** Chosen because the migration's re-runnability (FND-01) is itself the safety net; live dual-write plumbing judged too heavy for a deterministic migration over demo data.

---

## readDb/writeDb API fate

| Option | Description | Selected |
|--------|-------------|----------|
| Keep API, transactional per-collection writes | Preserve readDb()/writeDb() signatures; writeDb upserts changed collections in one SQLite transaction | ✓ |
| Keep API, global write mutex | Whole-object write serialized by a mutex — safe but keeps O(whole-db) write cost | |
| Refactor hot paths to targeted writes | Convert busiest endpoints to per-row writes now | |

**User's choice:** Keep API, transactional per-collection writes
**Notes:** Established during discussion that SQLite alone does NOT fix the lost-update race under whole-object write-modify-write semantics; the per-collection transactional upsert is the actual FND-03 fix. Lowest churn against the ~3,200-line server.js while genuinely closing the race.

---

## Verification bar

| Option | Description | Selected |
|--------|-------------|----------|
| Round-trip deep diff + row counts | Reconstruct object from SQLite, assert deep-equals original db.json, plus per-collection row-count parity; gates retirement | ✓ |
| Row-count parity only | Assert equal row counts per collection | |
| Deep diff + extended parallel run | Deep diff plus a stretch of live parallel comparison | |

**User's choice:** Round-trip deep diff + row counts
**Notes:** Deterministic proof sufficient; catches field-level/type-coercion bugs. Parallel-run rejected as overkill and dependent on the rejected dual-run plumbing.

---

## Phase-3 schema anticipation

| Option | Description | Selected |
|--------|-------------|----------|
| Single deal-aware DB now | Migrate into one SQLite DB, shape schema so Phase-3 file split is mechanical | ✓ |
| Build the multi-file structure now | Lay control.db + demo.db in Phase 1 | |

**User's choice:** Single deal-aware DB now
**Notes:** Multi-file structure rejected as speculative — deal-isolation plumbing is meaningless and largely untestable before the auth + deal-resolver of Phases 2–3. Schema still shaped deal-aware to keep the Phase-3 split from becoming a redesign.

---

## Claude's Discretion

- Blob-per-collection vs normalized columns (research says normalize only what capability areas need).
- Fate of the mtime in-memory cache (`_dbCache`/`_dbMtime`) over SQLite.
- Faithful migration of the `custom*` demo/real shadow arrays as-is (Phase 3 restructures).
- `.bak`/`.tmp` machinery and the download-zip exclusion list extension for `.db` files.

## Deferred Ideas

- Refactor hot endpoints to targeted per-row writes (later hardening; relates to v2 HARD-03).
- Broader automated test suite beyond the FND-03 concurrent-write test and the round-trip verify (v2 HARD-02).
- SQLCipher at-rest encryption (v2 HARD-01; milestone relies on OS full-disk encryption).
