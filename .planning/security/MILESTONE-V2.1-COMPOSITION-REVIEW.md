# Milestone v2.1 — Whole-Codebase Composition Security Review (Part 1 of 2)

**Target:** `/Users/karstenhaldan/M&A` @ HEAD `54d9186`, branch `main`
**Reviewer model:** Fable 5 (milestone-close cross-phase ritual, IN ADDITION to the per-phase `/gsd-secure-phase` gates)
**Date:** 2026-08-10
**Scope of Part 1:** cross-phase MNPI-control composition — the leaks a per-phase threat model structurally cannot see. Part 2 (supply-chain / released-tags) is a separate pass; two prior parts already exist in `.planning/security/` (`HISTORY-SUPPLYCHAIN-REVIEW.md`, `RELEASED-TAGS-REVIEW.md`).
**Configuration observed:** every phase SECURITY.md is `asvs_level: 1`, `block_on: high`. Severity ranking below uses that gate: only OPEN threats at severity ≥ high are ship-blocking.

> This document may contain concrete exploit detail against MNPI controls. `.planning/` is public. **Do not commit until every live finding below is fixed** (orchestrator owns the commit, per the task contract). No source file was modified during this review.

---

## Method

- Read all six per-phase SECURITY.md registers (`.planning/phases/0{2..7}/*-SECURITY.md`) and extracted every accepted risk + every deferred-hardening note.
- Read the actual gate/filter/audit code, never the comments or planning claims: the consolidated `/api` gate (`server.js:410-481`), `ROLE_WRITE_POLICY` (`:296-351`), `db/resolver.js`, `db/auditHook.js`, `validators/index.js`, `db/accessPolicy.js` call sites, and every conversion/export/pack route.
- Enumerated the full Express route table (`grep app.<verb>`), then traced each MNPI read/write surface to the shared filter it does — or does not — pass through.
- **Live-booted the real `server.js`** against isolated temp control/runtime/demo/deal/audit databases (the same harness shape `test/raid-access-filter.test.js` uses) to reproduce the headline finding end-to-end with real HTTP requests and real session cookies. Probe script and its output are quoted verbatim under F-1.
- Ran the write-validation coverage gate (`test/write-validation-coverage.test.js`) — passes; every write route has a registered zod schema.

When a vector turned up nothing, the "Checked / not-covered" section says how far the check went, not "clean".

---

## Findings by severity

### HIGH — F-1 · Task-lane clean-room bypass: converted DD-finding and flight-risk MNPI reaches uncleared deal members (T-04-21 revived, and made worse by a now-false disclosure)

**Where:**
- Republication into the shared task lane: `server.js:5409` (DD finding → task, `title = finding.title`) and `server.js:4836/4845` (flight-risk → task, `` title = `${employeeName} — retention risk mitigation` ``).
- Unfiltered read exits of that lane:
  - `GET /api/integration-tasks` → `res.json(taskLane(db))` — **no clearance filter** (`server.js:2963-2966`).
  - `GET /api/reports/export?dataset=tasks` → `rows = taskLane(db)` — **no clearance filter** (`server.js:5657`, comment at `:5655` explicitly asserts "every deal member sees every task").
  - `GET /api/reports/pack` → `tasks = taskLane(db)` embedded in the steerco PDF (`server.js:5806`).
- The control that Phase 4 accepted this risk on — the convert-row disclosure — now renders **the opposite of the truth** for the task path: `public/js/due-diligence.js:326-329` reads *"Creates a linked Day-1 task and/or RAID entry, visible only to members cleared for this area."* This single note sits on a row that contains **both** the "Create RAID entry" button and the task button (`due-diligence.js:301-305`), yet only the RAID lane is clearance-filtered.

**How this composed across phases (the part no per-phase gate could see):**
1. **Phase 4** proved T-04-21 live: converting a Legal DD finding republished its title/notes into the *unfiltered* RAID **and** task lanes, reaching a member cleared only for HR. It was closed as **accepted risk AR-04-01**, conditioned on a truthful disclosure ("visible to the whole deal team once created"). Phase 4's own Deferred-Hardening note (04-SECURITY.md §1) named both lanes: *"`/api/raid` and `/api/integration-tasks` are not clearance-filtered… Route to a hardening phase or Phase 6."*
2. **Phase 6** (D-17 / WR-03) hardened **only `/api/raid`**: it added `resolveRaidEntryClearanceArea()` + a conversion-time `clearanceArea` stamp, and rewrote the disclosure to *"visible only to members cleared for this area."* The task lane was left unfiltered. The rewrite is even locked in by a regression test that asserts the old truthful sentence is **gone**: `test/raid-access-filter.test.js:382-386` (`assert(!src.includes('whole deal team'))`).
3. **Phase 7** added the tasks CSV/JSON export and the steerco PDF pack, both reading `taskLane(db)` directly — extending the same unfiltered content into two new circulating-file exits, under a pack whose whole design premise (D-09) is "org/talent structurally excluded."

Net effect: the RAID half is fail-closed; the task half is fail-**open**; and the operator-facing control now actively **reassures** the operator that the created task is restricted when it is not. This is the exact "acceptance rests on a control that behaves opposite to its claim" failure mode the Phase-4/Phase-5 auditors flagged as the reason to never trust a clean register.

**Live reproduction (real `server.js`, isolated temp DBs, real session cookies):**
Deal `PROJECT FALCON`, members `admin` + `pmo_hr`; `pmo_hr` granted `ddAreas:['hr']` only (never `legal`). `admin` creates a `legal` finding and a flight-risk entry and converts each `toTask`. Then `pmo_hr` reads the shared lanes:

```
--- GET /api/integration-tasks as pmo_hr (NOT cleared for legal) ---
   task.title: "Change-of-control clause voids Siemens master agreement on close"   <-- LEGAL finding title
   task.title: "Jane Executive — retention risk mitigation"                          <-- RETENTION (named employee)
   /api/dd/findings?area=legal rows visible to hr-only: 0    (correctly blocked)
   /api/raid rows visible to hr-only:                  0     (Phase-6 filter works)
   >>> legal finding title leaked into task lane for hr-only member:      true
   >>> retention (employee name) leaked into task lane for hr-only member: true
   >>> same legal title present in tasks EXPORT for hr-only member:        true
```

The same member who is correctly returned **0 rows** from `/api/dd/findings?area=legal` and **0 rows** from `/api/raid` receives the identical withheld MNPI — a pre-announcement legal exposure headline and a named employee's retention status — through `/api/integration-tasks` and the tasks export. Both leaked strings are MNPI named explicitly in the project charter ("retention lists", pre-announcement target detail). Blast radius: **every deal member**, including the `employee` role and members cleared for zero DD areas (the read is gated on session + deal membership only; `GET` skips `ROLE_WRITE_POLICY`).

**Severity rationale:** high. Confidentiality breach of the very MNPI the clean-room exists to segregate, reachable by any deal member with a single unauthenticated-of-area GET, and the accepted-risk's mitigating disclosure is now false for the leaking path. At `block_on: high` this is **ship-blocking**.

**Fix options (pick one; both are strictly stronger than today):**
- **Enforcement (recommended):** filter the task lane by provenance on the way out, reusing the existing machinery. A converted task already carries `source` (`dd-finding:…` / `org-flightrisk:…`); stamp a `clearanceArea` on the task at conversion time exactly as the RAID entry gets one (`server.js:5439`, `:4872`), and add a `reportTaskRows(db, deal, portalUser)` mirror of `reportRaidRows()` that all three task exits (`GET /api/integration-tasks`, the tasks export branch, the pack's `tasks =` line) call — so one filter covers the live screen, the CSV, and the PDF, the same one-filter-per-concern shape WR-04 gave RAID. Manual/source-less tasks stay unfiltered (general execution content is not MNPI), matching the RAID rule.
- **Honest-disclosure fallback (weaker, only if enforcement is deferred):** if the task lane is deliberately left deal-wide, the convert note must say so — restore a truthful audience statement for the task path (the pre-Phase-6 "visible to the whole deal team once created" wording, scoped to the task button), and re-accept the risk **explicitly** with the user, because AR-04-01's premise (a truthful disclosure) no longer holds. Do **not** leave the current "visible only to members cleared for this area" copy standing over an unfiltered lane.

---

### MEDIUM — F-2 · Read-audit asymmetry: the most consequential MNPI *reads* leave no audit trace, while a less-sensitive one is fully audited

**Where (reads with NO audit row on success):**
- `GET /api/org/decisions` (`server.js:4585-4595`) — retain / redeploy / **redundant** determinations against **named individuals**, the app's own comment (`:4597-4599`) calls this "the most consequential act this app records about a named individual." Clearance-gated (403 for non-`hr`), but neither the successful read nor the denial records anything.
- `GET /api/org/positions?state=target` (`server.js:4170-4184`) — the named target org design (a reorg blueprint, MNPI). Gated, but no read audit and the denial branch (`:4180`) also records nothing.
- `GET /api/org/summary` (`server.js:4976`) — the two-tier restricted panel; no audit.
- `GET /api/dd/findings`, `GET /api/dd/request-items`, and their `:id` routes — successful DD reads are **not** audited; only **denials** are (`refuseDdArea()` records `dd-access-denied`, `server.js:5065-5069`).

**Contrast that exposes the inconsistency:** `GET /api/org/flight-risk` audits **both** the denial (`org-flightrisk-access-denied`, `:4680`) **and** the successful read (`org-flightrisk-read`, `:4686`) — a deliberate Phase-6 dual-audit (T-06-33..41). No later phase extended that pattern to the org-decision register or the target-org design, which are at least as sensitive. So the compliance record can answer "who *viewed* the flight-risk register" but cannot answer "who viewed the redundancy decisions" or "who opened the target org chart."

**Why it's a composition finding:** no single phase *claimed* to audit these reads, so no per-phase gate registered a gap — but the milestone's stated control is "every MNPI-significant action is attributable." Reads of redundancy decisions and pre-announcement reorg designs are MNPI-significant by the project's own definition, and they are currently invisible to the trail.

**Severity rationale:** medium (below the `high` block threshold → **non-blocking**). It is a repudiation/forensic gap, not a confidentiality breach: the reads themselves are correctly clearance-gated. It matters because MNPI compliance is a named legal control for this app.

**Fix:** extend the existing `recordSecurityEvent()` read-audit shape (already used for flight-risk) to `GET /api/org/decisions`, `GET /api/org/positions` (at minimum the target-state branch), and optionally the DD finding/item list reads — success and denial both, mirroring `:4680-4689`. Cheap and additive; reuses the audited-read pattern already shipped.

---

### LOW — F-3 · Count-level leak of restricted-provenance items through unfiltered aggregate lanes

**Where:** `GET /api/notifications` computes `raid_high` over `raidLane(db)` **unfiltered** (`server.js:5575`) and `tasks_overdue`/`tasks_blocked` over `taskLane(db)` unfiltered (`:5570-5574`); `computeWorkstreamRollup()` tallies per-workstream task counts over the unfiltered task lane (`:2944`), surfaced on the deal home, the workstreams export, and the pack.

**Exploit:** a member uncleared for `legal` cannot see a converted legal finding in `/api/raid` (F-1's RAID half is filtered), but a high-severity converted legal finding still increments their `raid_high` **badge count**, and a converted task still moves their workstream/overdue **counts**. This discloses *existence and volume* of restricted-provenance items, not their content.

**Severity rationale:** low. Aggregate count only, no titles/notes. Below block threshold, non-blocking. Noted for completeness and because it shares a root cause with F-1 — fixing F-1's task filter and applying the same provenance filter to the notification/rollup RAID+task tallies closes both. (If F-1 is fixed by enforcement, fold these count sites into the same filtered read.)

---

### LOW / INFO — F-4 · The convert-note disclosure copy is materially inaccurate for the task path

Called out separately from F-1 because it is the classic "reads as closed in every artifact" trap: `public/js/due-diligence.js:326-329` asserts restriction that only half the row's actions actually deliver, and a green regression test (`raid-access-filter (j)`) *locks the inaccurate copy in*. Even if F-1 is fixed by enforcement, the note should be revisited so its wording matches the enforced reality for **both** buttons. No separate severity beyond F-1.

---

### INFO — confirmed non-issues (checked, and how far)

- **`db_kind:'control'` hardcode is cosmetic (confirmed, not assumed).** `recordSecurityEvent()` writes the literal `'control'` into `db_kind` for deal-scoped read/export/pack events (`db/auditHook.js:136`; call sites `server.js:4687, 5724, 5869`). I grepped every consumer of that column: `queryAudit()` filters on `deal_id`/`actor_username`/`ts` only — **never `db_kind`** (`db/auditHook.js:157-172`), and the admin viewer passes only `deal`/`user`/`from`/`to` (`server.js:1091-1100`). The `deal_id` column **is** populated correctly on these events (`recordSecurityEvent` forwards `dealId`). So a compliance query "show me everything on deal X" returns these rows correctly; the mislabel changes no access decision and no query result. Residual stays cosmetic. Recommend fixing the label opportunistically (pass through the resolved kind) but it blocks nothing.
- **Demo → real-deal shared-origin pivot holds.** `isOpenMode(req)` requires `DEMO_OPEN==='1' && req.isDemo` (`server.js:245-247`), and `req.isDemo` is set true **only** for a resolved `kind==='demo'` (no deal binding) in `db/resolver.js:137`. A session bound to a real deal resolves to `kind:'deal'`, `isDemo:false`, so `DEMO_OPEN` can never disable auth for a real-deal request even in the same browser. Verified by reading the resolver, not the comment.
- **No new stored-XSS sink reopened the chain in Phase 6/7 client code.** `org.js`, `deal-home.js`, `due-diligence.js`, `deal-wizard.js` contain **zero** `innerHTML`/`insertAdjacentHTML`/`outerHTML` sinks (grep). `execution.js` (Phase 5/7 RAID+synergy UI) has 10 `innerHTML` sinks; every user-controlled value at the RAID and synergy renderers is wrapped in `esc()` (`execution.js:711-719, 1011-1023`). Write-time sanitization is scoped to the three CMS rich-text `htmlField()` fields by design (validators/index.js inventory); everything else relies on render-time `esc()` + CSP, which is present at the sinks I read. The one unescaped interpolation (`wsDef.icon`, `execution.js:718, 1017`) is a fixed server-side workstream definition and predates this milestone (documented in 05-SECURITY.md) — flagged again here only so it is not lost.
- **RAG/AI does not index deal MNPI.** `ragService.js` indexes only `public/playbook.html` (static corpus, `:62-70`). `GET /api/ai/insight` passes the **client-supplied** `portal` payload to the model (`server.js:2299-2313`) — it pulls no server-side deal store, so it is not a cross-clearance server leak. It *does* forward whatever the client sends to an external LLM **iff** an operator has configured a Gemini API key — a pre-existing MNPI-to-third-party consideration, out of this milestone's diff, noted under NOT-COVERED.
- **Validation coverage is complete and fail-closed.** `validationMiddleware` 500s any write route with no registered schema (`validators/index.js:329-332`); the coverage gate `test/write-validation-coverage.test.js` passes (every `/api` write route, incl. both convert routes, has a zod schema). Both convert routes' bodies are `{toTask,toRaid}` booleans; the MNPI they copy is server-side finding/flight-risk data, so validation is not the relevant control for F-1 (the read filter is).
- **Deal lifecycle + membership + grants are fully audited.** deal-create (`:791`), members-update (`:853`), setup (`:893/909`), dd-area-grant/revoke (`:991`), vdr-access-grant (`:1023`), archive (`:1052`), delete (`:1073`), break-glass token use (`:425`), session revoke (`:2290`), password change (`:642`). Membership removal also releases live deal bindings (`:849-851`). No gap here.
- **download-zip excludes the sensitive stores.** `server.js:1131` excludes `data/runtime.db*`, `data/audit.db*`, `data/deals/*`, `.env*`, `db.json*`, and admin-only per CR-02 (`GET /api/admin/*` requires admin for every method, `:462-472`). `/healthz` (`:666`) is outside `/api`, reads demo.db only, returns `{status,ts}` — no MNPI.

---

## Accepted-risk revival table (each accepted risk × status today)

| Risk ID | Threat | Original disposition | Status at HEAD 54d9186 |
|---|---|---|---|
| AR-02-01 | T-02-SC supply chain | accept (no deps in Ph2) | **Holds.** No dep added in scope. |
| AR-03-01 | T-03-04 control.db committed | accept (demo scrypt hashes only) | **Holds** (functional). control.db still committed; real-cred verification is Part 2's job. |
| AR-03-02 | T-03-27 best-effort post-commit audit | accept (2PC/hash-chain deferred to v2) | **Holds.** Still best-effort by design. |
| AR-03-03 | T-03-36 single-pass regex sanitizer | accept (CSP + textContent compensate) | **Holds.** F-1 is not an XSS path (esc present); unrelated. |
| AR-04-01 | **T-04-21 conversion widens audience** | **accept, conditioned on a truthful convert-time disclosure** | **REVIVED — see F-1.** RAID half hardened in Ph6; **task half still unfiltered** and now reaches CSV/pack (Ph7); the conditioning disclosure was rewritten to claim restriction it does not deliver for tasks. The premise the acceptance rested on no longer holds. |
| AR-04-02 | T-04-55 dedup create no audit | accept | Holds. |
| AR-04-03 | T-04-36/42 codename advisory | accept (notice present) | **Holds.** Notice present `public/deal-wizard.html:84`. |
| AR-04-04 | T-04-40 client holds no validation | accept (server sole SoT) | Holds. |
| AR-04-05 | T-04-51(09) refine cost | accept (perf) | Holds. |
| AR-04-06 | T-04-08 no dep change | accept | Holds. |
| T-05-05 | cross-deal synergy read | accept (resolver boundary) | Holds — resolver refuses non-member bind (`resolver.js:97`). |
| T-05-11 | migration touches i18n | accept | Holds (script not route-reachable). |
| T-05-29 | rollup discloses aggregate | accept (derivable from list) | Holds. |
| T-05-45 | demo seed → real deal | accept (allowlist excludes lane) | Holds (`dealSeed.js:31`). |
| **T-05-47** | unphased free-typed value blends into headline | deferred (medium) | **Partially addressed.** Ph7 added `unphasedRealizedM` to the shared `computeSynergyRollupSplit()` and the pack model.rollup (`server.js:5834, 5846`), giving the pack a phased/unphased split. The generic `POST /api/synergies` unphased-write path still exists by D-04 design; no longer blends *silently* in the pack. Acceptable; confirm the split is surfaced in the pack rendering. |
| T-05-SC | supply chain | accept | Holds. |
| T-06-SC | supply chain | accept | Holds (zero dep changes in phase range). |
| Ph6 residual | `db_kind:'control'` mislabel | documented residual | **Holds, cosmetic — confirmed** (see INFO). |
| AR-07-01 | T-07-07 export DoS | accept (no new amplification) | Holds. |
| AR-07-02 | T-07-20 staleness reader | accept (reuses capped reader) | Holds. |
| AR-07-03 | db_kind residual (re-doc) | accept | Holds, cosmetic. |

**One revival: AR-04-01 / T-04-21 → F-1 (blocking).** Everything else stands.

---

## NOT COVERED by this review (explicit)

- **Part 2 scope:** supply-chain integrity of committed `node_modules`, the vendored font/Transformers.js, prebuilt better-sqlite3 binaries, and released turnkey zips — that is the separate milestone-close pass; two related files already exist in `.planning/security/`. I did not re-derive dependency provenance here.
- **Whether `control.db` / `demo.db` as committed contain any *real* target name or credential** (vs. the fabricated NextGen personas the registers claim). I confirmed the *code paths* keep real deal DBs gitignored (`data/deals/*`, `runtime.db`, `audit.db`) and demo seeding is allowlist-scoped; I did **not** dump the committed `.db` blobs to inspect their row contents. Recommend Part 2 or a targeted check does.
- **External-LLM egress of MNPI** via `GET /api/ai/insight` / `/api/rag/upload` when a Gemini API key is configured — pre-existing, out of the Phase 4-7 diff, not a composition regression; flagged as a standing design consideration only.
- **Full 655-test suite re-run.** I ran the write-validation coverage gate (pass) and my own live probe (which boots the real app), and read `raid-access-filter.test.js` in full; I did not execute the entire suite. The suite count is asserted by the phase records, not re-verified here.
- **Client-side `pageAccess` gate races** (04-SECURITY.md Deferred-Hardening §2) — a known, pre-existing convenience-gate race that is not a server bypass; unchanged, not re-examined.
- **Concurrency/WAL correctness** under real multi-writer load — a data-integrity concern, not an MNPI-control-composition concern; out of this pass's scope.

---

## Bottom line for the orchestrator

- **1 blocking finding (F-1, high):** the task-lane clean-room bypass. It is a live, reproduced MNPI leak reachable by any deal member, it revives accepted risk AR-04-01, and it is compounded by a disclosure that now asserts a false restriction. **The milestone should not cut a release until F-1 is resolved** (enforcement filter recommended; honest-disclosure re-acceptance is the weaker fallback and requires an explicit user decision).
- **1 non-blocking medium (F-2):** read-audit asymmetry on org decisions / target-org / DD reads — recommend closing before shared-host deployment, additive and cheap.
- **2 low (F-3 count leak, F-4 disclosure copy):** fold into the F-1 fix.
- Everything else checked composed cleanly, with the demo→real pivot, the RAID provenance filter, validation coverage, and the deal-lifecycle audit trail all verified present in code (not accepted on report).

This review makes no claim that the codebase is "secure." It reports what was checked, what was found, and what was not covered.


---

## REMEDIATION OUTCOME (2026-08-10, quick task 260810-erm)

All code-fixable findings from this review were fixed and verified before the embargo on this report was lifted (commits `15b2a86` F-1/F-3 task-lane clean-room filter · `0644c7b` F-2 client XSS ×3 + cache-stamps · `b5e111a` CSV whitespace guard · `646208e` MNPI read-audit · docs `4af0631`). Suite 655 → **687/687** (+32 tests incl. `test/task-access-filter.test.js` four-identity harness; F-1 leak-closed independently reproduced by the orchestrator). **DEFERRED to the user at release cut (demo-vs-real deployment DECISIONS, not code bugs — the demo showcase is a maintained deliverable): DEMO_OPEN=1 in launchers, default admin password published in login.html, transformers vendored blob remote model download.** `db_kind:.control` residual confirmed cosmetic (no query filters on it). Honest limit retained: only ~35 of ~345 client `innerHTML` sinks were traced — the class is reduced, not eliminated (`pmo.js:1073-1076` remains an unproven candidate for a future pass).
