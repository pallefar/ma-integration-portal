// Browser smoke harness (QUAL-02 / D-12-08): `npm run smoke`.
//
// Boots an ISOLATED real-deal server (MA_MODE=real, throw-away MA_DATA_DIR),
// signs in through the real login page as the bootstrap admin and as a
// synthetic Integration Lead, then visits every page in scripts/smoke/pages.js
// at 1440x900 and 390x844 in a real Chromium, collecting page errors, failed
// same-origin requests, missing landmarks and axe-core critical/serious counts.
//
// Never shipped: scripts/smoke/ is export-ignored (.gitattributes), so release
// zips built with `git archive` do not contain it. It is NOT part of the
// runtime path and adds NO dependency to package.json or node_modules —
// Playwright and axe-core are resolved from the host (see resolveTool), never
// from this repo and never installed by the harness.
//
// Usage:
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright \
//   AXE_CORE_PATH=/path/to/node_modules/axe-core \
//     npm run smoke -- [--pages a,b] [--out dir] [--fail-on-axe] [--headed]
//
// Exit codes: 0 clean, 1 page errors / failed requests / missing landmarks
// (or axe critical+serious > 0 with --fail-on-axe), 2 cannot run (tool
// missing, disk nearly full, bad usage). axe counts are informational until
// the accessibility phase gates them with --fail-on-axe.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const HEIGHT_FOR = { 1440: 900, 390: 844 };
const MIN_FREE_BYTES = 1024 * 1024 * 1024; // refuse to start below 1 GB free in tmpdir
const IDLE_TIMEOUT_MS = 10000;

const TOOLS = {
  playwright: { envVar: 'PLAYWRIGHT_PATH', label: 'Playwright' },
  'axe-core': { envVar: 'AXE_CORE_PATH', label: 'axe-core' },
};

// ------------------------------------------------------------ tool resolution
function readPackage(dir, name) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (pkg && pkg.name === name) return pkg;
  } catch (e) { /* not a package dir */ }
  return null;
}

// Resolves a tool package directory from OUTSIDE the repo. Order:
//   1. <ENV_VAR> (PLAYWRIGHT_PATH / AXE_CORE_PATH) — the package directory
//   2. opts.searchDirs — extra node_modules dirs (used by tests)
//   3. <home>/.npm/_npx/*/node_modules/<name> — the local npx cache
//   4. the global npm root (`npm root -g`); skipped when opts.globalRoot === null
// Every candidate must be a directory whose package.json `name` is the tool
// and, when opts.verify is given, pass verify(dir) (a partially-installed npx
// cache entry has a package.json but cannot be loaded — it is skipped, with
// opts.onSkip(dir, source) told about it).
// Returns { dir, version, source } or null. Never installs anything and never
// looks in this repo's node_modules.
function resolveTool(name, opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const home = o.home || os.homedir();
  const info = TOOLS[name];
  const candidates = [];
  if (info && env[info.envVar]) candidates.push({ dir: path.resolve(env[info.envVar]), source: info.envVar });
  (o.searchDirs || []).forEach((d) => candidates.push({ dir: path.join(d, name), source: 'searchDirs' }));
  const npx = path.join(home, '.npm', '_npx');
  try {
    fs.readdirSync(npx).sort().forEach((h) => {
      candidates.push({ dir: path.join(npx, h, 'node_modules', name), source: 'npx cache' });
    });
  } catch (e) { /* no npx cache */ }
  if (o.globalRoot !== null) {
    let root = o.globalRoot;
    if (root === undefined) {
      const r = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 15000, env: o.env ? Object.assign({}, process.env, o.env) : process.env });
      root = r.status === 0 ? String(r.stdout).trim() : '';
    }
    if (root) candidates.push({ dir: path.join(root, name), source: 'global npm root' });
  }
  for (const c of candidates) {
    const pkg = readPackage(c.dir, name);
    if (!pkg) continue;
    let usable = true;
    if (typeof o.verify === 'function') {
      try { usable = o.verify(c.dir) === true; } catch (e) { usable = false; }
    }
    if (!usable) { if (typeof o.onSkip === 'function') o.onSkip(c.dir, c.source); continue; }
    return { dir: c.dir, version: pkg.version || 'unknown', source: c.source };
  }
  return null;
}

// Loadability checks the CLI applies on top of the package-name check.
const VERIFY = {
  playwright: (dir) => typeof require(dir).chromium === 'object',
  'axe-core': (dir) => fs.statSync(path.join(dir, 'axe.min.js')).isFile(),
};
function resolveForCli(name) {
  return resolveTool(name, {
    verify: VERIFY[name],
    onSkip: (dir, source) => console.warn(`smoke: skipping ${name} at ${tildePath(dir)} (via ${source}): present but not loadable`),
  });
}

function tildePath(p) {
  const home = os.homedir();
  return home && p.indexOf(home) === 0 ? '~' + p.slice(home.length) : p;
}

const FIX_HINT = [
  'Fix: point the harness at host-local copies of the tools (nothing is installed by the harness):',
  '  PLAYWRIGHT_PATH=/path/to/node_modules/playwright',
  '  AXE_CORE_PATH=/path/to/node_modules/axe-core',
  'then re-run `npm run smoke`. See scripts/smoke/README.md (Tool resolution).',
].join('\n');

// ------------------------------------------------------------ small utilities
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Main DB files exact; -wal normalised (absent == empty); -shm ignored.
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

function parseArgs(argv) {
  const out = { pages: null, outDir: null, failOnAxe: false, headed: false, help: false, bad: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pages') out.pages = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') out.outDir = argv[++i];
    else if (a === '--fail-on-axe') out.failOnAxe = true;
    else if (a === '--headed') out.headed = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else out.bad.push(a);
  }
  return out;
}

const USAGE = 'Usage: npm run smoke -- [--pages a,b] [--out dir] [--fail-on-axe] [--headed]';

// ------------------------------------------------------------ lifecycle state
const state = { browser: null, child: null, tmp: null, cleaning: null, secrets: [] };

// Secrets (generated passwords) must never reach the output.
function redact(s) {
  let out = String(s);
  state.secrets.forEach((x) => { if (x) out = out.split(x).join('<redacted>'); });
  return out;
}
function say(line) { console.log(redact(line === undefined ? '' : line)); }

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* gone */ } }, 4000);
    child.once('exit', () => { clearTimeout(t); resolve(); });
    try { child.kill('SIGTERM'); } catch (e) { clearTimeout(t); resolve(); }
  });
}

// Idempotent: closes the browser, kills OUR server child, removes OUR temp dir.
function cleanup() {
  if (state.cleaning) return state.cleaning;
  state.cleaning = (async () => {
    try { if (state.browser) await state.browser.close(); } catch (e) { /* ignore */ }
    try { if (state.child) await stopServer(state.child); } catch (e) { /* ignore */ }
    try { if (state.tmp) fs.rmSync(state.tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  })();
  return state.cleaning;
}

// ------------------------------------------------------------ server
function realLaneEnv(dataDir) {
  const env = Object.assign({}, process.env);
  [
    'MA_MODE', 'MA_DATA_DIR', 'MA_DEMO_DB_PATH', 'MA_CONTROL_DB_PATH', 'MA_RUNTIME_DB_PATH',
    'MA_AUDIT_DB_PATH', 'MA_DEALS_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN', 'ENABLE_HSTS',
    'TRUST_PROXY', 'PUBLIC_BASE_URL', 'MA_BOOTSTRAP_PASSWORD', 'PORTAL_AUTH',
  ].forEach((k) => { delete env[k]; });
  env.MA_MODE = 'real';
  env.MA_DATA_DIR = dataDir;
  return env;
}

async function startServer(port, env) {
  const childEnv = Object.assign({}, env, { PORT: String(port) });
  const child = spawn(process.execPath, ['server.js'], { cwd: REPO_ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  state.child = child;
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdout.on('data', () => { /* drained */ });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('server exited early: ' + stderr.slice(0, 600));
    try {
      const res = await fetch(base + '/healthz');
      if (res.status === 200) return base;
    } catch (e) { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('server did not answer /healthz 200 within 25s: ' + stderr.slice(0, 600));
}

// ------------------------------------------------------------ browser flows
async function waitForPath(page, re, ms) {
  // page.url() (not page.evaluate): a navigation mid-poll cannot destroy the
  // execution context under us.
  const pathOf = () => new URL(page.url()).pathname;
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (re.test(pathOf())) return pathOf();
    await sleep(150);
  }
  return pathOf();
}

// Signs in through the real login page. When the account carries a one-time
// password (mustChangePassword) the change-password screen is completed with
// `rotateTo`. Returns the browser context holding the session.
async function signInViaLoginPage(browser, base, username, password, rotateTo) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(base + '/login.html', { waitUntil: 'load' });
  await page.fill('#lg-user', username);
  await page.fill('#lg-pass', password);
  await page.click('#login-form button[type="submit"]');
  const landed = await waitForPath(page, /(change-password|index)\.html$|^\/$/, 15000);
  if (/change-password\.html$/.test(landed)) {
    await page.waitForFunction(() => { const el = document.getElementById('cp-current'); return el && !el.disabled; }, null, { timeout: 10000 });
    await page.fill('#cp-current', password);
    await page.fill('#cp-new', rotateTo);
    await page.fill('#cp-confirm', rotateTo);
    await page.click('#cp-submit');
    const after = await waitForPath(page, /^\/(index\.html)?$/, 15000);
    if (!/^\/(index\.html)?$/.test(after)) {
      throw new Error(`forced rotation for ${username} did not reach the app (landed on ${after})`);
    }
  } else if (!/^\/(index\.html)?$/.test(landed)) {
    throw new Error(`sign-in for ${username} did not reach the app (landed on ${landed})`);
  }
  // Let the landing page's own first requests settle so the session is final.
  await page.waitForLoadState('networkidle', { timeout: IDLE_TIMEOUT_MS }).catch(() => { /* polling pages never idle */ });
  await page.close();
  return context;
}

async function apiJson(context, method, url, data) {
  const res = await context.request.fetch(url, { method, data, headers: { 'Content-Type': 'application/json' } });
  let json = null;
  try { json = await res.json(); } catch (e) { /* non-JSON */ }
  return { status: res.status(), json };
}

// ------------------------------------------------------------ measurement
function isAllowed(entry, resp) {
  return (entry.allow || []).some((a) => {
    const urlOk = a.url instanceof RegExp ? a.url.test(resp.url) : String(a.url) === resp.url.split('?')[0];
    return urlOk && (a.status === undefined || a.status === resp.status);
  });
}

async function measure(browser, base, entry, width, storageState, axeSource, outDir) {
  const height = HEIGHT_FOR[width] || 900;
  const ctxOpts = { viewport: { width, height } };
  if (storageState) ctxOpts.storageState = storageState;
  const context = await browser.newContext(ctxOpts);
  const row = { page: entry.name, width, critical: null, serious: null, pageErrors: [], failed: [], missing: [], notes: [] };
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => row.pageErrors.push('pageerror: ' + String(e && e.message ? e.message : e).slice(0, 200)));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      // The browser echoes every >= 400 response as a console error; those are
      // judged (with the allow-list) by the response listener below.
      if (/^Failed to load resource/.test(t)) return;
      if ((entry.allowConsole || []).some((re) => re.test(t))) {
        const note = 'allowed console.error (known, see pages.js KNOWN_CONSOLE): ' + t.slice(0, 70) + '...';
        if (!row.notes.includes(note)) row.notes.push(note);
        return;
      }
      row.pageErrors.push('console.error: ' + t.slice(0, 200));
    });
    page.on('response', (r) => {
      const u = r.url();
      if (u.indexOf(base) !== 0 || r.status() < 400) return;
      const resp = { url: u.slice(base.length), status: r.status(), method: r.request().method() };
      if (!isAllowed(entry, resp)) row.failed.push(`${resp.method} ${resp.url.split('?')[0]} ${resp.status}`);
    });

    await page.goto(base + entry.path, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: IDLE_TIMEOUT_MS }).catch(() => { row.notes.push('network never idle'); });
    if (typeof entry.afterLoad === 'function') {
      await entry.afterLoad(page);
      await page.waitForLoadState('networkidle', { timeout: IDLE_TIMEOUT_MS }).catch(() => { /* polling */ });
    }

    const landedOn = new URL(page.url()).pathname;
    if (landedOn !== entry.path) row.failed.push(`redirected ${entry.path} -> ${landedOn}`);

    const landmarks = entry.landmarks === undefined ? ['main'] : entry.landmarks;
    for (const sel of landmarks) {
      const n = await page.locator(sel).count();
      if (n === 0) row.missing.push(sel);
    }

    // [CSP] page.evaluate (CDP Runtime.evaluate) is not subject to the page's
    // script-src, so the app's CSP stays exactly as served — an inline
    // <script> injection (addScriptTag) would be blocked by it.
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => {
      const r = await window.axe.run(document, { resultTypes: ['violations'] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    });
    row.critical = violations.filter((v) => v.impact === 'critical').length;
    row.serious = violations.filter((v) => v.impact === 'serious').length;
    row.violations = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');

    if (outDir) {
      await page.screenshot({ path: path.join(outDir, `${entry.name}-${width}.jpg`), type: 'jpeg', quality: 60, fullPage: false });
    }
  } catch (e) {
    row.pageErrors.push('harness: ' + String(e && e.message ? e.message : e).split('\n')[0].slice(0, 240));
  } finally {
    try { await context.close(); } catch (e) { /* ignore */ }
  }
  return row;
}

function formatTable(rows) {
  const head = ['page', 'width', 'axe critical', 'axe serious', 'page errors', 'failed req', 'landmarks'];
  const body = rows.map((r) => [
    r.page, String(r.width),
    r.critical === null ? '-' : String(r.critical), r.serious === null ? '-' : String(r.serious),
    String(r.pageErrors.length), String(r.failed.length), r.missing.length ? 'MISSING ' + r.missing.join(',') : 'ok',
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  return [line(head), line(widths.map((w) => '-'.repeat(w)))].concat(body.map(line)).join('\n');
}

// ------------------------------------------------------------ main
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return 0; }
  if (args.bad.length) { console.error('unknown argument(s): ' + args.bad.join(' ') + '\n' + USAGE); return 2; }

  const registry = require('./pages');
  const known = registry.map((p) => p.name);
  const wanted = args.pages || known;
  const unknown = wanted.filter((n) => !known.includes(n));
  if (unknown.length) {
    console.error('unknown page(s): ' + unknown.join(', ') + ' (known: ' + known.join(', ') + ')');
    return 2;
  }
  const entries = registry.filter((p) => wanted.includes(p.name));

  // --- tools (outside the repo; never installed here)
  const pw = resolveForCli('playwright');
  const axeTool = resolveForCli('axe-core');
  const missing = [];
  if (!pw) missing.push('Playwright (set PLAYWRIGHT_PATH)');
  if (!axeTool) missing.push('axe-core (set AXE_CORE_PATH)');
  if (missing.length) {
    console.error('smoke: cannot run - missing tool(s): ' + missing.join('; ') + '\n' + FIX_HINT);
    return 2;
  }
  let chromium;
  let axeSource;
  try {
    ({ chromium } = require(pw.dir));
    axeSource = fs.readFileSync(path.join(axeTool.dir, 'axe.min.js'), 'utf8');
  } catch (e) {
    console.error('smoke: cannot load a resolved tool: ' + String(e && e.message ? e.message : e).split('\n')[0] + '\n' + FIX_HINT);
    return 2;
  }
  console.log(`tools: playwright ${pw.version} (${tildePath(pw.dir)}, via ${pw.source}); axe-core ${axeTool.version} (${tildePath(axeTool.dir)}, via ${axeTool.source})`);

  // --- disk (this host is often nearly full)
  try {
    const s = fs.statfsSync(os.tmpdir());
    const free = s.bavail * s.bsize;
    if (free < MIN_FREE_BYTES) {
      console.error(`smoke: refusing to start - only ${(free / 1048576).toFixed(0)} MB free in ${os.tmpdir()} (need >= 1024 MB).`);
      return 2;
    }
  } catch (e) { console.warn('smoke: could not check free disk space (' + e.code + '); continuing'); }

  if (args.outDir) fs.mkdirSync(path.resolve(args.outDir), { recursive: true });
  const outDir = args.outDir ? path.resolve(args.outDir) : null;

  const dataBefore = hashCommittedData();
  const gitBefore = gitStatusGuarded();
  const rows = [];
  let exit = 0;

  try {
    state.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-smoke-'));
    const dataDir = path.join(state.tmp, 'real-data');
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const env = realLaneEnv(dataDir);
    const port = await freePort();
    const base = await startServer(port, env);
    console.log('isolated real-deal server up (temp MA_DATA_DIR, MA_MODE=real)');

    // first admin: generated one-time secret, rotated at first sign-in
    const adminBoot = randomSecret(20);
    state.secrets.push(adminBoot);
    const bs = spawnSync(process.execPath, ['scripts/bootstrap-admin.js'], {
      cwd: REPO_ROOT, env: Object.assign({}, env, { MA_BOOTSTRAP_PASSWORD: adminBoot }), encoding: 'utf8',
    });
    if (bs.status !== 0) throw new Error('bootstrap-admin failed: ' + redact(String(bs.stderr)).slice(0, 300));

    // handleSIG*: false — Playwright's own signal handlers call process.exit()
    // immediately, which would pre-empt OUR async cleanup (server child + temp
    // dir). Ours close the browser, stop the server, remove the temp dir, then exit.
    state.browser = await chromium.launch({
      headless: !args.headed, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    });
    const browser = state.browser;

    const needIl = entries.some((e) => e.as === 'il');
    const needAdmin = needIl || entries.some((e) => e.as === 'admin');
    const states = { anonymous: null };

    if (needAdmin) {
      const adminNow = 'Rot-' + randomSecret(20);
      state.secrets.push(adminNow);
      const adminCtx = await signInViaLoginPage(browser, base, 'admin', adminBoot, adminNow);
      states.admin = await adminCtx.storageState();

      if (needIl) {
        const created = await apiJson(adminCtx, 'POST', base + '/api/admin/users',
          { username: 'smoke.il', name: 'Smoke Integration Lead', role: 'hrbp' });
        if (created.status !== 201 || !created.json || !created.json.tempPassword) {
          throw new Error('Integration Lead account create failed: HTTP ' + created.status);
        }
        const ilTemp = created.json.tempPassword;
        state.secrets.push(ilTemp);
        const deal = await apiJson(adminCtx, 'POST', base + '/api/deals',
          { name: 'Smoke synthetic deal', targetCompany: 'Synthetic Smoke Target Co', members: ['smoke.il'] });
        if (deal.status !== 200 || !deal.json || !deal.json.deal || !deal.json.deal.id) {
          throw new Error('deal create failed: HTTP ' + deal.status);
        }
        const ilNow = 'Rot-' + randomSecret(20);
        state.secrets.push(ilNow);
        const ilCtx = await signInViaLoginPage(browser, base, 'smoke.il', ilTemp, ilNow);
        const sel = await apiJson(ilCtx, 'POST', base + '/api/deals/select', { dealId: deal.json.deal.id });
        if (sel.status !== 200) throw new Error('deal select failed for the Integration Lead: HTTP ' + sel.status);
        states.il = await ilCtx.storageState();
        await ilCtx.close();
      }
      await adminCtx.close();
    }

    for (const entry of entries) {
      for (const width of entry.widths) {
        rows.push(await measure(browser, base, entry, width, states[entry.as], axeSource, outDir));
      }
    }
  } catch (e) {
    console.error('smoke: harness failure: ' + redact(String(e && e.message ? e.message : e)).split('\n')[0]);
    exit = 1;
  } finally {
    await cleanup();
  }

  // --- isolation guard
  const dataAfter = hashCommittedData();
  const gitAfter = gitStatusGuarded();
  const dataSame = JSON.stringify(dataBefore) === JSON.stringify(dataAfter);
  const gitSame = gitBefore === gitAfter;
  if (!dataSame || !gitSame) {
    console.error('smoke: ISOLATION FAILURE - committed data/ changed during the run');
    exit = 1;
  }

  // --- report
  say('');
  say(formatTable(rows));
  say('');
  rows.forEach((r) => {
    r.pageErrors.forEach((m) => say(`  [${r.page}@${r.width}] ${m}`));
    r.failed.forEach((m) => say(`  [${r.page}@${r.width}] failed request: ${m}`));
    r.missing.forEach((m) => say(`  [${r.page}@${r.width}] missing landmark: ${m}`));
    r.notes.forEach((m) => say(`  [${r.page}@${r.width}] note: ${m}`));
    (r.violations || []).forEach((v) => say(`  [${r.page}@${r.width}] axe ${v.impact}: ${v.id} (${v.nodes} node${v.nodes === 1 ? '' : 's'})`));
  });
  const bad = rows.filter((r) => r.pageErrors.length || r.failed.length || r.missing.length);
  const axeTotal = rows.reduce((n, r) => n + (r.critical || 0) + (r.serious || 0), 0);
  say(`\n${rows.length} page x width visit(s); ${bad.length} with errors; axe critical+serious total ${axeTotal} (${args.failOnAxe ? 'gating' : 'informational'}).`);
  say(`isolation: committed data/*.db sha256 ${dataSame ? 'unchanged' : 'CHANGED'}; git status data/ + public/sent_emails/ ${gitSame ? 'unchanged' : 'CHANGED'}.`);
  if (rows.length === 0 && exit === 0) exit = 1;
  if (bad.length) exit = 1;
  if (args.failOnAxe && axeTotal > 0) exit = 1;
  return exit;
}

if (require.main === module) {
  const onSignal = (code) => () => { cleanup().then(() => process.exit(code), () => process.exit(code)); };
  process.once('SIGINT', onSignal(130));
  process.once('SIGTERM', onSignal(143));
  process.once('SIGHUP', onSignal(129));
  main().then((code) => process.exit(code), (e) => {
    console.error('smoke: unexpected failure: ' + redact(String(e && e.stack ? e.stack : e)).split('\n').slice(0, 4).join('\n'));
    cleanup().then(() => process.exit(1), () => process.exit(1));
  });
}

module.exports = { resolveTool, parseArgs, formatTable };
