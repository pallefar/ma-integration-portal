# Requirements: M&A Integration Portal — Real-Deal Milestone

**Defined:** 2026-07-23
**Core Value:** An Integration Lead can run one real TE acquisition end-to-end in this app — from due diligence through 100 days — without keeping a parallel spreadsheet.

> Brownfield milestone. The existing app (v2.0.1) already delivers the people-integration surface; those capabilities are recorded as **Validated** in PROJECT.md and are not re-listed here. The v1 requirements below are only the *new* work this milestone commits to. Requirement categories and the foundation build order (F0→F3) are derived from `.planning/research/SUMMARY.md`.

## v1 Requirements

### Foundation — Persistence (F0)

- [x] **FND-01**: A re-runnable, diffable migration copies all existing `db.json` data into SQLite, with the source verified against the result before the file store is retired
- [x] **FND-02**: The app reads and writes all data through SQLite (`better-sqlite3`, WAL mode) instead of `db.json`
- [x] **FND-03**: Concurrent writes never lose data (no lost-update race), verified by a concurrent-write test
- [x] **FND-04**: The zero-install Windows/macOS/any-OS bundles run against SQLite with the correct native binary vendored per platform (same precedent as the committed canvas binaries)

### Foundation — Authentication & Access (F1)

- [x] **AUTH-01**: Authentication is mandatory — no `/api/*` endpoint serves data or accepts a write without a valid authenticated session (verified against a full route inventory, read endpoints included)
- [x] **AUTH-02**: Every write endpoint enforces the caller's role, rejecting actions outside that role
- [x] **AUTH-03**: Sessions are revocable and expire, backed by a `sessions` table; passwords are stored hashed (existing `scryptSync`) with `SameSite=Strict` session cookies
- [x] **AUTH-04**: A signed-in user's role and identity are resolvable server-side on every request for audit and access decisions

### Foundation — Deal Isolation & Audit (F2)

- [ ] **ISO-01**: Real-deal data is stored in a separate SQLite file per deal (`deals/<id>.db`), physically separate from demo data (`demo.db`) and shared control data (`control.db`)
- [ ] **ISO-02**: Demo-only mechanics (time-travel day-scaling, XP/leaderboards, gamification) cannot read or mutate any real-deal database
- [ ] **ISO-03**: A request is resolved to exactly one deal (or demo) database before any handler touches data, replacing the current `demoMode`-flag + shadow-array project-switch mechanism
- [ ] **AUD-01**: Every write to deal data is recorded in an append-only audit log capturing who, what, when, and before/after values
- [ ] **AUD-02**: The audit log survives deletion of the deal it describes

### Foundation — Validation (F3)

- [ ] **VAL-01**: Every write endpoint validates its input against a schema (type, required fields, length limits) and rejects malformed requests with a clear error
- [ ] **VAL-02**: Free-text and HTML-bearing fields are sanitized before storage or render, closing the documented XSS gaps

### Due Diligence Workspace

- [ ] **DD-01**: The IL can create and manage DD request lists organized by functional area, each item with an owner, status and due date
- [ ] **DD-02**: The IL can record DD findings, each with severity, functional area and owner
- [ ] **DD-03**: A DD finding can be converted into a Day-1 integration task and/or a RAID entry, reusing the existing remediation linkage (`from-remediation`)
- [ ] **DD-04**: DD content is clean-room restricted — only users with need-to-know for a functional area can read its request items and findings, enforced server-side (not just hidden in the UI), with access decisions audited
- [ ] **DD-05**: DD document exchange links out to TE's existing VDR; the app records the reference and access grant, and does not store the documents themselves

### Synergy Value Capture

- [ ] **SYN-01**: A synergy initiative carries a baseline, a phased/ramped target over time, and realized value tracked against that phasing (not a single target-vs-realized pair)
- [ ] **SYN-02**: A synergy initiative records its cost-to-achieve alongside its target value
- [ ] **SYN-03**: A synergy initiative moves through confidence stage-gates (idea → validated → committed → captured), with baseline history preserved when values change
- [ ] **SYN-04**: A synergy initiative can be linked to the integration task(s) that deliver it
- [ ] **SYN-05**: Synergy status carries a staleness signal so an un-updated initiative is visibly flagged rather than silently trusted

### IMO Reporting & Exports

- [ ] **RPT-01**: The IL can export raw data (workstreams, tasks, RAID, synergies) as CSV and JSON — closing the current "no export at all" gap
- [ ] **RPT-02**: The IL can generate a formatted PDF steering-committee pack summarizing status across workstreams, tasks, RAID and synergies
- [ ] **RPT-03**: The steerco pack reports synergy net benefit, cost-to-achieve and confidence-stage movement, avoiding double-counting across initiatives
- [ ] **RPT-04**: A status report distinguishes current from stale data using the staleness signals (SYN-05 and equivalents)

### Org Design & Talent Retention

- [ ] **ORG-01**: The IL can represent the acquired organisation's structure and map roles beyond the current flat employee list
- [ ] **ORG-02**: The IL can record role-selection / redundancy decisions against roles or people
- [ ] **ORG-03**: The IL can maintain a key-talent flight-risk register (risk level, owner, mitigation), restricted to authorized roles and audited as sensitive data

## v2 Requirements

Deferred — acknowledged but not in this milestone's roadmap.

### Shared Host

- **HOST-01**: The app runs on a shared internal host with workstream leads signing in directly
- **HOST-02**: Multi-process / network-filesystem SQLite behavior is tested and hardened
- **HOST-03**: TE SSO (SAML/OIDC) replaces app-managed accounts

### Later Hardening

- **HARD-01**: SQLCipher application-level at-rest encryption of deal databases
- **HARD-02**: Automated test suite covering migration, auth coverage, deal isolation and gamification scoring
- **HARD-03**: Refactor of the monolithic frontend files surfaced during this milestone's module splits

## Out of Scope

Explicitly excluded. Documented to prevent scope creep. (Anti-features corroborated by `.planning/research/FEATURES.md`.)

| Feature | Reason |
|---------|--------|
| Deal sourcing / target screening / valuation | Post-deal integration tool, not deal origination; Acquisition Radar stays a static showcase piece |
| Multi-tenant / white-label | TE-internal only; no tenant isolation or de-branding |
| TE SSO & HRIS/Workday/SAP integration | App-managed accounts only this milestone; deferred to shared-host milestone (v2 HOST-03) |
| TSA / carve-out tracking | Only relevant for divestitures, not the target use case |
| Post-close review / lookback | Milestone ends at 100 days |
| Portfolio view across simultaneous deals | Single-active-deal while the operator is a single IL |
| Document storage / VDR in DD workspace | TE licenses a VDR; DD links out rather than storing documents (DD-05) |
| PPTX steerco-pack generation | Export is CSV/JSON + PDF only; PPTX is disproportionate for a laptop tool |
| SQLCipher / app-level at-rest encryption | Relies on OS full-disk encryption + documented policy; deferred to later hardening (v2 HARD-01) |
| Full VDR with document ACLs, external counterparty logins | Duplicates a tool TE already licenses (FEATURES.md anti-feature) |
| Automated ML flight-risk scoring | Disproportionate; ORG-03 is a manual register |
| Compensation / severance engine | Out of tool scope; ORG-02 records decisions only |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 1: Schema & Migration | Complete |
| FND-02 | Phase 1: Schema & Migration | Complete |
| FND-03 | Phase 1: Schema & Migration | Complete |
| FND-04 | Phase 1: Schema & Migration | Complete |
| AUTH-01 | Phase 2: Mandatory Auth & Roles | Complete |
| AUTH-02 | Phase 2: Mandatory Auth & Roles | Complete |
| AUTH-03 | Phase 2: Mandatory Auth & Roles | Complete |
| AUTH-04 | Phase 2: Mandatory Auth & Roles | Complete |
| ISO-01 | Phase 3: Deal Isolation, Audit Log & Write Validation | Pending |
| ISO-02 | Phase 3: Deal Isolation, Audit Log & Write Validation | Pending |
| ISO-03 | Phase 3: Deal Isolation, Audit Log & Write Validation | Pending |
| AUD-01 | Phase 3: Deal Isolation, Audit Log & Write Validation | Pending |
| AUD-02 | Phase 3: Deal Isolation, Audit Log & Write Validation | Pending |
| VAL-01 | Phase 3: Deal Isolation, Audit Log & Write Validation | Pending |
| VAL-02 | Phase 3: Deal Isolation, Audit Log & Write Validation | Pending |
| DD-01 | Phase 4: Due Diligence Workspace | Pending |
| DD-02 | Phase 4: Due Diligence Workspace | Pending |
| DD-03 | Phase 4: Due Diligence Workspace | Pending |
| DD-04 | Phase 4: Due Diligence Workspace | Pending |
| DD-05 | Phase 4: Due Diligence Workspace | Pending |
| SYN-01 | Phase 5: Synergy Value Capture | Pending |
| SYN-02 | Phase 5: Synergy Value Capture | Pending |
| SYN-03 | Phase 5: Synergy Value Capture | Pending |
| SYN-04 | Phase 5: Synergy Value Capture | Pending |
| SYN-05 | Phase 5: Synergy Value Capture | Pending |
| ORG-01 | Phase 6: Org Design & Talent Retention | Pending |
| ORG-02 | Phase 6: Org Design & Talent Retention | Pending |
| ORG-03 | Phase 6: Org Design & Talent Retention | Pending |
| RPT-01 | Phase 7: IMO Reporting & Exports | Pending |
| RPT-02 | Phase 7: IMO Reporting & Exports | Pending |
| RPT-03 | Phase 7: IMO Reporting & Exports | Pending |
| RPT-04 | Phase 7: IMO Reporting & Exports | Pending |

**Coverage:**

- v1 requirements: 32 total (corrected from an earlier "30" placeholder — a direct count of unique v1 requirement IDs in this document is 32: FND×4, AUTH×4, ISO×3, AUD×2, VAL×2, DD×5, SYN×5, RPT×4, ORG×3)
- Mapped to phases: 32/32 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-23*
*Last updated: 2026-07-23 after roadmap creation — traceability populated, coverage count corrected to 32*
