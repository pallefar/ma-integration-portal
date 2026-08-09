---
phase: 07-imo-reporting-exports
reviewed: 2026-08-09T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - lib/reportCsv.js
  - lib/reportFilename.js
  - lib/reportPack.js
  - lib/reportPdf.js
  - package.json
  - public/execution.html
  - public/js/execution.js
  - public/vendor/fonts/OFL.txt
  - scripts/seed-reports-i18n.js
  - server.js
  - test/reports-audit.test.js
  - test/reports-export.test.js
  - test/reports-filename.test.js
  - test/reports-i18n.test.js
  - test/reports-pack.test.js
  - test/reports-pdf.test.js
  - test/synergy-rollup-split.test.js
  - test/synergy-staleness.test.js
findings:
  critical: 0
  warning: 5
  info: 2
  total: 7
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-08-09
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

Reviewed the full IMO Reporting & Exports surface: `lib/reportCsv.js`, `lib/reportFilename.js`,
`lib/reportPack.js`, `lib/reportPdf.js`, the `server.js` diff regions (`GET /api/reports/export`,
`GET /api/reports/pack`, `computeWorkstreamRollup`, `reportRaidRows`/`reportSynergyRows`, the
synergy phased/unphased rollup split), the Reports tab wiring in `execution.html`/`execution.js`,
the i18n seed script, and all eight associated test files (123 tests, all passing locally).

The six security invariants named in scope were checked explicitly and all hold:

- **Clearance parity** — `reportRaidRows()` reuses the exact `resolveRaidEntryClearanceArea`/
  `accessPolicy.hasAreaGrant` filter GET /api/raid uses; `test/reports-export.test.js` (a)/(j)/(k)
  and `test/reports-pack.test.js` (b) prove export/pack/live-GET parity across four identities.
- **Org/talent exclusion** — the export dataset is a `zod` enum whitelist
  (`workstreams|tasks|raid|synergies`); no branch exists for positions/decisions/flight-risk, and
  the pack route ignores unrecognised query parameters entirely (proven by test (d)/(m)).
- **Audit discipline** — exactly one `report-export`/`report-pack-generated` audit row per
  successful real-deal call, zero for demo, zero on 400/409 refusal (`test/reports-audit.test.js`
  a–f, all passing).
- **Codename-only footer/filename** — `deal.targetCompany` is never referenced anywhere in
  `lib/reportPack.js` or the export route; sentinel-absence is proven at both the raw-string level
  (`reports-pack.test.js` (c)) and the HTTP body/header level (`reports-export.test.js` (b)/(m)).
- **CSV injection + header CRLF** — `csvField()` apostrophe-prefixes leading `=+-@`;
  `setContentDisposition()` strips control/bidi characters before the value ever reaches
  `res.setHeader()`, with a try/catch fallback. Both are unit- and integration-proven.
- **Fail-closed auth** — the reports routes are registered after the consolidated `/api` gate
  (server.js:404) and are not in `PUBLIC_API_PATHS`; no session/deal-membership bypass exists.

No blocker-tier defects were found. The five warnings below are all real, demonstrable
quality/robustness issues that don't compromise the security invariants above but should be fixed:
two data-correctness bugs (numeric CSV columns silently becoming spreadsheet text; the pack's
UTF-8 filename support being unreachable from the one client that uses it), one process-lifetime
reliability bug (a single transient logo-load failure permanently breaks pack generation), and two
DRY violations that quietly contradict the phase's own repeated "one source of truth" design intent.

## Warnings

### WR-01: CSV formula-injection escaping mis-fires on negative numeric columns, turning them into spreadsheet text

**File:** `lib/reportCsv.js:33-42` (`csvField`), reached via `server.js:5611` (`netBenefitM`
column) and the synergies export's `targetM`/`realizedM`/`costIncurredM`/`netBenefitM` columns.

**Issue:** `csvField()` apostrophe-prefixes *any* value whose first character is `=`, `+`, `-` or
`@` — with no distinction between free-text (RAID titles, where this is the intended T-07-05
defence) and computed numeric fields. `validators/workstream.js`'s `SynMoneyUnion` (`z.union([
z.number(), z.string().max(20)])`) places no `min(0)` floor on `targetM`/`realizedM`/
`costPlannedM`, and `netBenefitM` is explicitly documented and tested as "negative and unclamped"
(`test/synergy-staleness.test.js` (n): `netBenefitM === -8`). Confirmed directly:

```
$ node -e "console.log(require('./lib/reportCsv').csvField(-5.2))"
'-5.2
```

A recipient opening the CSV in Excel sees a left-aligned **text** value `'-5.2`, not a numeric
`-5.2` — any `SUM()`/sort/conditional-format applied to that column silently excludes or
misorders the row, with no visible error. This is exactly the failure mode a steering-committee
financial export must not have: the most attention-getting figure (a negative net benefit) is the
one most likely to silently drop out of downstream spreadsheet math.

**Fix:** Only apply the formula-trigger check to string-typed source values, or restrict it to the
known free-text columns (title, notes, owner) rather than every field passed through `csvField()`:
```js
function csvField(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (typeof value !== 'number' && s.length > 0 && FORMULA_TRIGGER_CHARS.has(s[0])) {
    s = "'" + s;
  }
  ...
}
```

### WR-02: The pack-download button's Content-Disposition parser always picks the ASCII fallback filename, never the RFC 5987 extended parameter

**File:** `public/js/execution.js:1132`

**Issue:** `lib/reportFilename.js`'s `setContentDisposition()` deliberately emits both an ASCII
`filename="..."` fallback and an RFC 5987 `filename*=UTF-8''...` extended parameter so non-ASCII
codenames (e.g. `中文`, `Müller`) survive into the download filename — proven server-side by
`test/reports-filename.test.js` (g). But the client's extraction regex,
`/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i`, is unanchored and non-global: `.exec()` returns the
*first* match in the string, and `filename="..."` always appears before `filename*=UTF-8''...` in
the header Express constructs. Confirmed directly:

```
$ node -e '
const d = "attachment; filename=\"Muller_ZhongWen.pdf\"; filename*=UTF-8'"'"''"'"'M%C3%BCller-%E4%B8%AD%E6%96%87.pdf";
const m = /filename\*?=(?:UTF-8'"'"''"'"')?"?([^";]+)"?/i.exec(d);
console.log(m[1]); // -> "Muller_ZhongWen.pdf", never the extended value
'
```

So the "Generate steerco pack" button — the one client actually consuming this header — always
downloads with the ASCII-sanitised name (accented/CJK characters replaced by `_`), even though the
server did the work to preserve them. The CSV/JSON `<a href>` links in `execution.html` are
unaffected (they rely on the browser's own native Content-Disposition parsing, which correctly
prefers `filename*`).

**Fix:** Prefer the extended parameter by matching it first, e.g. two explicit regexes tried in
order:
```js
var extMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
var asciiMatch = /filename="([^"]*)"/i.exec(disposition);
var filename = extMatch ? decodeURIComponent(extMatch[1]) : (asciiMatch ? asciiMatch[1] : 'steerco-pack.pdf');
```

### WR-03: `lib/reportPack.js`'s logo-load cache permanently poisons itself on first failure

**File:** `lib/reportPack.js:305-314` (`loadLogoImage`)

**Issue:**
```js
let logoImagePromise = null;
function loadLogoImage() {
  if (!logoImagePromise) {
    logoImagePromise = loadImage(LOGO_PATH).catch((err) => { console.error(...); throw err; });
  }
  return logoImagePromise;
}
```
`logoImagePromise` is cached the first time `loadLogoImage()` is called, and the cache is never
reset — including when the cached promise *rejects*. A rejected `Promise` object is still truthy,
so `if (!logoImagePromise)` is `false` on every subsequent call, and every future
`buildPack()`/`buildPackFromSections()` call for the remaining lifetime of the process receives
the *same* cached rejection immediately, without ever retrying `loadImage()`. A single transient
failure (e.g. a filesystem hiccup, a container volume not yet mounted at the moment of the first
request) permanently disables PDF pack generation for every deal until the process is restarted —
there is no way for an operator to recover it short of a restart, and no log signal distinguishes
"permanently broken" from "the vendored logo file is genuinely missing".

**Fix:** Reset the cache on rejection so a subsequent call retries:
```js
function loadLogoImage() {
  if (!logoImagePromise) {
    logoImagePromise = loadImage(LOGO_PATH).catch((err) => {
      console.error(`[security] ...`);
      logoImagePromise = null; // allow a later call to retry rather than caching a permanent failure
      throw err;
    });
  }
  return logoImagePromise;
}
```

### WR-04: `reportRaidRows()` is documented as "the single clearance-filtered RAID read" but `GET /api/raid` still carries its own separate copy of the identical filter

**File:** `server.js:4039-4050` (`reportRaidRows`) vs. `server.js:4052-4064` (`app.get('/api/raid')`)

**Issue:** `reportRaidRows()`'s own comment states it exists "so a future change can never make the
CSV export and the PDF pack disagree ... about which RAID rows a given caller may see (D-08)" —
true for those two callers. But `GET /api/raid` (the live screen route every export/pack claims to
stay in parity with) was **not** refactored to call `reportRaidRows()`; it retains its own
line-for-line duplicate of the same `resolveRaidEntryClearanceArea`/`accessPolicy.hasAreaGrant`
filter:

```js
// server.js:4044-4050
function reportRaidRows(db, deal, portalUser) {
  ddFindingsLane(db);
  return raidLane(db).filter((entry) => {
    const area = resolveRaidEntryClearanceArea(entry, db);
    return area === null || accessPolicy.hasAreaGrant(deal, portalUser, area);
  });
}

// server.js:4052-4064
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

Today this is harmless (the two copies are byte-for-byte identical), but it means the "one filtered
read path" claim the phase's design docs and comments repeat throughout is not actually true — a
future edit to one copy (e.g. a new clearance rule) that isn't mirrored to the other would silently
reintroduce the exact export/screen divergence this phase's own tests (`reports-export.test.js` a/j,
`reports-pack.test.js` b) were written to catch, because those tests only compare the export/pack
against the *current* `GET /api/raid` output, not against a shared implementation.

**Fix:** Have `GET /api/raid` call `reportRaidRows(db, deal, req.portalUser)` too, so there is
exactly one implementation of the filter, not two synchronised-by-hand copies.

### WR-05: The synergy phased/unphased rollup-split formula is duplicated verbatim between `GET /api/synergies/rollup` and `GET /api/reports/pack`

**File:** `server.js:3518-3527` (`/api/synergies/rollup`) vs. `server.js:5779-5788`
(`/api/reports/pack`)

**Issue:** The T-05-47 phased/unphased split (`hasPhasing`, `phasedItems`/`unphasedItems`,
`grossRealizedM`/`unphasedRealizedM`/`netBenefitM`/`dealTargetM`/`staleCount`) is implemented twice,
with identical logic but operating on two different arrays (`enriched` in the rollup route,
`synergies` in the pack route — both ultimately built from `enrichSynergy()` so the values agree
today):

```js
// server.js:3518-3527 (GET /api/synergies/rollup)
const hasPhasing = (i) => Array.isArray(i.phasing) && i.phasing.length > 0;
const phasedItems = enriched.filter(hasPhasing);
const unphasedItems = enriched.filter((i) => !hasPhasing(i));
const grossRealizedM = roundSynergyMoney(phasedItems.reduce((a, i) => a + (i.realizedM || 0), 0));
...

// server.js:5779-5788 (GET /api/reports/pack)
const hasPhasing = (i) => Array.isArray(i.phasing) && i.phasing.length > 0;
const phasedItems = synergies.filter(hasPhasing);
const unphasedItems = synergies.filter((i) => !hasPhasing(i));
const grossRealizedM = roundSynergyMoney(phasedItems.reduce((a, i) => a + (i.realizedM || 0), 0));
...
```

The extensive comments on the rollup route (server.js:3480-3507) explicitly frame D-02 as "this
split is computed ONCE, here, so the execution-tab tile row and ... the PDF pack both read this one
response and can never disagree" — but the pack route does not read that response; it re-derives
the identical formula independently. A future change to the split's definition (e.g. a new
partition rule, a rounding-order change) applied to one call site and not the other would silently
make the on-screen synergy rollup and the PDF pack's page-one/Section-4 numbers disagree — precisely
the "double-counting drift" the surrounding comments say this design prevents.

**Fix:** Factor the phased/unphased split into a shared helper (e.g.
`computeSynergyRollup(enrichedItems)` returning `{ grossRealizedM, unphasedRealizedM,
costIncurredM, netBenefitM, dealTargetM, staleCount, unconfirmedRealizedM }`) and call it from both
`GET /api/synergies/rollup` and `GET /api/reports/pack`.

## Info

### IN-01: `csvField()`'s formula-trigger character set omits leading TAB/CR, which some spreadsheet CSV-injection guidance also flags

**File:** `lib/reportCsv.js:22`

**Issue:** `FORMULA_TRIGGER_CHARS` covers `=`, `+`, `-`, `@` (the four universally-cited triggers)
but not a leading tab (`\x09`) or carriage return, which OWASP's CSV Injection guidance also lists
as recognised by some spreadsheet applications' auto-formula detection. Low practical risk given
RFC 4180 quoting already wraps any field containing a CR/LF, but worth a comment noting the
decision was deliberate (matching the four-character convention this phase's own comment already
names) rather than an oversight.

**Fix:** Either add `\t` to the trigger set, or add a one-line comment explaining why it was
deliberately excluded.

### IN-02: `buildPdf()` hardcodes an assumed `scale=2` when recovering point dimensions from pixel dimensions

**File:** `lib/reportPdf.js:183-184`

**Issue:**
```js
// renderPageToRgbStream's default scale is 2
const ptWidth = page.width / 2;
const ptHeight = page.height / 2;
```
`renderPageToRgbStream(drawFn, cssWidth, cssHeight, scale = 2)` accepts a `scale` parameter, but
`buildPdf()` has no way to know what scale a given `page` was actually rendered at — it just
divides by the literal `2`, relying on every caller always using the default. This is correct
today (no caller in this codebase overrides `scale`), but it's a latent trap: if a future caller
ever passes a non-default `scale` to `renderPageToRgbStream`, `buildPdf()` would silently compute
the wrong `/MediaBox`, stretching or shrinking the rendered page without any error.

**Fix:** Have `renderPageToRgbStream()` return the `scale` (or the CSS `cssWidth`/`cssHeight`)
alongside `width`/`height`/`deflated`, and have `buildPdf()` read it from the page object instead
of assuming `2`.

---

_Reviewed: 2026-08-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
