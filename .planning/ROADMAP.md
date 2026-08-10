# Roadmap: M&A Integration Portal

## Milestones

- ✅ **v2.1.0 — Real-Deal** — Phases 1–7 (shipped 2026-08-10)
- 🚧 **v2.2.0 — Shared-Host Multi-User** — Phases 8–13 (planning)

## Phases

<details>
<summary>✅ v2.1.0 Real-Deal (Phases 1–7) — SHIPPED 2026-08-10</summary>

Turned the demo-shaped portal into a tool an Integration Lead runs a real TE
acquisition on, MNPI-grade. Foundation-first (SQLite → mandatory auth → deal
isolation/audit/validation) then four capability areas (DD workspace, synergy
value capture, org/talent design, IMO reporting/exports). Demo showcase
preserved. Suite 687/687. Full detail archived in
[`milestones/v2.1.0-ROADMAP.md`](milestones/v2.1.0-ROADMAP.md).

- [x] Phase 1: Schema & Migration (3/3 plans) — completed 2026-08-10 (Linux boot Docker-verified; Windows static-verified + release-confirm)
- [x] Phase 2: Mandatory Auth & Roles (3/3 plans) — completed 2026-07-31
- [x] Phase 3: Deal Isolation, Audit Log & Write Validation (6/6 plans) — completed 2026-08-02
- [x] Phase 4: Due Diligence Workspace (10/10 plans) — completed 2026-08-05
- [x] Phase 5: Synergy Value Capture (8/8 plans) — completed 2026-08-06
- [x] Phase 6: Org Design & Talent Retention (8/8 plans) — completed 2026-08-08
- [x] Phase 7: IMO Reporting & Exports (7/7 plans) — completed 2026-08-10

Gates at close: code review 0-crit (Phases 6–7), Fable verifier passed, per-phase
`/gsd-secure-phase` SECURED, plus a whole-codebase Fable 5 security review before
the release cut (found + fixed a cross-phase clean-room bypass and three XSS sinks).

</details>

### 🚧 v2.2.0 Shared-Host Multi-User (Phases 8–13) — PLANNING

**Milestone Goal:** Move the portal from laptop-local to a shared internal host where the
Integration Lead and workstream leads collaborate on one live deal concurrently — conflict-safe,
operationally hardened, deployable across a self-managed host / a container / app-only — plus
collaborative deal-setup wizard enhancements. Architecture locked on Option B (SQLite, host-local
WAL write-serialization, `replicas: 1`); the zero-install committed-DB turnkey model and the demo
showcase both survive. MNPI-grade throughout: every phase gets a threat model at plan time.

- [ ] **Phase 8: Concurrency & Storage Foundation** — Serialize concurrent writers on one host with zero lost updates (GATING) — CONC-01
- [ ] **Phase 9: Optimistic Locking & Conflict Recovery** — Same-record conflicts are caught (409) and recoverable, not silently clobbered — CONC-02
- [ ] **Phase 10: Runtime Hardening & Deployment Readiness** — The app self-reports health, drains safely, resists abuse, and manages secrets/sessions to shared-host standards — DEPLOY-03, OPS-01, OPS-02, OPS-03
- [ ] **Phase 11: Deployment Shapes** — Stand the portal up as a self-managed Linux service or a TE-IT container from shipped tooling + config contract — DEPLOY-01, DEPLOY-02
- [ ] **Phase 12: Workstream-Lead Collaboration** — Workstream leads join a live deal with the right clearances, revoked cleanly on change, with MNPI-safe presence and activity awareness — COLLAB-01, COLLAB-02, COLLAB-03, COLLAB-04
- [ ] **Phase 13: Collaborative Deal-Setup Wizard** — Two or more people set up a deal together — onboarding, per-step handoff, multi-user-aware resume — WIZ-02, WIZ-03, WIZ-04

## Phase Details

### Phase 8: Concurrency & Storage Foundation
**Goal**: Concurrent writers on one shared host serialize safely with zero lost updates — the Option-B storage-layer change that gates the whole milestone.
**Depends on**: Nothing (first phase of v2.2.0; builds on the v2.1.0 SQLite/WAL layer)
**Requirements**: CONC-01
**Success Criteria** (what must be TRUE):
  1. Two or more processes (or overlapping in-process requests) writing the same deal's records concurrently all persist — no write silently overwrites another, proven by a multi-process soak test.
  2. Under write contention a losing writer gets a clear, bounded retry signal (busy-retry → `503 Retry-After`) rather than a corrupt, partial, or hung write.
  3. The demo showcase still boots and behaves identically, and the zero-install committed-DB turnkey bundle still runs with no install step, after the storage-layer change.
**Plans**: TBD

### Phase 9: Optimistic Locking & Conflict Recovery
**Goal**: When two people edit the same record, the second save is caught and safely recoverable instead of silently overwriting the first.
**Depends on**: Phase 8 (storage-layer hardening must land before optimistic locking; architecturally independent of it)
**Requirements**: CONC-02
**Success Criteria** (what must be TRUE):
  1. A user saving an edit to a co-edited record (RAID entry, integration task, DD finding, synergy initiative, org decision) based on stale data has that write rejected with a 409 rather than clobbering the newer version.
  2. On a 409 the user sees a reload-and-reapply path that preserves their in-progress edit instead of discarding it.
  3. Two users editing different records concurrently both save successfully — the lock bites only on the same record, not the whole collection.
**Plans**: TBD
**UI hint**: yes

### Phase 10: Runtime Hardening & Deployment Readiness
**Goal**: The app runs as a production-hardened managed service — self-reporting health, draining safely on shutdown, resisting abuse, and managing secrets and sessions to shared-host standards. The common app-layer base both deployment shapes build on.
**Depends on**: Phase 8 (runtime hardening builds on the hardened storage layer; migration-on-boot ties to the schema/storage layer)
**Requirements**: DEPLOY-03, OPS-01, OPS-02, OPS-03
**Success Criteria** (what must be TRUE):
  1. An operator can query a liveness endpoint and a readiness endpoint that reports ready only once schema migrations have completed on boot.
  2. Restarting the service under load finishes in-flight writes before the process exits — no writes are dropped.
  3. Repeated failed logins and abusive request volume against auth and write endpoints are rate-limited rather than served unbounded.
  4. No long-lived plaintext admin credential lives in the host environment — the admin break-glass secret is managed (hashed at rest, rotatable), retiring the `ADMIN_TOKEN` stopgap.
  5. A user's session expires on idle and absolute timeout, an operator can list and revoke a user's active sessions, and cookies carry `Secure`/HSTS correctly on a real TLS origin.
**Plans**: TBD
**UI hint**: yes

### Phase 11: Deployment Shapes
**Goal**: An operator can stand the portal up in either of two shapes — a self-managed internal Linux host, or a container on TE-IT infrastructure — from shipped tooling and a documented config contract. Both shapes run in parallel over the Phase-10 readiness base.
**Depends on**: Phase 10 (both shapes depend on the DEPLOY-03 app-layer readiness base landing first)
**Requirements**: DEPLOY-01, DEPLOY-02
**Success Criteria** (what must be TRUE):
  1. An operator can install the portal on a self-managed Linux host as a managed service (service-manager unit, reverse proxy + TLS, graceful restart) following shipped docs.
  2. TE IT can run the portal from a shipped container image against a documented config contract (env vars, health/readiness endpoint, named `data/` volume, non-root user, `replicas: 1` constraint).
  3. An operator can take and restore a WAL-aware backup with the MNPI handling policy documented in the runbook.
  4. The MNPI boundary and demo/real separation survive packaging — the image carries no real deal data, refuses real-deal traffic without a persistent data volume, and never silently inherits `DEMO_OPEN=1`.
**Plans**: TBD

### Phase 12: Workstream-Lead Collaboration
**Goal**: Workstream leads join a live deal with the right clearances and collaborate safely — invited by the Integration Lead, revoked cleanly on change, with MNPI-safe presence and activity awareness.
**Depends on**: Phase 9 (collaboration on co-edited records needs optimistic locking first) and Phase 10 (extends the hardened session model)
**Requirements**: COLLAB-01, COLLAB-02, COLLAB-03, COLLAB-04
**Success Criteria** (what must be TRUE):
  1. An Integration Lead can invite and assign a workstream lead to a deal and set that person's per-area clearance grants.
  2. Changing a user's role or clearance grants takes effect on their already-open sessions (re-evaluated or revoked), not only at next login.
  3. A deal member sees a coarse presence signal — how many teammates are currently active on this deal — with no codename or who-is-where detail leaking beyond that count.
  4. A deal member sees a clearance-scoped team activity feed of recent changes, projected read-only from the existing append-only audit log (never a new logging path).
**Plans**: TBD
**UI hint**: yes

### Phase 13: Collaborative Deal-Setup Wizard
**Goal**: Two or more people can set up a deal together — onboarding workstream leads, handing off individual steps, and resuming shared in-progress state without clobbering each other.
**Depends on**: Phase 12 (COLLAB-01 invite/clearance model must land before the wizard collaboration steps)
**Requirements**: WIZ-02, WIZ-03, WIZ-04
**Success Criteria** (what must be TRUE):
  1. The deal-setup wizard has a workstream-lead onboarding step that assigns leads and their per-area clearance grants during setup.
  2. The Integration Lead can hand off an individual setup step to a different owner, so a partially-configured deal can be finished collaboratively rather than by one person.
  3. The wizard shows who completed which step and does not clobber when two people touch setup concurrently.
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:** Phases execute in numeric order: 8 → 9 → 10 → 11 → 12 → 13

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 8. Concurrency & Storage Foundation | v2.2.0 | 0/TBD | Not started | - |
| 9. Optimistic Locking & Conflict Recovery | v2.2.0 | 0/TBD | Not started | - |
| 10. Runtime Hardening & Deployment Readiness | v2.2.0 | 0/TBD | Not started | - |
| 11. Deployment Shapes | v2.2.0 | 0/TBD | Not started | - |
| 12. Workstream-Lead Collaboration | v2.2.0 | 0/TBD | Not started | - |
| 13. Collaborative Deal-Setup Wizard | v2.2.0 | 0/TBD | Not started | - |
