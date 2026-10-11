---
phase: 13-content-safety
plan: quick-client-bridge
status: complete
findings: [CR3-02, CR3-03, CR3-04]
base: f941767d45031e49c6b9d754cac02d60e72612bb
commits: [2977845, b985e11]
---

# Phase 13 Quick: client break-glass bridge, new-session clearing, AI plan render (CR3-02 / CR3-03 / CR3-04)

All three findings from the v3.0.0-rc.1 client/assets review are closed. CR3-04 was done because the
rendered plan was proven unchanged (evidence below).

## CR3-02 (MEDIUM) - break-glass bridge

- **Client (a)** `public/js/transitions.js`: `maybePromptForToken`, the `admin_token` read in `window.fetch`
  and in `maConfirmDelete`, and `withToken` are deleted. A non-`authRequired` 401 (e.g. a wrong current
  password) is returned to the caller untouched; no prompt, no web-storage write, no header. Nothing
  under `public/` (vendor excluded) mentions the persisted token or the header any more.
- **Server (c)** `server.js`, the `/api` gate: the session cookie is resolved first. A valid session is the
  identity; the `X-Admin-Token` header is honoured only when there is no live session (scripts/CLI, a dead or
  unknown cookie, DEMO_OPEN token-only calls). The gate records the fact on `req.sessionOwnsIdentity`.
- **Same precedence in `isAdminRequest()`** (same file, the function next to the gate): handlers re-check the
  header inline (`GET /api/settings` full view, `/api/admin/users*`, deal-membership, egress POST...), so
  fixing only the gate would still let a pmo session carrying the token through those. The function now
  ignores the header when `req.sessionOwnsIdentity === true`; on paths that never reach the gate the flag is
  undefined and behaviour is unchanged. No other lines of the sibling-owned `/api/deals/:id*` region touched.
- Unchanged contracts: canonical path gate, role/read policy, `admin-token-use` audit event and the
  `admin-token` actor (T-13-13), DEMO_OPEN token-only behaviour, credential lockdown.

## CR3-03 (LOW) - browser state at sign-in

- `public/js/client-storage.js`: `clearForNewSession()` beside `clearOnLogout()`, sharing `LANGUAGE_KEYS`
  (only `employeeLanguage` survives). Clears `sessionStorage` and every other `localStorage` key
  synchronously, no network, never throws, returns the number of removed keys. It deliberately leaves
  Cache Storage alone (shared model weights only; a real logout still clears it).
- `public/js/login.js` calls it on a successful sign-in, before the redirect; `public/login.html` loads
  `client-storage.js` ahead of `login.js` (content-hash stamps are applied at serve time).
- The `authRequired` 401 redirect does NOT clear storage (kept to the brief; sign-in is the single choke
  point and every redirect lands on it).

## CR3-04 (LOW) - AI 100-day plan

`renderMarkdownPlan` in `public/js/dashboard.js` no longer assigns `innerHTML`. The converter's output markup
carries class names instead of inline `style`; the string goes through `MASafeHtml.render`; the
presentational declarations the allowlist would drop (border, background, `var(--x)` colours, font-family,
overflow) are re-applied by `applyPlanStyles()` from a trusted constant table via `style.setProperty`. The
empty-plan and "renderer missing" states are built with `createElement`/`textContent` (fail closed - no
string fallback). Added to `ENUMERATED_PATHS` in `test/client-render-paths.test.js`.

**Evidence (scratch Chromium harness outside the repo, isolated temp-DB server, before = the base
`dashboard.js` served via route interception, after = this tree):**

| Plan text | Viewports | Result |
|---|---|---|
| golden local-fallback plan A (culture/talent critical, value strong: WARNING, CAUTION, 3 IMPORTANT callouts, 2 tables, status spans) | 1440, 390 | 341 nodes: tag, text, own attributes, bounding rect and the complete computed style identical, 0 differences |
| golden plan B (moderate scores, NOTE callout) | 1440, 390 | 299 nodes, 0 differences |
| synthetic plan (h1-h4, hr, NOTE/WARNING/IMPORTANT/CAUTION, blockquote, table, list, coloured spans, `<img onerror>` payload) | 1440, 390 | only difference: the `onerror` attribute is removed (intended) |

Screenshots were also compared pixel-wise: 390 px identical (goldenA 0 differing channels, goldenB max
delta 1). At 1440 px the pixel diff is non-zero, but an old-vs-old control run shows the same class of diff
(goldenB 1440 max delta 112 with no code change; backdrop-filter/capture noise on tall element captures),
while every node's computed style and geometry is identical - so the 1440 pixel diff is capture noise, not
a visual change. Residual by design: the policy still allows `<a href=http(s)>` and `class`, so a lure link
or class-based redress from model output is the same ceiling as the chatbot bubble (AR-13-08 class), not
eliminated.

## Tests

- New `test/admin-token-bridge.test.js` (8 tests): static no-`admin_token`/prompt/header under `public/`;
  fetch-wrapper region never prompts or touches storage; login clears before redirect + script order;
  `clearForNewSession` keeps only the language key / no request / never throws; runtime: pmo session + valid
  token gets the existing 403 on `/api/admin/users`, `/api/admin/egress` POST (nothing stored) and an
  identical `/api/settings` view, admin session unaffected, wrong token irrelevant; token alone and
  token + dead cookie still 200; DEMO_OPEN token-only egress POST 200, anonymous/wrong token 403.
- Amended: `test/client-render-paths.test.js` (one `ENUMERATED_PATHS` row, `renderMarkdownPlan`). No other
  existing test changed; `caching-safe07` needed no pin change (its client-storage rows pass as-is).
- Full suite: `node --test` -> tests 1721, pass 1719, fail 1, skipped 1, EXIT=1. The single failure was the
  known load flake `WR-A06: 200 000 nested <b> / <div>` (216 ms vs 100 ms bound under host load); re-run
  alone: 32/32 pass. No other failure.

## Deviations

- Rule 2/CR3-02: `isAdminRequest()` also edited (see above) - same token-vs-session precedence, required for
  the fix to hold on inline-checked handlers; a stale code comment above `ADMIN_TOKEN` in `server.js` was
  corrected in the same commit.
- A valid session cookie suppresses the token in ALL modes including DEMO_OPEN (literal reading of the
  brief: "honoured only when there is no valid session cookie"); token-only requests are unchanged.

## Docs owed (not edited here; DEPLOYMENT.md is not in this plan's ownership)

In `DEPLOYMENT.md` section "ADMIN_TOKEN (optional break-glass, discouraged)" add: "The browser UI never
prompts for, stores or sends this token; it is for scripts and the command line only. A request that carries
a valid session cookie is judged on that session's role - the header never raises it - so the token works
only on requests without a live session (curl/CLI without the cookie jar, or with an expired cookie)." Also
for the release notes: CR3-02 (a pre-release exposure) is closed in rc.1.

## Self-Check: PASSED

Commits 2977845 and b985e11 exist; `git status --porcelain data/ public/sent_emails/` empty; changed files
present (`server.js`, `public/js/{transitions,client-storage,login,dashboard}.js`, `public/login.html`,
`test/admin-token-bridge.test.js`, `test/client-render-paths.test.js`).
