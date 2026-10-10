// Phase 9 gap-closure UAT runner (plan 09-08, GD-13): drives REAL Chromium
// contexts against an ISOLATED real-deal server so a two-tab conflict walk is
// reproducible evidence instead of a human checklist.
//
// Isolation (T-09-39): the committed data/demo.db and data/control.db are
// COPIED (with any -wal/-shm sidecar) into a temp dir and never opened; the
// child server gets all five MA_* paths pointing at the copies, with DEMO_OPEN
// and ADMIN_TOKEN removed, so auth is fail-closed and every deal is real. The
// committed files are sha256-hashed before and after; any change is a FAIL.
//
// Scenarios live in scripts/uat/phase9-scenarios/*.js — one module per plan,
// each exporting `{ scenarioName: async (ctx) => {...} }`. The runner loads
// every module there in name order; later plans add a module and never edit
// this file or another plan's module.
//
// Usage:
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright \
//     node scripts/uat/phase9-walk.js [--scenario name]... [--out dir] [--headed] [--demo-open]
//
// --demo-open (plan 09-16): boots the child with DEMO_OPEN=1, performs no
// deal setup, and opens every tab with a signed-in session that has NO deal
// binding (the demo.db lane DEMO_OPEN exempts; scenarios exercise the
// cookie-less anonymous lane through ctx.api(null, ...)). Only scenarios a module lists in its
// `__demo` export (an array of scenario names) run in this mode; a normal run
// skips exactly those scenarios. Keys starting with `__` are metadata, never
// scenarios.
//
// Exit codes: 0 all PASS, 1 at least one FAIL, 2 Playwright not resolvable.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const SCENARIO_DIR = path.join(__dirname, 'phase9-scenarios');
const DEMO_PASSWORD = 'TEdemo!2026';

// ---------------------------------------------------------------- argv
function parseArgs(argv) {
  const out = { scenarios: [], outDir: null, headed: false, demoOpen: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scenario') out.scenarios.push(argv[++i]);
    else if (a === '--out') out.outDir = argv[++i];
    else if (a === '--headed') out.headed = true;
    else if (a === '--demo-open') out.demoOpen = true;
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

// ---------------------------------------------------------------- small utils
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Every committed demo/control DB file (main + sidecars) -> sha256.
function hashCommittedData() {
  const out = {};
  if (!fs.existsSync(DATA_DIR)) return out;
  fs.readdirSync(DATA_DIR).filter((n) => /^(demo|control)\.db/.test(n)).sort().forEach((n) => {
    out[n] = sha256File(path.join(DATA_DIR, n));
  });
  return out;
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

// ---------------------------------------------------------------- server
async function startServer(port, dataDir, demoOpen) {
  const env = Object.assign({}, process.env, {
    PORT: String(port),
    MA_DEMO_DB_PATH: path.join(dataDir, 'demo.db'),
    MA_CONTROL_DB_PATH: path.join(dataDir, 'control.db'),
    MA_RUNTIME_DB_PATH: path.join(dataDir, 'runtime.db'),
    MA_AUDIT_DB_PATH: path.join(dataDir, 'audit.db'),
    MA_DEALS_DIR: path.join(dataDir, 'deals'),
  });
  delete env.DEMO_OPEN;
  delete env.ADMIN_TOKEN;
  if (demoOpen) env.DEMO_OPEN = '1'; // anonymous demo showcase lane (plan 09-16)
  const child = spawn(process.execPath, ['server.js'], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdout.on('data', () => { /* drained */ });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('server exited early: ' + stderr.slice(0, 500));
    try {
      const res = await fetch(base + '/api/auth/me');
      if (res.status === 200 || res.status === 401) return { child, base };
    } catch (e) { /* not up yet */ }
    await sleep(150);
  }
  child.kill('SIGKILL');
  throw new Error('server did not become ready within 15s: ' + stderr.slice(0, 500));
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* gone */ } }, 3000);
    child.once('exit', () => { clearTimeout(t); resolve(); });
    try { child.kill('SIGTERM'); } catch (e) { clearTimeout(t); resolve(); }
  });
}

// ---------------------------------------------------------------- api client
function makeApi(base) {
  async function api(cookie, method, urlPath, body) {
    const res = await fetch(base + urlPath, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* non-JSON body */ }
    return { status: res.status, json };
  }
  async function login(username) {
    const res = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: DEMO_PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status}`);
    const m = /ma_session=([^;]+)/.exec(res.headers.get('set-cookie') || '');
    if (!m) throw new Error('login returned no ma_session cookie for ' + username);
    return { token: m[1], cookie: 'ma_session=' + m[1] };
  }
  return { api, login };
}

// ---------------------------------------------------------------- dialog helpers
async function overlayCount(page) {
  return page.evaluate(() => document.querySelectorAll('.conflict-modal-overlay').length);
}

async function readDialog(page) {
  return page.evaluate(() => {
    const m = document.querySelector('.conflict-modal');
    if (!m) return null;
    const q = (s) => m.querySelector(s);
    const txt = (s) => (q(s) ? q(s).textContent : null);
    const rows = Array.from(m.querySelectorAll('.conflict-diff-row')).map((r) => ({
      label: r.querySelector('.conflict-diff-label') ? r.querySelector('.conflict-diff-label').textContent : null,
      mine: r.querySelector('.conflict-diff-mine') ? r.querySelector('.conflict-diff-mine').textContent : null,
      theirs: r.querySelector('.conflict-diff-theirs') ? r.querySelector('.conflict-diff-theirs').textContent : null,
    }));
    const buttons = Array.from(m.querySelectorAll('button')).map((b) => ({ text: b.textContent, cls: b.className, disabled: b.disabled }));
    return {
      title: txt('.conflict-modal-title'),
      attribution: txt('.conflict-modal-attribution'),
      intro: txt('.conflict-modal-intro'),
      banner: txt('.conflict-modal-error'),
      rows,
      buttons,
      overlays: document.querySelectorAll('.conflict-modal-overlay').length,
    };
  });
}

async function waitDialog(page, timeout) {
  await page.waitForSelector('.conflict-modal-overlay', { timeout: timeout || 5000 });
  await sleep(150);
  return readDialog(page);
}

async function waitNoDialog(page, ms) {
  await sleep(ms || 1200);
  return (await overlayCount(page)) === 0;
}

// Fit check: nothing overflows the viewport horizontally and the dialog box
// lies entirely inside it.
async function fitCheck(page) {
  return page.evaluate(() => {
    const m = document.querySelector('.conflict-modal');
    const rect = m ? m.getBoundingClientRect() : null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      noHorizontalScroll: document.documentElement.scrollWidth <= vw,
      dialogInside: !!rect && rect.left >= 0 && rect.top >= 0 && rect.right <= vw && rect.bottom <= vh,
      rect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
      viewport: { w: vw, h: vh },
      // Diagnostic only: the first few elements reaching past the right edge.
      overflowing: Array.from(document.querySelectorAll('body *')).filter((e) => e.getBoundingClientRect().right > vw + 1 && e.getBoundingClientRect().width > 0)
        .slice(0, 3).map((e) => (e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '') + ' right=' + Math.round(e.getBoundingClientRect().right))),
    };
  });
}

// ---------------------------------------------------------------- main
(async () => {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.outDir
    ? path.resolve(args.outDir)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'phase9-walk-'));
  fs.mkdirSync(outDir, { recursive: true });
  logStream = fs.createWriteStream(path.join(outDir, 'walk.log'));
  console.log('evidence dir: ' + outDir);

  // Load scenario modules in name order.
  const registry = {};
  const demoNames = new Set();
  fs.readdirSync(SCENARIO_DIR).filter((n) => n.endsWith('.js')).sort().forEach((n) => {
    const mod = require(path.join(SCENARIO_DIR, n));
    Object.keys(mod).forEach((name) => {
      if (name.indexOf('__') === 0) return; // metadata, not a scenario
      registry[name] = mod[name];
    });
    (Array.isArray(mod.__demo) ? mod.__demo : []).forEach((name) => demoNames.add(name));
  });
  // Demo runs execute only demo scenarios; normal runs skip them.
  const eligible = Object.keys(registry).filter((n) => (args.demoOpen ? demoNames.has(n) : !demoNames.has(n)));
  const wanted = args.scenarios.length ? args.scenarios : eligible;
  const unknown = wanted.filter((n) => !registry[n] || !eligible.includes(n));
  if (unknown.length) {
    console.error('unknown scenario(s): ' + unknown.join(', ') + ' (known for this mode: ' + eligible.join(', ') + ')');
    process.exit(1);
  }

  const before = hashCommittedData();
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'phase9-walk-data-'));
  fs.mkdirSync(path.join(tmpData, 'deals'), { recursive: true });
  Object.keys(before).forEach((name) => fs.copyFileSync(path.join(DATA_DIR, name), path.join(tmpData, name)));

  let server = null;
  let browser = null;
  try {
    const port = await freePort();
    server = await startServer(port, tmpData, args.demoOpen);
    const { base } = server;
    const { api, login } = makeApi(base);

    // Shared setup: karen (Integration Lead) + pmo, one real deal, pmo granted legal.
    // --demo-open performs none of this: no session, no deal (the showcase lane).
    let seeder = null;
    let deal = null;
    if (args.demoOpen) {
      const me = await api(null, 'GET', '/api/auth/me');
      record('setup', 'demo-open instance reachable anonymously (DEMO_OPEN=1)', me.status === 200 ? 'PASS' : 'FAIL', me.status);
    } else {
      seeder = await login('karen');
      const created = await api(seeder.cookie, 'POST', '/api/deals', { name: 'Phase 9 walk deal', targetCompany: 'Walk Sensors GmbH', members: ['karen', 'pmo'] });
      if (created.status !== 201 && created.status !== 200) throw new Error('deal create failed: ' + created.status + ' ' + JSON.stringify(created.json));
      deal = created.json.deal;
      const sel = await api(seeder.cookie, 'POST', '/api/deals/select', { dealId: deal.id });
      if (sel.status !== 200) throw new Error('deal select failed: ' + sel.status);
      const grant = await api(seeder.cookie, 'POST', `/api/deals/${deal.id}/grants`, { username: 'pmo', ddAreas: ['legal'] });
      record('setup', `deal ${deal.id} created, pmo granted legal`, grant.status === 200 ? 'PASS' : 'FAIL', grant.status);
    }

    browser = await chromium.launch({ headless: !args.headed });

    // Opens a logged-in, deal-selected tab (its own context + session).
    async function openTab(opts) {
      const o = opts || {};
      const user = o.user || 'karen';
      const viewport = o.viewport || { width: 1440, height: 900 };
      const ctx = await browser.newContext({ viewport });
      // --demo-open: a signed-in session with NO deal binding — the lane
      // DEMO_OPEN=1 exempts (it resolves to demo.db). A cookie-less browser
      // tab cannot be used: the header deal switcher fetches /api/deals, a
      // control-plane path that is never open, and its 401 authRequired
      // bounces the tab login.html -> / -> login.html (pre-existing since
      // Phase 3, see deferred-items.md). Anonymous API behaviour is covered
      // by the scenario itself through ctx.api(null, ...).
      const sess = await login(user);
      if (!args.demoOpen) {
        const s = await api(sess.cookie, 'POST', '/api/deals/select', { dealId: deal.id });
        if (s.status !== 200) { await ctx.close(); throw new Error(`select failed for ${user}: ${s.status}`); }
      }
      await ctx.addCookies([{ name: 'ma_session', value: sess.token, url: base, httpOnly: true }]);
      const page = await ctx.newPage();
      page.requests = [];      // every non-GET /api/ call
      page.nativeDialogs = []; // every native confirm/alert (accepted)
      page.pageErrors = [];
      page.on('dialog', async (d) => { page.nativeDialogs.push({ type: d.type(), message: d.message() }); await d.accept(); });
      page.on('pageerror', (e) => page.pageErrors.push(String(e)));
      page.on('response', async (r) => {
        const u = r.url();
        const req = r.request();
        if (!u.includes('/api/') || req.method() === 'GET') return;
        let respJson = null;
        try { respJson = await r.json(); } catch (e) { /* non-JSON */ }
        let reqJson = null;
        try { reqJson = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) { /* non-JSON */ }
        page.requests.push({ method: req.method(), url: u.replace(base, ''), request: reqJson, status: r.status(), response: respJson });
      });
      if (o.path) await page.goto(base + o.path, { waitUntil: 'load' });
      return page;
    }

    const shot = async (page, name) => {
      const p = path.join(outDir, name);
      await page.screenshot({ path: p, fullPage: false });
      return p;
    };

    for (const name of wanted) {
      const ctx = {
        base, outDir, deal, seeder, api, login, openTab, shot,
        overlayCount, readDialog, waitDialog, waitNoDialog, fitCheck, sleep,
        pass: (step, detail) => record(name, step, 'PASS', detail),
        fail: (step, detail) => record(name, step, 'FAIL', detail),
        check: (step, cond, detail) => record(name, step, cond ? 'PASS' : 'FAIL', detail),
      };
      try {
        await registry[name](ctx);
      } catch (e) {
        record(name, 'scenario threw', 'FAIL', String(e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
      }
    }
  } catch (e) {
    record('setup', 'harness failure', 'FAIL', String(e && e.message ? e.message : e));
  } finally {
    if (browser) { try { await browser.close(); } catch (e) { /* ignore */ } }
    if (server) await stopServer(server.child);
    try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    const after = hashCommittedData();
    const same = JSON.stringify(before) === JSON.stringify(after);
    record('data-integrity', 'committed data/demo.db* and data/control.db* unchanged', same ? 'PASS' : 'FAIL', same ? Object.keys(before).length + ' file(s) identical' : { before, after });
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
    const failed = results.filter((r) => r.status === 'FAIL').length;
    console.log(`\n${results.length - failed} PASS, ${failed} FAIL. results: ${path.join(outDir, 'results.json')}`);
    logStream.end(() => process.exit(failed ? 1 : 0));
  }
})();
