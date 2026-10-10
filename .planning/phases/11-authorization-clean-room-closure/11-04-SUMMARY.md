---
phase: 11-authorization-clean-room-closure
plan: 04
subsystem: auth
tags: [authz, audit, rate-limit, denial-audit, append-only, express, node-test]

requires:
  - phase: 11-authorization-clean-room-closure (11-01, 11-03)
    provides: "consolidated gate read policy, req.gatePathCanonical, RecordNotFoundError central 404 branch"
provides:
  - "lib/denialAudit.js: createDenialAuditor({windowMs,maxKeys,now,write,templateFor}) -> {record,sweep,flushAll,size,startSweeper,stopSweeper}"
  - "server.js: denialAuditor singleton (app.denialAuditor), recordDenial()/denyAt(), route-template resolver over the registered /api layers"
  - "access-denied security events for gate 401/403, resolver 403, grants inline 403, clearance-404 and credential-lockdown 403"
  - "optional onDenied hooks on dealResolverMiddleware and lockdownMiddleware (both modules stay audit-free)"
  - "test/denial-audit.test.js (23 tests) incl. a static guard that every server-loading suite isolates the audit db"
affects: [11-08 route-inventory/denial scenarios, DEPLOYMENT.md matrix docs]

actuals:
  tokens: 14960   # chars/4 over the realized diff vs base e18e19f (59,840 chars)
  tasks: 3
  commits: 4

key-files:
  created:
    - lib/denialAudit.js
    - test/denial-audit.test.js
  modified:
    - server.js
    - db/resolver.js
    - lib/credentialLockdown.js
    - DEPLOYMENT.md
    - test/auth-route-inventory.test.js
    - test/deal-lifecycle.test.js
    - test/deal-registry.test.js
    - test/deal-resolver.test.js
    - test/demo-only-gating.test.js
    - test/role-enforcement.test.js
    - test/xss-sanitization.test.js
    - test/write-validation.test.js
    - test/rag-upload.test.js

key-decisions:
  - "Counter lives in memory per window and is written as the NEXT row: audit_log has UPDATE/DELETE RAISE(ABORT) triggers (AUD-02), so the PRD's 'increment the same row' cannot be implemented literally"
  - "Keys are actor|method|route-TEMPLATE|reason; route template resolved with layer.regexp.test over app._router.stack (method-aware), never layer.match()"
  - "Anonymous actor is '(anonymous)' with role '(anonymous)' because audit_log.actor_role is NOT NULL"
  - "A busy audit.db is not swallowed anywhere in the denial path (refusal becomes the central 503); pending counts survive a failed write"

requirements-completed: [AUTHZ-05]

duration: ~1h30
completed: 2026-10-10
status: complete
---

# Phase 11 Plan 04: Rate-bounded denial audit Summary

**Every 401/403 from the consolidated /api gate and the deal resolver, the grants inline 403, the credential lockdown and every clearance-404 is now an `access-denied` security event naming actor, canonical route template, method and reason, bounded to at most one audit row per actor+method+route+reason per 60 s, with folded denials counted and written as the next row.**

## Performance

- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 auto)
- **Commits:** 4 (3 task commits + docs). Suite green at each: 1122 (tracer), 1132, 1133, 1134
- **Final full suite:** `node --test` -> **1134 tests, 1134 pass, 0 fail** (base 1111; +23 new)

## Accomplishments

- `lib/denialAudit.js`: pure, clock-injectable, no SQL of its own (the writer is injected). First denial of a key writes `{count:1}` immediately and opens a window; denials in the window only increment an in-memory counter; at expiry the folded count is written ONCE as `{count:n, folded:true}` and a new window opens, so the 1-row-per-window bound holds for the whole run and no count is lost while the process lives. Key map capped at 5000 with per-reason `(overflow)` folding; idle keys evicted by `sweep()`; an unref'd interval started lazily on first record.
- Tracer proven end to end: anonymous `GET /api/synergies` x5 -> 401 x5 (body byte-identical) -> exactly one row (actor `(anonymous)`, reason `no-session`, count 1), and `flushAll()` writes the 4 folded denials as one more row.
- Every refusal reason live-proven with a row and an unchanged response: `no-session` 401, `must-change-password`, `demo-only`, `role-write`, `role-read`, `deal-access` (resolver, records the deal the session was bound to), `clearance-404` (only `err.reason === 'clearance'`; missing ids are never recorded and never counted), `credential-lockdown`.
- Variant spellings (`/api/Synergies`, `/api/synergies/`, `/api//synergies`) are ONE key under the canonical route `GET /api/synergies`; random ids on `DELETE /api/raid/:id` share one key.
- 60 mixed denials across 3 templates produced exactly 3 rows in the window; totals reconcile to 60 after flush.
- Suite isolation: 8 server-loading suites now set `MA_AUDIT_DB_PATH` to a temp file; a static guard in `denial-audit.test.js` fails the build if any test file that requires `server.js` does not.

## Task Commits

1. **Task 1 (tracer): auditor + gate/resolver/404/lockdown wiring + tracer tests** - `98dc8d5`
2. **Task 2: live rows for every denial reason** - `8127a1a`
3. **Task 3: audit-db isolation of denial-triggering suites + static guard** - `f34fd3a`
4. **Docs: DEPLOYMENT.md denial-audit section (amendment 7)** - `35e4f57`

## Decisions and Findings (requested by the plan)

### D-11-05 adaptation to AUD-02

The PRD wording "an incrementing counter in the same row's detail" is impossible: `db/audit-schema.sql` has `audit_log_no_update` / `audit_log_no_delete` triggers (AUD-02). The counter is held in memory per window and written as the key's next row. The bound and the counter are both preserved without touching the append-only invariant. `lib/denialAudit.js` contains no `UPDATE`, no `DELETE FROM`, no `.prepare(`/`.exec(` (asserted by a test; comments may name the trigger).

### Lockdown finding

`lockdownMiddleware` answers **403** (deliberately never 503 — plan 10 says the client silently retries 503 writes, which would hide the condition) for every non-allowlisted path while the lockdown is active, for `/api/*` as JSON and for pages as fixed HTML. It is therefore a denial and is recorded as `credential-lockdown` (anonymous: no identity exists before that middleware) through the same auditor. `lib/credentialLockdown.js` gained an optional second parameter `onDenied(req, status)`; it still has no audit dependency. Note `lib/credentialLockdown.js` is not in the plan's `files_modified` — this is the minimal seam the plan's behaviour row requires.

### Suite isolation measurement (Task 3)

| Measure | `access-denied` rows in default `data/audit.db` |
|---|---|
| Before (clean worktree, file absent) | 0 |
| After tracer commit, full suite, 8 suites un-isolated | **15** (deal-lifecycle, deal-registry, deal-resolver, demo-only-gating, role-enforcement, +1 revoke-sessions probe) |
| After Task 3, full suite | **0** (file not created by any denial) — delta 0 |

Suites changed: demo-only-gating, deal-lifecycle, deal-registry, deal-resolver, role-enforcement, xss-sanitization, rag-upload, write-validation (each already had a temp control/runtime/demo/deals block; only `MA_AUDIT_DB_PATH` was added). `auth-route-inventory` got the full MA_* temp block (it used none). `audit-security-events.test.js` needed no change (its own temp audit db; no exact-count assertion saw denial rows). `deal-wizard-page` and `write-validation-coverage` only inspect the route table and are explicitly allow-listed in the guard.

## Deviations from Plan

### Judgment calls

**1. [Tracer gate] No interactive human-verify checkpoint after the tracer commit.** Per the dispatch's tracer policy: re-ran the tracer `<verify>` end to end (`node --test test/denial-audit.test.js test/auth-route-inventory.test.js`, then the full suite 1122/1122) before expanding. Passed.

**2. [Commit granularity] The Task-2 server/resolver wiring landed in the tracer commit `98dc8d5`.** I wired every refusal in one pass while the gate was open; Task 2's commit `8127a1a` therefore carries the live tests only. The behaviour per task is unchanged; the suite was green at every commit.

### Auto-fixed / auto-added

**3. [Rule 3 - blocking] `audit_log.actor_role` is NOT NULL.** `recordSecurityEvent` writes `actor.role || null`, so an anonymous row would have violated the constraint. Anonymous denials carry role `'(anonymous)'` (username `'(anonymous)'`); overflow rows carry `'(overflow)'`. Found by the plan's own key naming, before any run.

**4. [Rule 2 - correctness] Method-aware template resolution.** The plan's `templateFor(path)` matched any `/api` layer. A `DELETE` on a path whose first registered layer is a `GET` would have reported the wrong template. `templateFor(canonicalPath, method)` prefers a layer that registers the method (HEAD -> GET), falling back to any matching layer, then `(unrouted)`.

**5. [Rule 2 - hardening] Path/length bounds.** The recorded `path` and `request.path` are clipped to 256 chars (the key already uses the template; only the stored detail could carry attacker-length text).

### Plan text vs reality

- `lockdownMiddleware` and `dealResolverMiddleware` both got a trailing optional callback (as the plan specified for the resolver; the lockdown seam is the same pattern).
- `denialAuditor` is exposed as `app.denialAuditor` rather than via `module.exports` (keeps the shared module.exports tail untouched for the parallel 11-06 merge).
- The plan's `role-inline` row (`GET /api/deals/:id/grants` inline 403) is HTTP-unreachable by design (the read policy already refuses `/api/deals/*` for non-admin/hrbp at the gate as `role-read`), so it is proven structurally, not live.
- Amendment 6: every live scenario uses its own account/route/reason, never "exactly one row" after another scenario on the same key. Amendment 7: documented in DEPLOYMENT.md; `depends_on: ["11-02"]` was NOT edited into the PLAN.md frontmatter (orchestrator metadata, plan already in flight; 11-02 is merged in the base anyway).

## Accepted residuals (documented)

- **Pending counts lost on process exit.** Held in memory until the window ends; a crash or graceful restart loses the not-yet-written folded counts of the current window (first denial of every window is always durable). No shutdown flush was added because that region (end of `server.js`) is outside the regions this plan claimed in the parallel wave; `denialAuditor.flushAll()` exists and is a one-line hook for a follow-up. Documented in DEPLOYMENT.md (T-11-35 accepted).
- **Handler-level defence-in-depth 403s are not audited** (`refuseNonAdmin`, `refuseCommittedControlWrite`, the Phase 4/6 inline checks that keep their own `dd-*/org-*-access-denied` events, the `POST /api/deals/select` non-member 403). The gate in front of them is the control and is audited; the plan scoped denial audit to the gate, resolver, grants inline 403 and clearance-404.
- **Ambiguous-spelling 404** from the gate (dot segments, undecodable escapes) is not recorded: not a 401/403 and not a clearance 404.
- **Per-process bound** under multi-process deployments (T-11-35 accept).

## Known Stubs

None.

## Threat Flags

None. The new surface is audit-write only; the two new optional callbacks do not add endpoints or auth paths. Threat register: T-11-30 (flooding) mitigated by the window bound + template keys + key cap, T-11-31 (unrecorded denials) mitigated, T-11-32 (map growth) mitigated by `maxKeys` + idle eviction + unref'd timer, T-11-33 (row mutation) mitigated by no-SQL module + untouched triggers, T-11-34 (rows carrying bodies) mitigated (template, canonical path, method, reason, counts, requestMeta only), T-11-35/36 accepted as planned.

## Self-Check: PASSED

- FOUND: lib/denialAudit.js, test/denial-audit.test.js, DEPLOYMENT.md "Denial audit" section
- FOUND commits: 98dc8d5, 8127a1a, f34fd3a, 35e4f57 on the worktree branch
- `grep -c "denyAt(req, res" server.js` = 7 (>= 6); `grep -c onDenied db/resolver.js` = 2 (>= 2)
- `git status --porcelain data/` empty; no STATE.md / ROADMAP.md / public/sent_emails changes
- Full suite: 1134 tests, 1134 pass, 0 fail
