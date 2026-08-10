---
phase: 2
slug: mandatory-auth-roles
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-31
---

# Phase 2 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| browser → /api gate | Untrusted cookie/token crosses into the app; the gate is the sole authentication boundary | Session cookie, X-Admin-Token (MNPI-guarding credentials) |
| app → sessions table (SQLite file) | The .db file is an exfiltration target (backup, stolen laptop) | Session tokens (hashed at rest), usernames, roles |
| env (DEMO_OPEN) → gate | Operator/launcher misconfiguration can flip fail-closed to open | Deployment mode flag |
| session role → write authorization | The caller's server-side role decides whether a write proceeds | Role claims (server-resolved only) |
| X-Admin-Token → identity | Shared secret must resolve to an attributable identity, not an anonymous bypass | Break-glass admin credential |
| operator → admin credential | Real-deal must not run on the publicly-known demo password | Admin password |
| server 401 → client | Client must react to authRequired signal rather than render partial/stale data | Auth state signal |
| launcher env → server mode | The launcher decides demo-open vs fail-closed | DEMO_OPEN flag |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-02-01 | Spoofing / Elevation | consolidated /api gate | high | mitigate | Fail-closed default: no valid session ⇒ 401 (`authRequired:true`) on every /api route incl. reads (server.js gate); proven by test/auth-route-inventory.test.js live sweep + live UAT (curl 401, browser redirect) | closed |
| T-02-02 | Information Disclosure | sessions table at rest | high | mitigate | SHA-256 `token_hash` only, never the raw token (db/sessions.js:30,43,67); leaked .db cannot replay sessions; asserted in test/session-lifecycle.test.js | closed |
| T-02-03 | Spoofing (fixation / non-revocation) | session lifecycle | high | mitigate | Server-side revocable rows: logout deletes row (db/sessions.js:77), admin revoke-all (server.js:1639), absolute 12h expiry with lazy prune (server.js:355,467); asserted in session-lifecycle.test.js; hardened by WR-01 (revoke on password rotation, commit 71c654b) | closed |
| T-02-04 | Tampering (CSRF) | login cookie + gate | medium | mitigate | `SameSite=Strict` + `HttpOnly` on ma_session (server.js:365,377,439); no CORS headers; JSON-only writes | closed |
| T-02-05 | Information Disclosure (accidental open mode) | isOpenMode seam | high | mitigate | DEMO_OPEN is an explicit env opt-in, default fail-closed; named `isOpenMode(req)` seam for Phase-3 `&& req.isDemo` binding (server.js:139,160); WR-03 startup `[security]` warning (server.js:127-128, commit f54b784); proven live in both modes during UAT | closed |
| T-02-06 | Elevation of Privilege | gate write branch / ROLE_WRITE_POLICY | high | mitigate | Role read only from server-side `req.portalUser.role`, checked on every write; boundary-safe + method-scoped matching after CR-01 fix (commit bff4298); admin role required on /api/admin/* for EVERY method after CR-02 fix (commit 48dff92, server.js:303); proven by test/role-enforcement.test.js (incl. employee-403-on-assessment-DELETE and non-admin-403-on-download-zip regressions) | closed |
| T-02-07 | Elevation / silent-open on new endpoints | default-allow policy | medium | mitigate | Unlisted write prefixes default to `DEFAULT_WRITE_ROLES` (admin/hrbp/pmo) — never employee; safe-by-default for future endpoints | closed |
| T-02-08 | Repudiation (unattributed break-glass) | X-Admin-Token path | medium | mitigate | Attributed identity `{username:'admin-token', role:'admin'}` (server.js:278) for Phase-3 audit attribution (D-11) | closed |
| T-02-09 | Spoofing (credential exposure) | admin account credential | high | mitigate | First-run scripts/set-admin-password.js with loud D-10 warning when admin is still on the known demo password in a non-DEMO_OPEN deployment (set-admin-password.js:81-95); scrypt hashing preserved; change-password throttled (WR-02, commit 2ef543b) | closed |
| T-02-10 | Information Disclosure (stale/partial render) | transitions.js fetch wrapper | medium | mitigate | Deterministic per-request redirect to /login.html on any authRequired 401, reads included (transitions.js:37-47, commit 27cf729); proven live in UAT (no blank page, no login-loop) | closed |
| T-02-11 | Information Disclosure (demo-open on real deployment) | launcher DEMO_OPEN flag | high | mitigate | DEMO_OPEN set ONLY in demo-release launchers (start.command:30, start.bat:40); real-deal deployments stay fail-closed by default; WR-03 startup warning flags accidental carry-over; Phase 3 binds open-mode to the resolved DB (D-03) | closed |
| T-02-SC | Tampering (supply chain) | npm installs | low | accept | Phase introduces NO new packages (Node crypto + already-committed better-sqlite3 only); Package Legitimacy Gate N/A per 02-RESEARCH.md | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-02-01 | T-02-SC | No new dependencies introduced in this phase; supply-chain gate not applicable (documented in all 3 plan threat models) | plan-time disposition (all 3 PLANs) | 2026-07-24 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-31 | 12 | 12 | 0 | secure-phase L1 classification (orchestrator; short-circuit — register authored at plan time, all mitigations code-evidenced; post-code-review state incl. CR-01/CR-02 fixes) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-31
