// SAFE-03 / D-13-04 (Phase 13, plan 13-03): uploaded slides are untrusted markup.
// This suite proves, through the REAL routes of the requireable app:
//   Task 1 (tracer): an uploaded HTML slide is served from the dedicated
//     /uploads/slides mount with the sandbox CSP + nosniff and no
//     Report-Only header — in a temp upload directory AND in the DEFAULT
//     directory (MA_SLIDES_UPLOAD_DIR unset, B-1 negative control: it fails if
//     the mount sits after the terminal `.html` middleware, which a temp
//     directory outside public/ cannot detect);
//   Task 2: the type allowlist, the 10 MB limit and the library quota, with
//     fixed refusal bodies and side-effect-free refusals.
//
// Isolation: every MA_* path is a throwaway directory and MA_SLIDES_UPLOAD_DIR
// is a temp directory, except the single default-directory case, which writes
// into THIS checkout's public/uploads/slides (gitignored) and deletes its own
// file in `finally`.

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
});

// ---- the DEFAULT-directory case (B-1 negative control) ------------------------
const DEFAULT_CHILD = `
  const app = require('./server.js');
  const server = app.listen(0, '127.0.0.1', async () => {
    const base = 'http://127.0.0.1:' + server.address().port;
    const out = {};
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
    } catch (e) { out.error = String(e && e.message); }
    process.stdout.write('\\nDEFAULT_RESULT ' + JSON.stringify(out) + '\\n');
    server.close();
    process.exit(0);
  });
`;

test('slide-upload-safety (d): DEFAULT directory (MA_SLIDES_UPLOAD_DIR unset) — the shipped configuration serves the slide with the sandbox CSP, never the app CSP (B-1)', async () => {
  const token = adminToken('slide-admin-d');
  const defaultDir = path.join(REPO, 'public', 'uploads', 'slides');
  const uploadsDir = path.join(REPO, 'public', 'uploads');
  const hadSlidesDir = fs.existsSync(defaultDir);
  const hadUploadsDir = fs.existsSync(uploadsDir);
  const before = listing(defaultDir);
  let uploadedFile = null;
  try {
    const env = cleanEnv({ ...isolatedPaths(TMP_DIR), GSD_COOKIE: cookie(token) });
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
        resolve(JSON.parse(m[1]));
      });
    });
    assert.strictEqual(result.error, undefined, result.error);
    assert.strictEqual(result.upload.status, 200, JSON.stringify(result.upload));
    uploadedFile = path.join(defaultDir, path.basename(result.upload.body.url));
    assert.ok(fs.existsSync(uploadedFile), 'the file landed in the default public/uploads/slides directory');

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
  } finally {
    if (uploadedFile) fs.rmSync(uploadedFile, { force: true });
    if (!hadSlidesDir) { try { fs.rmdirSync(defaultDir); } catch (e) { /* not empty or absent */ } }
    if (!hadUploadsDir) { try { fs.rmdirSync(uploadsDir); } catch (e) { /* not empty or absent */ } }
  }
  assert.deepStrictEqual(listing(defaultDir), before, 'public/uploads/slides listing is identical before/after');
});
