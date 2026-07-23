# Project Research Summary

**Project:** M&A Integration Portal — Real-Deal Milestone
**Domain:** Foundation hardening (file-store to SQLite, mandatory auth, audit log, validation) plus M&A/IMO integration software (due diligence, synergy value capture, IMO reporting/exports, org design and talent retention)
**Researched:** 2026-07-23
**Confidence:** HIGH (stack, architecture), MEDIUM (features, pitfalls — cross-checked against multiple vendor/practice sources, no single-source claims presented as fact)

## Executive Summary

This milestone turns a demo-shaped Express/vanilla-JS app into a tool an Integration Lead runs a real acquisition on, and all four researchers converged strongly on the same shape of answer. The foundation work — replacing db.json with SQLite, making auth mandatory, adding an audit log, and validating every write — is not incremental hardening on top of the current architecture; it is a structural rewrite of exactly the mechanisms (readDb/writeDb, stashActiveCustomProject/snapshotCms, the opt-in PORTAL_AUTH gate) that make demo/real separation fragile today. The single most important convergent finding is that demo/real separation should be file-per-deal SQLite (control.db + demo.db + deals/<id>.db), not a demoMode boolean/column — both Stack and Architecture research independently arrived at this, and Pitfalls research explains precisely why the column approach is the current bug class (40+ scattered demoMode checks, shadow custom* arrays) rather than a new risk.

The recommended build order is F0 (schema/migration) then F1 (mandatory auth + roles) then F2 (deal-resolver + audit triggers, where "must never share a store" is actually satisfied in code) then F3 (write validation), using better-sqlite3@13 (synchronous API matching the existing readDb/writeDb mental model, N-API prebuilt binaries fitting the zero-install-bundle precedent already set by @napi-rs/canvas) and zod for validation. Clean-room enforcement is a bounded RESOURCE_POLICY middleware over roughly 10-15 sensitive endpoints (DD, org design, retention, synergy financials) rather than a rewrite of all ~90 routes — but Pitfalls research is emphatic that this must be field-level server-side filtering, not route-level gating or frontend hiding, and that unauthorized read of MNPI (not just write) is the actual compliance event, so read-endpoint gating cannot be deferred to a later phase.

After the foundation, the four capability areas sequence by data dependency, not by headline importance: DD workspace and synergy value capture can build in parallel (both extend existing entities — integrationTasks/raidEntries via the proven from-remediation linkage, and synergyInitiatives with new baseline/phasing/CTA/stage columns); org/talent design is the most independent and the safest to trim first if scope needs to shrink; IMO reporting is last because its rollups need DD and synergy data to exist, but the cheap CSV/JSON export should ship as an immediate quick win independent of the fancier PDF pack, since the app currently has zero export endpoints at all. The key risks are schema debt disguised as "drop-in migration" (Pitfall 1), auth-retrofit route gaps from enumerating sensitive endpoints by memory instead of programmatically (Pitfall 5), clean-room implemented as UI-only field hiding (Pitfall 7), and synergy/IMO numbers nobody trusts because baseline/staleness/ownership aren't first-class (Pitfall 12) — each has a concrete, cheap prevention documented below and mapped to a phase.

## Key Findings

### Recommended Stack

Core additions are minimal and deliberately avoid new build tooling: better-sqlite3@13.0.1 for the persistence layer, zod@4.4.3 for write-path validation, and express-rate-limit@8.6.0 to replace the ad hoc login throttle. Password hashing (crypto.scryptSync) and session cookies (custom HMAC-signed) are already correctly implemented and should be promoted/tuned, not replaced. node:sqlite is explicitly rejected as still experimental until Node 26 (the bundled portable Node is 22.23.1); sqlite3 (async) is rejected for its legacy per-ABI native-binary model, which is a worse version of the exact packaging problem better-sqlite3's N-API binaries solve. No ORM — hand-written parameterized SQL plus numbered .sql migration files, matching the codebase's zero-abstraction, no-build-step style.

**Core technologies:**
- better-sqlite3 13.0.1: SQLite/WAL persistence layer — synchronous API matches existing readDb()/writeDb() style; single-thread execution eliminates the concurrent-write race outright without a mutex
- zod 4.4.3: schema validation on every write endpoint — zero build step, directly closes CONCERNS.md's Critical input-validation gap
- express-rate-limit 8.6.0: maintained login-throttle replacement, once auth is mandatory and network-reachable

### Expected Features

Four capability areas, each researched against Midaxo/Devensoft/DealRoom/SecureDocs practice and PMI/HR consulting sources. The consistent theme: build the minimum realistic version of each capability for a single-IL internal tool, and explicitly reject the "market product" version (full VDR, ML flight-risk scoring, PPTX generation, HRIS-grade org charts) as disproportionate scope for this milestone.

**Must have (table stakes):**
- DD request list + functional-area taxonomy (~10 standard categories) with findings register routing to task/RAID via the existing remediation linkage
- Clean-room accessTier (core_team/extended_team) field on DD records, enforced by role
- Synergy baseline, cost-to-achieve, and phasing (planned/realized per period) fields — fixes the "single euro-M pair" problem named in PROJECT.md
- Synergy confidence stage-gating (idea to validated to committed to captured) and synergy-to-task linkage
- CSV/JSON raw data export — closes the "no export endpoint exists at all" gap at the lowest possible effort
- Org role-mapping table (role, level, reports-to, mapped employee, decision status) — no visual org chart needed

**Should have (differentiators):**
- Auto-computed net benefit/variance and rollups feeding the reporting pack
- Cadence-aware pack variants (weekly operating view vs. monthly board view)
- Flight-risk register with rubric-based (not ML) risk levels, redundancy-communication-overdue nudges

**Defer (v2+):**
- Generated PDF/PPTX steering-committee pack (build after Areas 1-2 data is proven), historical pack archive, two-stage org design tracking, any AI-assisted document extraction, interactive BI dashboarding, full VDR/document ACL system, automated ML flight-risk scoring, scheduled/emailed report cadence

### Architecture Approach

The system splits server.js (~3,200 lines) into routes/*.js + services/*.js + middleware/*.js, mounted around a small pipeline: session gate, then deal-resolver (attaches req.dealId/req.isDemo/req.dealDb), then access-policy (RESOURCE_POLICY-driven 403s), then actor-stamp (for audit triggers), then route handler. This is a refactor into plain require()/express.Router(), not a framework migration — consistent with the vanilla-JS, no-build-step constraint.

**Major components:**
1. db/dealResolver.js — maps selected deal to a physical SQLite file/connection, replacing stashActiveCustomProject/snapshotCms/applyCmsToTopLevel
2. middleware/accessPolicy.js — data-driven RESOURCE_POLICY config gating ~10-15 sensitive endpoints (DD, org design, retention) by role + workstream, leaving the other ~75+ content/CMS endpoints to the mandatory-auth gate alone
3. db/triggers.sql + middleware/auditActor.js — SQLite AFTER INSERT/UPDATE/DELETE triggers write to audit_log in control.db, so every write path (including future ones nobody remembers to instrument) is captured automatically

### Critical Pitfalls

1. **Migration reshapes data instead of normalizing it** — treat the SQLite migration as a schema-design exercise for tables new capabilities depend on (DD findings, synergy, audit log, users), not a 1:1 JSON-blob-to-table serialization swap; CMS/i18n/slide content is legitimately fine as JSON columns.
2. **Migration is a one-way door** — make it idempotent/re-runnable against a fresh db.json snapshot, with a diff/checksum verification step, and keep the pre-migration file archived permanently as a rollback oracle.
3. **Auth retrofit has route-shaped holes** — enumerate all ~90 endpoints programmatically (not by memory) and require an explicit auth decision per route via a global allow-list, not per-route opt-in; re-run the enumeration whenever new capability-area routes are added.
4. **Clean-room built as route-level gating instead of field-level filtering** — sensitive fields (valuation, DD findings, retention data) must be filtered server-side per clean-room membership on every response; verify by curling the raw API as a non-clean-room user, not just checking the UI.
5. **Synergy/IMO numbers management doesn't trust** — model baseline changes as an append-only history table (not a mutable field), give every initiative a single owner with overlap flags, and distinguish last_confirmed_at (owner-attested) from last_updated_at (system-touched) so generated packs visibly flag stale line items.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Schema & Migration (F0)
**Rationale:** Gates everything else — no capability area can attach data until tables exist. Getting normalization right here is cheap; getting it wrong under real deal data is expensive to fix later (Pitfall 1).
**Delivers:** control.schema.sql / deal.schema.sql / demo.schema.sql, a re-runnable/diffable migrate-from-json.js, vendored better-sqlite3 prebuilt binaries for all four release-zip platforms.
**Uses:** better-sqlite3@13.0.1, hand-numbered migration files, WAL/pragma configuration.
**Avoids:** Pitfall 1 (reshaping not normalizing), Pitfall 2 (one-way-door migration), Pitfall 11 (real DB file committed to git — gitignore/naming designed together with the schema).

### Phase 2: Mandatory Auth + Roles (F1)
**Rationale:** Promotes existing PORTAL_AUTH rather than rebuilding — the hard part (scrypt hashing, HMAC-signed sessions) is already correct; the work is enforcement completeness and role granularity. Must land before any real deal data, and before F2 (access policy needs real roles).
**Delivers:** Mandatory session gate (no "unset = open" branch), expanded role enum (il, ws_lead_*), programmatically-generated 100%-coverage route/auth-decision checklist, first-run admin bootstrap.
**Addresses:** Every capability area's access requirements downstream.
**Avoids:** Pitfall 5 (route gaps from memory-based enumeration), Pitfall 6 (read-endpoint MNPI exposure deprioritized vs. writes).

### Phase 3: Deal-Resolver + Audit Log (F2)
**Rationale:** This is where "real-deal data must never share a store" is actually satisfied in code, not just in policy — the file-per-deal pattern (Stack + Architecture converged independently). Must follow F0 (files to resolve to) and F1 (req.user for audit-actor stamping).
**Delivers:** db/dealResolver.js, middleware/auditActor.js, generated audit triggers on every table, demo-only functions (time-travel, XP/leaderboard) gated at their own entry point (not just route/UI level), client-storage keys namespaced by mode.
**Implements:** Architecture Pattern 1 (file-per-mode persistence) and Pattern 4 (trigger-based audit log).
**Avoids:** Pitfall 3 (stale-cache reintroduction), Pitfall 4 (wrong transaction boundaries), Pitfall 8 (audit log not tamper-resistant), Pitfall 9 (demo/real shared mutating functions), Pitfall 10 (frontend global-state mode leak).

### Phase 4: Write Validation (F3)
**Rationale:** Natural byproduct of the routes/ split happening table-by-table in F0-F2; closes CONCERNS.md's Critical input-validation gap with the exact fields it names.
**Delivers:** zod schema per resource type (validators/projects.js, etc.), applied at every write endpoint.
**Uses:** zod@4.4.3.

### Phase 5: Due Diligence Workspace
**Rationale:** First capability area because clean-room is the other hard architectural requirement besides mode separation; validates accessPolicy.js before org design reuses the same pattern.
**Delivers:** DD request list + functional-area taxonomy, findings register with severity/owner, findings-to-task/RAID routing (reusing from-remediation), accessTier clean-room field enforced server-side (field-level, not route-level).
**Addresses:** FEATURES.md Area 1 table stakes + P1 differentiators.
**Avoids:** Pitfall 7 (clean-room as route-gate not field-filter) — the pattern established here is reused by Areas 3 and 4.

### Phase 6: Synergy Value Capture (can run in parallel with Phase 5)
**Rationale:** Lowest new-architecture risk — extends the existing synergyInitiatives table with new columns and a time-series child table, no new access model, shares no new middleware surface with DD.
**Delivers:** baseline, costToAchieve, stage, stageHistory[], phasing[], deliveredByTaskIds[] on synergyInitiatives; append-only synergy_baseline_events table; last_confirmed_at/last_confirmed_by staleness signal.
**Addresses:** FEATURES.md Area 2 table stakes.
**Avoids:** Pitfall 12 (untrustworthy synergy numbers — double-counting, baseline drift, stale-as-current).

### Phase 7: IMO Reporting & Exports
**Rationale:** Last by data dependency, though it's the headline deliverable — its rollups need Phase 5 (DD) and Phase 6 (synergy) data to exist, plus the audit log (Phase 3) for the change-log section. Ship CSV/JSON export first as a standalone quick win, independent of the PDF pack.
**Delivers:** CSV/JSON data export of tasks/RAID/synergies (P1, immediate); generated PDF steering-committee pack with weekly/monthly cadence variants (P2, after Phase 5/6 data is proven); staleness-visible report rendering (confirmed vs. carried-over line items).
**Addresses:** FEATURES.md Area 3 — closes the "app has import but zero export endpoints" gap named as near-blocker-severity in PROJECT.md.
**Avoids:** Pitfall 12 (shared staleness-visibility convention with Phase 6), UX pitfall of packs presenting stale numbers with equal visual confidence.

### Phase 8: Org Design & Talent Retention
**Rationale:** Most independent of the four capability areas — touches only employees, nothing else in the milestone depends on it. Safest to trim first if the milestone needs to shrink. Sequenced after DD so its pre_close_restricted access rule reuses the already-proven accessPolicy.js pattern rather than inventing it twice.
**Delivers:** orgRoles (role/level/reports-to/mapped-employee/decision status), flightRiskRegister (rubric-based risk level, not ML), redundancy-communication-overdue nudge.
**Addresses:** FEATURES.md Area 4 table stakes.

### Phase Ordering Rationale

- Foundation (Phases 1-4) gates all four capability areas per PROJECT.md's own explicit "foundation first" decision — this isn't a new finding, all four researchers independently confirmed the sequencing holds because DD clean-room, flight-risk/redundancy visibility, and steerco pack contents all touch the most sensitive data in the app.
- DD and synergy (Phases 5-6) can build in parallel post-foundation since they extend independent existing entities with no shared new middleware surface.
- Reporting (Phase 7) is sequenced last by data dependency, not by priority — it would ship with two of five sections empty if built before DD/synergy data models exist.
- Org design (Phase 8) is the safest scope-cut candidate — nothing else in the milestone depends on it.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (Schema & Migration):** MEDIUM confidence on the exact better-sqlite3 v13 bundled-platform binary manifest — verify by inspecting node_modules/better-sqlite3/ after install, before assuming all four release-zip platforms are covered.
- **Phase 7 (IMO Reporting):** PDF-generation approach for this vanilla-JS/no-build-step stack needs concrete implementation research (which existing print-to-PDF pattern in the app to reuse) once this phase is reached.
- **Phase 5 (DD Workspace):** exact workstream-lead role taxonomy is an open question (see Gaps below) — needs resolution before accessPolicy.js's RESOURCE_POLICY can be finalized.

Phases with standard patterns (skip research-phase):
- **Phase 2 (Mandatory Auth):** existing PORTAL_AUTH implementation is already correct; this is enforcement completeness, well-documented pattern.
- **Phase 6 (Synergy):** pure schema extension of an existing entity, no new architecture.
- **Phase 4 (Write Validation):** zod usage pattern is standard and already demonstrated in STACK.md.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All package versions verified live against npm registry; only the exact better-sqlite3 v13 bundled-binary platform manifest is MEDIUM (needs post-install verification) |
| Features | MEDIUM | Cross-checked against multiple vendor sources (Midaxo, Devensoft, DealRoom/SecureDocs) and PMI/HR consulting guides; exact vendor UI specifics flagged LOW inline where noted |
| Architecture | HIGH | Grounded directly in this codebase's server.js and .planning/codebase/*; SQLite/audit-trigger patterns cross-checked against current library docs |
| Pitfalls | MEDIUM-HIGH | SQLite/WAL mechanics verified against sqlite.org + better-sqlite3 official docs; auth/MNPI/reporting-trust pitfalls are established patterns applied specifically to this codebase's documented shape |

**Overall confidence:** HIGH — all four researchers converged independently on the same architectural conclusions (file-per-deal, foundation-first, bounded access-policy middleware), which is a strong cross-validation signal.

### Gaps to Address

- **SQLCipher (at-rest encryption) vs. OS full-disk encryption (FileVault/BitLocker) as baseline expectation** — Pitfalls research flags this as an open security decision; needs to be resolved before real deal data is entered, not deferred silently. Flag for requirements gate.
- **Whether the shared-host move happens within this milestone or after** — affects whether multi-process WAL concurrency and the "WAL doesn't work over network filesystems" constraint need addressing now or can wait.
- **TE export format: PDF vs. PPTX** — FEATURES.md recommends PDF-only (rejecting native PPTX as disproportionate engineering investment) but this is a stakeholder expectation question, not purely technical; confirm with TE before Phase 7.
- **Whether TE already licenses a VDR (Datasite/Intralinks)** — directly affects how thin the DD clean-room feature can legitimately be; if TE has no VDR, the DD workspace's document-tracking scope may need to expand slightly beyond the "reference/link only" recommendation.
- **Exact workstream-lead role taxonomy** (ws_lead_hr, ws_lead_legal, etc.) — Architecture research proposes examples but this needs concrete definition before Phase 2's role enum and Phase 5's RESOURCE_POLICY can be finalized.

## Sources

### Primary (HIGH confidence)
- npm registry, verified live via npm view (2026-07-23): better-sqlite3 13.0.1, zod 4.4.3, express-rate-limit 8.6.0, csrf-csrf 4.0.3
- SQLite WAL official docs (sqlite.org/wal.html), better-sqlite3 performance docs (GitHub WiseLibs), Node.js SQLite docs (nodejs.org/api/sqlite.html)
- Direct codebase inspection: /Users/karstenhaldan/M&A/server.js, .planning/codebase/CONCERNS.md, .planning/codebase/ARCHITECTURE.md, .planning/codebase/STRUCTURE.md, .planning/PROJECT.md

### Secondary (MEDIUM confidence)
- Midaxo (midaxo.com/platform/m-a-due-diligence), Devensoft (devensoft.com/platform/synergy-tracking), DealRoom/SecureDocs (securedocs.com), BCG synergy PMI, L.E.K. synergy, Umbrex PMI Playbook 2025, WTW org design/talent flight, KPMG talent flight
- Simon Willison — SQLite JSON audit log pattern

### Tertiary (LOW confidence)
- Exact better-sqlite3 v13.0.0 GitHub release asset manifest — inferred from release commentary, not directly enumerated; verify post-install before final release build

---
*Research completed: 2026-07-23*
*Ready for roadmap: yes*
