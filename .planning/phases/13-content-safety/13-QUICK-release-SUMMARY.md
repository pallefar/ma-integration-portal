# Phase 13 Quick Task: release build script + trial build of v3.0.0-rc.1 — Summary

**Status:** complete — minimal REL-01 deliverable. Nothing tagged, pushed or published; STATE.md / ROADMAP.md untouched.

**One-liner:** `scripts/build-release.sh` builds the three turnkey zips deterministically from a committed HEAD (git archive → exclusions → portable Node verified byte-for-byte against nodejs.org → zip -X → SHA256SUMS + MANIFEST); two independent builds produced bit-identical zips, and the macOS bundle booted in demo and real-deal lanes with only its bundled Node.

## What was built

| Item | Where | Commit |
|---|---|---|
| Build script | `scripts/build-release.sh` | 96de0c0, fix 0039c63 |
| Version 3.0.0-rc.1 (package.json + lock root entries) | `package.json`, `package-lock.json` | 9e267d3 |
| UF-1: `.gitignore` guard `data/*/` + one DEPLOYMENT.md hunk | `.gitignore`, `DEPLOYMENT.md` | 108f399 |
| `export-ignore` set in `git archive` (coordinator addition) | `.gitattributes` | 9385a28 |
| Honest draft release notes incl. rated known limits | `RELEASE-NOTES-v3.0.0-rc.1.md` | c67d036, 76050ef |

Trial build commit (HEAD when built): `76050efc4510bb825ee9cbce421148c1467c329b` (BASE `a707385` + the commits above; the SUMMARY commit that follows changes no shipped file).

## Script behaviour

`scripts/build-release.sh <version> [--commit <sha>] [--node-from-release <tag>] [--out <dir>] [--prune-superseded]`

- Refuses: dirty tree (untracked included), `--commit` that is not HEAD, `package.json` version != `<version>`, an `--out` inside the repo.
- Stages with `git archive --prefix=ma-integration-portal/` into a **fresh empty** `mktemp` staging dir; staging + download scratch are deleted on exit (success or failure); on any FAIL the artifacts written by that run are removed. Superseded outputs of the same version are removed first; sibling `v*` dirs only with `--prune-superseded`.
- Node binaries come from the previous release's assets (default: latest non-prerelease), then verified: Mach-O arm64 / PE x64 headers, version read from `node --version` (macOS) and the PE `FileVersion` resource (Windows), `SHASUMS256.txt` and the official `node-v22.23.1-darwin-arm64.tar.gz` / `-win-x64.zip` downloaded from nodejs.org, archives verified against SHASUMS256.txt, extracted binaries compared sha256-for-sha256. A mismatch dies (STOP).
- Deterministic zip: sorted names, mtimes normalised to the commit time, `zip -X -D -y`, TZ=UTC.
- Writes `SHA256SUMS` (3 zips + MANIFEST.txt) and `MANIFEST.txt` (commit, version, node versions + sha256, per-zip size/files/sha256, exclusion list, every check line).
- Normalisation: launchers mode 755; `*.bat` converted LF → CRLF (git stores them LF; v2.1.0 shipped LF — improvement, see deviations); `node/LICENSE` copied from the verified official tarball next to the Node binary.

### Exclusion list (staging removal; also `export-ignore`d in `.gitattributes` where tracked-and-unneeded)

`.planning/`, `.claude/`, `.gsd/`, `.github/`, `.githooks/`, `.gitattributes`, `.gitignore`, `test/`, `scripts/uat/`, `scripts/perf/`, `scripts/smoke/`, `scripts/soak.js`, `scripts/test-gate.js`, `scripts/list-unvalidated-routes.js`, `scripts/bootstrap-session.sh`, `scripts/export-session-state.sh`, `scripts/build-release.sh`, `scripts/migrate-db-json-to-sqlite.js`, `scripts/split-db-into-control-demo-deals.js`, `db.json`, `data/ma-portal.db`; plus a pattern sweep (outside `node_modules/`) for `.DS_Store`, `*.log`, `*.orig`, `*.rej`, `*.swp`, `*~`, `evidence/`, `walk-evidence/`, `screenshots/`, `__MACOSX/`.

**Legacy database decision (grepped first):** the server opens only the explicit paths of `db/dbFiles.js` (demo/control/runtime/audit/deals). `data/ma-portal.db` appears only as `db/store.js DEFAULT_DB_PATH`, the unused no-argument fallback of `initDb()` (the only call in `server.js` passes `DEMO_DB_PATH`), plus the Phase-1 migration scripts. `db.json` is read only by `ragService.js` behind an `existsSync` guard and its `ragUploads` is empty (confirmed: boot log "0 custom trained chunks" without it). Both removed; the two migration scripts whose inputs they are go with them. Kept: `data/demo.db`, `data/control.db`, the one tracked `public/sent_emails/comm_1783454326531.html`, the playbook PDF, `public/vendor`.

`.gitattributes` patterns use a leading `/` so they cannot hit same-named files in `node_modules` (e.g. `mime-db/db.json`, vendored packages' own `test/` dirs). `git archive HEAD | tar -t` verified: none of the ignored paths appear; the kept ones do.

## Trial build results (HEAD 76050ef, `--node-from-release v2.1.0`)

Script: **RESULT: PASS (39 checks passed)**, 0 FAIL.

Artifacts in `$HOME/ma-release/v3.0.0-rc.1/` (outside the repo):

| File | Size (bytes) | Files | sha256 |
|---|---|---|---|
| `ma-integration-portal-v3.0.0-rc.1.zip` | 110390824 | 3090 | `1096362dd3764c0ed10c7407a85c013692be8c4778f10ada930d23f56d45154e` |
| `ma-integration-portal-v3.0.0-rc.1-macos.zip` | 147462087 | 3092 | `524f9e814a7a735dd2f42dc625d5407e396d0a546687197696c04c00086f0d10` |
| `ma-integration-portal-v3.0.0-rc.1-windows.zip` | 143635780 | 3092 | `f3a002abdf7a4bab3bb1c58c2b2aa0d60c451b7b264277fa13b6e15dec247a80` |
| `MANIFEST.txt` | 7579 | | `5f4ac60c2b5e3a651d4d1591dfbf40ab36610fb96a3c861642625d12456fdd0e` |
| `SHA256SUMS` | 405 | | |

(A rebuild at the final docs-only HEAD changes the zip hashes — mtimes are the commit time — but not any file's content; the orchestrator's rc.1 build at its own HEAD is the one to publish.)

**Reproducibility:** a second build into a different `--out` produced a byte-identical `SHA256SUMS` (all three zips and the MANIFEST). **Archive-mechanism equivalence:** per-file name/size/CRC of all three zips built before the `.gitattributes` change and after it are identical except `RELEASE-NOTES-v3.0.0-rc.1.md` (edited in between).

### Node verification (nodejs.org)

| Check | Result |
|---|---|
| macOS binary | Mach-O arm64, `v22.23.1`, sha256 `2e3f1286…9b99d`, byte-identical to the official `darwin-arm64` tarball's `bin/node` — PASS |
| Windows binary | PE x64 (machine 0x8664), FileVersion `22.23.1`, sha256 `f8d162c0…469ed`, byte-identical to the official `win-x64.zip`'s `node.exe` — PASS |
| Official archives vs `SHASUMS256.txt` | both match — PASS (HTTPS only; the `.sig`/GPG signature was not checked) |

### Boot proof — macOS zip, only the bundled `node/bin/node` (clean `env -i`, PATH=/usr/bin:/bin, stubbed `open`)

| Lane | Check | Result |
|---|---|---|
| Demo (`./start.command` as shipped, PORT=3411) | boot log | `CSP_MODE=enforce`, `DEMO_OPEN=1` warning, readiness sweep 0 not ready — PASS |
| | `GET /healthz` | 200 `status:ok`, readiness ready, versions deal 2 / runtime 1 / control 1 / audit 1 — PASS |
| | `GET /login.html` | 200 — PASS |
| | `GET /api/auth/mode` | 200 `{"mode":"demo","demoOpen":true,"accountsWritable":false}` — PASS |
| | login `admin` (published demo password) | 200, `ma_session` cookie set — PASS |
| | `GET /api/auth/me` with that session | 200 `{"authEnabled":false,"user":null}` — by design under DEMO_OPEN (open mode ignores the session); see supplementary dev lane |
| Dev (`node server.js`, no DEMO_OPEN, PORT=3413) — supplementary | login `karen`, then `/api/auth/me` | 200 with `user.role:"hrbp"`, `authEnabled:true`; unauthenticated `/api/projects` 401 — PASS |
| Real-deal (same unzipped tree; `MA_MODE=real`, `MA_DATA_DIR`=scratch) | `bootstrap-admin.js` (password via `MA_BOOTSTRAP_PASSWORD`) | "Created account 'admin'"; data dir `0700`, DB files `0600` — PASS |
| | `./start-real-deal.command` boot, `/healthz`, `/login.html`, `/api/auth/mode` | 200 / 200 / `{"mode":"real","demoOpen":false,"accountsWritable":true}` — PASS |
| | demo accounts absent | scratch `control.db` has exactly 1 user (`admin`); `karen/TEdemo!2026` and `admin/TEdemo!2026` → 401; the bundle's committed `control.db` has the 4 demo accounts, proving the contrast — PASS |
| | forced rotation | login → `mustChangePassword:true`; `GET /api/deals` fenced 403 `{"mustChangePassword":true}`; weak password refused 400 (9 chars → "at least 12 characters"); valid change 200 — PASS |
| | `GET /api/auth/me` after rotation | 200, `mustChangePassword:false`, `authEnabled:true`; `/api/deals` 200 `[]`; unauthenticated 401 — PASS |

All servers stopped; no listener left on 3411–3413.

### Windows bundle — static checks only (not natively booted)

`node/node.exe` begins `MZ`, 86 989 128 bytes, PE x64; `better-sqlite3/prebuilds/win32-x64.node` and `@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node` present and PE; `start.bat` and `start-real-deal.bat` CRLF on every line; `start.bat` install-guard (`if not exist "%~dp0node_modules"` → `npm install --omit=dev`) and `node\node.exe` lookup intact; longest relative path + `C:\Users\<20 chars>\Downloads\ma-integration-portal-v3.0.0-rc.1-windows\` = **197** chars (`node_modules/dom-serializer/node_modules/entities/lib/esm/generated/decode-data-html.d.ts.map`), < 260; largest file is `node.exe` at 86 989 128 bytes, < 100 MB.

### Zip hygiene (all three zips unzipped fresh)

No `.planning`, `.claude`, `.gsd`, `.github`, `.githooks`, `test/`, `scripts/uat|perf|smoke`, `soak.js`, `test-gate.js`, `.env*`, `*.pem`, `id_rsa*`, `-wal`/`-shm`, `*.sqlite*`, `.DS_Store`, `*.log`, `public/uploads`, `data/` subdirs. Only `.db` files: `data/demo.db`, `data/control.db`. `public/sent_emails/`: only the tracked showcase `comm_1783454326531.html`. No private-key header outside `node_modules`. Hits: `node_modules/mime-db/db.json` (third-party data file, expected); `db/collections.js` mentions `.planning/` in a comment only; **`aiService.js` lines 312–314 contain `file:///Users/<builder>/M&A/public/playbook.html#…` links** (see Deferred).

## Deviations from Plan

1. **[Rule 3 - Blocking] Trial build is not at BASE.** The script requires `--commit` == HEAD, a clean tree and `package.json` version == the argument; BASE has neither the script nor the version bump. The trial ran at BASE + my commits (76050ef); shipped content differs from BASE only by the script/version/UF-1/notes/`.gitattributes` (the script itself is excluded from the zips).
2. **`.bat` CRLF conversion in all bundles.** Git stores `start.bat`/`start-real-deal.bat` LF and v2.1.0 shipped them LF; the brief asked for CRLF verified, so the build converts them.
3. **Extra exclusions beyond the minimum:** `scripts/list-unvalidated-routes.js`, `bootstrap-session.sh`, `export-session-state.sh`, `build-release.sh`, `migrate-db-json-to-sqlite.js`, `split-db-into-control-demo-deals.js`, `.gitignore`, `.gitattributes`, `.githooks/` — developer-only or orphaned once the legacy DBs are removed.
4. **`node/LICENSE`** added to the macOS/Windows bundles (from the verified official tarball).
5. **Script bug found and fixed during the trial** (0039c63): `grep -q` on the right of a pipe under `pipefail` made present zip members read as missing; the first attempt correctly failed closed and removed its artifacts. One later run was killed by the harness mid-summary (exit 144) and was rerun cleanly.
6. **UF-1 scope.** Minimal as instructed: `.gitignore` `data/*/` and one DEPLOYMENT.md hunk (lines 57–62). Not done: deriving the `download-zip` exclusion from `dbFiles.DATA_DIR` (`server.js` literal `data/real/*`) — the route is removed in Phase 14; DEPLOYMENT.md ~line 450 ("gitignored and excluded from the in-app download") still reads as universal and should be softened by whoever next edits that section.

## Deferred / observations (not fixed — out of scope)

- **`aiService.js:312-314`** (pre-existing, in the public repo and every release): the canned AI answer links to `file:///Users/<builder-home>/M&A/public/playbook.html#…`. Leaks the builder's OS username and the links are dead for everyone else. Fix: relative `/playbook.html#culture|talent|value`; check `test/` for assertions on the string first.
- **Cosmetic:** in real mode a password shorter than 8 chars is refused with "at least 8 characters" (schema layer) while the policy is 12 (handler layer says 12 for 8–11 chars).
- Launcher browser URL is hard-coded `http://localhost:3000` regardless of `PORT`.
- DEPLOYMENT.md references `scripts/perf/*.js`, which are not in the zips (already `export-ignore`d since Phase 12).
- REL-01 is only minimally met: README/DEPLOYMENT/DEMO-RUNBOOK/boot-banner accuracy and `/healthz` reporting the version (single-sourcing beyond `package.json` + tag) remain Phase 21. REL-02: `compression` 1.8.1 and `proxy-addr` 2.0.7 remain (age-gated); both are in the notes.
- `test/sanitize-html.test.js` WR-A06 ("200 000 nested … < 100 ms") is a wall-clock assertion that failed once at load average ~300 and passed alone on re-run (known load-flake class).

## Test result

First full run (before the `.gitattributes`/notes commits): 1709 tests, 1708 pass, 0 fail, 1 skipped, EXIT=0. Second run under load average > 300: 1 timing flake (WR-A06, above), passes alone. **Final full run at HEAD 76050ef (worktree root, backgrounded): `# tests 1709`, `# pass 1708`, `# fail 0`, `# skipped 1`, `# cancelled 0`, `EXIT=0`** (duration 44 s).

## Threat Flags

None — no new network surface, auth path or schema; the script reads GitHub release assets and nodejs.org only at build time and writes outside the repo.

## Self-Check

- `scripts/build-release.sh`, `RELEASE-NOTES-v3.0.0-rc.1.md`, `.gitattributes`: present and committed.
- Commits 96de0c0, 9e267d3, 108f399, c67d036, 0039c63, 9385a28, 76050ef: present in `git log`.
- Out dir holds the three zips + `SHA256SUMS` + `MANIFEST.txt`; `.build-work.*` staging removed; scratch dirs removed.
