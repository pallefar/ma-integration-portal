# R2 — Operational, Data & Deployment Readiness (v3.0 review lane)

Date 2026-10-10 · Reviewer: Claude (Fable 5.1), lane R2 · Scope: would this survive months as a managed
service on a shared internal Linux host / container, run by people who are not its developer?
Method: code trace of `server.js`, `db/*`, `lib/*`, `scripts/*`, launchers, `.gitignore`, `DEPLOYMENT.md`;
seven boot probes, a 40-client load probe, an external-lock stall probe, a restart-under-write test and a
live `download-zip` on an isolated instance (port 4312, scratch data only; scripts under
`scratchpad/r2/`: `boot-tests.sh`, `runner.js`, `load-probe.js`, `service-time.js`, `restart-test.js`,
`audit-inspect.js`, `audit-growth.js`). All servers started were killed. No repo file was modified.

Severity is judged against *production on a shared internal host holding MNPI*. Prior reviews
(`.planning/security/*`, phase REVIEW/SECURITY docs) are not re-reported; one item (R2-16) overlaps the
security lane and is flagged as such.

## 0. Headline

The app is correct under concurrency (0 acknowledged writes lost across a SIGTERM mid-burst; WAL recovery
clean on reboot) but it is not *operable* yet. The single biggest problem is not in the planned Phase 10/11
scope at all: the audit log grows by one row **per existing row** of the deal on every write (99.6 % of
audit rows are byte-identical before/after), which (a) makes `audit.db` grow ~300 KB per click once a
deal has a few hundred records, with no retention and append-only triggers that forbid pruning, and
(b) is the main reason the write path is O(N) and the event loop stalls for seconds under 40 users.
Everything else — no first-run bootstrap, world-readable MNPI files, a "graceful" shutdown that keeps
accepting writes for 10 s and exits 1, no schema versioning, no backup tooling, no structured logs — is
fixable in S/M-sized items, listed at the end.

## 1. Findings

| ID | Sev | Status | Finding |
|---|---|---|---|
| R2-01 | **BLOCKER** | VERIFIED | Audit-log amplification: every `writeDb()` audits every row of every non-versioned collection and every untouched row of the written versioned collection |
| R2-02 | HIGH | VERIFIED | Whole-object read/write path is O(rows in deal) per request; 40 users → 40 rps ceiling, p99 5 s, 2.4 s event-loop stalls |
| R2-03 | HIGH | VERIFIED | CPU-bound endpoints (PDF steerco pack, PDF parse) freeze the whole process 2–4 s per call; reachable by any session; no concurrency guard |
| R2-04 | HIGH | VERIFIED | Graceful shutdown neither stops serving nor drains: keeps accepting writes for the full 10 s, always exits via the forced path with code 1, never closes/checkpoints DBs |
| R2-05 | HIGH | VERIFIED | No first-run bootstrap: a host without the committed `control.db` boots with zero users (permanent lockout); real-deal mode inherits four published demo accounts and only `admin` can be rotated |
| R2-06 | HIGH | VERIFIED | MNPI at rest is world-readable: all DB files created 0644 / dirs 0755 (umask-dependent), incl. `runtime.db` holding the plaintext Gemini key |
| R2-07 | MEDIUM | VERIFIED | No boot/config validation: `PORT=abc` creates a Unix socket named `abc` and logs "running on port abc"; port-in-use exits with code **0**; `TRUST_PROXY`/`PUBLIC_BASE_URL`/`ENABLE_HSTS` unvalidated and undocumented |
| R2-08 | MEDIUM | VERIFIED | No schema versioning or migration mechanism (`CREATE … IF NOT EXISTS` only; no `PRAGMA user_version`); DEPLOY-03's "migration on boot" presumes a framework that does not exist |
| R2-09 | MEDIUM | VERIFIED | Observability: `console.*` only, no levels/JSON/request-id/access log/metrics; `/healthz` checks only `demo.db`; an operator learns of unhealthiness only from proxy 5xx |
| R2-10 | MEDIUM | VERIFIED | No backup/restore, integrity or retention tooling; "back up `data/`" in DEPLOYMENT.md is not WAL-aware; deleting a deal leaves its full MNPI snapshots in `audit.db` forever (no purge path) |
| R2-11 | MEDIUM | VERIFIED | Reverse-proxy contract: without `TRUST_PROXY` the login throttle keys on the proxy's IP → 8 failed logins/min lock out the whole organisation; `Secure` cookie is coupled to `ENABLE_HSTS` |
| R2-12 | MEDIUM | VERIFIED | Abuse limits: 50 MB JSON body on every route, unauthenticated serving of uploads at predictable paths, no upload quota/type allowlist, `download-zip` packages the entire working tree (4.97 GB, 103 s CPU, includes gitignored local-only files) |
| R2-13 | LOW | VERIFIED | `uncaughtException`/`unhandledRejection` are log-and-continue; a supervised deploy needs log-and-exit (the code comment already says so) |
| R2-14 | LOW | VERIFIED | Unbounded in-memory maps are minor (login-throttle map never pruned; connection cache keeps archived deals' handles); no RSS growth evidence in a 2.5-min run — weeks untested |
| R2-15 | LOW | VERIFIED | Packaging: tracked tree ships `.planning/` (250 files incl. threat models), `db.json`, `data/ma-portal.db`, `test/`; container base must be glibc ≥ 2.38 (`node:22-bookworm` will not boot); canvas prebuilds only for 4 platforms |
| R2-16 | MEDIUM | VERIFIED (code) / SUSPECTED (policy) | Outbound egress of uploaded PDF text to Google Gemini when a key is configured; no egress policy or feature flag for an MNPI host (overlaps security lane) |

### R2-01 — Audit amplification (BLOCKER, VERIFIED)

Mechanism, `db/store.js`: `writeDb()` walks **every** array collection and, for a non-versioned
collection, `UPDATE`s every row unconditionally and pushes an audit delta for each
(`db/store.js:500-502`). For a versioned collection (RAID, tasks, …) the "untouched" branch still issues
the version-checked UPDATE and audits it whenever `changes > 0`, i.e. always for an existing row
(`db/store.js:443-446`). `db/auditHook.js:133-146` then inserts one row per delta with full
`before_json`/`after_json`.

Evidence, the developer's real `data/audit.db` (inspected on a scratch copy): 75.6 MB, 33,937 rows,
10 active days. `action='update'` rows: **25,774, of which 25,763 (99.96 %) have byte-identical
before/after = 56.5 MB of the 75.6 MB**. Top no-op sources: `/api/integration-tasks` 11,844 rows,
`/api/departments` 9,996. One `POST /api/integration-tasks` produced 168 audit rows, 167 unchanged.

Evidence, fresh seeded deal (`service-time.js`): one `POST /api/raid` creating one entry writes
**65 audit rows / 90 KB** (60 `raidEntries` of which 59 unchanged, plus 10 `processCatalog`,
3 `assessmentTemplates`, 1 `ddRequestTemplates`, 1 `checklistTemplates` — every one unchanged).
Growth is linear in collection size (`audit-growth.js` over the load run): write #1 = 16 rows/72 KB,
#100 = 115 rows/146 KB, #300 = 315 rows/229 KB, **#494 = 509 rows/309 KB**; 494 creates → 155 MB
audit file, 129,181 of 129,678 rows unchanged.

Why it is a blocker for a shared host: (1) `audit.db` is append-only by trigger
(`db/audit-schema.sql` `audit_log_no_update`/`_no_delete`) and has no retention, so at a realistic
~200 writes/day on a 500-record deal it grows ~60 MB/day; (2) each no-op row is a full MNPI snapshot
duplicated hundreds of times, which multiplies the data a breach or a subpoena exposes; (3) the admin
audit viewer (`/api/admin/audit`) shows hundreds of "updates" per real change, which defeats the
compliance purpose; (4) it is the dominant cost in the write path measured under R2-02. Fix is small:
audit (and UPDATE) only when `serialized !== priorRaw`; the Phase-9 version stamp already identifies
real edits. Retention then needs a design (per-deal audit partition or sealed export at deal close).

### R2-02 — O(N) request path and the measured load profile (HIGH, VERIFIED)

`readDb()` loads **all** rows of **all** collections and `JSON.parse`s each on every request
(`db/store.js:259-293`); `writeDb()` rewrites every row of every collection (`:364-504`). Costs are
therefore proportional to the size of the deal, not the request. Isolated service times are fine on a
60-row deal (`GET /api/raid` 8.3 ms, `POST /api/raid` 8.0 ms, `/healthz` 5.7 ms, demo `POST` 16.8 ms
because `demo.db` holds more rows), but the sync model turns any growth into a global stall:

Load probe (`runner.js` + `load-probe.js`; in-process `monitorEventLoopDelay`, 40 closed-loop clients,
45 s, mix 45 % `GET /api/raid`, 15 % `GET /api/integration-tasks`, 10 % `GET /api/employees`,
25 % `POST /api/raid`, 5 % `/healthz`; the RAID collection grew 40 → ~500 rows during the run):

| metric | value |
|---|---|
| throughput | 1,792 requests / 45 s = **40 rps**, 0 transport errors, statuses 200×1338, 201×454 |
| `GET /api/raid` latency | p50 934 ms · p95 4,432 ms · p99 5,034 ms · max 6,401 ms |
| `POST /api/raid` latency | p50 311 ms · p95 2,049 ms · p99 2,816 ms |
| `/healthz` latency | p50 397 ms · p99 3,545 ms (probe shares the one event loop) |
| server event-loop delay | p50 155 ms · p95 1,359 ms · p99 **1,921 ms** · max **2,355 ms** |
| RSS | 144 MB before → 111 MB after (97–136 MB during); heap 39 MB |

Most of the latency is queueing (Little's law: 40 clients ÷ 40 rps ≈ 1 s), i.e. the server's capacity is
~40 mixed requests/s on an M-series laptop once a deal has ~500 RAID rows, and it falls further as the deal
grows. Fifteen simultaneous users is the stated scale; at that scale this is survivable today but
degrades monotonically over a deal's lifetime because R2-01 makes every write slower than the last.

### R2-03 — Whole-process freezes from CPU-bound endpoints (HIGH, VERIFIED)

`GET /api/reports/pack?lang=en` → 200, 1.29 MB in **4,151 ms with the event loop blocked 2,397 ms**
(second call 1,820 ms / 1,800 ms blocked): `lib/reportPack.js` renders with `@napi-rs/canvas`
synchronously on the main thread (`server.js:6265-6300`). Reads are gated on session existence only
(`server.js:262-263`), so any `employee` session can request a pack every two seconds and freeze the
portal for everyone. Same class: `POST /api/rag/upload` parses up to a 50 MB PDF in-process
(`server.js:1299-1313`) and `GET /api/admin/download-zip` runs `zip -r` of the working tree for 103 s
(`server.js:1261-1283`). Fix: move pack/pdf-parse to a `worker_thread`, per-route concurrency guard
(1 in flight → 429), role-gate pack/export to IL/admin.

### R2-04 — Shutdown does not stop serving, does not drain, exits 1 (HIGH, VERIFIED)

`server.js:7270-7276`: `server.close()` then a 10 s forced `process.exit(1)`. Node's `close()` only stops
*new* connections; active keep-alive connections (every browser and every reverse proxy) keep being
served. Restart test (`restart-test.js`, real `node server.js`, 30 writers): SIGTERM sent after 60 acks →
server log "SIGTERM received — shutting down gracefully… Forced shutdown after timeout." → exit
**code 1 at 10,070 ms**, and **acks rose from 60 to 817 during the "drain"**. Verification after exit:
acknowledged 817, **lost 0, acked-but-unaudited 0, persisted-but-never-acked 0**; `deal.db-wal` 4.15 MB
and `audit.db-wal` 4.8 MB left behind (no checkpoint, no `conn.close()`), recovered on reboot
(`GET /api/raid` returned 817 rows). So durability is right (commit-before-ack inside one `.immediate`
transaction, Phase 8 CR-01) but the lifecycle is wrong: a systemd `Restart=` or container orchestrator
sees exit 1 on every stop, a rolling restart takes ≥ 10 s, and a proxy keeps routing to a dying process.
Fix (S): flip readiness to 503 → `server.closeIdleConnections()` → short drain → `closeAllConnections()`
→ `wal_checkpoint(TRUNCATE)` + close every cached connection → `exit(0)`.

### R2-05 — First-run bootstrap and published demo accounts (HIGH, VERIFIED)

Boot with `MA_CONTROL_DB_PATH` pointing at a missing file: server starts normally (`/healthz` 200),
`users` table has 0 rows, `admin/TEdemo!2026` → 401, and `scripts/set-admin-password.js` fails with
"No 'admin' user found in control.db" (it only rotates an existing `admin`, header lines 14-17). There is
no `INSERT INTO users` anywhere outside `scripts/soak.js:117`. The only recovery is `ADMIN_TOKEN`
break-glass — exactly what OPS-02 retires. Conversely, a host that *does* carry the committed
`control.db` runs real-deal mode with `admin`, `karen`, `pmo`, `employee-demo` all on the password printed
on the login page (`public/login.html` has 2 `TEdemo` hits); DEPLOYMENT.md step 1 rotates only `admin`.
Needed: `bootstrap-admin` (create-if-none, from a one-time env/stdin secret), refuse real-deal boot while
any account still matches the demo password, disable non-admin demo accounts when `DEMO_OPEN` is unset.

### R2-06 — File permissions on MNPI at rest (HIGH, VERIFIED)

`db/dbFiles.js:92-106` opens with `new Database(path)` and `fs.mkdirSync(dir, {recursive:true})` — no
mode, no `chmod`, no `umask` guidance anywhere (repo-wide grep: none outside tests). Observed on boot
(umask 022): `control.db`, `demo.db`, `runtime.db`, `-wal`, `-shm` all `-rw-r--r--`, `deals/` `drwxr-xr-x`.
On a shared host every local account can copy every deal database, the session-hash table and the
plaintext `geminiApiKey` in `runtime.db` (`db/controlStore.js:499-510`). DEPLOYMENT.md relies on
full-disk encryption, which does not separate users on the same host. Fix (S): `mkdirSync(..., {mode:
0o700})`, `chmodSync(file, 0o600)` after first open (SQLite gives sidecars the main file's mode), and
`UMask=0077` + a dedicated service user in the unit.

### R2-07 — Boot/config contract (MEDIUM, VERIFIED)

The env contract is: `PORT`, `PUBLIC_BASE_URL` (`server.js:69-70`), `TRUST_PROXY` (`:102-107`),
`ENABLE_HSTS` (`:142,682,777`), `ADMIN_TOKEN` (`:197`), `DEMO_OPEN` (`:207,246,708`), vestigial
`PORTAL_AUTH` (`:230`), five `MA_*_PATH`/`MA_DEALS_DIR` overrides (`db/dbFiles.js:49-53`), plus
`ADMIN_PASSWORD` for the script. None is validated. Probes: `PORT=abc` → "server running on port abc",
a Unix socket file `abc` created in the cwd; port already in use → `uncaughtException: listen
EADDRINUSE` logged, then the process **exits with code 0** (event loop drained — a supervisor with
`Restart=on-failure` will not restart it and a deploy script sees success); corrupt `control.db` and a
read-only data dir both fail fast with a raw better-sqlite3 stack (exit 1) and no operator-readable
message naming the file. `DEMO_OPEN=1` on a host with real deals only warns (`:208`; verified open API).
DEPLOYMENT.md mentions none of `TRUST_PROXY`, `ENABLE_HSTS`, `PUBLIC_BASE_URL`, health, backup, restore,
systemd or Docker (grep counts 0). Fix (S): a `config.js` that parses/validates at boot and prints the
effective contract; `server.on('error')` → exit 1; refuse `DEMO_OPEN=1` when `data/deals/` is non-empty.

### R2-08 — Schema versioning (MEDIUM, VERIFIED)

All five schema files are `CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS` applied on every open
(`db/dbFiles.js:102-103`); no `PRAGMA user_version`, no migrations table, no `ALTER` anywhere. Today
this is survivable only because tables are `(id, project_id, seq, data JSON)` and Phase 9 stamps
versions lazily inside the blob. Any future column, index change, trigger change or data backfill has no
path across *N* deal files + demo + control + runtime + audit, and a changed `CREATE TABLE` silently
no-ops on existing files. No integrity check runs at boot (only tests/soak call `integrity_check`).
DEPLOY-03's "runs its schema migration on boot" and Phase 10 SC1 "ready only once migrations have
completed" therefore have nothing to hook into yet. Fix (M): `user_version` per file + ordered migration
list applied inside `openDbFile()` under `BEGIN IMMEDIATE`; `quick_check` on open for non-audit files.

### R2-09 — Observability (MEDIUM, VERIFIED)

Logging is bare `console.log/warn/error` (no timestamps, levels, request ids, JSON), no HTTP access log,
no error/latency counters, no rotation concern because nothing is written to files (stdout → journald or
container log driver is the right target — keep it, structure it). `/healthz` (`server.js:783-786`) is
unauthenticated, cheap (5–6 ms) and only proves the demo singleton can `readDb()`; it does not touch
control/runtime/audit/deal files, disk space or WAL size, and there is no readiness/shutdown state. Logs
include a user-supplied PDF filename (`:1304`) — a target name in a filename would land in the host log.
No test covers `/healthz` (grep: none). An operator currently cannot answer "is it slow / why / for whom".
Fix (M): structured logger with request id + duration + status (no bodies), slow-request threshold,
`/readyz` that `SELECT 1`s every opened file, reports WAL bytes and free disk, returns 503 while draining.

### R2-10 — Backup, restore, integrity, retention (MEDIUM, VERIFIED)

What exists: `scripts/wal-checkpoint.js` + `.githooks/pre-commit` (a *git* hygiene tool for the
committed demo/control files — not a backup), `PRAGMA integrity_check` only in tests/soak, default WAL
autocheckpoint (1000 pages — measured WAL stayed ≈ 4.1 MB under load, so WAL growth is bounded in the
single-process case). What is missing: any WAL-aware backup (`VACUUM INTO` / backup API) and a restore
runbook — DEPLOYMENT.md:40 says "back up `data/`", and a file copy that misses `-wal` loses committed
rows; VACUUM policy (irrelevant for append-only audit, relevant after deal deletes in control.db);
disk-full handling (`SQLITE_FULL` is not a busy error → generic 500 via `server.js:7236`, no alert);
data lifecycle — `deleteDeal()` unlinks the deal file (`db/controlStore.js:420-452`) but every
before/after MNPI snapshot of that deal stays in `audit.db` with triggers forbidding deletion, so there is
no MNPI purge at deal end and no per-deal audit export. Fix (S/M): `scripts/backup.js` (per-file
`VACUUM INTO` + `quick_check` of the copy + manifest), restore steps, and a retention design for audit
(per-deal audit file sealed/exported at close is the simplest that keeps append-only semantics).

### R2-11 — Reverse proxy / TLS contract (MEDIUM, VERIFIED)

`req.ip` is the raw peer unless `TRUST_PROXY` is set (`server.js:102-107`, correct default). But the
login throttle keys on `req.ip` (`:637-651`, 8 attempts/min); behind nginx/Caddy without `TRUST_PROXY`
every user shares one key, so eight mistyped passwords across the company → 429 for everyone for a
minute, and `sessions.ip` audit is meaningless. `Secure` is added to the session cookie only when
`ENABLE_HSTS=1` (`:682,777`) — a TLS-terminating proxy without HSTS yields a non-Secure cookie; HSTS
`includeSubDomains` (`:143`) is a risky default on a shared internal domain. `PUBLIC_BASE_URL` is
interpolated into outbound email bodies (`:7144-7160`) unvalidated. Fix (S): `SECURE_COOKIES` derived
from `PUBLIC_BASE_URL` scheme, throttle keyed on `username + ip`, documented nginx snippet, HSTS without
`includeSubDomains` by default.

### R2-12 — Abuse and resource limits (MEDIUM, VERIFIED)

`express.json({limit:'50mb'})` and `urlencoded` 50 MB on every route (`server.js:148-149`); zod blob caps
are 70 MB (`validators/cms.js:19`, `validators/settings.js:15`). `POST /api/media` writes the decoded
blob to `public/uploads/<ms>_<name>` with no quota or type allowlist (`:2166-2191`) and `express.static`
serves `public/` without auth (`:175`; `GET /sent_emails/comm_….html` → 200 unauthenticated on my
instance), so uploads and runtime-written "sent emails" (`:1621,6883`) are readable by anyone who can reach
the host. Only login/change-password are throttled. `download-zip` (admin) zipped **4.97 GB in 103 s** on
this machine because it archives the working tree minus a hand-kept exclusion list (`:1273`): it shipped
the gitignored root screenshots, `public/uploads/`, `graphify-out/`, the 4.7 GB `slidedeck interaction/`
source directory, and would ship `.planning/security/RELEASED-TAGS-REVIEW.md`, which `.gitignore:70-75`
keeps local precisely so it is never distributed. Server timeouts are set (`:7263-7265`, 60/65/61 s) —
sound. Fix (S/M): per-route body limits (1 MB default, 25 MB on the two upload routes), upload quota +
MIME allowlist + auth-gated serving, rate limit per session on writes and on pack/export/audit, and
retire `download-zip` (the release zip is the artifact) or restrict it to `git ls-files`.

### R2-13 / R2-14 / R2-15 / R2-16 (LOW / packaging / egress)

- R2-13: `server.js:7247-7248` log-and-continue on `uncaughtException`/`unhandledRejection`; the comment
  at `:7243` already prescribes log-then-exit for supervised deploys — do it when `DEMO_OPEN` is unset.
- R2-14: `_loginAttempts` (`:636`) is never pruned (grows with distinct IPs/usernames); `connectionCache`
  (`db/store.js:68`) has no eviction, archived deals keep an open handle + page cache. RSS over the whole
  probe: 144 → 111 → 163 → 212 MB with GC-shaped swings, heap 39 MB — no leak signal in 2.5 min; a
  multi-week soak is the only honest test and was not run.
- R2-15: `git ls-files` = 2,421 files: `node_modules/` 1,973 files/210 MB (four skia binaries 111 MB,
  `icudtl.dat` 10 MB, `sqlite3.c` 9.5 MB), `.planning/` 250 files (roadmaps, threat models, graphs),
  `db.json` 561 KB, `data/ma-portal.db` 1.2 MB pre-split archive, `test/` 61 files, `public/` 59 MB. A
  `git archive` release carries all of it. `.gitignore` is sound for the MNPI families
  (`data/runtime.db*`, `data/audit.db*`, `data/deals/`, `public/sent_emails/*`) and
  `test/db-artifact-exclusion.test.js` pins them. Native coverage: better-sqlite3 prebuilds for 8 targets
  incl. musl; `@napi-rs/canvas` only darwin-arm64/x64, linux-x64-gnu, win32-x64 → a musl or arm64 Linux
  container boots but `GET /api/reports/pack` degrades to 503 (`server.js:6252-6263`). glibc ≥ 2.38 means
  `node:22-trixie`/Ubuntu 24.04 bases; `node:22-bookworm` (glibc 2.36) fails at the SQLite binding.
- R2-16: `POST /api/rag/upload` sends the extracted PDF text to
  `generativelanguage.googleapis.com` when a Gemini key is stored (`server.js:1325-1328`,
  `aiService.js:56`), and the CSP permits `huggingface.co` model downloads. On an MNPI host this is an
  egress-policy decision nobody has made; the route works in deal context for admin/hrbp/pmo
  (DEFAULT_WRITE_ROLES). Flag for the security lane; operationally it needs a feature flag + documented
  egress allow-list. (Side note: `ragService.js:190-200` reads `ragUploads` from the frozen `db.json`,
  not SQLite, so uploads never become searchable — a dead feature, not a leak.)

Areas checked and found sound in one line each: BEGIN IMMEDIATE + busy_timeout contract
(`db/dbFiles.js:100`) behaves as designed — an external lock holder produced `503 Retry-After: 1` after
1,050 ms and stalled *every* request for that long (`/healthz` p99 1,056 ms, loop max 1,050 ms); the
central 503/409/500 handlers never echo internals; slowloris timeouts set; sessions have a 12 h absolute
TTL with prune-on-login/boot (`db/sessions.js`, `server.js:821`); deal deletion evicts and unlinks
`.db/-wal/-shm` and refuses on EBUSY; WAL recovery after a hard kill is clean.

## 2. Planned requirements vs. what production needs

| Requirement | Verdict | Why / what must change |
|---|---|---|
| DEPLOY-01 Linux managed service (unit, proxy+TLS guidance, backup/restore, graceful shutdown) | **needs-change** | Necessary. Must bundle R2-04 (a shutdown that actually stops serving and exits 0), R2-06 (`UMask=0077`, dedicated user, 0600 files), R2-10 (WAL-aware backup = `VACUUM INTO`, restore runbook, integrity job), R2-07 (validated env contract, exit 1 on listen error) and R2-11 (TRUST_PROXY/Secure/HSTS doc). "Guidance" is not enough — ship the unit file, the nginx snippet and the backup script. |
| DEPLOY-02 Container image + config contract | **needs-change** | Necessary. Add: base-image constraint (glibc ≥ 2.38 or accept pack=503 on musl/arm64), `.dockerignore` that drops `.planning/ test/ db.json data/ma-portal.db *.png` beyond `.gitignore`, non-root + umask, `/readyz`, `replicas: 1` as a documented *and enforced* constraint (refuse boot if a lock file shows another writer? at minimum doc), secret injection for the bootstrap admin (R2-05), log-to-stdout contract. Phase 11 SC4 (image carries no real data, refuses real-deal traffic without a volume, never inherits `DEMO_OPEN=1`) is the right bar. |
| DEPLOY-03 health/readiness, drain, migration on boot | **needs-change** | Necessary but under-specified: readiness must check every DB family + disk + shutdown state (R2-09); "drain" must be defined as *stop keep-alive, finish in-flight, checkpoint, exit 0* and proven by the restart test above (R2-04); "migration on boot" requires the versioning mechanism first (R2-08) — make it an explicit sub-requirement. |
| OPS-01 rate-limit auth and write endpoints | **needs-change** | Necessary but insufficient: the expensive *reads* (pack, export, audit query, download-zip) are the DoS vectors (R2-03), body size must be per-route (R2-12), and the throttle key must be `username+ip` with `TRUST_PROXY` documented or it self-DoSes (R2-11). |
| OPS-02 retire ADMIN_TOKEN for a managed admin secret | **needs-change** | Necessary, but on its own it removes the only recovery for a zero-user host (R2-05). Must ship together with first-run bootstrap, demo-password refusal in real-deal mode and demo-account disablement. |
| OPS-03 session idle/absolute timeout, list/revoke, Secure/HSTS correctness | **sufficient with one change** | Absolute TTL + revoke-by-user already exist; idle timeout and a session list are new. Decouple `Secure` from `ENABLE_HSTS` (R2-11) and drop `includeSubDomains` by default. |

### Production needs no planned requirement covers

1. **Audit growth and no-op amplification** (R2-01) — retention, per-deal partitioning, purge-at-deal-end
   policy vs. append-only guarantee. Nothing in Phases 10–13 touches `audit.db` sizing.
2. **Request-cost budget** (R2-02) — the O(N) whole-object path has no owner; v3.0 needs at least
   "writeDb touches only the collection(s) a route modified" and pagination/filters on the three list
   reads that dominate traffic.
3. **CPU isolation** for pack/pdf-parse/zip (R2-03) — worker thread + concurrency guard.
4. **MNPI file permissions** (R2-06) and **secrets at rest** (plaintext Gemini key in `runtime.db`).
5. **Boot validation + exit-code discipline + supervised crash policy** (R2-07, R2-13).
6. **Schema versioning** (R2-08) — prerequisite for DEPLOY-03's wording.
7. **Structured logging / metrics / slow-request visibility** (R2-09).
8. **Data lifecycle**: deal archive export, deal-delete vs. audit MNPI, backup verification (R2-10).
9. **Upload storage** quota, allowlist, authenticated serving; `download-zip` retirement (R2-12).
10. **Egress policy** for Gemini/Hugging Face on an MNPI host (R2-16).
11. **Release/packaging hygiene**: strip `.planning/`, `test/`, `db.json`, `data/ma-portal.db` from
    distributed artifacts; document the glibc floor in the image (R2-15).
12. **Operational runbook** for disk-full, corrupt file, lost `control.db`, forgotten admin password —
    each of which today ends in a raw stack trace or a silent lockout.

## 3. Top actions for v3.0 (ranked)

1. **Stop auditing and rewriting unchanged rows** — in `db/store.js` skip UPDATE+delta when
   `serialized === priorRaw` for non-versioned collections and drop the "untouched" delta in the
   versioned branch; add a regression test asserting one audit row per changed row. Why: BLOCKER R2-01,
   also halves the write path. Where: `db/store.js:443-446, 500-502`, `test/audit-log.test.js`. **S**.
2. **Audit retention design** — per-deal audit file (`data/audit/<dealId>.db`) sealed and exported at
   deal close, control-plane events stay in `audit.db`; document purge/retention. Why: R2-01/R2-10.
   Where: `db/auditHook.js`, `db/dbFiles.js`, DEPLOYMENT.md. **M**.
3. **Real graceful shutdown** — readiness→503, `closeIdleConnections()`, 5 s drain, `closeAllConnections()`,
   `wal_checkpoint(TRUNCATE)` + close all cached connections, `exit(0)`; `server.on('error')`→exit 1;
   uncaught→exit 1 when `DEMO_OPEN` unset. Prove with `restart-test.js`. Where: `server.js:7247-7276`,
   `db/store.js` (export `closeAllConnections` for prod use). **S**.
4. **First-run bootstrap + demo-account lockdown** — `scripts/bootstrap-admin.js` (create-if-none),
   boot refusal in real-deal mode while any account matches `TEdemo!2026`, disable non-admin demo users
   unless `DEMO_OPEN=1`; pair with OPS-02. Where: `scripts/`, `db/controlStore.js`, `server.js` boot block
   (`:806-821`). **S/M**.
5. **Files at rest** — `mode: 0o700` dirs, `chmod 0600` after open, `UMask=0077` in the unit,
   dedicated user; encrypt or move the Gemini key out of `runtime.db`. Where: `db/dbFiles.js:92-106`,
   `deploy/portal.service`. **S**.
6. **Validated config module** — parse/validate `PORT`, `PUBLIC_BASE_URL`, `TRUST_PROXY`,
   `SECURE_COOKIES`, `ENABLE_HSTS`, `DEMO_OPEN` (refuse with real deals present), print the effective
   contract at boot; document every variable in DEPLOYMENT.md. Where: new `config.js`, `server.js:69-230`.
   **S**.
7. **Worker-thread the CPU hogs + concurrency guard** — `lib/reportPack.js` and `pdf-parse` in a
   `worker_thread`, 1-in-flight per route → 429, role-gate pack/export to admin/hrbp. Where:
   `server.js:1299-1363, 6265-6390`. **M**.
8. **Schema versioning** — `PRAGMA user_version` + ordered migrations run per file inside
   `openDbFile()`; `quick_check` on open; readiness waits for it. Where: `db/dbFiles.js`, new
   `db/migrations/`. **M**.
9. **Observability baseline** — JSON logs with request id/duration/status/user (no bodies, no
   filenames), slow-request warnings, `/readyz` (every DB `SELECT 1`, WAL bytes, free disk, draining
   flag), `/healthz` kept as liveness. Where: `server.js` top middleware + `:783`. **M**.
10. **Backup/restore tooling** — `scripts/backup.js` (`VACUUM INTO` per file + `quick_check` + manifest),
    `scripts/restore.js`, runbook incl. MNPI handling; nightly unit timer. **S/M**.
11. **Limits** — per-route body limits, upload quota + MIME allowlist + auth-gated `/uploads`, write
    rate-limit per session, retire `download-zip`. Where: `server.js:148-149, 175, 1261, 2166`. **S/M**.
12. **Deployment shapes** — `Dockerfile` (`node:22-trixie-slim` or `ubuntu:24.04`, non-root, `data/`
    volume, `.dockerignore` stripping `.planning/ test/ db.json data/ma-portal.db *.png`), systemd unit +
    nginx snippet, release zip trimmed the same way. **M**.
13. **Egress policy** — feature flag for AI-Insight/Gemini and HF downloads, documented allow-list; fix or
    remove the dead `ragUploads` path. **S**.

## 4. What I did not cover

- Windows and Linux boots were not re-run here (prior Ph1/Ph7 Docker evidence stands); no container was
  actually built. glibc/canvas statements come from prebuild listings and DEPLOYMENT.md, not a new run.
- Multi-process (`replicas > 1` or CLI-scripts-alongside-server) behaviour beyond the one external-lock
  probe; the Phase 8 soak covers it.
- Weeks-long memory/handle growth — only a 2.5-minute profile; `_loginAttempts`/connection-cache growth
  is reasoned, not observed.
- The frontend's reaction to 503/409/slow responses, and whether the auto-retry hook amplifies load under
  the stalls measured here.
- A full MNPI-in-logs audit of every `console.*` call site (only the obvious RAG filename was checked),
  and the security semantics of the Gemini egress (left to the security lane).
- `/api/reports/export` CSV cost (needs a query schema I did not probe), `/api/admin/migrate-db` (a demo
  feature that writes `connectionDetails` into settings — not evaluated), and the AI-Insight browser-side
  model download.
- Correctness of clearance filtering, auth, XSS — other lanes.
