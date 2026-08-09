---
phase: 07-imo-reporting-exports
plan: 01
subsystem: api
tags: [export, csv, zod, express, sqlite, audit, rfc4180, content-disposition]

# Dependency graph
requires:
  - phase: 04-due-diligence-workspace
    provides: resolveRaidEntryClearanceArea() + accessPolicy.hasAreaGrant() (the RAID clean-room filter this plan reuses verbatim)
  - phase: 03-deal-isolation-audit-write-validation
    provides: db/auditHook.js recordSecurityEvent(), req.isDemo, req.dealContext, controlStore.getDeal()
provides:
  - GET /api/reports/export?dataset=raid&format=csv — the phase's proven export architecture (zod whitelist -> clearance filter -> RFC 4180 CSV -> safe Content-Disposition -> gated audit call)
  - lib/reportCsv.js (toCsv/csvField — reusable by every future dataset/format combination)
  - lib/reportFilename.js (sanitizeForFilename/buildReportFilename/setContentDisposition — reusable by every future export and the PDF pack)
  - the Reports & Exports execution.html tab (ex-pane-reports), wired into the tab-switch array
affects: [07-02-through-07-06 (workstreams/tasks/synergies CSV+JSON export, PDF steerco pack — all build on this tracer's architecture)]

# Actuals (#2632)
actuals:
  tokens: 11700
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Export routes reuse the exact same clearance-filter function(s) the corresponding live GET route uses, in the same order — never a second, divergent implementation (D-08)"
    - "A dataset/format zod enum IS the category-exclusion control (D-09) — no denylist branch to forget to update"
    - "Filenames and Content-Disposition headers are built from the deal codename (deal.name), never the legal target name (deal.targetCompany), via one shared sanitising helper wrapped in try/catch"
    - "Every real-deal export writes exactly one recordSecurityEvent() row, gated on !req.isDemo; demo gets full export parity with zero audit rows"

key-files:
  created:
    - lib/reportCsv.js
    - lib/reportFilename.js
    - test/reports-export.test.js
    - test/reports-filename.test.js
    - test/reports-audit.test.js
  modified:
    - server.js (GET /api/reports/export)
    - public/execution.html (Reports & Exports tab + pane)
    - public/js/execution.js (tab-switch pane array)

key-decisions:
  - "Formula-injection neutralisation (T-07-05) implemented as planner-added hardening: any CSV field whose first character is =, +, - or @ is apostrophe-prefixed before RFC 4180 quoting"
  - "Only the raid+csv combination is implemented in this tracer; every other zod-accepted dataset/format combination returns 501 (not silently honoured) until Plan 07-02"
  - "The route is placed directly after DELETE /api/raid/:id in server.js — adjacent to the other RAID read/write routes it reuses, per the plan's 'next to the other read routes' instruction"
  - "Interactive tracer feedback gate: paused after Task 1 for a human-verify checkpoint on the live route (auto mode was not active) before building the UI/tests on top of it — approved via real-browser (Playwright) verification"

patterns-established:
  - "lib/ CommonJS module shape (JSDoc header, named function declarations, one exports object) — lib/sanitizeHtml.js's precedent, now shared by two more modules"
  - "Report route audit rows accept the same db_kind:'control' labelling residual Phase 6 documented for flight-risk reads (06-RESEARCH.md A2) — not worked around, to preserve AUD-02 isolation"

requirements-completed: [RPT-01]

coverage:
  - id: D1
    description: "GET /api/reports/export?dataset=raid&format=csv returns exactly the RAID rows the caller's own GET /api/raid would show, for four distinct identities (admin, IL/hrbp, one-area member, no-area member), asserted as sorted id arrays"
    requirement: "RPT-01"
    verification:
      - kind: integration
        ref: "test/reports-export.test.js#reports-export (a)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The exported filename, Content-Disposition header and CSV body never contain the deal's legal target name — only the codename"
    requirement: "RPT-01"
    verification:
      - kind: integration
        ref: "test/reports-export.test.js#reports-export (b)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A dataset with zero visible RAID rows downloads a valid headers-only (BOM + header row) file, never an error"
    requirement: "RPT-01"
    verification:
      - kind: integration
        ref: "test/reports-export.test.js#reports-export (c)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Org/talent dataset spellings (positions, decisions, flightrisk) are refused with 400 before any lane is opened"
    requirement: "RPT-01"
    verification:
      - kind: integration
        ref: "test/reports-export.test.js#reports-export (d)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A CSV field beginning with a formula-trigger character is apostrophe-prefixed; a field with a comma and a double quote round-trips through RFC 4180 quoting"
    requirement: "RPT-01"
    verification:
      - kind: integration
        ref: "test/reports-export.test.js#reports-export (e)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A hostile deal codename (CR/LF, null byte, bidi-override, all-control, non-ASCII, reserved filesystem characters) can never 500 the export or inject a second HTTP header"
    requirement: "RPT-01"
    verification:
      - kind: unit
        ref: "test/reports-filename.test.js#reports-filename (a)-(e)"
        status: pass
      - kind: integration
        ref: "test/reports-filename.test.js#reports-filename (f)-(g)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Exactly one audit row per successful real-deal export, zero for the identical demo request, zero on a 400 refusal"
    requirement: "RPT-01"
    verification:
      - kind: integration
        ref: "test/reports-audit.test.js#reports-audit (a)-(c)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The Reports & Exports tab renders, switches correctly alongside the three pre-existing tabs, and its RAID CSV link downloads the real file — verified live against a running dev server"
    verification:
      - kind: manual_procedural
        ref: "checkpoint:human-verify (tracer feedback gate) — Playwright download-event verification against http://localhost:3450, approved by coordinator"
        status: pass
    human_judgment: true
    rationale: "Live browser click-through (anchor download behavior, tab-switch visual state) is not exercised by the node:test suite; verified via a real-browser automation pass at the tracer checkpoint instead"

duration: ~20min (across one tracer checkpoint pause)
completed: 2026-08-09
status: complete
---

# Phase 7 Plan 1: RAID CSV Export Tracer Summary

**GET /api/reports/export?dataset=raid&format=csv — the whole export architecture (zod whitelist, D-08 clearance reuse, RFC 4180 CSV writer with formula-injection neutralisation, safe Content-Disposition, gated D-10/D-11 audit) proven end to end on one dataset before Plan 07-02 expands it.**

## Performance

- **Duration:** ~20 min (Tasks 1-3), including one interactive tracer-feedback checkpoint pause
- **Completed:** 2026-08-09
- **Tasks:** 3
- **Files modified/created:** 8 (2 new lib modules, 1 route in server.js, 2 UI files, 3 new test files)

## Accomplishments
- Built `lib/reportCsv.js` (RFC 4180 quoting, CRLF terminators, UTF-8 BOM, formula-injection neutralisation for T-07-05) and `lib/reportFilename.js` (codename sanitisation, RFC 6266/5987 Content-Disposition with a safe fallback)
- Added `GET /api/reports/export` to server.js: a zod dataset/format enum IS the D-09 category-exclusion control; the raid+csv branch reuses `resolveRaidEntryClearanceArea()`/`accessPolicy.hasAreaGrant()` verbatim (D-08); every other accepted combination returns 501 pending Plan 07-02
- Added the fourth "Reports & Exports" tab to `execution.html` with one RAID/CSV export row, wired into `execution.js`'s tab-switch pane array
- Proved the whole path with 15 new tests across three files: four-identity clearance parity, sentinel (legal-target) absence, headers-only-at-zero, dataset refusal, RFC 4180/formula round-trips, hostile-codename survival, and D-10/D-11 audit row-count deltas

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end RAID CSV export (tracer)** - `6483308` (feat)
2. **Task 2: Reports and Exports tab** - `ab4439b` (feat)
3. **Task 3: Filename defence and audit scoping proofs** - `8a00841` (test)

## Files Created/Modified
- `lib/reportCsv.js` - RFC 4180 CSV writer with UTF-8 BOM and formula-injection neutralisation
- `lib/reportFilename.js` - codename sanitisation + safe RFC 6266/5987 Content-Disposition builder
- `server.js` - `GET /api/reports/export`, zod query schema, RAID+CSV branch, gated audit call
- `public/execution.html` - fourth `ex-tab`/`ex-pane-reports`, `.rpt-export-row`/`-links`/`-label` CSS, cache-stamp bump
- `public/js/execution.js` - added `'reports'` to the tab-switch pane array
- `test/reports-export.test.js` - four-identity parity, sentinel absence, empty-file, refusal, quoting/formula cases
- `test/reports-filename.test.js` - unit + integration proofs for the filename/header sanitiser
- `test/reports-audit.test.js` - D-10/D-11 audit row-count delta proofs

## Decisions Made
- Formula-trigger characters `= + - @` are apostrophe-prefixed before RFC 4180 quoting (planner discretion, IN per 07-CONTEXT.md/07-RESEARCH.md flag, T-07-05)
- The new route sits immediately after `DELETE /api/raid/:id` in server.js, alongside the RAID routes it depends on
- Zod query validation (`ReportExportQuerySchema`) lives outside `validators/index.js`'s write-only `WRITE_SCHEMAS` pipeline since this is a read route — required its own direct `require('zod')` at the top of server.js
- Per the executor's tracer-feedback gate (auto mode inactive), execution paused after Task 1 for a live human-verify checkpoint on the running route before building Task 2/3 on top of it; approved via real-browser (Playwright) verification of the download, headers, and dataset-refusal behavior

## Deviations from Plan

None — plan executed exactly as written. The formula-injection neutralisation, the 501-stub branches for not-yet-implemented dataset/format combinations, and the db_kind:'control' audit-labelling residual were all explicitly specified by the plan itself, not discovered/added mid-execution.

## Issues Encountered
- `fetch()`'s `.text()` (WHATWG "UTF-8 decode") silently strips a leading BOM per spec, which initially broke the headers-only-at-zero test assertion. Fixed by asserting the BOM at the byte level via `arrayBuffer()`/`Buffer` instead of the decoded text — the real consumer (a browser saving via `Content-Disposition: attachment`) sees the raw bytes, so this is the correct test, not a workaround.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 07-02 can now extend the `ReportExportQuerySchema` enum's remaining three 501 branches (workstreams, tasks, synergies) and add the JSON format branches, reusing `lib/reportCsv.js`/`lib/reportFilename.js` and the same clearance-reuse pattern
- The PDF steerco pack (RPT-02/03, later plans) reuses the same codename/Content-Disposition discipline established here
- Live in-app click-through of the new tab/link was proven via a real-browser checkpoint pass (Playwright), not the node:test suite — no outstanding manual verification debt for this plan

---
*Phase: 07-imo-reporting-exports*
*Completed: 2026-08-09*

## Self-Check: PASSED

All 8 created/modified files confirmed present on disk; all 3 task commit hashes (`6483308`, `ab4439b`, `8a00841`) confirmed present in `git log --oneline --all`.
