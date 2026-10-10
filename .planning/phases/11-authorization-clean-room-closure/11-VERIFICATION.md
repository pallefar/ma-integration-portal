---
phase: 11-authorization-clean-room-closure
verified: 2026-10-10T16:40:00Z
verified_commit: e6a5021
verifier: Claude Fable 5.1 (gsd-verifier, independent of executors/reviewers/fixers)
verification: automated, Fable-reviewed
status: passed
score: 39/39 must-haves verified (36 by the verifier at e6a5021; G-1 closed by d91ff88; 2 UNCERTAIN browser lanes re-run by the evidence refresh; 1 human item decided)
behavior_unverified: 0
overrides_applied: 0
re_verification: true
suite: "node --test at e6a5021 -> tests 1258, pass 1258, fail 0 (26.3 s), run by the verifier"
soak: "SOAK_DURATION_MS=20000 SOAK_WRITE_INTERVAL_MS=250 npm run soak at e6a5021 -> FAIL (acknowledged=894 missing=0 mismatched=894) — see gap G-1"
gaps:
  - truth: "11-08 must-have 4 / Phase 8 contract: `npm run soak` PASS on the final code (acknowledged-write invariant held and EXACT)"
    status: closed (d91ff88, merged e920245)
    severity: high (proof instrument broken; no data-loss observed)
    reason: "Review fix IN-02 (commit feed9c9) makes POST /api/pulses in a real deal file the pulse under the session account's display name and ignore the body `employeeName`. scripts/soak.js uses `employeeName` as its per-write correlator (soak.js:261-263, 362, 494, 542). On HEAD every acknowledged pulse row therefore carries the worker's account name instead of the correlator: check 1 ('every acknowledged write present in the final database and exact') reports mismatched=894 of 894 and the run exits 1. The committedButUnaudited attribution (soak.js:542, pulseIdByEmployeeName) is also blind for the same reason, so under contention a committed-but-unaudited refused write could no longer be detected. 11-VALIDATION.md's soak PASS and evidence/soak.log were produced at the 11-08 base (before feed9c9) and do not describe HEAD."
    artifacts:
      - path: "scripts/soak.js"
        issue: "correlator carried in a field the server now overwrites for real deals; exactness and refused-write attribution both key on it"
      - path: ".planning/phases/11-authorization-clean-room-closure/11-VALIDATION.md"
        issue: "frontmatter soak verdict PASS and suite 1187 describe the pre-fix tree; stale for e6a5021"
      - path: ".planning/phases/11-authorization-clean-room-closure/evidence/soak.log"
        issue: "PASS log predates feed9c9"
    missing:
      - "Carry the soak correlator in a field the server preserves for every role (e.g. `comment`, or `type`+`comment`), compare `employeeName` to the worker account's display name, and key pulseIdByEmployeeName on the preserved field; or make the harness workers' account display names the correlator source. Server code needs no change — IN-02 is correct and must stay."
      - "Re-run `npm run soak` (at least the 250 ms-interval configuration the project sanctioned under D-14) at HEAD and refresh evidence/soak.log + 11-VALIDATION.md frontmatter (soak and suite counts)."
human_verification:
  - test: "WR-C01 reachability change (FIXER C flagged, awaiting the user's decision): log in to a real deal as hrbp (Integration Leader) and open /employee.html, /pmo.html, /supporting.html by URL; as employee open /dashboard.html and /supporting.html"
    expected: "Each is now redirected to / with the access-denied toast (the verified role is enforced against transitions.js `pageAccess`). Decide whether any of these roles should be added back to a page's pageAccess entry."
    why_human: "Which pages the IL may open is a product decision, not derivable from a written contract — the PRD lists APIs, not pages. Automation proves the current behaviour (test/client-authz-hiding.test.js vm rows), not that it is the wanted behaviour."
  - test: "Visual check of the hidden-control layout: evidence/p11-hrbp-admin-1440.jpg, p11-hrbp-admin-390.jpg, p11-employee-employee-1440/-390.jpg, p11-pmo-pmo-1440/-390.jpg (regenerate after the evidence refresh)"
    expected: "No empty rails, orphan headings or collapsed cards where configuration/content editors, the leaderboard, the helpdesk card or the Day pill were removed."
    why_human: "Layout quality after removal is a visual judgement; the suite only asserts hidden/not-requested."
  - test: "Acknowledge the logged-in demo-store change (IN-C04, by decision): log in on the demo store as `karen` (hrbp) and `pmo`"
    expected: "No CMS tabs / inline 'Edit Content' / demo-mode switcher for those accounts; demo-open (DEMO_OPEN=1) unchanged. Confirm this is acceptable for the showcase with logins."
    why_human: "D-11-02 applies ROLE_WRITE_POLICY on the demo store too; whether the showcase-with-logins may lose those controls is the user's call."
deferred:
  - truth: "IN-03: POST /api/deals/:id/setup audits after the control.db commit (Phase 8 'audit inside the transaction' rule)"
    addressed_in: "Phase 20"
    evidence: "Phase 20 goal 'Runtime Hardening & Operability'; DEPLOYMENT.md Known limitations names it; idempotent overwrite, pre-existing pattern at /members"
  - truth: "IN-01 residual: synergy WRITE responses / synergy 409 currentRecord still carry stored taskIds (count-only) to the staff writer"
    addressed_in: "Phase 18"
    evidence: "Phase 18 goal 'IL Execution Tooling & Reporting' reworks the synergy write surface"
  - truth: "targetCompany reaches an employee through GET /api/settings (PUBLIC_SETTINGS_KEYS) and the shell header although the CR-01 deal projection withholds it"
    addressed_in: "Phase 17"
    evidence: "Phase 17 goal 'IL Cockpit & Real-Deal Shell' rebuilds the real-deal shell; verifier note below"
  - truth: "WR-C02 real employee helpdesk channel (session-stamped self-service write) and WR-C07 employee 'own messages' projection"
    addressed_in: "Phase 22"
    evidence: "Phase 22 goal 'Workstream-Lead Collaboration & Collaborative Setup'"
  - truth: "IN-C06 academy lesson checkbox POSTs a demo-only route in a real deal with seeded courses; IN-C03 residual header-pill flash"
    addressed_in: "Phase 15"
    evidence: "Phase 15 goal 'Module Control — Core' (per-module enable/disable; admin console visibility)"
  - truth: "IN-C07 demo-open admin.html redirects to /login.html (GET /api/deals 401), pre-existing at 63bb2af"
    addressed_in: "Phase 23 (CERT-03) / Phase 20"
    evidence: "Phase 23 goal 'Production Certification'; FIXER C deferral reason"
---

# Phase 11: Authorization & Clean-Room Closure — Verification Report

**Phase goal (ROADMAP):** Every read and write is authorized for who the caller is — no `pmo`-writable configuration, no clean-room hole on tasks and RAID, no GET that mutates.
**Verified commit:** `e6a5021` (plans 11-01..11-08 + review fixes S and C merged)
**Verified:** 2026-10-10T16:40Z
**Status:** gaps_found (1 gap, 2 must-haves not re-run by the verifier, 3 human items)
**Re-verification:** No — initial verification
**Provenance:** `verification: automated, Fable-reviewed`. Every claim marked RE-RUN below was executed by this verifier in its own process at `e6a5021`; nothing below rests on a SUMMARY.md, REVIEW-FIX or VALIDATION.md statement alone.

## Executive verdict

The authorization mechanisms the phase set out to build are real, wired, and hold up under independent adversarial probing on an isolated instance (fresh `mkdtemp` MA_* paths, port 0 on 127.0.0.1, committed `data/*.db` never opened, `POST /api/settings/new-ma` never called, servers closed, temp dirs removed, `git status --porcelain -- data public/sent_emails` empty throughout):

- The read gate is canonical-path-anchored and fail-closed: 16 spellings x GET/HEAD/OPTIONS never answered 200 to an employee; an unlisted `/api` path is 403 (not 404) for a deal-bound session; the coverage test fails on an unlisted route *and* on a dead rule (mutation-checked).
- The deal registry record is projected per role at every exit: an employee's `GET /api/deals` body is exactly `{id,name,status}`, the `select` echo likewise; `dealSizeM`, `synergyTargetM`, `memberGrants`, `members`, `setup`, dates never appear (the review's CR-01 is closed and mutation-checked).
- An uncleared member gets a byte-identical `404 {"error":"Not found"}` on all 24 task/RAID write/delete shapes I tried (update, status flip, delete; no version, version 0, current version, version 999), the record is unchanged, lists omit it, the cleared member still gets the Phase 9 409 with `currentRecord`, and a reserved `source` is refused 400 on create (WR-02 closed).
- No GET mutates: 162 GETs as uncleared pmo, employee and cleared pmo left every table of the deal and control databases byte-identical; the suite's statement-level instrumentation drives all four lanes.
- Denials are rate-bounded with fresh actors: 25 identical probes -> exactly 1 row, for the gate (401 and 403), for DD and org by-id clearance denials (WR-01 closed), and for both clearance-404 route templates; `flushAll` writes folded counts of 24; the append-only trigger still blocks UPDATE; rows name actor, `METHOD /route/template`, reason and status.
- Config writes are admin-only under every spelling; `GET /api/settings` for an employee holds only `targetCompany` and `hasGeminiApiKey`; pulses are projected (own-only / aggregate), IN-02 forged names are replaced by the account name; `GET /api/employees/get-or-create` is gone and the POST never resolves a colleague's record.
- Full suite at HEAD: **1258/1258 pass** (run by me). Seven mutation checks in a throwaway copy each turned the intended test red while the unmodified copy stayed green.

**The phase does not close yet.** The one earlier-phase proof instrument the phase promised to keep green — `npm run soak` (Phase 8, named as a must-have of plan 11-08) — **fails on HEAD**: the IN-02 fix changed the field the soak harness uses as its per-write correlator, so the harness can no longer prove acknowledged writes are exact (mismatched=894/894) nor attribute refused-but-committed writes. No data loss is visible (missing=0, audit 1:1, conflict version reconciles exactly), so this is a broken proof, not a broken store — but a red soak is a red soak, and 11-VALIDATION.md's PASS describes a tree that no longer exists. Fix direction is in the harness only (gap G-1).

## Method actually executed

| Step | What I ran | Result |
|---|---|---|
| Full suite | `node --test` at `e6a5021` | 1258 pass / 0 fail, 26.3 s |
| Hand probe A (scratch `probe11.js`) | isolated server, deal with admin/hrbp/pmo-hr/pmo-nc/employee; 78 checks over claims (a)–(d) + extras | 72 pass; 6 "failures" were my own probe's window-reuse artefacts (the 60 s windows had already been opened by earlier sections — zero new rows is the bound working); re-done below |
| Hand probe B (scratch `probe11e.js`) | fresh actors per amendment 6; claim (e) + demo leniency | 15/15 pass |
| Mutation checks | throwaway rsync copy (scratchpad, node_modules symlinked), 7 mutations, one named test file each, revert between | all 7 red; baseline green |
| Soak | `SOAK_DURATION_MS=20000 SOAK_WRITE_INTERVAL_MS=250 npm run soak` (default load is known to fill this disk — 11-08 F-5) | **FAIL** check 1, exit 1 (gap G-1); 8 other checks pass; scratch dir removed by the script |
| Anti-pattern scan | `git diff 63bb2af..HEAD -- . ':!.planning' ':!node_modules'` added lines for TBD/FIXME/XXX/HACK/TODO/placeholder/console.log; `.skip/.todo` in the 14 Phase 11 test files | none (one `welcome-video-placeholder-bg` DOM id — not a stub) |
| Decision-coverage gate | `gsd-tools query check.decision-coverage-verify` | `could-not-parse` (non-blocking warning: 11-CONTEXT.md writes the decisions as a prose paragraph, not list items) |
| Browser lanes (11-08) | **not re-run by me** — an evidence-refresh agent is re-running them concurrently; running Playwright in parallel would contend for ports/disk | relied on: evidence logs at the 11-08 base (real 154/0, demo 193/0, Phase 10 runner 523/0, Phase 9 walk 350/0 + 18/0) and FIXER C's 205-visit isolated walk on its branch (1 refused request, IN-C07) |

## Contract table — requirement / acceptance / SC / decision / amendment

Legend: RE-RUN = I executed the proof myself at HEAD; SUITE = covered by a named test in my 1258-pass run; NOT RE-RUN = evidence exists but I did not execute it.

| Claim | Implemented (file:function) | Automated proof (test) | Verifier evidence | Verdict |
|---|---|---|---|---|
| **AUTHZ-01 / SC1 / PRD acc. 1** employee refused synergies, RAID, tasks, roster, comms, org, DD, reports, others' pulses; 200 on courses/lessons/notifications/own pulse | `lib/readPolicy.js` ROLE_READ_POLICY; `server.js:898-901` gate (`gatePolicy.readAllows`); `lib/pulseView.js pulsesFor` at `server.js:8038` | `test/read-policy-matrix.test.js` (matrix: real deal; tracer; /api/pulses), `test/personal-data-reads.test.js` | RE-RUN: 12 refused prefixes -> 403 fixed body; courses/lessons/notifications/pulses -> 200; employee pulses own-only, pmo aggregate `{rating,type,day}` | VERIFIED |
| **AUTHZ-01** every `/api` read route has a declared policy; unlisted route fails coverage | `lib/readPolicy.js` (no default rule); `test/helpers/route-inventory.js` | `test/read-policy-coverage.test.js` (4 structural + 1 live) | RE-RUN: unlisted path -> 403 for deal-bound pmo; mutation M3 (drop `/api/alerts` rule) -> coverage test fails 2 | VERIFIED |
| **AUTHZ-01 CR-01** employee/pmo deal record carries no deal size / synergy target / grants | `lib/dealProjection.js projectDealForRole`; `server.js:1687 dealForCaller` at 10 exits | `test/deal-record-projection.test.js`, `test/read-policy-matrix.test.js` (body allowlists) | RE-RUN: employee body `[{"id","name","status"}]`, pmo adds `targetCompany`; select echo identical; hrbp full; mutation M6 -> 5+1 tests fail | VERIFIED |
| **AUTHZ-02 / SC2 / PRD acc. 2** pmo/hrbp 403 on POST settings/menus/pages/banners/slides/media/i18n/courses (+ variants); admin ok | `server.js:457-465` ROLE_WRITE_POLICY admin-only rows | `test/config-admin-only.test.js` (a)–(f) | RE-RUN: 10 spellings x 2 roles -> 403 `role-write` | VERIFIED |
| **AUTHZ-02** `GET /api/settings` non-admin = allowlist subset, no secret | `validators/settings.js PUBLIC_SETTINGS_KEYS`; `server.js publicSettings` | `test/settings-public-subset.test.js` (a)–(f) | RE-RUN: employee keys = `targetCompany,hasGeminiApiKey` | VERIFIED |
| **AUTHZ-02** IL edits deal-level values via `POST /api/deals/:id/setup`; non-member 404; pmo 403 | `db/controlStore.js updateDealSettings`; `validators/wizard.js DealSettingsSchema` | `test/deal-settings-setup.test.js` (a)–(g) | RE-RUN: hrbp dealSettings -> 200 and visible in hrbp record; pmo -> 403 | VERIFIED |
| **AUTHZ-03 / SC3 / PRD acc. 3** uncleared member: 404 on update/status-flip/delete of hr task + RAID, stale version -> 404 not 409, no record field, record unchanged, cleared/admin unaffected, conversions work | `server.js:5398 RecordNotFoundError`, `:5426 assertRecordVisibleOr404` before `conflictIfStale` at 4079/4137/5470/6309-6310/6973-6974/7208; central 404 branch `:8408` | `test/clearance-write-paths.test.js` (tracer, Task 2 both lanes, conversions, Task 3 store, structural gate) | RE-RUN: 24 shapes -> 404 byte-identical to missing id; lists omit; cleared pmo sees title/version unchanged; cleared stale -> 409 with currentRecord; mutation M2 -> 2 tests fail | VERIFIED |
| **AUTHZ-03 D-11-03** store-layer fail-closed backstop for the four task/RAID lanes (closes 09-SECURITY UF-2) | `db/collections.js:181 CLEARANCE_SCOPED_COLLECTIONS` (+orgPositions/orgFlightRisks), `:219 hasRestrictedProvenance`; `db/store.js:213-218` | `test/clearance-write-paths.test.js` (Task 3: WHERE-layer conflict with NO armed filter) | SUITE; code read: provenance-aware null for PROVENANCE_SCOPED, null for CLEARANCE_SCOPED when unarmed | VERIFIED |
| **AUTHZ-03 WR-02** reserved `source` cannot be planted; convert dedupes only on stamped records | `validators/workstream.js RESERVED_SOURCE_PREFIXES / ClientSourceSchema`; convert routes | `test/clearance-write-paths.test.js` (reserved sources, planted-adoption) | RE-RUN: `dd-finding:<id>` and `Org-FlightRisk:x` on create -> 400 | VERIFIED |
| **AUTHZ-03 IN-01** restricted task ids not echoed via `GET /api/synergies[].taskIds`; link of restricted id = same 400 as unknown | `server.js synergyLinksVisibleTo`, `resolveSynergyTaskIds` | `test/clearance-write-paths.test.js` | RE-RUN: hrbp links hr task; uncleared pmo synergies body lacks the id; link attempt -> `Unknown task id: <supplied id>` same shape as unknown | VERIFIED |
| **AUTHZ-04 / SC3 / PRD acc. 4** no GET mutates; `get-or-create` is POST with schema; every write route POST/PUT/PATCH/DELETE with a registered schema | `server.js:476` exact POST rule; `validators/people.js EmployeeGetOrCreateSchema`; restricted lane own-record only (WR-03 defaults) | `test/no-get-mutates.test.js` (admin x2 lanes + pmo/employee x2 lanes, statement-level better-sqlite3 + fs instrumentation, negative controls, static `app.get` scan, method/schema sweep), `test/get-or-create-post.test.js` | RE-RUN: 162 GETs over all registered GET routes as pmo-nc/employee/pmo-hr -> no table of deal.db/control.db changed; GET get-or-create -> 403 (employee) / 404 (hrbp); employee POST with colleague `empId` + forged role/department -> own `emp_acct_*` record, `Specialist`/`Operations` | VERIFIED |
| **AUTHZ-05 / SC4 / PRD acc. 6 (audit half)** every 401/403 and clearance-404 is a rate-bounded security event with actor, route, reason | `lib/denialAudit.js createDenialAuditor`; `server.js:1624 recordDenial`, `:1647 recordClearanceDenial` (WR-01), `:1664 denyAt`, resolver `onDenied`, lockdown callback `:249`, 404 branch `:8416` | `test/denial-audit.test.js` (unit fake clock, tracer, live flood, variants, DD/org bounded, structural) | RE-RUN (fresh actors): 25x employee 403 -> 1 row (`row_id` `GET /api/synergies`, reason `role-read`, status 403); 25x anonymous 401 -> 1 row; DD random-id 25 -> 1, real-id 25 -> 1 (distinct subject), POST+DELETE by id 50 -> 1; org flight-risk 25 -> 1, decisions 25 -> 1; clearance-404 on `DELETE /api/raid/:id` and `POST /api/integration-tasks` 25 each -> 1 each, status 404; missing-id 404s mint nothing; `flushAll` folded counts 24/24/24/24; UPDATE on audit_log blocked by trigger; mutation M5 (denyAt stops recording) -> 9 tests fail | VERIFIED |
| **PRD acc. 5 / D-11-07** variant paths get the canonical verdict | `lib/requestPath.js` (unchanged this phase), `server.js:799 pathForms`, `readPolicy.readAllowsForms` | `test/path-canonical-gate.test.js` (CR-01 live read + write x variants), `test/config-admin-only.test.js` (d), `test/denial-audit.test.js` (variants same template) | RE-RUN: `/api/Synergies`, `;x`, `%73`, `//api/...`, trailing slash, `/api//`, `/API/raid`, `%65mployees` x GET/HEAD/OPTIONS never 200; pmo trailing slash same verdict as canonical | VERIFIED |
| **D-11-01** demo store stays lenient | gate skips read policy iff `req.isDemo === true` (`db/resolver.js` sets it only for unbound sessions) | `test/read-policy-matrix.test.js` (demo lenient x2) | RE-RUN: unbound employee session GET /api/synergies -> 200 | VERIFIED |
| **D-11-02** time-travel exception stays demo-only for staff | `server.js:457` exact rule before admin-only `/api/settings` | `test/config-admin-only.test.js` (e)/(f) | SUITE; code read | VERIFIED |
| **D-11-04** instrumented every-GET test covers pmo/employee lanes too (WR-04 b) | `test/no-get-mutates.test.js:371-403` | same | SUITE (4 lanes, "employee lane really meets refusals" guard) | VERIFIED |
| **D-11-05** counter as next row (append-only), per-process bound documented, crash loss documented (amendment 7) | `lib/denialAudit.js` header; DEPLOYMENT.md "Denial audit" §, lines 364-369 | `test/denial-audit.test.js` unit | code read + DEPLOYMENT.md read | VERIFIED |
| **D-11-06** pulses named only to admin/hrbp/author; `/api/hrbps` LEAD_ROLES; policy table in DEPLOYMENT.md; IN-02 account-stamped name | `lib/pulseView.js`; `readPolicy.js:79`; `server.js:8046-8070`; DEPLOYMENT.md "Roles and what they can read" | `test/personal-data-reads.test.js`, `test/deployment-role-matrix.test.js` | RE-RUN: forged `Jane Doe (hrbp)` stored as `v-emp`; pmo aggregate rows carry no name/comment/id; employee GET /api/hrbps -> 403; mutation M4 (doc cell drift) and M7 (widen `/api/synergies` to ALL_ROLES) -> doc-matrix test fails 2 each, matrix test fails 3 | VERIFIED |
| **Amendment 1** temporary get-or-create read rule removed by 11-06 | `lib/readPolicy.js:59-60` comment; no rule present | coverage test (dead rule would fail) | code read | VERIFIED |
| **Amendments 2/3** pmo.js config POSTs + AI download gated on `configWrite`; chatbot roster call gated on `roster` with neutral message | `public/js/pmo.js`, `public/js/transitions.js` | `test/client-authz-hiding.test.js` (re-anchored guard rows, WR-C06) | SUITE | VERIFIED |
| **Amendment 4** merge order 11-02 before 11-03 | n/a (process) | — | both merged, suite green | VERIFIED |
| **Amendment 5** restricted get-or-create resolves only the caller's own record; supplied `empId` ignored | `server.js` restricted lane | `test/get-or-create-post.test.js` | RE-RUN (above) | VERIFIED |
| **Amendment 6** bounded-audit scenario on a fresh actor/route | `scripts/uat/phase10-scenarios/authz-phase11.js denialAuditBounded`; my probe B | evidence `phase11-real.log` | RE-RUN with fresh actors | VERIFIED |
| **Amendment 7** DEPLOYMENT.md states crash loss of pending counts; shared suites `depends_on` | DEPLOYMENT.md:364-369 | — | doc read | VERIFIED |
| **11-07** `/api/auth/me` access map from `accessSummaryFor` + `roleAllowedForWrite`; client holds no role table; `maCan` | `server.js:1201`; `public/js/transitions.js maCan/maAccessReady/maPageAllowed` | `test/client-authz-hiding.test.js` (server rows, vm rows, key-drift row) | RE-RUN: employee map all-false with `configWrite/helpdesk/timeTravel` present (18 keys) | VERIFIED |
| **11-07** hidden-control list; page gate uses server-verified role (WR-C01), DD/org pages gated on capability (WR-C04), helpdesk honest error (WR-C02), assessment-instances probe (WR-C03) | `public/js/*.js` per 11-REVIEW-FIX-C.md | `test/client-authz-hiding.test.js` (1707 lines; mutation-checked by FIXER C) | SUITE; FIXER C live walk (not mine) | VERIFIED (behaviour); reachability policy -> human item 1 |
| **11-07** every changed public/js file has a bumped `?v=` stamp and is in the guard table | `test/asset-cache-bust.test.js` FROZEN/NEW_ASSETS | same | SUITE | VERIFIED |
| **11-08** DEPLOYMENT.md "Roles and what they can read" == ROLE_READ_POLICY row for row; admin-only write table; deal-level bounds | DEPLOYMENT.md:180-341 | `test/deployment-role-matrix.test.js` | SUITE + mutation M4 | VERIFIED |
| **11-08** real browser lane: role landings at 1440/390 with no 403 from a visible control; API matrix from the same sessions | `scripts/uat/phase10-scenarios/authz-phase11.js` | evidence `phase11-real.log` (154/0 at the 11-08 base) | NOT RE-RUN by me; evidence predates FIXER S/C; refresh in progress | UNCERTAIN (WARNING) |
| **11-08** demo lanes unchanged (dev + demo-open); Phase 9 walk + Phase 10 runner pass | `scripts/uat/phase10-walk.js` | evidence `phase11-demo.log` 193/0, `phase10-walk.log` 523/0, `phase9-walk*.log` | NOT RE-RUN by me; same caveat; note IN-C04 changes the logged-in dev lane by decision | UNCERTAIN (WARNING) |
| **11-08** 11-VALIDATION.md maps every item; suite >= 1055 + Phase 11 tests, 0 failures; **`npm run soak` PASS** | `11-VALIDATION.md`; `scripts/soak.js` | — | suite 1258/0 RE-RUN; **soak RE-RUN -> FAIL** (mismatched=894/894); VALIDATION frontmatter stale (1187, soak PASS at base) | **FAILED -> gap G-1** |
| **Phase 8 contracts** 503 contract, audit inside the deal transaction | unchanged | `test/busy-503-contract.test.js` (+16 lines this phase), soak checks 3/5 | SUITE; soak: committedButUnaudited=0, audit 1:1 894/894 (the checks that still work) | VERIFIED |
| **Phase 9 contracts** version precondition, 409 body, CR-01 conflict-body filtering | unchanged; `recordClearanceFilter` arms the WHERE-layer | `test/optimistic-locking-*.test.js` | RE-RUN: cleared stale -> 409 `conflict:true` + `currentRecord`; uncleared stale -> 404 (never 409); soak conflict lane 76 acks / 156 409s, version reconciles 77 | VERIFIED |
| **Phase 10 contracts** canonical path gate, accounts re-read per request | `lib/requestPath.js` unchanged (not in diff); `db/resolver.js` +7 (onDenied only) | `test/path-canonical-gate.test.js` | SUITE + variant probe | VERIFIED |

**Score:** 36/39 must-haves verified (1 FAILED, 2 UNCERTAIN — not re-run by this verifier).

## Gaps

### G-1 — `npm run soak` fails on HEAD: the harness correlator was broken by the IN-02 fix (severity: HIGH for the gate; no data loss observed)

- **Repro (isolated, run by me):** `SOAK_DURATION_MS=20000 SOAK_WRITE_INTERVAL_MS=250 npm run soak` at `e6a5021` ->
  `[FAIL] every acknowledged write present in the final database and exact: acknowledged=894 missing=0 mismatched=894`; all other 8 D-15 checks PASS (audit 1:1 894/894, integrity ok, conflict version 1+76=77 exact, committedButUnaudited=0); exit 1.
- **Cause:** `server.js:8056-8062` (commit `feed9c9`, IN-02) files a real-deal pulse under the session account's display name and ignores body `employeeName`. `scripts/soak.js:261-263, 362` embeds the per-write correlator in `employeeName`; `:494` compares it for exactness; `:542` keys `pulseIdByEmployeeName` on it for refused-write attribution. Every worker's rows now carry the worker account's name, so exactness is unprovable and the committed-but-unaudited detector (the Phase 8 CR-01 proof) is blind under contention.
- **Contracts broken:** plan 11-08 must-have 4 (`npm run soak PASS`), orchestrator's "Phase 8 contracts must still hold (`npm run soak`)", 11-VALIDATION.md frontmatter `soak: PASS` (now describes a tree that does not exist).
- **Fix direction (harness only; keep IN-02):** correlate on a field the server preserves for every role — `comment` (currently the constant `'soak-load'`) is the natural carrier — compare `employeeName` against the worker account's display name, and key the refused-write attribution map on the preserved field. Then re-run the soak at HEAD and refresh `evidence/soak.log` and the VALIDATION frontmatter (suite count too: 1258, not 1187). `test/personal-data-reads.test.js` already pins the server side; add a harness smoke (`SOAK_DURATION_MS=15000`) to the regeneration commands in `evidence/README.md` so the next security fix that touches the pulses route cannot silently break the proof again.

No other gap. In particular, CR-01, WR-01, WR-02, WR-03, WR-04, IN-01, IN-02, IN-04, IN-05 (server) and WR-C01..C07, IN-C01..C03 (client) were each re-checked against the written finding and are closed in code at HEAD; IN-03, IN-C04..C07 are accepted/deferred with a written reason and a named target (table below).

## Review remediation audit

| Finding | Disposition claimed | Verifier check | Agree? |
|---|---|---|---|
| CR-01 deal record unprojected | fixed `d86cd81` | RE-RUN probe (a) + mutation M6 | yes |
| WR-01 DD/org denials unbounded | fixed `5df9fea` | RE-RUN probe (e2/e3) | yes |
| WR-02 planted reserved source | fixed `9a96835` | RE-RUN 400 on both lanes incl. case variant | yes |
| WR-03 get-or-create honours body role/department | fixed `3ba8515` | RE-RUN: defaults stored | yes |
| WR-04 test gaps | fixed `95e5ca2` | code read of body-allowlist matrix + 4-lane no-GET-mutates | yes |
| IN-01 restricted ids via synergies | fixed `2098b73`, residual -> Phase 18 | RE-RUN read path; residual accepted (count-only to the writer) | yes |
| IN-02 forged pulse name | fixed `feed9c9` | RE-RUN; **but see G-1 — the fix broke the soak harness and nobody re-ran the soak** | fix correct; follow-through missing |
| IN-03 setup audit after commit | accepted, Phase 20 | DEPLOYMENT.md Known limitations present | accept (idempotent patch; pre-existing pattern) |
| IN-04 trailing slash 500 | fixed `72e0616` | code read `validators/index.js`; residual: a write to a path that is **not a route at all** (e.g. pmo `POST /api/dd/findings/<id>`) still answers 500 + one `console.error` per request — pre-existing class, log-noise oracle, not an authorization hole | yes (residual noted) |
| IN-05 rationale / day1Date | fixed `dd0b316` | code read | yes |
| WR-C01 page gate bypass | fixed `104a75e`, **reachability change needs the user's decision** | SUITE; human item 1 | yes |
| WR-C02 helpdesk false success | fixed `cb68e20`; channel -> Phase 22 | SUITE (`helpdesk` key false for employee RE-RUN) | yes |
| WR-C03 assessment-instances 403s | fixed `b36ce5e`; open question whether IL should see trends — **no target phase named** | SUITE | yes; flag the open question to the orchestrator |
| WR-C04 DD/org pages ungated | fixed `104a75e` | SUITE | yes |
| WR-C05 dashboard.js stamp | fixed `d2f3b25` | SUITE (`asset-cache-bust`) | yes |
| WR-C06 key-drift row | fixed `3b96d69` | SUITE | yes |
| WR-C07 employee comms invisible | sender-side note; projection -> Phase 22 | SUITE | accept |
| IN-C01 Day pill in real deals | fixed `0b3e068` | RE-RUN: `timeTravel:false` for deal-bound employee | yes |
| IN-C02 signage 403/throw | fixed `75bfc24` | SUITE | yes |
| IN-C03 flash | rail tabs fixed `6df61b5`; residual -> Phase 15 | SUITE | accept |
| IN-C04 logged-in demo store loses config controls | documented, no code (D-11-02) | consistent with the write table | accept; human item 3 |
| IN-C05 `?empId=` binding | accepted | reviewer's reasoning holds | accept |
| IN-C06 lesson checkbox demo-only | -> Phase 15 | not reachable in a fresh real deal | accept |
| IN-C07 demo-open admin.html -> login | -> Phase 23/20, pre-existing at 63bb2af | `git log` confirms pre-existing | accept |
| FIXER S observation: `targetCompany` to employee via `GET /api/settings` + header | -> Phase 17 | RE-RUN: employee settings body `targetCompany: "deal_vrf1 Co"` while the CR-01 projection withholds it from the same employee's deal record | accept, with a note: the two rules are inconsistent on HEAD. AUTHZ-01's list does not name the target, and the employee portal serves the target's own staff, so I do not call this a gap — but Phase 17 should pick one rule and apply it to both exits. |

Deferral I would push back on: none hard. Two soft notes — WR-C03's product question (IL trends) has no owner phase, and the `dd-clearance` 403 body (`"You are not cleared for that due-diligence area."`) still differs from the task/RAID 404 (`"Not found"`), i.e. DD by-id still confirms existence to an uncleared member. That is Phase 6's documented DD contract, not Phase 11's (D-11-03 scopes the 404 rule to tasks/RAID "and every clearance-carrying record" — DD findings ARE such records). I record it as a residual risk for Phase 23 rather than a gap because the PRD acceptance 3 and SC3 name tasks and RAID only; the orchestrator may decide otherwise.

## Required artifacts (Level 1-3)

| Artifact | Exists | Substantive | Wired | Status |
|---|---|---|---|---|
| `lib/readPolicy.js` | yes (186 lines) | table + 4 functions + ACCESS_PROBES | gate `server.js:753/899`, `/api/auth/me :1201`, notifications `:7183`, get-or-create `:7752` | VERIFIED |
| `lib/denialAudit.js` | yes (274) | windowed recorder, overflow key, legacy action shape | `server.js:1609-1667`, resolver/lockdown callbacks, 404 branch | VERIFIED |
| `lib/dealProjection.js` | yes (57) | per-role allowlist, fail-closed unknown role | 10 exits via `dealForCaller`/`projectDealsForRole` | VERIFIED |
| `lib/pulseView.js` | yes (69) | projection | `server.js:8036-8038` (non-demo only) | VERIFIED |
| `db/collections.js` CLEARANCE_SCOPED + `hasRestrictedProvenance` | yes | 8 lanes, versioned-membership assertion | `db/store.js:213-218` | VERIFIED |
| `db/controlStore.js updateDealSettings` | yes | `.immediate` RMW of 5 keys | `POST /api/deals/:id/setup` | VERIFIED |
| `validators/settings.js PUBLIC_SETTINGS_KEYS`, `people.js EmployeeGetOrCreateSchema`, `workstream.js ClientSourceSchema`, `wizard.js DealSettingsSchema` | yes | zod | registry + routes | VERIFIED |
| `test/*` 14 Phase 11 suites + 2 helpers | yes | 7,000+ lines, no `.skip/.todo`, live + structural + vm | in `node --test` | VERIFIED |
| `scripts/uat/phase10-scenarios/authz-phase11.js` | yes (40 KB) | 2 scenario families | plugged into `phase10-walk.js` | present; run NOT re-run by me |
| DEPLOYMENT.md §§ roles/config/clean-room/denial audit/known limitations | yes | 216 added lines | pinned by `deployment-role-matrix.test.js` | VERIFIED (does not list the three new access-map keys `helpdesk/timeTravel/assessmentInstances` — info) |
| `11-VALIDATION.md`, `evidence/` (1108 KB <= 1200 KB) | yes | maps every item | — | present; **stale for HEAD** (G-1) |

## Anti-patterns / test quality

- Debt markers in the Phase 11 diff: none (TBD/FIXME/XXX/TODO/HACK/placeholder: 0 hits; `console.log` in added server code: 0).
- Disabled tests in the 14 Phase 11 suites: none.
- Circular expected values: none found; expected values are status codes, fixed bodies, allowlists from `validators/settings.js` (declared contract), and counts — not captured from the system under test.
- Assertion strength: value-level throughout (bodies compared byte-for-byte, allowlists, row counts, folded counts). Negative controls exist in coverage, no-GET-mutates and denial-audit suites and I confirmed each by mutation.
- One structural note: the decision-coverage gate cannot parse 11-CONTEXT.md's `<decisions>` block (prose, not list items) — warning only; D-11-01..07 are all evidenced in the table above.

## Residual risks for Phase 23 certification

1. **Soak proof currently red (G-1).** Until the harness is fixed and re-run at HEAD, the project has no passing multi-process acknowledged-write proof for the final Phase 11 code.
2. **Audit write amplification (11-08 F-5, Phase 12).** Default-load soak fills this disk (5.5 GB audit.db in ~90 s). Per-process denial bound is correct but each extra server process multiplies denial rows by N.
3. **Unrouted write paths answer 500 + per-request error log** (IN-04 residual class): any staff role can emit one `console.error` line per request by POSTing to a non-existent `/api` path within a prefix the write table allows (e.g. `/api/dd/<anything>`). Not an authorization hole; a log-volume oracle. Phase 20 (structured logs / rate limits) territory.
4. **DD by-id denials are 403 with a distinguishing body**, unlike the task/RAID 404 rule — existence of an out-of-clearance finding is confirmed to an uncleared member. Phase 6 contract; worth a conscious decision before certification.
5. **`targetCompany` policy inconsistency** (employee: withheld in the deal record, served in `/api/settings` and the header) — Phase 17.
6. **Real-deal employee functionality narrowed by design:** no helpdesk card (write refused since v2.1.0), no in-app messages, no leaderboard, no Day pill. All honest (no false success) but Phase 22 owns the replacement channel.
7. **Docs to refresh before close:** REQUIREMENTS.md AUTHZ-01..05 still `Pending`; ROADMAP Phase 11 box unticked; 11-VALIDATION.md frontmatter (suite 1187 -> 1258, soak verdict); DEPLOYMENT.md access-map key list.
8. **Browser-lane evidence at HEAD** pending the concurrent refresh; my API probes cover the server contract, not pixel layout.

## Human verification required

1. **WR-C01 reachability (product decision).** As hrbp in a real deal, open `/employee.html`, `/pmo.html`, `/supporting.html`; as employee open `/dashboard.html`, `/supporting.html`. Expected: redirected to `/` with the access-denied toast. Decide whether to add any role back to `pageAccess` in `public/js/transitions.js:1226`.
2. **Hidden-control layout.** Eyeball the evidence JPEGs (after refresh) for empty rails/orphan headings.
3. **IN-C04 acknowledgment.** Logged-in demo store (`karen`/`pmo`) no longer shows CMS tabs, inline edit, or the pmo demo-mode switcher; demo-open unchanged. Confirm acceptable.

## Gaps summary

One gap. Phase 11's own authorization goal — explicit fail-closed read policy, admin-only configuration, clean-room 404 on every task/RAID write path, no mutating GET, rate-bounded denial audit — is achieved and independently re-proven at `e6a5021`, including every CRITICAL/HIGH review finding. What is not achieved is the phase's promise to leave the Phase 8 soak proof green: the IN-02 fix changed the server behaviour the harness depends on, the harness was not updated, and the soak was not re-run after the fixes. Fix the harness (not the server), re-run, refresh VALIDATION/evidence, then re-verify.

---

_Verified: 2026-10-10T16:40Z at e6a5021_
_Verifier: Claude Fable 5.1 (gsd-verifier) — verification: automated, Fable-reviewed_


## Closure addendum (orchestrator, 2026-10-10, autonomous-mode contract)

- **G-1 CLOSED.** `scripts/soak.js` carries its correlator in `comment` (`d91ff88`, merged `e920245`); `test/soak-correlator.test.js`
  pins it (3 static guards + a 2-process smoke). Soak re-run on the final code: fixer — 3 and 4 processes PASS (872 / 1118 acknowledged,
  0 missing, 0 mismatched, audit 1:1); evidence refresh — `SOAK_DURATION_MS=60000 SOAK_WRITE_INTERVAL_MS=250`: 2226 acknowledged,
  0 lost, audit 1:1, 0 committed-but-unaudited. `evidence/soak.log` is the post-fix run.
- **Browser lanes re-run on the final code** (evidence refresh `213f707`): real lane 284/0, demo lanes 195/0, full Phase 10 runner
  655/0, Phase 9 walk 350/0 and `--demo-open` 18/0; the same scenario module run against `d927233` (pre-fix) fails 93 rows — one
  cluster per review finding — and fails none on the fixed tree (`evidence/prefix-sensitivity.log`).
- **Human items decided:** (1) WR-C01 reachability — ACCEPTED as the original `pageAccess` design now actually enforced (hrbp is not on
  employee/pmo/supporting; employee not on dashboard/supporting; pmo not on admin); real-deal landing by role is Phase 15/17
  (`11-CARRY-INS.md` #7). (2) Visual layout — refreshed JPEGs viewed at 1440 and 390: no broken layout, hidden controls are hidden;
  demo copy / persona-derived header in a real deal recorded as carry-in #17. (3) IN-C04 logged-in demo store hides config controls
  from karen/pmo — ACKNOWLEDGED (D-11-02), noted for the release notes.
- Open items for later phases live in `11-CARRY-INS.md`; the security audit is `11-SECURITY.md` (SECURED 44/44, 0 open).
