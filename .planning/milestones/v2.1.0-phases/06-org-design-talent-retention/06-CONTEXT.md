# Phase 6: Org Design & Talent Retention - Context

**Gathered:** 2026-08-06
**Status:** Ready for planning

<domain>
## Phase Boundary

The IL can represent the acquired organisation's structure and manage sensitive
people decisions beyond the current flat employee list. In scope:

- **ORG-01** — organisation structure and role mapping (role, level, reports-to,
  mapped employee) beyond the flat `employees` list.
- **ORG-02** — role-selection / redundancy decisions recorded against roles or
  people.
- **ORG-03** — a key-talent flight-risk register (risk level, owner, mitigation)
  readable only by authorized users, with access to it audited.

Plus one in-phase security closure the decisions below deliberately pull in:
outbound clearance-filtering on `/api/raid` (the Phase-4 accepted risk T-04-21),
because this phase creates a second route for clearance-restricted content into
that unfiltered log.

Out of scope — belongs to **Phase 7 (IMO Reporting & Exports)**: CSV/JSON export
of org data, the steerco pack, and any cross-lane report assembly. This phase
produces the data model and the in-app views those reports will read.

**Depends on Phase 4**, specifically `db/accessPolicy.js` — whose own header
comment already names this phase's flight-risk register as its intended second
consumer, "rather than inventing a second row/area-level access-policy pattern".

</domain>

<decisions>
## Implementation Decisions

23 decisions, all chosen explicitly by the user (23/23 recommendations taken).

### Sensitivity & clearance model

- **D-01:** Clean-room restriction is **tiered, not whole-lane**. Current-state
  org structure is readable by any member of the deal; **target-state design,
  role-selection/redundancy decisions, and the flight-risk register are
  restricted**. Rationale: matches real PMI practice (the as-is org is shared
  with workstream leads to plan integration work; the to-be design, selection
  decisions and retention lists are not) and keeps the org chart useful.
  Rejected whole-lane (workstream leads lose the chart, which is most of what a
  chart is for) and flight-risk-only (a redundancy decision against a named
  person is as sensitive as a flight-risk entry).
  — **Reversibility:** costly — the tier boundary is baked into every list
  filter, the rollup route, and the `state` field's own filter path; tightening
  or loosening it later means revisiting each read path.

- **D-02:** The clearance unit is the **existing DD `hr` area grant**, resolved
  through `db/accessPolicy.js`'s `grantedAreas(deal, user)` /
  `hasAreaGrant()` / `assertAreaGrant()`. **No new grant dimension**, no change
  to `deal.memberGrants[username].ddAreas`, no new admin grants UI. `admin` and
  `hrbp` already short-circuit to every area.
  **Cost surfaced and accepted before choosing:** HR *diligence* clearance and
  retention-list clearance become the same key — you cannot clear someone for HR
  DD requests without also handing them the org decisions and flight-risk
  register. Rejected an additive `orgAccess` dimension (independently grantable,
  but a second grant dimension in the editor and a second filter helper) and
  role-based IL+admin-only (contradicts Phase 4's D-16 contributor model).
  — **Reversibility:** costly — splitting the key later means adding a grant
  dimension, migrating existing deal records' `memberGrants`, and re-pointing
  every org read path.

- **D-03:** **Both denials AND successful reads of the flight-risk register are
  audited**, scoped to that register only (not the whole lane). ORG-03's wording
  is stronger than DD-04's — "access to it audited" means who *looked at* the
  retention list, which is the actual MNPI compliance question.
  **This requires NEW code:** `audit.db` is write-triggered today (the hook
  fires from `db/store.js`'s `writeDb()`); there is no read-side audit path
  anywhere in the codebase. Denials follow the existing pattern —
  `db/auditHook.js#recordSecurityEvent()` called from a server.js choke point,
  exactly as `refuseDdArea()` does, with `db/accessPolicy.js` holding no audit
  dependency itself.
  Rejected denials-only (a narrower reading a verification gate would likely
  challenge) and once-per-session (needs session-scoped dedupe with no precedent
  here, and is a weaker record).

- **D-04:** **Write authz is split, and stated explicitly rather than left to
  inference.** Area-cleared members may create and maintain **org structure**
  (Phase 4 D-16 shape). **Only IL (`hrbp`) and `admin`** may record a
  role-selection/redundancy decision or create/edit a flight-risk entry (Phase 5
  D-15 shape) — these are governance acts with legal and severance consequences.
  Enforced **server-side in the route handler, as its first statement, before
  any lookup**, mirroring D-15's proven pattern; never by hiding controls in the
  UI. This is spelled out because an authz bug has surfaced at a review or
  verification gate in **five consecutive phases**.

### Org structure model

- **D-05:** A **position is a first-class entity**, not a field on an employee.
  New deal-scoped collection (`orgPositions`) holding at minimum
  `{ id, title, level, reportsToId, employeeId|null, state }`. A position can
  exist with nobody in it (an open role, or a to-be design drawn before
  selection), and a person is mapped later. This is what makes ORG-02 possible
  at all — "role selection" means deciding **who fills a position**.
  Rejected extending `employees` with `reportsTo`+`level` (an employee row *is*
  a person, so a vacant role cannot be drawn, a target org cannot be designed
  before naming people into it, and it entangles the org lane with the demo
  gamification fields `points`/`badge`/`completedLessons` already on that row)
  and replacing `employees` entirely (that collection is load-bearing for the
  demo showcase — leaderboard, academy, signage, pulses — which PROJECT.md
  protects).
  — **Reversibility:** costly — the position id becomes the anchor for
  decisions, flight-risk entries, the tree render and the rollup; collapsing
  back into `employees` is a data migration plus a rewrite of every read path.

- **D-06:** **Two states — current and target — on one position record**
  (e.g. a `state: 'current' | 'target'` discriminator). Org *design* is
  inherently about the to-be org; without a target state, ORG-02's "role
  selection" has no destination to select into. Rejected one-org-edited-in-place
  (loses the before/after that makes a design reviewable, and a redundancy
  decision has nothing to point at) and named scenarios/versions A/B (scenario
  management, comparison UI and a "which is live" concept — its own phase).

- **D-07:** **Target state is restricted; current state is open.** The to-be
  design is exactly the "named org design" PROJECT.md lists as MNPI, and it
  implies who is *not* in it — so it sits behind the same `hr` grant as
  decisions and flight-risk, per D-01/D-02. **Consequence the planner must
  handle:** the list filter keys on the `state` field as well as the collection,
  so one filter is doing two jobs — this is the most likely place in the phase
  for a leak, and warrants its own test.

- **D-08:** `level` is **free-text with a suggestion datalist** (e.g. IC /
  Manager / Director / VP / Exec), not an enum. TE has its own grading scheme
  this app has no knowledge of, and hard-coding the wrong one is worse than
  none. Accepted cost: no reliable headcount-by-level rollup, since "Dir" and
  "Director" do not group. Rejected a fixed enum (would enable rollups and
  span-of-control, but enums in this repo get duplicated across server,
  validator and client and must move together — and a wrong band set is a data
  migration) and deriving numeric depth from `reportsTo` (depth is not
  seniority, and ROADMAP criterion 1 names `level` explicitly).

### Populating & visualising

- **D-09:** The person on a position is a **link to an `employees` row**
  (`position.employeeId → employees[].id`), not a free-text name. Populating the
  org finally gives a real deal its acquired roster in the collection the rest
  of the app already understands, so one person has one record.
  **Verified safe:** ISO-02 hard-gates the demo gamification mechanics
  (XP/points/leaderboards) out of real-deal databases entirely, so those fields
  simply stay unset on a real deal's employee rows. Accepted cost: two writes to
  create one person-in-a-role, and **deleting an employee must be guarded
  against orphaning a position**. Rejected free-text (the same person in a
  current and a target position becomes two strings that drift; no single roster
  for Phase 7) and an either/or optional link (every read path handles two
  shapes and "is this the same person" becomes unanswerable).

- **D-10:** Population is **manual add PLUS a bulk paste importer** (a pasted
  CSV or JSON block of `title, level, reportsTo, name, email` rows). Precedent
  exists on the demo side — `public/pmo.html`'s "Paste Roster JSON or CSV
  Content" textarea — so the interaction is not novel. A 150-person target is
  unworkable manually, and PROJECT.md's core value is explicitly "without
  keeping a parallel spreadsheet". Rejected manual-only (sends the IL back to
  Excel) and a CSV **file** upload (needs upload handling, size limits and
  content-type validation, where paste reuses the existing JSON write pipeline
  and its zod schema directly).

- **D-11:** The structure renders as a **collapsible indented tree of position
  cards** — each node a styled card (title, level, occupant, decision badge)
  indented by depth, with expand/collapse. Pure DOM, no layout maths, handles
  200+ positions, searchable, and degrades correctly at narrow widths. Rejected
  a CSS-drawn boxes-and-lines chart (best-looking in a screenshot, but
  hand-rolled connector layout with no library, unreadable past ~4 levels or a
  wide span, and it breaks first at narrow widths — the exact class of visual
  regression already flagged on this project) and building both (two renderers
  to style, sync and re-verify at multiple widths — realistically a second wave).

- **D-12:** The org surface is a **new page: `public/org.html` +
  `public/js/org.js`**, mirroring `public/due-diligence.html` /
  `public/js/due-diligence.js`. **It gets NO `pageAccess` entry in
  `public/js/transitions.js`** — deliberately, following the IN-02 precedent
  recorded in that file's own comment: access here is per-deal-member clearance,
  not role, so a client-side role gate would be the wrong control and would
  fight the server one. Rejected a tab in `execution.html` (already 1,100 lines
  and owner of the entire synergy lane, with a DOM-structure bug in its history)
  and a panel on the deal home (`deal-home.js` is deliberately a rollups-only
  surface that can be grep-asserted as a whole — an editable register breaks
  that property).

### Decision register (ORG-02)

- **D-13:** A decision lives in an **append-only `orgDecisions` log**
  (`{ id, positionId, employeeId, type, rationale, decidedBy, decidedAt,
  effectiveDate }`); a position's **current decision is derived** as its latest
  entry, never stored on the position. Directly follows Phase 5's D-12 (an
  in-app, member-readable governance record distinct from admin-only `audit.db`)
  and Phase 5's D-22 (denormalising a link in both directions means every delete
  path must clean up two places). Rejected a `decision` field on the position (a
  reversal a week later overwrites the original with no rationale trail, leaving
  the record only in admin-only `audit.db`) and log-plus-denormalised-field.

- **D-14:** The decision vocabulary is **five values: `retain`, `redeploy`,
  `in-selection`, `redundant`, `open`**. `in-selection` matters because most of
  a live deal sits in that state for weeks; `open` distinguishes a vacant
  position from an undecided one. Rejected three values (`redeploy` and
  `redundant` are legally and financially different outcomes) and free-text (no
  rollup possible — Phase 7's steerco pack would have nothing countable).
  **Verified cost:** an enum in this repo gets duplicated across `server.js`,
  its validator and the client and **MUST move together** — `RAID_LEVELS` and
  `SYN_STATUSES` both did, and each has an anti-drift test. Budget ~5 i18n keys
  × 4 languages (EN/DE/ZH/CS).
  — **Reversibility:** costly — changing the vocabulary later means migrating
  stored `orgDecisions` rows plus the three code copies and the i18n keys.

### Flight-risk register (ORG-03)

- **D-15:** An entry carries **`mitigation` free text (per ORG-03) AND
  one-click conversion** into a Day-1 integration task and/or a RAID entry,
  bidirectionally linked — the same spine Phase 4's D-12 built for DD findings,
  which PROJECT.md calls "the best linkage in the app". Justified by live data:
  `data/demo.db` already holds RAID entry `raid_seed_1` — *"Key sensing R&D
  engineers approached by competitors"*, `ws_hr`, *"Retention packages
  approved; 1-on-1s in progress"* — i.e. the register and RAID are already
  describing the same thing with no link between them.

- **D-16:** Risk level **reuses RAID's four levels — `low` / `medium` / `high` /
  `critical`**. Phase 4's D-11/D-26 extended RAID to four specifically so a
  finding's severity passes through conversion with no lossy downgrade; the same
  argument applies verbatim here. Zero new enum, zero new i18n keys, and the two
  existing copies (`server.js` ~3840 and `validators/workstream.js`) already
  have an anti-drift test. Rejected a dedicated 3-level scale (needs a lossy
  mapping table at conversion) and an impact×likelihood grid (two fields plus a
  derived score everyone must agree on before Phase 7 can rank by it).

### In-phase security closure

- **D-17:** **Outbound clearance-filtering on `/api/raid` is closed in this
  phase** — the Phase-4 accepted risk T-04-21, previously deferred to a
  hardening phase. Rationale: D-15 deliberately creates a *second* route for
  clearance-restricted content into an unfiltered log, and the leak is already
  **proven live once** (converting a Legal DD finding republished its title and
  notes through `/api/raid` to a member cleared only for `hr`). Closing it here
  also retro-fixes the Phase-4 instance.
  **Accepted cost:** this widens the phase's blast radius into the RAID lane
  (`server.js` RAID routes and their client consumers), code this phase would
  otherwise only write to. Rejected deferring again (the phase would knowingly
  ship a second instance of a leak it created) and neutral-titled RAID entries
  (a RAID log full of "Retention risk #4" is materially less useful in the
  steerco review RAID exists for).

### Demo showcase

- **D-18:** The demonstration showcase **gets a hand-tuned org lane seed** over
  the 5 existing `data/demo.db` employees — including flight-risk entries with
  fictional names — following Phase 5's D-10 (hand-tuned, not mechanical, so the
  showcase actually demonstrates the capability). The seed is small and a
  collapsible org tree with decision badges is the most visual thing this phase
  produces. Rejected structure-only (a third of the phase would have no showcase
  representation) and real-deal-only (the Phase-4 precedent — the demo never got
  a DD workspace — but the showcase then stops tracking what the tool can do).
  **⚠ Standing trap:** any write to a committed WAL-mode `.db` can land only in
  the gitignored `-wal` sidecar, leaving the tracked file byte-unchanged and
  `git status` clean. Run `PRAGMA wal_checkpoint(TRUNCATE)` and diff `demo.db`
  against HEAD before trusting a clean tree. This has fired in **every** phase
  that touched a committed `.db`.

### Deal home & rollups

- **D-19:** The deal home gains a **two-tier org panel**. Open tier: current
  headcount, open positions. Restricted tier: target headcount, the
  current→target **headcount delta**, counts by decision type, and unmitigated
  high/critical flight risks. The delta is the number a steerco actually asks
  for, and Phase 4 (D-19) and Phase 5 (D-19) both added a deal-home surface —
  skipping it would make org the only capability with no home presence.

- **D-20:** For an uncleared member, restricted lines are **absent entirely —
  not zeroed, not masked**. The server omits them from the response so the
  client has nothing to draw. This is Phase 4's T-04-46 rule, proven in UAT by
  confirming uncleared areas were absent from **raw `innerHTML`**, not merely
  displaying zero. A masked row still discloses that decisions exist; a zero is
  itself information.

- **D-21:** The rollup comes from a **new `GET /api/org/summary`**,
  server-computed and clearance-scoped, mirroring `GET /api/dd/summary` (and
  Phase 5's `GET /api/synergies/rollup`). It is the only option that satisfies
  `deal-home.js`'s stated no-client-side-computation invariant. Rejected
  client-side tallying **on a security ground, not a stylistic one**: computing
  the target-headcount delta in the browser means shipping target-state position
  rows to the client and hiding them there — precisely the "hidden in the UI
  rather than filtered server-side" failure DD-04 forbids. Also rejected
  extending `GET /api/deals` (a control-plane route serving the switcher and
  admin console, which would then compute org tallies for every caller).

- **D-22:** Flight-risk owners are **nudged via the existing deal-home
  owner-nudge pattern** (Phase 4 D-21, reused by Phase 5 D-19) for unmitigated
  high/critical entries they own. No new notification surface, no email. The
  nudge is itself restricted content and must be clearance-scoped like the rest
  of the restricted tier. Rejected also nudging on stalled `in-selection`
  positions (would re-introduce the staleness machinery deferred in D-23).

### Explicitly deferred

- **D-23:** **No staleness signal on the flight-risk register this phase.**
  ORG-01/02/03 and all three ROADMAP success criteria are silent on it, and
  SYN-05 was its own requirement with a three-decision model behind it — adding
  it here is a new capability inside a phase that already has three.
  **Flagged risk:** Phase 7's RPT-04 says "the staleness signals (SYN-05 **and
  equivalents**)" — that wording may have meant this, so Phase 7 may find it
  missing. Recorded in Deferred Ideas.

### Claude's Discretion

No area was delegated with "you decide" — all 23 decisions were chosen
explicitly. The planner retains normal latitude on:

- The exact `orgPositions` field set beyond the ones D-05 names (e.g. an
  area/workstream tag, FTE, location) — add what the tree and rollup actually
  need, nothing speculative.
- The orphan-guard behaviour when an employee linked by D-09 is deleted (refuse
  the delete, or null the link and surface the position as vacant).
- Import column-mapping tolerance for D-10 (header casing variants, how a
  `reportsTo` referencing a not-yet-created row is resolved, and whether a
  partially-valid paste is rejected wholesale or row-by-row).
- Where unassigned employees and vacant positions render in the D-11 tree.
- i18n key naming for the D-14 vocabulary and any new labels.
- Whether `orgPositions` / `orgDecisions` / the flight-risk register are three
  collections or fewer, and their exact naming — following the blob-per-row
  convention and the `db/collections.js` + `db/schema.sql` registration pattern.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` — Phase 6 section: goal, "Depends on: Phase 4" and the
  three success criteria this phase is verified against. Criterion 1 names the
  field set (`role, level, reports-to, mapped employee`) that D-05/D-08 build on.
- `.planning/REQUIREMENTS.md` §Org Design & Talent Retention — ORG-01, ORG-02,
  ORG-03 exact wording. ORG-03's "restricted to authorized roles and audited as
  sensitive data" is the basis for D-03.
- `.planning/PROJECT.md` §Constraints — names "retention lists, named org
  designs" as MNPI examples; the stated basis for D-01/D-07, and §Compatibility
  (the demo showcase is a maintained deliverable) for D-18.

### The access-control primitive this phase consumes
- `db/accessPolicy.js` — `DD_AREAS` / `DD_AREA_IDS`, `grantedAreas()`,
  `hasAreaGrant()`, `filterByAreaGrant()`, `assertAreaGrant()`,
  `AreaAccessError`. **Read its header comment**: it explicitly anticipates this
  phase's flight-risk register as its second consumer and explains why it holds
  no audit dependency and never opens its own connection.
- `.planning/phases/04-due-diligence-workspace/04-CONTEXT.md` — D-01/D-03/D-16
  (the clean-room model), D-12 (bidirectional conversion, reused by D-15),
  D-19/D-21 (deal home + owner nudges, reused by D-19/D-22), D-23
  (`deal.memberGrants` shape), D-26 (four-level RAID severity, reused by D-16).
- `.planning/phases/05-synergy-value-capture/05-CONTEXT.md` — D-10 (hand-tuned
  demo seed, reused by D-18), D-12 (in-app governance record vs `audit.db`,
  reused by D-13), D-15 (server-side governance authz, reused by D-04), D-19
  (nudge reuse), D-22 (why not to denormalise both directions).
- `.planning/phases/03-deal-isolation-audit-log-write-validation/03-CONTEXT.md` —
  the resolver, membership, audit and validation foundation everything rides on.

### The security debt this phase closes
- Phase 4 security audit finding **T-04-21** (`/api/raid` outbound clearance
  filtering) — the accepted risk D-17 converts into in-phase work. Recorded in
  `.planning/phases/05-synergy-value-capture/05-CONTEXT.md` §Deferred Ideas and
  in the Phase 4 security artifacts.

### The code surfaces this phase touches
- `db/collections.js` — `ARRAY_COLLECTIONS` (35 entries, with a hard
  length assertion that WILL throw if a collection is added without updating the
  count) and the physical-file routing map.
- `db/schema.sql` — one `CREATE TABLE IF NOT EXISTS` + `project_id` index per
  collection; `ddFindings` / `ddRequestItems` (lines ~165–187) are the exemplar.
- `db/dealSeed.js` — `DEAL_SEED_COLLECTIONS` is an **allowlist**
  (`['checklistTemplates','assessmentTemplates','processCatalog',
  'ddRequestTemplates']`). New collections are not on it and therefore start
  empty in every real deal — including `employees`, which is why D-10's import
  path exists at all.
- `db/auditHook.js` — `recordSecurityEvent()` (the D-03 denial path) and
  `writeAuditBatch()` fired from `db/store.js`'s `writeDb()` (why D-03's
  successful-read audit is new code).
- `validators/` + `validators/index.js#registerSchema(method, path, schema)` —
  every new write route needs a schema or `test/write-validation-coverage.test.js`
  fails the suite. `validators/dd.js` is the closest analog.
- `public/due-diligence.html` + `public/js/due-diligence.js` — the D-12 page
  template, including its `textContent`-only discipline.
- `public/js/deal-home.js` — the D-19/D-20/D-21/D-22 target. Read its header:
  the no-client-side-fallback-list invariant and the deliberate absence of any
  audit-route reference are grep-asserted acceptance criteria of a passing plan.
- `public/js/transitions.js` ~line 145 — the `pageAccess` map and the IN-02
  comment explaining why `due-diligence.html` has no entry (D-12 follows it).

</canonical_refs>

<code_context>
## Existing Code Insights

### Scout finding: this lane is greenfield

App-wide grep for `reportsTo` / `orgChart` / `flightRisk` / `redundanc` /
`retention` / `headcount` across `*.js` and `*.html` returns **zero structural
matches** — only prose in `public/playbook.html`, `ragService.js`, `aiService.js`
and one seeded RAID row. There is no org hierarchy, no position concept, no
retention register anywhere. Everything in D-05…D-16 is new construction.

### Reusable Assets

- **`db/accessPolicy.js`** — the entire D-01/D-02/D-07 access model is a
  consumer of this module. `grantedAreas()` already returns all areas for
  `admin`/`hrbp` and fails closed on a null deal.
- **`POST /api/integration-tasks/from-remediation` (`server.js` ~2996–3026)** —
  the conversion spine. Note the `source` dedupe (`if (lane.some(t => t.source
  === source)) return`) that Phase 5's D-22 deliberately did not overload;
  D-15's conversion should follow Phase 4's `dd-finding:<id>` source convention.
- **`GET /api/dd/summary`** — the exact shape D-21's `GET /api/org/summary`
  mirrors, including the "no explicit role gate because every number is already
  clearance-scoped before any tally runs" reasoning recorded in Phase 4.
- **`newId(prefix)`** — collision-resistant id generator; use it for positions,
  decisions and risk entries rather than array indices.
- **`public/pmo.html` roster paste textarea** (`#wiz-roster-raw`, "Paste Roster
  JSON or CSV Content") — the D-10 interaction precedent, demo-side.
- **RAID four-level severity** (`server.js` ~3840 + `validators/workstream.js`,
  with an anti-drift test) — reused directly by D-16.
- **Banner/badge system + deal-home nudge pattern** — D-22.

### Established Patterns

- **Duplicated enums move together.** `RAID_LEVELS` and `SYN_STATUSES` each
  exist independently in server, validator and client copies, each with an
  anti-drift test. D-14's five-value vocabulary inherits this — a partial edit
  is a known failure mode in this repo.
- **Server-side authz in the route, never UI hiding** — DD-04 and D-15. D-04
  restates it because an authz bug has hit a gate in five consecutive phases.
- **Invisibility, not zeroing** — Phase 4's T-04-46. D-20 applies it to the
  rollup.
- **`textContent`-only rendering** on every new surface; write-time
  `sanitizeHtml` only for fields explicitly tagged `htmlField()`.
- **Blob-per-row collections** with `id`/`project_id` extracted as metadata
  columns; register in `db/collections.js` **and** `db/schema.sql`.
- **Cache-stamp `?v=` bump** whenever a JS file changes.
- **`data/deals/` is currently empty** — no real deal database exists yet, so a
  new-collection addition strands no live data.

### Integration Points

- `db/collections.js` + `db/schema.sql` — new collections (count assertion will
  throw if the length is not updated).
- `validators/` — a new module (e.g. `validators/org.js`) registering every new
  write route, or the coverage test fails.
- `server.js` — new `/api/org*` routes; the D-03 denial choke point; the D-17
  `/api/raid` outbound filter (the one edit outside the org lane).
- `public/js/deal-home.js` — the D-19 panel, rendered strictly from
  `GET /api/org/summary`.
- `public/js/transitions.js` — nav entry for `org.html`; **no** `pageAccess`
  entry (D-12).
- `data/demo.db` — the D-18 hand-tuned seed, subject to the WAL checkpoint trap.

### Known trap (carried forward, has fired in every phase touching a .db)

A SQLite write against a git-committed WAL-mode `.db` can land **only** in the
gitignored `-wal` sidecar, leaving the tracked file byte-unchanged and
`git status` clean. Run `PRAGMA wal_checkpoint(TRUNCATE)` before close and diff
the committed `.db` against HEAD before trusting a clean tree.

</code_context>

<specifics>
## Specific Ideas

- The org tree is described as a **collapsible indented tree of position cards** —
  the cards carry the visual weight, not connector lines (D-11).
- The decision vocabulary is fixed and named: **`retain` / `redeploy` /
  `in-selection` / `redundant` / `open`** (D-14).
- The deal-home number that matters most is the **current→target headcount
  delta** (D-19).
- The demo RAID row `raid_seed_1` ("Key sensing R&D engineers approached by
  competitors") is the concrete example of the register/RAID overlap D-15 links
  together.

</specifics>

<deferred>
## Deferred Ideas

- **Staleness signal on the flight-risk register** — explicitly deferred (D-23).
  ORG-01/02/03 are silent on it. **Flagged for Phase 7:** RPT-04's wording is
  "the staleness signals (SYN-05 and equivalents)", so Phase 7 may find this
  missing and need to decide whether to add it then.
- **Named org-design scenarios (Option A / Option B) with comparison** —
  rejected under D-06 as its own phase's worth of scenario management,
  comparison UI and a "which one is live" concept.
- **Fixed `level` enum enabling headcount-by-level and span-of-control rollups**
  — rejected under D-08 pending knowledge of TE's real grading bands.
- **Impact × likelihood flight-risk grid** — rejected under D-16 in favour of
  RAID's four levels; revisit if the single axis proves too coarse.
- **Nudging on positions stalled in `in-selection`** — rejected under D-22
  because it re-introduces the deferred staleness machinery.
- **Linking a redundancy decision to a synergy initiative's cost-to-achieve**
  (severance as SYN-02 cost) — never in ORG-01/02/03 and not discussed as a
  requirement; a genuinely attractive future linkage but a new capability, not a
  clarification of this phase.
- **A boxes-and-lines org chart view** — rejected under D-11 on layout and
  narrow-width grounds; revisit if the indented tree proves unpersuasive in UAT.
- **Org data in the Phase 7 export** — RPT-01 names only "workstreams, tasks,
  RAID and synergies". Whether org/decisions/flight-risk join the export is a
  Phase 7 scope question, noted here so it is not silently dropped.

### Reviewed Todos (not folded)

- **`new-deal-setup-wizard`** (`.planning/todos/pending/new-deal-setup-wizard.md`)
  — surfaced by `todo.match-phase 6` at score 0.4 on the single keyword "phase".
  Not folded: it is WIZ-01, already delivered and closed in Phase 4. A stale
  keyword match, not a real candidate.

</deferred>

---

*Phase: 6-Org Design & Talent Retention*
*Context gathered: 2026-08-06*
