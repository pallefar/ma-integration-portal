---
phase: 13-content-safety
review: client (Part B)
reviewed_commit: 766195a
diff_base: a0656ef
reviewed: 2026-10-11
reviewer: Fable 5.1 (independent, adversarial)
scope: >
  MASafeHtml and every render path routed through it; externalised inline code (public/js/pages, public/js/overview-deck);
  all public/*.html + decks (script order, inline code); generated handlers in transitions.js; egress client gates;
  logout clearing / cache-wipe removal; openHtmlSlide() sandbox; the client-side tests and gates.
method: >
  Code trace at 766195a via `git show`; live attacks in real Chromium (host-local Playwright 1.62.1 + Chromium build 1234)
  from scratch scripts outside the repo; the 766195a tree exported to a scratch directory and booted against temp MA_*
  stores (copies of the committed DBs; the committed files were never opened by a server); gate regexes re-run on probes.
findings:
  critical: 0
  high: 1
  medium: 2
  low: 4
  info: 5
  total: 12
status: issues_found
---

# Phase 13 — Content Safety — Independent client-side review (Part B)

**Reviewed:** commit `766195a` (plans 13-01..13-11 merged; 13-12/13-13/13-14 in flight and NOT reviewed)
**Contract:** PHASE-13-PRD D-13-01..07 + acceptance 1-6, 13-CONTEXT, 13-PLAN-CHECK, 13-06/08/09/10/11 PLAN+SUMMARY, R1-03/04/14/16, R5-07/15.

## Summary

The core deliverable is sound: `public/js/safe-html.js` survived 313 corpus vectors plus 76 novel vectors (mXSS, namespace
switches, DOM clobbering, scheme obfuscation, CSS smuggling, deep/huge input) in a real Chromium with **zero** policy
violations, zero script execution and zero divergences from the server sanitizer on the 44 golden demo values. All 28
HTML files in `public/` are inline-free, and a Chromium walk of all of them under `CSP_MODE=enforce` (authenticated
admin + pmo, demo-open, and real mode) produced **zero** CSP violations and zero page errors; real mode made **zero**
non-self requests.

The findings are at the edges the plans drew around themselves. One is live now: a **pmo-writable URL field
(`modules.playbookLink`) is interpolated raw into an `href` on the admin/IL dashboard**, and because the shipped header at
`766195a` still enforces the legacy policy with `'unsafe-inline'`, an `<img onerror>` smuggled through it executes in the
admin's session on render (reproduced). That is exactly the R1-03 class the PRD says is "bounded by CSP" — the bound does
not exist until 13-13 flips the mode, and even then the sink remains a phishing link. A third sign-out path bypasses the
D-13-06 clearing, the render-path gate has demonstrable false-pass shapes, and three smaller residuals are listed below.

---

## Findings

### CR-B01 — HIGH — pmo-writable `modules.playbookLink` rendered raw into an `href` on the admin/IL dashboard; executes under the policy enforced at 766195a

**Where**
- `public/js/dashboard.js:456` `fetch('/api/modules')` → `:500`
  `<a href="${m.playbookLink || '/playbook.html'}" class="btn btn-secondary" …>Open Playbook Chapter</a>` — inside an
  `innerHTML` template, no escaping, no scheme check.
- Writer: `server.js:8527 app.post('/api/modules')`; `/api/modules` has **no** `ROLE_WRITE_POLICY` entry (`server.js:641-719`),
  so it inherits `DEFAULT_WRITE_ROLES = ['admin','hrbp','pmo']` (`:719`). `validators/workstream.js:412`
  `playbookLink: z.string().trim().max(2000).optional()` — any characters, any scheme. `minScore`/`maxScore` are also
  writer-controlled, so the "recommended" filter (`dashboard.js:470-478`) is trivially satisfied.
- Reader: `lib/readPolicy.js:92` `/api/modules` → ALL_ROLES; the dashboard is the IL's and admin's home page.
- Policy actually enforced at this commit: `lib/csp.js` default `CSP_MODE=report-only` → `Content-Security-Policy` is
  `LEGACY_SCRIPT_SRC` = `'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'`; the strict policy is Report-Only.

**Reproduced (Chromium, exact template string, page carrying each policy)**

| policy | payload in `playbookLink` | result |
|---|---|---|
| legacy (enforced today) | `x" ><img src=x onerror="…"><a href="` | **executed on render, no click** |
| legacy (enforced today) | `javascript:…` | `a.protocol === 'javascript:'` — runs on click |
| strict (after 13-13) | both | blocked (`script-src-attr` violation) |
| either | `https://attacker.example/reset-password` | trusted-looking "Open Playbook Chapter" button navigates off-portal — CSP does not govern navigation |

**Scenario.** A `pmo` (or any compromised pmo session) POSTs a module with the payload; the Integration Lead or admin opens
`/dashboard.html`; the script runs with their session (settings, egress switches, user management, every MNPI read the
admin may perform). This is the R1-03 escalation the phase exists to close, through a sink the 13-09 inventory filed as
"app-sourced data … none on a stored-markup path". After enforce it degrades to markup injection / phishing, which is
still a defect on an MNPI portal.

**Fix (minimal).**
```js
// dashboard.js:500
<a href="${escapeHtml((window.MASafeHtml && window.MASafeHtml.safeHref(m.playbookLink)) || '/playbook.html')}" …>
```
Server, `validators/workstream.js:412` (and `validators/cms.js:64` lesson `playbookLink`, `:124/:141` menu `href`,
`:180/:185` cta hrefs): `.refine(v => v === '' || /^(?:\/(?!\/)|#|\?|https?:\/\/)/i.test(v), 'Link must be a relative path or http(s) URL')`.
Gate: add a scan to `test/client-render-paths.test.js` — any `href="${` / `src="${` interpolation whose expression is not
wrapped in `safeHref`/`safeUrl`/`safeVdrUrl` fails — and add the recommended-modules card to `ENUMERATED_PATHS`.

---

### WR-B01 — MEDIUM — Third sign-out path ("End session" on the current session) bypasses D-13-06(b) clearing on both sides

**Where** `public/js/account-menu.js:274-279`: `fetch('/api/auth/sessions/'+id, {method:'DELETE'})` → on
`body.endedCurrent === true || s.current` → `window.location.href = '/login.html'` — no `MAClientStorage.clearOnLogout()`,
no sessionStorage / localStorage / Cache Storage clearing. Server `server.js:1549-1559` (`DELETE /api/auth/sessions/:id`)
clears the cookie and sets `no-store` but sends **no** `Clear-Site-Data`, unlike `POST /api/auth/logout` (`:1360`).

**Scenario.** On a shared workstation the user signs out via the account menu's "End this session". The server session is
revoked, but `active_demo_role`, `ma_auth_role_verified`, drafts (`pmo_tasks_state`, `pmo_blockers_state`,
`te_leader_checklist_*`, `coachingChecklist`, `ilStretchTasks`, `welcome_kit_orders`, `active_assessment_id`), every
sessionStorage dismissal flag and the whole Cache Storage survive for the next user. None of today's keys is MNPI-grade,
but D-13-06(b) is a control ("the client logout path additionally clears…"), the caching-safe07 static rows pin only the two
other paths, and this is the one a security-conscious user is most likely to use.

**Fix.** `account-menu.js:279`: replace the bare navigation with
`var leave=function(){window.location.href='/login.html';}; (window.MAClientStorage ? window.MAClientStorage.clearOnLogout() : Promise.resolve()).then(leave, leave);`
(the extra `POST /api/auth/logout` is a harmless 200 on an already-dead cookie), or export a `clearLocalState()` from
client-storage.js that skips the server call. Server: set `Clear-Site-Data: "cache", "storage"` on the `endedCurrent`
branch. Add an `account-menu.js` row to `test/caching-safe07.test.js`.

---

### WR-B02 — MEDIUM — The render-path gate (`test/client-render-paths.test.js`) has false-pass classes that re-admit the exact anti-pattern MASafeHtml exists to prevent

**Where** `findSinks` patterns at `:151-153` (+ bracket form) match only `innerHTML`/`outerHTML` assignment,
`insertAdjacentHTML(` and `document.write(`. Re-running those regexes on probes:

| probe (inside an enumerated function) | gate |
|---|---|
| `el.setHTMLUnsafe(html)` | MISSED |
| `el.append(document.createRange().createContextualFragment(html))` | MISSED |
| `el.append(...new DOMParser().parseFromString(html,'text/html').body.childNodes)` | MISSED |
| `fr.srcdoc = html` | MISSED |
| `el.insertAdjacentElement('beforeend', parsed.firstElementChild)` | MISSED |
| `el.innerHTML = html` (control) | caught |

The DOMParser-adopt shape matters most: parsed nodes are inert only inside the parser document — once adopted their
`on*` attributes and `javascript:` hrefs are live. A future edit that "simplifies" `MASafeHtml.render(el, v)` into that
line passes the gate, and the `uses` check (`scanEntry`, any of `MASafeHtml|textContent|createElement` as a substring of
the comment-stripped region, strings included) is satisfied by an unrelated `createElement` or even a string literal.

**Fix.** Add to `findSinks`: `/\bsetHTMLUnsafe\s*\(/`, `/\bcreateContextualFragment\s*\(/`, `/\.\s*srcdoc\s*=(?!=)/`,
`/\bparseFromString\s*\(/` (any file except `safe-html.js`), `/\b(?:importNode|adoptNode)\s*\(/`,
`/\binsertAdjacentElement\s*\(/`. For render-kind entries require the literal call `MASafeHtml.render(` or
`MASafeHtml.toFragment(` and evaluate `uses` against `mask` (strings blanked), not `code`. Mirror the same additions in
`test/safe-html-policy.test.js`'s no-sink scan (`importNode`/`adoptNode`/`append(` of parser nodes).

---

### WR-B03 — LOW — `overview-1.js` message relay accepts `open-slide` / `deck-overlay` from any origin and any source

**Where** `public/js/pages/overview-1.js:6-14`: `window.addEventListener('message', e => { … if (d.type==='open-slide' && d.url && window.openHtmlSlide) window.openHtmlSlide(d.url, d.label||'Slide'); })` — no `e.origin`, no `e.source` check.
13-10 SUMMARY records this ("validates nothing about origin … recorded") without fixing it.

**Reachability.** (a) A cross-origin page that `window.open()`s the portal keeps a WindowProxy (no COOP header is set) and
can post to it; (b) any slide frame opened on overview.html — including the sandboxed opaque-origin uploaded slides — can
`parent.postMessage(...)`. `openHtmlSlide` accepts any http(s) URL (`transitions.js:1198-1206`): the iframe itself is then
blocked by `frame-src 'self'`, but the overlay's **"Open in new tab ↗" anchor points at the attacker URL**
(`transitions.js:1218`), the label is attacker text, and `deck-overlay` toggles `body.deck-fullscreen` (whole-window
redress).

**Fix.**
```js
var df = document.getElementById('deckframe');
if (e.origin !== location.origin || !df || e.source !== df.contentWindow) return;
if (d.type === 'open-slide' && !/^\/overview-deck\/[\w.-]+\.html$/.test(String(d.url))) return;
```
(Setting `Cross-Origin-Opener-Policy: same-origin` on HTML responses closes vector (a) generally — server side.)

---

### WR-B04 — LOW — Stored URL fields rendered as `href`/`src` are escaped but not scheme-checked (admin-authored; `javascript:` live under the still-enforced legacy policy)

| sink | source field | validator |
|---|---|---|
| `public/js/admin.js:660` `href="${escapeHtml(m.playbookLink)}"` | modules (see CR-B01 — pmo-writable) | none |
| `public/js/employee.js:2237` `href="${cmsEsc(l.playbookLink)}"` | lesson `playbookLink` | `validators/cms.js:64` max(2000) |
| `public/js/transitions.js:2793` `link.href = it.href` (custom sidebar menu items) | menus | `validators/cms.js:124/141` max(500) |
| `public/js/employee.js:1872` `<video src="${url}">` (raw) and `:1853` youtube iframe | `welcomeVideoUrl*` | `validators/settings.js:75-83` max(2000) |

Escaping stops attribute breakout but not a `javascript:` scheme (`client-xss-sinks (a)` documents this exact lesson for
the quick-nav). Under the legacy header enforced today a click executes; after enforce they are off-portal lures. The
code base already has three correct patterns to copy (`safeUrl` in `buildQuickNav`, `safeVdrUrl` in due-diligence.js,
`MASafeHtml.safeHref` in page-layout.js). `getYoutubeId` (`employee.js:1664-1669`) caps the id at 11 chars of `[^#&?]`,
which admits `"` — add `^[\w-]{11}$`.

**Fix.** One rule: every API-sourced value written to `href`/`src` passes `MASafeHtml.safeHref` (already loaded first on
every page); the zod `.refine` from CR-B01 on all four fields; a static gate row for `href="${…}"` / `.href = ` without a
safe wrapper.

---

### WR-B05 — LOW — Free-form `class` in both policy tables lets authored content wear the app's own full-screen chrome (UI redress CSP cannot stop)

**Where** `public/js/safe-html.js:84` / `lib/htmlPolicy.js` `GLOBAL_ATTRIBUTES: ['class', …]` — any value. Proven in
Chromium: `<div class="slide-overlay"><div class="slide-overlay-bar">Session expired</div></div>` renders unchanged;
`.slide-overlay`, `.ai-insight-modal-overlay`, `.cms-modal-overlay`, `.time-travel-overlay` are `position:fixed`
full-viewport rules in `style.css`. No script, no inline style → the strict CSP is silent. D-13-01 allows `class`, so this
is a design residual, and since Phase 11 only admins author CMS content; the impact is admin→viewer in-portal phishing
("session expired — re-enter your password" over a real page).

**Fix.** Cheapest and complete today: scope authored content in CSS —
`.cms-authored *, .pl-richtext *, .teodor-bubble *, .lesson-body * { position: static !important; }` — and/or restrict
`class` values on both sides to a prefix allowlist (`cms-`, `pl-`, `rt-`).

---

### WR-B06 — LOW — Inline-free gates have false-pass shapes of the historical kind

Re-running the tests' own regexes on probes:

| gate | probe | result |
|---|---|---|
| `csp-inline-free-pages.test.js:82` `\son[a-z]+\s*=` | `<img/onerror="…">` (slash separator — the R1-03 trick) | MISSED |
| `:85` `/javascript\s*:/i` | `<a href="&#106;avascript:…">`, `&#x6A;…`, `java&Tab;script:` (all executed by the browser) | MISSED |
| `:69-87` | `<script src="data:text/javascript,…">` | treated as external |
| `csp-inline-free-decks.test.js:190` `HANDLER_ATTR_IN_STRING` (quote required after `=`) | `'<img src=x onerror=alert(1)>'`, `el.setAttribute('onclick', …)` | MISSED |

The tree is clean today (own scan of all 28 HTML files: 0 inline scripts, 0 handlers, 0 `javascript:`, 0 `srcdoc`), so
this is gate strength, not a live defect. **Fix:** decode `&#…;`/`&Tab;` entities before the scheme test; use
`[\s/]on[a-z]+\s*=`; drop the quote requirement; add `\.setAttribute\(\s*['"]on`; flag script `src` outside
`/js/|/vendor/`.

---

### IN-B01 — INFO — The 13-09 "not enumerated" inventory should be tagged by writer role
"Each remaining sink is a template-literal … build of app-sourced data" is not accurate for at least four stored URL
fields (CR-B01, WR-B04). Re-tag the 241 sinks by the lowest role that can write the source collection
(`ROLE_WRITE_POLICY` / `DEFAULT_WRITE_ROLES`) so the "bounded by CSP" acceptance is judged per sink.

### IN-B02 — INFO — Back/forward cache after logout: covered on secure contexts only
Experiment (Chromium with bfcache re-enabled): after the app's own logout, Back re-fetched `/dashboard.html` and the auth
probe bounced to login — `Clear-Site-Data: "cache"` is honoured on loopback (secure context). On a plain-HTTP LAN host the
header is ignored (the server comment at `server.js:1355` says so) and nothing client-side guards a restore: no
`pageshow` listener exists in `public/js`, HTML is `Cache-Control: no-cache` (bfcache-eligible). Belt-and-braces:
`window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });` in transitions.js.

### IN-B03 — INFO — Whole-tree inline-free gate is pending 13-13
At 766195a only 7 pages + 6 decks are gated; the other 15 HTML files (login, change-password, pmo, execution, org, …,
`slides/welcome-slide.html`) are clean (own scan) but ungated until the 13-13 whole-tree gate lands.

### IN-B04 — INFO — `public/doom/js-dos.js`, `wdosbox.js`, `wdosbox.wasm` are saved HTML 404 pages
Each contains `<iframe src="https://ghbtns.com/github-btn.html…">` (`:49`) — the only third-party `src=` in `public/`
outside `vendor/`. Nothing references `/doom/` (grep of `public/js`, `public/*.html` = 0). Dead, mis-downloaded assets;
not a Phase 13 regression. Delete them (Phase 14 clean-up).

### IN-B05 — INFO — Dev mode (non-real, no `DEMO_OPEN`) inherits the demo egress defaults
Walk evidence: in dev mode `employee.html` requested `img.youtube.com/vi/…/hqdefault.jpg` (admin and pmo). Consistent
with the PRD (real=false, demo=true) — state it in DEPLOYMENT.md so a laptop-local "dev" run is understood to egress.

---

## Checked and clean (evidence)

**MASafeHtml (`public/js/safe-html.js`), real Chromium, policy-table check on the LIVE DOM**
- 313-vector `xss-corpus.json`: 0 violations, 0 throws, 0 `alert`, 0 dialogs, 0 page errors.
- 76 novel vectors, all inert: `javascript&colon;`, `&#x6A;avascript:`, `java&Tab;script:`, NBSP/ZWSP/soft-hyphen
  prefixes (ZWSP/SHY values are kept — the browser also treats them as relative paths; resolved protocol `https:`),
  `vbscript:`, `data:text/html`, `//`, `/\`, `///`, `https:evil` (allowed scheme), `target=_top`/`rel=opener` (dropped,
  rel forced), `srcset`, `data:image/svg+xml` (dropped), `data:image/png` incl. upper-case and whitespace (kept), CSS
  `url()`/`background-image`/`expression()`/`var()`/`position:fixed`/`content:url()`/escapes/`!important`/5-value
  margin/`1e3px`/duplicate `style` (only allowlisted longhands survive; shorthand leak fixed as 13-06 says),
  `id`/`name` clobbering (dropped; `window.location`, `document.cookie`, `document.body` intact), SVG/MathML
  `xlink:href`, `foreignObject`, the classic mXSS set (`noscript`, `svg><style`, `form><math><mtext`, `table><a`,
  `select><noembed`, `xmp`, `template`, `plaintext`), `srcdoc`, `object`, `base`, `meta refresh`, `link`,
  `<scr<script>ipt>`, `<img src="x"onerror=…>`, duplicate `href`, nested `<a>`, `ping`, `is=`, `label/for`+`autofocus`,
  `details ontoggle`, `video/audio onerror`, `marquee onstart`, `body onload`, `html onmouseover`, `frameset`, 5000-deep
  nesting (124 ms), 2 MB text.
- `checkUrl` is sound by construction: it falls back to the browser's own `new URL()` verdict whenever the compact-scheme
  regex does not match, so there is no input the browser reads as `javascript:` that the renderer reads otherwise.
- External `<img src>` is accepted by policy (as the PRD specifies) — the request fires at `createElement` time; in the
  app it is stopped by `img-src 'self' data: blob:` in BOTH the legacy and strict policies (real-mode header carries no
  third-party origin). Recorded, not a finding.
- Golden demo corpus (`cms-golden.json`, 44 non-empty values): 0 structural divergences client-vs-server and
  client-vs-raw (ignoring the forced `rel`). The 24 playbook checkbox strings are orphaned — zero references to
  `culture_milestone_*`/`talent_checklist_*` in `public/`, `lib/`, `server.js` — so nothing visible is dropped; 13-06's
  decision stands and xss-chain (b3) pins the count.
- Parity test, deep-freeze, no-DOM load, no-sink source scan, 18-page ordering gate: all present and correct.

**Enumerated render paths** — `page-layout.js` (richtext + legacy body via `render`, CTA via `safeHref`, fails closed),
`page-cms.js` (`toFragment`, fails closed), `inline-edit.js` (edit bar DOM-built; cancel restores original nodes; commit
view via `toFragment`), `transitions.js` `addMessageBubble` (escape → markdown → `render`; `[x](javascript:…)` loses its
href), `applyPortalI18n` (`[data-i18n]` bold pass and `[data-i18n-html]` via `setMarkup`, regex stripper gone),
`fetchSmolInsight` (`render` into a created span; marker state via textContent; no retry), `openLessonModal`
(DOM-built, body via `render`), `openHtmlSlide` (createElement/textContent; `sandbox="allow-scripts"` set BEFORE `src`;
http(s) only; `rel="noopener noreferrer"`), `addSlide` (textContent, `href="#"` + `preventDefault`), `renderSlides`/
`loadSlides` (textContent), `banners.js` (textContent). Notification panel `it.href` values are server constants
(`server.js:8055-8120`).

**Not-enumerated sinks sampled by writer role** — pulses (employee): `dashboard.js:1076-1085` and `pages/dashboard-1.js`
escape name/comment; employees (employee via get-or-create): `admin.js:812-820`, `signage.js`, `leaders.js` escaped;
RAID/tasks/synergies (pmo): `execution.js:196-198, 775-786` `esc()`; communications (pmo): `admin.js:1832-1840`
escaped, `htmlEmailPath` is server-generated (`server.js:9118`); departments/process catalog (pmo):
`dashboard.js:175-182, 201-203, 340-370` escaped; DD VDR links: `safeVdrUrl`; quick-nav bookmarks: `safeUrl`. The one
raw API interpolation found by a sweep of every template-literal `innerHTML` in `public/js` is CR-B01.

**CSP compatibility (D-13-03 client half)** — all 28 HTML files inline-free (0 `<script>` without `src`, 0 `on*=`,
0 `javascript:`, 0 `srcdoc`); no `eval`/`new Function`/string timers/`document.write`/`srcdoc` in first-party JS; the only
dynamic `import()` is same-origin and gated; dynamically inserted scripts are same-origin; `worker-src 'self' blob:`
covers the ORT blob worker (the vendored bundle's `importScripts(blob:)` is the threaded path, unreachable without
cross-origin isolation — W-1 of the plan check stands as an open verification item for 13-12). **Chromium walk under
`CSP_MODE=enforce`, 28 URLs × {admin, pmo} in authenticated, demo-open and real mode: 0 CSP violations (page + frames),
0 page errors, `/api/admin/csp-violations` → `count: 0`.** Enforce header on `/dashboard.html` in real mode:
`script-src 'self' 'wasm-unsafe-eval'`, no `https:` token anywhere, no Report-Only header.

**Egress (D-13-05 client half)** — host sweep of `public/` (vendor excluded) for YouTube/ytimg/Google Fonts/Hugging
Face/Gemini/CDNs: only `employee.js` (gated by `youtubeAllowed`, missing = off) and the admin panel label; CSS uses four
local `@font-face` files, no `@import`/remote `url()`; `/vendor/transformers/transformers.min.js` import sits behind
`huggingFaceAllowed()` (`transitions.js:3281, 3358, 3399, 3456-3468`); RAG upload card hidden unless `/api/auth/mode` is
dev|demo; marker state rendered once. **Real-mode walk: 0 non-self requests on every page.**

**Caching / logout (D-13-06 client half)** — `client-storage.js`: language key snapshot before the POST, every other
localStorage key removed, sessionStorage cleared, all Cache Storage names deleted, workers unregistered, restore even on
failure; `runLegacyCleanupOnce` filters `transformers-cache` out and runs once (flag); `sw.js` is a self-unregistering
stub with no `fetch` handler; no `serviceWorker.register` anywhere; `manifest.json` gone and unreferenced; the two static
sign-out paths (sidebar link `transitions.js:1447-1461`, `change-password.js:103-109`) call `clearOnLogout`; no IndexedDB
use in the app; JS-injected `?v=` references (`client-storage.js?v=1` etc.) ARE rewritten transitively by
`assetStamp.rewriteAsset` (`server.js:462-475`), so the hand stamps are not a stale-cache risk.

**Slides (D-13-04 client half)** — `sandbox="allow-scripts"` only, set before `src`; PDFs exempt by `pathname` (served
responses carry the sandbox CSP header regardless, so an unsandboxed frame of an uploaded `.html` is not reachable);
deck.html framed first-party unsandboxed with its `postMessage` bridge intact; decks use no storage/network/parent APIs.

---

## Verdict per locked decision (client half)

| Decision | Verdict | Note |
|---|---|---|
| D-13-01 (client parity with the server table) | CONFORMANT | table-for-table parity test; 0 golden divergences in Chromium |
| D-13-02 renderer + enumerated paths | CONFORMANT on every enumerated path; **GAP** in the inventory claim | CR-B01 is a stored URL sink filed as "app-sourced"; WR-B02 gate false-passes |
| D-13-03 externalisation (client) | CONFORMANT | 28/28 inline-free; 0 violations under enforce in three modes; flip itself is 13-13 (not reviewed) |
| D-13-04(b) `openHtmlSlide` sandbox | CONFORMANT | WR-B03 is the overview relay, not the sandbox |
| D-13-05 client gates + fonts | CONFORMANT | real-mode walk 0 non-self requests; IN-B05 dev-mode note |
| D-13-06(b)(c) logout clearing / wipe removal | **GAP** | WR-B01 third sign-out path; IN-B02 bfcache on plain HTTP |
| D-13-07 proof tooling | not reviewed (13-12 in flight) | the committed gates have false-pass shapes: WR-B02, WR-B06 |

**Bottom line.** Fix CR-B01 (one line client + one `.refine` server) and WR-B01 before 13-13 flips to enforce; harden the
two gates (WR-B02, WR-B06) so the next regression of these shapes cannot pass green.

---

## Method notes

- Review target pinned with `git show 766195a:<path>`; working-tree changes from 13-12/13-13 were not read.
- Chromium evidence: host-local Playwright 1.62.1 + Chromium 1234 driven from scratch scripts in the session scratchpad
  (deleted afterwards). MASafeHtml attacks ran against a routed `https://portal.test/` page with no server. The page
  walks booted the exported 766195a tree against temp `MA_*` stores (copies of the committed DBs; `NODE_TEST_CONTEXT=1`),
  seeded synthetic `admin`/`pmo`/`employee` sessions, and were torn down with the temp directory. `POST /api/settings/new-ma`
  was never called. No source file was modified.
