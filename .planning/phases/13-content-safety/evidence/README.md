# Phase 13 evidence - report-only browser proof (plan 13-12)

Produced by `scripts/uat/phase13-xss.js` (real Chromium, isolated child servers, committed `data/*.db`
sha256-guarded before/after every run) with `--csp-mode report-only`. Every log ends `EXIT=<code>`; `0` = every check
PASS. No real names, addresses or secrets: accounts and deals are synthetic, generated passwords are redacted.

`report-only` = the strict policy (`script-src 'self' 'wasm-unsafe-eval'`) rides beside the legacy enforcing policy; a
clean run here is the measured precondition for flipping `CSP_MODE` to `enforce` (13-13). The same scenarios are re-run
under `--csp-mode enforce` by 13-13.

| File | Scenario x lanes | Acceptance item (PRD) |
| ---- | ---------------- | --------------------- |
| `tracer-stored-xss.log` | storedXss x dev (the tracer, plan Task 1) | 2 - stored payload inert, zero violations |
| `ro-stored-xss.log` | storedXss x real, dev, demo-open | 1/2 - R1-03 a-d + corpus sample stored by an author through the real routes, opened by a victim on every enumerated render path (page body, layout blocks, lesson body, i18n html value, banner, slide label, chatbot, inline-edit cancel round trip); `__xss` never set, no dialog, canary silent, violation list empty; pmo write 403 |
| `ro-client-corpus.log` | clientCorpus x dev | 1 - all 313 corpus vectors (+3 fold-in shapes) through `MASafeHtml.toFragment`: no handler, no non-allowlisted element/scheme; 100 demo `[data-i18n-html]` values keep their element/text structure |
| `ro-slide-sandbox.log` | slideSandbox x real, dev, dev-defaultdir | 3 - hostile slide probes fail framed AND top-level, exact `SLIDE_SANDBOX_CSP` + nosniff, `.svg` / `.exe` / over-quota / over-10 MB refused with the fixed bodies and no file; B-1 default-directory variant (`MA_SLIDES_UPLOAD_DIR` unset) prints `slideSandbox default-dir PASS` |
| `ro-egress.log` | egress x real, dev, demo-open | 4 - real defaults: every request same-origin, CSP names no third party; panel toggle changes the next response's CSP and the video / model-dialog behaviour; showcase unchanged |
| `ro-transformers-import.log` | transformersImport x demo-open | 4 / W-1 - vendored bundle imports, `WebAssembly.compile(ort-wasm-simd.wasm)` clean (`transformersImport wasm-compile PASS`); eval-class reports from the bundle are RECORDED (PD-44) |
| `ro-caching.log` | caching x real, dev | 5 - `no-store` at 200/401/403/404/409 in the browser's view, model cache survives ten loads, UI logout clears Cache Storage / sessionStorage / non-language localStorage, session revoked |
| `ro-walk-dev.log` | demoWalk x dev | 2 / D-13-03 - demo walk under the strict policy: zero violations (in-page + endpoint) |
| `ro-walk-demo-open.log` | demoWalk x demo-open | 2 / D-13-03 - same walk as the anonymous showcase visitor |
| `ro-walk-real.log` | ilWalk x real | 2 / D-13-03 - Integration Lead walk (smoke IL pages at 1440 and 390, dashboard tabs, execution tabs incl. RAID and Reports, DD, org) + admin console tabs, zero violations |
| `p13-stored-<lane>-*.jpg` | storedXss screenshots | rendered page body / banner + chatbot / lesson modal per lane |
| `p13-walk-<lane>-*.jpg` | walk screenshots | demo pages, admin Settings with the External services panel, IL pages at 1440 and 390; `p13-walk-dev-deck-slide-1440.jpg` is the sandboxed Ask 1 deck slide (I-5 non-blank render - asserted in every lane, photographed once) |

Re-run (host-local tools, nothing installed into the repo):

```
PLAYWRIGHT_PATH=<playwright or playwright-core package dir> \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=<chromium binary, only if the package's revision is not cached> \
  node scripts/uat/phase13-xss.js --scenario <name> [--lane <lane>]... --csp-mode report-only|enforce --out <dir>
```

Scenarios: `storedXss`, `clientCorpus`, `slideSandbox`, `egress`, `caching`, `transformersImport`, `demoWalk`,
`ilWalk`. Lanes: `real`, `dev`, `demo-open`, `dev-defaultdir` (dev with `MA_SLIDES_UPLOAD_DIR` unset, B-1).

## Enforced run (plan 13-13) - `--csp-mode enforce`, the shipped default

The same scenarios re-run after the default flipped to the ENFORCING strict policy (`CSP_MODE` unset ->
`script-src 'self' 'wasm-unsafe-eval'` as `Content-Security-Policy`, no Report-Only header; the child servers are
started with `CSP_MODE=enforce` explicitly, which is the same policy). Every log ends `EXIT=0`; screenshots were
written to a scratch directory and are not committed (the `p13-*.jpg` set above is the visual record).

| File | Scenario x lanes | Result |
| ---- | ---------------- | ------ |
| `enf-stored-xss-dev.log` | storedXss x dev (the 13-13 tracer) | 81 PASS, violations=0 canaryHits=0 |
| `enf-stored-xss.log` | storedXss x real, demo-open | 159 PASS, violations=0 canaryHits=0 in both lanes |
| `enf-walk-dev.log` | demoWalk x dev | 57 PASS, `violations=0 endpoint=0 inpage=0` (48 checkpoints, 46 steps) |
| `enf-walk-demo-open.log` | demoWalk x demo-open | `violations=0 endpoint=0 inpage=0` (46 checkpoints, 45 steps) |
| `enf-walk-real.log` | ilWalk x real | `violations=0 endpoint=0 inpage=0` (51 checkpoints, 32 steps) |
| `enf-transformers-import.log` | transformersImport x demo-open | `transformersImport wasm-compile PASS`: bundle import resolves (501 exports), `WebAssembly.compile(ort-wasm-simd.wasm)` clean, 2 eval-class `script-src` reports from the bundle RECORDED (PD-44), no other violation |
| `enf-client-corpus.log` | clientCorpus x dev | 16 checks PASS |
| `enf-egress.log` | egress x real, dev, demo-open | 81 PASS; real: 278 requests, thirdPartyAttempts=0, violations=0; dev / demo-open: the showcase's one YouTube thumbnail attempt, violations=0 |
| `enf-caching.log` | caching x real, dev | 43 PASS, violations=0 |
| `enf-slide-sandbox.log` | slideSandbox x real, dev, dev-defaultdir | 107 PASS; dev-defaultdir prints `slideSandbox default-dir PASS` (slide in `data/slides`, nothing under `public/uploads/slides`) |

Measured, not asserted away: the only enforced-run report in any log is the vendored Transformers.js bundle's guarded
`new Function("return this")` probe (blocked once, no effect).
