# Deployment Guide — TE Connectivity M&A Integration Portal

This portal ships **two modes from one codebase**: a public **demo showcase** and a
**real-deal** mode that holds material non-public information (MNPI) about live
acquisitions. The two modes must be launched differently. Choosing the wrong
launcher on a real-deal host disables authentication.

## Choose the right launcher

| Host purpose | Launcher (macOS/Linux) | Launcher (Windows) | Auth |
|---|---|---|---|
| **Real acquisition data (MNPI)** | `start-real-deal.command` | `start-real-deal.bat` | **Mandatory (fail-closed)** |
| Demo / showcase only | `start.command` | `start.bat` | Open (`DEMO_OPEN=1`) |

> **Never run `start.command` / `start.bat` on a host that will hold real deal
> data.** Those launchers set `DEMO_OPEN=1`, which disables all `/api`
> authentication and authorization so the showcase runs without a login. The
> real-deal launchers deliberately do not set it, so every request requires a
> real authenticated session.

The server prints a `[security]` warning at boot whenever `DEMO_OPEN=1` is in
effect — if you see that line on a real-deal host, stop and switch launchers.

## Real-deal first-run checklist

1. **Rotate the admin password before the first login.** The demo ships a
   published default admin password (visible on the login page). On a real-deal
   host, set a private one first:
   ```
   node scripts/set-admin-password.js
   ```
   Then start the server with the real-deal launcher.
2. **Enable OS full-disk encryption** on the host. Deal databases
   (`data/control.db`, `data/deals/*.db`) are stored unencrypted at the
   application layer by design this milestone; disk-level encryption plus the
   documented access policy is the control. (SQLCipher was deferred.)
3. **Keep the host off shared/demo accounts.** Real-deal databases are always
   auth-gated regardless of `DEMO_OPEN`; only the demo database can be served
   open.
4. **Back up `data/` with the same handling as the source data** — it contains
   MNPI once real deals are created.

## Platform support envelope

- **Node.js:** requires `>= 22` (bundled in the turnkey zips as a portable Node;
  system Node also works).
- **Linux:** the committed `better-sqlite3@13.0.1` native prebuilds require
  **glibc >= 2.38** — i.e. **Ubuntu 24.04+ / Debian 13+**, or a musl
  distribution (Alpine; musl prebuilds ship too). Older glibc hosts
  (Ubuntu 22.04, Debian 12) fail to load the SQLite binding at boot.
- **macOS:** arm64 and x64 both verified.
- **Windows:** x64 and arm64 prebuilds ship; launch with `start-real-deal.bat`.

## Known limitations

- **AI-Insight wizard downloads model weights at runtime.** The optional
  AI-Insight feature fetches Transformers.js model weights from the Hugging Face
  Hub on first use, which departs from the otherwise self-contained / no-CDN
  posture. It is **user-gated** — unreachable unless a user explicitly opens the
  AI-Insight wizard — and is **deferred to a follow-up task** (vendoring the
  weights or gating the feature to demo mode). Real-deal hosts that must stay
  fully offline should not use the AI-Insight feature until this is resolved.
- **Client-side XSS sink audit is partial.** The milestone security review
  traced the highest-risk stored-string→`innerHTML` sinks and fixed the
  confirmed ones; the full sink class across the legacy frontend is not
  exhaustively proven. Treat any new user-authored free-text rendering as
  requiring explicit escaping.
