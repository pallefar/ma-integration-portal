# Milestone v2.1.0 — Whole-Codebase MNPI Security Review (Fable 5, server-side)

- **Reviewer:** Fable 5 (model-diversity second opinion), server-side MNPI-controls scope
- **Repo / HEAD:** /Users/karstenhaldan/M&A @ `54d9186` (branch `main`)
- **Date:** 2026-08-10
- **Method:** cross-phase composition review of the 7-phase milestone. Read `server.js` (6805 lines, focused on the composition seams), `db/*.js` (store, resolver, sessions, controlStore, auditHook, accessPolicy, dbFiles), `validators/*`, `lib/report*` + `lib/sanitizeHtml.js`. Ran targeted `node --test` proofs against isolated temp databases.
- **Scope note:** SERVER-SIDE MNPI controls and how they COMPOSE across phases. Client-side XSS / vendored-assets / launchers are covered by a second agent and are NOT re-audited here. This is IN ADDITION TO the per-phase `/gsd-secure-phase` gates.
- **Framing (per user directive):** This report does NOT assert the code is "secure" or "perfect." It states what was CHECKED, what was FOUND, and what was NOT covered. Every finding is surfaced regardless of severity.

---

## Executive summary (honest)

The consolidated `/api` gate, the per-deal SQLite isolation model, the write-validation pipeline, the export/pack attack surface, and the audit hook are, on the whole, coherently composed and hold up well under cross-phase scrutiny. Deal isolation is genuinely bind-time (a non-member never obtains a connection handle), validation fails closed (a write route with no schema returns 500, enforced by a live coverage gate), the export enum structurally excludes org/talent data, and the export/pack filename + CSV paths handle CRLF and formula-injection.

**However, this review found one HIGH-severity cross-phase composition leak that every per-phase gate missed, precisely because it only appears when Phase 4 (clean-room clearance), Phase 6 (flight-risk → task/RAID conversion), and Phase 7 (exports/pack) are viewed together:**

The Phase-6 conversion routes create a linked **Day-1 task AND a RAID entry** from clearance-restricted sources (a DD finding, an HR flight-risk entry). Phase 6's D-17 fix correctly filters the **RAID** twin by provenance (`clearanceArea` stamp + `resolveRaidEntryClearanceArea`). But the **TASK** twin is written into the plain `taskLane`, which has **no clearance filter at all** — and the tasks dataset flows verbatim into `GET /api/integration-tasks`, `GET /api/reports/export?dataset=tasks`, and the `GET /api/reports/pack` PDF. The result: a deal member who is explicitly `403`'d from the flight-risk register can read a task titled `"<Employee Name> — retention risk mitigation"`. This is the exact T-04-21 leak pattern the milestone believed it had closed, revived through the parallel channel the fix did not cover. The shipped UI copy actively tells the Integration Lead the opposite ("visible only to members cleared for this register"), which makes it worse than a silent gap: it is a false assurance that invites an IL to route genuinely sensitive MNPI through it.

**Verdict: OPEN_FINDINGS** (one HIGH; details below). Everything else checked in scope is either clean or an already-documented, correctly-assessed accepted risk.

---

## Composition findings by seam

### Seam 1 — Auth fail-closed spans every Phase 4-7 route  ✅ HOLDS
- The single gate `app.use('/api', …)` (server.js:410-481) is registered before every `/api/*` route handler (first handler is `POST /api/auth/login` at 529). No `/api` data route is registered ahead of it.
- `PUBLIC_API_PATHS` = exactly `{/auth/login, /auth/logout, /auth/me}` (server.js:251). Nothing sensitive is public. `/healthz` (666) is outside `/api`, calls only `readDb()`, returns a status string — no data.
- Order is correct and composes: session/​token resolve → `resolver.dealResolverMiddleware` (binds deal BEFORE `isOpenMode`) → open-mode → 401 fail-closed → demo-only-path 403 → role check → validation. Verified for DD (`/api/dd/*`), synergy (`/api/synergies/*`), org (`/api/org/*`), and reports (`/api/reports/*`) — all sit behind it.
- Break-glass `X-Admin-Token` resolves to the ATTRIBUTED identity `{username:'admin-token', role:'admin', sessionId:null}` (420) and writes an `admin-token-use` security event on EVERY use (425-430) — never anonymous. `isAdminOrIlRequest()` correctly excludes the token path via `sessionId !== null` (513-515, WR-01).
- CR-02 carve-out verified: `/api/admin/*` requires the admin role for EVERY method incl. GET (469), so `GET /api/admin/download-zip` / `/api/admin/audit` are not reachable by a non-admin session.

### Seam 2 — Deal isolation across Phase 4-7 routes  ✅ HOLDS
- `db/resolver.js` resolves the physical file from the SESSION's server-side `dealId` (resolver.js:83) and refuses missing/archived/non-member bindings at BIND time with a uniform 403 (97-99, anti-enumeration T-03-17). A non-member never gets a connection handle.
- **No data route accepts a client-supplied deal selector.** Grep confirms the only route reading `req.query.deal` is `GET /api/admin/audit` (server.js:1093) — admin-only, and it filters `audit.db` (a deliberately cross-deal, deletion-surviving store), not a deal's data file. All 34 data-route deal resolutions use the server-resolved `req.dealContext.dealId`.
- A demo/open-mode session can never reach a real deal: `isOpenMode` requires `req.isDemo===true`, which is only ever set for a `dealId===null` (demo.db) binding (resolver.js:137, server.js:246). A deal-bound session is never open even under `DEMO_OPEN=1`.
- Reports export/pack are bound the same way — a session bound to deal A cannot export deal B (no param override; `deal = getDeal(req.dealContext.dealId)`, server.js:5621/5795).

### Seam 3 — Clean-room clearance composition  ⚠️ ONE OPEN LEAK (task channel)
- **One filter implementation, correctly reused for RAID:** `resolveRaidEntryClearanceArea` + `reportRaidRows` (server.js:4050-4081) is the single provenance-filtered RAID path for the live `GET /api/raid` (4083), `GET /api/reports/export?dataset=raid` (5629), and the pack (5804). DD list/by-id routes reuse `accessPolicy.filterByAreaGrant`/`assertAreaGrant`; org routes reuse `hasAreaGrant`. No divergent copies found.
- **WR-03 declassify-on-delete is genuinely closed:** both conversion routes STAMP `clearanceArea` at conversion time (DD: server.js:5439; flight-risk: 4872), and the resolver checks the stamp FIRST (4051), so deleting the source finding/entry cannot re-widen the RAID entry. Verified in code and via `test/raid-access-filter.test.js` (passes).
- **BUT the RAID fix has an unfiltered twin — see FINDING F-1 below.** The same conversion routes also write a TASK (`finding.title` / `"<name> — retention risk mitigation"`) into `taskLane`, which is NOT clearance-filtered anywhere. Proven empirically (below).

### Seam 4 — Audit completeness  ✅ HOLDS (one cosmetic residual, already accepted)
- Every deal write is audited via the store-layer hook with a required non-anonymous actor (`db/store.js` writeDb → `auditHook.writeAuditBatch`, throws if actorless). Demo writes are excluded by `AUDITED_DB_KINDS` (auditHook.js:55) — demo produces zero audit rows.
- Control-plane events (deal create/archive/delete, member/grant/vdr changes, password change, session revoke, break-glass use, DD denial, flight-risk read/denial, export, pack) all call `recordSecurityEvent` with `actor: req.portalUser`. Exports/packs are gated on `!req.isDemo` (server.js:5723, 5868) — real actor attributed, demo silent.
- **Residual (`db_kind:'control'` mislabel, AR-07-03 / 06-SECURITY.md) confirmed COSMETIC:** grep shows `db_kind` is written (auditHook.js:84) and defined in schema, but is NEVER read by any SELECT/filter. `queryAudit` filters on `deal_id / actor_username / ts` only (auditHook.js:161-164), and deal-scoped export/read events DO carry the correct `deal_id`, so an admin's per-deal audit query still returns them. The wrong `db_kind` label degrades no functional guarantee today. Cleanup is still worthwhile but it is not a live gap.
- Observation (not a finding): DD list/by-id READ successes are not audited (only denials); flight-risk register reads ARE audited. This asymmetry is a deliberate, documented design choice (denials + the more-sensitive register are audited; routine cleared list reads are not).

### Seam 5 — Validation coverage  ✅ HOLDS
- The pipeline fails closed: a write route with no registered schema returns 500 (`validators/index.js:329-332`), and `test/write-validation-coverage.test.js` (re-run here, PASS) proves every live write route resolves to a schema. Confirmed registrations exist for every Phase 4-7 write route (DD, org, synergy, deals, grants, vdr-grants, conversions).
- `z.object` strips unknown keys (D-13); DELETEs/bodyless POSTs use `EmptyBodySchema` (deliberate, reviewed). Error messages never echo the submitted value (T-03-34) — MNPI in a rejected field is not reflected back.
- `htmlField()`/`applySanitization` sanitizes exactly the tagged HTML-bearing fields (3 CMS fields inventoried) and leaves plain-text fields intact; runs LAST in the gate, after auth/role. Sanitizer is the documented regex (T-03-36 accepted, CSP + client textContent as backstop) — a known, accepted residual, not a new gap.

### Seam 6 — Exports as a new exfiltration channel (Phase 7)  ✅ HOLDS (except it inherits the task leak)
- Org/talent structurally excluded: `ReportExportQuerySchema` is a 4-value enum `{workstreams, tasks, raid, synergies}` (server.js:5607) — positions/decisions/flight-risk have no export branch; a crafted `dataset` 400s before any lane opens. Pack reads the same lanes; no org/talent section.
- Codename discipline: filename and pack model read `deal.name` (codename), never `deal.targetCompany` (server.js:5702, 5841, 5858). `test/reports-export.test.js` asserts the legal-target sentinel is absent.
- CSV formula injection neutralised (`lib/reportCsv.js:46-55`) and Content-Disposition CRLF stripped + RFC 5987 encoded with try/catch (`lib/reportFilename.js:37-83`).
- RAID export/pack are clearance-scoped via the shared `reportRaidRows`. **The tasks dataset, however, carries the F-1 leak into both the CSV/JSON export and the PDF pack** (proven below) — the export surface faithfully re-exports an already-leaking lane.

---

## Severity-ranked findings

### F-1 — HIGH — Clean-room leak: conversion-created TASKS bypass area clearance (T-04-21 revived through the task channel)
**Where:** `POST /api/dd/findings/:id/convert` (server.js:5394-5413) and `POST /api/org/flight-risk/:id/convert` (server.js:4830-4849) write a task into `taskLane(db)` (server.js:2925). `taskLane` has NO clearance filter; `GET /api/integration-tasks` (2963), `GET /api/reports/export?dataset=tasks` (5657), and `GET /api/reports/pack` (5806) all return every task to every deal member.

**Impact:** A deal member who lacks the source area's clearance — and is correctly `403`'d from the register/finding itself — can read the converted task's title, which is derived verbatim from restricted MNPI:
- Flight-risk → task title = `"<Employee Name> — retention risk mitigation"` (named retention data — a specifically-called-out MNPI category).
- DD finding → task title = the finding's own title (up to 2000 chars of user-authored diligence text).

The RAID twin of the SAME conversion is correctly hidden (D-17). Only the task twin leaks. This is the identical shape of T-04-21 (Phase-4 accepted risk that Phase-6 D-17 was created to close) — reopened by the half of the conversion the fix didn't cover.

**Aggravating factor (false assurance):** The shipped UI tells the operator the opposite of the truth:
- `public/js/org.js:918` — "Creates a linked Day-1 task and/or RAID entry, **visible only to members cleared for this register**."
- `public/js/due-diligence.js:328` — "Creates a linked Day-1 task and/or RAID entry, **visible only to members cleared for this area**."
- `06-UI-SPEC.md:166` recorded this exact wording as the intended contract. The RAID half honours it; the task half does not. An IL reading this copy may deliberately route sensitive retention/legal MNPI through conversion believing it stays clean-room-scoped.

**Not documented as an accepted risk** anywhere in 06-/07-SECURITY.md — this is a true cross-phase composition miss, not a known trade-off.

**Proof (empirical, run against isolated temp DBs at review time):** Deal with members `admin`, `karen`(hrbp/IL), `pmo_it`(clearance: `it` only). `pmo_it` is `403`'d from `GET /api/org/flight-risk` (control works). IL creates a `critical` flight-risk for employee "Jane MNPI-Doe" and converts it (`toTask:true, toRaid:true`). Reading as `pmo_it`:
```
RAID entry visible to non-hr member?   false   (D-17 filter works)
TASK  visible to non-hr member?        true    (leaked title: "Jane MNPI-Doe — retention risk mitigation")
TASK in /api/reports/export to non-hr?  true
```

**Suggested remediation (implementation owner's call — auditor does not patch):** Give tasks the same provenance-based clearance filter as RAID. Options: (a) stamp `clearanceArea` on the converted task (mirroring the RAID stamp) and apply a `resolveTaskClearanceArea`/filter in `taskLane` readers (`GET /api/integration-tasks`, the export tasks branch, and the pack's `tasks`); or (b) if tasks are intended to be whole-deal-team by design, then STOP copying restricted source text into the task (use a non-disclosing generic title + a link the reader can only follow if cleared) AND correct both UI notes to state the task is visible to the whole deal team. Either way the code and the UI copy must be made to agree. Also add a differently-cleared-member regression test on the task lane (the existing conversion tests only read tasks back as the cleared IL).

### F-2 — LOW — CSV formula-injection guard misses a formula preceded by leading whitespace
**Where:** `lib/reportCsv.js:46-55`. `csvField` apostrophe-prefixes only when `s[0]` is one of `= + - @`. A value like `"\t=cmd()"` or `" =1+1"` has a non-trigger first char, is not in the RFC-4180 quoting set (`/[",\r\n]/` excludes TAB/space), and passes through raw. Some spreadsheet apps trim leading whitespace before evaluating, so this can still be interpreted as a formula.
**Impact:** Low — requires user-authored free-text field beginning with whitespace + a formula char, opened in a lenient spreadsheet. Narrow, but this IS an MNPI export path with attacker-influenced free text (RAID/synergy titles, owners).
**Suggested remediation:** trim (or test `.trimStart()[0]`) before the trigger check, or prefix whenever the trimmed value begins with a trigger char.

### F-3 — INFORMATIONAL — `db_kind:'control'` audit mislabel (already accepted AR-07-03)
Confirmed cosmetic (no consumer reads the column; deal-scoped events carry the correct `deal_id`). Listed only to close the loop on the item flagged for this pass. Fixing it (pass the real resolved kind into `recordSecurityEvent`) is low-cost cleanup with no functional urgency.

---

## What was NOT covered (scope boundaries — stated honestly)
- **Client-side** XSS, DOM sinks, vendored-asset integrity, CSP efficacy in the browser, and the Windows/mac launchers — explicitly out of this agent's scope (second agent owns these). The server-side write-time sanitizer (`lib/sanitizeHtml.js`) was reviewed only as the write-time control; its regex limitation (T-03-36) is a pre-existing accepted risk, not re-litigated here.
- **Full 655-test suite** was not run end-to-end; targeted tests (`write-validation-coverage`, `raid-access-filter`, `org-flight-risk-conversion`) plus a purpose-built F-1 proof were run. The composition analysis was primarily source-level.
- **Rate-limiting / DoS** beyond a spot read: the login throttle and request timeouts were noted, not stress-tested. `T-07-07` (synchronous export join) is an accepted low risk.
- **Crypto primitives** (scrypt params, session entropy) were read and look standard (256-bit tokens, SHA-256-hashed at rest, constant-time compare) but were not independently benchmarked.
- **`ADMIN_TOKEN` / `DEMO_OPEN` operational misuse** is mitigated by loud startup warnings, not enforced — an operator who ships `DEMO_OPEN=1` opens demo.db to the world (real deals stay gated). This is by design; flagged as an operational, not code, risk.
- **PDF pack native path** (`lib/reportPack.js` via `@napi-rs/canvas`) was reviewed for its data model/inputs (only `lang` + server-resolved values reach it, T-07-32) but the skia rendering internals were not audited.

---

## Overall verdict

**OPEN_FINDINGS.**

- 1 × HIGH: **F-1** — conversion-created tasks leak clearance-restricted MNPI (named retention data, DD finding titles) to non-cleared deal members via the unfiltered task lane, the reports export, and the PDF pack; the RAID twin is filtered but the task twin is not, and the shipped UI copy falsely promises the task is clearance-scoped. Empirically proven. Not a documented accepted risk.
- 1 × LOW: **F-2** — CSV formula-injection guard misses leading-whitespace formulas.
- 1 × INFORMATIONAL: **F-3** — `db_kind` audit mislabel (already accepted; confirmed cosmetic).

The auth gate, deal isolation, validation pipeline, export enum/filename/codename discipline, and audit attribution otherwise compose correctly across the seven phases. F-1 should be resolved (code + UI copy made to agree) before the milestone is treated as production-ready for MNPI.


---

## REMEDIATION OUTCOME (2026-08-10, quick task 260810-erm)

All code-fixable findings from this review were fixed and verified before the embargo on this report was lifted (commits `15b2a86` F-1/F-3 task-lane clean-room filter · `0644c7b` F-2 client XSS ×3 + cache-stamps · `b5e111a` CSV whitespace guard · `646208e` MNPI read-audit · docs `4af0631`). Suite 655 → **687/687** (+32 tests incl. `test/task-access-filter.test.js` four-identity harness; F-1 leak-closed independently reproduced by the orchestrator). **DEFERRED to the user at release cut (demo-vs-real deployment DECISIONS, not code bugs — the demo showcase is a maintained deliverable): DEMO_OPEN=1 in launchers, default admin password published in login.html, transformers vendored blob remote model download.** `db_kind:.control` residual confirmed cosmetic (no query filters on it). Honest limit retained: only ~35 of ~345 client `innerHTML` sinks were traced — the class is reduced, not eliminated (`pmo.js:1073-1076` remains an unproven candidate for a future pass).
