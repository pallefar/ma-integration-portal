---
phase: 09-optimistic-locking-conflict-recovery
verified: 2026-10-10T13:30:00Z
status: passed
score: 14/14 must-haves verified
behavior_unverified: 0
overrides_applied: 0
verification: automated — Fable-reviewed per standing directive (2026-08-08)
re_verification:
  previous_status: human_needed
  previous_score: 9/9
  gaps_closed:
    - "F-1: first concurrent edit of a never-edited record is caught (client sends version 0; real-deal update/delete with no precondition refused 400 versionRequired)"
    - "F-2: page shows the server's resulting state after Apply / Delete anyway (held original promise; DD refresh never under an open dialog)"
    - "F-3/F-5: honest diff via per-route field map + display labels; neutral panel replaces 'No conflicting fields'"
    - "F-4: withheld-record (currentRecord null) variant with clearance sentence; reapply 4xx shows the server's own reason"
    - "F-6: native confirm() replaced by in-app confirm that becomes the stale-delete variant on 409"
    - "F-7: deleted variant titled 'Someone else deleted this' with no attribution line"
    - "Docs: 09-01 truths (per-record, client-precondition, WHERE-layer 409 clearance), UI-SPEC A1–A11, UAT item-2 wording, WINDOWS #3"
    - "Human-verify items 1–4 (two-tab walks) satisfied by Playwright two-context evidence, Fable-judged against 09-UI-SPEC.md / D-01..D-09 / CONC-02"
  gaps_remaining: []
  regressions: []
decision_coverage:
  honored: 9
  total: 9
  not_honored: []
human_verification: []
---

# Phase 9: Optimistic Locking & Conflict Recovery — Verification Report (re-verification)

**Phase Goal:** When two people edit the same record, the second save is caught and safely recoverable instead of silently overwriting the first — including the very first co-edit of a record nobody has edited yet.
**Verified:** 2026-10-10 (HEAD `0f56e6a`, main, suite 875/875 twice)
**Status:** passed
**Re-verification:** Yes — after the R7 real-browser UAT reopened CONC-02 (gaps F-1..F-7), gap-closure plans 09-08..09-16, and code-review Round 2 fixes (WR-03/WR-04/IN-02..IN-05).

**Standing-directive note.** The four two-tab walks the 2026-08-11 verification routed to a human were performed as real two-context Chromium walks (`scripts/uat/phase9-walk.js`, 28 scenarios) against an isolated real-deal server with temp copies of the committed DBs. I re-ran both lanes myself for this verification (real-deal: 350 PASS / 0 FAIL; `--demo-open`: 18 PASS / 0 FAIL; `git status --porcelain data/` empty after both) and judged the screenshots against the written contracts. Per the project owner's directive of 2026-08-08 this Fable-judged evidence stands in for the human walks; no human-verification items remain.

## Independent re-runs (my process, not the SUMMARYs)

| Proof | Command | Result |
|-------|---------|--------|
| Full suite, run 1 | `node --test` | 875 pass / 0 fail / 0 skipped |
| Full suite, run 2 | `node --test` | 875 pass / 0 fail / 0 skipped |
| Six Phase-9 files | `node --test test/optimistic-locking-contract.test.js test/optimistic-locking-precondition.test.js test/optimistic-locking-cross-process.test.js test/client-conflict-dialog.test.js test/client-version-precondition.test.js test/asset-cache-bust.test.js` | 169 pass / 0 fail / 0 skipped; no `.skip`/`.todo` in any of the six files |
| Playwright real-deal lane | `PLAYWRIGHT_PATH=… node scripts/uat/phase9-walk.js --out <scratch>` | 350 PASS / 0 FAIL, 28 scenarios, committed `data/*.db` sha256-identical |
| Playwright demo-open lane | `… phase9-walk.js --demo-open --out <scratch>` | 18 PASS / 0 FAIL (anonymous version-less RAID/task updates 200, no `versionRequired`, no 409) |
| Multi-process soak smoke | `SOAK_DURATION_MS=15000 node scripts/soak.js` | PASS — 1210 acknowledged / 0 missing / audit 1:1; conflict lane 111 acknowledged, 238 real 409s, version reconciles exactly (112) |
| Decision coverage gate | `gsd-tools query check.decision-coverage-verify` | 9/9 CONTEXT decisions honored |

## Goal Achievement — Success Criteria SC1–SC9 (roadmap contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Stale write to any co-edited collection (RAID, task, DD finding, synergy, org) rejected 409, never clobbering | VERIFIED | `server.js:480-527` `conflictIfStale()`; 24 `conflictIfStale(req…)` call sites across every POST/DELETE on the 10 `VERSIONED_COLLECTIONS` lanes (`server.js:3216…6122`); WHERE-layer enforcement `db/store.js:394,430,526`; contract tests (1)-(44) + Part 1 structural gate (only 4 reasoned create-only allow-list entries: instantiate×2, copy-to-target, import) + Part 3 dual-lane; cross-process 7/7; Playwright `raid-f1`, `task-f1-never-edited`, `synergy-stage-never-edited`, `dd-f2`, `org-delete-anyway-f2`; soak conflict lane |
| SC2 | 409 shows reload-and-reapply path preserving the in-progress edit | VERIFIED | `transitions.js` held-promise session (`settleConflictSession` :233, `activateConflictSession` :903, `withFreshVersion` :445); `client-conflict-dialog` HP3/HP4/HP9/HP11/CF6; Playwright `raid-f2-apply`, `synergy-realized-f2`, `third-writer` (banner "the record changed again" re-renders in place — screenshot `third-writer-banner-390.png`) |
| SC3 | Different records save concurrently; lock bites per record | VERIFIED | Cross-process `(different records)`, `(integration tasks, different records)`, `(cross-collection)`; Playwright `different-records` 2/2; 09-01 truth list now states it (`09-01-PLAN.md:42`) |
| SC4 (F-1) | First co-edit of a never-edited record caught — client sends `version: 0`; real-deal versioned update with no precondition refused 400 | VERIFIED | Client: `window.maVersionOf` (`transitions.js:11`), 29 call sites (execution 19, org 5, DD 5), 5 `?expectedVersion=` delete URLs; zero `version:` lines not sourced from `maVersionOf` (org.js:982 passes the caller's `maVersionOf` value). Server: `server.js:507-512` (`record && req.isDemo !== true` → 400 `{error, versionRequired:true}`), fail-closed predicate GD-1b. Tests: precondition P1–P7, U1–U3, U6, T-demo, E-invalid; contract (3), (43); client-version-precondition C1; Playwright `task-f1-never-edited`, `synergy-stage-never-edited`, `raid-f1`, `raid-delete-f1`, `api-version-required` (400 body exactly `{error, versionRequired}`); demo lane proves D-09 leniency intact |
| SC5 (F-2) | After Apply / Delete anyway the page shows the server's state — no false self-conflict, no deleted row left, no DD refresh under the dialog | VERIFIED | Held promise resolves with the reapply's 2xx (`transitions.js:533,611`); WR-03 exits locked while in flight (`exitLocked = () => session.inFlight` :919; tests WR03a-c); DD refresh only after its own dialog closes (`due-diligence.js:33-36`, IN-02 comment corrected); Playwright `one-tab-no-self-conflict`, `raid-f2-apply`, `raid-f2-delete-anyway` (row gone from DOM and API), `org-delete-anyway-f2`, `synergy-realized-f2`, `dd-f2`, `task-discard-keeps-theirs` (GD-5 re-read after Discard) |
| SC6 (F-3/F-4/F-5/F-7) | Dialog tells the truth: per-route diff, clearance-aware copy + real 4xx reason, display labels, no contradictory attribution on deleted | VERIFIED | `CONFLICT_FIELD_MAP` :332 / `CONFLICT_FIELD_LABELS` :344 + `humaniseConflictKey`; neutral panel A3; withheld branch `isWithheld` :667 → `CONFLICT_WITHHELD_TEXT` :167, single Close; `conflictServerReason()` :484 (200-char cap, A6); deleted variant :753 title `Someone else deleted this`, no attribution. Tests DT4, DT6, DT8, DT9, DT13, HP13; Playwright `synergy-stage-f3`, `confirm-current-neutral-f3`, `phasing-month-f3`, `labels-f5`, `withheld-f4`, `reapply-4xx-f4`, `deleted-variant-f7`. Screenshots judged: `dialog-widths-edit-390.png` ("Target (M) · 2026-01"), `dialog-widths-withheld-390.png`, `dialog-widths-deleted-390.png` — copy byte-identical to the Copywriting Contract, orange only on Apply + mine border |
| SC7 (F-6) | Stale delete is one in-app prompt; native `confirm()` replaced; decision recorded | VERIFIED | `window.maConfirmDelete` (`transitions.js:1078`) at all 5 delete surfaces (`execution.js:260,1053,1096,1190`; `org.js:598`); no `window.confirm` remains on any delete path; UI-SPEC A8 records the decision. Playwright `delete-confirm-raid` (19), `delete-confirm-surfaces` (79: every surface, "native dialogs: 0", "two DELETEs (409 then 2xx)"), `confirm-widths`; screenshots `delete-confirm-state-390.png` (Cancel + red Delete), `delete-stale-state-390.png` |
| SC8 (R5-03) | Every `public/js|css` file changed since v2.1.0 carries a new `?v=` stamp; `login.html` loads current `style.css` stamp | VERIFIED | Changed since v2.1.0: style.css, transitions.js, execution.js, due-diligence.js, org.js. Stamps now vs v2.1.0: transitions 1791628622 (18 pages) vs 1784900002; style 1791625638 (20 pages incl. login.html, which was 1784500010) vs 1784600001; execution/due-diligence 1791628622; org 1791625638 vs 1784900011. `asset-cache-bust.test.js` frozen-table tests pass; Playwright `asset-stamps` 54/54 (requested == on-disk, > frozen, 200). `signage.html` does not load transitions.js (kiosk page, comment at :539) — not a gap |
| SC9 (docs) | 09-01 truths gain per-record / client-precondition / 409-clearance (each tested); UI-SPEC lists deleted-variant literals; UAT item-2 corrected; WINDOWS records org position-edit gap | VERIFIED | `09-01-PLAN.md:42,50,68` (tests: cross-process different-records; precondition P1–P3; CR-01 a–d); UI-SPEC Copywriting Contract rows A1/A2 + Amendments A1–A11; `09-UAT.md` test 2 expectation corrected 2026-10-10; `.planning/WINDOWS.md` #3 (org position-edit, routed Phase 18 IL-18) |

### Plan-level truths (09-01 must_haves, carried from the 2026-08-11 verification)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 10 | Enforcement is the SQL WHERE clause inside `writeDb()`'s `.immediate` txn (version bound as parameter) | VERIFIED | `db/store.js:394` `versionMatchSql` (json_type integer + range, else 0 — WR-04 mirror of `comparableVersion()` `db/collections.js:189`); structural binds-parameter test |
| 11 | WHERE-layer 409 never leaks uncleared field values; fails closed when no filter armed | VERIFIED | `conflictVisibleRecord()` `db/store.js:203`; `CLEARANCE_SCOPED_COLLECTIONS`; arming before every return incl. the 400 path (`server.js:489-496`); CR-01 (a)(b)(c)(c2)(d) pass; DD routes run `ddAreaRefused()` before `conflictIfStale()` (`server.js:5560,5594,5791,5821,5901`) |
| 12 | Structural gate fails the suite for any unguarded versioned route | VERIFIED | Part 1 + Part 2 (both directions) pass; allow-list has 4 reasoned create-only entries only |
| 13 | A conflict aborts the whole `writeDb()` call (conversions leave no orphans) | VERIFIED | contract (23)(24)(33)(34) pass |
| 14 | Update racing a delete is reported (`conflictKind: 'deleted'`), never a false success; non-numeric stored versions comparable (WR-04) | VERIFIED | cross-process `(update vs delete)`; `db/store.js:490`; WR-04 (a)(b)(c); IN-03 (a)(b) dual-channel mismatch → fixed 400 |

**Score:** 14/14 truths verified (0 present-but-behavior-unverified). Every behavior-dependent truth (held-promise settle, exit lock, focus trap, cross-process race, delete-then-reapply) has a passing behavioral test or a Playwright scenario naming it.

## R7 UAT gaps F-1..F-7 — closure verdicts

| Gap | Verdict | Evidence |
|-----|---------|----------|
| F-1 silent clobber of never-edited record | PASS | `server.js:507-512`; `transitions.js:11`; precondition P2 ("second update still carrying version 0 gets 409"); Playwright `task-f1-never-edited` (6/6), `synergy-stage-never-edited` (5/5) |
| F-2 page stale after Apply / Delete anyway | PASS | `transitions.js:533` settles with 2xx; Playwright `one-tab-no-self-conflict` (5/5), `raid-f2-delete-anyway` ("record gone from the DOM and the API"), `org-delete-anyway-f2`, `dd-f2` (16/16) |
| F-3 "No conflicting fields" on stage change | PASS | A3/A4 field map (`targetStage`→`stage`, per-month cell); retired sentence absent from `transitions.js`; Playwright `synergy-stage-f3`, `confirm-current-neutral-f3`, `phasing-month-f3`; test DT4 |
| F-4 withheld record misleads; 403 as "network error" | PASS | `CONFLICT_WITHHELD_TEXT`, `conflictServerReason()`; DT8/DT9; Playwright `withheld-f4` (9/9), `reapply-4xx-f4` (6/6) |
| F-5 raw key labels | PASS | `CONFLICT_FIELD_LABELS` + humaniser, no CSS case transform; DT6; Playwright `labels-f5`; screenshot shows "Target (M) · 2026-01" |
| F-6 native confirm stacked before stale delete | PASS | `maConfirmDelete` at every delete site, no `window.confirm` on delete paths; Playwright `delete-confirm-surfaces` 79/79 incl. "native dialogs: 0" |
| F-7 contradictory attribution under "deleted" | PASS | `transitions.js:753` branch renders no attribution element; DT13; Playwright `deleted-variant-f7` |

## Adversarial checks (what the plans could have missed)

- **Client writers without a precondition** — every `method: POST/DELETE` site in execution/org/due-diligence.js was inspected. The 13 without `maVersionOf` are all creates or create-only bulk routes (task/synergy/RAID/finding/item create, `instantiate`×2, `copy-to-target`, `import`, append-only `org/decisions`, control-plane `vdr-grants`) — exactly the server allow-list plus creates (D-06). No versioned update/delete site omits a precondition.
- **Server routes** — every `app.post/delete` touching a versioned lane either calls `conflictIfStale()` or is one of the 4 reasoned create-only allow-list entries; the Part 1 gate scans real handler bodies so a future route cannot slip.
- **DD clearance-filtered 409 bodies** — route layer refuses uncleared callers before the precheck (`ddAreaRefused` first), the precheck filters through `publicDdItem()`/grant check, and the WHERE layer fails closed via `CLEARANCE_SCOPED_COLLECTIONS`; the 400 bodies are fixed literals. CR-01 (a–d, c2) pass; Playwright `withheld-f4` renders the documented null-record body with no field values.
- **WR-04 non-numeric stored version** — single `comparableVersion()` rule (`Number.isSafeInteger(v) && v >= 0 ? v : 0`) used by precheck, both throw sites, the client, and mirrored in SQL via `json_type`; WR-04 (b) seeds `"v2"`, `1.5`, `true`, `-1` and proves the rows are editable again.
- **WINDOWS #4 demo-open anonymous redirect loop** — assessed as **pre-existing in v2.1.0, not a Phase 9 regression**: `public/js/deal-switcher.js` and `db/resolver.js` (`CONTROL_PLANE_PATHS` incl. `/api/deals`) are byte-identical to the v2.1.0 tag (`git diff --stat v2.1.0..HEAD` empty); the `authRequired` → `/login.html` redirect and the deal-switcher script injection exist at `v2.1.0:public/js/transitions.js:46,1273`; `/api/auth/me` returned `{authEnabled:false}` under `DEMO_OPEN=1` at `v2.1.0:server.js:591`. It is tracked (WINDOWS #4 open, `deferred-items.md` D-1) and the demo lane the showcase actually uses (signed-in, deal-less) is proven by `demo-smoke` 18/18. Not a Phase 9 gap; it must be owned before CERT-03 (demo regression check) closes.
- **Test quality** — no skipped/todo tests in the six requirement-linked files; assertions are value/behavioral level (409 bodies, stored versions, DOM state, request counts); no circular fixtures (expected values are literals or server state re-read via the API).

## Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `db/collections.js` | VERIFIED | `VERSIONED_COLLECTIONS` (10, self-checked), `CLEARANCE_SCOPED_COLLECTIONS`, `comparableVersion()` |
| `db/store.js` | VERIFIED | WHERE-layer `versionMatchSql`, `makeConflictError`, `conflictVisibleRecord`, deleted-kind throw |
| `server.js` | VERIFIED | `parseExpectedVersion()` (mismatch rule), `conflictIfStale()` (400 versionRequired, CR-01 arming first), 24 call sites, central 409 middleware |
| `public/js/transitions.js` | VERIFIED | `maVersionOf`, held-promise sessions, field map/labels, withheld/deleted variants, `maConfirmDelete`, focus trap, busy reason, `?v=1791628622` on 18 pages |
| `public/js/execution.js`, `org.js`, `due-diligence.js` | VERIFIED | 29 `maVersionOf` sites, 5 `maConfirmDelete` sites, refresh only after own dialog closes |
| `public/css/style.css` | VERIFIED | `.conflict-modal*` rules; stamp 1791625638 on all 20 pages incl. login.html |
| `scripts/uat/phase9-walk.js` + 7 scenario modules | VERIFIED | Isolated temp DBs, sha256 integrity check, 28 scenarios, `--demo-open` lane; re-run clean by me |
| Tests (6 files) + `test/helpers/held-version.js` | VERIFIED | 169/169; helper route table structurally cross-checked |
| `09-VALIDATION.md`, `09-UI-SPEC.md` A1–A11, `09-UAT.md`, `WINDOWS.md` #3/#4 | VERIFIED | Re-signed; literals match code |

## Anti-Patterns

None. `TBD|FIXME|XXX|HACK|PLACEHOLDER|TODO` scan over every phase-modified source, test and harness file: zero matches.

## Residual risks (non-blocking, recorded)

1. `execution.js:879` — "generate-phasing" still uses a native `window.confirm` before a versioned POST (a non-delete; UI-SPEC A8 covers deletes only). A stale regenerate is therefore confirm → 409 → dialog. Not an SC7 violation; candidate for an A8 extension.
2. WINDOWS #2 (no client delete UI for flight-risk / DD) and #3 (no org position-edit UI) remain open product gaps routed to later phases; server-side protection is complete for all routes.
3. WINDOWS #4 demo-open anonymous redirect loop — pre-existing v2.1.0 (see above); owner needed before CERT-03.
4. Dialog copy is EN-only by signed decision (Phase 19 owns runtime-copy localisation).
5. Pre-existing intermittent `audit-security-events` flake — not seen in either of this verification's two full runs.

## Decision Coverage

All trackable CONTEXT.md decisions are honored by shipped artifacts (9/9). D-07 (control plane deferred) intentionally untouched by the gap closure.

## Human Verification Required

None. The previously routed two-tab walks are satisfied by the re-run Playwright evidence (Fable-judged against the written contracts per the 2026-08-08 standing directive); FA-1/FA-2 were resolved in 09-15 (truth list amended; UI-SPEC A1).

## Gaps Summary

No gaps. The reopened CONC-02 contract — including the first co-edit of a never-edited record and the real-deal 400 refusal of a precondition-less versioned update — is demonstrably true in the codebase at the HTTP, storage (real spawned processes, soak) and real-browser levels, with the committed demo DBs untouched by every run.

---

_Verified: 2026-10-10 — Claude (gsd-verifier, Fable 5.1)_
_verification: automated — Fable-reviewed per standing directive (2026-08-08)_
