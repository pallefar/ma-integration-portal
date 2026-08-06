---
phase: 5
slug: synergy-value-capture
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-08-06
audited_at_head: 22ff42d
---

# Phase 5 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

**Verdict: SECURED — 47/47 register entries closed (46 numbered + `T-05-SC`), `threats_open: 0`.**

Audited by `gsd-security-auditor` (opus) at ASVS L1, `block_on: high`, against the code as it
stands at HEAD `22ff42d` — **not** against the plans' claims. Verification exceeded L1: six
adversarial runtime probes were run against the real booted app on isolated temporary databases
for the authorization, per-deal isolation, audit-coverage and gate-bypass claims, because a
register entry asserting a mitigation is a claim, not evidence.

**The workflow's short-circuit was deliberately refused.** With `threats_open: 0`,
`register_authored_at_plan_time: true` and ASVS L1, secure-phase's own rule permits skipping the
auditor entirely. It was not skipped. In Phase 4 of this project that same refusal is the only
reason a real MNPI clean-room leak was caught: `T-04-21` had been recorded as an *accepted risk*,
and the risk had been accepted on a UI disclosure **that was never built**. A clean register is a
reason to verify, not a reason to stop.

**Three later waves of change are covered here that the PLAN threat models could not know about:**
the 8 code-review fixes (`05-REVIEW-FIX.md`), the G-05-01 create-path gate
(`0170087`), and the unrecognized-stage 500→409 recode (`2ef2dc4`).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser → `POST /api/synergies` | Generic upsert; the alternative route through which a stage change, an unexplained re-baseline or a forward-booked value could be smuggled | Synergy valuations (MNPI) |
| Browser → `POST /api/synergies/:id/stage` | Untrusted body proposes a target stage + optional reason; the gate decision is made entirely server-side | Governance state |
| Browser → `POST /api/synergies/:id/rebaseline` | Privileged act reachable by any session that passed the broader `/api/synergies` write policy (admin, hrbp **and** pmo) — narrowing to admin+hrbp happens only inside the handler | Baseline history (MNPI) |
| Browser → `POST /api/synergies/:id/{generate-phasing, phasing/:month, confirm-current, cost-entries}` | Value-bearing writes; each carries its own zod schema so one cannot smuggle another's fields | Synergy valuations (MNPI) |
| Browser → `GET /api/synergies/rollup` | New aggregate endpoint returning deal-level money figures | Aggregated valuations (MNPI) |
| Operator shell → committed `.db` files | `scripts/migrate-synergy-stages.js`, `scripts/seed-synergy-demo.js` — neither is `require`d by any runtime module | Seed/migration data |
| App → `audit.db` | Append-only compliance record written by the `writeDb()` hook | Attributed governance actions |

---

## Threat Register

All 47 entries verified with `file:line` evidence. Full per-threat evidence table is preserved in
the audit trail below; the register is summarised here by disposition.

| Disposition | Count | Threat IDs | Status |
|---|---|---|---|
| mitigate | 38 | T-05-01…04, 06…10, 12…22, 24…28, 30…33, 35…37, 39…44, 46 | closed |
| accept | 5 | T-05-05, T-05-11, T-05-29, T-05-45, T-05-SC | closed (premises individually verified — see Accepted Risks) |
| transfer | 3 | T-05-23, T-05-34, T-05-38 | closed (transfer target verified present — see correction AR-NOTE-1) |

**Critical / high highlights:**

| Threat ID | Category | Severity | Evidence |
|---|---|---|---|
| T-05-12 | Elevation of Privilege | **critical** | `isAdminOrIlRequest(req)` is the handler's first statement (`server.js:3790`); WR-01's `sessionId !== null` exclusion of the X-Admin-Token break-glass identity present (`:496`). **Live probe:** `pmo` — which holds broad `/api/synergies` write access — receives `403 Only admin and the Integration Lead…`; `employee` 403. |
| T-05-14 | Tampering | high | Cumulative gate loop (`server.js:3185-3201`) evaluates every intervening ordinal; the `captured` gate reuses the single `monthHasArrived()` implementation rather than a second that could disagree. |
| T-05-15 | Repudiation | high | Empty-reason demotion refused 400 (`:3762`); `pushBaseline()` runs before mutation (`:3769`). **Live probe:** every stage write produced an attributed row in `audit.db`. |
| T-05-24 | Repudiation | high | `SYNERGY_STAMPING_FIELDS` allowlist (`:3323`) excludes title/notes, so a cosmetic edit cannot refresh the confirmation clock. |
| T-05-25 | Tampering | high | `lastConfirmedAt` is server-clock only; grep confirms **zero** occurrences in `validators/`, and zod strips unknown keys. |
| T-05-42 | Tampering | high | **Independently re-derived, not taken from the seed script:** queried copies of both committed databases — 360 phasing rows, **0 future-month rows carrying realized value**. |

**Live probe results (real `server.js`, isolated temp DBs):**

- **G-05-01 is real and not re-bypassable.** `stage:'captured'` → 400. `stage:'committed'` *with*
  `runRateM`/`startMonth` in the payload → 400, because the create branch persists neither field —
  a gated stage is structurally unreachable at create time, as claimed.
- **Per-deal isolation holds at the resolver, not the handler.** A session rebound to a deal it is
  not a member of is refused `403 You are not a member of that deal` before any handler runs
  (`db/resolver.js:95-99`).
- **Audit coverage is complete.** All 8 synergy write routes produced an attributed `audit.db` row
  (create, generate-phasing, stage, cost-entries, rebaseline, confirm-current, phasing/:month,
  delete), each carrying actor username + role, `deal_id`, `db_kind=deal`, request path and
  before/after JSON.

---

## Accepted Risks

Each premise was verified individually rather than taken on trust — the `T-04-21` lesson (a risk
accepted on a control that was never built).

| ID | Risk | Why accepted | Premise verification |
|---|---|---|---|
| T-05-05 | Cross-deal read of synergy data | Deal membership is the isolation boundary, enforced centrally | **Verified live:** non-member bind → 403 at `db/resolver.js:95-99` before any handler |
| T-05-11 | Migration script alters i18n content | Touches only `syn.st_*` UI label keys | **Verified:** `scripts/migrate-synergy-stages.js:55-69` |
| T-05-29 | `GET /api/synergies/rollup` discloses aggregate valuations | Every field is derivable from the pre-existing `GET /api/synergies` | **Verified field-by-field:** all 7 rollup fields derivable; no new field, no cross-deal path |
| T-05-45 | Demo seed data leaking into a real deal | `synergyInitiatives` is absent from the seed allowlist | **Verified twice:** seeded rows are fabricated NextGen personas; `db/dealSeed.js:31` `DEAL_SEED_COLLECTIONS` excludes the lane |
| T-05-SC | Supply-chain exposure from new dependencies | No dependencies were added | **Verified:** `git diff` of `package.json`/`package-lock.json` across the entire Phase-5 commit range is **empty** |

### AR-NOTE-1 — evidence correction (no security impact)

`T-05-23/34/38` cite `test/xss-sanitization.test.js` as the transfer target. That file covers the
CMS `htmlField()` sanitizer only, and its test `(b)` explicitly asserts plain-text fields round-trip
byte-identical — a probe confirmed `<img src=x onerror=alert(1)>` is stored **raw** in
title/owner/notes/cost-note/baseline-reason **by design**. The real control is output-side `esc()`
in `execution.js`, which **is** present at every new sink (read line-by-line: `:295-330`,
`:509-525`, `:575-587`, `:701-723`) and **is** asserted by `synergy-stage-ui (l)` and
`synergy-cost-ui (e)`. **The control is verified present; only the cited proof document was
misattributed.**

---

## Deferred Hardening

Recorded so these cannot silently vanish. None is blocking at `block_on: high`.

### T-05-47 (proposed) — unphased free-typed value blends into the headline · **medium**

G-05-01 closed the *stage* half of the forged-create path; the *money* half remains by design.

**Orchestrator-reproduced live:** `POST /api/synergies {stage:'validated', realizedM:9.9}` → 201,
and `GET /api/synergies/rollup`'s `grossRealizedM` moves **0.9 → 10.8**. The rollup returns
`grossRealizedM, costIncurredM, netBenefitM, dealTargetM, unconfirmedRealizedM, staleCount, mine` —
**no phased/unphased split**, so a report consumer cannot distinguish gate-backed arrived-month
value from free-typed unphased value at the aggregate level (per-item it is derivable:
`phasingRows: 0`).

This is **D-04's deliberate exception** — an initiative with zero phasing rows keeps the
independently-writable `targetM`/`realizedM` pair — and `T-05-02`'s mitigation is correctly scoped
to "once phasing rows exist", so **no declared mitigation is absent**. It nonetheless sits against
D-18/D-21's own trustworthy-headline rationale, and Phase 7's steerco pack (RPT-03) will read this
number. Writers are admin/hrbp/pmo only and every such write is audited and attributed.

**Recommendation:** either split the rollup figure, or require phasing before realized value is
writable. Belongs in a hardening phase or Phase 7's reporting work.

### Carried forward from Phase 4

- **`/api/raid` outbound clearance filtering** — pre-existing deferred debt. **Phase 5 does not
  widen it:** `POST /api/dd/findings/:id/convert` writes only to `integrationTasks` and
  `raidEntries`; no DD content flows into the synergy lane, and synergy items carry no `area` field.

### Informational (not threats)

- `GET /api/synergies/rollup` is readable by any deal member including `employee` (live: 200).
  Consistent with the existing model — deal membership is the isolation boundary; only DD items
  carry sub-deal area clearance — and it discloses nothing not already derivable from the
  pre-existing list route.
- `scripts/seed-synergy-demo.js` accepts an arbitrary db path as `argv[2]` and performs an
  allowlist `DELETE` on `synergyInitiatives`; pointed at a real deal database it would delete that
  deal's initiatives. Not route-reachable, and squarely inside Plan 08's declared
  operator-shell trust boundary.
- **Pre-existing, out of scope:** `wsDef.icon` is interpolated unescaped at `execution.js:711`
  (also `:138`, `:169`). `git log -L` dates that line to `b84648a`, 2026-07-19 — before Phase 5.
- No SUMMARY.md carries a `## Threat Flags` section. That absence was **not** treated as "no new
  attack surface"; the six runtime probes stand in for it.

---

## Audit Trail

| Date | Action | Outcome |
|---|---|---|
| 2026-08-06 | `/gsd-secure-phase 5` — State B (first audit; no prior SECURITY.md) | Register built from 8 PLAN `<threat_model>` blocks: 46 numbered + `T-05-SC` |
| 2026-08-06 | Short-circuit rule evaluated | **Refused** — auditor spawned despite `threats_open: 0` + L1 (the Phase-4 `T-04-21` precedent) |
| 2026-08-06 | `gsd-security-auditor` (opus), ASVS L1, `block_on: high` | **SECURED** — 47/47 closed, 6 live adversarial probes, no implementation file modified |
| 2026-08-06 | Orchestrator independently reproduced the one substantive residual | `grossRealizedM` 0.9 → 10.8 from an unphased free-typed create → recorded as proposed `T-05-47` (medium, non-blocking) |
| 2026-08-06 | SECURITY.md written by the orchestrator (the auditor returns a verdict only) | `threats_open: 0`, `status: verified` |
