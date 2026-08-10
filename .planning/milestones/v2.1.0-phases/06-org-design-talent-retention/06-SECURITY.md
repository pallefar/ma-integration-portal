---
phase: 06-org-design-talent-retention
audited: 2026-08-08
status: verified
threats_open: 0
threats_total: 66
asvs_level: 1
block_on: high
auditor: gsd-security-auditor (Fable, per user directive 2026-08-08)
verdict: SECURED
---

# Phase 6 Security Audit — SECURED

**66/66 threats CLOSED** (65 numbered + T-06-SC ×8 registers, identical). Register authored at plan time across all 8 PLAN.md files; verify-mitigations mode with trust-but-verify — every critical/high mitigation opened at file:line by the auditor, not taken from reports. Suite at audit time: 561/561.

## Verdict summary by plan

| Plan | Threats | Status | Load-bearing evidence |
|------|---------|--------|----------------------|
| 06-01 spine/clearance/guards | T-06-01..08 | all CLOSED | hr-grant 403 BEFORE lane read (server.js:4008-4011); exact-match state ternary (4003-4005); positionGraphFailure on ALL THREE write paths (4077/4104/4354); org collections absent from DEAL_SEED_COLLECTIONS (db/dealSeed.js:31); zero markup sinks in org.js |
| 06-02 tree/switch/copy/delete | T-06-09..16 | all CLOSED | keys plain-assigned only in granted branches (4130-4137); switch structurally absent (org.js:1108-1112); per-switch server re-fetch — no combined payload client-side; delete refuses orphaning (4183-4196) |
| 06-03 import/link/orphan-guard | T-06-17..24 | all CLOSED | ORG_IMPORT_MAX_ROWS=500 validator-level; all-or-nothing (400 before ANY mutation, graph self-check over merged lane pre-write 4349-4358); orphan guard scans both states (5573-5581); no gamification keys on import |
| 06-04 decision register | T-06-25..32 | all CLOSED | isAdminOrIlRequest literal first statement (4438-4440); break-glass excluded (496-498 sessionId!==null); actor/time server-stamped, zod strips client fields; append-only — no update/delete route exists; three-copy anti-drift test |
| 06-05 flight-risk + dual audit | T-06-33..41 | all CLOSED | denial audited (4510-4513) AND successful read audited (4516-4519, no session dedupe); four-identity 201/201/403/403 write matrix; no polling (0 setInterval, source-level test) |
| 06-06 conversion + RAID filter | T-06-42..50 | all CLOSED | per-entry provenance filter (3913-3916); resolver checks WR-03 clearanceArea stamp FIRST (3891); no workstreamId inverse (rejected in-code 3864-3869); over-filter prevented — admin/manual entries proven returned (tests a/b); dedupe on stable source string |
| 06-07 rollup + deal-home | T-06-51..58 | all CLOSED | restricted key assigned only inside hasAreaGrant branch (4744-4790), server-computed only; section built on hasOwnProperty, tag-level distinction; nudge absent-never-zero (deal-home.js:381-385); summary route writes no audit event (asserted both sides) |
| 06-08 seed + walks | T-06-59..65 | all CLOSED | seed WAL-checkpointed + committed; only fictional employees referenced (verified live); clean-room proven at BOTH layers (raw body + USER-APPROVED live markup walk); showcase regression 11/11 vs 29-gauge baseline; idempotent allowlist-scoped re-seed |
| all plans, supply chain | T-06-SC | CLOSED (accept, basis verified) | `git diff --stat c7e6746..b6a30f0 -- package.json package-lock.json node_modules` EMPTY — zero dependency changes across the phase |

Full per-threat table with file:line evidence: auditor return, recorded verbatim in the orchestrator transcript 2026-08-08; spot-anchors above suffice for re-audit.

## Post-review hardening folded in (06-REVIEW.md, all resolved)

- WR-01: roster-validated `employeeId` on positions create+update (server.js:4068-4072, 4090-4094)
- WR-02: flight-risk owner defaults to session identity (server.js:4569, 4592) — proven live (5/5 stamped)
- WR-03: conversion-time `clearanceArea` stamping — **strengthened T-06-42/T-06-45 from declassify-on-delete (previously accepted) to fail-closed retention**; test flipped to prove retention, legacy fallback covered

## Accepted risks log

- T-06-SC (supply chain, ×8): accepted at plan time; acceptance basis re-verified true at audit (zero dependency changes in phase range).

## Notes

- Residual labelling inaccuracy, documented in-code and accepted (server.js:4500-4506): `recordSecurityEvent()` hardcodes `db_kind: 'control'` for deal-scoped flight-risk read events. Nothing filters on that column; the functional audit guarantee (who read the register, when, denial and success both) is intact. Candidate cleanup for the Phase-7/milestone security pass.
- No `## Threat Flags` sections existed in any SUMMARY (grep-confirmed); new attack surface that appeared during implementation was surfaced and resolved through 06-REVIEW.md instead. No unmapped surface remains.
