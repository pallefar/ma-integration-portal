---
status: superseded
phase: 13-content-safety
checked: 2026-10-11
plans: 14
verdict: ISSUES FOUND
blockers: 1
warnings: 5
info: 5
---

# Phase 13 plan check — ISSUES FOUND (1 blocker, 5 warnings, 5 info)

Scope: 13-01..13-14 PLAN.md against PHASE-13-PRD (D-13-01..07, acceptance 1-6), ROADMAP SC1-5, SAFE-01/02/03/06/07 and
the Phase 8-12 contracts. Verified against the live tree (server.js, public/**, vendor bundle, validators, db/migrate.js,
tests). The set is strong: coverage is complete, the waves are correct, and the CSP inventory matches grep. One defect
would make acceptance 3 fail in the default configuration while every test passes. It needs a plan amendment before execution.

## BLOCKER

### B-1 [SAFE-03 / D-13-04b] 13-03 — slide mount lands AFTER the terminal `.html` middleware, so default-config slides never get the sandbox CSP
Evidence:
- server.js ~358-372 `app.use((req,res,next)=>{ … htmlRequestVerdict … return sendHtml(res, abs); })` is TERMINAL for
  every canonical `*.html` path that resolves to a file under `public/` (comment: "TERMINAL for every request whose path
  is, or normalises to, an `.html` path"). It is mounted BEFORE `express.static` (~402).
- 13-03 anchors place the new mount "immediately BEFORE `app.use(express.static(path.join(__dirname, 'public')`". That is after
  the terminal middleware. In the default configuration (`MA_SLIDES_UPLOAD_DIR` unset → `public/uploads/slides`) every
  `/uploads/slides/*.html` is answered by `sendHtml()` with the global app CSP, no `sandbox`, and no `nosniff` override.
  This includes every slide already uploaded.
- 13-03's tests and 13-12 `slideSandbox` set `MA_SLIDES_UPLOAD_DIR=<temp>` outside `public/`. `statSync` then fails and the
  request falls through to the new mount. The suite is green while production is unsandboxed (false pass).

Impact: acceptance 3 and SC3 are not met in the shipped configuration. The uploaded-slide origin-isolation risk (R1-04)
remains open.

Amendment (13-03 Task 1 action, paste-ready):
> Mount the `/uploads/slides` static handler (PD-18) BEFORE the terminal HTML middleware (the `htmlRequestVerdict` block
> at ~358), immediately after the credential-lockdown gate it already follows — not "before express.static". Also
> change that terminal middleware to `return next()` when `req.path` starts with `/uploads/slides/`, so the dedicated mount
> is the only responder (and `sendHtml`'s `rewriteHtml` never touches slide bytes). Add to test/slide-upload-safety.test.js
> a DEFAULT-DIRECTORY case: boot with `MA_SLIDES_UPLOAD_DIR` unset (or set to a directory INSIDE `public/uploads/`),
> upload, GET, and assert `content-security-policy === SLIDE_SANDBOX_CSP`. Remove the written file in `finally`. Add the
> same default-directory (inside-`public/`) variant to 13-12 `slide-sandbox.js`.

## WARNINGS

### W-1 [SAFE-02] 13-12 PD-44 / 13-13 — vendored Transformers.js is only import-tested under the strict policy
Evidence: `public/vendor/transformers/transformers.min.js` contains `new Function("return this")` ×2 (try/catch-guarded,
benign), `eval("quire".replace…)` ×1 (try/catch-guarded), and `importScripts(<blob:>)` ×4 in the threaded-wasm worker path.
`worker-src blob:` is kept, but a blob worker inherits the creator's `script-src 'self'`, so `importScripts(blob:)` is
blocked. The app never sets `numThreads`, so ORT runs single-thread unless the page is cross-origin-isolated. The plan
asserts only that the import resolves "WITHOUT downloading a model", and enforce walks never run inference.
Amendment (13-12 Task 2, transformersImport scenario, add): under `--csp-mode enforce`, also
`WebAssembly.compile` the vendored `/vendor/transformers/ort-wasm-simd.wasm` and assert no `securitypolicyviolation`
(proves `'wasm-unsafe-eval'` is sufficient with no network). Record explicitly in 13-VALIDATION open items that
multi-thread (`importScripts(blob:)`) inference is unverified, and that DEPLOYMENT.md gives `CSP_MODE=report-only` as the
rollback if the AI-model flow regresses.

### W-2 [PRD D-13-03 literal] 13-02 PD-8 — `frame-ancestors 'self'` vs the PRD text "keep … `frame-ancestors 'none'`"
Evidence: server.js:197 ships `frame-ancestors 'self'`; the portal frames its own decks and PDFs, so `'none'` would break
the demo. The planner's reading ("keep = never loosen") is correct, but it is a literal deviation from a LOCKED decision.
Amendment: add one row in 13-VALIDATION D-13-03 recording "PRD text misquotes shipped `'self'`; `'self'` retained
deliberately (decks/PDF framing)", and surface it to the user at phase close. No code change.

### W-3 [scope] 13-06 (22 files), 13-10 (17), 13-11 (15)
13-06 lists 22 files, 13-10 lists 17 and 13-11 lists 15, which is at or above the 15-file blocker threshold. Each plan has
only 2 tasks and the edits are mechanical (18 identical one-line `<script>` inserts; verbatim block moves). Execution risk
is acceptable. Accept as WARNING, not a blocker. Keep the per-page commit option in 13-10 Task 2 and 13-06 Task 2.

### W-4 [SAFE-01] 13-05 — committed `data/demo.db` regeneration: contract note and test coupling
Evidence: db/migrate.js rule 5 plus "COMMITTED files are NEVER written by the runner" — regeneration by script in its own
commit is the sanctioned path, and 13-05 follows it (checkpoint TRUNCATE, `-wal` empty, control.db untouched). Residual
risks the plan only half-covers:
- (a) `test/healthz-readiness.test.js:127` pins `versions.deal.version === 1`; the grep in "Existing test files" will
  catch it, but name it explicitly in `files_modified`.
- (b) Phase 23 CERT-02/03 byte-identity baselines will be computed from the regenerated file; note that in the SUMMARY.
- (c) Any release-build script that copies `data/demo.db` is unaffected, but state it.
Amendment: add `test/healthz-readiness.test.js` to 13-05 `files_modified` and to the "Existing test files" list.

### W-5 [SAFE-07] 13-04 — logout ordering relies on snapshot-before-POST
`Clear-Site-Data: "storage"` on a secure context wipes `employeeLanguage` as part of the logout response. PD-19 snapshots
the language keys first and restores after, which is correct. The vm test must assert the snapshot happens BEFORE the
fetch (the stub should clear localStorage inside the stubbed `fetch`). Amendment (13-04 Task 1 behaviour, add): "a stub
`fetch` that empties localStorage on call still leaves `employeeLanguage` restored".

### W-6 [SAFE-06] 13-02 Task 1 — real-mode "no `https:` token" assertion scope
The assertion is made on the page CSP. Add the same assertion for the Report-Only/strict header once 13-07 lands
(13-07 `csp-policy.test.js` real-defaults child already builds both; ensure it asserts both headers). Amendment: one
line in 13-07 Task 2 behaviour: "MA_MODE=real defaults: neither `Content-Security-Policy` nor `-Report-Only` contains `https:`".

## INFO

- I-1 CSP feasibility CONFIRMED against grep. Inline `<script>` blocks: index, playbook, signage, overview, insights,
  dashboard ×2, plus decks deck ×2, slide5, slide6, agenda, easter-egg, working-in-a-matrix (matches plans 13-10/13-11
  exactly). Inline `on*=`: admin.html ×2, dashboard.html ×1. Generated handlers: transitions.js:2248 (quick-nav hover) and
  :4486 (survey modal close). `javascript:` URLs: dashboard.html ×8, transitions.js :1399/:2153/:2164/:2783. No `eval`,
  `new Function`, `srcdoc`, string timers, or `document.write` in first-party JS. Other `createElement('script')` uses
  load `'self'` files. `public/slides/welcome-slide.html` and `sent_emails/*.html` have no inline code (covered by 13-13
  whole-tree gate).
- I-2 Waves and `depends_on` are consistent: 13-05/08 are wave 2 (deps wave 1), 13-09/10/11 wave 3 (max dep wave 2), 13-12
  wave 4, 13-13 wave 5, 13-14 wave 6. No cycles.
- I-3 Gemini coverage complete: only three fetch sites exist (aiService.js :56/:356/:506), matching server.js :2603,
  :3754, :3861; `/api/assessment` degrades to the local plan.
- I-4 `/api/csp-report` as `PUBLIC_API_PATHS` member returns from the gate before the role-write check (server.js :917),
  so the unauthenticated path works. The asset stamper (`STAMPED_REF_RE`) supports sub-directories, so `/js/pages/*` and
  `/js/overview-deck/*` with `?v=1` are content-hash-stamped at serve time (`sendHtml` covers nested `.html`).
- I-5 Sandboxed first-party decks (via `openHtmlSlide`, opaque origin): plan asserts no storage / parent-DOM use by grep.
  Opaque-origin frames cannot load cross-origin `@font-face` without CORS. The decks reference no `@font-face`, so no
  visible change is expected. 13-12 PD-31 already opens deck slides; make it assert one non-blank render in the sandboxed
  frame.

## Coverage

| Requirement | Plans | Verdict |
|---|---|---|
| SAFE-01 | 13-01, 13-05, 13-06, 13-09, 13-11 (addSlide), 13-12, 13-13, 13-14 | Covered |
| SAFE-02 | 13-02 (builder), 13-07, 13-10, 13-11, 13-12, 13-13, 13-14 | Covered |
| SAFE-03 | 13-03, 13-12 | Covered, subject to B-1 |
| SAFE-06 | 13-02, 13-08, 13-12 | Covered |
| SAFE-07 | 13-04, 13-12 | Covered |

| SC / acceptance | Plans | Verdict |
|---|---|---|
| SC1 / A1 (payloads + corpus inert, pmo/admin real browser) | 13-01, 13-06, 13-09, 13-12 | Met (pmo → second admin per PD-7 since Phase 11 made content admin-only; 403 asserted) |
| SC2 / A2 (strict CSP, report-only → enforce, zero violations) | 13-07, 13-10, 13-11, 13-12, 13-13 | Met |
| SC3 / A3 (slide sandbox, type/quota) | 13-03, 13-12 | NOT met in default config until B-1 is fixed |
| SC4 / A4 (egress defaults, fonts vendored, RAG upload gone) | 13-02, 13-08, 13-12 | Met |
| SC5 / A5 (no-store, logout clearing, no wipe, model cache survives) | 13-04, 13-12 | Met |
| A6 (Phase 9/10/11/12 unchanged, soak, demo) | 13-14 | Met (budgets never loosened, PD-24 / 12-14 rule) |

## Locked decisions
D-13-01 13-01/05; D-13-02 13-06/09/11; D-13-03 13-02/07/10/11/12/13 (note W-2); D-13-04 13-03 (B-1); D-13-05 13-02/08;
D-13-06 13-04; D-13-07 13-01 corpus + 13-12. No deferred ideas included (Phase 14 file store explicitly excluded in 13-03).
No scope-reduction language found: "v1" appears only as the `ma.legacyCleanup.v1` flag name and `?v=1` stamp placeholder.

## Region disjointness (same-wave plans)

| Wave | File | Plans | Regions | Verdict |
|---|---|---|---|---|
| 1 | server.js | 13-02, 13-03, 13-04 | 02: headers ~186-226, pre-/api-gate, settings, rag/insight/assessment; 03: slides handler + mount; 04: pre-`express.json` middleware + logout | Disjoint, but 03's mount position is wrong (B-1) |
| 1 | transitions.js | 13-03, 13-04 | 03: `openHtmlSlide` ~1178; 04: loader/logout ~1386-1406 and wipe ~1858 | Disjoint |
| 1 | lib/csp.js | 13-02 only | | OK |
| 2 | server.js | 13-07 only | | OK |
| 2 | transitions.js / employee.js | 13-08 only (13-06 does not touch) | | OK |
| 2 | public/*.html | 13-06 only | | OK |
| 3 | transitions.js | 13-09, 13-11 | 09: `addMessageBubble` + `[data-i18n-html]`; 11: sidebar templates, quick-nav, `addSlide`, survey modal | Disjoint (≥ 1500 lines apart) |
| 3 | HTML | 13-10 (7 pages) vs 13-11 (decks) | | Disjoint |

## Other dimensions
Task completeness: all tasks have files/action/verify/done. `<verify>` commands are worktree-root relative and background
long runs. Verification derivation: truths are observable. Key links are wired (headersFor ↔ server loop; MASafeHtml ↔
18 pages; clearOnLogout ↔ both logout paths). Nyquist: automated verify present on every task. CLAUDE.md: stack
unchanged (vanilla JS, no build step); `node_modules` committed by scratch-prefix copy, never `npm install` in-repo. Supply
chain: dates/versions in 13-01 were not re-verified offline (executor re-verifies; none of the 16 packages exists in
`node_modules` today, so no version collision).
