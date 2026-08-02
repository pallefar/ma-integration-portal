# Roadmap: M&A Integration Portal — Real-Deal Milestone

## Overview

This milestone turns the existing demo-shaped portal (v2.0.1) into a tool an Integration Lead runs a real TE acquisition on. It is a brownfield rebuild of the app's data and access foundations followed by the four capability gaps the current lifecycle-coverage analysis surfaced. Foundation work lands first, in a strict dependency chain: the file-store-to-SQLite migration (Phase 1) must exist before anything else can be built on top of it; mandatory authentication and roles (Phase 2) must exist before deal isolation can enforce who resolves to what; deal isolation, audit and write validation (Phase 3) is where "real data never shares a store with demo" is actually satisfied in code, not just policy. Only once that foundation is in place do the four capability areas build: Due Diligence workspace and Synergy Value Capture extend existing entities independently and can proceed in parallel; Org Design & Talent Retention is the most independent capability and the safest to trim if scope needs to shrink; IMO Reporting & Exports comes last because its rollups depend on DD and Synergy data existing first. The demonstration showcase (time-travel, gamification, multi-language CMS) is preserved throughout as a separate, cleanly-isolated mode — nothing in this milestone touches it except to make sure it can no longer reach real-deal data.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Schema & Migration** - Replace `db.json` with SQLite (WAL mode) via a re-runnable, verified migration
- [x] **Phase 2: Mandatory Auth & Roles** - Promote `PORTAL_AUTH` to mandatory, with full route coverage and role enforcement (completed 2026-07-31)
- [x] **Phase 3: Deal Isolation, Audit Log & Write Validation** - File-per-deal isolation from demo data, an audit trail on every write, and schema validation on every write (completed 2026-08-02)
- [ ] **Phase 4: Due Diligence Workspace** - New-deal setup wizard (guided onboarding incl. readiness assessments), DD request lists, findings register, and server-side clean-room access control
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

**Plans**: 3/3 plans executed
**Wave 1**

- [x] 01-01-PLAN.md — Vendor better-sqlite3@13.0.1 (prebuilds + engines bump) and pre-empt .db leaks in .gitignore + admin download-zip (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Schema, re-runnable verified migration, SQLite readDb/writeDb cutover, and the round-trip + concurrent-write proofs (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Cross-platform bundle boot verification + reversible cutover archiving db.json (wave 3)

### Phase 2: Mandatory Auth & Roles

**Goal**: Every request to the app is authenticated, and every write enforces the caller's role — promoting the existing `PORTAL_AUTH` mechanism rather than building new authentication.
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04
**Success Criteria** (what must be TRUE):

  1. A request to any `/api/*` route — read or write — without a valid session is rejected, verified against a full, programmatically-generated inventory of every route (none left un-enumerated).
  2. A signed-in user attempting a write outside their role's permissions is rejected.
  3. A session can be revoked and expires on its own; a revoked or expired session immediately stops authorizing requests.
  4. Every server-side request handler can resolve the calling user's identity and role, for use by access decisions and the audit log in Phase 3.

**Plans**: 3/3 plans executed

**Wave 1**

- [x] 02-01-PLAN.md — Requireable server + sessions table + consolidated fail-closed gate (tracer) and session revoke/expire proofs (AUTH-01/03/04)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — Coarse ROLE_WRITE_POLICY, break-glass identity, employee seed, self password-change + first-run admin secret (AUTH-02/03/04)
- [x] 02-03-PLAN.md — Client fail-closed redirect-to-login + demo-open launchers (AUTH-01 UX) — parallel with 02-02

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

**Plans**: 6/6 plans executed

**Wave 1**

- [x] 03-01-PLAN.md — zod package-legitimacy gate + pinned install, runtime/audit/deal `.db` leak pre-emption in git and download-zip, and the control/runtime/audit schemas (ISO-01, AUD-02, VAL-01)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-02-PLAN.md — one-way split gate, the control/demo/runtime fan-out migration with a `--verify` union-parity check, and the template-only deal seeder (ISO-01, ISO-02)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-03-PLAN.md — session-bound deal resolver (tracer), cutover to the split stores, and demo-only mechanic hard-gating (ISO-01, ISO-02, ISO-03)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 03-04-PLAN.md — deal registry API, membership + destructive-guarded archive/delete, and the header deal switcher (ISO-01, ISO-03)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 03-05-PLAN.md — store-layer audit hook into a separate append-only audit.db, control-plane security events, and the admin audit viewer (AUD-01, AUD-02)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 03-06-PLAN.md — zod validation pipeline across every registered write route plus write-time HTML sanitization (VAL-01, VAL-02)

### Phase 4: Due Diligence Workspace

**Goal**: A new deal enters the app through a guided setup wizard (basics, team, readiness assessments, scope, timeline), and the IL can run due diligence inside it, with pre-close information restricted to those with need-to-know.
**Depends on**: Phase 3
**Requirements**: DD-01, DD-02, DD-03, DD-04, DD-05, WIZ-01 (new-deal setup wizard — user request 2026-08-02, see .planning/todos/pending/new-deal-setup-wizard.md)
**Success Criteria** (what must be TRUE):

  0. Creating a new deal walks through the setup wizard — deal basics, member allowlist, readiness-assessment kickoff (acquirer + target + IL instances with owners/dates), workstream scope, and timeline markers — and every wizard write flows through the Phase-3 validation and audit pipeline.
  1. The IL can create and manage a DD request list organized by functional area, each item carrying an owner, status and due date.
  2. The IL can record a DD finding (severity, functional area, owner) and convert it into a Day-1 integration task and/or RAID entry via the existing remediation linkage (`from-remediation`).
  3. A user without need-to-know for a functional area cannot read that area's DD requests or findings via a direct API call, even with a valid session — filtering happens server-side, and the denial itself is audited.
  4. A DD item can carry a reference link and access-grant record pointing at TE's existing VDR, without the app storing the document itself.

**Plans**: 6/8 plans executed

Plans:

**Wave 1**

- [x] 04-01-PLAN.md — DD data spine + clean-room need-to-know filter (tracer: an IL creates a Legal request item, an uncleared member sees nothing, the denial is audited) (DD-01, DD-04)

**Wave 2** *(blocked on Wave 1)*

- [x] 04-02-PLAN.md — per-deal area grants control plane, admin grants editor, and the additive memberGrants regression proof (DD-04)

**Wave 3** *(blocked on Wave 2)*

- [x] 04-03-PLAN.md — seeded 80-item standard DD request checklist + clearance-scoped instantiate (DD-01)

**Wave 4** *(blocked on Wave 3)*

- [x] 04-04-PLAN.md — findings register, four-level RAID severity, one-click bidirectional conversion (DD-02, DD-03)

**Wave 5** *(blocked on Wave 4)*

- [x] 04-05-PLAN.md — VDR link-outs per request item + audited data-room access-grant records, no document storage (DD-05)

**Wave 6** *(blocked on Wave 5)*

- [x] 04-06-PLAN.md — pending readiness-assessment instances + create-early wizard backend and setup state (WIZ-01)

**Wave 7** *(blocked on Wave 6)*

- [ ] 04-07-PLAN.md — full-page seven-step new-deal setup wizard, validate-on-advance, switcher repointed (WIZ-01)

**Wave 8** *(blocked on Wave 7)*

- [ ] 04-08-PLAN.md — deal home (setup checklist, readiness completion, DD progress with overdue rollup) + in-app owner nudges (DD-01, DD-02, WIZ-01)

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
| 1. Schema & Migration | 3/3 | In Progress|  |
| 2. Mandatory Auth & Roles | 3/3 | Complete    | 2026-07-31 |
| 3. Deal Isolation, Audit Log & Write Validation | 6/6 | Complete    | 2026-08-02 |
| 4. Due Diligence Workspace | 6/8 | In Progress|  |
| 5. Synergy Value Capture | 0/TBD | Not started | - |
| 6. Org Design & Talent Retention | 0/TBD | Not started | - |
| 7. IMO Reporting & Exports | 0/TBD | Not started | - |
