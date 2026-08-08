# Phase 7: IMO Reporting & Exports - Context

**Gathered:** 2026-08-08
**Status:** Ready for planning

<domain>
## Phase Boundary

The Integration Lead produces trustworthy status output from live deal data: raw exports (CSV and JSON) of workstreams, tasks, RAID and synergies, plus a formatted PDF steering-committee pack — replacing manual deck assembly. Last phase by data dependency (needs Phase 4 DD + Phase 5 synergy data models; both complete). Requirements RPT-01..04. Formats locked at requirements gate: CSV/JSON + PDF, **no PPTX**; capability order ships raw export before PDF.

</domain>

<decisions>
## Implementation Decisions

### T-05-47 — headline integrity (closes the Phase-5 standing debt; decide-before-RPT-03 satisfied)
- **D-01:** The synergy headline **splits phased-backed from unphased realized money**. `grossRealizedM` in the steerco pack counts only phased-backed amounts; unphased free-typed money appears as a separate, labelled "unphased" line. No write-path gating — Phase 5's quick-entry UX stands. — **Reversibility:** costly — the pack's headline semantics become the steerco's number; changing what "gross" means after packs have circulated re-baselines every prior report.
- **D-02:** The split is computed **once, in `GET /api/synergies/rollup`** (new fields alongside the existing `grossRealizedM`/`unconfirmedRealizedM` family, following that precedent's item-level-rounding discipline). The PDF pack AND the execution-tab UI both render from the rollup — one source of truth, screen and pack can never disagree.
- **D-03:** "Unphased" is **derived at read time** (entry has zero phasing rows when the rollup runs). No migration, no stored flag; self-correcting the moment phasing is added.

### Steerco pack composition (RPT-02)
- **D-04:** Structure = **one-page executive summary first** (headline numbers incl. the D-01 split, RAG-style workstream strip, top risks), then one section each for workstreams/tasks, RAID, synergies.
- **D-05:** Visual identity = **TE deck branding**: TE logo (`public/te-logo.png`, already the app header logo), deal name, date in the header; consistent with the v1.3.0 slidedeck look.
- **D-06:** Numbers = **tables plus a few simple horizontal bars** (synergy phased-vs-unphased, workstream progress) drawn with the already-vendored `@napi-rs/canvas` — no new chart library.
- **D-07:** **Every page carries the confidentiality footer**: `CONFIDENTIAL — <project codename> · generated <timestamp> · by <username>`. Codename, **never the target's legal name pre-announcement** (MNPI discipline). The file leaves the app; it must carry its own handling instructions and provenance. — **Reversibility:** reversible, but treat as a compliance floor: removing marks from a circulating-artifact format is a policy change, not a styling change.

### Export access & audit (RPT-01)
- **D-08:** **Any deal member can export** — but the file contains exactly what the app would show that caller: the same outbound filters (RAID provenance/`clearanceArea`, area grants, restricted-tier absence) apply to export payloads identically. Export is a read surface, never a bypass. No new permission tier. — **Reversibility:** costly — this is the clean-room contract extended to files; weakening it later means re-auditing every export consumer.
- **D-09:** **Org/talent data is excluded from exports and the pack entirely** (positions, decisions, flight-risk). RPT-01/02 name workstreams, tasks, RAID, synergies — that is the whole export surface. Named-people MNPI never lands in an emailable file; the Phase-6 registers remain the only window. — **Reversibility:** one-way in spirit — once a retention list has ever been exportable, the guarantee "people data never leaves the app" is unmakeable; treat inclusion as a future deliberate decision with its own gate, not an extension.
- **D-10:** **Every export and pack generation writes an audit event**: who, deal, format (csv/json/pdf), scope, row counts. Same doctrine as the Phase-6 flight-risk read audit (D-03 there): MNPI leaving the system is the audit log's core question. Real deals only (see D-11).
- **D-11:** **Demo mode gets full export parity** (the showcase should demonstrate reporting — it is a selling point; demo data is fictional). No audit rows in demo, matching Phase-3 D-08's audit scoping.

### Staleness presentation (RPT-04) + D-23 carry-over
- **D-12:** Stale items render **inline where they are read**: dimmed + "stale Nd" tag with last-updated date on the row, AND the exec summary shows the `staleCount` headline. No stale-appendix — main tables must never present stale numbers as current.
- **D-13:** **Phase-6 D-23 stands**: the flight-risk register gets no staleness signal (a retention conversation does not go stale the way a synergy number does), and the question is moot for the pack since org/talent is excluded (D-09). Revisit only on evidence from a real deal. This closes the STATE.md Phase-7 carry-over blocker.
- **D-14:** Staleness threshold = **the per-deal `staleDays` setting, reused as-is** (SYN-05 semantics, exactly-N-days-is-not-yet-stale boundary, never-default-unknown-to-stale). One knob; screen and pack move together.

### Claude's Discretion
- PDF generation mechanism (the HOW): research decides between @napi-rs/canvas PDF surface, a minimal hand-rolled PDF writer, print-CSS routes, or another zero-new-dependency approach. Constraint: vanilla stack, no build step, no CDN, works in the zero-install bundle on all three platforms. New npm dependencies only via the Package Legitimacy Gate, and prefer none.
- CSV column contracts, escaping/encoding (Excel-compatible UTF-8 handling), and JSON export shape.
- Export/pack filenames (should carry codename + date, not target legal name — extension of D-07's discipline).
- Where the export/pack UI lives (execution tab vs deal home vs both) and its generation UX (inline download vs async), subject to ui-phase.
- Pack pagination/typography details within D-04..07.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Rollup & staleness (the data the pack reports)
- `server.js` ~3270-3400 — existing rollup: `grossRealizedM`/`unconfirmedRealizedM`/`costIncurredM`/`netBenefitM`/`staleCount`, `isSynergyStale()` (SYN-05 boundary contract), item-level rounding discipline D-01/D-02 must follow.
- `.planning/phases/05-synergy-value-capture/05-SECURITY.md` §T-05-47 — the exact reproduced residual D-01 closes (including the 0.9→10.8 repro).

### Clearance filters exports must reuse (never reimplement)
- `server.js` ~3870-3916 — `resolveRaidEntryClearanceArea()` + the GET /api/raid provenance filter (WR-03 `clearanceArea` stamp preferred, source-parse fallback).
- `db/accessPolicy.js` — `grantedAreas()`/`hasAreaGrant()`/`filterByAreaGrant()` (admin/hrbp short-circuit).
- `.planning/phases/06-org-design-talent-retention/06-SECURITY.md` — the outbound-clearance doctrine exports extend (T-06-42/43/51).

### Audit doctrine for D-10
- `db/auditHook.js` — `recordSecurityEvent()` (note: hardcodes `db_kind:'control'`, accepted residual; export events should set kind correctly if cheap, see 06-SECURITY.md Notes).
- `server.js` ~4507-4519 — the flight-risk dual-audit call sites (the D-03 pattern D-10 mirrors).

### Branding & confidentiality
- `public/te-logo.png` + the v1.3.0 slidedeck styling precedent (memory: TE deck logos) — D-05's look.
- `.planning/PROJECT.md` §Constraints — MNPI/codename discipline behind D-07/D-09.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Synergy rollup endpoint + `isSynergyStale()` — D-01/D-02/D-14 extend these, no re-derivation.
- `@napi-rs/canvas` v0.1.80 — vendored with prebuilds for all release platforms, currently UNUSED (the stack doc's "PDF export" line was aspirational): candidate for D-06 bars and possibly PDF generation itself.
- `pdf-parse` / `pdfjs-dist` are extraction/rendering only — NOT generators; do not mistake them for a PDF-writing capability.
- Print CSS precedent exists (`public/css/style.css:7556,7685`; `assessments.html`).
- Admin `download-zip` route — the only file-download precedent (Content-Disposition handling to mirror).

### Established Patterns
- Outbound clearance filtering (Ph6) — exports are just another consumer.
- Read-audit call-site pattern (Ph6 D-03) — D-10 mirrors it.
- Cache-stamp bumps for changed client scripts; i18n wrap-never-clip applies to any new UI chrome.

### Integration Points
- `GET /api/synergies/rollup` gains the D-01 split fields; execution-tab UI re-renders from them.
- New export routes join the existing `/api` gate (fail-closed, role/write policy untouched — exports are GETs/POSTs per design in planning).
- Audit events via the established audit.db append path.

</code_context>

<specifics>
## Specific Ideas

- The pack replaces "manual deck assembly" — the artifact the steerco already receives, but generated. TE-branded like the in-app slidedeck (v1.3.0 look), codename-only confidentiality footer on every page with generation provenance.
- Exec summary page 1 is the product: headline numbers (with the phased/unphased split visible), RAG workstream strip, top risks.

</specifics>

<deferred>
## Deferred Ideas

- PPTX export — explicitly rejected at the requirements gate; do not revisit this milestone.
- Org/talent data in exports for hr-cleared callers — deliberately excluded (D-09); if ever wanted, it is its own gated decision, not an extension.
- Flight-risk staleness signal — D-23 stands; revisit only on real-deal evidence.
- Scheduled/emailed report delivery — out of scope (no outbound email infrastructure this milestone; x2j quick-task gitignored future outbound emails for a reason).

</deferred>

---

*Phase: 07-imo-reporting-exports*
*Context gathered: 2026-08-08*
