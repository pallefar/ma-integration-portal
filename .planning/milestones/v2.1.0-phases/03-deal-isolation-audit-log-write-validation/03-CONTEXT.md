# Phase 3: Deal Isolation, Audit Log & Write Validation - Context

**Gathered:** 2026-07-31
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase makes "real data never shares a store with demo" true in code. It delivers: (1) the physical split of `data/ma-portal.db` into `control.db` + `demo.db` + `deals/<id>.db` (ISO-01); (2) a request→database resolver that binds every request to exactly one database before any handler runs, replacing the `demoMode`-flag + shadow-array (`customEmployees` etc.) + `snapshotCms`/stash mechanism (ISO-03); (3) hard-gating of demo-only mechanics (time-travel, XP/leaderboards) to `demo.db` only (ISO-02); (4) an append-only audit log with who/what/when/before-after on deal and control-plane writes (AUD-01/AUD-02); (5) schema validation and XSS sanitization on every write endpoint (VAL-01/VAL-02).

NOT in this phase: field-level clean-room access control (Phase 4), DD/synergy/org data models (Phases 4-6), reporting/exports (Phase 7).

</domain>

<decisions>
## Implementation Decisions

### Deal lifecycle & switching
- **D-01:** The resolver is **session-bound**: each logged-in user selects a deal; the selection is stored server-side on their Phase-2 sessions-table row (new deal column). Demo requests resolve to `demo.db`. No global "active deal", no URL rewrite of the frontend. — **Reversibility:** costly — moving to URL-scoped deals later touches every frontend fetch path; moving to a global switch would be a multi-user safety regression.
- **D-02:** **Deal creation: admin + hrbp (Integration Lead). Deal deletion/archival: admin-only**, destructive-guarded, with the audit trail retained per AUD-02.
- **D-03:** **Per-deal member list** (username allowlist stored in the control DB). The resolver refuses to bind a session to a deal the user is not a member of; admin is always allowed. This is coarse need-to-know now — field-level clean-room lands in Phase 4 on top of it.
- **D-04:** UI this phase = a **small header/sidebar deal switcher** (visible to deal members) plus a **minimal create-deal form** (name, target company, members) — deliberately separate from the demo Projects UI so the two modes never blur visually.

### Existing data's fate (migration split)
- **D-05:** **Everything demo-flavored goes to `demo.db`** — including the Custom-M&A shadow lane (it was always showcase data). Users/settings/deal-registry go to the control DB. **A new real deal always starts with zero demo-derived rows.** — **Reversibility:** one-way — once the split migration runs and ma-portal.db is archived, re-interleaving the stores would require a reverse migration; also a compliance stance (nothing demo-tainted may pre-seed an MNPI store).
- **D-06:** A new `deals/<id>.db` is seeded with **templates only**: same schema as demo plus `checklistTemplates` (34-task/8-workstream), `assessmentTemplates`, `processCatalog`, and `i18n` strings. No demo employees, projects, pulses, XP, or CMS showcase content.
- **D-07:** Git/zip policy (user initially chose committing demo+control wholesale; after the sessions-churn consequence was surfaced, settled on the split): **commit `demo.db` and a near-static `control.db`** (demo user accounts, settings, deal-registry skeleton) so zero-install keeps booting with pre-seeded accounts; **live sessions and other churning runtime rows move to a gitignored `runtime.db`**; **`deals/*.db` are gitignored AND excluded from the admin download-zip.** No MNPI, live session, or real-credential rows can ever reach git or a release zip. — **Reversibility:** costly — undoing means either re-merging sessions into a committed file (leak + churn regression) or breaking the zero-install boot story.

### Audit log scope & access
- **D-08:** Audit **every write to any `deals/<id>.db` PLUS control-plane security events**: deal create/delete/archive, membership changes, user/role/password changes, session revocations, and every X-Admin-Token (break-glass) use. Demo writes are NOT audited (noise, no compliance value).
- **D-09:** Audit rows live in a **dedicated central append-only `audit.db`** — gitignored, zip-excluded, physically outside every deal file, so AUD-02 (survives deal deletion) holds by construction. — **Reversibility:** one-way — the audit trail is a compliance record; relocating it later must not lose or rewrite history.
- **D-10:** **Admin-only audit viewer this phase**: a small filterable table in the admin console (filter by deal, user, date range). Deal-scoped IL views are deferred.
- **D-11:** Each entry stores **full before/after row JSON snapshots** (plus who/what/when/deal-id) — self-contained compliance reconstruction, fits the blob-per-row schema.

### Validation strictness
- **D-12:** Use **zod** for schema validation across the ~60 write endpoints. Pure-JS, no native code; goes through the Package Legitimacy Gate and is committed to node_modules like better-sqlite3 was (zero-install preserved). Schemas are a reusable asset for Phases 4-7's new write models.
- **D-13:** **Strip unknown fields, reject invalid ones**: unknown keys are silently dropped (nothing unvetted reaches the stored blob); wrong types, missing required fields, and over-length values reject with a clear 400 (VAL-01's "clear error").
- **D-14:** **One validation pipeline, same rules in demo and deal mode.** Schemas are derived from the payloads the existing UI actually sends, so the showcase keeps working and permanently regression-tests the exact rules real deals rely on.
- **D-15:** XSS (VAL-02) closed from **both ends**: schemas tag which fields may carry HTML — those are sanitized at write time (script/event-handler stripping); all other fields are stored as plain text; the existing textContent-on-render discipline stays in place.

### Claude's Discretion
- Audit capture mechanism (SQLite triggers vs middleware wrapper vs store-layer hook) — research recommended triggers + a one-row actor table stamped by middleware; planner decides against the current db/store.js shape.
- Exact control-DB vs runtime-DB table split beyond "sessions + churning runtime rows leave the committed file".
- Deal id format, `deals/` directory layout, WAL/backup handling per deal file.
- Migration script mechanics — expected to follow Phase 1's precedent (re-runnable, `--verify` parity gate, archive the source read-only after green).
- How demo-only endpoints (time-travel, XP scaling) are hard-gated (route guard vs resolver-level refusal) — success criterion 2 defines the observable behavior.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase contract
- `.planning/ROADMAP.md` §Phase 3 — goal, 5 success criteria (esp. #1 one-DB-per-request, #2 demo-mechanic gating, #5 XSS round-trip)
- `.planning/REQUIREMENTS.md` — ISO-01..03, AUD-01..02, VAL-01..02 definitions

### Prior-phase seams this phase must consume
- `.planning/phases/02-mandatory-auth-roles/02-CONTEXT.md` — D-03 (bind `isOpenMode(req)` to `&& req.isDemo` so a real-deal DB is never open even under `DEMO_OPEN=1`), D-11 (attributed `admin-token` identity exists for audit attribution)
- `.planning/phases/02-mandatory-auth-roles/02-SECURITY.md` — T-02-05/T-02-11 mitigations this phase extends
- `.planning/phases/01-schema-migration/01-CONTEXT.md` — D-08 (single deal-aware DB then, file split deferred to this phase), D-06 (verify-gate precedent for migrations)
- `.planning/STATE.md` §Blockers — Phase-3 seams note (isOpenMode binding; `sessions.ip`/TRUST_PROXY feeds audit)

### Research grounding (from milestone research)
- `.planning/research/SUMMARY.md` — file-per-deal architecture rationale, audit-via-triggers recommendation, F2+F3 merge rationale

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `db/store.js` — `initDb`/`readDb`/`writeDb` with `__snapshot` three-way merge and `getConnection()`; the resolver generalizes this from one connection to one-per-resolved-database.
- `db/sessions.js` + sessions table — gains the deal-binding column (D-01); `req.portalUser` already carries username/role/sessionId for audit attribution.
- Consolidated `/api` gate (server.js ~L268) — the single choke point where deal resolution, `isOpenMode && req.isDemo`, and validation dispatch naturally attach.
- `scripts/migrate-db-json-to-sqlite.js` — the re-runnable + `--verify` migration pattern to copy for the split script.
- `db/collections.js` — the 38-key inventory that defines what splits where (D-05) and what a template-only deal seed includes (D-06).

### Established Patterns
- Blob-per-row schema (id/project_id + JSON `data` column) — audit before/after snapshots (D-11) are naturally full-blob copies.
- `[security]` startup warnings (ADMIN_TOKEN, DEMO_OPEN) — extend for any new dangerous config.
- Package vetting precedent: better-sqlite3 [SUS]-checkpoint flow — zod (D-12) follows the same gate.
- `ROLE_WRITE_POLICY` boundary-safe prefix matching — deal-management endpoints slot into it (`/api/deals` write tier per D-02).

### Integration Points
- `demoMode` flag (~40 checks) + `custom*` shadow arrays + `stashActiveCustomProject`/`snapshotCms` — the mechanism ISO-03 replaces; every one of those call sites is a migration site.
- Time-travel (`scaleEmployeesForDay`, `getPulsesForDay`), XP/leaderboard endpoints — the demo-only mechanics ISO-02 must hard-gate to `demo.db`.
- `download-zip` exclusion list (server.js) — must add `deals/*`, `audit.db`, `runtime.db`.
- Frontend fetch wrapper (transitions.js) — deal-switcher UI (D-04) and any "no deal selected" signal ride the existing 401/redirect plumbing.

</code_context>

<specifics>
## Specific Ideas

- The user's git-policy instinct was "keep zero-install working" — preserve unzip→run with pre-seeded demo accounts as a hard constraint on the control/runtime split (D-07).
- Deal switcher should be visibly distinct from the demo Projects UI — the separation is a feature, not an accident (D-04).

</specifics>

<deferred>
## Deferred Ideas

- Deal-scoped audit views for ILs (admin-only this phase, D-10) — natural Phase 4+ follow-up alongside clean-room.
- Audit retention/rotation policy and tamper-evidence (hash chaining) — not required by AUD-01/02; revisit at shared-host milestone (v2).
- Workstream-lead role taxonomy (ws_lead_hr, …) — still parked for Phase 4 planning (carried in STATE.md blockers).

</deferred>

---

*Phase: 3-Deal Isolation, Audit Log & Write Validation*
*Context gathered: 2026-07-31*
