---
phase: 12-data-layer-integrity-performance
plan: 03
subsystem: static-serving / client cache-busting
tags: [cache-bust, content-hash, express, QUAL-01, R5-03, D-12-07]
requires: []
provides:
  - "lib/assetStamp.js createAssetStamper({ publicDir }) -> { stampFor, rewriteAsset, rewriteHtml, fileFor, stats }"
  - "server.js sendHtml() + pre-static HTML middleware + stamped-asset middleware; app.assetStamper"
  - "test/asset-cache-bust.test.js: live content-hash invariant with negative control"
affects: [server.js static/HTML serving region, every public/*.html response, /js and /css responses that reference stamped assets]
tech-stack:
  added: []
  patterns: ["serve-time content hash (sha256 first 16 hex) cached per file by mtimeMs:size", "transitive hash through JS references with a back-edge raw-hash cycle guard"]
key-files:
  created: [lib/assetStamp.js, test/asset-stamp-unit.test.js]
  modified: [server.js, test/asset-cache-bust.test.js]
decisions:
  - "PD-17 honoured: stamp = first 16 hex of sha256 over the exact bytes served at that URL, transitive; hand stamps stay in the source files (overwritten at serve time, no mass edit)"
  - "Negative control is built by swapping methods on app.assetStamper (no production kill-switch flag)"
metrics:
  duration: "~35 min"
  completed: 2026-10-10
status: complete
actuals:
  tokens: 13000
  tasks: 2
  commits: 2
---

# Phase 12 Plan 03: Content-hash cache-bust stamps (QUAL-01) Summary

Every HTML response now carries `?v=<sha256 first 16 hex>` on each local `/js` and `/css` reference, computed at serve time from the bytes the app actually serves at that URL (transitive through JS that references other stamped assets), with no hand-edited stamps and no build step.

## What was built

- **lib/assetStamp.js** (new). `createAssetStamper({ publicDir, warn })`:
  - `stampFor(urlPath)`: sha256 of the served bytes, first 16 hex; for JS/CSS with `?v=`-stamped references the references are rewritten first and the REWRITTEN bytes are hashed, so editing `account-menu.js` changes `transitions.js`'s stamp.
  - `rewriteAsset(urlPath)` returns `{ body, rewritten }`; `rewriteHtml(text)` stamps (adds or replaces) `src|href` attributes and re-stamps `?v=`-stamped inline references.
  - Per-file cache keyed by `mtimeMs:size` plus the dependency stamps (T-12-23); an unchanged file is never re-read.
  - Cycle guard: a file already on the resolution stack contributes its RAW bytes' hash; results that crossed a back-edge are not cached. Missing referenced files are left untouched with one warning each.
  - Path safety (T-12-21): URLs must match a strict segment whitelist, `.`/`..` segments rejected, no decoding inside the module, resolved path re-checked against the public root before any read. Vendored code, external URLs, images and `?other=` query strings are never touched.
- **server.js** (static/HTML region only): `sendHtml(res, filePath)` (rewrites, `Content-Type: text/html; charset=utf-8`, `Cache-Control: no-cache`, Express ETag); `/` and the SPA catch-all go through it; a middleware mounted after the credential-lockdown gate and immediately before `express.static` serves every `.html` under public/ (except `/vendor/`) through `sendHtml`; a second middleware serves a `/js|/css` file from `rewriteAsset` ONLY when `rewritten === true` (same Content-Type/charset as express.static, `public, max-age=2592000`), everything else falls through to express.static unchanged. The stamper is exposed as `app.assetStamper` (not via `module.exports`); every call goes through it at request time.
- **test/asset-stamp-unit.test.js** (new, 7 tests): hash == stamp, edit changes it, cache hit (no re-read), transitive rewrite + dynamic/missing/vendor references untouched + one warning, cycle terminates, `rewriteHtml` attribute/inline/external/vendor/missing/query cases, traversal rejection, live `/execution.html`.
- **test/asset-cache-bust.test.js** (rewritten, 8 tests): see below.

## Test file rewrite and pinned stamps

`test/asset-cache-bust.test.js` no longer holds the FROZEN / NEW_ASSETS hand-stamp tables (its own header said Phase 12 replaces them). It now asserts, over the live app on an isolated MA_* block:

1. every `public/*.html` fetched by name is `no-cache` and every js/css attribute reference is stamped with a 16-hex value equal to `sha256(GET that URL body).slice(0,16)`;
2. `/` and an extension-less SPA path (catch-all index.html) satisfy the same;
3. `transitions.js` embeds `account-menu.js?v=<hash of served account-menu.js>`, `account-menu.js` embeds `account.css?v=<hash>`, `transitions.js`'s stamp in HTML equals the hash of its rewritten bytes; all `public, max-age=2592000`; an asset with no stamped references is byte-identical to the file on disk;
4. ETag round-trip answers 304 and HEAD carries no body;
5. negative control: swapping `app.assetStamper.rewriteHtml/rewriteAsset` for identity makes the same checker report violations on (nearly) every page, then restores and re-proves green;
6. credential lockdown (child process, real mode on a hand copy of control.db): `login.html` is 200, `no-cache`, rewritten with correct stamps, its assets stay reachable; `/execution.html`, `/dashboard.html`, `/admin.html`, `/`, `/js/transitions.js` and an SPA path are still 403;
7. static: every page still references `style.css` and (except login, change-password, signage) `transitions.js`; every stamped reference in sources names an existing file; no stamped-reference cycle in public/.

**Existing tests whose pinned stamps changed: none.** `test/admin-users-ui.test.js`, `test/org-summary.test.js`, `test/client-account-surfaces.test.js`, `test/client-authz-hiding.test.js`, `test/client-xss-sinks.test.js` etc. read the SOURCE files on disk, whose hand stamps this plan deliberately does not edit (PD-17), so they pass unchanged. The old per-asset "stamp strictly greater than frozen value" and "same stamp on every page" assertions were removed with the table; they are superseded by a strictly stronger invariant (stamp == hash of the served bytes, per page, with a negative control). The suite count drops 1269 -> 1234 only because the 43 per-asset table tests became 8 invariant tests (+7 new unit tests).

## Verification

- `node --test test/asset-cache-bust.test.js test/asset-stamp-unit.test.js test/lockdown-asset-allowlist.test.js`: 22/22 pass (lockdown-asset-allowlist unchanged).
- Full suite `node --test`: after Task 1 `# tests 1269 / pass 1269 / fail 0` (1262 base + 7); final `# tests 1234 / pass 1234 / fail 0`. No known flake (`audit-security-events`) was hit.
- Manual curl on a real `node server.js` (isolated MA_* temp paths, port 3917): `curl -s /execution.html | grep -o 'transitions.js?v=[0-9a-f]*'` -> `transitions.js?v=1ce505e4368c8b80`; `curl -s /js/transitions.js | shasum -a 256 | cut -c1-16` -> `1ce505e4368c8b80` (equal). Headers: HTML `Cache-Control: no-cache`, `Content-Type: text/html; charset=utf-8`; rewritten JS and plain JS both `public, max-age=2592000` / `application/javascript; charset=UTF-8`.
- `git status --porcelain data/ public/sent_emails/` empty at both commits; no STATE.md / ROADMAP.md changes.

## Deviations from Plan

### Auto-fixed / noted

**1. [Scope note] Task 2's server wiring landed in the Task 1 commit.**
- While building the tracer I wired the whole serving region once (HTML middleware, `/` and SPA catch-all through `sendHtml`, stamped-asset middleware for `/js|/css`) rather than writing the file twice. Task 1's commit (`869616c`) therefore contains all of the server.js change and is proven by the unit + live `/execution.html` test and the full suite; Task 2's commit (`f533622`) contains the test rewrite that proves the rest. Behaviour per task boundary is unchanged.

**2. [Rule 1 - Bug in my test] 304 check cannot use `fetch`.**
- Found during Task 2: undici's `fetch` adds `Cache-Control: no-cache` to a request carrying `If-None-Match`, which (correctly) defeats Express's freshness check, so the first draft of the ETag assertion saw 200. The check uses `node:http`. No production change.

**3. [Design choice] Negative control without a production flag.**
- The plan allowed "an app-level test hook"; I first added a disable flag, then removed it in favour of the test replacing `app.assetStamper.rewriteHtml/rewriteAsset` (server calls them at request time), so no kill-switch exists in production code.

**4. [Minor hardening] HTML middleware decodes the request path before the `.html` check** (and skips dot-segments, backslashes, NUL and `/vendor/`), so a `%`-encoded spelling of a page cannot be served from express.static with unrewritten bytes while the plain spelling is stamped. Dot-segment and traversal paths fall through to express.static's own policy.

## Known Stubs

None.

## Threat Flags

None. The new surface is the serving-layer rewrite already covered by T-12-20..T-12-23: mitigations are in place and test-proven (hash invariant + negative control; strict path resolution + traversal unit case; middleware mounted after the lockdown gate + lockdown child-process case; mtime/size cache + "not re-read" case).

## Notes for the orchestrator / later plans

- No later plan has to remember stamps any more; the hand `?v=` values in the source files are now cosmetic (overwritten at serve time) and can be left alone or cleaned in a later sweep.
- A zero-install bundle build (git archive + portable Node) is unaffected: the stamper is plain `fs`/`crypto`.
- Plans 12-04 (pack/rag routes in server.js) and the other Wave-1 executors do not touch the regions edited here; the only shared symbol names added are `sendHtml`, `ASSET_STAMP_PUBLIC_DIR`, `publicFileForRequest` and `app.assetStamper`, all declared next to the `/` handler.

## Self-Check: PASSED

- lib/assetStamp.js, test/asset-stamp-unit.test.js, test/asset-cache-bust.test.js, server.js: present and committed.
- Commits `869616c` (Task 1) and `f533622` (Task 2) exist on branch `worktree-agent-acc0423dd3701edb0`.
