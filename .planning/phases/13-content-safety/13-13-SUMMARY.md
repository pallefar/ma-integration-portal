---
phase: 13-content-safety
plan: 13
subsystem: security / CSP enforcement
tags: [csp, enforce, report-only-rollback, inline-code-gate, playwright, deployment-docs, SAFE-02, SAFE-01, SAFE-03, SAFE-06, SAFE-07]
requires: ["13-12"]
provides:
  - "lib/csp.js: CSP_MODE unset/empty = ENFORCE (strict script-src 'self' 'wasm-unsafe-eval' as the only header); CSP_MODE=report-only is the documented rollback pair"
  - "test/csp-strict-gate.test.js: whole-tree inline-code gate with the hardened shapes and negative controls"
  - "evidence/enf-*.log: every Phase 13 browser scenario re-run under --csp-mode enforce, all EXIT=0, violations=0"
  - "DEPLOYMENT.md: Content safety section (+ updated Known limitations)"
affects: [13-14]
key-files:
  created:
    - test/csp-strict-gate.test.js
    - .planning/phases/13-content-safety/evidence/enf-*.log (10 logs)
  modified:
    - lib/csp.js
    - test/csp-policy.test.js
    - test/csp-report.test.js
    - test/egress-settings.test.js
    - scripts/uat/phase13-scenarios/slide-sandbox.js
    - DEPLOYMENT.md
    - .planning/phases/13-content-safety/evidence/README.md
decisions:
  - "PD-45 held: the flip is a default change only; no code path removed; rollback = CSP_MODE=report-only + restart"
  - "PD-46 held: sent_emails/ previews are scanned by the whole-tree gate"
  - "Gate scope: markup = *.html|htm|xhtml|svg under public/ minus top-level vendor/ and uploads/; client JS = public/js/**/*.js + public/sw.js. public/doom/*.js (saved HTML 404 pages, IN-B04) stay out of scope"
status: complete
actuals:
  tokens: 13000   # chars/4 over the changed/new files (gate 27.6k chars, DEPLOYMENT.md additions ~16k, test + scenario edits ~8k)
  tasks: 3
  commits: 6
---

# Phase 13 Plan 13: Enforce the strict CSP by default, whole-tree gate, enforced walks, Content safety docs Summary

The strict `script-src 'self' 'wasm-unsafe-eval'` policy now ENFORCES by default in both modes, `CSP_MODE=report-only` is
the one-variable rollback, a whole-tree static gate (with the review's hardened shapes and per-shape negative controls)
keeps inline code out of `public/`, every browser scenario passes under enforce with zero violations, and
DEPLOYMENT.md documents each Phase 13 control.

## Commits

| Task | Commit | Content |
| ---- | ------ | ------- |
| 1 (tracer) | `ef22586` | `lib/csp.js` default -> enforce; `csp-policy` default case flipped + rollback case; `csp-report` / `egress-settings` follow; `enf-stored-xss-dev.log`, `enf-walk-dev.log` |
| 2 | `97b6ea2` | `test/csp-strict-gate.test.js`; `enf-walk-demo-open.log`, `enf-walk-real.log`, `enf-transformers-import.log` |
| 2 (cont.) | `1725856` | `slide-sandbox.js` default-directory variant follows the new location; remaining enforced logs (storedXss real+demo-open, clientCorpus, egress, caching, slideSandbox) |
| 2 (docs) | `(README)` | evidence README: enforced-run table |
| 3 | `382c260` | DEPLOYMENT.md Content safety section + Known limitations |

Tracer gate (autonomous policy): re-ran the tracer `<verify>` (csp-policy green, both enforced logs `EXIT=0`,
`violations=0`) and continued.

## Enforced walks, scenario x lane (all `--csp-mode enforce`; checks in the logs)

| Scenario | Lane | Result | Log |
| -------- | ---- | ------ | --- |
| storedXss | dev | 81 PASS, violations=0, canaryHits=0 | `enf-stored-xss-dev.log` |
| storedXss | real | PASS, violations=0, canaryHits=0 | `enf-stored-xss.log` |
| storedXss | demo-open | PASS, violations=0, canaryHits=0 (159 PASS across both lanes) | `enf-stored-xss.log` |
| demoWalk | dev | 57 PASS, `violations=0 endpoint=0 inpage=0` (48 checkpoints, 46 steps) | `enf-walk-dev.log` |
| demoWalk | demo-open | 56 PASS, `violations=0 endpoint=0 inpage=0` (46 checkpoints, 45 steps) | `enf-walk-demo-open.log` |
| ilWalk | real | 44 PASS, `violations=0 endpoint=0 inpage=0` (51 checkpoints, 32 steps) | `enf-walk-real.log` |
| transformersImport | demo-open | 15 PASS, `transformersImport wasm-compile PASS`; import resolves (501 exports); `WebAssembly.compile(ort-wasm-simd.wasm)` clean (10,014,674 bytes, 90 imports); 2 eval-class `script-src` reports from `transformers.min.js:34` RECORDED (PD-44), no other violation; threaded `importScripts(blob:)` path UNVERIFIED by design | `enf-transformers-import.log` |
| clientCorpus | dev | 16 PASS (316 vectors + 100 i18n-html values) | `enf-client-corpus.log` |
| egress | real | PASS, 278 requests, thirdPartyAttempts=0, violations=0 | `enf-egress.log` |
| egress | dev | PASS, 289 requests, one intercepted `img.youtube.com` thumbnail attempt (showcase), violations=0 | `enf-egress.log` |
| egress | demo-open | PASS, 248 requests, same single showcase attempt, violations=0 (81 PASS across the three lanes) | `enf-egress.log` |
| caching | real, dev | 43 PASS, violations=0 | `enf-caching.log` |
| slideSandbox | real | 34 PASS | `enf-slide-sandbox.log` |
| slideSandbox | dev | 34 PASS | `enf-slide-sandbox.log` |
| slideSandbox | dev-defaultdir | 33 PASS, `slideSandbox default-dir PASS` (107 PASS across the three lanes) | `enf-slide-sandbox.log` |

Every log ends `EXIT=0`; every run's `[data-integrity]` checks (committed `data/demo.db` / `data/control.db` sha256 incl.
`-wal`, `git status --porcelain -- data public/sent_emails`) PASS. Evidence directory: `.planning/phases/13-content-safety/evidence/`.

## Whole-tree gate (`test/csp-strict-gate.test.js`, 9 tests)

Shipped tree: 0 findings over every `public/**/*.html|htm|xhtml|svg` (28+ pages/decks/slides + the `sent_emails/` preview;
`vendor/`, `uploads/` excluded) and every client script (`public/js/**`, `public/sw.js`). Rules (the Phase 13 client review's
WR-B06 demands): entity-decoded scheme test (`&#106;`, `&#x6A;`, zero-padded and semicolon-less numerics, `&Tab;`,
`&NewLine;`, `&colon;`, double encoding, raw tab/newline inside the scheme); handler attributes parsed from the tag
(slash separator, directly after a closing quote, any case) with a raw `[\s/"']on*=` backstop; no quote requirement for
handlers inside JS strings (also across template-literal newlines, and attribute fragments built apart from the tag);
`.setAttribute('on…'`; `srcdoc` (markup and JS); `<script src>` outside `/js/` and `/vendor/` (third party, protocol-relative,
`data:`, `blob:`, `/uploads/`, `..` traversal); comment ends `--!>`, `<!-->`, `<!--->` handled. 60 inline negative-control
fixtures (39 markup + 21 client JS, one per shape), 24 must-pass fixtures, a synthetic-tree walker control (exclusions, sent_emails/ inclusion,
nested vendor/ stays scanned) and a directory cross-check that no HTML file can be added ungated.

## Deviations from Plan

**1. [Authorized exception] `scripts/uat/phase13-scenarios/slide-sandbox.js` updated** (orchestrator-authorized outside
`files_modified`). The `dev-defaultdir` variant now resolves the default slide directory as `<repo>/data/slides` (outside
`public/`, CR-A01), asserts nothing is ever written under `public/uploads/slides` and that its listing is unchanged,
and cleans up/compares the new location (removing `data/slides` when the run created it). URLs, headers and
the probe/limit checks are unchanged. `_shared.js` needed no change.
**2. [Rule 3 - consequence of the planned flip] two more existing tests follow the default:**
`test/csp-report.test.js` (the violations endpoint reports `mode: 'enforce'`, was `'report-only'`; `CSP_MODE` is unset
in that suite) and `test/egress-settings.test.js` (the builder's default `script-src` is the strict list). Neither
assertion was weakened: each now pins the new default. Not in `files_modified`.
**3. [Evidence] screenshots not committed for the enforced run.** The directory was already at the 13-12 cap (1152 KB);
the ten enforced logs add ~80 KB (1252 KB total), JPEGs went to a scratch directory. The first line of each log
(`evidence dir …`) was rewritten to a placeholder before commit so no OS-user path is committed.
**4. [csp-policy.test.js] the "default mode" test was split, not weakened:** the legacy-enforced + strict-Report-Only pair
assertions moved to an explicit `CSP_MODE=report-only` rollback case; the default case asserts a single enforcing strict
header; child-server cases prove default, rollback and real+enforce over real HTTP.
**5. [Tool use] runs used the host-local Playwright** (`playwright-core@1.58.1` + chromium headless shell 1234 via
`PLAYWRIGHT_PATH` / `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, axe-core from `AXE_CORE_PATH`); nothing was installed.

## Gaps / findings for the orchestrator (measurements; no product file was edited to make a check pass)

1. **Stale runner header comments and lane value.** `scripts/uat/phase13-xss.js` (outside the authorized exception) still
   describes the `dev-defaultdir` lane as "the worktree's real `public/uploads/slides`" (header, lines ~24-28, and
   `prepareLane()` sets `slidesDir` to that path). The scenario no longer reads `ctx.slidesDir` for that lane, so the runs
   are correct; the comment/value should be corrected at merge. The runner's own `--csp-mode` default is still
   `report-only` (every child gets `CSP_MODE` set explicitly, so results are unaffected).
2. **`POST /api/media` (REVIEW-FIX-S open item 1) is not documented here.** A sibling quick fix owns it; DEPLOYMENT.md has
   no media-library paragraph. Add one (extension/magic allowlist, storage location) after that fix merges.
3. **"Client-side notes" sub-heading is intentionally empty** (last subsection of the Content safety section, with an
   HTML comment) for Fixer C's docs-owed text.
4. **13-12 finding 3 not documented:** parsing a pasted `<base href>` through `MASafeHtml` emits one `base-uri` report per
   policy although nothing applies; only reachable via an i18n dictionary value. Mention it in the client notes if wanted.
5. **Older gates untouched.** `csp-inline-free-pages` / `csp-inline-free-decks` keep their pre-hardening regexes (Fixer C's
   change); the new gate is strictly stronger and covers their trees.
6. **Windows live test still skipped.** `slide-upload-safety (k)` is the single skip in the suite (win32-only); it needs a
   `windows-latest` run before release, together with a smoke row asserting `sandbox` in the slide CSP.
7. **PD-8 still needs user confirmation at phase close:** `frame-ancestors 'self'` (PRD text says `'none'`).
8. **Eval entry in the violations list.** Under enforce the vendored Transformers bundle's guarded
   `new Function("return this")` is blocked once and listed; documented as expected/harmless in DEPLOYMENT.md.

## Known Stubs

None. No stubs, skipped tests or unrun verifies introduced; no `.planning/WINDOWS.md` entries.

## Threat Flags

None. No new endpoint, auth path, file access or schema change: one default value, one static test, a scenario file and
documentation.

## Threat model status

| ID | Status | Evidence |
| -- | ------ | -------- |
| T-13-120 | mitigated | default header is the strict enforcing policy (`csp-policy` default subtests incl. child server); enforced walks and storedXss zero violations |
| T-13-121 | mitigated | zero-violation report-only walks preceded the flip (13-12 precondition re-checked), enforced walks green in all lanes, rollback documented and tested over HTTP |
| T-13-122 | mitigated | `test/csp-strict-gate.test.js` with per-shape negative controls over the whole tree |
| T-13-123 | mitigated | DEPLOYMENT.md "Caching and sign-out": `Clear-Site-Data` honoured only on https/localhost, run behind TLS |

## Verification

- Final full suite (`node --test`, worktree root, after all code/test/scenario commits; DEPLOYMENT.md was edited once more
  afterwards, then `launcher-mode`, `deployment-role-matrix`, `denial-audit`, `csp-strict-gate`, `csp-policy` re-run: 60/60):
  `# tests 1670  # pass 1669  # fail 0  # cancelled 0  # skipped 1  # todo 0` (EXIT=0, 35 s). The one skip is the
  win32-only `slide-upload-safety (k)`. Base was 1659 tests (1658 pass, 1 skip).
- `git status --porcelain data public/sent_emails public/uploads` empty after every run and after the suite;
  `data/slides` and `public/uploads/slides` absent.
- Plan `<verify>` conditions: `node --test test/csp-policy.test.js test/csp-strict-gate.test.js` green; every enforced log
  ends `EXIT=0`; the three walk logs contain `violations=0`; `enf-transformers-import.log` contains
  `transformersImport wasm-compile PASS`; DEPLOYMENT.md contains `CSP_MODE`, `MA_SLIDE_QUOTA_MB`, `csp-violations`,
  `Clear-Site-Data`, `importScripts`.

## Self-Check: PASSED

- Files exist: `lib/csp.js`, `test/csp-strict-gate.test.js`, `scripts/uat/phase13-scenarios/slide-sandbox.js`, `DEPLOYMENT.md`
  (Content safety section), ten `evidence/enf-*.log`.
- Commits `ef22586`, `97b6ea2`, `1725856`, `382c260` and the README docs commit exist on the worktree branch.
