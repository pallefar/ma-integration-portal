---
phase: 13-content-safety
plan: 09
subsystem: client-security
tags: [xss, MASafeHtml, render-paths, static-scan, chatbot, i18n-html, inline-edit, SAFE-01]
requires: ["13-03", "13-06"]
provides:
  - "chatbot bubble, [data-i18n-html] apply, AI-insight card, inline click-to-edit, page-cms region, lesson modal and admin slide list render through MASafeHtml / createElement / textContent only"
  - "stripDangerousHtml and the last client regex handler-strip rules are deleted"
  - "test/client-render-paths.test.js: ENUMERATED_PATHS region-scan gate + negative control + not-enumerated sink inventory"
affects: [13-11, 13-12, 13-13]
tech-stack:
  added: []
  patterns:
    - "lexed-source region scan (comments, string bodies, template text and regex literals blanked; template ${} kept as code) with a brace counter"
    - "cancel restores the original DOM nodes instead of a serialise/parse round trip"
key-files:
  created:
    - test/client-render-paths.test.js
  modified:
    - public/js/transitions.js
    - public/js/page-cms.js
    - public/js/inline-edit.js
    - public/js/employee.js
    - public/js/admin-cms.js
    - test/xss-chain.test.js
    - test/slide-sandbox-client.test.js
decisions:
  - "PD-39 held: region scan over a lexed copy of the source; reads of .innerHTML and clearing assignments of an empty string literal are allowed, everything else on an enumerated path fails"
  - "PD-40 held: chatbot text is escaped + markdown-transformed exactly as before, then MASafeHtml.render; legitimate messages are byte-identical in the DOM"
  - "Fail closed everywhere: without window.MASafeHtml every converted path shows plain text (or keeps static markup for page-cms), never parses the string"
  - "Not-enumerated inventory is printed, not pinned: sibling plans in the same phase legitimately move the count"
status: complete
actuals:
  tokens: 9000    # chars/4 over the changed/new files (~36k chars)
  tasks: 2
  commits: 3
---

# Phase 13 Plan 09: SAFE-01 remaining render paths Summary

Every enumerated client render path that turns stored or message-sourced markup into DOM now builds it from the MASafeHtml
allowlist or from createElement/textContent, the last client regex sanitizer is gone, and a lexed static scan keeps it so.

## Commits

| Task | Commit | Content |
| ---- | ------ | ------- |
| 1 (tracer) | `7720bde` | chatbot `addMessageBubble` through `MASafeHtml.render`; `test/client-render-paths.test.js` (scanner, negative control, first entry) |
| 2 | `9a3b119` | `[data-i18n-html]` apply, `fetchSmolInsight`, inline-edit, page-cms, lesson modal, admin slide list, full ENUMERATED_PATHS, inventory, xss-chain (b4) retired |

Tracer gate: the scanner + negative control green and `npm run smoke` exit 0 / 0 page errors after Task 1 - expansion continued
without a human stop (brief rule). The scanner was also run against the pre-fix `HEAD` source of transitions.js and
reported the original `bubble.innerHTML = htmlContent` sink (line 3773), so the gate is proven to fail on the old code.

## What changed

- **transitions.js `addMessageBubble`**: text escaped, `**bold**`/`[text](url)` transforms kept, result rendered by
  `MASafeHtml.render`. `[x](javascript:alert(1))` keeps its text and loses its href; http(s) links keep `href` with forced
  `rel="noopener noreferrer"` and `target="_blank"`.
- **transitions.js `[data-i18n-html]` apply**: regex `stripDangerousHtml` deleted; bold pass kept; `setMarkup` renders via
  `MASafeHtml.render`. The `[data-i18n]` `**` bold branch (escaped then `innerHTML`) now uses the same `setMarkup`, so the whole
  `applyPortalI18n` function is sink-free.
- **transitions.js `fetchSmolInsight`** (flagged by 13-08, in this plan's scope): `${data.insight}` is no longer interpolated
  into an `innerHTML` template; the insight is rendered by `MASafeHtml` into a `createElement` span, the two error states go
  through a small `setSmolInsightError` (textContent). The 13-08 `egressDisabled` marker branch is untouched.
- **inline-edit.js**: edit bar built with `createElement` (the `slug` interpolation into markup is gone); `startPage` builds the
  `cms-editable-body` wrapper by DOM and renders the body through `MASafeHtml` (title fallback = `h3` + `p` via textContent);
  Cancel puts the ORIGINAL child nodes back (no serialise/parse round trip, so block-layout attributes and listeners survive);
  the commit view uses a DOM-built `wrapAuthored`; the `[data-i18n-html]` restore uses `MASafeHtml`.
- **page-cms.js**: wrapper/badge by `createElement`, body via `MASafeHtml.toFragment`; missing renderer keeps the static markup.
- **employee.js `openLessonModal`**: the whole modal is built with `createElement`/`textContent` (a literal reading of the plan
  - "shell as today, body container empty" - would have left an `overlay.innerHTML =` sink on the enumerated function, which
  the scan correctly rejects); the lesson body goes through `MASafeHtml.render` into an empty `.lesson-body`; description
  fallback and quiz are text nodes/inputs built by DOM. Same classes, styles and `.lq-submit` / `.lq-result` hooks.
- **admin-cms.js** (checked per the plan, fixed because it was not textContent-only on the container): slide-list rows and the
  load-failure state are DOM-built; label/url/pages stay `textContent`.
- **banners.js**: confirmed textContent only, no change.

## ENUMERATED_PATHS (all pass the region scan)

| File | Anchor | Kind |
| ---- | ------ | ---- |
| page-layout.js | whole file (13-06) | file |
| page-cms.js | whole file | file |
| banners.js | whole file | file |
| transitions.js | `function openHtmlSlide(` (13-03) | function |
| admin-cms.js | `function renderSlides(`, `function loadSlides(` | function |
| transitions.js | `function addMessageBubble(` | function |
| transitions.js | `window.applyPortalI18n = function` and the `querySelectorAll('[data-i18n-html]').forEach(` apply block | function / callback |
| transitions.js | `function fetchSmolInsight(`, `function setSmolInsightError(` | function |
| inline-edit.js | whole file (editI18n restore, startPage, endPage restore, renderBar) | file |
| employee.js | `function openLessonModal(` | function |
| transitions.js | `addSlide` - **gated in 13-11** (listed, not scanned; existence asserted) | gated-elsewhere |

## Not enumerated (bounded by the strict CSP, D-13-03 / 13-13; threat T-13-84 accepted)

Counted by the same sink patterns across `public/js` (vendor excluded), output of
`node --test test/client-render-paths.test.js` on `9a3b119` (empty-string clears and comments/strings excluded):

| File | Sinks | | File | Sinks |
| ---- | ----: | - | ---- | ----: |
| admin-cms.js | 52 | | assessments.js | 8 |
| admin.js | 34 | | signage.js | 7 |
| dashboard.js | 34 | | app.js | 5 |
| employee.js | 33 | | leaders.js | 5 |
| transitions.js | 29 (28 innerHTML/outerHTML + 1 `insertAdjacentHTML`, the survey modal, 13-11) | | supporting.js | 4 |
| pmo.js | 16 | | ted-launcher.js | 4 |
| execution.js | 10 | | **Total** | **241** in 13 files |

A raw grep for `.innerHTML =`/`+=` reports 311 (the plan's "about 300"); the 70 the scan does not count are `= ''` clears and
matches inside comments/strings (spot-checked on supporting.js and synergy-quest.js). Each remaining sink is a template-literal
or concatenation build of app-sourced data; none of them is on a stored-markup path enumerated by D-13-02. They are inventoried,
not fixed (exhaustive audit deferred per the PRD).

## Real-browser evidence (scratch script, Chromium via the npx Playwright 1.62.1; not committed)

Real extracted function source (`addMessageBubble`+`escapeHtml`, `openLessonModal`) run on a page with the real `safe-html.js`:

- `[x](javascript:alert(1))` -> `<a target="_blank" rel="noopener noreferrer">x</a>)` (no `href`); `data:text/html,...` link -> no `href`.
- `[TE](https://www.te.com/page?a=1)` -> `href` kept with `target="_blank" rel="noopener noreferrer"`; `**bold**` -> `<strong>`.
- `<img src=x onerror=alert(1)> <script>alert(2)</script>` typed in a message -> escaped text, 0 `img`, 0 `script`.
- Lesson with `<p onclick>`, `<script>`, `<img onerror>`, `javascript:` link: body rendered as
  `<p>Body <strong>bold</strong><img src="x"><a rel="noopener noreferrer">j</a></p>`, 0 scripts, title/quiz text kept as text,
  radios and Submit work (100% -> "Passed!").
- 0 page errors, 0 dialogs. The committed browser corpus is 13-12's.

## Verification

- `node --test test/client-render-paths.test.js test/xss-chain.test.js test/client-authz-hiding.test.js test/safe-html-policy.test.js
  test/egress-client.test.js test/client-xss-sinks.test.js test/slide-upload-safety.test.js`: 135 / 135.
- Full suite (`node --test`, worktree root, on `9a3b119`): **`# tests 1601  # pass 1600  # fail 1  # cancelled 0  # skipped 0`**.
  The single failure is the known date-sensitive `read-sets-org-reports.test.js` export row (pre-existing, owned by the sibling
  date-fix, untouched here). An earlier run of the same tree showed a second failure, `slide-sandbox-client (g)`, a
  source-shape pin on the old `row.innerHTML = \`...\`` template; it was re-pinned in the Task 2 commit (asserts textContent on
  `titleEl`/`subEl`, no innerHTML assignment, no interpolation on the list path) and passes.
- `npm run smoke` (full default set, isolated real-mode server) after Task 1 and after Task 2: 12 page x width visits, **0 with
  errors**, axe critical+serious total 37 (pre-existing informational), data/ + public/sent_emails/ unchanged, exit 0.
- `git status --porcelain data/ public/sent_emails/` empty at every commit; no `.db`/`-wal`/`-shm` staged.

## Deviations from Plan

**1. [Rule 1 - sink on an enumerated path] openLessonModal builds the whole modal by DOM** - see "What changed". The plan text
("render the modal shell as today") conflicts with its own region-scan acceptance (no `innerHTML` assignment inside the
function); intent followed.

**2. [Rule 2 - missing critical] inline-edit `renderBar` and admin-cms `loadSlides` also converted** - both assigned markup
(one interpolating `slug`, one a static error string) inside files this plan enumerates; converted so the whole-file scan of
inline-edit.js holds and the admin slide-list failure state is DOM-built. Cancel restoring original nodes (rather than
re-rendering a serialised string through MASafeHtml) is a deliberate strengthening: the allowlist would have stripped
`data-cms-layout` and other non-allowlisted attributes from a restored region.

**3. [Rule 3 - blocking] `slide-sandbox-client (g)` re-pinned** - not in `files_modified`; it asserted the old static row template
this plan removes. Intent kept and strengthened (no innerHTML assignment, no interpolation, textContent on both elements).

**4. client-authz-hiding stub** - not needed: its vm sandboxes only load the scripts / click path and never reach a rendering
call that depends on `MASafeHtml`; the file is unchanged and passes (81 / 81 in the combined run).

**5. Smoke tool resolution** - `npm run smoke` could not find `axe-core` by default on this host; run with
`AXE_CORE_PATH=<a host-local axe-core outside the repo>` (nothing installed, nothing under the repo touched).

## Findings for later plans (not fixed here)

- **13-11**: transitions.js still holds `document.body.insertAdjacentHTML('beforeend', modalHTML)` (survey-scores modal) and the
  sidebar/quick-nav templates - the one `insertAdjacentHTML` sink in the inventory is theirs.
- **13-12**: the committed browser corpus should include a chat message with a `javascript:` link, an i18n-html value with
  `onerror`, a lesson body with the same, and an inline-edit cancel round trip on a page-body region.
- `MASafeHtml` is not a layout engine: an allowlisted `<img src>` begins loading when the node is created (same note as 13-06).
- A pasted `contentEditable` value read back by `.innerHTML` for `/api/i18n` is sanitised by the server (13-01); the live element
  keeps whatever the browser's own editing produced until the next render.

## Known Stubs

None.

## Threat Flags

None - no new network endpoint, auth path or schema change.

## Threat model status

| ID | Status | Evidence |
| -- | ------ | -------- |
| T-13-80 | mitigated | `addMessageBubble` through MASafeHtml; real-Chromium run: `javascript:`/`data:` links lose their href; region-scan entry |
| T-13-81 | mitigated | `[data-i18n-html]` apply + inline-edit restore via MASafeHtml / original-node restore; region-scan entries |
| T-13-82 | mitigated | lesson body rendered into an empty container by MASafeHtml; real-Chromium run; region-scan entry |
| T-13-83 | mitigated | static gate with negative control (and proven to fail on the pre-fix source) |
| T-13-84 | accepted (bounded) | 241 not-enumerated sinks inventoried above; strict CSP (D-13-03 / 13-13) is the second layer |

## Self-Check: PASSED

- `test/client-render-paths.test.js`, `.planning/phases/13-content-safety/13-09-SUMMARY.md` present; `stripDangerousHtml` absent
  from `public/js` (asserted by the gate).
- Commits `7720bde` (Task 1) and `9a3b119` (Task 2) present on the worktree branch.
