// Phase 13 (Content Safety) browser proof runner - plan 13-12 (D-13-07).
//
// Drives REAL Chromium against ISOLATED child servers, one per "lane". Scenario
// modules in scripts/uat/phase13-scenarios/*.js plug in. This is a developer /
// release-gate tool: it is export-ignored with the rest of scripts/uat and adds
// no dependency (Playwright is resolved from the host, never installed here).
//
// Why a separate runner (PD-23): scripts/uat/phase10-walk.js cannot pass CSP_MODE
// or MA_SLIDES_UPLOAD_DIR per lane and is never edited; its pattern is copied.
//
// Lanes (what the child server is):
//   real            MA_MODE=real, MA_DATA_DIR = empty temp dir, first admin from
//                   scripts/bootstrap-admin.js (generated password, rotated
//                   through the real change-password route). Egress defaults all
//                   OFF in this mode.
//   dev             no MA_MODE; MA_*_PATH point at temp COPIES of the committed
//                   demo/control databases (login required, published demo
//                   accounts).
//   demo-open       dev plus DEMO_OPEN=1 (anonymous showcase visitor). Open mode
//                   skips the session gate, so the inline admin-only routes
//                   (csp-violations, egress POST) answer 403 to everyone; the
//                   runner reads the violation list with a generated
//                   X-Admin-Token (ADMIN_TOKEN is set on this child only).
//   dev-defaultdir  dev with MA_SLIDES_UPLOAD_DIR UNSET so uploaded slides land in
//                   the PRODUCT'S DEFAULT slide directory (B-1). Since the CR-A01
//                   fix (13-REVIEW-FIX-S) that default is OUTSIDE the public
//                   static root: `<instance data dir>/slides`, i.e. `<repo>/data/slides`
//                   for this non-real lane (gitignored, created 0700 at the first
//                   upload) - NOT public/uploads/slides any more. The scenarios
//                   delete what they upload (removing data/slides again when the
//                   run created it) and compare the listing before/after, and
//                   assert nothing is ever written under public/uploads/slides.
//
// Every child gets CSP_MODE=<--csp-mode> (enforce by default - the product
// default since plan 13-13; `--csp-mode report-only` is the documented rollback
// pair and stays selectable). Committed
// data/demo.db* and data/control.db* are sha256-hashed before/after the whole
// run (main files exact; -wal absent == empty; -shm ignored) and
// `git status --porcelain -- data public/sent_emails` is compared. Any change is
// a FAIL. POST /api/settings/new-ma is never called (it deletes tracked
// public/sent_emails/*).
//
// A scenario module exports `{ name: async (ctx) => {} }` plus
// `__lanes: { name: ['real', ...] }` (default: `dev`). Keys starting `__` are
// metadata.
//
// Usage:
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright \
//     node scripts/uat/phase13-xss.js [--scenario name]... [--lane name]...
//       [--csp-mode enforce|report-only] [--out dir] [--headed]
//
// Exit codes: 0 every check PASS, 1 any FAIL, 2 Playwright not resolvable.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const DEFAULT_SCENARIO_DIR = path.join(__dirname, 'phase13-scenarios');
const DEFAULT_OUT = path.join(REPO_ROOT, '.planning', 'phases', '13-content-safety', 'evidence');

const LANES = ['real', 'dev', 'demo-open', 'dev-defaultdir'];
const VIEWPORT_DESKTOP = { width: 1440, height: 900 };
const VIEWPORT_PHONE = { width: 390, height: 844 };
const MIN_FREE_BYTES = 512 * 1024 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- argv
function parseArgs(argv) {
  const out = {
    scenarios: [], lanes: [], outDir: null, headed: false, cspMode: 'enforce', scenarioDir: null,
    chromium: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--chromium') out.chromium = argv[++i];
    else if (a === '--scenario') out.scenarios.push(argv[++i]);
    else if (a === '--lane') out.lanes.push(argv[++i]);
    else if (a === '--out') out.outDir = argv[++i];
    else if (a === '--csp-mode') out.cspMode = argv[++i];
    else if (a === '--scenario-dir') out.scenarioDir = argv[++i];
    else if (a === '--headed') out.headed = true;
  }
  return out;
}

// ---------------------------------------------------------------- playwright
// PLAYWRIGHT_PATH (a `playwright` OR `playwright-core` package directory - both
// expose `chromium`), then the same host search scripts/smoke/run.js performs
// (npx cache, global npm root; partially-installed entries are skipped).
// PLAYWRIGHT_CHROMIUM_EXECUTABLE (or --chromium) names a Chromium binary when the
// package's own browser revision is not in the host cache. Nothing is installed.
function resolvePlaywright() {
  const verify = (dir) => typeof require(dir).chromium === 'object';
  const envDir = process.env.PLAYWRIGHT_PATH;
  if (envDir) {
    const dir = path.resolve(envDir);
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if ((pkg.name === 'playwright' || pkg.name === 'playwright-core') && verify(dir)) {
        return { dir, version: pkg.name + '@' + (pkg.version || 'unknown'), source: 'PLAYWRIGHT_PATH' };
      }
    } catch (e) { /* fall through to the host search */ }
  }
  const { resolveTool } = require(path.join(REPO_ROOT, 'scripts', 'smoke', 'run.js'));
  const found = resolveTool('playwright', { verify });
  return found ? { dir: found.dir, version: 'playwright@' + found.version, source: found.source } : null;
}

// ---------------------------------------------------------------- utils
function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function hashCommittedData() {
  const out = {};
  ['demo.db', 'control.db'].forEach((n) => {
    const main = path.join(DATA_DIR, n);
    out[n] = fs.existsSync(main) ? sha256File(main) : 'absent';
    const wal = path.join(DATA_DIR, n + '-wal');
    out[n + '-wal'] = (fs.existsSync(wal) && fs.statSync(wal).size > 0) ? sha256File(wal) : 'absent-or-empty';
  });
  return out;
}

function gitStatusGuarded() {
  const r = spawnSync('git', ['status', '--porcelain', '--', 'data', 'public/sent_emails'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function randomSecret(len) {
  return crypto.randomBytes(Math.ceil(len * 0.75) + 2).toString('base64url').slice(0, len);
}

// Generated passwords must never reach the log.
const secrets = [];
function redact(s) {
  let out = String(s);
  secrets.forEach((x) => { if (x) out = out.split(x).join('<redacted>'); });
  return out;
}

// ---------------------------------------------------------------- results
const results = [];
function say(line) { console.log(redact(line)); }
function record(scenario, step, status, detail) {
  const row = { scenario, step, status, detail: detail === undefined ? '' : detail };
  results.push(row);
  const d = row.detail === '' || row.detail === null ? '' : ' :: ' + (typeof row.detail === 'string' ? row.detail : JSON.stringify(row.detail));
  say(`[${scenario}] ${status} - ${step}${d}`);
}

// ---------------------------------------------------------------- canary
// A tiny HTTP server on ANOTHER loopback port (= another origin) that records
// every hit. Stored payloads and the slide beacon target it; "no request to the
// canary" = its hit log is empty AND no browser request to that origin exists.
function startCanary() {
  return new Promise((resolve, reject) => {
    const hits = [];
    const srv = http.createServer((req, res) => {
      hits.push({ method: req.method, url: req.url.slice(0, 120), at: Date.now() });
      res.writeHead(200, { 'Content-Type': 'image/gif', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      res.end('GIF89a');
    });
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({
        server: srv,
        port,
        origin: `http://127.0.0.1:${port}`,
        hits: () => hits.slice(),
        reset: () => { hits.length = 0; },
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

// ---------------------------------------------------------------- lane setup
function copyWithSidecars(srcDir, destDir, names) {
  names.forEach((n) => {
    ['', '-wal'].forEach((suffix) => {
      const src = path.join(srcDir, n + suffix);
      if (fs.existsSync(src) && fs.statSync(src).size > 0) fs.copyFileSync(src, path.join(destDir, n + suffix));
    });
  });
}

function baseEnv() {
  const env = Object.assign({}, process.env);
  Object.keys(env).forEach((k) => { if (k.indexOf('MA_') === 0) delete env[k]; });
  ['DEMO_OPEN', 'ADMIN_TOKEN', 'ENABLE_HSTS', 'TRUST_PROXY', 'PUBLIC_BASE_URL', 'PORTAL_AUTH', 'CSP_MODE',
    'NODE_TEST_CONTEXT'].forEach((k) => { delete env[k]; });
  return env;
}

// Builds { env, dataDir, slidesDir } for a lane. `tmp` is a fresh runner-owned dir.
function prepareLane(lane, tmp, cspMode) {
  const env = baseEnv();
  env.CSP_MODE = cspMode;
  let dataDir;
  let slidesDir;
  if (lane === 'real') {
    dataDir = path.join(tmp, 'real-data');
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    env.MA_MODE = 'real';
    env.MA_DATA_DIR = dataDir;
  } else {
    dataDir = path.join(tmp, 'data');
    fs.mkdirSync(path.join(dataDir, 'deals'), { recursive: true });
    copyWithSidecars(DATA_DIR, dataDir, ['demo.db', 'control.db']);
    env.MA_DEMO_DB_PATH = path.join(dataDir, 'demo.db');
    env.MA_CONTROL_DB_PATH = path.join(dataDir, 'control.db');
    env.MA_RUNTIME_DB_PATH = path.join(dataDir, 'runtime.db');
    env.MA_AUDIT_DB_PATH = path.join(dataDir, 'audit.db');
    env.MA_DEALS_DIR = path.join(dataDir, 'deals');
    if (lane === 'demo-open') {
      env.DEMO_OPEN = '1';
      // Open mode skips the session gate, so req.portalUser is null for EVERY
      // caller and the inline admin-only routes (csp-violations, egress POST)
      // answer 403 even to a signed-in admin. The runner reads the violation
      // list with the X-Admin-Token break-glass header instead; browsers never
      // send it, so the anonymous showcase behaviour under test is unchanged.
      env.ADMIN_TOKEN = randomSecret(24);
      secrets.push(env.ADMIN_TOKEN);
    }
  }
  if (lane === 'dev-defaultdir') {
    // Per-scenario child-env override that UNSETS a key (B-1): the slide lands in the
    // product's DEFAULT slide directory, <instance data dir>/slides - for this
    // non-real lane <repo>/data/slides (db/dbFiles.js DATA_DIR; lib/slideUpload.js
    // slidesDir()), outside the public static root since the CR-A01 fix. It is NOT
    // public/uploads/slides any more; scenarios must not read or write that path
    // except to assert nothing lands there.
    delete env.MA_SLIDES_UPLOAD_DIR;
    delete env.MA_SLIDE_QUOTA_MB;
    slidesDir = path.join(DATA_DIR, 'slides');
  } else {
    slidesDir = path.join(tmp, 'slides');
    fs.mkdirSync(slidesDir, { recursive: true });
    env.MA_SLIDES_UPLOAD_DIR = slidesDir;
    env.MA_SLIDE_QUOTA_MB = '1';
  }
  return { env, dataDir, slidesDir };
}

// ---------------------------------------------------------------- server
async function startServer(port, env) {
  const childEnv = Object.assign({}, env, { PORT: String(port) });
  const child = spawn(process.execPath, ['server.js'], { cwd: REPO_ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdout.on('data', () => { /* drained */ });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('server exited early: ' + stderr.slice(0, 600));
    try {
      const res = await fetch(base + '/api/auth/mode');
      if (res.status === 200) return { child, base, getStderr: () => stderr };
    } catch (e) { /* not up yet */ }
    await sleep(150);
  }
  child.kill('SIGKILL');
  throw new Error('server did not become ready within 40s: ' + stderr.slice(0, 600));
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* gone */ } }, 4000);
    child.once('exit', () => { clearTimeout(t); resolve(); });
    try { child.kill('SIGTERM'); } catch (e) { clearTimeout(t); resolve(); }
  });
}

// ---------------------------------------------------------------- api client
function makeApi(base) {
  async function raw(cookie, method, urlPath, body, extraHeaders) {
    const res = await fetch(base + urlPath, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}, extraHeaders || {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    let text = '';
    try { text = await res.text(); json = JSON.parse(text); } catch (e) { /* non-JSON body */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  function cookieOf(headers) {
    const m = /ma_session=([^;]+)/.exec(headers.get('set-cookie') || '');
    return m ? 'ma_session=' + m[1] : null;
  }
  // The login throttle is 8/min per IP: on a 429 wait and retry (up to ~100 s).
  async function loginFull(username, password) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const r = await raw(null, 'POST', '/api/auth/login', { username, password });
      if (r.status === 429) { await sleep(10000); continue; }
      if (r.status !== 200) throw new Error(`login failed for ${username}: ${r.status}`);
      const cookie = cookieOf(r.headers);
      if (!cookie) throw new Error('login returned no ma_session cookie for ' + username);
      return { cookie, user: r.json.user, mustChangePassword: r.json.mustChangePassword === true };
    }
    throw new Error('login throttled for ' + username + ' (429 after retries)');
  }
  return { api: raw, loginFull, cookieOf };
}

// The published demo password is read from the shipped login.js (its single
// client-side home), never hard-coded here.
function publishedDemoPassword() {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'login.js'), 'utf8');
  const m = /var\s+DEMO_PASSWORD\s*=\s*'([^']+)'/.exec(src);
  if (!m) throw new Error('could not read DEMO_PASSWORD from public/js/login.js');
  return m[1];
}

// ---------------------------------------------------------------- browser page
// In-page listener: every securitypolicyviolation (any frame, any document) is
// pushed to window.__cspv BEFORE any page script runs (PD-31).
function violationInit() {
  window.__cspv = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__cspv.push({
      directive: e.effectiveDirective || e.violatedDirective,
      blocked: String(e.blockedURI || '').slice(0, 160),
      source: String(e.sourceFile || '').slice(0, 160),
      line: e.lineNumber || 0,
      disposition: e.disposition,
      sample: String(e.sample || '').slice(0, 60),
      doc: String(document.location && document.location.pathname || '').slice(0, 80),
    });
  }, true);
}

// ---------------------------------------------------------------- lane run
async function runLane(lane, scenarioNames, registry, args, outDir, browser, canary) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase13-xss-' + lane + '-'));
  const laneTag = 'lane:' + lane;
  let server = null;
  const contexts = [];
  try {
    const { env, dataDir, slidesDir } = prepareLane(lane, tmp, args.cspMode);
    const port = await freePort();
    server = await startServer(port, env);
    const { base } = server;
    const { api, loginFull, cookieOf } = makeApi(base);
    const mode = await api(null, 'GET', '/api/auth/mode');
    record(laneTag, `server booted (CSP_MODE=${args.cspMode}), /api/auth/mode answers`, mode.status === 200 ? 'PASS' : 'FAIL', mode.json);

    // --- accounts -------------------------------------------------------
    const sessions = new Map(); // memoised logins: key -> cookie
    let adminPassword = null;
    let rotatedPassword = null;
    if (lane === 'real') {
      adminPassword = randomSecret(20);
      secrets.push(adminPassword);
      const bs = spawnSync(process.execPath, ['scripts/bootstrap-admin.js'], {
        cwd: REPO_ROOT, env: Object.assign({}, env, { MA_BOOTSTRAP_PASSWORD: adminPassword }), encoding: 'utf8',
      });
      record(laneTag, 'bootstrap-admin created the first admin', bs.status === 0 ? 'PASS' : 'FAIL',
        bs.status === 0 ? '' : { status: bs.status, stderr: redact(String(bs.stderr)).slice(0, 300) });
    }

    // The bootstrap admin: forced rotation once per lane (real); the published
    // demo account (dev); no session at all (demo-open).
    async function adminCookie() {
      if (sessions.has('admin')) return sessions.get('admin');
      let cookie = null;
      if (lane === 'real') {
        const first = await loginFull('admin', adminPassword);
        const next = 'Rot-' + randomSecret(20);
        secrets.push(next);
        const ch = await api(first.cookie, 'POST', '/api/auth/change-password', { currentPassword: adminPassword, newPassword: next });
        if (ch.status !== 200) throw new Error('admin forced rotation failed: ' + ch.status);
        rotatedPassword = next;
        cookie = cookieOf(ch.headers) || first.cookie;
      } else {
        // dev AND demo-open: /api/admin/* (incl. csp-violations) is closed to an
        // anonymous visitor even in demo-open, so the operator signs in with the
        // published demo account like the login page's click-to-fill does.
        cookie = (await loginFull('admin', publishedDemoPassword())).cookie;
      }
      sessions.set('admin', cookie);
      return cookie;
    }

    // A fresh, separate session for a named account (a victim / second author).
    async function freshSession(key, username, password) {
      const cookie = (await loginFull(username, password)).cookie;
      sessions.set(key, cookie);
      return cookie;
    }

    // Creates a real-lane account through the admin API, completes the forced
    // rotation, returns its cookie. Password never logged.
    async function createAccount(key, username, name, role) {
      const admin = await adminCookie();
      const created = await api(admin, 'POST', '/api/admin/users', { username, name, role });
      if (created.status !== 201 || !created.json || !created.json.tempPassword) {
        throw new Error(`account create failed for ${username}: ${created.status}`);
      }
      secrets.push(created.json.tempPassword);
      const first = await loginFull(username, created.json.tempPassword);
      const next = 'Rot-' + randomSecret(20);
      secrets.push(next);
      const ch = await api(first.cookie, 'POST', '/api/auth/change-password', { currentPassword: created.json.tempPassword, newPassword: next });
      if (ch.status !== 200) throw new Error(`forced rotation failed for ${username}: ${ch.status}`);
      const cookie = cookieOf(ch.headers) || first.cookie;
      sessions.set(key, cookie);
      return cookie;
    }

    // One fixture per lane server, shared by every scenario (sequential).
    //   real:      a deal with members author2 (admin), il (hrbp), emp, pmo; every
    //              session bound to the deal (that is what resolves the REAL store).
    //   dev:       admin author + a SECOND admin session, karen (hrbp), employee.
    //   demo-open: the anonymous showcase visitor is author and victim (cookie null).
    let fixturePromise = null;
    function fixture() {
      if (fixturePromise) return fixturePromise;
      fixturePromise = (async () => {
        const f = { lane, users: {}, dealId: null };
        if (lane === 'real') {
          const admin = await adminCookie();
          const names = {
            author: ['p13.author', 'Phase Thirteen Author', 'admin'],
            victim: ['p13.victim', 'Phase Thirteen Victim Admin', 'admin'],
            il: ['p13.il', 'Phase Thirteen Integration Lead', 'hrbp'],
            emp: ['p13.emp', 'Phase Thirteen Employee', 'employee'],
            pmo: ['p13.pmo', 'Phase Thirteen Workstream Lead', 'pmo'],
          };
          for (const key of Object.keys(names)) {
            const n = names[key];
            f.users[key] = { username: n[0], role: n[2], cookie: await createAccount(key, n[0], n[1], n[2]) };
          }
          const deal = await api(admin, 'POST', '/api/deals', {
            name: 'Phase 13 proof deal',
            targetCompany: 'Synthetic Proof Target Co',
            members: Object.keys(names).map((k) => names[k][0]),
          });
          if (deal.status !== 200 || !deal.json || !deal.json.deal || !deal.json.deal.id) throw new Error('deal create failed: ' + deal.status);
          f.dealId = deal.json.deal.id;
          f.users.admin = { username: 'admin', role: 'admin', cookie: admin };
          for (const key of Object.keys(f.users)) {
            const sel = await api(f.users[key].cookie, 'POST', '/api/deals/select', { dealId: f.dealId });
            if (sel.status !== 200) throw new Error(`deal select failed for ${f.users[key].username}: ${sel.status}`);
          }
        } else if (lane === 'demo-open') {
          // The showcase visitor is anonymous (writes are open there by design) and is
          // both author and victim; only the operator console / violation list needs
          // the admin session.
          const anon = { username: null, role: 'anonymous', cookie: null };
          f.users = { admin: { username: 'admin', role: 'admin', cookie: await adminCookie() }, author: anon, victim: anon, il: anon, emp: anon, pmo: anon };
        } else {
          const pw = publishedDemoPassword();
          const admin = await adminCookie();
          f.users.admin = { username: 'admin', role: 'admin', cookie: admin };
          f.users.author = f.users.admin;
          f.users.victim = { username: 'admin', role: 'admin', cookie: await freshSession('victim', 'admin', pw) };
          f.users.il = { username: 'karen', role: 'hrbp', cookie: await freshSession('il', 'karen', pw) };
          f.users.pmo = { username: 'pmo', role: 'pmo', cookie: await freshSession('pmo', 'pmo', pw) };
          f.users.emp = { username: 'employee-demo', role: 'employee', cookie: await freshSession('emp', 'employee-demo', pw) };
        }
        return f;
      })();
      return fixturePromise;
    }

    // --- pages ----------------------------------------------------------
    async function newPage(opts) {
      const o = opts || {};
      const viewport = { width: o.width || VIEWPORT_DESKTOP.width, height: o.height || VIEWPORT_DESKTOP.height };
      const context = await browser.newContext({ viewport, serviceWorkers: 'allow' });
      contexts.push(context);
      await context.addInitScript(violationInit);
      const cookies = (o.cookies || []).filter(Boolean).map((c) => {
        const m = /^([^=]+)=(.*)$/.exec(c);
        return { name: m[1], value: m[2], url: base, httpOnly: true };
      });
      if (cookies.length) await context.addCookies(cookies);
      if (o.localStorage) {
        await context.addInitScript((kv) => {
          try { Object.keys(kv).forEach((k) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, kv[k]); }); } catch (e) { /* none */ }
        }, o.localStorage);
      }
      const page = await context.newPage();
      page.pageErrors = [];
      page.dialogs = [];
      page.reqLog = [];       // { method, url, type } for EVERY request of the context (frames/workers included)
      page.cspConsole = [];   // console lines the browser prints for policy violations
      page.on('pageerror', (e) => page.pageErrors.push(String(e && e.message ? e.message : e).slice(0, 240)));
      page.on('dialog', (d) => { page.dialogs.push({ type: d.type(), message: String(d.message()).slice(0, 80) }); d.dismiss().catch(() => {}); });
      page.on('console', (m) => {
        const t = m.text();
        if (/Content Security Policy|\[Report Only\]/i.test(t)) page.cspConsole.push(t.slice(0, 260));
      });
      // One entry per request of the whole context (frames, workers included):
      // `status` is set only when a response reached the browser, `failed` when the
      // browser (CSP, abort) refused it - so "attempted" and "reached the network"
      // are separable facts.
      const entries = new Map();
      context.on('request', (r) => {
        let type = '';
        let frame = '';
        try { type = r.resourceType(); } catch (e) { /* none */ }
        try { frame = r.frame() ? r.frame().url() : ''; } catch (e) { /* service worker / detached */ }
        const entry = { method: r.method(), url: r.url(), type, frame };
        entries.set(r, entry);
        page.reqLog.push(entry);
      });
      context.on('response', (res) => {
        const e = entries.get(res.request());
        if (e) e.status = res.status();
      });
      context.on('requestfailed', (r) => {
        const e = entries.get(r);
        if (e) e.failed = (r.failure() && r.failure().errorText) || 'failed';
      });
      // Nothing may leave this host: every request to an origin other than the
      // app under test or the canary is answered locally (an empty 204) and
      // recorded in page.externalBlocked. The `request` event above still fires,
      // so an attempted third-party fetch stays visible to the assertions.
      page.externalBlocked = [];
      const appOrigin = base;
      await context.route('**/*', (route) => {
        const u = route.request().url();
        if (/^(data|blob|about):/i.test(u)) return route.continue();
        let origin = '';
        try { origin = new URL(u).origin; } catch (e) { /* unparsable */ }
        if (origin === appOrigin || origin === canary.origin) return route.continue();
        page.externalBlocked.push(u.slice(0, 120));
        return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' });
      });
      return page;
    }

    const settle = async (page, ms) => {
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => { /* polling pages never idle */ });
      await sleep(ms === undefined ? 600 : ms);
    };

    // window.__cspv of the main frame AND every child frame (decks, slides).
    const pageViolations = async (page) => {
      const all = [];
      for (const f of page.frames()) {
        try {
          const v = await f.evaluate(() => (window.__cspv || []).slice());
          v.forEach((x) => all.push(Object.assign({ frame: f === page.mainFrame() ? 'main' : 'child' }, x)));
        } catch (e) { /* detached / navigating frame */ }
      }
      return all;
    };

    // GET /api/admin/csp-violations with an admin session (none needed in demo-open).
    const endpointViolations = async () => {
      const cookie = await adminCookie();
      const token = env.ADMIN_TOKEN && lane === 'demo-open' ? { 'X-Admin-Token': env.ADMIN_TOKEN } : undefined;
      const r = await api(cookie, 'GET', '/api/admin/csp-violations', undefined, token);
      if (r.status !== 200 || !r.json) throw new Error('csp-violations answered ' + r.status);
      return r.json;
    };

    const shot = async (page, name, quality) => {
      const file = /\.[a-z]+$/i.test(name) ? name : name + '.jpg';
      const p = path.join(outDir, file);
      await page.screenshot({ path: p, type: 'jpeg', quality: quality || 28, fullPage: false });
      return p;
    };

    for (const name of scenarioNames) {
      const tag = name + '@' + lane;
      const ctx = {
        lane, base, outDir, tmp, dataDir, slidesDir, browser, canary, repoRoot: REPO_ROOT,
        cspMode: args.cspMode,
        newPage, settle, pageViolations, endpointViolations, shot, sleep,
        api, loginFull, adminCookie, createAccount, freshSession, fixture,
        publishedDemoPassword,
        viewports: { desktop: VIEWPORT_DESKTOP, phone: VIEWPORT_PHONE },
        say: (line) => say(line),
        pass: (step, detail) => record(tag, step, 'PASS', detail),
        fail: (step, detail) => record(tag, step, 'FAIL', detail),
        check: (step, cond, detail) => record(tag, step, cond ? 'PASS' : 'FAIL', detail),
      };
      try {
        await registry[name].fn(ctx);
      } catch (e) {
        record(tag, 'scenario threw', 'FAIL', String(e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
      }
    }
  } catch (e) {
    record(laneTag, 'lane failure', 'FAIL', String(e && e.message ? e.message : e));
  } finally {
    for (const c of contexts) { try { await c.close(); } catch (e) { /* ignore */ } }
    if (server) await stopServer(server.child);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------- main
(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!['report-only', 'enforce'].includes(args.cspMode)) {
    console.error('--csp-mode must be report-only or enforce');
    process.exit(2);
  }
  const pw = resolvePlaywright();
  if (!pw) {
    console.error('Playwright is not resolvable. Set PLAYWRIGHT_PATH to a playwright package directory, e.g. PLAYWRIGHT_PATH=$HOME/.npm/_npx/<hash>/node_modules/playwright');
    process.exit(2);
  }
  const { chromium } = require(pw.dir);
  try {
    const s = fs.statfsSync(os.tmpdir());
    if (s.bavail * s.bsize < MIN_FREE_BYTES) {
      console.error('refusing to start: less than 512 MB free in ' + os.tmpdir());
      process.exit(2);
    }
  } catch (e) { /* cannot check - continue */ }

  const outDir = path.resolve(args.outDir || DEFAULT_OUT);
  fs.mkdirSync(outDir, { recursive: true });
  const scenarioDir = path.resolve(args.scenarioDir || DEFAULT_SCENARIO_DIR);
  say(`phase13-xss: ${pw.version}; csp-mode=${args.cspMode}; evidence dir ${path.relative(REPO_ROOT, outDir) || '.'}`);

  const registry = {};
  if (fs.existsSync(scenarioDir)) {
    fs.readdirSync(scenarioDir).filter((n) => n.endsWith('.js') && n.charAt(0) !== '_').sort().forEach((n) => {
      const mod = require(path.join(scenarioDir, n));
      const lanesMeta = (mod.__lanes && typeof mod.__lanes === 'object') ? mod.__lanes : {};
      Object.keys(mod).forEach((name) => {
        if (name.indexOf('__') === 0 || typeof mod[name] !== 'function') return;
        registry[name] = { fn: mod[name], lanes: Array.isArray(lanesMeta[name]) ? lanesMeta[name] : ['dev'], module: n };
      });
    });
  }
  const wanted = args.scenarios.length ? args.scenarios : Object.keys(registry);
  const unknown = wanted.filter((n) => !registry[n]);
  if (unknown.length) {
    console.error('unknown scenario(s): ' + unknown.join(', ') + ' (known: ' + Object.keys(registry).join(', ') + ')');
    process.exit(1);
  }
  const badLane = Object.keys(registry).reduce((acc, n) => acc.concat(registry[n].lanes.filter((l) => !LANES.includes(l))), []);
  if (badLane.length) {
    console.error('unknown lane(s) in scenario metadata: ' + badLane.join(', ') + ' (known: ' + LANES.join(', ') + ')');
    process.exit(1);
  }

  const dataBefore = hashCommittedData();
  const gitBefore = gitStatusGuarded();
  let browser = null;
  let canary = null;
  try {
    canary = await startCanary();
    const launch = { headless: !args.headed };
    if (args.chromium) launch.executablePath = args.chromium;
    browser = await chromium.launch(launch);
    for (const lane of LANES) {
      if (args.lanes.length && !args.lanes.includes(lane)) continue;
      const names = wanted.filter((n) => registry[n].lanes.includes(lane));
      if (!names.length) continue;
      say(`\n=== lane ${lane}: ${names.join(', ')} ===`);
      await runLane(lane, names, registry, args, outDir, browser, canary);
    }
  } catch (e) {
    record('setup', 'harness failure', 'FAIL', String(e && e.message ? e.message : e));
  } finally {
    if (browser) { try { await browser.close(); } catch (e) { /* ignore */ } }
    if (canary) { try { await canary.close(); } catch (e) { /* ignore */ } }
    const dataAfter = hashCommittedData();
    const same = JSON.stringify(dataBefore) === JSON.stringify(dataAfter);
    record('data-integrity', 'committed data/demo.db and data/control.db (+ -wal) sha256 unchanged', same ? 'PASS' : 'FAIL',
      same ? Object.keys(dataBefore).length + ' value(s) identical' : { before: dataBefore, after: dataAfter });
    const gitAfter = gitStatusGuarded();
    record('data-integrity', '`git status --porcelain -- data public/sent_emails` unchanged', gitBefore === gitAfter ? 'PASS' : 'FAIL',
      gitBefore === gitAfter ? (gitAfter === '' ? 'clean' : gitAfter) : { before: gitBefore, after: gitAfter });
    const failed = results.filter((r) => r.status === 'FAIL').length;
    say(`\n${results.length - failed} PASS, ${failed} FAIL.`);
    // Let stdout drain and exit naturally; the timer is a backstop only.
    process.exitCode = failed ? 1 : 0;
    setTimeout(() => process.exit(process.exitCode), 3000).unref();
  }
})();
