# Stack Research

**Domain:** Shared-host, multi-user deployment hardening for an existing Express 4 + vanilla-JS + better-sqlite3 (WAL) internal tool
**Researched:** 2026-08-10
**Confidence:** HIGH (versions verified against npm registry 2026-08-10; better-sqlite3/SQLite mechanics verified against `db/store.js` source and SQLite/better-sqlite3 documentation; nginx/Caddy versions verified via web search with dated sources)

This is an **additions-only** stack research pass for the v2.2.0 Shared-Host Multi-User milestone. It does not re-litigate the existing validated stack (Express 4.19.2, better-sqlite3 13.0.1, zod 4.4.3, Node >=22, committed `node_modules`, file-per-deal SQLite) — see `.planning/codebase/STACK.md` and `db/store.js` for that. Everything below is scoped to what changes or gets added to run the existing app on a shared host with concurrent users.

## The concurrency architecture decision (read this first)

The milestone framing ("multi-process clustering breaks the Phase-1 in-process snapshot merge") is **half right and worth sharpening**, because the sharpened version changes the recommendation:

- `writeDb()`'s snapshot-diff merge (`db/store.js:257-390`) diffs `data[key]` against `data.__snapshot[key]` — **this request's own read baseline**, not "current live state" — and runs the whole thing inside one `conn.transaction()`. Because that diff logic never assumes it's the only writer (it explicitly tolerates concurrent inserts/deletes by other requests it never saw), the **collection-membership** case (add an item, remove an item, reorder) is already correctly ACID-safe across *any* number of concurrent SQLite connections to the same local file — including multiple OS processes — because SQLite's own file-level locking (not this app's JS logic) is what serializes the actual `INSERT`/`UPDATE`/`DELETE` statements. WAL mode allows unlimited concurrent readers plus one active writer at a time; other writers block (and retry, given a `busy_timeout` pragma) rather than corrupt.
- What **does** stay broken regardless of process topology is the **same-record concurrent-edit** case: two people editing the same RAID entry or org position, both reading version N, both writing — under this diff algorithm, "id already in my snapshot → unconditional UPDATE," the second writer's `UPDATE` silently overwrites the first writer's change (last-write-wins). This is a single-process risk **today**, with two truly concurrent async requests interleaving around an `await`, not something multi-process introduces. Optimistic locking (item 7 below) is the actual fix, and it fixes it identically whether there's one Node process or five.
- What genuinely *is* process-topology-sensitive: `connectionCache` (`db/store.js:68`), the `AsyncLocalStorage`-bound per-request context, and any in-memory rate-limit store are all **per-process** by construction — none of that is a bug, it just means every additional Node process needs its own connection (fine, SQLite supports that) and rules out anything that assumes a single shared in-memory structure across processes (e.g., a naive in-memory rate limiter under PM2 cluster mode would give each worker its own counter, quietly widening the effective limit).

**Recommendation: stay single-process. Do not introduce Node `cluster`, PM2 cluster mode, or any horizontally-scaled multi-replica deployment of the SQLite-backed app.** At the actual scale in play — one Integration Lead plus a handful of workstream leads per live deal, not an internet-facing service — a single Node process comfortably serves this traffic; `better-sqlite3` calls are synchronous and sub-millisecond for this data volume, so the one CPU core Express already uses is not the bottleneck. Single-process also means the entire "cross-process advisory locking" and "single-writer broker" design space collapses to *already solved, for free, by the existing snapshot-diff merge plus SQLite's own file locking* — no new dependency, no new architecture. The only genuinely new work is optimistic locking on co-edited records (§7) and tuning `busy_timeout` so a burst of concurrent writes queues instead of throwing `SQLITE_BUSY`.

This directly resolves the three options the requirements doc poses:

| Option | Verdict | Why |
|---|---|---|
| Single-writer broker process (worker cluster proxying writes to one writer) | **Not needed** | The single Node process already *is* the single writer; adding a broker adds IPC complexity to solve a problem that doesn't exist at this scale. Revisit only if profiling later shows the event loop genuinely saturated. |
| Cross-process advisory locking (`proper-lockfile` et al.) | **Not needed** | SQLite's own WAL file locking already serializes writers correctly for the collection-membership case; an app-level lock on top would be redundant and would not fix the same-record-edit race anyway (that's a business-logic race, not a file-access race). |
| Postgres migration | **Deferred, not this milestone** — see cost breakdown below | Real cost, real benefit only for one specific scenario (TE-IT multi-replica autoscaling that cannot pin to 1 replica). Everything else in scope is servable by SQLite. |

### The Postgres cost, made concrete against this codebase

If the TE-IT-run container shape genuinely requires horizontal autoscaling (N replicas, no guaranteed single pod, ephemeral/non-shared local disk) — the one scenario SQLite structurally cannot serve safely — here is what a Postgres migration actually costs against *this* codebase, not a generic comparison:

- **`db/store.js`'s external contract can survive.** `initDb(path)` / `readDb()` / `writeDb(data)` is a whole-object, EAV-shaped API (`id`, `project_id`, `seq`, `data` JSON blob per row) that the ~90 `server.js` call sites depend on unchanged (that's the whole point of the Phase-1 design, per the file's own header comment). A Postgres-backed reimplementation of `db/store.js` *could* keep the same table shape (`id text`, `project_id text`, `seq int`, `data jsonb`) and the same snapshot-diff `writeDb()` algorithm almost verbatim, swapping `better-sqlite3`'s synchronous calls for `pg`'s async pool calls (which forces every call site touching `readDb()`/`writeDb()` to become `await`-aware if it isn't already — likely a large mechanical diff even if the *shape* doesn't change) and the SQLite `INSERT/UPDATE/DELETE` statements for Postgres equivalents (`json_extract` → `data->>'version'` / `jsonb`, `INSERT ... ON CONFLICT` differs slightly, etc.).
- **What does NOT survive:** the committed-`.db`-file, zero-install turnkey-zip distribution model. `data/control.db` + `data/demo.db` being committed files that `git archive` bundles straight into a zip is the entire mechanism that makes `node server.js` runnable with no install step. Postgres is a running server process, not a file — there is no "commit the database into the zip" equivalent. This is not a tooling gap to work around; it is a categorical shift from "embedded database" to "client-server database," and it is the reason the demo showcase (which must stay laptop-local zero-install, a **validated, must-survive requirement**) cannot move to Postgres without breaking its own defining property.
- **The practical consequence: a Postgres decision forks the persistence layer, not just migrates it.** Demo mode stays SQLite (it must, to keep zero-install); real-deal mode would move to Postgres. That means `db/store.js` needs a driver seam (SQLite driver for demo, Postgres driver for real-deal), doubling the persistence surface that needs testing, and the file-per-deal isolation model (one physical `.db` file per deal, deleted by unlinking a file) becomes schema-per-deal or database-per-deal inside one Postgres instance — achievable, but it changes `db/controlStore.js`'s `deleteDeal()` mechanics and the backup/restore story (copy-a-file → `pg_dump`/logical backup per schema) non-trivially.
- **New operational surface if chosen:** a Postgres server to install/patch/back up (self-managed host) or a managed Postgres TE IT already runs (container shape — likely the actual reason to prefer this path, since IT-run platforms usually have Postgres as a first-class managed service already, unlike a committed SQLite file). New deps: `pg` (^8.23.0) or `postgres.js`, a migration tool (e.g. `node-pg-migrate` ^9.0.0) since there's no more "the schema lives in the committed file," and connection-pool tuning.
- **Recommendation:** do not adopt Postgres this milestone. Confirm with TE IT whether the container shape can pin to exactly 1 replica with a persistent volume (a normal, supported pattern for stateful services on most platforms — it does not require Kubernetes StatefulSets specifically, just "don't autoscale this one"). If that constraint is achievable, SQLite serves all three deployment shapes and this entire migration is avoided. If TE IT's platform structurally cannot guarantee that (some fully-serverless/no-persistent-disk platforms can't), that finding is itself the trigger for a v3.0 Postgres milestone — treat it as a scoped follow-on, not something to build defensively now.

## Recommended Stack

### Core Technologies (new for this milestone)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `express-rate-limit` | **8.6.2** (peer: `express >= 4.11`, matches installed 4.19.2) | Per-route request throttling | Pure-JS, zero native deps (doesn't disturb the committed-`node_modules` platform-prebuild story), directly closes a named **Critical**-adjacent gap (`.planning/codebase/CONCERNS.md`: "no rate limiting"). Default in-memory store is correct *because* the recommendation above is single-process — no distributed store needed. |
| systemd (unit file, OS-native) | n/a — ships with the target Linux distro | Process supervision for the self-managed shape | Zero new npm dependency. Gives auto-restart on crash, resource limits (`MemoryMax`, `CPUQuota`), journald log integration, and `Restart=on-failure` — everything PM2 offers for a single-instance app, with nothing extra installed on the host. Aligns with "self-managed Linux host we configure." |
| Caddy | **2.11.4** (June 2026) | TLS termination + reverse proxy, self-managed shape | Automatic HTTPS (Let's Encrypt or internal CA) with a 3-line Caddyfile is a materially lower ops burden than nginx + certbot for a small internal deployment with no in-house nginx/certbot expertise on record in this codebase. OS package/binary, not an npm dependency. |
| nginx | **1.30.4** stable (Jul 2026) | TLS termination + reverse proxy, self-managed shape — *alternative* | Recommend only if TE IT already standardizes on nginx internally (worth a direct question before defaulting to Caddy) — see Alternatives below. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `sd-notify` | 2.8.0 | Optional systemd watchdog/readiness integration (`sd_notify(READY=1)`, `WATCHDOG=1`) | Only if the self-managed host wants systemd-level liveness beyond plain `Restart=on-failure` (e.g. detecting an event-loop hang, not just a crash). Skip unless that specific failure mode is a real worry — plain `Restart=on-failure` plus a `GET /health` route polled by the reverse proxy covers most cases with zero new dependency. |

### Ops artifacts (not npm dependencies)

| Artifact | Purpose | Notes |
|------|---------|-------|
| `Dockerfile` + `.dockerignore` | Container image for the TE-IT-run shape | See "Containerization" below — no build step inside the image either, preserving zero-install even in-container. |
| systemd unit file (`ma-portal.service`) | Process supervision, self-managed shape | `Restart=on-failure`, `EnvironmentFile=/etc/ma-portal/secrets.env` (0600, root-owned), `WatchdogSec=` if `sd-notify` adopted. |
| `Caddyfile` (or `nginx.conf`) | TLS + reverse proxy config | Lives in a new `deploy/` directory in-repo as a template, filled in per host — not shipped inside `node_modules` or the turnkey zip. |
| Backup script using `better-sqlite3`'s built-in `.backup(path)` API | Safe live backup of `control.db` / `deals/*.db` while the process is running | No new dependency — `Database.prototype.backup()` has shipped in `better-sqlite3` since v7 (well below the installed 13.0.1), does a safe WAL-aware snapshot rather than a raw `cp` of the file (a raw copy of a WAL-mode DB mid-write risks copying a torn file). |

## Installation

```bash
# Core — the only new runtime npm dependency this milestone needs
npm install express-rate-limit@8.6.2

# Optional — only if adopting systemd watchdog integration
npm install sd-notify@2.8.0

# Everything else in this milestone (Caddy/nginx, systemd, Docker, TLS certs,
# secrets files) is an OS package or ops artifact — NOT `npm install`.
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| Single Node process (no cluster) | Node `cluster` module / PM2 cluster mode | Only if profiling under real multi-user load shows the single event loop genuinely CPU-saturated — unlikely at the stated scale (one IL + a handful of workstream leads per deal). If ever adopted, `express-rate-limit`'s in-memory store must be swapped for a shared store (e.g. `rate-limit-redis`), and a real single-writer broker becomes necessary again. |
| systemd (self-managed shape) | PM2 (7.0.3) | If the deploying team already runs PM2 fleet-wide for other Node services and wants one consistent tool across services — otherwise systemd is strictly less to install and matches "we configure the host ourselves" more directly. |
| Caddy (self-managed shape) | nginx (1.30.4) | If TE IT's internal standard is nginx, or if the config needs nginx-specific modules/patterns already documented elsewhere at TE. Functionally both terminate TLS and reverse-proxy fine for this app; the difference is operator familiarity and config verbosity, not capability. |
| SQLite + optimistic locking (this milestone) | Postgres migration | Only if TE IT's container platform cannot pin to a single replica with a persistent volume — see the cost breakdown above. Treat as a v3.0 decision, not a hedge to build now. |
| `express-rate-limit`'s default in-memory store | `rate-limit-redis` + a Redis instance | Only needed if multi-process is later adopted (see above) — do not add Redis preemptively; it's a whole new infrastructure dependency for a problem that doesn't exist in the single-process recommendation. |
| Version-in-JSON-blob optimistic locking via `json_extract` (§ below) | A dedicated SQL `version` column + `ALTER TABLE` migration | If the team later normalizes away from the generic EAV (`id`/`seq`/`data`) shape entirely — out of scope for this milestone, which explicitly preserves the existing whole-object API. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| Node `cluster` module / PM2 cluster mode | Reintroduces exactly the cross-process coordination problem the milestone is worried about, for zero real throughput benefit at this scale; also breaks the implicit single-process assumption behind the default `express-rate-limit` store. | Single Node process, supervised by systemd or the container runtime. |
| `node:22-alpine` (or any musl-based) Docker base image | `better-sqlite3`'s committed prebuilds are `linux-x64-gnu` / `linux-arm64-gnu` (glibc-linked). Alpine uses musl libc — the committed native binary will fail to load, forcing an `npm rebuild` inside the image and defeating the entire point of committing prebuilds. | `node:22-bookworm-slim` (or `node:22-slim`) — glibc-based, matches the already-committed prebuild ABI. |
| `helmet` | The app already hand-rolls CSP and the full security-header set (per `.planning/codebase/STACK.md`) and it works; layering `helmet` on top risks conflicting/duplicate header logic for zero new capability. | Keep the existing hand-rolled headers; add only what's missing (e.g. confirm `Strict-Transport-Security` is set when Caddy/nginx terminates TLS in front — currently gated by `ENABLE_HSTS`, which is correct, just needs to be turned on at the reverse-proxy boundary). |
| `dotenv` as a runtime dependency | `server.js` already reads `process.env` directly; there's no `.env`-file-loading need in production (env vars come from systemd's `EnvironmentFile=` or the container platform's secret injection) and adding it is unneeded indirection against the zero-install ethos. | Keep reading `process.env` directly; a `.env.example` file (not a dependency) documents required vars for local dev. |
| `keytar` / any OS-keychain npm binding | Native bindings — would add a 9th platform-prebuild matrix on top of `better-sqlite3`'s and `@napi-rs/canvas`'s already-8-platform committed binaries, for a capability (desktop OS keychain) that doesn't fit a server process anyway. | The hashed-secret-in-`control.db` pattern already used for the first-run admin secret (see §4 below), or systemd's root-owned `EnvironmentFile=`. |
| Any cloud KMS SDK (`@aws-sdk/client-secrets-manager`, Azure Key Vault SDK, etc.) | TE-IT-specific and belongs to *their* config contract (whatever secret store their platform already provides), not this app's dependency tree — matches the "no TE IT dependency" posture carried forward from the prior milestone. | Document the required env var names (config contract) and let TE IT inject values however their platform already does it. |
| `proper-lockfile` / cross-process advisory locks around `writeDb()` | Solves a problem SQLite's own WAL file-locking already solves at the engine level for the collection-membership case, and does nothing for the same-record-edit race, which is the actual remaining gap. | Optimistic locking (§7) + a tuned `busy_timeout` pragma. |
| Network-filesystem-mounted SQLite files (NFS, most cloud "shared" volumes, some CSI drivers) | SQLite's own documentation explicitly warns file locking is unreliable over network filesystems — this is a genuine corruption risk, not a style preference. | Local block storage / a persistent volume backed by local disk for whichever single replica holds the writer connection. |

## Stack Patterns by Variant

**Self-managed Linux host (we configure):**
- systemd unit (`Restart=on-failure`, `EnvironmentFile=` for secrets), Caddy (or nginx) in front for TLS + reverse proxy, `better-sqlite3`'s `.backup()` API driven by a cron job or systemd timer, `express-rate-limit` in-app.
- Because: this shape gives full control, matches "no TE IT dependency," and every piece above is either already-installed-by-default (systemd) or a single OS package (Caddy) — no orchestration platform needed.

**Container image + config contract (TE-IT-run infra):**
- `Dockerfile` from `node:22-bookworm-slim`, `COPY . .` with no `npm install`/`npm ci` step (node_modules already committed with correct-ABI prebuilds), non-root `USER`, `/app/data` as a mounted persistent volume, `GET /health` for liveness/readiness, secrets via env-var injection only (no in-app secret store needed — TE IT's platform owns that), TLS terminates upstream of the container (document this as a contract requirement, do not add TLS handling in-container). **Config contract must pin replicas=1** given the single-process/single-writer recommendation above — call this out explicitly to TE IT as a hosting requirement, not an implementation detail they can silently override.
- Because: this preserves the zero-install property *inside* the container (still just `node server.js`, no build stage) while handing TLS, secrets, and process supervision to infra that already does those things — the container should do the minimum, not duplicate what the platform provides.

**App-layer-only multi-user safety (shared base, no infra changes assumed):**
- `express-rate-limit`, optimistic-locking version fields + 409 handling, `busy_timeout` tuning, and the ADMIN_TOKEN → hashed-break-glass-secret change (§4) are the pieces that live entirely in the app regardless of which hosting shape eventually wraps it — build and test these first, since both other shapes depend on this layer being correct.
- Because: this is the floor every deployment shape shares; get it right once instead of per-shape.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `express-rate-limit@8.6.2` | `express@^4.19.2` (installed) | Peer range is `express >= 4.11` — no Express upgrade needed; do not bump to Express 5 as a side effect of this milestone (out of scope, a separate decision per PROJECT.md). |
| `better-sqlite3@13.0.1` (installed) | Node >=22 | A `13.0.3` patch is available (registry-current as of this research) — safe minor bump if picked up incidentally, not required for anything in this milestone. |
| `better-sqlite3` committed prebuilds (`linux-x64-gnu`, `linux-arm64-gnu`) | glibc-based container base images only | Confirmed the blocker for Alpine — see "What NOT to Use." |
| Caddy 2.11.4 / nginx 1.30.4 | Either proxies plain HTTP from Node unchanged | No app-side code changes needed for either choice — `PUBLIC_BASE_URL` and `ENABLE_HSTS` (both already present per existing STACK.md) are the only app-level toggles that need setting correctly once a reverse proxy is in front. |
| `json_extract()` (SQLite JSON1) | Built into better-sqlite3's bundled SQLite (compiled in since SQLite 3.38+, well below any version better-sqlite3 13.x ships) | No dependency needed for the optimistic-locking `WHERE json_extract(data,'$.version') = ?` pattern — confirm during plan-phase against the exact SQLite version `better-sqlite3@13.0.1` bundles, but this has been core SQLite for years and is not a risk. |

## Optimistic locking mechanics (item 7, detailed)

Recommended mechanism, chosen specifically to avoid a schema migration and stay inside the existing whole-object/EAV model:

1. Store `version` **inside the item's JSON** (`item.version`, an integer starting at `1`), not as a new SQL column — every `ARRAY_COLLECTIONS` table already stores the whole item as an opaque `data` JSON blob (`id`, `project_id`, `seq`, `data`), so this needs zero `schema.sql` changes.
2. Reads are unchanged — `version` just travels as a normal field inside the item, same as today.
3. Writes for version-checked collections use a **conditional UPDATE**, not the existing unconditional one, for that specific action: `UPDATE <key> SET project_id = ?, seq = ?, data = ? WHERE id = ? AND json_extract(data,'$.version') = ?` (binding the version the client last read). Check `result.changes === 0` → the row moved since the client read it → return `409 Conflict` with the current server-side item so the client's reload UX has something to show. On success, increment `item.version` before serializing so the next client read carries the new value.
4. This composes cleanly with the existing snapshot-diff `writeDb()` — it only changes the `UPDATE` branch's SQL for opted-in collections, not the INSERT/DELETE logic or the overall transaction structure.
5. Scope this per-collection, not globally — start with the collections IL and workstream leads will genuinely co-edit (RAID entries, org positions/decisions, synergy initiatives, integration tasks are the obvious first candidates per the target-features list), since adding `version` changes the API contract for any endpoint that accepts a PUT/PATCH on that collection (clients must now send back the `version` they read). Full collection scoping is a plan-phase decision, not a stack decision.
6. Pair with `busy_timeout` (a `better-sqlite3` pragma, e.g. `PRAGMA busy_timeout = 5000`) so a burst of near-simultaneous writes queues briefly instead of throwing `SQLITE_BUSY` — cheap insurance once more than one process/thread is ever writing at once, and free even in the single-process recommendation for the rare case of two SQLite connections (e.g. a backup script running concurrently with the live app).

## Sources

- `db/store.js` (read directly) — the exact snapshot-diff `writeDb()`/`readDb()` mechanics this entire recommendation is built against.
- `.planning/PROJECT.md`, `.planning/codebase/STACK.md`, `package.json` — existing validated stack and milestone framing.
- npm registry (`npm view <pkg> version`, queried 2026-08-10) — `express-rate-limit@8.6.2`, `pm2@7.0.3`, `pg@8.23.0`, `node-pg-migrate@9.0.0`, `better-sqlite3@13.0.3` (latest, vs. installed 13.0.1), `express@5.2.1` (latest major, not recommended — see Version Compatibility), `sd-notify@2.8.0`, `proper-lockfile@4.1.2`, `helmet@8.3.0`. MEDIUM-HIGH confidence (direct registry query, no third-party interpretation).
- Web search, dated sources: nginx 1.30.4 stable / 1.31.3 mainline (both released 2026-07-15, per nginx.org release notes) — [nginx news: 2026](https://nginx.org/2026.html); Caddy 2.11.4 (released 2026-06-03) — [Caddy releases on GitHub](https://github.com/caddyserver/caddy/releases). MEDIUM confidence (web search synthesis; version numbers cross-referenced across multiple result snippets).
- Web search — better-sqlite3 multi-process/worker-thread patterns: [WiseLibs/better-sqlite3 issue #237 — worker threads usage](https://github.com/JoshuaWise/better-sqlite3/issues/237); SQLite's own documented caution against network-filesystem locking (general SQLite knowledge, not a single cited URL — verify against sqlite.org's "When To Use SQLite" / WAL documentation if this becomes a live decision point). MEDIUM confidence.
- Node.js LTS schedule — Node 22 is Maintenance LTS (through 2027-04-30), Node 24 is Active LTS, per [endoflife.date/nodejs](https://endoflife.date/nodejs) and search synthesis, 2026-08-10. Informational only — this milestone does not recommend bumping the `engines.node` floor above the existing `>=22`.
- better-sqlite3 `.backup()` API — general package knowledge (shipped since v7.x, long predates the installed 13.0.1); not independently re-verified via changelog in this pass — confirm against the installed version's docs during plan-phase before relying on it for the backup script.

---
*Stack research for: v2.2.0 Shared-Host Multi-User milestone — deployment/concurrency additions only*
*Researched: 2026-08-10*
