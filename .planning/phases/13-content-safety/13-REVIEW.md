---
phase: 13-content-safety
part: A (server side, data, supply chain)
reviewed_commit: 766195a
diff_base: a0656ef
reviewed: 2026-10-11
reviewer: independent Fable code reviewer (adversarial, evidence-driven)
depth: deep
scope:
  - lib/sanitizeHtml.js
  - lib/htmlPolicy.js
  - lib/csp.js
  - lib/cspReports.js
  - lib/egress.js
  - lib/slideUpload.js
  - lib/credentialLockdown.js
  - db/migrations/deal/002-resanitize-html.js
  - db/controlStore.js
  - scripts/regenerate-demo-db.js
  - data/demo.db
  - validators/cms.js
  - validators/settings.js
  - aiService.js
  - server.js (Phase-13 hunks)
  - package.json / package-lock.json / node_modules (sanitize-html + 16 transitives)
  - public/vendor/fonts/*
findings:
  critical: 0
  high: 1
  medium: 1
  low: 7
  info: 4
  total: 13
status: issues_found
---

# Phase 13 — Code Review, Part A (server / data / supply chain)

**Reviewed:** commit `766195a` (main), Phase-13 diff base `a0656ef`. Later in-flight plans (13-12 test tooling, 13-13 CSP flip, 13-14) were NOT reviewed. For every file in scope `git diff 766195a -- lib db validators server.js scripts package*.json node_modules test` was empty at review time, so the live-tree probes below exercise exactly the committed code.
**Method:** contract read (PRD D-13-01..07, CONTEXT, PLAN-CHECK, 13-01..11 SUMMARYs, R1/R5) → source read of every in-scope file → adversarial probes against the sanitizer (120+ hand-built payloads + stress), path-spelling probes against the slide mount, lockfile/vendor cross-checks, old-vs-new `data/demo.db` content diff, and a run of the 11 Phase-13 server-side test files against isolated `TMPDIR` scratch (`# tests 120 / pass 120 / fail 0`). No server was started against committed `data/*.db`; nothing outside this report was written to the repo; `git status --porcelain data/ public/sent_emails/` empty.

## Summary

The server half of Phase 13 is solid where it matters most: the parser-based sanitizer held against every novel payload tried (scheme encodings, mXSS/namespace tricks, CSS `url()`/`expression`/brace-escape, DOM clobbering, comments/CDATA) and is idempotent; the egress switch is enforced server-side (CSP built per request from runtime.db, Gemini refusals at the route and in `aiService`, RAG upload 404 in real mode); `no-store` sits before the body parsers; the regenerated `data/demo.db` differs from its predecessor **only** in `user_version 0 → 2` (row-for-row content diff); the vendored `sanitize-html` tree matches the lockfile version-for-version, has no install scripts or native code, and the lockfile integrity equals the registry's.

One finding is serious: the `/uploads/slides` sandbox mount is protected by a URL-prefix regex, and on a **Windows host** two path spellings (`%5C` backslash separators; a trailing single period on a directory segment) are not recognised by that guard, not caught by the terminal `.html` middleware (which only inspects `*.html` and only catches the backslash form), and are resolved by `send`/Win32 to the very same slide file — served with the app CSP, same-origin, unsandboxed. That is the R1-04 scenario Phase 13 set out to close, re-opened on one of the two shipped platforms (CR-A01). The fix is structural and small: put the slide directory outside the public static root by default.

The second notable item is the literal PRD contract "unauthenticated but body ≤ 4 KB" for `/api/csp-report`: it holds for the two report content types, but the app-wide `express.json`/`express.urlencoded` (50 MB) run before the route's limiter and parser, so an anonymous `application/json` or form body is read in full first (WR-A01; 13-07 flagged it, left for 13-04 territory, nobody picked it up).

---

## Findings

### CR-A01 [HIGH] — Slide sandbox mount is bypassable by Windows path spellings (backslash, trailing-dot segment)

**Files:** `server.js` ~404–440 (`SLIDE_URL_PREFIX_RE`, `SLIDE_MOUNT_PREFIX_RE`, guard), `server.js` ~440–448 (terminal `.html` middleware pass-through), `server.js` `htmlRequestVerdict()` ~370–384, `lib/slideUpload.js:68–73` (default dir inside `public/`), `node_modules/send/index.js:527–546` (`path.normalize('.' + sep + path)`, `join(root, path)`).

**Issue.** The only thing that keeps a slide from being served by `sendHtml()` or the public `express.static` is a prefix regex (`^\/uploads\/slides(?:\/|$)`) evaluated on `req.path`, its once-decoded form and `path.posix.normalize(decoded)`. `send` resolves the request path with the **platform** `path.normalize`, and on Windows `\` is a separator and a segment ending in a single `.` is normalised to the segment without it. The guard knows neither form:

| Request | slide guard 404? | terminal `.html` mw catches? | `send` on Windows resolves to |
|---|---|---|---|
| `/uploads/slides%5Cx.htm` | no | no (`.htm`, not `.html`) | `public\uploads\slides\x.htm` |
| `/uploads%5Cslides%5Cx.htm` | no | no | `public\uploads\slides\x.htm` |
| `/uploads./slides/x.html` | no | no (no `\`, no `%2e`, no dot segment) | `public\uploads.\slides\x.html` → Win32 strips the trailing period |
| `/uploads/slides./x.html` | no | no | `public\uploads\slides.\x.html` → same |

(Reproduced with the committed regexes and `path.win32` in Node; the Win32 trailing-period rule is the documented normalisation. Not executed on a Windows host — this review ran on macOS/APFS, where neither form resolves. The `.html` + backslash form IS caught by `htmlRequestVerdict` (`decoded.indexOf('\\')`), which is why `.htm` — an allowlisted slide extension, `SLIDE_TYPES.htm` — is the backslash vector.)

**Failure scenario.** Windows host (turnkey Windows zip is a release deliverable; shared internal host OS unspecified). Content admin A uploads `evil.htm` (allowed type; its script would be inert in the sandbox). A sends admin B the link `/uploads/slides%5C<ts>_<hex>_evil.htm`. B's browser receives `text/html` with the APP CSP (`script-src 'self' 'unsafe-inline' …` while `CSP_MODE=report-only`, the default), no `sandbox`, same origin as the portal → the slide's inline script runs with B's session: `fetch('/api/auth/me')`, deal reads, exfil through `img-src`/`connect-src` origins that are on in demo, or same-origin POSTs in real mode. For `.html` slides the `/uploads./slides/…` spelling goes through `htmlRequestVerdict` → `sendHtml()`: same outcome plus `rewriteHtml` stamping the attacker's bytes. Acceptance 3 / SC3 fails on Windows while every test (all run on macOS/Linux) is green — the exact shape plan-check B-1 warned about, one layer down.

**Fix (minimal, structural).**
1. Default `slidesDir()` to a directory **outside** the static root, e.g. `path.join(dbFiles.DATA_DIR, 'slides')` (gitignored like `data/runtime.db`), so no spelling that `express.static(public)`/`sendHtml` can resolve ever reaches a slide file. Document a one-time move of legacy `public/uploads/slides/*` in DEPLOYMENT.md; keep `MA_SLIDES_UPLOAD_DIR` as the override. This removes the whole class (8.3 names, NTFS alternate streams, future spellings) rather than one more regex.
2. Defence in depth, cheap: reject app-wide, as the very first middleware, any request whose decoded path contains `\`, a NUL, or a segment ending in `.` or space (`/[\\\0]|[. ](?:\/|$)/.test(decoded)`) with a fixed 404 — no legitimate route in this app uses such spellings, and `htmlRequestVerdict` already treats `\` this way for `.html`.
3. Add a regression test that feeds the five spellings above to the slide guard and asserts 404 (platform-independent), and a Windows CI smoke row (the release workflow already boots on windows runners) that GETs `/uploads/slides%5C<name>.htm` and asserts `content-security-policy` contains `sandbox`.

---

### WR-A01 [MEDIUM] — `/api/csp-report`: the "body ≤ 4 KB" bound only holds for the two report content types; the global 50 MB parsers read an anonymous body first

**Files:** `server.js:288–289` (`app.use(express.json({ limit: '50mb' })); app.use(express.urlencoded({ limit: '50mb', extended: true }))`), `server.js` ~3044–3060 (route chain: limiter → `express.json({ type: SUPPORTED_TYPES, limit: '4kb' })`), `lib/credentialLockdown.js:139` (the route passes during lockdown too).

**Issue.** D-13-03 reads "unauthenticated but body ≤ 4 KB, per-IP rate-limited". The route's limiter and 4 KB parser are route-level, so they run only after the app-level parsers. For `Content-Type: application/json` (or `application/x-www-form-urlencoded`) an anonymous caller — including during credential lockdown, where this is now the only non-auth POST that passes — has up to 50 MB read, inflated (`inflate: true`) and JSON-parsed **before** `cspReportLimiter.take()` ever runs; only then does the handler answer 415. 13-07 recorded this as `threat_flag: unauthenticated-global-json-parse` and deferred it to "13-04 territory"; 13-04 did not pick it up. It is the same exposure as `/api/auth/login`, but Phase 13 added a new public POST and wrote a tighter contract for it.

**Failure scenario.** Loop `POST /api/csp-report` with `Content-Type: application/json`, 50 MB of `[[[[…` (or a gzip bomb) → each request costs the event loop a full parse; the limiter never counts it. Memory/CPU DoS from an unauthenticated network position; the same against a locked-down host.

**Fix (minimal).** Make the app-level parsers skip this path so the route parser is the only reader:
```js
const skipGlobalParse = (req) => req.path === '/api/csp-report';
app.use(express.json({ limit: '50mb', type: (req) => !skipGlobalParse(req) && /^application\/json\b/i.test(req.get('content-type') || '') }));
app.use(express.urlencoded({ limit: '50mb', extended: true, type: (req) => !skipGlobalParse(req) && /^application\/x-www-form-urlencoded\b/i.test(req.get('content-type') || '') }));
```
and move `cspReportLimiter.take()` into a tiny `app.use` placed BEFORE these parsers for `req.path === '/api/csp-report'` (so the limiter is the first thing that sees the request). Per-route body limits remain Phase 14 for the rest of `/api`.

---

### WR-A02 [LOW] — Slide upload is not atomic: a failed/partial write leaves a servable, quota-counted fragment

**File:** `server.js` ~3430–3440 (`fs.mkdirSync(dir, …); fs.writeFileSync(path.join(dir, fname), verdict.buffer, { flag: 'wx' })` inside a `try` whose `catch` only answers 500).

**Issue.** `writeFileSync` can fail mid-write (ENOSPC, EIO — the host is documented as running at ≥ 90 % disk). The partially written file stays in `slidesDir()`: it is counted by `libraryBytes()` (quota), is servable (sandboxed), and has no slide record pointing at it, so no admin UI can remove it.

**Fix.** Write to `fname + '.tmp'` (not a servable extension → the mount answers 404 for it) with `wx`, then `fs.renameSync` into place; on any error `fs.rmSync(tmp, { force: true })` before answering 500. Have `libraryBytes()` ignore `*.tmp` or sweep them at boot.

---

### WR-A03 [LOW] — `DELETE /api/slides/:id` never unlinks the uploaded file; the new quota turns orphans into a lockout

**File:** `server.js` ~3405–3411 (`db.slides = (db.slides||[]).filter(…); writeDb(db);` — no `fs` call), `lib/slideUpload.js:92–105` (`libraryBytes()` sums every regular file in the directory).

**Issue.** Pre-Phase-13 the file simply lingered; with D-13-04's 100 MB library quota every deleted slide keeps consuming quota and keeps being publicly servable at its old URL. After ~10 deletes-and-re-uploads of 10 MB decks the admin gets the fixed `slide-quota-exceeded` body with no in-app way to free space; the only remedy is filesystem access on the host, which the operating model (zero-install laptop / shared host, no TE IT) does not assume.

**Fix.** On delete, if the record's `url` starts with `/uploads/slides/` and no other slide record references the same `url`, `fs.rmSync(path.join(slidesDir(), path.basename(url)), { force: true })` (basename only — never trust the stored path). Optionally a boot sweep that removes files not referenced by any slide record older than N days.

---

### WR-A04 [LOW] — `Clear-Site-Data` is emitted on every `POST /api/auth/logout`, including sessionless cross-site form posts

**File:** `server.js` ~1351–1365 (logout handler; `PUBLIC_API_PATHS` member; `Clear-Site-Data: "cache", "storage"` set unconditionally), `server.js:289` (`express.urlencoded` enabled app-wide).

**Issue.** The route is public, accepts a form-encoded body, and sets the header whether or not a session token was present. `SameSite=Strict` (server.js:1242) stops the session from being revoked cross-site, but `Clear-Site-Data` is honoured on any top-level navigation response for the portal's origin. Any web page can `<form method=post action="https://portal/api/auth/logout">` + auto-submit and wipe the visitor's portal `localStorage` (checklists, drafts, language preference — the client-side restore only runs on the in-app logout path) and Cache Storage (the Transformers model cache — acceptance 5 wants that cache to *survive*). Nuisance-grade, no data exposure, but a new cross-site capability introduced by this phase.

**Fix.** Set the header only for a genuine logout: `if (token) res.setHeader('Clear-Site-Data', …)`; optionally also require `Sec-Fetch-Site` ∈ {`same-origin`, `none`, absent} on this route.

---

### WR-A05 [LOW] — Migration 002 logs `pages/<id>` and `courses/<id>`; those ids are author-chosen slugs that can carry a target name

**File:** `db/migrations/deal/002-resanitize-html.js:157` (`` `[migrate] deal/002 resanitize-html ${table}/${row.id} ${c.path} sha256 …` ``), header comment lines 32–36 ("never the content itself (MNPI), and never a deal id").

**Issue.** The module took care to hash the file name and the values, but the record id goes to stdout verbatim. CMS page ids are free text from the admin (`validators/cms.js` `ID_MAX = 120`); in a real deal a page is naturally named after the target or project code name — pre-announcement MNPI in a boot log that is routinely pasted into support channels (the SUMMARYs quote migration output verbatim).

**Fix.** Log `sha256(row.id).slice(0, 8)` like the file digest, or the row's ordinal position. The per-value `sha256 before -> after` already gives the operator a stable handle.

---

### WR-A06 [LOW] — Sanitizer cost is superlinear in nesting depth; the only bound is `HTML_MAX` in another module, untested

**Files:** `lib/sanitizeHtml.js:129–141` (synchronous, up to 3 passes), `validators/cms.js:19` (`HTML_MAX = 20000`), `validators/cms.js:26–31` (`i18nOrString`: record with unbounded key count), `validators/cms.js:82,93` (500 lessons × 200 modules).

**Measured (committed code, this host):**

| input | nesting | bytes | wall |
|---|---|---|---|
| `<b>`×n unclosed | 10 000 | 30 KB | 29 ms |
| `<b>`×n unclosed | 40 000 | 120 KB | 965 ms |
| `<b>`×n unclosed | 200 000 | 600 KB | **50.1 s** |
| `<div>`×n…`</div>`×n | 200 000 | 2.2 MB | **35.9 s** |
| 1 MB flat text / 1 MB style / 1 MB entities / 1 MB `<` | — | 1 MB | 18–963 ms |

Quadratic in depth (htmlparser2 stack close + sanitize-html frame stack; the idempotency loop doubles it). Today it is harmless only because `HTML_MAX = 20000` caps a leaf at ≈ 6 600 nested tags (≈ 10–15 ms). Nothing couples the two files: raising `HTML_MAX` (a plausible "long-form lesson" request) silently reopens a synchronous DoS on the write path and on the boot migration. Separately, a single 50 MB request may carry ~2 500 worst-case leaves (unbounded i18n keys, lessons arrays) ≈ 25–40 s of event-loop time for one authenticated author — body limits are Phase 14, noted here only because the sanitizer cost multiplies it.

**Fix.** (a) A regression test in `test/sanitize-html.test.js` that sanitizes the worst-case nested input at exactly `HTML_MAX` chars and asserts `< 100 ms`, with a comment naming the coupling; (b) a hard depth cap inside `sanitizeHtml` (count `<` runs before parsing: if `input.length > 64 KB` or depth estimate `> 2 000`, return `escapeAsText(input)` — the fail-closed path that already exists); (c) bound `i18nOrString` record size (`.refine(o => Object.keys(o).length <= 20)` — the CMS has ≤ 4 languages).

---

### WR-A07 [LOW] — CSP violation store can be blinded by an anonymous client (LRU eviction of genuine tuples)

**Files:** `lib/cspReports.js:22–24,130–160` (100 distinct tuples, least-recently-seen evicted, 20 tuples/request), `server.js` ~3048 (60 req/min/IP).

**Issue.** One IP may legitimately insert 60 × 20 = 1 200 distinct tuples per minute (vary `blocked-uri` path); the store holds 100 → every genuine tuple is evicted within seconds. The whole rollout rule of D-13-03 ("flip to enforcing only after … ZERO violations" asserted on `GET /api/admin/csp-violations`) reads this store: an attacker can either hide a real violation (so the flip goes ahead with a page that will break under enforce) or keep the list non-empty indefinitely (so the flip never happens). T-13-60 accepted "bounded"; the *integrity* effect on the decision procedure is not recorded anywhere.

**Fix (minimal).** Keep the cap but stop foreign noise from evicting first-party signal: only `record()` tuples whose `documentPath` names a real served page (exists under `public/` or `/`) AND whose `sourceFile` is empty/`inline`/`eval`/same-origin; evict foreign-origin tuples before same-origin ones; and have the walk scripts (13-12) also assert on their own browser's `securitypolicyviolation` events, not only on this list.

---

### IN-A01 [INFO] — Tracked `node_modules/.package-lock.json` is stale (no entry for sanitize-html or its 16 transitives)

**Files:** `node_modules/.package-lock.json` (tracked; 13-01 SUMMARY deviation 3 reverted npm's rewrite), `package-lock.json` (correct).
npm ignores the hidden lockfile when any `node_modules` dir is newer, so today it is inert — but it is a tracked artifact that contradicts the tree and will bite the first `npm ci`/`npm ls` run on a fresh clone with preserved mtimes. Regenerate it in a deliberate commit (or untrack it); the "no pre-existing file modified" rule was about package *code*, not npm's cache.

### IN-A02 [INFO] — `POST /api/admin/egress` with `{}` writes runtime.db and an `egress-settings-changed` audit row with identical before/after

**File:** `server.js` ~3011–3027. Harmless but audit noise; answer 400 (`'No egress key supplied'`) or skip `set()`/audit when `Object.keys(req.body).length === 0`.

### IN-A03 [INFO] — 70 stray 8-byte `*_x.html` files in the main checkout's `public/uploads/slides` (gitignored)

Created by `test/config-admin-only.test.js` / `test/deployment-role-matrix.test.js` runs **before** 13-03 added `MA_SLIDES_UPLOAD_DIR` to their env (newest mtime 01:42, 13-03 landed 01:47); the 11-file run performed for this review added none. They are servable (sandboxed) and count toward the quota. Delete them. Note that `test/csp-policy.test.js:169–186` (PD-37) still uploads into the real `public/uploads/slides` of whichever checkout runs it (it does clean up in a `try`); prefer `MA_SLIDES_UPLOAD_DIR` there too.

### IN-A04 [INFO] — PD-8: `frame-ancestors 'self'` ships although D-13-03's text says `'none'`

`lib/csp.js:54`. The planner's reading ("keep = never loosen") is right and `'none'` would break the first-party deck/PDF framing, but it is a literal deviation from a LOCKED decision that the SUMMARY flags as "NEEDS USER CONFIRMATION at phase close". Not yet confirmed in any artifact seen. Surface it.

---

## Checked and clean (with evidence)

**D-13-01 sanitizer**
- R1-03 four payloads inert: `<img src="x" />`, `<a rel="noopener noreferrer">x</a>` (href dropped) ×2, `ipt&gt;alert(1)`.
- 120+ hand-built vectors (beyond the 313-vector corpus) all inert and idempotent: whitespace/entity/NUL/`&colon;`/`&Tab;`/C0/`%0a` scheme splits, `\\evil`, `//evil` (protocol-relative refused), `data:text/html` href, `data:image/svg+xml` and `data:text/html` img (src dropped), `srcset` (dropped), `style` `url()`/`expression()`/`behavior`/`@import`/`-moz-binding`/`position:fixed`/`\64` escapes/`}` rule-break/`var()` (all dropped; `color:red !important` survives harmlessly), `<svg>`/`<math>`/`<style>`/`<template>`/`<noscript>`/`<xmp>`/`<textarea>`/`<title>`/`<select>` mXSS carriers dropped **with content**, `<iframe srcdoc>`, `formaction`, `<base>`, `<meta refresh>`, `<link>`, `<object>`/`<embed>`, `<details ontoggle>`, `<p/onclick>`, `on*` with NUL/newline/uppercase, `id`/`name` clobbering (dropped), `target=_top` (dropped) / `_BLANK` (normalised) / `rel=opener` (forced to `noopener noreferrer`), comments/CDATA/PI/half-open comments, attribute-quoted `-->`/`&quot;&gt;` (stay entity-escaped), duplicate attributes.
- Surviving oddities verified inert by WHATWG URL semantics: hrefs prefixed with U+FEFF / U+00A0 / U+2028 / fullwidth `ｊ` / U+FFFD parse as **relative paths** (`https://host/pages/%EF%BB%BFjavascript:alert(1)`), never as `javascript:`.
- Fail-closed fallback: `escapedFallbacks` stayed 0 over all probes; the fallback escapes `& < >` only, so it is its own fixed point.
- Policy table deep-frozen; `nonTextTags` replaces the library default with the PD-4 set; `allowProtocolRelative:false`; `allowedSchemesByTag.img` adds `data:` only, and the `img` transform restricts it to base64 raster MIME (`charset=` parameter variant correctly refused).
- 1 MB flat text 18 ms; 1 MB style attribute 207 ms; 1 MB unterminated CSS string / comments / brackets / braces 13–282 ms; 1 MB entity soup 365 ms; 1 MB `<` 963 ms — no ReDoS (see WR-A06 for the depth dimension).

**Migration deal/002 + demo.db**
- `up()` runs inside the runner's `BEGIN IMMEDIATE` (db/migrate.js rule), writes only rows with ≥ 1 changed leaf, invents no `version` (pages/courses are not `VERSIONED_COLLECTIONS`), skips absent tables and unparsable JSON, logs no content. Idempotent by construction (sanitizer fixed point) and never re-run (user_version).
- `data/demo.db` a0656ef → 766195a: full content dump (schema + every row of every table, sorted) is **identical** except `user_version=0` → `user_version=2`; sha256 `63d552c4…` → `dba58120…` as the SUMMARY states; `journal_mode`, `page_count` unchanged; no `-wal` bytes.
- `scripts/regenerate-demo-db.js`: refuses `MA_MODE=real`; works on a same-filesystem copy; `integrity_check`; checkpoint TRUNCATE; refuses a non-empty old `-wal`; restores file mode; no-op when already at latest.

**Slides (apart from CR-A01)**
- `checkUpload()` judged before any `mkdir`/write; refusals use fixed bodies, never echo input; `.svg`/`.exe`/no-extension/trailing-dot/`..`/NUL/unicode names → 415 (`sanitizeFilename` + `extname`); declared type must equal the extension's MIME; PNG/JPEG/PDF/WebP magic required, HTML refused if it starts with a binary signature; 10 MB checked on the arithmetic size before base64 decode; `wx` flag prevents overwrite.
- Headers on every response variant: `send` emits `headers` (→ `setHeaders`: nosniff, `private, no-cache`, Report-Only removed, sandbox CSP for html/htm/png/jpg/jpeg/webp) in `setHeader()` **before** the conditional/range branches, so 200, 206, 304 and HEAD all carry them; `notModified()` strips only `Content-*`. PDFs keep the app CSP + nosniff (PD-17, accepted T-13-25).
- Mount is terminal for the exact prefix (`slideNotFound` tail), `dotfiles:'deny'`, `index:false`, `redirect:false`; `/uploads/slides/` (dir) → 404; `..` → `send` 403; case/percent/dot-segment/double-slash spellings → 404 (tested with the committed regexes).
- Unauthenticated read of `/uploads/slides/*` is the explicit D-13-04(c) deferral to Phase 14 — recorded, not re-flagged.

**CSP builder / report channel**
- `buildPolicy` takes only booleans; no request data reaches a header (no injection). Real-mode strings contain no `http`/`https`/wildcard token in either header; per-switch origin lists are absent when the switch is off (`frame-src 'self'`, `connect-src 'self'`, `img-src 'self' data: blob:`). YouTube never in `script-src`. Unknown `CSP_MODE` fails closed to enforce with one warning.
- `/api/csp-report`: on `PUBLIC_API_PATHS` (gate returns before `pathForms`/role checks); route parser accepts only the two report types at 4 KB (`inflate` limit applies to decompressed bytes); 415 for anything else; route-local 413/400/415 mapper; `normalize()` reduces URLs to origin+path (query/fragment never stored), non-http(s) URIs to scheme, clips to 200 chars, caps 20 tuples/request, validates line numbers; store returns JSON only; `GET /api/admin/csp-violations` checks `isAdminRequest` inline on top of the `/api/admin` prefix policy. Lockdown passes exactly `POST /api/csp-report` canonical.
- `CspReportSchema` is documentation only (the public path never hits `validationMiddleware`) — consistent with its comment.

**Egress (D-13-05)**
- Enforced server-side, not by UI: CSP per request from `egress.current()`; `/api/ai/insight` and `/api/rag/upload` return the 200 `{ egressDisabled: 'gemini' }` marker first (nothing parsed/leased); `aiService` backstop takes the local branch on `false`; `/api/assessment` passes an empty key when Gemini is off; real mode answers 404 for every canonical spelling of `/api/rag/upload` before the gate (unauthenticated included).
- Defaults: real → all `false`, dev/demo → all `true` (`modeDefaults`); overlay accepts only real booleans for the three keys (`controlStore.getEgressSettings` filters on read too).
- Admin-only: `/api/admin` prefix is `roles: ['admin']` for all methods (server.js:642) plus inline `isAdminRequest` on POST; `EgressUpdateSchema` is `.strict()` optional booleans → unknown key/non-boolean = 400; every change is a security event with actor/before/after.
- Cross-process freshness: `PRAGMA data_version` + in-process generation counter; `load()` never throws (version/read wrapped; last good value or mode default).
- `egress` in `GET /api/settings` is appended after the spread, so a stored `settings.egress` cannot shadow it; `PUBLIC_SETTINGS_KEYS` exposes booleans only.
- Fonts: four woff2 files have `wOF2` magic and sha256 equal to the SUMMARY table; `style.css` declares local `@font-face` only; no `fonts.googleapis`/`fonts.gstatic` reference under `public/` outside `vendor/`; lockdown allowlist extended by exactly those four paths.

**Caching (D-13-06, server half)**
- `no-store` middleware sits after the lockdown gate and **before** `express.json`/`urlencoded`, so parser 400/413, gate 401/403, route 404/409, the central 503 and the final 500 all inherit it (13-04 matrix re-read against the code order; CR-01 non-canonical `/API/…` 404 carries a fixed body and no data). Explicit per-route `no-store` sets remain no-op re-sets. Logout clears the cookie, revokes the session row and (see WR-A04) sets `Clear-Site-Data`.

**Supply chain (D-13-01 vendoring rule)**
- `package.json`: `"sanitize-html": "2.17.5"` exact; `overrides` for launder/postcss/nanoid/source-map-js exact.
- Registry (`npm view sanitize-html@2.17.5`): `dist.integrity` `sha512-ZmU1joGRrvoyctKIiuwUxqR6moLoU2Wk+2bMccN6f7UwhAmwYDvWziqPxRDDN2Qip62NqnIrVrT9akbL6Wretg==` **equals** `package-lock.json`'s entry.
- All 17 new packages (incl. nested `dom-serializer/node_modules/entities@4.5.0`): `node_modules/<pkg>/package.json` version == lockfile version; lockfile `resolved` all `registry.npmjs.org`; no `preinstall`/`install`/`postinstall` (only `prepare`, which npm does not run for registry deps); no `*.node`/`binding.gyp`/`*.sh`/`*.wasm`; no symlinks; only `nanoid` declares a `bin` (not linked — `.bin` not copied); every file tracked, no untracked/ignored files in the new dirs. Release ages as tabulated in 13-01 (sanitize-html 2.17.5 published 2026-06-10, 123 days) — consistent with registry `time` data queried for the top package; transitives taken from the SUMMARY table (not re-queried).

**Regression contracts (Phases 8–12) touched by this diff**
- Canonical path gate unchanged (`/csp-report` added to the public set only); `/api/rag/upload` 404 uses `pathForms` (every canonical spelling); terminal `.html` middleware semantics unchanged except the slide pass-through; `sendHtml`/stamping untouched; credential lockdown allowlist grew by exactly `/js/client-storage.js` + 4 fonts + one canonical POST; audit-inside-transaction untouched (egress is a control-plane security event, not a deal write).
- Test run (isolated `TMPDIR`): `sanitize-html`, `slide-upload-safety`, `csp-report`, `csp-policy`, `egress-settings`, `egress-real-mode`, `caching-safe07`, `resanitize-migration`, `credential-lockdown`, `xss-sanitization`, `xss-chain` → 120/120 pass; no file under `data/` or `public/sent_emails/` touched; `public/uploads/slides` count unchanged.

---

## Verdict per locked decision (server half)

| Decision | Verdict | Notes |
|---|---|---|
| **D-13-01** server sanitizer + legacy migration | **CONFORMANT** | Allowlist, schemes, CSS policy, never-allowed list, idempotency, `''` for non-string, migration writes only changed rows, no audit rows, demo.db regenerated with content byte-identical. WR-A05 (id in log) and WR-A06 (depth cost coupling) are hardening, not contract breaks. |
| **D-13-02** client renderer | n/a (Part B) | — |
| **D-13-03** CSP rollout infrastructure | **CONFORMANT with one literal gap** | Strict policy Report-Only by default, `report-uri`, admin-only list, `CSP_MODE` rollback: ✓. Literal gap: "body ≤ 4 KB" holds only for report content types (WR-A01). `frame-ancestors 'self'` deviation awaits user confirmation (IN-A04). Enforce flip = 13-13, not reviewed. WR-A07 weakens the "ZERO violations" oracle. |
| **D-13-04** slides & uploads | **GAP** | (a) allowlist/limits/quota/fixed bodies/nothing written: ✓. (b) sandbox CSP + nosniff on every variant: ✓ on POSIX hosts; **bypassable on Windows** via `%5C` / trailing-period spellings (CR-A01). (c) no file store built: ✓. WR-A02/A03 operational. |
| **D-13-05** egress switch | **CONFORMANT** | Server-side enforcement (CSP + route refusals + aiService backstop), real default off / demo on, admin-only + strict schema + audited, next-request cross-process, fonts vendored (hash-verified), RAG upload 404 outside demo. |
| **D-13-06** caching (server half) | **CONFORMANT** | `no-store` before parsers on every `/api` status; `Clear-Site-Data` on logout (WR-A04 recommends gating it on a real session). Client half = Part B. |
| **D-13-07** proof tooling (server half) | **CONFORMANT** | 313-vector corpus runs in `node --test` against the real sanitizer; this review added 120+ independent vectors, all inert. Playwright walks = 13-12, not reviewed. |

---

_Reviewed: 2026-10-11 against `766195a` — Part A (server / data / supply chain). Review is read-only; no source file modified; nothing committed._
