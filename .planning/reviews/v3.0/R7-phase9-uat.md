# R7 — Phase 9 human-verify items closed with real browser evidence

Lane: R7 · 2026-10-10 · Reviewer: Claude (Fable 5.1) · Method: real two-tab Playwright walks (Chromium 1.62.1, headless)
against an **isolated real-deal-mode server** (`PORT=4316`, temp copies of `demo.db`/`control.db`, no `DEMO_OPEN`,
fail-closed login as `karen`/hrbp plus `pmo` as a differently-cleared deal member). Server killed and temp data removed
at the end; repo untouched except this file.

Evidence directory (scripts, 16 screenshots, `results.json`, `walk.log`):
`/private/tmp/claude-501/-Users-karstenhaldan-M-A/11c2f150-6442-4de1-9ac2-99cbd3fc00f0/scratchpad/r7/`
(harness `walk.js`, server recipe `start-server.sh`). Every claim below is **VERIFIED** live unless marked SUSPECTED.

Contracts judged against: `.planning/REQUIREMENTS.md` CONC-02, `09-CONTEXT.md` D-01..D-09, `09-UI-SPEC.md` (literal
Copywriting Contract + colour/typography/spacing rows), `09-01-PLAN.md` must_haves (FA-1/FA-2), `09-REVIEW.md` resolutions.

## Verdict at a glance

| UAT item | Verdict | One line |
|---|---|---|
| 1 Execution hub (tasks + synergies) | **ISSUE** (core path PASS) | Same-record edit → correct dialog + diff, reapply persists, different records don't fight. But: a never-edited record's first concurrent edit **silently clobbers** (F-1, HIGH); after a successful reapply the page is stale and the next click **self-conflicts** (F-2); the synergy **stage** conflict shows "No conflicting fields" when the other user changed the stage (F-3). |
| 2 Due diligence (findings + request items) | **PASS with 2 issues** | Same-user conflicts render a correct diff on items and findings. Uncleared caller never sees field values (403 at the route layer; `currentRecord:null` on the WHERE-layer body) — leak-safety holds. But the null-record body renders "No conflicting fields … Apply your changes to continue" and Apply then reports a 403 as "a network error" (F-4). The UAT expectation text ("sees the attribution fallback") contradicts the accepted T-09-17/IN-01 contract. |
| 3 Org (position edit) | **PASS (contract) / not walkable as written** | `org.html` has **no position-edit surface** (per node: toggle, Decisions, Delete; zero inputs) — only create/delete/copy-to-target/import exist. The contract was exercised from the real page context (real 409 → dialog with Title/Level diff → reapply persisted). Record the gap in WINDOWS.md. |
| 4 Stale delete (RAID/task/synergy/position) | **PASS with 2 low issues** | All four destructive-variant dialogs correct (title, attribution, no diff list, Cancel + red "Delete anyway", zero orange), record survives until confirm, untouched delete shows no conflict dialog. But each delete is preceded by the pre-existing native `window.confirm`, so a stale delete is **two prompts** (F-6), and deleted rows **stay on the page** after "Delete anyway" (F-2). |
| 5 FA-1 truth list | **ISSUE (doc, LOW)** | List is accurate for what it states but **incomplete**: no per-record-granularity truth despite FA-1 claiming one; no client-side truth for unversioned records (the exact hole F-1 fell through); no 409-body clearance truth (the hole CR-01 fell through). |
| 6 FA-2 literals | **ACCEPT with amendment (LOW)** | Hardcoded EN via `textContent` is what the signed UI-SPEC prescribes (Phase 8 precedent) — do **not** i18n them. Add the three literals to the Copywriting Contract; tweak voice ("Someone else deleted this") and suppress the contradictory attribution line ("This record changed…" under "This record was deleted"). |

New defects found while walking: **F-1 HIGH, F-2 MEDIUM, F-3 MEDIUM, F-4 MEDIUM, F-5/F-6/F-7 LOW** (details below).
No security regression found: 409 bodies never carried uncleared field values in any walk; the CR-01 fix behaves as documented.

---

## Setup actually used

- Deal `R7 UAT Deal` (members `karen`, `pmo`), created and selected via `POST /api/deals` + `/api/deals/select`;
  `pmo` granted `ddAreas: ['legal']` via `POST /api/deals/:id/grants`.
- Four independent `karen` sessions (API seeder, tab A 1440×900, tab B 1440×900, tab M 390×844) + one `pmo` session —
  separate browser contexts with separately issued `ma_session` cookies.
- Seeded through the API: tasks T1–T4, synergies S1/S2, RAID R1–R3, DD items/findings (financial + legal), org
  positions P1–P3. Most were pre-edited once so they carry `version: 1`; **T4 was deliberately left never-edited** (no
  `version` field, exactly the state every freshly created record is in).
- Every native `confirm()`/`alert()` was captured (`page.on('dialog')`); every non-GET `/api` response body was captured.

---

## Item 1 — Execution hub (integration tasks + synergy initiatives)

**PASS — same record, correct diff.** Tab A flipped T1 twice (todo→doing→blocked, v1→v3, both 200). Tab B, holding v1,
flipped once → `POST /api/integration-tasks` **409** with `conflict:true, currentVersion:3, changedBy:'karen'` → dialog
(`01-task-conflict-desktop.png`): title "Someone else updated this", "Changed by **karen**, just now", intro sentence
verbatim, one row **Status: mine `doing` / theirs `blocked`**, buttons "Discard mine, keep theirs" (`.btn-secondary`,
transparent) + "Apply my changes anyway" (`.btn-primary`, `rgb(233,131,0)`). Page row untouched while open ("To do").

**PASS — reapply.** "Apply my changes anyway" re-sent the byte-identical payload with `version:3` → 200 → dialog closed
→ server `status:'doing', version:4`. Escape and overlay-click close with no request (verified on tab M).

**PASS — per-record granularity.** A flipped T2 while B flipped T3 → both 200, no overlay in either tab.

**PASS — synergy header realizedM** (`04-synergy-realized-conflict.png`): A=1.5 (v2), B=2.5 stale → row
**RealizedM 2.5 / 1.5**, no `window.alert` fired (WR-01 fix holds — 0 alerts in the whole run).

**PASS — second conflict re-renders in place** (`05-synergy-second-conflict-banner.png`): with B's dialog open, A changed
again (→3); B clicked Apply → second 409 → **same overlay** (count 1), theirs refreshed to `3`, banner verbatim
"That didn't go through — the record changed again. Your edits are still here; review the fresh values below and try
again.", Apply re-enabled; Apply again → 200, server `realizedM 2.5, version 4`.

**PASS — 390 px** (`03-task-conflict-390.png`): modal 326 px wide inside 32 px gutters, no horizontal page scroll, both
actions visible (labels wrap inside their buttons).

### F-1 — HIGH — First concurrent edit of a never-edited record silently clobbers (VERIFIED)

Repro (walk log, T4): both tabs loaded T4 **with no `version` field**. A flipped twice (→`blocked`, server v2). B flipped
once: the request carried **no `version`** → **200**, server now `status:'doing', version:3`. A's write is gone, **no
dialog anywhere**. Screenshot not needed — the response body is in `results.json` ("FRESH record T4").

Why: every record is INSERTed without a version (`db/store.js:404-411`), and every client call site omits `version` when
the held record has none (`public/js/execution.js:203-204, 230, 421, 815, 857, 885, 919, 951, 987, 1016, 1060, 1123,
1146`; `public/js/org.js:594, 960`; `public/js/due-diligence.js:114-116, 173-175, 248-250, 264-266` — the DD comment
literally says "keeps a first-ever edit exempt from the precondition"). With no client version the route precheck
returns `false` (`server.js:450-455`) and the WHERE layer binds *this request's own fresh snapshot* version
(`db/store.js:421`), which always matches in-process. Net: the lock does not bite on the first co-edit of any record,
and any tab that loaded the record before its first stamp stays unprotected until it reloads or gets a success response.

This contradicts D-02 ("no exemptions") and D-09's claim that legacy records "gain protection the moment two people
co-edit one", and it is the common case in a new deal (freshly instantiated checklists are all unversioned). The
server-side tests enshrine the "no-version-supplied exemption" as intended (09-06-SUMMARY), so the coverage gate cannot
catch this — it is a client-contract gap.

Fix shape (S): send `version: rec.version !== undefined ? rec.version : 0` at every call site (the server already treats
a missing stored version as 0 at `server.js:456`, zod accepts 0, and `parseExpectedVersion` accepts `expectedVersion=0`),
**or** stamp `version: 0` on INSERT in `db/store.js:404-411` so every GET carries a version. Add a contract test: "a
client that loaded a version-less record and sends 0 gets 409 after another writer stamps it".

### F-2 — MEDIUM — Page state is not synchronised after the dialog's own Apply / Delete-anyway succeeds (VERIFIED)

The page's handler has already consumed the 409 (`res.success` falsy → no state update) when the dialog's Apply fires a
fresh `window.fetch` and simply closes on success (`public/js/transitions.js:455-459`, delete variant `337-341`).
Observed: (a) task row still "To do" while server says `doing`; B's next click sent stale v1 → **409 "doing vs doing"**
(`02-task-self-conflict-after-reapply.png`) — a false conflict against the user's own reapplied write; (b) synergy card
header "$0M" while server has 2.5; (c) after "Delete anyway" the RAID row and org node **remain in the DOM**
(`rowStillInDom:true`, `nodeStillInDom:true`) although the server deleted them; (d) DD: the page's unconditional
`.then(refresh)` (`due-diligence.js:119, 253`) re-renders the select to *theirs* while the dialog is still open, and
after Apply the select shows `requested` while the server holds `received`.

D-03's "form state is never lost" is honoured only inside the dialog; D-05's "no per-page wiring" means no page learns
the outcome. Fix shape (M, keeps D-05): resolve the *original* fetch promise with the reapplied response (hold it pending
while the dialog is open; resolve with the 409 on Discard) so every existing `.then(res => res.success …)` handler
updates status + version; or dispatch a `ma:conflict-resolved` event the three pages listen to.

### F-3 — MEDIUM — Field diff keyed on payload∩record keys mislabels non-mirroring routes (VERIFIED + SUSPECTED)

`transitions.js:394-395` builds the diff from payload keys that also exist on `currentRecord`. Synergy **stage** change
sends `{targetStage}` (`execution.js:416`) but the record field is `stage` → zero rows → the dialog asserts
"No conflicting fields — the record's version changed **without affecting anything you edited**. Apply your changes to
continue." while the 409 body shows the other user changed the stage to the same value the user was pressing
(`06-synergy-stage-conflict.png`, body `currentRecord.stage:'validated'`). The UAT item-1 literal ("CORRECT field diff")
fails on the primary synergy edit surface. Same class for `confirm-current` (`{}`), `convert` (`{toTask,toRaid}`),
`rebaseline` (`{reason}`). SUSPECTED (code-traced, not reproduced): `/synergies/:id/phasing/:month` sends
`{targetM|realizedM}` (`execution.js:913-915`), which *does* exist on the record as the **initiative total** → the dialog
would compare a month cell to the rollup. Fix shape (S–M): never claim "without affecting anything you edited" when the
payload has no record-mirroring key; let routes declare a diff mapping, or diff `currentRecord` against the client's held
copy for the route's known fields.

---

## Item 2 — Due diligence (request items + findings)

**PASS** (`07-dd-item-conflict.png`): A `requested`, B `received` stale → **Status received / requested**, attribution
present; Apply → server `received v3`. Finding severity: A `high`, B `critical` → **Severity critical / high**. The 409
`currentRecord` for a cleared caller is the `publicDdItem()` projection (same shape as the 200 response).

**PASS — leak-safety for an uncleared caller.** `pmo` (legal only) held `R7 material contracts list`; karen moved it to
`financial`; pmo saved → `POST /api/dd/request-items` **403** `{error:"You are not cleared for that due-diligence
area."}`, no dialog, row disappears on refresh. The route checks clearance on the item's *current* area before the
precheck (`server.js:5522` → `5534`), so the precheck's null branch is HTTP-unreachable, as 09-04 recorded. The only
HTTP-reachable null-record body is the cross-process WHERE-layer path (CR-01 fix, `db/store.js:203-206, 474`), which
cannot be timed from a browser; I rendered **exactly that documented body** (`currentRecord:null, changedBy:'karen'`)
through the real wrapper via route interception: title + "Changed by karen, just now" + **no field values** ✓.

### F-4 — MEDIUM — The withheld-record body renders misleading copy and the follow-up 403 is reported as a network error (VERIFIED by rendering the documented body)

`08-dd-uncleared-null-record.png`: with `currentRecord:null` the dialog shows "No conflicting fields — … Apply your
changes to continue." — telling an uncleared user to apply a change to a record that is now outside their clearance.
`09-dd-uncleared-apply-result.png`: Apply hit the real route → **403** → banner "That didn't go through — **a network
error occurred**…" because `transitions.js:465` maps every non-409/non-5xx outcome to NETWORK. No leak, but the user is
misdirected twice. Fix shape (S): branch on `currentRecord === null` ("This record is no longer within your clearance;
your change cannot be applied.") and surface the response's own `error` for 4xx.

**Doc correction:** the UAT item-2 expectation "an uncleared caller sees the attribution fallback" is wrong against the
contract as built and accepted — attribution is deliberately disclosed (T-09-17 / 09-REVIEW IN-01); only the record is
withheld. The fallback sentence renders only when the body lacks actor/time — verified live
(`10-dd-attribution-fallback.png`: "This record changed since you loaded it.").

---

## Item 3 — Org design (position edit)

**Not walkable as written.** `org.html` renders per position: expand toggle, "Decisions", "Delete" — **zero inputs**
(`results.json` item 3); the only position writes in `public/js/org.js` are create (`1267-1309`, no `id`/version), delete
(`581-622`), copy-to-target (`723`), import (`1478`). `.planning/WINDOWS.md:19` records the missing delete UIs but **not**
the missing position-edit UI — add it.

**PASS at the contract level** (`11-org-position-conflict.png`): from tab B's page context a stale `POST /api/org/positions`
(karen had renamed P1 via API) → real 409 → dialog rows **Title "R7 VP Operations EMEA" / "R7 VP Global Operations"**,
**Level L5 / L4** → Apply → server `title:'R7 VP Operations EMEA', level:'L5', version:3`.

---

## Item 4 — Stale delete

| Surface | Stale delete → | Record survives until confirm | Delete anyway | Untouched delete |
|---|---|---|---|---|
| org position (`12-org-stale-delete-desktop.png`) | `DELETE …?expectedVersion=3` → 409 → destructive dialog | yes (Cancel → still exists) | 200, gone | native confirm only, 200, no conflict dialog |
| RAID (`13-…desktop.png`, `14-…390.png`) | `?expectedVersion=1` → 409 → dialog | yes | 200, gone | native confirm only, 200, row removed |
| task | `?expectedVersion=2` → 409 → dialog | — | — | — |
| synergy | `?expectedVersion=2` → 409 → dialog | — | — | — |

Dialog literal check: title "Someone else updated this — still delete it?", attribution line, **no intro, no diff
list**, "Cancel" (`.btn-secondary`) + "Delete anyway" (`.btn-danger`, `rgb(239,68,68)`), **orange scan empty**. 390 px:
326 px wide, fits, no page scroll.

### F-6 — LOW — A stale delete is two prompts; "one click" is not literally true (VERIFIED)

Every delete handler calls the pre-existing native `window.confirm` *before* the request (`execution.js:222, 1053,
1139`; `org.js:586`), so a stale delete is **confirm() → 409 → conflict dialog**. 09-UI-SPEC "Destructive
confirmation" row: "no separate browser `confirm()` — the stale-delete dialog itself is the confirmation surface …
rather than stacking two prompts". Captured sequence: `confirm "Delete this entry?"` immediately followed by the dialog
(8 native confirms in the run, one per delete). Untouched deletes are click + native confirm, not "one click". Either
drop the native confirm when the held record carries a version (the dialog is the safety net) or re-word the UAT/spec.
Also F-2 applies: rows deleted via "Delete anyway" stay visible.

---

## Spec conformance of the dialog (literal checks, all VERIFIED)

- Copy: every rendered string matched the Copywriting Contract byte-for-byte (titles, intro, attribution, empty-diff,
  error banner prefix/suffix + "the record changed again", "Applying…"/"Deleting…" labels present in code, fallback).
- Colour: orange appears **only** on `.conflict-diff-mine` (`border-left 3px rgb(233,131,0)`) and
  `.conflict-btn-apply` (background) — nothing else in the modal; delete variant has **no** orange; secondary buttons
  transparent with teal text. Scrim `rgba(15,30,38,0.72)`, `blur(3px)`, z-index 12500.
- Shell: `.conflict-modal` background/radius 14px/shadow identical to a probe `.deal-modal`; width 560 px, padding 24 px,
  `max-height 90vh`, diff list scrolls internally (40vh).
- Typography: title 18px/700 Outfit; attribution 12px/500; intro 14px/500; labels 13px/700; buttons 13px/700.
- Long text (`15-raid-long-text-desktop.png`): both value boxes scroll internally (scrollHeight 641/263 vs client 158),
  `text-overflow: clip` (never ellipsis); empty value renders italic "(empty)".
- Single-instance guard: second conflict reused the one overlay; 0 stray overlays at end of run across 4 pages.
- a11y: `role="dialog"`, `aria-modal="true"`; Escape closes. (No focus trap / initial focus — not required by the spec; note for v3.0 a11y lane.)

### F-5 — LOW — Diff labels are raw JSON keys, not display labels (VERIFIED)

`label.textContent = field` (`transitions.js:408`) + CSS `text-transform: capitalize` yields "Status" but also
"RealizedM" (`04-…png`), "DueDate", "ReportsToId". UI-SPEC E1-populated says "the field's display label above".

---

## Item 5 — FA-1 review: hand-derived CONC-02 truth list (`09-01-PLAN.md:25-41`)

Accurate for what it states (13 truths + 1 backstop; each maps to CONC-02 wording or a D-decision, and each was proven in
09-VERIFICATION). **Incomplete** on three counts:

1. FA-1 (`09-01-PLAN.md:123-127`) claims the list covers "per-record granularity", but **no truth states it** — SC3
   ("two users editing different records both save") lives only in the roadmap and the cross-process test. Add it.
2. No truth constrains the **client** for version-less records (e.g. "a client that loaded a record carrying no version
   still sends a precondition, so the first co-edit is caught"). Truth 3 is server-only. This is precisely the hole F-1
   fell through.
3. No truth about the 409 body respecting clearance on the WHERE-layer path — the hole CR-01 fell through (plan 04 scope,
   but the phase-level list should carry it).

Verdict: **ISSUE (LOW, documentation)** — amend the list with those three truths; the F-1 one should come with a test.

## Item 6 — FA-2 review: the three fresh literals (`transitions.js:132-134`)

- **i18n:** the signed UI-SPEC (`09-UI-SPEC.md:98`) *prescribes* hardcoded English via `textContent`, citing Phase 8's
  `BUSY_GIVE_UP_MESSAGE` precedent and Phase 7's documented JS-literal gap. Routing these three through `strings.en.*`
  would contradict the signed contract and be inconsistent with the other twelve literals. **Do not i18n them**; the
  app-wide gap (all runtime error/recovery copy is EN-only for DE/ZH/CS users) is a v3.0 question for the whole wrapper,
  not for these three strings.
- **Voice:** "This record was deleted" / "Close" fit the register, but the two signed titles both start "Someone else …";
  "Someone else deleted this" would be consistent. `CONFLICT_DELETED_INTRO` is fine.
- **F-7 — LOW (VERIFIED, `16-deleted-variant.png`):** the `deleted` throw carries no actor/time (`db/store.js:483`), so
  this variant *always* renders the fallback line "This record changed since you loaded it." directly under "This record
  was deleted" — contradictory. Suppress the attribution line in the deleted variant (or word it "…was deleted since you
  loaded it").
- Verdict: **ACCEPT with a one-line UI-SPEC amendment** adding the three literals to the Copywriting Contract plus the
  F-7 tweak; no UI-SPEC re-approval cycle needed.

---

## Top actions for v3.0 (ranked)

1. **F-1 — send a version precondition for version-less records** (client one-liner at ~20 call sites or stamp
   `version:0` on INSERT) + contract test. Where: `public/js/{execution,org,due-diligence}.js`, `db/store.js:404-411`,
   `test/optimistic-locking-contract.test.js`. **S**. Why: silent clobber on the first co-edit of every new record.
2. **F-2 — propagate the dialog's outcome back to the page** (resolve the original fetch with the reapplied response, or
   a `ma:conflict-resolved` event). Where: `public/js/transitions.js:455-474, 337-356` (+ DD's unconditional `refresh`).
   **M**. Why: false self-conflicts and deleted rows still visible.
3. **F-3 — honest diff for non-mirroring payloads** (`targetStage`, `{}`, `toTask`, `reason`, per-month `targetM`).
   Where: `transitions.js:388-427`, optionally a per-route field map. **S–M**.
4. **F-4 — clearance-aware copy for `currentRecord:null` and 4xx reasons on reapply.** Where: `transitions.js:397-401,
   460-466`. **S**.
5. **Docs:** fix UAT item-2 expectation (attribution disclosed, record withheld); add the org position-edit gap to
   `WINDOWS.md`; amend 09-01 truths (item 5) and 09-UI-SPEC Copywriting Contract (item 6, F-7); decide F-6 (drop the
   native confirm for versioned records, or re-word). **S**.
6. **F-5 — display labels in the diff** (map known keys; fall back to a humanised key). **S**.

## What I did not cover

- The real cross-process WHERE-layer race in a browser (not deterministically timeable); I rendered its documented body
  shape instead and rely on `test/optimistic-locking-contract.test.js` CR-01 (a–d) for the storage-level proof.
- DD finding → task/RAID conversion and flight-risk conversion conflicts; synergy cost-entry, generate-phasing, per-month
  grid and rebaseline conflicts (F-3's phasing case is code-traced only). Demo-mode (`DEMO_OPEN=1`) behaviour of the
  dialog. Firefox/WebKit. Keyboard focus management inside the dialog. Non-EN locales.
- I did not re-run the unit/contract suites (the verifier did, 779/779); this lane is browser evidence only.
