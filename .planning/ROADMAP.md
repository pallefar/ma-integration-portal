# Roadmap: M&A Integration Portal — Real-Deal Milestone

## Overview

This milestone turns the existing demo-shaped portal (v2.0.1) into a tool an Integration Lead runs a real TE acquisition on. It is a brownfield rebuild of the app's data and access foundations followed by the four capability gaps the current lifecycle-coverage analysis surfaced. Foundation work lands first, in a strict dependency chain: the file-store-to-SQLite migration (Phase 1) must exist before anything else can be built on top of it; mandatory authentication and roles (Phase 2) must exist before deal isolation can enforce who resolves to what; deal isolation, audit and write validation (Phase 3) is where "real data never shares a store with demo" is actually satisfied in code, not just policy. Only once that foundation is in place do the four capability areas build: Due Diligence workspace and Synergy Value Capture extend existing entities independently and can proceed in parallel; Org Design & Talent Retention is the most independent capability and the safest to trim if scope needs to shrink; IMO Reporting & Exports comes last because its rollups depend on DD and Synergy data existing first. The demonstration showcase (time-travel, gamification, multi-language CMS) is preserved throughout as a separate, cleanly-isolated mode — nothing in this milestone touches it except to make sure it can no longer reach real-deal data.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Schema & Migration** - Replace `db.json` with SQLite (WAL mode) via a re-runnable, verified migration
- [ ] **Phase 2: Mandatory Auth & Roles** - Promote `PORTAL_AUTH` to mandatory, with full route coverage and role enforcement
- [ ] **Phase 3: Deal Isolation, Audit Log & Write Validation** - File-per-deal isolation from demo data, an audit trail on every write, and schema validation on every write
- [ ] **Phase 4: Due Diligence Workspace** - DD request lists, findings register, and server-side clean-room access control
- [ ] **Phase 5: Synergy Value Capture** - Baseline, phasing, cost-to-achieve and confidence stage-gating on synergy initiatives
- [ ] **Phase 6: Org Design & Talent Retention** - Organisation structure, redundancy decisions, and a flight-risk register
- [ ] **Phase 7: IMO Reporting & Exports** - CSV/JSON data export and a generated steering-committee pack

## Phase Details

### Phase 1: Schema & Migration

**Goal**: All app data lives in SQLite (WAL mode), migrated from `db.json` through a verified, re-runnable process — nothing else in this milestone can be built until reads and writes go through SQLite.
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, FND-04
**Success Criteria** (what must be TRUE):

  1. Running the migration script against a snapshot of `db.json` produces a SQLite database whose contents are diffed and verified against the source before `db.json` is retired.
  2. The app reads and writes exclusively through SQLite (`better-sqlite3`, WAL mode) — no remaining code path reads or writes `db.json`.
  3. An automated concurrent-write test (two simultaneous writes to the same resource) completes with no lost update.
  4. All three release-zip bundles (any-OS, Windows, macOS) boot successfully with the correct native `better-sqlite3` binary vendored per platform.

**Plans**: 1/3 plans executed
**Wave 1**

- [x] 01-01-PLAN.md — Vendor better-sqlite3@13.0.1 (prebuilds + engines bump) and pre-empt .db leaks in .gitignore + admin download-zip (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 01-02-PLAN.md — Schema, re-runnable verified migration, SQLite readDb/writeDb cutover, and the round-trip + concurrent-write proofs (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 01-03-PLAN.md — Cross-platform bundle boot verification + reversible cutover archiving db.json (wave 3)

### Phase 2: Mandatory Auth & Roles

**Goal**: Every request to the app is authenticated, and every write enforces the caller's role — promoting the existing `PORTAL_AUTH` mechanism rather than building new authentication.
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04
**Success Criteria** (what must be TRUE):

  1. A request to any `/api/*` route — read or write — without a valid session is rejected, verified against a full, programmatically-generated inventory of every route (none left un-enumerated).
  2. A signed-in user attempting a write outside their role's permissions is rejected.
  3. A session can be revoked and expires on its own; a revoked or expired session immediately stops authorizing requests.
  4. Every server-side request handler can resolve the calling user's identity and role, for use by access decisions and the audit log in Phase 3.

**Plans**: TBD

### Phase 3: Deal Isolation, Audit Log & Write Validation

**Goal**: Real-deal data is physically isolated from demo data, every write to deal data is attributable and audited, and every write is schema-validated before it lands — this is where "real data never shares a store with demo" is actually enforced in code.
**Depends on**: Phase 1, Phase 2
**Requirements**: ISO-01, ISO-02, ISO-03, AUD-01, AUD-02, VAL-01, VAL-02
**Success Criteria** (what must be TRUE):

  1. A request resolves to exactly one database (a specific deal's `deals/<id>.db` file, or `demo.db`) before any handler touches data; two different deals' SQLite files contain no shared rows.
  2. Demo-only mechanics (time-travel day-scaling, XP/leaderboards) can only run against `demo.db` — invoking them against a deal session has no effect on that deal's data.
  3. Every write to deal data appears in an append-only audit log recording who, what, when, and before/after values; deleting a deal leaves its audit trail intact.
  4. A write with a malformed payload (wrong type, missing required field, over a length limit) is rejected with a clear error, on every write endpoint.
  5. Free-text and HTML-bearing fields round-trip through storage and render without executing injected script.

**Plans**: TBD

### Phase 4: Due Diligence Workspace

**Goal**: The IL can run due diligence inside the app, with pre-close information restricted to those with need-to-know.
**Depends on**: Phase 3
**Requirements**: DD-01, DD-02, DD-03, DD-04, DD-05
**Success Criteria** (what must be TRUE):

  1. The IL can create and manage a DD request list organized by functional area, each item carrying an owner, status and due date.
  2. The IL can record a DD finding (severity, functional area, owner) and convert it into a Day-1 integration task and/or RAID entry via the existing remediation linkage (`from-remediation`).
  3. A user without need-to-know for a functional area cannot read that area's DD requests or findings via a direct API call, even with a valid session — filtering happens server-side, and the denial itself is audited.
  4. A DD item can carry a reference link and access-grant record pointing at TE's existing VDR, without the app storing the document itself.

**Plans**: TBD

### Phase 5: Synergy Value Capture

**Goal**: Synergy tracking reflects a real, trusted value-capture program instead of a single target-vs-realized pair.
**Depends on**: Phase 3 (independent of Phase 4 — can execute in parallel)
**Requirements**: SYN-01, SYN-02, SYN-03, SYN-04, SYN-05
**Success Criteria** (what must be TRUE):

  1. A synergy initiative shows a baseline, a phased/ramped target over time, and realized value tracked period-by-period against that phasing.
  2. A synergy initiative records its cost-to-achieve alongside its target value.
  3. A synergy initiative moves through confidence stages (idea → validated → committed → captured), and its prior baseline is preserved — not overwritten — when values change.
  4. A synergy initiative can be linked to the integration task(s) that deliver it.
  5. An initiative that hasn't been confirmed recently is visibly flagged as stale rather than presented as current.

**Plans**: TBD

### Phase 6: Org Design & Talent Retention

**Goal**: The IL can represent the acquired organisation's structure and manage sensitive people decisions beyond the current flat employee list.
**Depends on**: Phase 4 (reuses the clean-room access-policy pattern established there rather than inventing a second one)
**Requirements**: ORG-01, ORG-02, ORG-03
**Success Criteria** (what must be TRUE):

  1. The IL can map roles (role, level, reports-to, mapped employee) for the acquired organisation, beyond the current flat employee list.
  2. The IL can record a role-selection or redundancy decision against a role or person.
  3. The IL can maintain a flight-risk register (risk level, owner, mitigation) that only authorized roles can read, with access to it audited.

**Plans**: TBD

### Phase 7: IMO Reporting & Exports

**Goal**: The IL can produce trustworthy status output — raw data exports and a formatted steerco pack — replacing manual deck assembly. Last by data dependency: its rollups need Phase 4 (DD) and Phase 5 (Synergy) data models to exist.
**Depends on**: Phase 4, Phase 5
**Requirements**: RPT-01, RPT-02, RPT-03, RPT-04
**Success Criteria** (what must be TRUE):

  1. The IL can export workstreams, tasks, RAID and synergies as both CSV and JSON.
  2. The IL can generate a formatted PDF steering-committee pack summarizing status across workstreams, tasks, RAID and synergies.
  3. The steerco pack reports synergy net benefit, cost-to-achieve and confidence-stage movement without double-counting any initiative.
  4. A status report visually distinguishes current from stale line items, using the staleness signals established in Phase 5.

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 (Phases 4 and 5 may execute in parallel; both depend only on Phase 3)

| Phase | Plans Complete | Status | Completed |
|-------|-----------------|--------|-----------|
| 1. Schema & Migration | 1/3 | In Progress|  |
| 2. Mandatory Auth & Roles | 0/TBD | Not started | - |
| 3. Deal Isolation, Audit Log & Write Validation | 0/TBD | Not started | - |
| 4. Due Diligence Workspace | 0/TBD | Not started | - |
| 5. Synergy Value Capture | 0/TBD | Not started | - |
| 6. Org Design & Talent Retention | 0/TBD | Not started | - |
| 7. IMO Reporting & Exports | 0/TBD | Not started | - |
