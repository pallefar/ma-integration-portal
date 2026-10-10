---
phase: 11-authorization-clean-room-closure
plan: 05
subsystem: auth
tags: [authorization, personal-data, pulses, notifications, read-policy, clean-room, express, node-test]

requires:
  - phase: 11-authorization-clean-room-closure
    provides: "11-01 lib/readPolicy.js (roleAllowedForRead, ROLE_READ_POLICY) and test/helpers/deal-fixture.js"
provides:
  - "lib/pulseView.js: pulsesFor(role, username, pulses) projection"
  - "POST /api/pulses stamps authorUsername from the session (never the body)"
  - "GET /api/pulses role-aware in real deals; demo store untouched"
  - "GET /api/notifications withholds task/RAID nudges from roles the read matrix refuses those lanes"
  - "test/personal-data-reads.test.js (role x pulse visibility, author stamp, notifications, demo controls)"
affects: [11-07, 11-08]

actuals:
  tokens: 7500
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "pure per-role projection module applied only when req.isDemo !== true"
    - "derived-count feeds gated by the same ROLE_READ_POLICY verdict as the lane routes (no second role list)"

key-files:
  created:
    - lib/pulseView.js
    - test/personal-data-reads.test.js
  modified:
    - server.js
    - public/js/dashboard.js
    - test/read-policy-matrix.test.js

key-decisions:
  - "Strict reading of D-11-06 + acceptance 1: pmo gets own pulses in full plus aggregate rows (rating/type/day); employee gets only its own; admin/hrbp everything"
  - "Unknown or missing role is own-only (fail-closed) rather than aggregate; today the only roles are admin/hrbp/pmo/employee so behaviour matches the plan"
  - "Aggregate rows are sorted by day, rating, then type (type tiebreak added so ordering is fully deterministic and carries no submission order)"
  - "Legacy pulses without authorUsername are never 'own' for anybody (a missing username never matches a missing author)"

patterns-established:
  - "Adding a personal-data feed: stamp authorship from req.portalUser at write time, project by role at read time, leave the demo store unprojected"

requirements-completed: [AUTHZ-01]

duration: 25min
completed: 2026-10-10
status: complete
---

# Phase 11 Plan 05: Personal data reads (role-aware pulses + honest notifications) Summary

**Named pulse ratings/comments now reach only admin/hrbp and each pulse's session-stamped author in a real deal (pmo gets rating/type/day aggregate rows, employee only its own), and the notifications feed no longer hands an employee task or RAID counts the read matrix refuses, with the demo store byte-identical for every role.**

## Performance

- **Tasks:** 2 completed (1 tracer, 1 auto/tdd)
- **Files:** 2 created, 3 modified
- **Suite:** 1097/1097 green at the final commit (base 1088; +9 new tests; 0 failures at either commit)

## Accomplishments

- `lib/pulseView.js` — `pulsesFor(role, username, pulses)`: admin/hrbp unchanged; pmo = own (full) + one aggregate row per other pulse with exactly `rating`, `type`, `day`, re-sorted by day/rating/type so submission order and time of day cannot re-identify an author; everyone else = own only. Pure, never mutates its input. `[security]` header documents R1-15 and the re-identification reasoning.
- `POST /api/pulses` stores `authorUsername: req.portalUser ? req.portalUser.username : null`; the body is never read for it (zod strips it, and the handler destructures explicitly).
- `GET /api/pulses` projects through `pulsesFor` only when `req.isDemo !== true`; a real-deal request with no identity resolves to an empty list (fail-closed). The demo branch is the original expression, untouched.
- `GET /api/notifications` computes `strict = req.isDemo !== true && req.portalUser` and emits `tasks_overdue`/`tasks_blocked` only when `roleAllowedForRead(role, '/api/integration-tasks')` and `raid_high` only when `roleAllowedForRead(role, '/api/raid')`. The T-ERM-08 comment is kept and extended. Assessment nudges are untouched.
- Tracer proven end to end first (employee A sees only its own, pmo own + 3 aggregates, hrbp/admin all 4, legacy pulse never own) before the notifications task.

## Task Commits

1. **Task 1 (tracer): role-aware pulses + session-stamped authorship** — `e9b7f5a`
2. **Task 2: notifications honour the read matrix** — `e2d425d`

## Tracer gate

Per the dispatch's gate policy no interactive human-verify checkpoint was raised. The tracer's automated verify (`node --test test/personal-data-reads.test.js test/read-policy-matrix.test.js`) was run end to end and passed (12/12), and the full suite passed (1094/1094) before the expansion task.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 2 - Missing critical functionality] Dashboard pulse feed renders aggregate rows**
- **Found during:** Task 1 (consumer audit of `/api/pulses`)
- **Issue:** `public/js/dashboard.js` rendered each pulse with `new Date(p.timestamp)` and `escapeHtml(p.employeeName)`. A real-deal pmo now receives aggregate rows with no `timestamp`/`employeeName`, which would render "Invalid Date" and a blank name header. No other plan in this phase touches that file (11-07's plan has no pulse rule).
- **Fix:** two one-line fallbacks: `new Date(p.timestamp || p.day)` and `p.employeeName || 'Anonymous'`. `public/dashboard.html`'s inline feed already tolerates both (`'Anonymous'`, `ts` empty). Showcase output is unchanged because demo pulses always carry both fields.
- **Files:** public/js/dashboard.js — **Commit:** `e9b7f5a`

### Judgment calls

**2. Unknown role is own-only, not aggregate.** The plan text says "pmo (and any other non-lead role) -> own followed by aggregate rows". Only four roles exist, so this is behaviour-neutral today; an unrecognised or missing role getting the aggregate feed would be a fail-open default, so aggregate is granted to `pmo` explicitly.

**3. Aggregate sort has a `type` tiebreak** beyond the plan's "day then rating", to make ordering fully deterministic (identical-key rows would otherwise keep submission order via sort stability).

**4. `test/notifications-clock.test.js` not changed.** Every real-deal assertion there runs as `admin`, which keeps all three nudges, so no switch was needed (the plan allowed this).

## Hand-off notes for later plans

- 11-07 (client capability hiding): the notifications nudge types `tasks_overdue`/`tasks_blocked`/`raid_high` have no client consumer keyed on type string (grepped), so an employee receiving none needs no client change. Pulse consumers (`public/js/dashboard.js`, `public/dashboard.html`, `public/js/assessments.js`) all tolerate aggregate rows now; `assessments.js` only reads `rating`/`type` of pulses.
- Stored pulses now carry `authorUsername` (plan 11-04's reversibility note: the projection is reversible, the stored field stays). Legacy author-less pulses are admin/hrbp-full and pmo-aggregate only.
- `readPolicy.js`'s `/api/integration-tasks` `why` text mentions the employee portal reading its own tasks via "the clearance-filtered notifications nudge"; after this plan an employee receives no task nudge in a real deal (per D-11-01 and the plan). The text is stale and is a candidate for a wording touch when 11-07/11-08 next edit that file (not changed here: out of this plan's file list).

## Known Stubs

None.

## Threat Flags

None - the change only restricts existing reads and adds one server-stamped field; no new endpoint, auth path or schema.

## Threat model status

| Threat | Disposition | Status |
|--------|-------------|--------|
| T-11-40 named pulse ratings/comments | mitigate | `pulsesFor` projection in real deals, proven per role x pulse |
| T-11-41 forged authorship | mitigate | `authorUsername` from the session only; forged body value stored as the caller's own name, proven live |
| T-11-42 re-identification from aggregates | mitigate | aggregate rows carry rating/type/day only, sorted day/rating/type; asserted by exact key set and absence of names/usernames in the pmo body |
| T-11-43 task/RAID counts via notifications | mitigate | nudges gated by `roleAllowedForRead` on the lane's own path |
| T-11-44 demo regression | mitigate | demo branch untouched; byte-identical pulses and notifications across roles asserted |

## Self-Check: PASSED

- lib/pulseView.js, test/personal-data-reads.test.js present; server.js, public/js/dashboard.js, test/read-policy-matrix.test.js modified
- commits `e9b7f5a`, `e2d425d` present on the worktree branch
- `grep -c "roleAllowedForRead(req.portalUser.role, '/api/raid')" server.js` = 1; `pulsesFor(` and `authorUsername` present in server.js
- no STATE.md / ROADMAP.md / data/*.db / public/sent_emails changes
