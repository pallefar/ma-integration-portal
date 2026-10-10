# M&A Integration Portal — Real-Deal Milestone

## What This Is

A TE Connectivity M&A integration portal that today demonstrates post-merger integration capability, being turned into a tool TE actually runs live acquisitions on. The primary operator is the Integration Lead / IMO, who manages a deal from due diligence through the first 100 days; workstream leads join once it moves to a shared host. The existing demonstration showcase is kept intact as a separate, cleanly-separated mode.

## Core Value

An Integration Lead can run one real TE acquisition end-to-end in this app — from due diligence through 100 days — without keeping a parallel spreadsheet.

## Current Milestone: v3.0 Production-Ready

**Goal:** Make the portal genuinely production-ready on a shared internal host holding MNPI — with an
**admin who can switch parts of the app off** and the **Integration Leader as the key persona** —
after a seven-lane review of the whole app (2026-10-10, `.planning/reviews/v3.0/`).

**Target features:**
- Accounts & identity: real user provisioning, explicit real-deal mode on its own gitignored data
  directory, no published credentials, sessions that see role changes (Phase 10).
- Authorization: an explicit read/write policy, admin-only configuration, the clean-room closed on
  tasks and RAID, denials audited (Phase 11).
- Data layer that scales with the deal: writes/audit proportional to change, paged reads, versioned
  schemas, tamper-evident audit partitions, CPU isolation, a trustworthy test suite + browser smoke
  harness (Phase 12).
- Content and file safety: allowlist sanitizer, CSP without inline script, sandboxed slides, egress
  off by default (Phase 13); authenticated deal-scoped file store, per-route limits, demo-era hazards
  removed (Phase 14).
- **Module control:** admin switchboard — server-enforced (API + pages), audited, reversible, with a
  coverage gate and break-glass CLI (Phase 15); every surface honours it, per-deal override,
  real-deal default (Phase 16).
- **Integration Leader focus:** cockpit + real-deal shell, correct attention signals, timeline,
  currency (Phase 17); task planning, decision log, retention terms, DD ergonomics, pack v2, changes
  digest (Phase 18); four-language, accessible, phone-fit screens (Phase 19).
- Operations: validated config, readiness, graceful stop, structured logs, limits (Phase 20);
  self-managed + container deployment shapes and a reproducible release (Phase 21).
- Collaboration and collaborative setup (Phase 22); independent production certification (Phase 23).

**Key context:** v2.2.0 "Shared-Host Multi-User" was never released; v3.0 absorbs it in place — Phases
8–9 (concurrency, optimistic locking) carry over, the v2.2.0 operational/collaboration scope is
re-shaped by the review. Phase 9 is reopened for a gap closure (R7 found the lock does not bite on a
record's first co-edit). Architecture is unchanged (SQLite, host-local WAL, `replicas: 1`).

## Requirements

### Validated

<!-- Inferred from the existing codebase (.planning/codebase/, v2.0.1, HEAD 5c45f3f). Shipped and relied upon. -->

- ✓ Day-1 and 100-day execution checklist — 34 seeded tasks across 8 workstreams (`ws_imo`, `ws_hr`, `ws_it`, `ws_finance`, `ws_legal`, `ws_sales`, `ws_ops`, `ws_comms`) with owner, due date, phase and status — existing (`checklistTemplates`, `integrationTasks`, `execution.html`)
- ✓ Readiness assessment suite — paired acquirer/target org templates plus IL readiness, Likert-scored with weighted dimensions, banding (ready/support/risk), red flags and gate references — existing (`assessmentTemplates`, `assessmentInstances`, `assessments.html`)
- ✓ Assessment red flag → integration task remediation linkage — existing (`POST /api/integration-tasks/from-remediation`)
- ✓ RAID log — risks, issues, decisions and dependencies with severity, probability, owner and workstream — existing (`raidEntries`)
- ✓ Synergy initiative register — target vs realized €M by category and owner — existing (`synergyInitiatives`)
- ✓ Multi-role portals — Integration Leader dashboard, employee welcome portal, PMO control desk, acquired-leaders portal, supporting teams hub, capability hub — existing
- ✓ People-integration and change-management layer — 100-day roadmap, integration academy with lesson tracking, culture & ways of working, pulse surveys and sentiment, communications desk, digital signage — existing
- ✓ Per-project data isolation — multiple M&A projects each carrying their own CMS bundle, activated one at a time — existing (`projects[]`, `activeProjectId`, `POST /api/projects/:id/activate`)
- ✓ Content management system — courses/lessons, pages, menus, slides, banners, block-based layout builder, inline click-to-edit on live pages — existing (`admin.html`, `admin-cms.js`)
- ✓ Four-language internationalisation (EN/DE/ZH/CS) with an admin translation editor — existing (`i18n`, ~698 keys × 4 languages)
- ✓ Playbook grounded in the real 52-slide HR M&A Guidebook, with an app-wide slide viewer and RAG retrieval over it — existing (`playbook.html`, `ragService.js`)
- ✓ Process integration catalog — 10-process sending→receiving transformation view — existing (`processCatalog`)
- ✓ Server-verified login with roles (admin/hrbp/pmo/employee) — was opt-in (`PORTAL_AUTH=1`), now mandatory fail-closed by default — Phase 2
- ✓ Zero-install turnkey distribution — any-OS, Windows and macOS bundles with portable Node — existing
- ✓ Mandatory authentication with roles enforced on every write endpoint — fail-closed `/api` gate (reads included), SQLite-backed revocable sessions (tokens hashed at rest), coarse `ROLE_WRITE_POLICY` (boundary-safe + method-scoped), attributed `X-Admin-Token` break-glass, self password-change + first-run admin secret, client 401→login redirect, `DEMO_OPEN=1` demo escape hatch — Phase 2 (2026-07-31)
- ✓ Deal isolation with physically split stores — session-bound AsyncLocalStorage resolver binds every `/api` request to exactly one SQLite file (`demo.db` or `deals/<id>.db`) with membership refused at bind time; `control.db` (users + deal registry, committed) / `runtime.db` (sessions + secrets, gitignored) / template-only deal seeding; demo mechanics hard-gated 403 from real deals; deal registry API + header switcher (admin/IL only) — Phase 3 (2026-08-02)
- ✓ Append-only audit log — store-layer `writeDb()` hook writing attributed before/after JSON into a separate gitignored `audit.db` (UPDATE/DELETE rejected by schema triggers), D-08 control-plane security events, admin-only filterable viewer; trail survives deal deletion — Phase 3 (2026-08-02)
- ✓ Write validation on every route — one zod pipeline over all ~65 write routes (strip-unknown, typed, length-bounded, value-free 400s, applies in demo-open mode too) + write-time HTML sanitization + a coverage test that fails the suite on any unvalidated new route — Phase 3 (2026-08-02)

**Real-Deal capabilities — VALIDATED in v2.1.0 (Phases 1–7 shipped 2026-08-10)**

- ✓ Foundation: SQLite (WAL) replacing `db.json`, concurrent-write race closed, audit log, write validation, real/demo store separation — Phases 1–3
- ✓ Due diligence workspace: request list with functional areas + owners + status, findings register flowing into Day-1 tasks/RAID, clean-room need-to-know access, VDR link-out, guided deal-intake wizard — Phase 4
- ✓ Synergy value capture: monthly phasing, cost-to-achieve, confidence stage-gating, synergy→task linkage, staleness signals, non-double-counting rollup — Phase 5
- ✓ Org design & talent retention: org-position registry, append-only decision log, clearance-scoped flight-risk register, two-tier deal-home rollup — Phase 6
- ✓ IMO reporting & exports: CSV/JSON exports of workstreams/tasks/RAID/synergies + TE-branded tri-language PDF steerco pack, all clearance-scoped and audited — Phase 7

**v3.0 Production-Ready — carried-over foundation (Phases 8–9, built under the v2.2.0 label)**

- ✓ CONC-01: Concurrent writers (overlapping in-process requests or separate processes on one host) serialize safely with zero lost updates — `BEGIN IMMEDIATE` + busy-retry → 503 Retry-After, audit append atomic with the deal commit, client silent retry + honest give-up toast, proven by a real multi-process soak (`npm run soak`) — Phase 8 (2026-08-11)
- ✓ CONC-02: Optimistic locking — stale co-edited writes rejected 409 with a reload-and-reapply dialog, including the first co-edit of a never-edited record (client sends version 0; real-deal writes without a precondition refused 400); held-promise dialog sessions so pages show the server's outcome; in-app delete confirm; truthful diffs — Phase 9 (2026-10-10, reopened by the R7 browser walk and closed by gap-closure plans 09-08..09-16; verified 14/14, security SECURED 61/61)
- ✓ ACCT-01..07, COLLAB-02, OPS-08: real accounts and identity — explicit `MA_MODE=real` on its own gitignored data dir (committed control/demo DBs never written), bootstrap-admin CLI, admin user CRUD, role/disabled re-read per request, forced rotation + scrypt N=2^17 with lazy rehash, per-account/per-source throttle, Secure cookie decoupled from HSTS, self-service password/sessions UI, demo-credential lockdown + `/api/auth/mode`, 0600/0700 files, canonical-path gate hardening (CR-01) — Phase 10 (2026-10-10; verified 16/16, security SECURED 59/59; `compression` ≥1.8.2 bump deferred to REL-02)
- ✓ AUTHZ-01..05: explicit authorization — fail-closed `ROLE_READ_POLICY` over every `/api` GET (canonical-path anchored, coverage-gated), config/content writes admin-only with a public settings subset and deal-level values on the setup route, clean-room 404 on every task/RAID write/delete/convert/link path with a provenance-aware store backstop, per-role deal-record projection, no GET mutates (get-or-create is a validated POST), rate-bounded `access-denied` audit, server-verified page gate + access map (`maCan`) hiding controls that would 403 — Phase 11 (2026-10-10; verified 39/39, security SECURED 44/44, 2 Fable reviews fixed)

### Active

<!-- v3.0 Production-Ready — 86 requirements across Phases 8–23; full text + traceability in .planning/REQUIREMENTS.md -->

- [ ] AUTHZ: read/write policy, admin-only config, clean-room on tasks/RAID (Phase 11)
- [ ] DATA/QUAL: dirty-row writes + audit, paged reads, schema versions, audit partitions, CPU isolation, deterministic tests, smoke harness (Phase 12)
- [ ] SAFE: sanitizer/CSP/slides/egress (Phase 13); deal files, limits, legacy hazards (Phase 14)
- [ ] MOD: admin module switchboard — core (Phase 15), surfaces/per-deal/defaults (Phase 16)
- [ ] IL: cockpit + real-deal shell (Phase 17), execution tooling + reporting (Phase 18)
- [ ] UX: four-language, accessible, phone-fit IL screens (Phase 19)
- [ ] OPS: runtime hardening (Phase 20); DEPLOY/REL: deployment shapes + release engineering (Phase 21)
- [ ] COLLAB/WIZ: workstream-lead collaboration + collaborative setup (Phase 22)
- [ ] CERT: independent production certification (Phase 23)

### Out of Scope

<!-- Assumed at initialization; the out-of-scope question returned no selection, so these were stated as assumptions and accepted at the PROJECT.md gate. -->

- Deal sourcing, target screening and valuation as real features — the Acquisition Radar in `insights.html` stays a static showcase piece; this milestone is post-deal integration, not deal origination
- Multi-tenant and white-label capability — TE-internal only, so no tenant isolation, de-branding or licensing model
- TE SSO (SAML/OIDC) and HRIS/Workday/SAP integration — app-managed accounts only this milestone; deferred until the app moves to a shared internal host and TE IT is engaged
- TSA / carve-out tracking — Transition Services Agreement management is only relevant for divestitures, which are not the target use case
- Post-close review and lookback reporting — deferred; the milestone ends at 100 days
- Portfolio view across multiple simultaneous deals — deferred; the app stays single-active-deal while the primary operator is a single Integration Lead
- Document storage / VDR in the DD workspace — TE already licenses a virtual data room; the DD workspace tracks request lists, findings and clean-room *access* and links out to the VDR rather than storing or exchanging documents (resolved at requirements gate 2026-07-23)
- PPTX steerco-pack generation — export is CSV/JSON + formatted PDF only; PowerPoint generation is disproportionate for a laptop tool (resolved at requirements gate)
- SQLCipher / application-level at-rest encryption — MNPI at-rest protection relies on OS full-disk encryption (FileVault/BitLocker) as a documented deployment requirement; SQLCipher noted as later hardening if the app moves to shared hosting (resolved at requirements gate)
- Destructive module removal — v3.0's module switch is reversible and never deletes data; deletion would be a separate, previewed, audited action
- Network-filesystem SQLite (NFS/SMB data dirs) — multi-process hardening on ONE host shipped in Phase 8 (v2.2.0); network filesystems remain out of scope (WAL locking is unreliable on them; deployment docs require a local volume)

## Context

**Current state.** The app is at **v2.1.0 (Real-Deal Milestone), shipped 2026-08-10**, plus unreleased local work: Phase 8 (concurrency) and Phase 9 (optimistic locking, gap closure pending) — suite 779/779. The 2026-10-10 review (`.planning/reviews/v3.0/SUMMARY.md`) concluded the app is **not yet production-ready for MNPI on a shared host** (no user provisioning and published demo credentials; write/audit amplification; coarse authorization; the IL lands on the demo deck) and set the v3.0 scope. The v2.0.1 demo-showcase heritage is preserved as a cleanly-isolated mode. A codebase map exists at `.planning/codebase/` (older, pre-SQLite in places — trust the code).

**Stack.** Express 4 backend (`server.js`, ~6,800 lines) serving a vanilla-JS multi-page frontend. Persistence is **SQLite (better-sqlite3, WAL) via `db/store.js`**, file-per-deal (`data/control.db` + `data/demo.db` committed; `data/runtime.db`, `data/audit.db`, `data/deals/*.db` gitignored). Real server-verified auth is **fail-closed by default** (sessions table; `DEMO_OPEN=1` is the explicit demo-open flag used only by the demo launchers). Writes are zod-validated and audited to an append-only `audit.db`. No build step, no framework, no bundler. `node_modules` is committed and Transformers.js is vendored locally so the bundles are self-contained. Real-deal deployments use the fail-closed `start-real-deal.*` launchers (see `DEPLOYMENT.md`).

**Lifecycle coverage gap that motivates this milestone.** Analysis against the M&A lifecycle found: strategy/screening thin (static content), due diligence entirely absent, pre-close partial, Day 1 strong, first 100 days strongest, value capture partial (synergy is a four-field stub), IMO/steering partial (RAID and tasks exist but produce no reporting output), post-close review absent. The app is effectively the back half of an M&A tool with a very strong HR spine.

**Underexploited existing assets.** `POST /api/integration-tasks/from-remediation` already links assessment red flags to integration tasks — the best linkage in the app and the natural spine for DD findings to flow through. The assessment templates already carry a `gates` array. `PORTAL_AUTH=1` already provides server-verified login with roles; it needs to become mandatory, not built from scratch.

**Known technical debt to address.** `.planning/codebase/CONCERNS.md` rates two items **Critical**: the concurrent `writeDb()` race condition (data loss) and missing input validation. Also flagged: no automated tests anywhere, monolithic frontend files (`employee.js` 3,663 lines, `transitions.js` 3,322, `dashboard.js` 2,411, `admin.js` 2,454), an incomplete XSS audit, admin token held in `localStorage` without expiry, no rate limiting, fragile regex-based RAID indexing in `ragService.js`, and no audit log.

**Verified during analysis.** No dependency or critical-path modelling exists in the execution hub (zero matches for `dependsOn`/`predecessor` in `execution.js` and `server.js`). No export endpoint exists anywhere in the ~90-endpoint API; CSV roster import exists in the opposite direction.

**Working style.** The user ships by fast-forward merging a feature branch into `main` and pushing — no PRs, solo private repo. Confirm before touching remote `main` — **exception: the v3.0 push and release are pre-authorized (2026-10-10, see Key Decisions).** The user judges the portal visually, so UI changes need multi-width verification before being reported as done.

## Constraints

- **Security**: Real acquisition data is MNPI (material non-public information) — target names pre-announcement, valuations, retention lists, named org designs. Mandatory auth, audit trail and clean-room segregation are legal and compliance controls, not features. This is what makes foundation-first non-negotiable.
- **Tech stack**: Vanilla JS, no framework, no build step, Express backend. Established across ~23,400 lines of frontend; introducing a framework or bundler is a separate decision, not a side effect of this milestone.
- **Deployment**: Runs laptop-local today via the zero-install bundle, moving to a shared internal host soon. This is why SQLite (single file, ACID, no server infrastructure) fits, and why the data layer must be concurrency-safe from day one rather than retrofitted.
- **Compatibility**: The demonstration showcase must survive intact — demo mode is a maintained deliverable, not legacy. Both modes ship from one codebase.
- **Dependencies**: No TE IT dependency this milestone — no SSO, no HRIS integration. The app must remain independently runnable.
- **Timeline**: No fixed date. Quality over speed; foundation-first sequencing is comfortable.
- **Release policy**: Every completed milestone ends with a GitHub release — confirm push with the user (commits are local-only until then; **v3.0.0 is pre-authorized — see Key Decisions 2026-10-10**), tag the version, rebuild the 3 turnkey zips (any-OS / Windows / macOS via `git archive --prefix=ma-integration-portal/` + portable Node reused from prior release assets), and `gh release create --latest`. Milestone close (`/gsd-complete-milestone`) is not done until the release is cut. The deferred Phase-1 Windows/Linux bundle-boot checks and `/gsd-verify-work 1` close-out happen at this release cut.
- **Milestone security review**: User directive 2026-08-06 — every milestone close also gets a **whole-codebase security review run on Fable 5**, *in addition to* (never instead of) the per-phase `/gsd-secure-phase` gate. It runs **before the release is cut**, so nothing ships on a finding. Its distinct value is cross-phase: the per-phase gates each reason inside one phase's threat model, so only this pass can see how controls from different phases compose (e.g. Phase 4's DD clean-room against Phase 6's org clearance, or an accepted risk in one phase that a later phase's new route revives — exactly the T-04-21 → D-17 pattern). Model diversity is deliberate: a different model than the per-phase auditor is a second opinion, not a repeat. Scope is the MNPI controls first — auth, deal isolation, clean-room filtering, audit completeness, validation coverage — then everything else.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Become a real internal TE tool, not a showcase or a market product | The app is credible enough that the next step is real use; multi-tenant/white-label is a much larger scope with no stated demand | — Pending |
| Foundation first, then features | Real deal data is MNPI; the concurrent-write race and opt-in auth are dependencies of everything prioritised, and retrofitting them later means migration pain and rework | — Pending |
| SQLite (WAL mode) as the persistence layer | Single file with ACID guarantees, no server infrastructure, drops cleanly into the existing zero-install bundle, and handles the coming shared-host multi-user path without another migration | — Pending |
| Build the data layer for concurrent users from day one | Hosting is laptop-local now but explicitly shared-host soon; designing for single-user would force a second rewrite | — Pending |
| Keep demo mode and real-deal mode, cleanly separated | Preserves the showcase and pitch asset the user has invested 11 phases in, while keeping showcase mechanics (time-travel, XP, leaderboards) away from real deal data | — Pending |
| Real and demo data must not share a store | Time-travel day-scaling and gamification mutate records; letting them reach real deal data would corrupt it | — Pending |
| Integration Lead / IMO is the primary user | Single named operator resolves who the tool is for and makes IMO reporting a first-class deliverable rather than a side feature | — Pending |
| Extend the existing remediation linkage rather than build new plumbing for DD | `POST /api/integration-tasks/from-remediation` already turns assessment findings into tasks; DD findings are the same shape of problem | — Pending |
| Make auth mandatory by promoting `PORTAL_AUTH`, not by rebuilding | Server-verified login with roles already exists and is tested; the work is enforcement and role granularity, not new authentication | — Pending |
| Native SQLite WAL multi-process serialization (Option B), not a broker or Postgres | Stays zero-install, keeps the committed-DB turnkey bundle intact, and `BEGIN IMMEDIATE` + busy_timeout does the cross-process waiting inside SQLite itself | ✓ Shipped Phase 8 — soak-proven (thousands of writes, zero lost, audit 1:1) |
| Audit append atomic with the deal commit (inside one transaction) | A 503 must truthfully mean "nothing persisted" — the post-commit audit ordering let a busy audit 503 an already-committed write, which the client's silent retry would have turned into duplicate MNPI rows (review CR-01) | ✓ Shipped Phase 8 — committedButUnaudited is now a hard soak violation, measured 0 |
| Re-scope the unreleased v2.2.0 into v3.0 in place (no archive) | All of it is local/unreleased and v2.2.0's remaining scope *is* the production-readiness work; archiving Phases 8–9 under a never-shipped label would be bookkeeping for nothing; REQUIREMENTS.md already anticipated the v3.0 bump | — Pending (2026-10-10) |
| Module switch = instance ceiling + per-deal additive override, admin-only, non-destructive | An IMO needs per-deal control (org off until HR clearance, employee portal off pre-close); static pages have no deal context so they are guarded at instance level, per-deal enforced at the API where the data is; disable never deletes | — Pending (Phases 15–16) |
| Foundation-first ordering retained for v3.0 (trust → data → content safety → module switch → IL → ops → deployment → collaboration → certification) | MNPI is non-negotiable; every IL feature stands on authorization, a sane audit/write path and safe content | — Pending |
| IL membership management stays in the collaboration phase; admin does it meanwhile | Keeps Phase 10 bounded now that admin user CRUD exists | — Pending (Phase 22) |
| Translate the real-deal IL screens (EN/DE/ZH/CS) rather than hide the language selector | DE/CZ/CN workstream leads join in v3.0 and the user's i18n investment is the product's differentiator | — Pending (Phase 19) |
| Human-verify gates are judged by Fable against the written contracts (user directive 2026-08-08); push/release remain user-confirmed | Keeps the autonomous run unblocked without weakening review; authorization ≠ review | ✓ In effect |
| Push + release of v3.0.0 is pre-authorized by the user (2026-10-10): once version 3 is fully up and running, push all changes and create a release that opens on Windows and macOS | The user's own goal message — "once we have a version 3 fully up and running ensure you push all changes and create a new release that can open on windows and Mac". Supersedes the per-act confirmation for THIS release only; scope is push + tag + release (no force-push, no remote-branch deletion); certification must state exactly what was proven on which OS (Windows cannot be booted natively from the dev Mac) | ✓ In effect (2026-10-10) |
| Real-deal mode is explicit (`MA_MODE=real`) on its own gitignored data directory; committed `control.db`/`demo.db` are never written in real-deal mode | `start-real-deal.*` was indistinguishable from `node server.js`; the deal registry (target names = MNPI) lived in a committed file in a public repo; boot refusal on demo credentials would otherwise break the suite and dev loop | — Pending (Phase 10) |
| Audit becomes per-deal, hash-chained, sealed-then-exported, purge only after sealed export + retention; this **supersedes v2.1.0 AUD-02 "trail survives deal deletion"** | The single append-only audit.db grows unboundedly, holds MNPI snapshots of deleted deals forever with no purge path, and has no tamper evidence (ASVS 16.4.2); retention is a legal call — default is never auto-purge | — Pending (Phase 12) |
| An activity/changes feed for deal members is allowed (clearance-scoped, projected from the audit): **supersedes v2.1.0 D-20 "deliberately no activity feed"** | R4/R6: "what changed since I last looked" is an IL table-stake; the projection never exposes the admin audit | — Pending (Phases 18, 22) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state


---
*Last updated: 2026-10-10 after the v3.0 production-readiness review — milestone re-scoped v2.2.0 → v3.0 in place; CONC-02 reopened.*
