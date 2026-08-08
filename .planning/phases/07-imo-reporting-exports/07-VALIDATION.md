---
phase: 7
slug: imo-reporting-exports
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-08
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from 07-RESEARCH.md §Validation Architecture (committed b5acd01) — that section is the authoritative requirement→test map; this file is the executor-facing contract.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` (package.json `"test": "node --test"`) — no new install |
| **Config file** | none — tests live flat under `test/*.test.js` |
| **Quick run command** | `node --test test/reports-export.test.js test/reports-pack.test.js test/reports-audit.test.js test/synergy-rollup-split.test.js test/reports-filename.test.js` (explicit files — NEVER `node --test test/` as a directory arg on this Node version) |
| **Full suite command** | `npm test` |
| **Estimated runtime** | full suite ~3s (561/561 baseline) |
| **Harness pattern** | Boot real `require('../server.js')` against isolated temp DB set via `MA_*_DB_PATH` env vars — copy `test/raid-access-filter.test.js` / `test/org-flight-risk-conversion.test.js` |

---

## Sampling Rate

- **After every task commit:** Run the quick command (the five phase test files that exist so far)
- **After every plan wave:** Run `npm test` — 561+ suite must stay green
- **Before `/gsd-verify-work 7`:** Full suite green PLUS the two UI-SPEC backstops walked live (375px/DE reflow of Reports tab + export rows — unevidenced backstops route to human_needed at verify time)
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

Authoritative map: 07-RESEARCH.md §Validation Architecture "Phase Requirements → Test Map". Load-bearing entries the planner must carry into plan must_haves verbatim:

| Req/Decision | Proof | File (Wave 0) |
|---|---|---|
| RPT-01 | CSV RFC4180-valid, content == live GET's clearance-filtered rows; JSON field-for-field == live enriched shape (D-08 parity); **four-identity RAID export test asserting SORTED ID ARRAYS, not lengths**; headers-only at zero rows | `test/reports-export.test.js` |
| Pitfall 2 | Codename with CRLF/control chars does NOT 500 the export (res.setHeader TypeError defense; RFC 5987 filename*) | `test/reports-filename.test.js` |
| RPT-02 | Pack response is well-formed `application/pdf` (`%PDF-1.4` … `%%EOF`) for populated deal; SUCCEEDS for empty deal with empty-state page; pack RAID section clearance == CSV export clearance for same caller | `test/reports-pack.test.js` |
| RPT-03 / D-01/02/03 | **BOTH DIRECTIONS IN ONE TEST**: item WITH phasing → counts in phased headline, excluded from unphased line; item WITHOUT phasing → reverse. Plus: pack synergy recap numbers EXACTLY equal `GET /api/synergies/rollup` output (no re-summation) on a rounding-edge fixture | `test/synergy-rollup-split.test.js` + `test/reports-pack.test.js` |
| RPT-04 / D-12/14 | `stale` flag renders in CSV, JSON and PDF from ONE server flag; `staleDays` change moves export and pack together | `test/reports-export.test.js` |
| D-10 / D-11 | Audit-delta: exactly ONE security-event row per export/pack call on a real deal; ZERO for identical demo call | `test/reports-audit.test.js` |
| D-09 | `dataset=positions` (any org/talent variant) is REFUSED — never silently honored | `test/reports-export.test.js` |

## Wave 0 Gaps

- [ ] `test/reports-export.test.js` — RPT-01, RPT-04 (partial), D-08, D-09
- [ ] `test/reports-pack.test.js` — RPT-02, RPT-03 (partial), D-08
- [ ] `test/reports-filename.test.js` — filename/header-injection defense
- [ ] `test/synergy-rollup-split.test.js` — RPT-03/D-01/D-02/D-03 both-directions proof
- [ ] `test/reports-audit.test.js` — D-10/D-11 audit-delta
- [ ] Live-walk item: 375px/DE reflow on Reports & Exports tab (UI-SPEC backstop — not automatable)
- [ ] Framework install: none

## Manual-Only Verifications

| Item | Why manual | When |
|---|---|---|
| 375px/DE reflow of `.rpt-export-row` + Reports pane | Visual wrap/occlusion judgment at longest translation | Phase live walk |
| PDF pack visual fidelity (TE branding, tiles, RAG strip, bars, every-page footer, DE + ZH rendering — **CJK tofu check**: explicit glyph-covering font, never default sans-serif) | Rendered-document appearance; font resolution is host-dependent (research verified macOS only) | Phase live walk, pack opened in a real viewer |
| Pack pagination at high row counts | Page-break placement is visual | Phase live walk |
