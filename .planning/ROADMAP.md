# Roadmap: M&A Integration Portal

## Milestones

- ✅ **v2.1.0 — Real-Deal** — Phases 1–7 (shipped 2026-08-10)
- 🚧 **v3.0 — Production-Ready** — Phases 8–23 (in progress; absorbs the never-released v2.2.0 Shared-Host Multi-User milestone)

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

### 🚧 v3.0 Production-Ready (Phases 8–23) — IN PROGRESS

**Milestone Goal:** Make the portal genuinely production-ready on a shared internal host holding
MNPI — real accounts and authorization, a data layer that scales with the deal, content and file
safety, an **admin who can switch parts of the app off** (server-enforced, deal-aware), and the
**Integration Leader as the key persona** (a cockpit and execution tooling that remove the
spreadsheet fallbacks) — then hardened operations, deployable shapes, collaboration, and an
independent certification. Origin: the 2026-10-10 seven-lane review in `.planning/reviews/v3.0/`
(SUMMARY.md maps every finding to a phase; PLAN-REVIEW.md's amendments are applied). Phases 8–9 were
built under the unreleased v2.2.0 label and carry over. Architecture stays SQLite / host-local WAL /
`replicas: 1`; the zero-install turnkey model and the demo showcase both survive. **Mode contract:**
real-deal mode is explicit (`MA_MODE=real`) on its own gitignored data directory (see
REQUIREMENTS.md). Every phase gets a threat model at plan time and a Fable verification; every UI
phase adds its pages to the browser smoke harness (Phase 12 onward) and is judged on multi-width
screenshots. *Optional internal pilot checkpoint after Phase 16 (plain tag, no release).*

- [x] **Phase 8: Concurrency & Storage Foundation** — Serialize concurrent writers with zero lost updates — CONC-01 (completed 2026-08-11)
- [ ] **Phase 9: Optimistic Locking & Conflict Recovery** — Stale writes caught (409) and recoverable; **gap closure** for the R7 findings — CONC-02
- [ ] **Phase 10: Accounts & Identity** — Real people with real accounts; explicit real-deal mode; no published credentials — ACCT-01..07, COLLAB-02, OPS-08
- [ ] **Phase 11: Authorization & Clean-Room Closure** — Every read and write authorized for who the caller is — AUTHZ-01..05
- [ ] **Phase 12: Data-Layer Integrity & Performance** — Writes/audit proportional to change; versioned schemas; trustworthy tests — DATA-01..06, QUAL-01/02
- [ ] **Phase 13: Content Safety** — User content can't run code in another session — SAFE-01/02/03/06/07
- [ ] **Phase 14: Deal Files, Limits & Legacy Hazards** — Files stay inside the deal boundary; limits and legacy hazards closed — SAFE-04/05/08
- [ ] **Phase 15: Module Control — Core** — Registry, server-side gate, page guard, coverage gate, break-glass CLI — MOD-01/02/07/08
- [ ] **Phase 16: Module Control — Surfaces, Per-Deal & Defaults** — Every surface honours the switch; per-deal override; real-deal default — MOD-03/04/05/06
- [ ] **Phase 17: IL Cockpit & Real-Deal Shell** — The IL lands in a tool built for her deal — IL-01..07
- [ ] **Phase 18: IL Execution Tooling & Reporting** — Plan, assign, decide, retain and report without a spreadsheet — IL-08..18
- [ ] **Phase 19: Real-Deal Surfaces — Language, Accessibility, Mobile** — Four languages, keyboard/screen-reader usable, phone-fit — UX-01..04
- [ ] **Phase 20: Runtime Hardening & Operability** — Validated config, readiness, graceful stops, logs, limits — OPS-01..07
- [ ] **Phase 21: Deployment Shapes & Release Engineering** — Self-managed host + container + reproducible release — DEPLOY-01..03, REL-01/02
- [ ] **Phase 22: Workstream-Lead Collaboration & Collaborative Setup** — Invite, clear, see activity; set a deal up together — COLLAB-01/03/04, WIZ-02..04
- [ ] **Phase 23: Production Certification** — Independent adversarial proof; release staged for the user's go — CERT-01..06

## Phase Details

### Phase 8: Concurrency & Storage Foundation

**Goal**: Concurrent writers on one shared host serialize safely with zero lost updates — the Option-B storage-layer change that gates the whole milestone.
**Depends on**: Nothing (builds on the v2.1.0 SQLite/WAL layer)
**Requirements**: CONC-01
**Success Criteria** (what must be TRUE):

  1. Two or more processes (or overlapping in-process requests) writing the same deal's records concurrently all persist — no write silently overwrites another, proven by a multi-process soak test.
  2. Under write contention a losing writer gets a clear, bounded retry signal (busy-retry → `503 Retry-After`) rather than a corrupt, partial, or hung write.
  3. The demo showcase still boots and behaves identically, and the zero-install committed-DB turnkey bundle still runs with no install step, after the storage-layer change.

**Plans**: 5/5 plans executed (3 waves) — complete

### Phase 9: Optimistic Locking & Conflict Recovery

**Goal**: When two people edit the same record, the second save is caught and safely recoverable instead of silently overwriting the first — including the very first co-edit of a record nobody has edited yet.
**Depends on**: Phase 8
**Requirements**: CONC-02
**Success Criteria** (what must be TRUE):

  1. A user saving an edit to a co-edited record (RAID entry, integration task, DD finding, synergy initiative, org decision) based on stale data has that write rejected with a 409 rather than clobbering the newer version.
  2. On a 409 the user sees a reload-and-reapply path that preserves their in-progress edit instead of discarding it.
  3. Two users editing different records concurrently both save successfully — the lock bites only on the same record, not the whole collection.
  4. **(gap, R7 F-1)** The first concurrent edit of a never-edited record is caught — a client holding a version-less record sends a precondition (`version: 0`) and gets the 409; in real-deal mode a versioned update with no precondition is refused (400).
  5. **(gap, R7 F-2)** After "Apply my changes anyway" or "Delete anyway" the page shows the server's resulting state — no false self-conflict, no deleted row left on screen, no DD refresh under the open dialog.
  6. **(gap, R7 F-3/F-4/F-5/F-7)** The dialog tells the truth: a diff for payloads that don't mirror record fields, clearance-aware copy and the real 4xx reason for a withheld record, display labels instead of raw keys, no contradictory attribution on a deleted record.
  7. **(gap, R7 F-6)** A stale delete is one in-app prompt — the native `confirm()` is replaced by an in-app confirm that becomes the conflict dialog on a 409 (or the UI-SPEC row is re-worded); the decision is recorded.
  8. **(gap, R5-03)** Every `public/js|css` file changed since v2.1.0 carries a new `?v=` stamp and `login.html` loads the current `style.css` stamp.
  9. **(gap, R7 docs)** The 09-01 truth list gains per-record, client-precondition and 409-clearance truths (each with a test); the 09-UI-SPEC Copywriting Contract lists the deleted-variant literals; the UAT item-2 expectation is corrected; WINDOWS.md records the org position-edit gap.

**Plans**: 7/7 original plans executed + 9 gap-closure plans (09-08..09-16, 6 waves) planned and checker-passed — execute with `/gsd-execute-phase 9 --gaps-only`

- [x] 09-01-PLAN.md
- [x] 09-02-PLAN.md
- [x] 09-03-PLAN.md
- [x] 09-04-PLAN.md
- [x] 09-05-PLAN.md
- [x] 09-06-PLAN.md
- [x] 09-07-PLAN.md
- [x] 09-08-PLAN.md
- [ ] 09-09-PLAN.md
- [ ] 09-10-PLAN.md
- [ ] 09-11-PLAN.md
- [ ] 09-12-PLAN.md
- [ ] 09-13-PLAN.md
- [ ] 09-14-PLAN.md
- [ ] 09-15-PLAN.md
- [ ] 09-16-PLAN.md

**UI hint**: yes

### Phase 10: Accounts & Identity

**Goal**: Real people can be given real accounts and a real-deal host cannot run on published credentials — the first half of the trust foundation, and the mode contract everything else relies on.
**Depends on**: Phase 9
**Requirements**: ACCT-01, ACCT-02, ACCT-03, ACCT-04, ACCT-05, ACCT-06, ACCT-07, COLLAB-02, OPS-08
**Success Criteria** (what must be TRUE):

  1. An admin creates, disables and re-enables users, sets roles and resets passwords from the console; a disable or role change takes effect on that user's next request; every action is in the audit trail.
  2. A real-deal host with no users is bootstrapped to a first admin by a CLI run as the service user; `start-real-deal.*` boots `MA_MODE=real` on its own gitignored data directory seeded without demo accounts, and `git status` stays clean after real-deal use (committed `control.db`/`demo.db` never written).
  3. In real-deal mode no account verifies the published demo password, the server refuses to serve beyond login/change-password if one does, and the login page shows demo credentials only in demo-open mode; creating a real deal against the committed control DB path is refused outside real-deal mode.
  4. Eight wrong passwords from one user do not lock out a colleague behind the same proxy; temporary passwords force a change at first login; stored hashes upgrade transparently; any user changes their password and ends their own sessions from the UI.
  5. New database files are `0600` in a `0700` directory under any umask.

**Plans**: TBD — plan as two waves: (A) mode contract + data dir + bootstrap + demo-credential lockdown; (B) user CRUD, sessions, throttle/hash, UI.
**UI hint**: yes

### Phase 11: Authorization & Clean-Room Closure

**Goal**: Every read and write is authorized for who the caller is — no `pmo`-writable configuration, no clean-room hole on tasks and RAID, no GET that mutates.
**Depends on**: Phase 10 (accounts and real-deal mode), Phase 9 (409 bodies are re-filtered here)
**Requirements**: AUTHZ-01, AUTHZ-02, AUTHZ-03, AUTHZ-04, AUTHZ-05
**Success Criteria** (what must be TRUE):

  1. Every `/api` read route has a declared role policy and an unlisted route fails the coverage test; an `employee` session in a real deal is refused synergy financials, RAID, tasks, roster, communications, pulses and org data.
  2. `pmo`/`hrbp` sessions cannot write instance settings, menus, pages, banners, slides, media, i18n or AI keys; the IL's deal-level settings (currency, synergy target, Day-1 date) are written through the deal's own setup route.
  3. A deal member outside a record's clearance area gets "not found" — never a body, a 409 echo or a silent overwrite — on read, update, status-flip and delete of tasks and RAID; no GET route changes state.
  4. Every 401/403 and clearance-404 appears as a rate-bounded security event with actor, route and reason.

**Plans**: TBD
**UI hint**: no

### Phase 12: Data-Layer Integrity & Performance

**Goal**: Writes and audit rows are proportional to what changed and reads to what was asked; schemas evolve safely; the audit has a retention model; heavy CPU work cannot freeze the portal; the test suite is a signal you can trust and the UI has a smoke net.
**Depends on**: Phase 11 (authz/audit semantics land first; tests extended)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, QUAL-01, QUAL-02
**Success Criteria** (what must be TRUE):

  1. On the 1,000-task / 5,000-RAID deal one created record appends exactly one audit row and median write latency is ≤ 40 ms (baseline 86–97 ms, 6,220 rows).
  2. RAID and task lists page and filter server-side, the DD workspace loads in one request, 10 users × 3 list reads hit p95 ≤ 300 ms, and event-loop p99 stays ≤ 100 ms under the 40-client review profile.
  3. Every database file reports a schema version; a seeded old-version file (including the legacy single audit file) migrates at boot; a deliberately broken migration keeps the instance not-ready.
  4. Deal audit lives in hash-chained per-deal partitions; sealing records a SHA-256 control-plane event and makes the file read-only; the chain verifies by CLI; purge is refused without a sealed export and the retention period; the admin viewer reads across partitions.
  5. Requesting the steerco pack leaves other requests' event-loop p99 ≤ 50 ms and a second concurrent request is refused or queued.
  6. Twenty consecutive full-suite runs pass; no test writes `data/audit.db` or `data/runtime.db`; a changed client asset without a bumped stamp fails the suite; a GitHub Actions workflow runs the suite on ubuntu + windows.
  7. `npm run soak` (0 lost, 0 committed-but-unaudited) and the Phase 9 contract suite pass unchanged; reorders persist via sequence without audit rows.
  8. One command runs the browser smoke harness (real browser + axe) over the first IL pages; it is excluded from release zips.

**Plans**: TBD
**UI hint**: no

### Phase 13: Content Safety

**Goal**: User-authored content can no longer run code in another user's session.
**Depends on**: Phase 11 (AUTHZ-02 shrinks who can author), Phase 12 (store changes, smoke harness)
**Requirements**: SAFE-01, SAFE-02, SAFE-03, SAFE-06, SAFE-07
**Success Criteria** (what must be TRUE):

  1. The review's sanitizer-bypass payloads and a fuzz corpus are inert on the enumerated render paths (CMS pages, banners, slides, chatbot, inline edit); a payload stored by `pmo` does not execute in an admin's real browser.
  2. App pages are served with `script-src 'self' 'wasm-unsafe-eval'` only — inline blocks externalised — after a report-only rollout through the demo and IL walks shows zero violations; the demo and IL walks pass enforced.
  3. An uploaded HTML slide runs sandboxed without portal-origin access; non-allowlisted types and over-quota uploads are refused.
  4. In real-deal mode no request leaves the host for Gemini, Hugging Face, YouTube or Google Fonts (fonts vendored) until an admin enables it; the dead AI-training upload path is gone outside demo.
  5. API responses are `no-store`; logout clears client caches/storage; pages no longer wipe legitimate caches.

**Plans**: TBD
**UI hint**: yes

### Phase 14: Deal Files, Limits & Legacy Hazards

**Goal**: Deal files stay inside the deal boundary and the demo-era footguns cannot fire in a real deal.
**Depends on**: Phase 13, Phase 12 (purge path)
**Requirements**: SAFE-04, SAFE-05, SAFE-08
**Success Criteria** (what must be TRUE):

  1. Deal files are unreachable without a session; a member of deal A cannot fetch deal B's file; legacy `/sent_emails/*` and `/uploads/*` are not mounted in real-deal mode (demo keeps them); each read is audited; the DATA-04 purge removes a deal's files.
  2. The default body limit comes from the measured largest legitimate non-upload body (i18n save, roster import) with 4× headroom; only media, slide upload and RAG upload accept large bodies; the demo and IL walks still pass.
  3. "Reset custom M&A" cannot touch real deals' files; the whole-tree download route is gone.

**Plans**: TBD
**UI hint**: yes

### Phase 15: Module Control — Core

**Goal**: An admin can switch a module off and nothing can reach it — the server-enforced heart of the user's explicit requirement, proven end to end on one tracer module before the surfaces are swept.
**Depends on**: Phase 11 (admin-only configuration), Phase 14 (static guard and file routes)
**Requirements**: MOD-01, MOD-02, MOD-07, MOD-08
**Success Criteria** (what must be TRUE):

  1. In the Modules tab an admin switches Synergies off with a reason; the change is audited and takes effect on every session's next request; the tab shows dependants and "data retained".
  2. For every module, each API route answers HTTP 403 `{moduleDisabled}` while off — every method, every role, demo-open included — and its pages and scripts are not served (case and encoding variants too), proven by an automated per-module sweep; the client does not retry or redirect on it.
  3. `/` and links into a disabled page land on deal home, never a module-disabled page; core surfaces cannot be switched off.
  4. The break-glass CLI re-enables modules on the host with no shared token; adding an unmapped route or page fails the coverage test; the app-module registry lives at `/api/app-modules`.

**Decisions to take at discuss**: module inventory and granularity (R3 §1's 14 ids; is `knowledge-ai` one switch?), dependency philosophy (cascade-with-preview vs refuse-with-reason, R6 G4).
**Plans**: TBD
**UI hint**: yes

### Phase 16: Module Control — Surfaces, Per-Deal & Defaults

**Goal**: Every surface honours the switch, an admin can narrow it per deal, and real-deal installs come up with the showcase off.
**Depends on**: Phase 15
**Requirements**: MOD-03, MOD-04, MOD-05, MOD-06
**Success Criteria** (what must be TRUE):

  1. With a module off the sidebar, deal-home tiles, execution tabs, wizard steps, notifications, export datasets, steerco sections and chatbot answers carry no trace; a switched-off tile shows the admin's reason and date; the setup checklist ignores its steps; conversions into a disabled module are refused.
  2. Switching a module off for one deal leaves other deals untouched; per-deal state is admin-only in the control-plane deal row.
  3. A real-deal install boots with the showcase cluster off (audited first-boot seed); upgrade-added modules default off in real-deal mode and on in demo; demo launchers keep everything on.
  4. The two named presets (real-deal default; all-off-except-core) pass the IL and demo walks.

**Plans**: TBD
**UI hint**: yes

### Phase 17: IL Cockpit & Real-Deal Shell

**Goal**: The Integration Leader logs in and lands in a tool built for running her deal — one screen that says where the deal stands and what needs her today. (The user's key-focus persona.)
**Depends on**: Phase 16 (showcase is a module; module-aware nav), Phase 12 (cheap reads for the cockpit's fan-out)
**Requirements**: IL-01, IL-02, IL-03, IL-04, IL-05, IL-06, IL-07
**Success Criteria** (what must be TRUE):

  1. After login an IL with a selected deal lands on the cockpit (with no deal: the registry/wizard); the sidebar lists only deal tools; none of the demo chrome listed in IL-01 renders in real-deal mode; demo mode is unchanged.
  2. Each cockpit panel answers its question from server data and links to the working surface; a switched-off or empty module renders as exactly that.
  3. A task due yesterday shows overdue on the cockpit and in the hub on the real clock, a `critical` RAID entry raises the nudge, and the two surfaces agree on counts.
  4. Phase, T-minus and Day-N come from the deal's own dates (a pre-close deal never shows "Day 30"); currency symbols and a deal-level synergy target follow the deal.
  5. At 390 px the cockpit has no horizontal scroll; the IL gets a "Deal settings" page instead of the 17-tab admin shell; a new real deal contains no NextGen process rows.

**Plans**: TBD
**UI hint**: yes

### Phase 18: IL Execution Tooling & Reporting

**Goal**: The IL can plan, assign, decide, retain and report inside the app — the spreadsheet fallbacks the review found are closed.
**Depends on**: Phase 17
**Requirements**: IL-08, IL-09, IL-10, IL-11, IL-12, IL-13, IL-14, IL-15, IL-16, IL-17, IL-18
**Success Criteria** (what must be TRUE):

  1. The IL assigns owner, due date, phase and workstream to all 30 seeded tasks without leaving the hub (inline and bulk), filters unassigned/overdue/mine, sees where a DD-sourced task came from, and loads a checklist with due dates defaulted from Day 1.
  2. Each workstream shows a lead and next milestone on the cockpit, export and pack; a RAID decision records who decided, when and why; "decisions this week" appears on the cockpit and in the export/pack.
  3. In an 81-item DD workspace the IL filters to "my overdue", collapses areas and bulk-updates status; a rejected save keeps the typed text and states the server's reason.
  4. The steerco pack for a pre-close deal contains DD status, Day-1 readiness and the timeline; org/talent stays excluded.
  5. A flight-risk entry records retention terms visible only to `hr`-cleared members and absent from exports; an org position is edited in place.
  6. A member sees "changed since my last visit" limited to records they own or are cleared for, and sees their own assessment records without a 401.

**Plans**: TBD — plan as two waves: (A) task planning, filters, due defaults, DD ergonomics, org edit; (B) decisions, workstream lead/milestone, retention terms, pack v2, changes digest.
**UI hint**: yes

### Phase 19: Real-Deal Surfaces — Language, Accessibility, Mobile

**Goal**: The screens the IL actually uses speak four languages, work with a keyboard and a screen reader, and fit a phone.
**Depends on**: Phases 17–18 (screens stabilised first)
**Requirements**: UX-01, UX-02, UX-03, UX-04
**Success Criteria** (what must be TRUE):

  1. In DE/ZH/CS, DD, org, wizard, deal-home and the conflict/busy dialogs render translated strings (a parity test finds no EN-only key on these pages), a dictionary update reaches an existing deal, and dates follow the app language; a new UI-SPEC supersedes the Phase 8/9 hard-coded-EN precedent.
  2. axe reports zero critical or serious violations on the IL pages; the conflict dialog and deal modal have a label, trap and return focus and close on Escape; failed saves are announced; reduced motion is honoured.
  3. At 390 px and 768 px the real-deal header collapses and no IL page scrolls horizontally in any language (longest German strings), verified on multi-width screenshots.
  4. The smoke harness covers the complete IL page set and is green.

**Plans**: TBD
**UI hint**: yes

### Phase 20: Runtime Hardening & Operability

**Goal**: The app behaves like a managed service — validated configuration, honest readiness, graceful stops, structured logs, rate limits, no shared secrets, managed sessions.
**Depends on**: Phase 12 (readiness and migrations), Phase 10 (accounts, sessions)
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06, OPS-07
**Success Criteria** (what must be TRUE):

  1. Booting with `PORT=abc`, a port in use, a corrupt database, an invalid proxy setting, or `DEMO_OPEN=1` beside real deals exits non-zero with a message naming the problem; the effective configuration is logged.
  2. SIGTERM during a write burst: nothing new is served after the signal, in-flight writes finish, WAL is checkpointed, exit code 0; acknowledged writes = persisted = audited; the real-deal launchers restart on a non-zero exit.
  3. `/readyz` is red until migrations finish and while draining and reports databases, WAL size and free disk; `/healthz` is cheap and reports the version; logs are one JSON line per request with a request id and no bodies.
  4. Failed-login bursts, write storms and repeated pack/export/audit reads are limited with a retry signal; `X-Admin-Token` is gone and privileged operations are host CLIs audited as `cli:<os-user>`; sessions expire on idle and absolute timeouts and an operator can list and revoke them; cookies are `Secure` on TLS without HSTS.
  5. The AI key is never stored in a database; unbounded maps are pruned.

**Plans**: TBD
**UI hint**: yes

### Phase 21: Deployment Shapes & Release Engineering

**Goal**: An operator can stand up and recover the portal as a self-managed Linux service or a container, and a release is reproducible and honest.
**Depends on**: Phase 20
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03, REL-01, REL-02
**Success Criteria** (what must be TRUE):

  1. On a clean Ubuntu 24.04 the shipped unit, proxy snippet and backup/restore scripts install the service; a backup → restore drill brings back a deal with its audit within the stated RPO/RTO; the disk-full and lost-control-DB runbook steps have been executed once.
  2. The container image builds, runs non-root on a named volume, refuses real-deal traffic without that volume, never inherits `DEMO_OPEN=1`, documents `replicas: 1` and the glibc/arm64 caveats; its ignore file excludes planning, tests and legacy artifacts.
  3. Both shapes pass the shared conformance script (liveness, readiness-red-until-migrated, drain-on-SIGTERM exit 0, migration on boot).
  4. One command builds the three turnkey zips with checksums, excluding `.planning/`, `test/`, `db.json` and legacy databases; package version, `/healthz` and the tag agree; the dependency audit shows no HIGH/critical advisory.
  5. README, DEPLOYMENT, DEMO-RUNBOOK and the boot banner make no statement the code contradicts (checked by a Fable documentation audit).

**Plans**: TBD

### Phase 22: Workstream-Lead Collaboration & Collaborative Setup

**Goal**: The IL runs her team in the app — inviting leads, setting clearances, seeing who is active and what changed — and sets a deal up together with others.
**Depends on**: Phase 10 (accounts), Phase 9 (conflicts), Phase 16 (module-aware)
**Requirements**: COLLAB-01, COLLAB-03, COLLAB-04, WIZ-02, WIZ-03, WIZ-04
**Success Criteria** (what must be TRUE):

  1. An IL invites and removes existing users on her deal and sets per-area clearances without an admin; the clearance ledger is viewable and exportable.
  2. A deal member sees a coarse presence count with no who-is-where detail, and a clearance-scoped activity feed served by the same projection as the IL digest.
  3. The wizard has a lead-onboarding step and per-step ownership handoff, shows who completed which step, and two people touching setup do not clobber each other (the control-plane deal row is version-checked).

**Plans**: TBD
**UI hint**: yes

### Phase 23: Production Certification

**Goal**: v3.0 is proven production-ready by independent, adversarial verification, and the release is staged — not pushed — for the user's explicit go.
**Depends on**: All prior phases
**Requirements**: CERT-01, CERT-02, CERT-03, CERT-04, CERT-05, CERT-06
**Success Criteria** (what must be TRUE):

  1. The Fable whole-codebase MNPI review ends with no open BLOCKER or HIGH, covers audit tamper-evidence, and its composition seams (clean-room × module switch × exports × files × accounts) have been re-tested.
  2. The multi-process soak, load profile, restart-under-write and backup → restore drills pass the DATA-01/02/05 budgets; committed `demo.db` and `control.db` are byte-identical to their commits.
  3. The demo showcase passes its regression walk under `DEMO_OPEN=1` and boots from the turnkey zip (macOS, plus Linux via Docker).
  4. An Integration-Leader acceptance walk of a full deal completes in-app with none of the review's spreadsheet-fallback gaps remaining.
  5. The security-decisions record ships (ASVS L2 mapping, single-factor justification, timeouts, retention, RPO/RTO, at-rest).
  6. v3.0.0 zips are built and checksummed; the push and GitHub release are presented for the user's explicit confirmation.

**Plans**: TBD

## Progress

**Execution Order:** Phases execute in numeric order: 8 → 9 → 10 → … → 23

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 8. Concurrency & Storage Foundation | v3.0 | 5/5 | Complete    | 2026-08-11 |
| 9. Optimistic Locking & Conflict Recovery | v3.0 | 8/16 | In Progress|  |
| 10. Accounts & Identity | v3.0 | 0/TBD | Not started | - |
| 11. Authorization & Clean-Room Closure | v3.0 | 0/TBD | Not started | - |
| 12. Data-Layer Integrity & Performance | v3.0 | 0/TBD | Not started | - |
| 13. Content Safety | v3.0 | 0/TBD | Not started | - |
| 14. Deal Files, Limits & Legacy Hazards | v3.0 | 0/TBD | Not started | - |
| 15. Module Control — Core | v3.0 | 0/TBD | Not started | - |
| 16. Module Control — Surfaces, Per-Deal & Defaults | v3.0 | 0/TBD | Not started | - |
| 17. IL Cockpit & Real-Deal Shell | v3.0 | 0/TBD | Not started | - |
| 18. IL Execution Tooling & Reporting | v3.0 | 0/TBD | Not started | - |
| 19. Real-Deal Surfaces — Language, Accessibility, Mobile | v3.0 | 0/TBD | Not started | - |
| 20. Runtime Hardening & Operability | v3.0 | 0/TBD | Not started | - |
| 21. Deployment Shapes & Release Engineering | v3.0 | 0/TBD | Not started | - |
| 22. Workstream-Lead Collaboration & Collaborative Setup | v3.0 | 0/TBD | Not started | - |
| 23. Production Certification | v3.0 | 0/TBD | Not started | - |
