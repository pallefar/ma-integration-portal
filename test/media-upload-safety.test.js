// Phase 13 quick task 13-QUICK-media: POST /api/media must not store active
// content. public/uploads/ is the PUBLIC static root (same origin, app CSP), so an
// uploaded .html/.htm/.svg — or an .html loading an uploaded same-origin .js —
// would run with the viewer's session. The write side now allows only
// png/jpg/jpeg/webp/pdf: FINAL extension AND declared type AND magic bytes, <= 10
// MiB decoded (lib/slideUpload.js checkMediaUpload), with the fixed refusal bodies
// Phase 14 (D-14-04) specifies. DELETE /api/media/:id unlinks only a regular file
// directly inside public/uploads/.
//
// Isolation: every MA_* path is a throwaway directory. The upload directory itself
// is this checkout's gitignored public/uploads (the route's fixed location), so
// every file this suite creates is tracked by exact name and removed in `finally`;
// "unchanged listing" assertions ignore the names other suites own (busy-503's
// probe) and only compare what a refusal could have written.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-media-upload-safety-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.MA_SLIDES_UPLOAD_DIR = path.join(TMP_DIR, 'slides');
process.env.ADMIN_TOKEN = '';
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN']) delete process.env[key];

const { listenLocal } = require('./helpers/listen-local');
const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { ensureUser } = require('./helpers/seed-identity.js');
const slideUpload = require('../lib/slideUpload.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

const REPO = path.join(__dirname, '..');
const UPLOADS = path.join(REPO, 'public', 'uploads');
const PUBLIC_DIR = path.join(REPO, 'public');
const MIB = 1024 * 1024;

const TYPE_REFUSED = { error: 'This file type is not allowed.', code: 'media-type-refused' };
const TOO_LARGE = { error: 'This file is too large.', code: 'media-too-large' };

// One marker per run: every upload name carries it, so a refusal that wrote
// anything — under any stored name — is visible in the listing.
const RUN = 'mus' + crypto.randomBytes(3).toString('hex');
const nm = (suffix) => `${RUN}-${suffix}`;

// ---- minimal REAL bytes of each allowed type (only the signatures matter) ----
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'), Buffer.from([0xff, 0xd9])]);
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 ', 'latin1'), Buffer.alloc(14)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');
const HTML = Buffer.from('<!doctype html><title>x</title><script>fetch("/api/sessions")</script>', 'utf8');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>', 'utf8');

const dataUrl = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;

function adminToken(username) {
  ensureUser(controlConn, { username, role: 'admin' });
  return sessionsDb.createSession(runtimeConn, { username, role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });
}
function roleToken(username, role) {
  ensureUser(controlConn, { username, role });
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
const cookie = (token) => `ma_session=${token}`;

async function call(base, token, method, urlPath, body) {
  const opts = { method, headers: {} };
  if (token) opts.headers.Cookie = cookie(token);
  if (body !== undefined && body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(base + urlPath, opts);
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}
const post = (base, token, body) => call(base, token, 'POST', '/api/media', body);

const withServer = async (fn) => {
  const server = await listenLocal(app);
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
};

// Names this suite created under public/uploads (and elsewhere) — removed at the end.
const created = new Set();
function track(p) { created.add(p); return p; }
test.after(() => {
  for (const p of created) { try { fs.rmSync(p, { force: true }); } catch (e) { /* best effort */ } }
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

/** Listing of public/uploads limited to names this run could have written (null = no such directory). */
function ownListing() {
  try { return fs.readdirSync(UPLOADS).filter((n) => n.includes(RUN)).sort(); } catch (e) { return null; }
}
/** The whole listing minus the one name family another suite (busy-503) owns. */
function wholeListing() {
  try { return fs.readdirSync(UPLOADS).filter((n) => !n.includes('busy-503-contract-probe')).sort(); } catch (e) { return null; }
}
const storedPath = (url) => path.join(UPLOADS, path.basename(url));

// =============================================================== unit: the checker ===
test('media-upload-safety (unit a): the allowlist is exactly png/jpg/jpeg/webp/pdf, sharing the slide type table', () => {
  assert.deepStrictEqual(Object.keys(slideUpload.MEDIA_TYPES).sort(), ['jpeg', 'jpg', 'pdf', 'png', 'webp']);
  for (const ext of Object.keys(slideUpload.MEDIA_TYPES)) {
    assert.strictEqual(slideUpload.MEDIA_TYPES[ext], slideUpload.SLIDE_TYPES[ext], `${ext}: one definition per type`);
  }
  assert.deepStrictEqual(slideUpload.MEDIA_REFUSALS.type, TYPE_REFUSED);
  assert.deepStrictEqual(slideUpload.MEDIA_REFUSALS.tooLarge, TOO_LARGE);
});

test('media-upload-safety (unit b): every allowed type is judged ok with its MIME; the verdict carries the decoded bytes', () => {
  const cases = [['a.png', 'image/png', PNG], ['a.JPG', 'image/jpeg', JPEG], ['a.jpeg', 'image/jpeg', JPEG],
    ['a.webp', 'image/webp', WEBP], ['a.Pdf', 'application/pdf', PDF]];
  for (const [fileName, mime, buf] of cases) {
    const v = slideUpload.checkMediaUpload({ fileName, fileData: dataUrl(mime, buf) });
    assert.strictEqual(v.ok, true, fileName);
    assert.strictEqual(v.mime, mime);
    assert.strictEqual(v.safeName, fileName);
    assert.ok(Buffer.compare(v.buffer, buf) === 0, `${fileName}: decoded bytes round-trip`);
    // the `kind` field alone also declares the type (bare base64 payload)
    const k = slideUpload.checkMediaUpload({ fileName, fileData: buf.toString('base64'), declaredType: mime });
    assert.strictEqual(k.ok, true, `${fileName} via kind`);
  }
});

test('media-upload-safety (unit c): the size is judged on the arithmetic size BEFORE any base64 decode; exactly 10 MiB is fine, one byte more is refused', () => {
  const at = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(10 * MIB - 8)]);
  const over = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(10 * MIB + 1 - 8)]);
  assert.strictEqual(at.length, 10 * MIB);
  assert.strictEqual(slideUpload.checkMediaUpload({ fileName: 'big.png', fileData: dataUrl('image/png', at) }).ok, true, 'exactly 10 MiB');

  const overUrl = dataUrl('image/png', over);
  const realFrom = Buffer.from;
  let base64Decodes = 0;
  Buffer.from = function patched(...a) { if (a[1] === 'base64') base64Decodes += 1; return realFrom.apply(this, a); };
  let v;
  try { v = slideUpload.checkMediaUpload({ fileName: 'big.png', fileData: overUrl }); } finally { Buffer.from = realFrom; }
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.status, 413);
  assert.deepStrictEqual(v.body, TOO_LARGE);
  assert.strictEqual(base64Decodes, 0, 'an oversize payload is refused without being decoded');
});

test('media-upload-safety (unit d): extension is judged on the FINAL extension of the sanitized stored name', () => {
  const refused = (fileName, fileData) => slideUpload.checkMediaUpload({ fileName, fileData });
  const png = dataUrl('image/png', PNG);
  for (const name of ['x.png.html', 'x.html', 'x.htm', 'x.svg', 'x.js', 'x.exe', 'x.txt', 'noext', 'png', '.png', 'x.png.', 'x.png ', 'x.png\u0000.html', 'x.png/../y.html', '', 'x.php.png.php']) {
    const v = refused(name, png);
    assert.strictEqual(v.ok, false, JSON.stringify(name));
    assert.strictEqual(v.status, 415, JSON.stringify(name));
    assert.deepStrictEqual(v.body, TYPE_REFUSED, JSON.stringify(name));
  }
  // not a string at all -> still a fixed refusal, never a throw
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.strictEqual(slideUpload.checkMediaUpload({ fileName: bad, fileData: png }).ok, false);
    assert.strictEqual(slideUpload.checkMediaUpload({ fileName: 'a.png', fileData: bad }).ok, false);
  }
  assert.strictEqual(slideUpload.checkMediaUpload(undefined).ok, false);
});

test('media-upload-safety (unit e): resolveMediaFile names only a file DIRECTLY inside the uploads root', () => {
  const root = path.join(os.tmpdir(), 'ma-uploads-root');
  const ok = slideUpload.resolveMediaFile('/uploads/1760000000000_logo.png', root);
  assert.strictEqual(ok, path.join(root, '1760000000000_logo.png'));
  for (const bad of ['/uploads/slides/x.html', '/uploads/slides/', '/uploads/../server.js', '/uploads/..%2fserver.js',
    '/uploads/a/b.png', '/uploads/..\\server.js', '/uploads/.hidden.png', '/uploads/x.png:stream', '/uploads/PROGRA~1.png',
    '/uploads/', '/uploads', '/server.js', '', null, undefined, 7, '/uploads/x y.png', '/uploads//etc/passwd',
    '/uploads/' + 'a'.repeat(300)]) {
    assert.strictEqual(slideUpload.resolveMediaFile(bad, root), null, JSON.stringify(bad));
  }
});

// ========================================================== route: POST /api/media ===
test('media-upload-safety (a): refusals — active content, double extensions, type mismatch, bad magic, bad encoding, oversize — are fixed 415/413 and create NOTHING', async () => {
  const token = adminToken('media-admin-a');
  await withServer(async (base) => {
    const before = { whole: wholeListing(), own: ownListing(), media: (await call(base, token, 'GET', '/api/media')).body };
    const png = dataUrl('image/png', PNG);
    const html = dataUrl('text/html', HTML);
    const bigPng = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(10 * MIB + 1 - 8)]);

    const type415 = [
      // active content by extension — with the declared type and bytes of the format itself
      [nm('a.html'), html, undefined], [nm('a.htm'), html, undefined],
      [nm('a.svg'), dataUrl('image/svg+xml', SVG), undefined], [nm('a.js'), dataUrl('text/javascript', Buffer.from('alert(1)')), undefined],
      [nm('a.exe'), dataUrl('application/octet-stream', Buffer.from('MZ')), undefined], [nm('a.txt'), dataUrl('text/plain', Buffer.from('hi')), undefined],
      [nm('noext'), png, undefined], [nm('a.png.html'), png, undefined], [nm('a.png.svg'), png, undefined],
      [nm('a.PNG.php'), png, undefined], [nm('a.html.'), html, undefined],
      // a polyglot: HTML bytes under an image extension -> magic mismatch
      [nm('a.html.png'), dataUrl('image/png', HTML), undefined],
      [nm('b.png'), dataUrl('image/png', SVG), undefined],
      [nm('c.jpg'), dataUrl('image/jpeg', PNG), undefined],
      [nm('d.webp'), dataUrl('image/webp', Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1')), undefined],
      [nm('e.pdf'), dataUrl('application/pdf', HTML), undefined],
      // declared type must name the extension's MIME
      [nm('f.png'), dataUrl('image/jpeg', PNG), undefined],
      [nm('g.png'), dataUrl('text/html', PNG), undefined],
      [nm('h.png'), png, 'text/html'],                    // header ok, kind lies
      [nm('i.png'), PNG.toString('base64'), undefined],   // no declared type at all
      [nm('j.png'), PNG.toString('base64'), 'image/svg+xml'],
      // not a base64 data URL / not base64
      [nm('k.png'), 'data:image/png,' + encodeURIComponent(PNG.toString('latin1')), undefined],
      [nm('l.png'), 'data:image/png;base64,@@@not-base64@@@', undefined],
      [nm('m.png'), 'data:image/png;base64', undefined],
    ];
    for (const [fileName, fileData, kind] of type415) {
      const r = await post(base, token, kind === undefined ? { fileName, fileData } : { fileName, fileData, kind });
      assert.strictEqual(r.status, 415, `${fileName} -> ${r.status} ${JSON.stringify(r.body)}`);
      assert.deepStrictEqual(r.body, TYPE_REFUSED, fileName);
      assert.ok(!JSON.stringify(r.body).includes(RUN), 'a refusal never echoes the file name');
    }

    const big = await post(base, token, { fileName: nm('big.png'), fileData: dataUrl('image/png', bigPng) });
    assert.strictEqual(big.status, 413);
    assert.deepStrictEqual(big.body, TOO_LARGE);

    // an oversize payload with a refused extension is the TYPE refusal (extension is judged first)
    const bigHtml = await post(base, token, { fileName: nm('big.html'), fileData: dataUrl('image/png', bigPng) });
    assert.strictEqual(bigHtml.status, 415);

    const afterOwn = ownListing();
    assert.deepStrictEqual(afterOwn === null ? [] : afterOwn, [], 'no refused upload wrote a file (under any stored name)');
    if (before.whole === null) {
      // the directory did not exist: a refusal must not have created it (others may legitimately race — only our marker matters)
      assert.deepStrictEqual(ownListing() || [], []);
    } else {
      const afterWhole = wholeListing() || [];
      assert.deepStrictEqual(afterWhole.filter((n) => n.includes(RUN)), before.own || []);
    }
    const mediaAfter = (await call(base, token, 'GET', '/api/media')).body;
    assert.deepStrictEqual(mediaAfter, before.media, 'no media record was added by a refusal');
  });
});

test('media-upload-safety (b): PNG, JPEG, WebP and PDF are stored and served with the right Content-Type (nosniff)', async () => {
  const token = adminToken('media-admin-b');
  await withServer(async (base) => {
    const cases = [
      ['logo.png', 'image/png', PNG], ['photo.jpg', 'image/jpeg', JPEG], ['photo2.jpeg', 'image/jpeg', JPEG],
      ['pic.webp', 'image/webp', WEBP], ['doc.pdf', 'application/pdf', PDF],
    ];
    for (const [suffix, mime, buf] of cases) {
      const fileName = nm(suffix);
      const r = await post(base, token, { fileName, fileData: dataUrl(mime, buf), kind: mime });
      assert.strictEqual(r.status, 200, `${suffix}: ${JSON.stringify(r.body)}`);
      assert.strictEqual(r.body.success, true);
      const m = r.body.media;
      assert.deepStrictEqual(Object.keys(m).sort(), ['fileName', 'id', 'kind', 'timestamp', 'url']);
      assert.strictEqual(m.fileName, fileName);
      assert.strictEqual(m.kind, mime);
      assert.match(m.url, new RegExp(`^/uploads/\\d+_${fileName.replace(/\./g, '\\.')}$`));
      track(storedPath(m.url));
      assert.ok(Buffer.compare(fs.readFileSync(storedPath(m.url)), buf) === 0, `${suffix}: the stored bytes are the decoded upload`);

      const res = await fetch(base + m.url, { headers: { Cookie: cookie(token) } });
      assert.strictEqual(res.status, 200, `${suffix}: served`);
      assert.strictEqual((res.headers.get('content-type') || '').split(';')[0], mime, `${suffix}: Content-Type`);
      assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(Buffer.compare(Buffer.from(await res.arrayBuffer()), buf) === 0, `${suffix}: served bytes`);
    }
    const list = (await call(base, token, 'GET', '/api/media')).body;
    for (const [suffix] of cases) assert.ok(list.some((m) => m.fileName === nm(suffix)), `${suffix} listed`);
  });
});

test('media-upload-safety (c): a data-URL upload without `kind` uses the header; a bare base64 upload needs `kind`; the upload name is sanitised exactly as before', async () => {
  const token = adminToken('media-admin-c');
  await withServer(async (base) => {
    const a = await post(base, token, { fileName: nm('no kind.png'), fileData: dataUrl('image/png', PNG) });
    assert.strictEqual(a.status, 200, JSON.stringify(a.body));
    track(storedPath(a.body.media.url));
    assert.strictEqual(a.body.media.fileName, nm('no_kind.png'), 'spaces and other characters -> `_`');
    assert.strictEqual(a.body.media.kind, 'image/png');

    const b = await post(base, token, { fileName: nm('bare.png'), fileData: PNG.toString('base64'), kind: 'image/png' });
    assert.strictEqual(b.status, 200, JSON.stringify(b.body));
    track(storedPath(b.body.media.url));
  });
});

test('media-upload-safety (d): admin-only — pmo/hrbp/employee/anonymous are refused before any decoding or write', async () => {
  const before = ownListing();
  await withServer(async (base) => {
    for (const role of ['pmo', 'hrbp', 'employee']) {
      const t = roleToken(`media-${role}-d`, role);
      const r = await post(base, t, { fileName: nm(`${role}.png`), fileData: dataUrl('image/png', PNG) });
      assert.ok(r.status === 403, `${role} -> ${r.status}`);
    }
    const anon = await post(base, null, { fileName: nm('anon.png'), fileData: dataUrl('image/png', PNG) });
    assert.ok(anon.status === 401 || anon.status === 403, `anonymous -> ${anon.status}`);
    assert.deepStrictEqual(ownListing(), before, 'nothing written');
  });
});

test('media-upload-safety (e): the check runs before any filesystem call in the route; the busy-503 / 500 handling is kept', () => {
  const src = fs.readFileSync(path.join(REPO, 'server.js'), 'utf8');
  const start = src.indexOf("app.post('/api/media'");
  const end = src.indexOf("app.delete('/api/media/:id'");
  assert.ok(start > 0 && end > start);
  const handler = src.slice(start, end);
  const check = handler.indexOf('checkMediaUpload(');
  assert.ok(check > 0, 'the handler calls checkMediaUpload');
  for (const fsCall of ['fs.existsSync', 'fs.mkdirSync', 'fs.writeFileSync']) {
    assert.ok(handler.indexOf(fsCall) > check, `${fsCall} comes after the verdict`);
  }
  assert.ok(/res\.status\(verdict\.status\)\.json\(verdict\.body\)/.test(handler), 'the fixed refusal body is returned verbatim');
  assert.ok(/isBusyError\(e\)\)\s*throw e/.test(handler), 'writeDb contention still reaches the central 503 middleware');
  assert.ok(handler.includes("`${Date.now()}_${safeName}`"), 'the stored name keeps its `${Date.now()}_` prefix');
});

// ======================================================= route: DELETE /api/media/:id ===
test('media-upload-safety (f): deleting an uploaded media item removes its file and its record', async () => {
  const token = adminToken('media-admin-f');
  await withServer(async (base) => {
    const up = await post(base, token, { fileName: nm('del.png'), fileData: dataUrl('image/png', PNG) });
    assert.strictEqual(up.status, 200);
    const file = track(storedPath(up.body.media.url));
    assert.ok(fs.existsSync(file));
    const del = await call(base, token, 'DELETE', `/api/media/${up.body.media.id}`);
    assert.strictEqual(del.status, 200);
    assert.deepStrictEqual(del.body, { success: true, message: 'Media deleted.' });
    assert.strictEqual(fs.existsSync(file), false, 'the file is gone');
    const list = (await call(base, token, 'GET', '/api/media')).body;
    assert.ok(!list.some((m) => m.id === up.body.media.id), 'the record is gone');
  });
});

test('media-upload-safety (g): delete containment — a record whose url is a traversal, the slides subtree or a symlink drops the record but never unlinks outside public/uploads or a non-regular file', async () => {
  const token = adminToken('media-admin-g');
  // Decoys: one outside the repo (reached by `..` from public/), one in the slides subtree
  // (name is not a servable slide ext, so the legacy-slide boot move never touches it), one
  // symlink inside uploads pointing at a third file.
  const outside = track(path.join(TMP_DIR, `${RUN}-outside.txt`));
  fs.writeFileSync(outside, 'must survive');
  const slidesDir = path.join(UPLOADS, 'slides');
  fs.mkdirSync(slidesDir, { recursive: true });
  const inSlides = track(path.join(slidesDir, `${RUN}-decoy.txt`));
  fs.writeFileSync(inSlides, 'must survive');
  const linkTarget = track(path.join(TMP_DIR, `${RUN}-link-target.png`));
  fs.writeFileSync(linkTarget, PNG);
  fs.mkdirSync(UPLOADS, { recursive: true });
  const linkName = `1760000000000_${RUN}-link.png`;
  const linkPath = track(path.join(UPLOADS, linkName));
  let symlinked = true;
  try { fs.symlinkSync(linkTarget, linkPath); } catch (e) { symlinked = false; /* no symlink privilege (Windows) */ }

  const relOutside = '/' + path.relative(PUBLIC_DIR, outside).split(path.sep).join('/');
  assert.ok(relOutside.startsWith('/../'), 'the decoy is reached by traversal from public/');
  const seeds = [
    { id: `media_${RUN}_trav`, url: relOutside },
    { id: `media_${RUN}_slides`, url: `/uploads/slides/${RUN}-decoy.txt` },
    { id: `media_${RUN}_dots`, url: `/uploads/../${path.basename(outside)}` },
  ];
  if (symlinked) seeds.push({ id: `media_${RUN}_link`, url: `/uploads/${linkName}` });

  const db = store.readDb();
  db.media = db.media || [];
  for (const s of seeds) db.media.push({ id: s.id, fileName: 'x', kind: 'application/octet-stream', url: s.url, timestamp: new Date().toISOString() });
  store.writeDb(db);

  await withServer(async (base) => {
    for (const s of seeds) {
      const del = await call(base, token, 'DELETE', `/api/media/${s.id}`);
      assert.strictEqual(del.status, 200, s.id);
    }
    const list = (await call(base, token, 'GET', '/api/media')).body;
    for (const s of seeds) assert.ok(!list.some((m) => m.id === s.id), `${s.id}: the record is dropped`);
  });
  assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'must survive', 'a traversal url never unlinked a file outside public/uploads');
  assert.strictEqual(fs.readFileSync(inSlides, 'utf8'), 'must survive', 'the slides subtree is not touched');
  if (symlinked) {
    assert.ok(fs.lstatSync(linkPath).isSymbolicLink(), 'a symlink is not a regular file — not unlinked');
    assert.ok(Buffer.compare(fs.readFileSync(linkTarget), PNG) === 0, 'and its target is untouched');
  }
});
