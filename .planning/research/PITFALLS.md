# Pitfalls Research — v2.2.0 Shared-Host Multi-User

**Domain:** Taking a single-process, laptop-local SQLite/Express MNPI app onto a shared host with concurrent real users
**Researched:** 2026-08-10
**Confidence:** HIGH (concurrency, session, and audit findings are grounded directly in this repo's `db/store.js`, `db/sessions.js`, `db/accessPolicy.js`, `server.js`, `DEPLOYMENT.md`; SQLite WAL/multi-writer guidance cross-checked against sqlite.org and community post-mortems; container/deployment guidance is well-established practice, not project-specific-verified)

**Ground truth this research is built on:**
- `db/store.js`'s `writeDb()` diffs `data[key]` against **this request's own `__snapshot`**, not live DB state or a row version. For an id already in the snapshot it issues an **unconditional `UPDATE`** — no `WHERE version = ?`, no compare-and-swap. This closes the *insert/delete* race (D-04, CR-01/CR-02) but does **nothing** for two concurrent edits to the *same* record's fields. Confirmed by reading the full function (lines 287–390).
- `connectionCache` (module-level `Map`) and `requestDbStorage` (`AsyncLocalStorage`) are **per-process** state. A second Node process has its own empty cache and its own better-sqlite3 handle onto the same file.
- `db/dbFiles.js` sets `journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 5000` — confirmed via grep.
- `db/sessions.js`: session `role` is **copied into the `sessions` row at login** (`createSession({..., role})`) and read straight off that row on every request (`server.js` line 434, `req.portalUser = sess`) — it is **never re-joined against the live `users` row**. TTL is absolute, no sliding renewal (`db/sessions.js` docstring, D-07).
- `server.js` line 658–661 and 563–566: session cookie is always `HttpOnly; SameSite=Strict`; `Secure` is appended **only if `ENABLE_HSTS=1`** is set.
- `server.js` line 838–857 (`POST /api/deals/:id/members`): when a member is removed, the code explicitly calls `sessions.releaseSessionsForDeal()` so their live session can't keep reading the deal file. This is the **only** existing "revoke on entitlement change" precedent in the codebase — there is no equivalent for a *role* change (no update-role endpoint exists yet; only `POST /api/admin/users/:username/revoke-sessions`, which is manual).
- `db/accessPolicy.js`'s DD clean-room grants (`grantedAreas()`) are read **fresh from the deal object on every request** (not session-cached) — DD-area clearance changes take effect immediately; this is the opposite behavior from role, and the asymmetry is easy to assume applies everywhere.
- `DEPLOYMENT.md`: MNPI at rest relies entirely on OS-level full-disk encryption — "SQLCipher was deferred." Real-deal DBs are gitignored (`data/runtime.db*`, `data/audit.db*`, `data/deals/`); `data/control.db` and `data/demo.db` are committed. `better-sqlite3@13.0.1` prebuilds require **glibc >= 2.38** (Ubuntu 24.04+/Debian 13+, or musl/Alpine).
- `server.js` graceful shutdown (lines 6870–6879) drains in-flight HTTP requests on `SIGTERM`/`SIGINT` with a 10s hard-kill fallback — but never explicitly closes the SQLite handle(s), and has no concept of "another process is also live right now."
- No Dockerfile exists in the repo today — containerization is greenfield for this milestone, no existing pattern to lean on or regress.
- No `.env` file/dotenv usage found — `ADMIN_TOKEN`/`DEMO_OPEN`/`ENABLE_HSTS` are read directly from `process.env`, set by the launcher scripts or the shell. There is currently nothing checked into git that itself contains a live secret, but there is also no secret-manager pattern to copy for the shared-host case.

---

## Critical Pitfalls

### Pitfall 1: The concurrency trap — multi-process SQLite writers with an in-process-only merge

**What goes wrong:**
Someone "goes multi-user" by simply running two (or more) `node server.js` instances behind a load balancer or a process manager's cluster mode, assuming WAL mode plus the existing snapshot-diff merge already makes this safe. It doesn't. Two users editing the *same* RAID entry, synergy line, or org position concurrently — even inside a single process — silently lose one edit, because `writeDb()`'s UPDATE path has no version check at all; it is a last-write-wins overwrite keyed only on "did my own snapshot see this id." Across two processes the risk compounds: each process's `connectionCache`/`AsyncLocalStorage` state is independent, so there is no shared in-memory coordination whatsoever, only whatever SQLite itself enforces at the file level.

**Why it happens:**
The Phase-1 `__snapshot` merge was explicitly designed and documented as "closes the same-collection lost-update race" (insert/delete races within one collection array) — a narrower guarantee than "concurrent edits are safe." It's easy to misread that comment as full concurrency safety. WAL mode's "readers don't block writers" reputation also gets over-generalized to "writers don't block or clobber each other," which is false — WAL solves reader/writer contention, not writer/writer contention.

**How to avoid:**
- Treat the "multi-writer architecture" decision (single-writer broker vs. cross-process advisory lock vs. Postgres) as the gating decision for this milestone, exactly as PROJECT.md already flags — do not let a phase ship optimistic locking on top of an unresolved multi-process write path.
- Whichever architecture is chosen, add a **real per-record version column** (`version INTEGER`) to co-edited tables and make `writeDb()`'s UPDATE conditional: `UPDATE ... SET ..., version = version + 1 WHERE id = ? AND version = ?`, checking `changes === 0` to detect a lost race — this closes Pitfall 1 (same-record concurrent writes) as a byproduct of closing Pitfall 2.
- If multiple Node processes are kept (vs. a single-writer broker), route every write for a given file through the SAME process (e.g., one writer process per deal file, or a lock service) rather than relying on SQLite's own locking to arbitrate; SQLite's `busy_timeout` turns contention into added latency and eventual `SQLITE_BUSY` errors, not into a safe, application-meaningful conflict response.
- Keep write transactions in `writeDb()` short (already true — a single `conn.transaction()` per request) and never widen it to span an `await` or external call.

**Warning signs:**
- Two browser tabs/users editing the same RAID/synergy/org record and one edit "disappears" with no error shown to either user.
- `SQLITE_BUSY: database is locked` errors appearing in logs only under multi-process load testing, not single-process testing.
- Load-testing with 2+ `node server.js` processes against the same `data/deals/<id>.db` produces different final state than running the same request sequence against one process.

**Phase to address:**
The "Concurrency safety" / multi-writer-architecture research-and-build phase (PROJECT.md's Target Feature 1) — this must be resolved before any other multi-user phase ships, since every subsequent collaboration feature (workstream-lead invites, presence, wizard handoff) adds more concurrent writers to the same problem.

---

### Pitfall 2: Optimistic locking implemented as UI decoration, not enforced at the write

**What goes wrong:**
A common shallow implementation: the client sends back a `version` field, the server reads it, compares it to the current record in application code, and if it matches proceeds to call the existing unconditional `writeDb()` path. This *looks* like optimistic locking (a 409 can even be returned "correctly" in the happy-path test) but has a TOCTOU (time-of-check-to-time-of-use) window between the compare and the actual UPDATE — under real concurrency two requests can both pass the compare before either writes, and the second write still silently clobbers the first.

**Why it happens:**
It's the natural way to bolt version-checking onto a codebase whose write primitive (`writeDb()`) is a whole-object diff, not a single conditional SQL statement. The compare-then-write pattern reads as "I already checked the version" without recognizing that the check and the write are not atomic.

**How to avoid:**
- The version check must be **inside the SQL**, in the same statement that performs the UPDATE: `UPDATE <table> SET data = ?, version = version + 1 WHERE id = ? AND version = ?`. Inspect `result.changes` — `0` means either the row was deleted or another writer's version already moved; both cases return a 409 to the client with the current server-side value for a reload, never a silent success.
- This has to be threaded through `db/store.js`'s array-collection UPDATE path specifically for tables the roadmap marks as co-edited (org positions, RAID entries, synergy initiatives, integration tasks) — not a blanket change to every collection, since some (e.g., audit rows, settings singletons) don't need it.
- Write a concurrency test that fires two overlapping `writeDb()`-equivalent requests at the same record from two open `readDb()` snapshots and asserts one gets a 409, not "last one wins with no error."

**Warning signs:**
- A 409 response exists in the API contract but no automated test ever forces the race window open (e.g., via two connections held mid-transaction) to prove it fires.
- The "conflict" check is written in JavaScript against a value read moments earlier, rather than as a `WHERE` clause on the write itself.
- QA only tests the conflict path by manually editing in two tabs slowly (which can't reliably reproduce the actual race window).

**Phase to address:**
Same phase as Pitfall 1 (multi-writer architecture / concurrency safety) — locking design and multi-process architecture are one decision, not two.

---

### Pitfall 3: WAL checkpoint contention and unbounded WAL growth under sustained concurrent writers

**What goes wrong:**
WAL mode defers writes into a `-wal` sidecar file and periodically checkpoints them back into the main `.db` file. Under sustained multi-user write load (several workstream leads all updating tasks during a live steerco prep session), checkpoints can be delayed or blocked by a long-running reader, causing the `-wal` file to grow unbounded — which on a shared host translates into unexpectedly large deal database directories, slower reads, and, in the worst case, a checkpoint that finally runs and briefly blocks all readers/writers for longer than `busy_timeout` covers.

**Why it happens:**
`synchronous = NORMAL` + WAL is the right choice for throughput, but the codebase currently has no explicit checkpoint policy (no `wal_autocheckpoint` tuning, no monitoring of `-wal` file size) because a single laptop user never produced enough write volume to notice.

**How to avoid:**
- Add a periodic or threshold-based `PRAGMA wal_checkpoint(PASSIVE)` (non-blocking) on a schedule appropriate to write volume, and reserve `TRUNCATE`/`RESTART` checkpoints for low-traffic windows (e.g., server startup, graceful shutdown) rather than mid-session.
- Monitor `-wal` sidecar file size per deal DB as part of the health/readiness endpoints this milestone is already adding (PROJECT.md's "Operational hardening").
- Keep transactions short (already true in `writeDb()`) — long-lived read transactions are the main thing that blocks checkpoints from making progress.

**Warning signs:**
- `data/deals/<id>.db-wal` growing to multiple times the size of the main `.db` file.
- Occasional multi-second write latency spikes correlating with WAL checkpoint events in logs.

**Phase to address:**
Operational hardening phase (health/readiness endpoints, backup/restore) — this is a monitoring and tuning concern layered on top of whatever the concurrency phase decides for the write architecture.

---

### Pitfall 4: A role or clearance change doesn't take effect on an already-open session

**What goes wrong:**
An admin demotes a workstream lead, changes their role, or revokes a per-area grant mid-deal. Because `sessions.role` is a snapshot copied in at `createSession()` time and read straight off the session row on every request (`server.js` line 434), the change has **zero effect** on that person's already-open browser session until it expires (the TTL is absolute, no sliding renewal — so this could be hours) or is explicitly revoked. Meanwhile the person keeps operating — and, worse, keeps writing audit rows — under the stale, higher (or now-wrong) privilege.

**Why it happens:**
The session-row-as-cache-of-identity pattern was a deliberate performance/simplicity choice for the single-operator laptop app (avoid a join on every request) and was correct for that context. It becomes a real access-control gap the moment role/clearance changes happen *during* a live multi-user session on a shared host, which wasn't a realistic scenario before.

**How to avoid:**
- Follow the exact precedent already in this codebase (`POST /api/deals/:id/members`, lines 846–851): every endpoint that writes a role or clearance change must call `sessions.deleteAllSessionsForUser()` (or a new narrower "revoke this deal's binding only" variant, mirroring `releaseSessionsForDeal()`) in the same request, not leave it to a manual admin action.
- When workstream-lead invite/clearance-grant features are built this milestone (PROJECT.md's "per-area clearance grants set at setup"), design the grant-change endpoint with automatic revocation from day one — do not ship it first and bolt revocation on later.
- Consider whether role (not just DD area clearance) should move to the "read fresh from `users` table on every request" pattern `db/accessPolicy.js` already uses for DD areas, if role changes are expected to be frequent under multi-user operation — that removes the whole class of staleness rather than patching each mutation site.

**Warning signs:**
- A revoked/demoted user's UI still shows admin-only controls and those controls still succeed against the API after the change was saved.
- No automated test exercises "change role, then make a request on the OLD session token, assert 403."

**Phase to address:**
Workstream-lead collaboration phase (invite/onboard with per-area clearance grants) — this is exactly the feature surface that introduces mid-deal role/clearance changes for the first time; the phase plan must include the revoke-on-change call, not just the grant-write.

---

### Pitfall 5: Session cookie loses its `Secure` flag on a real TLS origin because `ENABLE_HSTS` wasn't set

**What goes wrong:**
The demo runs over plain `http://localhost`, so the cookie code correctly omits `Secure` unless `ENABLE_HSTS=1`. On the shared host, the operator stands up a real TLS-terminating reverse proxy but forgets to also set `ENABLE_HSTS=1` on the Node process behind it (a separate, easy-to-miss env var from the TLS cert/proxy config itself) — the session cookie for `ma_session` is then sent without `Secure`, meaning it would also be transmitted in the clear if the origin were ever reachable over plain HTTP (e.g., a misconfigured proxy that doesn't force-redirect http→https, or an internal hop between proxy and Node that isn't itself encrypted).

**Why it happens:**
`ENABLE_HSTS` was named and scoped for the HSTS header, and the cookie `Secure` flag was piggybacked onto the same flag as a convenient existing "we're on real TLS" signal — reasonable for one launcher script, but it means TLS setup and cookie-security setup are two separate manual steps that look unrelated in the deployment docs unless called out explicitly.

**How to avoid:**
- The self-managed-host deployment doc/tooling for this milestone must make `ENABLE_HSTS=1` a **mandatory, checked** step of the TLS setup runbook, not an optional hardening flag — ideally the server should refuse to boot (or log a loud `[security]` warning matching the existing `DEMO_OPEN`/`ADMIN_TOKEN` pattern) if it detects it's behind a proxy header indicating TLS (`X-Forwarded-Proto: https`) while `ENABLE_HSTS` is unset.
- Consider renaming/splitting the flag conceptually in docs even if the env var stays the same, so "cookie Secure flag" isn't buried inside an HSTS-named toggle.
- For the container/TE-IT-run shape, bake `ENABLE_HSTS=1` into the documented required config contract, not left to operator discretion.

**Warning signs:**
- Inspecting the `Set-Cookie` header on a real-deal shared-host deployment and finding no `Secure` attribute despite the browser address bar showing `https://`.
- `DEPLOYMENT.md`'s real-deal checklist doesn't mention `ENABLE_HSTS` at all today — confirmed by reading the file; it must be added.

**Phase to address:**
Deployment phase (self-managed host: reverse proxy + TLS) — should ship as a startup-time check, not just a doc line.

---

### Pitfall 6: No idle timeout or concurrent-session-count limit, and no visible session inventory

**What goes wrong:**
Sessions today have an absolute TTL and no sliding renewal (deliberate, per `db/sessions.js`'s docstring) — reasonable for a single laptop operator. At multi-user shared-host scale, two gaps open up: (1) a user can accumulate an unbounded number of concurrent sessions (every device/browser they ever log in from, forever, until the TTL individually expires), with no way for the user or an admin to see "these are my active sessions, revoke this one"; (2) there's no idle-timeout concept distinct from absolute TTL, so a session left open on a shared or unattended machine for the length of a long TTL stays live even with zero activity.

**Why it happens:**
Single-operator laptop use never surfaced either gap — one person, one machine, one session at a time in practice.

**How to avoid:**
- Add an idle-timeout column/check alongside the existing absolute `expires_at` (e.g., `last_seen_at`, refreshed opportunistically, with a shorter idle cutoff than the absolute TTL) — this is additive to, not a replacement for, the deliberate "no silent indefinite renewal" design.
- Add a "my active sessions" self-service view (device/UA/IP/last-seen, calling the existing `deleteSession`/`deleteAllSessionsForUser` primitives) and an admin equivalent, rather than only the blunt `revoke-sessions` admin endpoint that already exists.
- Decide and document a concurrent-session cap per user if TE's expectations require it (not clearly required by MNPI handling alone, but worth an explicit decision rather than an implicit "unlimited").

**Warning signs:**
- No endpoint anywhere lets a user or admin enumerate live sessions for an account.
- A session opened on a since-repurposed shared conference-room laptop stays valid for the full absolute TTL with no activity.

**Phase to address:**
Operational hardening phase (sessions at scale) — PROJECT.md already names this explicitly.

---

### Pitfall 7: New collaborative write paths ship without the audit hook, or without an attributable actor

**What goes wrong:**
`writeDb()`'s audit hook (D-11) already refuses to write an anonymous audit row and throws if an "audited" `dbKind` context resolves with no actor — a strong existing guarantee. But that guarantee only covers writes that go through the whole-object `writeDb()` path with a properly scoped `runWithDb()` context. New multi-user surfaces this milestone adds — presence/status pings, workstream-lead onboarding-step handoffs, comments or collaboration notes on records, invite acceptance — are exactly the kind of new, narrow, high-frequency endpoints that get built as their own lightweight DB writes (mirroring `db/sessions.js`'s precedent of *not* going through `writeDb()` for high-frequency, non-business-object writes) and can silently fall outside `AUDITED_DB_KINDS`/the audit hook entirely if the author doesn't deliberately route them through it.

**Why it happens:**
High-frequency, low-"business value" writes (a presence heartbeat every N seconds) create real pressure to skip the heavier whole-object audit path for performance reasons — `db/sessions.js` sets a precedent that "some tables legitimately bypass `writeDb()`," and it's easy to over-apply that precedent to a new table that *should* be audited (e.g., a clearance-grant acceptance, an ownership handoff) because it superficially looks like plumbing rather than a business record.

**How to avoid:**
- For every new table/endpoint this milestone introduces, explicitly decide and document whether it is audited or explicitly exempt (mirroring `db/sessions.js`'s own comment explaining *why* it's exempt) — never let "we didn't get to it" be the reason a write silently isn't audited.
- Ownership handoffs, clearance-grant creation/acceptance, and invite issuance are control-plane-adjacent actions (same category as `deal-members-update`, `password-change`) — route them through `auditHook.recordSecurityEvent()` explicitly, the same pattern already used for deal membership and session revocation.
- Add a coverage test analogous to Phase 3's "every write route is validated" test (mentioned in PROJECT.md), but for audit coverage: fail the suite if a new POST/PUT/DELETE route under `/api` has no corresponding audit call and isn't on an explicit exemption list.

**Warning signs:**
- A new collaboration feature ships and the admin audit viewer shows no entries for actions users can clearly see happened (e.g., "X handed off ownership to Y" visible in the UI but absent from `/api/admin/audit`).
- Presence/heartbeat writes accidentally land in the audited path and flood the audit log with noise (the opposite failure — also worth guarding against).

**Phase to address:**
Workstream-lead collaboration phase and deal-setup wizard enhancement phase — both introduce genuinely new write surfaces; each phase's plan should include an explicit audit-coverage checklist item, not assume Phase 3's blanket coverage automatically extends.

---

### Pitfall 8: A presence/activity feed leaks who's-on-which-deal or a pre-announcement codename

**What goes wrong:**
"Presence/status" (PROJECT.md's own target feature) is exactly the kind of feature that, implemented naively, becomes an MNPI leak vector distinct from the record-level clean-room controls already built. A presence indicator or activity feed that shows "3 people currently viewing [Project Falcon]" or a browser tab title / notification / toast that names the deal is visible to *anyone who can see the UI chrome* — including over someone's shoulder, in a screen share, or in a browser history/tab-switcher preview — regardless of whether they're cleared for that deal's content. This is a different threat than record-level access control: it leaks the deal's *existence and current activity*, not its content, and existence itself is often the sensitive fact pre-announcement.

**Why it happens:**
Presence features are almost always designed around "make collaboration feel alive," and the design conversation defaults to showing names/avatars/deal names because that's the obviously useful version — the MNPI angle (codename discipline, need-to-know on *existence*, not just content) isn't the first thing that comes to mind when building a presence widget.

**How to avoid:**
- Scope presence strictly to users who already have deal membership — never show cross-deal presence (e.g., a global "who's online" list must not reveal which named deal someone is currently in unless the viewer is also a member of that deal).
- Reuse the deal's existing codename/display-name convention (if TE requires pre-announcement codenames — confirm with the user) consistently in any presence UI, not the real target company name, until the deal's disclosure stage permits it.
- Treat "presence visible in browser chrome" (tab title, OS notification, taskbar) as in-scope for the MNPI threat model, not just in-app UI — audit what a screen-share or shoulder-surf would reveal.
- Extend `db/accessPolicy.js`'s existing "filter, don't expose-then-hide" pattern (`filterByAreaGrant`) to presence: the server should never send presence data for a deal/area the requester isn't cleared for, rather than sending it and hiding it client-side.

**Warning signs:**
- A presence feature demo where the reviewer can see deal names/activity for deals they are not a member of, even if the content behind those deals is correctly gated.
- Browser tab title or OS-level notification includes the real target company name rather than a codename or generic "M&A Portal" label.

**Phase to address:**
Workstream-lead collaboration phase (invite/onboard + presence/status is explicitly named there in PROJECT.md) — this deserves its own explicit threat-model pass at discuss-phase time, not an assumption that Phase 3/4's clean-room controls automatically cover it.

---

### Pitfall 9: `DEMO_OPEN=1` reaching the shared host — now with more people who could make the mistake

**What goes wrong:**
This risk is already flagged in `DEPLOYMENT.md` for the laptop case ("Never run `start.command`... on a host that will hold real deal data"), but multi-user shared hosting changes the blast radius and the operator population: instead of one person controlling one launcher choice, a shared host may be provisioned by IT, restarted by a process manager, or redeployed via a script — any of which could default to the demo launcher, a copied systemd unit file with a stale `DEMO_OPEN=1`, or a container image built from the wrong entrypoint. Once wrong, *every* concurrent user on the shared host is silently unauthenticated at once, not just one laptop.

**Why it happens:**
Process managers, systemd units, and container entrypoints are typically configured once and then left alone — the boot-time `[security]` console warning that catches this today on a manually-launched laptop process is easy to miss in a service manager's log stream that nobody tails, and doesn't stop the process from serving traffic.

**How to avoid:**
- For the self-managed host: the service-manager unit file this milestone's deployment tooling produces must not merely omit `DEMO_OPEN` by default — it should be impossible to accidentally inherit it from a copied demo unit (e.g., the real-deal unit file explicitly sets `Environment=DEMO_OPEN=` empty/unset, doesn't rely on absence).
- For the container shape: bake two distinct, clearly-named image tags or entrypoint scripts (`real-deal`, `demo`) rather than one image controlled by a runtime env var that a deployer could copy-paste wrong from another deployment's config.
- Make the existing boot-time warning louder than console-only for a shared-host context: also expose it on `/healthz` or a dedicated `/readyz` field (`demoOpen: true`) so a monitoring/alerting integration (or a human hitting the health endpoint) catches it even without reading process logs.
- Consider a hard refusal-to-boot if `DEMO_OPEN=1` is combined with a signal that this is not a demo (e.g., a populated `data/deals/` directory, or a new explicit `DEPLOYMENT_MODE=real-deal` flag that must never coexist with `DEMO_OPEN=1`) — fail loudly rather than silently open.

**Warning signs:**
- A systemd/process-manager unit file or Dockerfile entrypoint for the real-deal deployment was copy-pasted from the demo one and only the port/path was changed.
- `/healthz` (or its successor) gives no signal about auth posture at all today — confirmed by reading the handler.

**Phase to address:**
Deployment phase (self-managed host tooling + container image), with the health-endpoint signal owned by the operational-hardening phase.

---

### Pitfall 10: Backups of MNPI databases land unencrypted, world-readable, or off-host without the same handling as the source

**What goes wrong:**
`DEPLOYMENT.md` already states the deployment-layer control for MNPI-at-rest is OS full-disk encryption on the *primary* host — but backups are a second, easily-forgotten copy of the same data. A generic backup script (cron `cp`/`rsync`/`sqlite3 .backup` to a network share, an unencrypted S3-compatible bucket, or a laptop the operator drags a copy onto "just in case") re-creates the MNPI-at-rest exposure the primary host's FDE was specifically relied on to close — but on a medium that may have no disk encryption, no access control, and no audit trail at all.

**Why it happens:**
Backup tooling is usually built for operational recoverability first ("can we restore after a crash") and MNPI handling is treated as a property of the live host, not something that needs to be re-asserted for every derived copy.

**How to avoid:**
- Treat backup destination encryption and access control as part of the same MNPI control set as the primary host, explicitly, in the deployment runbook — DEPLOYMENT.md's existing "back up `data/` with the same handling as the source data" line is the right instinct but needs concrete mechanics (encrypted backup target, retention policy, who can read backups) once backups become an automated, unattended process rather than a manual copy.
- Use SQLite's own `.backup` API (safe against WAL torn-page reads) rather than a raw file copy of a live `.db`+`.db-wal` pair, to avoid a corrupt/inconsistent backup as a separate correctness issue.
- Ensure a backup never captures a database mid-write in a way that captures a partially-applied multi-collection `writeDb()` transaction — `.backup` against a WAL-mode SQLite file is safe for this by design, a raw filesystem copy of `.db` alone (without the `-wal`) is not.
- Confirm backups are excluded from anything that syncs to a non-TE-controlled location (personal cloud storage, a laptop) — this is a policy/documentation control, not a code control, but belongs in the same runbook.

**Warning signs:**
- A backup cron job exists that isn't documented anywhere in the deployment guide, or writes to a path outside the host's encrypted volume.
- No test/runbook step verifies a restored backup is byte-consistent with a `.backup`-API-produced source rather than a raw copy taken mid-write.

**Phase to address:**
Deployment/operational-hardening phase (backup/restore is explicitly named in PROJECT.md's target features).

---

### Pitfall 11: Rolling restarts (or crashes) drop in-flight writes or create a brief dual-process window

**What goes wrong:**
The existing graceful shutdown (drain HTTP, 10s hard-kill fallback) protects one process's in-flight requests during a clean stop, but a shared-host deploy commonly involves either (a) a rolling restart under a process manager that briefly runs old and new processes simultaneously against the same file (reintroducing Pitfall 1's multi-process problem for a short but real window), or (b) an ungraceful crash/OOM-kill that skips the drain path entirely, in which case an in-flight `writeDb()` transaction either fully commits or fully rolls back (SQLite's transactional guarantee holds), but the *client* never learns which happened and may retry, double-submitting.

**Why it happens:**
The graceful-shutdown code was written and is entirely correct for the single-process laptop case; it was never asked to reason about "is there another process also live right now," because there wasn't one.

**How to avoid:**
- Whatever multi-writer architecture Pitfall 1 lands on should define the restart/deploy sequence explicitly: for a single-writer-process design, restarts must be strictly sequential (old process fully stopped, including its DB handle closed, before the new one opens the same file) — never overlapping "start new, then stop old" unless the chosen architecture (e.g., a lock service or Postgres) is specifically safe for overlap.
- Extend the shutdown handler to close the better-sqlite3 connection(s) explicitly (`db/store.js`'s `closeAllConnections()` already exists for tests — reuse it in the production shutdown path too) rather than relying on process exit to release the OS file handle.
- Make writes idempotent where the client might retry after an ambiguous failure (the optimistic-locking version field from Pitfall 2 doubles as a natural idempotency guard here — a retried write with the same expected version either succeeds once or 409s cleanly on retry).

**Warning signs:**
- A deploy/restart procedure exists in the ops runbook that doesn't specify "wait for full process exit before starting the replacement" for the SQLite-file-based architecture.
- `shutdown()` in `server.js` never calls into `db/store.js`'s connection-close path — confirmed by reading the function; it only calls `server.close()`.

**Phase to address:**
Deployment phase (graceful restart is explicitly named in PROJECT.md's target features) — should be co-designed with whichever multi-writer architecture Pitfall 1 lands on, since the safe restart sequence differs by architecture choice.

---

### Pitfall 12: The demo/real separation erodes under multi-user or containerized deployment

**What goes wrong:**
The demo/real separation today rests on several assumptions that were safe for one laptop process and get stress-tested by this milestone: a single `DEMO_OPEN` env var per process, a single `data/` directory holding both `demo.db` (committed, meant to be public-ish/showcase) and real deal files (gitignored, MNPI), and file-per-deal resolution keyed by request context. On a shared host or in a container, it becomes newly possible to (a) run a demo-mode container and a real-deal container against a **shared volume** that includes both `demo.db` and real `deals/*.db`, blurring what should be a hard boundary; (b) let a demo-mode deployment's `git`-committed `demo.db` accidentally get overwritten by data that started as a real deal if a deal is ever created against the wrong launcher before the operator notices; (c) have TE-IT-run container infra apply one set of security controls (network policy, secrets) uniformly to "the app," not realizing demo and real-deal are meant to be two different trust zones from one image.

**Why it happens:**
The separation was built and reasoned about as an in-process routing decision (`db/resolver.js`'s per-request bind), which is airtight *within* a correctly-configured single process, but the container/shared-host packaging layer this milestone adds is a new place where the separation could be recreated incorrectly (e.g., one shared volume, one container, toggled by env var) without anyone touching the application code that's actually correct.

**How to avoid:**
- The container/config contract this milestone defines should treat demo and real-deal as **separate deployments** (separate containers, separate volumes, separate images/tags per Pitfall 9) rather than one image with a runtime toggle and a shared data volume — this is a packaging-layer decision, not something `db/resolver.js` can enforce on its own.
- Document explicitly in the container config contract that `data/` must never be a single shared volume across a demo instance and a real-deal instance.
- Add a startup-time check (or a `/healthz` field) reporting which mode + which physical `data/` path a given process resolved, so a misconfigured shared volume is visible immediately rather than discovered when demo showcase data and real MNPI show up in the same admin view.

**Warning signs:**
- A container/orchestration manifest mounts one volume path for both a demo and a real-deal deployment.
- `data/demo.db`'s git history shows unexpected changes that don't match known demo-content commits (a sign real data landed there).

**Phase to address:**
Deployment phase (container image + config contract) — this is the newest packaging surface this milestone introduces and has no existing precedent to lean on.

---

### Pitfall 13: Container build/runtime mistakes specific to this codebase's committed-artifacts model

**What goes wrong:**
This app's "committed `node_modules`, committed platform-specific native `better-sqlite3` prebuilds, committed `demo.db`/`control.db`, vendored Transformers.js" model is exactly built for the zero-install turnkey-zip case, and each of those choices becomes a distinct container trap: (1) `git archive`/`COPY . .` into an image layer bakes `data/control.db`/`data/demo.db` into every image build — fine for control.db/demo.db (already committed, non-MNPI-by-design), **but a Dockerfile that's later copy-pasted or generalized to also `COPY data/` wholesale would bake real deal files (if ever present in the build context) straight into an image layer**, which then persists in image history/registry even after deletion from a later layer; (2) a slim/Alpine base image with the wrong libc mismatches the committed `better-sqlite3@13.0.1` prebuild requirement (glibc >= 2.38, confirmed in `DEPLOYMENT.md`) — Alpine is musl, not glibc, and while musl prebuilds are noted as shipping too, a base image chosen without checking this fails to load the native binding at boot, or worse, silently falls back to a different resolution path if one exists; (3) no declared volume for `data/` means container restarts/redeploys silently wipe or orphan the real-deal SQLite files unless the orchestration layer is told explicitly to persist that path; (4) running the Node process as root inside the container (the default for most minimal Dockerfiles unless a `USER` directive is added) is unnecessary privilege for a process that only needs to read/write its own `data/` directory and listen on one port.

**Why it happens:**
None of these are mistakes the current codebase has *made* — there's no Dockerfile yet — they're the standard failure modes of writing a first Dockerfile for an app with unusual packaging choices (committed deps, committed native binaries, committed-but-selectively-gitignored data files) without carrying forward the reasoning already documented in `.gitignore` and `DEPLOYMENT.md` about which files are safe to ship and which are runtime-only/MNPI.

**How to avoid:**
- Write the Dockerfile's `COPY`/`.dockerignore` rules to mirror `.gitignore`'s existing MNPI boundary exactly (exclude `data/runtime.db*`, `data/audit.db*`, `data/deals/` from the build context the same way git does) — treat `.dockerignore` as a second copy of the same security-relevant list, and add a CI check that fails if the two drift.
- Declare `data/` as an explicit named volume/bind mount in the image and its compose/orchestration docs, and document that a fresh container without that volume mounted must not silently start "empty" and accept writes — prefer a startup check that refuses to serve real-deal traffic if `data/` isn't a persistent mount (heuristics: e.g., an overlay/tmpfs filesystem type check, or a marker file convention).
- Explicitly pin and verify the base image's libc against the committed `better-sqlite3` prebuild requirement (`DEPLOYMENT.md`'s existing glibc >= 2.38 / musl note) as part of the Dockerfile's own comments, and add a boot-time smoke test (already implicitly exists via `initDb()` failing loudly) to the container's health check so a libc mismatch fails the container health check immediately rather than manifesting as a mysterious crash loop.
- Add a non-root `USER` directive and confirm the app's write paths (`data/`, any temp/upload dirs) are owned by that user, not root, in the image build.

**Warning signs:**
- `docker history` on a built image shows a layer containing anything under `data/deals/` or `data/runtime.db*`/`data/audit.db*`.
- Container fails at startup with a native-module load error that only reproduces inside the container, not on the host running the same Node version.
- A `docker-compose down -v` (or equivalent) silently destroys deal data because no named volume was declared.

**Phase to address:**
Deployment phase (container image + config contract for TE-IT-run infra) — this is entirely new surface for this milestone; treat the `.gitignore` MNPI list as the source of truth `.dockerignore` must be kept in sync with.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|--------------------|-----------------|------------------|
| Ship optimistic locking with an app-level (not SQL-`WHERE`-level) version compare | Faster to build, passes happy-path tests | TOCTOU window reopens the exact lost-update bug the milestone exists to close | Never for MNPI co-edited records |
| Run multiple Node processes on the current `writeDb()` merge without a chosen multi-writer architecture | "It probably works most of the time" gets multi-user demoed quickly | Silent, hard-to-reproduce data loss under real concurrent load — the worst kind of bug to debug in production | Never — this is the milestone's core unknown, not a deferrable detail |
| One shared `DEMO_OPEN` env-var toggle instead of separate demo/real container images | One image to build/maintain | A single misconfigured deploy exposes MNPI to every concurrent user at once, not one laptop | Only acceptable for local dev, never for the shared-host/container shape |
| Skip idle-timeout / concurrent-session limits this milestone | Less new session-table surface to build/test | A stolen or unattended session on a shared host stays live for the full absolute TTL with no independent trigger to end it | Acceptable short-term ONLY if absolute TTL is tightened correspondingly and documented as a known gap |
| Backup via raw filesystem copy of the `.db` file instead of SQLite's `.backup` API | Simpler script, no new dependency | Risk of a torn/inconsistent backup if taken mid-write under real concurrent load (which didn't exist on the laptop) | Never once the app is genuinely multi-writer |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|------------------|--------------------|
| Reverse proxy (TLS termination) | Terminate TLS at the proxy but forget `ENABLE_HSTS=1` on the Node process behind it, so the session cookie loses `Secure` | Make `ENABLE_HSTS=1` a checked, mandatory step of the TLS runbook; consider a startup check against `X-Forwarded-Proto` |
| Process manager (systemd/pm2/etc.) | Copy the demo unit file for the real-deal service, inheriting `DEMO_OPEN=1` or its absence-of-explicit-unset ambiguity | Real-deal unit file explicitly sets `DEMO_OPEN=` empty; never rely on "the demo one just isn't set" |
| Container orchestration (TE-IT-run) | Mount one shared volume for `data/` across a demo and a real-deal deployment, or omit a volume entirely | Separate volumes/images per mode (Pitfall 12); explicit named volume + startup check that refuses to serve without persistent `data/` |
| Load balancer / rolling deploy | Route traffic to both the old and new process during a rolling restart of a SQLite-file-based single-writer service | Sequence restarts strictly (old fully stopped, including DB handle closed, before new starts) until/unless the chosen multi-writer architecture is proven safe for overlap |
| Backup tooling (cron/rsync/cloud sync) | Raw-copy the live `.db` (with or without `-wal`) to an unencrypted or non-TE-controlled destination | Use SQLite's `.backup` API; treat the backup destination under the same MNPI-handling policy as the source |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| No WAL checkpoint tuning | `-wal` sidecar grows unbounded; occasional multi-second write latency spikes | Scheduled `PRAGMA wal_checkpoint(PASSIVE)`, short transactions, monitor `-wal` size via health endpoint | Sustained multi-user write sessions (e.g., several workstream leads updating tasks simultaneously during steerco prep) |
| `busy_timeout` alone treated as "concurrency solved" | Writes silently queue and slow down under load, or start throwing `SQLITE_BUSY` once the 5s timeout is exceeded, with no application-level signal to the user about why | Combine `busy_timeout` with short transactions and, per the chosen architecture, a single-writer discipline — never treat timeout tuning as a substitute for an actual concurrency design | Once concurrent-writer count and write frequency exceed what a 5s timeout can absorb — exact threshold depends on chosen architecture, must be load-tested, not assumed |
| Synchronous session lookup on every request against a growing `sessions` table with no periodic prune scheduled beyond opportunistic login-time pruning | Slight per-request latency creep as stale session rows accumulate under multi-user load with many more logins/day than the laptop case | Confirm `pruneExpiredSessions()` runs on a real schedule (not just opportunistically at login) once login frequency scales with multiple concurrent users | Once total historical session-row count grows large enough for the (currently unindexed-by-default beyond token_hash) table scan patterns to matter — worth a look once daily active users exceeds single digits |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Version-compare done in application code, not the SQL `WHERE` clause | Optimistic locking looks implemented but the lost-update race it's meant to close still happens under real concurrency (Pitfall 2) | Version check must be part of the same atomic `UPDATE ... WHERE version = ?` statement |
| Session `role` treated as always-current | A demoted/revoked user keeps acting under stale privilege for up to the full absolute TTL (Pitfall 4) | Auto-revoke sessions on every role/clearance-affecting write, mirroring the existing `releaseSessionsForDeal()` precedent |
| New collaborative write routes built as lightweight bypasses of `writeDb()`'s audit hook | Silent audit gap on exactly the new actions (handoffs, grants, invites) that most need a trail (Pitfall 7) | Explicit audited/exempt decision per new route, with a coverage test |
| Presence/activity UI shows deal name or member identity to non-members, or in OS-level chrome (tab title/notifications) | Leaks a pre-announcement deal's existence and activity — a distinct MNPI exposure from record-level content leaks (Pitfall 8) | Server-side filter presence by deal membership before it ever reaches the client; codename discipline in any presence surface |
| `ENABLE_HSTS` treated as optional hardening rather than a required step of real-TLS deployment | Session cookie sent without `Secure` on a real production TLS origin (Pitfall 5) | Make it a mandatory, checked runbook step; consider a startup-time refusal/warning based on `X-Forwarded-Proto` |
| Backups handled as a generic ops concern, decoupled from the app's MNPI classification | A backup copy re-creates the at-rest exposure the primary host's FDE was relied on to close, on a medium with weaker controls (Pitfall 10) | Same MNPI handling policy for backup destinations as for `data/` itself; documented explicitly, not assumed |
| Dockerfile `COPY`/build context not kept in lockstep with `.gitignore`'s MNPI exclusions | Real deal files baked into an image layer, persisting in registry history even after later deletion (Pitfall 13) | `.dockerignore` mirrors `.gitignore`'s MNPI list exactly; CI check to catch drift |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| A 409 conflict on a co-edited record shows a generic error with no reload path | User loses their in-progress edit and has to redo it from scratch, blind to what changed | Reload UX (explicitly named in PROJECT.md) — show what changed, offer to reapply the user's delta where possible, never just "try again" |
| Presence indicator shows raw names/deal names with no regard to who's viewing it | A screen-share, shoulder-surf, or shared-screen moment leaks a pre-announcement deal to someone not cleared for it | Server-side membership filtering before presence data reaches the client (Pitfall 8) |
| No visible "you're the only writer" vs. "N people editing this record" signal | Users assume single-user safety habits (edit slowly, don't worry about conflicts) that no longer hold once multi-user is live | Surface record-level co-edit awareness in the UI once the concurrency architecture exists to back it |

## "Looks Done But Isn't" Checklist

- [ ] **Optimistic locking:** Often missing an atomic `WHERE version = ?` in the actual SQL — verify with a real overlapping-write test, not a sequential two-tab manual test.
- [ ] **Multi-process safety:** Often "tested" only by running one process under multi-user *browser* load — verify by literally running 2+ `node server.js` processes against the same deal file under concurrent writes.
- [ ] **Role/clearance revocation:** Often implemented for the deal-membership case (already exists) but not extended to role changes or new clearance-grant types added this milestone — verify every new "who can do what" mutation site calls a revoke/re-bind primitive.
- [ ] **Audit coverage on new routes:** Often assumed to be inherited from Phase 3's blanket coverage — verify explicitly per new route added this milestone, since new routes built outside `writeDb()`'s whole-object path don't get it for free.
- [ ] **Graceful shutdown:** Often verified only for "does the process exit cleanly," not "does it close its DB handle" or "is it safe if a second process is starting at the same moment" — verify against the actual chosen multi-writer architecture's restart sequence.
- [ ] **`ENABLE_HSTS` on real TLS:** Often set on the proxy but forgotten on the Node process itself — verify by inspecting the actual `Set-Cookie` header on the deployed origin, not just the proxy's TLS cert.
- [ ] **Backup restorability:** Often verified as "the backup script ran without error," not "a restored backup produces byte-consistent, non-corrupt data under a WAL-mode file taken mid-write" — verify with an actual restore drill under write load.
- [ ] **Container MNPI boundary:** Often verified as "the app boots in the container," not "`docker history` contains zero MNPI-eligible paths and a fresh container without the data volume refuses real-deal traffic" — verify both explicitly.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|-----------------|------------------|
| Lost update from unconditional UPDATE (Pitfall 1/2) discovered in production | MEDIUM | Restore from the append-only audit log's before/after JSON (already captured per-row by `writeAuditBatch`) to reconstruct the lost edit's content; manually reapply; then ship the atomic version-check fix before it can recur |
| Stale-privilege session used after a role/clearance change (Pitfall 4) | LOW | Call the existing `POST /api/admin/users/:username/revoke-sessions` immediately; audit log already attributes what that session did in the gap (D-08's `admin-token-use`/security-event pattern extends here) so impact can be assessed |
| MNPI baked into a container image layer (Pitfall 13) | HIGH | Image must be deleted from every registry it reached (history persists even after a later layer removes the file) — not just the current tag; treat as a real MNPI incident requiring TE's disclosure process, not a quiet fix |
| Unencrypted backup discovered off-host (Pitfall 10) | HIGH | Same incident-handling posture as the container case — the backup medium's access history needs review, not just deletion of the file |
| `DEMO_OPEN=1` discovered live on the shared host (Pitfall 9) | HIGH | Immediately stop the process; audit log review for the exposure window (though DEMO_OPEN bypasses auth, not the audit hook itself — confirm what, if anything, was logged); rotate any credentials/tokens that could have been read during the window |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|--------------------|----------------|
| 1. Multi-process concurrency trap | Concurrency-safety / multi-writer-architecture phase | Load test with 2+ live processes against one deal file; assert no silent data loss |
| 2. Optimistic locking not enforced in SQL | Same phase as #1 | Concurrency test forcing the exact race window; assert a real 409, not last-write-wins |
| 3. WAL checkpoint contention | Operational hardening phase | Monitor `-wal` file size in health checks under sustained write load |
| 4. Stale role/clearance on open sessions | Workstream-lead collaboration phase | Test: change role mid-session, confirm old token 403s on next request |
| 5. Cookie loses `Secure` on real TLS | Deployment phase (self-managed host TLS) | Inspect `Set-Cookie` on the deployed origin; startup check against `X-Forwarded-Proto` |
| 6. No idle timeout / session inventory | Operational hardening phase | Self-service "my sessions" view exists and works; idle cutoff enforced independent of absolute TTL |
| 7. Audit gaps on new collaborative routes | Workstream-lead + wizard phases | Coverage test analogous to Phase 3's write-validation coverage test, applied to audit calls |
| 8. Presence leaking deal identity | Workstream-lead collaboration phase | Non-member cannot see presence/activity for a deal they're not on, verified server-side |
| 9. `DEMO_OPEN=1` on shared host | Deployment phase | Real-deal unit file/image explicitly unsets `DEMO_OPEN`; `/healthz` surfaces auth posture |
| 10. Unencrypted/unmanaged backups | Deployment / operational hardening phase | Restore drill from an actual `.backup`-API-produced backup; destination encryption verified |
| 11. Unsafe restarts dropping/racing writes | Deployment phase | Shutdown handler closes DB connections; restart sequence matches chosen multi-writer architecture |
| 12. Demo/real separation erosion in packaging | Deployment phase (container/config contract) | Separate volumes/images per mode enforced in the config contract, not just app-layer routing |
| 13. Container build/runtime MNPI + libc mistakes | Deployment phase (container image) | `.dockerignore` audited against `.gitignore`; `docker history` scanned; non-root `USER`; named volume required |

## Sources

- Direct codebase inspection (HIGH confidence, primary source): `db/store.js`, `db/sessions.js`, `db/accessPolicy.js`, `db/dbFiles.js`, `server.js` (auth gate, cookie issuance, shutdown, deal-membership revocation), `DEPLOYMENT.md`, `.gitignore`, `.planning/codebase/CONCERNS.md`, `.planning/PROJECT.md`.
- [SQLite Write-Ahead Logging](https://www.sqlite.org/wal.html) — official semantics for WAL mode, checkpointing, and reader/writer concurrency (HIGH confidence, official docs).
- [SQLite concurrent writes and "database is locked" errors](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/) — WAL solves reader/writer blocking, not writer/writer contention; WAL + busy_timeout + short transactions as the combined mitigation (MEDIUM-HIGH confidence, cross-checked community analysis).
- [What to do about SQLITE_BUSY errors despite setting a timeout](https://berthub.eu/articles/posts/a-brief-post-on-sqlite3-database-locked-despite-timeout/) — practical failure modes of busy_timeout under real multi-writer load (MEDIUM confidence).
- [SQLite in Practice: The Database Is Locked Again!](https://docsaid.org/en/blog/sqlite-wal-busy-timeout-for-workers/) — `BEGIN IMMEDIATE` vs. deferred transactions and read-then-upgrade contention patterns (MEDIUM confidence).

---
*Pitfalls research for: Shared-Host Multi-User milestone (v2.2.0), M&A Integration Portal*
*Researched: 2026-08-10*
