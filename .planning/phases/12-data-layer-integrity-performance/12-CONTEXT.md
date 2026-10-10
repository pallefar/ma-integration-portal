# Phase 12: Data-Layer Integrity & Performance - Context

**Gathered:** 2026-10-10
**Status:** Ready for planning
**Source:** PRD Express Path (.planning/reviews/v3.0/PHASE-12-PRD.md)

<domain>
## Phase Boundary
Writes and audit proportional to change; reads proportional to the request; versioned schemas; hash-chained per-deal audit
partitions with seal/export/verify/purge; CPU isolation for pack/pdf; trustworthy tests (isolation guard, workflow);
content-hash cache-busting; a browser smoke harness. Requirements DATA-01..06, QUAL-01, QUAL-02.
</domain>

<decisions>
## Implementation Decisions
LOCKED D-12-01..08 (full wording + numeric budgets + acceptance in PHASE-12-PRD.md): dirty-row writes (≤40 ms median, one audit
row per change, soak + Phase 9 contract suite unchanged); readCollections + server-side filter/page + one-request DD workspace
(p95 ≤300 ms, loop p99 ≤100 ms); user_version migrations + quick_check + not-ready; audit partitions hash-chained, seal/export/
verify/purge (never auto-purge); worker-thread pack/pdf with 1-in-flight 429 (p99 ≤50 ms); test isolation guard + workflow +
20× green; serve-time content-hash `?v=`; Playwright+axe smoke harness.
### Claude's Discretion
Schema/column details of audit partitions, migration file layout, worker implementation choice, perf script design, how
readCollections is threaded through db/store.js, query-param naming (keep the PRD set).
</decisions>

<canonical_refs>
- `.planning/reviews/v3.0/PHASE-12-PRD.md`, `.planning/REQUIREMENTS.md` (DATA-01..06, QUAL-01/02), `.planning/ROADMAP.md` Phase 12 SC1–8
- `.planning/reviews/v3.0/R2-ops-data-deploy.md` (R2-01/02/03/08/10), `R5-quality.md` (R5-01..05), `PLAN-REVIEW.md` (PR-09/13/20/21)
- `db/store.js`, `db/auditHook.js`, `db/dbFiles.js`, `db/audit-schema.sql`, `server.js` (readDb/writeDb call sites, /api/admin/audit, reports pack, rag upload), `lib/reportPack.js`, `scripts/soak.js`, `test/optimistic-locking-*.test.js`, `test/audit-*.test.js`, `test/asset-cache-bust.test.js`
</canonical_refs>

<specifics>
Helpers: test/helpers/listen-local.js, seed-identity.js, held-version.js; Playwright pattern scripts/uat/phase10-walk.js; isolated MA_* temp paths only; real-mode data dir (MA_MODE=real → data/real).
</specifics>

<deferred>
/readyz + graceful shutdown + structured logs (Phase 20); a11y fixes (19); IL list UIs using paging (18).
</deferred>

---
*Phase: 12-data-layer-integrity-performance*
