---
status: superseded
phase: 14-deal-files-limits-legacy-hazards
checked_head: ef1c2b7
checked: 2026-10-11
plans: 10
blockers: 3
warnings: 7
info: 6
verdict: ISSUES FOUND
---

# Phase 14 plan check - ISSUES FOUND (3 blockers, 7 warnings, 6 info)

Scope: 14-01..14-10 PLAN.md against PHASE-14-PRD (D-14-01..08, acceptance 1-7), 14-CONTEXT, ROADMAP SC1-3,
SAFE-04/05/08, the 13-PLAN-CHECK defect classes and the 13 EXECUTOR-BRIEF, verified by grep against main `ef1c2b7`.

The decision coverage, wave graph, file ownership and threat models are sound. Three defects would make execution
fail or end BLOCKED by construction; all three are cheap to fix in the plans.

## Verdicts on the checks

| # | Check | Result |
|---|-------|--------|
| 1 | Coverage (acceptance 1-7, SAFE-04/05/08, SC1-3, D-14-01..08) | PASS. Every item maps to an automated truth (14-01 coverage table is accurate). One human-judged phrase: W-5. |
| 2 | Dependencies/waves | PASS. 01 -> {02..08} -> 09 -> 10, acyclic, waves = max(deps)+1. Wave-2 server.js regions are disjoint by function/route (see hot spots). |
| 3 | Tracer-first | PASS. 14-01 T1 is a real-lane vertical slice with its own verify gate (heavy, see W-3). |
| 4 | File ownership | FAIL on 14-07 (B-2) and 14-03 (B-1); otherwise accurate. DEPLOYMENT.md split (READ rows in 14-01, prose in 14-09) is coherent with deployment-role-matrix (compares rows in order + non-empty Why only). |
| 5 | Existing-test amendments | FAIL: two suites broken and unlisted (B-2); one amendment already done at HEAD (B-1). |
| 6 | Code reality | FAIL: 14-03 (B-1) and the Playwright path in 14-02/14-08/14-10 (B-3). All other cited names exist. |
| 7 | Threat models / Windows lesson | PASS with W-2. |
| 8 | Right-sizing | WARNING W-3 (all plans over the 100k smart-zone budget; <= 3 tasks and <= 10 files each). |
| 9 | Evidence plan | FAIL: B-3. Never loosens a budget (PD-24). |
| 10 | Demo contract | PASS. Byte-for-byte statements are testable (14-02 demoEmail, 14-05, 14-10 demoUnchanged). |

## BLOCKERS

### B-1 [D-14-04 / check 5, 6] 14-03 re-specifies work already on main and contradicts the shipped media contract
Evidence (HEAD):
- `lib/slideUpload.js` already exports `MEDIA_TYPES`, `MEDIA_REFUSALS`, `checkMediaUpload()`, `resolveMediaFile()`;
  server.js `POST /api/media` / `DELETE /api/media/:id` already use them; `test/media-upload-safety.test.js` (387 lines,
  unit a-e + route a-g) exists; `test/busy-503-contract.test.js` already sends the PNG probe (L380-391).
- 14-03 plans `checkUpload(input,{kind:'media'})`, `MEDIA_TYPES`, `MEDIA_REFUSALS`, `mediaInput()` as NEW, says "Write the
  tracer rows of test/media-upload-safety.test.js" (would overwrite/duplicate the existing suite), says the busy-503
  probe "becomes .png" (already is), and anchors on "writes ... with no checks" (stale).
- Truth 2 invents refusal TEXT: `'This file type is not allowed for media.'` / `'Media file is larger than 10 MB.'`.
  HEAD ships `'This file type is not allowed.'` / `'This file is too large.'` (+ the codes) and the existing suite pins them
  (`TYPE_REFUSED`, `TOO_LARGE`, L50-51). PRD D-14-04 fixes the CODES only; the quick task intentionally froze the texts
  "so they do not churn" in Phase 14. As written, 14-03 breaks its own test file.
- Task 3 replaces `resolveMediaFile()` with a new regex `^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$` that admits a trailing dot.
Fix (rewrite 14-03 as an EXTENSION): (1) add an `opts` arg `{ dir, quotaBytes }` to the existing `checkMediaUpload()` and a
`MEDIA_REFUSALS.quota = { error:'The media library is full.', code:'media-quota-exceeded' }` (413) plus `mediaQuotaBytes()`;
keep the two existing texts and every existing export/signature; (2) APPEND rows to the existing media-upload-safety test
file, never recreate it; (3) deal-lane/demo-lane delete reuses `resolveMediaFile(url, laneDir)` (deal lane: regex-valid
`/api/files/media/<name>` -> `unlinkDealFile`); (4) busy-503: the probe is already PNG - only add a temp
`MA_DEMO_MEDIA_DIR` to its MA_* block and swap the cleanup loop for a temp-dir-empty assertion; (5) refresh the Anchors
and "Existing test files" sections to HEAD.

### B-2 [D-14-08 c / check 5] 14-07 breaks two existing suites it does not list
Evidence: 14-07 makes `POST /api/settings` carrying `demoMode` answer 403 `demo-only` for any non-demo resolution.
- `test/clearance-write-paths.test.js` L113 (`seedFixture(..., {custom:true})`): deal-bound admin posts `{demoMode:false}`,
  asserts 200; used at L234 for the dual-lane proof.
- `test/optimistic-locking-contract.test.js` L1766-1770 `enableCustomMode()` (called at L1778, 1810, 1842, 4 sites): same
  POST with a deal-bound admin token, asserts 200.
Neither file is in 14-07 `files_modified` or its amendment register; the full-suite verify in Task 3 (and 14-09/14-10) fails.
An executor "fixing" it ad hoc risks weakening the dual-lane proofs.
Fix: add both files to 14-07 `files_modified` and "Existing test files this plan touches" as DELIBERATE AMENDMENTS: flip the
deal to the custom lane by writing its `settings` singleton directly through the store API
(`store.getOrOpenConnection(dbFiles.dealDbPath(id), DEAL_SCHEMA_PATH)`), keep every downstream assertion (custom* table
placement, version bumps, clearance blocks) unchanged, and add them to the 14-10 amendment register.

### B-3 [check 9 / acceptance 7] Evidence tooling cannot launch a browser as written (14-10; stale paths in 14-02, 14-08)
Evidence (host, verified): `~/.npm/_npx` is EMPTY (the hash dir named in 14-02/14-08/14-10 does not exist; 14-02's fallback
"any other `~/.npm/_npx/*`" matches nothing). The only Playwright is `playwright-core` 1.58.1 (wants chromium rev 1208, not
cached) via `PLAYWRIGHT_PATH=/Users/karstenhaldan/.npm-global/lib/node_modules/openclaw/node_modules/playwright-core` +
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/Users/karstenhaldan/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`.
- `scripts/uat/phase13-xss.js` honours the executable env and accepts playwright-core.
- `scripts/smoke/run.js` (`readPackage(dir,'playwright')` requires package name `playwright`; `chromium.launch` has no
  `executablePath`), `scripts/uat/phase9-walk.js` L292 and `phase10-walk.js` L410 (`chromium.launch({headless})`, no
  `executablePath`) cannot start Chromium on this host. 14-10 Task 2 (`npm run smoke`) and Task 3 (Phase 9 walks, Phase 10
  runner) therefore end BLOCKED by construction; PD-24 forbids fixing in-plan. 14-02's STOP gate and 14-08's screenshot
  script would also fail to launch unless they copy the phase13 resolver incl. the executable env (PD-11 does not say so).
Fix: (1) replace every `~/.npm/_npx/e41f...` string in 14-02, 14-08, 14-10 by the two env vars above; (2) PD-11: the
Phase 14 runner and the 14-08 script must pass `executablePath` from `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (copy
`resolvePlaywright()` + `launch` from phase13-xss.js); (3) give 14-10 an authorized Task 0 (the 13-14 analogue): minimal
tooling patch so `smoke/run.js`, `phase9-walk.js`, `phase10-walk.js` accept playwright-core and honour
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` (default behaviour unchanged when unset; extend test/smoke-harness.test.js), added to
`files_modified`, committed before any evidence run.

## WARNINGS

### W-1 [14-10] Walk outputs and CSP mode are implicit
`phase9-walk.js` is run without `--out` (default = Phase 9's committed evidence dir: Phase 9 JPEGs/logs would be rewritten);
the Phase 13 runner's `parseArgs` default is still `cspMode: 'report-only'` at HEAD, so the "enforce default -> p13-enforce.log"
run is only enforce if 13-14 merged. Fix: pass `--out "$E"` to both Phase 9 invocations and `--csp-mode enforce`
explicitly for p13-enforce.log.

### W-2 [Windows lesson, 14-02 / 14-03] new unlink-containment code has no path.win32 matrix or win32-gated live test
14-01 and 14-05 apply the lesson; the demo-lane comm delete (14-02 T1) and media delete (14-03 T3) rely on a basename
regex + dirname equality but test only posix `../` records. 14-03's regex admits a trailing dot (`x.png.`), a Windows
alias of `x.png`. Fix: add to each a `path.win32` simulated matrix (`x.png.`, `x.png `, `x.png::$DATA`, `X~1.PNG`,
`..\\x`, `a\\b`, device names `NUL`/`CON`) asserting no unlink outside/other than the exact regular file, plus one
`process.platform==='win32'`-gated live row; require the stored-name regex to end in an alphanumeric extension.

### W-3 [check 8] Every plan exceeds the 100k smart-zone budget (estimate-check: 14-01 1.50x; 14-07 1.45x; 14-06 1.25x; 14-02/03/04 1.20x; 14-05/09 1.15x; 14-08 1.05x; 14-10 1.50x)
All are <= 3 tasks and <= 10 files, so advisory only. Heaviest: 14-01 T1 (8 files incl. the child-server helper, complete
auditor, three routes, comm lane, READ rows) and 14-07 (five test amendments + three behaviour tasks + two more once B-2
lands). Suggestion: thin 14-01 T1 to store + one route + comm send + helper (auditor `record()` may start minimal and be
completed in T3, where its tests already live); give 14-07 T1's five amendments their own commit.

### W-4 [14-04] the existing slide upload route swallows busy errors
HEAD `app.post('/api/slides/upload')` wraps writes in `try { ... } catch (err) { res.status(500) }`. PD-14 says an event
throw "rethrows (central 503)" but never mentions the local catch; implemented inside it the busy error becomes a 500 and
the truth "fixed busy 503" fails. Fix: state in Task 1 action: `catch (e) { unlink the published file; if (isBusyError(e)) throw e; ... }`
(the `/api/media` precedent).

### W-5 [14-08 truth 4 / project rule "judge by evidence"] "layouts unbroken at every width" is judged by eye
Computed-style/rect visibility is automated, the layout verdict is the agent reviewing JPEGs. Fix: add automated
assertions per width: `document.documentElement.scrollWidth <= innerWidth`, header height at 390 below a stated bound,
no zero-height card grid gap where the Portable card was; keep the JPEG review as supplementary.

### W-6 [14-01] app-wide `compression()` (server.js:207) interacts with the "exact header set" truth
A streamed text/html reply > threshold is gzipped: `Content-Encoding`/`Vary` appear and `Content-Length` is dropped. Tests
that `deepStrictEqual` the whole header set or compare bytes without `Accept-Encoding: identity` will flake/fail. Fix: say
in Task 1 that header/byte assertions use `Accept-Encoding: identity`, and assert only the listed headers plus the
absence of ETag/Last-Modified/Accept-Ranges/Content-Range/Report-Only.

### W-7 [14-09 PD-23] a refused rerun that completed removal is indistinguishable from a no-op
The rerun returns 409 "This deal has no audit trail on this host." (CLI non-zero) although files were just removed. Fix:
include `files: {count, bytes}` in the refusal body/CLI line only when removal ran, and cover it in the deal E row.

## INFO

- **I-1 Wave-2 server.js union-merge hot spots (expected, textual only):** (a) the strip between the 14-01 `/sent_emails`
  override mount and `express.static(public)`: 14-03's `/uploads` mount lands there while 14-05 wraps the `/uploads/slides`
  registrations a few lines above; (b) top-of-file parser region: 14-05 guard line after `lockdownMiddleware(...)` vs 14-06
  parser block ~25 lines below; (c) the consolidated gate tail (14-06) vs `DEMO_ONLY_PREFIXES`/unmount block (14-07) ~120
  lines above; (d) `app.<seam> =` assignments from 14-01 (`fileReadAuditor`), 14-06 (`LARGE_BODY_ROUTES`,
  `largeBodyParser`). No two plans create the same new file or edit the same test region; test amendments are single-owner
  (caching-safe07, csp-report -> 14-06; db-artifact-exclusion, deal-resolver, no-get-mutates, role-enforcement,
  path-canonical-gate -> 14-07; client-authz-hiding -> 14-08; busy-503 -> 14-03; slide-sandbox -> 14-04).
- **I-2 Planner departures consistent with the PRD:** PD-6 (rows land with the policy; drift test forces it), PD-19
  (tombstone is required: without a pre-gate row anonymous gets 401, non-admin 403, so "404 for every role/mode" fails),
  PD-23 (matches "reruns record nothing" in the normal case), PD-12 (supports "original names never reach audit"), PD-14
  (needed for the per-deal quota to ever free), PD-17 (no shipped real data, D-14-01). See W-7 for PD-23 UX.
- **I-3 14-04 rationale slightly off:** the Phase 13 real-lane fixture already binds every session to the deal
  (`phase13-xss.js` fixture), so the probe upload currently succeeds into the deal lane and the scenario fails on the
  `/uploads/slides/` URL regexes, not on a 409. The planned amendment is still right.
- **I-4 Demo-mode differences beyond the PRD's four listed:** removing `urlencoded` and the 2 MiB default for all non-upload
  routes apply in demo too (both D-14-07, locked). Record them in 14-VALIDATION "PRD readings" so the demo contract section
  is exhaustive.
- **I-5 14-03 quota counts every file directly in `public/uploads`** (local welcome videos included) in the demo lane; a
  large hand-placed video can exhaust the 100 MB media quota. Acceptable; mention in DEPLOYMENT.md.
- **I-6 Layering:** db/dealFiles.js requires lib/slideUpload.js for `SLIDE_SANDBOX_CSP` (db -> lib). No cycle; acceptable,
  or move the constant into dealFiles' header table.
