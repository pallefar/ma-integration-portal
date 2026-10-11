---
phase: 13-content-safety
plan: 06
subsystem: security / content-safety (client)
tags: [xss, DOMParser, allowlist, mutation-xss, SAFE-01]
requires: [13-01]
provides:
  - public/js/safe-html.js (window.MASafeHtml = { render, toFragment, safeHref, POLICY })
  - script-order gate for the 18 transitions.js pages (test/safe-html-policy.test.js)
affects: [13-09, 13-10, 13-11, 13-12]
tech-stack:
  added: []
  patterns: [DOMParser-into-inert-document then createElement build (never serialize), CSSOM-only style copy, policy-parity test against a server table]
key-files:
  created:
    - public/js/safe-html.js
    - test/safe-html-policy.test.js
  modified:
    - public/js/page-layout.js
    - test/xss-chain.test.js
    - public/admin.html
    - public/assessments.html
    - public/capability-hub.html
    - public/dashboard.html
    - public/deal-wizard.html
    - public/due-diligence.html
    - public/employee.html
    - public/execution.html
    - public/index.html
    - public/insights.html
    - public/integration-excellence.html
    - public/leaders.html
    - public/org.html
    - public/overview.html
    - public/playbook.html
    - public/pmo.html
    - public/supporting.html
    - public/survey.html
decisions:
  - "PD-22 held: page-layout chrome and hero/cards/cta are createElement/textContent; only richtext html and the legacy body are HTML strings and go through MASafeHtml.render"
  - "PD-28 held: one identical parser-blocking tag per page, first /js/ script; ordering test is the gate"
  - "Playbook checkbox strings: documented exception stands, no marker rendered (the 24 strings have no render path today)"
  - "safeHref added to the MASafeHtml export so CTA hrefs share the one scheme check"
  - "CSS copy reads only properties the author declared by name (shorthand expansion cannot smuggle background-color: initial)"
status: complete
actuals:
  tokens: 9000    # chars/4 over the new/changed non-HTML files (~36k chars) + 18 one-line tag inserts
  tasks: 2
  commits: 2
---

# Phase 13 Plan 06: SAFE-01 client renderer Summary

`public/js/safe-html.js` — the single client renderer for stored HTML — parses with DOMParser into an inert document and
BUILDS the output with createElement/setAttribute/createTextNode from a table that is parity-tested against
`lib/htmlPolicy.js`; the CMS page path (`page-layout.js`) renders through it, and all 18 chrome pages load it first.

## Commits

| Task | Commit | Content |
|------|--------|---------|
| 1 (tracer) | `e13fd00` | safe-html.js, page-layout.js rewrite, 4 page tags, safe-html-policy test, xss-chain (b4) |
| 2 | `27dde5d` | remaining 14 page tags, ordering gate widened to all 18 |

Tracer gate: `<verify>` (policy + xss-chain tests, `npm run smoke -- --pages admin-users`) re-run green after Task 1 —
expansion continued without a human stop (executor brief).

## What shipped

- **MASafeHtml** (IIFE, `[security]` header): `render(el, html)`, `toFragment(html)`, `safeHref(value)`, frozen `POLICY`.
  Semantics per PD-36: drop-with-content tags removed with their content; other non-allowlisted elements unwrapped;
  SVG/MathML (non-HTML namespace) dropped with content; comments dropped; `on*`, `id`, `name`, `srcdoc`, `srcset`,
  `xlink:href`, `formaction` never copied; `href`/`src` resolved with `new URL(v, origin)` after control characters are
  stripped, protocol must be allowlisted, protocol-relative refused, `data:` only for `img` + allowlisted raster MIME +
  base64; `style` copied through a detached element's CSSStyleDeclaration filtered by the CSS allowlist and written
  with `style.setProperty` (CSSOM, so a future `style-src-attr` CSP stays satisfiable); `a` always
  `rel="noopener noreferrer"`, `target` only `_blank`.
- **page-layout.js**: `const sanitize =` and every `innerHTML` assignment are gone. Region wrapper, badge and the
  hero/cards/cta templates are built with `createElement`/`textContent` (same classes, inline styles, `data-cms-layout`);
  richtext and the legacy body call `MASafeHtml.render`; CTA hrefs pass `MASafeHtml.safeHref`. If `MASafeHtml` is missing
  the page fails closed (static markup kept, console error) — there is no string fallback. The registry's `render`
  functions now return DOM nodes; `admin-cms.js` only reads `fields`/`label`/`icon`, so the admin builder is unaffected.
- **Pages**: `<script src="/js/safe-html.js?v=1"></script>` immediately before the first `/js/` script on admin,
  assessments, capability-hub, dashboard, deal-wizard, due-diligence, employee, execution, index, insights,
  integration-excellence, leaders, org, overview, playbook, pmo, supporting, survey (`?v=1` is rewritten to the content
  hash at serve time by `lib/assetStamp.js`).
- **Tests**: `test/safe-html-policy.test.js` (7 subtests: table-for-table parity, frozen, no-sink scan with
  string-aware comment stripping, no-DOM load, `safeHref` allow/refuse matrix, page-layout uses MASafeHtml and fails
  closed, 18-page script order + parser-blocking). `test/xss-chain.test.js` (b4) re-stated without the page-layout leg.

## Real-browser evidence (scratch scripts, Chromium 1.62.1 Playwright; not committed)

- 313-vector `xss-corpus.json` rendered through `MASafeHtml.render` and re-checked with `test/helpers/html-inert.js`:
  **0 inert violations, 0 throws, 0 `alert` calls, 0 dialogs, 0 page errors.** An earlier run found one violation
  (`java script:alert(1)` — an interior space; harmless to a browser but judged by the compact form by the server and the
  checker) -> `checkUrl` now judges the compact scheme too.
- 48 tagged demo values (`cms-golden.json`) rendered: **0 structural divergences** from the server sanitizer output.
- Differential vs `lib/sanitizeHtml.js` over the corpus: 22 structural divergences, all inert; classes: (a) spec-parser
  vs htmlparser2 foreign-content breakout (`<svg><style><img src=x onerror=…>` -> the client DOM correctly contains an
  inert `<img src="x">` after the dropped `<svg>`, the server drops it), (b) control characters inside attribute values
  (client strips them, server keeps), (c) NBSP/U+FEFF/U+2028 around a scheme (client trims them -> drops the href, the
  server keeps it as an unparseable relative value — client is stricter). No class where the client keeps something the
  server drops and that is not inert. 13-12 owns the committed browser corpus.
- page-layout in a real page with a stubbed `/api/pages`: hero CTA `javascript:` -> `#`; richtext `onclick`, `<script>`,
  `onerror`, `javascript:` href, `target=_top`, `<svg>` removed, `style` reduced to `color: red`; card text escaped;
  legacy body drops `<iframe>` and an svg `data:` image, keeps a png `data:` image; layout and legacy DOM shape equals
  the previous markup (badge + body siblings).
- `npm run smoke -- --pages admin-users` (and the full default set, below): 0 page errors, 0 failed same-origin requests.
  axe counts are the pre-existing informational ones (not changed by this plan).

## Deviations from Plan

**1. [Rule 2 - Missing critical] `safeHref` added to the `MASafeHtml` export** — PD-22 requires CTA hrefs to "pass the
same scheme check MASafeHtml uses"; without a shared function that check would be a second copy (the drift this phase
removes). The plan's three-name API gained one name; `POLICY` parity is unaffected.

**2. [Rule 1 - Bug, found in browser] shorthand expansion leak** — first cut of the CSS copy read every allowlisted name
from the parsed CSSOM; `background:url(x)` expands to `background-color: initial` (accepted by the colour regex). Fixed
by copying only properties the author declared by that name (`copyStyle`), proven in Chromium
(`style="color:red;background:url(x)"` -> `color: red`).

**3. [Rule 1 - Bug, found in browser] compact-scheme gap** — see evidence above; `checkUrl` judges the whitespace-compacted
form's scheme (matching the server and `html-inert.js`) in addition to what `new URL` reports.

**4. Playbook checkbox strings (13-01 heads-up)** — plan 13-06 prescribes no marker and 13-09 does not mention one. Grep
over `public/`, `lib/`, `server.js` finds **no reference** to `playbook.culture_milestone_*` / `playbook.talent_checklist_*`
(24 dictionary values, orphaned entries), so nothing renders them today and no checkbox is lost on screen. Decision:
the documented exception stands — `input` stays never-allowed, MASafeHtml drops it (identical to the server), xss-chain
(b3) keeps its exactly-24 pinned exception unchanged, no `☐` rendering added. **13-09 / a later content pass must revisit
only if a page starts rendering these keys.**

**5. Task 2 committed as one batch** (14 mechanical lines + the test) — allowed by the plan's W-3 note.

## Findings for later plans (not fixed here)

- **13-09**: `public/js/transitions.js` still carries the regex `stripDangerousHtml` + `innerHTML` for
  `[data-i18n-html]` (xss-chain (b4) keeps asserting exactly its 3 lines until 13-09 retires them and the test).
  `MASafeHtml` is already loaded before it on every page, so the swap has no ordering risk.
- **13-10 / 13-11**: pages already carry the `safe-html.js` tag as their first `/js/` script; externalising inline
  blocks must keep it first (the ordering test fails otherwise).
- MASafeHtml is not a layout engine: elements are created in the live document before insertion, so an allowlisted
  `<img src>` begins loading at build time — same URL check as everything else, and the same moment it would load on
  insertion; no event handler can be attached.

## Known Stubs

None.

## Threat Flags

None — no new network endpoint, auth path or schema change.

## Verification

- `node --test test/safe-html-policy.test.js test/xss-chain.test.js test/asset-cache-bust.test.js test/asset-stamp-unit.test.js test/client-xss-sinks.test.js`: 46 / 46 (Task 1), policy + cache-bust 17 / 17 (Task 2).
- `grep -c "const sanitize =" public/js/page-layout.js` = 0; `grep -l '/js/safe-html.js?v=' public/*.html | wc -l` = 18.
- `git status --porcelain data/ public/sent_emails/` empty at every commit.
- Full suite (`node --test`, worktree root, on `27dde5d`): **tests 1568, pass 1567, fail 1, cancelled 0, skipped 0**
  (30.2 s). The single failure is `read-sets-org-reports.test.js` "read-sets-reports (export): every dataset x format x
  identity …" — see Deferred below; it is unrelated to this plan and fails alone, identically, on re-run.
- `npm run smoke` (full default set, 12 page x width visits, isolated real-mode server): **0 with errors**, 0 failed
  same-origin requests, landmarks ok, data/ + public/sent_emails/ unchanged, exit 0. axe critical+serious total 37 is the
  pre-existing informational count (select-name / color-contrast / label-title-only), untouched by this plan.

## Deferred / out of scope (not fixed — scope boundary)

- **Date-sensitive test, pre-existing:** `test/read-sets-org-reports.test.js:368` pins the expected report bytes at a
  fixed `nowMs = 2026-10-10T12:00:00Z` (staleDays 273/281) while the live route under test computes `staleDays` from the
  real clock; once the host date passed 2026-10-10 (UTC midnight rolled during this execution) the live value is
  274/282 and the byte comparison fails. Neither the test nor any file it exercises is touched by 13-06 (`git diff
  a78044e..HEAD` over `test/read-sets-org-reports.test.js`, `lib/`, `server.js` is empty). Needs the test to stub the
  server clock (or compute expected `staleDays` from `Date.now()`); orchestrator to route it. The 13-01 full-suite run
  (1489/1489) predates the date rollover.

## Self-Check: PASSED

- `public/js/safe-html.js`, `test/safe-html-policy.test.js` present; `public/js/page-layout.js` has no `const sanitize =` and no
  inner/outer HTML assignment; 18 pages carry the tag first among `/js/` scripts (ordering subtest green).
- Commits `e13fd00` (Task 1) and `27dde5d` (Task 2) present on the worktree branch.
