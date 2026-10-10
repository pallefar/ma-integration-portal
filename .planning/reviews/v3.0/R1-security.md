# R1 — Security & MNPI Posture (v3.0 production-readiness review)

Reviewer lane: R1 · Date: 2026-10-10 · HEAD `56ca821` (Phase 9 closed; v2.1.0 = last whole-codebase review)
Method: `git diff v2.1.0..HEAD` code review of Phase 8/9; whole-app pass over authz, accounts, HTTP surface,
injection, leakage, dependencies; **live probe** against an isolated instance (scratch copies of `demo.db` +
`control.db`, port 4311, fail-closed mode, no `DEMO_OPEN`), plus a headless-Chromium proof for the sanitizer.
Probe script + raw output: `scratchpad/r1/probe.js`, `probe-out.json`, `xss-proof.js`. Server killed; no repo
file touched except this report (routes that write files under `public/` were proven by code trace, not run).

Severity is judged against *"production on a shared internal host holding MNPI, ~15 users of mixed roles"*.
Items already listed as fixed/accepted in `.planning/security/*.md`, `08-SECURITY.md`, `09-REVIEW.md` are not
re-reported unless I show a regression or a false premise.

---

## Executive summary

The Phase 8/9 engineering is careful and the controls it promises mostly hold (fixed 503/409 bodies, audit
inside the write transaction, serialized control-plane RMW, marker-based 409 client handling, bounded jittered
retry, fresh per-request db context). **But the app is not production-ready for MNPI on a shared host today**:

1. **No way to provision real users** — the only accounts are the four committed demo accounts with a password
   printed on the login page; nothing forces rotation or refuses to boot. (BLOCKER)
2. **Phase 9 turned a latent clean-room write gap into a disclosure oracle**: an uncleared deal member can read,
   overwrite and delete a restricted-provenance task/RAID entry if they know its id — reproduced live. (HIGH)
3. **The HTML sanitizer is bypassable in four ways and CSP `unsafe-inline` is no backstop** — a `pmo` can plant
   JavaScript that runs in the admin's browser (stored XSS → privilege escalation); HTML slide upload needs no
   bypass at all. (HIGH ×2)
4. **Authorization is too coarse for the stated personas**: `employee` reads synergy financials, RAID, roster,
   communications; `pmo` can rewrite menus/pages/settings — including flipping `demoMode` and setting the Gemini
   key. This collides head-on with the v3.0 ask "admin can disable parts of the app". (HIGH)
5. Runtime-written files (`/sent_emails/*.html`, `/uploads/*`) are served **without authentication** and shared
   across deals; audit.db is amplified ~10× with no-op rows; login throttle locks out the whole team behind a
   proxy; `compression` has an open HIGH advisory. (MEDIUM ×5)

---

## PASS A — Delta since v2.1.0 (Phase 8 concurrency, Phase 9 optimistic locking)

What I verified **holds** (one line each, VERIFIED):
- 503 path: `isBusyError()` keys on `err.code` prefix only (server.js:363); fixed literal body + `Retry-After: 1`,
  `headersSent` guard (server.js:7196-7211). No SQLite text/paths reach the wire.
- 409 path: single `conflictBody()` (server.js:377-387) mapped by the central middleware (server.js:7227);
  `conflict:true` marker, client never keys on status alone (transitions.js attemptFetch); never auto-retried.
- Audit append runs as the last step **inside** `writeDb()`'s `.immediate` transaction (db/store.js:553-611) — the
  Phase-8 CR-01 duplicate-row fix is intact; `D-11` anonymous-actor refusal still throws inside the txn.
- Client retry: ≤2 retries, 300 ms jitter, `Retry-After` clamped to 60 s, only absent/string bodies replayed,
  `Request` objects never replayed (WR-05); give-up toast is `textContent`.
- Control-plane RMW (`updateUser`, `updateDealSetup`, `updateDealMembers`, `setDealMemberGrants`, `archiveDeal`,
  `createDealDeduped`) all run SELECT-inside-`.immediate` (db/controlStore.js).
- `conflictIfStale()` arms its clearance closure on a **fresh per-request** context object (db/resolver.js:144) —
  no cross-request filter leak. Version is server-authoritative in the WHERE layer (client cannot rewind it:
  stale → 409, negative/garbage → 400 — probed live).
- SQL: `${key}` table names come from the fixed `ARRAY_COLLECTIONS` set, values are bound parameters; the
  `json_extract` WHERE clause is parameterized. No injection surface.

Delta findings: **R1-02** (409 disclosure oracle + unguarded writes on tasks/RAID), **R1-07** (audit no-op
amplification, pre-existing but now inside the write lock), **R1-11** (version omission = silent last-writer-wins).
Minor: the client retries *any* `/api` 503 — e.g. the permanent `GET /api/reports/pack` "unavailable on this
platform" 503 is retried 3× and then shows "your change was not saved" for a read (cosmetic).

---

## Findings

### BLOCKER

#### R1-01 — Demo accounts with a published password are the ONLY accounts; no provisioning, no forced rotation, no boot refusal
**VERIFIED.** `data/control.db` ships exactly four users — `admin`, `karen` (hrbp/Integration Leader), `pmo`,
`employee-demo` — all verifying `TEdemo!2026` (scratch-copy query). `public/login.html:41-46,70` renders and
auto-fills that password in **every** mode. `scripts/set-admin-password.js:82-104` rotates **only `admin`**
(DEPLOYMENT.md step 1 says the same). There is **no** user-management route at all — the only `/api/admin/users*`
route is `revoke-sessions` (server.js:2429); no create/disable/role/reset. Nothing at boot checks whether an
account still verifies the demo password when `DEMO_OPEN` is unset.
**Scenario:** a real-deal host is stood up per DEPLOYMENT.md; admin is rotated; `karen` is not. Anyone on the
intranet logs in as the Integration Leader with the password printed on the login page and reads every deal she
is a member of. Alternatively, the 15 real users are forced to share `karen`/`pmo`, destroying audit attribution
(every `actor_username` is the same) — the compliance control the whole milestone rests on.
**Fix:** (a) boot-time guard: if `DEMO_OPEN!=='1'` and any account verifies `TEdemo!2026`, refuse to serve
anything but `/login` + `/api/auth/change-password` (or refuse to boot); (b) admin user CRUD
(`POST/PATCH/DELETE /api/admin/users`, audited, admin-only prefix already exists); (c) hide the `.lg-demo` panel
unless `/api/auth/me` reports open-demo mode; (d) ship a real-deal `control.db` seed without `karen/pmo/
employee-demo`. **Size: M.**

### HIGH

#### R1-02 — Clean-room bypass on the task/RAID **write** path; Phase 9's 409 body is a disclosure oracle
**VERIFIED live.** Setup: deal with members `karen` (granted DD area `hr`) and `pmo` (no grant). `karen` files an
`hr` finding "R1-SECRET retention package for CFO Jane Doe / EUR 1.2M retention bonus" and converts it (task +
RAID, both stamped `clearanceArea:'hr'`). `pmo` correctly sees **neither** in `GET /api/integration-tasks`,
`GET /api/raid`, `GET /api/dd/findings` (the v2.1.0 F-1 read filter works). But with the record id:
- `POST /api/integration-tasks {id, version:999}` → **409 with the full record** (title, notes, source,
  clearanceArea) — `currentVersion:0`.
- `POST /api/integration-tasks {id, status:'done', title:'overwritten by uncleared pmo'}` (no version) → **200**;
  karen's view now shows the overwritten title, `updatedBy:'pmo'`.
- `DELETE /api/integration-tasks/:id` → **200**. Same three results on `/api/raid` (RAID 409 also echoed the
  `notes` with the bonus amount).
Root cause: server.js:3149-3156 (POST tasks), 3201-3209 (DELETE tasks), 4379-4382 (POST raid), 6056-6061
(DELETE raid) look the record up in the **raw** lane and never call `resolveTaskClearanceArea()` /
`resolveRaidEntryClearanceArea()`; `conflictIfStale()` is called with no `clearanceFilter`; and
`CLEARANCE_SCOPED_COLLECTIONS` (db/collections.js:51) lists only `ddFindings`/`ddRequestItems`, so the store-layer
backstop (Phase 9 CR-01 fix) does not fail closed for the two lanes that *also* carry `clearanceArea`.
Precondition: the id (`task_<base36 ms><8 hex>`, 32 random bits — not brute-forceable, but routinely visible to
a cleared colleague's screen, exported CSV, kanban DOM, or shared URL). Authorization must not rest on id secrecy.
**Fix:** one `assertRecordVisibleOr404(req, db, deal, record)` applied before `conflictIfStale` on all four
upsert/delete paths (and the status-flip branch); return **404** (not 403) so existence is not confirmed; add the
four task/RAID collections to `CLEARANCE_SCOPED_COLLECTIONS` with a `clearanceArea`-aware filter; extend
`test/task-access-filter.test.js` to writes/409 bodies. **Size: S–M.**

#### R1-03 — HTML sanitizer bypassed four ways; CSP `unsafe-inline` means stored XSS executes → pmo→admin escalation
**VERIFIED live + Chromium.** As `pmo`, `POST /api/pages` (DEFAULT_WRITE_ROLES: admin/hrbp/pmo) stored these
bodies **unchanged** (read back by `employee`):
- `<img src="x"onerror="…">` — no separator between attributes; regex needs `[\s/]` before `on*`
  (lib/sanitizeHtml.js:52-54). Chromium: **handler fired** when assigned via `innerHTML` (page-layout.js:104's
  exact sink).
- `<a href="jav&#x61;script:…">` and `<a href="java\tscript:…">` — scheme regex (line 57) sees neither; the
  browser normalizes both to `javascript:` (`a.href` protocol = `javascript:` in Chromium).
- `<scr<script>ipt>…</scr</script>ipt>` → stored as a literal `<script>…</script>` (the documented T-03-36
  residual); inert under `innerHTML`, **executes** when rendered as a document (as the slide path does).
The accepted-risk premise ("CSP + textContent compensate", AR-03-03) is false for this class: `script-src` carries
`'unsafe-inline' 'unsafe-eval'` (server.js:124), so inline handlers and `javascript:` URLs are permitted, and the
render-time client `sanitize()` is the same regex family. **Scenario:** `pmo` saves a CMS page/banner; the admin
opens it; the payload calls `POST /api/deals/:id/grants` / `/members` / `/api/admin/download-zip` with the
admin's cookie (HttpOnly protects the token, not same-origin requests). **Fix:** replace the regex with a real
allowlist parser server-side (e.g. a tokenizer-based allowlist of tags/attributes/URL schemes, or `sanitize-html`;
`node_modules` is committed so vendoring is the project's normal path) and re-parse-then-serialize so
reconstruction is impossible; move inline scripts to nonces and drop `'unsafe-inline'` from `script-src`
(`'unsafe-eval'` + `wasm-unsafe-eval` can stay scoped to the Transformers worker); meanwhile render CMS HTML in a
`sandbox` iframe via `srcdoc`. Keep the four payloads above as regression tests. **Size: M–L.**

#### R1-04 — HTML slide upload is raw, same-origin, unauthenticated-to-read, framed without `sandbox`
**VERIFIED (code trace; not executed to avoid writing into the repo tree).** `POST /api/slides/upload`
(server.js:1935-1949) writes `content` byte-for-byte to `public/uploads/slides/<ts>_<rand>_<name>.html`;
`SlideUploadSchema.content` (validators/cms.js:264-272) is **not** an `htmlField`, so no sanitizer runs at all;
`express.static` serves it to anyone (R1-06); `openHtmlSlide()` (transitions.js:637-660) loads it in a
same-origin `<iframe>` with **no `sandbox` attribute**. Any admin/hrbp/pmo can therefore ship arbitrary JS that
runs with the portal origin in every viewer's session — no bypass needed. **Fix:** serve uploads with
`Content-Security-Policy: sandbox` and `sandbox="allow-scripts"` (no `allow-same-origin`) on the iframe, or
restrict real-deal uploads to PDF/PNG; put uploads behind auth (R1-06). **Size: S.**

#### R1-05 — Authorization matrix too coarse for the stated personas; CMS/settings surface is pmo-writable
**VERIFIED live (authz matrix probe).** Reads are gated on session existence only (D-05):
`employee-demo` received 200 with data for `/api/synergies` (targetM/realizedM), `/api/raid`,
`/api/integration-tasks`, `/api/employees`, `/api/settings`, `/api/communications`, `/api/pulses` (named mood
ratings + comments), `/api/org/positions`, `/api/hrbps` (emails), `/api/pages`; only `/api/org/flight-risk`
(403), `/api/assessment-instances` (401) and `/api/admin/*` (403) are role-gated. Writes: `pmo` got **200** on
`POST /api/settings {demoMode:false}` (server.js:1554-1566 has no admin check — flips every route onto the
`custom*` lane and hides the deal's seeded data for everyone), `POST /api/menus`, `POST /api/pages`,
`POST /api/slides/upload`; `SettingsUpdateSchema` also accepts `geminiApiKey` (validators/settings.js:72), so a
non-admin can switch on third-party egress of portal data (see R1-16). This is exactly the surface the v3.0 ask
"admin can disable parts of the app" would live on — today it is not admin-controlled. Role gates verified sound:
`/api/deals*` admin+hrbp, members admin-only, `/api/dd` excludes employee, `/api/admin/*` all methods admin.
**Fix:** add an explicit `ROLE_READ_POLICY` (same `{prefix, roles}` shape, fail-closed default) and move
`/api/settings`, `/api/menus`, `/api/pages`, `/api/banners`, `/api/slides*`, `/api/media`, `/api/i18n`,
`/api/courses` to an admin-only list (or an `/api/admin/cms/*` prefix); decide and document what `employee` /
workstream-lead may read in a real deal (Phase 12 scope). **Size: S–M.**

### MEDIUM

#### R1-06 — Runtime-written files are served without authentication and shared across deals
**VERIFIED live.** `GET /sent_emails/comm_1783454326531.html` → **200** with no cookie; `express.static` on
`public/` (server.js:175) runs before the `/api` gate, so everything under `public/uploads/` (media library,
slides) and `public/sent_emails/` (compiled communications, server.js:6883-6915) is world-readable to anyone on
the network who has or guesses a name (`comm_<ms><8hex>` ids appear in `GET /api/communications`, readable by
every member), survives logout, is never audited, and is **not deal-segregated on disk** (the DB lane is
per-deal, the files are not). Both dirs are gitignored (`.gitignore:41,67`) — correct — but `download-zip`
still bundles `public/uploads/*` (R-08, accepted). **Fix:** store under `data/files/<dealId>/`, serve via an
authenticated, resolver-bound `GET /api/files/:id` that applies membership + audit (`recordSecurityEvent`);
redirect legacy paths. **Size: M.**

#### R1-07 — Audit log is amplified ~10× with no-op rows (full MNPI snapshots) on every write
**VERIFIED.** After ~12 writes the scratch `audit.db` held **145 rows, 128 with `before_json == after_json`**;
a single `POST /api/raid` produced rows for `processCatalog`, `assessmentTemplates`, `checklistTemplates`,
`ddRequestTemplates`, `ddFindings`… Cause: `writeDb()` pushes an `update` delta for **every row of every
collection** it re-UPDATEs, changed or not (db/store.js:502 non-versioned branch; :453-456 versioned "untouched"
branch). Pre-existing (v2.1.0 store.js:336) and never surfaced by prior reviews, but Phase 8 moved the append
**inside** the write lock, so each click now holds `deal.db` + `audit.db` locks while inserting hundreds of
redundant rows — more contention/503s, and an audit trail that cannot answer "who changed what". Also: no
retention/rotation policy for `audit.db` (full snapshots of named retention lists, forever). **Fix:** guard with
`if (serialized !== priorRaw)` in both branches; add a test "one changed row → one audit row"; define retention
(policy item). **Size: S.**

#### R1-08 — Login throttle keyed on `req.ip` locks out the whole team behind a proxy; `TRUST_PROXY`/`ENABLE_HSTS` undocumented
**VERIFIED live.** 9 wrong passwords from one IP → **a subsequent correct login returns 429** (server.js:636-651).
Behind the documented reverse proxy/TLS terminator, `req.ip` is the proxy for everyone unless `TRUST_PROXY` is
set (server.js:90-107) — one careless or hostile user denies login to all 15. The session cookie gets `Secure`
**only** when `ENABLE_HSTS=1` (server.js:680-682). **Neither variable appears in DEPLOYMENT.md.** No per-account
lockout/backoff; password policy is 8 chars (validators/settings.js:25). **Fix:** per-username + per-IP sliding
window with backoff; set `Secure` when `req.secure || ENABLE_HSTS`; make `TRUST_PROXY` and `ENABLE_HSTS`
first-run checklist items (and mind R1-09's `proxy-addr` advisory if a CIDR is used). **Size: S.**

#### R1-09 — Open dependency advisories (`npm audit --omit=dev` on a scratch lockfile copy)
**VERIFIED.** Installed: `compression@1.8.1` — **HIGH** DoS via memory leak on premature close
(GHSA-vc2v-76pw-4v95, fixed ≥1.8.2); `proxy-addr@2.0.7` — **critical** IP-spoofing via IPv4-mapped IPv6 trust
subnet (GHSA-jqcg-44mw-7w3h; exploitable only when `trust proxy` is a subnet — which is one of the shapes the
code comment recommends); `qs@6.15.2` — moderate ×2 (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g); `body-parser`
≤1.20.6 moderate (invalid `limit` value only — n/a here, limit is valid). `express 4.22.2`, `path-to-regexp
0.1.13`, `cookie 0.7.2`, `send 0.19.2`, `serve-static 1.16.3`, `pdfjs-dist 5.4.296` (CVE-2024-4367 fixed),
`better-sqlite3 13.0.1`, `zod 4.4.3` — clean. **Fix:** bump `compression`, take the express patch that pulls
`proxy-addr`/`qs`, re-commit `node_modules`. **Size: S.**

#### R1-10 — 50 MB JSON bodies into a synchronous whole-object write
**VERIFIED (code).** `express.json({limit:'50mb'})` / `urlencoded` (server.js:148-149) apply to every route; a
single authenticated writer can post tens of MB that `JSON.parse`, zod-validate and `writeDb()` process
synchronously, blocking the event loop for all users far beyond the 1 s contention budget AR-08-01 accepted.
**Fix:** default 1–2 MB; raise only on `/api/media`, `/api/slides/upload`, `/api/rag/upload`. **Size: S.**

### LOW

#### R1-11 — Omitting `version` silently bypasses optimistic locking (by design)
**VERIFIED live.** `POST /api/raid {id,title}` with no `version` → 200 (`version` 1→2), while `version:0` →
409. The shipped UI always sends it; scripts/curl do not. Lazy adoption is deliberate (D-09), but for a
multi-user MNPI record set a missing precondition should at least be logged, and made mandatory in v3.0 once all
clients carry it. **Size: S.**

#### R1-12 — Password hashing cost below current guidance
`crypto.scryptSync(pw, salt, 32)` (server.js:233-235) uses Node defaults N=2¹⁴, r=8, p=1 (≈16 MiB); OWASP
recommends N=2¹⁷. Constant-time compare and dummy-salt timing equalization are correct. **Fix:** pass
`{N:131072}` with a hash-version marker for lazy rehash on login. **Size: S.**

#### R1-13 — Stale, misleading boot warning steers operators toward the shared-secret bypass
server.js:198-199 prints "ADMIN_TOKEN not set — write/admin API endpoints are OPEN" — false since Phase 2 (the
session gate applies regardless). An operator following it configures `X-Admin-Token`, a header-only,
non-expiring, unattributed-to-a-person admin identity. **Fix:** reword; consider removing the break-glass path in
real-deal mode. **Size: S.**

#### R1-14 — No `Cache-Control: no-store` on `/api` JSON
Verified header absent. Service worker is a deactivation script (`public/sw.js`) — **no** MNPI caching risk
there (brief's concern checked, clean). Back/forward cache on a shared workstation can still restore an MNPI
page after logout. **Fix:** `no-store` on `/api/*`, and `Clear-Site-Data: "cache","storage"` on logout. **Size: S.**

#### R1-15 — Personal data of colleagues readable by any member
`GET /api/pulses` returns `employeeName` + `rating` + `comment`; `GET /api/hrbps` returns emails. Fold into R1-05's
read policy (GDPR relevance for DE/CZ employees). **Size: S.**

#### R1-16 — Third-party egress of portal data is switchable by a non-admin
`GET /api/ai/insight` forwards the client-supplied `portal` payload and `/api/rag/upload` forwards PDF text to
Google Gemini when `geminiApiKey` is set (aiService.js:56,356,506); the key is writable via `POST /api/settings`
by `pmo`/`hrbp` (R1-05). Prior reviews noted the egress; the new point is who can enable it. **Fix:** admin-only
settings + an explicit real-deal `AI_EGRESS_ALLOWED` gate (default off). **Size: S.**

---

## Checked and sound (one line each)
- Auth gate: every `/api` route 401s unauthenticated (route-inventory test + probe); `/api/auth/me` leaks only the
  caller's own identity; `/data/*.db`, `/server.js`, `/package.json` are not reachable (SPA fallback 404/200 html).
- Cookie: `HttpOnly; SameSite=Strict; Max-Age=43200`, 256-bit token hashed at rest; CSRF covered by Strict +
  JSON-only writes + no CORS (urlencoded parser is a latent widening only if SameSite is ever relaxed).
- Demo→real pivot: `isOpenMode()` requires `req.isDemo` (resolver) — unchanged, holds.
- Upload path handling: media/slide filenames are regex-sanitized and prefixed; `DELETE /api/media/:id` unlinks
  only a server-built `url` (schema strips a client `url`). No traversal.
- Error handling: generic 500 body, stack to server log only; no request-body/PII logging found in server.js.
- `pmo.js:1073-1076` (flagged "unproven sink" in v2.1.0): all four `suggestions.push` objects are literals — **not
  a sink**; closed.
- `download-zip` excludes runtime/audit/deal DBs, `.env`, `sent_emails`; admin-only for all methods.

---

## Top actions for v3.0 (ranked)

1. **Real accounts** — admin user CRUD (audited), boot refusal on demo credentials in fail-closed mode, demo panel
   gated to demo mode, real-deal `control.db` seed. *Why:* R1-01 blocks any real use. *Where:* server.js auth
   section, db/controlStore.js, public/login.html, scripts/. **M**
2. **Clean-room on writes + 409 filter for tasks/RAID** — shared `assertRecordVisibleOr404`, extend
   `CLEARANCE_SCOPED_COLLECTIONS`, write-path tests. *Why:* R1-02 is a live MNPI leak/overwrite. **S–M**
3. **Admin-only CMS/settings/menus + explicit read policy** — this is the mechanism for "admin can disable parts of
   the app"; it must not be pmo-writable; decide `employee`/workstream-lead read scope. *Why:* R1-05/R1-15/R1-16.
   *Where:* server.js ROLE_WRITE_POLICY (+ new ROLE_READ_POLICY), validators/settings.js. **S–M**
4. **Replace the regex sanitizer; nonce-based CSP; sandbox slides** — *Why:* R1-03/R1-04 give any pmo the admin's
   session. *Where:* lib/sanitizeHtml.js, public/js/page-layout.js, server.js CSP, transitions.js openHtmlSlide,
   validators/cms.js. Regression tests = the four payloads. **M–L**
5. **Authenticated, deal-scoped file store** for communications/media/slides (R1-06). *Where:* server.js
   communications/media/slides routes, new `data/files/`. **M**
6. **Audit hygiene** — skip no-op deltas (R1-07), retention policy, and a "one change → one row" test. **S**
7. **Operator hardening pack** — per-user throttle, `Secure` cookie by `req.secure`, DEPLOYMENT.md gains
   `TRUST_PROXY`/`ENABLE_HSTS`, body limit 1–2 MB, `no-store` on `/api`, reword ADMIN_TOKEN warning
   (R1-08/10/13/14). **S**
8. **Dependency bumps** — compression ≥1.8.2, express patch for proxy-addr/qs; re-run `npm audit` at each release
   (R1-09). **S**
9. **Lock polish** — require `version` once clients all send it; scrypt N=2¹⁷ with lazy rehash (R1-11/12). **S**

## What I did not cover
- The remaining ~300 client `innerHTML` sinks beyond the ones named here and in v2.1.0's triage; I closed the
  single flagged candidate (pmo.js) and proved the sanitizer class, not every sink.
- Prototype-pollution / mass-assignment through per-route `Object.assign` merges — zod strips unknown keys on all
  write routes (coverage gate), which bounds it, but I did not trace each handler's merge.
- Transformers.js blob provenance, remote model-weight download, PDF-pack (`@napi-rs/canvas`) internals, Windows
  launchers — unchanged since v2.1.0 reviews.
- Load/soak behaviour under real multi-process contention (Phase 8 soak was not re-run); the full 779-test suite
  was not re-executed — only the targeted probes above.
- Whether the committed `demo.db` contains any real (non-fabricated) person or target — row contents not dumped.
- Network-level posture (TLS config, host firewall, OS disk encryption) — out of the code's reach; DEPLOYMENT.md
  already makes disk encryption a checklist item.
