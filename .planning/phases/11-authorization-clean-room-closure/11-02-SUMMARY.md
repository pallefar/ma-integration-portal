---
phase: 11-authorization-clean-room-closure
plan: 02
subsystem: auth
tags: [authz, write-policy, settings, allowlist, deal-settings, express, zod, sqlite]

requires:
  - phase: 10-accounts-identity
    provides: "account re-read per request (D-10-04), canonical-path gate (CR-01), isAdminRequest()"
provides:
  - "admin-only ROLE_WRITE_POLICY rules for settings, menus, pages, banners, slides, media, i18n, courses"
  - "PUBLIC_SETTINGS_KEYS allowlist + role-aware GET /api/settings"
  - "dealSettings on POST /api/deals/:id/setup, controlStore.updateDealSettings, dealSettingsFor(req) reader precedence"
  - "rollup fields dealSynergyTargetM and staleThresholdDays"
affects: [11-07 client capability gating, 11-08 demo-open console lane, 11-04 docs]

tech-stack:
  added: []
  patterns:
    - "allowlist pick (never a delete-list) for secret-bearing response objects"
    - "deal-level config on the control.db registry record, reader precedence deal > db.settings > default"
    - "non-member refusal byte-identical to missing-resource 404 (no existence oracle)"

key-files:
  created:
    - test/config-admin-only.test.js
    - test/settings-public-subset.test.js
    - test/deal-settings-setup.test.js
  modified:
    - server.js
    - validators/settings.js
    - validators/wizard.js
    - db/controlStore.js
    - test/busy-503-contract.test.js
    - test/synergy-phasing.test.js
    - test/synergy-staleness.test.js
    - test/write-validation.test.js
    - test/xss-sanitization.test.js

key-decisions:
  - "Time-travel stays staff-writable: an explicit exact POST rule ahead of the admin-only /api/settings prefix; it is already demo-only via DEMO_ONLY_PREFIXES"
  - "browserModel is IN the public allowlist: transitions.js reads it on every page to decide whether to show the AI-Insight prompt; it is a model identifier, not a credential"
  - "dealSettings stored as a sub-object on the deal record; currency/day1Date patch the existing top-level fields createDeal() already writes"
  - "Rollup also reports staleThresholdDays (the threshold the verdicts were judged against) so the deal-level value is observable without the PDF pack"

patterns-established:
  - "settingsResponseFor(req, s): admin gets publicSettings() unchanged, everyone else the allowlist pick"
  - "Client-read drift scan: a test fails when a page reads a settings key that is neither public nor declared admin-only"

requirements-completed: [AUTHZ-02]

duration: ~75min
completed: 2026-10-10
status: complete
actuals:
  tokens: 21600   # chars/4 over the realized diff (86,403 chars)
  tasks: 3
  commits: 3
---

# Phase 11 Plan 02: Admin-only configuration and content, public settings subset, deal-level settings Summary

**Configuration and content writes are admin-only; non-admins get an allowlisted settings subset; the Integration Lead edits currency, Day-1, synergy target, staleness and horizon on her own deal's setup route with deal > instance > default reader precedence.**

## Performance

- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 TDD)
- **Commits:** 3 task commits, suite green at each (1055 at base, 1061, 1067, 1074 at head)
- **Files:** 3 new suites, 9 modified files

## Accomplishments

- PRD acceptance 2 proven: pmo and hrbp get 403 on every config/content write (POST and DELETE), on the demo store and inside a real deal, under every spelling variant; admin is not refused; the stored collections are byte-identical after a refused write.
- GET /api/settings for every non-admin (pmo, hrbp, employee, anonymous DEMO_OPEN) contains only `PUBLIC_SETTINGS_KEYS`; the API-key and connection-string sentinels never appear.
- An hrbp member changes the five deal-level values through `POST /api/deals/:id/setup`; the staleness and phasing readers, the rollup and the PDF pack honour them; a non-member hrbp gets the same 404 as a missing deal.
- Showcase unchanged: the demo time-travel control works for admin/hrbp/pmo on the demo store; demo readers still use `db.settings`.

## Task Commits

1. **Task 1 (tracer): admin-only config writes** - `7d51677`
2. **Task 2: public settings subset** - `bc8d912`
3. **Task 3: deal-level settings on the setup route** - `c929087`

## PUBLIC_SETTINGS_KEYS and readers

| Key | Non-admin reader |
|-----|------------------|
| demoMode | pmo.js / admin.js mode toggle; pmo.js wizard-vs-dashboard routing |
| targetCompany, sector, size, hq, acquisitionDate, synergyObjective | app.js sidebar target card; transitions.js profile dropdown; dashboard.js coaching corner + process flow |
| welcomeVideoType, welcomeVideoUrl and the _en/_de/_zh/_cs variants | employee.js welcome-video player |
| roleVisibility | index.html showcase cards; transitions.js role switcher |
| doomGloballyEnabled, doomUnlockXp | employee.js TEd game gate |
| floatingMenuEnabled | transitions.js unified assistant Navigation tab |
| timeTravelDay, timelineDay | transitions.js day badge; employee.js calendar; dashboard.js diagnostics; signage.js timeline; pmo.js |
| dashboardLayoutOrder | dashboard.js widget order (written by reorder-widgets) |
| pmoCustomSetupComplete | pmo.js custom-deal setup gate |
| browserModel | transitions.js AI-Insight prompt (only whether a model is configured) |
| synergyStaleDays, synergyHorizonYears | instance defaults for the synergy readers |
| hasGeminiApiKey | boolean capability flag (admin.js hint); the key value is never included |

Excluded on purpose: `geminiApiKey`, `databaseConfig` (provider + connection details are admin-console only; declared in the drift test's `ADMIN_ONLY_CLIENT_KEYS`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Synergy suites fixed in Task 1, not Task 3**
- **Found during:** Task 1 (full-suite run after adding the admin-only rules: exactly the 12 planner-measured breaks)
- **Issue:** The plan assigns the synergy-phasing/staleness fixes to Task 3, but the rule that breaks them lands in Task 1, so the suite would be red at the Task 1 commit (project gotcha: green at every commit).
- **Fix:** In Task 1 the `/api/settings` writes in those two files go through an admin session bound to the same deal; Task 3 then converts the deal-bound cases to the setup route and asserts the bounds on both write paths, as planned.
- **Files modified:** test/synergy-phasing.test.js, test/synergy-staleness.test.js
- **Commit:** 7d51677, c929087

**2. [Rule 1 - Bug] Tests (k) and (l) of synergy-staleness were passing vacuously**
- **Found during:** Task 1
- **Issue:** They posted `synergyStaleDays` to `/api/settings` without asserting the status; once the write became a 403 they kept passing while no longer configuring anything (they were not among the 12 measured breaks).
- **Fix:** Every threshold write in the suite now asserts a 200 (deal setup route) so a refused write can never again go unnoticed.
- **Commit:** c929087

**3. [Rule 2 - Missing critical functionality] `POST /api/settings/new-ma` never exercised live in tests**
- **Found during:** Task 1 (the admin matrix run deleted a tracked `public/sent_emails/comm_*.html` from the repo working tree)
- **Issue:** The new-ma handler unlinks `comm_*` files from the repo's real `public/sent_emails/`, which a test must never do.
- **Fix:** The file was restored with a path-specific checkout; the admin row for new-ma is asserted through `roleAllowedForWrite` (policy table) instead of a live call, with a comment. Non-admin live calls are still made (they 403 before the handler).
- **Commit:** 7d51677

**4. [Interpretation] sentinel pattern vs hasGeminiApiKey**
- The plan's secret pattern `/apikey/i` also matches the permitted `hasGeminiApiKey` flag; the test exempts exactly that key and asserts it is a boolean.

### Additions beyond the plan text

- `staleThresholdDays` added to the `/api/synergies/rollup` response next to `dealSynergyTargetM`, so the plan's "synergies report staleThreshold 10" is observable over HTTP.
- `validators/wizard.js` also exports `DealSettingsSchema`.

## Authentication gates

None.

## Known Stubs

None.

## Threat Flags

None new. The deal setup route now performs a membership check; no new endpoints or file access were introduced.

## Notes for the orchestrator and later plans

- `server.js` regions touched: `ROLE_WRITE_POLICY` (top rules + trailing comment), `POST /api/settings` inline guard, `publicSettings()` neighbourhood (`settingsResponseFor`), `GET /api/settings`, `POST /api/deals/:id/setup`, `synergyHorizonYears`/`synergyStaleDays` + `dealSettingsFor`, six call sites, the rollup response. No require line at the top of the file was added or edited (`validators/settings` is resolved lazily inside `settingsResponseFor`); no `module.exports` line was added.
- 11-07 (client): pmo.js settings POSTs, the custom-setup wizard, and the AI-model download `{browserModel}` POST in transitions.js now 403 for non-admins (amendment 2 covers hiding them). The admin console receives the allowlisted subset in anonymous demo-open mode (databaseConfig and geminiApiKey hint absent) — 11-08's demo-open lane should confirm it renders without errors.
- `hrbp` Integration Leads have no UI for the new `dealSettings` yet; the route is the contract.

## Self-Check: PASSED

- test/config-admin-only.test.js, test/settings-public-subset.test.js, test/deal-settings-setup.test.js exist.
- Commits 7d51677, bc8d912, c929087 exist on the worktree branch.
- Full suite 1074/1074; `git status --porcelain data/` empty; no STATE.md / ROADMAP.md changes.
