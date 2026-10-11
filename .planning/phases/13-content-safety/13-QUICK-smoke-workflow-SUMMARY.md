---
phase: 13-content-safety
plan: quick-smoke-workflow
subsystem: release-engineering / ci
tags: [github-actions, release-smoke, windows, macos, linux, real-deal, bootstrap-admin]
requires: []
provides:
  - ".github/workflows/release-smoke.yml: manual workflow that boots the DOWNLOADED release zips on windows/macos/linux runners"
affects: [REL-01, CERT-05, Phase 21, Phase 23]
key-files:
  created:
    - .github/workflows/release-smoke.yml
    - .planning/phases/13-content-safety/13-QUICK-smoke-workflow-SUMMARY.md
  modified: []
status: complete
---

# Quick task: release-smoke workflow Summary

One `workflow_dispatch`-only GitHub Actions workflow, `.github/workflows/release-smoke.yml`,
that downloads the three release zips of a (draft) release by tag and boots each on its own OS
runner in two lanes (open demo, real-deal), so "opens on Windows and Mac" is proven from the
release assets themselves. Nothing was tagged, pushed or released; no code, STATE.md or ROADMAP.md
change.

## What was built

- **Trigger / inputs:** `on: workflow_dispatch` only. `tag` (required string, e.g. `v3.0.0-rc.1`)
  and `include_draft` (boolean, default true). `include_draft=false` fails fast if the release is
  still a draft; `true` accepts a draft or a published release.
- **Permissions / secrets:** top-level `permissions: contents: write` and nothing else, with the
  reason (a token without push access cannot see DRAFT release assets) documented in the header.
  The only secret is `github.token`, passed as `GH_TOKEN` to the single download step of each
  platform (not to the job, so it is not in the server processes' environment). No `checkout`:
  no repository code runs, only the released artifact.
- **Actions:** `actions/setup-node@v4` (Linux job only, `node-version: 22`) and
  `actions/upload-artifact@v4`. No others. Pinned by major tag as in `test.yml`.
- **Matrix** (`fail-fast: false`, `timeout-minutes: 12`):

  | kind | runner | asset pattern | node |
  |---|---|---|---|
  | windows | windows-latest | `*-windows.zip` | bundled `node\node.exe` |
  | macos | macos-latest | `*-macos.zip` | bundled `node/bin/node` |
  | linux | ubuntu-latest | `ma-integration-portal-<tag>.zip` | runner Node 22 |

  The three patterns are mutually exclusive (checked locally against the three asset names plus
  `SHA256SUMS`: each name matched exactly one pattern, `SHA256SUMS` matched none). At run time each
  job additionally fails unless exactly one zip came down.
- **Per job:** release preflight (lists assets, draft policy) -> `gh release download --pattern ...
  --dir` -> SHA256 of the zip, verified against `SHA256SUMS` when the release carries one (mismatch
  or a missing entry fails) -> unpack into a fresh dir (`unzip` / .NET `ZipFile` close to
  `$RUNNER_TEMP`) -> bundle inspection (exactly one `server.js`, `scripts/bootstrap-admin.js`,
  `public/login.html`, committed `data/control.db` + `data/demo.db`, `node_modules/express` and
  `better-sqlite3`, platform launchers, bundled node present and >= 22, launcher text still sets
  `DEMO_OPEN=1` / `MA_MODE=real`, no CRLF in the `.command` files, `chmod +x`, quarantine xattr
  cleared on macOS) -> LANE 1 -> LANE 2 -> always stop servers -> log tails on failure -> upload
  logs.
- **LANE 1 (open demo):** free port, `DEMO_OPEN=1`, `node server.js` as the launcher runs it.
  `/healthz` polled up to 60 s -> 200 with `status: ok`; `/login.html` -> 200 and contains
  `id="login-form"`; `/api/auth/mode` -> `mode: demo, demoOpen: true`; `/api/auth/me` ->
  `authEnabled: false`; server still alive; server logs free of uncaught/fatal lines or logged stack
  traces.
- **LANE 2 (real-deal):** `MA_MODE=real`, temp `MA_DATA_DIR`, `DEMO_OPEN` unset. A 32-hex
  throw-away password is generated in the job and masked with `::add-mask::` (kept inside one step;
  never crosses `GITHUB_ENV`, never on argv: bootstrap reads `MA_BOOTSTRAP_PASSWORD`, the login body
  goes through a file / in-process). `scripts/bootstrap-admin.js` -> boot -> `/api/auth/mode` is
  `real`, `demoOpen: false`, `accountsWritable: true`; `/api/auth/me` is fail-closed; `POST
  /api/auth/login` as `admin` returns 200 `success: true` (forced rotation reported, accepted);
  `admin`, `karen`, `pmo` with the published demo password are refused (401, or 429 if throttled; a
  200 fails the job).
- **Shell injection review:** no `${{ }}` expression appears inside any `run:` body (checked
  programmatically over the parsed YAML). Inputs reach scripts only via `env:` and are quoted; the
  tag is validated against `^[A-Za-z0-9][A-Za-z0-9._-]*$` before it is used in a glob or argument.

## How it was validated (all without pushing)

| Check | Result |
|---|---|
| YAML parse | PyYAML 6.0.3 (`python3 -I -c "import yaml..."`): parses; triggers = `workflow_dispatch` only; `permissions` = `{contents: write}`; `uses` = setup-node@v4, upload-artifact@v4; no `secrets.*` reference |
| No `push` / `pull_request` / `schedule` | confirmed on the parsed `on:` map |
| `${{ }}` inside `run:` bodies | none, in all 14 steps |
| Bash lane dry run | The 6 bash `run:` bodies were extracted from the YAML and run in order with a stand-in `gh` against a synthetic release: a zip built from `git archive HEAD` (with `.planning/` and `test/` removed, `ma-integration-portal/` root folder), plus decoy sibling `-windows.zip` / `-macos.zip` assets and a `SHA256SUMS`. Run on this macOS host as the linux kind (host Node 22.18, so `shasum` fallback and bash 3.2-safe code were exercised). Result: download, checksum verified, unpack, LANE 1 pass (healthz 200 after 2 s), LANE 2 pass (bootstrap, admin login 200 with forced rotation, `admin`/`karen`/`pmo` demo logins 401), servers stopped on SIGTERM with a clean graceful-shutdown log. Run twice, both green. |
| Negative checks | tampered `SHA256SUMS` -> job fails with the mismatch message; `include_draft=false` on a draft -> fails; the `macos` download step selects only the `-macos.zip` and verifies it; the log scanner flags `uncaughtException` and a bare stack-trace line and passes the real boot logs |
| Scratch hygiene | all runs under the session scratchpad, never against the worktree's committed `data/*.db`; `git status --porcelain data/ public/sent_emails/` empty |
| Full `node --test` | see "Test result" below |

No local zip existed under `$HOME/ma-release/`, so no real release zip was exercised; the
synthetic zip is a proxy for the layout, not a release asset.

## What is unproven until it runs on GitHub

1. **The whole PowerShell (Windows) lane has never executed.** No `pwsh` was available here, so it
   is reviewed as text only (balanced braces, here-string terminators, no `${{ }}` in bodies,
   quoting of the `gh --json` argument list). Expect a first-run fix or two there.
2. **`gh release download <tag>` against a DRAFT release with a `contents: write` token.** The
   design relies on `gh` falling back to listing releases for a tag it cannot resolve; this is the
   documented reason for `contents: write` but was not exercised.
3. **Real asset names.** The patterns follow the brief (`*-windows.zip`, `*-macos.zip`,
   `ma-integration-portal-<tag>.zip`); the scripted build (REL-01, Phase 21) does not exist yet. A
   different naming makes the download step fail with the asset list printed, not pass silently.
   The `SHA256SUMS` check assumes `sha256sum` text format (`<hash>  <file>`); the asset must be
   named exactly `SHA256SUMS`.
4. **The shipped bundled node** on windows/macos (node present, runs, >= 22, loads the committed
   `better-sqlite3` prebuild for win32-x64 / darwin-arm64, a macOS arm64 binary being accepted
   without a quarantine-driven signature check).
5. **Launcher execution.** The workflow runs `node server.js` with the launcher's environment; it
   does not execute `start.command` / `start.bat` themselves (a detached `open`/`start`, `pause` and
   `read` make them poor CI citizens). The launchers are checked statically only (contents, line
   endings, exec bit warning). Not covered: double-click, Gatekeeper / SmartScreen on a
   browser-downloaded zip, Intel macOS, Windows-on-ARM, older glibc.

## Deviations from the brief

- **No `github.event.inputs.*`:** used the equivalent `inputs.*` context, only via `env:`.
- **Windows unpack** uses `[System.IO.Compression.ZipFile]::ExtractToDirectory` instead of
  `Expand-Archive` (same long-path mitigation, extracted next to `$RUNNER_TEMP`; far faster on a
  committed `node_modules` tree, so the 12-minute budget is not spent unpacking).
- **Extra assertions beyond the brief** (all cheap, all in the same lanes): bundle file inventory,
  launcher text checks, `/healthz` body `status: ok`, `/api/auth/mode` mode/`demoOpen`/
  `accountsWritable`, `/api/auth/me` open vs fail-closed, process-still-alive, and a stack-trace
  rule in the log scan.
- **`GH_TOKEN` is step-scoped** to the download step rather than job-wide, so it never reaches the
  server processes' environment.
- **`include_draft`** is given a concrete meaning (fail when the release is a draft and the input
  is false); the brief only fixed its name and default.

## Known stubs

None.

## Test result

Full `node --test` from the worktree root (backgrounded into a log ending `EXIT=<code>`, host load
average about 100): `tests 1709, pass 1706, fail 2, skipped 1, EXIT=1`. The two failures are
known-class load flakes and passed when re-run alone
(`node --test test/bootstrap-admin.test.js test/sanitize-html.test.js`: 47 tests, 47 pass, 0 fail):

- `bootstrap-admin: bootstrapped admin logs in (200, mustChangePassword) ...` failed with
  `fetch failed` after 18.8 s under load.
- `WR-A06: 200 000 nested <b> / <div> return inert escaped text in < 100 ms` is a wall-clock
  bound.

`test/ci-workflow.test.js` reads only `test.yml`; no test globs `.github/workflows/`, so the new
file changed no result.

## Self-Check: PASSED

- `.github/workflows/release-smoke.yml` exists (760 lines, parses, `workflow_dispatch` only).
- This summary exists.
- HEAD equals the BASE sha `a707385328e542be0a03359fcee46499d63f95dd` at the time of writing;
  `git status --porcelain data/ public/sent_emails/` is empty.
