---
phase: 03
slug: deal-isolation-audit-log-write-validation
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-08-02
---

# Phase 03 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time across all 6 PLAN.md `<threat_model>` blocks (36 entries).
> L1 short-circuit applied: threats_open 0 + plan-time register + ASVS 1 → no auditor spawn.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| repo working tree → git remote / release zips | runtime.db, audit.db, deals/*.db must never cross | MNPI, credentials, compliance history |
| browser session cookie → resolved database | Which physical MNPI store a request may touch | all deal data |
| session deal binding → deals/<id>.db handle | Membership enforced at bind time | deal workspace |
| env DEMO_OPEN → consolidated gate | Auth off must not mean isolation or validation off | gate semantics |
| deal-bound request → control.db account store | Deal connections structurally can't reach accounts | credentials, registry |
| demo mechanics (time-travel/XP) → deal data | Fabricated progress must never reach a real deal | deal integrity |
| request identity → audit row actor | Attribution must be server-resolved, never client-supplied | compliance record |
| deal deletion → audit store | The record outlives the thing it describes | compliance history |
| browser request body → stored blob → rendered DOM | Untrusted JSON in; rendered later elsewhere | XSS surface |

---

## Threat Register

All 36 plan-time threats. Status evidence = the named test in the register (suite 122/122, independently re-run by orchestrator 2026-08-02) plus live orchestrator evidence noted below.

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-03-01 | Info Disclosure | .gitignore / download-zip lists | critical | mitigate | Both lists exclude runtime.db*/audit.db*/deals/ before files existed; test/db-artifact-exclusion.test.js; `git ls-files data/` verified by phase verifier | closed |
| T-03-02 | Repudiation | audit_log rows | high | mitigate | RAISE(ABORT) no-update/no-delete triggers; test/db-file-layout.test.js | closed |
| T-03-03 | Tampering | dealDbPath() | high | mitigate | Throws on 7 malformed/traversal id variants; test/db-file-layout.test.js | closed |
| T-03-SC(01) | Tampering | zod install | high | mitigate | Blocking-human Package Legitimacy Gate; user-approved 2026-08-01 after orchestrator's independent registry re-verification; pinned 4.4.3, no postinstall | closed |
| T-03-04 | Info Disclosure | control.db committed | medium | accept | By design (D-07): scrypt-hashed demo creds only; first-run admin-secret rotation exists | closed (accepted) |
| T-03-05 | Tampering | runSplit/verifySplit | high | mitigate | Temp-path build + --verify union-parity gate; corrupted-output case in test/db-split-migration.test.js; orchestrator re-ran --verify live (exit 0) | closed |
| T-03-06 | Info Disclosure | secret settings fields | high | mitigate | SECRET_SETTINGS_FIELDS → gitignored runtime.db; test case (e); orchestrator grepped no secret values in committed files | closed |
| T-03-07 | Info Disclosure | createDealDatabase | high | mitigate | Allowlist-direction template-only seeding (D-06); test/deal-seed.test.js; UAT: new deal showed 0 employees live | closed |
| T-03-08 | Tampering | seeder path join | high | mitigate | dealDbPath() validation + refuse-overwrite | closed |
| T-03-09 | DoS | migration source handle | medium | mitigate | Read-only open; unchanged mtime/byte-length case; verified live after real run | closed |
| T-03-SC(02) | Tampering | installs | low | accept | No new package in plan | closed (accepted) |
| T-03-10 | Info Disclosure | resolveDatabase / conn cache | critical | mitigate | Bind-time membership refusal before any handle; no ATTACH; test/deal-resolver.test.js (a)-(e), test/deal-isolation.test.js | closed |
| T-03-11 | EoP | ~60 write endpoints | critical | mitigate | Bind-time refusal means no per-endpoint bug can reach another deal's file; test/deal-isolation.test.js (a) | closed |
| T-03-12 | Info Disclosure | isOpenMode(req) | critical | mitigate | `DEMO_OPEN==='1' && req.isDemo`; deal-bound session never open; test/deal-resolver.test.js | closed |
| T-03-13 | Spoofing | resolver failure path | high | mitigate | DealAccessError refusal, never silent demo downgrade; uniform 403 hardened post-review (WR-02 fix 8e7df78) | closed |
| T-03-14 | Tampering | time-travel/XP vs deals | high | mitigate | DEMO_ONLY_PREFIXES 403 + guarded scaling call sites; test/demo-only-gating.test.js | closed |
| T-03-15 | Info Disclosure | AsyncLocalStorage binding | high | mitigate | runWithDb() spans downstream chain; interleaved concurrency case green | closed |
| T-03-16 | EoP | controlStore isolation | high | mitigate | users out of request-bound inventory; test/deal-isolation.test.js (d) | closed |
| T-03-SC(03) | Tampering | installs | low | accept | node:async_hooks is core | closed (accepted) |
| T-03-17 | Info Disclosure | GET /api/deals | critical | mitigate | listDealsForUser() member-scoped; non-member refusal doesn't confirm existence; case (e); UAT live: employee got `[]` | closed |
| T-03-18 | EoP | POST /api/deals/select | critical | mitigate | Server-side membership re-check + independent bind-time check | closed |
| T-03-19 | EoP | deal creation | high | mitigate | ROLE_WRITE_POLICY admin+hrbp (D-02); case (f) | closed |
| T-03-20 | DoS/destruction | DELETE deal | high | mitigate | Admin-only + confirm=dealId destructive guard; case (b); UAT live: delete 400'd without confirm, 200 with | closed |
| T-03-21 | Repudiation | deleteDeal vs audit | high | mitigate | Delete path holds no audit reference; UAT live: 2 audit rows survived actual deletion | closed |
| T-03-22 | Tampering (XSS) | deal-switcher render | medium | mitigate | textContent discipline + CSP; write-time sanitization landed in Plan 06 | closed |
| T-03-23 | Tampering | half-created deal | medium | mitigate | Registry insert rolled back if provisioning throws | closed |
| T-03-SC(04) | Tampering | installs | low | accept | No new package | closed (accepted) |
| T-03-24 | Repudiation | audit actor | critical | mitigate | Actor from request-bound identity only; anonymous write throws; case (h) | closed |
| T-03-25 | Repudiation | audit_log rewrite | critical | mitigate | ABORT triggers + no write routes under audit path; cases (e)/(f) of audit-security-events | closed |
| T-03-26 | Repudiation | trail vs deletion | high | mitigate | Physically separate audit.db; case (g); UAT live-proven | closed |
| T-03-27 | Repudiation | post-commit window | medium | accept | Best-effort by design (D-09); loud failure surfacing; hash chaining deferred to v2; user approved at D-09 gate 2026-08-02 | closed (accepted) |
| T-03-28 | Info Disclosure | GET /api/admin/audit | high | mitigate | /api/admin prefix rule enforces admin for every method; case (c) | closed |
| T-03-29 | Info Disclosure | data/audit.db leak | high | mitigate | Gitignored + zip-excluded (Plan 01); test/db-artifact-exclusion.test.js | closed |
| T-03-30 | Tampering (XSS) | audit viewer | medium | mitigate | textContent-only cells; before/after shown as text; verified in review + live browser pass | closed |
| T-03-SC(05) | Tampering | installs | low | accept | No new package | closed (accepted) |
| T-03-31 | Tampering | validationMiddleware | high | mitigate | Strip-unknown zod schema per route, fail-closed for schema-less routes; write-validation-coverage test; post-review fix b8dde3c extends pipeline to DEMO_OPEN (orchestrator live-verified 400) | closed |
| T-03-32 | Tampering (stored XSS) | HTML-bearing fields | high | mitigate | Write-time sanitizeHtml on 3 schema-tagged fields + render-time textContent + CSP; test/xss-sanitization.test.js | closed |
| T-03-33 | DoS | unbounded strings | medium | mitigate | Explicit max on every string (incl. post-review fix of 2 in validators/deals.js); source check: zero unbounded z.string() | closed |
| T-03-34 | Info Disclosure | validation errors | medium | mitigate | Errors name paths/rules, never submitted values; case (a); orchestrator live-verified error shape | closed |
| T-03-35 | Info Disclosure | 400 body internals | low | mitigate | Single-string shape; zod issue objects/stacks never serialized | closed |
| T-03-36 | Tampering | sanitizer nested-tag class | medium | accept | Single-pass regex limitation shared with shipped client sanitizer; documented + tested as accepted (A1: no DOM-dependency parser in no-build-step app); CSP + textContent as compensating controls | closed (accepted) |
| T-03-SC(06) | Tampering | installs | low | accept | No new package | closed (accepted) |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-03-01 | T-03-04 | control.db committed by design (D-07) for zero-install boot; demo scrypt hashes only; first-run rotation available | User (D-07 discussion) | 2026-07-31 |
| AR-03-02 | T-03-27 | Best-effort post-commit audit semantics; 2PC + hash chaining deferred to shared-host milestone | User (D-09 gate via orchestrator) | 2026-08-02 |
| AR-03-03 | T-03-36 | Nested-tag-reconstruction survives single-pass regex sanitizer — same limitation as shipped client sanitizer; CSP + textContent compensate | Plan-time (03-RESEARCH A1), carried through review | 2026-08-02 |
| AR-03-04 | T-03-SC(02..06) | No new packages beyond gate-approved zod | Plan-time | 2026-08-01 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-02 | 36 | 36 (30 mitigated + 6 accepted) | 0 | orchestrator (L1 short-circuit; plan-time register; 122/122 suite + live evidence) |

Post-plan hardening included in this audit: code-review fixes 6f77e9f (CR-01), b8dde3c (CR-02 — DEMO_OPEN validation bypass closed), 97e1347 (WR-01), 8e7df78 (WR-02), c656422 (WR-03), all independently re-verified by the orchestrator.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
