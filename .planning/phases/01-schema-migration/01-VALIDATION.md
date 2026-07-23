---
phase: 1
slug: schema-migration
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-23
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `01-RESEARCH.md` §Validation Architecture (framework verified against codebase: no test tooling exists today).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node's built-in runner, ≥18) — zero new dependency, zero build step, matches the repo's "no build tooling" convention. No `*.test.js`/jest/vitest/mocha exists today. |
| **Config file** | none — `node:test` needs no config |
| **Quick run command** | `node --test test/` |
| **Full suite command** | `node --test test/` |
| **Estimated runtime** | ~5–15 seconds (in-process SQLite, no build) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/`
- **After every plan wave:** Run `node --test test/`, and re-run the migration in `--verify` mode against the committed `db.json` snapshot
- **Before `/gsd-verify-work`:** Full suite green + migration `--verify` passing + `checkpoint:human-verify` for non-Mac bundle boot tests
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-xx | migration | 0 | FND-01 | T-1-03 (source never mutated) | Migration only reads source db.json; re-run produces identical canonical-JSON reconstruction | integration | `node scripts/migrate-db-json-to-sqlite.js --source db.json --out /tmp/v1.db --verify && node scripts/migrate-db-json-to-sqlite.js --source db.json --out /tmp/v2.db --verify` then compare canonical-JSON reconstructions (NOT raw bytes — SQLite bytes can differ for identical logical content) | ❌ W0 | ⬜ pending |
| 1-xx | migration | 0 | FND-01 (D-06) | — | Round-trip deep diff: reconstruct full object from SQLite deep-equals original db.json + per-collection row-count parity | integration | `node --test test/migration-roundtrip.test.js` | ❌ W0 | ⬜ pending |
| 1-xx | db-layer | 0 | FND-02 | T-1-01 (parameterized SQL only) | No `fs.readFileSync(DB_FILE)`/`fs.writeFileSync(DB_FILE)` path remains; all queries use `.prepare().run()/.all()` | smoke (grep) + review | `grep -nE "readFileSync\(DB_FILE\|writeFileSync\(DB_FILE\|db\.json" server.js` returns no live read/write path | ❌ W0 (run at verify) | ⬜ pending |
| 1-xx | db-layer | 0 | FND-03 | — | Two concurrent adds to the SAME collection both survive (snapshot-tagged three-way merge, not naive diff) | integration | `node --test test/concurrent-write.test.js` | ❌ W0 | ⬜ pending |
| 1-xx | bundle | 0 | FND-04 | T-1-02 (no .db leak to git/zip) | All 8 prebuilt `.node` binaries present; macOS bundle boots; download-zip + .gitignore exclude `.db`/`.db-wal`/`.db-shm` | smoke + manual | `ls -la node_modules/better-sqlite3/prebuilds/*/*.node` (8 present, non-empty); macOS boot-test; grep download-zip exclusion list | ❌ W0 (presence scriptable; non-Mac boot manual) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Task IDs are `1-xx` placeholders — the planner assigns concrete IDs; the requirement→test mapping is the binding contract.*

---

## Wave 0 Requirements

- [ ] `test/concurrent-write.test.js` — covers FND-03 (concurrent same-collection add; the load-bearing concurrency proof — NEW, nothing like it exists today)
- [ ] `test/migration-roundtrip.test.js` — covers FND-01/D-06 (round-trip deep diff + row-count parity)
- [ ] `scripts/migrate-db-json-to-sqlite.js` with `--verify` mode — the re-runnable migration (FND-01)
- [ ] `db/schema.sql` + a single-source-of-truth collection inventory (the **38** top-level keys — 5 more than `readDb()`'s defaulting block lists; must not be duplicated between migration script and `readDb()`)
- [ ] Framework install: none — `node:test` is built into Node ≥18

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Windows & Linux release-zip bundles boot with the correct native binary | FND-04 | No CI runner for those platforms in this repo; only macOS is testable on this machine | Unzip the Windows and macOS/any-OS release bundles on their target OS, run `start.bat`/`start.command`, confirm the server starts and serves a page with SQLite active (no db.json fallback). Record as `checkpoint:human-verify`. |

*Prebuild-presence (all 8 `.node` files) is scriptable and NOT manual; only cross-platform boot is manual.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
