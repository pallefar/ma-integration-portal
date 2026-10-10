---
phase: 13-content-safety
plan: 01
subsystem: security / content-safety
tags: [sanitize-html, xss, allowlist, supply-chain, SAFE-01]
requires: []
provides:
  - lib/htmlPolicy.js (the single allowlist table; client renderer 13-06 is parity-tested against it)
  - lib/sanitizeHtml.js (parser-based, same `{ sanitizeHtml }` export)
  - test/helpers/html-inert.js (structural inertness checker reused by later plans)
  - test/fixtures/xss-corpus.json (313 vectors), test/fixtures/cms-golden.json
affects: [13-06, 13-09, validators/index.js htmlField (invisible swap)]
tech-stack:
  added: [sanitize-html@2.17.5 and 16 pure-JS transitives]
  patterns: [allowlist parser re-serialization, fixed-point idempotency with escaped-text fail-closed fallback]
key-files:
  created:
    - lib/htmlPolicy.js
    - test/sanitize-html.test.js
    - test/helpers/html-inert.js
    - test/fixtures/xss-corpus.json
    - test/fixtures/cms-golden.json
  modified:
    - lib/sanitizeHtml.js
    - package.json
    - package-lock.json
    - test/xss-sanitization.test.js
    - test/xss-chain.test.js
decisions:
  - "PD-1 held: sanitize-html 2.17.5 (122 days old on 2026-10-11); no advisory forced 2.17.6+"
  - "Two extra overrides beyond the planner's launder/postcss: nanoid 3.3.19 and source-map-js 1.2.1 (newest in range were 5 and 10 days old)"
  - "Fallback escapes only & < > so the fail-closed value is itself a fixed point of the sanitizer"
status: complete
actuals:
  tokens: 22000   # chars/4 over the 6 new non-vendored files (86,427 chars) + test edits; vendored node_modules excluded
  tasks: 3
  commits: 4
---

# Phase 13 Plan 01: SAFE-01 sanitizer tracer Summary

Vendored `sanitize-html@2.17.5` behind the unchanged `sanitizeHtml` export, driven by one frozen allowlist table
(`lib/htmlPolicy.js`); the four R1-03 payloads are inert end-to-end through the real `POST/GET /api/pages` route and a
313-vector corpus is inert and idempotent.

## Commits

| Task | Commit | Content |
|------|--------|---------|
| 1 (tracer) | `523f883` | vendored tree (15 new package dirs), lib/htmlPolicy.js, lib/sanitizeHtml.js, test/sanitize-html.test.js, test/helpers/html-inert.js, package.json/lock |
| 2 | `d505637` | xss-corpus.json (313), cms-golden.json, corpus/idempotency/golden subtests |
| 3 | `35c130d` | test/xss-sanitization.test.js, test/xss-chain.test.js |

Tracer gate: `<verify>` re-run green after Task 1 (`node --no-experimental-require-module -e "require('sanitize-html')"`,
`node --test test/sanitize-html.test.js`, `git status --porcelain node_modules` additions only) — expansion continued.

## Package legitimacy audit (executor re-verification, 2026-10-11, `npm view`)

Age gate >= 14 days (published on or before 2026-09-27). Every package: MIT/BSD/ISC-class licence, pure JS (no `*.node`,
no `binding.gyp`), no `preinstall`/`install`/`postinstall` script (the `dom*`/`htmlparser2`/`entities@4`/`is-plain-object`
registry metadata lists only `prepare`, which npm does not run for registry dependencies), installed with `--ignore-scripts`.

| Package | Version | Published | Age (d) | Note |
|---------|---------|-----------|---------|------|
| sanitize-html | 2.17.5 | 2026-06-10 | 122 | apostrophecms maintainers (alexgilbert, boutell, romanek, bodonkey) |
| htmlparser2 | 10.1.0 | 2026-01-21 | 262 | dual CJS/ESM, loads without require(esm) |
| domhandler | 5.0.3 | 2022-04-30 | 1624 | |
| domutils | 3.2.2 | 2025-01-06 | 642 | |
| dom-serializer | 2.0.0 | 2022-04-09 | 1645 | |
| domelementtype | 2.3.0 | 2022-04-07 | 1647 | |
| entities (top) | 7.0.1 | 2026-01-21 | 262 | |
| entities (nested under dom-serializer) | 4.5.0 | 2023-04-13 | 1276 | |
| deepmerge | 4.3.1 | 2023-03-16 | 1304 | |
| escape-string-regexp | 4.0.0 | 2020-04-23 | 2361 | |
| is-plain-object | 5.1.0 | 2026-08-21 | 50 | |
| parse-srcset | 1.0.2 | 2016-12-10 | 3591 | |
| launder | 1.7.1 (override) | 2026-05-13 | 150 | 1.7.2 is < 14 d |
| dayjs | 1.11.23 | 2026-08-17 | 54 | |
| postcss | 8.5.28 (override) | 2026-09-03 | 37 | 8.5.29 is < 14 d |
| picocolors | 1.1.1 | 2024-10-16 | 724 | |
| nanoid | 3.3.19 (override) | 2026-09-10 | 30 | newest 3.3.20 is 5 d old — **added override** |
| source-map-js | 1.2.1 (override) | 2024-09-08 | 762 | newest 1.2.2 is 10 d old — **added override** |

Copied package list (all absent from the repo beforehand; none overwritten): dayjs, deepmerge, dom-serializer (+nested
entities@4.5.0), domelementtype, domhandler, domutils, entities, escape-string-regexp, htmlparser2, is-plain-object,
launder, nanoid, parse-srcset, picocolors, postcss, sanitize-html, source-map-js. Layout matches the lockfile (nanoid and
source-map-js hoisted). The scratch install's `postcss/node_modules/.bin` symlink dir was not copied.
`git status --porcelain node_modules` shows only `??` additions; no ignored file under any new package.

## Corpus

313 vectors: attribute-separator 34, entity-scheme 31, whitespace-scheme 33, nested-reconstruction 26,
namespace-confusion 25, mxss 32, frame-and-form 32, css 29, unicode 21, event-and-clobber 50 (R1-03-a..d verbatim).
PD-3 escaped-text fallbacks over the corpus: **0** (limit 5 %). Golden: 48 tagged demo values (12 page bodies, 36 lesson
bodies) byte-identical; 8 banner values asserted untagged.

## Edited assertions (before -> after)

test/xss-sanitization.test.js
- (a) `!/<script/i`, `!/onerror\s*=/i`, `!/javascript:/i` on output -> `inertViolations(stored)` empty; `/<p>Welcome<\/p>/` / `/<b>…<\/b>/` regexes -> `includes()` of the same strings.
- (d) `!/<script/i` / `!/onclick/i` on output -> `inertViolations(...)` empty; `/<p>after<\/p>/` -> `includes('<p>after</p>')`.
- (e) `!/<script/i` -> `inertViolations` empty (byte-identical `assert.strictEqual(page.body.en, encoded)` unchanged and still passes).
- KNOWN RESIDUAL LIMITATION (asserted `<script>` WAS reconstructed) -> inverted: "a nested-tag reconstruction payload is neutralized by the parser"; asserts inert + no `<script` + idempotent. Header comment updated (T-03-36 retired).

test/xss-chain.test.js ((a1)–(a6) untouched)
- (b1), (b1-whitespace): `!/on\w+\s*=/i.test(result)` -> `inertViolations(result)` empty.
- (b2): benign list kept byte-identical for `<p class>`, `<strong>`; added `<ul><li>` and `<table>` cases. REMOVED from the byte-identical list: `<a href="/playbook/...">` (now keeps href + forced `rel`, asserted structurally in new (b2-policy)) and `<input type="checkbox" id="chk-1">` (`input`/`id` are PRD never-allowed — asserted removed in (b2-policy)).
- (b3): pre-fix frozen regex differential -> structural DOM differential (parse both, compare element tree/attrs/text). Zero unexplained divergences over 3,992 i18n strings + 12 page bodies; the one documented exception (24 playbook strings embedding `<input type="checkbox">`) is pinned to exactly 24 and a name pattern.
- (b4): three regex copies -> asserts `lib/sanitizeHtml.js` carries zero handler-strip regex lines and keeps only page-layout.js <-> transitions.js parity (13-06/13-09 retire those).

## Deviations from Plan

**1. [Rule 3 - Blocking] Two additional `overrides` (nanoid 3.3.19, source-map-js 1.2.1)** — the planner's check listed only launder/postcss; at execution date the newest in-range nanoid (3.3.20, 5 d) and source-map-js (1.2.2, 10 d) were under the 14-day gate. Pinned via `overrides`; verified ages above.

**2. [Rule 2 - Missing critical] test/helpers/html-inert.js added** (not in `files_modified`) — the structural inertness checker is needed by three test files; a shared helper avoids triple duplication. It matches the node:test directory pattern harmlessly (no tests in it).

**3. node_modules/.package-lock.json** — `npm install --package-lock-only` rewrote this tracked hidden lockfile; reverted with `git checkout -- node_modules/.package-lock.json` to honour "no pre-existing file under node_modules/ is modified". The hidden lockfile is therefore stale versus the tree (npm treats it as a cache and prefers package-lock.json).

**4. Fallback escape set** — the PD-3 fallback escapes only `& < >` (the parser's own text-escape set), not quotes, so the fallback value is itself a fixed point of the sanitizer (idempotency holds on the fail-closed path too; proven by a cache-stubbed non-convergence test).

## Findings for later plans (not fixed here)

- **13-09 / 13-06 content regression risk:** 24 shipped i18n strings (`playbook.culture_milestone_1..3`, `playbook.talent_checklist_1..3` x en/de/zh/cs-equivalents) embed `<input type="checkbox" style="accent-color:…">`. `input` is on the PRD never-allowed list, so `MASafeHtml` will drop the checkbox when it renders those `[data-i18n-html]` values. Decide in 13-09 whether the playbook checklist is restyled (e.g. `☐` glyph) or the strings are edited; the dictionary is deliberately not server-tagged (PD-5).
- Tagged fields now re-serialize plain `&` as `&amp;` and `<br>` as `<br />` (DOM-identical). Any renderer of a tagged field must treat it as HTML (it already does: page-layout.js renders the value as markup).
- Legacy stored content is re-sanitized by the Phase-12 migration plan, not this plan.

## Known Stubs

None.

## Threat Flags

None — no new network endpoint, auth path or schema change.

## Verification

- `node --no-experimental-require-module -e "require('sanitize-html')"` exit 0.
- `node --test test/sanitize-html.test.js test/xss-sanitization.test.js test/xss-chain.test.js`: 46 / 46 pass.
- Full suite (`node --test`, worktree root, on commit `35c130d`): **tests 1489, pass 1489, fail 0, cancelled 0, skipped 0** (29.4 s, EXIT=0).
- `git status --porcelain data/ public/sent_emails/` empty at every commit.

## Self-Check: PASSED

- lib/htmlPolicy.js, lib/sanitizeHtml.js, test/sanitize-html.test.js, test/helpers/html-inert.js, test/fixtures/xss-corpus.json, test/fixtures/cms-golden.json present.
- Commits `523f883`, `d505637`, `35c130d` present on the worktree branch.
