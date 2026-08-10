---
phase: 03-deal-isolation-audit-log-write-validation
plan: 06
subsystem: api
tags: [zod, express, validation, xss, sanitization, sqlite]

# Dependency graph
requires:
  - phase: 03-deal-isolation-audit-log-write-validation
    provides: "03-01: zod@4.4.3 pinned; 03-03: the consolidated /api gate (resolver -> demo-only check -> role check) that validationMiddleware now mounts inside, after the role check; 03-04: validators/deals.js's first zod validator module and its validateBody()/formatIssues() shape, generalized here; 03-05: the audit hook's actor-required writeDb() contract, unaffected by this plan"
provides:
  - "validators/index.js: WRITE_SCHEMAS registry, registerSchema()/resolveSchema(), validationMiddleware (mounted once in the consolidated /api gate), htmlField()/applySanitization() (D-15 HTML tagging with union/object/array/record recursion), formatIssues(), findUnvalidatedWriteRoutes() (shared by the reporter and the coverage test)"
  - "validators/{deals,workstream,cms,people,assessment,settings}.js: one zod schema per registered write route across every resource group — every string field bounded, unknown keys stripped by default (D-13)"
  - "lib/sanitizeHtml.js: sanitizeHtml(value) — the server-side port of public/js/page-layout.js's client-side render-time regex sanitizer"
  - "scripts/list-unvalidated-routes.js: the coverage worklist reporter (non-test, exits non-zero while any write route lacks a schema)"
  - "server.js: validationMiddleware mounted in the consolidated /api gate; every ad hoc required-field check removed from ~30 handlers (schema is the single rejection path); a malformed-JSON body now 400s instead of falling through to the generic 500 handler"
  - "test/write-validation.test.js, test/write-validation-coverage.test.js, test/xss-sanitization.test.js"
affects: []

# Actuals (#2632)
actuals:
  tokens: 33528
  tasks: 3
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Generic, path-resolved validation middleware (validators/index.js): ONE validationMiddleware mounted once in the consolidated /api gate resolves the schema for the matched route via a boundary-safe route-template regex (WRITE_SCHEMAS), rather than per-route middleware attached to each of the ~65 write handlers individually"
    - "Fail-closed-on-missing-schema: a write route with no registered schema 500s with a loud server-side log rather than passing the body through unvalidated — this is what makes findUnvalidatedWriteRoutes() a REAL enforcement mechanism, not just a lint"
    - "htmlField()/applySanitization() recursion (validators/index.js): a WeakSet tags a schema instance as HTML-bearing; sanitizeValue() recursively walks object/array/record/union zod types, propagating the tag down through containers, so a lesson/page body nested inside an i18n record or a layout-block array is sanitized correctly wherever it lives"
    - "One rejection path per route: every ad hoc `if (!x) return 400` check the plan identified as schema-redundant was removed from its handler, so a route's ONLY rejection path for a shape/presence problem is now the shared pipeline"

key-files:
  created:
    - lib/sanitizeHtml.js
    - validators/index.js
    - validators/workstream.js
    - validators/cms.js
    - validators/people.js
    - validators/assessment.js
    - validators/settings.js
    - scripts/list-unvalidated-routes.js
    - test/write-validation.test.js
    - test/write-validation-coverage.test.js
    - test/xss-sanitization.test.js
  modified:
    - validators/deals.js
    - server.js

key-decisions:
  - "Task 1 and Task 2 landed in ONE commit (c0f9a6c) rather than the plan's two — the generic validationMiddleware fails CLOSED for any write route with no registered schema, so mounting it (Task 1, with only the departments route registered) would have immediately turned every OTHER pre-existing test exercising an unvalidated route red until Task 2 registered the rest. Splitting the commits would have left an intermediate broken state with no behavioral benefit — the SAME situation and resolution Plan 03's own summary documents for its consolidated-gate rewrite. Task 3 (HTML tagging) landed as its own commit (0cf5a0f) since it did not have this same all-or-nothing coupling."
  - "WRITE_SCHEMAS is keyed on the Express ROUTE TEMPLATE string (e.g. '/api/deals/:id/members'), converted once to a boundary-safe regex ('[^/]+' per ':param' segment) — this lets ONE resolveSchema(method, path) implementation serve both a real runtime request path (validationMiddleware, at request time) and the literal template string with its ':id' placeholders still in it (findUnvalidatedWriteRoutes()'s coverage check, reading Express's own route.path), since a placeholder token like ':id' satisfies the same '[^/]+' segment a real id would."
  - "Bodyless writes (every DELETE, plus a handful of POSTs that take no payload) are registered against a shared EmptyBodySchema = z.object({}) rather than left unregistered — this is what lets the coverage gate prove a DELETE route was DELIBERATELY reviewed (and any accidental future body silently stripped) rather than exempted from the requirement."
  - "SettingsUpdateSchema (validators/settings.js) enumerates every settings key the real admin UI is observed to send today rather than using an open catchall — POST /api/settings is a config bag whose handler iterates every incoming key onto the stored settings object, so an open catchall would defeat D-13's 'nothing unvetted reaches storage' guarantee for this one endpoint. A future settings key needs a corresponding schema addition; documented as a known, intentional extension point rather than silently permissive."
  - "A malformed JSON request body (including a bare top-level 'null', which body-parser's strict mode rejects) previously fell through to the generic 500 error handler at the bottom of server.js — added a dedicated error-handling middleware right after the json/urlencoded parsers that catches body-parser's 'entity.parse.failed' and returns 400, so 'a null body never crashes' (a Task 1 acceptance criterion) actually holds. This is a real, narrow bug fix (Rule 1), not new validation logic — the fix lives at the body-parsing layer, before validationMiddleware ever runs."
  - "Two z.string() calls in the PRE-EXISTING validators/deals.js (Plan 04) had no explicit .max() — SelectDealSchema's dealId union member and DeleteConfirmSchema's confirm field, both regex/length-checked but not length-BOUNDED. Fixed to satisfy this plan's own 'no unbounded string' coverage requirement (grep -rn 'z.string()' validators/ | grep -vc 'max(' must be 0), which is repo-wide, not scoped to this plan's own new files."
  - "HTML-bearing field tagging (Task 3) is deliberately narrow: only validators/cms.js's LessonSchema.body, PageBlockDataSchema.html (the richtext block only) and PageUpsertSchema.body are tagged, verified against the ACTUAL client-side render paths (public/js/employee.js's openLessonModal, public/js/page-layout.js's REGISTRY) rather than tagging every field that plausibly COULD carry markup — every hero/cards/cta block field, every banner field, and every other CMS text field renders via esc()/textContent and stays untagged plain text, since sanitizing a field that is never rendered as markup would itself be a data-integrity risk for values like a target company name containing an ampersand."

patterns-established:
  - "Reporter-then-test pairing: scripts/list-unvalidated-routes.js and test/write-validation-coverage.test.js share ONE implementation of the coverage check (validators/index.js#findUnvalidatedWriteRoutes) rather than two independently-maintained lists — the reporter was literally the worklist used to author every schema in this plan."

requirements-completed: [VAL-01, VAL-02]

coverage:
  - id: D1
    description: "Every registered write route (POST/PUT/PATCH/DELETE) resolves to a zod schema in WRITE_SCHEMAS, proven against the live Express route inventory rather than a maintained list — a route added without a schema fails the suite (VAL-01)"
    requirement: VAL-01
    verification:
      - kind: unit
        ref: "test/write-validation-coverage.test.js#write-validation-coverage (VAL-01)"
        status: pass
      - kind: other
        ref: "command: node scripts/list-unvalidated-routes.js — exits 0, 'Every registered write route has a schema in WRITE_SCHEMAS.'"
        status: pass
    human_judgment: false
  - id: D2
    description: "A malformed payload (wrong type, missing required field, over-length value) 400s with a single-string error naming the field path and rule, never the submitted value; an unknown key is silently stripped before the handler runs (D-13)"
    requirement: VAL-01
    verification:
      - kind: unit
        ref: "test/write-validation.test.js (a)-(b)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Boundary, empty-body, encoding (UTF-16 code units not UTF-8 bytes), ordering (stable/repeatable error string) and concurrency (no cross-request bleed) edge cases all hold; the same schema rejects the same payload identically for a demo-bound and a deal-bound session (D-14, one pipeline)"
    requirement: VAL-01
    verification:
      - kind: unit
        ref: "test/write-validation.test.js (c)-(h)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A parametrized sweep across every resource group (cms/workstream/people/assessment/settings) confirms an unknown-key+invalid-field payload 400s naming the field and the group's known-good payload still succeeds with its original response shape"
    requirement: VAL-01
    verification:
      - kind: unit
        ref: "test/write-validation.test.js#write-validation: parametrized sweep"
        status: pass
    human_judgment: false
  - id: D5
    description: "No schema declares an unbounded string — every z.string() in validators/ carries an explicit .max()"
    requirement: VAL-01
    verification:
      - kind: other
        ref: "command: grep -rn \"z.string()\" validators/ | grep -vc \"max(\" -> 0"
        status: pass
    human_judgment: false
  - id: D6
    description: "HTML-bearing fields (lesson body, the richtext page-layout block, the legacy page body) are sanitized at write time via lib/sanitizeHtml.js; every other field is stored as plain text unmangled; a null/absent/non-string value in a tagged field stores as an empty string, never a stringified placeholder (VAL-02/D-15)"
    requirement: VAL-02
    verification:
      - kind: unit
        ref: "test/xss-sanitization.test.js (a)-(c)"
        status: pass
    human_judgment: false
  - id: D7
    description: "A mixed-case script tag and a whitespace-split (HTML-legal) event-handler attribute are both neutralized; an entity-encoded payload is stored inert as text and never decoded into an executable construct by the write path"
    requirement: VAL-02
    verification:
      - kind: unit
        ref: "test/xss-sanitization.test.js (d)-(e)"
        status: pass
    human_judgment: false
  - id: D8
    description: "One documented residual limitation (backstop truth, T-03-36): a nested-tag reconstruction payload survives the single-pass regex sanitizer — the same limitation the pre-existing client-side sanitizer already has, explicitly asserted and reported rather than silently hidden"
    verification:
      - kind: unit
        ref: "test/xss-sanitization.test.js#KNOWN RESIDUAL LIMITATION"
        status: pass
    human_judgment: false
  - id: D9
    description: "Every previously-working write flow still succeeds with its original response shape and status code; the Phase-2 role-enforcement suite and every other pre-existing test file stay green"
    verification:
      - kind: unit
        ref: "npm test (bare node --test): 116/116 green"
        status: pass
    human_judgment: false

duration: ~2h
completed: 2026-08-02
status: complete
---

# Phase 3 Plan 06: Generalized Write-Validation Pipeline + HTML Sanitization Summary

**One zod-based validation pipeline covering every ~65 write route in the app (unknown-key stripping, explicit length bounds, single-string 400s) plus write-time HTML sanitization for exactly the three genuinely markup-rendered fields — closing VAL-01/VAL-02, the last two Critical gaps from `.planning/codebase/CONCERNS.md`**

## Performance

- **Duration:** ~2h
- **Started:** 2026-08-02 (session start)
- **Completed:** 2026-08-02T03:50:39Z (final commit)
- **Tasks:** 3 (2 landed in one commit — see Deviations; 1 in its own commit)
- **Files modified:** 16 (11 created, 2 modified across both commits, deals.js modified in the first)

## Accomplishments
- Built `validators/index.js` — the shared, generic, path-resolved validation pipeline: `WRITE_SCHEMAS` (a route-template registry with a boundary-safe regex matcher), `resolveSchema()`, `validationMiddleware` (mounted ONCE in the consolidated `/api` gate, after the resolver bind and the role check), `htmlField()`/`applySanitization()` (D-15's HTML tagging, with a recursive `sanitizeValue()` walking zod's object/array/record/union types), `formatIssues()` (promoted from `validators/deals.js`), and `findUnvalidatedWriteRoutes()` (the coverage-check implementation shared by the reporter and the permanent test)
- Authored `lib/sanitizeHtml.js` — a faithful server-side port of `public/js/page-layout.js`'s client-side render-time regex sanitizer, with the same documented single-pass limitation and no new dependency (per 03-RESEARCH.md's "Don't Hand-Roll" table — a real DOM/allowlist parser was deliberately not adopted this phase)
- Authored one validator module per resource group — `validators/{workstream,cms,people,assessment,settings}.js` — registering a schema for every one of the ~65 registered write routes, with `validators/deals.js` (Plan 04) refactored onto the shared pipeline
- Mounted `validationMiddleware` in `server.js`'s consolidated `/api` gate and removed ~30 now-redundant ad hoc required-field checks from individual handlers, so every route has exactly one rejection path for a shape/presence problem (empty-on-update and enum-membership checks that the schema does NOT independently cover were deliberately left in place — see Deviations)
- Built `scripts/list-unvalidated-routes.js` — the coverage worklist reporter that was the actual authoring tool for this plan (run, register a schema for each printed route, re-run, repeat until empty) and is now also `test/write-validation-coverage.test.js`'s exact implementation
- Fixed a real bug the round-trip test caught during Task 3: `sanitizeValue()` had no case for zod's `union` type, so a tagged `z.union([string, i18n-record])` field (this codebase's `i18nOrString()` pattern, used for every localized CMS field) collapsed an entire i18n object down to a single `''` instead of recursing per-language — added a union branch that matches the value's runtime shape to the corresponding union member
- Fixed a pre-existing gap in `validators/deals.js` (Plan 04): two `z.string()` calls (the `dealId` union member and `confirm`) had no explicit `.max()` — bounded both to satisfy this plan's own "no unbounded string" coverage requirement, which is repo-wide across `validators/`
- Fixed a real, narrow bug: a malformed JSON body (including a bare top-level `null`, which `body-parser`'s strict mode rejects as invalid JSON) previously fell through to the generic 500 error handler — added a dedicated `entity.parse.failed` handler right after the body parsers so it 400s instead, closing a genuine "never a crash" gap the plan's own acceptance criteria required
- `npm test` (bare `node --test`): 72 (Phase 1+2+3 baseline before this plan) → 116, 0 failures throughout both commits

## Task Commits

Each task was committed atomically, with Tasks 1 and 2 combined into one commit (see Deviations):

1. **Tasks 1+2: validation pipeline, coverage gate, every route's schema** - `c0f9a6c` (feat)
2. **Task 3: HTML-bearing field tagging + write-time sanitization round-trip proof** - `0cf5a0f` (feat)

**Plan metadata:** (final docs commit follows this summary)

## Files Created/Modified
- `lib/sanitizeHtml.js` - NEW: `sanitizeHtml(value)`, the server-side sanitizer port
- `validators/index.js` - NEW: `WRITE_SCHEMAS`/`registerSchema`/`resolveSchema`/`validationMiddleware`/`htmlField`/`applySanitization`/`formatIssues`/`findUnvalidatedWriteRoutes`/`EmptyBodySchema`; the tagged-field inventory comment
- `validators/deals.js` - refactored onto the shared pipeline; `dealId`/`confirm` now `.max()`-bounded
- `validators/workstream.js` - departments/processes/integration-tasks(+instantiate/from-remediation)/synergies/raid/modules/dashboard-reorder-widgets
- `validators/cms.js` - courses/lessons/i18n/menus/pages(+layout blocks)/banners/media/slides(+upload); the three `htmlField()` tags
- `validators/people.js` - employees/lesson-complete/lesson-uncomplete/award-merit/hrbps/alerts/pulses/communications-send
- `validators/assessment.js` - questions(+reorder)/legacy-assessment-submit/assessment-instances
- `validators/settings.js` - auth/change-password/settings/settings-new-ma/time-travel/projects(+activate)/rag-upload/admin-migrate-db/admin-revoke-sessions
- `scripts/list-unvalidated-routes.js` - NEW: the coverage worklist reporter
- `server.js` - `validationMiddleware` mounted; ~30 ad hoc required-field checks removed; malformed-JSON-body 400 handler added; `compileHtmlEmail()`'s header comment updated to describe the current three-layer XSS control
- `test/write-validation.test.js` - NEW: 9 cases (a-h + the parametrized cross-group sweep)
- `test/write-validation-coverage.test.js` - NEW: the permanent coverage gate
- `test/xss-sanitization.test.js` - NEW: 5 required cases + 1 explicitly-documented residual-limitation case

## Decisions Made
See `key-decisions` in the frontmatter above — summarized: Tasks 1+2 combined into one commit (fail-closed validation cannot be mounted incrementally without breaking every unvalidated route's existing tests, matching Plan 03's own precedent); `WRITE_SCHEMAS` keyed on route templates so one matcher serves both request-time and coverage-check-time lookups; bodyless writes registered against a shared `EmptyBodySchema` rather than exempted; `SettingsUpdateSchema` enumerates known keys rather than using an open catchall (D-13); a malformed-JSON-body 400 handler added at the body-parsing layer; two pre-existing unbounded `z.string()` calls in `validators/deals.js` fixed; HTML tagging kept deliberately narrow to the three fields actually rendered as markup.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - bug] `sanitizeValue()` had no case for zod's `union` type, collapsing a tagged i18n-record field to `''`**
- **Found during:** Task 3, `test/xss-sanitization.test.js`'s own round-trip case (a)
- **Issue:** `validators/cms.js`'s `i18nOrString()` returns `z.union([z.string(), z.record(...)])`. `validators/index.js`'s `sanitizeValue()` dispatched only on `object`/`array`/`record` container types; a `union`-typed tagged field fell straight to the leaf branch, which returned `''` for any non-string value — so a page body sent as `{en: '<script>...'}` (an object, not a string) sanitized to the bare string `''` instead of `{en: 'sanitized text'}`.
- **Fix:** Added a `union` branch to `sanitizeValue()` that matches the value's ACTUAL runtime shape (string/array/object) to the corresponding union member schema and recurses into it with the same `tagged` flag.
- **Files modified:** `validators/index.js`
- **Verification:** `test/xss-sanitization.test.js` (a), (c) — round-trip and empty-value cases both pass; full regression green (116/116).
- **Committed in:** `0cf5a0f` (Task 3)

**2. [Rule 1 - bug] A malformed JSON body (including a bare top-level `null`) 500ed instead of 400ing**
- **Found during:** Task 1, `test/write-validation.test.js` case (d)'s null-body assertion
- **Issue:** `body-parser`'s strict JSON mode rejects a bare top-level `null` as invalid JSON (only object/array are valid top-level JSON in strict mode), throwing a `SyntaxError` that fell through to `server.js`'s generic bottom-of-file error handler — returning 500, not the 400 the plan's own "never a crash" acceptance criterion requires for a null body.
- **Fix:** Added a dedicated error-handling middleware immediately after `express.json()`/`express.urlencoded()` that catches `err.type === 'entity.parse.failed'` and returns 400 with a clear error, before the request ever reaches the generic handler.
- **Files modified:** `server.js`
- **Verification:** `test/write-validation.test.js` (d) passes; full regression green.
- **Committed in:** `c0f9a6c` (Tasks 1+2)

**3. [Rule 2 - missing critical functionality] Two pre-existing `z.string()` calls in `validators/deals.js` (Plan 04) had no explicit `.max()`**
- **Found during:** Task 2's acceptance-criteria verification (`grep -rn "z.string()" validators/ | grep -vc "max("`, which is repo-wide, not scoped to this plan's own new files)
- **Issue:** `SelectDealSchema`'s `dealId` union member (`z.string().regex(DEAL_ID_PATTERN, ...)`) and `DeleteConfirmSchema`'s `confirm` field were regex/length-checked but carried no upper bound — an arbitrarily long string satisfying the regex pattern (many alphanumeric characters) would still pass.
- **Fix:** Added `.max(DEAL_ID_MAX)` (120, a generous bound over `newId('deal')`'s actual length) to both.
- **Files modified:** `validators/deals.js`
- **Verification:** the repo-wide grep now returns 0; `test/deal-registry.test.js`/`test/deal-lifecycle.test.js` still 14/14 green.
- **Committed in:** `c0f9a6c` (Tasks 1+2)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bugs, 1 Rule 2 missing-bound fix) — all caught by this plan's OWN acceptance criteria (a passing test or a passing source-grep check), none discovered after the fact.
**Impact on plan:** None on delivered behavior — every VAL-01/VAL-02 acceptance criterion in the plan is met; each fix was necessary for the plan's own stated acceptance criteria to actually hold.

## Issues Encountered
- Task 1's own acceptance criterion ("Regression: every other test file stays green") could not literally hold at Task 1's OWN commit boundary once the fail-closed `validationMiddleware` was mounted with only the departments route registered — every OTHER pre-existing test exercising an unvalidated write route (change-password, time-travel, admin revoke-sessions, …) would 500 until Task 2 registered the rest. Resolved by combining Tasks 1 and 2 into one commit (see Deviations decision above and Plan 03's own documented precedent for the same class of situation).
- ~30 ad hoc required-field checks were removed from server.js handlers per Task 2's "one rejection path" instruction; a smaller number of enum-membership and empty-on-UPDATE checks (tasks/synergies/raid's "Invalid status"/"title cannot be empty on update") were deliberately LEFT IN PLACE where the registered schema's own `.refine()` (id-present-or-title-required) does not independently cover that exact case — removing those would have been a real regression, not a cleanup.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- Phase 3 is now 6/6 plans complete. VAL-01 and VAL-02 close the last two Critical items from `.planning/codebase/CONCERNS.md` (the concurrent-write race closed in Phase 1, missing input validation closed here).
- `validators/index.js`'s `WRITE_SCHEMAS`/`registerSchema`/`htmlField` pattern is a reusable asset for every write model Phases 4-7 add — a new write route registers its schema in the appropriate `validators/*.js` module (or a new one) and `test/write-validation-coverage.test.js` will fail the suite if it's forgotten.
- Known, explicitly documented residual limitation (not blocking, matches the pre-existing client-side sanitizer's own limitation): `lib/sanitizeHtml.js`'s single-pass regex does not neutralize a nested-tag reconstruction payload (`<scr<script>ipt>...`) — recorded in `test/xss-sanitization.test.js` and this plan's own threat register (T-03-36, accepted risk). A robust allowlist HTML parser remains the documented future upgrade path if this class of risk needs closing.
- No blockers.

---
*Phase: 03-deal-isolation-audit-log-write-validation*
*Completed: 2026-08-02*

## Self-Check: PASSED

All created files verified present on disk; commit hashes (`c0f9a6c`, `0cf5a0f`) verified present in `git log --oneline --all`.
