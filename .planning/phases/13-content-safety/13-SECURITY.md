---
phase: 13
slug: content-safety
status: OPEN_THREATS
verdict: OPEN_THREATS (non-blocking — one MEDIUM open threat below the HIGH gate; ship gate not triggered)
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_total: 70
threats_closed: 69
threats_mitigated: 63
threats_accepted: 6
threats_open_nonblocking: 1
threats_open: 0
asvs_level: 1
block_on: high
audited: 2026-10-11
audited_head: ef1c2b7
audited_commit: ef1c2b70814561de76a96da74063d22bef8afa0b
diff_base: a0656ef
auditor: Claude Fable 5.1 (gsd-security-auditor, second-opinion model)
suite: 1705 tests / 1704 pass / 0 fail / 1 skipped (Windows-only live row) — node --test, 32 s, re-run by the auditor at ef1c2b7
live_probe: 56 HTTP checks on isolated real-mode / demo-open / report-only / unknown-mode instances + 4 follow-up + 1 reproduction; 31 unit checks; 9 real-Chromium checks (host-local Playwright 1.62.1 + Chromium 1234, nothing installed)
---

# Phase 13 — Content Safety: Security Gate

**Verdict: OPEN_THREATS, non-blocking.** All 70 `T-13-nn` threats declared in the `<threat_model>` blocks of plans
13-01..13-14 were classified and verified against the committed tree at `ef1c2b7`. 63 `mitigate` dispositions are located
in code (file:line below) and proven by a named test, a live request on an isolated instance, a unit run of the shipped
module, or a real-Chromium check; 6 `accept` dispositions (AR-13-01..05 plus the 13-12/13-14 Playwright acceptance) have
their rationale present and still valid. **One declared mitigation is absent in one lane:** `T-13-13` (Repudiation —
silent egress change, MEDIUM). Under `DEMO_OPEN=1` a `POST /api/admin/egress` authenticated by the `X-Admin-Token`
break-glass header **persists the change, answers 500 and writes no `egress-settings-changed` row** (reproduced; root cause
below). MEDIUM is below the HIGH block threshold, so `threats_open` is **0** and the phase is not blocked; the fix is two
lines plus one test row. Every review finding of `13-REVIEW.md`, `13-REVIEW-CLIENT.md` and the media quick task was
re-verified in code or live, not taken from the fixer reports. Nine new concerns (SC-01..09) are recorded; the highest is
LOW. Eight already-decided items were re-examined and their justification holds (AR-13-06..13); one documentation debt
they create is SC-01.

**Stance and method.** Every mitigation was assumed absent until found in source and exercised; SUMMARY, REVIEW and FIX
reports were used only as a map. Depth: ASVS L1 (control present) with L2 placement checks on every boundary control (the
no-store header before the body parsers; the CSP-report limiter before any parser; the slide mount before the terminal
`.html` middleware; the Windows-alias guard as the first middleware; the sanitizer at the write gate and the DOM-building
renderer at the sink; the egress check at the route AND in `aiService`), and L3 traces on the three composition seams
that mattered (stored/uploaded bytes → script execution in the portal origin; egress in real mode; the demo-open lane).
Live work ran on fresh `mkdtemp` instances under the session scratchpad against an exported copy of the `ef1c2b7` tree
(node_modules symlinked), `127.0.0.1` port 0, every child closed and every temp tree removed; the main checkout's
`data/demo.db` / `data/control.db` sha256 are identical before and after everything (`dba58120…`, `e83f049e…`), every
`-wal` is 0 bytes, `git status --porcelain -- data public` is empty, `public/uploads/slides` is still empty and
`data/slides` does not exist. `POST /api/settings/new-ma` was never called. Nothing was installed; Playwright was loaded
read-only from an unrelated project's `node_modules` on this host.

## Verification performed

| Check | Result |
|-------|--------|
| `node --test` at `ef1c2b7` (full suite) | 1705 tests, 1704 pass, 0 fail, 0 cancelled, 1 skipped (`slide-upload-safety (k)` — Windows-only live row), 32 s; committed DBs byte-identical afterwards |
| Unit probe of the shipped modules (`lib/sanitizeHtml`, `lib/htmlPolicy`, `db/migrations/deal/002`, `lib/cspReports`, `lib/requestPath`, `lib/csp`, `validators/index urlField`, `lib/slideUpload`) | 31 checks: 30 PASS; 1 auditor clause error (header string, verified byte-identical live) |
| Live probe 1 — real mode (`MA_MODE=real`, temp `MA_DATA_DIR`, `MA_SLIDE_QUOTA_MB=1`), second real process on the same data dir, demo-open child (`DEMO_OPEN=1` + `ADMIN_TOKEN`), `CSP_MODE=report-only` child, `CSP_MODE=disabled` child | 56 checks: 52 PASS; 4 FAIL triaged — 2 probe defects (module path; stale "directory absent" clause), 1 wrong expectation (trailing-slash `/api/csp-report/` is refused 401 at the gate, body unread — stricter than asserted), **1 real defect → T-13-13 OPEN** |
| Live probe 2 (audit rows + demo-open token header) and probe 3 (reproduction with the child's stderr) | egress audit rows: exactly one hashed `audit_log` row per ACCEPTED change in real mode (none for the 403 / `{}` 400) PASS; demo-open + token: `status 500`, `effective.youtube` flipped, `audit_log` egress rows `[]`, stderr `recordSecurityEvent() called with no resolved actor` — **REPRODUCED** |
| Real Chromium (headless, Playwright 1.62.1 / Chromium 1234): legacy `playbookLink` payloads planted directly in the deal store; sandboxed slide framed and top-level with a canary listener; `<script src=slide>`; planted `javascript:` welcome-video URL; `clearOnLogout` | 9 checks: 7 PASS; 2 FAIL triaged as probe primitives (`sendBeacon` returns `true` = queued, request then blocked by `connect-src 'none'` with zero canary hits; top-level slide navigated its OWN tab, read before load) — every containment assertion held |
| Supply chain (`sanitize-html` 2.17.5 + 16 transitives) | lockfile `integrity` **equals** the registry's `dist.integrity` (fetched live); published 2026-06-10 (122 days; 2.18.0 of 2026-09-30 correctly NOT taken); installed `package.json` version == lockfile for all 17 (incl. nested `entities@4.5.0`); no `preinstall`/`install`/`postinstall` (only `prepare`/`prepublishOnly`, never run for registry deps); no `*.node`/`binding.gyp`/`*.sh`/`*.wasm`/symlinks; `node_modules/.package-lock.json` untracked and ignored (IN-A01) |
| Static sweeps of `public/` (vendor excluded) | 0 inline `<script>`, 0 `on*=` handlers, 0 `javascript:`/`srcdoc` in 28 HTML files; 0 `eval`/`new Function`/`document.write`/`.srcdoc`/`setHTMLUnsafe`/string timers in first-party JS; 0 `serviceWorker.register`, 0 `manifest.json` references; 0 `fonts.googleapis`/`gstatic`/CDN references; exactly one `message` listener (`overview-1.js`, origin + source checked); fonts `wOF2` magic, sha256 equal to the 13-02 SUMMARY table |
| Evidence hygiene (`evidence/`, 13-12 logs + screenshots) | `grep -rE "/Users/|/private/tmp|TEdemo|ma_session=|tempPassword|MA_BOOTSTRAP"` — no match; every `enf-*.log` / `ro-*.log` ends `data-integrity PASS` and `N PASS, 0 FAIL` |

## Threat register

Severity order critical > high > medium > low; `block_on: high`. CLOSED = control found at the stated location, placed at
the right boundary, proven by the named test and/or live/unit/browser check. CLOSED (accepted) = rationale present and
still valid. OPEN = declared mitigation absent (here: in one lane).

| ID | Category | Sev | Disp. | Mitigation location (code) | Proof (test / live) | Status |
|----|----------|-----|-------|----------------------------|---------------------|--------|
| T-13-01 | Tampering/EoP — stored XSS via htmlField (R1-03) | high | mitigate | `lib/htmlPolicy.js` (one deep-frozen allowlist), `lib/sanitizeHtml.js:128-209` parser + re-serialize, `validators/index.js` `htmlField()` unchanged | `sanitize-html.test.js:142,166` (R1-03 inert through the real `/api/pages` route), `:284` corpus; live: `POST /api/pages` R1-03 → `<img src="x" /><a rel=…>l</a>ipt&gt;alert(1)`; unit 34 hand vectors inert | CLOSED |
| T-13-02 | Tampering — mXSS / namespace confusion | high | mitigate | `htmlPolicy.js:41-45` DROP_WITH_CONTENT → `sanitizeHtml.js:150` `nonTextTags`; client `safe-html.js:249-251` drops non-HTML namespaces with content | corpus categories `mxss`, `namespace-confusion` (313 vectors); unit: svg/math/noscript/template/select/xmp/table-foster vectors inert; Chromium corpus evidence `enf-client-corpus.log` 16 PASS | CLOSED |
| T-13-03 | Tampering — non-idempotent output | medium | mitigate | `sanitizeHtml.js:200-209` fixed point ≤ 3 passes, escaped fallback is its own fixed point `:43-54` | `sanitize-html.test.js:284,306`; unit: every vector idempotent | CLOSED |
| T-13-04 | DoS/Integrity — mangling demo content | medium | mitigate | parser preserves the allowlist (`htmlPolicy.js:28-36,60-69`) | `sanitize-html.test.js` golden subtest over `test/fixtures/cms-golden.json`; `xss-chain (b3)`; `data/demo.db` content unchanged apart from `user_version` (13-REVIEW row diff; sha `dba58120…` stable across suite + probes) | CLOSED |
| T-13-05 | Info — DOM clobbering | low | mitigate | `htmlPolicy.js:54,60` (`id`/`name` absent), mirrored `safe-html.js:82,84` | `sanitize-html.test.js:135`; unit policy checks | CLOSED |
| T-13-SC | Supply chain — sanitize-html + transitives | high | mitigate | `package.json` exact `2.17.5` + exact `overrides`; `package-lock.json` | registry integrity match (live), 122-day age, 17/17 installed == lock, no install scripts / native / symlinks, `.package-lock.json` untracked (see Verification) | CLOSED |
| T-13-10 | Info — Gemini egress of MNPI | high | mitigate | `lib/egress.js:28-33` real default off; route markers `server.js:2750-2752,4041-4043`, empty key `:4173`; backstop `aiService.js:8-16,26,333,500` | `egress-settings` "zero outbound" subtest; live real: `/api/ai/insight` → `{egressDisabled:'gemini'}`, `/api/rag/upload` (4 spellings/callers) → 404 | CLOSED |
| T-13-11 | Info — browser egress (HF/YouTube/fonts) | medium | mitigate | `lib/csp.js:48-68` origins only while the switch is on; `public/css/style.css:6-35` local `@font-face` | live real default header carries no `http`/`https` token; grep: no CDN reference; `egress-real-mode` green | CLOSED |
| T-13-12 | EoP — non-admin enabling egress | high | mitigate | `server.js:733` + `lib/readPolicy.js:35` (`/api/admin` admin-only every method), inline `isAdminRequest` `:3097`; `validators/settings.js:242-247` `.strict()` booleans | live: hrbp GET/POST 403, anon 401, `{}`/non-boolean/unknown key 400; demo-open anon POST 403 (switch unchanged) | CLOSED |
| T-13-13 | Repudiation — silent egress change | **medium** | mitigate | `server.js:3107-3114` `egress-settings-changed` with actor/before/after | real mode: exactly 2 hashed `audit_log` rows for 2 accepted changes, none for the refused ones (probe 2). **Absent under `DEMO_OPEN=1` + `X-Admin-Token`: change persisted, 500, no row** (probe 3) — see Open threats | **OPEN (non-blocking)** |
| T-13-14 | Tampering — stale setting in another process | medium | mitigate | `lib/egress.js:56-69` `PRAGMA data_version` + generation; `db/controlStore.js` `runtimeDataVersion()` | `egress-settings` cross-process subtest; live: process 2 saw process 1's switch, process 1 saw process 2's switch-off on the next request | CLOSED |
| T-13-15 | DoS — per-request settings read | low | mitigate | one pragma per request `egress.js:58`, memoised header strings `csp.js:104-121` | code; budget re-measure belongs to 13-14 (in flight) | CLOSED |
| T-13-16 | Supply chain — font binaries | low | accept | `public/vendor/fonts/*.woff2` + OFL texts, served static only | sha256 of the 4 files equal the 13-02 SUMMARY table, `wOF2` magic; AR-13-01 | CLOSED (accepted) |
| T-13-20 | EoP — slide script with the viewer's session | high | mitigate | `lib/slideUpload.js:25-27` sandbox CSP, `server.js:489-504` set on every variant; `transitions.js:1235-1236` `sandbox="allow-scripts"` set before `src` | live: 200/HEAD carry the exact sandbox CSP + nosniff + `private, no-cache`, no Report-Only, no Set-Cookie; Chromium: `self.origin` null, cookie/localStorage/`parent.document` SecurityError, `fetch('/api/auth/me')` and canary fetch TypeError, top-navigation SecurityError, zero canary hits; `enf-slide-sandbox.log` 107 PASS | CLOSED |
| T-13-21 | Tampering — SVG/polyglot upload | high | mitigate | `slideUpload.js:56-64` (no svg), `:345-386` ext AND declared type AND magic, html refused with a binary signature | live: `.svg`/`.exe`/png-with-html/html-with-png/type-mismatch/no-ext → 415 fixed body, name never echoed | CLOSED |
| T-13-22 | DoS — disk exhaustion via slides | medium | mitigate | `slideUpload.js:20-21,280-310,331-337` arithmetic size before decode, quota over regular non-tmp files; `:383` | live: > 10 MB → 413; `MA_SLIDE_QUOTA_MB=1`: 2nd 600 KB → 413 `slide-quota-exceeded`, nothing written, no `.tmp` | CLOSED |
| T-13-23 | Info — traversal/dotfiles via the mount | medium | mitigate | `server.js:481-505` `mountFileName()` allowlist + `dotfiles:'deny'` + terminal 404; `:130-139` Windows-alias first middleware | live: 17 spellings (`%5C`, `uploads.`, `slides.`, case, `//`, `%20`, `./`, `../`, `%2e%2e`, `::$INDEX_ALLOCATION`, `~1`, dir, dotfile, trailing slash, `%2e`) → 404; `/api/deals/x~y` untouched (401) | CLOSED |
| T-13-24 | Tampering — slide label in overlay markup | medium | mitigate | `transitions.js:1205-1240` createElement/textContent | `slide-sandbox-client` static subtest; code read | CLOSED |
| T-13-25 | EoP — PDF framed unsandboxed | low | accept | `slideUpload.js:53-59` PDF keeps app CSP + nosniff + magic; `transitions.js:1235` | DEPLOYMENT.md "PDFs are not sandboxed"; AR-13-02 | CLOSED (accepted) |
| T-13-26 | EoP — slide answered by the terminal `.html` middleware (B-1) | high | mitigate | mount `server.js:468-505` before the terminal middleware `:509-521` (which passes the prefix); default dir OUTSIDE public `slideUpload.js:79-92` | `slide-upload-safety (c),(d),(l)`; live: file under `<MA_DATA_DIR>/slides` mode 0700, nothing under `public/` | CLOSED |
| T-13-30 | Info — cached /api responses after logout | high | mitigate | `server.js:311-316` no-store BEFORE the parsers `:346-355` | `caching-safe07` status matrix; live: 200/401/403/404/400 (malformed JSON)/404 (alias) all `no-store` | CLOSED |
| T-13-31 | Info — storage residue after logout | medium | mitigate | `server.js:1434` Clear-Site-Data (cookie-gated, WR-A04); `public/js/client-storage.js:106-134` snapshot → logout → clear → restore | live: header present with cookie, absent without; Chromium: only `employeeLanguage=de` survives, sessionStorage/Cache Storage empty, session revoked; `enf-caching.log` 43 PASS | CLOSED |
| T-13-32 | DoS — model cache wiped per load | low | mitigate | wipe removed `transitions.js:1917-1927`; `client-storage.js:147-164` filters `transformers-cache` out of the legacy clean-up | `enf-caching.log` `pageLoads=10`; vm subtest | CLOSED |
| T-13-33 | Tampering — leftover service worker | low | mitigate | `public/sw.js:15-29` no fetch handler, self-unregister; `client-storage.js:155-156` unregisters `/sw.js` | grep: no `serviceWorker.register`, no `manifest.json` reference | CLOSED |
| T-13-34 | Info — Clear-Site-Data ignored on plain http | medium | mitigate | client clearing unconditional `client-storage.js:116-133`; IN-B02 `transitions.js:1933` pageshow reload; DEPLOYMENT.md "Caching and sign-out" TLS note | code + docs present | CLOSED |
| T-13-40 | Tampering/EoP — legacy stored XSS | high | mitigate | `db/migrations/deal/002-resanitize-html.js:55-59` the three htmlField paths, `:134-177` | `resanitize-migration` + inventory cross-check; unit: dirty page body/layout/lesson re-sanitized | CLOSED |
| T-13-41 | Tampering — spurious rewrites / 409 storms | medium | mitigate | `002:153` unchanged row not written, `:154` version only for VERSIONED_COLLECTIONS | unit: clean row bytes identical, no `version` invented | CLOSED |
| T-13-42 | Tampering — committed demo.db via -wal | medium | mitigate | `scripts/regenerate-demo-db.js:35-36` refuses real mode, `:51` checkpoint TRUNCATE, `:85` integrity_check | demo.db sha unchanged after suite + probes, `-wal` 0 bytes, porcelain clean | CLOSED |
| T-13-43 | Repudiation — content changed without trace | low | mitigate | `002:163-176` per-value sha256 before/after, row id as `#sha8`, file by digest (WR-A05) | unit: log has no verbatim id, no file name, no content | CLOSED |
| T-13-44 | DoS — migration failure leaves file not-ready | medium | mitigate | `db/migrate.js:32,278` one BEGIN IMMEDIATE per migration (Phase 12 T-12-50/51 sticky not-ready) | `schema-migrations` green; timing on a volume deal = 13-14 | CLOSED |
| T-13-50 | EoP — CMS page render executing script | high | mitigate | `public/js/safe-html.js:242-286`; `page-layout.js:40,168`, `page-cms.js:37` | `safe-html-policy:244`; `enf-stored-xss.log` 159 PASS; Chromium: 0 violations on dashboard/employee | CLOSED |
| T-13-51 | Tampering — serialize/re-parse mXSS | high | mitigate | `safe-html.js:262-275` parser nodes never re-attached | `safe-html-policy:163` no-sink + `:150` negative control (WR-B02) | CLOSED |
| T-13-52 | Tampering — client/server allowlist drift | medium | mitigate | `safe-html.js:62-121` literal copy | `safe-html-policy:103` table-for-table parity | CLOSED |
| T-13-53 | DoS — MASafeHtml missing at render | medium | mitigate | parser-blocking tag first on 18 pages; fail-closed `page-layout.js:132`, `page-cms.js:25-26` | `safe-html-policy:275` ordering gate | CLOSED |
| T-13-54 | Integrity — demo pages differ | low | mitigate | chrome kept; no CSS scoping applied (WR-B05 decision) | `evidence/p13-walk-*.jpg`; FIX-C computed-style comparison | CLOSED |
| T-13-60 | DoS — report flood / oversized body | medium | mitigate | limiter BEFORE parsers `server.js:332-343`; global parsers skip the path `:346-355`; 4 KB route parser `:3134`; caps `cspReports.js:25-29` | live: 5 MB `application/json` → 415 in 1 ms, form → 415, 10 KB report → 413, 429 + `Retry-After: 60` + no-store inside the window, store ≤ 100 | CLOSED |
| T-13-61 | Info — MNPI in reported URLs | medium | mitigate | `cspReports.js:41-69` origin+path only, non-http → scheme | live + unit: `?deal=SECRET#frag` / `?token=SECRET` / `javascript:alert(SECRET)` never stored | CLOSED |
| T-13-62 | Tampering — attacker strings rendered in an admin view | medium | mitigate | JSON only `server.js:3157-3164`; no client code references `csp-violations` (grep 0); comment `cspReports.js:17-18` | code | CLOSED |
| T-13-63 | Info — non-admin reading the list | low | mitigate | `/api/admin` read rule + inline `isAdminRequest` `:3158` | live: anon 401, hrbp 403, demo-open anon 403, token 200 | CLOSED |
| T-13-64 | EoP — inline script during report-only | high | accept (time-boxed) | superseded: `lib/csp.js:71` `DEFAULT_MODE = 'enforce'` | live default header is the strict enforcing policy; `csp-policy` default subtests | CLOSED (time-box ended with 13-13) |
| T-13-65 | Spoofing — forged reports polluting the walk signal | low | accept | isolated walk servers; in-page `securitypolicyviolation` capture `scripts/uat/phase13-scenarios/_shared.js:118`, `csp-walks.js:4`; WR-A07 hardening `cspReports.js:133-199` | unit: non-served page dropped, foreign tuple evicted first; AR-13-03 | CLOSED (accepted) |
| T-13-70 | Info — model download / thumbnail leaking to third parties | medium | mitigate | `employee.js:1687,1815,1853-1855` (`youtubeAllowed`, fail-closed), `transitions.js:3292-3294,3369,3410,3467` (`huggingFaceAllowed`) | `enf-walk-real.log` "no third-party request was even attempted"; `egress-client` vm rows | CLOSED |
| T-13-71 | DoS — marker retried in a loop | low | mitigate | `transitions.js:4221-4233` textContent state, refresh control withdrawn, `return`; `admin.js:1363` | code; `egress-client` row (one fetch, zero timers) | CLOSED |
| T-13-72 | Tampering — panel built from server strings | low | mitigate | `admin.js:3015-3075` createElement/textContent only | grep of the region: no innerHTML/insertAdjacentHTML/outerHTML/document.write | CLOSED |
| T-13-73 | EoP — non-admin reaching the panel write | low | mitigate | server-side T-13-12 | live 403s | CLOSED |
| T-13-80 | EoP — chatbot `javascript:` link | high | mitigate | `transitions.js:3789-3811` escape → markdown → `MASafeHtml.render`; `safe-html.js:155-177` scheme check | region-scan entry; 13-09 Chromium run; `enf-stored-xss.log` banner-chat path | CLOSED |
| T-13-81 | EoP — i18n-html / inline-edit restore | high | mitigate | `transitions.js:4807-4810` `setMarkup`; `inline-edit.js:53,64`; `pages/signage-1.js:14` | `client-render-paths` ENUMERATED_PATHS; `enf-client-corpus.log` 100 i18n values | CLOSED |
| T-13-82 | EoP — lesson body raw innerHTML | high | mitigate | `employee.js:2317-2318` render into an empty container | `enf-stored-xss.log` lesson modal rows | CLOSED |
| T-13-83 | Tampering — sink regression on an enumerated path | medium | mitigate | `test/client-render-paths.test.js` (sinks incl. `setHTMLUnsafe`/`createContextualFragment`/`srcdoc`/`parseFromString`/`importNode`/`insertAdjacentElement`, render-kind literal call, URL-attribute gate) | negative controls present and green | CLOSED |
| T-13-84 | EoP — the not-enumerated sinks | medium | accept (bounded) | strict CSP enforced by default (`csp.js:71`); 246 sinks inventoried by writer role (13-09 SUMMARY + FIX-C IN-B01) | live default header; AR-13-04 | CLOSED (accepted) |
| T-13-90 | EoP — inline script/handler executing | high | mitigate | all inline code externalised to `public/js/pages/*`, `public/js/overview-deck/*` | auditor grep: 0 inline `<script>`, 0 `on*=`, 0 `javascript:` in 28 files; `csp-inline-free-pages` + `csp-strict-gate` | CLOSED |
| T-13-91 | DoS — page broken by moved code | medium | mitigate | verbatim moves, same position | `enf-walk-dev/demo-open/real.log` 0 failed steps, 0 page errors | CLOSED |
| T-13-92 | Tampering — stale external file from cache | low | mitigate | content-hash stamps (Phase 12 `lib/assetStamp.js`, transitive) | `test/asset-cache-bust.test.js` green | CLOSED |
| T-13-93 | EoP — user text interpolated raw in moved code | medium | mitigate | `pages/dashboard-1.js:4,35` `esc()`; `pages/signage-1.js:13-14` textContent/MASafeHtml | code | CLOSED |
| T-13-100 | EoP — runtime-generated inline handlers | high | mitigate | `addEventListener` everywhere; grep 0 `setAttribute('on…')` | `csp-inline-free-decks` + `csp-strict-gate:356` client-JS negative control (WR-B06) | CLOSED |
| T-13-101 | DoS — decks broken under sandbox/strict | medium | mitigate | verbatim deck moves | `evidence/p13-walk-dev-deck-slide-1440.jpg`; walks 0 failed | CLOSED |
| T-13-102 | Tampering — `javascript:` navigation from generated links | low | mitigate | `transitions.js:2851` `href='#'` + preventDefault (addSlide), `:2251` quick-nav, `:2797-2803` custom links via `safeHref` | gate; code | CLOSED |
| T-13-110 | Tampering — committed DBs during browser runs | high | mitigate | `scripts/uat/phase13-xss.js:113-131` sha256 (+-wal) + `git status --porcelain` | every `enf-*.log`/`ro-*.log` ends `data-integrity PASS` | CLOSED |
| T-13-111 | Info — credentials/MNPI in evidence | medium | mitigate | `phase13-xss.js:148-158` `redact()`; synthetic deals | auditor grep of `evidence/`: no OS-user path, password, cookie or bootstrap secret | CLOSED |
| T-13-112 | Repudiation — walks tuned to pass | high | mitigate | both violation sources asserted (`_shared.js:116-118`); PD-24 | 13-12 SUMMARY deviations are test-side; product files untouched by 13-12 (`git diff` of the plan's commits) | CLOSED |
| T-13-113 | Supply chain — Playwright | low | accept | host-local, not in `package.json`, `scripts/uat` not shipped | `package.json` dependencies list has no playwright; AR-13-05 | CLOSED (accepted) |
| T-13-114 | Tampering — probe slide left in `public/uploads/slides` | low | mitigate | delete by returned URL in `finally` | `enf-slide-sandbox.log:113-114` listings identical; auditor: directory still empty | CLOSED |
| T-13-120 | EoP — inline/eval from any missed sink | high | mitigate | `lib/csp.js:71` default enforce, `:45` strict script-src | live default header; `csp-policy` default subtests incl. child; enforce walks | CLOSED |
| T-13-121 | DoS — enforcement breaking a page | medium | mitigate | report-only walks first (`ro-*.log`), enforced walks (`enf-*.log`), one-variable rollback `csp.js:79-85` | live: `CSP_MODE=report-only` → legacy enforced + strict report-only; `CSP_MODE=disabled` → enforce | CLOSED |
| T-13-122 | Tampering — inline code re-introduced | medium | mitigate | `test/csp-strict-gate.test.js:253-356` whole tree + negative controls | suite green | CLOSED |
| T-13-123 | Info — operator unaware Clear-Site-Data needs TLS | low | mitigate | DEPLOYMENT.md "Caching and sign-out" | text present | CLOSED |
| T-13-130 | Tampering — committed/local DBs during 13-14 evidence runs | high | mitigate | same runner guards as T-13-110 (`phase13-xss.js:113-131`) | control present at `ef1c2b7`; **13-14 not yet executed — re-check its SUMMARY** | CLOSED (control present; evidence pending) |
| T-13-131 | Info — credentials/MNPI in 13-14 evidence | medium | mitigate | same `redact()` as T-13-111 | as above | CLOSED (control present; evidence pending) |
| T-13-132 | Repudiation — budgets/scenarios tuned to pass | high | mitigate | 12-14 rule (scripts/thresholds frozen; failures reported as gaps) | procedural; verifiable only at 13-14 close (`git diff` of `scripts/perf`, `scripts/uat`) | CLOSED (procedural; verify at 13-14 close) |
| T-13-133 | Supply chain — Playwright / axe-core | low | accept | as T-13-113 | AR-13-05 | CLOSED (accepted) |

**Totals:** 70 threats — 63 CLOSED by mitigation, 6 CLOSED (accepted), 1 OPEN (medium, non-blocking).
`threats_open` (OPEN with severity ≥ high) = **0**.

## Open threats

### Open (blocking — severity ≥ high)

None.

### Open (non-blocking — severity below the HIGH threshold)

| Threat ID | Category | Severity | Mitigation expected | Found | Reproduction | Minimal fix |
|-----------|----------|----------|---------------------|-------|--------------|-------------|
| T-13-13 | Repudiation — silent egress change | medium | `egress-settings-changed` security event with actor + before/after on EVERY accepted change (`server.js:3107-3114`) | Present for session-authenticated admins (real/dev). **Absent for the break-glass lane under `DEMO_OPEN=1`:** the `/api` gate resolves `X-Admin-Token` to the `admin-token` identity (`server.js:1098`), then the open-mode branch unconditionally sets `req.portalUser = null` (`:1125-1127`); the route re-admits the token via `isAdminRequest()` (`:3097`), calls `egress.set()` (`:3107` — persisted to runtime.db) and THEN `recordSecurityEvent({ actor: null })`, which throws by design (`db/auditHook.js:292-293`). Result: change applied, response 500 `Internal server error`, no `egress-settings-changed` row (only the gate's `admin-token-use` row names the path, not the values). DEPLOYMENT.md states this path works. | isolated dev child with `DEMO_OPEN=1 ADMIN_TOKEN=…`: `POST /api/admin/egress {"youtube":false}` + `X-Admin-Token` → `500`; `GET /api/admin/egress` effective.youtube `true → false`; `audit_log` rows with action like `%egress%` = `[]`; child stderr `recordSecurityEvent() called with no resolved actor` | In the route: `const actor = req.portalUser || (isAdminRequest(req) ? { username: 'admin-token', role: 'admin', sessionId: null } : null);` and record the event BEFORE (or transactionally with) `egress.set()` so a failed audit never leaves an unaudited change; add an `egress-settings` test row "DEMO_OPEN + X-Admin-Token: 200, one audit row with actor admin-token" (and the same row for `GET /api/admin/csp-violations` which already works). `/gsd-quick`. |

## Review findings — disposition re-check on the final code

| Finding | Fixer claim | Re-verified by this audit | Status |
|---------|-------------|---------------------------|--------|
| CR-A01 slide mount bypass by Windows spellings | FIX-S `77b8ab1`,`de2a03e` | `slideUpload.js:79-92` default dir `<DATA_DIR>/slides` (live: created 0700 under `MA_DATA_DIR`); `requestPath.js:89-102` + `server.js:130-139` first middleware (live: 17 spellings → 404, `/api` ids with `~`/`:` untouched); `mountFileName` allowlist (unit); `(k)` still skipped off-Windows (AR-13-10) | closed (Windows live run outstanding) |
| WR-A01 global 50 MB parsers read anonymous csp-report bodies | FIX-S `c37a6db` | `server.js:332-355` limiter first, parsers skip the canonical path; live: 5 MB `application/json` → 415 in 1 ms, form → 415, 60/min → 429 | closed |
| WR-A02 non-atomic slide write | `88ad4b3` | `slideUpload.js:139-157` `.tmp` + rename, cleanup on error; `:185-206` boot sweep; live: no `.tmp` after a refused upload | closed |
| WR-A03 delete never unlinks | `42497a9` | `slideUpload.js:168-183`, `server.js:3495`; live: record delete removed the file | closed (cross-deal residual AR-13-14) |
| WR-A04 Clear-Site-Data on sessionless logout | `eb735db` | `server.js:1434` `if (token)`; live: form POST without cookie → no header; with cookie → header | closed |
| WR-A05 row ids in migration log | `a0d898b` | `002:163-165`; unit: `pages/#57d66429`, no verbatim id | closed |
| WR-A06 superlinear sanitizer cost | `c666382` | `sanitizeHtml.js:69-111,196-199` depth cap; `validators/cms.js` I18N_MAX_KEYS 20; unit: 200 000 `<b>` → 33 ms escaped, 2.2 MB nest → 46 ms | closed |
| WR-A07 violation store blinding | accepted + hardening `a855834` | `cspReports.js:133-199,212,229-237`; unit + live (non-served page dropped); both signals in walks | accepted (AR-13-07) |
| IN-A01 stale hidden lockfile | `e847215` | untracked, `.gitignore:8` | closed |
| IN-A02 `{}` writes + audits | `09ed007` | `server.js:3101-3104`; live 400, no audit row | closed |
| IN-A03 tests upload into the real dir | `77b8ab1` | `csp-policy.test.js:213-219` temp dir; main checkout `public/uploads/slides` empty after the suite | closed |
| IN-A04 frame-ancestors deviation | docs `92a100c` | PRD addendum present; see AR-13-06 | closed |
| CR-B01 pmo-writable `playbookLink` raw href | FIX-C `8222077` | `validators/index.js` `urlField` on 12 fields (unit matrix); `dashboard.js:459-531` DOM-built; Chromium with legacy rows planted below the API: breakout string → same-origin relative path, `javascript:` → `/playbook.html`, no `<img>`, no `__xss`, 0 violations | closed |
| WR-B01 third sign-out path | `3836f3e` | `account-menu.js:270-297` snapshot → DELETE → clearOnLogout → restore; `server.js:1625-1640` Clear-Site-Data only on `endedCurrent`; live header present | closed |
| WR-B02 render-path gate false passes | `e04fad4` | `client-render-paths` + `safe-html-policy:150` negative controls green | closed |
| WR-B03 overview relay any-origin | `12ff575` | `pages/overview-1.js:14-25` origin + `#deckframe` source + path allowlist; `overview-relay-origin.test.js` | closed |
| WR-B04 stored URLs not scheme-checked | `b9ff87b` | `transitions.js:2797-2803`, `employee.js:1668-1681,2249`; Chromium: planted `javascript:` welcome video → `<video src="#">`, no execution | closed |
| WR-B05 class-based UI redress | accepted | see AR-13-08 | accepted |
| WR-B06 inline-free gate false passes | `6f2c9de` | `csp-inline-free-pages/decks` negative controls; `csp-strict-gate:283,356` | closed |
| IN-B02 bfcache restore on plain http | `2d7d98a` | `transitions.js:1933` | closed (code-level; browser effect not re-run) |
| IN-B04 saved-404 doom assets | `fa9974e` | `git ls-files public/doom` → 0 | closed |
| IN-B05 dev mode inherits demo egress | docs | DEPLOYMENT.md "Dev mode is not offline" present | closed |
| 13-QUICK-media `POST /api/media` stored any extension | `8208d27` | `slideUpload.js:403-482`, `server.js:3742-3789`; live: html/svg/js/`x.png.html`/`x.html.png`/polyglot → 415 fixed body, `public/uploads` not even created; PNG → 200 served `image/png` + nosniff; DELETE unlinks only a regular file directly inside `public/uploads` | closed (docs missing → SC-01; no quota → SC-02) |

## Accepted-risk register (AR-13-nn)

| ID | Threat / decision | Rationale (verified) | Accepted by | Still valid |
|----|-------------------|----------------------|-------------|-------------|
| AR-13-01 | T-13-16 — downloaded font binaries | official Google Fonts woff2 under OFL (texts committed), sha256 recorded in 13-02 SUMMARY and re-computed identical, `wOF2` magic, served static only, never executed | planner 13-02 | yes |
| AR-13-02 | T-13-25 — PDF slides framed without `sandbox` | Chromium cannot render a PDF in a sandboxed document; the file must carry `%PDF-` at upload, is served nosniff with the app CSP, and the viewer runs outside the portal origin; documented in DEPLOYMENT.md | planner 13-03 | yes — same treatment applies to media-library PDFs |
| AR-13-03 | T-13-65 — forged CSP reports | walks run on isolated servers and assert in-page `securitypolicyviolation` as the second signal; WR-A07 hardening drops non-served pages and evicts foreign tuples first | planner 13-07 / FIX-S | yes |
| AR-13-04 | T-13-84 — ~246 not-enumerated `innerHTML` sinks | strict CSP ENFORCED by default (verified live) is the second layer; sinks inventoried by writer role (IN-B01); exhaustive audit deferred by the PRD | planner 13-09 | yes — note the inventory is a point-in-time count |
| AR-13-05 | T-13-113 / T-13-133 — Playwright / axe-core | host-local installs, not in `package.json`/`node_modules`, `scripts/uat` evidence tooling only | planners 13-12, 13-14 | yes |
| AR-13-06 | PD-8 / IN-A04 — `frame-ancestors 'self'` instead of the PRD's literal `'none'` | the app frames its OWN pages (`overview.html` → `#deckframe` `/overview-deck/deck.html`, the playbook PDF/slide viewer, `openHtmlSlide` same-origin iframes); `'none'` would break first-party framing; `'self'` + `X-Frame-Options: SAMEORIGIN` still refuses every foreign framer; PRD addendum recorded | orchestrator (PRD addendum 2026-10-11) | yes |
| AR-13-07 | WR-A07 — the violation list is advisory | unauthenticated by nature; hardening shipped and unit-verified; the enforce flip relied on both signals (walk logs show `inpage=0 endpoint=0`) | orchestrator / FIX-S | yes |
| AR-13-08 | WR-B05 — authored `class` can wear app chrome | CSS scoping measurably changed demo layout (FIX-C computed-style run); `/api/pages|banners|slides|courses|menus|i18n` are admin-only (`server.js:729-736`); residual is admin → viewer in-portal redress — note that under `DEMO_OPEN=1` the author is anonymous (showcase, no MNPI) | orchestrator / FIX-C | yes — documentation owed (SC-01); revisit if any non-admin role gains CMS authoring |
| AR-13-09 | Threaded Transformers path (`importScripts(blob:)`) unverified under enforce | `enf-transformers-import.log` records it as unverified by design; no first-party file sets `numThreads`; single-thread import + wasm compile verified with 0 violations; `CSP_MODE=report-only` rollback documented and verified live | orchestrator | yes |
| AR-13-10 | Windows live test unrun | `slide-upload-safety (k)` skipped off-win32; spellings reproduced with `path.win32` `(i)` and refused over HTTP `(j)`; the structural fix (slides outside `public/`) removes the class; the first middleware was verified live here | orchestrator | yes — run `(k)` on the `windows-latest` release runner before the v3.0 release |
| AR-13-11 | Files already in `public/uploads/` (any extension) remain servable until Phase 14 | the write side is closed for every role in every mode; a legacy `.html`/`.js` there is served same-origin with the app CSP (a `.js` would satisfy `script-src 'self'`); operator audit needed | orchestrator (media quick task) | yes — the operator text is NOT yet in DEPLOYMENT.md (SC-01) |
| AR-13-12 | Legacy stored link values neutralised only at render time | verified in real Chromium with rows planted below the API (CR-B01, WR-B04); the menu editor reports a 400 until an offending legacy row is corrected | orchestrator / FIX-C | yes — text owed to DEPLOYMENT.md (SC-01) |
| AR-13-13 | `POST /api/csp-report` unauthenticated by design | bounded: limiter first, 4 KB for every content type, 100 tuples, 10 000 limiter keys, query strings never stored, reports about non-served pages dropped; passes credential lockdown for exactly the canonical POST | planner 13-07 | yes |
| AR-13-14 | WR-A03 cross-deal residual | a slide file URL pasted into another deal's record is unlinked when the first deal's record is deleted; checking would cross clean-room lines | FIX-S deviation 7 | yes (low; Phase 14 per-deal store removes it) |

Pre-existing residuals continued unchanged and not re-counted here: AR-12-01..06, AR-11-01..11, Phase 12 SC-02 (unbound
real-mode sessions land in the lenient demo copy — the egress and slide probes above ran in that lane).

## New findings (not in either review)

| ID | Sev | Finding | Evidence | Recommendation |
|----|-----|---------|----------|----------------|
| SC-01 | low | **DEPLOYMENT.md still carries the `### Client-side notes` placeholder** (`<!-- Filled by the orchestrator after the client review fixes are merged. -->`). The texts the fixers and the media quick task handed over are absent at `ef1c2b7`: the stored-link rule + "legacy values are neutralised at render" (CR-B01/WR-B04), "ending your current session is a sign-out" (WR-B01), the back/forward-cache reload (IN-B02), the WR-B05 accepted residual, "Media library accepts only images and PDF" and the **upgrade audit of `public/uploads/`** (AR-13-11 depends on an operator reading it). Present: IN-B05, all server-side texts | `grep -c` of each handed-over sentence in DEPLOYMENT.md = 0; placeholder = 1 | land the paragraphs in 13-14 (owns docs) before the phase closes; the `public/uploads/` audit sentence is the one with security weight |
| SC-02 | low | **The media library has no quota.** `POST /api/media` accepts 10 MiB per file with no library bound (`MA_MEDIA_QUOTA_MB` is Phase 14). Admin-only in real/dev mode; **under `DEMO_OPEN=1` the writer is anonymous** (the `/api` gate returns before the role check for open mode, `server.js:1125-1127`) — a showcase host can be disk-filled with valid PNGs from the network | live demo-open: anonymous `POST /api/media` PNG → 200 (file removed by the probe); anonymous slide upload → 200 but quota-bounded and sandboxed | add the library quota now (reuse `libraryBytes()` over `public/uploads`, env `MA_MEDIA_QUOTA_MB`), or document that `DEMO_OPEN` is laptop-only; Phase 14 D-14-04 otherwise |
| SC-03 | info | `GET /api/admin/egress` has no inline `isAdminRequest()` (the POST and `GET /api/admin/csp-violations` do), so under `DEMO_OPEN=1` an anonymous caller reads the egress snapshot (`mode`, `defaults`, `stored`, `effective` — booleans only; `/api/settings` already exposes `effective`) | live demo-open anon GET → 200 | add the inline check for symmetry, or state in DEPLOYMENT that the panel's read is open in demo-open |
| SC-04 | info | The CR-01 non-canonical `/API/…` 404 guard (`server.js:253-262`) answers before the `/api` no-store middleware and carries no `Cache-Control` (fixed body `{"error":"Not found"}`, no data) | live `/API/auth/mode` → 404, `cache-control` null | `res.set('Cache-Control','no-store')` in that guard (one line) |
| SC-05 | info | `POST /api/media` logs `console.error('Media upload failed:', e)` — an `fs` error object carries the full target path including the admin-chosen file name (a deck named after the target); `ENAMETOOLONG` on a 300-char name is the reachable case | `server.js:3769` | log `e.code` only (mirror WR-A05) |
| SC-06 | info | A slide opened TOP-LEVEL (the overlay's "Open in new tab") may navigate its own tab off-portal (`top.location.href = …` succeeds because a document can always navigate itself; the framed slide cannot — SecurityError verified). Opaque origin and no portal data either way; an admin-authored lure of the WR-B04 class | Chromium: top-level slide reached `chrome-error://` after the probe aborted its navigation to the canary; framed: `top: blocked:SecurityError` | none required beyond admin trust; mention in DEPLOYMENT "Slides" |
| SC-07 | info | `POST /api/csp-report/` (trailing slash) is refused 401 by the gate because `PUBLIC_API_PATHS.has(req.path)` matches the exact spelling (`server.js:1080`) while the limiter and the parser-skip use the canonical form; browsers post the exact `report-uri`, and the body is never read on that path — fail-closed asymmetry only | live → 401, no parse | optional: compare the canonical form in the gate too |
| SC-08 | info | `SLIDE_SANDBOX_CSP` replaces the app policy and carries no `frame-ancestors`, so a slide response may be framed by any origin (opaque origin, unauthenticated content — the Phase 14 deferral) | header read | append `frame-ancestors 'self'` to the sandbox policy when Phase 14 adds authentication to slide reads |
| SC-09 | info | The "ZERO violations" oracle has one documented exception under enforce: the vendored Transformers bundle's guarded `new Function("return this")` produces an `eval`-class `script-src` tuple when the AI-model flow runs | `enf-transformers-import.log` `evalClassReports=2`; DEPLOYMENT.md "An expected entry" | none; keep the walks' allow-list to exactly that tuple |

## Live and browser re-verification results (isolated instances)

| Area | Result |
|------|--------|
| Real-mode headers | `/` and `/dashboard.html`: one `Content-Security-Policy` equal to the documented real default (no `http`/`https` token, `frame-ancestors 'self'`, `script-src 'self' 'wasm-unsafe-eval'`), no Report-Only header, `X-Frame-Options: SAMEORIGIN`, nosniff; HTML `Cache-Control: no-cache` |
| SAFE-07 (a) | `/api` 200 / 401 / 403 / 404 / 400 (malformed JSON) / 404 (Windows alias) → `Cache-Control: no-store`; `/API/` 404 lacks it (SC-04) |
| Egress real defaults | snapshot all `false`; `/api/ai/insight` → marker; `/api/rag/upload` → 404 for admin/anon and every spelling; hrbp GET/POST 403; `{}` / `{youtube:'yes'}` / `{foo:true}` → 400; admin youtube on → next header gains YouTube in `frame-src`/`img-src`/`media-src` only; huggingface on → `connect-src`/`img-src`; second process sees both without restart and its switch-off is seen by the first on the next request; 2 hashed `audit_log` rows (actor `admin`, before/after JSON, `prev_hash`/`row_hash`) |
| CSP report channel | anonymous report → 204; list: anon 401, hrbp 403, admin 200 with `documentPath` `/dashboard.html`, `blockedUri` `https://evil.example/track` (query + fragment gone, no SECRET); report about a non-served page dropped; 5 MB `application/json` → 415 in 1 ms; form → 415; 10 KB report → 413; malformed → 400; 429 + `Retry-After: 60` + no-store inside the window; store ≤ 100 |
| Slides | admin `.html` upload → `/uploads/slides/<ms>_<hex>_My_Deck.html`; GET/HEAD carry the exact sandbox CSP + nosniff + `private, no-cache`, no Report-Only, no Set-Cookie; file under `<MA_DATA_DIR>/slides` (0700), nothing under `public/`; 17 alias/non-canonical spellings → 404, `?query` form serves sandboxed; `.svg`/`.exe`/polyglots/type mismatch/no extension → 415 fixed body (name never echoed), > 10 MB → 413; 1 MB quota: second 600 KB → 413, nothing written, no `.tmp`; record delete removes the file; hrbp 403 / anon 401 |
| Media | html/svg/js/`x.png.html`/`x.html.png`/png-with-html → 415 `media-type-refused` with `public/uploads` never created; PNG → 200, served `image/png` + nosniff; DELETE unlinks; hrbp 403 |
| Sanitizer via the real route | `POST /api/pages` with the four R1-03 payloads → stored `<img src="x" /><a rel="noopener noreferrer">l</a>ipt&gt;alert(1)` |
| Sign-out | sessionless form POST → 200 without Clear-Site-Data; cookie POST → `Clear-Site-Data: "cache", "storage"`, cookie cleared, `/api/auth/me` → `user: null`; `DELETE /api/auth/sessions/<own>` → Clear-Site-Data + `endedCurrent: true` |
| Demo-open lane | anon `POST /api/admin/egress` → 403 (switch unchanged); anon `GET /api/admin/csp-violations` → 403, token → 200; wrong token → 403; **token POST → 500 with the change applied and no audit row (T-13-13)**; anon slide upload → 200 and still served sandboxed; anon active-content media → 415; anon PNG media → 200 (SC-02); `/api/settings.egress` booleans only; dev/demo CSP = the all-on showcase policy |
| Modes | `CSP_MODE=report-only` → legacy (`'unsafe-inline' 'unsafe-eval'`) enforced + strict Report-Only; `CSP_MODE=disabled` → strict enforced, no Report-Only |
| Chromium — CR-B01 legacy rows | two modules planted below the API (`x" ><img src=x onerror=…><a href="` and `javascript:window.__xss=2`, scores 0–5): both rendered as text cards, 0 `<img>`, hrefs `http://<host>/x%22%20%3E%3Cimg…` (relative path) and `/playbook.html`, `window.__xss` undefined, 0 dialogs, 0 `securitypolicyviolation` |
| Chromium — slide sandbox | framed: `self.origin` `null`, `document.cookie`/`localStorage`/`parent.document` → SecurityError, `fetch('/api/auth/me')` and canary fetch → TypeError, canary `img` request failed in-browser, `sendBeacon` queued but never delivered (0 canary hits), `top.location` → SecurityError, iframe `sandbox="allow-scripts"`, dashboard URL unchanged; top-level: `self.origin` `null`, cookie SecurityError, 0 canary hits (self-navigation attempted — SC-06) |
| Chromium — composition | `<script src="/uploads/slides/<name>.html">` from the dashboard → `error` (nosniff on `text/html`); planted `welcomeVideoUrl_en: javascript:…` → `<video src="#">`, no execution, 0 violations; `clearOnLogout()` left only `employeeLanguage=de`, emptied sessionStorage and Cache Storage, revoked the session; 0 page errors |

## Composition-seam results

| Seam | Finding |
|------|---------|
| Canonical-path gate (10) × Windows-alias first middleware × slide mount | The alias guard runs before every other middleware and judges `:`/`~` on the RAW `/api` prefix only (a `/API/x:y` spelling is refused by it before the CR-01 guard — stricter, harmless); `/api/deals/x~y` passes to the gate (401). The slide mount is exact-case (`case sensitive routing`), every other spelling of the prefix is answered 404 by the guard before it, and the terminal `.html` middleware passes the prefix. No spelling reached a slide file or `sendHtml()`; the files are outside `public/` anyway. |
| Credential lockdown (10) allowlist growth | `+/js/client-storage.js`, 4 font files, and exactly `POST /api/csp-report` canonical (`lib/credentialLockdown.js:37-44,134-138`); `change-password.js` (allowlisted) calls `clearOnLogout`; `credential-lockdown` and `lockdown-asset-allowlist` green. |
| Read policy / clearance (11) for slides and media | `/api/slides` and `/api/media` metadata are `ALL_ROLES` reads (`lib/readPolicy.js:94,101`); slide/media FILE reads are unauthenticated (D-13-04(c) deferral, DEPLOYMENT states it). Stored `slide.url` has no server scheme rule (admin-only writer; `openHtmlSlide` refuses non-http(s); list uses textContent) — info. |
| Audit-inside-transaction (8/12) × egress control-plane writes | `egress.set()` writes `runtime.db` and `recordSecurityEvent()` appends to the `audit.db` control chain as two separate statements, not one transaction; a failure between them leaves an unaudited change — exactly what the demo-open break-glass lane exhibits (T-13-13). Real-mode admins: 1:1 verified. |
| Sealed/partitioned deal DBs (12) × migration `deal/002` | The migration runs in the runner's BEGIN IMMEDIATE on the deal FILE (not the 0400 audit partition), writes no audit rows (documented system repair), and the boot sweep covers archived deals too; a deal file at user_version 2 is skipped. Consistent with Phase 12 contracts. |
| Per-request egress freshness in multi-process | `PRAGMA data_version` + generation (`lib/egress.js:56-69`); two real-mode processes on one data dir converged in both directions on the next request. |
| DEMO_OPEN lane | Does not widen any Phase 13 content control: strict CSP enforced (showcase origins only), sanitizer and renderer apply, slide sandbox/type/quota apply to anonymous uploads, media allowlist applies, no-store applies; the instance-level switch and the violations list refuse anonymous callers (403). Gaps: the break-glass audit defect (T-13-13), the read of the egress snapshot (SC-03), and the unbounded media library (SC-02). |
| Stored/uploaded content → script execution under the ENFORCED strict CSP | No remaining path found: uploads cannot store `.js`/`.html`/`.svg` in `public/` (media allowlist + magic); slides live outside `public/`, are served `text/html` + nosniff + sandbox CSP (a `<script src=slide>` from a page fails — verified); `sent_emails/*.html` bodies are `escEmail()`-escaped (`server.js:9278-9290`) and inline script there would be blocked anyway; `javascript:`/`data:` are refused by the sanitizer, `urlField` and `MASafeHtml.safeHref`; no `srcdoc`, `eval`, `new Function`, string timers or `document.write` in first-party JS; one `postMessage` listener, origin + source bound; no service worker. Legacy files already in `public/uploads/` are the single accepted exception (AR-13-11). |
| Egress to YouTube / Hugging Face / Gemini / Google Fonts in real mode | Header: none (verified); runtime: `enf-walk-real.log` "no third-party request was even attempted" + canary zero; code: every YouTube/HF surface behind an explicit `=== true` gate, Gemini refused at the route and in `aiService`, fonts local. Dev/demo mode egresses by design (documented). |
| Cache/logout residue on a shared workstation | all three sign-out paths clear client state and carry `Clear-Site-Data` only for a genuine session; `/api` `no-store` on every status; HTML `no-cache` + `pageshow` reload for bfcache on plain http (code-level). |
| DoS bounds on new unauthenticated surfaces | `/api/csp-report`: limiter first, 4 KB for every type, bounded store and limiter table — verified live; slide mount: regex allowlist + static 404, no decode; sanitizer: depth cap 2000 + `HTML_MAX` 20 000 + i18n keys ≤ 20 (unit-timed). Unchanged: the app-wide 50 MB JSON parser for authenticated writes (Phase 14). |
| Log / audit hygiene | migration logs digests only; slide move logs counts; `[security] CSP_MODE=` fixed; CSP tuples hold page paths and origin+path only; egress events hold booleans + actor; residual SC-05 (media `fs` error object). |

## Residual risks to carry into Phase 14 / Phase 23

1. **T-13-13 (demo-open + break-glass egress change unaudited, 500 with the change applied)** — two-line fix + test row; re-check in Phase 23.
2. **SC-01 documentation debt** — the `public/uploads/` upgrade audit and the stored-link rule are operator-facing controls that exist only in planning artifacts until 13-14 lands them.
3. **AR-13-11** — legacy active content under `public/uploads/` (any role, any mode) is served same-origin until Phase 14's static guard; a legacy `.js` there satisfies `script-src 'self'`.
4. **SC-02** — unbounded media library (anonymous under `DEMO_OPEN`); Phase 14 `MA_MEDIA_QUOTA_MB`.
5. **AR-13-10** — the Windows live row `(k)` must run on the `windows-latest` release runner before the v3.0 release (release-per-milestone policy).
6. **AR-13-09** — threaded Transformers path unverified; rollback is `CSP_MODE=report-only`.
7. **AR-13-08 / AR-13-12** — admin-authored redress and off-portal lures remain possible by design; `DEMO_OPEN` makes the author anonymous.
8. Slide reads unauthenticated (D-13-04(c)); `SLIDE_SANDBOX_CSP` without `frame-ancestors` (SC-08) — both Phase 14.
9. Phase 12 SC-02 (unbound real-mode sessions in the lenient demo copy) is the lane the real-mode content writes of this audit landed in; Phase 17.

## What this audit could not verify

- Windows host behaviour: `slide-upload-safety (k)` is skipped on this darwin host; the alias spellings were verified with `path.win32` (test `(i)`) and refused over HTTP here, not on Windows.
- The threaded Transformers runtime (`importScripts(blob:)` inside a blob worker) under the enforced policy — recorded unverified by 13-12 as well.
- Plan 13-14's own evidence (scenarios, perf budgets after the per-request egress read, volume-deal migration timing) — the plan is in flight; its four threats are verified against the shared runner code and the 12-14 rule only.
- The full 13-12 Playwright walks were not re-executed; `evidence/ro-*.log` / `enf-*.log` were read and a bounded real-Chromium probe (CR-B01 legacy rows, slide sandbox framed and top-level, nosniff script load, planted video URL, logout clearing) was run instead.
- Browser-side effects of `Clear-Site-Data` and the `pageshow` reload on a plain-http LAN host (header presence and code verified; the 13-12 caching scenario ran on loopback).
- Release ages of the 16 transitive packages (taken from the 13-01 table; versions, scripts and native content were re-checked against the installed tree; only `sanitize-html` itself was re-queried at the registry).

No implementation file was modified by this audit. The only file written is this document; probe scripts and the TAP log
live in the session scratchpad and every temp data directory, child process and the exported tree copy were removed.
