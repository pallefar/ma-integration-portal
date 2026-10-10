# Phase 11 — plan amendments (orchestrator, from the plan checker's warnings; BINDING for executors)

Applies on top of 11-01..11-08-PLAN.md. If a plan text conflicts with an amendment, the amendment wins.

1. **(11-01, 11-06) get-or-create window.** 11-01 must add an explicit read rule for `/api/employees/get-or-create`
   (all roles, exact, placed BEFORE the `/api/employees` rule) so the employee portal's profile call does not 403 between
   W1 and W2; 11-06 removes that rule when the route becomes a POST.
2. **(11-07) Hidden-control list additions.** Also hide/disable, keyed on `maCan('configWrite')`: public/js/pmo.js settings
   POSTs (demo-mode switcher ~140, custom-setup wizard ~1149, pmoCustomSetupComplete ~1351) and the AI-model download flow's
   `{browserModel}` POST in public/js/transitions.js (~3249); the pmo roster upload (~1340) follows the roster rule.
3. **(11-07) Chatbot roster call.** `getAcquisitionProgress` → `GET /api/employees` (transitions.js ~3622) is gated on
   `maCan('roster')` and returns a neutral message for roles without it (no "Roster is empty").
4. **(11-02 / 11-03) Merge safety in server.js.** 11-03 touches `GET /api/synergies` only if task enrichment exists there and
   must state the exact line boundary it owns; 11-02 owns the synergyStaleDays call site and the rollup region. If the regions
   are adjacent, 11-03 merges AFTER 11-02 (dispatch 11-02 first; the orchestrator merges in that order).
5. **(11-06) get-or-create scoping.** In real deals, for roles refused `/api/employees`, the route resolves ONLY the caller's
   own roster record (derive the id from the session identity; ignore a supplied `empId` that is not the caller's) or returns
   a minimal projection — a supplied `empId` must never return a colleague's full record.
6. **(11-08) denialAuditBounded.** Use a fresh account/route for the bounded-audit scenario (or assert ≤ 1 row per 60 s window
   AND a total that equals the probe count) — never "exactly one row" after other scenarios hit the same actor/route/reason.
7. **(11-04) Docs.** State the crash-loss of pending denial counts (accepted T-11-35) in DEPLOYMENT.md; add
   `depends_on: ["11-02"]` for the shared suites.
