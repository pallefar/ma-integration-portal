# Phase 14 — Deal Files, Limits & Legacy Hazards — PRD / locked decisions (orchestrator, 2026-10-11)

Input for `/gsd-plan-phase 14 --prd` (research/UI-spec skipped, as Phases 10–13). Requirements: SAFE-04, SAFE-05, SAFE-08.
Depends on Phase 13 (plan from its CLOSED head — 13-12..14 open at writing) and 12 (DATA-04 purge, test-isolation guard, smoke).
Evidence: R1-06, R1-10, R2-12, R3 F-3/§1.2/§4.2(b), R5-06, R5-08 (+ "related legacy debt"), R1-05, PLAN-REVIEW PR-14/25/26; no
11-/12-CARRY-INS row targets 14. Each change is mode-neutral, real-only (`MA_MODE=real`) or deal-bound-only; the demo store stays.

## Problem (measured by the review, re-verified on HEAD 766195a)
**Files.** Comm send, media upload (any base64; no type/size/quota; no client caller) and slide upload write per-INSTANCE dirs
in the static tree (`public/sent_emails/`, `public/uploads/[slides/]` — server.js:9086-9118, :3649-3674, :3414-3433), shared by
all deals, served sessionless by express.static (:479) / the `.html` terminal (:439-454) before the gate (:1011), never audited,
filename in the URL; deletes unlink `path.join(public, url)` (:9143, :3680); deal delete (controlStore.js:566) and the DATA-04
purge (auditLifecycle.js:568) leave a deal's files behind.
**Limits.** `express.json` + `urlencoded` at 50 MB parse every path BEFORE auth (:295-296); oversize is unmapped (:304-309) → a
generic 500 + stack log (:9497). Largest legitimate non-upload body = Translations "Save all" (admin.js:2467-2475, every key ×
language): 1,076 keys × 4 (the brief's "698" is stale) = **310,234 B**. Org paste import at its 500-row cap (validators/org.js:95)
86,918 / 167,918 long-name / 143,418 CJK B; roster CSV import = one employee per request (dashboard.js:2068).
**Legacy.** `download-zip` (:2610-2635) `execSync('zip -r')`s the tree: 4.6–4.97 GB / 91–103 s on the loop, ships gitignored
local-only files, unbootable, 500 on Windows (R2-12, R5-06); control-plane (resolver.js:48), so DEMO_OPEN never reaches it.
`new-ma` (:3082-3112) unlinks EVERY `comm_*` incl. the showcase email and other deals' files, unaudited (R5-08). In a deal,
`settings {demoMode:false}` (:2953) and `/api/projects` writes (:3226-3296, DEFAULT_WRITE_ROLES) flip it onto the empty `custom*`
lanes and swap its CMS; `migrate-db` (:3874) returns an unaudited SQL roster dump and fakes a "connected" DB config.

## Locked decisions
**D-14-01 Deal file store (SAFE-04).** `<DEALS_DIR>/<dealId>.files/<kind>/<fileId>.<ext>` (real `<MA_DATA_DIR>/deals/`, dev
`data/deals/`, tests inherit `MA_DEALS_DIR`), kinds `communications|media|slides`, path only via new `dbFiles.dealFilesDir()`
(case-sensitive `DEAL_ID_RE`, throws like `dealDbPath`); dirs 0700, files 0600 (temp → fsync → no-overwrite publish),
`assertTestIsolation` per write; already gitignored, outside `public/`, NO new table (committed DBs byte-identical). Lane by
RESOLVED STORE: deal-bound ⇒ store, every mode; dev/demo demo store ⇒ today's public dirs; real mode + non-deal resolution
(unbound lane, 11 SC-02) ⇒ file writes/deletes `409 {error:'Choose a deal first: files are kept with a deal.', dealRequired:true}`
(no `conflict` marker, :9435 precedent; Phase 17 reuses it) — real mode never touches `public/`. No migration: no shipped
release holds real-mode data (v2.1.0 deals sit in the committed dir real mode never opens, D-10-01); legacy URLs fail closed.
**D-14-02 Authenticated route.** `GET /api/files/{communications|media|slides}/:file` (three routes, one handler, HEAD = GET)
behind the full gate. `:file` = `<fileId>.<ext>`, server-minted (`comm_…`/`media_…` = the record id, `slidefile_…`), checked
after param decoding by a case-SENSITIVE per-kind regex before any fs call; path = bound dealId + kind dir + name,
containment-asserted, `lstat` regular file, else 404; the ext stays (`openHtmlSlide` frames `.pdf` unsandboxed,
transitions.js:1200); original names never reach URLs, disk, headers, logs or audit. Headers: server ext table →
`Content-Type`, nosniff, `no-store`, `Cross-Origin-Resource-Policy: same-origin`, `Content-Disposition: inline;
filename="<fileId>.<ext>"`; CSP replaced — comms `sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:;
form-action 'none'`, HTML/image slides + images `SLIDE_SANDBOX_CSP` (slideUpload.js:25), PDF the app CSP (PD-17). No Range, no
ETag/Last-Modified: always a full, audited 200.
**D-14-03 Read rule + audit.** Lookup only in the resolver-bound deal (resolver.js:102-119) ⇒ wrong-deal/unknown id or non-deal
resolution 404 `{error:'Not found'}`, unaudited (:9396). Role = the owner's rule: three ROLE_READ_POLICY rows mirroring
`/api/communications` (STAFF), `/api/media`, `/api/slides` (ALL) + a per-role drift test ⇒ existing 403 role-read (Phase 11:
role ⇒ 403, hidden ⇒ 404). Comm/media files need their record in the bound deal; slide files are owned by its slide dir; a
future clearance-scoped kind must pass `recordVisibleTo`. Audit: control-plane `deal-file-read` (actor, dealId, kind/file)
BEFORE the bytes (busy ⇒ 503, nothing served; demo store none), windowed like lib/denialAudit.js — ≤ 1 immediate row per (actor,
deal, kind, file) per 15 min, repeats folded into the key's next row `{count, folded:true}`, capped map (embeds re-fetch).
**D-14-04 Writes.** Comms (deal lane): file, then record (`htmlEmailPath`, `fileBytes`, `fileSha256`) via writeDb; failed writeDb
unlinks the file; delete = record, then file; demo-lane unlink containment-checked. Media in EVERY mode via the slide checker
made per-kind (slide bodies byte-identical): PNG/JPEG/WebP/PDF by ext AND declared type AND magic, ≤ 10 MiB decoded,
`MA_MEDIA_QUOTA_MB` (100); fixed 415 `media-type-refused` / 413 `media-too-large` / 413 `media-quota-exceeded`, nothing written.
Slides (deal lane): per-deal quota (`MA_SLIDE_QUOTA_MB`), one `deal-file-created` {kind, file, bytes, sha256} per upload.
**D-14-05 End of life = DATA-04 purge path.** One idempotent `removeDealFiles(dealId)` (`legacy` ⇒ no-op) runs (a) INSIDE
`auditLifecycle.purgePartition` after the partition goes (route ≡ `scripts/audit-admin.js`, 12-12 rule) and (b) in `DELETE
/api/admin/deals/:id` (DEPLOYMENT §3 step 6) BEFORE `deleteDeal` (failure leaves the deal intact; EBUSY/EPERM ⇒ busy 503, WR-03).
One `deal-files-removed` {count, bytes, trigger} BEFORE unlinking (no names, no per-file rows); `deal-files-remove-failed` on
error.
**D-14-06 One static guard (+ Phase 15 seam).** New `lib/staticGuard.js` mounted once after the lockdown (:276), before the
no-store middleware, parsers, `/`, slides mount, `.html` terminal, stamper, express.static. It judges FILE IDENTITY (12-REVIEW
CR-01): raw, decoded, posix-normalised, backslash-folded, lowercased, `//`-collapsed forms with Windows dot/space folding, plus
`realpathSync.native` of the file static would serve (case, 8.3, symlinks). Only Phase 14 rule: real mode ⇒ any form or identity
under `/sent_emails` or `/uploads` (bare/extensionless too) ⇒ 404 `text/plain`; `/uploads/slides` is not mounted in real mode;
dev/demo have no rule (legacy byte-for-byte). Seam, NOT built: Phase 15 adds module page/asset rules + the `/` fallback to this
table, `moduleAllows(forms)` to `gatePolicy` (:935) BEFORE the `isOpenMode` short-circuit (:1057), and maps `/api/files/<kind>/`
per kind (communications → comms, media/slides → cms) — no new middleware.
**D-14-07 Body limits (SAFE-05).** Default `express.json({limit:'2mb'})` = 4 × 310,234 B (1,240,936) rounded up to the next clean
value (6.8× today; 4× holds to a 512 KiB dictionary), on `/api` only. Large-body allowlist = EXACTLY `POST /api/media`,
`/api/slides/upload`, `/api/rag/upload` (one predicate, all canonical forms), skipped by the default parser and parsed at `'16mb'`
by the gate only AFTER session, must-change, bind and role checks (open mode: before validation) — anonymous/employee callers
never make the server buffer > 2 MiB. 16 MiB = 10 MiB decoded as base64 (13,981,016 B) + envelope, rounded up: Phase 13 test
(f)'s 13.33 MiB probe still gets `slide-too-large`; the 6.32 MB demo guidebook (8.43 MB data URL) fits ~2×. `urlencoded` removed
(no form posts; R1's CSRF note). Parser errors mapped where raised (:304 is upstream of the gate): 413 `{error:'This request is
too large.', code:'body-too-large'}` (fixed, no stack log), 400 unchanged, 415 bad encoding.
**D-14-08 Legacy hazards (SAFE-08).** (a) `download-zip` DELETED in every mode (route, CONTROL_PLANE_PATHS entry, no-get-mutates
allowance) + the "Portable IMO App Package" card (admin.html:674-701, admin.js:2978); REL-01 zips are the artifact. (b) Real mode:
`new-ma`, `migrate-db` join D-13-05's unmount (:968-975, one table) ⇒ 404 for every caller/spelling before the gate. (c)
Custom-lane switches are demo-store-only in every mode: new-ma, migrate-db, `/api/projects` POST/DELETE join DEMO_ONLY_PREFIXES
(:916, existing 403 body); a non-demo `settings` write carrying `demoMode` gets that body via `denyAt`. (d) Demo-store new-ma
deletes only files named by the pre-reset `customCommunications` that no remaining record (communications, project bundles)
references, inside the demo-lane dir. Client: DEMO/CUSTOM pill, custom-M&A and DB-migration cards render only where allowed.

## Out of scope / deferred
Module gate/registry/page rules/`/` fallback (15, seams only); showcase chrome + Projects tab (16/17); unbound lane for non-file
routes (17); clearance-scoped attachments (18); file rate limits, no-filename logs, knob validation, read-auditor SIGTERM flush,
`/readyz` disk (20); file-dir backups (21); employee inbox (22); removing the custom lanes; per-deal RAG; video/Range; AV.

## Acceptance
Proof = node --test per decision + a Phase 14 scenario on the Phase 13 runner pattern (real/dev/demo-open lanes, committed-DB and
real-mode `public/` hash guards) + smoke entries (admin console real/dev, deal-store slide overlay, comm link; 1440/390).
1. Real lane, IL in deal A: comm send ⇒ `/api/files/communications/<id>.html`, file under `<MA_DATA_DIR>/deals/<A>.files/`
   (0600/0700); GET ⇒ 200 with exactly the D-14-02 headers (literal CSPs, no ETag, `Range` ⇒ full 200); `public/` hash unchanged;
   no cookie 401; employee 403 role-read; IL bound to B (even if also in A) 404; `COMM_…`, `%2e%2e%2f…`, `..%5c…`, `<id>.HTML`,
   `<id>.html.` 404 with an outside canary unread; real-mode non-deal file writes/deletes 409 `dealRequired`.
2. First read = 1 `deal-file-read`; 99 more in 15 min = +0; after the window the folded row (count 99) + a new row; busy audit ⇒
   503, zero body bytes; demo-store reads and unknown-id 404s = 0 rows.
3. Real mode: `/sent_emails/comm_1783454326531.html`, `/SENT_EMAILS/…`, `/%73ent_emails/…`, `/js/../sent_emails/…`,
   `//sent_emails//…`, `/sent_emails./…`, `/uploads`, `/uploads/slides/<f>`, `/uploads/foo`, a symlink alias ⇒ 404 text/plain,
   never bytes or index.html; dev/demo: the same tracked email ⇒ anonymous 200, byte-identical.
4. archive → seal → export → retention (test clock) → purge removes `<id>.files/`, event first; deal DELETE removes `<id>.db` +
   `<id>.files/`; reruns record nothing; route ≡ CLI; simulated EBUSY ⇒ 503, deal still registered.
5. Media `.svg/.html/.txt/.exe`, type mismatch, bad magic ⇒ 415; 10 MiB+1 or over quota ⇒ 413; none writes. 2 MiB+1 to a
   non-allowlisted route ⇒ 413 `body-too-large` + no-store, no stack log; a test recomputes the Save-all from a read-only demo.db
   snapshot (⇒ 200; 4× ≤ default); 16 MiB+1 allowlisted ⇒ 413; anonymous/employee 15 MiB `POST /api/media` ⇒ 401/403 with the
   large parser never invoked; the route inventory pins exactly three large-body routes; Phase 13 slide tests unchanged.
6. download-zip 404 for every role/mode; real new-ma/migrate-db 404 for every caller/spelling; dev deal-bound new-ma, migrate-db,
   projects writes, `settings {demoMode}` ⇒ 403 demo-only, deal DB byte-unchanged; demo-store new-ma (live, temp dir) keeps
   `comm_1783454326531.html`; real console shows no pill/custom/migration card; no mode shows the Portable card.
7. Suite 20× green; soak; Phase 9 walk (+ --demo-open), Phase 10 runner (all lanes, demoShowcaseUnchanged), Phase 13 runner (both
   CSP modes), Phase 14 scenarios pass; committed DB hashes unchanged; smoke green, 0 CSP violations; the deal-store slide opens
   in the sandboxed overlay WITH the session at 1440/390; admin console screenshots at 1440/768/390.

## Demo-mode contract
Byte-for-byte: data/demo.db + control.db (1 comm → tracked `public/sent_emails/comm_1783454326531.html`: URL, anonymous 200,
bytes, record; 1 slide → static `/slides/welcome-slide.html`; 0 media); demo-lane comm send (`/sent_emails/<id>.html`) and slides
(`slidesDir()`, `/uploads/slides/…`, Phase 13 headers/env); legacy `/uploads/*`; the DEMO_OPEN walk (no admin console, IN-C07).
Listed differences: Portable card + download-zip gone; Reset spares the showcase email and still-referenced files (R5-08); media
limits in every mode (no demo UI); oversize ⇒ 413 not 500; RAG cap 50 MB → 16 MiB; custom-lane switches refused when deal-bound.

## Risks / planner notes
- Deliberate test amendments (record each): caching-safe07 :87-92 (`jsonParser` layer), :99-110/:145-147 (exact 413), :339-340
  (literal `'50mb'`) — keep "no-store before every parser"; db-artifact-exclusion :41-97; deal-resolver :252-254; no-get-mutates
  :21/:143/:189/:436-455; client-authz-hiding ~:894 (keep :951); busy-503 :379-384 (`.txt` media probe ⇒ PNG, no writes to the
  real `public/uploads`); deployment-role-matrix (three order-sensitive READ rows in DEPLOYMENT.md).
- Phase 13's real-lane slideSandbox (13-12) uploads as an UNBOUND admin ⇒ 409 now: bind a deal, accept `/api/files/slides/…`;
  D-13-04's per-instance slide quota becomes per deal in the store.
- Browser: prove in Chromium that the sandboxed overlay iframe (same-site initiator) and the `target=_blank` comm link carry the
  SameSite=Strict session; if not, STOP and escalate — no URL capability tokens.
- `%2F` arrives decoded in `:file`; Windows: realpath.native, dot/space folding, EBUSY ⇒ 503; 70 `public/uploads/slides/*_x.html`
  are a fixed test leak (11-02→13-03). DEPLOYMENT.md: layout, backups, purge/delete, limits, real-mode unmounted list, 'local'
  welcome videos under `/uploads/`. Phase 20 carry-ins: read-auditor flush, file rate limits.

User confirmation needed: only the Portable-card removal is visible in a logged-in demo build — default PROCEED (mandated by
SAFE-08/SC3; unused by the DEMO_OPEN showcase and DEMO-RUNBOOK).
