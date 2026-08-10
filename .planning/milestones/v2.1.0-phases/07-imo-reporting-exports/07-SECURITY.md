---
phase: 7
slug: imo-reporting-exports
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-08-10
audited_commit: 30d68a6
auditor_model: fable
---

# Phase 7 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time (all 7 PLAN.md `<threat_model>` blocks); audited State B
> by gsd-security-auditor on Fable (model diversity per milestone directive).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Session → export/pack routes | GET /api/reports/export and /api/reports/pack sit behind the consolidated fail-closed `/api` gate (server.js:405), not in `PUBLIC_API_PATHS` | MNPI deal data leaving the app as files |
| Clearance boundary inside a deal | Shared `reportRaidRows()` / `reportSynergyRows()` outbound filters — same functions the live GET routes use (WR-04 unified all three callers) | Clearance-scoped RAID/DD-provenance rows |
| App → circulating file | CSV/JSON/PDF artifacts leave the audit perimeter permanently | Codename-only provenance; org/talent structurally excluded (D-09) |
| Client → server inputs | Only `dataset` (zod 4-value enum) and `lang` (zod 4-value enum, `.catch('en')`) accepted; filename/timestamp/username all server-resolved | Untrusted query strings |
| Repo → supply chain | Zero new npm packages phase-wide; vendored font with recorded SHA-256 + OFL licence | Vendored binary assets |

---

## Threat Register

Full 40-row register with per-threat mitigation plans lives in the seven PLAN.md
`<threat_model>` tables (07-01 … 07-07). Audit verdict per threat, with file:line
evidence recorded in the audit run (2026-08-10, Fable):

| Threat ID | Category | Component | Severity | Disposition | Mitigation evidence (audit) | Status |
|-----------|----------|-----------|----------|-------------|------------------------------|--------|
| T-07-01 | Info Disclosure | export raid branch | critical | mitigate | `reportRaidRows()` server.js:5623 → resolveRaidEntryClearanceArea + hasAreaGrant 4069–4074; GET /api/raid delegates to same fn 4080 (WR-04 `6821f8d`); four-identity parity tests (a)/(j) | closed |
| T-07-02 | Info Disclosure | filename + Content-Disposition | high | mitigate | `buildReportFilename(deal.name…)` server.js:5696, 5823; sentinel zero-occurrence tests (b)/(m) | closed |
| T-07-03 | Tampering | setContentDisposition() | medium | mitigate | C0/DEL/bidi strip reportFilename.js:24,38; RFC 6266 + 5987 :76–78; try/catch fallback :79–82; tests (f)/(g) | closed |
| T-07-04 | Repudiation | export audit call | high | mitigate | One `'report-export'` site server.js:5717–5723, `!req.isDemo`-gated; delta tests audit (a)/(b)/(c) | closed |
| T-07-05 | Tampering | CSV field values | medium | mitigate | Formula-prefix reportCsv.js:26,46–50; WR-01 `9d34f0a` number-skip keeps string escaping in force | closed |
| T-07-06 | EoP | dataset query param | high | mitigate | Zod 4-dataset enum server.js:5601–5604, 400 pre-lane-read 5607–5610; test (d) | closed |
| T-07-07 | DoS | export route | low | accept | Synchronous string join over lanes live GETs already serve unbounded; below block threshold | closed (accepted) |
| T-07-08 | Info Disclosure | dataset branches | high | mitigate | RAID filter untouched post-branching server.js:5619–5623; both-format parity test (j) | closed |
| T-07-09 | Info Disclosure | cross-deal read | high | mitigate | All branches via readDb() under session-bound resolver server.js:5614–5615; second-deal test (l) | closed |
| T-07-10 | Tampering | JSON shape divergence | medium | mitigate | Same rows array serialised whole server.js:5700; deep-equal vs live GET test (g) | closed |
| T-07-11 | Info Disclosure | over-filtering | medium | mitigate | Identical-set four-identity assertion for unfiltered datasets, test (k) | closed |
| T-07-12 | Repudiation | audit after branching | medium | mitigate | Single call site after success, true rows.length server.js:5717 | closed |
| T-07-13 | Tampering | committed node_modules | high | mitigate | `git diff --stat 6483308~1..30d68a6 -- node_modules` EMPTY; sole lock edit `744b1d9`→canvas promotion + zod pin tightening | closed |
| T-07-14 | Info Disclosure | silent font fallback | medium | mitigate | Register-once IIFE logs `[security]` + rethrows reportPdf.js:46–63; pixel non-tofu tests (a)–(e) | closed |
| T-07-15 | DoS | canvas allocation | medium | mitigate | Fixed geometry constants, dimension validation reportPdf.js:85–90, MAX_SECTION_PAGES=4 reportPack.js:522 | closed |
| T-07-16 | Tampering | xref offsets | medium | mitigate | True byte offsets at append reportPdf.js:150–153; xref hard-fail :225–231; test (i) | closed |
| T-07-17 | Tampering | redefined gross-realized | high | mitigate | computeSynergyRollupSplit() server.js:3521–3536 (WR-05 `b119b37` unified both callers); both-directions + conservation test (a); consumer updated same commit `39e9f52` | closed |
| T-07-18 | Tampering | aggregate re-rounding | medium | mitigate | roundSynergyMoney over already-rounded items server.js:3526–3532; rounding-edge test (b) | closed |
| T-07-19 | Info Disclosure | second consumer | medium | mitigate | Grep precondition in `39e9f52`; re-verified at audit — no stale reader | closed |
| T-07-20 | Tampering | staleness threshold | medium | accept | Existing validated/capped reader reused unchanged (server.js:3333–3337, D-14); no second path | closed (accepted) |
| T-07-21 | Repudiation | unknown-age items | low | mitigate | Unparseable → stale:false, staleDays:null server.js:3350–3355, 3370–3375; tests 34/34 + (n) | closed |
| T-07-22 | Info Disclosure | pack header/footer deal name | critical | mitigate | Bands read model.deal.name only reportPack.js:181,223; targetCompany only in comments (grep-verified); sentinel tests (c) + route (a) | closed |
| T-07-23 | Info Disclosure | unmarked page | high | mitigate | Bands drawn only by renderPageFrame reportPack.js:272–288 — sections cannot render pages; frame tests (a)/(b)/(h) | closed |
| T-07-24 | Repudiation | footer provenance | medium | mitigate | model.generatedAt/generatedBy server-resolved server.js:5804–5809, same identity audit records :5834–5835 | closed |
| T-07-25 | Tampering | re-summation | high | mitigate | Tiles + stale sentence read model.rollup only reportPack.js:364–370,1024–1027; rounding-edge fixtures | closed |
| T-07-26 | Info Disclosure | unreadable CJK | medium | mitigate | Single font() helper emits REPORT_FONT_FAMILY reportPack.js:157; walk opened Chinese pack in real viewer | closed |
| T-07-27 | DoS | unbounded pagination | medium | mitigate | Ceiling in pure-arithmetic measure pass reportPack.js:537–559 before canvas allocation | closed |
| T-07-28 | Info Disclosure | pack model assembly | critical | mitigate | Pack calls identical reportRaidRows/reportSynergyRows as export (server.js:5769,5777 vs 5623,5667); pack-RAID==own-CSV test (b) | closed |
| T-07-29 | Info Disclosure | org/talent in circulating file | critical | mitigate | Structural: DEFAULT_SECTIONS 4-only reportPack.js:1169; no org model field server.js:5805–5817; lang-only query :5746,5756; injection test (d); FALCON walk file-search user-approved | closed |
| T-07-30 | Info Disclosure | withheld-row placeholder | high | mitigate | Row-count-only notice reportPack.js:562–569 unconditional; no-drawn-string /hidden\|restricted\|remaining/ test :690–711 | closed |
| T-07-31 | Repudiation | pack audit trail | high | mitigate | One `'report-pack-generated'` site server.js:5833–5844 w/ per-section counts; delta tests (d)/(e)/(f) | closed |
| T-07-32 | Tampering | client-supplied provenance | medium | mitigate | lang = entire client surface, 4-value enum `.catch('en')` server.js:5746,5756; rest server-resolved | closed |
| T-07-33 | DoS | pack on very large deal | medium | mitigate | Same measuring-pass ceiling as T-07-27; CSV-pointing truncation notice; RAID truncation test (b) | closed |
| T-07-34 | Tampering | truncated response as file | medium | mitigate | 409/500 JSON server.js:5787–5791,5848–5850; buffer awaited :5819 before send; client inline error execution.js:1126–1129 | closed |
| T-07-35 | Info Disclosure | live-walk both directions | critical | mitigate | Both directions in walk (07-07-PLAN.md:214–224) executed on FALCON, user-approved; test backstops (b)/(a)/(j)/(k) | closed |
| T-07-36 | Info Disclosure | continuation-page marking | high | mitigate | Walk step 9 all pages confirmed; structural frame + page-number tests (b)/(d) | closed |
| T-07-37 | Tampering | seed overwriting translation | medium | mitigate | Add-only hasOwnProperty skip seed-reports-i18n.js:159 (skip-if-exists realises the plan's intent — overwrite impossible; declared in script header); idempotency tests 4/4 | closed |
| T-07-38 | Tampering | WAL sidecar write | high | mitigate | wal_checkpoint(TRUNCATE) seed-reports-i18n.js:178; acceptance = real tracked-file byte diff, clean tree rejected as evidence | closed |
| T-07-39 | Repudiation | demo polluting audit ledger | medium | mitigate | Walk audit-delta check + permanent backstops audit (b)/(e): byte-identical demo requests add zero rows | closed |
| T-07-SC ×7 | Tampering | npm installs (all plans) | high | mitigate | Phase-wide manifest diff = only `744b1d9` canvas promotion; node_modules diff EMPTY; font SHA-256 `faa6c9df…5ea9` matches record, 8,331,336 B, OTTO magic, OFL.txt present | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-07-01 | T-07-07 | Export CSV is a synchronous string join (reportCsv.js:70–76) over lanes the live GET routes already serve unbounded — no new amplification surface. Low severity, below block threshold. | Plan-time disposition (07-01-PLAN.md), re-verified at audit | 2026-08-10 |
| AR-07-02 | T-07-20 | Per-deal staleness threshold reuses the existing reader unchanged — rejects non-positive/non-finite/non-numeric, caps at 365 (server.js:3333–3337, D-14). No second, weaker path was added. | Plan-time disposition (07-04-PLAN.md), re-verified at audit | 2026-08-10 |
| AR-07-03 | Residual (carried from Phase 6) | `recordSecurityEvent()` hardcodes `db_kind:'control'` for deal-scoped export/pack events (in-code note server.js:5709–5716); nothing filters on the field. Candidate for the milestone whole-codebase security pass. | Phase-6 accepted residual, re-documented | 2026-08-10 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-10 | 40 (39 unique + T-07-SC phase-wide) | 40 | 0 | gsd-security-auditor (Fable), State B from plan-time register |

Audit notes:
- WR-04/WR-05 post-review refactors verified as strictly strengthening T-07-01/T-07-28 (three callers, one RAID filter) and T-07-17/T-07-25 (two callers, one rollup split).
- T-07-29 evidence-mechanism substitution recorded: plan's instrumented org-fixture assertion realised as structural model exclusion + query-injection test + user-approved FALCON walk file-search — org names unreachable by construction, not a mitigation gap.
- Unregistered flags: none (no `## Threat Flags` in any SUMMARY; post-plan surface resolved via 07-REVIEW.md, all warnings fixed).
- Targeted test evidence: 136 tests across 9 files individually green; full suite 651/651.
- Known cosmetic gap (non-security): pack button in-flight/failure/409 strings are English-only literals, documented in seed-reports-i18n.js:46–55.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-10
