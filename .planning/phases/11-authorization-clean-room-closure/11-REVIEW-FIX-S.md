---
phase: 11-authorization-clean-room-closure
fixed_at: 2026-10-10T18:30:00Z
review_path: .planning/phases/11-authorization-clean-room-closure/11-REVIEW.md
part: S (server-side findings of review part A)
iteration: 1
base: d927233e1aba6776ebcbb223f2d4fa677357d90b
head: d818d7f
findings_in_scope: 10
fixed: 9
accepted: 1
deferred: 0
status: all_fixed
suite: 1201/1201 (base 1181)
---

# Phase 11: Code Review Fix Report — FIXER S (server side)

**Source review:** `11-REVIEW.md` (Fable, part A: CR-01, WR-01..WR-04, IN-01..IN-05)
**Worktree:** `.claude/worktrees/agent-a0080148ecaf15c3b`, branch `worktree-agent-a0080148ecaf15c3b`, base `d927233`
**Verification ran in:** the isolated worktree (MA_* temp paths only; committed `data/*.db` never opened;
`POST /api/settings/new-ma` never called). `git status --porcelain data/ public/sent_emails/` was empty at every commit.

## Summary

| Finding | Severity | Outcome | Commit |
|---|---|---|---|
| CR-01 deal record handed unprojected to employee/pmo | Critical | **fixed** (mutation-checked) | `d86cd81` |
| WR-01 DD/org clearance denials not rate-bounded | High | **fixed** (mutation-checked) | `5df9fea` |
| WR-02 planted reserved `source` + convert adoption | High | **fixed** (both halves mutation-checked) | `9a96835` |
| WR-03 restricted get-or-create honours body role/department/company | Medium | **fixed** | `3ba8515` |
| WR-04 test gaps | Medium | **fixed** (a, b in `95e5ca2`; c in `9a96835`; d in `5df9fea`) | `95e5ca2` |
| IN-01 restricted task ids echoed via synergies | Low | **fixed** | `2098b73` |
| IN-02 pulse `employeeName` free text | Low | **fixed** | `feed9c9` |
| IN-03 setup write committed before its audit event | Low | **accepted with reason** (DEPLOYMENT.md), target Phase 20 | `d818d7f` |
| IN-04 trailing slash → 500 schema diagnostic | Low | **fixed** | `72e0616` |
| IN-05 stale rationale + `day1Date` format | Low | **fixed** (rationale already reworded by 11-07; regex added) | `dd0b316` |

Full suite at every commit: green. Final: **`node --test` → tests 1201, pass 1201, fail 0** (base 1181; +20 tests).

## Fixed Issues

### CR-01: `GET /api/deals` / `POST /api/deals/select` handed employee the full deal record

**Files modified:** `lib/dealProjection.js` (new), `server.js`, `public/js/deal-home.js`, `public/dashboard.html`,
`test/deal-record-projection.test.js` (new), `test/org-summary.test.js`
**Commit:** `d86cd81`
**Applied fix:** One allowlist helper `projectDealForRole(deal, role)` (`lib/dealProjection.js`): admin/hrbp get the full
record; pmo `{id, name, targetCompany, status}`; employee **and any unknown/missing role** `{id, name, status}` (fail
closed). `server.js` routes every deal-record exit through `dealForCaller(req, deal)` / `projectDealsForRole`:
`GET /api/deals`, `POST /api/deals/select` echo, `POST /api/deals` (create + resumed), `POST /api/deals/:id/setup` (all
three responses), `/members`, `/grants` (both responses), `/api/admin/deals/:id/archive` — 10 call sites. `/api/auth/me`
was checked by grep and returns no deal record (only `dealId`). `deal-home.js` omits the setup checklist when the record
carries no `setup` (projected pmo/employee) instead of rendering six false "Outstanding" rows and a resume link into a
wizard those roles cannot use; stamp `deal-home.js?v=1791800001 → 1791800002` on `dashboard.html` (its only loader).
`deal-switcher.js` needed no change (already renders `targetCompany || ''`).
**Tests:** per-role body assertions on `GET /api/deals` and the select echo (pmo/employee bodies contain none of
`dealSizeM, synergyTargetM, memberGrants, members, setup, createdBy, dealSettings, currency, day1Date` nor the seeded
values), setup responses stay full for admin/hrbp, unit (incl. `__proto__`/`constructor`/unknown roles), a static scan
that no `res.json({ success: true, deal… })` echo bypasses the projection, and **vm render checks** of `deal-home.js` and
`deal-switcher.js` for each role shape. **Mutation check:** reverting the projection on `GET /api/deals` + select → 3 of
the new tests fail.
**Existing test edited:** `test/org-summary.test.js` pins the CURRENT deal-home stamp by design; bumped to `1791800002`.

### WR-01: DD and org clearance denials wrote one permanent audit row per request

**Files modified:** `lib/denialAudit.js`, `server.js`, `test/denial-audit.test.js`, `test/org-dd-read-audit.test.js`,
`test/org-flight-risk-audit.test.js`
**Commit:** `5df9fea`
**Applied fix:** `createDenialAuditor().record()` accepts an optional `action` + bounded `subject`. Such a key emits the
historical row shape on the first denial of a window (`{action, subject, before: null, after: null}` — byte-for-byte the
row the call sites always wrote) and the folded count as the key's next row under the same action
(`after: {reason, status, path, route, count, folded: true, windowStartedAt}`). New `recordClearanceDenial(req, action,
reason, subject)` in `server.js` keys on actor + deal + method + **route template** (`req.route.path`) + reason
(`dd-clearance` / `org-clearance`) + subject. `refuseDdArea` (all DD by-id GET/POST/DELETE + convert) and the three org
sites (`org-positions-target-access-denied`, `org-decisions-access-denied`, `org-flightrisk-access-denied`) now use it;
action names and `!req.isDemo` gating preserved; the successful-read audits (`org-positions-target-read`, etc.) untouched.
**Design notes:** (1) the DD subject (item area or null) is part of the key so "unknown id" vs "uncleared area" stay
distinct rows (the existing `dd-findings` test that expects 2 rows for one uncleared + one unknown probe still passes);
subjects are bounded (stored, validated area ids). (2) **The deal id is now part of every auditor key** (also for the
generic `access-denied` keys): a refusal in deal B must not fold into a row naming deal A; the deal id comes from the
server-side binding, so the key space stays bounded. No existing denial-audit assertion changed.
**Tests:** live 25 × `GET /api/dd/findings/<random>` → 1 `dd-access-denied` row (+1 for a real uncleared id, distinct
subject), flush writes the folded `count: 24`; live 25 × `GET /api/org/decisions?positionId=<random>` and 25 ×
`GET /api/org/flight-risk` → 1 row each, flush → `count: 24`; unit for legacy-action shape + subject/deal keys;
structural (no direct `recordSecurityEvent` for the four actions). **Mutation check:** restoring the direct per-request
write in `refuseDdArea` → the live DD test and the structural test fail.
**Existing tests edited (named):** two source-grep guards (`org-dd-read-audit (i)`, `org-flight-risk: grep-level guard`)
counted the literal `recordSecurityEvent` in the handler bodies; they now count `recordSecurityEvent|recordClearanceDenial(req`
with the same expected totals (2 per handler) — the guard's intent (denial + success are both audited) is unchanged, and
the flight-risk guard additionally asserts the denial is the rate-bounded `org-flightrisk-access-denied` call.

### WR-02: uncleared member planted a reserved `source`; the IL's conversion adopted it

**Files modified:** `validators/workstream.js`, `server.js`, `test/clearance-write-paths.test.js`
**Commit:** `9a96835`
**Applied fix:** (a) `RESERVED_SOURCE_PREFIXES = ['dd-finding:', 'org-flightrisk:', 'template:', 'remediation:']`
(enumerated by grep: the four prefixes the convert / instantiate / from-remediation routes mint on task/RAID; the DD
`ddtemplate:` prefix lives on DD request items whose schema already strips `source`). A zod `refine` on the `source`
field of BOTH `TaskUpsertSchema` and `RaidUpsertSchema` refuses them (trimmed, case-insensitive) with the standard 400
body, on create and update, for every role; free text such as `manual` stays valid. Internal routes do not pass through
the HTTP schema. (b) Both convert routes adopt an existing source-matched record only if it ALSO carries the server
stamp: DD — any valid `DD_AREA_IDS` stamp (the stamp is deliberately sticky across a re-pointed finding, which the
existing re-point test relies on); flight-risk — `clearanceArea === 'hr'`.
**Tests:** reserved sources (6 spellings) → 400 on task and RAID create, 400 on update (admin too), nothing planted,
free-text sources 201; a record planted straight into the store with a matching source and no stamp is NOT adopted — DD
and flight-risk conversions mint the genuine task/RAID with the stamp and link it, and a re-convert dedupes on the
genuine one. **Mutation checks:** removing the refine → the reserved-source test fails (and the demo-store test); with
the refine restored, reverting only the dedupe predicate → the planted-adoption test fails.
**Existing test edited (named):** `clearance-write-paths (Task 2): in the demo store …` planted its stamped record via
the HTTP create path with `source: 'org-flightrisk:demo_probe'`, which is now refused by design. It now asserts that
refusal (400) and writes the stamped record straight into the temp demo store; the rest of the test (invisible to every
role, by-id write 404s) is unchanged.
**Residual (documented, not a code gap):** a genuine DD conversion created before T-ERM-01 (tasks lacked the stamp) is
no longer adopted on re-convert, so such a legacy finding would get a second, stamped task. Duplicates are preferred
over adopting an unprovable record.

### WR-03: restricted get-or-create honoured body `role` / `department` / `company`

**Files modified:** `server.js`, `test/get-or-create-post.test.js`
**Commit:** `3ba8515`
**Applied fix:** in the restricted lane the new roster row takes `role: 'Specialist'`, `department: 'Operations'`,
`company: <deal's targetCompany | 'NextGen Sensors Ltd.'>` — the same defaults as any other server-minted profile; the
body values are never used. Staff roles and the demo store unchanged.
**Tests:** employee POST with `<img …>` role, `Executive Board`, a forged company and `isLeader` → defaults stored and
returned; hrbp `GET /api/employees` contains none of the forged values; hrbp still supplies its own fields.

### WR-04: test gaps that let CR-01 / WR-01 / WR-02 pass green

**Files modified:** `test/read-policy-matrix.test.js`, `test/no-get-mutates.test.js` (+ (c) and (d) above)
**Commit:** `95e5ca2`
**Applied fix:** (a) a new matrix test with per-role BODY allowlists for `/api/deals`, `/api/settings`,
`/api/pulses`, `/api/notifications` against a deal seeded with MNPI on every surface (deal-level values, pulses from
two roles, an overdue task and a high RAID entry); (b) every registered GET route driven again as **pmo and employee**,
in a real deal and the demo store (4 lanes × 65 GETs; histograms in the test diagnostics), any non-audit write fails;
(c) reserved-source negatives in `clearance-write-paths` (`9a96835`); (d) bounded DD/org denial scenarios in
`denial-audit` (`5df9fea`). All existing assertions intact; no ROLE_READ/WRITE_POLICY row touched.

### IN-01: restricted task ids echoed through `GET /api/synergies[].taskIds`

**Files modified:** `server.js`, `test/clearance-write-paths.test.js`
**Commit:** `2098b73`
**Applied fix:** `synergyLinksVisibleTo(req, db)` drops ids of existing tasks the caller cannot see
(`recordVisibleTo`) — applied to `GET /api/synergies` and to `reportSynergyRows()` (synergies export + report pack, the
same read class). Ids that resolve to no task are left as stored (no information). The write path's hidden-link
preservation (`resolveSynergyTaskIds`) is unchanged and proven still to preserve the link on an uncleared edit.
**Residual (named):** the synergy WRITE responses (`initiative: item` on the 10 synergy routes) and a synergy 409
`currentRecord` still carry the stored `taskIds` to the staff caller who performed that write. These are count-only
(ids, no content) and reach only a caller already editing the initiative; tracked with the IL execution tooling work
(Phase 18) where the synergy write surface is reworked.

### IN-02: pulse `employeeName` was free text

**Files modified:** `server.js`, `test/personal-data-reads.test.js`
**Commit:** `feed9c9`
**Applied fix:** in a real deal (`req.isDemo !== true`) `POST /api/pulses` files the pulse under the session account's
display name (fallback: username); the body value is ignored (still schema-required, so clients are unchanged). Demo
store unchanged (the byte-identical demo test stays green).
**Tests:** forged `Jane Doe (hrbp)` → stored `Alice A`; blank display name → username; the IL never reads the forged
name. **Existing test setup edited (named, assertions unchanged):** `personal-data-reads` now seeds its three accounts
with the display names its scenarios already post and assert (`Alice A`, `Bob B`, `Pat PMO`), so those unchanged
assertions now prove the name comes from the account.

### IN-04: `POST /api/employees/get-or-create/` answered 500 "no registered validation schema"

**Files modified:** `validators/index.js`, `test/get-or-create-post.test.js`
**Commit:** `72e0616`
**Applied fix:** `validationMiddleware` mirrors the router: a trailing-slash spelling is validated with the canonical
route's schema (Express routing is non-strict, so the same handler runs); any other variant whose canonical form
(`req.gatePathCanonical`) names a real write route gets the router's own `404 {"error":"Not found"}` (the case-sensitive
router serves no handler for it — and no body is validated against a schema the router will not run). A write route
with no schema in any spelling still fails closed with the 500.
**Tests:** trailing slash returns the identical record to the canonical spelling and is validated by its schema (400 on
an over-long name); `Get-or-create`, `//`, `%63` variants are never 500 and carry no schema oracle.

### IN-05: stale policy rationale; `day1Date` format

**Files modified:** `validators/wizard.js`, `validators/deals.js`, `test/deal-settings-setup.test.js`
**Commit:** `dd0b316`
**Applied fix:** the `readPolicy.js` integration-tasks rationale was **already reworded by 11-07** ("an employee gets no
task list and no task nudge in a real deal …") — no change. `day1Date` on `WizardBasicsSchema`, `CreateDealSchema`
(kept in sync per the D-07 anti-drift rule) and `DealSettingsSchema` now requires
`^(\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]))?$` (ISO date or empty — the wizard only sends a non-empty value).
**Tests:** three length-valid junk values added to the existing out-of-range list (additive); a unit test over all
three schemas (accepts ISO dates and `''`, refuses 7 malformed spellings).

## Accepted

### IN-03: `POST /api/deals/:id/setup` commits the control.db write before its audit event

**File:** `server.js:1882-1888` at head (and the older `/api/deals/:id/members`)
**Reason:** the control-plane change is a plain overwrite of the same values; if the audit append meets a busy
audit.db, the central 503 triggers the client's silent retry, which re-applies the identical patch and writes the audit
event — same end state, only the first unaudited attempt is not separately recorded. No code change; documented in
`DEPLOYMENT.md` → **Known limitations** (commit `d818d7f`). **Target:** Phase 20 (runtime hardening) may move the append
inside `updateDealSettings`' `.immediate` transaction as deal-data writes already do.

## Observations for the orchestrator (not review findings)

- **`targetCompany` still reaches an employee through two other surfaces.** CR-01's decision withholds the target name
  from employee deal records, but a real deal's own database `settings.targetCompany` (seeded by `createDealDatabase`)
  is returned to every role by `GET /api/settings` (`targetCompany` is in the 11-02 `PUBLIC_SETTINGS_KEYS` allowlist) and
  by `GET /api/assessment-status`, and the shell header (`public/js/transitions.js` ~2966) renders it for every page.
  Withholding it is a product call plus a client fallback in FIXER C's files; **deferred to Phase 17 (IL Cockpit &
  Real-Deal Shell)**, which rebuilds the real-deal shell. Not changed here.
- **Needs readPolicy wording (FIXER C / 11-08 owner):** the `/api/deals` exact rule's `why` text ("already filtered to
  the caller's own memberships") could add "and projected per role (lib/dealProjection.js)". Rows not touched (pinned).
- **Disk exhaustion during this run.** At ~17:56 the volume hit 100 % (ENOSPC). The cause was a sibling's soak run in
  `$TMPDIR/gsd-soak-szcBuT` whose `audit.db` had grown to **5.5 GB** (servers from worktree
  `agent-aa274ef9fc1247dbf`). One full-suite run in this worktree failed 24 tests from disk exhaustion. Each failing
  suite passed when re-run individually, and the full suite passed 1196/1196 once space recovered. I did not touch the
  soak directory. A 5.5 GB audit trail from a ~2-minute soak is worth a look by its owner: it may be denial-audit or
  read-audit amplification under load.
- **Merge notes for FIXER C:** I edited `public/js/deal-home.js` (setup-checklist guard only) and the `deal-home.js`
  stamp on `public/dashboard.html` (now `1791800002`); `deal-switcher.js` is unchanged. FIXER C's
  `client-authz-hiding` item-7 vm test mocks `/api/deals` with a `setup` key, so it is unaffected.

---

_Fixed: 2026-10-10_
_Fixer: Claude (gsd-code-fixer, FIXER S)_
_Iteration: 1_
