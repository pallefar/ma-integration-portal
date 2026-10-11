---
phase: 13-content-safety
part: S (server side — fixes for 13-REVIEW.md Part A)
fixed_at: 2026-10-11
review_path: .planning/phases/13-content-safety/13-REVIEW.md
base: 2b5a7e49014266b3f38334e355d23b0ee78cd8a4
iteration: 1
findings_in_scope: 12
fixed: 11
accepted: 1   # WR-A07 residual accepted per orchestrator decision 8; its cheap hardening IS implemented
skipped: 0
status: all_fixed
---

# Phase 13: Code Review Fix Report, Part S (server side)

**Fixed at:** 2026-10-11
**Source review:** `.planning/phases/13-content-safety/13-REVIEW.md` (Part A: CR-A01, WR-A01..A07, IN-A01..A04)
**Base:** `2b5a7e4`. All work was done in the isolated executor worktree. Every gate ran in that worktree, not in the main checkout.
**Rules followed:** EXECUTOR-BRIEF.md. Each fix was committed atomically with explicit paths only. `git status --porcelain data/ public/sent_emails/` was empty at every commit. No server was run against a committed `data/*.db`. `npm` was never run. `lib/csp.js`, `DEPLOYMENT.md`, `public/**` and `scripts/uat/**` were not touched.

**Summary:** 12 findings in scope. 11 are FIXED. WR-A07 is ACCEPTED as a residual, with its hardening shipped. Nothing was skipped.

## Per finding

| ID | Verdict | Commit(s) | Tests (file › name) |
|---|---|---|---|
| CR-A01 [HIGH] | FIXED | `77b8ab1`, follow-up `de2a03e` | `slide-upload-safety` › (c) structural (first middleware + mount allowlist), (d) DEFAULT directory, (i) Win32-simulated spellings vs both layers, (j) HTTP 404s, (k) LIVE Windows (skipped off-win32), (l) default dir follows instance data dir, (m) legacy move; `csp-policy` › PD-37 (temp `MA_SLIDES_UPLOAD_DIR`) |
| WR-A01 [MEDIUM] | FIXED | `c37a6db` | `csp-report` › "WR-A01: a 5 MB application/json or form body … 415 after <= 64 KB", "WR-A01: a 5 MB report-typed body is 413 … (spy)", "WR-A01: the limiter is the first reader — 100 rapid requests …"; `caching-safe07` › structural no-store/parser order + provocation-route splice |
| WR-A02 | FIXED | `88ad4b3` | `slide-upload-safety` › (n) injected partial write / rename failure, (o) boot sweep |
| WR-A03 | FIXED | `42497a9` | `slide-upload-safety` › (p) delete frees file + quota; shared URL kept until last record |
| WR-A04 | FIXED | `eb735db` | `caching-safe07` › "SAFE-07 (b) / WR-A04: a sessionless logout POST … carries NO Clear-Site-Data" (+ existing SAFE-07 (b) real-logout row) |
| WR-A05 | FIXED | `a0d898b` | `resanitize-migration` › existing changed-rows test now pins `pages/#<sha8>` and "no row id verbatim" |
| WR-A06 | FIXED | `c666382` | `sanitize-html` › "WR-A06: worst-case nested input at exactly HTML_MAX …", "WR-A06: 200 000 nested <b> / <div> …", "WR-A06: normal content never reaches the cap …", "WR-A06 (c): an i18n map carries at most 20 language variants" |
| WR-A07 | ACCEPTED residual + hardening FIXED | `a855834` | `csp-report` › "WR-A07: a report about a page the app does not serve is dropped", "WR-A07: a full store evicts foreign-origin tuples before first-party ones", "WR-A07 unit: eviction order …" (+ reports+json fixture moved to real pages) |
| IN-A01 | FIXED | `e847215` | n/a (`git rm` + `.gitignore`; `sanitize-html` supply-chain rows still green) |
| IN-A02 | FIXED | `09ed007` | `egress-settings` › "dev: … admin toggle …" now asserts `{}` → 400 `{error:'No egress key supplied'}`, nothing stored, still exactly 1 audit row |
| IN-A03 | FIXED (test isolation) | `77b8ab1` | `csp-policy` › PD-37 uploads into a temp `MA_SLIDES_UPLOAD_DIR` and asserts the file landed there (the 70 stray files were already deleted by the orchestrator) |
| IN-A04 | FIXED (docs only, no code) | `92a100c` | n/a. Addendum under D-13-03 in `.planning/reviews/v3.0/PHASE-13-PRD.md` |

### CR-A01: what changed
- **(a) Structural.** `slideUpload.slidesDir()` now defaults to `path.join(dbFiles.DATA_DIR, 'slides')`. That is `<repo>/data/slides` in dev/demo and `<MA_DATA_DIR>/slides` (default `data/real/slides`) in real mode. `MA_SLIDES_UPLOAD_DIR` still overrides it. `ensureSlidesDir()` creates the directory 0700 through `dbFiles.ensurePrivateDir`. `data/slides/` is gitignored (`git check-ignore` → `.gitignore:50`); `data/real/slides` is covered by `data/real/`. Stored record URLs (`/uploads/slides/<name>`) do not change.
- **(b) Legacy move.** `slideUpload.migrateLegacySlidesAtBoot()` runs at boot, beside the mount, and only when `MA_SLIDES_UPLOAD_DIR` is unset:
  - It moves only regular files whose name passes the mount allowlist.
  - It uses `link`+`unlink`. If linking fails (EXDEV, no hard links), it falls back to `copyFile(COPYFILE_EXCL)`+`unlink`.
  - It skips name collisions and never overwrites.
  - It logs counts only and never throws. It is idempotent, and silent when the legacy directory is absent or empty.
- **(c) Mount allowlist.** `slideUpload.mountFileName(req.path)` accepts exactly one raw segment matching `^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$` (1–200 chars, no leading dot) with an allowlisted extension. Anything else gets the existing `slideNotFound` 404.
- **(d) First middleware.** The very first `app.use()` in `server.js` is a guard built on `requestPath.windowsAmbiguousPath()`. It decodes the path once; a malformed path goes to existing handling. It answers a fixed 404 when the decoded path has `\` or NUL, or a segment (other than exactly `.` or `..`) ending in `.` or a space. `/api` spellings get the JSON `{error:'Not found'}` body; everything else gets text/plain `Not found`. The full suite ran with every existing dot-segment, percent and case pin unchanged, and no rule had to be adjusted.

## Deviations (intent kept; recorded for the orchestrator)
1. **CR-A01 (d) widened by one rule.** Outside the canonical `/api` prefix the guard also refuses `:` and `~`. The reason: a legacy file that stays under `public/uploads/slides` (a skipped name collision, or an operator override pointing elsewhere) is not reached through the mount. Windows reaches it through `express.static(public)` with `/uploads::$INDEX_ALLOCATION/slides/x.htm` or `/UPLOAD~1/slides/x.htm`, and neither spelling contains `\`, NUL or a trailing dot or space. No tracked `public/` file contains `:` or `~`, and `/api` ids are exempt. Without this rule the mount allowlist alone would not have killed those two spellings.
2. **The predicate lives in `lib/requestPath.js`** as a new export, `windowsAmbiguousPath`. That file was not on my ownership list, but the decision says to reuse `requestPath` helpers, and it is the existing "one definition of path spelling" module. The change is additive; existing exports are untouched.
3. **The first middleware sits literally first**, before the security-headers middleware. Its 404 therefore sets `X-Content-Type-Options: nosniff` itself (plus `Cache-Control: no-store` for `/api`) but carries no CSP header. That is harmless: the body is a fixed text or JSON string.
4. **The legacy move uses link/EXCL-copy instead of `rename`**, because `rename` silently overwrites on POSIX. It is **opt-in under `node --test`** (`NODE_TEST_CONTEXT` set and `MA_TEST_LEGACY_SLIDE_MOVE` ≠ `1` → skipped, commit `de2a03e`). Dozens of suites boot the app in parallel, and an incidental boot must not move the checkout's files under another suite. Only `slide-upload-safety (d)` opts in. Production boots are unaffected.
5. **WR-A01:**
   - The limiter `app.use` sits after the `/api` no-store middleware and before the parsers, so a 429 still carries `no-store`. It acts only on POST at the canonical path (`pathForms().canonical === '/api/csp-report'`, which includes the trailing-slash spelling the router dispatches).
   - The structural pins in `caching-safe07` that assumed "the layer immediately before express.json is no-store" were updated: only the CSP limiter may sit between the two.
   - body-parser 1.x **dumps** a refused body (reads and discards it, never buffers it) before answering 413. The 413 is therefore not an early answer. The proof is a spy showing no app-wide parser consumed a csp-report body; the 415 paths are proven as early answers after ≤ 64 KB sent.
6. **WR-A02.** The temp file is created with `openSync(tmp,'wx')` and written through the fd, then renamed. This is equivalent to `writeFileSync(..,{flag:'wx'})` but tells us whether *we* created the temp, so a failure never deletes someone else's. The final name is checked for existence before the rename, which keeps the old `wx` no-overwrite guarantee. The boot sweep removes only `*.tmp` files older than 1 h, because a younger one can belong to a concurrent upload on a shared host.
7. **WR-A03.** "No other slide record references the URL" is checked inside the **current deal database**. Slide records are deal-scoped (cms bundle), but the slide directory is instance-wide. If the same uploaded URL is pasted into a slide record of another deal, deleting it here removes the file there too. Checking would mean opening every deal database on a delete, crossing clean-room lines, so it is left as an open item.
8. **WR-A05.** `db/migrations/deal/002-resanitize-html.js` carries the PD-35 "body is frozen once released" rule. Phase 13 is unreleased, and the change is to the log line only: the data effect is byte-identical, and the user_version stamp and idempotency are unchanged.
9. **WR-A06:**
   - The cap counts only tags that can build depth in htmlparser2. Void elements and implicitly closed siblings (`p li dt dd tr td th option optgroup rb rt rtc rp thead tbody tfoot`) are excluded, so long legacy bodies with unclosed `<p>`/`<li>` are not affected. The scan stops just past 2000. Cap hits go to a separate counter, `sanitizeHtml.depthFallbacks`, so the corpus PD-3 `escapedFallbacks` keeps its meaning.
   - `escapeAsText` was rewritten to copy runs by slice (same output, linear). With the old per-char loop the 2.2 MB fallback took ~90 ms under load.
   - Byte-identity check: old vs new sanitizer over 1393 real values (xss corpus + cms golden + every `data/demo.db` page/course HTML leaf, opened read-only; sidecars removed afterwards) gave 0 diffs. The maximum real nesting estimate is 5.
   - Timing bounds are best-of-3 wall time: `<b>`×200 000 and `<div>`×200 000 must be < 100 ms. The review's 2.2 MB `<div>`…`</div>` open+close variant has a looser < 1000 ms bound: its 4.6 MB escaped output is a large copy, and it was 35.9 s before. All pass at host load ~170.
   - `validators/cms.js`: `i18nOrString` records are bounded to ≤ 20 keys. The suite and fixtures stayed green, so (c) was applied, not skipped.
   - The **client** renderer (`public/js/safe-html.js`) has no matching cap. That is Fixer C's territory; noted as an open item.
10. **WR-A07.**
    - The page allowlist is `/` plus every `*.html` under `public/` (excluding `vendor/` and `uploads/`), plus `<dir>/` when the directory has an `index.html`. It is computed once. The origin a report was posted to (`req.protocol` + Host) decides "foreign".
    - A source-file is first-party when it is a keyword, a bare path, or same-origin http(s). Any other origin or any non-http scheme (extensions, `data:`, `blob:`) is foreign.
    - The internal `foreign` flag never leaves the store.
11. **Test helper.** `test/helpers/egress-server.js` `startServer()` gained an `env` passthrough, needed for PD-37's temp slide directory.

## WR-A07: what is accepted
The CSP violation list (`GET /api/admin/csp-violations`) is **ADVISORY**. Reports are unauthenticated by nature, so an anonymous client can still add tuples about real pages with a same-origin-looking source-file. The cheap hardening shipped:
- reports about pages the app does not serve are dropped;
- foreign-origin tuples are evicted before first-party ones.

**The enforce-flip decision (D-13-03, plan 13-13) must therefore also rely on in-page `securitypolicyviolation` events captured by the walk scripts. Plan 13-12 asserts both; never flip on this list alone.**

## Docs owed to DEPLOYMENT.md (plan 13-13 owns the file; text to add)
- **Slide library location (CR-A01).** Uploaded slides are stored OUTSIDE the public web root. The location is `<instance data dir>/slides`: `data/slides` on a dev/demo host, and `<MA_DATA_DIR>/slides` (default `data/real/slides`) on a real-deal host. The directory is created 0700 and is never committed (`data/slides/` and `data/real/` are gitignored). `MA_SLIDES_UPLOAD_DIR` still overrides the location. Slides are only ever served through `/uploads/slides/<name>`, with the sandbox CSP (PDFs keep the app CSP + nosniff).
- **Upgrade: automatic one-time move.** On the first boot after upgrading, files in the old location `public/uploads/slides` are moved into the new directory when `MA_SLIDES_UPLOAD_DIR` is unset. Only files whose names the slide URL can serve are moved. A file whose name already exists in the new directory is left where it is, never overwritten. The boot log shows a count, `[slides] legacy slide move: N file(s) moved …`, and never file names. After the upgrade, check `public/uploads/slides`. Anything left there was skipped (a name collision or a non-slide file). Move it by hand if a slide record still points at it, then delete it. If `MA_SLIDES_UPLOAD_DIR` is set, nothing is moved automatically: move legacy files into that directory yourself.
- **Back up the slide directory** together with the data directory. It holds uploaded deck files (possibly deal material).
- **Windows hosts.** Request paths containing a backslash, NUL, a path segment ending in `.` or a space, and (outside `/api`) `:` or `~` are answered 404 by design (Windows path-alias spellings). No page or API of the portal uses them.
- **Deleting a slide** in the admin UI now also deletes its uploaded file, once no other slide record of the same deal references it. That frees library quota (`MA_SLIDE_QUOTA_MB`). Upload temp files (`*.tmp`) never count toward the quota; ones older than an hour are removed at boot.
- **`/api/csp-report`.** Its body limit of 4 KB now holds for every content type (other types get 415 unread), and the per-IP limit (60/min) applies before any body is read. The violation list keeps only reports about pages the portal serves, and evicts reports from other origins (e.g. browser extensions) first. Treat it as ADVISORY: before switching `CSP_MODE` to enforce, also rely on the walk scripts' in-page `securitypolicyviolation` capture.
- **Logout.** `Clear-Site-Data` is sent only for a logout that carried a session cookie. A cross-site auto-submitted logout form no longer wipes browser storage.
- **Egress admin API.** `POST /api/admin/egress` with no egress key (`{}`) is refused 400 `No egress key supplied`. Nothing is written or audited.
- **Sanitizer.** HTML fields nested deeper than 2000 elements are stored as escaped text, not markup (fail-closed). i18n maps carry at most 20 language variants. `HTML_MAX` (20 000 chars per HTML field) is also a sanitizer-cost bound: raise it only together with `test/sanitize-html.test.js`.

## Scenario changes owed to plan 13-12's runner (Playwright default-directory slide variant)
- **The default slide directory is no longer `public/uploads/slides`.** With `MA_SLIDES_UPLOAD_DIR` unset, an upload lands in `<instance data dir>/slides`: `<repo>/data/slides` in dev/demo, and `<MA_DATA_DIR>/slides` in real mode (e.g. the walk's temp real data dir + `/slides`). Any fixture setup, cleanup or assertion that reads or deletes files under `public/uploads/slides` must use that path instead. Better: set `MA_SLIDES_UPLOAD_DIR` to a temp directory, as the node suites now do.
- **URLs are unchanged.** The upload response is still `/uploads/slides/<ms>_<6hex>_<sanitized-name>`, and `openHtmlSlide()` and the sandbox CSP behave as before.
- **A pre-seeded "legacy" slide** placed in `public/uploads/slides` before boot is moved into the data-dir slides directory at boot when `MA_SLIDES_UPLOAD_DIR` is unset. Its old URL keeps working. Under `node --test` this only happens with `MA_TEST_LEGACY_SLIDE_MOVE=1`; a Playwright child is not under `node --test` unless the runner itself is.
- **The mount serves only names matching** `^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$` with an allowlisted extension. A hand-placed fixture with spaces, `~`, `:`, `%`, a leading dot or a sub-path is 404.
- **Spellings now 404:** `%5C`/backslash, trailing-dot or trailing-space segments, and `:`/`~` outside `/api`. A probe expecting 200 for `/UPLOADS/Slides/...` still gets 404, as before.
- **Deleting a slide record deletes its file.** A scenario that deletes a slide and then re-opens its URL must expect 404.
- **CSP violation list.** A walk that asserts on `GET /api/admin/csp-violations` must browse real pages (`/` or an existing `public/*.html`); reports with other document paths are dropped. The walk must ALSO assert on its own browser's `securitypolicyviolation` events.

## Open items (not in this fixer's decisions — surfaced, not fixed)
1. **NEW, HIGH-shaped: `POST /api/media` stores any extension under `public/uploads/`.** It is admin-only (`/api/media` roles `['admin']`), and `validators/cms.js` `MediaUploadSchema` constrains only lengths. `server.js` `app.post('/api/media')` writes `<ms>_<safeName>` with any extension into `public/uploads/`, which is the public static root. So `x.html`/`x.htm`/`x.svg` is served same-origin, with the app CSP, unsandboxed: `.html` through `sendHtml()` (with stamping), `.svg`/`.htm` through `express.static`. Under `CSP_MODE=report-only` (the current default), inline script in such a file runs with the viewer's session. This is the same admin-A → admin-B threat as CR-A01, through a sibling route. D-13-04(c) defers the authenticated file store to Phase 14, but this hole is reachable today on every platform. Suggested fix: an extension/magic allowlist reusing `slideUpload.checkUpload` semantics, plus storage outside `public/` behind a sandboxing mount. Orchestrator decision needed (not owned here).
2. **WR-A03 cross-deal residual** (see deviation 7).
3. **WR-A06 client-side parity.** `public/js/safe-html.js` has no nesting cap (Fixer C / a later plan).
4. **CR-A01 (ii) runs only on Windows.** `slide-upload-safety (k)` is skipped on macOS/Linux. It should run on a `windows-latest` runner (the release workflow already boots there) before release; the review also asked for a Windows smoke row asserting `sandbox` in the slide CSP.
5. **Unauthenticated read of `/uploads/slides/*`** remains the recorded D-13-04(c) Phase-14 deferral.
6. **WR-A07** oracle residual (accepted, above).

## Verification
- **Where it ran:** all gates ran in the isolated worktree `agent-a4c21e55e0e760c8e` (not the main checkout). The host was shared and heavily loaded (load average 36–173, disk 93 %).
- **Per-fix:** each finding's targeted suites ran green before its commit. The touched surfaces covered were: slide-upload-safety, csp-policy, config-admin-only, deployment-role-matrix, asset-cache-bust, path-canonical-gate, credential-lockdown, lockdown-asset-allowlist, auth-route-inventory, csp-report, caching-safe07, resanitize-migration, healthz-readiness, schema-migrations, sanitize-html, write-validation, xss-sanitization, xss-chain, safe-html-policy, egress-settings, egress-real-mode.
- **Full suite** (`node --test` from the worktree root at `de2a03e`, the final code state, backgrounded into a log ending `EXIT=<code>`): `# tests 1659 / # pass 1658 / # fail 0 / # cancelled 0 / # skipped 1 / # todo 0`, `EXIT=0`. The skip is the Windows-only live test `slide-upload-safety (k)`. The base was 1640 tests. An earlier full run before the follow-up gave the same numbers.
- **After the suite:** `git status --porcelain data/ public/sent_emails/` is empty. No file is left in `data/slides` or `public/uploads/slides`. The only ignored leftovers are `data/control.db-{wal,shm}` from the pre-existing sanctioned committed-control.db suites, empty and gitignored.

---

_Fixed: 2026-10-11_
_Fixer: Claude (gsd-code-fixer, FIXER S)_
_Iteration: 1_
