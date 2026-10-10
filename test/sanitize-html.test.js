// SAFE-01 / D-13-01 (Phase 13, plan 13-01): the vendored `sanitize-html`
// allowlist parser behind the unchanged `{ sanitizeHtml }` export.
//
//  - tracer: the four R1-03 payloads that bypassed the old regex body are inert
//    END TO END through the real POST /api/pages -> GET /api/pages route, in
//    body (string and language map) and in layout richtext;
//  - unit behaviour: attribute / scheme / data-image / style allowlist;
//  - supply chain: exact pin, overrides, no install script, whole tree loads
//    without require(esm), no pre-existing node_modules file touched;
//  - corpus + golden (Task 2) are appended below.
//
// Assertions on sanitizer output are STRUCTURAL (htmlparser2 parse + walk,
// test/helpers/html-inert.js) — never regex-on-output.
//
// Boots the REAL requireable app against an isolated temp control/runtime/demo
// trio (the [test-isolation] guard requires MA_* set BEFORE require).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { parseDocument } = require('htmlparser2');
const { listenLocal } = require('./helpers/listen-local');
const { inertViolations } = require('./helpers/html-inert.js');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-sanitize-html-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}
function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-sanitize-html-split-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = '';

const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');
const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
const SOURCE_DB_PATH = tempDbPath('legacy-source');
runMigration(SOURCE_PATH, SOURCE_DB_PATH);

const { runSplit } = require('../scripts/split-db-into-control-demo-deals.js');
runSplit({ sourcePath: SOURCE_DB_PATH, outDir: TMP_DIR });

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');

const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const fixtureUsers = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

const app = require('../server.js');
const { sanitizeHtml } = require('../lib/sanitizeHtml.js');
const policy = require('../lib/htmlPolicy.js');

test.after(() => {
  cleanupDbFile(SOURCE_DB_PATH);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

const ROOT = path.join(__dirname, '..');

// R1-03 payloads, verbatim (.planning/reviews/v3.0/R1-security.md).
const R1_03 = {
  'R1-03-a': '<img src="x"onerror=alert(1)>',
  'R1-03-b': '<a href="jav&#x61;script:alert(1)">x</a>',
  'R1-03-c': '<a href="java\tscript:alert(1)">x</a>',
  'R1-03-d': '<scr<script>ipt>alert(1)</scr</script>ipt>',
};

// ---------------------------------------------------------------------------
// Unit behaviour
// ---------------------------------------------------------------------------
test('sanitize-html unit: a non-string yields the empty string', () => {
  assert.strictEqual(sanitizeHtml(null), '');
  assert.strictEqual(sanitizeHtml(undefined), '');
  assert.strictEqual(sanitizeHtml(42), '');
  assert.strictEqual(sanitizeHtml({}), '');
  assert.strictEqual(sanitizeHtml([]), '');
});

test('sanitize-html unit: event handler dropped, benign inline markup kept byte-identical', () => {
  assert.strictEqual(sanitizeHtml('<p onclick="x()">Hi <b>there</b></p>'), '<p>Hi <b>there</b></p>');
  assert.strictEqual(sanitizeHtml('<p>Welcome</p>'), '<p>Welcome</p>');
});

test('sanitize-html unit: javascript: href loses its target; https href is kept and gets the forced rel', () => {
  const dead = parseDocument(sanitizeHtml('<a href="jav&#x61;script:alert(1)">x</a>')).children[0];
  assert.strictEqual(dead.name, 'a');
  assert.strictEqual(dead.attribs.href, undefined, 'javascript: href must be removed');

  const live = parseDocument(sanitizeHtml('<a href="https://te.com" target="_self">x</a>')).children[0];
  assert.strictEqual(live.attribs.href, 'https://te.com');
  assert.strictEqual(live.attribs.rel, policy.FORCED_LINK_REL);
  assert.strictEqual(live.attribs.target, undefined, 'a target other than _blank is dropped');

  const blank = parseDocument(sanitizeHtml('<a href="/x" target="_blank" rel="opener">x</a>')).children[0];
  assert.strictEqual(blank.attribs.target, '_blank');
  assert.strictEqual(blank.attribs.rel, policy.FORCED_LINK_REL, 'rel is always overwritten');
});

test('sanitize-html unit: img src — svg data URL dropped, png data URL kept, protocol-relative dropped', () => {
  const svg = parseDocument(sanitizeHtml('<img src="data:image/svg+xml;base64,AAAA">')).children[0];
  assert.strictEqual(svg.attribs.src, undefined);
  const html = parseDocument(sanitizeHtml('<img src="data:text/html;base64,AAAA">')).children[0];
  assert.strictEqual(html.attribs.src, undefined);
  const png = parseDocument(sanitizeHtml('<img src="data:image/png;base64,iVBORw0KGgo=">')).children[0];
  assert.strictEqual(png.attribs.src, 'data:image/png;base64,iVBORw0KGgo=');
  const proto = parseDocument(sanitizeHtml('<img src="//evil.example/x.png">')).children[0];
  assert.strictEqual(proto.attribs.src, undefined);
  const rel = parseDocument(sanitizeHtml('<img src="/uploads/a.png" alt="a">')).children[0];
  assert.strictEqual(rel.attribs.src, '/uploads/a.png');
});

test('sanitize-html unit: style keeps only allowlisted properties and values', () => {
  const p = parseDocument(sanitizeHtml('<p style="color:red;position:fixed;background:url(x)">t</p>')).children[0];
  assert.strictEqual(p.attribs.style, 'color:red');
  const gone = parseDocument(sanitizeHtml('<p style="background-color:url(javascript:alert(1))">t</p>')).children[0];
  assert.strictEqual(gone.attribs.style, undefined);
});

test('sanitize-html unit: id/name are never allowed (DOM clobbering)', () => {
  const out = parseDocument(sanitizeHtml('<p id="x" name="y" class="k">t</p>')).children[0];
  assert.strictEqual(out.attribs.id, undefined);
  assert.strictEqual(out.attribs.name, undefined);
  assert.strictEqual(out.attribs.class, 'k');
});

test('sanitize-html unit: the four R1-03 payloads are inert and idempotent', () => {
  for (const [id, payload] of Object.entries(R1_03)) {
    const out = sanitizeHtml(payload);
    assert.deepStrictEqual(inertViolations(out), [], `${id} must be structurally inert, got ${JSON.stringify(out)}`);
    assert.strictEqual(sanitizeHtml(out), out, `${id} must be idempotent`);
  }
});

// ---------------------------------------------------------------------------
// Tracer: the real POST /api/pages route -> GET /api/pages
// ---------------------------------------------------------------------------
function newAdminSession() {
  return sessionsDb.createSession(runtimeConn, { username: 'admin', role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });
}

async function roundTrip(port, token, page) {
  const headers = { Cookie: `ma_session=${token}`, 'Content-Type': 'application/json' };
  const post = await fetch(`http://127.0.0.1:${port}/api/pages`, { method: 'POST', headers, body: JSON.stringify(page) });
  assert.strictEqual(post.status, 200, `POST /api/pages must succeed for ${page.slug}`);
  const get = await fetch(`http://127.0.0.1:${port}/api/pages?slug=${encodeURIComponent(page.slug)}`, { headers: { Cookie: `ma_session=${token}` } });
  assert.strictEqual(get.status, 200);
  return get.json();
}

test('sanitize-html tracer: the four R1-03 payloads come back inert from the real POST/GET /api/pages route (body string, body language map, layout richtext)', async () => {
  const token = newAdminSession();
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    let n = 0;
    for (const [id, payload] of Object.entries(R1_03)) {
      n += 1;
      const stamp = `${Date.now()}-${n}`;

      const asString = await roundTrip(port, token, { slug: `san-str-${stamp}`, body: payload });
      assert.deepStrictEqual(inertViolations(asString.body), [], `${id} (body string) -> ${JSON.stringify(asString.body)}`);

      const asMap = await roundTrip(port, token, { slug: `san-map-${stamp}`, body: { en: payload, de: payload } });
      assert.deepStrictEqual(inertViolations(asMap.body.en), [], `${id} (body.en) -> ${JSON.stringify(asMap.body.en)}`);
      assert.deepStrictEqual(inertViolations(asMap.body.de), [], `${id} (body.de)`);

      const asLayout = await roundTrip(port, token, {
        slug: `san-layout-${stamp}`,
        layout: [{ id: 'blk1', type: 'richtext', data: { html: payload } }],
      });
      assert.deepStrictEqual(inertViolations(asLayout.layout[0].data.html), [], `${id} (layout[0].data.html) -> ${JSON.stringify(asLayout.layout[0].data.html)}`);
    }
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Supply chain (T-13-SC): exact pin, overrides, no install hook, loads
// without require(esm).
// ---------------------------------------------------------------------------
test('sanitize-html supply chain: exact pin + overrides, no install script on any added package, no native file', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.dependencies['sanitize-html'], '2.17.5', 'sanitize-html must be exact-pinned');
  for (const k of ['launder', 'postcss', 'nanoid', 'source-map-js']) {
    assert.ok(pkg.overrides && pkg.overrides[k], `overrides must pin ${k} (age gate)`);
  }
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.strictEqual(lock.packages['node_modules/sanitize-html'].version, '2.17.5');

  const added = [
    'sanitize-html', 'htmlparser2', 'domhandler', 'domutils', 'dom-serializer', 'domelementtype', 'entities',
    'deepmerge', 'escape-string-regexp', 'is-plain-object', 'launder', 'dayjs', 'parse-srcset', 'postcss',
    'nanoid', 'picocolors', 'source-map-js',
  ];
  for (const name of added) {
    const dir = path.join(ROOT, 'node_modules', name);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const hook of ['preinstall', 'install', 'postinstall']) {
      assert.ok(!(meta.scripts && meta.scripts[hook]), `${name} must not carry a ${hook} script`);
    }
    assert.ok(!lock.packages['node_modules/' + name] || !lock.packages['node_modules/' + name].hasInstallScript, `${name} must not be flagged hasInstallScript`);
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else assert.ok(!p.endsWith('.node') && e.name !== 'binding.gyp', `${p} must not be native code`);
      }
    }
  }
});

test('sanitize-html supply chain: the whole resolved tree loads without require(esm)', () => {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['--no-experimental-require-module', '-e', "require('sanitize-html')('<p>ok</p>')"], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
});

test('sanitize-html source: lib/sanitizeHtml.js carries no regex sanitizer body and loads the parser exactly once', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'sanitizeHtml.js'), 'utf8');
  assert.strictEqual(src.split('.replace(/').length - 1, 0, 'no .replace(/ regex sanitizer may remain');
  assert.strictEqual(src.split("require('sanitize-html')").length - 1, 1, 'the vendored parser is required exactly once');
  assert.ok(src.includes("require('./htmlPolicy')"), 'the allowlist is imported, never duplicated');
});

test('sanitize-html policy: the table never allows the PRD never-list', () => {
  for (const t of policy.NEVER_ALLOWED_TAGS) assert.ok(!policy.ALLOWED_TAGS.includes(t), `${t} must not be allowed`);
  for (const t of policy.DROP_WITH_CONTENT_TAGS) assert.ok(!policy.ALLOWED_TAGS.includes(t), `${t} drop-with-content tag must not be allowed`);
  const attrs = new Set(policy.GLOBAL_ATTRIBUTES);
  Object.values(policy.ALLOWED_ATTRIBUTES).forEach((l) => l.forEach((a) => attrs.add(a)));
  for (const a of attrs) {
    assert.ok(!a.startsWith(policy.NEVER_ALLOWED_ATTRIBUTE_PREFIX), `${a} looks like an event handler`);
    assert.ok(!policy.NEVER_ALLOWED_ATTRIBUTES.includes(a), `${a} is never allowed`);
  }
  assert.ok(!policy.IMG_SCHEMES.includes('javascript'));
  assert.ok(!policy.DATA_IMAGE_MIME.includes('svg+xml'));
  assert.ok(!('position' in policy.ALLOWED_STYLES['*']));
});

// gsd:task2-append-point
