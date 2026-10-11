---
phase: 13
task: quick — deal-membership rule for the control-plane /api/deals/:id* surface (milestone review F-1, HIGH, release-blocker)
base: 50940cba6e32c5a7dbe11c97b49e176569f09ef6
status: complete
files_modified:
  - server.js
  - test/deal-membership-control-plane.test.js (new)
---

# 13-QUICK: deal membership on the control-plane `/api/deals/:id*` surface

## Problem
Every `/api/deals/:id*` route is control-plane (`db/resolver.js` `isControlPlanePath`: `startsWith('/api/deals/')`),
so the resolver's bind-time membership refusal never runs for it. The gate's role rules for `'/api/deals'`
(ROLE_WRITE_POLICY `admin,hrbp`; ROLE_READ_POLICY `LEAD_ROLES`) prove the ROLE, not WHICH deal. Phase 11 T-11-13 added
`isDealMember` to `POST /api/deals/:id/setup` only. A non-member `hrbp` could therefore read another deal's roster and
clearance map, rewrite its clean-room grants (and get the full registry record echoed back), and add a permanent
`vdr-access-grant` row to that deal's audit trail.

## Fix: one mount-level rule (server.js)
`app.use('/api/deals/:id', …)`, registered directly below `GET /api/deals` and **above** every `:id` handler:
- admin (session or the attributed break-glass identity) passes: `isDealMember` treats admin as a member of every deal;
- every other role must be in the deal's `members[]`; otherwise `404 {"error":"Deal not found."}`, byte-identical
  to the missing-deal branch every handler (and `/setup`) already sends. Unaudited, like that branch.
- The rule sits after the static siblings `POST /api/deals/wizard/basics` and `POST /api/deals/select`, which are
  registered above it and always respond. A comment says any new static `/api/deals/<name>` route must also go
  above the rule. If one is added below it, a non-admin gets a 404, so the mistake fails closed.
- A future `/api/deals/:id/<x>` route picks up the rule automatically. The new suite's inventory test fails until
  that route is classified.
- Path spellings: `req.params.id` is decoded by the same router step that gives the handler its `req.params.id`, so
  a percent-encoded id cannot name one deal to the check and a different deal to the handler. Case variants of the
  prefix do not dispatch (`case sensitive routing`). Dot segments and undecodable escapes are already 404'd by the
  CR-01 gate (`lib/requestPath.js`). An encoded slash (`<id>%2Fgrants`) matches the mount with id `<id>/grants`,
  which is not a member, so it gets the 404.
- The `/setup` inline T-11-13 check stays as defence in depth. The stale comment above the grants routes ("the
  deal-level anti-enumeration rule … does not apply to this admin/IL surface") now describes F-1.
- `GET /api/deals` (list) is unchanged: the rule's mount path needs an `:id` segment, so the bare list never matches.
  The suite checks that membership filtering and the per-role projection are unchanged.

## Route table (non-admin caller, deal A)

| Route | Role rule (gate, unchanged) | Before: non-member hrbp | After: non-member hrbp | Member hrbp | pmo / employee (member or not) | admin |
|---|---|---|---|---|---|---|
| `GET /api/deals/:id/grants` | read `LEAD_ROLES` + inline admin/hrbp | **200**, roster + clearance map | 404 `Deal not found.` | 200 | 403 role-read (id-independent) | 200 |
| `POST /api/deals/:id/grants` | write `admin,hrbp` | **200**, grant/revoke + full registry echo | 404 `Deal not found.` | 200 | 403 role-write | 200 |
| `POST /api/deals/:id/vdr-grants` | write `admin,hrbp` | **200**, permanent forged audit row | 404 `Deal not found.` | 200 | 403 role-write | 200 |
| `POST /api/deals/:id/setup` | write `admin,hrbp` | 404 (T-11-13 inline) | 404 (mount rule + inline) | 200 | 403 role-write | 200 |
| `POST /api/deals/:id/members` | write `admin,hrbp` + inline admin-only | 403 `Only admin…` (id-independent, no reach) | 404 `Deal not found.` | 403 (unchanged) | 403 role-write | 200 |
| `GET /api/deals` (list) | read ALL_ROLES (exact) | filtered + projected | unchanged | unchanged | unchanged | unchanged |
| `POST /api/deals/select`, `POST /api/deals/wizard/basics` | static siblings, above the rule | unchanged | unchanged | unchanged | unchanged | unchanged |

## Deviations from the brief (intent followed)
1. **The 404 body is `{"error":"Deal not found."}`, not `{"error":"Not found"}`.** The brief asked for "the SAME body
   the siblings use". `/setup` and every handler's missing-id branch send `Deal not found.`. The anti-enumeration
   property needs the refusal to be byte-identical to a missing deal, and the suite asserts exactly that.
2. **Non-member pmo/employee get the gate's existing 403, not a 404.** The consolidated gate's role check runs before
   any route. Returning 404 for these roles would mean moving a membership check into the gate ahead of the role
   checks. That would change the Phase 11 contract (`/setup` → 403 for pmo) and turn an audited, rate-limited
   role denial into an unaudited one. The 403 does not depend on the deal id, so it gives no oracle. The suite
   asserts the non-member response is byte-identical to (a) the same role's MEMBER response and (b) a missing deal
   id's response, and that A's registry row, sessions and audit rows do not change.
3. **The POST response projection is unchanged.** Only admin/hrbp can reach a POST, and they get the full record via
   `GET /api/deals` anyway (`lib/dealProjection.js`). The suite asserts each member POST echo (`grants`, `setup`) deep-equals
   the caller's `GET /api/deals` entry, and that the `vdr-grants` echo carries only the grant. Narrowing the echo to
   `{success, members}` (the reviewer's optional suggestion) is unnecessary now that a non-member never reaches the
   handler. No client reads `body.deal` from the grants POST (`public/js/admin.js` only checks `ok`), so it remains
   a possible future hardening.

## Tests — `test/deal-membership-control-plane.test.js` (new, isolated MA_* temp paths)
Deal A: hrbp `fm_il_a`, `fm_il_a2`, pmo `fm_pmo_a`, employee `fm_emp_a`. Deal B: hrbp/pmo/employee `*_b`. Also an
unbound hrbp `fm_il_c` and an admin who is not on A's members list.
- `F-1 inventory: every registered /api/deals/:id route is classified by this suite`
- `F-1 (a): a NON-MEMBER hrbp (bound elsewhere, unbound) gets the missing-deal 404 on every route — no state change, no audit row`
  (registry row, sessions bound to A, A's audit count AND the global audit count all unchanged; response identical to a missing id)
- `F-1 (b): a non-member pmo / employee gets the id-independent role refusal (identical to a member of the same role and to a missing id), A unchanged`
- `F-1 (c): the deal's own hrbp and an admin keep their documented statuses on every route`
- `F-1 (d): no spelling of the path lets a non-member hrbp reach a handler`: trailing slash, `%64`-encoded id,
  `%2F` encoded slash, upper-cased id, `/api/Deals`, `/API/deals`, upper-cased suffix, `/api//deals`, `/api/deals//`,
  raw `x/../`, `x/%2e%2e/`, and a `?id=<B>` query. Sent as exact bytes over `node:http`, so the client does no
  normalisation. Every case is refused 4xx, leaks nothing, changes nothing, and is identical to the same spelling with
  a missing id. The forms that reach the router get the fixed 404. Positive control: a member's encoded-id and
  trailing-slash GETs still return 200.
- `F-1 (e): an hrbp REMOVED from the deal loses all reach on the very next request` (the reviewer's offboarding scenario)
- `F-1 (f): a member's POST response carries nothing the caller cannot read via GET /api/deals; list semantics unchanged`

Red check: with the `server.js` hunk reverted, (a), (d) and (e) fail. With it applied, 7/7 pass. Related suites
(`dd-grants`, `dd-vdr`, `deal-registry`, `deal-settings-setup`, `read-policy-coverage`, `read-policy-matrix`,
`path-canonical-gate`, `no-get-mutates`, `session-identity-reread`) pass 78/78. No existing test needed changes.

## Class sweep (control-plane routes or deal-id inputs that skip the bind-time check)
| Surface | Deal id from | Rule found | Verdict |
|---|---|---|---|
| `/api/deals/:id*` (5 routes) | path | role only (except `/setup`) | **Fixed** (this task) |
| `POST /api/deals/select` | body `dealId` | inline `getDeal` + archived + `isDealMember` → uniform 403 | clean |
| `POST /api/admin/deals/:id/archive`, `DELETE /api/admin/deals/:id`, `GET /api/admin/deals/:id/audit`, `GET …/audit/export`, `POST …/audit/purge`, `POST …/audit/seal` | path | ROLE_WRITE_POLICY row 1 `{prefix:'/api/admin', roles:['admin']}` for every method (gate `requiresRoleCheck = isWrite \|\| isAdminPath(forms)`), plus ROLE_READ_POLICY `{prefix:'/api/admin', roles: ADMIN_ROLES}` | admin-only; admin = all deals by contract → clean |
| `GET /api/admin/audit?deal=` | query | same `/api/admin` rows | admin-only → clean |
| `/api/admin/users*`, `/api/auth/sessions*`, `/api/auth/change-password`, `/api/admin/download-zip` | — (username / session id, keyed by caller or admin-only) | — | not deal-scoped → n/a |
| Deal-DATA routes (`/api/dd`, `/api/org`, `/api/synergies`, …) | `req.dealContext.dealId` only (the resolver's bind-time membership check) | grep: no deal id read from body/query/params outside the rows above | clean |

No other non-member reach was confirmed. L-1 from the same review (`/api/admin/*` under `DEMO_OPEN=1`) belongs to a
different lane and was not touched.

## Docs owed (not edited here, per ownership)
- **DEPLOYMENT.md / security notes:** "Deal-management routes `/api/deals/:id/*` (grants, data-room grants, setup,
  membership) are refused to anyone who is not a member of that deal, with the same `404 Deal not found.` an unknown
  deal id gets. Admin can reach every deal. Removing an Integration Lead from a deal ends their access to that deal's
  clean-room configuration on their next request."
- **11-SECURITY.md / threat register:** T-11-13 now covers every `/api/deals/:id*` route through the mount-level rule
  (`server.js`, `app.use('/api/deals/:id', …)`), with evidence in `test/deal-membership-control-plane.test.js`. Record F-1
  as CLOSED in the milestone review follow-up.
- **ARCHITECTURE.md (control plane):** "new `/api/deals/<static>` routes must be registered above the membership
  rule; new `/api/deals/:id/*` routes inherit it."

## Verification
Gates ran in the isolated worktree (`.claude/worktrees/agent-aa451d92af4237f71`) against `mkdtemp` MA_* paths. No
server was started on the committed `data/*.db`. `git status --porcelain data/ public/sent_emails/` was empty at commit.

Full suite (`node --test`, backgrounded, logs ending `EXIT=<code>`; host load average ~120–165):
- Run 1 (fix only): `tests 1716, pass 1713, fail 2, skipped 1`, `EXIT=1`.
  - `deal-lifecycle (f)` was a real, intended behavior change: a NON-member hrbp's membership edit now gets 404,
    not 403. Amended in its own commit, asserting 404 + `Deal not found.` + membership unchanged. 6/6 alone.
  - `sanitize-html` WR-A06 was a wall-clock bound (139.7 ms against 100 ms) under load. 3/3 alone. This diff touches
    neither `lib/` nor `validators/`.
- Run 2 was killed by a signal at test 116, before finishing. Not a test result.
- **Run 3 (final, HEAD with the amendment): `# tests 1716 / # pass 1714 / # fail 1 / # skipped 1`, `EXIT=1`.** The one
  failure was `isolatedTask: a job past timeoutMs is terminated…`, the documented `cpu-isolation` load flake.
  Re-run alone: `cpu-isolation` 24/24 pass.

## Commits
- `677a3a2` fix(13-quick): F-1 deal-membership rule for every control-plane /api/deals/:id route
- `70a2150` test(13-quick): F-1 deal-lifecycle (f) - a non-member hrbp's membership edit is now the missing-deal 404
- this SUMMARY (docs commit)
