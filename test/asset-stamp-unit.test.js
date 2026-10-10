// QUAL-01 / D-12-07 (Phase 12, plan 12-03): unit + one live case for
// lib/assetStamp.js — the serve-time content-hash cache-bust stamper.
//
// Unit cases run against a temporary public/ directory (never the real one):
//   - stamp == first 16 hex of sha256(served bytes); an edit changes it; an
//     unchanged file is not re-read (mtime+size cache, T-12-23)
//   - JS that references stamped assets is rewritten, and its own stamp hashes
//     the REWRITTEN bytes (transitive); a reference cycle terminates
//   - rewriteHtml: attributes + inline text; vendor / external / missing /
//     non-js-css references are left alone
//   - traversal: no request path can read outside public/ (T-12-21)
// The live case boots the real app on an isolated MA_* temp block and proves
// GET /execution.html carries, on every js/css reference, a stamp equal to the
// hash of the bytes GET <that URL> actually returns.
//
// node:test — run via `node --test test/asset-stamp-unit.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { listenLocal } = require('./helpers/listen-local');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-asset-stamp-unit-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const { createAssetStamper } = require('../lib/assetStamp');
const app = require('../server.js');

const sha16 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

// A fresh temp public dir per case so caches and mtimes never leak between them.
function makePublic(files) {
  const dir = fs.mkdtempSync(path.join(TMP, 'pub-'));
  for (const rel of Object.keys(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, files[rel]);
  }
  return dir;
}
function bump(file, content) {
  fs.writeFileSync(file, content);
  // Force a distinct mtime even on a coarse-granularity filesystem.
  const t = new Date(Date.now() + 5000 + Math.floor(Math.random() * 1000));
  fs.utimesSync(file, t, t);
}

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('stampFor == first 16 hex of sha256(served bytes); an edit changes it', () => {
  const dir = makePublic({ 'js/a.js': 'console.log("a1");\n' });
  const s = createAssetStamper({ publicDir: dir });
  const first = s.stampFor('/js/a.js');
  assert.match(first, /^[0-9a-f]{16}$/);
  assert.strictEqual(first, sha16(Buffer.from('console.log("a1");\n')));
  bump(path.join(dir, 'js/a.js'), 'console.log("a2-changed");\n');
  const second = s.stampFor('/js/a.js');
  assert.strictEqual(second, sha16(Buffer.from('console.log("a2-changed");\n')));
  assert.notStrictEqual(second, first);
});

test('an unchanged file is not re-read (mtime+size cache hit)', () => {
  const dir = makePublic({ 'js/a.js': 'var a = 1;\n', 'js/b.js': 'x("/js/a.js?v=old");\n' });
  const s = createAssetStamper({ publicDir: dir });
  s.stampFor('/js/b.js');
  const afterFirst = s.stats();
  assert.strictEqual(afterFirst.reads, 2, 'b.js + its dependency a.js are each read once');
  for (let i = 0; i < 10; i++) { s.stampFor('/js/b.js'); s.stampFor('/js/a.js'); s.rewriteAsset('/js/b.js'); }
  const after = s.stats();
  assert.strictEqual(after.reads, afterFirst.reads, 'no further file reads for unchanged files');
  assert.ok(after.hits > afterFirst.hits, 'cache hits are counted');
});

test('JS referencing a stamped asset is served with the dependency stamp; its own stamp hashes the rewritten bytes (transitive)', () => {
  const dir = makePublic({
    'js/b.js': 'var b = 1;\n',
    'js/a.js': "load('/js/b.js?v=old');\nload('/js/missing.js?v=7');\nload('/vendor/x.js?v=3');\nlet u = '/js/b.js?v=' + n;\n",
    'css/c.css': 'body{}\n',
  });
  const warnings = [];
  const s = createAssetStamper({ publicDir: dir, warn: (m) => warnings.push(m) });
  const bStamp = s.stampFor('/js/b.js');
  const out = s.rewriteAsset('/js/a.js');
  assert.strictEqual(out.rewritten, true);
  const text = out.body.toString('utf8');
  assert.ok(text.includes(`'/js/b.js?v=${bStamp}'`), text);
  assert.ok(text.includes("'/js/missing.js?v=7'"), 'missing file left untouched');
  assert.ok(text.includes("'/vendor/x.js?v=3'"), 'vendor reference untouched');
  assert.ok(text.includes("'/js/b.js?v=' + n"), 'a dynamic (empty) stamp is never rewritten');
  assert.strictEqual(s.stampFor('/js/a.js'), sha16(out.body), "a.js's stamp hashes its REWRITTEN bytes");
  assert.strictEqual(warnings.length, 1, 'one warning for the missing reference');
  s.rewriteAsset('/js/a.js');
  assert.strictEqual(warnings.length, 1, 'the warning is emitted once');

  // Transitive: a change to b.js changes a.js's stamp with no edit to a.js.
  const aBefore = s.stampFor('/js/a.js');
  bump(path.join(dir, 'js/b.js'), 'var b = 2; // changed\n');
  assert.notStrictEqual(s.stampFor('/js/b.js'), bStamp);
  assert.notStrictEqual(s.stampFor('/js/a.js'), aBefore);
  assert.ok(s.rewriteAsset('/js/a.js').body.toString('utf8').includes(`/js/b.js?v=${s.stampFor('/js/b.js')}`));

  // A file with no stamped references is served as its raw bytes, not "rewritten".
  const plain = s.rewriteAsset('/css/c.css');
  assert.strictEqual(plain.rewritten, false);
  assert.strictEqual(plain.body.toString('utf8'), 'body{}\n');
});

test('a reference cycle a -> b -> a terminates without throwing', () => {
  const dir = makePublic({
    'js/a.js': "go('/js/b.js?v=1');\n",
    'js/b.js': "go('/js/a.js?v=1');\n",
    'js/self.js': "go('/js/self.js?v=1');\n",
  });
  const s = createAssetStamper({ publicDir: dir });
  assert.match(s.stampFor('/js/a.js'), /^[0-9a-f]{16}$/);
  assert.match(s.stampFor('/js/b.js'), /^[0-9a-f]{16}$/);
  assert.match(s.stampFor('/js/self.js'), /^[0-9a-f]{16}$/);
  // Deterministic across repeated calls (a cyclic result is never cached stale).
  assert.strictEqual(s.stampFor('/js/a.js'), s.stampFor('/js/a.js'));
});

test('rewriteHtml: attributes get a stamp added/replaced; inline stamped refs re-stamped; others left alone', () => {
  const dir = makePublic({
    'js/t.js': 'var t = 1;\n',
    'css/s.css': 'a{}\n',
    'js/b.js': 'var b;\n',
    'js/a.js': "load('/js/b.js?v=old');\n",
  });
  const warnings = [];
  const s = createAssetStamper({ publicDir: dir, warn: (m) => warnings.push(m) });
  const t = s.stampFor('/js/t.js');
  const c = s.stampFor('/css/s.css');
  const a = s.stampFor('/js/a.js');
  const html = [
    '<link rel="stylesheet" href="/css/s.css?v=999">',
    '<link rel="stylesheet" href=\'/css/s.css\'>',
    '<script src="/js/t.js"></script>',
    '<script src="/js/a.js?v=1"></script>',
    '<script>var u = "/js/t.js?v=oldinline";</script>',
    '<script src="/vendor/transformers/x.js?v=3"></script>',
    '<script src="https://cdn.example.com/js/t.js"></script>',
    '<script src="/js/missing.js?v=2"></script>',
    '<img src="/images/logo.png?v=4">',
    '<script src="/js/t.js?other=1"></script>',
  ].join('\n');
  const out = s.rewriteHtml(html);
  assert.ok(out.includes(`href="/css/s.css?v=${c}"`), out);
  assert.ok(out.includes(`href='/css/s.css?v=${c}'`), out);
  assert.ok(out.includes(`<script src="/js/t.js?v=${t}">`), out);
  assert.ok(out.includes(`<script src="/js/a.js?v=${a}">`), out);
  assert.ok(out.includes(`"/js/t.js?v=${t}";`), 'inline stamped reference re-stamped');
  assert.ok(out.includes('src="/vendor/transformers/x.js?v=3"'));
  assert.ok(out.includes('src="https://cdn.example.com/js/t.js"'));
  assert.ok(out.includes('src="/js/missing.js?v=2"'));
  assert.ok(out.includes('src="/images/logo.png?v=4"'));
  assert.ok(out.includes('src="/js/t.js?other=1"'), 'a non-?v= query string is left alone');
  assert.strictEqual(warnings.filter((w) => w.includes('/js/missing.js')).length, 1);
  // a.js's stamp in the HTML is the transitive one (hash of the rewritten bytes).
  assert.strictEqual(a, sha16(s.rewriteAsset('/js/a.js').body));
});

test('traversal: no request path can read outside public/ (T-12-21)', () => {
  const dir = makePublic({ 'js/ok.js': 'ok\n' });
  fs.writeFileSync(path.join(path.dirname(dir), 'secret.js'), 'SECRET\n');
  const s = createAssetStamper({ publicDir: dir });
  assert.match(s.stampFor('/js/ok.js'), /^[0-9a-f]{16}$/);
  for (const bad of [
    '/js/../../secret.js',
    '/js/../secret.js',
    '/js/..%2f..%2fsecret.js',
    '/js/%2e%2e/secret.js',
    '/js/..\\..\\secret.js',
    '../secret.js',
    '/secret.js',
    path.join(path.dirname(dir), 'secret.js'),
    '/js/ok.js\0.png',
    '/js/./ok.js',
    '/vendor/transformers/x.js',
    '',
    null,
    undefined,
    42,
  ]) {
    assert.strictEqual(s.stampFor(bad), null, `stampFor(${JSON.stringify(bad)}) must be null`);
    assert.strictEqual(s.rewriteAsset(bad), null, `rewriteAsset(${JSON.stringify(bad)}) must be null`);
    assert.strictEqual(s.fileFor(bad), null);
  }
  // An HTML reference that tries to climb out is simply left untouched.
  const html = '<script src="/js/../../secret.js"></script>';
  assert.strictEqual(s.rewriteHtml(html), html);
});

// --- live: the real app, isolated MA_* temp block -----------------------------

test('live: GET /execution.html carries, on every js/css reference, the hash of the bytes served at that URL', async () => {
  const server = await listenLocal(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(base + '/execution.html');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('cache-control'), 'no-cache');
    assert.match(res.headers.get('content-type'), /^text\/html/);
    const html = await res.text();
    const refs = [];
    const re = /(?:src|href)="(\/(?:js|css)\/[A-Za-z0-9_.\-]+\.(?:js|css))\?v=([0-9a-f]{16})"/g;
    let m;
    while ((m = re.exec(html)) !== null) refs.push({ url: m[1], stamp: m[2] });
    assert.ok(refs.length >= 3, `expected execution.html to carry stamped js/css references, got ${refs.length}`);
    for (const r of refs) {
      const asset = await fetch(base + r.url + '?v=' + r.stamp);
      assert.strictEqual(asset.status, 200, r.url);
      const body = Buffer.from(await asset.arrayBuffer());
      assert.strictEqual(r.stamp, sha16(body), `${r.url}: stamp must equal the hash of the served bytes`);
    }
    // Every local js/css reference in the page is stamped (no bare reference survives).
    assert.ok(!/(?:src|href)="\/(?:js|css)\/[^"?]+"/.test(html), 'no unstamped js/css reference');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
