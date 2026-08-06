---
quick_id: 260803-sxl
slug: session-continuity
description: Two-part session-continuity scripts so work resumes on a new computer
date: 2026-08-03
mode: quick
status: complete
completed: 2026-08-06
---

# Quick Task 260803-sxl: Session-Continuity Scripts

## Problem

The repo is unusually self-sufficient — `node_modules/` is committed (zero-install), and
`data/control.db` + `data/demo.db` ship the seeded demo accounts. A plain `git clone` gets a
**working app**.

What a clone does *not* get is the **session**: the accumulated GSD/Claude working context that
makes Phase 5 resumable rather than restartable. That state lives outside git, under `~/.claude`
and `~/.carl`:

| Component | Path | Size | Why it matters |
|---|---|---|---|
| Memory files | `~/.claude/projects/<slug>/memory/` | 304K, 22 files | 124K `ma-gsd-real-deal-milestone.md` holds the entire phase-by-phase history |
| Global instructions | `~/.claude/CLAUDE.md` | 4K | Declares the CARL rule system |
| CARL rules | `~/.carl/` | 64K | The rules the global CLAUDE.md points at |
| GSD toolchain | `~/.claude/gsd-core/` | 7.9M | VERSION 1.9.1 — workflows + `gsd-tools.cjs` |
| GSD agents | `~/.claude/agents/` | 764K, 34 files | Without these no `gsd-*` subagent can be dispatched |
| GSD skills | `~/.claude/skills/gsd-*` | 336K, 71 dirs | Without these the `/gsd-*` commands do not exist |

The memory directory name is derived from the project's absolute path — every character not in
`[a-zA-Z0-9.]` becomes `-`, so `/Users/karstenhaldan/M&A` → `-Users-karstenhaldan-M-A` (verified
against the live `~/.claude/projects/` listing; dots are preserved). A new machine will likely have
a different username or clone location, so the restore side **must compute this**, never hardcode it.

## Constraint: MNPI

`data/deals/`, `data/runtime.db*` and `data/audit.db*` are gitignored on purpose — they hold real
deal material, session tokens and compliance history. PROJECT.md treats clean-room segregation as a
legal control, not a feature. These must be **excluded by default** from any bundle.

They also do not need to travel: `db/dbFiles.js:80` does a recursive `mkdirSync` and
`db/store.js:178` uses `CREATE TABLE IF NOT EXISTS`, so all three auto-create empty on first boot,
and the committed `control.db` already carries the demo logins.

## Tasks

### Task 1 — `scripts/export-session-state.sh` (run on the OLD machine)

- **files:** `scripts/export-session-state.sh` (new)
- **action:** Bundle the six out-of-git components into one `.tar.gz` at a user-given path.
  Compute the memory slug from the repo root rather than hardcoding it. Record a `MANIFEST.txt`
  (source host, date, repo remote + commit SHA, GSD VERSION, per-component present/absent) so the
  restore side can verify what it got. MNPI deal data excluded by default; `--include-deal-data`
  opts in and demands a typed confirmation unless `--yes`. Refuse to overwrite an existing archive
  without `--force`.
- **verify:** Run it for real; list the archive and confirm the manifest plus all six components are
  present and no `data/deals`, `runtime.db` or `audit.db` entry appears.
- **done:** Archive builds, MNPI excluded by default, opt-in path warns.

### Task 2 — `scripts/bootstrap-session.sh` (run on the NEW machine)

- **files:** `scripts/bootstrap-session.sh` (new)
- **action:** Preflight `node >= 22`, `git`, `tar`, `curl`. Resolve the repo (existing clone, or
  clone the remote recorded in the manifest). Compute this machine's memory path from *its* repo
  location and restore into it. Restore CARL, global CLAUDE.md, agents, and gsd-* skills, backing up
  anything already present instead of clobbering it; never downgrade a newer gsd-core. Then prove
  the machine actually works: load the `better-sqlite3` native binary and round-trip a real
  in-memory table, run the full suite, boot the server on a free port and curl `/healthz`. Finish by
  printing where GSD left off and the next command.
- **verify:** `--dry-run` prints the full plan with no writes; a real restore against a throwaway
  `HOME` lands the memory files at the correctly computed path for that HOME and leaves this
  machine's real `~/.claude` untouched.
- **done:** Idempotent, fails loudly, and the three proofs (sqlite / suite / healthz) actually run.

## Must-haves

- **Truth 1:** The memory path is computed, not hardcoded — a different username or clone directory
  restores to the right place.
- **Truth 2:** MNPI (`data/deals/`, `runtime.db`, `audit.db`) never enters the archive unless
  explicitly opted in with a warning.
- **Truth 3:** Neither script silently half-completes — both run under `set -euo pipefail` and
  every restore backs up rather than overwrites.
- **Truth 4:** Bootstrap proves the result rather than asserting it (native binary round-trip,
  240/240 suite, live `/healthz`).
- **Artifacts:** `scripts/export-session-state.sh`, `scripts/bootstrap-session.sh`.

## Notes

- Target `bash` 3.2 — that is what macOS ships. No associative arrays, no `${var,,}`.
- Repo convention puts Node one-shots in `scripts/`; these are shell because they must run before
  (and independently of) the Node context, and the export runs against `$HOME`, not the app.

## Verification (2026-08-06)

Both scripts had been written on 2026-08-03 but never run. Executed and verified now.

**Bug found and fixed — `bootstrap-session.sh` `backup_if_present()`.** The first
`--dry-run` terminated silently after the very first line, `EXIT=1`, printing none of
the remaining restore steps or the proofs. Cause: the function's last command was
`[ "$DRY_RUN" -eq 0 ] && mv ...`; when the condition is false the `&&` list returns 1,
which becomes the function's return status, and `set -e` then kills the caller.
Isolated with three minimal repros before touching the script, which also corrected an
initial over-diagnosis of mine: `[ cond ] && stmt` is **safe** at top level and in an
`if` branch (bash exempts commands in an `&&` list) — only the *function-tail* position
is fatal. So one site was changed, not the five the grep first suggested.

**Task 1 — export.** Ran for real: 2.3M archive; MANIFEST.txt plus all six components
present (memory 22 files, global CLAUDE.md, CARL 10, gsd-core 473 @1.9.1, agents 34,
71 gsd skills). `tar -tzf | grep -Ei "deals/|runtime\.db|audit\.db|deal-data"` returned
**nothing** — MNPI excluded by default.

**MNPI gate, both halves.** Wrong confirmation text → aborts, `no archive written`.
`--include-deal-data --yes` → `deal-data/` present and MANIFEST records
`deal data: INCLUDED (MNPI opt-in)`. Test archives deleted immediately.

**Task 2 — bootstrap.** `--dry-run` now runs to completion and writes nothing (no
`.pre-bootstrap-*` anywhere). Real restore against a throwaway `HOME`: memory landed at
that HOME's computed path, CARL/CLAUDE.md/gsd-core/agents/skills restored, and
`gsd-core 1.9.1 already installed (same version) — left alone` proved the no-downgrade
rule. The real `~/.claude` + `~/.carl` fingerprint was **byte-identical before and
after** (`3b4daa43…`).

**Truth 4 proofs all executed, not asserted:** better-sqlite3 native round-trip
`ok (darwin-arm64)`; suite **240 pass, 0 fail**; server boot + live
`/healthz` → `{"status":"ok",...}`.

**Truth 1** confirmed by derivation, since the restore reused this repo's path:
`/home/kh/code/M&A` → `-home-kh-code-M-A`, `/Users/other.name/dev/…` preserves the dot,
`/c/Users/Karsten H/M&A` → `-c-Users-Karsten-H-M-A`. Matches the live
`~/.claude/projects/-Users-karstenhaldan-M-A`.

**Not exercised:** an actual second machine, and the clone-from-manifest branch (this
run resolved an existing repo). Both need hardware this session does not have.
