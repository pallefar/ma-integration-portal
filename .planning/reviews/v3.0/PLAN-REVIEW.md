# v3.0 Plan Review — independent adversarial read (Fable 5.1, 2026-10-10)

**Verdict: CONFORMANT WITH AMENDMENTS.** The plan lands every BLOCKER/HIGH finding in a requirement and a phase,
keeps the user's two explicit asks first-class, and its foundation-first order is defensible. It is not executable
as written: six items would break the project's own constraints (committed `control.db`, test suite, demo launchers)
or leave a success criterion unachievable. All are wording/ordering fixes — no re-plan.

Judged against the user's verbatim goal, SUMMARY.md, REQUIREMENTS.md (76 reqs), ROADMAP.md, PROJECT.md, R1–R7, plus
spot checks of `server.js`, `db/*`, `start-real-deal.command`, `DEPLOYMENT.md`, `validators/*`, `public/*.html`.
Tags: BLOCKING = fix before the affected phase is planned · AMEND = change the text · NOTE = record a decision.

## A. Coverage

All 76 requirements map to one phase; every BLOCKER/HIGH finding in R1–R7 and every lane "Top action" lands in a
requirement (checked id-by-id) except the orphans below. SUMMARY's disposition table is more complete than ROADMAP's
success criteria in three places (R5-03 "Ph9 closure", R1-11 "Ph9", R7 F-6) — roadmap orphans despite a named phase.

**PR-01 · BLOCKING · CERT-04 is unachievable as worded.** CERT-04 requires "none of the review's spreadsheet-fallback
gaps remaining", but R4 §3 gap #2 (workstream lead + next milestone — R4 cockpit row 3 "new: workstream lead/owner
field and milestone") and gap #5 (retention terms/amounts — R4 step 9, `validators/org.js:168-178`; R6 §7.1 #5)
have no requirement. `REQUIREMENTS.md` §IL: add **IL-14** "Each workstream carries a lead and a next milestone (label
+ date); the cockpit execution panel, the workstreams export and the pack show lead, RAG, next milestone and blockers"
(Phase 15) and **IL-15** "Flight-risk entries carry retention terms (instrument, amount in deal currency, status
offered/accepted/declined, expiry), clearance-scoped to `hr`, excluded from exports per D-23" (Phase 15) — or
rewrite CERT-04 as an enumerated list naming the two as deferred with a reason.

**PR-02 · BLOCKING · Phase 9 gap-closure SCs omit three items SUMMARY assigned to Phase 9.** `ROADMAP.md` §Phase 9:
(a) R7 F-6 is in SUMMARY's row but absent from SC6 — add SC7 "a stale delete is one in-app prompt: the native
`confirm()` is replaced by an in-app confirm that becomes the conflict dialog on 409, or the 09-UI-SPEC row is
re-worded; the decision is recorded"; (b) R5-03 — add SC8 "every `public/js|css` file changed since v2.1.0 carries a
new `?v=` stamp and `login.html` loads the current `style.css` stamp" (without it the F-1 client fix itself sits
behind the 30-day cache); (c) R7 Top action 5 — add SC9 "09-01 truth list gains per-record, client-precondition and
409-clearance truths (each with a test); 09-UI-SPEC Copywriting Contract lists the deleted-variant literals (F-7);
09-UAT item 2 corrected; WINDOWS.md records the org position-edit gap". CONC-02 (R1-11): append "once every record
carries `version` (stamp `version:0` on INSERT), an update with no precondition is refused (400) in real-deal mode".

**PR-03 · NOTE · LOW orphans to place explicitly** (phase detail, or Future with a reason): R1 cosmetic retry of the
permanent pack 503 (DATA-05); R3 F-4 reserve `/api/app-modules` (Phase 13); R7 item 3 no org position *edit* UI
(Phase 15); R4 F8 RAID review date (IL-09); R6 §7.1 #6 clearance-ledger export in insider-list shape (audit rows
exist; COLLAB-01); R6 G12 vs R3 §4.3 new-module default (decide: "on in demo, off in real-deal mode for modules added
by an upgrade"); R2-07 `DEMO_OPEN=1` refuses to start with real deals present (OPS-05); R2-11 HSTS without
`includeSubDomains` (OPS-03); R2-15 glibc ≥ 2.38 floor + arm64/musl pack=503 (DEPLOY-02 docs); R6 §7.1 #2
baseline/critical path, dis-synergy signals, R6 §7.4 Q4 "IL requests a switch", R4 §6 "DD read-only post-close" → Future.

## B. User-goal fit

**(i) "admin can disable parts of the app"** — MOD-01..08 deliver server-enforced (every method, every role, demo-open
included), audited, reversible, per-deal, coverage-tested switching. Holes:

**PR-04 · BLOCKING · `/` becomes a 403 page for every real-deal user between Phase 13 and Phase 14.** MOD-06 ships
real-deal installs with the showcase cluster off; `server.js:168-171` hard-codes `/` → `overview.html` (showcase);
MOD-02's static guard then serves the "module disabled" page as the landing page until IL-01 (Phase 14). R3 §3 and
Top action 7 name exactly this. MOD-03: append "`/` and every link into a disabled page resolve to the nearest
enabled core page (deal home), never to the module-disabled page"; add it to Phase 13 SC3.

**PR-05 · AMEND · Module wording.** MOD-01 "effective for every session immediately" contradicts Phase 13 SC1 "on
their next request" → "on the next request of every session, no re-login". MOD-02 → add "(instance switch; a
per-deal switch is enforced at the API and in the client payload — static pages carry no deal context, D-V3-2); the
refusal is HTTP 403 with body `{ moduleDisabled: '<id>' }`, never auto-retried or redirected by the client". MOD-03:
delete "the cockpit says 'switched off'" (the cockpit is Phase 14's; IL-02 already carries it); add "a switched-off
tile shows the admin's reason and date". MOD-05 → "on for a deal only if on at instance level and not switched off
for that deal; per-deal state lives in the control-plane deal row (admin-only), never in the deal DB `settings`
singleton (R3 §4.1(c))". MOD-08: the break-glass CLI must not depend on `X-Admin-Token` (retired by OPS-02 later).

**PR-06 · AMEND · Phase 13 lacks the decisions it needs.** `ROADMAP.md` §Phase 13 "Depends on": add "user decision on
the module inventory and granularity (R3 §1's 14 ids; R6 §7.4 Q2 — is `knowledge-ai` one switch for playbook +
chatbot + AI insight?), the new-module default (PR-03) and the dependency philosophy (cascade-with-preview, R6 G4)".
MOD-07: add "the two named presets — real-deal default (showcase off) and all-off-except-core — pass the IL and demo
walks" (R6 G11; per-module tests do not prove the composition).

**(ii) Is the IL the key focus in substance?** Yes in scope (IL-01..13, UX-01..04, CERT-04, COLLAB-01 — 20 of 76) —
but the first IL-visible change lands in Phase 14, after five foundation phases, and two S-sized bugs that make every
real deal's signals lie (R4 F2: demo clock, `critical` ignored) wait with it. See PR-18.

**PR-07 · AMEND · IL-01 is narrower than the list its SC cites.** IL-01 omits the "Edit Content" pill, HR/Finance/
Sales module tabs, gamification/XP and the demo "M&A Projects" admin tab (R4 §5, F18); Phase 14 SC1 says "none of
the demo chrome the review listed" — align IL-01 to R4 §5 verbatim. Add "an IL with no deal lands on the deal
registry/wizard, not the deck" (R4 step 1: "no 'your deal' entry point").

**(iii) What still stops a sceptical CISO or ops lead after Phase 20:**

**PR-08 · AMEND · No security-decisions record.** Add **CERT-06** "A security-decisions record ships with the
release: ASVS 5.0 L2 mapping (V6/V7/V8/V14/V16); the written justification for single-factor auth without SSO (6.3.3)
and its network precondition (intranet/VPN + TLS at the proxy); session timeouts; data-protection levels; dependency
remediation timeframes; audit retention; RPO/RTO; at-rest = OS FDE + 0600" (R6 §7.3) — the first thing a CISO asks for.

**PR-09 · BLOCKING · DATA-04 contradicts a validated requirement and leaves tamper-evidence unplanned.** v2.1.0
AUD-02 ("the audit log survives deletion of the deal it describes"; PROJECT.md "trail survives deal deletion") is
contradicted by DATA-04's purge path; `db/audit-schema.sql` forbids UPDATE/DELETE by trigger and its header defers
"hash-chaining tamper-evidence to the shared-host milestone" — this one — which no requirement picks up (ASVS 16.4.2);
the viewer `server.js:1233` and `auditHook`'s connection assume one file. Rewrite DATA-04: "Audit rows are written per
deal into `data/audit/<dealId>.db` (control-plane events stay in `audit.db`); at deal close an admin seals the
partition (read-only, SHA-256 recorded as a control-plane audit event) and exports it; purge is a separate audited
admin action possible only after a sealed export exists and the documented retention period has passed; the admin
viewer queries across partitions; the legacy `audit.db` migrates under DATA-03; AUD-02 is superseded (PROJECT.md Key
Decisions)". Add tamper-evidence (per-partition hash chain, or at minimum the signed seal) to CERT-01's scope.

**PR-10 · AMEND · Authorization denials are not logged.** AUTHZ-01: append "every 401/403 and clearance-404 is
logged as a security event with actor, route and reason (rate-bounded)" (ASVS 16.3.2, R6 G7).

**PR-11 · AMEND · OPS-07 "secrets not in plaintext" has no key source** — encrypting `runtime.db` with a key on the
same disk is obfuscation. Reword: "the AI key is held only in the environment or a `0600` file outside `data/` and is
never written to any database". OPS-02's "managed, hashed, rotatable admin secret" is likewise undefined once accounts
exist → "`X-Admin-Token` is removed; privileged non-UI operations (bootstrap, admin password reset, module enable,
backup/restore) are CLIs run on the host as the service user, audited as `cli:<os-user>`; no shared secret exists".

**PR-12 · AMEND · Ops gaps.** DEPLOY-01: add "RPO/RTO stated in the runbook (nightly `VACUUM INTO` → RPO ≤ 24 h;
restore drill ≤ 30 min)". OPS-04 exit-on-fault regresses the turnkey laptop install, which has no supervisor
(`start-real-deal.*` = `exec node server.js`) → "the real-deal launchers restart the server on a non-zero exit".
DATA-06 "one command runs it in CI" → "a GitHub Actions workflow runs the suite on push, ubuntu + windows" or defer.

## C. Requirement quality

**PR-13 · AMEND · Budgets deferred to plan time are not observable.** Phase 11 SC1/SC2/SC5 and CERT-02 say "budget
fixed in the plan". Put the lanes' baselines in now: SC1 "write ≤ 20 ms median and audit rows = changed rows on the
1k-task/5k-RAID deal (baseline 86–97 ms, 6,220 rows — R5-01)"; SC2 "p95 ≤ 300 ms for 10 users × 3 list reads
(baseline 483 ms — R5-05) and event-loop p99 ≤ 100 ms under R2's 40-client profile (baseline 1,921 ms — R2-02)";
SC5 "a pack request leaves other requests' event-loop p99 ≤ 50 ms (baseline 2,397 ms blocked — R2-03)". CERT-02
inherits them.

**PR-14 · AMEND · Non-atomic or vague requirements.** ACCT-03 bundles three controls and conflates modes (PR-23);
AUTHZ-01 "fail-closed default" → "an unlisted read route fails the coverage test (VAL-01 precedent), never silently
403s"; SAFE-01 "every render path" (~300 `innerHTML` sinks) → "on the enumerated render paths in the plan (CMS pages,
banners, slides, chatbot, inline edit)"; SAFE-06 "resolved" → "removed outside demo (404); the process-global RAG
index cannot be made per-deal safely (R5-07)"; SAFE-08 → "removed (R2-12, R5-06; needs a `zip` binary Windows lacks)";
OPS-07/REL-01 bundle three deliverables each (plan as separate tasks); IL-08 bundles five → split IL-08a/b.

**PR-15 · AMEND · DEPLOY-03 is a duplicate** of OPS-04 + OPS-06 + DATA-03 ("built in Phases 11 and 17"). Delete it,
or make it the one distinct testable thing: "both deployment shapes pass one shared conformance script (liveness,
readiness red until migrated, drain-on-SIGTERM exit 0, migration on boot)" in Phase 18.

**PR-16 · AMEND · AUTHZ-02 vs IL-06, IL-12 vs COLLAB-04, WIZ-04.** AUTHZ-02 makes `/api/settings` admin-only (right:
it carries `demoMode` and `geminiApiKey`, R1-05) while IL-06 gives the IL "Deal settings" → append "deal-level
settings the IL may edit (currency, synergy target, Day-1 date, stale-days — `validators/settings.js:107,115`) move to
`/api/deals/:id/setup`". IL-12 and COLLAB-04 are one projection → "`/api/deals/:id/changes?since=`, clearance-scoped,
serves both; D-20 superseded (PROJECT.md)". WIZ-04 → "extends optimistic locking to the control-plane deal row".

## D. Ordering and dependencies

**PR-17 · BLOCKING · Role is snapshotted in the session; ACCT-01's role change is inert for nine phases.**
`db/sessions.js:43-74` stores `role` at login and `findSession` returns it without touching `users`; COLLAB-02
("role/clearance changes reach open sessions") sits in Phase 19. Move COLLAB-02 to Phase 10 (re-read role + disabled
flag from `control.db` per request, or revoke the user's sessions on role change — one line given ACCT-01's revoke).
Phase 10 SC1: "a role change or disable takes effect on the user's next request".

**PR-18 · AMEND · Pull five S-sized items forward.** Into Phase 9 gap closure (the same files are being edited:
`due-diligence.js:114-119`, `execution.js`): IL-03 (`server.js:6006-6014` demo clock, `:6046` `critical` never
counted — R4 F2 HIGH), R5-09 DD lost input (`due-diligence.js:117-119, 368-391`), the `?v=` bump (PR-02). Into Phase
10: R2-06 file modes `0600/0700` (`db/dbFiles.js:92-106`, HIGH — other local accounts can copy deal DBs today) and
the `compression` HIGH advisory bump (R1-09). Keep the requirement ids; update traceability rows.

**PR-19 · AMEND · Phases 10, 12 and 13 are too large to execute safely.** Phase 10 (10 reqs, two concerns) → 10a
Accounts (ACCT-01..06 + COLLAB-02) and 10b Authorization (AUTHZ-01..04). Phase 12 → 12a Content (SAFE-01/02/03) and
12b Files, limits, legacy (SAFE-04..08). Phase 13 (R3 Plans A–D ≈ M+L+M+M) → 13a Core (MOD-01/02/07/08 + synergies
tracer + PR-04 `/` fallback) and 13b Surfaces, per-deal, defaults (MOD-03/04/05/06). Inserting phases is a gsd-tools
state mutation — diff `STATE.md` `total_phases` before committing (standing gotcha).

**PR-20 · AMEND · The browser smoke harness arrives after the UI it should guard.** UX-04 (Phase 16) is the only
browser test; R5-03/09/11 got through because none existed. Move the harness (Playwright + axe, one command) into
Phase 11 under DATA-06; Phases 13–15 each add their pages; UX-04 becomes "the IL set is complete and green".

**PR-21 · AMEND · Phase 11 must gate on the Phase 8/9 proofs.** DATA-01 rewrites exactly the `writeDb()` branches
Phase 9 built on (`db/store.js:443-446, 500-502`). Add Phase 11 SC7: "`npm run soak` (0 lost, 0
committedButUnaudited) and the Phase 9 contract suite pass unchanged; reorders persist via `seq` without audit rows".
SUMMARY promises the soak re-run in Ph11; the SC does not.

**PR-22 · NOTE · No deployable shape until Phase 18** although the user said "moving to a shared internal host soon".
Consider an internal pilot checkpoint after 13b (plus OPS-04/05/07 pulled in), plain tag, no GitHub release.

## E. Constraint conflicts

**PR-23 · BLOCKING · "Real-deal install" is indistinguishable from `node server.js`, and shares the committed
`control.db`.** `start-real-deal.command` is `exec node server.js` with no flag and no `MA_*_PATH` override;
DEPLOYMENT.md §first-run rotates only `admin` on the committed `data/control.db`; the suite, `scripts/soak.js:117`,
the R4/R7 walks and the user's own two-tab UAT all log in with the demo password in fail-closed mode. Executed
literally: (a) ACCT-03's refusal fires on every developer run and every fail-closed test — 779 tests break or must all
provision non-demo users; (b) ACCT-03's account disablement and MOD-06's audited first-boot seed write into the
committed `control.db` (visibly, or only into the gitignored WAL sidecar — the known WAL trap), so CERT-02 "committed
`demo.db`/`control.db` untouched" cannot hold, and a demo launch from the same checkout afterwards runs with showcase
off and accounts disabled (CERT-03 fails). Amend ACCT-03, MOD-06, OPS-05 and Phase 10 SC2: "real-deal mode is an
explicit, validated config value (`MA_MODE=real`) set only by `start-real-deal.*`, the systemd unit and the container
image; `node server.js` stays fail-closed-permissive for development and tests; real-deal mode uses its own gitignored
data directory (`data/real/`), seeded on first boot from the committed `control.db` minus the demo accounts, and
never opens the committed files for writing". ACCT-02's bootstrap then creates the first admin there.

**PR-24 · AMEND · SAFE-02 is feasible and smaller than feared — say exactly what it is.** Measured: 8 plain inline
`<script>` blocks (dashboard 2, index, insights, login, overview, playbook, signage), 3 inline `on*=` in HTML (admin 2,
dashboard 1), 2 generated in `transitions.js`, 3 `javascript:void(0)` hrefs (`transitions.js:760,1491,1502,2104`);
Transformers.js loads by `import('/vendor/transformers/…')` (`transitions.js:2666`) from `'self'` and needs only
`'wasm-unsafe-eval'` + `worker-src blob:` — both already in `server.js:124,131`. Reword SAFE-02: "`script-src 'self'
'wasm-unsafe-eval'` only — no `unsafe-inline`, no `unsafe-eval`, no nonces (inline blocks externalised; HTML is
static); applies in both modes; rolled out as `Content-Security-Policy-Report-Only` through the demo and IL walks
before enforcing (CERT-03)". Extend SAFE-06: "in real-deal mode the CSP carries no third-party origin — YouTube,
Google Fonts, Hugging Face — fonts are vendored (no-CDN policy)".

**PR-25 · AMEND · SAFE-05 limits must be measured, not guessed.** Only `media`, `slides/upload`, `rag/upload` carry
`LARGE_BLOB_MAX` (`validators/cms.js:19,232`, `validators/settings.js:15,143`) — consistent — but `/api/i18n`
full-dictionary saves (1,076 keys × 4) and roster paste-import are non-upload bodies that may exceed a 1 MB default
and break the demo walk. Reword: "the default is set from the measured largest legitimate non-upload body in the demo
and IL walks with 4× headroom; the large-body allowlist is exactly `media`, `slides/upload`, `rag/upload`".

**PR-26 · AMEND · SAFE-04 "for real deals" cannot be decided per request on a static path.** Phase 12 SC4 "legacy
`/sent_emails/*` and `/uploads/*` serve nothing for real deals" — static routes have no session or deal context, and
the committed demo email `public/sent_emails/comm_1783454326531.html` (gitignore exception) is used by the showcase.
Reword: "legacy static paths are not mounted in real-deal mode (`MA_MODE=real`, PR-23); demo mode keeps them". Add to
SAFE-04: "deal files are removed by DATA-04's purge path".

**PR-27 · NOTE · Other constraint checks passed.** Vanilla JS/no build: every amendment stays file-based. Zero-install:
REL-01's `export-ignore` must not touch `node_modules`. No TE IT dependency: CI (PR-12) uses the existing private
GitHub repo. UX-01 translating the conflict/busy dialogs contradicts 09-UI-SPEC's "hardcoded EN via `textContent`"
rule — the Phase 16 UI-SPEC must explicitly supersede the Phase 8/9 precedent. UX-02's contrast fix changes the
showcase header look (`#a2acb9` pills) — multi-width screenshots before reporting done; the user judges visually.

## F. Under-weighted risks (ranked) with mitigations

1. Mode conflation breaks the suite, dev loop and demo (PR-23) → `MA_MODE` + `data/real/` before Phase 10 planning.
2. `writeDb()` rewrite destabilises CONC-01/02 (PR-21) → soak + Phase 9 contract suite as Phase 11 SCs.
3. Audit retention/purge is a legal decision made by engineers (PR-09) → user/TE legal fixes the retention period
   before Phase 11 planning; default "never auto-purge"; seal → export → purge, each a control-plane event.
4. The IL sees nothing new until Phase 14 and the key-focus persona drifts → PR-18 quick wins now; CERT-04's walk kept
   as a living checklist from Phase 14; PR-01's two gaps added so the walk can pass.
5. Phase 13 ships a 403 landing page (PR-04) → `/` fallback in 13a.
6. CSP enforcement breaks the showcase silently (PR-24) → report-only rollout with a violation endpoint through both
   walks; one CSP per mode.
7. Dependency drift over a long milestone (Express 4 maintenance-only, `compression` HIGH open) → `npm audit` at every
   phase close, not only REL-02; bump `compression` in Phase 10.
8. Laptop real-deal installs die on first fault once OPS-04 exits non-zero (PR-12) → launcher restart loop.
9. Stale client state after a module or deal switch → `/api/auth/me` carries effective modules; the fetch wrapper
   handles `moduleDisabled` with one toast; payload refetch on `POST /api/deals/select` (R3 §4.2(c)).
10. "Budget fixed in the plan" invites budgets tuned to pass (PR-13) → numbers in the SCs now.

---

## Minimal amendment list (makes the plan CONFORMANT)

1. **PR-23** — `MA_MODE=real` + `data/real/` seeded from the committed `control.db` minus demo accounts; reword
   ACCT-03, MOD-06, OPS-05, Phase 10 SC2.
2. **PR-01** — add IL-14 and IL-15 to Phase 15, or enumerate CERT-04 with the two deferred and a reason.
3. **PR-02** — Phase 9 SC7 (F-6 decision), SC8 (`?v=` bump), SC9 (R7 doc items); CONC-02 server-side precondition.
4. **PR-04** — MOD-03 / Phase 13 SC3: `/` and disabled-page links resolve to deal home, never the 403 page.
5. **PR-09** — rewrite DATA-04 (partitions, seal, purge-after-sealed-export, viewer, migration, AUD-02 superseded);
   tamper-evidence into CERT-01's scope.
6. **PR-17** — COLLAB-02 into Phase 10; Phase 10 SC1 "role change or disable takes effect on the next request".
7. **PR-05/06** — MOD-01/02/03/05/08 wording; Phase 13 "Depends on" gains the inventory, new-module-default and
   dependency decisions; MOD-07 presets.
8. **PR-13** — numeric budgets in Phase 11 SC1/SC2/SC5 and CERT-02.
9. **PR-18** — IL-03, R5-09 and the stamp bump into Phase 9; file modes and `compression` into Phase 10.
10. **PR-19/20/21** — split Phases 10/12/13; harness into Phase 11; Phase 11 SC7 soak + contract gate.

Everything else (PR-03, 07, 08, 10–12, 14–16, 22, 24–27) sharpens wording or records a decision and can be taken at
the affected phase's discuss step without re-opening the roadmap.
