# v3.0 Production-Readiness Review — shared brief (read first)

Written 2026-10-10 as the research input to milestone v3.0 ("Production-Ready").
Every review lane reads this file, then its own lane assignment in the prompt that launched it.

## What the user asked for (verbatim)

> "please review the app and lets make a 3. version that really make this ready for production,
> need to ensure that admin can disable part of the app and key focus will be on the integration leader"

Three things follow: (1) an honest review of the app as it stands; (2) a v3.0 that is genuinely
production-ready — shared internal host, many users, MNPI data; (3) two explicit product asks —
**an admin must be able to disable parts of the app**, and **the Integration Leader (IL) is the
key persona**. Treat that framing as the user's *intent*, not as established fact about the code —
verify what is actually true.

## The product, in 10 lines

- TE Connectivity M&A Integration Portal. Internal tool for the **Integration Lead / IMO** to run a
  real acquisition from due diligence through the first 100 days. Data is **MNPI** (material
  non-public information): target names pre-announcement, valuations, retention lists, org designs.
- Stack: Express 4 (`server.js`, ~7.4k lines) + vanilla-JS multi-page frontend (`public/*.html`,
  `public/js/*.js`, ~26k lines, no framework, no build step) + SQLite via better-sqlite3
  (`db/store.js`, `db/dbFiles.js`, `db/resolver.js`, `db/controlStore.js`, `db/auditHook.js`),
  zod write validation (`validators/`), tests in `test/` (`node --test`, 779 pass, ~10 s).
- Two modes from ONE codebase: **demo showcase** (`data/demo.db`, launched with `DEMO_OPEN=1`) and
  **real-deal** mode (fail-closed auth, one `data/deals/<id>.db` per acquisition, append-only
  `data/audit.db`, `data/control.db` accounts + deal registry, `data/runtime.db` sessions).
- Roles: `admin`, `hrbp` (shown in the UI as **Integration Leader**), `pmo`, `employee`.
  Per-deal clean-room clearance grants layer on top (`db/accessPolicy.js`).
- Hard constraints: vanilla JS / no framework / no build step; `node_modules/` is committed
  (zero-install, `node server.js`); no TE IT dependency (no SSO/HRIS); the demo showcase must keep
  working; SQLite single-host (`replicas: 1`) is the settled architecture.
- Milestone state: v2.1.0 shipped (real-deal capability, Phases 1–7). v2.2.0 "Shared-Host
  Multi-User" is mid-flight: Phase 8 (concurrency: BEGIN IMMEDIATE + busy→503) and Phase 9
  (optimistic locking: 409 + conflict dialog) are built and verified; Phases 10–13 (runtime
  hardening, deployment shapes, workstream-lead collaboration, collaborative wizard) are planned
  but not started. v3.0 will absorb 10–13 and add new scope from this review.
- Planning docs worth reading: `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`,
  `.planning/ROADMAP.md`, `.planning/STATE.md`. `.planning/codebase/*.md` is an OLDER map that
  predates SQLite/auth/isolation — useful for orientation, wrong in places; trust the code.
  Prior security reviews live in `.planning/security/` (v2.1.0 whole-codebase reviews).

## Rules for every lane

1. **Read-only on the repo, except your one report file** (path given in your prompt). Do not
   edit, delete, `git add/commit/stash/checkout/reset`, or push anything. Do not touch
   `data/*.db` directly.
2. **To run the app, ALWAYS use isolated temp data.** Create a scratch directory, copy
   `data/demo.db` and `data/control.db` into it, and start the server like this (pick YOUR port):

   ```bash
   S=$(mktemp -d); cp "/Users/karstenhaldan/M&A/data/demo.db" "/Users/karstenhaldan/M&A/data/control.db" "$S/"; mkdir -p "$S/deals"
   cd "/Users/karstenhaldan/M&A" && PORT=<yourport> MA_DEMO_DB_PATH="$S/demo.db" MA_CONTROL_DB_PATH="$S/control.db" \
     MA_RUNTIME_DB_PATH="$S/runtime.db" MA_AUDIT_DB_PATH="$S/audit.db" MA_DEALS_DIR="$S/deals" node server.js
   ```

   Do NOT set `DEMO_OPEN=1` unless you are deliberately testing demo-open mode. Without it the
   server is fail-closed and needs a login (`POST /api/auth/login`; the committed demo accounts are
   `admin`, `karen` (hrbp / Integration Leader), `pmo`, `employee-demo`, password `TEdemo!2026`).
   Never run the server against the real `data/*.db` paths — a write can land in a gitignored WAL
   sidecar and silently dirty committed databases. Kill any server you start before you finish.
3. **Browser automation** works via Playwright from a script (the MCP plugin is down):
   `require('/Users/karstenhaldan/.npm/_npx/e41f203b7505f1fb/node_modules/playwright')` then
   `chromium.launch({ headless: true })`. Put your scripts and screenshots under the scratchpad
   directory named in your prompt, not in the repo.
4. **Evidence standard.** Every finding cites `file:line` (or a command and its output) and carries
   a severity judged against *"production on a shared internal host holding MNPI"*:
   `BLOCKER` (must fix before any real use) · `HIGH` · `MEDIUM` · `LOW`. Mark each finding
   **VERIFIED** (you traced the code path or reproduced it) or **SUSPECTED**. Prior reviews exist
   — do not re-report anything they list as fixed/accepted unless you can show it regressed.
   No generic best-practice padding: if an area is sound, say so in one line and move on.
5. **Budget.** You are one of several parallel lanes. Be economical: use grep and targeted reads,
   not whole-file dumps of the 26k-line frontend. Roughly 60–90 tool calls is plenty.
6. **Report format.** Markdown, ≤ ~450 lines, in your assigned file under
   `.planning/reviews/v3.0/`. Finish with (a) **"Top actions for v3.0"** — a ranked list of
   concrete, buildable work items (each: what, why, where, rough size S/M/L), and (b) **"What I did
   not cover"** — honest scope boundaries. Return a ≤ 150-word summary to the orchestrator; the
   file is the deliverable.
7. Do not trust this brief's claims about the code over what you find. If the brief is wrong, say so.
