# Phase 13 — Content Safety — PRD / locked decisions (orchestrator, 2026-10-10)

Input for `/gsd-plan-phase 13 --prd` (research/UI-spec skipped by design, as Phases 10–12). Requirements: SAFE-01, SAFE-02,
SAFE-03, SAFE-06, SAFE-07. Depends on Phase 11 (AUTHZ-02 shrinks who can author; settings are admin-only) and Phase 12
(migrations, smoke harness). Evidence: R1-03, R1-04, R1-14, R1-16, R5-07, R5-15, R2-16, PLAN-REVIEW PR-24 (SAFE-02 is
feasible and small), `.planning/reviews/v3.0/R1-security.md`, `R5-quality.md`. Demo mode stays intact: every restriction
below is either mode-neutral hardening or applies to real-deal mode only (`MA_MODE=real`).

## Problem (measured by the review)
`lib/sanitizeHtml.js` is a 58-line regex pass that four payloads bypass (`<img src="x"onerror=…>`, `jav&#x61;script:`,
`java\tscript:`, reconstructed `<scr<script>ipt>`); the render-time client `sanitize()` (`public/js/page-layout.js:17`) is the
same regex family, and CSP carries `script-src 'unsafe-inline' 'unsafe-eval'` (+ YouTube), so stored markup executes — a `pmo`
planting a page/banner runs JavaScript in the admin's session. HTML slide upload is raw bytes served same-origin, framed
without `sandbox`. Gemini / Hugging Face / YouTube / Google Fonts egress is built into the pages and CSP with no switch.
`/api/*` has no blanket `no-store`; `transitions.js` wipes every Cache Storage entry on each page load (killing the AI model
cache); `sw.js`/`manifest.json` are unlinked leftovers. 346 `innerHTML` assignments exist client-side — the class is bounded by
(a) the enumerated render paths below, (b) a CSP that blocks execution even if a sink is missed.

## Locked decisions
**D-13-01 Server sanitizer (SAFE-01).** Replace the regex body of `lib/sanitizeHtml.js` with a real allowlist parser that
re-serializes: vendor `sanitize-html` (exact-pinned, release ≥ 2 weeks old per the supply-chain rule, pure JS, committed in
`node_modules` with its transitive deps; no native code) wrapped by the SAME export `{ sanitizeHtml }` so
`validators/index.js htmlField()` and every call site stay unchanged. Allowlist: block/inline text formatting, headings,
lists, tables, `a` (`http`/`https`/`mailto`/`tel`/relative only; `rel="noopener noreferrer"` forced), `img` (`http`/`https`/
relative or `data:image/(png|jpeg|gif|webp)`, never svg), `class`, and a CSS-property allowlist for `style` (colour, spacing,
alignment, font weight/size — no `url()`, no `expression`, no `position:fixed`). Never allowed: `script`, `style`-element,
`iframe`, `object`, `embed`, `svg`, `math`, `base`, `meta`, `link`, `form`, `input`, `button`, `template`, `noscript`, any
`on*` attribute, `srcdoc`, `formaction`. Idempotent: `sanitize(sanitize(x)) === sanitize(x)`. A non-string yields `''`.
Stored legacy content is re-sanitized once by an ordered, idempotent Phase-12 migration over every `htmlField`-wrapped
collection (pages, banners, slides metadata, course lessons — planner enumerates); unchanged values are NOT rewritten (no
no-op audit rows, versions untouched unless the value changed).
**D-13-02 Client render path (SAFE-01).** One module `public/js/safe-html.js` (IIFE, `window.MASafeHtml`) exposes
`render(el, html)` / `toFragment(html)`: parse with `DOMParser` into an inert document, walk it, and BUILD the output with
`createElement`/`setAttribute` from the same tag/attribute/URL-scheme allowlist — never serialize-then-`innerHTML` (no
mutation-XSS round-trip). Every enumerated render path routes through it: CMS pages (`page-layout.js` ~17/32/104),
banners, HTML-slide labels/overlays, chatbot messages, inline click-to-edit display. A static-scan test fails if a file
assigns CMS/user-sourced data to `innerHTML`/`insertAdjacentHTML`/`outerHTML` on those paths outside `MASafeHtml`
(the other ~300 sinks are bounded by D-13-03 and listed as "not enumerated" in the SUMMARY, not silently ignored).
**D-13-03 CSP (SAFE-02).** App pages are served under `script-src 'self' 'wasm-unsafe-eval'` ONLY — no `unsafe-inline`, no
`unsafe-eval`, no nonces — in BOTH modes. Externalise the measured inline code (≈8 inline `<script>` blocks: dashboard ×2,
index, insights, login, overview, playbook, signage; 3 inline `on*=` in admin/dashboard HTML; 2 generated handlers and 3
`javascript:void(0)` hrefs in `transitions.js`) into `public/js/*.js` with `addEventListener`/`data-*` delegation; behaviour
identical. `worker-src 'self' blob:` and `'wasm-unsafe-eval'` stay (Transformers.js). Keep `object-src 'none'`,
`base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`; `style-src` is NOT tightened here. Rollout: ship FIRST as
`Content-Security-Policy-Report-Only` with `report-uri /api/csp-report` (accepts `application/csp-report` and
`application/reports+json`; unauthenticated but body ≤ 4 KB, per-IP rate-limited, keeps only the last 100 DISTINCT
(directive, blocked-uri, source-file) tuples in memory; `GET /api/admin/csp-violations` is admin-only and is what the walks
assert on). Flip to enforcing only after the demo walk and the IL walk report ZERO violations; the final state enforces;
`CSP_MODE=report-only` env remains as a documented rollback (DEPLOYMENT.md).
**D-13-04 Slides & uploads (SAFE-03).** (a) `POST /api/slides/upload` accepts only an allowlist (HTML, PDF, PNG, JPEG, WebP;
SVG refused) by extension AND declared type, with per-file ≤ 10 MB and per-instance slide-library quota (default 100 MB,
env/admin-setting) — over-quota or other type ⇒ 4xx with a fixed body, nothing written. (b) HTML slides are served with
`Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src data: blob:; font-src data:; media-src data:; connect-src 'none'; form-action 'none'` and `X-Content-Type-Options:
nosniff` (opaque origin, no network, no portal cookies), and `openHtmlSlide()` frames them with `sandbox="allow-scripts"`
(NO `allow-same-origin`, no top-navigation, no forms, no popups). (c) Do NOT build the authenticated deal-file store here —
that is Phase 14 (SAFE-04); this phase only hardens the existing `/uploads/slides/*` mount and the iframe.
**D-13-05 Egress switch (SAFE-06).** An admin-only instance setting `egress` `{ gemini, huggingface, youtube }` (all `false`
by default in real-deal mode; `true` in demo mode so the showcase is unchanged) with an "External services" panel in the
admin console (EN with new i18n keys + English fallback; warns that enabling sends portal data to a third party). Effects:
(1) the CSP is built from the setting — real mode with defaults carries NO third-party origin in `connect-src`/`frame-src`/
`script-src`; (2) `/api/ai/insight`, Gemini RAG paths refuse with a marker body `{ egressDisabled: 'gemini' }` (client
shows an "switched off by your administrator" state and never auto-retries); (3) the browser model download from Hugging
Face is not attempted when `huggingface` is off — the chatbot falls back to its non-AI path; (4) Google Fonts are VENDORED
(`public/vendor/fonts/*.woff2` + local `@font-face`; both modes; no CDN reference remains, consistent with the Transformers.js
vendoring rule); (5) the dead AI-training upload path (`/api/rag/upload` and its client UI, R5-07) is not mounted outside
demo mode (404). Settings changes take effect on the next request without restart.
**D-13-06 Caching (SAFE-07).** (a) A middleware on the `/api` prefix sets `Cache-Control: no-store` on EVERY response
including errors (existing explicit headers stay); (b) the logout response carries `Clear-Site-Data: "cache", "storage"`
and the client logout path additionally clears `sessionStorage` and the app's `localStorage` keys, preserving only the
language preference keys (enumerated in code, documented); (c) delete the unconditional wipe at `transitions.js` ~1738–1750;
keep ONE guarded legacy clean-up (runs once per browser, flag in `localStorage`, deletes only legacy service-worker
registrations and legacy cache names — never the Transformers model cache); `sw.js` becomes a self-unregistering stub that
deletes only legacy cache names; remove the unlinked `manifest.json` if nothing references it (grep-proven).
**D-13-07 Proof tooling.** `scripts/uat/phase13-xss.js` (Playwright via the pattern of `scripts/uat/phase10-walk.js`): a
`pmo` stores the payload corpus through the real routes (page, banner, slide label, chatbot-visible content), an `admin`
opens every render path, and the script asserts no payload executed (`window.__xss` never set, no dialog, no request to the
canary origin) and the violation endpoint is empty in report-only AND enforcing mode; plus a network-egress capture across
the IL walk in real mode proving zero non-self requests with defaults. The fuzz corpus (≥ 200 vectors: attribute-separator
tricks, entity/numeric-encoded schemes, tab/newline-split schemes, nested reconstruction, SVG/MathML namespace confusion,
`<template>`/`<noscript>` mXSS, `srcdoc`, `formaction`, CSS `url()`/`expression`, unicode normalisation) lives in
`test/fixtures/xss-corpus.json` and runs in `node --test` against the server sanitizer.

## Out of scope
Authenticated per-deal file store and legacy static mounts (Phase 14), per-route body limits (14), module switch (15/16),
exhaustive audit of all ~346 `innerHTML` sites (bounded by D-13-02/D-13-03), tightening `style-src`, i18n/a11y fixes (19),
real-deal translation of the new admin panel beyond EN + fallback keys (19).

## Acceptance
1. The four R1-03 payloads and the ≥ 200-vector corpus come out inert (no executable construct after parse), idempotent, with
   legitimate content (a golden corpus of the demo's pages/banners) preserved byte-for-byte or visually identical.
2. Real browser (Chromium via the smoke harness): payload stored by `pmo` does not execute in the admin session on any
   enumerated path; ZERO CSP violations across the demo walk and the IL walk in report-only, then enforcing; both modes.
3. Uploaded HTML slide with `fetch('/api/auth/me')`, `document.cookie`, `parent.document` and an outbound beacon all fail;
   `.svg`/`.exe`/over-quota uploads are refused with a fixed 4xx body and write nothing.
4. Real-mode defaults: CSP header lists no third-party origin; a full IL walk produces zero non-self requests; toggling an
   egress switch changes behaviour on the next request; demo mode is unchanged (walk still passes); no CDN reference remains
   for fonts.
5. `/api/*` responses (incl. 401/403/404/409/500) are `no-store`; after logout `caches.keys()` is empty and storage cleared
   except language keys; the AI model cache survives ten consecutive page loads.
6. Suite green and unchanged for Phase 9/10/11 contracts; `npm run soak` unchanged; demo showcase unchanged.
