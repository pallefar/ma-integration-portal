// R5-03 / GD-11 -> QUAL-01 / D-12-07 (Phase 12, plan 12-03): cache-bust guard.
//
// server.js serves /js and /css with `Cache-Control: public, max-age=2592000`
// (30 days), so a changed client asset only reaches a browser that already
// holds the old copy through a CHANGED `?v=` stamp on the URL that references
// it. Phases 8-11 changed client assets without bumping hand-maintained stamps
// (09-SECURITY UF-1, Phase 11 review WR-C05), which is why this file used to
// hold a FROZEN stamp table and a NEW_ASSETS list.
//
// Those tables are REPLACED by the content-hash invariant (D-12-07): the server
// rewrites every local /js|/css reference at serve time to
// `?v=<first 16 hex of sha256(the exact bytes served at that URL)>`, transitive
// through JS that references other stamped assets (lib/assetStamp.js). The hand
// stamps left in the source files are overwritten at serve time and are never
// trusted — they are now the negative control: with the rewrite removed, the
// invariant below FAILS.
//
// What is asserted, over the LIVE app (isolated MA_* temp block, listenLocal):
//   1. every public/*.html fetched by name, plus `/` and an extension-less SPA
//      path, is `no-cache` and carries on EVERY local js/css reference a stamp
//      equal to sha256(GET <that URL> body).slice(0,16);
//   2. transitions.js / account-menu.js are served with their JS-internal
//      references re-stamped (transitive) and stay on the 30-day cache header;
//   3. negative control: swapping the stamper for an identity stamper makes the
//      same checker report violations (so the guard cannot silently pass);
//   4. credential lockdown still serves login.html (rewritten) and still
//      refuses every non-allowlisted page (child process, real mode);
//   5. static: every page still references transitions.js and style.css (a
//      page that silently drops its asset must still fail), every stamped
//      reference in the sources names a file that exists, and public/ has no
//      stamped-reference cycle.
//
// node:test — run via `node --test test/asset-cache-bust.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { listenLocal } = require('./helpers/listen-local');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-asset-cache-bust-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const app = require('../server.js');

const sha16 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
const ASSET_CACHE = 'public, max-age=2592000';

let server;
let base;
test.before(async () => {
  server = await listenLocal(app);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

const PAGES = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html')).sort();

// Every `/js|/css/<file>?v=<stamp>` reference in a served HTML body.
function stampedRefs(html) {
  const out = [];
  const re = /(\/(?:js|css)\/[A-Za-z0-9_.\-]+\.(?:js|css))\?v=([A-Za-z0-9_.\-]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push({ url: m[1], stamp: m[2] });
  return out;
}
// Every local js/css reference in an HTML attribute, stamped or not.
function allAttrRefs(html) {
  const out = [];
  const re = /\b(?:src|href)\s*=\s*["'](\/(?:js|css)\/[^"'?#]+)(\?[^"']*)?["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push({ url: m[1], query: m[2] || '' });
  return out;
}

// The invariant, as a checker returning violations (so the negative control can
// reuse it): per page, no-cache + every reference stamped with hash(served body).
async function pageViolations(route) {
  const violations = [];
  const res = await fetch(base + route);
  if (res.status !== 200) return [`${route}: status ${res.status}`];
  if (res.headers.get('cache-control') !== 'no-cache') {
    violations.push(`${route}: Cache-Control is "${res.headers.get('cache-control')}", expected no-cache`);
  }
  const html = await res.text();
  const refs = allAttrRefs(html);
  const stamped = stampedRefs(html);
  for (const r of refs) {
    if (!/^\?v=[0-9a-f]{16}$/.test(r.query)) violations.push(`${route}: ${r.url}${r.query} is not stamped with a 16-hex content hash`);
  }
  const seen = new Map();
  for (const r of stamped) {
    const key = r.url + '?v=' + r.stamp;
    if (seen.has(key)) continue;
    const asset = await fetch(base + key);
    if (asset.status !== 200) { violations.push(`${route}: ${key} -> ${asset.status}`); seen.set(key, true); continue; }
    const body = Buffer.from(await asset.arrayBuffer());
    const expected = sha16(body);
    if (r.stamp !== expected) violations.push(`${route}: ${r.url} stamp ${r.stamp} != sha256(served body) ${expected}`);
    seen.set(key, true);
  }
  return violations;
}

test('every public/*.html is no-cache and every js/css reference carries sha256(served bytes)', async () => {
  assert.ok(PAGES.length >= 18, `expected the shipped pages under public/, found ${PAGES.length}`);
  for (const page of PAGES) {
    const v = await pageViolations('/' + page);
    assert.deepStrictEqual(v, [], `/${page}:\n  ` + v.join('\n  '));
  }
});

test('"/" and an extension-less SPA path (catch-all index.html) carry content-hash stamps too', async () => {
  for (const route of ['/', '/some/spa/route-that-is-not-a-file']) {
    const v = await pageViolations(route);
    assert.deepStrictEqual(v, [], `${route}:\n  ` + v.join('\n  '));
  }
  const root = await (await fetch(base + '/')).text();
  assert.ok(stampedRefs(root).length > 0 || allAttrRefs(root).length === 0, '"/" must be stamped when it references js/css');
});

// WR-B01 (12-REVIEW-B): a RAW request path (no client-side normalisation, as a
// script or a pass-through proxy would send it) must never reach express.static
// for an HTML page — it was served with the stale hand stamps before the fix.
function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = http.request({ host: u.hostname, port: u.port, method: 'GET', path: rawPath }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('WR-B01: non-canonical HTML spellings are refused (404), never served by express.static with hand stamps', async () => {
  const handStamp = /transitions\.js\?v=\d{10}\b/;
  assert.ok(handStamp.test(read('index.html')), 'precondition: the source carries a 10-digit hand stamp (the negative control)');
  const variants = [
    '/x/../index.html',
    '/vendor/../execution.html',
    '//index.html',
    '/./index.html',
    '/js/../index.html',
    '/x/..%2findex.html',
    '/%2e%2e/index.html',
    '/x/%2e%2e/index.html',
    '/index%2ehtml',
  ];
  for (const p of variants) {
    const r = await rawGet(p);
    assert.strictEqual(r.status, 404, `${p} -> ${r.status}`);
    assert.ok(!handStamp.test(r.body), `${p}: no hand-stamped page body`);
  }
  // The canonical spelling is still served, stamped with the content hash.
  const ok = await rawGet('/index.html');
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.headers['cache-control'], 'no-cache');
  assert.ok(!handStamp.test(ok.body), 'canonical page carries content-hash stamps only');
  assert.match(ok.body, /transitions\.js\?v=[0-9a-f]{16}/);
});

test('JS-internal references are rewritten (transitive) and assets stay on the 30-day cache header', async () => {
  const tr = await fetch(base + '/js/transitions.js');
  assert.strictEqual(tr.status, 200);
  assert.strictEqual(tr.headers.get('cache-control'), ASSET_CACHE);
  assert.match(tr.headers.get('content-type') || '', /javascript/);
  const trBody = await tr.text();

  const am = await fetch(base + '/js/account-menu.js');
  assert.strictEqual(am.status, 200);
  assert.strictEqual(am.headers.get('cache-control'), ASSET_CACHE);
  const amBuf = Buffer.from(await am.arrayBuffer());
  const amStamp = sha16(amBuf);
  assert.ok(trBody.includes(`/js/account-menu.js?v=${amStamp}`),
    `transitions.js must reference account-menu.js with the hash of the served account-menu.js (${amStamp})`);

  const css = await fetch(base + '/css/account.css');
  assert.strictEqual(css.status, 200);
  assert.strictEqual(css.headers.get('cache-control'), ASSET_CACHE);
  const cssStamp = sha16(Buffer.from(await css.arrayBuffer()));
  assert.ok(amBuf.toString('utf8').includes(`/css/account.css?v=${cssStamp}`),
    `account-menu.js must reference account.css with the hash of the served account.css (${cssStamp})`);

  // Transitive: the stamp transitions.js carries in HTML is the hash of ITS rewritten
  // bytes, which embed account-menu.js's stamp — so editing account-menu.js changes it.
  const html = await (await fetch(base + '/execution.html')).text();
  const trRef = stampedRefs(html).find((r) => r.url === '/js/transitions.js');
  assert.ok(trRef, 'execution.html references transitions.js');
  assert.strictEqual(trRef.stamp, sha16(Buffer.from(trBody, 'utf8')));

  // An asset with no stamped references still comes from express.static unchanged.
  const ex = await fetch(base + '/js/execution.js');
  assert.strictEqual(ex.status, 200);
  assert.strictEqual(ex.headers.get('cache-control'), ASSET_CACHE);
  assert.strictEqual(Buffer.compare(Buffer.from(await ex.arrayBuffer()), fs.readFileSync(path.join(PUBLIC, 'js', 'execution.js'))), 0);
});

test('HTML revalidates: ETag round-trip answers 304 and HEAD carries no body', async () => {
  const first = await fetch(base + '/execution.html');
  const etag = first.headers.get('etag');
  assert.ok(etag, 'HTML carries an ETag');
  await first.text();
  // node:http, not fetch: fetch adds `Cache-Control: no-cache` to a request that
  // carries If-None-Match, which (correctly) defeats Express's freshness check.
  const again = await new Promise((resolve, reject) => {
    const u = new URL(base + '/execution.html');
    http.get({ host: u.hostname, port: u.port, path: u.pathname, headers: { 'if-none-match': etag } },
      (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); }).on('error', reject);
  });
  assert.strictEqual(again, 304);
  const head = await fetch(base + '/execution.html', { method: 'HEAD' });
  assert.strictEqual(head.status, 200);
  assert.strictEqual(head.headers.get('cache-control'), 'no-cache');
  assert.strictEqual((await head.text()).length, 0);
});

test('negative control: with the rewrite removed the per-page invariant FAILS', async () => {
  const real = app.assetStamper;
  const original = { rewriteHtml: real.rewriteHtml, rewriteAsset: real.rewriteAsset };
  try {
    // Identity stamper = what the server would serve if the rewrite were removed:
    // the hand stamps in the source files go out untouched.
    real.rewriteHtml = (text) => text;
    real.rewriteAsset = () => null;
    let total = 0;
    const offenders = [];
    for (const page of PAGES) {
      const v = await pageViolations('/' + page);
      if (v.length) offenders.push(page);
      total += v.length;
    }
    assert.ok(total > 0, 'with the rewrite disabled at least one page MUST violate stamp == hash(served bytes)');
    assert.ok(offenders.length >= PAGES.length - 2,
      `with the rewrite disabled nearly every page should fail (got ${offenders.length}/${PAGES.length})`);
  } finally {
    real.rewriteHtml = original.rewriteHtml;
    real.rewriteAsset = original.rewriteAsset;
  }
  // Restored: the invariant holds again.
  assert.deepStrictEqual(await pageViolations('/execution.html'), []);
});

test('credential lockdown: login.html is served rewritten; every non-allowlisted page is still refused', () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'lockdown-'));
  const dataDir = path.join(dir, 'real-data');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  // The hand copy of the committed control.db (published demo passwords) —
  // read-only for us; the child boots against the copy.
  fs.copyFileSync(path.join(ROOT, 'data', 'control.db'), path.join(dataDir, 'control.db'));
  const env = Object.assign({}, process.env, {
    MA_MODE: 'real',
    MA_DATA_DIR: dataDir,
  });
  for (const k of Object.keys(env)) {
    if (/^MA_.*_PATH$/.test(k) || k === 'MA_DEALS_DIR') delete env[k];
  }
  for (const k of ['DEMO_OPEN', 'ADMIN_TOKEN', 'TRUST_PROXY', 'PUBLIC_BASE_URL', 'ENABLE_HSTS']) delete env[k];

  const script = `
    const crypto = require('crypto');
    const app = require('./server.js');
    const sha16 = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
    const srv = app.listen(0, '127.0.0.1');
    srv.once('listening', async () => {
      const base = 'http://127.0.0.1:' + srv.address().port;
      const out = { locked: app.isCredentialLockdownActive(), login: null, refused: {} };
      const res = await fetch(base + '/login.html');
      const html = await res.text();
      const refs = [];
      const re = /(?:src|href)="(\\/(?:js|css)\\/[A-Za-z0-9_.\\-]+\\.(?:js|css))\\?v=([0-9a-f]{16})"/g;
      let m;
      while ((m = re.exec(html)) !== null) refs.push({ url: m[1], stamp: m[2] });
      const checks = [];
      for (const r of refs) {
        const a = await fetch(base + r.url + '?v=' + r.stamp);
        checks.push({ url: r.url, status: a.status, ok: r.stamp === sha16(Buffer.from(await a.arrayBuffer())) });
      }
      out.login = { status: res.status, cache: res.headers.get('cache-control'), refs: refs.length, checks };
      for (const p of ['/execution.html', '/dashboard.html', '/admin.html', '/', '/js/transitions.js', '/some/spa/route']) {
        out.refused[p] = (await fetch(base + p)).status;
      }
      console.log('RESULT=' + JSON.stringify(out));
      process.exit(0);
    });
  `;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: ROOT, env, encoding: 'utf8', timeout: 90000 });
  assert.strictEqual(result.status, 0, result.stderr);
  const line = result.stdout.split('\n').find((l) => l.startsWith('RESULT='));
  assert.ok(line, 'child printed a result: ' + result.stdout + result.stderr);
  const out = JSON.parse(line.slice('RESULT='.length));
  assert.strictEqual(out.locked, true, 'the hand-copied control.db must trigger the lockdown');
  assert.strictEqual(out.login.status, 200);
  assert.strictEqual(out.login.cache, 'no-cache');
  assert.ok(out.login.refs >= 2, 'login.html carries stamped js/css references');
  for (const c of out.login.checks) {
    assert.strictEqual(c.status, 200, `${c.url} stays reachable during lockdown`);
    assert.strictEqual(c.ok, true, `${c.url}: login.html stamp must equal the hash of the served bytes`);
  }
  for (const p of Object.keys(out.refused)) {
    assert.strictEqual(out.refused[p], 403, `${p} must still be refused during lockdown`);
  }
});

// --- static source checks (files only) ------------------------------------------

function read(rel) { return fs.readFileSync(path.join(PUBLIC, rel), 'utf8'); }

// Pages that legitimately do not load transitions.js (standalone surfaces).
const NO_TRANSITIONS = new Set(['login.html', 'change-password.html', 'signage.html']);

test('every page still references style.css and (except standalone pages) transitions.js', () => {
  const missing = [];
  for (const page of PAGES) {
    const html = read(page);
    if (!/\/css\/style\.css/.test(html)) missing.push(`${page}: style.css`);
    if (!NO_TRANSITIONS.has(page) && !/\/js\/transitions\.js/.test(html)) missing.push(`${page}: transitions.js`);
  }
  assert.deepStrictEqual(missing, [], 'pages that dropped a core asset: ' + missing.join(', '));
});

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((ent) => {
    if (ent.isDirectory()) {
      if (ent.name === 'vendor' || ent.name === 'node_modules') return;
      walk(path.join(dir, ent.name), out);
    } else if (ent.isFile()) out.push(path.join(dir, ent.name));
  });
  return out;
}

test('every stamped local reference in the sources names an existing file; public/ has no reference cycle', () => {
  const files = walk(PUBLIC, []).filter((f) => /\.(html|js|css)$/.test(f) &&
    (f.endsWith('.html') || /^(js|css)$/.test(path.relative(PUBLIC, f).split(path.sep)[0])));
  const re = /(?<![A-Za-z0-9_.:\/\-])(\/(?:js|css)\/[A-Za-z0-9_.\-]+\.(?:js|css))\?v=[A-Za-z0-9_.\-]+/g;
  const graph = new Map();
  const dangling = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const rel = '/' + path.relative(PUBLIC, f).split(path.sep).join('/');
    const deps = new Set();
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      deps.add(m[1]);
      if (!fs.existsSync(path.join(PUBLIC, m[1]))) dangling.push(`${rel} -> ${m[1]}`);
    }
    graph.set(rel, deps);
  }
  assert.deepStrictEqual(dangling, [], 'stamped references to missing files (they would silently keep a stale hand stamp)');

  const state = new Map(); // 1 = on stack, 2 = done
  const cycles = [];
  const visit = (node, trail) => {
    if (state.get(node) === 2) return;
    if (state.get(node) === 1) { cycles.push(trail.concat(node).join(' -> ')); return; }
    state.set(node, 1);
    for (const d of graph.get(node) || []) visit(d, trail.concat(node));
    state.set(node, 2);
  };
  for (const n of graph.keys()) visit(n, []);
  assert.deepStrictEqual(cycles, [], 'stamped-reference cycle in public/ (the stamper hashes a back-edge on raw bytes)');
});
