---
phase: 13-content-safety
plan: 10
subsystem: security / content-safety (client pages)
tags: [csp, inline-script, externalisation, SAFE-02]
requires: [13-03, 13-06, 13-07]
provides:
  - public/js/pages/*.js (8 external files replacing every inline block / handler of the seven app pages)
  - test/csp-inline-free-pages.test.js (static + served-page gate)
affects: [13-12, 13-13]
tech-stack:
  added: []
  patterns: [verbatim block move at the exact script position, data-action + capture-phase delegated listener, href="#" under the existing [data-html-slide] preventDefault delegate]
key-files:
  created:
    - public/js/pages/admin-actions.js
    - public/js/pages/dashboard-1.js
    - public/js/pages/dashboard-2.js
    - public/js/pages/index-1.js
    - public/js/pages/insights-1.js
    - public/js/pages/overview-1.js
    - public/js/pages/playbook-1.js
    - public/js/pages/signage-1.js
    - test/csp-inline-free-pages.test.js
  modified:
    - public/admin.html
    - public/dashboard.html
    - public/index.html
    - public/insights.html
    - public/overview.html
    - public/playbook.html
    - public/signage.html
    - test/slide-sandbox-client.test.js
decisions:
  - "PD-21 held: one external classic (parser-blocking) file per inline block at the block's exact position, code verbatim (IIFE-wrapped only where the inline code was not already an IIFE; no 'use strict' added so semantics are unchanged)"
  - "dashboard print + admin handlers use ONE capture-phase document listener each (an inline attribute fired on the target regardless of any ancestor stopPropagation; capture preserves that)"
  - "signage fails closed without MASafeHtml: [data-i18n-html] falls back to textContent, never raw innerHTML"
status: complete
actuals:
  tokens: 14000   # chars/4 over the new/changed non-HTML files (~56k chars) + HTML tag swaps
  tasks: 2
  commits: 4
---

# Phase 13 Plan 10: SAFE-02 app-page externalisation Summary

The seven app pages (dashboard, index, insights, overview, playbook, signage, admin) no longer contain any inline
`<script>`, inline `on*=` handler or `javascript:` URL: every former block is an external file under `/js/pages/`
loaded at the block's exact position with a `?v=` stamp, so the strict `script-src 'self'` policy can be enforced
(13-13) without breaking them.

## Block -> file -> position

| Page | Former inline code | New file | Position |
|------|--------------------|----------|----------|
| insights.html | one block (data + render + modal/tab/view interactions) | `public/js/pages/insights-1.js` | end of body, after `transitions.js` (same place) |
| index.html | one block (role cards / showcase detail panel / landing-card overrides) | `public/js/pages/index-1.js` | end of body |
| overview.html | one block (deck `message` relay: `deck-overlay`, `open-slide`) | `public/js/pages/overview-1.js` | end of body |
| playbook.html | one block (section tab selector) | `public/js/pages/playbook-1.js` | immediately before `page-layout.js` (unchanged order) |
| signage.html | one block (minimal i18n bootstrap) | `public/js/pages/signage-1.js` | after `signage.js` (unchanged order) |
| dashboard.html | block 1: employee-feedback card (`/api/pulses`) | `public/js/pages/dashboard-1.js` | in the Overview tab, where the block stood |
| dashboard.html | block 2: IL Academy tab progress | `public/js/pages/dashboard-2.js` | in the IL Academy tab, where the block stood |
| dashboard.html | `onclick="window.print()"` | `data-action="print"` handled in `dashboard-2.js` | document-level delegate |
| dashboard.html | 8 x `href="javascript:void(0)"` slide anchors | `href="#"` | existing `[data-html-slide]` delegate in transitions.js calls `preventDefault()` |
| admin.html | `onclick="window.location.href='/pmo.html'"` | `data-action="open-pmo"` | `public/js/pages/admin-actions.js` |
| admin.html | `onclick="window.launchDoomProtocol()"` | `data-action="launch-ted"` | `public/js/pages/admin-actions.js`, loaded after `/js/ted-launcher.js` |

Page-script order: every page keeps `/js/safe-html.js` as its FIRST `/js/` script (the ordering test is green).
No merging of blocks: dashboard's two blocks stay two files because markup sits between them.

## Commits

| Task | Commit | Content |
|------|--------|---------|
| 1 (tracer) | `dd94ff9` | insights.html externalised + `csp-inline-free-pages` gate created |
| 2 | `4aa5116` | dashboard/index/overview/playbook/signage/admin externalised, gate extended to all seven |
| 2 (fix) | `7535d94` | `slide-sandbox-client` (d) reads the externalised overview relay |

Tracer gate: `node --test test/csp-inline-free-pages.test.js test/asset-cache-bust.test.js` re-run green after
Task 1 (14/14); expansion continued without a human stop (executor brief).

## Verification

- `node --test test/csp-inline-free-pages.test.js test/safe-html-policy.test.js test/asset-cache-bust.test.js test/lockdown-asset-allowlist.test.js` -> 49/49 pass.
- Full suite: see "Full suite" below.
- Served-page proof: every external file is served 200 `application/javascript` and its `?v=` stamp equals
  sha256(served body)[:16] (test case per page).
- `npm run smoke` could NOT run on this host: exit 2, "missing tool(s): axe-core" and the npx-cached Playwright
  (`9833c18b2d85bc59`) is truncated ("Unexpected end of input"). Substitute (ad-hoc, not committed): the worktree app
  served from a throw-away MA_* block (copied demo/control DBs, `DEMO_OPEN=1`) driven in real Chromium via a loadable
  host Playwright copy: **0 `pageerror` and 0 console errors on insights, index, overview, playbook, signage and
  dashboard**, with behaviour confirmed — insights: 6 radar cards render, tab switch + modal open; index: 5 role cards,
  panel updates; playbook: 6 TOC links, click sets `#strategy`; signage: 6 `[data-i18n-html]` nodes rendered through
  MASafeHtml; dashboard: IL Academy 5 modules, feedback card `3.6 / 5`, print button fires `window.print` once, the eight
  slide anchors are `href="#"`. admin.html redirects to /login.html without a session (auth is unchanged), so its
  delegate was proven in isolation in Chromium: a click on a child of the TEd button reaches `launchDoomProtocol()`
  once, the PMO button navigates to `/pmo.html`. The full smoke net (axe-core) still needs a host with axe-core; 13-12
  runs the real-browser report-only walks.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `slide-sandbox-client` test (d) asserted the relay inside overview.html**
- **Found during:** Task 2 full-suite run
- **Issue:** the test regex-matched the inline `open-slide` relay in `overview.html`; the code (unchanged) now lives in `overview-1.js`.
- **Fix:** the assertion reads `public/js/pages/overview-1.js` and additionally asserts overview.html loads it. Intent (relay routes `open-slide` to `openHtmlSlide`; deck frame unsandboxed) unchanged.
- **Files modified:** `test/slide-sandbox-client.test.js`
- **Commit:** `7535d94`

**2. [Plan adjustment] ordering rule for signage lives in the new gate, not in `safe-html-policy.test.js`**
- The plan lists `test/safe-html-policy.test.js` as "not edited" while saying its ordering rule "now also covers signage.html". That test only iterates pages that load `transitions.js`, which signage does not. To avoid touching a file sibling plans edit, the signage rule (safe-html.js is the FIRST `/js/` script, exactly once; `[data-i18n-html]` renders through `MASafeHtml.render`; no inner/outerHTML assignment) is asserted in `test/csp-inline-free-pages.test.js`.

### Recorded decisions

- **overview relay origin**: moved unchanged; it still validates nothing about `e.origin` (the frame is the page's own first-party, unsandboxed `/overview-deck/deck.html`). Adding an origin check is a behaviour change outside this plan's remit; recorded here per plan.
- **PD-41 sink fixes: none found.** dashboard-1.js already wrapped `name` and `comment` (user-authored pulse text) in its `esc()` helper; the other `innerHTML` sinks in the moved code (insights, index) interpolate static in-file data only (index `data.visual` is a literal in the same block). Nothing was refactored.
- **IIFE wrapping**: insights/index/overview/playbook wrapped in a bare IIFE (their top-level `var`s were page-private; a repo-wide grep found no external user of `CURRENT`/`TARGETS`/`renderInsight`/…); signage and both dashboard blocks were already IIFEs and are moved as-is.

## Known Stubs

None.

## Threat Flags

None - no new network endpoint, auth path or file access; this plan removes inline execution surface (T-13-90).

## Deferred Issues

- `test/read-sets-org-reports.test.js` "read-sets-reports (export)": `staleDays` 273 vs 274 — a calendar-date drift unrelated to this plan (the sibling "tiny test date-fix" owns it). Failed identically with this plan's changes absent from its code path (export datasets only).
- dashboard.html still serves one `href="javascript:void(0)"` at runtime: the sidebar easter-egg link that `transitions.js` (line ~2214) injects. It is a generated template owned by plan 13-11, not page HTML.

## Full suite

`node --test` (after commit `7535d94`): **tests 1609, pass 1608, fail 1, cancelled 0, skipped 0** — the single failure
is the pre-existing calendar-date drift in `read-sets-org-reports` (`staleDays` 273 vs 274, see Deferred Issues), not
touched by this plan. The first full run (before the `slide-sandbox-client` fix) was 1607/2.

## Self-Check: PASSED

- All eight `public/js/pages/*.js` files and `test/csp-inline-free-pages.test.js` exist and `node --check` clean.
- Commits `dd94ff9`, `4aa5116`, `7535d94` exist on the worktree branch.
- `git status --porcelain data/ public/sent_emails/` empty; no `.db`/`-wal`/`-shm` staged.
