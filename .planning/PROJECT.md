# M&A Integration Portal — Real-Deal Milestone

## What This Is

A TE Connectivity M&A integration portal that today demonstrates post-merger integration capability, being turned into a tool TE actually runs live acquisitions on. The primary operator is the Integration Lead / IMO, who manages a deal from due diligence through the first 100 days; workstream leads join once it moves to a shared host. The existing demonstration showcase is kept intact as a separate, cleanly-separated mode.

## Core Value

An Integration Lead can run one real TE acquisition end-to-end in this app — from due diligence through 100 days — without keeping a parallel spreadsheet.

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

### Active

<!-- This milestone. Hypotheses until shipped and validated. Foundation first, then the four capability gaps. -->

**Foundation — VALIDATED (Phases 1–3 complete; real deal data can now land)**

- [x] Replace the `db.json` file store with SQLite in WAL mode, sized for concurrent users from day one even while running laptop-local — Validated in Phase 1
- [x] Eliminate the documented concurrent-write race that can silently lose a write — Validated in Phase 1
- [x] Add an audit log recording who changed what, when, with before/after values — Validated in Phase 3
- [x] Add schema validation on all write paths, with length and type limits — Validated in Phase 3
- [x] Separate real-deal data from demo data so the two never share a store, and make time-travel, XP/leaderboard and other showcase mechanics unreachable from real-deal mode — Validated in Phase 3

**Due diligence workspace**

- [ ] Due diligence request list with functional areas, owners, status and document tracking
- [ ] DD findings register, with findings flowing into Day-1 tasks and RAID entries via the existing remediation linkage
- [ ] Clean-room access segregation so pre-close information is restricted on a need-to-know basis

**Synergy value capture**

- [ ] Synergy baseline and phasing over time, not just a single target vs realized pair
- [ ] Cost-to-achieve tracked against each initiative
- [ ] Confidence stage-gating on initiatives as they mature
- [ ] Linkage from a synergy initiative to the integration tasks that deliver it

**IMO reporting & exports**

- [ ] Generated steering-committee pack replacing manual deck assembly
- [ ] Status reporting across workstreams, tasks, RAID and synergies
- [ ] Data export (the app currently has import but no export endpoint at all)

**Org design & talent retention**

- [ ] Organisation structure and role mapping beyond the current flat employee list
- [ ] Role selection and redundancy decisions
- [ ] Key-talent flight-risk register

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
- Multi-process / network-filesystem SQLite hardening — the data layer is built concurrency-safe (WAL, single-writer-process) but multi-process and shared-host testing is deferred to the shared-host milestone (resolved at requirements gate)

## Context

**Current state.** The app is at v2.0.1 (HEAD `5c45f3f`), 11 phases shipped, released on GitHub with three turnkey zips. A codebase map exists at `.planning/codebase/` (7 documents, refreshed 2026-07-18) and should be treated as the authoritative technical reference.

**Stack.** Express 4 backend (`server.js`, ~3,200 lines) serving a vanilla-JS multi-page frontend (~23,400 lines across `public/js/`). Persistence is a single `db.json` file with an in-memory mtime-checked cache. No build step, no framework, no bundler. `node_modules` is committed and Transformers.js is vendored locally so the bundles are fully self-contained.

**Lifecycle coverage gap that motivates this milestone.** Analysis against the M&A lifecycle found: strategy/screening thin (static content), due diligence entirely absent, pre-close partial, Day 1 strong, first 100 days strongest, value capture partial (synergy is a four-field stub), IMO/steering partial (RAID and tasks exist but produce no reporting output), post-close review absent. The app is effectively the back half of an M&A tool with a very strong HR spine.

**Underexploited existing assets.** `POST /api/integration-tasks/from-remediation` already links assessment red flags to integration tasks — the best linkage in the app and the natural spine for DD findings to flow through. The assessment templates already carry a `gates` array. `PORTAL_AUTH=1` already provides server-verified login with roles; it needs to become mandatory, not built from scratch.

**Known technical debt to address.** `.planning/codebase/CONCERNS.md` rates two items **Critical**: the concurrent `writeDb()` race condition (data loss) and missing input validation. Also flagged: no automated tests anywhere, monolithic frontend files (`employee.js` 3,663 lines, `transitions.js` 3,322, `dashboard.js` 2,411, `admin.js` 2,454), an incomplete XSS audit, admin token held in `localStorage` without expiry, no rate limiting, fragile regex-based RAID indexing in `ragService.js`, and no audit log.

**Verified during analysis.** No dependency or critical-path modelling exists in the execution hub (zero matches for `dependsOn`/`predecessor` in `execution.js` and `server.js`). No export endpoint exists anywhere in the ~90-endpoint API; CSV roster import exists in the opposite direction.

**Working style.** The user ships by fast-forward merging a feature branch into `main` and pushing — no PRs, solo private repo. Confirm before touching remote `main`. The user judges the portal visually, so UI changes need multi-width verification before being reported as done.

## Constraints

- **Security**: Real acquisition data is MNPI (material non-public information) — target names pre-announcement, valuations, retention lists, named org designs. Mandatory auth, audit trail and clean-room segregation are legal and compliance controls, not features. This is what makes foundation-first non-negotiable.
- **Tech stack**: Vanilla JS, no framework, no build step, Express backend. Established across ~23,400 lines of frontend; introducing a framework or bundler is a separate decision, not a side effect of this milestone.
- **Deployment**: Runs laptop-local today via the zero-install bundle, moving to a shared internal host soon. This is why SQLite (single file, ACID, no server infrastructure) fits, and why the data layer must be concurrency-safe from day one rather than retrofitted.
- **Compatibility**: The demonstration showcase must survive intact — demo mode is a maintained deliverable, not legacy. Both modes ship from one codebase.
- **Dependencies**: No TE IT dependency this milestone — no SSO, no HRIS integration. The app must remain independently runnable.
- **Timeline**: No fixed date. Quality over speed; foundation-first sequencing is comfortable.
- **Release policy**: Every completed milestone ends with a GitHub release — confirm push with the user (commits are local-only until then), tag the version, rebuild the 3 turnkey zips (any-OS / Windows / macOS via `git archive --prefix=ma-integration-portal/` + portable Node reused from prior release assets), and `gh release create --latest`. Milestone close (`/gsd-complete-milestone`) is not done until the release is cut. The deferred Phase-1 Windows/Linux bundle-boot checks and `/gsd-verify-work 1` close-out happen at this release cut.
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
*Last updated: 2026-08-02 after Phase 3 (Deal Isolation, Audit Log & Write Validation)*
