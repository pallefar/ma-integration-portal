---
phase: 04
slug: due-diligence-workspace
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
block_on: high
threats_total: 60
threats_closed: 60
register_authored_at_plan_time: true
created: 2026-08-02
verified: 2026-08-03
---

# Phase 04 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

**Scope.** All 10 plans (04-01 … 04-10) carried a `<threat_model>` block authored at
plan time, yielding a 60-row STRIDE register (ids `T-04-01` … `T-04-56`, plus the
repeated supply-chain row `T-04-SC`). The register is therefore complete by
construction; this audit verifies that each declared mitigation is actually present
in the implementation, rather than scanning for new threats.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| browser → `/api/dd/*` | Every DD read/write crosses the clean-room boundary | Pre-announcement diligence content (MNPI) |
| `memberGrants` → DD list/by-id routes | Per-deal, per-area clearance decides visibility | Area clearance map |
| DD finding → RAID entry / Day-1 task | **Conversion widens the audience** beyond area-cleared members | Finding title + notes (MNPI) |
| browser → `POST /api/deals` | Deal creation and wizard resume | Target company name (MNPI) |
| stored VDR url → rendered anchor | A stored value becomes a clickable link | Operator-supplied URL |
| session → deal binding (`db/resolver.js`) | Which deal a request resolves to | Deal identity |

---

## Threat Register

Verified 2026-08-02/03 by `gsd-security-auditor` (ASVS L1, `block_on: high`) against the
implementation, with the orchestrator independently re-proving the items marked ✱.

**60 of 60 closed. `threats_open: 0`.**

Full per-threat evidence (file:line for every row) is recorded in the audit run and
summarised here by group; the one threat that was genuinely open at first audit is
documented in full below.

| Group | Threat IDs | Severity range | Status | Representative evidence |
|-------|-----------|----------------|--------|-------------------------|
| Clean-room list/by-id enforcement | T-04-01 … T-04-04, T-04-16, T-04-20, T-04-23, T-04-28 | critical–high | closed ✱ | `server.js:3246,3280-3289` `filterByAreaGrant()`/`ddAreaRefused()`; uniform 403 at `db/accessPolicy.js:57-63` |
| DD input validation & bounds | T-04-05, T-04-07, T-04-12, T-04-17, T-04-22, T-04-31, T-04-35 | medium–low | closed | `validators/dd.js`, `validators/deals.js`, `validators/wizard.js` — enums, `.max()`, unknown-key stripping |
| No markup sinks (XSS) | T-04-06, T-04-14, T-04-41, T-04-54 | high–low | closed ✱ | `grep -c innerHTML public/js/due-diligence.js` → `0`; same for `deal-wizard.js`, `deal-home.js`, `admin.js` |
| Audit trail / non-repudiation | T-04-04, T-04-10, T-04-29, T-04-37, T-04-49(09) | high–low | closed | `refuseDdArea()` audits before responding; `server.js:851-854` completion event |
| Grants & membership authz | T-04-09, T-04-11, T-04-13, T-04-30, T-04-34, T-04-56 | critical–medium | closed | `server.js:274-303` `ROLE_WRITE_POLICY`; `:900-902` GET role gate (CR-02 carve-out); grants re-read per request |
| VDR URL scheme safety | T-04-27 | high | closed ✱ | write: `validators/dd.js:62-68` protocol refine; render: `due-diligence.js:174-180` + both anchor sites with `rel="noopener noreferrer"` |
| Rollup / deal-home disclosure | T-04-45 … T-04-48, T-04-51(08) | critical–medium | closed ✱ | `server.js:3661-3672` filters **before** tally; `deal-home.js:151-160` renders only returned areas |
| Wizard & setup integrity | T-04-32, T-04-33, T-04-36, T-04-38 … T-04-44, T-04-50(09), T-04-51(09) | high–low | closed | `server.js:2597-2607` assign sets no score; `:847-850` steps passed through untouched; `:737-747` provisioning rollback |
| Duplicate-deal / resume guard | T-04-52, T-04-53, T-04-55 | high–medium | closed ✱ | `db/controlStore.js:210-219` `createdBy`-pinned exact match, returns `null` when `createdBy` falsy (fails closed) |
| Demo-showcase isolation | T-04-15, T-04-50(08) | high | closed ✱ | `db/dealSeed.js:31` allowlist excludes live DD collections; demo initializers untouched |
| Archived-deal access | T-04-49(08) | medium | closed | `db/resolver.js:97` — D-22 amendment **fails closed** (stronger than the register declared) |
| Supply chain | T-04-08, T-04-SC | high–low | closed | No dependency added in any Phase 4 plan; no `package.json`/lock change |
| **Conversion audience disclosure** | **T-04-21** | **high** | **closed (was OPEN at first audit)** | See below |

✱ = independently re-proven live by the orchestrator, not accepted on report.

---

### T-04-21 — resolved 2026-08-03

**Category:** Information Disclosure · **Severity:** high · **Disposition:** accept, *conditioned on a UI control*

**Why it was open.** The register accepted this risk on an explicit condition — *"the
convert control states that the created task or entry is visible to the whole deal
team."* **That disclosure was never built.** No such string existed in
`public/js/due-diligence.js`, `public/due-diligence.html`, or `public/css/style.css`,
and `04-04-SUMMARY.md` never claimed it was. The acceptance therefore rested on a
control that did not exist — a failure mode that reads as "closed" in every artifact
and is covered by no test.

**The underlying exposure is real** — proven live by the orchestrator, not inferred
(deal `T0421 Probe`, `pmo` granted `["hr"]` only and never `legal`):

```
BEFORE convert — pmo sees the legal finding via /api/dd/findings:  NO   (clean-room holding)
AFTER  karen converts it — pmo reads via GET /api/raid:
  title: "Change-of-control clause voids Siemens master agreement on close"
  notes: "Counsel estimates EUR 4.2M exposure; target has not disclosed to counterparty."
  workstreamId: "ws_legal"   source: "dd-finding:ddfind_..."
also leaked via GET /api/integration-tasks: YES
```

Mechanism: `server.js:3618-3629` copies `finding.title` **and** `finding.notes`
verbatim into the RAID entry (`:3596` title → task); `app.get('/api/raid')`
(`server.js:3126-3128`) returns `raidLane(readDb())` with **no** `filterByAreaGrant()`,
as does `/api/integration-tasks`; `filterByAreaGrant` appears only on DD routes
(`3246, 3383, 3476, 3661, 3662`); GETs are not role-checked outside `/api/admin`.

**Resolution (user decision, 2026-08-02).** Build the disclosure the register promised,
making the audience-widening a deliberate, informed operator choice. Conversion is
performed by an operator who *is* cleared for the area, so informed consent is the
appropriate control at this point in the flow.

- `public/js/due-diligence.js:325` — textContent-only span on the convert row:
  *"Visible to the whole deal team once created — not only members cleared for this area."*
- `public/due-diligence.html` cache stamp bumped to `?v=1784800003`.
- `test/dd-findings.test.js` — `dd-findings (p)` regression test; **confirmed to genuinely
  fail** when the disclosure is removed.
- Commits `541dc08`, `b5b4632`. Suite 239 → **240/240**.

**Orchestrator live verification (2026-08-03):** rendered on the finding row with
`computedDisplay: block`, `visibility: visible`, `opacity: 1`, `offsetParent` non-null,
height 18.4px, present in `body.innerText`, under script tag `?v=1784800003`. Screenshot
confirmed it sits directly beneath the two convert buttons — *before* the operator
clicks.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-04-01 | T-04-21 | Conversion deliberately widens audience beyond area clearance. Accepted **because** the convert control now discloses this at the point of decision, and the actor is always an operator already cleared for the area. | Karsten (user) | 2026-08-02 |
| AR-04-02 | T-04-55 | A deduplicated create records no new audit event because it mutates nothing; the deal's original `deal-create` event already answers who created it and when. | Plan 04-10 | 2026-08-02 |
| AR-04-03 | T-04-36, T-04-42 | Pre-announcement codename guidance is advisory, not enforced — an IL may legitimately need the real target name. Notice present at `public/deal-wizard.html:84`. | Plan 04-07 | 2026-08-02 |
| AR-04-04 | T-04-40 | The client holds no validation rules; the server is the sole source of truth (D-07), verified independently enforced. | Plan 04-07 | 2026-08-02 |
| AR-04-05 | T-04-51(09) | The added `.refine()` costs one predicate evaluation per setup post on an already-bounded body; route is admin+hrbp and operator-paced. | Plan 04-09 | 2026-08-02 |
| AR-04-06 | T-04-08 | No dependency or lockfile change in this phase. | Plan 04-01 | 2026-08-02 |

---

## Deferred Hardening (not Phase 4 scope)

Recorded so these are not silently lost:

1. **Outbound clearance filtering for DD-sourced entries.** `/api/raid` and
   `/api/integration-tasks` are not clearance-filtered. T-04-21 is now closed by
   disclosure rather than enforcement. Filtering these lanes is strictly stronger but
   requires a design decision — moving an item *into* the shared execution lane is the
   entire purpose of converting, so "who should see a converted finding" is a product
   question, not a bug fix. **Route to a hardening phase or Phase 6 (Org Design), which
   already touches the execution lanes.**
2. **`pageAccess` gate races the login-role handshake.** `public/js/transitions.js:145-176`
   can evaluate a stale `localStorage.active_demo_role` on the first navigation after a
   role change. Pre-existing and app-wide, **not a bypass** — the server-side gate is
   independent (`ROLE_WRITE_POLICY`, `server.js:303`), confirmed during UAT. The page
   map is documented as a convenience gate only (T-04-39).

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-02 | 60 | 59 | 1 (T-04-21, high — blocking) | gsd-security-auditor (opus, ASVS L1) |
| 2026-08-03 | 60 | 60 | 0 | orchestrator — re-verified T-04-21 mitigation in source + live browser; re-confirmed T-04-06 markup-sink count is 0 on the changed file; suite 240/240 |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-03
