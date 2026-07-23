# Pitfalls Research

**Domain:** Demo-to-production migration for an M&A integration portal — file-store-to-SQLite migration, mandatory auth retrofit, demo/real-deal mode isolation, MNPI handling in a laptop-local app, and trustworthy IMO/synergy reporting.
**Researched:** 2026-07-23
**Confidence:** MEDIUM-HIGH (SQLite/WAL mechanics verified against sqlite.org + better-sqlite3 official docs; auth-retrofit, demo/real separation, MNPI and reporting-trust pitfalls are established engineering/compliance patterns applied specifically to this codebase's documented shape from `CONCERNS.md`/`PROJECT.md`)

This document assumes `.planning/codebase/CONCERNS.md` as read. It does not repeat: the concurrent-`writeDb()` race, the `JSON.parse(JSON.stringify())` deep-clone data loss, the project-switch mode-transition data loss, missing input validation, the incomplete XSS audit, admin token in `localStorage`, no rate limiting, or "no tests exist." Every pitfall below is what happens **next**, once those known issues are addressed and the app takes on SQLite, mandatory auth, and real MNPI.

---

## Critical Pitfalls

### Pitfall 1: The migration script silently reshapes data instead of preserving it

**What goes wrong:**
`db.json` today is not a flat table-per-array file — it's a single blob with nested structures (per-project CMS bundles, `checklistTemplates` embedding `integrationTasks` semantics, `assessmentInstances` carrying denormalized template snapshots, `pulseLibrary` keyed by day-number not date). A first-pass migration script naively maps each top-level array to a table with an auto `id` column and JSON-stringifies anything nested "for now." Six months later nobody remembers which columns are real relational data and which are still opaque JSON blobs, and queries that should be simple SQL (e.g., "all RAID entries linked to this synergy initiative") become string-matching against a JSON column again — the migration achieved nothing but moving the file.

**Why it happens:**
The instinct with a "drop-in replacement" framing (as `CONCERNS.md` itself suggests: "Near term: Implement SQLite... as drop-in replacement") is to preserve the existing shape 1:1 rather than using the migration as the forcing function to actually normalize. This is doubly tempting under "foundation-first, don't scope-creep into features" pressure.

**How to avoid:**
Treat the migration as a schema-design exercise, not a serialization-format swap. Before writing migration code, write the target schema by hand for the tables that new capabilities depend on (`due_diligence_findings`, `synergy_initiatives` with baseline/phasing, `audit_log`, `users`/`roles`) — these need real columns and real foreign keys because DD-findings→task linkage, synergy→task linkage, and audit queries are the whole point of this milestone. Lower-value, rarely-queried blobs (CMS page body HTML, slide metadata, i18n key/value pairs) are legitimately fine as JSON columns in SQLite (`json1` extension or plain TEXT) — decide per-table, don't default either way.

**Warning signs:** A migration PR where every table has exactly the same columns as the old JSON array had keys, plus `id INTEGER PRIMARY KEY`. Any query against the new schema that still does `LIKE '%..%'` against a JSON text column for something that should be a join.

**Phase to address:** Foundation phase (SQLite migration), before any capability-area work starts. This is the one pitfall where getting it wrong is expensive to fix later — schema debt under real deal data is much harder to correct than under an empty demo store.

---

### Pitfall 2: The migration is a one-way door dressed as "foundation-first, comfortable pace"

**What goes wrong:**
`PROJECT.md` explicitly states "no fixed date... foundation-first sequencing is comfortable" — which is good, but it creates a trap: the team runs the migration once on the working demo db.json, deletes/archives the old code path, and only then discovers a bug in the migrated data (a dropped field, a wrong type coercion, a broken relationship) after real deal data has already been entered into SQLite for weeks. There is no way back to file-store, and no verified way to re-run the migration on the now-diverged SQLite data.

**Why it happens:**
Migration scripts are usually written to run once and thrown away. Nobody budgets for "run it three times against snapshots and diff the output" because it doesn't feel like "real" roadmap work.

**How to avoid:**
Make the migration idempotent and re-runnable against a fresh copy of the source `db.json` (not runnable-once). Keep the file-store code path (read-only, feature-flagged) alive for one full milestone after cutover as a fallback / comparison oracle, not deleted at cutover. Write a small diff tool that loads the pre-migration db.json and the post-migration SQLite file and asserts record counts and spot-checked field values match, per table, before calling migration "done." Snapshot the pre-migration db.json into `.planning/` or a dated backup directory as the last file-store artifact, permanently — this becomes the audit trail's "day zero."

**Warning signs:** No `--dry-run` or `--verify` mode on the migration script. The migration script is deleted or unmaintained the moment it runs successfully once. No automated count/checksum comparison between old and new store after migration.

**Phase to address:** Foundation phase. Verification step: "migration produces identical record counts and a passing field-level diff against source db.json, run twice from the same source with identical output" should be an explicit UAT criterion, not implied by "it looks right in the UI."

---

### Pitfall 3: The mtime-cache pattern gets carried over into the SQLite layer, or torn out without a replacement invalidation strategy

**What goes wrong:**
The current `readDb()` caches the parsed object keyed on the file's `mtime`; correctness relies on every write going through `writeDb()`, which updates the file (and hence its mtime) atomically. Two ways this breaks under SQLite: (a) someone keeps an in-process cache "for performance" but keys it on nothing meaningful, so a write from one request isn't visible to a read on another connection/handle in the same process until an arbitrary TTL expires — a subtler, harder-to-detect version of the stale-read bug that existed before; or (b) the cache is torn out entirely with no replacement, and every request pays full query cost for data (settings, active project, department list) that barely changes, reintroducing the "sync file I/O on every request" performance problem `CONCERNS.md` already flagged, just moved to SQLite queries.

**Why it happens:**
Caching is invisible until it's wrong. With WAL mode, `better-sqlite3` connections in the same process see writes immediately (no cross-connection staleness like a network DB) — but if the app later moves to a worker/cluster model (Node cluster, PM2, multiple processes) for the shared-host phase, and cross-process caches (e.g., a Node-level LRU) are introduced without documenting SQLite's read-your-writes semantics per-process, staleness returns in a different, less familiar shape.

**How to avoid:**
Default to no application-level object cache on top of SQLite for anything write-adjacent (settings, active project, roles) — WAL mode with a single writer connection already gives cheap, consistent reads in-process; trust it before re-inventing caching. If a hot-path cache is genuinely needed later (e.g., rendered dashboard aggregates), key it by an explicit version counter incremented inside the same transaction as the write, not by wall-clock time or file mtime (SQLite files don't reliably expose a meaningful per-row mtime).

**Warning signs:** Any `setTimeout`/TTL-based cache introduced during the SQLite migration "to keep things fast like before." A support report of "I changed X but the dashboard still shows the old value" after the migration ships.

**Phase to address:** Foundation phase, explicitly noted in the migration's design so it isn't quietly reintroduced by whoever writes the new `readDb`-equivalent.

---

### Pitfall 4: Transaction boundaries are drawn around HTTP requests instead of around domain operations

**What goes wrong:**
The natural first refactor is "wrap the whole request handler in `db.transaction()`." This looks correct and passes manual testing, but two multi-step operations in this app are not one request each: (a) `POST /api/integration-tasks/from-remediation` creates one-or-more tasks from a red flag — if this becomes multi-table (task + RAID entry + audit row) under SQLite and only *part* of it is wrapped, a crash between steps leaves an orphaned task with no audit trail, exactly the kind of gap the audit log exists to prevent; (b) project activation / mode-switch (`POST /api/projects/:id/activate`, the existing `stashActiveCustomProject()` logic) touches many tables and currently has known data-loss edge cases per `CONCERNS.md` — moving this to SQLite without an explicit transaction boundary around the *entire* stash-then-activate sequence just gives the same bug ACID clothing without ACID behavior.

**Why it happens:** SQLite's per-statement autocommit-by-default makes it easy to write correct-looking sequential `INSERT`/`UPDATE` calls that are each individually safe but not atomic as a group. `better-sqlite3`'s synchronous API makes this worse to notice because there's no visible `await` gap suggesting "something async could interleave here" — but a thrown JS exception mid-sequence still leaves earlier statements committed.

**How to avoid:** Identify the actual domain-level "must all happen or none happen" operations before writing SQL: DD-finding→task/RAID creation, synergy-initiative→task linkage, project activation/stash, and every audit-logged write (the write + its audit row must commit together or the audit log becomes unreliable, see Pitfall 8). Wrap exactly those in `db.transaction(fn)`, not the HTTP handler as a whole (which may include non-DB work like AI calls or file I/O that shouldn't hold a write lock).

**Warning signs:** A grep for `db.transaction` that returns zero results anywhere near the remediation-linkage or project-activation code after the migration. Any audit-log write issued as a separate statement after the main write's response has already been prepared.

**Phase to address:** Foundation phase (SQLite migration + audit log), verified again when DD-findings and synergy-linkage capability areas build on top of these code paths.

---

### Pitfall 5: The retrofitted auth gate has route-shaped holes because ~90 endpoints were enumerated by memory, not by code

**What goes wrong:**
`PROJECT.md` and `CONCERNS.md` both note there are ~90 API endpoints and that `PORTAL_AUTH`/`ADMIN_TOKEN` today is opt-in and coarse (on/off, not per-role/per-route). The natural retrofit approach is to add role checks to the routes the team remembers are sensitive (admin CRUD, project creation) and miss: read endpoints that return sensitive fields as a side effect of an otherwise-fine feature (e.g., an assessment-detail endpoint that also embeds the full org/employee list for context), endpoints added mid-milestone by a different capability area (DD findings, synergy exports) that never get retrofitted because they're "new, so obviously already covered" when they're actually copy-pasted from an old unguarded route, and static file serving or CMS page routes that bypass the API auth middleware entirely because they're mounted via `express.static` or a catch-all before the auth middleware runs.

**Why it happens:** Express middleware ordering is easy to get subtly wrong (a static-file or catch-all route registered before the auth middleware silently skips it), and "add auth to every route" is a boring, unglamorous task that's easy to under-scope as "add auth to the routes that matter" — a judgment call made under time pressure that this milestone's timeline ("no fixed date, quality over speed") is specifically designed to prevent.

**How to avoid:** Do not enumerate sensitive routes by memory. Generate the endpoint list programmatically (Express exposes `app._router.stack`, or grep every `app.get/post/put/delete/patch(` call in `server.js`) and produce it as a checklist — every single route gets an explicit auth-requirement decision (`public`, `authenticated-any-role`, `role:X`), not a default. Apply role-checking middleware globally (mounted before all `/api` routes) with an explicit allow-list of the few genuinely public routes (`/healthz`, static demo assets, login) rather than a deny-list of routes to protect — deny-lists rot as routes are added; allow-lists fail safe. Re-run the same enumeration script as a CI/pre-commit check that fails if a new route exists with no auth decision recorded next to it.

**Warning signs:** Auth middleware applied per-route (`router.get('/x', requireAuth, handler)`) rather than globally with exceptions — this pattern guarantees future omissions. Any route mounted via `app.use(express.static(...))` for a directory that also contains non-public generated files (exports, uploads). A grep for `app.get(` or `app.post(` returning more matches than the auth checklist has entries.

**Phase to address:** Foundation phase (mandatory auth). Verification: the generated route-vs-auth-decision checklist, with 100% coverage, should be a UAT gate before this phase is marked done — and re-run whenever a capability-area phase adds new endpoints (DD, synergy, IMO exports, org design all add routes).

---

### Pitfall 6: Read-endpoint gaps get treated as lower priority than write-endpoint gaps, but MNPI leaks through reads

**What goes wrong:**
`CONCERNS.md` already flags "No Authentication for Read Operations in Demo Mode" as a known gap, but frames the fix as demo-mode-specific ("gate read access... behind a simple demo PIN"). Under real-deal mode with MNPI, the asymmetry that matters most is the opposite of the usual security instinct: write endpoints get locked down first because "someone could change data" feels more dangerous than "someone could see data," but for MNPI the read path *is* the primary risk (pre-announcement target name, valuation, retention list exposure is a legal/compliance event the moment it's *read* by the wrong person — no write required). A retrofit that prioritizes write-gating and treats read-gating as a follow-up leaves the highest-severity risk for last.

**Why it happens:** General web-security instinct (OWASP-style thinking) is write-first because writes cause data corruption/fraud. MNPI risk inverts this: unauthorized read of a pre-close target name or valuation is itself the compliance violation (insider-trading exposure, disclosure-timing violation), independent of any write.

**How to avoid:** Treat every read endpoint that can return real-deal-mode data as requiring the same mandatory-role-check pass as writes, in the same phase, not a follow-up. Specifically flag and clean-room-gate: anything returning `targetCompany`, valuation/synergy financials, `raidEntries`, DD findings, retention/flight-risk lists, and named org-design data — these need per-role need-to-know gating (the "clean-room access segregation" requirement in `PROJECT.md`), not just "logged in."

**Warning signs:** A design or PR where the auth checklist (Pitfall 5) marks all GET routes as simply `authenticated-any-role` without a finer-grained need-to-know tier for the fields above.

**Phase to address:** Foundation phase for the baseline (any authenticated user vs. anonymous), but clean-room segregation is explicitly called out in `PROJECT.md`'s "Due diligence workspace" capability area — that phase must revisit every read endpoint touching DD/valuation/retention data with role-scoped field filtering, not just endpoint-level gating (see Pitfall 7).

---

### Pitfall 7: Clean-room segregation is implemented as a page-level (route) gate when the real requirement is field-level and record-level

**What goes wrong:**
"Need-to-know" in an M&A clean room isn't "can this role see the DD Workspace page" — it's "can this specific person see this specific target's DD findings, and specifically not the valuation/synergy figures even if they can see the findings list, if they're outside the clean-room group for this deal." A retrofit that adds a role check to the DD-workspace route (`ws_legal` can see `/dd` but `ws_sales` cannot) looks like clean-room segregation in a demo but doesn't hold up: (a) the same person's role often spans multiple functions in a small IL team, so role-based gating alone is too coarse; (b) API responses that return the full DD-findings object (including valuation-adjacent fields) to anyone who can reach the route at all, because the frontend just hides the sensitive fields in the UI — anyone with devtools or a raw `curl` against the endpoint gets everything regardless of what the UI shows.

**Why it happens:** Frontend-only field hiding is much faster to build than backend field-level filtering, and it "looks right" in every manual browser test because the person testing has full access. It's the single most common way access control demos fine and fails in production.

**How to avoid:** Clean-room membership should be its own explicit data (a per-project, per-user allow-list — "who is in the clean room for this deal"), separate from the coarse role (`admin`/`hrbp`/`pmo`). Every DD/valuation-adjacent API response must filter fields server-side based on clean-room membership, not just gate the route. Never rely on frontend hiding as the only control for MNPI fields — verify by hitting the raw API with a non-clean-room but otherwise-authenticated user and confirming the sensitive fields are actually absent from the JSON, not just unrendered.

**Warning signs:** Sensitive fields present in the raw API response but hidden by a `v-if`/conditional render in the frontend. Clean-room membership implemented as a reuse of the existing coarse role enum rather than a separate per-deal list.

**Phase to address:** Due diligence workspace capability area, as `PROJECT.md` already scopes it there — but the *pattern* (server-side field filtering by need-to-know, not route gating) should be established once in the foundation auth phase so DD, synergy, and org-design capability areas all reuse the same mechanism rather than each inventing its own.

---

### Pitfall 8: The audit log is trusted more than its actual tamper-resistance warrants

**What goes wrong:**
An audit log implemented as just another SQLite table (`INSERT INTO audit_log ...`) with the same DB file, same file permissions, and same admin access as everything else is defeatable by anyone with admin/DB access — which, in a laptop-local single-file SQLite app, is anyone with filesystem access to the `.db` file. Management or compliance may treat "we have an audit log" as satisfying a control that actually requires the log to be at least somewhat resistant to the very users it's watching (append-only, no UPDATE/DELETE path, ideally write-once or externally mirrored). If the audit table has no delete/update protection at the DB layer, a person editing MNPI to cover a mistake (or worse) can also quietly edit their own audit trail rows, since both are just rows in the same file with the same access.

**Why it happens:** "Add an audit log" reads as a data-modeling task (add a table, log every write) rather than a security-control task (make the log resistant to the people it's supposed to catch). The two look identical in a code review that only checks "does a row get written."

**How to avoid:** Make the audit table append-only at the application layer at minimum (no UPDATE/DELETE endpoints ever exposed for it, not even to admin) and ideally enforce it at the DB layer with a SQLite trigger that raises on UPDATE/DELETE against `audit_log`. Log the actor, action, resource, before/after values, and timestamp inside the *same transaction* as the write it's auditing (Pitfall 4) so a crash can never produce a write with no corresponding audit row. For the laptop-local phase, treat "the audit log lives in the same file an admin can open in a SQLite browser and edit" as an accepted, documented risk (not silently assumed away) until the shared-host move allows shipping audit rows to a separate destination (append-only file, external log sink) the app's own admin can't edit.

**Warning signs:** An `/api/audit-log` endpoint that accepts anything other than GET. No DB trigger or constraint preventing UPDATE/DELETE on the audit table. Audit-log writes issued as a separate, non-transactional statement after the main write commits.

**Phase to address:** Foundation phase (audit log). Explicitly scope "append-only enforcement" as an acceptance criterion, not just "a row gets written when data changes."

---

### Pitfall 9: Demo mode and real-deal mode share code paths that mutate state, even after they stop sharing a store

**What goes wrong:**
`PROJECT.md` correctly identifies that demo and real data must not share a *store* — but the deeper risk is shared *mutating code paths*, which is a different problem that persists even after the data is split. Time-travel (`scaleEmployeesForDay()`), gamification scoring, and the leaderboard scaler are functions that take a day-number and *rewrite* employee/task state as a side effect. If real-deal mode reuses these functions at all (even pointed at the real-deal tables instead of demo tables, e.g., because "the scoring logic is useful, let's reuse it for engagement tracking in the real IMO"), the same class of retroactive-recalculation bug already documented in `CONCERNS.md` ("Lesson Pool Collision in Gamification" — scores jump when courses change) reappears against real deal data, where a retroactive score change isn't a demo quirk, it's a data-integrity incident someone has to explain to the IL.

**Why it happens:** Code reuse instinct — "we already have a day-scaling engine, let's not build a second one" — is usually good practice, but here the *reason* the function exists (simulate elapsed time for a pitch demo) is fundamentally incompatible with the property real-deal data needs (append-only, no retroactive rewrites triggered by unrelated admin actions like adding a course).

**How to avoid:** Don't just separate demo/real *data* — audit every function that performs a write as a side effect of something that looks like a read or a settings change (time-travel day advance, course/lesson pool changes, leaderboard recompute) and make those functions structurally unreachable when `demoMode` is false, not just pointed at empty tables. The cleanest boundary is a single, obvious gate at the top of each such function (`if (!isDemoMode()) return;` or a route-level 404 in real-deal mode) rather than trusting that real-deal mode "just won't have the UI buttons that trigger it" — the existing admin token / API surface means any such function reachable by API call is reachable regardless of UI.

**Warning signs:** Any function with "scale," "recalculate," "retroactive," or "leaderboard" in its name that doesn't check demo-mode status at its own entry point (only at the route or UI layer that calls it). A synergy or engagement-tracking feature request that says "reuse the gamification engine" for real-deal reporting.

**Phase to address:** Foundation phase ("make time-travel, XP/leaderboard and other showcase mechanics unreachable from real-deal mode" is already an explicit requirement in `PROJECT.md` — this pitfall is about implementing that as a function-level gate, not a data-level or UI-level one, so it can't be bypassed by direct API calls or future code reuse).

---

### Pitfall 10: Frontend global state (`activeEmployee`, `portalSettings`-style globals) becomes a demo/real-deal leak vector, not just a bug source

**What goes wrong:**
`CONCERNS.md` already flags page-level globals as a maintainability/XSS risk. Under this milestone, the same pattern becomes a mode-leak risk: if a user has the demo showcase open in one browser tab (for a sales pitch) and the real-deal instance open in another tab of the same browser, and any state is accidentally shared via `localStorage`/`sessionStorage` keys that aren't mode-namespaced (e.g., `activeProjectId`, `adminEditMode`, cached API responses), a demo-mode action in one tab can bleed into the real-deal tab's rendered state, or — worse — a real-deal API token/session cached in a mode-agnostic storage key becomes readable from the demo-mode page context if both are served from the same origin.

**Why it happens:** The app is single-origin, single-codebase by design (`PROJECT.md`: "Both modes ship from one codebase"), and `localStorage`/`sessionStorage` are origin-scoped, not mode-scoped — nothing in browser storage naturally respects the demo/real-deal boundary unless the app explicitly namespaces every key.

**How to avoid:** Namespace every client-side storage key by mode (and, once real-deal, by active project/deal) rather than assuming tab isolation is sufficient — two tabs on the same origin share `localStorage` regardless of what page each tab is showing. If demo and real-deal are meant to be reachable from the same running server instance at all (rather than genuinely separate deployments), audit that mode-switch actually clears or re-namespaces all client caches, not just server-side active-project state.

**Warning signs:** `localStorage.getItem('activeProjectId')` or similar mode-agnostic keys used without a demo/real-deal prefix. A support report of "I saw a demo employee's name in my real project" or vice versa.

**Phase to address:** Foundation phase (demo/real-deal separation), as an explicit item alongside the store-separation requirement already in `PROJECT.md` — this is the client-side half of the same boundary.

---

### Pitfall 11: A real db file (or a backup/export of it) gets committed to git because the repo's existing habits normalize committing generated artifacts

**What goes wrong:**
This repo already commits `node_modules`, vendored Transformers.js binaries, and demo `db.json` — a deliberate, sensible choice for the zero-install demo bundle. That same habit is exactly the failure mode for MNPI: once SQLite is in place, a `.gitignore` that isn't updated to explicitly exclude the real-deal `.db`/`.db-wal`/`.db-shm` files (and any `/api/admin/export` or `/api/admin/download-zip`-style artifact containing real data) means a single `git add -A` or an unreviewed commit ships MNPI into git history — which, per the user's own documented shipping workflow (fast-forward merge to `main`, push, no PRs, solo repo), has no review gate to catch it before `main` is pushed.

**Why it happens:** The existing `.gitignore` was written for a demo-only app where nothing in the repo was sensitive; nobody revisits it when the same repo starts holding real data, because the file itself gives no signal that anything changed.

**How to avoid:** The moment SQLite lands, add an explicit, named exclusion for the real-deal database file(s) and any generated export/backup artifacts, and verify with `git status`/`git check-ignore` that they're excluded — don't rely on a generic `*.db` pattern being obviously present; check it. Keep the demo `db.json`/demo SQLite file committed (it's meant to ship in the zero-install bundle) but store it under a path or filename that can never collide with the real-deal file's path, so there's no chance of the real file being written to the demo's already-committed path. Treat any future `git log` audit ("did we ever commit the real file") as a one-time check to run once this ships, given the no-PR/no-review workflow.

**Warning signs:** A single `.gitignore` pattern meant to cover both demo and real-deal files by name similarity. `git log --all --full-history -- '*real*.db'` (or the actual chosen filename) turning up unexpected commits.

**Phase to address:** Foundation phase (SQLite migration), as a checklist item at the same time the file path/naming scheme for the real-deal store is decided — naming and gitignore should be designed together, not gitignore added after the fact.

---

### Pitfall 12: Synergy/IMO reporting becomes numbers management doesn't trust because baseline, ownership, and staleness aren't first-class

**What goes wrong:**
`PROJECT.md` names this precisely: today's synergy tracking is "a four-field stub" (target vs. realized €M). The naive extension — add a "baseline" field and a "phasing" field to the same flat record — produces a report that *looks* more sophisticated but is still untrustworthy for three specific reasons common to IMO reporting: (1) **double-counting** — the same cost saving gets claimed by two initiatives (e.g., a headcount reduction claimed by both an "IT consolidation" initiative and a "shared services" initiative) because there's no mutual-exclusivity or ownership constraint at the data-model level; (2) **baseline drift** — the baseline against which "realized" is measured silently moves (someone edits the baseline field directly instead of the change going through a controlled re-baselining event with a reason and approver), so the same initiative can show 100% realization two different reporting periods in a row against two different actual baselines, and nobody can reconstruct why; (3) **stale status presented as current** — an initiative's status/confidence stage was set once and never revisited, so a steering-committee pack generated today silently repeats a number that's three months old with no visible "last updated" or owner-confirmation signal, and the pack looks authoritative regardless.

**Why it happens:** These three failure modes are exactly what make hand-built spreadsheets go wrong in real IMO practice too — SQLite/schema work doesn't automatically fix a data-modeling gap; if the schema doesn't structurally prevent double-counting, force explicit re-baselining events, and force a staleness signal, digitizing the spreadsheet just produces a spreadsheet-shaped bug in a database.

**How to avoid:** Model baseline changes as an append-only history (a `synergy_baseline_events` table: initiative_id, old_baseline, new_baseline, reason, approved_by, timestamp), not a mutable field — "realized %" is always computed against the *current* baseline, but the history is always inspectable. Give each initiative a single owner and, at the data-model level, either disallow or require explicit cross-linking when two initiatives claim overlapping cost/headcount categories (even a simple "overlapping category" flag surfaced in the UI is far better than silence). Every initiative carries a `last_confirmed_at`/`last_confirmed_by` pair distinct from `last_updated_at` (system-touched) — the generated steering-committee pack should visibly flag (not silently include) any initiative whose owner hasn't confirmed status within the reporting period, so stale numbers are visible as stale rather than presented with the same confidence as fresh ones.

**Warning signs:** A synergy schema where "baseline" is a single mutable column with no change history. A generated report with no per-line "as of" date or owner-confirmation indicator. Two initiatives whose category/description overlap with no cross-reference between them in the data model.

**Phase to address:** Synergy value-capture capability area, but the *staleness-visibility pattern* (last-confirmed vs. last-updated, surfaced in generated reports) should be a shared convention established once and reused by the IMO reporting/exports capability area too, since both draw from the same trust problem.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|--------------------|-----------------|------------------|
| Migrate to SQLite but keep every table shaped exactly like the old JSON arrays | Fast migration, low risk of behavior change | Re-creates the "everything is a JSON blob" problem inside a relational DB; queries stay string-matching instead of joins | Never for the tables new capability areas depend on (DD findings, synergy, audit log); acceptable for CMS/i18n/slide metadata that's genuinely document-shaped |
| Apply auth middleware per-route as routes are touched, rather than globally with an allow-list | Incremental, low-risk-feeling rollout | Guarantees some routes are missed and stay open; the ~90-endpoint surface makes "per-route as touched" a near-certain gap | Never — the allow-list-first approach is not meaningfully more work |
| Reuse gamification/time-travel functions for real-deal engagement metrics because "the logic is useful" | Avoids writing a second scoring engine | Imports retroactive-rewrite behavior into real-deal data, which cannot tolerate it | Never; write a second, append-only-by-design engine even if it duplicates some logic |
| Skip clean-room field filtering at the API layer and hide sensitive fields in the frontend only | Much faster to ship | Any authenticated user with devtools/curl sees everything regardless of role | Never for MNPI fields; acceptable only for genuinely non-sensitive cosmetic fields |
| Leave the audit log as a normal mutable table for the laptop-local phase | Less initial engineering effort | Compliance value of "we have an audit log" is overstated if it's trivially editable by the same admin it watches | Acceptable only if explicitly documented as a known, temporary limitation communicated to whoever relies on the audit trail — not acceptable if presented as a completed compliance control |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|------------------|-------------------|
| `better-sqlite3` (synchronous API) | Wrapping the whole Express handler in `db.transaction()`, including non-DB async work (AI calls, file I/O), holding the write lock far longer than needed | Scope `db.transaction()` tightly around the minimal set of statements that must be atomic; do AI/file work outside the transaction |
| WAL mode + long-lived read connections | Assuming WAL means "no locking ever" and never checkpointing, letting the WAL file grow unbounded under sustained concurrent reads (checkpoint starvation) | Call `db.pragma('wal_checkpoint(TRUNCATE)')` on a schedule or after bulk operations once the app has more than laptop-local single-user traffic |
| SQLite file over a shared-host filesystem (the "moving to a shared host soon" path) | Placing the `.db` file on a network filesystem (NFS/SMB share) for the shared-host phase, assuming WAL "just works" there | WAL mode requires shared memory between processes on the same host; SQLite explicitly does not support WAL over network filesystems — the shared-host deployment must keep the DB file on local disk of the single host process, or move to a client/server DB (Postgres) at that point, not stay on file-shared SQLite |
| `PORTAL_AUTH` env-flag promotion from opt-in to mandatory | Flipping the flag default without an explicit account-provisioning story — mandatory auth with no initial admin account locks everyone out on first boot of a fresh (non-demo) deploy | Ship a first-run bootstrap path (seed one admin account from an env var or a one-time setup screen) before making auth mandatory by default |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Per-request application-level cache reintroduced on top of SQLite, keyed by TTL instead of a write-version counter | "I changed X but still see the old value" bug reports that come and go depending on timing | Don't cache at all in-process for SQLite-backed reads unless profiling proves it's needed; if needed, key by a version counter bumped inside the writing transaction | As soon as any read-after-write UI flow exists (which is most of this app) |
| Steering-committee pack / status report generated by re-querying and re-aggregating raw tables on every request | Report generation slows as RAID/task/synergy counts grow across a full 100-day cycle | Precompute/cache the report as a materialized snapshot generated on an explicit "generate report" action (which also gives it a natural "as of" timestamp — useful for Pitfall 12's staleness signal) rather than live-aggregating on every view | Once a single project accumulates hundreds of tasks/RAID entries/synergy line items across a full deal cycle |
| Clean-room field filtering implemented as a per-request full-object fetch followed by in-memory field deletion | Works fine at small data volumes, but doubles memory/CPU per request as record counts grow, and is easy to get subtly wrong (miss a nested field) | Filter at the SQL query level (explicit column selection per role) rather than fetch-then-strip | Once DD findings / valuation-adjacent records number in the hundreds per deal |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Treating "mandatory auth" as equivalent to "clean-room segregation" | A logged-in but out-of-clean-room user (e.g., a workstream lead with no reason to see valuation) can read MNPI simply by being an authenticated user of the app | Mandatory auth is the floor, not the ceiling — clean-room membership is a separate, deal-specific and field-specific control layered on top (Pitfall 7) |
| Auditing writes but not reads of MNPI | An audit log satisfies "who changed what" but not "who looked at the target's valuation before it was public" — for MNPI, unauthorized *read* is often the actual compliance event | Log reads of specifically flagged sensitive fields/records (target identity, valuation, retention list, org design), not just writes — this can be scoped narrowly (a handful of endpoints) rather than logging every GET |
| Assuming laptop-local means "no attacker" so at-rest protection can wait | A stolen/lost laptop, or a laptop shared with family/other apps, exposes an unencrypted SQLite file containing MNPI in plaintext | At minimum, rely on full-disk encryption (FileVault/BitLocker) as the baseline expectation and document it as a deployment requirement; if that can't be guaranteed, consider SQLite encryption (SQLCipher) before real deal data is entered, not after |
| Committing a real export/backup artifact via the existing `/api/admin/download-zip` pattern, which today explicitly excludes `node_modules` but was never designed to also exclude a real-deal DB file | The same export mechanism built for shipping demo bundles could be reused to "back up" a real deal and land in a shared location (Slack, email, another repo) without the same review the original zip export had | Explicitly separate demo-bundle export (safe to share) from real-deal data export (MNPI, needs access control and probably shouldn't be a one-click zip at all) — don't let one endpoint serve both purposes |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Steering-committee pack presents every number with equal visual confidence regardless of freshness | Executives make decisions on stale synergy/status numbers without knowing they're stale | Visually distinguish confirmed-this-period vs. carried-over-unconfirmed line items in the generated pack (Pitfall 12) |
| Clean-room restriction surfaces as a silent 403 or an empty page with no explanation | Users assume the feature is broken rather than understanding they lack need-to-know access, generating support noise that itself could leak information ("why can't I see the DD findings for Project X?") | Show a clear, generic "restricted — contact the Integration Lead for access" message that doesn't confirm or deny the existence/details of the restricted record |
| Mode-switch (demo ↔ real-deal) has no confirmation step distinguishing "you are about to view/enter real MNPI" | A user habituated to the demo's freewheeling time-travel/reset mechanics could reflexively use a real-deal equivalent action without registering the stakes changed | A visibly different UI chrome (banner, color, or explicit label) whenever real-deal mode is active, so the mode is never ambiguous from a screenshot or a glance |

## "Looks Done But Isn't" Checklist

- [ ] **SQLite migration:** Often missing a re-runnable, diffable verification step against the source `db.json` — verify the migration script can run twice from a fresh copy of the source and produce identical, checksummed output, not just "the demo looks right after running it once."
- [ ] **Mandatory auth:** Often missing coverage proof — verify by generating the full route list programmatically and confirming every single route (not just the ones remembered as sensitive) has an explicit auth decision recorded.
- [ ] **Clean-room segregation:** Often implemented as route-level gating only — verify by calling the raw API (not the UI) as a non-clean-room authenticated user and confirming sensitive fields are absent from the JSON response, not merely hidden in the rendered page.
- [ ] **Audit log:** Often missing tamper-resistance — verify there is no code path (including admin-token-gated ones) that can UPDATE or DELETE an audit row, and that the audit write commits in the same transaction as the write it records.
- [ ] **Demo/real-deal separation:** Often separated at the data-store level but not the function level — verify time-travel/gamification/leaderboard functions are unreachable by direct API call in real-deal mode, not just absent from the real-deal UI.
- [ ] **Synergy/IMO reporting:** Often adds fields (baseline, phasing) without adding history or staleness signals — verify the generated pack visibly distinguishes confirmed-this-period numbers from carried-over ones, and that baseline changes are reconstructable after the fact.
- [ ] **Data export (new this milestone — `PROJECT.md` notes none exists today):** Often built as a single generic "export everything" endpoint reusing the existing zip-export pattern — verify it's explicitly scoped/access-controlled separately from the demo-bundle export, given the demo export was designed to be safely shareable and a real-deal export is not.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|-----------------|------------------|
| Migration reshaped data without normalizing (Pitfall 1) | MEDIUM | Add proper tables/foreign keys alongside the existing blob columns, backfill via a script that reads the JSON blobs once, then cut queries over incrementally — painful but not a rewrite if done before much real data accumulates |
| Migration is a one-way door and a bug surfaces after real data entry (Pitfall 2) | HIGH | If the pre-migration `db.json` snapshot was preserved (per the prevention strategy), replay: re-run migration fresh, then manually reconcile the delta of real-deal records entered since cutover against the newly-migrated base — costly but recoverable only because the snapshot exists |
| Auth retrofit missed routes (Pitfall 5) | LOW–MEDIUM | Run the programmatic route enumeration retroactively, diff against the auth-decision checklist, patch gaps — cheap to fix once discovered, expensive only in proportion to how long the gap went undetected |
| Clean-room segregation was route-level only, not field-level (Pitfall 7) | MEDIUM | Add server-side field filtering to the affected endpoints; audit whether any out-of-clean-room user's API access logs (if audit-logged reads exist, per the Security Mistakes table) show the gap was actually exploited |
| Audit log discovered to be editable (Pitfall 8) | LOW | Add a DB trigger blocking UPDATE/DELETE on the audit table going forward; historical rows can't be un-tampered retroactively, but the control becomes real from that point on |
| Synergy double-counting discovered after a steering-committee pack was already presented (Pitfall 12) | MEDIUM–HIGH | Requires manual reconciliation and, likely, a correction communicated to whoever received the pack — the data-model fix (overlap flags, single ownership) is cheap; the trust repair with stakeholders is the expensive part |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|--------------------|----------------|
| Migration reshapes instead of normalizing (1) | Foundation — SQLite migration | New schema reviewed table-by-table against which capability areas depend on real columns vs. legitimate JSON blobs |
| Migration is irreversible / unverifiable (2) | Foundation — SQLite migration | Migration script is re-runnable from a fresh source snapshot with identical, diffable output; pre-migration `db.json` archived permanently |
| Stale-cache pattern reintroduced (3) | Foundation — SQLite migration | No TTL-based application cache introduced on top of SQLite reads; any cache is version-counter-keyed |
| Wrong transaction boundaries (4) | Foundation — SQLite migration + audit log | `db.transaction()` wraps domain operations (remediation-linkage, project activation, every audit-logged write), not HTTP handlers wholesale |
| Auth retrofit route gaps (5) | Foundation — mandatory auth | Programmatically generated route list has 100% explicit auth-decision coverage; global allow-list middleware, not per-route opt-in |
| Read-endpoint MNPI exposure treated as lower priority (6) | Foundation — mandatory auth | Read endpoints returning target/valuation/retention/org-design data are gated in the same phase as writes, not deferred |
| Clean-room as route-gate not field-filter (7) | Due diligence workspace | Raw API response (not UI) verified to omit sensitive fields for a non-clean-room authenticated user |
| Audit log not tamper-resistant (8) | Foundation — audit log | DB-level trigger prevents UPDATE/DELETE on audit table; audit write is transactionally coupled to the write it records |
| Demo/real-deal shared mutating functions (9) | Foundation — demo/real separation | Time-travel/gamification functions gated at their own entry point, confirmed unreachable via direct API call when real-deal mode is active |
| Frontend global-state mode leak (10) | Foundation — demo/real separation | Client storage keys namespaced by mode/project; mode-switch clears or re-namespaces client caches |
| Real DB committed to git (11) | Foundation — SQLite migration | `.gitignore` updated and verified (`git check-ignore`) before any real-deal data is entered; demo and real-deal file paths designed to never collide |
| Untrustworthy synergy/IMO numbers (12) | Synergy value capture + IMO reporting/exports | Generated reports visibly distinguish confirmed vs. stale line items; baseline changes are append-only and reconstructable; overlapping-claim flag exists in the data model |

## Sources

- [SQLite: Write-Ahead Logging (official docs)](https://sqlite.org/wal.html) — HIGH confidence, primary source: single-writer/multiple-reader model, checkpoint starvation, WAL not supported over network filesystems
- [better-sqlite3 performance docs (WiseLibs, official)](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) — HIGH confidence, primary source: WAL concurrency behavior in Node.js context
- [SQLite Forum: WAL journal and threading mode](https://sqlite.org/forum/info/461653af585fb599) — MEDIUM confidence, community discussion cross-checked against official docs
- `.planning/codebase/CONCERNS.md` (2026-07-18 analysis) — HIGH confidence, direct codebase inspection; used as the baseline this document extends rather than repeats
- `.planning/PROJECT.md` (2026-07-23) — HIGH confidence, direct project scope document
- `.planning/codebase/TESTING.md` (2026-07-18 analysis) — HIGH confidence, direct codebase inspection; confirms no test harness exists to catch these pitfalls automatically, which is why verification steps above are specified as manual/scripted checks rather than "add a test"

---
*Pitfalls research for: demo-to-production M&A integration portal (file-store→SQLite migration, mandatory auth retrofit, MNPI handling, IMO/synergy reporting trust)*
*Researched: 2026-07-23*
