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
