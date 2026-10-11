---
phase: 13-content-safety
plan: quick-media
subsystem: media-library / upload safety
tags: [security, upload, media, content-safety, CR-A01-class]
requires: [13-03 slide upload checker (lib/slideUpload.js), 13-REVIEW-FIX-S open item 1]
provides: [checkMediaUpload write-side allowlist for POST /api/media, contained DELETE /api/media/:id]
affects: [lib/slideUpload.js, server.js (/api/media POST+DELETE only), test/media-upload-safety.test.js, test/busy-503-contract.test.js]
base: d9035b35dc368986126b33e821b7ab9b6f9406ed
commit: 8208d2770fd3d120cbbf086a04f61e73147554b4
status: complete
actuals:
  tasks: 3
  commits: 1
---

# Phase 13 Quick: close the unsandboxed-upload hole in `POST /api/media`

**One-liner:** `POST /api/media` now stores only PNG/JPEG/WebP/PDF (final extension AND declared type AND magic bytes, <= 10 MiB decoded, judged before any decode) with Phase 14's fixed 415 `media-type-refused` / 413 `media-too-large` bodies, and `DELETE /api/media/:id` only ever unlinks a regular file directly inside `public/uploads/`.

## Why
Fixer S's report (open item 1) found the admin-only media route wrote ANY extension into `public/uploads/`, the public static root served same-origin with the app CSP. An uploaded `.html`/`.htm`/`.svg` (or an `.html` loading an uploaded same-origin `.js`, which satisfies `script-src 'self'` even under the strict CSP) executed with the viewer's session: the CR-A01 class, on every platform, hollowing D-13-03's "second layer" premise for admin uploads.

## What changed

### `lib/slideUpload.js`
- **`checkMediaUpload({ fileName, fileData, declaredType })`** (exported). Pure: no disk access. Rules, in order:
  1. The FINAL extension of the sanitized stored name (`replace(/[^a-zA-Z0-9._-]/g,'_')`, exactly what the route writes), lower-cased, must be in `{png, jpg, jpeg, webp, pdf}`. `x.html`, `x.png.html`, `x.png.`, `x.png ` (becomes `x.png_`), `.png` and no-extension names are refused.
  2. Declared type: the data-URL header MIME, and the `kind` field (`declaredType`) if given, must each equal the extension's MIME; at least one must be present. A non-base64 data URL or a malformed header is refused.
  3. Base64 validity and decoded size <= 10 MiB, judged arithmetically BEFORE `Buffer.from` (a test spies `Buffer.from` and proves zero base64 decodes for an oversize payload).
  4. Magic bytes of the extension's type (so `x.html.png` holding HTML is refused).
- **Shared, not copied:** `MEDIA_TYPES` is a projection of `SLIDE_TYPES` (same objects: MIME + magic function), and the base64 validation/size arithmetic was extracted into one `decodeBase64Capped()` that `checkUpload` (slides) now also calls. Slide semantics are unchanged: the existing slide suites pass untouched.
- **`MEDIA_REFUSALS`**: `415 { error: 'This file type is not allowed.', code: 'media-type-refused' }`, `413 { error: 'This file is too large.', code: 'media-too-large' }`. Fixed bodies, never echoing caller input. Phase 14 (D-14-04) specifies the same codes, so they will not churn.
- **`resolveMediaFile(url, uploadsRoot)`**: the stored `url` is data, never a path. Returns the absolute file only for exactly `/uploads/<one segment>` matching `^[A-Za-z0-9_][A-Za-z0-9._-]*$` (<= 255) whose parent is exactly the uploads root; otherwise `null` (slides subtree, `..`, separators, `%`, `:`, `~`, spaces, leading dot).

### `server.js` (only the `/api/media` POST and DELETE handlers)
- **POST:** `checkMediaUpload` runs before any fs call; a refusal returns the fixed body and creates nothing (not even `public/uploads`). On success the shape, the `safeName` + `${Date.now()}_` naming, the single `writeDb`, the busy-503 re-throw (`isBusyError`) and the generic 500 are unchanged. The stored `kind` is now the canonical extension MIME (equal to the old `kind` / header value in every case that passes the check, except letter-case variants which are normalised).
- **DELETE:** the path comes from `resolveMediaFile`; the file is unlinked only if `lstat` says regular file (a symlink is never followed or unlinked). Anything else just drops the record. Response is unchanged.

### Tests
- **`test/media-upload-safety.test.js`** (new, 12 tests, isolated `MA_*` temp paths):
  - unit: allowlist shape + shared table, every allowed type, 10 MiB boundary + decode-spy, final-extension matrix, `resolveMediaFile` containment;
  - route: 27-row refusal matrix (`.html .htm .svg .js .exe .txt`, no extension, `x.png.html`, `x.html.png`, `.PNG.php`, trailing dot, header/`kind` mismatches, no declared type, non-base64, bad magic for png/jpg/webp/pdf) all fixed 415, plus oversize 413; the run's own listing under `public/uploads` and `GET /api/media` are unchanged after the refusals; a refused-extension + oversize payload is the type refusal;
  - PNG, JPG, JPEG, WebP and PDF succeed, are served 200 with the right `Content-Type` and `nosniff`, bytes round-trip, the success body has the unchanged key set;
  - admin-only (pmo/hrbp/employee 403, anonymous 401/403, nothing written);
  - structural: the verdict precedes `existsSync`/`mkdirSync`/`writeFileSync`, the busy re-throw and `${Date.now()}_` naming are kept;
  - delete: removes file + record; traversal url, slides-subtree url, `/uploads/../x` and a symlink record are dropped without unlinking outside `public/uploads` or a non-regular file.
- **Teeth check:** run against the pre-change `server.js`, (a), (e) and (g) fail (and the old route wrote `x.html`); they pass with the change.

## Deviations from the brief

1. **`test/busy-503.test.js` is `test/busy-503-contract.test.js`** in this tree. Its media probe (`busy-503-contract-probe.txt`, `data:text/plain`) became `busy-503-contract-probe.png` with a minimal valid 1x1 PNG data URL. Its existing `finally` cleanup already removes every file whose name contains `busy-503-contract-probe`, so it removes whatever the probe creates; no cleanup change was needed.
2. **No other existing test needed an amendment.** `config-admin-only` posts `{ filename, data }` (fails the schema's required `fileName`, a 400 that is neither 401 nor 403, which is what its admin rows assert) and `scripts/uat/phase10-scenarios/authz-phase11.js` posts `{}` as a non-admin (403 before the handler). The `fileData` uploads in `rag-upload`, `cpu-isolation`, `egress-*` all target `/api/rag/upload`.
3. **A data URL with no declared type at all is refused** (bare base64 with no `kind`). The brief's rule ("declared type from the data-URL header, else `kind`, must equal that extension's MIME") was read strictly; the slide checker's "empty means derive from extension" tolerance is NOT applied to media. The admin UI has no media upload form (`public/js/admin.js` only lists media), so nothing in the shipped client is affected.
4. **Unused-in-practice stored `kind` normalisation** (see POST above): `kind` is stored as the canonical MIME rather than echoing the raw field.
5. **`decodeBase64Capped()` refactor inside `checkUpload`.** Required by "SHARE the existing helpers"; behaviour is byte-identical for slides (same order: charset check, then arithmetic size, then decode), proven by the unchanged slide suites.

## Out of scope, left as is (surfaced)
- **Files already in `public/uploads/`** (any extension, uploaded before this change) are still served same-origin by `express.static` / the `.html` terminal middleware. The write side is closed; the read side for legacy files is Phase 14's static guard (D-14-06). Operators should audit `public/uploads/` on any host that has ever had the admin media route reachable and delete non-image files (docs text below).
- Per-deal store, quota, `MA_MEDIA_QUOTA_MB`, serving rules for `/uploads/*`: Phase 14.
- `fileData` is still held as a JSON string up to the app-wide `express.json` 50 MB limit and `validators/cms.js` 70 MB cap before the 10 MiB decoded check; the 16 MiB route-specific parser is Phase 14 (D-14-07).
- A media filename of up to 300 chars can still produce an `ENAMETOOLONG` generic 500 (pre-existing; not changed to keep the naming byte-identical).

## Docs owed to DEPLOYMENT.md (plan 13-13 owns the file; text to add)
- **Media library accepts only images and PDF.** `POST /api/media` (admin only) stores PNG, JPEG, WebP and PDF files up to 10 MiB. The file extension, the declared type (data-URL header or `kind`) and the file's own signature must all agree. Anything else (HTML, SVG, scripts, executables, text, files with no or a double extension) is refused 415 `media-type-refused`; an oversize file is refused 413 `media-too-large`. A refusal stores nothing.
- **Upgrade audit.** Files uploaded through the media library before this release are not re-checked. On any host that exposed the admin media route, list `public/uploads/` (top level, not `slides/`) and delete every file that is not a PNG/JPEG/WebP/PDF you recognise, then remove its entry from Admin > Media if present. Active content there (`.html`, `.htm`, `.svg`, `.js`) is served from the portal's own origin.
- Deleting a media item removes its file only when it is a regular file directly inside `public/uploads/`; a record that points anywhere else is just dropped.

## Verification
- Targeted: `media-upload-safety` 12/12; with `busy-503-contract`, `slide-upload-safety`, `config-admin-only`, `write-validation`, `deployment-role-matrix`: `# tests 55 / # pass 54 / # fail 0 / # skipped 1` (the skip is the Windows-only live slide test).
- `git status --porcelain data/ public/sent_emails/` empty at the commit. No `npm` command run. No server run against committed `data/*.db`.

- **Full suite** (`node --test` from the worktree root at `8208d27`, backgrounded into a log ending `EXIT=<code>`): `# tests 1671 / # pass 1670 / # fail 0 / # cancelled 0 / # skipped 1 / # todo 0`, `EXIT=0`. The base was 1659 tests; the +12 are the new suite. The one skip is the Windows-only `slide-upload-safety (k)`.
- After the suite: `git status --porcelain` shows only this SUMMARY; no file left in `public/uploads/` or `data/slides` (only empty, gitignored `public/uploads/slides/`).

## Self-Check: PASSED
- `lib/slideUpload.js`, `server.js`, `test/media-upload-safety.test.js`, `test/busy-503-contract.test.js`: present and in commit `8208d27`.
- Only the files the brief permits were touched; `server.js` hunks are confined to the `/api/media` POST and DELETE handlers.
