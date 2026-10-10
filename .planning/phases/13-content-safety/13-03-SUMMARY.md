---
phase: 13-content-safety
plan: 03
subsystem: security / content safety (slide uploads)
tags: [SAFE-03, D-13-04, csp-sandbox, upload-allowlist, express-static, mount-order]
status: complete
requires: []
provides:
  - "lib/slideUpload.js: SLIDE_SANDBOX_CSP, SLIDE_TYPES, slidesDir(), quotaBytes(), libraryBytes(), checkUpload(), sandboxedExt(), servableExt()"
  - "Dedicated /uploads/slides mount (terminal for its prefix) registered BEFORE the terminal `.html` middleware"
  - "MA_SLIDES_UPLOAD_DIR and MA_SLIDE_QUOTA_MB env knobs (for DEPLOYMENT.md in 13-13)"
affects: [13-12 slideSandbox default-directory variant, 13-13 DEPLOYMENT.md, 13-07 Report-Only header]
key-files:
  created:
    - lib/slideUpload.js
    - test/slide-upload-safety.test.js
    - test/slide-sandbox-client.test.js
  modified:
    - server.js
    - validators/cms.js
    - public/js/transitions.js
    - public/js/admin-cms.js
    - test/config-admin-only.test.js
    - test/deployment-role-matrix.test.js
decisions:
  - "PD-16/17/18/33 implemented as planned; B-1 amendment implemented and extended (see Deviations 1)"
  - "Empty/absent declared `type` is derived from the extension; a non-empty `type` must equal the extension's MIME; magic bytes still verified for binary types"
  - "Non-exact spellings of the /uploads/slides prefix (case variants, percent-encoded, dot segments, duplicate slashes) are answered 404, not passed through"
metrics:
  tasks: 3
  commits: 3
  files_changed: 9
  full_suite: "node --test: 1474 tests, 1474 pass, 0 fail"
actuals:
  tokens: 15100
  tasks: 3
  commits: 3
---

# Phase 13 Plan 03: Slide upload type allowlist, quota, sandbox CSP mount and sandboxed iframe Summary

Uploaded slides are type-allowlisted (extension + declared type + magic bytes), size- and quota-limited, served from a dedicated mount that sits before the terminal `.html` middleware (so it also holds in the default directory) with the exact D-13-04 sandbox CSP + nosniff, and framed by `openHtmlSlide()` in a `sandbox="allow-scripts"` iframe built with createElement/textContent.

## Tasks and commits

| Task | Name | Commit | Key files |
| ---- | ---- | ------ | --------- |
| 1 (tracer) | Sandboxed serving + framing: mount before terminal `.html` middleware, openHtmlSlide rebuild | `3bc7f83` | lib/slideUpload.js, server.js, public/js/transitions.js, test/slide-upload-safety.test.js, test/slide-sandbox-client.test.js |
| 2 | Allowlist, 10 MB limit, library quota, fixed side-effect-free refusals | `329dc3e` | validators/cms.js, test/slide-upload-safety.test.js, test/config-admin-only.test.js, test/deployment-role-matrix.test.js |
| 3 | Admin upload client: accept list, base64, fixed refusal text | `4c9dd39` | public/js/admin-cms.js, test/slide-sandbox-client.test.js |

Tracer gate (autonomous policy): re-ran the tracer `<verify>` end to end, green, then continued.

## What changed

- **server.js**: `slideUpload` require + `SLIDE_URL_PREFIX_RE` + prefix guard + extension guard + `express.static(slidesDir(), { dotfiles: 'deny', index: false, redirect: false, setHeaders })` + trailing `slideNotFound`, all immediately after `htmlRequestVerdict()` and before the terminal `.html` middleware, which now `return next()` for `/uploads/slides` first. The upload handler calls `checkUpload()` BEFORE any mkdir/write and writes with `wx`.
- **setHeaders**: nosniff, `Cache-Control: private, no-cache`, `removeHeader('Content-Security-Policy-Report-Only')`, and the sandbox CSP for html/htm/png/jpg/jpeg/webp; a PDF keeps the app CSP + nosniff (PD-17).
- **validators/cms.js**: `SlideUploadSchema` gains optional `type` and `encoding` (`utf8|base64`) — zod would otherwise strip them.
- **transitions.js `openHtmlSlide`**: no innerHTML; title via textContent; new-tab link `rel="noopener noreferrer"`; iframe `sandbox="allow-scripts"` set before `src` unless the path ends `.pdf`; the delegated `[data-html-slide]` handler already called `preventDefault()`.
- **admin-cms.js**: accept list `.html,.htm,.pdf,.png,.jpg,.jpeg,.webp`; HTML as text, others FileReader base64 + type + encoding; refusals show the server's fixed `error` via the textContent toast (fallback "Upload refused."); the slide list rows now use textContent (was `esc()` interpolation — safe, but PD-33 asks for textContent).

## Verification

- `node --test test/slide-upload-safety.test.js test/slide-sandbox-client.test.js test/config-admin-only.test.js test/deployment-role-matrix.test.js`: all pass; `public/uploads/slides` file count 0 before and after.
- Full suite: `node --test` → tests 1474, pass 1474, fail 0.
- **B-1 negative control proven**: with the mount block moved after the terminal middleware (and the pass-through removed) the default-directory subtest (d) and the structural subtest (c) FAIL; restored, they pass. A temp directory outside `public/` cannot detect this regression, which is why the default-directory child case exists.
- **Real-browser smoke** (Playwright/Chromium, one-off, not committed; isolated server, temp MA_* + temp slides dir, DEMO_OPEN):
  - Built-in decks `/overview-deck/slide5.html`, `slide6.html`, `easter-egg.html`, `working-in-a-matrix.html#scene-1`, `agenda.html` opened through `openHtmlSlide`: frame has `sandbox="allow-scripts"`, no page errors, `te-logo.png` loads, `fit()` ran (slides scaled), easter-egg Start click works, label `<img src=x onerror=…>` rendered as text. Inside the frame `self.origin` is `"null"` and `localStorage` is blocked — none of the decks use storage/network/parent (also asserted statically in `slide-sandbox-client (d)`).
  - Attack slide uploaded then (a) framed via `openHtmlSlide` and (b) opened top-level: `document.cookie`, `localStorage`, `parent.document`, `top.location` all throw `SecurityError` (framed); `fetch('/api/auth/me', {credentials:'include'})` is blocked in both; top-level origin is `"null"` (`parent.document` at top level is the slide's own document, expected).
- Overview deck bridge: `overview.html` frames `/overview-deck/deck.html` itself (unsandboxed first-party markup); `deck.html`'s `parent.postMessage` bridge is unchanged; the Agenda `open-slide` message goes through `openHtmlSlide` (asserted).

## Deviations from Plan

### Auto-fixed / amended

**1. [Rule 1 - Bug, plan premise false] Case-sensitive routing defeats the planned case-insensitive pass-through**
- **Found during:** Task 1 (default-directory test)
- **Issue:** the plan says "Express matches the mount path case-insensitively" and adds a case-insensitive `return next()` in the terminal middleware. server.js sets `case sensitive routing`, so `/UPLOADS/Slides/x.html` did NOT hit the slide mount; the pass-through then handed it to the public `express.static`, which (macOS, case-insensitive FS) served the file with the APP CSP, unsandboxed.
- **Fix:** a guard before the mount answers 404 for every non-exact spelling of the prefix (case variants, percent-encoded, dot segments, duplicate slashes); only the exact `/uploads/slides` spelling reaches the mount. The terminal-middleware pass-through remains as defence in depth.
- **Files:** server.js; test (b) asserts case variants are sandboxed-or-404 and encoded/double-slash/dot-segment spellings are 404.
- **Commit:** `3bc7f83`

**2. [Scope note] Task 1 commit contains the full `checkUpload()` in lib/slideUpload.js**
- The plan has Task 1 "HTML path only" and Task 2 add the allowlist. The lib is one cohesive module and the handler is wired to `checkUpload()` in Task 1, so the allowlist logic landed with the tracer; Task 2 added the schema fields, the refusal/limit/quota/binary tests and the existing-suite updates. No behaviour is missing from either task.

**3. [Rule 2 - design call] Empty declared `type` is accepted**
- Some OSes report `''` for `.webp`; refusing would block legitimate uploads. A non-empty `type` must match the extension's MIME, and binary types must still carry their magic bytes, so the security-relevant check is unchanged. Tested ('nodeclared.png').

**4. [Rule 2] Slide library rows use textContent (admin-cms.js)**
- Found: the list interpolated `s.icon/s.label/s.url/s.pages` through `esc()` into `innerHTML` (safe, escape-correct). Converted to textContent per PD-33 / T-13-24 and guarded by `slide-sandbox-client (g)`.

**5. Existing suites (recorded, no assertion changed)**
- `test/config-admin-only.test.js` and `test/deployment-role-matrix.test.js` already sent `x.html`; only `MA_SLIDES_UPLOAD_DIR` (a temp dir) was added to their MA_* block.

### Process incident (disclosed)
- While syntax-checking I ran `node -e "require('./server.js')"` once WITHOUT the MA_* temp paths, which booted against this worktree's committed `data/*.db` (the isolation guard only applies under `node --test`). Result: `data/control.db` and `data/demo.db` mtimes and `git status` unchanged; it only created the gitignored `data/runtime.db` and `data/audit.db`, which I deleted. `git status --porcelain data/ public/sent_emails/` empty at every commit.

## Deferred / Known gaps

- Legacy `.html` slides that relied on external images/fonts/scripts (`img-src data: blob:` only) will render without them under the sandbox CSP — this is the D-13-04 decision, not a regression; admins re-upload with inline assets.
- Concurrent cross-process quota overshoot of at most one file is accepted (PD-16).
- The media library (`POST /api/media` → `public/uploads/*`) is outside this plan (Phase 14 file store).
- Two playwright installs under `~/.npm/_npx` (e.g. `9833c18b2d85bc59`) are corrupt/truncated on this host (disk pressure); `db89d7302a373f10` works — useful for 13-12.

## Threat Flags

None beyond the plan's register. The only new surface is the `/uploads/slides` mount, which is the mitigation for T-13-20/21/22/23/24/26. T-13-25 (PDF framed unsandboxed) is accepted as planned.

## Known Stubs

None.

## Self-Check: PASSED

- Files exist: lib/slideUpload.js, test/slide-upload-safety.test.js, test/slide-sandbox-client.test.js, this SUMMARY.
- Commits exist: `3bc7f83`, `329dc3e`, `4c9dd39`.
- Full suite 1474/1474; working tree clean; `public/uploads/slides` unchanged by the runs.
