// Phase 10 (Accounts & Identity) browser UAT runner — plan 10-06.
//
// Drives REAL Chromium contexts against ISOLATED servers, one child server per
// "lane". Scenario modules in scripts/uat/phase10-scenarios/*.js plug in; later
// plans ADD modules and never edit this file or another plan's module.
//
// Lanes (what the child server is):
//   real            MA_MODE=real, MA_DATA_DIR = empty temp dir. The server seeds
//                   it on first boot, then scripts/bootstrap-admin.js creates the
//                   first admin (password = ctx.adminPassword, a generated
//                   secret; the account is mustChangePassword).
//   real-handcopied MA_MODE=real with a byte copy of the committed control.db
//                   pre-placed in MA_DATA_DIR and NO bootstrap — the "operator
//                   copied the demo database onto a real host" case.
//   dev             no MA_MODE; MA_*_PATH point at temp copies of the committed
//                   demo/control databases.
//   demo-open       dev plus DEMO_OPEN=1.
//   dev-committed / demo-committed
//                   the same two setups EXCEPT MA_CONTROL_DB_PATH is left unset
//                   so control resolves to the committed data/control.db (the one
//                   deliberate exception to copies-only: these lanes exist to
//                   exercise accountsWritable:false). Runtime, audit, demo and
//                   deals stay temp copies. A write to a WAL-mode file can land
//                   only in the gitignored -wal, leaving the main file's hash and
//                   `git status` unchanged — so the guard hashes data/control.db
//                   AND data/control.db-wal around the child's life.
//
// Isolation (T-09-39 / T-10-58): committed data/demo.db* and data/control.db*
// are sha256-hashed before and after every run (main files exact; -wal compared
// with absent == empty, since a clean open may legitimately leave an empty
// sidecar; -shm is a volatile wal-index and is ignored). `git status
// --porcelain -- data` is captured before/after and compared. Any difference is
// a FAIL.
//
// A scenario module exports `{ scenarioName: async (ctx) => {...} }` plus
// `__lanes: { scenarioName: ['real', ...] }`. Keys beginning with `__` are
// metadata. A scenario with no __lanes entry runs in the `real` lane only.
//
// ctx: { lane, base, outDir, dataDir, preBootstrapUserCount, browser, newPage,
//        api, login, loginFull, adminPassword, adminLogin, adminPasswordNow,
//        shot, sleep, pass, fail, check }
//
// Usage:
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright \
//     node scripts/uat/phase10-walk.js [--scenario name]... [--lane name]... [--out dir] [--headed]
//
// Evidence default: .planning/phases/10-accounts-identity/evidence/
// Exit codes: 0 all PASS, 1 any FAIL, 2 Playwright not resolvable.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const SCENARIO_DIR = path.join(__dirname, 'phase10-scenarios');
const DEFAULT_OUT = path.join(REPO_ROOT, '.planning', 'phases', '10-accounts-identity', 'evidence');

const LANES = ['real', 'real-handcopied', 'dev', 'demo-open', 'dev-committed', 'demo-committed'];
const COMMITTED_CONTROL_LANES = new Set(['dev-committed', 'demo-committed']);
const VIEWPORT_DESKTOP = { width: 1440, height: 900 };
const VIEWPORT_PHONE = { width: 390, height: 844 };

// ---------------------------------------------------------------- argv
function parseArgs(argv) {
  const out = { scenarios: [], lanes: [], outDir: null, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scenario') out.scenarios.push(argv[++i]);
    else if (a === '--lane') out.lanes.push(argv[++i]);
    else if (a === '--out') out.outDir = argv[++i];
    else if (a === '--headed') out.headed = true;
  }
  return out;
}

// ---------------------------------------------------------------- playwright
let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright'));
} catch (e) {
  console.error('Playwright is not resolvable. Set PLAYWRIGHT_PATH to a playwright package directory, e.g. PLAYWRIGHT_PATH=$HOME/.npm/_npx/<hash>/node_modules/playwright');
  process.exit(2);
}

// ---------------------------------------------------------------- utils
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Main DB files exact; -wal normalised (absent and zero-length are the same
// state); -shm ignored. Covers demo.db* and control.db* under the committed data/.
function hashCommittedData() {
  const out = {};
  if (!fs.existsSync(DATA_DIR)) return out;
  const names = ['demo.db', 'control.db'];
  names.forEach((n) => {
    const main = path.join(DATA_DIR, n);
    out[n] = fs.existsSync(main) ? sha256File(main) : 'absent';
    const wal = path.join(DATA_DIR, n + '-wal');
    if (fs.existsSync(wal) && fs.statSync(wal).size > 0) out[n + '-wal'] = sha256File(wal);
    else out[n + '-wal'] = 'absent-or-empty';
  });
  return out;
}

function gitStatusData() {
  const r = spawnSync('git', ['status', '--porcelain', '--', 'data'], { cwd: REPO_ROOT, encoding: 'utf8' });
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

// ---------------------------------------------------------------- results
const results = [];
let logStream = null;
function record(scenario, step, status, detail) {
  const row = { scenario, step, status, detail: detail === undefined ? '' : detail };
  results.push(row);
  const line = `[${scenario}] ${status} - ${step}${row.detail !== '' ? ' :: ' + (typeof row.detail === 'string' ? row.detail : JSON.stringify(row.detail)) : ''}`;
  console.log(line);
  if (logStream) logStream.write(line + '\n');
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
  [
    'MA_MODE', 'MA_DATA_DIR', 'MA_DEMO_DB_PATH', 'MA_CONTROL_DB_PATH', 'MA_RUNTIME_DB_PATH',
    'MA_AUDIT_DB_PATH', 'MA_DEALS_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN', 'ENABLE_HSTS',
    'TRUST_PROXY', 'PUBLIC_BASE_URL', 'MA_BOOTSTRAP_PASSWORD', 'PORTAL_AUTH',
  ].forEach((k) => { delete env[k]; });
  return env;
}

// Builds {env, dataDir} for a lane. `tmp` is a fresh temp dir the runner owns.
function prepareLane(lane, tmp) {
  const env = baseEnv();
  if (lane === 'real') {
    const dataDir = path.join(tmp, 'real-data');
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    env.MA_MODE = 'real';
    env.MA_DATA_DIR = dataDir;
    return { env, dataDir };
  }
  if (lane === 'real-handcopied') {
    const dataDir = path.join(tmp, 'real-data');
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    copyWithSidecars(DATA_DIR, dataDir, ['control.db']);
    env.MA_MODE = 'real';
    env.MA_DATA_DIR = dataDir;
    return { env, dataDir };
  }
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(path.join(dataDir, 'deals'), { recursive: true });
  const committedControl = COMMITTED_CONTROL_LANES.has(lane);
  copyWithSidecars(DATA_DIR, dataDir, committedControl ? ['demo.db'] : ['demo.db', 'control.db']);
  env.MA_DEMO_DB_PATH = path.join(dataDir, 'demo.db');
  if (!committedControl) env.MA_CONTROL_DB_PATH = path.join(dataDir, 'control.db');
  env.MA_RUNTIME_DB_PATH = path.join(dataDir, 'runtime.db');
  env.MA_AUDIT_DB_PATH = path.join(dataDir, 'audit.db');
  env.MA_DEALS_DIR = path.join(dataDir, 'deals');
  if (lane === 'demo-open' || lane === 'demo-committed') env.DEMO_OPEN = '1';
  return { env, dataDir };
}

// ---------------------------------------------------------------- server
async function startServer(port, env) {
  const childEnv = Object.assign({}, env, { PORT: String(port) });
  const child = spawn(process.execPath, ['server.js'], { cwd: REPO_ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdout.on('data', () => { /* drained */ });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('server exited early: ' + stderr.slice(0, 600));
    try {
      const res = await fetch(base + '/api/auth/mode');
      if (res.status === 200) return { child, base, getStderr: () => stderr };
    } catch (e) { /* not up yet */ }
    await sleep(150);
  }
  child.kill('SIGKILL');
  throw new Error('server did not become ready within 20s: ' + stderr.slice(0, 600));
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* gone */ } }, 4000);
    child.once('exit', () => { clearTimeout(t); resolve(); });
    try { child.kill('SIGTERM'); } catch (e) { clearTimeout(t); resolve(); }
  });
}

// Read-only user count from a control.db (never writes).
function countUsers(dbPath) {
  const Database = require(path.join(REPO_ROOT, 'node_modules', 'better-sqlite3'));
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try { return db.prepare('SELECT COUNT(*) AS n FROM users').get().n; } finally { db.close(); }
}

// ---------------------------------------------------------------- api client
function makeApi(base) {
  async function raw(cookie, method, urlPath, body) {
    const res = await fetch(base + urlPath, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* non-JSON body */ }
    return { status: res.status, json, headers: res.headers };
  }
  function cookieOf(headers) {
    const m = /ma_session=([^;]+)/.exec(headers.get('set-cookie') || '');
    return m ? 'ma_session=' + m[1] : null;
  }
  // The login throttle is 8/min per IP: on a 429 wait and retry (up to ~70 s).
  async function loginFull(username, password) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const r = await raw(null, 'POST', '/api/auth/login', { username, password });
      if (r.status === 429) { await sleep(10000); continue; }
      if (r.status !== 200) throw new Error(`login failed for ${username}: ${r.status} ${JSON.stringify(r.json)}`);
      const cookie = cookieOf(r.headers);
      if (!cookie) throw new Error('login returned no ma_session cookie for ' + username);
      return { cookie, user: r.json.user, mustChangePassword: r.json.mustChangePassword === true };
    }
    throw new Error('login throttled for ' + username + ' (429 after retries)');
  }
  return { api: raw, loginFull, cookieOf };
}

// ---------------------------------------------------------------- lane run
async function runLane(lane, scenarioNames, registry, args, outDir, browser) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase10-walk-' + lane + '-'));
  const laneTag = 'lane:' + lane;
  const committedControl = COMMITTED_CONTROL_LANES.has(lane);
  const hashesBefore = committedControl ? hashCommittedData() : null;
  let server = null;
  const contexts = [];
  try {
    const { env, dataDir } = prepareLane(lane, tmp);
    const port = await freePort();
    server = await startServer(port, env);
    const { base } = server;
    const { api, loginFull, cookieOf } = makeApi(base);
    const mode = await api(null, 'GET', '/api/auth/mode');
    record(laneTag, 'server booted, /api/auth/mode answers', mode.status === 200 ? 'PASS' : 'FAIL', mode.json);

    let preBootstrapUserCount = null;
    let adminPassword = null;
    let rotatedPassword = null;
    if (lane === 'real') {
      preBootstrapUserCount = countUsers(path.join(dataDir, 'control.db'));
      adminPassword = randomSecret(20);
      const bs = spawnSync(process.execPath, ['scripts/bootstrap-admin.js'], {
        cwd: REPO_ROOT,
        env: Object.assign({}, env, { MA_BOOTSTRAP_PASSWORD: adminPassword }),
        encoding: 'utf8',
      });
      record(laneTag, 'bootstrap-admin created the first admin', bs.status === 0 ? 'PASS' : 'FAIL',
        bs.status === 0 ? { preBootstrapUserCount } : { status: bs.status, stderr: String(bs.stderr).slice(0, 300) });
    }

    // Performs the bootstrap admin's forced rotation once per lane run.
    let adminRotationCookie = null;
    async function adminLogin() {
      if (!adminPassword) throw new Error('adminLogin() is only available in the real lane');
      if (!rotatedPassword) {
        const first = await loginFull('admin', adminPassword);
        const next = 'Rot-' + randomSecret(20);
        const ch = await api(first.cookie, 'POST', '/api/auth/change-password', { currentPassword: adminPassword, newPassword: next });
        if (ch.status !== 200) throw new Error('admin forced rotation failed: ' + ch.status + ' ' + JSON.stringify(ch.json));
        rotatedPassword = next;
        adminRotationCookie = cookieOf(ch.headers) || first.cookie;
        return adminRotationCookie;
      }
      return (await loginFull('admin', rotatedPassword)).cookie;
    }

    async function newPage(opts) {
      const o = opts || {};
      const viewport = { width: o.width || VIEWPORT_DESKTOP.width, height: o.height || VIEWPORT_DESKTOP.height };
      const context = await browser.newContext({ viewport });
      contexts.push(context);
      const cookies = (o.cookies || []).map((c) => {
        const m = /^([^=]+)=(.*)$/.exec(c);
        return { name: m[1], value: m[2], url: base, httpOnly: true };
      });
      if (cookies.length) await context.addCookies(cookies);
      const page = await context.newPage();
      page.pageErrors = [];
      page.apiRequests = []; // { method, url } for every /api/ request
      page.navigations = 0;  // main-frame navigations
      page.on('pageerror', (e) => page.pageErrors.push(String(e)));
      page.on('request', (r) => {
        const u = r.url();
        if (u.includes('/api/')) page.apiRequests.push({ method: r.method(), url: u.replace(base, '') });
      });
      page.on('framenavigated', (f) => { if (f === page.mainFrame()) page.navigations++; });
      return page;
    }

    const shot = async (page, name) => {
      const file = /\.[a-z]+$/i.test(name) ? name : name + '.jpg';
      const p = path.join(outDir, file);
      await page.screenshot({ path: p, type: 'jpeg', quality: 60, fullPage: false });
      return p;
    };

    for (const name of scenarioNames) {
      const ctx = {
        lane, base, outDir, dataDir, preBootstrapUserCount, browser, newPage,
        api, loginFull, adminPassword, adminLogin, sleep, shot,
        login: async (username, password) => (await loginFull(username, password)).cookie,
        adminPasswordNow: () => rotatedPassword || adminPassword,
        viewports: { desktop: VIEWPORT_DESKTOP, phone: VIEWPORT_PHONE },
        pass: (step, detail) => record(name + '@' + lane, step, 'PASS', detail),
        fail: (step, detail) => record(name + '@' + lane, step, 'FAIL', detail),
        check: (step, cond, detail) => record(name + '@' + lane, step, cond ? 'PASS' : 'FAIL', detail),
      };
      try {
        await registry[name].fn(ctx);
      } catch (e) {
        record(name + '@' + lane, 'scenario threw', 'FAIL', String(e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
      }
    }
  } catch (e) {
    record(laneTag, 'lane failure', 'FAIL', String(e && e.message ? e.message : e));
  } finally {
    for (const c of contexts) { try { await c.close(); } catch (e) { /* ignore */ } }
    if (server) await stopServer(server.child);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    if (committedControl) {
      const after = hashCommittedData();
      const same = JSON.stringify(hashesBefore) === JSON.stringify(after);
      record(laneTag, 'committed data/control.db AND control.db-wal unchanged across this lane', same ? 'PASS' : 'FAIL',
        same ? { control: after['control.db'].slice(0, 12), wal: after['control.db-wal'].slice(0, 12) } : { before: hashesBefore, after });
    }
  }
}

// ---------------------------------------------------------------- main
(async () => {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.outDir || DEFAULT_OUT);
  fs.mkdirSync(outDir, { recursive: true });
  logStream = fs.createWriteStream(path.join(outDir, 'walk.log'));
  console.log('evidence dir: ' + outDir);

  // Load scenario modules in name order: registry[name] = { fn, lanes }.
  const registry = {};
  if (fs.existsSync(SCENARIO_DIR)) {
    fs.readdirSync(SCENARIO_DIR).filter((n) => n.endsWith('.js')).sort().forEach((n) => {
      const mod = require(path.join(SCENARIO_DIR, n));
      const lanesMeta = (mod.__lanes && typeof mod.__lanes === 'object') ? mod.__lanes : {};
      Object.keys(mod).forEach((name) => {
        if (name.indexOf('__') === 0 || typeof mod[name] !== 'function') return;
        registry[name] = { fn: mod[name], lanes: Array.isArray(lanesMeta[name]) ? lanesMeta[name] : ['real'], module: n };
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
  const gitBefore = gitStatusData();
  let browser = null;
  try {
    browser = await chromium.launch({ headless: !args.headed });
    for (const lane of LANES) {
      if (args.lanes.length && !args.lanes.includes(lane)) continue;
      const names = wanted.filter((n) => registry[n].lanes.includes(lane));
      if (!names.length) continue;
      console.log(`\n=== lane ${lane}: ${names.join(', ')} ===`);
      await runLane(lane, names, registry, args, outDir, browser);
    }
  } catch (e) {
    record('setup', 'harness failure', 'FAIL', String(e && e.message ? e.message : e));
  } finally {
    if (browser) { try { await browser.close(); } catch (e) { /* ignore */ } }
    const dataAfter = hashCommittedData();
    const same = JSON.stringify(dataBefore) === JSON.stringify(dataAfter);
    record('data-integrity', 'committed data/demo.db and data/control.db (+ -wal) sha256 unchanged', same ? 'PASS' : 'FAIL',
      same ? Object.keys(dataBefore).length + ' value(s) identical' : { before: dataBefore, after: dataAfter });
    const gitAfter = gitStatusData();
    record('data-integrity', '`git status --porcelain -- data` unchanged', gitBefore === gitAfter ? 'PASS' : 'FAIL',
      gitBefore === gitAfter ? (gitAfter === '' ? 'clean' : gitAfter) : { before: gitBefore, after: gitAfter });
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
    const failed = results.filter((r) => r.status === 'FAIL').length;
    console.log(`\n${results.length - failed} PASS, ${failed} FAIL. results: ${path.join(outDir, 'results.json')}`);
    logStream.end(() => process.exit(failed ? 1 : 0));
  }
})();
