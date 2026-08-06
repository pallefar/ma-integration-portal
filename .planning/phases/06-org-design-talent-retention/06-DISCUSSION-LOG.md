# Phase 6: Org Design & Talent Retention - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-06
**Phase:** 6-Org Design & Talent Retention
**Areas discussed:** Sensitivity & clearance model, Org structure model, Populating & visualising the org, Decision & flight-risk registers, Deal home & rollups (follow-up round)

**Area selection:** all four offered gray areas were selected. Two additional
rounds followed — three consequence questions raised by the user's own choices,
then a deal-home/rollups round the user explicitly asked for at the closing gate.

**Outcome: 23 of 23 recommendations taken.**

---

## Sensitivity & clearance model

### How much of the Phase-6 lane is clean-room restricted?

| Option | Description | Selected |
|--------|-------------|----------|
| Tiered — structure open, decisions+risk restricted | Current-state structure open to deal members; decisions and flight-risk behind clearance. Matches real PMI practice. Cost: two rules, two filter paths. | ✓ |
| Whole lane restricted | Safest for MNPI. Cost: workstream leads lose the org chart entirely. | |
| Only the flight-risk register restricted | Literal ORG-03 reading, cheapest. Cost: leaves named redundancy decisions open to every member. | |

**User's choice:** Tiered.
**Notes:** Raised at the time — if a target-state design emerges in Area 2, it needs its own tier assignment. Resolved there as D-07.

### What is the clearance unit?

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse the DD `hr` area grant | Zero new mechanism; accessPolicy.js built for it. Cost: HR diligence clearance and retention-list clearance become the same key. | ✓ |
| New additive `orgAccess` grant dimension | Independently grantable. Cost: second dimension in the admin editor + second filter helper. | |
| Role-based IL+admin only | Strictest. Cost: contradicts D-16's contributor model; IL maintains everything alone. | |

**User's choice:** Reuse the `hr` grant.
**Notes:** The coupling cost was stated before the choice and accepted.

### What gets audited for the flight-risk register?

| Option | Description | Selected |
|--------|-------------|----------|
| Denials + successful reads | Truest to ORG-03's "access to it audited". Cost: audit.db is write-triggered today — a read-side path is new code. | ✓ |
| Denials only (mirror DD-04) | Zero new machinery. Cost: narrower reading a gate would likely challenge. | |
| Denials + one "register opened" per session | Middle ground. Cost: session-scoped dedupe with no precedent here. | |

**User's choice:** Denials + successful reads.

### Who can write in this lane?

| Option | Description | Selected |
|--------|-------------|----------|
| Split — cleared members maintain structure, IL+admin record decisions and risk | Combines D-16 and D-15 shapes. Cost: two authz rules, so it must be stated explicitly. | ✓ |
| IL+admin write everything | One rule, hardest to get wrong. Cost: IL hand-enters the whole structure. | |
| Cleared members write everywhere | Maximum contribution. Cost: anyone cleared could record a redundancy decision against a named person. | |

**User's choice:** Split.

---

## Org structure model

### What is the unit of the org structure?

| Option | Description | Selected |
|--------|-------------|----------|
| Position as a first-class entity, employee optionally mapped | Makes vacant roles and pre-selection design possible. Cost: two entities to sync. | ✓ |
| Extend `employees` with reportsTo + level | Smallest change. Cost: cannot draw a vacant role or design a target org; entangles with demo gamification fields. | |
| Position entity replacing `employees` | One entity. Cost: `employees` is load-bearing for the protected demo showcase. | |

**User's choice:** Position as a first-class entity.

### One org, or current-state AND target-state?

| Option | Description | Selected |
|--------|-------------|----------|
| Two states on one position record | Org *design* is inherently to-be; ORG-02 selection needs a destination. Cost: state toggle in every view; clearance line must split. | ✓ |
| One org, edited in place | Simplest. Cost: loses the reviewable before/after. | |
| Two states as named scenarios/versions | Richest. Cost: scenario management + comparison UI — its own phase. | |

**User's choice:** Two states on one record.

### Which side of the tiered clearance line does the target state sit on?

| Option | Description | Selected |
|--------|-------------|----------|
| Target restricted, current open | To-be design is the "named org design" MNPI example; it implies who is not in it. Cost: filter keys on the state field too. | ✓ |
| Both states open; only registers restricted | Cleanest filter. Cost: a target org with vacancies is a redundancy list in all but name. | |
| Both restricted — revert Area 1 to whole-lane | Strictest. Cost: undoes why tiered won. | |

**User's choice:** Target restricted, current open.

### What does `level` mean?

| Option | Description | Selected |
|--------|-------------|----------|
| Free-text with suggestions | TE's real grading scheme is unknown to the app. Cost: no reliable grouping or by-level rollup. | ✓ |
| Fixed enum IC/Lead/Manager/Director/VP/Exec | Enables rollups. Cost: triplicated enum + migration risk if TE's bands differ. | |
| Numeric depth derived from reportsTo | Free from the tree. Cost: depth ≠ seniority; ROADMAP criterion 1 names `level` explicitly. | |

**User's choice:** Free-text with suggestions.

---

## Populating & visualising the org

### How is the person on a position represented?

| Option | Description | Selected |
|--------|-------------|----------|
| Link to an `employees` row | One person, one record; ISO-02 keeps gamification out of real deals. Cost: two writes; orphan guard needed on employee delete. | ✓ |
| Free-text name + email on the position | One write. Cost: strings drift; no single roster for Phase 7. | |
| Either — optional link, free-text fallback | Most forgiving. Cost: two shapes in every read path. | |

**User's choice:** Link to an `employees` row.

### How does a real deal get its org populated?

| Option | Description | Selected |
|--------|-------------|----------|
| Manual add + bulk paste import | Precedent exists in pmo.html's roster textarea. Cost: parser + validation surface. | ✓ |
| Manual only | Zero parsing code. Cost: sends the IL back to the spreadsheet PROJECT.md's core value forbids. | |
| CSV file upload | Closer to how a roster arrives. Cost: upload handling, size limits, content-type validation. | |

**User's choice:** Manual add + bulk paste import.

### How is the structure rendered?

| Option | Description | Selected |
|--------|-------------|----------|
| Collapsible indented tree of position cards | Pure DOM, 200+ nodes, degrades at narrow widths. Cost: vertical, not the horizontal chart people picture. | ✓ |
| CSS-drawn boxes-and-lines chart | Best screenshot. Cost: hand-rolled layout, unreadable past ~4 levels, breaks first at narrow widths. | |
| Both, with a view toggle | List for working, chart for showing. Cost: two renderers to build, sync and re-verify. | |

**User's choice:** Collapsible indented tree of position cards.

### Where does the org surface live?

| Option | Description | Selected |
|--------|-------------|----------|
| New page — org.html + public/js/org.js | Mirrors due-diligence.html, including no pageAccess entry (IN-02). Cost: one more page in both modes. | ✓ |
| Tab inside execution.html | Reuses an IL-facing page. Cost: execution.js already 1,100 lines with a DOM-structure bug in its history. | |
| Panel on the deal home | One screen. Cost: breaks deal-home.js's grep-assertable rollups-only property. | |

**User's choice:** New page.

---

## Decision & flight-risk registers

### Where does a role-selection / redundancy decision live?

| Option | Description | Selected |
|--------|-------------|----------|
| Append-only `orgDecisions` log, current state derived | Follows Phase 5 D-12 and D-22. Cost: current decision is a lookup, not a field read. | ✓ |
| A `decision` field on the position | One read. Cost: a reversal overwrites the rationale trail; forensic record left only in admin-only audit.db. | |
| Both — log plus denormalised field | Fast reads + history. Cost: the two-places-to-sync failure D-22 rejected. | |

**User's choice:** Append-only log.

### What decision vocabulary?

| Option | Description | Selected |
|--------|-------------|----------|
| Five — retain / redeploy / in-selection / redundant / open | Covers the real selection lifecycle. Cost: triplicated enum + ~5 i18n keys × 4 languages. | ✓ |
| Three — retain / at-risk / redundant | Fewest keys. Cost: collapses legally distinct outcomes; vacancy has nowhere to go. | |
| Free-text decision type | No enum, no migration risk. Cost: nothing countable for Phase 7's steerco pack. | |

**User's choice:** Five values.

### Does a flight-risk entry convert into action?

| Option | Description | Selected |
|--------|-------------|----------|
| Mitigation text + one-click conversion to task and/or RAID | Reuses the DD-03 spine; demo RAID already holds this exact entry unlinked. Cost: exposes the deferred /api/raid leak path (T-04-21). | ✓ |
| Mitigation free-text only | Exactly ORG-03, sidesteps the leak. Cost: retention action lives in a register nobody works from. | |
| Convert to task only, never RAID | Keeps the title out of RAID. Cost: a flight risk genuinely is a risk. | |

**User's choice:** Mitigation text + conversion.
**Notes:** The RAID leak consequence was raised immediately as a follow-up question.

### What risk scale?

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse RAID's four levels — low/medium/high/critical | Zero new enum; D-11/D-26 precedent for lossless conversion. Cost: "critical flight risk" reads slightly oddly. | ✓ |
| Dedicated three-level scale | Arguably less false precision. Cost: new enum in three places + lossy mapping at conversion. | |
| Impact × likelihood grid | Most faithful; RAID already has severity + probability. Cost: two fields + an agreed derived score. | |

**User's choice:** Reuse RAID's four levels.

---

## Follow-up round — consequences of the above

### /api/raid outbound clearance filtering (T-04-21)

| Option | Description | Selected |
|--------|-------------|----------|
| Close it in this phase | The phase creates a second route into an unfiltered log; the leak is proven live once. Also retro-fixes Phase 4. Cost: widens blast radius into the RAID lane. | ✓ |
| Defer again to a hardening phase | Keeps blast radius in the org lane. Cost: knowingly shipping a second instance of a leak this phase created. | |
| Neutral-titled converted RAID entries | No RAID-lane changes. Cost: "Retention risk #4" is materially less useful in a steerco review. | |

**User's choice:** Close it in this phase.

### Demo showcase org lane

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-tuned seed over the 5 demo employees, incl. flight-risk | Phase 5 D-10 precedent; most visual output of the phase. Cost: demo.db rewrite + the WAL checkpoint trap. | ✓ |
| Org structure only, no flight-risk in demo | Avoids a named retention list in a showcase. Cost: a third of the phase unrepresented. | |
| Real-deal only, demo untouched | Matches the Phase-4 DD precedent; zero demo-regression risk. Cost: showcase stops tracking capability. | |

**User's choice:** Hand-tuned seed including flight-risk.

### Staleness signal on the flight-risk register

| Option | Description | Selected |
|--------|-------------|----------|
| No — defer it | Not in ORG-01/02/03 or any success criterion. Cost: Phase 7's RPT-04 says "and equivalents" and may find it missing. | ✓ |
| Yes — reuse lastConfirmedAt + configurable threshold | Prevents a six-week-old risk reading as current. Cost: a synergy-shaped model on a lane with no cadence; a fourth thing in the phase. | |
| Lightweight "last reviewed" date only | Surfaces age cheaply. Cost: nothing flags itself — the flag-nobody-sees problem. | |

**User's choice:** Defer.

---

## Deal home & rollups (user-requested extra round)

### Does the deal home gain an org panel, and what does it report?

| Option | Description | Selected |
|--------|-------------|----------|
| Two-tier panel including current/target headcount delta | The delta is what a steerco asks for; Phases 4 and 5 both added a deal-home surface. Cost: two clearance tiers in one panel, enforced server-side. | ✓ |
| Structure-only rollup | One tier, trivially safe. Cost: the two numbers an IL is actually asked for live only on the org page. | |
| No deal-home panel | Zero regression risk to a grep-asserted file. Cost: IL must go looking for org status. | |

**User's choice:** Two-tier panel with the delta.

### What does an uncleared member see?

| Option | Description | Selected |
|--------|-------------|----------|
| Restricted lines absent entirely — not zeroed, not masked | Phase 4 T-04-46, verified in UAT against raw innerHTML. Cheaper as well as correct. | ✓ |
| Zeroed or masked placeholders | Consistent layout for every viewer. Cost: contradicts the verified invisibility model; a placeholder confirms existence. | |
| Whole panel hidden for uncleared members | Unambiguous. Cost: takes back the open tier Area 1 deliberately granted. | |

**User's choice:** Absent entirely.

### Where does the rollup come from?

| Option | Description | Selected |
|--------|-------------|----------|
| New GET /api/org/summary, server-computed and clearance-scoped | Mirrors /api/dd/summary; only option satisfying deal-home.js's invariant. Cost: one route + one schema registration. | ✓ |
| Client-side tallying of the list endpoints | No new route. Cost: ships target-state rows to the browser and hides them there — the failure DD-04 forbids. | |
| Extend GET /api/deals with org counts | Zero extra requests. Cost: a control-plane route computing org tallies for every caller. | |

**User's choice:** New GET /api/org/summary.

### Do flight-risk owners get nudged?

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse the existing deal-home owner-nudge pattern | No new notification surface; stops the register being a list nobody works from. Cost: the nudge is restricted content and must be clearance-scoped. | ✓ |
| Also nudge on positions stuck in-selection | Real failure mode in live deals. Cost: re-introduces the staleness machinery just deferred. | |
| No nudges this phase | Smallest surface. Cost: Phase 5 D-19's own reason not to. | |

**User's choice:** Reuse the deal-home nudge pattern.

---

## Claude's Discretion

No area was delegated with "you decide" — all 23 decisions were chosen explicitly.
Recorded as planner latitude in CONTEXT.md:

- Exact `orgPositions` field set beyond the four named in ROADMAP criterion 1
- Orphan-guard behaviour when a linked `employees` row is deleted
- Import column-mapping tolerance, forward-reference resolution, and whether a partially-valid paste is rejected wholesale or row-by-row
- Where unassigned employees and vacant positions render in the tree
- i18n key naming for the decision vocabulary
- Whether the lane is three collections or fewer, and their exact naming

## Deferred Ideas

- Staleness signal on the flight-risk register (flagged for Phase 7's RPT-04)
- Named org-design scenarios with comparison
- Fixed `level` enum enabling by-level and span-of-control rollups
- Impact × likelihood flight-risk grid
- Nudging on positions stalled in `in-selection`
- Linking a redundancy decision to a synergy initiative's cost-to-achieve (severance as SYN-02 cost)
- A boxes-and-lines org chart view
- Whether org data joins the Phase 7 export (RPT-01 currently names only workstreams, tasks, RAID, synergies)

### Reviewed Todos (not folded)

- **`new-deal-setup-wizard`** — matched at score 0.4 on the single keyword "phase". Not folded: it is WIZ-01, delivered and closed in Phase 4. A stale keyword match.
