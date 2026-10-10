# Phase 13 — shared executor brief (read FIRST; your prompt names your plan, base sha and siblings)

You execute ONE plan of Phase 13 (Content Safety) in an isolated git worktree. Commit each task atomically; write your SUMMARY.md
(`.planning/phases/13-content-safety/13-NN-SUMMARY.md`) incrementally and commit it before returning. Do NOT edit STATE.md or ROADMAP.md.

**First action, verify-only (HALT with `exit 42` on any failure):** HEAD must not be main/detached, branch must match `agent-*`/`worktree-agent-*`,
and `git rev-parse HEAD` must equal the BASE sha in your prompt.

**Read first:** `PROJECT_ROOT=$(git rev-parse --show-toplevel)` (path contains `&` — always quote). Your `13-NN-PLAN.md` (THE PLAN), `13-CONTEXT.md`,
`.planning/reviews/v3.0/PHASE-13-PRD.md` (locked D-13-01..07, acceptance 1–6), `13-PLAN-CHECK.md` (amendments already applied in the plans),
`.planning/PROJECT.md`, `.claude/CLAUDE.md`, `11-CARRY-INS.md`/`12-CARRY-INS.md` rows addressed to Phase 13, and the SUMMARYs of earlier plans you depend on.
Contracts that pass UNCHANGED: Phases 8–12 (503/409/404 bodies, audit-inside-transaction, canonical path gate, read policy, clean-room, migrations
framework + readiness, dirty-row writes, content-hash asset stamps, worker isolation) and the demo showcase.

**Rules:**
- Tracer gate policy: a `type="tracer"` task needs NO human-verify stop — re-run its automated `<verify>` and continue if green; HALT and report only if it fails.
- Parallel siblings run in other worktrees: touch ONLY the files/regions (named by function/route/file) your plan owns; new constants beside their handlers,
  never in top-of-file constants blocks or the `module.exports` tail; merge order is decided by the orchestrator.
- ⚠ Host is shared: disk often ≥ 90% full, load avg 7–200. `df -h /System/Volumes/Data` before heavy runs; scratch small and deleted; kill only your own
  stragglers; commands > ~5 min run in the background into a log ending `EXIT=<code>`; verify commands run from the worktree root (never `cd` to the main
  checkout). Known load-flakes (re-run ALONE before suspecting code): `concurrency-busy-retry` CONC-01, `control-plane-serialization` (c),
  `cpu-isolation` "job past timeoutMs", `audit-security-events`, `optimistic-locking-cross-process`, `soak-correlator` smoke.
- Never run a server against committed `data/*.db` (MA_* temp paths; the isolation guard fails loudly); never stage `.db`/`-wal`/`-shm`;
  `git status --porcelain data/ public/sent_emails/` empty at every commit; never call `POST /api/settings/new-ma` live (deletes TRACKED
  `public/sent_emails/*`); stage explicit paths only; never `--no-verify`. Plan 13-05 is the ONLY plan allowed to regenerate `data/demo.db` (own commit).
- Supply chain (13-01 only): vendor `sanitize-html` exactly as the plan says — scratch-dir install with `--ignore-scripts`, copy only the new package
  folders, `npm install --package-lock-only`; NEVER run `npm install` inside the repo (it deletes the committed cross-platform binaries).
- The repo is PUBLIC: no real names/emails/secrets/OS-user paths in logs or evidence. No new runtime dependency beyond what your plan names.
- If the plan conflicts with reality follow its INTENT and record under "Deviations"; if blocked return BLOCKED. On context pressure stop at a task
  boundary with `PARTIAL — resume at Task N` and the exact state. Quote the final full `node --test` result in your return message and end with a
  `<worktree_metadata>` block (`path:`, `branch:`, `base:`).
