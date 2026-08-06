# History, Committed Data & Supply-Chain Security Review

**Scope:** git history, committed data artifacts, dependency supply chain, repo hygiene.
**Out of scope (covered by a separate reviewer):** runtime application vulnerabilities — auth, XSS, injection, upload handling.

| | |
|---|---|
| Repo | `pallefar/ma-integration-portal` — **PUBLIC** |
| Reviewed at | `44bdd53` (HEAD, `main`) |
| Commits in history | 270 |
| Public tags | 11 (`v1.0.0` 2026-07-13 → `v2.0.1` 2026-07-19) |
| Unreleased / local-only commits | **235** (everything after `5c45f3f` = `v2.0.1`) |
| Review date | 2026-08-06 |
| `.git` size | 134 MB |

---

## 1. Executive summary

The single most important question — *is real MNPI or real credential material sitting in this repo* — answers **no**: `data/deals/` is empty, `control.db.deals` has 0 rows, every `geminiApiKey` value across all 19 revisions of `db.json` in **every** commit (not just the 11 tags) is the empty string, and all four committed account records hash to the password the project already publishes on its own login page, so the committed hashes disclose nothing that `public/login.html` does not. The dependency supply chain came back genuinely clean under adversarial testing: a fresh `npm ci` from the committed lockfile reproduces the committed `node_modules` with **zero content mismatches**, all five hand-committed cross-platform native binaries SHA-256-match their published registry packages, no package in the tree carries an `install`/`preinstall`/`postinstall` script, and the only known CVE at any tag or at HEAD is one low-severity `body-parser` DoS. The real exposure is not secrets — it is **judgment about what becomes public**: a TE-Connectivity-branded, unlicensed public repo carrying the TE logo, a released page naming six real listed companies as acquisition targets with fit scores and antitrust notes, and 148 `.planning/` files that publish this project's own threat model, accepted risks and explicitly-deferred hardening. Two hygiene gaps will bite later rather than now: committing live `.db` files is an established habit (`data/demo.db` has been re-committed in 5 separate commits), so the day the admin password is rotated for real that hash gets published by the same reflex, and `public/sent_emails/` is a runtime-written directory that `download-zip` treats as sensitive but `.gitignore` does not. **Nothing here is a stop-the-line emergency, but 6 items should be resolved before the 235 commits are pushed, and 2 already-public items need a decision that a push will not fix.**

---

## 2. Findings table

Severity reflects impact in this repo's specific context (public repo, TE branding, MNPI-bound roadmap), not raw CVSS.

| ID | Severity | Title | Where | Public already? |
|----|----------|-------|-------|-----------------|
| **H-01** | **Medium** | Live SQLite DBs with account credential material are committed | `data/control.db`, `data/ma-portal.db` (`9a6fb8d`, `9ff8e8f`) | **Not yet — unreleased** |
| **H-02** | **Medium** | Dead legacy DB still committed, still carrying credential records | `data/ma-portal.db` (1.2 MB, `9ff8e8f`) | **Not yet — unreleased** |
| **H-03** | **Medium** | Public "Acquisition Radar" names 6 real listed companies as TE targets | `public/insights.html` (tags `v1.4.0`→`v2.0.1`) | **Yes** |
| **H-04** | **Medium** | Unlicensed public repo uses TE Connectivity name + logo, no affiliation disclaimer | `README.md`, `public/te-logo.png` | **Yes** |
| **H-05** | **Medium** | `.planning/` publishes the project's own threat model, accepted risks and deferred hardening | 148 files under `.planning/` | **Not yet — unreleased** |
| **H-06** | **Medium** | `public/sent_emails/` is runtime-written, NOT gitignored, and already has a committed file | `.gitignore`; `server.js:1456,4976` | Partially (1 benign file, `94eb08b`) |
| **H-07** | **Low** | Local build artifacts leak developer home dir + toolchain fingerprint | `node_modules/better-sqlite3/build/` (`config.gypi`, `Makefile`) | **Not yet — unreleased** |
| **H-08** | **Low** | Developer absolute path baked into shipped source and seed data | `aiService.js:300-302`, `db.json:143,166` | **Yes** (since `v1.0.0`) |
| **H-09** | **Low** | Internal TE email aliases / distribution-list naming hardcoded | `public/dashboard.html:699-717`, `public/js/admin.js:1671-1676`, `db.json` | **Yes** |
| **H-10** | **Low** | Admin `download-zip` export does not exclude `.planning/` | `server.js:1113` | **Yes** (code), N/A (data) |
| **H-11** | **Low** | `body-parser` <1.20.6 DoS (GHSA-v422-hmwv-36x6, CVSS 3.7) | every tag + HEAD lockfile | **Yes** |
| **H-12** | **Info** | 6 of 10 optional `@napi-rs/canvas` platform binaries absent — zero-install breaks on ARM Linux / musl | `package-lock.json` vs committed tree | **Yes** |

**Counts:** 0 critical · 0 high · **6 medium** · 5 low · 1 info.

---

## 3. Per-finding detail

### H-01 — Medium — Live SQLite databases with account credential material are committed

**What.** Three SQLite files are tracked: `data/control.db` (36 KB), `data/demo.db` (1.2 MB), `data/ma-portal.db` (1.2 MB). Two of them carry a populated `users` table.

**Evidence.**

| File | `users` rows | Fields per record | First committed |
|---|---|---|---|
| `data/control.db` | 4 | `username`, `name`, `role`, `salt` (16 bytes hex), `hash` (32 bytes hex) | `9a6fb8d` |
| `data/ma-portal.db` | 4 | identical set | `9ff8e8f` |
| `data/demo.db` | 0 | — | `9a6fb8d` |

Accounts: `admin` (role `admin`), `karen` (`hrbp`), `pmo` (`pmo`), `employee-demo` (`employee`).

I recomputed `scryptSync(password, salt, 32)` — the exact primitive at `server.js:216` and `scripts/set-admin-password.js:44` — for all four records in both files using the password the project publishes itself:

```
data/control.db     admin/karen/pmo/employee-demo → matches published demo pw: true (4/4)
data/ma-portal.db   admin/karen/pmo/employee-demo → matches published demo pw: true (4/4)
```

That password is published by the application in two places already public since `v2.0.0`:
- `public/login.html:46` — *"Password for all: `TEdemo!2026` — click an account to fill the form."*
- `DEMO-RUNBOOK.md:54`

Also verified: `sessions` tables are empty (0 rows) in every committed DB, no `secretSettings` key exists in any committed `app_state`, and `SECRET_SETTINGS_FIELDS` (`db/collections.js:119` — `geminiApiKey`, `databaseConfig.connectionDetails`) routes secrets to `runtime.db`, which is correctly gitignored and has never been committed.

**Impact.** Cryptographically, **the committed hashes disclose nothing new** — the plaintext is already on the login page, so an attacker gains zero by cracking them. Three real risks remain:

1. **Shipped default admin account.** Every zero-install bundle boots with a working `admin` account on a publicly-documented password. There is a first-run rotation tool (`scripts/set-admin-password.js`) and it warns when the admin is still on the demo password (`set-admin-password.js:88-97`), but nothing *forces* it — `server.js` warns at startup about `ADMIN_TOKEN` (`:181`) and `DEMO_OPEN` (`:190`) but has **no equivalent startup guard for "admin is still on the known demo password"**. On the shared internal host this milestone is heading toward, a missed manual step is full admin takeover.
2. **The habit is the hazard, not today's content.** `data/demo.db` has been re-committed in five separate commits (`0a88dc9`, `5f790de`, `d31c9c1`, `14e1672`, `9a6fb8d`). Committing a live database is normal practice in this repo. The moment `set-admin-password.js` is run for real and `control.db` is committed by the same reflex, a **real** salt + scrypt hash becomes public and permanent.
3. **Salts are pre-published.** Committed salts remove any per-deployment salt uniqueness for anyone who deploys the bundle without rotating.

**Fix.**
- **Before push:** stop tracking `control.db`. `git rm --cached data/control.db`, add `data/control.db` to `.gitignore`, and seed the four demo accounts at first boot from code instead (the seed logic already exists in `db/dealSeed.js`-adjacent paths). This preserves zero-install while making it structurally impossible to ever publish a real hash.
- If you keep it committed (defensible for zero-install), then add a **hard startup refusal**: if the resolved DB is not demo mode and any account still hashes to `TEdemo!2026`, refuse to boot. That converts finding 1 from "documented manual step" to "enforced".
- `data/demo.db` may stay — 0 users, fixture content only.

---

### H-02 — Medium — Dead legacy database still committed, still carrying credential records

**What.** `data/ma-portal.db` is the Phase-1 pre-split database. It was superseded by the `control.db`/`demo.db`/`runtime.db` split in `9a6fb8d`, but was never removed.

**Evidence.** `db/dbFiles.js:36-40` resolves only `control.db`, `runtime.db`, `audit.db`, `demo.db` and `data/deals/`. No runtime code path opens `ma-portal.db`; every remaining reference is a script default, a comment, or a test fixture name:

```
scripts/migrate-db-json-to-sqlite.js:31   default --out target
scripts/split-db-into-control-demo-deals.js:47  DEFAULT_SOURCE
db/sessions.js:17                          stale comment
test/db-artifact-exclusion.test.js:7       comment
```

It is 1.2 MB, mode `444`, last content-modified `0a88dc9`, and still contains all 4 `users` records with `salt`/`hash` (verified above) plus `settings.geminiApiKey: ""`.

**Impact.** A second, forgotten copy of the credential material with no owner and no reason to exist. Dead committed data is the class of artifact that gets missed in exactly this kind of review.

**Fix.** `git rm data/ma-portal.db` before the push. Update the two script defaults so nothing regenerates it at that path.

---

### H-03 — Medium — Public "Acquisition Radar" names six real listed companies as TE acquisition targets

**What.** `public/insights.html`, released publicly at tags `v1.4.0`, `v1.5.0`, `v1.5.1`, `v2.0.0`, `v2.0.1`, is titled `TE Connectivity - M&A Insights` and renders an "Acquisition Radar" of six **real, publicly traded** companies presented as acquisition candidates:

> Sensata Technologies · Methode Electronics · Bel Fuse Inc. · Novanta Inc. · TT Electronics plc · ChargePoint Holdings

Each entry carries a **"Fit score"**, revenue/valuation figures (`$3.9B`, `$1.1B`, `$949M`, `$660M`, `$535M`, `$417M`, `$180M`), an explicit deal rationale, and — most notably — **antitrust risk assessments**:

```
"Automotive-sensing antitrust scrutiny"
"Interconnect antitrust review"
"Heavy product overlap with TE connectors"
"Own the EV story from vehicle to charger"
"Premium high-multiple med-tech valuation"
```

**Mitigating fact, stated plainly:** the page *does* carry a disclaimer — `Illustrative strategic analysis for demonstration purposes, compiled from public information. Figures marked "est." are approximate. Not investment advice.` And `.planning/PROJECT.md:77` confirms internal intent: *"the Acquisition Radar in `insights.html` stays a static showcase piece"*.

**Impact.** The disclaimer materially reduces this, and I am not asserting any securities violation — I am not qualified to and the content appears to be public-source research. What remains is a **framing** problem: a repository branded "TE Connectivity — M&A Integration Portal", carrying the real TE logo, on a public personal GitHub, hosting a page that reads as a per-target acquisition thesis with antitrust analysis for six named listed companies. A journalist, a competitor, or one of those six companies' IR teams finding this does not read the footnote first. Combined with H-04 (no affiliation disclaimer anywhere at repo level), the appearance risk is real even though the substance is benign.

**This is already public and a push will not change it** — it needs a decision, not a fix.

**Fix (choose one).**
- Lowest effort: replace the six real names with fictional ones, matching how the rest of the demo already works (`NextGen Sensors Ltd.` is the fictional target used everywhere else). This costs nothing and removes the issue entirely.
- Or: keep them, but promote the disclaimer from a `.72rem` italic footer to a prominent banner, and add the repo-level disclaimer from H-04.
- Either way, confirm with TE that a TE-branded public artifact naming acquisition targets is sanctioned. That is a call for TE legal/comms, not for this review.

---

### H-04 — Medium — Unlicensed public repo uses TE Connectivity name and logo with no affiliation disclaimer

**What.** `README.md` line 1 reads `# TE Connectivity — M&A Integration Portal`. The real TE logo is committed at `public/te-logo.png` and `public/overview-deck/te-logo.png` and is used as the live app header logo. There is **no `LICENSE` file**, no `NOTICE`, and no disclaimer of affiliation anywhere in `README.md` or `DEMO-RUNBOOK.md` (grepped for `disclaim|not affiliated|unofficial|trademark|internal use` — zero hits).

**Impact.** Trademark use without notice on a public personal repo. Absent a license, the code is also "all rights reserved" by default, which is probably not the intent for something distributed as public release zips. Compounds H-03: the TE branding is what makes the Acquisition Radar read as official.

**Fix.** Add a `LICENSE` and a short `README` disclaimer — *"Personal/unofficial project. Not affiliated with, endorsed by, or an official product of TE Connectivity. All trademarks are the property of their respective owners."* If TE ownership *is* the intent, the repo belongs in a TE-controlled org, not a personal one. Already public — resolve regardless of push timing.

---

### H-05 — Medium — `.planning/` publishes the project's own threat model, accepted risks and deferred hardening

**What.** 148 tracked files under `.planning/`, all inside the unreleased 235 commits:

```
112  .planning/phases/     (incl. 02/03/04/05-SECURITY.md)
 14  .planning/research/
  7  .planning/codebase/
  5  .planning/quick/
  4  .planning/graphs/
     + STATE.md, ROADMAP.md, REQUIREMENTS.md, PROJECT.md, config.json
```

`.planning/phases/05-synergy-value-capture/05-SECURITY.md` alone contains an `## Accepted Risks` table (5 entries), a `## Deferred Hardening` section, and this line:

> **`/api/raid` outbound clearance filtering** — pre-existing deferred debt. **Phase 5 does not …**

plus the `T-05-47` residual (`grossRealizedM 0.9 → 10.8 from an unphased free-typed create`).

**Impact.** This is a precise, current, authored-by-the-defender map of which controls are *known to be absent* in a deployed instance — including a named unfiltered endpoint (`/api/raid`) and the exact shape of a value-inflation path. For a normal open-source project this is healthy transparency. For an app whose stated purpose is holding MNPI on a shared internal host, publishing the list of your own unclosed gaps alongside the code is a meaningful accelerant for anyone attacking a real deployment.

Note the tension honestly: this documentation is genuinely valuable and its rigor is why several real bugs were caught. The recommendation is about *audience*, not about writing less.

**Fix.** Decide deliberately before the push. Options, in order of preference:
1. Keep `.planning/` local-only — add to `.gitignore`, `git rm -r --cached .planning`. History rewrite is only needed if you object to it being in the pushed history at all (see §4).
2. Keep it public but move the four `*-SECURITY.md` files (and any "deferred/accepted risk" content) into a separate private repo.
3. Accept it — but only as an explicit decision, having read the `/api/raid` line above.

---

### H-06 — Medium — `public/sent_emails/` is runtime-written, not gitignored, and already has a committed file

**What.** The server writes generated communication HTML into `public/sent_emails/` at runtime:

```
server.js:1456   const emailDir = path.join(__dirname, 'public', 'sent_emails');
server.js:4976   const emailDir = path.join(__dirname, 'public', 'sent_emails');
server.js:5008   htmlEmailPath: `/sent_emails/${htmlFileName}`
```

`server.js:1106` explicitly classifies this directory as sensitive — the admin export excludes it alongside `.env` and the databases:

> `// Exclude everything holding data or secrets (db.json = API key + all records; .env; sent_emails).`

But `.gitignore` has **no `sent_emails` entry** (confirmed: `git check-ignore public/sent_emails/test.html` → exit 1, not ignored), and one file is already tracked: `public/sent_emails/comm_1783454326531.html`, committed in the initial commit `94eb08b`. I read it — it is a benign "System Verification Test" template with no recipient PII.

**Impact.** The asymmetry is the finding: `download-zip` treats this directory as secret-bearing, git does not. Every other runtime-artifact family in this repo got a pre-emptive `.gitignore` guard *before* it could leak — `data/runtime.db*`, `data/audit.db*`, `data/deals/` in `9fda4b5`, and `data/*.db-wal`/`-shm` in `d790de5`. This one was missed. In real-deal mode, generated employee/workstream communications land here and become commit-eligible; per `PROJECT.md:106` that content class is MNPI. Given the WAL-sidecar near-misses already recorded in this project's own notes, an accidental `git add .` here is a plausible failure mode.

**Fix.** Add to `.gitignore` before the push:
```
public/sent_emails/
!public/sent_emails/.gitkeep
```
and `git rm --cached public/sent_emails/comm_1783454326531.html` (or keep it deliberately as a fixture — it is harmless; the directory guard is the point).

---

### H-07 — Low — Local build artifacts leak developer home directory and toolchain fingerprint

**What.** `node_modules/better-sqlite3/build/` is committed (13 files incl. `config.gypi`, `Makefile`, `gyp-mac-tool`). These are node-gyp outputs from the developer's machine and are **not** produced by `npm ci` — confirmed by the tree diff in §"Supply chain" below (`Only in .../node_modules/better-sqlite3: build`).

**Evidence.** Absolute paths extracted from the committed artifacts:
```
/Users/karstenhaldan/.npm
/Users/karstenhaldan/.npm-global
/Users/karstenhaldan/.npm-global/etc/npmrc
/Users/karstenhaldan/.npm-init.js
/Users/karstenhaldan/.npmrc
/Users/karstenhaldan/Library/Caches/node-gyp/22.18.0
```

**Impact.** Discloses OS username, macOS, exact Node version (22.18.0), and npm config file locations. Low on its own; useful for targeting when combined with H-09 (TE email conventions). No credential content — `.npmrc` itself was never committed (verified: no `.npmrc` in history).

**Fix.** `git rm -r --cached node_modules/better-sqlite3/build` and add `node_modules/better-sqlite3/build/` to `.gitignore`. The committed `prebuilds/*.node` (8 platforms) are what zero-install actually needs; `build/` is redundant.

---

### H-08 — Low — Developer absolute path baked into shipped source and seed data

**What.** `file:///Users/karstenhaldan/M&A/public/playbook.html#...` appears in generated content.

**Evidence.** `aiService.js:300-302` (three occurrences, in the fallback plan template) and `db.json:143` + `db.json:166` (baked into two stored `aiPlan` blobs). Present since `v1.0.0` — verified at `v1.0.0`, `v2.0.1` and HEAD.

**Impact.** Same username disclosure as H-07, but **already public and unfixable retroactively**. Also a functional bug: these links are dead for every user who is not the author.

**Fix.** Replace with relative `/playbook.html#...` in `aiService.js:300-302` and re-generate the two `db.json` blobs. Fixes the broken links; the historical disclosure cannot be recalled.

---

### H-09 — Low — Internal TE email aliases and distribution-list naming hardcoded

**What.** Real-looking TE internal aliases appear in released, public files.

**Evidence.**
```
public/dashboard.html:699   imo.desk@te.com
public/dashboard.html:705   rewards.integration@te.com
public/dashboard.html:711   corp.comms@te.com
public/dashboard.html:717   security.onboarding@te.com
public/js/admin.js:1671     all@te.com
public/js/admin.js:1676     integration-leaders@te.com
public/js/employee.js:1936  integration-leaders@te.com
db.json:334,347             karen.peterson@te.com, david.miller@te.com
```
The person-shaped ones (`sconnor@`, `mvance@`, `karen.peterson@`, `david.miller@`) are demo fixtures matching the fictional demo cast. The **functional aliases** (`imo.desk@`, `rewards.integration@`, `corp.comms@`, `security.onboarding@`, `integration-leaders@`, `all@`) are the concern — they are presented in a contact table as real routing addresses.

**Impact.** Discloses TE internal distribution-list naming conventions. `security.onboarding@te.com` and `all@te.com` are directly useful for a phishing or social-engineering pretext against TE staff. Low severity — such aliases are semi-guessable — but this is confirmation, and confirmation is what a pretext needs. **Already public.**

**Fix.** Confirm whether these are real TE aliases. If yes, replace with `example.com` or clearly fictional equivalents going forward. Cannot be recalled from released tags.

---

### H-10 — Low — Admin `download-zip` export does not exclude `.planning/`

**What.** `server.js:1113` builds the admin export with an explicit exclusion list:

```
-x "node_modules/*" ".git/*" ".gemini/*" "public/ma-app.zip" "ma-portal.zip" "looxmaxing/*"
   ".playwright-mcp/*" ".DS_Store" "*/.DS_Store" "db.json" "db.json.tmp" "db.json.bak"
   "data/*.db" "data/*.db-wal" "data/*.db-shm" "data/*.db.bak" "data/runtime.db*"
   "data/audit.db*" "data/deals/*" ".env" ".env.*" "public/sent_emails/*" "sent_emails/*"
```

**Assessment — the data exclusions are correct and complete.** `.git/`, all databases, WAL/SHM sidecars, per-deal DBs, the audit trail, the session store, `.env`, and `sent_emails` are all excluded. The inline `[security]` comment at `server.js:1109` correctly notes that flat `data/*.db` does not recurse and that `data/deals/*` needs its own entry — that reasoning is sound and the entry is present.

**The gap:** `.planning/` is not excluded. Anyone who can reach `GET /api/admin/download-zip` (admin role, gated at `server.js:279` + `:451`) receives all 148 planning files including the four `*-SECURITY.md` threat models — the H-05 content, handed out through a product feature.

**Fix.** Add `".planning/*"` to the exclusion list. One-token change.

---

### H-11 — Low — `body-parser` <1.20.6 denial of service

**What.** `npm audit` against the lockfiles at `v1.0.0`, `v2.0.1` and HEAD returns exactly one advisory, identically at all three:

```
body-parser [low] <1.20.6
GHSA-v422-hmwv-36x6 — DoS when invalid limit value silently disables size enforcement
CVSS 3.1: 3.7 (AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:L)  CWE-770
totals at every point checked: {critical:0, high:0, moderate:0, low:1}
```

Reached transitively via `express@4.22.2 → body-parser@1.20.5`. `fixAvailable: true`.

**Impact.** Low, and only exploitable if a `limit` value is misconfigured. Note the app sets a 50 MB PDF parse limit, so review that call site when patching.

**Fix.** `npm update body-parser` to ≥1.20.6 and re-commit `node_modules` before the push. Old tags stay pinned at the vulnerable version permanently — unavoidable and acceptable at this severity.

---

### H-12 — Info — Incomplete cross-platform binary set

**What.** `package-lock.json` declares 10 optional `@napi-rs/canvas-*` platform packages; 4 are committed (`darwin-arm64`, `darwin-x64`, `linux-x64-gnu`, `win32-x64-msvc`). Absent: `android-arm64`, `linux-arm-gnueabihf`, `linux-arm64-gnu`, `linux-arm64-musl`, `linux-riscv64-gnu`, `linux-x64-musl`.

**Impact.** Not a security issue — a zero-install robustness gap. The bundle's PDF-export feature will fail on ARM64 Linux and on Alpine/musl. Relevant because the stated deployment path is "a shared internal host", which is plausibly ARM64 Linux.

**Fix.** Add `linux-arm64-gnu` and `linux-x64-musl` if the target host may be either.

---
## 3b. Supply chain — what was verified, and the result

`node_modules/` is committed, so old tags pin old versions permanently and a tampered dependency would ship silently and forever. I treated the committed tree as untrusted and tried to prove it had been modified. **It had not.**

**Test 1 — full tree reproduction.** Ran `npm ci --ignore-scripts` from the committed `package-lock.json` into a clean directory and recursively diffed against the committed `node_modules`:

```
Only in <repo>/node_modules: .DS_Store                        (untracked, never committed — verified)
Files .../node_modules/.package-lock.json ... differ           (npm bookkeeping — expected)
Only in <repo>/node_modules: @babel, @reduxjs, @types          (EMPTY dirs, 0 tracked files — not committed)
Only in <repo>/node_modules/@napi-rs: canvas-darwin-x64,
   canvas-linux-x64-gnu, canvas-win32-x64-msvc                 (cross-platform, see Test 2)
Only in <repo>/node_modules/better-sqlite3: build              (see H-07)
```

**Zero content mismatches** across the entire tree. Every package's on-disk `package.json` version matched the lockfile exactly (82 packages checked, 0 mismatches).

**Test 2 — hand-committed native binaries.** The three `@napi-rs` platform dirs above plus `darwin-arm64` are binaries `npm ci` never produces on this machine — they were added manually, so nothing would catch tampering. SHA-256 against the published registry tarballs:

```
MATCH   canvas-darwin-x64/skia.darwin-x64.node
MATCH   canvas-darwin-arm64/skia.darwin-arm64.node
MATCH   canvas-linux-x64-gnu/skia.linux-x64-gnu.node
MATCH   canvas-win32-x64-msvc/icudtl.dat
MATCH   canvas-win32-x64-msvc/skia.win32-x64-msvc.node
```
5/5 byte-identical to `@napi-rs/canvas-*@0.1.80` as published.

**Test 3 — undeclared packages.** 82 top-level packages committed, all 82 declared in `package-lock.json`. **No undeclared package.** `@napi-rs/canvas@0.1.80` is documented in `CLAUDE.md` as a "key dependency" but is absent from every `package.json` — this is **not** an undeclared package: it is a legitimate transitive dep (`pdf-parse@2.4.5 → @napi-rs/canvas@0.1.80`, and `pdfjs-dist@5.4.296 → @napi-rs/canvas@^0.1.80`). Only the `CLAUDE.md` description is imprecise.

**Test 4 — install scripts.** No package anywhere in the committed tree declares `preinstall`, `install`, or `postinstall`. Only two declare `prepare` (`mime@1.6.0`, `pdf-parse@2.4.5`), which npm does not run for installed dependencies. The lockfile flags `better-sqlite3@13.0.1` with `hasInstallScript: true`, so I pulled the published tarball and diffed its `package.json` against the committed one: **byte-identical**, and the published tarball genuinely contains no `install` script (it ships `prebuilds/**`). The lockfile flag is stale registry metadata, not evidence of modification.

**Test 5 — declared dependencies per era.** Identical across all 11 tags: `express ^4.19.2`, `compression ^1.8.1`, `pdf-parse ^2.4.5` (resolved `2.4.5`), `engines.node >=20`. HEAD adds `better-sqlite3 13.0.1` (pinned) and `zod 4.4.3` (pinned), and raises `engines.node` to `>=22`. Resolved versions are the same at every tag (`express@4.22.2`, `body-parser@1.20.5`, `cookie@0.7.2`, `path-to-regexp@0.1.13`, `qs@6.15.2`, `serve-static@1.16.3`, `send@0.19.2`) — the lockfile was generated late enough that the old tags are **not** carrying stale vulnerable transitive versions. That is a better outcome than the committed-`node_modules` model usually produces.

**Net:** the only dependency finding is H-11 (`body-parser`, low). Supply-chain integrity is verified clean at HEAD and at the sampled tags.

## 3c. Secrets in history — what was checked beyond the prior regex scan

The prior scan was pattern-based and covered the 11 tags. I widened it on both axes.

| Check | Method | Result |
|---|---|---|
| `geminiApiKey` across **all commits**, not just tags | Extracted the value from all 19 revisions of `db.json` reachable from `git rev-list --all` | **Empty string in all 19.** Confirms and extends the prior tag-only finding |
| `geminiApiKey` in any *other* file, ever | `git grep -l` across 300 revisions, excluding `node_modules` | No file other than `db.json` / `ma-portal.db` ever held the key; both empty |
| Secrets relocated to `runtime.db` | `SECRET_SETTINGS_FIELDS` = `['geminiApiKey','databaseConfig.connectionDetails']` (`db/collections.js:119`) | `runtime.db` correctly gitignored and **never committed**. No `secretSettings` key in any committed `app_state` |
| Non-standard-format secrets (entropy, not regex) | Extracted every ≥40-char token from tracked non-`node_modules` source, filtered to ≥18 distinct chars | **No secrets.** All hits are URLs, camelCase identifier lists, and `.planning/` path fragments |
| Commit messages | `git log --all` grepped for `passw\|secret\|token\|api[_-]?key\|credential` | Discussion of security *mechanisms* only. **No secret values in any message** |
| Secret committed then removed (still fetchable) | Diffed all-ever-added against currently-tracked, excluding `node_modules` | 6 files removed: `fix_script.js`, `remove_layout.js`, `replace_script.js`, `start_app.bat`, `start_app.sh` (all removed in `d781533`), `05-DISCUSS-CHECKPOINT.json`. **All read — zero secret content** |
| `.env`, `.gemini/`, `.npmrc`, keys/certs | `git log --all` per path | **Never committed** |
| Runtime artifacts (`runtime.db`, `audit.db`, `data/deals/`, `-wal`, `-shm`, `.bak`, `.tmp`, `public/uploads/`) | `git log --all --diff-filter=A` | **Never committed.** See positive note below |
| Real MNPI / real deal data | `data/deals/` listing; `control.db.deals` row count | `data/deals/` **empty**; `deals` table **0 rows**. No real acquisition data exists anywhere in the repo |
| PII in seed data | Dumped `employees`, `hrbps`, `projects` from `demo.db` | Fictional cast (`Sarah Jenkins`, `Michael Chang`, `Emma Watson`, `Karen Peterson`, `David Miller`) against fictional target `NextGen Sensors Ltd.`. **No real employee PII** |

**Positive worth recording — the gitignore guards landed *before* the artifacts they protect.** This is the correct ordering and it held twice:

```
d790de5  2026-07-23  fix(01-01): pre-empt SQLite artifact leaks in .gitignore and download-zip
9ff8e8f  2026-07-23  feat(01-02): SQLite schema ... (first .db committed)      ← guard was first
9fda4b5  2026-08-01  feat(03-01): ... pre-empt runtime/audit/deal db leaks
9a6fb8d  2026-08-01  feat(03-02): ... split into control/demo/deals            ← guard was first
```

That is why there are zero WAL/SHM/audit/runtime/deal leaks in 270 commits. H-06 (`public/sent_emails/`) is the one directory that never got the same treatment.

---

## 4. PRE-PUSH RISK REGISTER

**235 commits are about to become public.** In priority order — everything here is still preventable.

### Must resolve before push

| # | Item | Finding | Action | Effort |
|---|------|---------|--------|--------|
| **1** | Decide `.planning/` public or not | H-05 | It publishes your own threat model, accepted risks, and the unfiltered `/api/raid` deferred-hardening note. Either `git rm -r --cached .planning` + gitignore, or make the call explicitly and on the record | 5 min |
| **2** | Remove `data/ma-portal.db` | H-02 | Dead 1.2 MB legacy file carrying 4 credential records for no reason. `git rm data/ma-portal.db` | 2 min |
| **3** | Stop tracking `data/control.db` **or** add a boot guard | H-01 | Today's hashes are harmless (they equal the published demo password). The risk is the *next* commit after a real password rotation. Untrack + seed at first boot, or refuse to boot in non-demo mode while any account still hashes to `TEdemo!2026` | 30-60 min |
| **4** | Gitignore `public/sent_emails/` | H-06 | `download-zip` already treats it as secret-bearing; git does not. In real-deal mode this directory holds MNPI comms. Close the asymmetry before, not after | 2 min |
| **5** | Remove `node_modules/better-sqlite3/build/` | H-07 | Leaks `/Users/karstenhaldan/…`, npm config paths, node-gyp cache, Node 22.18.0. `prebuilds/` is what zero-install needs; `build/` is redundant | 5 min |
| **6** | Add `".planning/*"` to the `download-zip` exclusion list | H-10 | One token at `server.js:1113`. Stops the admin export handing out the threat model | 1 min |

### Should resolve before push (cheap, and the push is the natural moment)

| # | Item | Finding | Action |
|---|------|---------|--------|
| 7 | Patch `body-parser` to ≥1.20.6 | H-11 | `npm update body-parser`, re-commit `node_modules`. Check the 50 MB PDF limit call site |
| 8 | Fix `file:///Users/karstenhaldan/…` links | H-08 | `aiService.js:300-302` → relative paths; regenerate the two `db.json` `aiPlan` blobs. Also fixes broken links for every user |
| 9 | Add `LICENSE` + affiliation disclaimer | H-04 | Already-public issue, but the push is when it gets more visible |

### Already public — a push will not fix these; they need a decision

| # | Item | Finding | Why it still needs an answer |
|---|------|---------|------------------------------|
| **A** | Acquisition Radar naming 6 real listed companies | H-03 | Public since `v1.4.0`. Disclaimer present and internal intent is documented, but the TE branding makes it read as an official pipeline. Swapping to fictional names costs nothing and closes it. Confirm with TE |
| **B** | TE name + logo on an unlicensed personal public repo | H-04 | Compounds A. Either disclaim, or move the repo into a TE-controlled org |
| **C** | TE internal email aliases | H-09 | Confirm whether `imo.desk@`, `corp.comms@`, `security.onboarding@`, `integration-leaders@`, `all@te.com` are real. Cannot be recalled from released tags |
| **D** | `/Users/karstenhaldan/…` in `db.json` + `aiService.js` at all tags | H-08 | Username disclosure is permanent for `v1.0.0`–`v2.0.1` |

### On history rewriting

**I do not recommend rewriting history for anything in this report.** Nothing found is a live secret. The committed hashes correspond to a password the project publishes itself, so a rewrite would buy nothing and would break the 11 published release tags and every existing clone. Items 1-6 are all "stop tracking going forward", which is sufficient because none of that content is public yet.

The one thing that *would* justify a rewrite is a **real** credential landing in a commit. That has not happened — and item 3 exists to keep it that way.

---

## 5. What I could NOT verify

Stated explicitly. This review is not exhaustive and does not certify the repo as clean.

1. **Runtime application vulnerabilities were out of scope** — auth logic, XSS, injection, upload handling, session management, and the deal-isolation/clean-room controls were not assessed. A separate reviewer owns these. Findings here say nothing about whether those controls work.
2. **Whether the TE email aliases are real.** I cannot query TE's directory. `imo.desk@`, `rewards.integration@`, `corp.comms@`, `security.onboarding@`, `integration-leaders@` are *presented* as real routing addresses; I classified them on that presentation, not on confirmation.
3. **Whether the Acquisition Radar content is genuinely public-source.** The disclaimer asserts it is and `PROJECT.md` corroborates the intent. I did not attempt to verify the revenue/valuation figures or fit scores against public filings, and I am not qualified to assess securities or disclosure implications. That is a question for TE legal.
4. **`node_modules` at the 9 intermediate tags was not tree-diffed.** I ran the full `npm ci` reproduction against **HEAD only**, and `npm audit` against `v1.0.0`, `v2.0.1` and HEAD. Since resolved versions are identical at every tag, the risk of a divergence at `v1.1.0`–`v2.0.0` is low — but it is unverified.
5. **Binary content of committed `.node` prebuilds beyond `@napi-rs`.** `better-sqlite3/prebuilds/*.node` (8 files) matched via the `npm ci` tree diff rather than an independent SHA-256 against the registry. The diff is strong evidence but is one step less direct than the `@napi-rs` check.
6. **`public/vendor/transformers/` was not integrity-verified.** 5 files, **37 MB**, added in `04e5146` and public since `v1.0.0`: `transformers.min.js` plus `ort-wasm.wasm`, `ort-wasm-simd.wasm`, `ort-wasm-threaded.wasm`, `ort-wasm-simd-threaded.wasm`. These were repointed from a CDN into the repo, so **no lockfile covers them, no `npm audit` sees them, and no integrity hash protects them** — unlike every package in `node_modules`, which I was able to reproduce and hash-check. I did not diff them against upstream Transformers.js / ONNX Runtime releases. **This is the most notable remaining supply-chain gap in the repo**, and it is already public. Recommend pinning the upstream version in `package.json` (or a `VENDOR.md`) and recording SHA-256 for all 5 files so future drift is detectable.
7. **`.git` object-level forensics.** I enumerated added/deleted files via `git log --all --diff-filter=A/D`, which covers reachable commits. I did not scan dangling/unreachable objects (`git fsck --lost-found`) for content that was staged and discarded before ever being committed.
8. **GitHub-side exposure.** Release asset zips, Actions logs, issues, wiki, gists, and fork state were not examined — only the local repository. The 3 turnkey zips attached to each of the 11 releases were not downloaded or inspected; they are built outside git via `git archive` and could in principle differ from tag content.
9. **`.planning/graphs/graph.json`** (4,244 nodes) was excluded from greps as machine-generated. It is derived from repo content, so it should not contain anything not found elsewhere — but I did not confirm that.
