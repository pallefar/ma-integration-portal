---
created: 2026-08-02
source: user request (verbatim below), mid-Phase-3 close
resolves_phase: TBD (user decision pending: fold into Phase 4 vs dedicated phase)
---

# New-deal setup wizard (guided deal onboarding incl. readiness assessment)

**User ask (verbatim, 2026-08-02):** "when a new deal is created, it should go through the new deal assemment of of the company so like a new deal setup, please ensure this is added and we have a wizard for new deals, think about what can be there from an app perspective"

**Context:** Phase 3 deliberately shipped a *minimal* create-deal form (D-04). This upgrades deal creation into a guided multi-step "New Deal Setup" wizard whose centerpiece is kicking off the existing readiness-assessment suite for the new deal.

## Proposed wizard steps (grounded in existing app capabilities)

1. **Deal basics** — codename (MNPI guidance: use a project codename, not the target's real name, pre-announcement), target company, deal type (acquisition/JV/merger), key dates (signing, expected close, Day-1), optional deal size/currency.
2. **Team & access** — member allowlist from the user registry (IL, PMO, later workstream leads), per D-03; explicit MNPI/need-to-know notice; shows who will and won't see the deal.
3. **Readiness assessments (the user's core ask)** — instantiate the existing assessment suite for this deal: acquirer-org readiness + target-org readiness (paired templates) + IL readiness. Templates are ALREADY seeded into every new deal by D-06 template-only seeding — the wizard assigns owners + due dates and creates the assessment instances. Red flags later flow into Day-1 tasks via the existing `from-remediation` linkage.
4. **Integration scope & workstreams** — select active workstreams (8 exist), integration depth (full absorption / partial / standalone), and which checklist templates to instantiate (34 seeded tasks exist as templates in the deal seed).
5. **Timeline markers** — Day-1 / 30 / 60 / 100-day dates seeding the roadmap view.
6. **DD kickoff + VDR link** (Phase-4 tie-in) — link out to TE's licensed VDR (DD-05: link only, never document storage) and optionally open the DD request list.
7. **Review & create** — summary screen → creates the deal through the existing validated pipeline (zod deal schema, audit security event, session binding) → lands on a deal-home setup checklist showing which wizard steps produced what.

## Implementation notes

- Backend largely exists: deal creation (validators/deals.js), template seeding (db/dealSeed.js), assessments (assessmentTemplates/Instances), checklist templates, membership (D-03). The wizard is mostly a frontend flow + a few "instantiate template X for deal Y" endpoints + wizard-state on the deal record (`setupComplete` steps).
- Every wizard write goes through the Phase-3 validation pipeline + audit hook automatically.
- Fits naturally with Phase 4 (Due Diligence Workspace): DD is the first thing a new deal does; the wizard is the front door to it.
- Vanilla JS, no framework — model the flow on the existing admin intake wizard (Projects intake wizard precedent from the demo side).
