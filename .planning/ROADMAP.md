# Roadmap: M&A Integration Portal

## Milestones

- ✅ **v2.1.0 — Real-Deal** — Phases 1–7 (shipped 2026-08-10)

## Phases

<details>
<summary>✅ v2.1.0 Real-Deal (Phases 1–7) — SHIPPED 2026-08-10</summary>

Turned the demo-shaped portal into a tool an Integration Lead runs a real TE
acquisition on, MNPI-grade. Foundation-first (SQLite → mandatory auth → deal
isolation/audit/validation) then four capability areas (DD workspace, synergy
value capture, org/talent design, IMO reporting/exports). Demo showcase
preserved. Suite 687/687. Full detail archived in
[`milestones/v2.1.0-ROADMAP.md`](milestones/v2.1.0-ROADMAP.md).

- [x] Phase 1: Schema & Migration (3/3 plans) — completed 2026-08-10 (Linux boot Docker-verified; Windows static-verified + release-confirm)
- [x] Phase 2: Mandatory Auth & Roles (3/3 plans) — completed 2026-07-31
- [x] Phase 3: Deal Isolation, Audit Log & Write Validation (6/6 plans) — completed 2026-08-02
- [x] Phase 4: Due Diligence Workspace (10/10 plans) — completed 2026-08-05
- [x] Phase 5: Synergy Value Capture (8/8 plans) — completed 2026-08-06
- [x] Phase 6: Org Design & Talent Retention (8/8 plans) — completed 2026-08-08
- [x] Phase 7: IMO Reporting & Exports (7/7 plans) — completed 2026-08-10

Gates at close: code review 0-crit (Phases 6–7), Fable verifier passed, per-phase
`/gsd-secure-phase` SECURED, plus a whole-codebase Fable 5 security review before
the release cut (found + fixed a cross-phase clean-room bypass and three XSS sinks).

</details>
