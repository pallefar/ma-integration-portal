# Requirements: v2.2.0 Shared-Host Multi-User

Scoped requirements for the v2.2.0 milestone — moving the portal from laptop-local to a shared internal host where the Integration Lead and workstream leads collaborate on one live deal concurrently, conflict-safe and operationally hardened, deployable across three shapes, with collaborative deal-setup wizard enhancements. Grounded in `.planning/research/SUMMARY.md`.

**Architecture decision (research-settled, all sources converged):** stay on SQLite; concurrency safety via native multi-process WAL write-serialization (Option B), not a broker or Postgres. Host-local, `replicas: 1`. Postgres deferred to a possible v3.0 only if true multi-host horizontal scaling is ever required.

## v1 Requirements

### Concurrency & Data Safety (CONC)

- [x] **CONC-01**: Concurrent writers — whether overlapping requests in one process or separate processes on the same host — serialize safely with no lost updates, via immediate write transactions and busy-retry (SQLite WAL cross-process locking; the Option-B storage-layer change).
- [x] **CONC-02**: A user whose edit to a co-edited record (RAID entry, integration task, DD finding, synergy initiative, org decision) is based on stale data has that write rejected with a 409, and the UI offers a reload-and-reapply path rather than silently clobbering — optimistic locking enforced in the SQL WHERE clause (version carried in the record's JSON blob).

### Deployment (DEPLOY)

- [ ] **DEPLOY-01**: An operator can stand up the portal on a self-managed internal Linux host as a managed service — a service-manager unit, reverse-proxy + TLS guidance, backup and restore tooling, and graceful shutdown — following shipped tooling and docs.
- [ ] **DEPLOY-02**: The portal ships a container image and a documented config contract (env vars, health/readiness endpoint, named volume for `data/`, non-root user, `.dockerignore` mirroring the MNPI boundary, the `replicas: 1` constraint) so TE IT can run it on their platform.
- [ ] **DEPLOY-03**: Across all deployment shapes the app exposes health and readiness endpoints, drains in-flight writes on graceful shutdown, and runs its schema migration on boot — the common app-layer readiness base.

### Operational Hardening (OPS)

- [ ] **OPS-01**: Authentication and write endpoints are rate-limited so a shared-host deployment resists brute-force and abusive request volume.
- [ ] **OPS-02**: The `ADMIN_TOKEN`-in-env break-glass stopgap is retired in favor of a managed admin secret (hashed at rest, rotatable), so no long-lived plaintext admin credential lives in the host environment.
- [ ] **OPS-03**: Sessions are hardened for a shared multi-user host — idle and absolute timeout, the operator can see and revoke a user's active sessions, and the `Secure`/HSTS cookie contract is correct on a real TLS origin and documented in the deployment checklist.

### Collaboration (COLLAB)

- [ ] **COLLAB-01**: An Integration Lead can invite and assign a workstream lead to a deal and set that person's per-area clearance grants, as a thin flow over the existing `accessPolicy` area-grant model.
- [ ] **COLLAB-02**: A change to a user's role or clearance grants takes effect on their already-open sessions (re-evaluated or revoked), not only at next login — extending the existing membership-removal auto-revoke precedent.
- [ ] **COLLAB-03**: A deal member can see a coarse, MNPI-safe presence signal — how many teammates are currently active on this deal — without leaking a codename or who-is-where beyond that count.
- [ ] **COLLAB-04**: A deal member can see a team activity feed of recent changes, as a read-side projection of the existing append-only `audit.db` (clearance-scoped; never a new logging path).

### Wizard Enhancements (WIZ)

- [ ] **WIZ-02**: The deal-setup wizard has a workstream-lead onboarding step — assigning leads and their per-area clearance grants during setup.
- [ ] **WIZ-03**: The Integration Lead can hand off individual deal-setup steps to different owners, so a partially-configured deal can be completed collaboratively rather than by one person.
- [ ] **WIZ-04**: The wizard's in-progress state is multi-user-aware — it shows who completed which step and does not clobber when two people touch setup concurrently.

## Future Requirements (deferred)

- Multi-host horizontal scaling (multiple replicas across hosts) — would revive the single-writer-broker or Postgres options; deferred until evidence a single shared host is insufficient.
- Postgres / client-server database backend — a possible v3.0 dual-backend (SQLite for demo, Postgres for real-deal) only if multi-host scaling is required; breaks the zero-install turnkey-zip model, so deliberately out of this milestone.
- Real-time co-editing (CRDT/OT, live cursors, typing indicators) — anti-feature for a ~15-person deal team; optimistic locking + coarse presence is the deliberate ceiling.
- Vendoring the AI-Insight model weights / completing the client-side XSS sink-class audit — carried debts from v2.1.0, not part of the shared-host theme.

## Out of Scope

- TE SSO (SAML/OIDC) and HRIS integration — still app-managed accounts this milestone; a separate identity-integration milestone.
- SQLCipher / application-level at-rest encryption — MNPI at-rest protection remains OS full-disk encryption + documented policy; noted as later hardening.
- Network-filesystem-mounted SQLite — explicitly unsafe with WAL; the DB stays on local disk (a hard constraint of the Option-B architecture, not a feature to build).
- Postgres migration in this milestone (see Future).

## Traceability

All 15 v1 requirements mapped to exactly one phase. Coverage: 15/15.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONC-01 | Phase 8 | Complete |
| CONC-02 | Phase 9 | Complete |
| DEPLOY-03 | Phase 10 | Pending |
| OPS-01 | Phase 10 | Pending |
| OPS-02 | Phase 10 | Pending |
| OPS-03 | Phase 10 | Pending |
| DEPLOY-01 | Phase 11 | Pending |
| DEPLOY-02 | Phase 11 | Pending |
| COLLAB-01 | Phase 12 | Pending |
| COLLAB-02 | Phase 12 | Pending |
| COLLAB-03 | Phase 12 | Pending |
| COLLAB-04 | Phase 12 | Pending |
| WIZ-02 | Phase 13 | Pending |
| WIZ-03 | Phase 13 | Pending |
| WIZ-04 | Phase 13 | Pending |
