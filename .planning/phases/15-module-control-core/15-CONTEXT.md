# Phase 15: Module Control — Core - Context

**Gathered:** 2026-10-11
**Status:** Ready for planning once Phase 14 closes (14-01..14-10 drafted at writing; Phase 13 closing with 13-14)
**Source:** PRD Express Path (.planning/reviews/v3.0/PHASE-15-PRD.md)

<domain>
## Phase Boundary
An admin switches any of 15 application modules off and on from a Modules tab (reason, impact preview, audited, live on every
session's next request). While off, every API route of the module answers 403 `{moduleDisabled}` for every method and role
(admin, token and demo-open included), its pages redirect to the caller's home and its scripts are not served under any
spelling; `/` lands on deal home when the showcase is off; core cannot be switched off; a host CLI re-enables without console
or token; a coverage test keeps every route, page and script mapped. Proven end to end on Synergies. MOD-01, MOD-02, MOD-07
(coverage + live clauses; presets at Phase 16 SC4), MOD-08.
</domain>

<decisions>
## Implementation Decisions
LOCKED D-15-01..11 (full wording, numbers, acceptance in PHASE-15-PRD.md): 15 switchable ids (knowledge-ai split into playbook
+ assistant) + core (auth, admin console, deal registry + wizard, deal home, registry, settings/i18n/menus/notifications/
csp-report, `/healthz`, `/`, `*`, shared assets, every script a core page loads); `execution.html` any-of; one map
`lib/appModules.js` (core = exact METHOD+template; modules = exact templates then prefixes, method-agnostic) behind a reporter
and the coverage test; refuse-with-reason (`org requires people`); state = control.db `app_state.appModules` `{v, rev,
modules, known, seed}` (absent ⇒ on; committed control.db read-only; unreadable ⇒ fail-closed), control `PRAGMA data_version`
freshness, audit inside the IMMEDIATE transaction; gate check after resolver/401/must-change, before open-mode, demo-only,
role, read, large-body, validation; guard rules page ⇒ 302 `homeFor`, script/asset ⇒ 404; `/api/auth/me` `modules` + `home`,
one-toast wrapper branch, no-request loaders, default-hidden `data-module`; `/api/app-modules` + `/api/admin/app-modules/:id
[/impact]` (control-plane, session admin only); Modules tab; enable-only CLI; Synergies tracer; carry-ins 7–9.
### Claude's Discretion
Helper names (`moduleBlock`, `homeFor`, `controlDataVersion`, map fields), how guard verdicts carry the 302, `affects` texts,
toast wording beyond the fixed 403 body, scenario/runner design, plan/wave split (suggested: map + coverage; state + endpoints
+ audit + CLI; API gate + per-module sweep; static rules + landing + Windows matrix; client contract + core loaders +
carry-ins; Modules tab; Synergies surfaces; proof — scenarios, freshness, all-off lane, DEPLOYMENT.md, smoke).
</decisions>

<canonical_refs>
- PHASE-15-PRD.md; REQUIREMENTS.md (MOD-01..08, mode contract); ROADMAP.md Phase 15 SC1–4, discuss decisions, carry-ins;
  R3 §1/§3/§4/§5.2; R6 §5 + G1–G12; PLAN-REVIEW PR-04/05/06; PHASE-13-PRD D-13-05; PHASE-14-PRD D-14-06 + plans 14-05..08;
  11-CARRY-INS rows 7–9
- `server.js` (routing :117, first mw :131, lockdown :299, `/` :409, `.html` :507, static :547, isOpenMode :620, PUBLIC_API
  :629, identity :655, ROLE_WRITE :709, DEMO_ONLY :984, gatePolicy :1003, unmount :1036, gate :1079-1197, isAdminOrIl :1229,
  auth/me :1453, COMMITTED_CONTROL_REFUSAL :1660, denyAt :2024, egress :3092, reports :8284/:8520, `*` :9474)
- `lib/requestPath.js`, `lib/readPolicy.js`, `lib/egress.js`, `lib/reportPack.js` (:370-498, :1121, :1194), `db/resolver.js` :48,
  `db/controlStore.js` (:91, :607, :668), `db/control-schema.sql` :50, `validators/index.js` (:263, :316)
- `public/js/transitions.js` (:1037/:1083, :1284, :1329, :1364, :1394, :2484, :2750, :3610), `public/admin.html` :50-114,
  `public/js/admin.js` (:2966-3016, :3040, :3145), `deal-home.js` :312-357/:463, `execution.html` :201-225, `execution.js` :1212,
  `org.js` :181, `pmo.js` :18, `login.js` :38; `scripts/audit-admin.js`, `bootstrap-admin.js`, `list-unvalidated-routes.js`,
  `scripts/uat/phase13-xss.js`, `scripts/smoke/pages.js`, `test/helpers/route-inventory.js`, `DEPLOYMENT.md`
</canonical_refs>

<specifics>
Helpers: test/helpers/listen-local.js, seed-identity.js, deal-fixture.js, route-inventory.js; temp MA_* paths (a temp
MA_CONTROL_DB_PATH for every toggling test). Measured at ef1c2b7: 162 `/api` method-routes / 129 templates (POST 74, GET 60,
DELETE 27, PATCH 1) + `/`, `/healthz`, `*`; post-14 164; post-15 167 = core 41 + modules 126 (dd 16, org 13, tasks 5, raid 3,
synergies 11, reports 2, assessments 16, people 6, academy 12, comms 7, dept-process 9, playbook 0, assistant 3, cms 15,
showcase 8); 21 pages (5 core, execution any-of, 15 module-owned), 8 nested HTML, 47 scripts (21 core); 18 admin tabs (not 17).
Never call POST /api/settings/new-ma against the repo; never start a server on committed data/*.db; hash committed DBs.
</specifics>

<deferred>
Phase 16: surface sweep, switched-off tiles (reason + date), conversions into disabled modules, derived surfaces beyond
synergies, per-deal state, MOD-06 defaults + cluster, both presets on the walks. 17: IL cockpit landing. 19: translations.
20: X-Admin-Token removal. Future: second approver, scheduled switches, IL-requested switches, data deletion.
</deferred>

---
*Phase: 15-module-control-core*
