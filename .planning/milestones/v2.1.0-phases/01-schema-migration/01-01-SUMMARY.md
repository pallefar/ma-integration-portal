---
phase: 01-schema-migration
plan: 01
subsystem: database
tags: [better-sqlite3, sqlite, node-gyp, gitignore, vendoring, zero-install]

# Dependency graph
requires: []
provides:
  - "better-sqlite3@13.0.1 vendored into committed node_modules with all 8 platform prebuilt binaries"
  - "package.json engines.node bumped to >=22 (matches better-sqlite3@13's declared floor)"
  - ".gitignore + admin download-zip export both exclude the SQLite artifact family (.db-wal, .db-shm, .db.bak; download-zip also excludes .db itself)"
affects: [01-02, 01-03, schema-migration]

# Tech tracking
tech-stack:
  added: [better-sqlite3@13.0.1, node-addon-api@8.x (transitive)]
  patterns:
    - "Committed native-binary vendoring: node_modules/<pkg>/ committed wholesale (all-in-one-tarball prebuilds), same precedent as @napi-rs/canvas"
    - "Security exclusions land in the wave BEFORE the artifact they protect exists (T-01-02 pre-emptive mitigation)"

key-files:
  created: []
  modified:
    - package.json
    - package-lock.json
    - .gitignore
    - server.js
    - node_modules/better-sqlite3/ (committed, vendored)
    - node_modules/node-addon-api/ (committed, transitive dep of better-sqlite3)

key-decisions:
  - "Package legitimacy checkpoint (Task 1) approved by user: better-sqlite3's [SUS] verdict was a version-recency false positive (13.0.1 published 2 days before research), not a legitimacy signal — WiseLibs org, 8.65M weekly downloads, no postinstall script, established 11.x-13.x version history."
  - "npm's implicit gyp-rebuild install hook (triggered by better-sqlite3's binding.gyp, not an explicit postinstall/install script in the package's own manifest) ran but was a confirmed no-op: build/Release contains only 0-byte stamp files, no compiled .o/.node artifacts — the vendored prebuild for darwin-arm64 is what's actually loaded."
  - "download-zip -x list excludes data/*.db itself (unlike .gitignore, which keeps data/*.db committed as the demo database) — mirrors the existing db.json precedent where the file is committed to git but excluded from the shareable admin export."

requirements-completed: [FND-04]

coverage:
  - id: D1
    description: "better-sqlite3@13.0.1 installed, pinned, and vendored with all 8 platform prebuilt .node binaries committed to node_modules"
    requirement: "FND-04"
    verification:
      - kind: unit
        ref: "node -e \"const D=require('better-sqlite3'); const db=new D(':memory:'); db.pragma('journal_mode'); db.close(); console.log('ok')\" -> ok"
        status: pass
      - kind: other
        ref: "find node_modules/better-sqlite3/prebuilds -type f -name '*.node' | wc -l -> 8, each non-zero-length (verified via ls -la)"
        status: pass
    human_judgment: false
  - id: D2
    description: "package.json engines.node bumped >=20 -> >=22; better-sqlite3 pinned exactly 13.0.1"
    requirement: "FND-04"
    verification:
      - kind: other
        ref: "package.json engines.node == '>=22'; dependencies.better-sqlite3 == '13.0.1'"
        status: pass
    human_judgment: false
  - id: D3
    description: ".gitignore excludes data/*.db-wal, data/*.db-shm, data/*.db.bak (primary data/*.db stays committed); download-zip -x list excludes data/*.db + all three sidecars"
    requirement: "FND-04"
    verification:
      - kind: other
        ref: "grep -Eq 'data/\\*\\.db-wal' .gitignore && grep -Eq 'data/\\*\\.db-shm' .gitignore; grep -o 'data/\\*\\.db[a-z.-]*' server.js -> data/*.db, data/*.db-wal, data/*.db-shm, data/*.db.bak"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-23
status: complete
---

# Phase 1 Plan 01: SQLite Driver Vendoring + At-Rest Leak Pre-emption Summary

**better-sqlite3@13.0.1 vendored with all 8 platform prebuilds, engines.node bumped to >=22, and the SQLite artifact family (.db/.db-wal/.db-shm/.db.bak) pre-emptively excluded from git and the admin download-zip before any such file exists**

## Performance

- **Duration:** 15 min (continuation agent, Task 2 onward — Task 1's human-verify gate was resolved by the user before this agent started)
- **Started:** 2026-07-23T20:46:00Z (approx, first tool call of this continuation)
- **Completed:** 2026-07-23T21:01:03Z
- **Tasks:** 2 of 3 executed by this agent (Task 1 was the approved checkpoint gate, no code/commit)
- **Files modified:** 6 (package.json, package-lock.json, .gitignore, server.js, plus vendored node_modules/better-sqlite3/ and node_modules/node-addon-api/)

## Accomplishments
- Installed and vendored `better-sqlite3@13.0.1` into committed `node_modules`, confirming all 8 platform prebuilt `.node` binaries (darwin-x64, darwin-arm64, linux-x64, linux-arm64, linuxmusl-x64, linuxmusl-arm64, win32-x64, win32-arm64) are present and non-zero-length
- Verified the driver loads and opens/closes an in-memory database with no error on this machine
- Bumped `package.json` `engines.node` from `>=20` to `>=22` to match better-sqlite3@13's real floor
- Pre-emptively closed both at-rest leak channels for the wave-2 SQLite artifact: `.gitignore` (WAL/SHM sidecars + rolling backup) and the admin `/api/admin/download-zip` export (`-x` list extended for `.db` + all three sidecars)

## Task Commits

Each task was committed atomically:

1. **Task 1: Confirm better-sqlite3@13.0.1 package legitimacy** - checkpoint gate, approved by user in a prior session; no code changes, no commit for this task.
2. **Task 2: Install and vendor better-sqlite3@13.0.1; bump engines.node** - `82bcdaa` (feat)
3. **Task 3: Pre-empt SQLite artifact leaks in .gitignore and the admin download-zip** - `d790de5` (fix)

_No plan-metadata commit issued separately by this agent — see `final_commit` step below for the docs commit covering SUMMARY/STATE/ROADMAP._

## Files Created/Modified
- `package.json` - added `better-sqlite3: 13.0.1` to dependencies; `engines.node` bumped `>=20` -> `>=22`
- `package-lock.json` - lockfile entries for better-sqlite3 + node-addon-api
- `node_modules/better-sqlite3/` - vendored driver, all 8 platform prebuilds, committed wholesale
- `node_modules/node-addon-api/` - transitive header-only dependency of better-sqlite3, committed alongside (no compiled binary, no scripts auto-run by npm)
- `.gitignore` - new "SQLite runtime sidecars" section excluding `data/*.db-wal`, `data/*.db-shm`, `data/*.db.bak`
- `server.js` - download-zip `-x` exclusion list (~line 411) extended with `data/*.db`, `data/*.db-wal`, `data/*.db-shm`, `data/*.db.bak`

## Decisions Made
- Approved package legitimacy (Task 1, prior session): better-sqlite3's `[SUS]` flag was a version-recency false positive, not a real supply-chain concern; the package is the established WiseLibs SQLite driver (8.65M weekly downloads, no postinstall script).
- Committed `node_modules/node-addon-api/` alongside `better-sqlite3/` even though it wasn't explicitly named in the plan's file list — it's a transitive dependency automatically pulled in by `npm install better-sqlite3@13.0.1` (header-only, needed for the from-source-fallback build path, no compiled binary or auto-run scripts of its own). Committing it is required for the vendored tree to be self-contained under the zero-install model; omitting it would leave a broken transitive dependency in the committed tree.
- Kept `data/*.db` itself committed/not-git-ignored (matches `db.json` precedent — the demo database ships with the repo) while still excluding it from the *download-zip* export (matches how `db.json` is committed to git but excluded from the shareable zip, since a real/live database must never leave via that channel).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Verify command inaccuracy] Plan's `<verify>` glob for Task 2 didn't match actual on-disk prebuild layout**
- **Found during:** Task 2 verification
- **Issue:** The plan's automated verify command was `ls node_modules/better-sqlite3/prebuilds/*/*.node | wc -l`, which assumes a nested per-platform-directory layout (e.g. `prebuilds/darwin-x64/binding.node`). The actual installed package uses a flat layout: `prebuilds/darwin-x64.node`, `prebuilds/darwin-arm64.node`, etc. — 8 files directly under `prebuilds/`, no subdirectories.
- **Fix:** No code fix needed (nothing broken) — used `find node_modules/better-sqlite3/prebuilds -type f -name '*.node'` instead, which correctly lists and counts all 8 files, and confirmed each is non-zero-length via `ls -la`. The acceptance criteria (8 platform prebuilds present, non-empty) is fully satisfied; only the plan's literal glob pattern was stale relative to the actual package layout.
- **Files modified:** None (verification-only)
- **Verification:** `find node_modules/better-sqlite3/prebuilds -type f -name '*.node' | wc -l` -> 8; each confirmed non-zero-length via `ls -la`
- **Committed in:** N/A (no code change)

---

**Total deviations:** 1 auto-fixed (1 verify-command correction, no code impact)
**Impact on plan:** Zero impact on scope or correctness — the plan's acceptance criteria were met exactly as specified; only the literal shell glob in `<verify>` needed a substitution to match better-sqlite3@13's actual (flat, not nested) prebuild directory layout.

## Issues Encountered
- npm's install-time behavior for better-sqlite3 was worth double-checking: the package has no explicit `install`/`postinstall` script in its own `package.json` (confirmed via `npm view better-sqlite3 scripts.postinstall` returning empty), but npm implicitly invokes `node-gyp rebuild` for any package containing a `binding.gyp` file (documented npm convention for native addons, not something injected by the package). Confirmed this was a no-op on this machine: `node_modules/better-sqlite3/build/Release/` contains only 0-byte `.stamp` files and Makefiles, with zero compiled `.o` or `.node` artifacts — the actual binary loaded at runtime is the vendored `prebuilds/darwin-arm64.node`, not a from-source build. This satisfies the plan's acceptance criterion in substance ("the install produced the prebuilt binaries rather than a from-source gyp build").

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `better-sqlite3` is available to `require()` from wave-2 plans with no further setup.
- The SQLite artifact family's git and admin-zip leak channels are closed before wave 2 creates the first `.db` file — no follow-up needed for T-01-02.
- FND-04's vendoring half is complete; cross-platform *boot* verification (actually running the app against SQLite on Windows/Linux) remains Plan 03's responsibility per the phase plan's success criteria.

---
*Phase: 01-schema-migration*
*Completed: 2026-07-23*

## Self-Check: PASSED

- FOUND: node_modules/better-sqlite3/prebuilds/darwin-arm64.node
- FOUND: .planning/phases/01-schema-migration/01-01-SUMMARY.md
- FOUND: commit 82bcdaa (Task 2)
- FOUND: commit d790de5 (Task 3)
- FOUND: package.json declares "better-sqlite3": "13.0.1"
- FOUND: package.json engines.node ">=22"
