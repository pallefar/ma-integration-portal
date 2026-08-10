# Phase 4 — External API Coverage Declaration

**Detector result at plan time (2026-08-02):** `api-coverage` → `detected: false`.

No external API integration: this phase links OUT to TE's licensed virtual data room by operator-supplied URL
only (DD-05 explicitly forbids the app storing, fetching or proxying the documents themselves), and every
other capability — DD request lists, findings, conversion, clean-room grants, the setup wizard and the
readiness-assessment kickoff — is served by this repository's own Express routes against its own SQLite files,
with zero new runtime dependencies (04-RESEARCH.md, "Package Legitimacy Audit: not applicable this phase").

## Why this file exists despite a negative detection

The seal-time `verify:pre` gate re-runs the same detector across the ROADMAP section **and the PLAN bodies**.
This codebase is saturated with the detector's trigger vocabulary ("endpoint", "api", "integration tasks"),
so an absent COVERAGE.md risks a false-positive seal block on a phase that genuinely integrates nothing
external. Phase 3 wrote the same declaration and sealed clean.

## Outbound network calls added by this phase

None. The only new outbound reference is an `href` on an anchor element pointing at an operator-supplied
data-room URL, rendered client-side after a scheme re-check and opened by the browser in a new tab — the
server never dereferences it.

## Pre-existing external integrations (unchanged by this phase)

| Integration | Status this phase |
|-------------|-------------------|
| Gemini API (`aiService.js`) | Untouched — no Phase 4 route calls it |
| Hugging Face model streaming (Transformers.js) | Untouched — demo-side only |

---

*Phase: 04-due-diligence-workspace*
*Declared: 2026-08-02 at plan time*
