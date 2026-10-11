# v3.0.0-rc.1 — pre-release (release candidate 1)

> **DRAFT — not final.** This is a pre-release candidate for evaluation and hosted
> trial, not a production release. It is the first checkpoint of the v3.0 milestone
> ("Production-Ready"): the foundation phases (8–13) are in; the module switch, the
> Integration-Leader cockpit and the operations/deployment work are not. **Do not
> describe it, or run it, as production-ready.** Read "Known limits" below before
> putting any real deal data on it.

The M&A Integration Portal runs in three modes from one codebase — the demonstration
showcase (kept intact), a plain dev/test mode, and the real-deal mode that holds
material non-public information (MNPI). This candidate hardens everything underneath
the real-deal mode: concurrency, accounts, authorization, the data layer and the
safety of user-authored content.

## What is in this pre-release (Phases 8–13)

### Concurrency and conflict recovery (Phases 8–9)

- Concurrent writers are serialized; the data layer is safe under simultaneous
  requests from several people (no lost updates).
- **Optimistic locking with conflict recovery.** A stale write is refused with a
  409 instead of silently overwriting a colleague's change, and the UI shows a
  recovery dialog (see their version, then "Apply my changes anyway", "Delete
  anyway" or discard) instead of a bare error.

### Accounts and identity (Phase 10)

- Real per-person accounts with roles; explicit real-deal mode (`MA_MODE=real`) with
  its own data directory and **no published credentials** — the demo accounts do not
  exist there.
- **Forced password rotation** on first sign-in (the bootstrap and temporary
  passwords are one-time), a minimum length of 12 characters in real mode, and a
  per-account sign-in back-off (capped at 5 minutes).
- **Credential lockdown.** A host that still carries a published or copied demo
  credential serves only the login page, `/api/auth/*` and `/healthz` until every
  offender has changed its password.
- A first-run `scripts/bootstrap-admin.js` (no password on the command line,
  attributed security event), an admin-console **Users** tab, and role/disable
  changes that take effect on the person's next request.

### Authorization and clean-room closure (Phase 11)

- Every read and every write is authorized for who the caller is, on the server;
  clean-room need-to-know filtering is applied identically across lists, exports,
  search and converted records. Closure of the cross-phase gaps found in review.

### Data-layer integrity and performance (Phase 12)

- **Per-deal, hash-chained audit partitions** (`data/audit/<dealId>.db`) with seal,
  verify (`scripts/audit-verify.js`) and export/purge (`scripts/audit-admin.js`), and
  a one-audit-row-per-change contract.
- **Dirty-row writes**: a write touches only the rows that changed, so write cost
  and audit volume are proportional to the change, not to the deal size.
- **Schema versioning and migrations** for every database file, with a readiness
  probe: `/healthz` is 503 until every file is migrated, and a failed migration keeps
  the instance not-ready rather than serving a half-upgraded store.
- **CPU-isolated workers** for the heavy jobs (steering-committee pack, PDF text
  extraction) so they cannot freeze the portal; server-side paging/filtering of the
  large lists.
- A smoke harness and CI workflow (developer tooling — not part of the zips).

### Content safety (Phase 13)

- **Real HTML sanitizer** (allowlist parser, re-serializing) on the server and a
  DOM-building renderer on the client, replacing the regex pass that review payloads
  bypassed. Stored legacy content is re-sanitized once by an idempotent migration.
- **Strict, enforcing Content-Security-Policy**: `script-src 'self'
  'wasm-unsafe-eval'` — no inline script, no `eval`. Inline code was externalised.
  `CSP_MODE=report-only` is the documented rollback.
- **Sandboxed HTML slides**: opaque origin, no network, no portal cookies; uploads
  limited to an allowlist (HTML, PDF, PNG, JPEG, WebP) with per-file and library
  quotas.
- **Egress switch** (admin console, "External services"): in real-deal mode no
  request leaves the host for Gemini, Hugging Face, YouTube or Google Fonts until an
  administrator enables it. Fonts are vendored. The dead AI-training upload path is
  not mounted outside demo mode.
- **Caching and logout hygiene**: every API response is `no-store`; logout sends
  `Clear-Site-Data` and clears client storage; pages no longer wipe legitimate
  caches.
- **Media upload allowlist** and code-only upload logging.

Phase 13's formal close-out (final review and verification) is still pending at the
time of this draft; treat its items as "merged, review in progress".

## What is NOT in this pre-release

| Not here | Where it lands |
|---|---|
| Admin on/off switch for application modules (registry, server gate, page guard, per-deal override) | Phases 15–16 |
| Integration-Leader cockpit, real-deal shell, execution tooling (plan/assign/decide/retain/report) | Phases 17–18 |
| Language, accessibility and phone-fit pass on the real-deal surfaces | Phase 19 |
| Authenticated per-deal file store; per-route body limits; removal of the legacy `download-zip` / `new-ma` / `migrate-db` hazards | Phase 14 |
| Runtime hardening: validated config, graceful shutdown/drain, removal of the shared `ADMIN_TOKEN` break-glass | Phase 20 |
| Deployment shapes (systemd unit, container image, conformance script) and the finished, single-sourced release engineering | Phase 21 |
| Workstream-lead collaboration (invite/clearance ledger/presence/activity feed) and collaborative setup | Phase 22 |
| Independent adversarial certification | Phase 23 |

## Known limits

- **The Windows bundle is not natively boot-tested.** It was built and checked
  statically (PE header, native binaries present, launcher line endings and
  install-guard, path lengths) but has not been started on a Windows machine for
  this candidate. The macOS bundle was boot-tested in both demo and real-deal lanes.
- **macOS Gatekeeper.** The bundled Node is the unmodified official binary and the
  zip is not notarized. The first launch may be blocked: right-click
  `start.command` and choose **Open**, or clear the quarantine flag once:
  `xattr -dr com.apple.quarantine <the unzipped folder>`.
- **The open demo uses published demo credentials** (shown on the login page). They
  are public by design. Real-deal use requires `MA_MODE=real` (the
  `start-real-deal.*` launchers) and `scripts/bootstrap-admin.js`; never put real
  data on a host started with `start.command` / `start.bat` (they set `DEMO_OPEN=1`).
- **Legacy surfaces still exist until Phase 14:** the sessionless `/sent_emails` and
  `/uploads` static mounts, and the admin `download-zip` route. Do not rely on the
  portal to keep uploaded files private from someone who can reach the port.
- **`compression` is still 1.8.1.** The bump to ≥ 1.8.2 is held by the supply-chain
  age check until 2026-10-11T11:17Z and lands no later than Phase 21.
- **Single host, single process.** SQLite in WAL mode on local disk; one instance,
  no clustering. Real deal databases are not encrypted at the application layer —
  enable OS full-disk encryption (see `DEPLOYMENT.md`).
- **Linux:** the native SQLite prebuild needs glibc ≥ 2.38 (Ubuntu 24.04+ /
  Debian 13+) or a musl distribution.
- Set `MA_DATA_DIR`, if you set it, to a folder **outside** the install folder
  (`DEPLOYMENT.md`, "Real-deal first run").
- The optional AI-Insight wizard downloads model weights from the Hugging Face Hub
  at runtime when an administrator has enabled that egress; leave it off on
  real-deal hosts.

## Downloads

| File | For |
|---|---|
| `ma-integration-portal-v3.0.0-rc.1.zip` | any OS — uses your installed Node ≥ 22 |
| `ma-integration-portal-v3.0.0-rc.1-macos.zip` | macOS (Apple silicon) — bundled portable Node |
| `ma-integration-portal-v3.0.0-rc.1-windows.zip` | Windows x64 — bundled portable Node |
| `SHA256SUMS` | checksums of the three zips and `MANIFEST.txt` |
| `MANIFEST.txt` | commit, bundled Node versions and hashes, per-zip size/file count, exclusion list |

No `npm install` is needed: `node_modules` is bundled.

## How to start

Unzip, then run the launcher that matches the host's purpose.

**Demo / showcase (open, no login, published demo data):**

- macOS / Linux: `./start.command` (macOS: double-click)
- Windows: double-click `start.bat`
- any OS with Node ≥ 22: `DEMO_OPEN=1 node server.js`

It opens http://localhost:3000. Click-to-fill demo accounts are on the login page.

**Real deal (MNPI — mandatory authentication, its own data directory):**

1. Create the first administrator once, as the user that will run the service:
   `node scripts/bootstrap-admin.js` (macOS: `./node/bin/node scripts/bootstrap-admin.js`;
   Windows: `node\node.exe scripts\bootstrap-admin.js`). The password is read from a
   no-echo prompt or `MA_BOOTSTRAP_PASSWORD`; it is never taken from the command line.
2. Start with `start-real-deal.command` / `start-real-deal.bat` (they set
   `MA_MODE=real` and clear `DEMO_OPEN`).
3. Sign in as `admin`; you are fenced to the change-password screen until you set a
   new password of at least 12 characters.
4. Create people in **Admin console → Users**.

Full checklist: `DEPLOYMENT.md`.

## Verify your download

```
shasum -a 256 -c SHA256SUMS        # macOS / Linux  (sha256sum -c SHA256SUMS on Linux)
```

On Windows: `certutil -hashfile ma-integration-portal-v3.0.0-rc.1-windows.zip SHA256`
and compare with the line in `SHA256SUMS`. `MANIFEST.txt` lists the bundled Node
version and its SHA-256; the binaries were verified byte-for-byte against the
official nodejs.org release at build time.

## Upgrading from v2.1.0

Back up your data directory first. Databases are migrated at boot; the migration is
one-way (older releases cannot read a migrated file). The first sign-in on a
real-deal host that still carries published credentials is held at the lockdown page
until those accounts rotate their password.
