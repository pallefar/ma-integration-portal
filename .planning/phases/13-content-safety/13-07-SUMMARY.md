---
phase: 13-content-safety
plan: 07
subsystem: security
tags: [csp, report-only, csp-report, content-safety, lockdown]
requires: ["13-02"]
provides:
  - strict script-src 'self' 'wasm-unsafe-eval' policy shipped Report-Only beside the legacy enforcing policy
  - CSP_MODE (report-only default | enforce; unknown fails closed to enforce)
  - POST /api/csp-report (public, bounded) and admin-only GET /api/admin/csp-violations
affects: [13-10, 13-11, 13-12, 13-13]
key-files:
  created:
    - lib/cspReports.js
    - test/csp-policy.test.js
    - test/csp-report.test.js
  modified:
    - lib/csp.js
    - lib/credentialLockdown.js
    - server.js
    - validators/settings.js
    - test/auth-route-inventory.test.js
    - test/credential-lockdown.test.js
requirements-completed: [SAFE-02]
status: complete
actuals:
  tasks: 2
  commits: 2
---

# Phase 13 Plan 07: SAFE-02 strict CSP rollout infrastructure Summary

Strict `script-src 'self' 'wasm-unsafe-eval'` policy now ships as `Content-Security-Policy-Report-Only` beside today's
unchanged enforcing policy; browser reports land in a bounded, unauthenticated `/api/csp-report` and are listed by an
admin-only `/api/admin/csp-violations`; `CSP_MODE` switches report-only / enforce.

## What shipped

- **lib/csp.js** - `headersFor({ egress })` now returns one or two headers by `CSP_MODE` (memo key includes the mode).
  Exports `resolveMode()`, `logBootMode()`, `REPORT_URI`. Both policies carry `report-uri /api/csp-report`; no
  `report-to` / `Reporting-Endpoints` (PD-11). The server.js middleware loop is unchanged.
- **lib/cspReports.js** (new) - `normalize(contentType, body)` for `application/csp-report` and
  `application/reports+json` (camelCase and kebab-case keys), a distinct-tuple store (key
  `directive|blockedUri|sourceFile`, cap 100, least-recently-seen evicted, count + firstSeen + lastSeen), and a
  fixed-window per-key limiter. URLs reduced to origin + path, non-http(s) URIs to their scheme, strings clipped to 200,
  line numbers integer-validated, at most 20 tuples per request.
- **server.js** - `'/csp-report'` on `PUBLIC_API_PATHS`; `POST /api/csp-report` and `GET /api/admin/csp-violations`
  placed directly after `POST /api/admin/egress` (beside the other admin routes, not next to the logout/auth block that
  13-04 edits); a single `csp.logBootMode()` line next to the existing `require('./lib/csp')`.
  Route chain: limiter (60/min per `req.ip`, TRUST_PROXY-aware, 429 + `Retry-After`) -> route parser
  (`type: [csp-report, reports+json]`, 4 KB) -> handler (204, no body; 415 for any other content type) -> route-local
  error mapper (413 / 400 / 415, because the generic handlers would turn a parser rejection into a 500).
- **lib/credentialLockdown.js** - exactly one canonical `POST /api/csp-report` passes during lockdown.
- **validators/settings.js** - `CspReportSchema` registered so VAL-01 coverage stays green (the public path never runs
  generic validation; `normalize()` is the real bound).

## Exact policies

Dev/demo defaults (egress youtube + huggingface on), default mode `report-only`:

```
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://img.youtube.com https://i.ytimg.com https://*.huggingface.co; font-src 'self' data:; connect-src 'self' https://huggingface.co https://*.huggingface.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://youtube.com; media-src 'self' blob: data: https://*.youtube.com; worker-src 'self' blob:; report-uri /api/csp-report
Content-Security-Policy-Report-Only: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://img.youtube.com https://i.ytimg.com https://*.huggingface.co; font-src 'self' data:; connect-src 'self' https://huggingface.co https://*.huggingface.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://youtube.com; media-src 'self' blob: data: https://*.youtube.com; worker-src 'self' blob:; report-uri /api/csp-report
```

Real-mode defaults (every egress channel off), default mode `report-only`:

```
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; media-src 'self' blob: data:; worker-src 'self' blob:; report-uri /api/csp-report
Content-Security-Policy-Report-Only: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; media-src 'self' blob: data:; worker-src 'self' blob:; report-uri /api/csp-report
```

`CSP_MODE=enforce` sends only the strict string above (same directives) as `Content-Security-Policy`. Neither real-mode
header contains an `http(s):` token or a wildcard (asserted in default mode and in enforce, W-6).

## Verification

- `node --test test/csp-policy.test.js test/csp-report.test.js test/auth-route-inventory.test.js test/write-validation-coverage.test.js test/read-policy-coverage.test.js` - 25 pass, 1 skipped, 0 fail.
- `node --test test/csp-report.test.js test/csp-policy.test.js test/credential-lockdown.test.js test/lockdown-asset-allowlist.test.js` - 36 pass, 0 fail.
- Full suite (`node --test`, worktree root): `# tests 1520  # pass 1519  # fail 0  # cancelled 0  # skipped 1  # todo 0`
  (EXIT=0; the one skip is the conditional PD-37 slide subtest, deviation 4). Suite was 1500 at the base.

## Deviations from Plan

**1. [Placement] Both routes placed after `/api/admin/egress`, not after `/api/auth/mode`.** The plan's anchor sits
immediately below the logout handler that 13-04 (caching/logout) edits in parallel; placing the new routes beside the
existing admin routes avoids a textual merge conflict and matches the orchestrator's instruction. No behavioural effect
(the `/api` gate and PUBLIC_API_PATHS decide access, not source order).

**2. [Rule 2 - Missing critical] Route-local error mapper on `/api/csp-report`.** A body-parser rejection
(`entity.too.large`) would otherwise fall to the final generic handler as a 500. The 413/400/415 mapping is route-local
so no shared error middleware is touched.

**3. [Rule 2 - Missing critical] 415 for unsupported content types.** Only the two report types are accepted; a
`application/json` post (parsed by the global parser) is refused with 415 and stores nothing.

**4. [Sibling dependency] PD-37 regression subtest is conditional.** 13-03 (slides sandbox mount) is not in this base,
so the subtest uploads a slide, and only when the response carries a `sandbox` directive asserts no Report-Only header;
otherwise it records a skip. It becomes a live assertion after 13-03 merges - orchestrator should confirm it runs
(not skipped) on the merged tree.

## Residual notes / threat flags

- `threat_flag: unauthenticated-global-json-parse` - the app-wide `express.json({ limit: '50mb' })` parses an
  `application/json` body before any route runs, so an anonymous 50 MB `application/json` post to `/api/csp-report` is
  parsed (then refused 415) before the 4 KB route parser is reached. Real report content types are capped at 4 KB by the
  route parser and the limiter runs first. This is the same pre-existing exposure as `/api/auth/login`; closing it
  needs a pre-parser guard in the shared middleware region (13-04 territory) and was left out of this plan's file scope.
- The store and limiter are per process; a multi-process deployment lists per process (13-13 documents it).
- `logBootMode()` prints one `[security] CSP_MODE=...` line to stdout per `require('./server.js')`; an unknown value adds
  exactly one `[security]` warning (per process, per distinct value).
- Admin UI for the list is intentionally absent (T-13-62); a later view must use `textContent`.

## Known Stubs

None.

## Commits

- `6ff7561` feat(13-07): strict CSP shipped Report-Only + /api/csp-report and admin violation list
- `5288669` feat(13-07): keep /api/csp-report reachable during real-mode credential lockdown

## Self-Check: PASSED

Created files exist (lib/cspReports.js, test/csp-policy.test.js, test/csp-report.test.js); commits 6ff7561 and 5288669
exist on the worktree branch; `git status --porcelain data/ public/sent_emails/` empty.
