---
phase: 13-content-safety
plan: 12
subsystem: security / browser proof tooling
tags: [playwright, csp, report-only, xss, slide-sandbox, egress, caching, SAFE-01, SAFE-02, SAFE-03, SAFE-06, SAFE-07]
requires: ["13-01", "13-02", "13-03", "13-04", "13-05", "13-06", "13-07", "13-08", "13-09", "13-10", "13-11"]
provides:
  - "scripts/uat/phase13-xss.js: browser proof runner (lanes real / dev / demo-open / dev-defaultdir, --csp-mode, canary origin, sha256 data guard)"
  - "scripts/uat/phase13-scenarios/*.js: storedXss, clientCorpus, slideSandbox, egress, transformersImport, caching, demoWalk, ilWalk"
  - "evidence/: report-only run logs ending EXIT=0 + JPEG screenshots + README (the enforce precondition 13-13 needs)"
affects: [13-13, 13-14]
key-files:
  created:
    - scripts/uat/phase13-xss.js
    - scripts/uat/phase13-scenarios/_shared.js
    - scripts/uat/phase13-scenarios/stored-xss.js
    - scripts/uat/phase13-scenarios/client-corpus.js
    - scripts/uat/phase13-scenarios/slide-sandbox.js
    - scripts/uat/phase13-scenarios/egress.js
    - scripts/uat/phase13-scenarios/caching.js
    - scripts/uat/phase13-scenarios/csp-walks.js
    - .planning/phases/13-content-safety/evidence/ (10 logs, 30 JPEG, README.md)
  modified: []
decisions:
  - "PD-7 held: real lane author = a SECOND admin, pmo write asserted 403; demo-open author/victim = the anonymous showcase visitor"
  - "PD-24 held: no product file was edited; every result below is a measurement (none failed after the test-side fixes listed under Deviations)"
  - "Third-party requests are answered locally by the runner (empty 204) while staying visible in the request log - the proof runs never touch the network"
status: complete
actuals:
  tokens: 33000   # chars/4 over the new scripts + README (131,757 chars); logs/JPEGs excluded
  tasks: 3
  commits: 3
---

# Phase 13 Plan 12: Playwright browser proof runner + report-only CSP walks Summary

A new Playwright runner proves, in real Chromium against isolated servers, that stored XSS payloads are inert on every
enumerated render path, uploaded slides are sandboxed, real-deal egress defaults hold and switch, caching/logout behave -
and that the demo and Integration Lead walks produce ZERO CSP violations under the strict policy in report-only mode.

## Commits

| Task | Commit | Content |
| ---- | ------ | ------- |
| 1 (tracer) | `f1621b8` | runner skeleton + storedXss (dev, report-only): `tracer-stored-xss.log` EXIT=0, 81 PASS |
| 2 | `ecc0c83` | clientCorpus, slideSandbox (+ B-1 default-directory variant), egress, caching, transformersImport; storedXss gains real + demo-open; 6 logs EXIT=0 |
| 3 | `7e2d6fb` | demoWalk (dev, demo-open) + ilWalk (real): 3 logs EXIT=0 `violations=0`; evidence README |

Tracer gate (autonomous policy): re-ran the tracer `<verify>` end to end (EXIT=0, data untouched) and continued.

## Scenario x lane results (all `--csp-mode report-only`, final committed logs)

| Scenario | Lane | Checks | Result | Log |
| -------- | ---- | ------ | ------ | --- |
| storedXss | dev | 78 | PASS, violations=0, canaryHits=0 | `ro-stored-xss.log` |
| storedXss | demo-open | 76 | PASS, violations=0, canaryHits=0 | `ro-stored-xss.log` |
| storedXss | real | 78 | PASS, violations=0, canaryHits=0 (pmo POST /api/pages = 403) | `ro-stored-xss.log` |
| clientCorpus | dev | 13 | PASS - 316 vectors clean, 100 i18n-html values structurally equal, 0 canary hits | `ro-client-corpus.log` |
| slideSandbox | real | 34 | PASS (framed + top-level probes all blocked, quota/10 MB/.svg/.exe refusals) | `ro-slide-sandbox.log` |
| slideSandbox | dev | 34 | PASS | `ro-slide-sandbox.log` |
| slideSandbox | dev-defaultdir | 31 | PASS - `slideSandbox default-dir PASS`, listing identical before/after | `ro-slide-sandbox.log` |
| egress | real | 35 | PASS - 278 requests all same-origin; panel toggle -> next CSP exactly PD-9; behaviour flips and back | `ro-egress.log` |
| egress | dev | 20 | PASS - showcase unchanged (thumbnail + embed, model options enabled) | `ro-egress.log` |
| egress | demo-open | 20 | PASS | `ro-egress.log` |
| transformersImport | demo-open | 12 | PASS - `transformersImport wasm-compile PASS`; 2 eval-class reports RECORDED | `ro-transformers-import.log` |
| caching | real | 19 | PASS | `ro-caching.log` |
| caching | dev | 19 | PASS | `ro-caching.log` |
| demoWalk | dev | 54 | PASS `violations=0 endpoint=0 inpage=0` (48 checkpoints, 46 steps) | `ro-walk-dev.log` |
| demoWalk | demo-open | 53 | PASS `violations=0 endpoint=0 inpage=0` (46 checkpoints, 45 steps) | `ro-walk-demo-open.log` |
| ilWalk | real | 40 | PASS `violations=0 endpoint=0 inpage=0` (51 checkpoints, 32 steps) | `ro-walk-real.log` |

Evidence directory: 1152 KB (cap 1200), 10 logs (all end `EXIT=0`), 30 JPEGs, README.md mapping file -> acceptance item.
Committed `data/demo.db*` / `data/control.db*` sha256 and `git status --porcelain -- data public/sent_emails public/uploads`
unchanged by every run and by the full suite.

### What each scenario measured

- **storedXss** - R1-03-a..d + every 7th corpus vector (armed with `window.__xss=1,fetch(<canary>)`) stored through
  `/api/pages` (legacy body AND layout richtext + hero/cards/cta text + `javascript:` hrefs), `/api/courses` (lesson
  body), `/api/i18n` (`leaders.progress_heading`, a `[data-i18n-html]` key), `/api/banners`, `/api/slides` (label).
  Victims open `/capability-hub.html`, `/integration-excellence.html`, `/leaders.html`, `/dashboard.html` (banner, slide
  launcher + overlay, chatbot), `/employee.html` (lesson modal). Asserted: benign marker rendered, structural audit of
  each container (no handler / foreign element / javascript: / clobbering id / fetching style), no `__xss`, no dialog,
  canary silent (server + request log), both violation sources empty. 13-09 fold-ins: chat message with a `javascript:`
  link and a raw `<img onerror>` (link loses its href, https link keeps `rel="noopener noreferrer"`, `<strong>` still
  renders), i18n-html value with `onerror`, lesson body with `onerror`, inline-edit Cancel round trip on a page-body
  region (region text identical before/after, no editable body left).
- **clientCorpus** - all 313 corpus vectors + 3 fold-in shapes, host name rewritten to the live canary, appended to the
  LIVE document (a surviving `<img onerror>` would fire) and audited against `MASafeHtml.POLICY`; plus the 100 demo
  `[data-i18n-html]` values (25 keys x en/de/zh/cs) compared with a plain DOMParser parse: 0 structural differences.
- **slideSandbox** - probe slide (fetch `/api/auth/me`, `document.cookie`, `parent.document`, `localStorage`, canary
  beacon) framed through the real `openHtmlSlide()` and opened top-level: every probe `blocked:*`, origin `"null"`,
  response CSP exactly `SLIDE_SANDBOX_CSP`, `nosniff`, no Report-Only; refusals `.svg` / `.exe` / PDF-as-.html (415),
  over-quota (413, 1 MB test quota), 11 MB (413) with the fixed bodies and no file added. B-1 variant: child with
  `MA_SLIDES_UPLOAD_DIR` unset, slide in the worktree's `public/uploads/slides`, served by the dedicated mount, deleted
  in `finally`, listing identical (directory did not exist before and does not after).
- **egress** - see table; the real-lane panel flow is driven through the real admin UI (Settings tab ->
  `#egress-youtube` / `#egress-huggingface` -> Save).
- **transformersImport** - `import('/vendor/transformers/transformers.min.js')` resolves with 501 exports; the 10 MB
  `ort-wasm-simd.wasm` compiles with no violation; only same-origin requests; no first-party `numThreads`.
- **caching** - `no-store` read from the browser's `Response` at 200/401/403/404/409; seeded `transformers-cache` entry
  present after each of ten app loads; UI logout -> `caches.keys()` `[]`, sessionStorage 0, localStorage only
  `employeeLanguage` (value kept), no SW registration, `Clear-Site-Data: "cache", "storage"`, session revoked.
- **demoWalk / ilWalk** - per PD-31: every `public/*.html`; chatbot send + answer; easter-egg and Ask 1 deck slide through
  `openHtmlSlide` (non-blank sandboxed render asserted: 1254 chars of text, 45 visible elements, origin `"null"`);
  survey-scores modal; overview deck + Agenda popover; employee lesson modal + welcome video; 18 admin tabs incl.
  Settings (External services panel), Pages, Slides; IL smoke pages at 1440 and 390, 13 dashboard tabs, execution
  tasks/synergy/RAID/reports, DD, org.

## Findings for 13-13 / 13-14 (measurements, nothing fixed here - PD-24)

1. **Vendored Transformers bundle reports 2 eval-class `script-src` violations at import** (`blocked: eval`,
   `transformers.min.js` line 34 - the guarded `new Function("return this")` of W-1). Report-only: recorded. Preview
   under `--csp-mode enforce` (scratch run, not committed; 13-13 owns the committed one): the import STILL resolves
   (501 exports), `WebAssembly.compile` still clean, the eval attempts are blocked (`disposition: enforce`) and listed
   once on the endpoint. `'wasm-unsafe-eval'` suffices for the single-thread runtime. The threaded path
   (`importScripts(blob:)`) remains unverified by design (DEPLOYMENT.md rollback `CSP_MODE=report-only`, 13-14 open item).
2. **DEMO_OPEN: admin-only inline routes answer 403 to everyone, a signed-in admin included.** Open mode skips the
   session gate, so `req.portalUser` is null; `POST /api/admin/egress` and `GET /api/admin/csp-violations` (both
   `isAdminRequest`) are unreachable except with `X-Admin-Token` (needs `ADMIN_TOKEN`). The External services panel
   therefore renders in demo-open but cannot save; the violation list cannot be read there without the break-glass
   token. Showcase defaults are all-on, so no functional loss; relevant to 13-13's documentation (read the list in
   report-only on a dev/real instance, not demo-open). The runner sets a generated `ADMIN_TOKEN` on the demo-open child only.
3. **Parsing a `<base href=...>` through `MASafeHtml` (DOMParser inherits the creator's CSP) emits one `base-uri`
   report per policy** (enforce + report-only, blocked URI = the base target) although the element is dropped and
   nothing applies. Only reachable through a channel that stores raw markup (i18n dictionary values; chat text is
   escaped first). Committed demo/real content contains none, so the walks stay at zero; an operator who pastes a
   `<base>` into a translation would see a base-uri tuple. No action needed unless 13-13 wants it documented.
4. `public/js/page-layout.js` `cards.items` rendered from an i18n object (`{en: "..."}`, which `PageBlockDataSchema`
   accepts) shows `[object Object]`; the admin editor always sends a plain string. Not a safety issue; noted only.
5. `/api/auth/me` answers `200 {authEnabled:true,user:null}` (not 401) for a revoked session - the revocation check
   asserts `user === null`.

## Deviations from Plan

**1. [Host tools] The named `PLAYWRIGHT_PATH` does not exist.** `~/.npm/_npx` was emptied (03:29 today; the standing
"delete old builds and caches" directive). Used the only loadable copy on the host - `playwright-core@1.58.1` inside
another global package - with the cached Chromium headless shell 1234 passed as `executablePath`
(`PLAYWRIGHT_PATH` / `PLAYWRIGHT_CHROMIUM_EXECUTABLE`). Nothing installed, nothing under the repo touched; the runner
accepts either package name and prints the version it used. Re-running on another host needs only those two variables.
**2. [Runner design] `scripts/uat/phase13-scenarios/_shared.js` added** (helpers: corpus loader, armed payloads,
in-page DOM audit, execution state). Leading underscore keeps it out of the scenario registry.
**3. [Evidence] `*.log` is gitignored** - the committed logs were `git add -f`'d by explicit path (precedent: phases 9-12
committed their evidence logs the same way).
**4. [Evidence cap] Screenshots re-taken at JPEG quality 13-14 and the (identical) deck-slide shot kept for the dev
lane only** to fit the 1200 KB cap (first pass was 1624 KB). The I-5 non-blank assertion still runs in every lane.
**5. [Test-side fixes, no product change]** (a) at-rest sanitisation is checked structurally with
`test/helpers/html-inert.js` instead of a substring search (escaped payload text legitimately contains `onerror`);
(b) cards `items` is stored as the plain lines string the editor sends; (c) `Clear-Site-Data` is read with
`allHeaders()` (Playwright's `headers()` omits it); (d) revoked session = `user:null`; (e) demo-open violation list
read with a runner-only `X-Admin-Token`; (f) showcase lanes keep the showcase's own welcome video and only re-arm
`browserModel: none` on the throw-away copy.
**6. [PD-44 reading]** `transformersImport` treats eval-class reports from the vendored bundle as RECORDED (per PD-44)
and fails on any other violation, on the wasm-compile phase, or on a non-eval endpoint tuple; the must-haves line
"no securitypolicyviolation" is therefore enforced for the wasm compile and every non-eval event.

## Known Stubs

None. No stubs, skipped tests or unrun verifies; no `.planning/WINDOWS.md` entries.

## Threat Flags

None - tooling and evidence only; no new network endpoint, auth path or schema change in the product. The runner opens a
loopback canary listener for the duration of a run and sets `ADMIN_TOKEN` only on its own throw-away demo-open child.

## Threat model status

| ID | Status | Evidence |
| -- | ------ | -------- |
| T-13-110 | mitigated | sha256 guard (main + -wal) and `git status --porcelain -- data public/sent_emails` PASS at the end of every run; full suite leaves both clean |
| T-13-111 | mitigated | synthetic deals/accounts, generated passwords redacted, logs/README grep clean of OS-user paths and names |
| T-13-112 | mitigated | both violation sources asserted; failures were fixed on the test side only (Deviations 5); product files untouched |
| T-13-113 | accepted | host-local Playwright, not in package.json, not shipped |
| T-13-114 | mitigated | B-1 slide deleted by returned URL in `finally`; created `public/uploads/slides` removed; listing compared before/after (PASS) |

## Verification

- Final full suite (`node --test`, worktree root, on `7e2d6fb`): `# tests 1640  # pass 1640  # fail 0  # cancelled 0
  # skipped 0  # todo 0` (EXIT=0, 73.5 s). Unchanged from the base - this plan adds no `node --test` file.
- All `evidence/ro-*.log` and `tracer-stored-xss.log` end `EXIT=0`; the three walk logs print `violations=0`.
- `git status --porcelain data public/sent_emails public/uploads` empty after the runs and after the suite.

## Self-Check: PASSED

- Files exist: `scripts/uat/phase13-xss.js`, `scripts/uat/phase13-scenarios/{_shared,stored-xss,client-corpus,slide-sandbox,egress,caching,csp-walks}.js`, `.planning/phases/13-content-safety/evidence/README.md` and the logs listed above.
- Commits `f1621b8`, `ecc0c83`, `7e2d6fb` exist on the worktree branch.
