# R5: Engineering quality, tests, i18n, accessibility, docs

Lane R5 of the v3.0 production-readiness review. Written 2026-10-10, against HEAD `56ca821`.

**How I tested**
- I ran the suite 17× in parallel and 3× with `--test-concurrency=1`. Those runs used a clean `git archive HEAD` copy in the scratchpad, so test pollution could not reach the repo.
- I ran a live server on port 4315 against temp copies of `demo.db`/`control.db`. As karen (Integration Leader) I created a real deal and loaded it to a realistic size: 1,003 tasks, 5,006 RAID rows and 200 org positions.
- I ran axe-core (WCAG 2.1 AA) through Playwright on 6 IL pages, plus a German check at 390 px.
- I simulated the admin download-zip into the scratchpad.
- I read a **copy** of the local `data/audit.db`, never the live file.
- The server was killed afterwards. I edited nothing in the repo except this file.

**Verdict in one paragraph.** The suite is broad on the server side: 779 tests, and every IL-critical API route is tested. It is also fast (about 10 s). But the flakiness has a concrete, fixable root cause that nobody has found (R5-02). The biggest engineering risk is in the data layer. Every write rewrites **and audits** every row of the whole deal. At realistic size that is about 6,200 audit rows and 3.6 MB of append-only audit **per click** (R5-01). Shipping hygiene has two real failures. Phases 8–9 reach browsers without a cache-bust (R5-03), and the tests write into the real audit log (R5-04). i18n and accessibility are good on the demo showcase and weak on the new real-deal IL screens. Dependencies are in good shape.

---

## Findings

### R5-01: BLOCKER, VERIFIED. Every write rewrites and audits every row of the deal (write and audit amplification)
- **Where:** `db/store.js:494-503`, the non-versioned branch. It runs an unconditional `update.run(...)` for every row and pushes an audit delta for every row. `db/store.js:443-446`, the versioned "untouched" branch, re-runs the UPDATE and pushes an `update` delta with `before === after`. `writeDb()` loops over all 43 `ARRAY_COLLECTIONS` on every call (`store.js:365`).
- **Measured on my isolated server, real deal, 1k tasks / 5k RAID / 200 positions:**

  | Action | Audit rows appended | Audit bytes | Latency (median) |
  |---|---|---|---|
  | `POST /api/raid` (create one entry), fresh deal | 17 | 72 KB | 7.7 ms |
  | `POST /api/raid` (create one entry), at volume | **6,220** | **3.59 MB** | 85.7 ms |
  | `POST /api/integration-tasks` (create), at volume | **6,223** | **3.60 MB** | 96.6 ms |

  After 6 writes, `audit.db` was 37.8 MB.
- **History confirms the same pattern in organic use.** The local `data/audit.db` has 33,937 rows. **25,763 of them (76%) are no-op updates with `before_json = after_json`.** They account for 56.5 MB of its 58 MB of payload. One historical `POST /api/integration-tasks` wrote 168 audit rows, of which 167 were no-ops. Seeded template collections (`assessmentTemplates` at about 5.8 KB per row) are re-audited on every unrelated write.
- **Impact:** `audit.db` is append-only by trigger (UPDATE/DELETE abort), so this growth can never be trimmed.
  - One busy deal of about 1k rows produces roughly 0.5–1 MB of audit per save. Across a 15-person team that is GBs per week, which fills the disk on a laptop or shared host.
  - The compliance trail becomes more than 95% noise. That works against the very control the audit exists for.
  - Every save also blocks the single event loop for about 90 ms at this size.
  - Nothing in the phase docs records this as accepted.
- **Fix:** when `JSON.stringify(item) === priorRaw`, issue no data UPDATE and record no delta. If the index changed, update `seq` only (this keeps CR-01's reordering) and do not audit it. Keep the CONC-02 "untouched rows never clobber" semantics; the conditional UPDATE is only needed when content changed. Add tests: an N-row deal must produce exactly 1 audit row per single-record write, and the reorder case must still persist. **Size: M.**

### R5-02: MEDIUM (top test-health item), VERIFIED. Root cause of the "random" test flakes: tests listen on `[::]` but connect to `127.0.0.1`
- **Where:** 413 call sites of `app.listen(0)` in `test/*.js`, all followed by `fetch('http://127.0.0.1:${port}…')`.
- **Mechanism, reproduced deterministically:** a server bound to `127.0.0.1:P` plus a `listen(P)` with no host (which binds `::`) **both bind successfully on macOS**. A fetch to `127.0.0.1:P` then reaches the *other* process. My script returned `404 {"error":"Endpoint not found"}` from the foreign socket, and only `[::1]:P` reached the right server. This machine has about 30 listeners on 127.0.0.1 in the ephemeral range (Docker Desktop, Manus, Loom, Ollama and others). So any `listen(0)` can be handed a port that a foreign listener on 127.0.0.1 already holds.
- **Evidence from runs:**
  - 17 parallel runs; **6 failed (35%)** across 13 distinct tests in 11 files. Examples: `dd-vdr (f)`, `synergy-stage (i)` (404≠409), `synergy-tasks (c)` ("fetch failed"), `AUTH-04` (`/api/auth/me` without `user`), `dd-grants (a)` (body `{error:'Endpoint not found'}`), `org-positions (e)/(gg)`, `optimistic-locking-contract (40)`.
  - **Neither `Endpoint not found` nor `Endpoint or method not found.` exists anywhere in this codebase.**
  - A `--require` preload that stamps each response with its server PID caught 3 of 3 failures in runs 7–12. All three came from foreign servers: `127.0.0.1:56491` and `:56501` (Docker) and `:58683` (Manus). Those ports match `lsof` exactly.
- The known `audit-security-events (a)` "0 !== 1 after a 200" flake fits the same signature: a 200 that this process never produced. **SUSPECTED** attribution; the mechanism itself is verified.
- **Fix:** add a `test/_listen.js` helper that calls `app.listen(0, '127.0.0.1')` and replace all 413 call sites. **Size: S.** Until then, a red run gets re-run until green, and real regressions hide in that habit.

### R5-03: HIGH, VERIFIED. The Phase 8/9 client code ships without a cache-bust, behind a 30-day JS cache
- **Where:** JS and CSS are served with `Cache-Control: public, max-age=2592000` (`server.js:182-184`). Cache-busting relies on hand-edited `?v=` stamps.
- `transitions.js?v=1784900002` (for example `public/execution.html:10`) was last bumped in `0644c7b` on 2026-08-10, which is the v2.1.0 release. **Seven later commits changed `transitions.js` without a bump.** Those commits are all of Phase 8's busy-retry and give-up toast, and all of Phase 9's conflict dialog (`11e1de8`…`dda15a9`).
- `execution.js` and `org.js` (`?v=1786433369`) also missed the WR-01/WR-02 fix `0acb509`.
- `login.html:8` still loads `style.css?v=1784500010`, while every other page uses `1784600001`.
- **Impact:** every browser that loaded v2.1.0 keeps the old `transitions.js` for up to 30 days after the v2.2/v3 upgrade. Those users get no 503 retry and no conflict dialog, so a 409 surfaces as a generic failure. The concurrency UX the milestone is built on silently never reaches them.
- **Fix:** bump now. Then add a test that hashes each `public/js|css` file against a committed manifest and fails if content changed but the `?v=` did not. Alternatively, rewrite `?v=` to a content hash when serving the HTML (the HTML is already `no-cache`). **Size: S.**

### R5-04: MEDIUM, VERIFIED. The test suite writes to the live `data/audit.db` and `data/runtime.db`
- **Two groups of tests leak:**
  - Nine files set the control, runtime, demo and deals paths but **not** `MA_AUDIT_DB_PATH`, so their audited writes land in the real `data/audit.db`. The files are `control-plane-serialization`, `deal-registry`, `deal-lifecycle`, `deal-resolver`, `demo-only-gating`, `rag-upload`, `role-enforcement`, `xss-sanitization` and `write-validation`.
  - Seven more require the app or store with no path overrides at all, for example `auth-route-inventory`, `write-validation-coverage` and `deal-wizard-page`.
- **In the clean copy:** one `node --test` creates `data/audit.db` (167 KB) and `data/runtime.db`, and the audit file grows about 145 KB per run. The committed `demo.db`, `control.db` and `ma-portal.db` stayed byte-identical (shasum before and after).
- **Locally:** the 79 MB `data/audit.db` is explained. It holds 2,509 distinct deal ids, mostly test fixtures such as `deal_lifea1a…h1f`. It also holds 1,047 `session-revoke-all` events (target `nobody`), 357 `admin-token-use`, 355 `password-change` (user `karen2`) and 1,083 `deal-delete`. **Fifty of those rows were appended today at 06:53Z by somebody's test run.**
- **Impact:** if anyone runs `npm test` on a real-deal host (tests ship in the release zips), fabricated security events go permanently into the append-only compliance log.
- **Fix:** add `MA_AUDIT_DB_PATH` to those files. Also make `db/dbFiles.js` refuse the default `data/` paths whenever `process.env.NODE_TEST_CONTEXT` is set, so a missing override fails loudly. **Size: S.**

### R5-05: MEDIUM, VERIFIED. Every request reads and parses the whole deal, and IL pages fan out
- **Where:** `readDb()` (`db/store.js:259-271`) runs `SELECT … ORDER BY seq` and `JSON.parse` on all 43 collections. It has 134 call sites in `server.js`, so cost scales with total deal size whatever the endpoint. The "sub-millisecond reads, no cache" premise in `server.js:790ff` no longer holds at real-deal size.
- **Measured at volume (1k tasks / 5k RAID / 200 positions):**

  | Request | Result |
  |---|---|
  | `GET /api/raid` | 39.7 ms median, **1.6 MB, unpaginated** |
  | `GET /api/integration-tasks` | 21 ms, 215 KB |
  | `GET /api/notifications` | 9 → 17 ms (grows with deal size although it returns 680 bytes) |
  | 30 concurrent list GETs (10 users × 3 endpoints) | **p50 322 ms, p95 483 ms** (single-threaded) |

- **Due Diligence page:** `due-diligence.js:48-69` makes 18 requests per load. That is 2 per area across 8 areas, each one a full `readDb`. The page costs 150–235 ms of server CPU even with zero DD items, and it reloads everything after every write.
- **Execution Hub:** at 5k RAID rows `execution.html` builds **95,586 DOM nodes**, because there is no pagination or virtualisation.
- **Fix:**
  - A `readCollections([...])` read path for GETs that only need a few collections.
  - Server-side paging and filtering for RAID and tasks.
  - One batch endpoint for the DD workspace.
  - Combine with R5-01, since writes are the costlier half.
- **Size: M–L.**

### R5-06: MEDIUM, VERIFIED. The admin download-zip blocks the server and ships files that `.gitignore` deliberately keeps out
- **Where:** `server.js:1261-1283` runs `execSync('zip -r … .')` over the working directory with a deny-list.
- **Simulated on this checkout with the exact exclusion list:** it took **91 s, produced 4.6 GB and 717 files**. A synchronous call of that length freezes every user for the whole build. The size comes from `slidedeck interaction/`, which `.gitignore` ignores but the zip does not exclude.
- **The zip and `.gitignore` disagree.** The zip ships:
  - `public/uploads/`, the runtime media and slide uploads, which can hold deal material;
  - `.claude/settings.local.json`, `.gsd/` and `graphify-out/`;
  - the root screenshots and the 9 MB source `.pptx`;
  - **the two local-only `.planning/security/*-REVIEW.md` write-ups**, which are gitignored precisely so they never circulate.
- It also excludes `node_modules/` and `data/*.db`. The "portable package" is therefore neither zero-install nor bootable with accounts.
- It needs a `zip` binary, which stock Windows lacks, so the route returns 500 there.
- **Fix:** delete the route, or build from an allow-list (`git ls-files` or a release manifest) asynchronously and streamed. **Size: S–M.**

### R5-07: MEDIUM, VERIFIED. AI "training uploads" have been a dead feature since Phase 1
- **Where:**
  - `/api/rag/upload` persists to SQLite (`server.js:1331-1345`), then calls `ragService.initializeRAG()` to "retrain instantly".
  - `initializeRAG()` loads custom chunks **only from the frozen, read-only `db.json`** (`ragService.js:188-212`).
- **Result:** uploads never reach the index; the boot log prints "including 0 custom trained chunks". The tests only check that a row was persisted (`test/rag-upload.test.js:109,140`), and `GET /api/rag/search` has no test at all.
- **Caution for the fix:** the index is process-global. Simply pointing it at the DB would mix chunks across deals, which is a leak.
- **Fix:** decide between removing the feature or gating it to demo, and making the index per deal. **Size: S–M.**

### R5-08: MEDIUM, VERIFIED. The legacy "Reset Custom M&A" wipes every deal's sent-email files
- **Where:** `POST /api/settings/new-ma` (`server.js:1606-1635`), reachable from the admin console button at `admin.js:1969`. It deletes **every** `comm_*` file in `public/sent_emails/`, whatever deal is active.
- **Impact:**
  - Other deals' correspondence records are destroyed. Their DB rows survive but point at missing files.
  - The committed demo email `comm_1783454326531.html`, which the showcase uses, is deleted too.
  - The deletions are not audited.
- **Related legacy debt:** the same demo-era machinery (69 `demoMode` branches, 10 parallel `custom*` lanes) stays reachable inside a real deal.
- **Separate pointer for the security lanes:** `public/sent_emails/` and `public/uploads/` are served by `express.static` *before* the auth gate. An unauthenticated GET of the demo email returned 200. These are capability URLs; they are not scoped to a deal and are not removed when a deal is deleted.
- **Fix:** disable `new-ma` outside demo, or scope it to the deal. **Size: S.**

### R5-09: MEDIUM, VERIFIED. The Due Diligence client ignores failed saves and throws away what the IL typed
- **Where:** every DD write does `.then(r => r.json()).then(refresh)` without checking `r.ok`. See `due-diligence.js:117-119, 176-179, 251-253, 267-270`.
- The add-finding and add-request handlers clear the input on **any** response (`:368-371`, `:388-391`). A 400 validation error, a 403 clearance denial or a 503 after retries give up all silently erase the text.
- This contradicts Phase 8's "give-up toast, form preserved" decision. The file has 15 `fetch` calls and only 2 `.catch`es.
- **Fix:** add a shared `postJSON` that throws when `!ok`, and clear the input only on success. **Size: S.**

### R5-10: MEDIUM, VERIFIED. The real-deal IL screens are English-only, while the demo is translated
- **Dictionary parity is good** (`app_state.i18n`): EN has 1,076 keys and DE, ZH and CS have 1,074 each. All three are missing `syn.st_idea` and `syn.st_committed`, the synergy stage labels shown on the Execution Hub.
- **The new IL screens are not tagged:**

  | Screen | data-i18n count | Size |
  |---|---|---|
  | `due-diligence.html` / `.js` | 0 | 615 lines of JS |
  | `deal-wizard.html` / `.js` | 0 | 751 lines of JS, 22 hard-coded headings in the HTML |
  | `org.html` | 0 | (`org.js` has 9) |
  | `deal-home.js` | 3 | |

- The conflict dialog and busy toast are English by design (`transitions.js:112`). The "Execution Hub" `<h1>` stays English in DE mode (screenshot taken).
- **109 static `data-i18n` keys have no dictionary entry at all**, so they render English: `employee.html` 69, `playbook.html` 18, `dashboard.html` 11.
- **Translations do not propagate:** the dictionary is copied into each deal DB when the deal is created (`db/dealSeed.js:68-88`). Translation fixes in later releases never reach existing deals.
- **Dates follow the browser locale, not the app language:** `toLocaleDateString(undefined…)` in `execution.js:507,580`, `org.js:352`, `dashboard.js`. `signage.js:70` hard-codes `en-US`.
- **Layout holds up:** in German at 390 px, the dashboard and Execution Hub showed no horizontal overflow (only the "Abbrechen" button and the bell badge clip).
- **Size: M.**

### R5-11: MEDIUM, VERIFIED. Accessibility on the IL pages
- **axe-core, WCAG 2.1 AA, logged in as Integration Leader in a real deal:**
  - **Critical `select-name`** on every page, starting with `#role-switcher-select`. Also `#ex-new-ws`, `#org-add-reportsto` and `#merit-reason-select`.
  - **Critical `label`** on `#ex-new-due`, 6 assessment owner/due inputs in the deal wizard, and `#merit-emp-name`.
  - **Serious `color-contrast`** on every page. The header module pills use `#a2acb9` on white, a ratio of 2.29. The count was 3,694 nodes on execution at volume and 490 on org.
  - `link-in-text-block` on the dashboard.
- **Dialogs:**
  - The conflict dialog (`transitions.js:255-510`) and the deal modal (`admin.js:2610ff`) set `role=dialog` and `aria-modal`. Neither has `aria-labelledby`, initial focus, a focus trap or focus return.
  - `admin.js` contains **zero** `.focus()` calls, and its modals have no Escape handler.
- **Announcements:** the busy give-up toast (`transitions.js:79-92`) has no `role="alert"` or `aria-live`, so a failed save is never announced to screen readers.
- **Motion:** `prefers-reduced-motion` appears **0 times** in the codebase, despite page transitions and a splash animation.
- **What is sound:** `<main>` and `<nav>` landmarks exist, `html[lang]` follows the language switch (`transitions.js:3935`), controls are real `<button>`s, and there is no `outline:none` on core controls.
- **Size: M.**

### R5-12: MEDIUM, VERIFIED. Uncaught exceptions are swallowed and the process keeps running
- **Where:** `server.js:7247`, `process.on('uncaughtException', err => console.error(...))`. A process that hit an unknown fault keeps serving.
- **Impact:** that can include a better-sqlite3 transaction or lock in an unknown state. Phase 8 turns a lock that is never released into endless 503s for everyone. The launchers have no supervisor to restart a crashed process either.
- **Fix:** log, then `process.exit(1)`, and add a restart loop to `start-real-deal.*` or document systemd. **Size: S.**

### R5-13: LOW, VERIFIED. Documentation and operator messages describe a pre-Phase-2 app
- **README.md** says:
  - it is "a self-contained demo";
  - "The demo dataset lives in **`db.json`**";
  - "while [ADMIN_TOKEN] is unset the API stays open".

  All three are false: the app is fail-closed and SQLite-backed, and README never mentions `DEPLOYMENT.md` or real-deal mode.
- **The server boot banner** says the same thing: `server.js:199` prints "`ADMIN_TOKEN not set — write/admin API endpoints are OPEN`". In fact an unauthenticated `POST /api/raid` returned **401**.
- **DEMO-RUNBOOK.md** tells presenters to run `node server.js`, which shows a login wall without `DEMO_OPEN=1`. It also mentions `PORTAL_AUTH=1`, which is vestigial (`server.js:230`).
- **Versioning:** `package.json` says `"version": "1.0.0"` while the tags are at `v2.1.0`, and `/healthz` reports no version.
- **`.planning/codebase/*`** was last touched on 2026-07-18. Six of its seven docs never mention SQLite, and each still cites `db.json` 3–11 times.
- **DEPLOYMENT.md** omits that `@napi-rs/canvas` ships only 4 platforms (darwin-arm64/x64, linux-x64-gnu, win32-x64). On linux-arm64, win-arm64 and musl the PDF pack degrades to 503. better-sqlite3 does cover all 8 platforms.

### R5-14: LOW, VERIFIED. Repo and release hygiene
- **Tracked dead weight** is included in every `git archive` release zip, because there is no `.gitattributes export-ignore`:
  - `db.json` (562 KB, frozen; only migration scripts and the broken RAG read it);
  - `data/ma-portal.db` (2 MB migration intermediate);
  - `.planning/` (250 files, 16.9 MB, including 11.8 MB of graphs);
  - `test/` and `.claude/CLAUDE.md`.
- **Working-tree clutter** is correctly gitignored: 15 root screenshots, `ma-portal.zip` (67 MB), `looxmaxing/`, `slidedeck interaction/` (4.7 GB) and the `.pptx`. But it leaks through R5-06.
- **No CI** exists in the repo. Tests and the WAL pre-commit hook only run where someone remembered (`core.hooksPath` is per-clone).
- **The release build is not scripted in-repo.** The portable Node binary is copied forward from the previous release zip, with no checksum or provenance check.

### R5-15: LOW, VERIFIED. PWA leftovers wipe the AI model cache on every page load
- `manifest.json` is linked by no page. `sw.js` is a kill-switch.
- `transitions.js:1198-1214` runs on all 19 pages. It unregisters service workers and **deletes every Cache Storage entry on every load**. That includes Transformers.js' model cache, so AI-Insight re-downloads its weights from Hugging Face on every visit, against the offline posture in `DEPLOYMENT.md`.
- **Fix:** drop the kill-switch (it was a dev-era measure) and either delete `sw.js`/`manifest.json` or make them real.

### R5-16: LOW, VERIFIED. `/healthz` does a full database read without auth
- **Where:** `server.js:783-786`. It is unauthenticated, runs a full `readDb()` per probe (unbounded CPU per request) and returns no version.
- **Fix:** `SELECT 1` on each open handle, plus `version` from `package.json`.

### R5-17: LOW, VERIFIED. Code-health notes (maintainability, not individually blocking)
- **`server.js`:** 7,378 lines, 149 routes, 82 top-level functions, and **33% comment lines** (2,446), dense with phase and decision IDs. The provenance is good, but the file reads poorly.
- **Other large files:** `transitions.js` (3,972), `employee.js` (3,663), `admin.js` (2,890), `synergy-quest.js` (2,529). Client modules are properly IIFE-scoped, with no top-level globals or global-state hazards found.
- **About 15 separate HTML-escape helpers** with different semantics. Some omit `'`: `transitions.js:641,1575,3906`. One shared `esc()` would shrink the XSS surface.
- **Sync I/O in request paths:** the base64 media upload decodes and writes up to a 50 MB JSON body synchronously (`server.js:148`, `2172-2178`), and login uses `scryptSync` (`:234`). Both are acceptable at about 15 users.
- **The admin console has no UI** for `POST /api/auth/change-password` or `POST /api/admin/users/:u/revoke-sessions`. Users cannot rotate the published demo password themselves, and an admin cannot kill a session from the UI. `GET /api/lessons` is dead: there is no client caller.
- **Tidy:** no TODO/FIXME/HACK markers.

---

## Test-suite coverage map (for planning)
- **Runtime:** 61 files, 779 tests. About 10 s in parallel, 47–54 s with concurrency 1.
- **Routes:** 149 in total.
  - **109 are exercised by name in a test.** That includes every IL-critical family: deals, DD, org, RAID, tasks, synergies, reports, auth, admin users and deals.
  - **40 have no behavioural test:**
    - CMS and content: slides (4), banners (3), courses and lessons (4), pages, media, modules (3), processes (3), `questions/*` (3), `dashboard/reorder-widgets`;
    - communications and alerts: `communications/*` (3), `alerts/*` (3), `notifications`;
    - AI: `rag/search`, `ai/insight`;
    - assessments: `assessment/latest`, `assessments`;
    - other: `projects/:id` activate and delete, `hrbps/:id` DELETE, `employees/get-or-create`, `settings/new-ma` (see R5-08), `healthz`.
  - All 149 are still covered *structurally* by `auth-route-inventory` (401 gate) and `write-validation-coverage` (a validator per write route).
- **Frontend (about 26k lines):** no browser or end-to-end test. Client code is checked through regex source scans, plus a `node:vm` harness for `transitions.js`'s wrapper (`client-busy-retry`, `client-conflict-dialog`). This is how R5-03, R5-09 and the DD input loss got through.
- **Tests that pass while the feature is broken:** `rag-upload` (R5-07). The structural inventory tests prove a gate exists but not that the route works.

## Cheap wins (each ≤ 1 hour)
1. Add a `listenLocal()` helper, use `app.listen(0,'127.0.0.1')` across `test/`, and close out the flake class (R5-02).
2. Add `MA_AUDIT_DB_PATH` to the 9 test files, plus a fail-loud guard in `dbFiles.js` under `NODE_TEST_CONTEXT` (R5-04).
3. Bump `?v=` for `transitions.js`, `execution.js`, `org.js` and `login.html`'s `style.css`, and add a stamp-vs-hash test (R5-03).
4. In `due-diligence.js`, check `r.ok` and clear inputs only on success (R5-09).
5. Fix the `server.js:199` banner, `README.md` and `DEMO-RUNBOOK.md`; set the `package.json` version and expose it on `/healthz` (R5-13, R5-16).
6. Add the `syn.st_idea` and `syn.st_committed` translations in DE, ZH and CS (R5-10).
7. Give the 4 unlabelled selects and inputs an `aria-label`. Add `role="alert"` to the busy toast. Add `aria-labelledby`, initial focus and focus return to the conflict dialog and deal modal. Add a global `@media (prefers-reduced-motion: reduce)` block (R5-11).
8. Remove the cache-wipe kill-switch and the unlinked `manifest.json`/`sw.js` (R5-15).
9. Make `uncaughtException` exit(1) (R5-12).
10. Gate `POST /api/settings/new-ma` to demo mode (R5-08).
11. Add `.gitattributes export-ignore` for `.planning/`, `test/`, `db.json` and `data/ma-portal.db` (R5-14).

## Real work
- **R5-01** dirty-row-only writes and audit: M. Highest value.
- **R5-05** per-collection reads, paging and the DD batch endpoint: M–L.
- **A browser smoke suite:** Playwright plus axe over the 6 IL pages, in CI. It would have caught R5-03, R5-09 and R5-11: M.
- **A minimal CI pipeline** running `node --test` on 2 OSes: S–M.
- **i18n for DD, the wizard, org and deal-home**, plus a strategy for pushing dictionary updates to deals that already exist: M.
- **Rework or remove the download-zip (R5-06).** Decide the RAG upload's fate (R5-07): S–M each.
- **A scripted, checksummed release build:** S–M.

---

## Top actions for v3.0 (ranked)
1. **Stop the write and audit amplification (R5-01).** Change `db/store.js` `writeDb` so it skips unchanged rows, with seq-only updates for reorders and no audit delta. Prove it with a test: one write equals one audit row on a 1k-row deal. *Why:* the audit DB is unbounded and append-only, at 3.6 MB per save at realistic size; the compliance trail is 95%+ noise; each save blocks the event loop ~90 ms. **M**
2. **Make shipped client code actually reach browsers (R5-03).** Bump the stamps now, then automate them: a content-hash `?v=` rewrite when HTML is served, or a CI test. *Why:* the Phase 8/9 concurrency UX is invisible to existing users for 30 days. **S**
3. **Make the test signal trustworthy (R5-02, R5-04):**
   - bind tests to 127.0.0.1;
   - isolate `audit.db` and `runtime.db` in every test;
   - add CI;
   - add a Playwright and axe smoke run over the IL pages.

   *Why:* a 35% flake rate trains "rerun until green", and tests currently pollute the real compliance log. **S + M**
4. **Scale the read path (R5-05).** Add per-collection reads, paginate RAID and tasks, and give DD a single batch load. *Why:* p95 is already about 480 ms at 10 users × 3 lists on one realistic deal, and it grows linearly. **M–L**
5. **Close legacy demo-era hazards in real-deal mode (R5-06, R5-07, R5-08, R5-15, R5-16).** Covers the download-zip, the dead RAG upload, the global email wipe, the cache wipe and `/healthz`. *Why:* each one is a latent data-loss, leak or freeze path that the IL never asked for. **S each**
6. **Bring the IL screens up to the showcase's i18n and a11y bar (R5-09, R5-10, R5-11).** Cover the DD, wizard, org and deal-home strings, labels, dialog focus, live regions and reduced motion; fix DD's lost input. *Why:* workstream leads at DE, CZ and CN sites join in v3.0 (Phase 12), and the IL is the key persona. **M**
7. **Make the documentation and release process match reality (R5-13, R5-14).** Update README, the runbook, the boot banner and the versioning; script the release build with Node checksums; add export-ignore. **S**

## What I did not cover
- **Security and authorization semantics:** clean-room, clearance and CSRF/session design belong to other lanes. I only flagged static `sent_emails`/`uploads` as a pointer (R5-08).
- **Platforms:** no Windows or Linux runs. The flake mechanism is proven on macOS; Linux dual-stack binding behaves differently, so CI on Linux may flake less. I did not verify that.
- **Accessibility depth:** no screen-reader walkthrough and no full keyboard traversal of every page. axe covers about 30–40% of WCAG; it ran on 6 IL pages only, not the employee, admin, PMO, assessment or signage pages.
- **Performance depth:**
  - single-deal volume only; no multi-deal or multi-process load and no soak;
  - client render time was only coarsely measured (networkidle about 1 s for execution at 5k rows);
  - write latency under Phase-8 multi-process contention was not re-measured.
- **Dependencies:** no `npm audit` (offline). The posture judgement rests on locked versions and advisories I know of up to mid-2026: `cookie@0.7.2`, `path-to-regexp@0.1.13`, `on-headers@1.1.0`, `body-parser@1.20.5` and `pdfjs-dist@5.4.296` are all past known CVE fixes. **Express 4 is maintenance-only**; check its EOL date against the Express support schedule (SUSPECTED to be close).
- **Other surfaces:** `synergy-quest.js` gamification, `signage.html` and the admin CMS were not reviewed beyond metrics. I did not check that the `?v=` stamps of the other 20+ assets are current; only the IL files were checked.
