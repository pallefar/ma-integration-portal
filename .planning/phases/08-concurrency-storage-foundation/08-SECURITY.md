---
phase: 8
slug: concurrency-storage-foundation
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-08-11
---

# Phase 8 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| HTTP client ↔ server | Browser fetch wrapper (retry/toast) to Express routes | MNPI deal writes, session tokens |
| Server ↔ SQLite files | writeDb/controlStore/auditHook against per-deal + control + audit DBs | MNPI records, audit rows |
| Process ↔ process | Multiple `node server.js` processes contending on shared SQLite files (Phase 8's new surface) | Write-lock signals (SQLITE_BUSY), committed rows |
| Soak harness ↔ scratch tree | scripts/soak.js spawns real servers over a mkdtemp scratch data dir | Synthetic load only — structurally isolated from `data/` |

---

## Threat Register

Register authored at plan time in the five `08-0N-PLAN.md` `<threat_model>` blocks; audited against commit `e26dd96` + `f9920cc` (includes review fixes `08aa58d`..`c781069`). The plan-time ID `T-08-02` named two distinct threats (08-01 vs 08-04) — persisted here as `T-08-02a` / `T-08-02b`, never merged.

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-08-01 | Info Disclosure | server.js 503 middleware | high | mitigate | Fixed literal body `{error:'Server is busy. Please try again.'}`; `isBusyError()` reads `err.code` only; `res.headersSent` guard (WR-04); live-contention body assertions in test/busy-503-contract.test.js (no SQLITE text/paths) | closed |
| T-08-01s | Info Disclosure | scripts/soak.js console | low | mitigate | Verdict output is ids/counts only; crash-path stack print contained by T-08-06 scratch isolation (residual noted in audit) | closed |
| T-08-02a | DoS | db/dbFiles.js busy_timeout | low | accept | D-04 accepted: sync busy-wait blocks the event loop ≤1s under contention; `busy_timeout=1000` asserted by test/db-file-layout.test.js | closed (accepted) |
| T-08-02b | DoS | transitions.js retry storm | medium | mitigate | Retry cap 2 (3 attempts), 300ms jitter on every wait; tests assert exactly 3 origFetch calls | closed |
| T-08-03 | DoS | audit no-swallow amplification | medium | accept | D-10 accepted: no try/catch around audit append; bound observed not assumed — soak reports refusal rate (0.03–0.3% in runs) | closed (accepted) |
| T-08-04 | Tampering | controlStore lost updates | high | mitigate | All 5 RMW functions + `createDealDeduped()` (WR-01/02) run SELECT inside `.immediate` lock; test/control-plane-serialization.test.js proves cross-process | closed |
| T-08-05 | Repudiation | audit-row loss | high | mitigate | STRENGTHENED (CR-01 fix `08aa58d`): audit append is the final step INSIDE writeDb()'s `.immediate` transaction — busy audit rolls the deal write back; soak reconciles audit↔acks 1:1 both directions, committedButUnaudited is a hard violation | closed |
| T-08-06 | Tampering | soak vs committed data/ | high | mitigate | mkdtemp scratch + all 5 MA_* dir overrides set before first require; proven empirically (wal-checkpoint + clean `git status data/`) | closed |
| T-08-07 | Tampering | concurrency test vs data/ | medium | mitigate | mkdtemp + overrides in test/concurrency-busy-retry.test.js; empirically clean | closed |
| T-08-08 | Tampering | control-plane test vs control.db | medium | mitigate | mkdtemp + overrides in test/control-plane-serialization.test.js; empirically clean | closed |
| T-08-09 | DoS | catch sites swallowing contention | medium | mitigate | 9 guarded catch sites; permanent brace-depth coverage gate over live source asserts zero violations; server.js verified as the only route-registering file | closed |
| T-08-10 | DoS | async unforwarded rejections | medium | mitigate | `next(e)`/`.catch(next)` on all async write handlers; structural gate in busy-503-contract test | closed |
| T-08-11 | Tampering | provisioning rollback vs busy re-throw | high | mitigate | `deleteDeal()` compensation runs before the busy re-throw (server.js:820-826) | closed |
| T-08-12 | DoS | Retry-After parse bounds | low | mitigate | Parse + fallback existed; CLOSED fully by `f9920cc`: `Math.min(seconds, 60)` clamp + test asserting scheduled wait ∈ [60000, 60300]ms for `Retry-After: 999999` | closed |
| T-08-13 | Tampering | give-up toast DOM sink | medium | mitigate | `textContent` only — exactly one DOM write in the wrapper region, zero innerHTML/insertAdjacentHTML/eval; client-xss-sinks test green | closed |
| T-08-14 | Repudiation | silent retry masks failure | high | mitigate | Give-up toast fires on exhaustion AND non-retryable body; "not saved" wording; no navigation/clear; user-confirmed live (08-UAT.md tests 2–3) | closed |
| T-08-15 | DoS | orphaned soak workers | low | mitigate | `finally` → stopChild for every spawned child; SIGTERM → 5s → SIGKILL | closed |
| T-08-SC | Tampering | npm supply chain | low | accept | Phase's only package.json change is the `soak` script line; dependency set unchanged — verified empirically | closed (accepted) |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-08-01 | T-08-02a | D-04 (discuss-phase, all recs accepted): sync busy-wait blocks that process's event loop up to ~1s under contention — rare and bounded at 15-person scale; async rewrite would touch ~90 call sites and introduce a missed-await silent-ack bug class | Karsten (D-04, 2026-08-10) | 2026-08-11 |
| AR-08-02 | T-08-03 | D-10 (discuss-phase): audit no-swallow is the MNPI compliance invariant; the amplification bound is observed in every soak run (refusal rate reported), not assumed | Karsten (D-10, 2026-08-10) | 2026-08-11 |
| AR-08-03 | T-08-SC | Zero new dependencies this phase; only a script line added to package.json — supply-chain delta verified empty by audit | Security audit (Opus) | 2026-08-11 |
| AR-08-04 | IN-01 (review) | Soak BASE_PORT pid%400 collision window accepted as documented in scripts/soak.js's own comment — single-host manual runs only | Code review disposition | 2026-08-11 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-11 | 17 | 16 (+1 low partial) | 0 blocking | gsd-security-auditor (Opus, ASVS L1, verify-mitigations mode) |
| 2026-08-11 | 17 | 17 | 0 | Orchestrator: T-08-12 partial closed via clamp fix `f9920cc` (60s ceiling + test), suite 704/704 |

Audit-noted informational observations (not registered threats): `login.html` is the one page without the retry wrapper — no silent retry exists there to mask failure (T-08-14 vector absent), UX-only; soak crash-path stack print is contained by scratch-tree isolation. Register-hygiene: executor SUMMARYs carried no `## Threat Flags` section (template did not emit it) — absence is template behavior, not evidence.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-11
