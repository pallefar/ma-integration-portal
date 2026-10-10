# Requirements: v3.0 Production-Ready

Scoped requirements for the v3.0 milestone — making the portal genuinely production-ready on a shared
internal host holding MNPI, with an **admin who can switch parts of the app off** and the **Integration
Leader as the key persona**. Grounded in `.planning/reviews/v3.0/` (SUMMARY.md, lanes R1–R7, and the
independent PLAN-REVIEW.md whose amendments are applied here, 2026-10-10). v3.0 absorbs the unfinished
v2.2.0 Shared-Host Multi-User scope (CONC-01/02 built; DEPLOY, OPS, COLLAB, WIZ carried over and
re-shaped by the review).

**Architecture (settled):** SQLite, host-local WAL write serialization (Option B), `replicas: 1`.
Postgres/horizontal scaling stays deferred. The zero-install committed-DB turnkey model and the demo
showcase both survive. MNPI-grade throughout: every phase gets a threat model at plan time.

**Mode contract (decided at review, PR-23):** *demo* = `DEMO_OPEN=1` launchers on the committed
`demo.db`/`control.db`; *dev/test* = plain `node server.js` (fail-closed, committed files, tests use
`MA_*_PATH` temp overrides); *real-deal* = explicit `MA_MODE=real`, set only by `start-real-deal.*`, the
service unit and the container image, running on its **own gitignored data directory** seeded from the
committed control DB minus demo accounts. The committed files are never opened for writing in real-deal
mode, and MNPI (deal names, members) can therefore never land in a committed file.

## v3.0 Requirements

### Concurrency & Data Safety (CONC)

- [x] **CONC-01**: Concurrent writers — overlapping requests in one process or separate processes on one host — serialize safely with no lost updates (immediate write transactions + busy-retry → 503). *(Phase 8, shipped.)*
- [ ] **CONC-02**: A user whose edit to a co-edited record is based on stale data has that write rejected with a 409 and is offered reload-and-reapply — **including the first co-edit of a record that was never edited before** (every client holding a version-less record sends a precondition) — the page reflects the outcome of a reapplied or force-deleted write, and in real-deal mode an update to an existing versioned record that carries no precondition is refused (400). *(Reopened 2026-10-10: R7 F-1/F-2; Phase 9 gap closure.)*

### Accounts & Identity (ACCT)

- [ ] **ACCT-01**: An admin can create a user, set their role, disable and re-enable them, and issue a temporary password from the admin console; every action is audited and a disable or role change takes effect on that user's next request (open sessions re-read role/disabled state).
- [ ] **ACCT-02**: A real-deal host with no users can create its first admin from a one-time secret via a CLI run as the service user, so no installation ends with nobody able to log in and recovery never depends on a long-lived shared token.
- [ ] **ACCT-03**: Real-deal mode is explicit and isolated — `MA_MODE=real` set only by `start-real-deal.*`, the service unit and the container image; it runs on its own gitignored data directory seeded from the committed control DB with demo accounts removed; the committed `control.db`/`demo.db` are never opened for writing in real-deal mode; creating a real deal outside real-deal mode against the committed control DB path is refused.
- [ ] **ACCT-04**: A temporary password forces a change at first login; password hashes use a current work factor and are transparently re-hashed at the next successful login.
- [ ] **ACCT-05**: Login throttling is keyed per account and source with backoff, and one user's mistakes cannot lock the team out when the server sits behind a reverse proxy.
- [ ] **ACCT-06**: Every user can change their own password and see and end their own active sessions from the UI.
- [ ] **ACCT-07**: In real-deal mode the published demo credentials cannot exist or work — the seeded control DB carries no demo accounts, the server refuses to serve beyond login/change-password if any account still verifies the demo password, and the login page shows demo credentials only in demo-open mode.

### Authorization (AUTHZ)

- [ ] **AUTHZ-01**: Every `/api` read route has an explicit role policy and an unlisted read route fails the coverage test (VAL-01 precedent); an `employee` session in a real deal cannot read synergy financials, RAID, tasks, roster, communications, pulses or org data.
- [ ] **AUTHZ-02**: Configuration and content surfaces (instance settings, menus, pages, banners, slides, media, i18n, courses, AI keys) are writable only by admin; deal-level settings the IL may edit (currency, synergy target, Day-1 date, stale-days) live under the deal's own setup route.
- [ ] **AUTHZ-03**: Tasks, RAID entries and every other record carrying a clearance area are filtered by clean-room clearance on read, write, delete and 409 bodies; a record outside the caller's clearance answers as not found.
- [ ] **AUTHZ-04**: No GET route changes state; every state-changing route is POST/PUT/DELETE and passes write validation.
- [ ] **AUTHZ-05**: Every 401/403 and clearance-404 is recorded as a security event with actor, route and reason (rate-bounded so a probe cannot flood the audit).

### Data Layer (DATA) and Test Signal (QUAL)

- [ ] **DATA-01**: A write rewrites and audits only the records that changed — one changed record produces exactly one audit row, an unchanged record none, a reorder persists via sequence without audit noise — and on the 1,000-task / 5,000-RAID deal median write latency is ≤ 40 ms (review baseline 86–97 ms and 6,220 audit rows per click).
- [ ] **DATA-02**: A read loads only the collections the request needs; the heaviest lists (RAID, tasks) support server-side filter and paging; the due-diligence workspace loads through one batch request; 10 users × 3 list reads at volume stay at p95 ≤ 300 ms (baseline 483 ms) and the server's event-loop p99 stays ≤ 100 ms under the 40-client review profile (baseline 1,921 ms).
- [ ] **DATA-03**: Every database file carries a schema version; ordered migrations run at boot under an exclusive lock, including migrating the legacy single audit file; a failed migration or integrity check keeps the instance not-ready.
- [ ] **DATA-04**: Audit rows are written per deal into a tamper-evident partition (hash-chained) while control-plane events stay in the control audit; at deal close an admin seals a partition (read-only, SHA-256 recorded as a control-plane event) and exports it; purge is a separate audited admin action possible only after a sealed export exists and the documented retention period has passed (default: never auto-purge); the admin viewer queries across partitions. Supersedes v2.1.0 AUD-02 "trail survives deal deletion" (recorded in PROJECT.md).
- [ ] **DATA-05**: CPU-bound work (steerco PDF pack, PDF parsing) runs off the event loop behind a concurrency guard — while a pack renders, other requests' event-loop p99 stays ≤ 50 ms (baseline 2,397 ms blocked) — and the permanent "pack unavailable on this platform" 503 is not retried by the client.
- [ ] **DATA-06**: The test suite is deterministic and isolated — listeners bind loopback, no test can write the real `data/*.db`, a GitHub Actions workflow runs it on ubuntu + windows — and `npm run soak` plus the Phase 9 contract suite pass unchanged after the store rewrite.
- [ ] **QUAL-01**: Shipped client assets are cache-busted by content — a changed `public/js|css` file can never be served from a stale `?v=` stamp (automated, test-enforced).
- [ ] **QUAL-02**: A browser smoke harness (real browser + axe, one command, not shipped in release zips) exists from Phase 11; every UI phase adds its pages to it.

### Content & File Safety (SAFE)

- [ ] **SAFE-01**: User-authored HTML is sanitized by an allowlist parser that re-serializes its output; the review's bypass payloads and a fuzz corpus are inert on the enumerated render paths (CMS pages, banners, slides, chatbot, inline edit).
- [ ] **SAFE-02**: App pages are served under `script-src 'self' 'wasm-unsafe-eval'` only — no inline script, no inline handlers, no `eval`, no nonces (inline blocks externalised) — in both modes, rolled out report-only through the demo and IL walks before enforcement, proven by a stored-XSS payload that does not execute in a real browser.
- [ ] **SAFE-03**: Uploaded HTML slides render sandboxed (no same-origin access) and uploads are type-allowlisted with a size quota.
- [ ] **SAFE-04**: Deal files (communications, media, slides) are stored outside the static tree per deal and served only through an authenticated, membership-checked, audited route; legacy `/sent_emails` and `/uploads` static mounts do not exist in real-deal mode (demo keeps them); deal files are removed by the DATA-04 purge path.
- [ ] **SAFE-05**: Request body limits are per-route — the default is set from the measured largest legitimate non-upload body (i18n dictionary save, roster import) with 4× headroom, and the large-body allowlist is exactly media, slide upload and RAG upload.
- [ ] **SAFE-06**: In real-deal mode there is no third-party egress or CSP origin unless an admin enables it — Gemini, Hugging Face, YouTube and Google Fonts (fonts vendored) — and the dead AI-training upload path is removed outside demo.
- [ ] **SAFE-07**: API responses are `no-store`, logout clears client-side caches and storage, and pages no longer delete legitimate caches on every load.
- [ ] **SAFE-08**: Demo-era hazards are removed from real-deal mode — "Reset custom M&A" cannot touch real deals' files and the whole-tree `download-zip` route is removed.

### Module Control (MOD)

- [ ] **MOD-01**: An admin can switch an application module off and on from a Modules tab, with a required reason and an impact preview; the change is audited and takes effect on the next request of every session, no re-login.
- [ ] **MOD-02**: A disabled module is unreachable server-side — its API routes (every method, every role including admin, demo-open included) return HTTP 403 `{moduleDisabled:'<id>'}` that the client never retries or redirects on, and its pages and scripts are not served (instance switch; a per-deal switch is enforced at the API and in the client payload because static pages carry no deal context).
- [ ] **MOD-03**: A disabled module is absent from the sidebar, tiles, tabs, links, wizard steps and notifications, a switched-off tile shows the admin's reason and date, the setup checklist treats its steps as not-applicable, and `/` and every link into a disabled page resolve to deal home, never to a module-disabled page.
- [ ] **MOD-04**: Derived surfaces honour the switch — exports and steerco-pack sections, rollups, conversions into other modules (a conversion checks its target module), and chatbot answers.
- [ ] **MOD-05**: A module is on for a deal only if it is on at instance level and not switched off for that deal; per-deal state lives in the control-plane deal row (admin-only writes), never in the deal DB's settings singleton.
- [ ] **MOD-06**: Real-deal installs ship with the demo-showcase module cluster off by default (first-boot seed, audited), a module added by an upgrade defaults enabled in demo and off in real-deal mode, and demo launchers keep everything on.
- [ ] **MOD-07**: A coverage test fails when any `/api` route or `public/*.html` page is not mapped to a module or explicitly marked core; every module has a live disabled-state test; the named presets (real-deal default, all-off-except-core) pass the IL and demo walks.
- [ ] **MOD-08**: A break-glass CLI run on the host can re-enable modules without the admin console and without any shared token; core surfaces (auth, admin console, deal registry, the registry itself) cannot be switched off.

### Integration Leader (IL)

- [ ] **IL-01**: A logged-in Integration Leader with a deal lands on the deal cockpit (with no deal: on the deal registry/wizard), never the slide deck; the sidebar shows only deal tools (module-aware); demo chrome — time-travel badge, role switcher, device toggles, "Edit Content" pill, HR/Finance/Sales module tabs, gamification/XP, fabricated mission/AI banners, easter egg, AI-brain modal, the demo "M&A Projects" admin tab — is absent in real-deal mode.
- [ ] **IL-02**: The cockpit answers, from server rollups with honest empty and switched-off states: where are we (phase, T-minus, Day-N); what needs me today; is execution on track (per-workstream RAG, lead, next milestone, blockers); are we Day-1 ready; diligence status; value capture; people and retention; risks and decisions; team and access (members, clearances, VDR grants).
- [ ] **IL-03**: Attention signals are correct in real deals — overdue uses the real clock, `critical` RAID counts, and the overdue/unassigned/blocked numbers on the cockpit equal the Execution Hub's.
- [ ] **IL-04**: Deal phase, T-minus to Day 1 and Day-N of 100 are derived from the deal's own dates and replace the demo Day badge.
- [ ] **IL-05**: The deal currency is honoured wherever money is shown or exported, and the deal can carry a deal-level synergy target.
- [ ] **IL-06**: The IL has a scoped "Deal settings" surface (deal-level settings, no instance singleton) and is no longer painted as "IMO · System Admin" with admin navigation.
- [ ] **IL-07**: New real deals are not seeded with demo content (NextGen process catalog, mock assessment).
- [ ] **IL-08**: The IL can edit owner, due date, phase and workstream on any existing task inline and bulk-assign selected tasks.
- [ ] **IL-09**: RAID entries carry a review/due date and RAID decisions carry decided-by, decided-at and rationale; the cockpit shows decisions this week; the log is exportable.
- [ ] **IL-10**: The DD workspace filters by area/status/owner/overdue/mine, collapses, bulk-updates and shows counts; a failed save never discards what the user typed and always states why.
- [ ] **IL-11**: The steerco pack includes DD status (pre-close), Day-1 readiness and timeline; org/talent stays excluded.
- [ ] **IL-12**: A deal member sees a clearance-scoped "changed since my last visit" digest (records they own or are cleared for) — one `changes?since=` projection that also serves COLLAB-04; never the admin audit. Supersedes the v2.1.0 D-20 "no activity feed" decision (recorded in PROJECT.md).
- [ ] **IL-13**: Deal members can see their own assessment records without admin rights and without console errors.
- [ ] **IL-14**: Each workstream carries a lead and a next milestone (label + date); the cockpit execution panel, the workstreams export and the pack show lead, RAG, next milestone and blockers.
- [ ] **IL-15**: Flight-risk entries carry retention terms (instrument, amount in deal currency, status offered/accepted/declined, expiry), clearance-scoped to `hr` and excluded from exports (D-23).
- [ ] **IL-16**: The Execution Hub filters tasks by unassigned/overdue/mine and shows provenance for DD-sourced and conversion-sourced tasks.
- [ ] **IL-17**: When a checklist is loaded, task due dates default from the deal's Day-1 date by phase offset and can be re-planned in bulk when Day 1 moves.
- [ ] **IL-18**: An IL can edit an org position's title, level and reporting line in place (today only create/delete/copy exist).

### Real-Deal Surfaces: Language, Accessibility, Mobile (UX)

- [ ] **UX-01**: Due diligence, org, deal wizard, deal home and the conflict/busy dialogs are translated into EN/DE/ZH/CS (superseding the Phase 8/9 hard-coded-EN precedent in a new UI-SPEC); translation updates reach existing deals; dates and numbers follow the app language.
- [ ] **UX-02**: IL pages have zero axe critical/serious violations — labelled controls, dialogs with label + focus trap + focus return + Escape, live-region announcements, reduced-motion support, contrast (verified with multi-width screenshots).
- [ ] **UX-03**: In real-deal mode the header collapses at ≤ 768 px and no IL page scrolls horizontally at 390 px in any language.
- [ ] **UX-04**: The browser smoke harness covers the complete IL page set and is green.

### Operational Hardening (OPS)

- [ ] **OPS-01**: Auth endpoints, writes per session and the expensive reads (pack, export, audit query) are rate-limited with a retry signal.
- [ ] **OPS-02**: `X-Admin-Token` and the env-held shared admin secret are removed; privileged non-UI operations (bootstrap, admin password reset, module enable, backup/restore) are CLIs run on the host as the service user and audited as `cli:<os-user>`; no long-lived shared secret exists.
- [ ] **OPS-03**: Sessions have idle and absolute timeouts; an operator can list and revoke any user's sessions; cookies are `Secure` on a TLS origin independent of HSTS, and HSTS omits `includeSubDomains` by default.
- [ ] **OPS-04**: Shutdown stops serving, drains in-flight writes, checkpoints and closes every database, and exits 0; a fatal fault or listen error exits non-zero; the real-deal launchers restart the server on a non-zero exit (bounded loop).
- [ ] **OPS-05**: Configuration is parsed and validated at boot into one documented contract; invalid values refuse to start, `DEMO_OPEN=1` refuses to start when real deals exist, and the effective contract is logged.
- [ ] **OPS-06**: Logs are structured with request id, duration and status (no bodies or filenames); `/readyz` reports every database, WAL size, free disk and draining state; `/healthz` is cheap and reports the version.
- [ ] **OPS-07**: The AI key is held only in the environment or a `0600` file outside `data/` and never written to any database; unbounded in-memory structures (throttle map, connection cache) are pruned.
- [ ] **OPS-08**: MNPI database files and directories are created `0600`/`0700` under any umask. *(Pulled forward into Phase 10.)*

### Deployment & Release (DEPLOY, REL)

- [ ] **DEPLOY-01**: A shipped systemd unit, reverse-proxy/TLS snippet, WAL-aware backup/restore scripts and a runbook let an operator run the portal as a managed Linux service and recover from disk-full, a corrupt file and a lost control DB; RPO/RTO are stated (nightly `VACUUM INTO` → RPO ≤ 24 h; restore drill ≤ 30 min).
- [ ] **DEPLOY-02**: A shipped container image and config contract (env vars, readiness endpoint, named `data/` volume, non-root, `.dockerignore` mirroring the MNPI boundary, `replicas: 1`, the glibc ≥ 2.38 base and arm64/musl pack-503 caveat documented) lets TE IT run the portal; the image carries no real data and never inherits `DEMO_OPEN=1`.
- [ ] **DEPLOY-03**: Both deployment shapes pass one shared conformance script — liveness, readiness red until migrated, drain-on-SIGTERM exit 0, migration on boot.
- [ ] **REL-01**: A scripted, checksummed release build produces the three turnkey zips excluding planning/test/legacy artifacts; the version is single-sourced (package.json, `/healthz`, tags); README, DEPLOYMENT, DEMO-RUNBOOK and the boot banner describe the app as it is.
- [ ] **REL-02**: Shipped dependencies carry no known HIGH or critical advisory at release (audited at every phase close, bumped, re-committed; `compression` bumped in Phase 10).

### Collaboration (COLLAB) & Setup Wizard (WIZ)

- [ ] **COLLAB-01**: An Integration Lead can invite and assign an existing user to a deal, remove them, and set per-area clearance grants; the clearance ledger (who, area, granted by/at, revoked at) is viewable and exportable.
- [ ] **COLLAB-02**: A change to a user's role or clearance grants takes effect on their already-open sessions at their next request, not only at next login. *(Pulled forward into Phase 10.)*
- [ ] **COLLAB-03**: A deal member sees a coarse, MNPI-safe presence signal — how many teammates are active on this deal — without who-is-where detail.
- [ ] **COLLAB-04**: A deal member sees a clearance-scoped team activity feed served by the same `changes` projection as IL-12 — a read-side projection of the append-only audit, never a new logging path.
- [ ] **WIZ-02**: The deal-setup wizard has a workstream-lead onboarding step that assigns leads and their per-area clearance grants during setup.
- [ ] **WIZ-03**: The Integration Leader can hand off individual setup steps to different owners so a partially configured deal can be finished collaboratively.
- [ ] **WIZ-04**: The wizard's in-progress state is multi-user-aware — it shows who completed which step and does not clobber when two people touch setup concurrently (extending optimistic locking to the control-plane deal row, which CONC-02 excluded).

### Production Certification (CERT)

- [ ] **CERT-01**: A whole-codebase MNPI security review on Fable finds no open BLOCKER or HIGH, covers audit tamper-evidence, and its composition findings are fixed.
- [ ] **CERT-02**: The multi-process soak, the load profile, the restart-under-write drill and a backup → restore drill meet the budgets in DATA-01/02/05; committed `demo.db`/`control.db` are byte-identical to their commits.
- [ ] **CERT-03**: The demo showcase is regression-checked end to end under `DEMO_OPEN=1` and boots from the turnkey zip.
- [ ] **CERT-04**: An Integration-Leader acceptance walk of a full deal (wizard → DD → tasks → synergy → org → decision → pack) completes in-app with none of the review's spreadsheet-fallback gaps remaining (R4 §3 items 1–8).
- [ ] **CERT-05**: Version 3.0.0 is built into three turnkey zips; pushing and the GitHub release await explicit user confirmation.
- [ ] **CERT-06**: A security-decisions record ships with the release: ASVS 5.0 L2 mapping (V6/V7/V8/V14/V16), the written justification for single-factor auth without SSO and its network precondition (intranet/VPN + TLS at the proxy), session timeouts, data-protection levels, dependency remediation timeframes, audit retention, RPO/RTO, and at-rest = OS full-disk encryption + `0600` files.

## Future Requirements (deferred)

- Multi-host horizontal scaling and a Postgres/client-server backend — only if one shared host proves insufficient; breaks the zero-install turnkey model.
- Real-time co-editing (CRDT/OT, live cursors) — optimistic locking + coarse presence is the deliberate ceiling for a ~15-person deal team.
- Express 5 migration — reassess against the Express 4 support window at REL-02.
- Vendoring AI-Insight model weights — only if AI egress is ever enabled for real deals (SAFE-06 keeps it off).
- Refactoring the `server.js` / `transitions.js` monoliths — no behavioural payoff this milestone; touched only where a phase needs it.
- Baseline-vs-forecast milestones with critical-path auto-shift, dis-synergy / customer-loss signals (R6 §7.1) — beyond the review's spreadsheet-fallback list; revisit after v3.0.
- "IL can request a module switch" workflow and DD read-only/archived state post-close (R4 §6, R6 §7.4) — need a product decision; v3.0 ships the admin switch and the honest "switched off" display.
- Internal pilot tag after Phase 13 (accounts, authz, data layer, content safety, module switch): optional checkpoint, plain tag, no GitHub release.

## Out of Scope

- TE SSO (SAML/OIDC) and HRIS integration — app-managed accounts only (ACCT-01..07 make that real); a separate identity-integration milestone. CERT-06 records the single-factor justification.
- SQLCipher / application-level at-rest encryption — OS full-disk encryption + `0600`/`0700` file modes is the control.
- Network-filesystem-mounted SQLite — unsafe with WAL; the DB stays on local disk.
- Destructive module removal (deleting a module's data on disable) — v3.0 disable is reversible and never deletes; removal would be a separate, previewed, audited action.
- Postgres migration in this milestone.

## Traceability

All 86 requirements (1 complete, 85 pending) mapped to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONC-01 | Phase 8 | Complete |
| CONC-02 | Phase 9 | Reopened — gap closure |
| ACCT-01 | Phase 10 | Pending |
| ACCT-02 | Phase 10 | Pending |
| ACCT-03 | Phase 10 | Pending |
| ACCT-04 | Phase 10 | Pending |
| ACCT-05 | Phase 10 | Pending |
| ACCT-06 | Phase 10 | Pending |
| ACCT-07 | Phase 10 | Pending |
| AUTHZ-01 | Phase 11 | Pending |
| AUTHZ-02 | Phase 11 | Pending |
| AUTHZ-03 | Phase 11 | Pending |
| AUTHZ-04 | Phase 11 | Pending |
| AUTHZ-05 | Phase 11 | Pending |
| DATA-01 | Phase 12 | Pending |
| DATA-02 | Phase 12 | Pending |
| DATA-03 | Phase 12 | Pending |
| DATA-04 | Phase 12 | Pending |
| DATA-05 | Phase 12 | Pending |
| DATA-06 | Phase 12 | Pending |
| QUAL-01 | Phase 12 | Pending |
| QUAL-02 | Phase 12 | Pending |
| SAFE-01 | Phase 13 | Pending |
| SAFE-02 | Phase 13 | Pending |
| SAFE-03 | Phase 13 | Pending |
| SAFE-04 | Phase 14 | Pending |
| SAFE-05 | Phase 14 | Pending |
| SAFE-06 | Phase 13 | Pending |
| SAFE-07 | Phase 13 | Pending |
| SAFE-08 | Phase 14 | Pending |
| MOD-01 | Phase 15 | Pending |
| MOD-02 | Phase 15 | Pending |
| MOD-03 | Phase 16 | Pending |
| MOD-04 | Phase 16 | Pending |
| MOD-05 | Phase 16 | Pending |
| MOD-06 | Phase 16 | Pending |
| MOD-07 | Phase 15 | Pending |
| MOD-08 | Phase 15 | Pending |
| IL-01 | Phase 17 | Pending |
| IL-02 | Phase 17 | Pending |
| IL-03 | Phase 17 | Pending |
| IL-04 | Phase 17 | Pending |
| IL-05 | Phase 17 | Pending |
| IL-06 | Phase 17 | Pending |
| IL-07 | Phase 17 | Pending |
| IL-08 | Phase 18 | Pending |
| IL-09 | Phase 18 | Pending |
| IL-10 | Phase 18 | Pending |
| IL-11 | Phase 18 | Pending |
| IL-12 | Phase 18 | Pending |
| IL-13 | Phase 18 | Pending |
| IL-14 | Phase 18 | Pending |
| IL-15 | Phase 18 | Pending |
| IL-16 | Phase 18 | Pending |
| IL-17 | Phase 18 | Pending |
| IL-18 | Phase 18 | Pending |
| UX-01 | Phase 19 | Pending |
| UX-02 | Phase 19 | Pending |
| UX-03 | Phase 19 | Pending |
| UX-04 | Phase 19 | Pending |
| OPS-01 | Phase 20 | Pending |
| OPS-02 | Phase 20 | Pending |
| OPS-03 | Phase 20 | Pending |
| OPS-04 | Phase 20 | Pending |
| OPS-05 | Phase 20 | Pending |
| OPS-06 | Phase 20 | Pending |
| OPS-07 | Phase 20 | Pending |
| OPS-08 | Phase 10 | Pending |
| DEPLOY-01 | Phase 21 | Pending |
| DEPLOY-02 | Phase 21 | Pending |
| DEPLOY-03 | Phase 21 | Pending |
| REL-01 | Phase 21 | Pending |
| REL-02 | Phase 21 | Pending |
| COLLAB-01 | Phase 22 | Pending |
| COLLAB-02 | Phase 10 | Pending |
| COLLAB-03 | Phase 22 | Pending |
| COLLAB-04 | Phase 22 | Pending |
| WIZ-02 | Phase 22 | Pending |
| WIZ-03 | Phase 22 | Pending |
| WIZ-04 | Phase 22 | Pending |
| CERT-01 | Phase 23 | Pending |
| CERT-02 | Phase 23 | Pending |
| CERT-03 | Phase 23 | Pending |
| CERT-04 | Phase 23 | Pending |
| CERT-05 | Phase 23 | Pending |
| CERT-06 | Phase 23 | Pending |
