# Research Summary: v2.2.0 Shared-Host Multi-User Milestone

**Domain:** Transforming a single-process, laptop-local M&A integration portal into a shared-host tool with concurrent multi-user collaboration  
**Researched:** 2026-08-10  
**Overall Confidence:** HIGH (concurrency and deployment guidance grounded in codebase and sqlite.org; feature dependencies mapped against existing app structure; pitfall coverage comprehensive)

---

## Executive Summary

This milestone transforms the existing Phase-1-validated demo portal into a production-ready, multi-user tool suitable for running a real TE acquisition with 1 Integration Lead + 4–10 workstream leads collaborating on shared records. The research converges across three independent sources (STACK, ARCHITECTURE, and direct code verification) on a single concurrency architecture: **Option B — native SQLite multi-process WAL write-serialization with `.immediate()` transactions and busy-retry/503 handling**. This requires only two targeted changes to `db/store.js` (no call-site changes to the ~90 existing endpoints) and delivers the milestone's core safety guarantees—concurrent writes are file-level atomic, and same-record conflicts are detectable and recoverable through optimistic locking (version column), a separate phase sequenced after the concurrency architecture lands. Deployment patterns split into three shapes (self-managed Linux host, container/platform-run with `replicas: 1`, app-only) with a clean MNPI boundary enforced through `.dockerignore` mirroring `.gitignore`. The highest concentration of new pitfalls surfaces in containerization, role/clearance-change revocation, and session management at scale; these are well-understood by domain and addressable through explicit threat-model passes during planning phases. The milestone is achievable within existing vanilla-JS + SQLite + Express constraints without Postgres migration (deferred to a speculative v3.0), without a single-writer broker (unnecessary complexity at this team scale), and without real-time collaborative editing (ruled out by the user's chosen optimistic-locking architecture). Total engineering cost is **medium** (7–8 phases, ~35–45 story-points total estimated by research); the gating dependency is the concurrency architecture proof (multi-process soak test) before multi-user collaboration features can ship safely.

---

## Key Findings

### From STACK.md: Core Technologies & Versions

**New dependencies (v2.2.0 only):**
- `express-rate-limit@8.6.2` — only new npm dependency; in-memory store correct for single-process recommendation
- systemd / container runtime — OS-native process supervision, no new npm deps
- Caddy 2.11.4 or nginx 1.30.4 — TLS termination + reverse proxy (not inside Node)

**Critical constraints:**
- `better-sqlite3@13.0.1` prebuilds require **glibc >= 2.38** (not Alpine/musl)
- Optimistic locking via version field inside JSON blob (reuses `json_extract()`, no schema migration)
- Backup strategy: `better-sqlite3`'s `.backup()` API (WAL-aware), not raw file copy

**What to avoid:**
- Node cluster/PM2 cluster mode, Alpine base image, cross-process advisory locks, network-filesystem-backed SQLite

---

### From FEATURES.md: MVP Scope & Dependencies

**P1 (v2.2.0 launch):**
1. Optimistic-locking conflict UX (version + 409 + reload) — prevents silent same-record data loss
2. Workstream-lead invite/assign + per-area clearance — the milestone's defining collaboration feature
3. Idle session timeout — MNPI leak vector control
4. Self-service active-session list + revoke — "left myself logged in" self-recovery
5. Inline "who last touched this" attribution — trust signal via existing audit log

**P2 (post-v2.2.0, with real-usage validation):**
- Per-step wizard ownership handoff + multi-user resume state
- User-facing activity feed (read-only audit projection)
- Coarse presence signal ("N on this deal")
- Admin-forced revoke of another user's session

**Explicitly rejected (anti-features):**
- Real-time collaborative editing (contradicts optimistic locking)
- WebSocket live presence, field-level locking, rich notifications, anomaly detection

---

### From ARCHITECTURE.md: The Concurrency Decision (Converged Finding)

**Critical insight:** The premise "snapshot merge is in-process only" is half right, and the half that's wrong matters enormously.

`writeDb()` compares **this request's own snapshot** against payload ids, issuing real INSERT/UPDATE/DELETE by id inside one SQLite transaction against **the live file**. Nothing about that algorithm depends on reader/writer being the same OS process. It depends on:
1. `readDb()` reading actually-current rows (WAL handles this for any process)
2. Transaction atomicity (SQLite's cross-process locking via WAL handles this; already configured)

Same-record concurrent edits remain unsafe (no version check) — **optimistic locking closes this, identically whether one or five Node processes**. WAL's cross-process locking already protects collection-membership edits (insert/delete races).

**Recommendation: Option B — native SQLite WAL with `.immediate()` + busy-retry**

| Criterion | Option A: Broker | **Option B: Native WAL** | Option C: Postgres |
|-----------|---|---|---|
| Correctness | Preserved (redundant) | **Preserved — no change** | Preserved |
| New components | Writer + IPC | **None** | Store, pool, migrations |
| Call-site changes | None | **None** | None (C1 facade) |
| Horizontal scaling (N>1) | Yes | **No — replicas: 1 only** | Yes |
| Zero-install zip | Survives | **Survives** | Breaks (needs server) |
| Demo showcase | Survives | **Survives** | Survives (if dual-backend) |
| Engineering cost | Medium-high | **Low** | High |
| Version | v2.2.0 | **v2.2.0** | Likely v3.0 |

**Option B implementation (two tiny changes):**
1. `.immediate()` on transaction in `writeDb()` — acquire write lock at start, fail fast under contention
2. Busy-retry wrapper catching `SQLITE_BUSY`, jittered backoff, map to `503 Retry-After`
3. Two-process soak test opening two `better-sqlite3` connections from two Node processes, concurrent writes

**Optimistic locking (independent, sequences after architecture decision):**
- Add `version INTEGER DEFAULT 1` inside item's JSON (reuses `json_extract()`)
- Conditional UPDATE: `WHERE id=? AND version=?`, checking `.changes` to distinguish delete from conflict
- Scope per-collection: RAID, tasks, DD findings, synergy, org/decision log
- Separate phase after concurrency architecture lands

---

### From PITFALLS.md: 13 Critical Pitfalls Mapped to Phases

| # | Pitfall | Prevention Phase | Severity |
|---|---------|---------|----------|
| 1 | Concurrency trap — multi-process without coordination | Concurrency architecture | CRITICAL |
| 2 | Optimistic locking not atomic (TOCTOU) | Same as #1 | CRITICAL |
| 3 | WAL checkpoint contention / unbounded `-wal` | Operational hardening | MAJOR |
| 4 | Role/clearance change doesn't revoke sessions | Workstream-lead collaboration | MAJOR |
| 5 | Session cookie loses `Secure` on real TLS | Deployment (self-managed host) | MAJOR |
| 6 | No idle timeout / session inventory | Operational hardening | MAJOR |
| 7 | Audit gaps on new collaborative routes | Workstream-lead + wizard | MAJOR |
| 8 | Presence/activity leaks deal identity (MNPI) | Workstream-lead collaboration | CRITICAL |
| 9 | `DEMO_OPEN=1` on shared host | Deployment | CRITICAL |
| 10 | Backups unencrypted/unmanaged | Deployment + ops | MAJOR |
| 11 | Rolling restarts drop writes / dual-process window | Deployment | MAJOR |
| 12 | Demo/real separation erodes in packaging | Deployment (container) | MAJOR |
| 13 | Container build/runtime MNPI + libc mistakes | Deployment (container) | MAJOR |

**Key integration gotchas:**
- TLS proxy + `ENABLE_HSTS=1` on Node — two independent setup steps
- `DEMO_OPEN=1` inheritance from demo unit/image — must explicitly unset
- Backups to unencrypted or non-TE-controlled locations — must be in runbook
- Demo and real deployments on same volume — config contract must forbid

---

## Roadmap Implications: 7–8 Phase Build Order

### Phase 1: Concurrency Architecture Decision + Proof (GATING)
**Deliverable:** Two-process soak test proving Option B holds under realistic load  
**Scope:** Multi-process test harness, concurrent-write scenarios, silent-loss detection  
**Confidence:** HIGH  
**Story points:** 13–21

### Phase 2: Storage-Layer Hardening (GATES 3–7)
**Deliverables:**
- `.immediate()` + busy-retry in `writeDb()` (2 changes, 0 call-site mods)
- Schema-migration runner (`schema_migrations` table, numbered `.sql` files)
- `DATA_DIR` env-overridable, loopback-bind + trust-proxy, `uncaughtException` → log-then-exit
- Health split: `/healthz` (liveness) + `/readyz` (readiness, migrations complete)

**Confidence:** HIGH  
**Story points:** 13–21

### Phase 3: Optimistic Locking (AFTER 2; GATES 7)
**Deliverables:**
- Version-column migration for co-edited collections
- Conditional UPDATE + 409 conflict detection
- Client reload UX (preserve in-progress edit, show diff, reapply)
- Concurrency test suite

**Confidence:** MEDIUM-HIGH  
**Story points:** 13–21

### Phase 4: Multi-Process Runtime (AFTER 1–2)
**Deliverables:**
- Process-supervisor config (systemd multi-instance or Node cluster)
- Rolling-restart runbook (strictly sequential for Option B)
- N-process load/soak test

**Confidence:** MEDIUM  
**Story points:** 8–13

### Phase 5: Self-Managed Host Deployment (PARALLEL TO 6; AFTER 2–4)
**Deliverables:**
- Reverse-proxy config (TLS + loopback binding)
- systemd unit (explicit `DEMO_OPEN` unset, `ENABLE_HSTS=1` mandatory)
- Backup/restore via `.backup()` API with MNPI policy
- Startup MNPI checks, runbook/checklist

**Confidence:** MEDIUM  
**Story points:** 13–21

### Phase 6: Container/Platform Shape (PARALLEL TO 5; AFTER 2–4)
**Deliverables:**
- Dockerfile (`node:22-bookworm-slim`, no build, non-root `USER`)
- `.dockerignore` audited vs. `.gitignore` (MNPI boundary)
- Config contract with `replicas: 1` hard constraint + rationale
- Startup check refusing real-deal traffic without persistent `/data/`
- Separate images/tags for demo vs. real-deal

**Confidence:** MEDIUM  
**Story points:** 13–21

### Phase 7: Workstream-Lead Collaboration (AFTER 2–3)
**Deliverables:**
- Invite flow + email activation, clearance-grant UI
- Auto-revoke-on-change (follow `releaseSessionsForDeal()` pattern)
- Self-service "my active sessions" view, idle-timeout + `last_activity`
- Audit coverage validation, MNPI threat-model pass (server-side presence filtering)

**Confidence:** MEDIUM  
**Story points:** 21–34

### Phase 8: Deal-Setup Wizard Enhancements (AFTER 7; **DEFERRED post-v2.2.0**)
**Deliverables:**
- Per-step ownership, multi-user resume state, handoff UI
- Integration with Phase 7 clearance model

**Confidence:** MEDIUM  
**Story points:** 13–21  
**Rationale:** First real deal may not need this; validate demand before building.

### Critical Dependencies
1. Phase 1 gates everything (architecture must lock first)
2. Phase 2 gates 3–7 (storage foundation)
3. Phase 3 gates 7 (optimistic locking before real concurrency)
4. Phases 5 & 6 parallel (deployment-shape variations)
5. Phase 7 gates Phase 8

### Validation Checkpoints

**Phase 1:** 2+ real processes, concurrent writes → no silent loss  
**Phase 2:** DB connection explicit close; soak test; WAL checkpoint manageable  
**Phase 3:** Race-window test → 409, not last-write-wins  
**Phase 4:** Rolling restart → old process fully exits before new starts  
**Phase 5:** Backup restore under load; inspect `Set-Cookie` for `Secure`; `ENABLE_HSTS=1` set  
**Phase 6:** `docker history` zero MNPI; startup check with/without `/data/` mounted  
**Phase 7:** Audit coverage per new endpoint; non-member cannot see presence for deals they're not on

### TE IT Confirmation Needed

- **Container platform constraint:** Can it pin `replicas: 1` with persistent RWO volume?
  - YES → stay with Option B (SQLite) throughout v2.2.0
  - NO (requires horizontal autoscaling) → Option B not viable; escalate to A or C as v2.2.0 fork or v3.0 redirect

---

## Confidence Summary

| Area | Confidence | Known Gap |
|------|------------|-----------|
| Concurrency architecture | **HIGH** | 409 UX implications need real-user Phase 3 UAT |
| Stack (deps, ops tools) | **HIGH** | Minor version bumps not risk-assessed |
| Features & MVP | **MEDIUM-HIGH** | First real deal may reprioritize P2 features |
| Pitfalls | **HIGH** | Presence MNPI (Pitfall #8) needs Phase 7 spec deep dive |
| Deployment shapes | **MEDIUM** | TE IT infrastructure (K8s, storage, registry) unconfirmed |
| WAL checkpoint | **MEDIUM** | No real multi-user load test of this app's write patterns |

**Largest risks:**
1. Real multi-user UX friction in conflict resolution or session management (Phase 3 UAT)
2. TE IT platform constraints diverging from Option B assumptions (Phase 6 planning)
3. Backup restore reliability under multi-collection concurrent load (Phase 5 test)
4. Single Node process event-loop saturation under realistic deal workload (Phase 4 load test)

---

## Ready for Planning

**Architecture:** Locked on Option B  
**Stack:** Determined (express-rate-limit, systemd/Caddy, version-in-JSON)  
**Features:** P1 scoped; P2 deferred post-validation  
**Pitfalls:** All 13 mapped with prevention phases and verification criteria  
**Phases:** 7–8 with clear dependencies; gating decision explicit (Phase 1)  
**Validation:** Load tests, UAT checkpoints, TE IT confirmations, per-phase verification checklists  

**Next:** `/gsd-plan-phase --research-phase 1 Concurrency Architecture Decision + Proof`

---

*Synthesized from STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md (2026-08-10)*  
*v2.2.0 Shared-Host Multi-User Milestone*  
*Overall Confidence: HIGH*
