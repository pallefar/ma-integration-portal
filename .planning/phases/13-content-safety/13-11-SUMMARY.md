---
phase: 13-content-safety
plan: 11
subsystem: frontend-security
tags: [csp, content-safety, overview-decks, inline-handlers, transitions]
requires: ["13-03", "13-07"]
provides:
  - six first-party overview decks with no inline script (code in /js/overview-deck/*.js, content-hash stamped)
  - transitions.js generates no inline handler and no javascript: URL
  - client-JS-wide static gate (public/js/**, vendor excluded)
affects: [13-12, 13-13]
key-files:
  created:
    - public/js/overview-deck/agenda.js
    - public/js/overview-deck/deck.js
    - public/js/overview-deck/deck-bridge.js
    - public/js/overview-deck/easter-egg.js
    - public/js/overview-deck/slide5.js
    - public/js/overview-deck/slide6.js
    - public/js/overview-deck/working-in-a-matrix.js
    - test/csp-inline-free-decks.test.js
  modified:
    - public/overview-deck/agenda.html
    - public/overview-deck/deck.html
    - public/overview-deck/easter-egg.html
    - public/overview-deck/slide5.html
    - public/overview-deck/slide6.html
    - public/overview-deck/working-in-a-matrix.html
    - public/js/transitions.js
    - public/css/style.css
    - test/slide-sandbox-client.test.js
requirements-completed: [SAFE-02, SAFE-01]
status: complete
actuals:
  tokens: 20000
  tasks: 2
  commits: 2
---

# Phase 13 Plan 11: overview decks + generated handlers inline-free Summary

The six overview decks run from external, stamped scripts at their former positions, and transitions.js no longer
generates any inline handler or `javascript:` URL, so none of this first-party code needs `'unsafe-inline'`.

## What shipped

- **Decks (verbatim, position-preserving moves).** Each inline `<script>` block became
  `<script src="/js/overview-deck/<deck>.js?v=1">` at the same spot (the served page rewrites `?v=` to the 16-hex
  content hash). deck.html had two blocks and now loads `deck.js` then `deck-bridge.js` (the framed
  `postMessage` bridge + Agenda button). `working-in-a-matrix.js` is ~3.2 MB because the original block embedded its
  media data; it was moved as is. `overview.html`'s own inline bridge belongs to 13-10 and was NOT touched.
- **transitions.js (only the owned regions).**
  - sidebar survey link and easter-egg link: `href="#"`; the survey click listener now calls `e.preventDefault()`
    (the egg's existing `[data-html-slide]` delegate already prevents default).
  - notification-panel item template (the plan's "quick-nav item" with `onmouseover/onmouseout`): handlers removed,
    class `sidebar-notif-item`, hover is `.sidebar-notif-item:hover` in style.css (appended rule, PD-42).
  - `addSlide` (sidebar slide-link builder, D-13-02 label path): `href="#"`, icon/label built with `createElement` +
    `textContent`, click listener `preventDefault()` then `openHtmlSlide`; the now-unused `esc` helper removed.
  - survey-scores modal: close button has `id="survey-scores-modal-close"`, no `onclick`, listener attached right
    after the markup is inserted.
- **Gate `test/csp-inline-free-decks.test.js` (14 tests):** DECKS list cross-checked against the directory; each
  deck source and SERVED page inline-free; stamp equals sha256 of the served script (live server, isolated MA_* temp
  paths); template assertions; `addSlide` region assertion (no HTML-string sink, textContent label); client-JS-wide
  scan for inline handler attributes in string literals and `javascript:` URLs, with one recorded guard-line allowlist
  entry (`if (href.indexOf('javascript:') === 0) return '';`).

## Deviations from Plan

**1. [Rule 1 - Bug] `applyMenuOverrides.tokenOf` treats `href="#"` as tokenless.** `tokenOf('#')` would resolve to the
current page path and collide with real menu items (the egg and slide launchers could be matched/removed/relabelled by
a menu override). The old `javascript:` scheme was already tokenless; one guard line in the same function keeps that
behaviour. Region is outside the five owned regions but is a direct consequence of the owned change (2 lines).

**2. [Rule 3 - Blocking] `test/slide-sandbox-client.test.js` (d) edited.** It asserted `parent.postMessage` text inside
deck.html and the no-same-origin-API property over the deck HTML; after the mandated externalisation that code lives
in `/js/overview-deck/*.js`. The assertions now read page markup + the external scripts (same intent). The plan listed
this file as "run, not edited".

**3. [Naming] deck.html's two blocks -> `deck.js` + `deck-bridge.js`** (plan allowed "deck.js, or two files").

**4. [Interpretation] "quick-nav item template with onmouseover"** in the plan is the notification-panel `itemHtml`
template (sidebar bell); the real quick-nav links already carry no hover handlers. The CSS rule is named
`.sidebar-notif-item:hover` accordingly.

## Verification

- `node --test test/csp-inline-free-decks.test.js test/client-xss-sinks.test.js test/slide-sandbox-client.test.js
  test/asset-cache-bust.test.js` - 41 tests, 0 fail.
- Full suite (`node --test`, worktree root): `# tests 1598  # pass 1597  # fail 1  # cancelled 0  # skipped 0`.
  The one failure is `read-sets-org-reports.test.js` "read-sets-reports (export): ... audit row unchanged", the
  clock-dependent synergies export bytes; it fails deterministically alone, touches no file of this plan, and is the
  "tiny test date-fix" the orchestrator assigned to a sibling.
- `node --check` clean for every moved script and transitions.js.
- **Smoke (`npm run smoke`) NOT run:** the host has no loadable Playwright / axe-core resolution for the harness
  ("cannot run - missing tool(s): axe-core", exit 2). Real-browser deck walks (framed and sandboxed) are 13-12/13-13's
  scope; recorded here as an unrun verify rather than green.

## Known Stubs

None.

## Threat Flags

None. (Note for 13-12: the notification panel's `it.href` is server-computed and only HTML-escaped, not
scheme-filtered; unchanged by this plan.)

## Commits

- `37eda1b` feat(13-11): easter-egg deck inline code externalised; sidebar survey/egg launchers use href="#"
- `e08f082` feat(13-11): remaining decks inline-free; generated handlers/javascript: URLs removed; client-JS-wide gate

## Self-Check: PASSED
