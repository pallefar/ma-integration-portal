---
phase: 6
slug: org-design-talent-retention
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-06
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded by plan-phase from `06-RESEARCH.md` §Validation Architecture.
> Task IDs are filled in once plans exist; the requirement→behavior map below is authoritative now.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in `node:test` — verified: `package.json`'s `"test": "node --test"`; no jest/mocha/vitest/playwright in `package.json` or `node_modules/.bin` |
| **Config file** | none — `node --test` auto-discovers `test/*.test.js` with zero config |
| **Quick run command** | `node --test test/org-<name>.test.js` |
| **Full suite command** | `node --test` |
| **Estimated runtime** | ~2.3 seconds (verified live at research time: **374 tests, 374 pass, 0 fail, 2317ms** from repo root) |

Each test file boots the real app against an isolated temp `control`/`runtime`/`demo`/`deals`/`audit`
database quintet via `process.env.MA_*_DB_PATH` overrides — the established pattern at
`test/dd-access-policy.test.js:26-31`. New files follow it rather than inventing a harness.

---

## Sampling Rate

- **After every task commit:** run the single new/touched file, e.g. `node --test test/org-positions.test.js`
- **After every plan wave:** `node --test` (full suite — cheap enough at ~2.3s to run on every merge)
- **Before `/gsd-verify-work`:** full suite must be green
- **Max feedback latency:** ~3 seconds

⚠ **Green suite is necessary, not sufficient.** Every prior phase gate on this project additionally
required a LIVE browser walk, and twice that walk caught a total-breakage bug the suite could not:
Phase 4's server errors written to the right element but invisible (`style.display = ''` reverting to
the stylesheet's `display:none`), and Phase 5's over-closed `</div>` that killed every synergy card
interaction while 358 tests stayed green. The D-17 filter behavior and the UI-SPEC's two backstop rows
specifically warrant a live walk.

---

## Per-Task Verification Map

Task IDs are assigned when plans are written; this table is keyed on requirement + behavior until then.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | ORG-01 | — | A position with `title`/`level`/`reportsToId`/`employeeId`/`state` can be created, read (current state, open to any deal member) and updated | integration | `node --test test/org-positions.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ORG-01 | D-07 | An uncleared member's `GET /api/org/positions?state=target` is refused **server-side** even with a hand-crafted query string — the read-boundary the Phase-4-Wave-2 precedent warns about (`server.js:446` role-checked GETs only on `/api/admin` paths) | integration/security | `node --test test/org-access-policy.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ORG-01 | D-09 | Deleting an employee linked to a position is refused (400) unless unlinked first — `DELETE /api/employees/:id` has **zero** existing guard code, so this is new logic | integration | `node --test test/org-positions.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ORG-02 | D-04 | A decision write is refused for a non-IL/admin cleared member — *including* one holding the `hr` area grant. Four-identity assertion mirroring `test/synergy-stage.test.js`'s `isAdminOrIlRequest` precedent | security | `node --test test/org-decisions.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ORG-02 | D-14 | The 5-value decision vocabulary's duplicated copies stay in sync — anti-drift assertion mirroring `test/dd-findings.test.js`'s RAID_LEVELS check and `test/synergy-stage.test.js`'s 3-copy SYN_STAGES check | unit | `node --test test/org-decisions.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ORG-02 | D-13 | A position's current decision is **derived** as the latest `orgDecisions` entry, never read from a stored field | unit | `node --test test/org-decisions.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ORG-03 | D-03 | An uncleared member's `GET /api/org/flight-risk` is refused AND writes exactly one denial audit row | security | `node --test test/org-flight-risk-audit.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ORG-03 | D-03 | A cleared member's **successful** `GET /api/org/flight-risk` writes exactly one read audit row — genuinely new behavior with zero precedent in ~49 existing GET routes | security | `node --test test/org-flight-risk-audit.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ORG-03 | D-03 | Reading OPEN-tier org data (current positions) writes **ZERO** audit rows — proves the read-audit is scoped to the register, not the lane | security | `node --test test/org-flight-risk-audit.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ORG-03 | D-15 | Flight-risk→RAID/task conversion produces a bidirectionally linked entry, deduped by `source`, same shape as `test/dd-findings.test.js`'s conversion tests | integration | `node --test test/org-flight-risk-conversion.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | D-17 | An uncleared user's `GET /api/raid` **excludes** entries whose provenance traces to a restricted area, while a cleared or unlinked entry is **still returned** — proves the filter does not over-filter | security | `node --test test/raid-access-filter.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | D-17 | An admin session's `GET /api/raid` still returns manually-created (`source: ''`, unlinked) entries — the exact regression a naive `filterByAreaGrant()` reuse would cause, since RAID rows carry no `.area` and `granted.has(undefined)` is always false | regression | `node --test test/raid-access-filter.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | D-18 | `data/demo.db`'s **committed bytes actually change** after the seed script runs — the standing WAL trap, where a write lands only in the gitignored `-wal` sidecar and `git status` lies | regression | `git diff --stat data/demo.db` non-empty after `PRAGMA wal_checkpoint(TRUNCATE)` | ❌ W0 (script-level, not `node:test`) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/org-positions.test.js` — ORG-01 (CRUD, current/target state filtering, employee orphan-guard)
- [ ] `test/org-access-policy.test.js` — ORG-01 / D-07 read-boundary security, modeled on `test/dd-access-policy.test.js`
- [ ] `test/org-decisions.test.js` — ORG-02 (D-04 authz, D-14 enum anti-drift, D-13 derived-current)
- [ ] `test/org-flight-risk-audit.test.js` — ORG-03 / D-03. **Highest-value new test in this phase**: the read-audit path has zero precedent to copy from
- [ ] `test/org-flight-risk-conversion.test.js` — ORG-03 / D-15 (bidirectional link, dedupe by source)
- [ ] `test/raid-access-filter.test.js` — D-17, covering **both** the under-filtering and over-filtering failure modes
- [ ] No framework install needed — `node --test` is already the runner, zero config

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A `critical`-severity RAID entry renders with a distinct visual treatment via **either** conversion path (DD finding or flight risk) | D-16 / D-17 | CSS rendering is not observable from `node:test` source assertions. Note this gap is **already live in shipped code** — `.raid-lvl.critical` has no rule at `public/execution.html:115`, while the Phase-4 convert route already copies `severity: 'critical'` verbatim | Convert a critical finding, open `execution.html`, confirm the severity chip is visually distinct from `high` (`#C0392B`) |
| Compact chrome (level chip, decision badge, deal-home count rows, nudge banner) at the longest translation | UI-SPEC §Internationalisation | Text expansion across EN/DE/ZH/CS is a rendering property; DE is the sizing case, ZH the opposite failure | Switch language, verify no clipped or collapsed badge at 768px and 375px widths |
| Org tree interaction survives load at depth and volume | UI-SPEC Tension 2 | The Phase-5 orphaned-`</div>` class of bug is invisible to a green suite | Live walk: expand/collapse, search a deep node, confirm zero console errors |
| Clean-room absence in raw DOM | D-20 | Must be proven on raw `innerHTML`, not on rendered appearance | Load deal home as an uncleared member; grep raw `innerHTML` for `org-summary-restricted` → expect 0 occurrences; as a cleared member → expect exactly 1 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 3s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
