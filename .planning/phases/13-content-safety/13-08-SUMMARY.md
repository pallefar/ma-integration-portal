---
phase: 13-content-safety
plan: 08
subsystem: client-security
tags: [egress, csp, gemini, huggingface, youtube, rag, admin-console, SAFE-06]
requires: ["13-02"]
provides:
  - "admin.js External services panel (GET/POST /api/admin/egress), built with createElement/textContent"
  - "employee.js YouTube thumbnail/embed gate on settings.egress.youtube === true (missing = off)"
  - "transitions.js Hugging Face download gate (selector + runRealTransformersDownload) and Gemini marker state on the AI-insight card"
  - "admin.js AI-training (RAG) upload card hidden unless /api/auth/mode is dev|demo; marker answer rendered as a state"
  - "test/egress-client.test.js (16 rows: static no-sink scan, node:vm behaviour rows, one HTTP row)"
affects: [13-12, 13-13]
tech-stack:
  added: []
  patterns:
    - "fail-closed client gates: only an explicit `egress.<key> === true` allows a third-party channel (PD-38)"
    - "refusal marker rendered once as a state; no timer, no retry, re-ask control withdrawn"
    - "real function source extracted by name and run in node:vm against a recording fake DOM"
key-files:
  created:
    - test/egress-client.test.js
  modified:
    - public/js/admin.js
    - public/js/employee.js
    - public/js/transitions.js
decisions:
  - "Panel is inserted after the 'Merger System Settings' card (settingsForm.closest('.card')), not between form groups, so the checkboxes are never inside the settings form and admin.html stays untouched (13-06/13-10 own it)"
  - "One i18n key `egress.switchedOff` for every 'switched off' surface; the English fallback text is surface-specific (video / model download / AI insight / AI training)"
status: complete
actuals:
  tokens: 52000
  tasks: 2
  commits: 2
---

# Phase 13 Plan 08: Egress switch - browser gates and External services panel Summary

An admin can now operate the egress switch from the console, and every browser surface that would reach Google, Hugging Face or YouTube checks it first and explains the state instead of failing silently.

## What shipped

| Task | Commit | Content |
| ---- | ------ | ------- |
| 1 (tracer) | 13512d3 | External services panel (admin.js), YouTube thumbnail/embed gate (employee.js), `test/egress-client.test.js` panel + video + HTTP rows |
| 2 | 905fea6 | Hugging Face gate on the selector and `runRealTransformersDownload`, Gemini `egressDisabled` marker on the AI-insight card, RAG upload card hidden by default / revealed for dev|demo, marker on `/api/rag/upload`, transitions + RAG rows |

The tracer's automated verify was green on the first run, so no human stop (brief rule).

## Behaviour

- **Panel:** card `#egress-panel` after the System Settings card. Three real checkboxes (Gemini, Hugging Face, YouTube), per-row "Currently on/off - default for this mode", an always-visible third-party warning (`role="note"`), Save posts only the changed keys, re-renders from the response and shows `Saved` (`admin.egress.saved`). A non-admin gets 403 on the GET, so nothing is built.
- **YouTube:** `youtubeAllowed` is `false` until the settings answer says `egress.youtube === true`. Off: no `img.youtube.com` URL is built, no iframe, the play control is withdrawn and a neutral "Video switched off by your administrator" card is shown. The play handler re-checks (`youtubeBlocked()`) before building the embed.
- **Hugging Face:** the only `import('/vendor/transformers/transformers.min.js')` sits behind `huggingFaceAllowed()` inside `runRealTransformersDownload`. Off: the downloadable model options are disabled (radio disabled, never selectable), `simulated-duck` stays selected, "Model download switched off by your administrator" is shown, and the Activate button forces the local simulation.
- **Gemini marker:** `/api/ai/insight` answering `{ egressDisabled }` renders a single textContent state, schedules nothing, and hides Recalculate. `/api/rag/upload` marker clears the progress UI and shows a switched-off note; no retry path.
- **RAG upload UI:** the card is hidden synchronously at script run and revealed only if `/api/auth/mode` answers `dev` or `demo` (a failed probe leaves it hidden). The server 404 from 13-02 remains the enforcement.

## New i18n keys (English fallback inline, dictionary untouched - Phase 19)

`admin.egress.title`, `admin.egress.warning`, `admin.egress.gemini`, `admin.egress.huggingface`, `admin.egress.youtube`, `admin.egress.save`, `admin.egress.saved`, `egress.switchedOff`.

## Deviations from Plan

**1. [Placement] Panel sits after the settings card, not after the Gemini key field**
- The plan said "directly after the AI-provider card"; in admin.html the Gemini key is a form group inside the settings form, not a card. Inserting after the form's card keeps the new checkboxes outside the settings `<form>` and needs no admin.html edit. Same tab, same visual neighbourhood.

**2. [i18n] One key, surface-specific English fallback**
- `egress.switchedOff` is the key on all four "switched off" surfaces (the plan lists a single key). A future dictionary entry for that key would replace every fallback with one string; Phase 19 may want to split it per surface.

No Rule 1-3 fixes were needed. No file outside `files_modified` was touched.

## Findings for the orchestrator / later plans

- **Pre-existing, unrelated full-suite failure:** `test/read-sets-org-reports.test.js` "read-sets-reports (export): every dataset x format x identity ..." fails (expected `staleDays` 273/281, actual 274/282 - a one-day wall-clock offset) in this worktree at 00:00 UTC on 2026-10-11 and fails the same way when the file is run alone; none of this plan's files are involved (client JS + a new test only). It is date-sensitive and should self-heal once the host clock is past the UTC midnight boundary the test straddles; re-run it before blaming a merge.
- **Pre-existing sink left alone:** `fetchSmolInsight` still does `contentArea.innerHTML = ... ${data.insight} ...` for a normal (non-marker) insight body. It is outside this plan's region ownership (sanitizer/renderer is 13-06's); only the marker branch was added and it uses textContent.
- 13-12's real-lane request capture should include: real-mode employee page (no `img.youtube.com`), model-download dialog (no Hugging Face request), `/api/ai/insight` (one request, then a switched-off card).

## Threat model status

| ID | Status | Evidence |
| -- | ------ | -------- |
| T-13-70 | mitigated | vm rows: no YouTube reference on any element with the switch off or `egress` absent; Transformers import only after `huggingFaceAllowed()` (static order + vm on/off rows). Real-lane capture is 13-12. |
| T-13-71 | mitigated | AI-insight marker row: one fetch, zero timers; RAG marker branch has no fetch/timer/alert |
| T-13-72 | mitigated | static scan: `egressText`/`renderEgressPanel`/`loadEgressPanel` contain no innerHTML/outerHTML/insertAdjacentHTML/document.write |
| T-13-73 | mitigated | HTTP row: hrbp GET `/api/admin/egress` -> 403 (server admin-only, 13-02); panel built only on a 200 |

## Known Stubs

None.

## Verification

- `node --test test/egress-client.test.js test/client-authz-hiding.test.js` - `# tests 81  # pass 81  # fail 0`.
- Full suite (`node --test`): `# tests 1577  # pass 1576  # fail 1` - the single failure is the pre-existing clock-dependent `test/read-sets-org-reports.test.js` export row described above (reproduced alone, unrelated to this plan).
- `git status --porcelain data/ public/sent_emails/` empty at both commits; no `.db`/`-wal`/`-shm` staged.

## Self-Check: PASSED

Created/modified files exist (`test/egress-client.test.js`, `public/js/admin.js`, `public/js/employee.js`, `public/js/transitions.js`); commits 13512d3 and 905fea6 are on the worktree branch.
