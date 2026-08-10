# Feature Research

**Domain:** Multi-user collaboration for an internal enterprise M&A integration tool (small deal team: 1 Integration Lead + ~4-10 workstream leads + PMO)
**Researched:** 2026-08-10
**Confidence:** MEDIUM (cross-checked general enterprise-app patterns from Auth0, Keycloak, GitHub, IBM Watsonx, Grafana Enterprise, and audit-log/activity-feed design writeups — no single authoritative "M&A tool" precedent exists, so patterns are generic collaboration/session-management wisdom applied by judgment to this app's specific shape)

## Feature Landscape

### Table Stakes (Users Expect These)

Features a small team collaborating on shared records assumes exist. Missing these makes the app feel unsafe to use with real deal data once more than one person can write.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Optimistic-locking conflict feedback (version + 409 + reload) | Once two people can edit the same RAID entry, task, or synergy line, silent last-write-wins causes real data loss on MNPI records — unacceptable. The user has already chosen this mechanism; the open work is the UX around it. | LOW–MEDIUM | Server-side is nearly free (add a `version`/`updated_at` column + `WHERE version = ?` check, already close to what `db/store.js`'s `writeDb()` hook can enforce). The UX is the real work: don't just show a raw 409 — preserve the user's in-progress edit, show *what* changed underneath them (diff or at minimum "updated by X at Y"), and offer a one-click "reload and reapply" rather than silently discarding their draft. |
| Conflict UX applies only to genuinely co-edited record types | Not every table needs version-checked writes — most records in this app are edited by exactly one owner. Applying optimistic locking universally is wasted complexity; applying it nowhere on shared records is data loss risk. | LOW | Co-edited candidates, ranked by real concurrent-edit likelihood: **RAID log entries** (any workstream lead + IL), **integration tasks** (workstream lead updates status, IL reassigns/reviews), **DD findings/requests** (workstream lead updates while IL is triaging), **synergy initiatives** (workstream owner updates phasing while IL rolls up), **org positions/decision log** (HR + IL). Lower-risk, effectively single-owner: deal settings, wizard basics/team roster once set, CMS/content records (already single-admin pattern). |
| Invite / assign a workstream lead to a deal with per-area clearance | The milestone's entire premise is "workstream leads join once it moves to a shared host" — without an invite+grant flow, the only way to add a collaborator is manual DB/admin fiddling, which doesn't scale past the pilot deal and breaks the audit trail's attribution story. | MEDIUM | Builds directly on existing `accessPolicy` area grants and the roles table — this is a UI/flow feature (invite screen, pending-invite state, accept/first-login), not new access-control plumbing. Reuses the existing fail-closed session model. |
| Idle session timeout | A laptop-local single-operator tool didn't need this; a shared host with MNPI data and multiple logged-in users does. An indefinitely-alive session on a shared machine is a real MNPI leak vector, and this is table stakes for any credible internal tool handling sensitive data (converges across Auth0, Keycloak, and generic enterprise session-management guidance). | LOW | Extend the existing sessions table with a `last_activity` timestamp and expire server-side; ~30 min idle is a reasonable enterprise default, longer absolute max (e.g. 8–12h) so people aren't fighting re-logins mid-workday. |
| User-visible "who changed this" attribution on shared records | Once a record can be touched by more than one person, "who last touched this and when" is the minimum trust signal — it's what lets a workstream lead sanity-check a RAID entry they didn't write. This is a much smaller ask than a full activity feed. | LOW | Cheapest version: surface the existing audit log's per-record last-modified attribution (already captured by `db/auditHook.js`) inline on the record card/row, instead of requiring a trip to the admin-only audit viewer. |
| Active-session visibility + manual revoke (per user, self-service) | Once the app spans a shared host and multiple devices/browsers, "I think I left myself logged in on the shared conference-room laptop" is a realistic scenario for a real acquisition team. A self-service "sign out other sessions" is the accepted minimum bar (converges with Auth0/Keycloak session-management guidance), well short of full admin session-monitoring. | LOW–MEDIUM | Self-service (each user manages their own sessions) is table stakes; admin-forced revoke of *another* user's session is closer to a differentiator for a team this size (see below) but cheap to add given the sessions table already exists. |

### Differentiators (Valuable, Not Required)

Features that make the collaborative experience noticeably better, aligned with the milestone's core value ("run one real deal without a parallel spreadsheet"), but the app is not broken without them.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-step wizard ownership handoff | Turns the existing 7-step guided wizard from an IL-solo task into a genuinely collaborative deal-setup — e.g. IL does basics/team, delegates readiness assessments to workstream leads, HR/legal contribute their own DD kickoff inputs. Matches the milestone's stated target feature directly. | MEDIUM | Depends on the invite/assign flow above existing first (can't hand off a step to someone not yet on the deal). Model each step with an `owner` + `status` (not started/in progress/done), not a full task-assignment subsystem. |
| Multi-user-aware wizard resume state | Shows the IL "who did what" across the 7 steps at a glance when they return to a partially-completed setup — critical once setup isn't a single person's linear session. | LOW–MEDIUM | Natural extension of per-step ownership: persist `completedBy`/`completedAt` per step alongside existing resume-state, render as a simple per-step status list. Don't build a Gantt/timeline for this — a checklist is sufficient at this scale. |
| Lightweight in-app activity feed (beyond admin audit viewer) | Lets a workstream lead who's been away see "what happened on this deal since I last looked" without hunting through admin-only audit log filters. Meaningfully raises trust in a shared-record world. | MEDIUM | Build as a read-optimized *projection* over the existing append-only `audit.db`, not a parallel logging system — the audit log is already the source of truth and append-only by schema trigger. Filter by workstream/area the viewer has clearance for (reuses existing clean-room `accessPolicy` filtering, same pattern as reports/exports). Keep it a simple reverse-chronological list with actor/action/record/time — no aggregation, no @mentions, no push notifications. |
| Coarse presence signal ("N people currently on this deal" or "last active: workstream lead X, 4 min ago") | For a team this small, the actual collaboration risk isn't "who's editing my cursor position" — it's "am I the only one who knows this deal is being actively worked right now." A coarse signal answers that at near-zero cost. | LOW | Poll-based (piggyback on existing session heartbeat / `last_activity` from the idle-timeout feature above), not push/WebSocket. Show at the deal level, not per-field. This is the ceiling of what's worth building — see anti-features below for what NOT to build here. |
| Admin/IL-forced session revoke for another user | Useful once real incidents happen (a workstream lead's laptop is lost, someone leaves the deal mid-engagement) — lets the IL or admin immediately cut access without waiting for the idle timeout. | LOW | Builds directly on the sessions table + existing admin/role model; primarily a UI addition (session list + revoke button) over already-existing revocation capability (sessions are already server-verified and stored). |

### Anti-Features (Commonly Requested, Often Problematic)

Explicitly flagged as over-engineering for a <~15-person deal team on an internal tool. The user has already made the load-bearing decision here (optimistic locking, not real-time co-editing) — these are the traps that creep back in anyway if not called out.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Real-time collaborative editing (Google-Docs-style OT/CRDT, live merge of concurrent keystrokes) | "Feels modern," avoids ever seeing a conflict at all | Enormous complexity (OT/CRDT engine, conflict-free merge semantics, per-field diffing) for a team of ~15 people who are not typing in the same RAID entry at the same literal second in practice. Directly contradicts the user's stated architecture decision (optimistic locking, version+409+reload) and would require re-litigating the whole concurrency model. | Optimistic locking as chosen — a rare, recoverable 409 is a fine trade for a deal team of this size. |
| WebSocket/pub-sub live presence broadcast (cursor position, live "typing…" indicators, field-level occupancy) | Presence "feels" collaborative and is table stakes in consumer SaaS (Figma, Notion, Google Docs) | Requires persistent connection infrastructure, a pub/sub layer, and reconnection/heartbeat handling — a real new architectural component for a benefit (knowing exactly which field a colleague's cursor is in) that a <15-person async deal team doesn't need. Also cuts against the "app-only, no TE IT dependency" deployment shapes being evaluated this milestone (self-managed host / container / app-only all need to support this equally). | The coarse, poll-based "N people currently on this deal / last active" signal above — same reassurance, ~1% of the engineering cost. |
| Field-level (sub-record) locking | Seems more precise than record-level version checks | Multiplies the version/lock bookkeeping across every editable field on every co-edited record type, for conflicts that in practice occur at the *record* level (two people updating the same RAID entry's status), not mid-field. Materially increases surface area for bugs that would themselves cause the data-loss the feature is meant to prevent. | Record-level optimistic locking (the chosen design) is the right grain for this app's record types. |
| Rich notification system (@mentions, push/email alerts on every change, per-user notification preferences) | Feels necessary once an activity feed exists — "shouldn't people be *told* when something changes?" | For a team this size and cadence (daily/weekly deal cadence, not high-frequency chat), a pull-based activity feed people check when they log in is sufficient; a full notification subsystem (delivery channels, preferences, unsubscribe, digesting) is disproportionate scope and a second thing to keep secure (MNPI content must not leak into email subject lines/push payloads). | The in-app activity feed differentiator above. If a genuine need for outbound notification emerges later, it's a separably-scoped future milestone — and cuts directly against this milestone's explicit "no TE IT dependency" constraint (no mail relay wired up). |
| Full admin session-monitoring dashboard (geo/IP anomaly detection, device fingerprinting, concurrent-session-count enforcement across all users) | Enterprise security tooling (Auth0, Keycloak) does this at scale and it reads as "best practice" | Built for populations orders of magnitude larger than a ~15-person deal team; anomaly detection needs a baseline of normal behavior this team will never generate, and most of the value (revoke a stray session, see who's logged in) is captured by the much simpler self-service + admin-revoke table-stakes items above. | Self-service active-session list + admin/IL-forced revoke (both already scoped above), nothing more. |
| Building workstream-lead invite/onboarding as new access-control plumbing instead of a thin flow over `accessPolicy` | Tempting to design a "proper" invitation/role system from scratch since it's a new-feeling capability | The area-grant clearance model, roles, and fail-closed session auth already exist and are exactly the right primitives — building parallel plumbing would duplicate the clean-room access model this app depends on for MNPI compliance and risk drifting the two out of sync. | Invite flow is UI + email/link-based activation over the *existing* `accessPolicy`/roles/sessions tables — new surface, no new access-control model. |

## Feature Dependencies

```
[Workstream-lead invite/assign + per-area clearance grant]
    └──requires──> [Existing: roles table, accessPolicy area grants, fail-closed sessions] (already shipped)

[Per-step wizard ownership handoff]
    └──requires──> [Workstream-lead invite/assign]
                       └──requires──> [Existing: roles, accessPolicy]

[Multi-user-aware wizard resume state]
    └──requires──> [Per-step wizard ownership handoff]

[Optimistic-locking conflict UX (version + 409 + reload)]
    └──requires──> [Concurrency-safe write path — the pivotal architecture unknown this milestone (single-writer broker / cross-process lock / Postgres)]

[User-facing activity feed]
    └──requires──> [Existing: append-only audit.db, auditHook.js] (already shipped)
    └──requires──> [Existing: accessPolicy clean-room filtering, for scoping visible entries] (already shipped)

[Inline "who last touched this" attribution]
    └──requires──> [Existing: audit.db per-record attribution] (already shipped)

[Coarse presence signal ("N active on this deal")]
    └──enhances──> [Workstream-lead collaboration generally]
    └──requires──> [Session last-activity tracking] (built alongside idle timeout)

[Idle session timeout]
    └──requires──> [Existing: sessions table] (already shipped, needs last_activity column)

[Self-service active-session list + revoke]
    └──requires──> [Idle session timeout] (same last_activity tracking)

[Admin/IL-forced revoke of another user's session]
    └──requires──> [Self-service active-session list + revoke]
    └──requires──> [Existing: role model (admin/IL only)] (already shipped)

[Real-time presence/co-editing (WebSocket, OT/CRDT)] ──conflicts──> [Optimistic locking as chosen architecture]
```

### Dependency Notes

- **Optimistic-locking UX requires the concurrency architecture decision:** PROJECT.md flags the multi-writer architecture (single-writer broker vs. cross-process lock vs. Postgres migration) as "the pivotal unknown, research-first." The conflict UX (version + 409 + reload) is a thin layer on top of whichever write path is chosen — it should not be planned as a phase before that architecture decision lands, only sequenced after it.
- **Workstream-lead invite is the gating dependency for both wizard features:** you cannot hand off a wizard step or show multi-user resume state to someone who isn't yet a collaborator on the deal. Invite/assign must land in an earlier phase than the wizard collaboration enhancements.
- **Activity feed and inline attribution both reuse the existing audit log rather than building new logging** — this is a read-side/UI feature, not a new write-side concern, and should be scoped and estimated as such (avoid double-building what `auditHook.js` already captures).
- **Presence and session-list features share the same underlying primitive** (`last_activity` on the sessions table) — building idle-timeout first makes the presence signal and session-list nearly free to add afterward.
- **Real-time co-editing conflicts with the chosen optimistic-locking architecture:** these are mutually exclusive design directions, not complementary features — building any live-presence/broadcast infrastructure creates pressure to "finish the job" into real-time merge, which the user has already ruled out.

## MVP Definition

### Launch With (this milestone, v2.2.0)

Minimum for "workstream leads can safely and visibly collaborate with the IL on one live deal."

- [ ] Optimistic-locking conflict UX (version + 409 + reload, with in-progress-edit preservation) on the identified co-edited record types (RAID, tasks, DD findings, synergy initiatives, org/decision log) — the core safety guarantee the milestone exists to deliver
- [ ] Workstream-lead invite/assign flow with per-area clearance grants — the collaboration on-ramp; without it nothing else in this list has anyone to collaborate with
- [ ] Idle session timeout + self-service active-session list/revoke — the minimum session-hygiene bar for a shared host handling MNPI
- [ ] Inline "who last touched this" attribution on co-edited records — cheapest possible trust signal, near-free extension of the existing audit log

### Add After Validation (v2.2.x, once real multi-user usage happens)

- [ ] Per-step wizard ownership handoff + multi-user-aware resume state — valuable once there's more than one deal being *set up* collaboratively; the first real deal may still be IL-solo through setup even under this milestone
- [ ] User-facing activity feed (beyond raw audit viewer) — add once the team is large/active enough that "what happened while I was away" is a recurring need, not before
- [ ] Coarse presence signal ("N active on this deal") — genuinely nice-to-have; validate that workstream leads want it before building even the lightweight version
- [ ] Admin/IL-forced revoke of another user's session — add once there's an actual incident pattern (device loss, offboarding) to justify it, rather than pre-building it speculatively

### Future Consideration (v3+, explicitly deferred)

- [ ] Real-time collaborative editing / live co-authoring — only reconsider if the deal team scales well past ~15 concurrent editors or the deal cadence becomes high-frequency enough that occasional 409s become a real friction point (unlikely for this domain)
- [ ] Rich notification system (@mentions, email/push alerts) — deferred until there's a concrete outbound-channel need, and blocked by the "no TE IT dependency" constraint (no mail relay) until a later milestone
- [ ] Full admin session-monitoring/anomaly-detection dashboard — deferred indefinitely; population size never justifies it at this team's scale

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|----------------------|----------|
| Optimistic-locking conflict UX (version+409+reload) | HIGH | MEDIUM (UX) / depends on concurrency arch (backend) | P1 |
| Workstream-lead invite/assign + per-area grants | HIGH | MEDIUM | P1 |
| Idle session timeout | HIGH | LOW | P1 |
| Self-service active-session list + revoke | MEDIUM | LOW | P1 |
| Inline "who last touched this" attribution | MEDIUM | LOW | P1 |
| Per-step wizard ownership handoff | MEDIUM | MEDIUM | P2 |
| Multi-user-aware wizard resume state | MEDIUM | LOW–MEDIUM | P2 |
| User-facing activity feed | MEDIUM | MEDIUM | P2 |
| Coarse presence signal | LOW–MEDIUM | LOW | P2 |
| Admin-forced revoke of another user's session | LOW–MEDIUM | LOW | P2 |
| Real-time co-editing (CRDT/OT) | LOW (at this scale) | HIGH | P3 / reject |
| Rich notification system | LOW (at this scale) | HIGH | P3 / reject |
| Full session-monitoring/anomaly dashboard | LOW (at this scale) | HIGH | P3 / reject |
| Field-level locking | LOW (record-level is sufficient grain) | HIGH | reject |

**Priority key:**
- P1: Must have for this milestone — the safety/onboarding baseline that makes shared-host multi-user viable at all
- P2: Should have, sequence after P1 lands and real usage validates the need
- P3 / reject: Explicitly out of scope at this team's scale — documented here specifically to prevent scope creep during planning

## Comparable Pattern Analysis

No direct "M&A integration portal" competitor set exists to benchmark against (this app's domain is narrow and largely undifferentiated commercially — see PROJECT.md's Out of Scope on multi-tenant/market positioning). Instead, the relevant comparison set is how mature internal/enterprise tools at comparable team scale handle each concern:

| Concern | Enterprise-scale reference pattern | Applicability to this app |
|---------|-----------------------------------|----------------------------|
| Optimistic concurrency | ETag/version-based optimistic concurrency is the standard HTTP-native pattern for REST APIs; conflict resolution surfaces a clear diff/message rather than a bare 409 | Directly applicable — matches the user's chosen architecture; the differentiator is investing in *what the reload UX shows*, not just that it reloads |
| Presence | Grafana Enterprise's presence indicator exists specifically so on-callers know who else is looking at an incident in *large* organizations; Microsoft Teams' presence dashboard is built for tenant-wide monitoring | Both are built for populations far larger than this team — validates that the coarse, low-investment version is the right ceiling here, not the rich version |
| Session management | Auth0/Keycloak converge on: short access-token lifespan, ~30min idle timeout, longer absolute session max, server-side revocation on logout/password-change, risk-based shortened timeouts for non-MFA logins | Directly applicable pattern; this app doesn't need risk-based/MFA-tiered timeouts (no MFA this milestone) but the idle+absolute timeout split and server-side revocation-on-logout are worth adopting as-is |
| Audit trail vs. activity feed | Mature guidance treats the append-only audit log (compliance-grade, complete, admin-only) and the user-facing activity feed (readable, filtered, fast) as two distinct projections of the same event stream, not the same UI | Directly applicable — this app already has the audit-log half (`audit.db`); the new work is purely the read-side feed projection, not new logging |
| Invite/role-assignment flows | GitHub/IBM Watsonx/Wix all converge on: enter identifier, assign a role/permission scope, activation on accept | Directly applicable — this app's `accessPolicy` area-grant model is already more granular than typical single-role invite flows, so the invite UI is the only net-new surface |

## Sources

- [How to Resolve the 409 Status Code: Troubleshooting Conflicts](https://apipark.com/techblog/en/how-to-resolve-the-409-status-code-troubleshooting-conflicts/) — MEDIUM confidence (web search, cross-checked against multiple 409/optimistic-concurrency writeups)
- [409 Status Code: Causes, Solutions, and Best Practices](https://apipark.com/techblog/en/409-status-code-causes-solutions-and-best-practices/) — MEDIUM confidence
- [The Complete Guide to the 409 HTTP Status Code — Abstract API](https://www.abstractapi.com/guides/http-status-codes/409) — MEDIUM confidence
- [New Enterprise features in Grafana 7.0: usage insights and user presence indicator — Grafana Labs](https://grafana.com/blog/2020/07/07/new-enterprise-features-in-grafana-7.0-usage-insights-and-user-presence-indicator/) — MEDIUM confidence (vendor blog, but directly on-point precedent for presence-at-scale reasoning)
- [Session Management in Keycloak: From Refresh to Idle Timeouts](https://skycloak.io/blog/session-management-in-keycloak-from-refresh-to-idle-timeouts/) — MEDIUM confidence
- [Sessions with Actions — Auth0 Docs](https://auth0.com/docs/manage-users/sessions/manage-sessions-actions) — MEDIUM-HIGH confidence (vendor docs, widely-adopted IdP)
- [TrustedSec — AppSec Cheat Sheet: Session Management](https://trustedsec.com/blog/appsec-cheat-sheet-session-management) — MEDIUM confidence (security-practitioner source)
- [Audit logging for internal tools: clean change history patterns — AppMaster](https://appmaster.io/blog/audit-logging-internal-tools-activity-feed) — MEDIUM confidence
- [Designing an Activity Feed for B2B SaaS: Events, Aggregation, and Privacy-Safe Logging](https://wolf-tech.io/blog/designing-an-activity-feed-for-b2b-saas-events-aggregation-and-privacy-safe-logging) — MEDIUM confidence
- [IBM Watsonx — Project collaborators](https://www.ibm.com/docs/en/watsonx/saas?topic=projects-managing-collaborators) — MEDIUM confidence (vendor docs)
- Internal source: `/Users/karstenhaldan/M&A/.planning/PROJECT.md` — HIGH confidence (project's own requirements/constraints/decisions)
- Internal source: `/Users/karstenhaldan/M&A/.planning/codebase/STRUCTURE.md` — HIGH confidence (existing codebase facts, informs what's already shipped vs. net-new)

---
*Feature research for: Multi-user collaboration, v2.2.0 Shared-Host Multi-User milestone*
*Researched: 2026-08-10*
