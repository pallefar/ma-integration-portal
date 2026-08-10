# Phase 2: Mandatory Auth & Roles - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-24
**Phase:** 2-Mandatory Auth & Roles
**Areas discussed:** Mandatory vs open demo, Role model granularity, Session revocation model, Account management scope

---

## Mandatory vs open demo

| Option | Description | Selected |
|--------|-------------|----------|
| Fail-closed default + explicit demo-open | Auth mandatory by default; showcase runs in explicit demo-open mode; forward-compatible with Phase 3 (real-deal DB always auth, demo.db may be open) | ✓ |
| Auth always-on, even demo | Every mode requires login incl. showcase | |
| Mandatory only in real-deal mode | Demo fully open; auth only when bound to a real deal (but resolver is Phase 3 → open-by-default gap risk) | |

**User's choice:** Fail-closed default + explicit demo-open
**Notes:** MNPI-safe default (unauthorized read is the compliance event). Inverts today's "open unless PORTAL_AUTH=1". Demo bundles set the demo-open flag.

---

## Role model granularity (AUTH-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Coarse role→resource-group map | Existing roles (admin/IL/pmo/employee); one middleware; clean-room deferred to Phase 4 | ✓ |
| Per-resource fine-grained now | Specific per-endpoint permissions (overlaps Phase 4, built twice) | |
| Admin vs non-admin only | Keep today's coarse split (doesn't really deliver AUTH-02) | |

**User's choice:** Coarse role→resource-group map
**Notes:** Every write routed through one capability check; per-workstream/field-level clean-room explicitly deferred to Phase 4.

---

## Session revocation model (AUTH-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Sessions table: logout + admin-revoke-user | Opaque token → SQLite sessions row; logout deletes; admin revokes all for a user; absolute 12h expiry | ✓ |
| Per-device session list + sliding expiry | Also device list + individual revoke; activity-extended expiry (more UI/refresh scope) | |
| Keep stateless cookies + revocation list | Signed cookie + server-side blocklist (weaker/awkward) | |

**User's choice:** Sessions table: logout + admin-revoke-user
**Notes:** Today's HMAC cookie expires but can't be revoked; SQLite (Phase 1) makes a real store cheap. Gives Phase 3 audit a session identity.

---

## Account management scope

| Option | Description | Selected |
|--------|-------------|----------|
| Login + self password-change + first-run admin secret | Real-deal mode never ships on the known demo password; full user CRUD deferred | ✓ |
| Login-only against seeded users | Smallest; real-deal would run on demo password | |
| Full user CRUD admin UI now | Most complete; heavy UI scope for an auth phase | |

**User's choice:** Login + self password-change + first-run admin secret
**Notes:** Seeded demo accounts stay for demo mode; real-deal requires the first-run admin secret (fail-closed / warn if still on demo password).

---

## Claude's Discretion

- sessions table schema/indexing + opaque-token gen/lookup
- consolidating the two overlapping /api gate middlewares into one
- CSRF specifics beyond SameSite=Strict (research to recommend)
- demo-open flag name + how demo launchers set it
- first-run admin secret delivery (env vs forced-change-on-first-login)

## Deferred Ideas

- Clean-room / per-workstream field-level read filtering — Phase 4
- Auth-event audit logging — Phase 3 (AUD-01/02)
- Full user CRUD admin UI — later slice
- Per-device session list + sliding expiry — later
- TE SSO — v2 HOST-03
