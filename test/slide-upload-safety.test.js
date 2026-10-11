// SAFE-03 / D-13-04 (Phase 13, plan 13-03): uploaded slides are untrusted markup.
// This suite proves, through the REAL routes of the requireable app:
//   Task 1 (tracer): an uploaded HTML slide is served from the dedicated
//     /uploads/slides mount with the sandbox CSP + nosniff and no
//     Report-Only header — in a temp upload directory AND in the DEFAULT
//     directory (MA_SLIDES_UPLOAD_DIR unset);
//   Task 2: the type allowlist, the 10 MB limit and the library quota, with
//     fixed refusal bodies and side-effect-free refusals;
//   CR-A01 (13-REVIEW): the DEFAULT directory is <instance data dir>/slides —
//     OUTSIDE public/ (data/slides in dev/demo, <MA_DATA_DIR>/slides in real
//     mode); legacy public/uploads/slides files are moved out once at boot; the
//     Windows-only path spellings (`%5C`, trailing-period segment, NTFS `::$DATA`
//     stream, `~1` short name) are 404 at the first middleware AND at the mount's
//     file-name allowlist, each layer proven on its own.
//
// Isolation: every MA_* path is a throwaway directory and MA_SLIDES_UPLOAD_DIR
// is a temp directory, except the default-directory case (d), which boots a
// child with MA_SLIDES_UPLOAD_DIR unset: its upload lands in THIS checkout's
// data/slides (gitignored) and its legacy probe in public/uploads/slides
// (gitignored); both are deleted in `finally`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { listenLocal } = require('./helpers/listen-local');
const { cleanEnv, isolatedPaths, REPO } = require('./helpers/boot-probe');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-slide-upload-safety-'));
const SLIDES_TMP = path.join(TMP_DIR, 'slides');
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.MA_SLIDES_UPLOAD_DIR = SLIDES_TMP;
process.env.MA_SLIDE_QUOTA_MB = '1';
process.env.ADMIN_TOKEN = '';
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN']) delete process.env[key];

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { ensureUser } = require('./helpers/seed-identity.js');
const slideUpload = require('../lib/slideUpload.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

const EXACT_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; media-src data:; connect-src 'none'; form-action 'none'";

function adminToken(username) {
  ensureUser(controlConn, { username, role: 'admin' });
  return sessionsDb.createSession(runtimeConn, { username, role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });
}
const cookie = (token) => `ma_session=${token}`;

async function upload(base, token, body) {
  const res = await fetch(`${base}/api/slides/upload`, {
    method: 'POST',
    headers: { Cookie: cookie(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** GET with the path sent verbatim (fetch/URL would normalise dot segments). */
function rawGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function listing(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).sort(); } catch (e) { return []; }
  return names.map((n) => `${n}:${fs.statSync(path.join(dir, n)).size}`);
}

function clearDir(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return; }
  for (const n of names) fs.rmSync(path.join(dir, n), { force: true });
}

const withServer = async (fn) => {
  const server = await listenLocal(app);
  try { return await fn(`http://127.0.0.1:${server.address().port}`, server.address().port); } finally { server.close(); }
};

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

// ============================================================ Task 1 (tracer) ===
test('slide-upload-safety (a): an uploaded HTML slide is served with the exact sandbox CSP, nosniff and no Report-Only header', async () => {
  const token = adminToken('slide-admin-a');
  await withServer(async (base) => {
    const html = '<!doctype html><title>probe</title><script>document.title="x"</script>';
    const up = await upload(base, token, { filename: 'probe.html', content: html });
    assert.strictEqual(up.status, 200, JSON.stringify(up.body));
    assert.match(up.body.url, /^\/uploads\/slides\/\d+_[0-9a-f]{6}_probe\.html$/);
    assert.ok(fs.existsSync(path.join(SLIDES_TMP, path.basename(up.body.url))), 'the file is written into MA_SLIDES_UPLOAD_DIR');

    const res = await fetch(base + up.body.url);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-security-policy'), EXACT_CSP);
    assert.strictEqual(res.headers.get('content-security-policy'), slideUpload.SLIDE_SANDBOX_CSP);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('content-security-policy-report-only'), null);
    assert.match(res.headers.get('content-type') || '', /^text\/html/);
    assert.strictEqual(await res.text(), html, 'slide bytes are served untouched (never stamp-rewritten)');
  });
});

test('slide-upload-safety (b): traversal, dotfiles, non-allowlisted files, directories and encoded spellings of the prefix are 404; case variants are the same sandboxed response', async () => {
  const token = adminToken('slide-admin-b');
  await withServer(async (base, port) => {
    const up = await upload(base, token, { filename: 'real.html', content: '<p>real</p>' });
    assert.strictEqual(up.status, 200);
    const name = path.basename(up.body.url);
    fs.writeFileSync(path.join(SLIDES_TMP, 'x.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    fs.writeFileSync(path.join(SLIDES_TMP, '.hidden.html'), '<p>hidden</p>');
    fs.writeFileSync(path.join(SLIDES_TMP, 'noext'), 'plain');
    try {
      const notFound = [
        '/uploads/slides/../../server.js',
        '/uploads/slides/%2e%2e/%2e%2e/server.js',
        '/uploads/slides/..%2f..%2fserver.js',
        '/uploads/slides/.hidden.html',
        '/uploads/slides/x.svg',
        '/uploads/slides/noext',
        '/uploads/slides/',
        '/uploads/slides',
        '/uploads/slides/missing.html',
        `/%75ploads/slides/${name}`,
        `/uploads/%73lides/${name}`,
        `//uploads/slides/${name}`,
        `/./uploads/slides/${name}`,
      ];
      for (const p of notFound) {
        const r = await rawGet(port, p);
        assert.strictEqual(r.status, 404, `${p} must be 404, got ${r.status}`);
        assert.ok(!/real/.test(r.body.toString('utf8')), `${p} must not leak the slide`);
      }
      for (const p of [`/UPLOADS/Slides/${name}`, `/Uploads/SLIDES/${name}`]) {
        const r = await rawGet(port, p);
        assert.ok(r.status === 200 || r.status === 404, `${p}: ${r.status}`);
        if (r.status === 200) {
          assert.strictEqual(r.headers['content-security-policy'], EXACT_CSP, `${p} must never carry the app CSP`);
          assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
        }
      }
    } finally {
      for (const f of ['x.svg', '.hidden.html', 'noext']) fs.rmSync(path.join(SLIDES_TMP, f), { force: true });
    }
  });
});

test('slide-upload-safety (c): structural — the /uploads/slides mount precedes the terminal `.html` middleware, which passes the prefix through', () => {
  const src = stripComments(fs.readFileSync(path.join(REPO, 'server.js'), 'utf8'));
  const mount = src.indexOf("app.use('/uploads/slides', express.static(");
  const verdictCall = src.indexOf('htmlRequestVerdict(req.path)');
  assert.ok(mount > 0, 'the dedicated static mount exists');
  assert.ok(verdictCall > 0, 'the terminal `.html` middleware exists');
  assert.ok(mount < verdictCall, 'the slides mount must be registered BEFORE the terminal `.html` middleware (B-1)');
  const mwStart = src.lastIndexOf('app.use((req, res, next) => {', verdictCall);
  const mwBody = src.slice(mwStart, verdictCall);
  assert.ok(/SLIDE_URL_PREFIX_RE\.test\(req\.path\)\)\s*return next\(\)/.test(mwBody), 'the middleware passes /uploads/slides/ through first');
  assert.ok(src.includes('SLIDE_URL_PREFIX_RE = /^\\/uploads\\/slides(?:\\/|$)/i'), 'the pass-through prefix test is case-insensitive');
  assert.ok(/app\.use\('\/uploads\/slides', slideNotFound\)/.test(src) && src.indexOf("app.use('/uploads/slides', slideNotFound)") < verdictCall,
    'the mount is terminal for its prefix (trailing 404 handler before the terminal middleware)');
  const setHeaders = src.slice(mount, src.indexOf("app.use('/uploads/slides', slideNotFound)"));
  assert.ok(/removeHeader\('Content-Security-Policy-Report-Only'\)/.test(setHeaders), 'a Report-Only header is removed on slide responses');
  assert.ok(/'X-Content-Type-Options', 'nosniff'/.test(setHeaders), 'nosniff on slide responses');
  assert.ok(/dotfiles: 'deny'/.test(setHeaders) && /index: false/.test(setHeaders));
  // CR-A01 (c)/(d): the mount serves only allowlisted names, and the Windows-spelling
  // guard is the FIRST middleware of the app (before every route, static handler and gate).
  assert.ok(/slideUpload\.mountFileName\(req\.path\)/.test(src.slice(src.indexOf("app.use('/uploads/slides', (req"), mount)),
    'the mount checks the strict file-name allowlist before express.static');
  // (raw source here: stripComments() is a naive scanner that a `/*` inside a regex literal can derail)
  const raw = fs.readFileSync(path.join(REPO, 'server.js'), 'utf8');
  const firstUse = raw.search(/^app\.use\(/m);
  assert.ok(firstUse > 0 && /^app\.use\(\(req, res, next\) => \{\s*if \(!windowsAmbiguousPath\(req\.path\)\) return next\(\);/.test(raw.slice(firstUse)),
    'the first app.use() is the windowsAmbiguousPath guard');
});

// ---- the DEFAULT-directory case (CR-A01: outside public/; B-1 still pinned) --
const DEFAULT_CHILD = `
  const app = require('./server.js');
  const slideUpload = require('./lib/slideUpload.js');
  const server = app.listen(0, '127.0.0.1', async () => {
    const base = 'http://127.0.0.1:' + server.address().port;
    const out = { slidesDir: slideUpload.slidesDir() };
    const pick = async (label, res) => {
      out[label] = { status: res.status, csp: res.headers.get('content-security-policy'),
        nosniff: res.headers.get('x-content-type-options'), reportOnly: res.headers.get('content-security-policy-report-only'),
        type: res.headers.get('content-type'), body: (await res.text()).slice(0, 400) };
    };
    try {
      const up = await fetch(base + '/api/slides/upload', { method: 'POST',
        headers: { cookie: process.env.GSD_COOKIE, 'content-type': 'application/json' },
        body: JSON.stringify({ filename: 'probe-default.html', content: '<p id="probe-default">hi</p>' }) });
      out.upload = { status: up.status, body: await up.json() };
      const url = out.upload.body.url;
      await pick('plain', await fetch(base + url));
      await pick('upper', await fetch(base + url.replace('/uploads/slides/', '/UPLOADS/Slides/')));
      await pick('encoded', await fetch(base + url.replace('/uploads/', '/%75ploads/')));
      await pick('legacy', await fetch(base + '/uploads/slides/' + process.env.GSD_LEGACY_NAME));
    } catch (e) { out.error = String(e && e.message); }
    process.stdout.write('\\nDEFAULT_RESULT ' + JSON.stringify(out) + '\\n');
    server.close();
    process.exit(0);
  });
`;

test('slide-upload-safety (d): DEFAULT directory (MA_SLIDES_UPLOAD_DIR unset) — slides land in <data dir>/slides OUTSIDE public/, a legacy public/uploads/slides file is moved out at boot, and both are served with the sandbox CSP (CR-A01, B-1)', async () => {
  const token = adminToken('slide-admin-d');
  const defaultDir = path.join(REPO, 'data', 'slides');
  const legacyDir = path.join(REPO, 'public', 'uploads', 'slides');
  const uploadsDir = path.join(REPO, 'public', 'uploads');
  const hadDefaultDir = fs.existsSync(defaultDir);
  const hadLegacyDir = fs.existsSync(legacyDir);
  const hadUploadsDir = fs.existsSync(uploadsDir);
  const legacyName = `${Date.now()}_c0ffee_legacy-probe.html`;
  const legacyBody = '<p id="legacy-probe">legacy</p>';
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, legacyName), legacyBody);
  let uploadedFile = null;
  try {
    const env = cleanEnv({ ...isolatedPaths(TMP_DIR), GSD_COOKIE: cookie(token), GSD_LEGACY_NAME: legacyName });
    assert.strictEqual(env.MA_SLIDES_UPLOAD_DIR, undefined, 'the child must run with MA_SLIDES_UPLOAD_DIR unset');
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', DEFAULT_CHILD], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`child timed out\n${stdout}\n${stderr}`)); }, 90000);
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', () => {
        clearTimeout(timer);
        const m = /DEFAULT_RESULT (.*)\n/.exec(stdout);
        if (!m) return reject(new Error(`no result\n${stdout}\n${stderr}`));
        const r = JSON.parse(m[1]);
        r.stdout = stdout;
        resolve(r);
      });
    });
    assert.strictEqual(result.error, undefined, result.error);
    assert.strictEqual(path.resolve(result.slidesDir), path.resolve(defaultDir), 'the default slide directory is <repo>/data/slides in dev mode');
    const rel = path.relative(path.join(REPO, 'public'), result.slidesDir);
    assert.ok(rel.startsWith('..') || path.isAbsolute(rel), 'the default slide directory is OUTSIDE the public static root');
    assert.strictEqual(result.upload.status, 200, JSON.stringify(result.upload));
    uploadedFile = path.join(defaultDir, path.basename(result.upload.body.url));
    assert.ok(fs.existsSync(uploadedFile), 'the file landed in the default data/slides directory');
    assert.ok(!fs.existsSync(path.join(legacyDir, path.basename(result.upload.body.url))), 'nothing is written under public/');

    assert.strictEqual(result.plain.status, 200);
    assert.strictEqual(result.plain.csp, EXACT_CSP, 'default-directory slide must carry the sandbox CSP, not the app CSP');
    assert.strictEqual(result.plain.nosniff, 'nosniff');
    assert.strictEqual(result.plain.reportOnly, null);
    assert.match(result.plain.type, /^text\/html/);
    assert.ok(result.plain.body.includes('probe-default'));
    // Case variant: the same sandboxed response or 404 — never the app CSP.
    assert.ok(result.upper.status === 200 || result.upper.status === 404, `upper: ${result.upper.status}`);
    if (result.upper.status === 200) assert.strictEqual(result.upper.csp, EXACT_CSP);
    // Percent-encoded spelling of the prefix: refused, never answered by sendHtml/express.static.
    assert.strictEqual(result.encoded.status, 404);

    // CR-A01 (b): the legacy file was moved (not copied) and its old URL still works, sandboxed.
    assert.ok(!fs.existsSync(path.join(legacyDir, legacyName)), 'the legacy file is gone from public/uploads/slides');
    assert.strictEqual(fs.readFileSync(path.join(defaultDir, legacyName), 'utf8'), legacyBody, 'the legacy file now lives in data/slides');
    assert.strictEqual(result.legacy.status, 200, 'the legacy record URL keeps working');
    assert.strictEqual(result.legacy.csp, EXACT_CSP);
    assert.ok(result.legacy.body.includes('legacy-probe'));
    assert.match(result.stdout, /\[slides\] legacy slide move: \d+ file\(s\) moved/, 'the boot logs a count');
    assert.ok(!result.stdout.includes(legacyName), 'the boot log never names a slide file');
  } finally {
    for (const f of [uploadedFile, path.join(defaultDir, legacyName), path.join(legacyDir, legacyName)]) {
      if (f) fs.rmSync(f, { force: true });
    }
    if (!hadDefaultDir) { try { fs.rmdirSync(defaultDir); } catch (e) { /* not empty or absent */ } }
    if (!hadLegacyDir) { try { fs.rmdirSync(legacyDir); } catch (e) { /* not empty or absent */ } }
    if (!hadUploadsDir) { try { fs.rmdirSync(uploadsDir); } catch (e) { /* not empty or absent */ } }
  }
});

// ---- CR-A01: Windows path spellings (platform-independent proof) -------------
// The review's spellings, plus an NTFS stream and 8.3 short names. Each is first
// shown to be DANGEROUS under Win32 resolution (simulated with path.win32 plus
// the documented Win32 rule that trims trailing periods/spaces from every path
// component and resolves `::$DATA` to the file's default stream), then shown to
// be refused by each layer ON ITS OWN — the first middleware
// (requestPath.windowsAmbiguousPath) and the mount's file-name allowlist
// (slideUpload.mountFileName) — and finally end-to-end over HTTP.
const { windowsAmbiguousPath } = require('../lib/requestPath.js');
const WIN_SPELLINGS = [
  { url: '/uploads/slides%5Cx.htm', file: 'x.htm' },
  { url: '/uploads%5Cslides%5Cx.htm', file: 'x.htm' },
  { url: '/uploads./slides/x.html', file: 'x.html' },
  { url: '/uploads/slides./x.html', file: 'x.html' },
  { url: '/uploads/slides/x.htm::$DATA', file: 'x.htm', mount: '/x.htm::$DATA' },
  { url: '/uploads/slides/X~1.HTM', file: 'x.htm', shortName: true, mount: '/X~1.HTM' },
  { url: '/UPLOAD~1/slides/x.htm', file: 'x.htm', shortName: true },
  { url: '/uploads/slides/x.html.', file: 'x.html', mount: '/x.html.' },
  { url: '/uploads/slides/x.html%20', file: 'x.html', mount: '/x.html%20' },
];

/** What `send` + the Win32 file system resolve a request path to (8.3 names are filesystem-dependent and not simulated). */
function win32Resolve(root, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const joined = path.win32.join(root, path.win32.normalize('.' + path.win32.sep + decoded));
  return joined.split('\\').map((seg, i) => (i === 0 ? seg : seg.replace(/::\$DATA$/i, '').replace(/[. ]+$/, ''))).join('\\');
}

test('slide-upload-safety (i): CR-A01 — each Windows spelling resolves to the slide under Win32, and is refused by the first middleware AND by the mount allowlist independently', () => {
  const root = 'C:\\portal\\public';
  for (const s of WIN_SPELLINGS) {
    if (!s.shortName) {
      assert.strictEqual(win32Resolve(root, s.url).toLowerCase(), `${root}\\uploads\\slides\\${s.file}`.toLowerCase(),
        `${s.url}: under Win32 this spelling names the legacy slide file (the threat is real)`);
    }
    assert.strictEqual(windowsAmbiguousPath(s.url), true, `${s.url}: the first middleware refuses it`);
    if (s.mount) assert.strictEqual(slideUpload.mountFileName(s.mount), null, `${s.mount}: the mount allowlist refuses it on its own`);
  }
  // The mount allowlist on its own, for the separator/encoding spellings that reach it as one segment.
  for (const m of ['/x%5Cy.htm', '/a\\b.htm', '/sub/x.html', '/.hidden.html', '/x.svg', '/x.html.tmp', '/', '', `/${'a'.repeat(196)}.html`]) {
    assert.strictEqual(slideUpload.mountFileName(m), null, `${JSON.stringify(m)}: refused by the mount allowlist`);
  }
  assert.strictEqual(slideUpload.mountFileName('/1712345678901_ab12cd_deck.html'), '1712345678901_ab12cd_deck.html');
  assert.strictEqual(slideUpload.mountFileName(`/${'a'.repeat(195)}.html`), `${'a'.repeat(195)}.html`, '200 chars is the inclusive bound');
  // Canonical paths and the exact dot-segment / undecodable spellings keep their existing handling.
  for (const ok of ['/', '/index.html', '/js/app.js', '/uploads/slides/1_ab_x.html', '/api/pages/a:b~c', '/x/../y', '/./x', '/%zz']) {
    assert.strictEqual(windowsAmbiguousPath(ok), false, `${ok}: not refused by the first middleware`);
  }
});

test('slide-upload-safety (j): CR-A01 — over HTTP every Windows spelling is a 404 that never carries slide bytes (first middleware + mount)', async () => {
  fs.mkdirSync(SLIDES_TMP, { recursive: true });
  fs.writeFileSync(path.join(SLIDES_TMP, 'x.htm'), '<p>WINPROBE</p>');
  fs.writeFileSync(path.join(SLIDES_TMP, 'x.html'), '<p>WINPROBE</p>');
  try {
    await withServer(async (base, port) => {
      for (const s of WIN_SPELLINGS) {
        const r = await rawGet(port, s.url);
        assert.strictEqual(r.status, 404, `${s.url} must be 404, got ${r.status}`);
        assert.ok(!r.body.toString('utf8').includes('WINPROBE'), `${s.url} must not leak the slide`);
      }
      const ok = await rawGet(port, '/uploads/slides/x.htm');
      assert.strictEqual(ok.status, 200, 'the canonical spelling still serves the slide');
      assert.strictEqual(ok.headers['content-security-policy'], EXACT_CSP);
      const api = await rawGet(port, '/api/x%5Cy');
      assert.strictEqual(api.status, 404);
      assert.deepStrictEqual(JSON.parse(api.body.toString('utf8')), { error: 'Not found' }, 'an /api spelling gets the JSON 404 body');
    });
  } finally {
    for (const f of ['x.htm', 'x.html']) fs.rmSync(path.join(SLIDES_TMP, f), { force: true });
  }
});

test('slide-upload-safety (k): CR-A01 — LIVE on a Windows host: the spellings are 404 even with a legacy file left in public/uploads/slides',
  { skip: process.platform !== 'win32' ? 'Windows-only: proves the Win32 path resolution itself (the platform-independent proof is (i)/(j))' : false },
  async () => {
    const uploadsDir = path.join(REPO, 'public', 'uploads');
    const legacyDir = path.join(uploadsDir, 'slides');
    const hadLegacy = fs.existsSync(legacyDir);
    const hadUploads = fs.existsSync(uploadsDir);
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.mkdirSync(SLIDES_TMP, { recursive: true });
    const placed = [path.join(legacyDir, 'x.htm'), path.join(legacyDir, 'x.html'), path.join(SLIDES_TMP, 'x.htm'), path.join(SLIDES_TMP, 'x.html')];
    const created = [];
    try {
      for (const f of placed) {
        if (fs.existsSync(f)) throw new Error(`refusing to overwrite an existing ${path.basename(f)}`);
        fs.writeFileSync(f, '<p>WINPROBE</p><script>1</script>');
        created.push(f);
      }
      await withServer(async (base, port) => {
        for (const s of WIN_SPELLINGS) {
          const r = await rawGet(port, s.url);
          assert.strictEqual(r.status, 404, `${s.url} must be 404 on Windows, got ${r.status}`);
          assert.ok(!r.body.toString('utf8').includes('WINPROBE'), `${s.url} must not leak the slide on Windows`);
        }
      });
    } finally {
      for (const f of created) fs.rmSync(f, { force: true });
      if (!hadLegacy) { try { fs.rmdirSync(legacyDir); } catch (e) { /* not empty */ } }
      if (!hadUploads) { try { fs.rmdirSync(uploadsDir); } catch (e) { /* not empty */ } }
    }
  });

test('slide-upload-safety (l): CR-A01 — the default directory follows the instance data dir (dev: <repo>/data/slides; real: <MA_DATA_DIR>/slides); MA_SLIDES_UPLOAD_DIR overrides', () => {
  const { spawnSync } = require('child_process');
  const probe = "process.stdout.write(require('./lib/slideUpload.js').slidesDir())";
  const run = (env) => spawnSync(process.execPath, ['-e', probe], { cwd: REPO, env: cleanEnv(env), encoding: 'utf8' });
  const dev = run({});
  assert.strictEqual(dev.status, 0, dev.stderr);
  assert.strictEqual(path.resolve(dev.stdout), path.join(REPO, 'data', 'slides'));
  const realDir = path.join(TMP_DIR, 'real-data');
  const real = run({ MA_MODE: 'real', MA_DATA_DIR: realDir });
  assert.strictEqual(real.status, 0, real.stderr);
  assert.strictEqual(path.resolve(real.stdout), path.join(realDir, 'slides'));
  const over = run({ MA_SLIDES_UPLOAD_DIR: path.join(TMP_DIR, 'override') });
  assert.strictEqual(over.status, 0, over.stderr);
  assert.strictEqual(path.resolve(over.stdout), path.join(TMP_DIR, 'override'));
  for (const out of [dev.stdout, real.stdout]) {
    const rel = path.relative(path.join(REPO, 'public'), path.resolve(out));
    assert.ok(rel.startsWith('..') || path.isAbsolute(rel), `${out} must be outside public/`);
  }
});

test('slide-upload-safety (m): CR-A01 (b) — the legacy move: allowlisted regular files only, never overwrites, idempotent, counts-only log, never throws', () => {
  const from = fs.mkdtempSync(path.join(TMP_DIR, 'legacy-from-'));
  const to = path.join(fs.mkdtempSync(path.join(TMP_DIR, 'legacy-to-')), 'slides');
  fs.writeFileSync(path.join(from, '1_aa_one.html'), 'one');
  fs.writeFileSync(path.join(from, '2_bb_two.pdf'), '%PDF-two');
  fs.writeFileSync(path.join(from, '3_cc_clash.html'), 'legacy-clash');
  fs.writeFileSync(path.join(from, 'notes.txt'), 'not a slide');
  fs.writeFileSync(path.join(from, '.hidden.html'), 'dot');
  fs.mkdirSync(path.join(from, 'sub.html'));
  fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(to, '3_cc_clash.html'), 'current');
  const logs = [];
  const r = slideUpload.migrateLegacySlides({ from, to, log: (m) => logs.push(m) });
  assert.deepStrictEqual(r, { moved: 2, skipped: 4, failed: 0 });
  assert.strictEqual(fs.readFileSync(path.join(to, '1_aa_one.html'), 'utf8'), 'one');
  assert.strictEqual(fs.readFileSync(path.join(to, '2_bb_two.pdf'), 'utf8'), '%PDF-two');
  assert.ok(!fs.existsSync(path.join(from, '1_aa_one.html')) && !fs.existsSync(path.join(from, '2_bb_two.pdf')), 'moved, not copied');
  assert.strictEqual(fs.readFileSync(path.join(to, '3_cc_clash.html'), 'utf8'), 'current', 'a name collision never overwrites');
  assert.strictEqual(fs.readFileSync(path.join(from, '3_cc_clash.html'), 'utf8'), 'legacy-clash', 'the colliding legacy file is left in place');
  for (const n of ['notes.txt', '.hidden.html']) assert.ok(fs.existsSync(path.join(from, n)), `${n} is not a slide and stays`);
  assert.strictEqual(logs.length, 1);
  assert.match(logs[0], /2 file\(s\) moved/);
  assert.ok(!/one|two|clash/.test(logs[0]), 'the log carries counts only, never names');
  // idempotent: a second run moves nothing and logs nothing
  const again = slideUpload.migrateLegacySlides({ from, to, log: (m) => logs.push(m) });
  assert.strictEqual(again.moved, 0);
  assert.strictEqual(logs.length, 1);
  // absent legacy dir: a silent no-op
  assert.deepStrictEqual(slideUpload.migrateLegacySlides({ from: path.join(TMP_DIR, 'does-not-exist'), to, log: () => assert.fail('no log') }),
    { moved: 0, skipped: 0, failed: 0 });
  // an override means the operator placed the files: the boot hook does nothing
  assert.strictEqual(slideUpload.migrateLegacySlidesAtBoot({ from, to }).overridden, true, 'MA_SLIDES_UPLOAD_DIR is set in this suite');
});

// ================================================================== Task 2 ===
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 7)]);
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24, 9)]);
const WEBP_BYTES = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1c, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(20, 3)]);
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

const TYPE_REFUSED = { error: 'This file type is not allowed for slides.', code: 'slide-type-refused' };
const TOO_LARGE = { error: 'Slide file is larger than 10 MB.', code: 'slide-too-large' };
const QUOTA_FULL = { error: 'The slide library is full.', code: 'slide-quota-exceeded' };

test('slide-upload-safety (e): every disallowed type is refused 415 with the fixed body and writes nothing', async () => {
  clearDir(SLIDES_TMP);
  const token = adminToken('slide-admin-e');
  const cases = [
    ['svg (declared svg)', { filename: 'x.svg', type: 'image/svg+xml', content: '<svg xmlns="http://www.w3.org/2000/svg"/>' }],
    ['svg (declared html)', { filename: 'x.svg', type: 'text/html', content: '<svg/>' }],
    ['SVG uppercase', { filename: 'X.SVG', content: '<svg/>' }],
    ['double extension ending .svg', { filename: 'evil.html.svg', content: '<svg/>' }],
    ['exe', { filename: 'run.exe', content: 'MZ' }],
    ['extension-less', { filename: 'noext', content: 'hello' }],
    ['png declared text/html', { filename: 'a.png', type: 'text/html', encoding: 'base64', content: PNG_BYTES.toString('base64') }],
    ['png whose bytes are not PNG', { filename: 'a.png', type: 'image/png', encoding: 'base64', content: Buffer.from('not a png at all').toString('base64') }],
    ['png sent as utf8 text', { filename: 'a.png', type: 'image/png', content: 'plain text' }],
    ['jpeg bytes under .png', { filename: 'a.png', type: 'image/png', encoding: 'base64', content: JPEG_BYTES.toString('base64') }],
    ['pdf whose bytes are not PDF', { filename: 'a.pdf', type: 'application/pdf', encoding: 'base64', content: Buffer.from('<html></html>').toString('base64') }],
    ['html whose bytes are a PNG', { filename: 'a.html', encoding: 'base64', content: PNG_BYTES.toString('base64') }],
    ['html whose bytes are a PDF', { filename: 'a.html', content: '%PDF-1.4 sneaky' }],
    ['html declared image/png', { filename: 'a.html', type: 'image/png', content: '<p>x</p>' }],
    ['invalid base64', { filename: 'a.png', type: 'image/png', encoding: 'base64', content: '***not*base64***' }],
  ];
  await withServer(async (base) => {
    for (const [label, body] of cases) {
      const before = listing(SLIDES_TMP);
      const r = await upload(base, token, body);
      assert.strictEqual(r.status, 415, `${label}: ${JSON.stringify(r.body)}`);
      assert.deepStrictEqual(r.body, TYPE_REFUSED, `${label}: fixed refusal body`);
      assert.deepStrictEqual(listing(SLIDES_TMP), before, `${label}: a refusal writes nothing`);
    }
    // an unknown encoding is a schema error (400), still side-effect free
    const before = listing(SLIDES_TMP);
    const r = await upload(base, token, { filename: 'a.html', encoding: 'rot13', content: '<p>x</p>' });
    assert.strictEqual(r.status, 400);
    assert.deepStrictEqual(listing(SLIDES_TMP), before);
  });
  assert.deepStrictEqual(listing(SLIDES_TMP), [], 'no refused upload created any library content');
});

test('slide-upload-safety (f): > 10 MB decoded is refused 413 (utf8 and base64), exactly 10 MB is accepted by the checker; nothing written', async () => {
  const token = adminToken('slide-admin-f');
  const LIMIT = 10 * 1024 * 1024;
  await withServer(async (base) => {
    const before = listing(SLIDES_TMP);
    const html = await upload(base, token, { filename: 'big.html', content: 'a'.repeat(LIMIT + 1) });
    assert.strictEqual(html.status, 413);
    assert.deepStrictEqual(html.body, TOO_LARGE);
    const png = await upload(base, token, {
      filename: 'big.png', type: 'image/png', encoding: 'base64',
      content: Buffer.concat([PNG_BYTES, Buffer.alloc(LIMIT)]).toString('base64'),
    });
    assert.strictEqual(png.status, 413);
    assert.deepStrictEqual(png.body, TOO_LARGE);
    assert.deepStrictEqual(listing(SLIDES_TMP), before, 'an oversize refusal writes nothing');
  });
  const big = { quotaBytes: 1024 * 1024 * 1024, dir: SLIDES_TMP };
  assert.strictEqual(slideUpload.checkUpload({ filename: 'edge.html', content: 'a'.repeat(LIMIT) }, big).ok, true, 'exactly 10 MB passes');
  const over = slideUpload.checkUpload({ filename: 'edge.html', content: 'a'.repeat(LIMIT + 1) }, big);
  assert.strictEqual(over.ok, false);
  assert.strictEqual(over.status, 413);
});

test('slide-upload-safety (g): a library over MA_SLIDE_QUOTA_MB is refused 413 with the fixed body and the directory is unchanged', async () => {
  clearDir(SLIDES_TMP);
  const token = adminToken('slide-admin-g');
  try {
    await withServer(async (base) => {
      assert.strictEqual(slideUpload.quotaBytes(), 1024 * 1024, 'the suite boots with MA_SLIDE_QUOTA_MB=1');
      const first = await upload(base, token, { filename: 'fill.html', content: 'a'.repeat(900 * 1024) });
      assert.strictEqual(first.status, 200, JSON.stringify(first.body));
      const before = listing(SLIDES_TMP);
      const second = await upload(base, token, { filename: 'one-more.html', content: 'b'.repeat(200 * 1024) });
      assert.strictEqual(second.status, 413);
      assert.deepStrictEqual(second.body, QUOTA_FULL);
      assert.deepStrictEqual(listing(SLIDES_TMP), before, 'a quota refusal writes nothing');
      // a small slide that still fits is accepted (the quota is a sum, not a lock)
      const small = await upload(base, token, { filename: 'small.html', content: '<p>ok</p>' });
      assert.strictEqual(small.status, 200);
    });
  } finally {
    clearDir(SLIDES_TMP);
  }
  // unit level: the sum counts existing files + this file, boundary inclusive
  const dir = fs.mkdtempSync(path.join(TMP_DIR, 'quota-'));
  fs.writeFileSync(path.join(dir, 'a.html'), Buffer.alloc(100));
  fs.writeFileSync(path.join(dir, '.dot'), Buffer.alloc(5000));
  assert.strictEqual(slideUpload.libraryBytes(dir), 100, 'dotfiles are not counted');
  assert.strictEqual(slideUpload.checkUpload({ filename: 'b.html', content: 'x'.repeat(20) }, { dir, quotaBytes: 120 }).ok, true);
  assert.strictEqual(slideUpload.checkUpload({ filename: 'b.html', content: 'x'.repeat(21) }, { dir, quotaBytes: 120 }).status, 413);
});

test('slide-upload-safety (h): valid PNG/JPEG/WebP/PDF are stored byte-for-byte; images get the sandbox CSP, the PDF keeps the app CSP; all nosniff', async () => {
  clearDir(SLIDES_TMP);
  const token = adminToken('slide-admin-h');
  const valid = [
    ['pic.png', 'image/png', PNG_BYTES, true],
    ['pic.JPG', 'image/jpeg', JPEG_BYTES, true],
    ['pic.jpeg', 'image/jpeg', JPEG_BYTES, true],
    ['pic.webp', 'image/webp', WEBP_BYTES, true],
    ['deck.pdf', 'application/pdf', PDF_BYTES, false],
    ['nodeclared.png', '', PNG_BYTES, true],
  ];
  try {
    await withServer(async (base) => {
      for (const [filename, type, bytes, sandboxed] of valid) {
        const up = await upload(base, token, { filename, type, encoding: 'base64', content: bytes.toString('base64') });
        assert.strictEqual(up.status, 200, `${filename}: ${JSON.stringify(up.body)}`);
        const stored = fs.readFileSync(path.join(SLIDES_TMP, path.basename(up.body.url)));
        assert.ok(stored.equals(bytes), `${filename}: stored bytes equal the decoded input`);
        const res = await fetch(base + up.body.url);
        assert.strictEqual(res.status, 200, filename);
        assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff', filename);
        assert.strictEqual(res.headers.get('cache-control'), 'private, no-cache', filename);
        assert.strictEqual(res.headers.get('content-security-policy-report-only'), null, filename);
        const csp = res.headers.get('content-security-policy');
        if (sandboxed) assert.strictEqual(csp, EXACT_CSP, `${filename}: images carry the sandbox CSP`);
        else assert.ok(csp && !/\bsandbox\b/.test(csp), `${filename}: a PDF is not served with the sandbox CSP (PD-17)`);
        assert.strictEqual((await res.arrayBuffer()).byteLength, bytes.length, filename);
      }
      const exts = new Set(fs.readdirSync(SLIDES_TMP).map((f) => path.extname(f).toLowerCase()));
      assert.deepStrictEqual([...exts].sort(), ['.jpeg', '.jpg', '.pdf', '.png', '.webp']);
    });
  } finally {
    clearDir(SLIDES_TMP);
  }
});
