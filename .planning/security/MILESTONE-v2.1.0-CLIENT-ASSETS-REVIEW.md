# Milestone v2.1.0 — Whole-Codebase Security Review (Fable 5)
## Lane: Client-side injection · Vendored/third-party assets · Launcher/deployment surface

- **Repo:** /Users/karstenhaldan/M&A
- **HEAD:** 54d91865867b97ff0df381a0e50f22e73d9b7769 (branch `main`)
- **Reviewer model:** Fable 5 (client/assets/supply-chain lane; a second agent owns server-side MNPI-controls composition)
- **Threat model driving this lane:** Demo and real-deal share ONE origin. A stored-XSS payload injected into the open demo lane (DEMO_OPEN=1 → all `/api` auth disabled) executes in an Integration Lead's browser while they hold a real-deal session in another tab. HttpOnly stops cookie *theft* but not cookie *use* — the injected script can make same-origin `fetch()` calls that the browser auto-attaches the real-deal session cookie to, exfiltrating or mutating MNPI. Therefore **any** stored-string→innerHTML sink reachable in either lane is in scope.
- **Framing (per user directive):** This report says CHECKED / FOUND / NOT covered. It does NOT claim "secure" or "perfect." Working exploit strings for still-open sinks are deliberately omitted (`.planning/` has been public historically); sink class + field are described instead.

---

## Executive Summary (honest)

**Verdict: OPEN_FINDINGS.** The prior milestone review (2026-08-06) proved only 2 of ~345 `innerHTML` sinks and fixed one stored-XSS chain. This lane confirms the prior fixes are intact **and** that the unescaped-stored-string→innerHTML **class is not eliminated** — it is reduced, not closed. I traced a representative subset (~35 of the 345 sinks across the flagged files, plus a full pass over the NEW Phase 4–7 client files), not all 345.

Headline results:

- **VERIFIED CLOSED / intact:**
  - Widened `on*`-handler sanitizer class `[\s/]on\w+\s*=` present and byte-identical in all THREE copies (page-layout.js, transitions.js, lib/sanitizeHtml.js). No regression. Cache-stamps present and current on both patched client files.
  - Vendored Phase-7 font `NotoSansSC-Regular.otf` — committed SHA-256 exactly matches the recorded provenance value; size matches.
  - `public/sent_emails/` .gitignore uses the correct contents-glob + negation; only the single demo file is tracked; no new sent-email artifact leaked.
  - The NEW Phase 4–7 client files (execution.js, org.js, due-diligence.js, deal-wizard.js, deal-switcher.js, deal-home.js, capability-hub.js, integration-excellence.js, assess-charts.js) are DOM-safe by construction — MNPI is written via `textContent`, and execution.js's 10 `innerHTML` sinks all pass stored strings through `esc()` while money fields are coerced to numbers server-side.

- **OPEN FINDINGS:**
  - **F-1 (HIGH):** Unescaped stored-string→innerHTML sinks remain in legacy client chrome/showcase files. Confirmed concrete candidates: Quick-Nav bookmark labels (transitions.js), signage roster leaderboard (signage.js), and the assessment question inline-edit textarea (admin.js). All three interpolate server-stored strings writable by `admin/hrbp/pmo` and viewed by other users / the IL.
  - **F-2 (MEDIUM):** The vendored 37MB Transformers.js blob has no recorded provenance hash / no lockfile / never `npm audit`-ed, and at runtime it sets `allowLocalModels=false` and downloads model weights from the **remote** Hugging Face Hub with no integrity check — breaking the project's self-contained / no-CDN posture for that feature.
  - **F-3 (MEDIUM, deployment):** Both shipped launchers set `DEMO_OPEN=1` unconditionally; the only guard is a boot `console.warn`. A shared-host operator who runs the shipped launcher opens the entire API unauthenticated.
  - **F-4 (MEDIUM, deployment):** The default admin password `TEdemo!2026` is published inline in `login.html` (rendered in all modes, auto-filled) with no forced rotation.

---

## 1. innerHTML sink-class triage

**Scope honesty:** `grep -rn innerHTML public/js/*.js` = **345** matches. I concretely traced ~35 (every candidate the prior review named, every stored-string field the grep surfaced across the 8 highest-count legacy files, and a full pass of the NEW Phase 4–7 files). **A sink triage reduces but does not eliminate the class.** The ~310 sinks I did not individually open are predominantly (a) app-controlled enum/number/i18n-key interpolations and (b) `escapeHtml()`/`esc()`-wrapped stored strings in the high-escape files (dashboard.js escapes 67×, employee.js 34×, admin.js 29×) — but that is an inference from density, not a per-line proof.

Verdict legend: **SAFE** (number/enum/i18n-key, or escaped, or textContent, or hardcoded literal / per-browser localStorage) · **CANDIDATE / CONFIRMED** (server-stored string field, cross-user reachable, interpolated raw into markup).

| File:line | Field(s) | Source | Verdict |
|-----------|----------|--------|---------|
| transitions.js:1396–1399 (`renderQuickLink`) | `item.title` (=bookmark `label`), `item.href` (=`page`+`#section`), `item.icon` | `/api/menus` `.bookmarks` (stored CMS; write ACL = admin/hrbp/pmo) | **CONFIRMED** — raw into Quick-Nav FAB markup, rendered for every user on every page in BOTH modes; `href` also unescaped (scheme not sanitized at the sink) |
| signage.js:300–301 | `emp.name`, `emp.role`, `emp.department`, `emp.badge` | `/api/employees` roster (MNPI names) | **CONFIRMED** — raw into signage leaderboard innerHTML; signage.js has no escape helper |
| admin.js:375 (`activateInlineEdit`) | `q.text` | `/api/questions` (assessment question text; write ACL admin/hrbp/pmo) | **CONFIRMED** — raw into a `<textarea>` (textarea-breakout context); note the list view at admin.js:288 DOES `escapeHtml(q.text)`, the edit view does not |
| signage.js:216–217, 332–333 | `todayEvent.title/desc`, `current.title/body` | `INTEGRATION_EVENTS`, `BULLETIN_ANNOUNCEMENTS` (hardcoded local arrays) | SAFE (app-controlled literals) |
| supporting.js:164–165, 200–201, 252 | `bull.title/text`, `role.name/spec`, `task.title` | hardcoded `bulletins[]` + per-browser `localStorage` | SAFE (literals / self-only localStorage; not cross-user) |
| pmo.js:334/336, 435/436 | `blocker.title/desc`, `task.title/desc` | hardcoded `defaultBlockers`/`defaultTasks` + localStorage | SAFE (literals / self-only) |
| pmo.js:1073/1076 | `s.title/desc/status/color` | hardcoded `suggestions.push({...})` literals | SAFE (prior-review candidate → cleared) |
| admin.js:1633–1649 | `e.name/role/department`, `h.name/role` | `/api/employees`, `/api/hrbps` | SAFE — assigned via `.textContent`/`opt.value`/`.dataset`, not innerHTML |
| admin.js:2101/2167/2170 | `m.text` | hardcoded `milestones[]` migration-ceremony array | SAFE (literals) |
| dashboard.js:177–185 | `d.name/desc/phase/icon`; `tk.title/desc/badge` | `/api/departments`; hardcoded `TRACK_I18N` keys | SAFE — stored fields `escapeHtml()`-wrapped; `attr()` receives hardcoded i18n keys |
| transitions.js:1148–1158 | `prof.name/role/email` | hardcoded `roleProfiles` map | SAFE (app-controlled literals) |
| transitions.js:895–898 (`renderSideLink`) | `item.title/desc/href` | base sidebar = hardcoded per-role nav; CMS overrides applied via `applyMenuOverrides()` which sets labels through `.textContent` | SAFE for the traced paths (base = literals; override = textContent). Not the same sink as the bookmark path above |
| transitions.js:2486/2494/2499 | `r.title/text`, `e.message` | RAG index (vendored playbook) / error objects, returned as chatbot **string** | Lower-risk — content app-controlled (playbook index), and sink is the chatbot message renderer (not re-verified as innerHTML); flagged for follow-up, not confirmed |
| leaders.js:53 | `activeLeader.name` | `/api/employees` | SAFE — set via `.textContent` (this is the prior-review fix site; fix intact) |
| execution.js (10 sinks: 117,132,155,218,222,415,696,698,994,1008) | task/synergy/RAID `title`,`owner`,`notes`,`category`,`severity`,`workstream label`; money | `/api/integration-tasks`, `/api/synergies`, `/api/raid` | SAFE — every stored string wrapped in `esc()`; money fields (`realizedM/targetM`) are `z.union([number,string])` at the validator but coerced to numbers server-side via `num = roundSynergyMoney` (parseFloat) before storage, so raw numeric interpolation cannot carry markup |
| admin-cms.js (label/esc sinks) | CMS course/lesson/page/menu titles | `/api/courses`,`/api/pages`,`/api/menus` | Mostly SAFE — innerHTML uses are `esc(label(...))`-wrapped; raw `label()` uses at :186/:483/:666/:741 are `confirm()`/`modal()` title/`toast()` args (admin-authored, admin-viewed) — low-priority follow-up on `modal()` title rendering |

### F-1 finding statement (HIGH)
The unescaped-stored-string→innerHTML class is **not eliminated**. Three concrete cross-user sinks are confirmed:

1. **Quick-Nav bookmark labels (transitions.js:1396–1399).** Bookmarks come from `/api/menus.bookmarks`. The `.label`, `.page`/`.section` (→ `href`), and `.icon` are interpolated raw into the Quick-Nav markup, which renders in the app chrome for **every** user on **every** page, in **both** demo and real-deal modes. Write access to `/api/menus` is `DEFAULT_WRITE_ROLES = [admin, hrbp, pmo]` — so a **pmo** user can persist a payload that fires in an **admin/IL** browser (a real-deal cross-privilege stored-XSS, independent of the demo lane). In the demo lane (DEMO_OPEN=1) the same write is unauthenticated. The `href` is also emitted unescaped at the sink (attribute + scheme not sanitized there).
2. **Signage roster leaderboard (signage.js:300–301).** `emp.name/role/department/badge` from `/api/employees` (MNPI employee names) render raw; signage.js has no escape helper at all. Showcase/kiosk surface, same origin.
3. **Assessment question inline-edit (admin.js:375).** `q.text` renders raw inside a `<textarea>` when a question is opened for editing (the list view escapes it; the edit view does not). Textarea content is a breakout context. Questions are admin/hrbp/pmo-writable and viewed by an admin on edit.

**Why this matters under the milestone threat model:** each is a persistent, server-stored string that a lower-or-equal-privileged actor writes and a higher-value actor (IL/admin) later renders — and every one shares the origin an IL uses for a live MNPI deal.

---

## 2. Vendored / third-party asset assessment

### 2a. Transformers.js blob — `public/vendor/transformers/` (37MB: transformers.min.js + 4 ONNX WASM) — **F-2 (MEDIUM)**
- **Runtime loading (CHECKED):** referenced from exactly one place — `transitions.js:2093` via a lazy `import('/vendor/transformers/transformers.min.js')` inside `runRealTransformersDownload()`. It is **not** loaded on normal page load; it runs only when a user clicks through the "AI Insight" model-download wizard (a demo/gamification "coach/duck" feature). Single, user-gated entry point.
- **Attack surface (FOUND):** on activation it sets `transformers.env.allowLocalModels = false` and calls `transformers.pipeline('text2text-generation', 'Xenova/LaMini-Flan-T5-78M' | 'Xenova/Qwen1.5-0.5B-Chat', …)`. With local models disabled, **model weights are fetched from the remote Hugging Face Hub at runtime** ("Connecting to Hugging Face Hub…"), with **no** subresource/integrity check. So although the *library* WASM is vendored locally (`wasmPaths='/vendor/transformers/'`), the *model* is remote-downloaded and then parsed/executed by the ONNX WASM runtime in the browser. This (a) breaks the project's stated self-contained / no-CDN posture for this feature, and (b) introduces a runtime remote-content dependency parsed by a WASM runtime — a supply-chain surface if the Hub fetch is MITM'd or the pinned repo is compromised.
- **Provenance (NOT covered / gap):** unlike the Phase-7 font, there is **no recorded SHA-256, no lockfile entry, and no `npm audit` trail** for the vendored 37MB minified blob. I did not diff `transformers.min.js` against an upstream release or audit its minified contents. Its provenance is therefore unverified.
- **Reachability:** demo-flavored (AI Insight wizard) but shares the single origin; `browserModel` is persisted via `/api/settings` (write ACL admin/hrbp/pmo). Not auto-executing.

### 2b. Phase-7 font — `public/vendor/fonts/NotoSansSC-Regular.otf` — **VERIFIED**
- Recorded (07-03-SUMMARY.md:145): `faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9`, 8,331,336 bytes, SIL OFL 1.1, upstream `notofonts/noto-cjk` release `Sans2.004` asset `18_NotoSansSC.zip`.
- Committed file on disk: `shasum -a 256` = `faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9`, size 8,331,336 bytes. **Exact match.** The font parsed by the PDF pipeline is provenance-intact.

### 2c. Sanitizer widened class — **VERIFIED intact in all 3 copies**
- `public/js/page-layout.js:19–21`, `lib/sanitizeHtml.js:50–52`, `public/js/transitions.js:3344–3346` — all three carry the identical trio:
  - `.replace(/[\s/]on\w+\s*=\s*"[^"]*"/gi, '')`
  - `.replace(/[\s/]on\w+\s*=\s*'[^']*'/gi, '')`
  - `.replace(/[\s/]on\w+\s*=\s*[^\s>]+/gi, '')`
- The leading `[\s/]` class (which also eats `/on\w+=` URL path segments) is the deliberate, documented over-aggression that keeps the `<img src="x"/onerror=…>` bypass closed. Per the prior decision this is correct and is NOT flagged. No copy has regressed to a narrowing lookbehind.
- **Cache-stamps:** both patched client files ship a current `?v=` stamp (`page-layout.js?v=1784900001`, `transitions.js?v=1784900001` — the latest stamp cohort across 23 script tags), so browsers re-fetch the patched code. (`lib/sanitizeHtml.js` is server-side, not `?v=`-stamped.)

---

## 3. Launcher / deployment surface

### F-3 (MEDIUM, deployment) — launchers open the whole API
- `start.command:30` → `export DEMO_OPEN=1`; `start.bat:40` → `set "DEMO_OPEN=1"`. Both set it **unconditionally**.
- `DEMO_OPEN=1` disables the ENTIRE mandatory session gate for every `/api/*` route (server.js `isOpenMode()` / consolidated gate at server.js:410).
- **Only guard:** server.js:207–208 emits `console.warn('[security] DEMO_OPEN=1 — ALL /api authentication and authorization is DISABLED. …')` at boot. There is **no** separate real-deal launcher, **no** interactive confirmation, **no** refusal, **no** distinct bundle. The distinction between demo and real-deal is purely convention: "real-deal runs `node server.js` directly, so it stays fail-closed" (documented in the launcher comments + WR-03).
- **Risk:** a shared-host operator who copies/double-clicks the shipped `start.command`/`start.bat` (the natural thing to do) silently opens the full API — MNPI included — unauthenticated. The single stderr line scrolls past in the boot output. This is a documented design decision, not an oversight, but the mitigation is log-only and easily missed. Recommend a louder gate (e.g. refuse `DEMO_OPEN=1` unless a demo DB is resolved, or a separate clearly-named `start-demo.*` vs a real-deal launcher, or a boot banner requiring acknowledgement).

### F-4 (MEDIUM, deployment) — published default admin credential
- `login.html:46` renders `Password for all: TEdemo!2026 — click an account to fill the form. Change these before real use.` and `login.html:70` auto-fills it. The demo-accounts panel (`.lg-demo`, lines 41–46) is **static HTML with no mode-gating** — it renders on the login page in **all** modes, including a real-deal deployment stood up from the same bundle.
- The seed hashes correctly verify `TEdemo!2026` (this is NOT a hash-cracking issue). The risk is **default-credential exposure**: a real-deal deployment that does not rotate the seeded `admin` account is accessible with a password the login page itself publishes. Mitigation present = the "Change these before real use." caveat; there is no forced first-login rotation and no technical enforcement.

### sent_emails — **VERIFIED**
- `.gitignore:67–68`: `public/sent_emails/*` then `!public/sent_emails/comm_1783454326531.html` — correct contents-glob + negation form (a directory-level `public/sent_emails/` ignore could not re-include a nested file; the `/*` form can).
- `git ls-files public/sent_emails/` = only `comm_1783454326531.html`. Working tree holds only that one file. **No new secret-bearing sent-email artifact has leaked into git.**

---

## 4. What was NOT covered (explicit)

- **~310 of 345 `innerHTML` sinks** were not individually opened. The class is reduced by this triage, not proven closed. The unopened remainder is inferred-safe from escape density and enum/number/i18n-key patterns — inference, not per-line proof.
- **Transformers.js blob contents** — the 37MB minified `transformers.min.js` and the ONNX WASM were not decompiled/diffed against an upstream release; provenance is unverified (no recorded hash exists to check against).
- **The remote model weights** (LaMini-Flan-T5-78M / Qwen1.5-0.5B-Chat) fetched from HF Hub were not fetched or hash-pinned; runtime supply-chain integrity of those downloads is out of scope here.
- **transitions.js chatbot renderer (r.title/r.text/e.message → chat message)** — I did not confirm whether the assistant-message sink is `textContent` or `innerHTML`; content is app-controlled (playbook RAG index), so risk is low, but the sink itself is unverified.
- **admin-cms.js `modal()` title rendering** with raw `label()` (admin-authored, admin-viewed) — not opened; low priority (self-XSS class).
- **CSS-injection / `style="…"` sinks** where hex colors / widths are interpolated (e.g. execution.js RAG colors, pmo card `cssText`) — these use app-controlled palette values; not exhaustively audited for a CSS-context breakout.
- **Server-side MNPI-controls composition** — explicitly out of this lane (second agent).

---

## 5. Overall verdict

**OPEN_FINDINGS** — 4 open (1 HIGH, 3 MEDIUM), several items VERIFIED closed/intact.

| ID | Sev | Title | Location |
|----|-----|-------|----------|
| F-1 | HIGH | Unescaped stored-string→innerHTML class not eliminated (bookmark labels / signage roster / question inline-edit) | transitions.js:1396–1399; signage.js:300–301; admin.js:375 |
| F-2 | MED | Transformers.js: no provenance hash/lockfile/audit; runtime remote model fetch (allowLocalModels=false) breaks self-contained posture | public/vendor/transformers/; transitions.js:2093–2100 |
| F-3 | MED | Launchers set DEMO_OPEN=1 unconditionally; guard is log-only | start.command:30; start.bat:40; server.js:207 |
| F-4 | MED | Published default admin password in login.html, all modes, no forced rotation | login.html:46,70 |

| Verified closed/intact |
|------------------------|
| Sanitizer `[\s/]on\w+\s*=` class intact in all 3 copies; cache-stamps current |
| Phase-7 font SHA-256 exact match (faa6c9df…5ea9) |
| sent_emails .gitignore form correct; no new leak |
| NEW Phase 4–7 client files DOM-safe (textContent / esc() / server-side numeric coercion) |
| Prior leaders.js XSS fix intact (textContent) |



---

## REMEDIATION OUTCOME (2026-08-10, quick task 260810-erm)

All code-fixable findings from this review were fixed and verified before the embargo on this report was lifted (commits `15b2a86` F-1/F-3 task-lane clean-room filter · `0644c7b` F-2 client XSS ×3 + cache-stamps · `b5e111a` CSV whitespace guard · `646208e` MNPI read-audit · docs `4af0631`). Suite 655 → **687/687** (+32 tests incl. `test/task-access-filter.test.js` four-identity harness; F-1 leak-closed independently reproduced by the orchestrator). **DEFERRED to the user at release cut (demo-vs-real deployment DECISIONS, not code bugs — the demo showcase is a maintained deliverable): DEMO_OPEN=1 in launchers, default admin password published in login.html, transformers vendored blob remote model download.** `db_kind:.control` residual confirmed cosmetic (no query filters on it). Honest limit retained: only ~35 of ~345 client `innerHTML` sinks were traced — the class is reduced, not eliminated (`pmo.js:1073-1076` remains an unproven candidate for a future pass).
