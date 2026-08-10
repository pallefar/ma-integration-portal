# Phase 7: IMO Reporting & Exports - Pattern Map

**Mapped:** 2026-08-08
**Files analyzed:** 11 (new/modified)
**Analogs found:** 9 / 11 (2 flagged greenfield — no in-repo precedent, RESEARCH.md is the analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|-----------------|----------------|
| `server.js` — `GET /api/reports/export` | route/controller | request-response (file download) | `server.js:1102` `GET /api/admin/download-zip` (download shape) + `server.js:3906-3916` `GET /api/raid` (clearance filter shape) | role-match (composite) |
| `server.js` — `GET /api/reports/pack` | route/controller | request-response (binary blob) | same two analogs above, plus `GET /api/synergies/rollup` (`server.js:3372-3406`) as the single-source-of-truth pattern | role-match (composite) |
| `server.js` — `computeWorkstreamRollup(db)` | service (pure fn) | transform/CRUD-read | `public/js/execution.js:76-144` (client-side original) + `synergyRollupFields()`/`enrichSynergy()` in `server.js` (server-side rollup convention) | exact (client→server port of a named function) |
| `server.js` — synergy rollup split fields (`grossRealizedM`/`unphasedRealizedM`) | service (pure fn, extend existing) | transform | `GET /api/synergies/rollup` `server.js:3372-3406` (extend in place) | exact |
| `lib/reportCsv.js` (new) | utility | transform | none in-repo — greenfield; RESEARCH.md Code Examples §"CSV writer" is the canonical starting point | no analog (research-authored) |
| `lib/reportFilename.js` (new) | utility | transform | none in-repo — greenfield; RESEARCH.md Code Examples §"Safe filename + Content-Disposition" | no analog (research-authored) |
| `lib/reportPdf.js` (new) | utility/service | file-I/O (binary assembly) | none in-repo — greenfield; RESEARCH.md §"Minimal PDF 1.4 container" | no analog (research-authored) |
| `lib/reportPack.js` (new) | service | transform + file-I/O | closest partial analog: `@napi-rs/canvas` usage pattern in RESEARCH.md Pattern 3 (no repo consumer exists — this is the FIRST); i18n-resolve pattern mirrors `public/js/transitions.js`'s `t(key, lang)` | role-match (composite, first-of-kind) |
| Audit call sites (export + pack generation) | middleware/event-driven | event-driven | `server.js:4507-4522` flight-risk dual-audit call (`org-flightrisk-access-denied` / `org-flightrisk-read`) | exact |
| `public/execution.html` — 4th "Reports & Exports" tab + pane | component | request-response (static) | 3 existing tab buttons/panes `execution.html:157-161`, `:191`, `:213`; export row styling from `.raid-row` `execution.html:96` | exact |
| `public/js/execution.js` — tab wiring + CSV/JSON links + PDF fetch/blob button | component/hook | request-response, streaming (blob) | tab-switch array `execution.js:1050`; CSV/JSON link = `public/admin.html:666` download-zip `<a href>` pattern; PDF button = `public/js/admin-cms.js:35-38` disabled+label-swap idiom | exact (composite of two precedents) |
| `test/report-*.test.js` (×5, new) | test | request-response (integration) | `test/raid-access-filter.test.js:1-60` (temp-DB harness: `MA_*_DB_PATH` env vars, `require('../server.js')`, seeded users/deals, cookie sessions) | exact |
| i18n keys `rpt.*` | config (data) | CRUD | `db.i18n.strings[lang][key]` seeding precedent — no single canonical seed script cited in RESEARCH; follow Phase 5/6 "carry-verbatim or ship English + rely on fallback" convention already stated in 07-UI-SPEC.md | role-match |

## Pattern Assignments

### `server.js` — `GET /api/reports/export?dataset=&format=` (route, request-response)

**Analogs:** `server.js:1102` (`download-zip`, file-download shape) + `server.js:3906-3916` (`GET /api/raid`, clearance-filter shape) + `server.js:3372-3406` (`GET /api/synergies/rollup`, JSON parity shape)

**Clearance-reuse pattern** (verified, `server.js:3890-3916`):
```javascript
function resolveRaidEntryClearanceArea(entry, db) {
  if (entry && entry.clearanceArea) return entry.clearanceArea;
  const source = entry && entry.source;
  if (!source) return null;
  const ddMatch = /^dd-finding:(.+)$/.exec(source);
  if (ddMatch) {
    const finding = ddFindingsLane(db).find((f) => f.id === ddMatch[1]);
    return finding ? finding.area : null;
  }
  if (source.indexOf('org-flightrisk:') === 0) return 'hr';
  return null;
}

app.get('/api/raid', (req, res) => {
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  ddFindingsLane(db);
  const visible = raidLane(db).filter((entry) => {
    const area = resolveRaidEntryClearanceArea(entry, db);
    return area === null || accessPolicy.hasAreaGrant(deal, req.portalUser, area);
  });
  res.json(visible);
});
```
The export route's `dataset === 'raid'` branch MUST call `resolveRaidEntryClearanceArea` + `accessPolicy.hasAreaGrant` identically — never a second implementation (D-08).

**Download-response shape** (`server.js:1102-1119`, `download-zip`):
```javascript
app.get('/api/admin/download-zip', (req, res) => {
  try {
    // ... build artifact ...
    res.download(zipPath, 'te-ma-integration-portal.zip', (err) => {
      if (err) console.error('Error sending zip file to browser:', err);
      fs.unlink(zipPath, () => {});
    });
  } catch (error) {
    console.error('Error generating zip archive dynamically:', error);
    res.status(500).json({ error: 'Failed to compile and zip the application package. Please ensure zip utility is available.' });
  }
});
```
Export route (CSV/PDF/JSON) should follow the same try/catch → `console.error` → `500 { error }` shape, but MUST use `res.setHeader('Content-Disposition', ...)` + `res.send(body)` rather than `res.download()` (no temp file needed for CSV/JSON; PDF pack buffer is also sent directly, not written to a temp file first, per RESEARCH.md's two-pass in-memory layout).

**Error handling:** two-tier `console.error`/`console.warn` convention; wrap the whole `Content-Disposition` header-set in try/catch per Pitfall 2 (`lib/reportFilename.js`'s `setContentDisposition()` — see Shared Patterns below).

---

### `server.js` — `computeWorkstreamRollup(db)` (service, transform)

**Analog:** `public/js/execution.js:76-144`'s `render()` client-side math (the function being ported), and `server.js`'s own `synergyRollupFields()`/`enrichSynergy()` idiom for "server function producing the same numbers the screen already derives."

**Core pattern** (already drafted and verified in RESEARCH.md against real server.js symbols `taskLane(db)` and `db.checklistTemplates[0]`):
```javascript
function computeWorkstreamRollup(db) {
  const tpl = (db.checklistTemplates || [])[0];
  const workstreams = (tpl && tpl.workstreams) || [];
  const tasks = taskLane(db);
  return workstreams.map((w) => {
    const ts = tasks.filter((t) => t.workstreamId === w.id);
    const done = ts.filter((t) => t.status === 'done').length;
    const blocked = ts.some((t) => t.status === 'blocked');
    const pctComplete = ts.length ? Math.round((done / ts.length) * 100) : 0;
    return { id: w.id, label: w.label, tasksTotal: ts.length, tasksDone: done, pctComplete, blocked };
  }).filter((w) => w.tasksTotal > 0);
}
```
Place adjacent to `taskLane(db)` (`server.js:2908`) per the codebase's "define near first use" convention observed for `resolveRaidEntryClearanceArea`/`GET /api/raid` and `synergyRollupFields`/`GET /api/synergies/rollup`.

---

### `server.js` — synergy rollup split fields (D-01/D-02, extend in place)

**Analog:** `GET /api/synergies/rollup`, `server.js:3372-3406` (read the full body above — this is the function to extend, not replace).

**Pattern to follow exactly** (existing rounding + single-clock discipline):
```javascript
const grossRealizedM = roundSynergyMoney(enriched.reduce((a, i) => a + (i.realizedM || 0), 0));
// ... existing fields unchanged ...
```
New fields (`unphasedRealizedM`, and per Pitfall 3's resolved reading: redefine `grossRealizedM` to sum only `Array.isArray(item.phasing) && item.phasing.length > 0` items, add `unphasedRealizedM` for the complement) must reuse the exact `roundSynergyMoney()` per-item-then-sum discipline already used for `grossRealizedM`/`costIncurredM`/`dealTargetM` — never re-round the aggregate upward (existing comment at `server.js:3372` states this invariant explicitly; keep it in any diff).

---

### Audit call sites for exports/pack (event-driven)

**Analog:** `server.js:4507-4522`, flight-risk dual-audit pattern:
```javascript
app.get('/api/org/flight-risk', (req, res) => {
  const deal = controlStore.getDeal(req.dealContext.dealId);
  if (!accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    auditHook.recordSecurityEvent({
      actor: req.portalUser, action: 'org-flightrisk-access-denied', dealId: req.dealContext.dealId,
      subject: null, before: null, after: null, request: requestMeta(req),
    });
    return res.status(403).json({ error: 'You are not cleared to view the flight-risk register.' });
  }
  auditHook.recordSecurityEvent({
    actor: req.portalUser, action: 'org-flightrisk-read', dealId: req.dealContext.dealId,
    subject: null, before: null, after: null, request: requestMeta(req),
  });
  const db = readDb();
  res.json(orgFlightRiskLane(db));
});
```
Export/pack routes: call `auditHook.recordSecurityEvent({ actor: req.portalUser, action: 'report-export' | 'report-pack-generated', dealId, subject: { dataset, format }, before: null, after: { rowCount }, request: requestMeta(req) })` — but gated `if (!req.isDemo)` per D-11 (demo mode gets no audit rows, matching Phase-3 D-08's precedent — there is no repo citation for this specific `isDemo` gate pattern in the flight-risk route since flight-risk audits unconditionally; confirm the `req.isDemo` flag's exact name/shape at another Phase-3 D-08 call site before implementing — flagged for the planner, not resolved here).

**Known, accepted residual** (do not attempt to fix in this phase): `db/auditHook.js`'s `recordSecurityEvent()` hardcodes `dbKind: 'control'` for every caller (see `server.js:4506-4511` comment block, "KNOWN, ACCEPTED LABELLING GAP"). Export/pack audit rows inherit the identical residual — document in this phase's own SECURITY.md rather than re-opening the fix (Pitfall 4).

---

### `public/execution.html` — 4th tab + pane (component)

**Analog:** existing 3 tabs, `execution.html:157-161` (button markup) and `:191`/`:213` (pane divs).

```html
<button class="ex-tab" data-ex-tab="reports" data-i18n="exec.tab_reports">Reports &amp; Exports</button>
```
```html
<div id="ex-pane-reports" style="display:none;">
  <!-- export rows + pack card -->
</div>
```
Export row styling lifted from `.raid-row` (`execution.html:96`): `background:var(--card-bg,#fff); border:1px solid var(--border-color); border-radius:10px; padding:.6rem .9rem; margin-bottom:.45rem; display:flex; align-items:center; justify-content:space-between; gap:.75rem;`

**No new CSS file** — append rules to `execution.html`'s existing page-local `<style>` block (Phase-6 precedent, cited in 07-UI-SPEC.md §1).

---

### `public/js/execution.js` — tab wiring + export links + pack button (component/hook)

**Critical fix required, not optional** — the tab-switch handler hardcodes the pane-id array:
```javascript
// server.js line numbers n/a — this is public/js/execution.js:1050
['tasks', 'synergy', 'raid'].forEach(function (p) {
  document.getElementById('ex-pane-' + p).style.display = p === tab ? 'block' : 'none';
});
```
MUST become `['tasks', 'synergy', 'raid', 'reports']` or the new tab button renders inert (UI-SPEC §2 Design Tension #2, explicitly flagged).

**CSV/JSON links** — plain `<a href>` navigation, analog `public/admin.html:666`:
```html
<a href="/api/admin/download-zip" class="btn btn-primary" ...>Download Portable App Zip</a>
```
Apply identically but `btn-secondary` (per Color contract, CSV/JSON get secondary styling): `<a href="/api/reports/export?dataset=workstreams&format=csv" class="btn btn-secondary rpt-export-link" data-i18n="rpt.csv">CSV</a>`. No client JS handler needed — session cookie travels with plain navigation.

**PDF pack button** — disabled+label-swap idiom, analog `public/js/admin-cms.js:35-38`:
```javascript
const btn = foot.querySelector('.cms-save');
btn.disabled = true; btn.textContent = 'Saving…';
try { await onSave(); close(); } catch (e) { console.error(e); toast('Save failed.', true); btn.disabled = false; btn.textContent = 'Save'; }
```
Port to: `btn.disabled = true; btn.textContent = 'Generating pack…';` → `fetch('/api/reports/pack?lang=...')` → on success, blob + synthetic `<a>` click download, restore button; on failure, `errorEl.style.display = 'block'` (never `''` — Phase 4/6 invisible-error countermeasure) + restore button.

---

### `test/report-*.test.js` ×5 (test, request-response integration)

**Analog:** `test/raid-access-filter.test.js:1-60` — full harness shape to copy verbatim:
```javascript
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-raid-access-filter-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-raid-access-filter-test-token';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const app = require('../server.js');
// ... seed users/deals directly into controlConn, create sessions, bind deal ...
```
Assert exported row sets as **sorted arrays of ids**, never a length (comment at top of the analog explicitly names this as the anti-over-filter discipline — "an over-filter... and an under-filter are both caught by the same assertion"). Test files should cover: (1) CSV/JSON RAID clearance parity vs `GET /api/raid`, (2) workstream rollup number parity vs what `execution.js` would compute, (3) synergy split invariant (`grossRealizedM + unphasedRealizedM === old undifferentiated total`), (4) filename/Content-Disposition sanitization (Pitfall 2's embedded-CR/LF case), (5) demo-mode audit-row absence (D-11) vs real-deal audit-row presence (D-10).

---

## Shared Patterns

### Clearance-filter reuse (D-08)
**Source:** `server.js:3890-3916` (`resolveRaidEntryClearanceArea` + `accessPolicy.hasAreaGrant`)
**Apply to:** `GET /api/reports/export?dataset=raid`, and by extension the pack's RAID section — both must call this exact function, never re-derive.

### Audit dual-event shape (D-10/D-11)
**Source:** `server.js:4507-4522` (`recordSecurityEvent`)
**Apply to:** Every export and pack-generation route, gated on `!req.isDemo`.

### Content-Disposition / filename safety (Pitfall 2)
**Source:** RESEARCH.md's `lib/reportFilename.js` sketch (no in-repo precedent — first HTTP-header consumer of `deal.name`)
```javascript
const CONTROL_OR_BIDI_CHARS = /[\x00-\x1F\x7F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
function sanitizeForFilename(raw) {
  return String(raw || '').replace(CONTROL_OR_BIDI_CHARS, '').trim() || 'deal';
}
```
**Apply to:** Every route building a filename or header from `deal.name` (never `deal.targetCompany` — D-07/D-09).

### Two-tier logging
**Source:** codebase-wide convention (`console.error` for halting failures, `console.warn` for recoverable/security notes, `console.log` for info) — apply to every new PDF/export failure path per CLAUDE.md §Error Handling.

### i18n fallback-to-English
**Source:** `public/js/transitions.js`'s `t(key, lang)` — `(s[lang] && s[lang][key]) || (s.en && s.en[key]) || null`
**Apply to:** `lib/reportPack.js`'s `packT(db, lang, key, fallbackText)` helper (server-side port, same fallback order).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `lib/reportPdf.js` | utility (PDF 1.4 writer) | file-I/O | No PDF-writing code exists anywhere in the repo; `@napi-rs/canvas` is vendored but currently `require()`-d nowhere. RESEARCH.md's "Minimal PDF 1.4 container" code sketch (object/xref/trailer assembly) is the closest thing to an analog and should be used as the literal starting point. |
| `lib/reportPack.js` (canvas page-rendering half) | service | transform + file-I/O | First consumer of `@napi-rs/canvas` in this codebase — RESEARCH.md's Pattern 3 (`renderPageToRgbStream`) is research-verified working code, not a repo analog, but is the equivalent artifact for planning purposes. |

## Metadata

**Analog search scope:** `server.js` (routes, RAID/synergy/audit sections), `public/js/execution.js`, `public/js/admin-cms.js`, `public/admin.html`, `public/execution.html`, `test/raid-access-filter.test.js`, `db/auditHook.js`, `package.json`
**Files scanned:** ~9 files read/grepped directly, plus RESEARCH.md and UI-SPEC.md as the primary requirement/architecture sources
**Pattern extraction date:** 2026-08-08
