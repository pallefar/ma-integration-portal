# Phase 13: Content Safety - Context

**Gathered:** 2026-10-10
**Status:** Ready for planning
**Source:** PRD Express Path (.planning/reviews/v3.0/PHASE-13-PRD.md)

<domain>
## Phase Boundary
User-authored content can no longer run code in another user's session: a real allowlist HTML parser server-side and a
DOM-building (never re-serializing) renderer client-side on the enumerated render paths; `script-src 'self'
'wasm-unsafe-eval'` only after a report-only rollout; sandboxed, type- and quota-limited slide uploads; an admin egress
switch with vendored fonts and no third-party origin by default in real-deal mode; `no-store` on `/api` and honest
client-cache handling. Requirements SAFE-01, SAFE-02, SAFE-03, SAFE-06, SAFE-07.
</domain>

<decisions>
## Implementation Decisions
LOCKED D-13-01..07 (full wording, allowlists, limits and acceptance in PHASE-13-PRD.md): vendored `sanitize-html` behind the
unchanged `sanitizeHtml` export + idempotent legacy re-sanitize migration; `public/js/safe-html.js` DOMParser/createElement
renderer on every enumerated path + static-scan gate; inline code externalised, CSP report-only → zero violations →
enforcing, `/api/csp-report` + admin-only violations list, `CSP_MODE=report-only` rollback; slide upload allowlist +
10 MB/100 MB quota, `sandbox allow-scripts` iframe and sandbox CSP on served slides; admin `egress` setting
(gemini/huggingface/youtube; real-mode default off, demo on), vendored fonts, dead RAG upload unmounted outside demo;
`no-store` middleware on `/api`, `Clear-Site-Data` + storage clearing on logout, cache-wipe removed; Playwright XSS +
egress proof scripts and a ≥ 200-vector corpus.
### Claude's Discretion
Exact allowlist tables (within the PRD's never-allowed list), module/file layout, CSS-property allowlist contents, how the
CSP string is assembled/cached per settings version, plan/wave split (suggested: sanitizer+client renderer+corpus tracer
first; CSP externalisation + report-only rollout; slides; egress + fonts; caching + proof walks), migration numbering.
</decisions>

<canonical_refs>
- `.planning/reviews/v3.0/PHASE-13-PRD.md`, `.planning/REQUIREMENTS.md` (SAFE-01/02/03/06/07), `.planning/ROADMAP.md` Phase 13 SC1–5
- `.planning/reviews/v3.0/R1-security.md` (R1-03/04/14/16), `R5-quality.md` (R5-07/15), `PLAN-REVIEW.md` (PR-24, PR-04)
- `lib/sanitizeHtml.js`, `validators/index.js` (htmlField), `validators/cms.js` (SlideUploadSchema), `server.js` (CSP ~168-186,
  slides upload route, settings route, `/api/ai/insight`, `/api/rag/upload`, logout), `public/js/page-layout.js`,
  `public/js/transitions.js` (openHtmlSlide ~1158, cache wipe ~1738, chatbot, inline edit), `public/js/employee.js` (YouTube),
  `public/css/style.css` (Google Fonts), `public/sw.js`, `public/*.html` (inline scripts), `test/xss-sanitization.test.js`
- Phase 12 outputs: migrations framework (`db/migrations/`), `scripts/smoke/` Playwright harness, `/healthz` readiness
</canonical_refs>

<specifics>
Helpers: test/helpers/listen-local.js, seed-identity.js, held-version.js, deal-fixture.js; Playwright pattern
scripts/uat/phase10-walk.js; isolated MA_* temp paths only; real-mode data dir (MA_MODE=real → data/real). CMS content lives
in the collections the existing `htmlField()` wrappers guard — enumerate by grep, do not guess. Never call
`POST /api/settings/new-ma` live in a test (it deletes tracked `public/sent_emails/*` files).
</specifics>

<deferred>
Authenticated per-deal file store + legacy static mounts (14); body limits (14); module switch (15/16); exhaustive ~346
`innerHTML` audit (bounded, not eliminated); `style-src` tightening; real-deal translations of the new admin panel (19).
</deferred>

---
*Phase: 13-content-safety*
