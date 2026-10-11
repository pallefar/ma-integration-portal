---
phase: 13-content-safety
fixer: C (client side)
review_path: .planning/phases/13-content-safety/13-REVIEW-CLIENT.md
base: a19fcbe1beca270b30f9a044168a29b474fca66c
fixed_at: 2026-10-11
iteration: 1
findings_in_scope: 12
fixed: 9
accepted: 2
no_action: 1
status: all_addressed
---

# Phase 13 — Code Review Fix Report, Part B (client side)

**Source review:** `13-REVIEW-CLIENT.md` (Fable 5.1, Part B). **Base:** `a19fcbe`. **Owner rule:** fix it all, except the
items the dispatch marked ACCEPT or CONDITIONAL.

| Finding | Severity | Outcome | Commit |
|---|---|---|---|
| CR-B01 | HIGH | FIXED | `8222077` |
| WR-B01 | MEDIUM | FIXED | `3836f3e` |
| WR-B02 | MEDIUM | FIXED | `e04fad4` |
| WR-B03 | LOW | FIXED | `12ff575` |
| WR-B04 | LOW | FIXED | `b9ff87b` |
| WR-B05 | LOW, CONDITIONAL | ACCEPTED: the computed-style comparison showed a layout change (see below) | none |
| WR-B06 | LOW | FIXED | `6f2c9de` |
| IN-B01 | INFO | FIXED: the sweep was extended to attribute positions (WR-B04), table below | `b9ff87b` |
| IN-B02 | INFO | FIXED | `2d7d98a` |
| IN-B03 | INFO | NO ACTION (as decided; the whole-tree gate belongs to 13-13) | none |
| IN-B04 | INFO | FIXED (files deleted; grep found no reference) | `fa9974e` |
| IN-B05 | INFO | DOCS ONLY (text owed to DEPLOYMENT.md, below) | none |

All verification ran **in this worktree** (the harness-managed isolated worktree `agent-a06b7c7aedbcf16f0`). `node_modules`
is committed in this repo, so the worktree has the real dependency tree and the numbers can be reproduced from the
merged branch.

---

## Per finding

### CR-B01 — pmo-writable `modules.playbookLink` raw in an `href` (FIXED, `8222077`)

- **Client.** `public/js/dashboard.js` `renderActionModules` now builds the whole recommended-modules card with
  `createElement`/`textContent`/`setAttribute`. The function has no HTML-string sink left: status lines use
  `replaceChildren` + textContent. `playbookLink` reaches `href` only through `MASafeHtml.safeHref(...) || '/playbook.html'`.
  The function is a new `ENUMERATED_PATHS` entry (`dashboard.js` / `function renderActionModules(`), so the region gate
  rejects any `innerHTML`.
- **Server.** `validators/index.js` gains ONE shared `urlField(max, { alsoAllow })`:
  `z.string().trim().max(max).refine(v => v === '' || (no control char && /^(?:\/(?![/\\])|#|\?|https?:\/\/)/i), 'Link must be a relative path or http(s) URL')`.
  It is applied to every URL-valued writable field the `grep -rn` of `validators/` found:
  - `modules.playbookLink` (`validators/workstream.js`), the pmo-writable source;
  - lesson `playbookLink` and sidebar `href`, landing-card `href`, **bookmark `page`**, page-block `ctaHref`, page-block
    `href` (`validators/cms.js`; the URL-field hunks plus the import line only, nothing near `i18nOrString`);
  - `welcomeVideoUrl`, `_en`, `_de`, `_zh`, `_cs` (`validators/settings.js`).
- **Checked, deliberately not changed.** `dd.js` VDR `url` already requires an absolute http/https URL. Slide `url`
  (`validators/cms.js` `SlideUpsertSchema`) keeps its own handler contract: only admins write it (`/api/slides` is admin-only
  per D-11-02); `openHtmlSlide` refuses anything that is not http(s) before it builds the frame or the "Open in new tab"
  anchor; and the admin slide list renders it with textContent. `htmlEmailPath` is server-generated and not in any
  schema. ProjectCreateSchema `intake` is a free-text record that is never rendered as a URL.
- **Seed/demo proof.** The scan covered read-only scratch **copies** of `data/demo.db`, `data/control.db` and
  `data/ma-portal.db`: every JSON value under a key ending in url/href/link/src, plus `welcomeVideoUrl*`. Every real
  URL-field value passes the rule:
  - sidebar hrefs: `/`, `/dashboard.html`, `#survey-modal`, `/employee.html?name=…`, …;
  - playbook links: `/playbook.html#culture|talent|value`;
  - slide url: `/slides/welcome-slide.html`;
  - YouTube watch URLs, and an empty `welcomeVideoUrl`.
  The only rule misses were four i18n *strings* (`survey.playbook_card_link`), which are labels and not URL fields.
  `db/*Seed*.js` holds no URL fields. All test fixture values (`/execution.html`, `/assessments.html`,
  `https://example.test/…`, `/uploads/welcome.mp4`, …) pass.
- **Tests.** New file `test/url-field-safety.test.js`:
  - `urlField: refuses every non-http(s) scheme, protocol-relative forms, control characters and bare names`;
  - `urlField alsoAllow: widens for exactly the named token shape (bare YouTube id), never a scheme`;
  - `registry: every URL-valued write field refuses the payloads and keeps legitimate values`. It covers all 12 fields
    through the real `resolveSchema`;
  - `server: pmo POST /api/modules with the review payloads answers 400 and stores nothing; a legitimate link is stored`;
  - `render: a legacy unsafe playbookLink inserted straight into the store renders inert through dashboard.js renderActionModules`.
    This row inserts legacy rows below the API into the temp deal DB, serves them through the real `GET /api/modules`, and
    runs the real `renderActionModules` plus the real `safe-html.js` under node:vm with a DOM stub whose
    `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write` throw. Results: `javascript:` falls back to
    `/playbook.html`, the breakout string is a same-origin relative path set by setAttribute, and stored text stays text.

### WR-B01 — third sign-out path bypassed D-13-06(b) (FIXED, `3836f3e`)

- `public/js/account-menu.js` `endSession`: when the ended session is the current one,
  `(window.MAClientStorage ? MAClientStorage.clearOnLogout() : Promise.resolve()).then(leave, leave)`, which is the
  review's pattern.
- **Addition beyond the review.** The server now answers this path with `Clear-Site-Data`, which in a secure context
  wipes localStorage as soon as the DELETE response lands. That is BEFORE `clearOnLogout` takes its language snapshot.
  So `endSession` snapshots `MAClientStorage.LANGUAGE_KEYS` before the request, and `leave` restores them.
- `server.js` `DELETE /api/auth/sessions/:id`: the `endedCurrent` branch sets `Clear-Site-Data: "cache", "storage"`. This
  is the one-hunk ownership. Ending another device's session sends no such header.
- **Tests** (`test/caching-safe07.test.js`):
  - `SAFE-07 (b) / WR-B01: DELETE /api/auth/sessions/:id sends Clear-Site-Data only when the ended session is the caller's own`;
  - `account-menu (WR-B01): ending the current session clears the browser like logout and keeps the language key`. It runs
    the real `endSession` plus the real `client-storage.js` under vm, and the DELETE stub simulates the server wipe;
  - `account-menu (WR-B01): without MAClientStorage it still leaves for /login.html; ending another device clears nothing`;
  - `static: account-menu.js "End this session" calls MAClientStorage.clearOnLogout() before navigating to /login.html`.

### WR-B02 — render-path gate false-pass classes (FIXED, `e04fad4`)

- `findSinks` (`test/client-render-paths.test.js`) now also reports:
  - `setHTMLUnsafe(` and `createContextualFragment(`;
  - `.srcdoc =` and the bracket form `['srcdoc'] =`;
  - `parseFromString(` in every file except `safe-html.js`;
  - `importNode(`/`adoptNode(` and `insertAdjacentElement(`.
- `uses` is judged on the string-masked region. Render-kind entries (`render: true`) must contain the literal
  `MASafeHtml.render(` or `MASafeHtml.toFragment(` call: page-layout, page-cms, addMessageBubble, applyPortalI18n,
  fetchSmolInsight, inline-edit, openLessonModal.
- `test/safe-html-policy.test.js` no-sink scan mirrors this with `.srcdoc`, `importNode`/`adoptNode`,
  `insertAdjacentElement`, and a parsed-node re-attachment check. In that check, `appendChild` may only take a created
  text node, element or fragment, `replaceChildren` only `frag`, and no `append`/`prepend`/`insertBefore`/`replaceWith`/
  `before`/`after` is allowed.
- **Negative controls:**
  - `scanner negative control (WR-B02): the review probe shapes are all caught`. It covers every probe in the review table
    plus importNode/adoptNode, the srcdoc bracket form, the safe-html.js exemption, and prose/strings that are not hits;
  - `scanner negative control (WR-B02): \`uses\` ignores strings; render-kind needs the literal renderer call`;
  - `safe-html (no-sink) negative control: the re-attachment check catches the DOMParser-adopt shapes`.
- Inventory now: 246 not-enumerated sinks in 18 files. The one `insertAdjacentElement` (`employee.js`, a
  createElement-built card) is counted, not hidden.

### WR-B03 — overview relay accepted any origin/source (FIXED, `12ff575`)

- `public/js/pages/overview-1.js` ignores a message unless `e.origin === location.origin` and
  `e.source === #deckframe.contentWindow`. `open-slide` also requires `typeof url === 'string'` and
  `^/overview-deck/[\w.-]+\.html$`. A non-string label falls back to `'Slide'`.
- No COOP header, as decided.
- **Test.** New file `test/overview-relay-origin.test.js` runs the real relay under vm, with 4 rows:
  - the first-party deck still works;
  - a foreign origin (including the `null` opaque origin of a sandboxed slide) is ignored;
  - a same-origin non-deck source is ignored;
  - off-portal, traversal, query and nested URLs, arrays and objects are ignored.

### WR-B04 — stored URLs escaped but not scheme-checked (FIXED, `b9ff87b`)

- **Sweep.** Covered `href="${`, `src="${`, `action="${`, prefixed `src="https://…${`, concatenation
  `href="' + x + '"`, `.href|.src|.action|.formAction|.poster =`, and `setAttribute('href'|'src'|…)` across `public/js`.
  `public/*.html`, `overview-deck/*.html` and `slides/*.html` contain no `${` interpolation at all.
- **Fixed sinks.** Every one now uses `escapeHtml(safeLink(v))`. `safeLink` is a fail-closed `MASafeHtml.safeHref`
  wrapper placed beside each file's `escapeHtml`:
  - `admin.js:660` module playbook link and `admin.js` htmlEmailPath link;
  - `employee.js` lesson `playbookLink` (`cmsEsc(safeLink(…))`), welcome `<video src>`, and htmlEmailPath ×2;
  - `pmo.js` and `dashboard.js` htmlEmailPath.
- **`transitions.js:2793`** custom sidebar link: `href` only via `MASafeHtml.safeHref`, otherwise the link is not
  rendered. This mattered: `tokenOf` only skipped lower-case `javascript:`, so `JavaScript:` produced a link.
- **YouTube id.** `employee.js` `getYoutubeId` and the bare-id fallback (×2) now require `^[\w-]{11}$` through a hoisted
  `isYoutubeId()`. It is a function, not a const, so callers above it never hit the TDZ. This closes the embed `src`, the
  thumbnail URL and the CSS `url('…')` injection.
- **`style="${` sweep.** Every interpolated value comes from a lookup map, a numeric value, or a role/status constant. No
  stored string reaches a style attribute raw.
- **Gate.** New tests in `test/client-render-paths.test.js`:
  - `URL attribute gate (WR-B04): every href/src/action write from data is scheme-checked (and escaped in markup)`. Markup
    interpolation and concatenation must be `ESCAPER(CHECKER(…))`. Property and setAttribute writes must be a literal, a
    template with a fixed safe prefix, or a checker call. `URL_ATTR_EXEMPT` lists 16 provably non-stored sources with
    reasons: constants, blob URL, same-host-filtered navigation, a data object, local variables holding a checked
    result. A stale exemption fails;
  - `URL attribute gate negative control (WR-B04): the review sinks and their shapes are caught; safe forms pass`. It
    covers all four review sinks, plus `.action =`, a `javascript:` literal, and `${v}`-first templates.
- `test/egress-client.test.js` adds
  `WR-B04 (Phase 13 review, Part B): getYoutubeId only yields an 11-char [A-Za-z0-9_-] id; safeLink fails closed`. Its
  video vm harness and the `client-authz-hiding` inbox harness also load the new helpers.

### WR-B05 — authored `class` can wear full-screen chrome (CONDITIONAL → ACCEPTED)

- **Candidate rule:** `.cms-authored *, .pl-richtext *, .cms-editable-body *, .lesson-body *, .teodor-bubble *, #smol-insight-content * { position: static !important; }`.
  These are the real container classes found in page-layout.js, page-cms.js, inline-edit.js, employee.js and
  transitions.js.
- **Method.** A scratch Chromium script outside the repo, using playwright-core 1.62.1 and the cached Chromium build
  1234. It booted this worktree's server on an isolated temp-DB copy with `DEMO_OPEN=1`. It covered dashboard, playbook,
  capability-hub, integration-excellence, and employee with a lesson modal open, each at 390/768/1280 px. For every
  element in the containers it compared the box and computed `position`, plus an element screenshot of the container,
  with and without the rule.
- **Committed demo content.** The demo CMS page bodies are **empty** (all three pages, unpublished). The golden lesson
  bodies are plain `<p>`. The lesson modal shows 0 diffs and identical screenshots at all widths. The dashboard holds no
  authored container content apart from the AI-insight span (0 diffs).
- **Realistic authored content.** The pages were published in the copy with a body built from the golden lesson values,
  plus app classes an author would plausibly reuse (`card`, `btn btn-secondary`, `hero-badge`, `badge`), a list, a table
  and an image. Result: `.card` and `.btn` change `relative → static`, and the container screenshots **differ** at 768
  and 1280 px. 390 px also shifted. Their absolutely positioned pseudo-elements re-anchor to a farther ancestor.
- **Decision rule applied:** implement only on "no layout change" → **ACCEPTED, not implemented.**
- **Carry-in:** revisit if any non-admin role gains CMS authoring. Since D-11-02 only admins write
  pages/lessons/menus/banners/slides, so the residual is admin → viewer redress. A class-prefix allowlist on both
  sanitizers would be the follow-up.

### WR-B06 — inline-free gates had false-pass shapes (FIXED, `6f2c9de`)

- **Both HTML checkers** (`csp-inline-free-pages.test.js`, `csp-inline-free-decks.test.js`):
  - numeric and named entities (`&#…;`, `&#x…;`, `&Tab;`, `&NewLine;`, `&colon;`, …) are decoded, and
    whitespace/controls are dropped, before the `javascript:` test;
  - handler attributes match `[\s/]on[a-z]+\s*=`;
  - `<script src>` must be `/js/…` or `/vendor/…`, so `data:`, `blob:`, `//cdn` and `https://cdn` are flagged.
- **External/JS-tree checks:**
  - unquoted handlers (`HANDLER_ATTR_IN_STRING` no longer requires a quote, and admits a slash separator). Measured
    beforehand: 0 hits in the tree;
  - `.setAttribute('on…')`;
  - decoded `javascript:` in JS markup strings.
- **Negative controls:**
  - `negative control (WR-B06): slash-separated handlers, entity/tab-obfuscated schemes and non-/js/ script sources are caught`
    (pages; 12 probes plus external rows);
  - `checker negative control (WR-B06): slash-separated handlers, encoded schemes and non-/js/ script sources are caught`
    (decks);
  - additions to `client JS gate self-test`.
- `test/csp-strict-gate.test.js` (13-13) was not touched.

### IN-B02 — bfcache restore after logout on plain HTTP (FIXED, `2d7d98a`)

`public/js/transitions.js`: `window.addEventListener('pageshow', (e) => { if (e.persisted) window.location.reload(); });`.
It sits in the SAFE-07 init block right after `runLegacyCleanupOnce`, as one small hunk. Static row:
`static (IN-B02): transitions.js reloads a page restored from the back/forward cache`.

### IN-B04 — `public/doom/*` saved 404 pages (FIXED, `fa9974e`)

- **Grep.** A repo-wide `grep -rnI` excluding node_modules/.git/vendor covered `public/**` (including `overview-deck/`
  and `slides/`), `server.js`, `lib/`, `test/`, `scripts/`, package files and docs. It found no reference to
  `js-dos`/`wdosbox`/`/doom/` outside planning docs. The `doom*` settings keys (`doomGloballyEnabled`, `launchDoomProtocol`)
  are the TEd easter-egg and do not load these files.
- **Deleted:** `js-dos.js`, `wdosbox.js`, `wdosbox.wasm`.
- **Updated:** the `.planning/codebase/STRUCTURE.md` tree entry.
- **Not edited:** `.planning/graphs/*` (generated graphify snapshots) still name the files until the next graph build.
- `asset-cache-bust`, `lockdown-asset-allowlist`, `db-artifact-exclusion` and `file-modes` stay green.

### IN-B01 — lower-privileged-writable sinks, by writer role (sweep extended by WR-B04)

| Source (lowest writer) | Field(s) | Sink | Disposition |
|---|---|---|---|
| `modules` (pmo/hrbp, DEFAULT_WRITE_ROLES) | `playbookLink` | dashboard card href; admin.js module list href | FIXED: urlField server + DOM/safeHref, escapeHtml(safeLink) |
| `modules` (pmo) | title/urgency/description/supportingTeams | dashboard card; admin list | dashboard: textContent now; admin: escapeHtml (unchanged) |
| `communications` (pmo, `/api/communications/send`) | subject/body/sender/recipient | admin/pmo/dashboard/employee inbox cards | escapeHtml (sampled clean by the review) |
| `communications` | `htmlEmailPath` (server-generated) | 5 inbox "View email" hrefs | FIXED anyway: escapeHtml(safeLink) — uniform rule, gate-enforced |
| `pulses` (employee) | name/comment | dashboard.js, pages/dashboard-1.js | escaped (review sample) |
| `employees` via get-or-create (employee) | name/role/department/company | admin.js, signage.js, leaders.js | escaped |
| `employees` (employee) | `buddyEmail` | leaders.js `buddyEmailEl.href = \`mailto:${…}\`` | ACCEPTED: fixed `mailto:` prefix via property assignment — scheme cannot change; header-param injection only |
| `assessment-instances` (employee) | respondentName | assessments.js | `esc()`; scores are server-computed numbers |
| `questions` (pmo) | text | app.js survey | textContent |
| RAID / tasks / synergies (pmo) | titles/notes | execution.js | `esc()` |
| departments / processCatalog (pmo) | name/systems/phase/risk | dashboard.js | escaped; style colours from lookup maps (`PROC_RISK`, `procStatusMeta`), never raw |
| DD findings / VDR (pmo/hrbp) | `vdrLink.url` | due-diligence.js | `safeVdrUrl` + absolute-http(s) zod rule |
| CMS (admin only since D-11-02) | lesson playbookLink, menu href, bookmark page, ctaHref/href, welcomeVideoUrl* | employee.js, transitions.js, page-layout.js | FIXED: urlField + safeLink/safeHref at render |

---

## Deviations

1. **Worktree setup.** The agent prompt's `setup_worktree` step would hand-roll a nested worktree. This run was already
   dispatched into a harness-managed isolated worktree (branch `worktree-agent-a06b7c7aedbcf16f0`, HEAD verified equal to
   BASE). So every commit landed on this branch directly (`wt="."`). No nested worktree, temp branch or recovery sentinel
   was created, and there is no cleanup tail.
2. **CR-B01 client shape.** The decision text said `escapeHtml(MASafeHtml.safeHref(m.playbookLink) || '/playbook.html')`
   in the template. The same decision also requires the card to be an `ENUMERATED_PATHS` entry, and that region gate
   rejects every `innerHTML` in the function. So the card is DOM-built, and the href goes through
   `setAttribute(safeHref(…) || '/playbook.html')`. With setAttribute no HTML parser is involved, so escaping is moot.
   The intent (scheme check + no breakout) is met more strongly.
3. **urlField tightening.** The decided regex `\/(?!\/)` admits `/\host`, which browsers treat as `//host`
   (protocol-relative). The rule uses `\/(?![/\\])`, which is stricter. It also refuses control characters: the URL
   parser drops tab/LF anywhere, so `/<TAB>/host` would otherwise be `//host`.
4. **urlField widening, recorded.** `welcomeVideoUrl*` also accepts a bare 11-character YouTube id (`^[\w-]{11}$`). The
   employee page explicitly supports an id in place of a URL. An id is a plain token and can never carry a scheme.
5. **Extra field.** Bookmark `page` (`validators/cms.js`) is URL-valued: it becomes the quick-nav href
   (`page + '#' + section`). It was found by the grep and got the same rule.
6. **`mailto:`/`tel:` refused in these fields.** This follows the decided regex. No seed value or fixture uses them. The
   client `safeHref` still accepts them inside richtext.
7. **Playwright location.** The prescribed `~/.npm/_npx/e41f203b7505f1fb/…/playwright` no longer exists (the npx cache was
   emptied earlier today). `playwright-core@1.62.1` was installed into this session's scratchpad with `--ignore-scripts`.
   That is outside the repo, with nothing installed in the repo. It drove the cached Chromium build 1234 and was deleted
   after the run.
8. **Test harness adjustments.** `test/egress-client.test.js` and `test/client-authz-hiding.test.js` extract individual
   employee.js functions into vm sandboxes. They now also load `isYoutubeId`/`safeLink`, and egress-client stubs
   `escapeHtml`, whose regex literal defeats that file's quote-aware extractor.

## Docs owed to DEPLOYMENT.md

(Plan 13-13 owns DEPLOYMENT.md, so these sentences are handed over rather than written here.)

- **IN-B05:** "Dev mode, meaning no `MA_MODE=real` and no `DEMO_OPEN`, inherits the **demo** egress defaults: YouTube,
  Hugging Face and Gemini are switched on. A laptop-local dev run therefore makes third-party requests, for example
  `img.youtube.com` thumbnails on the employee page. Use `MA_MODE=real` (or switch the egress panel off) for any run that
  must stay offline."
- **Stored links (CR-B01/WR-B04):** "Every stored link field must be a relative path (`/…`, `#…`, `?…`) or an absolute
  `http(s)://` URL; any other value is refused with 400. This covers module and lesson playbook links, sidebar,
  landing-card and bookmark targets, CMS hero/CTA links, and the welcome-video URLs (a bare 11-character YouTube id is
  also accepted). Values stored before this release are not migrated. They are neutralised at render time (an unsafe
  link renders as `#` or the playbook fallback). The admin menu editor saves the whole menu list, so it reports a 400
  naming the offending row (e.g. `sidebar.3.href: Link must be a relative path or http(s) URL`) until that row is
  corrected."
- **WR-B01:** "Ending your *current* session from the account menu is a sign-out: the browser storage is cleared (the
  language preference is kept) and the response carries `Clear-Site-Data: "cache", "storage"`. Ending one of your *other*
  sessions leaves this browser untouched. `Clear-Site-Data` is honoured only in secure contexts (HTTPS or localhost); the
  client-side clearing runs everywhere."
- **IN-B02:** "A page restored from the browser's back/forward cache always reloads, so after sign-out the Back button
  cannot show the previous user's page even on a plain-HTTP LAN host where `Clear-Site-Data` is ignored."
- **WR-B05 (accepted residual):** "CMS content may use the portal's own CSS class names. An author can therefore make
  content look like application chrome, such as an overlay. Only administrators can author CMS content; treat CMS
  authoring as a trusted-admin capability."

## Scenarios owed to plan 13-12's runner (browser proofs)

- **CR-B01:**
  1. As `pmo`, POST `/api/modules` with `playbookLink` = `x" ><img src=x onerror="window.__xss=1"><a href="` and with
     `javascript:window.__xss=1`. Expect 400 for both and no module stored.
  2. Insert the same two values as legacy rows straight into the temp deal DB, with `minScore 0`/`maxScore 5` so they are
     recommended. As `admin` and as the IL (`hrbp`), open `/dashboard.html` and reach the recommended-modules section.
     Expect `window.__xss` undefined, no dialog, and no `<img>` inside `#hr-modules-container`.
  3. Each "Open Playbook Chapter" anchor's resolved `href` is same-origin. The `javascript:` row is `/playbook.html`.
  4. Clicking the anchors executes nothing.
  5. Repeat under `CSP_MODE=report-only` and enforce: 0 CSP violations.
- **WR-B01:**
  1. Log in and seed `localStorage` (`employeeLanguage=de`, `active_demo_role`, `pmo_tasks_state`), a `sessionStorage`
     key and a Cache Storage entry.
  2. Open the account menu → Your sessions → "End this session" on the current session.
  3. Expect: lands on `/login.html`; `localStorage` holds only `employeeLanguage=de`; `sessionStorage.length === 0`;
     `caches.keys()` is empty; the DELETE response carries `Clear-Site-Data: "cache", "storage"`.
  4. Second run: with two sessions, end the *other* one. Storage is untouched and the list reloads.
- **WR-B03:**
  1. On `/overview.html`, a cross-origin page opens the portal with `window.open` and posts
     `{type:'deck-overlay',open:true}` and `{type:'open-slide',url:'https://attacker.example/x'}`. Expect no
     `body.deck-fullscreen` and no slide overlay.
  2. Open a slide via `openHtmlSlide` (sandboxed, opaque origin) whose script does `parent.postMessage({type:'open-slide',url:'/overview-deck/agenda.html'},'*')`.
     Expect it to be ignored.
  3. The deck's own Agenda button still opens the agenda overlay, and the layer overlays still toggle full-screen.
- **WR-B04:** Insert legacy rows below the API into the temp DB:
  1. A custom sidebar menu item with `href: 'JavaScript:window.__xss=1'` → the link is not rendered.
  2. A lesson `playbookLink: 'javascript:window.__xss=1'` → the employee academy anchor href is `#`.
  3. `welcomeVideoUrl_en: 'javascript:alert(1)'` with type `local` → `<video src>` resolves same-origin `#`, nothing
     executes.
  4. A YouTube URL whose id contains a quote → no embed and no thumbnail request.
  5. A module `playbookLink: 'javascript:…'` → the admin module list "Playbook" link href is `#`.
  For all of these: no `window.__xss`, no dialog, and 0 CSP violations in both modes.

## Open items

- Slide `url` has no server-side scheme rule. The dispatch excluded it ("its own handler contract"). That contract is
  admin-only writes plus the http(s)-only `openHtmlSlide` and a textContent list. Every committed value
  (`/slides/welcome-slide.html`) and every value the upload route returns (`/uploads/slides/…`) would pass `urlField`. So
  adding the rule later is a one-line change if the owner wants it.
- Absolute `http(s)` links stay allowed in every URL field (CSP does not govern navigation). An admin- or pmo-authored
  off-portal lure is still possible by design; this is documented above.
- Legacy stored URL values are not migrated, only neutralised at render. A menu save fails until an offending legacy row
  is fixed; see the DEPLOYMENT text above.
- WR-B05 is accepted with the carry-in above.
- `.planning/graphs/*` still lists the deleted doom assets until the next graphify build.

## Verification

- Per-finding targeted runs: CR-B01 affected-route set 392/392. Client set (render-paths, xss-sinks, egress-client,
  authz-hiding, xss-chain, safe-html-policy, asset-cache-bust, csp-inline-free-pages) 168/168. Caching/account/sessions
  53/53. Inline-free gates 41/41. `asset-cache-bust` green after every client change (content-hash stamps are automatic;
  no manual `?v=` bump).
- Full suite (`node --test`, worktree root): see "Full suite" below.
- `git status --porcelain data/ public/sent_emails/` was empty at every commit. No `.db`/`-wal`/`-shm` was staged, and no
  server ran against a committed DB: the WR-B05 server used temp copies and `POST /api/settings/new-ma` was never called.

### Full suite

`node --test` from the worktree root on `fa9974e` (all fix commits), backgrounded into a log:

```
1..1597
# tests 1663
# suites 0
# pass 1663
# fail 0
# cancelled 0
# skipped 0
# todo 0
EXIT=0
```

(Base at the 13-11 merge was 1640. The +23 are this fixer's new rows.)
