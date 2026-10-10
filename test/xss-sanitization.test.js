// VAL-02/D-15: proves write-time sanitization of HTML-bearing fields
// (lib/sanitizeHtml.js via validators/index.js's htmlField()/
// applySanitization(), applied to validators/cms.js's PageUpsertSchema.body
// and PageBlockDataSchema.html) round-trips a dangerous payload inert while
// benign markup survives; a plain-text field (page `title`, deliberately
// NOT tagged) round-trips byte-identical, since mangling a plain-text field
// would itself be a data-integrity bug; a null/absent/non-string value in a
// tagged field stores as an empty string, never a stringified placeholder;
// mixed-case and a whitespace-split attribute variant are both neutralized;
// an entity-encoded variant is stored inert as text (never decoded into an
// executable construct by the write path).
//
// 13-01 (SAFE-01): the sanitizer is now a vendored allowlist parser
// (lib/htmlPolicy.js + sanitize-html), so the residual limitation this suite
// used to document (T-03-36, nested-tag reconstruction) is retired and its
// case inverted; assertions that pinned the regex's literal output are
// re-stated as structural inertness (test/helpers/html-inert.js).
//
// Boots the REAL requireable app against an isolated temp control/runtime/
// demo trio, the same pattern every write-validation test in this repo uses.

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-xss-sanitization-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}
function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-xss-sanitization-split-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
// Phase 11 / 11-04: gate denials are audited — keep them out of data/audit.db.
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
const { inertViolations } = require('./helpers/html-inert.js');

function cookieHeader(token) { return `ma_session=${token}`; }
// D-11-02 (Phase 11): page/CMS writes are admin-only now, so every CMS write in
// this suite is authored by the admin identity. What is under test — that the
// write path sanitizes HTML-bearing fields and never mangles plain text — does
// not depend on which role authored the page.
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}

test.after(() => {
  cleanupDbFile(SOURCE_DB_PATH);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('xss-sanitization (a): a page body round-trips with script/handler/js-href removed and benign markup intact', async () => {
  const token = newSession('admin', 'admin');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const dangerous = '<p>Welcome</p><script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">click</a><b>bold text</b>';
    const slug = 'xss-roundtrip-' + Date.now();
    const postRes = await fetch(`http://127.0.0.1:${port}/api/pages`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, body: { en: dangerous } }),
    });
    assert.strictEqual(postRes.status, 200);

    const getRes = await fetch(`http://127.0.0.1:${port}/api/pages?slug=${slug}`, { headers: { Cookie: cookieHeader(token) } });
    const page = await getRes.json();
    const stored = page.body.en;

    // 13-01 (SAFE-01): structural inertness (parse + allowlist walk) replaces
    // the regex-on-output assertions of the regex-sanitizer era.
    assert.deepStrictEqual(inertViolations(stored), [], 'script tag, event handler and javascript: href must all be neutralized');
    assert.ok(stored.includes('<p>Welcome</p>'), 'benign <p> markup must survive');
    assert.ok(stored.includes('<b>bold text</b>'), 'benign <b> markup must survive');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('xss-sanitization (b): a plain-text (untagged) field round-trips byte-identical — mangling it would itself be a bug', async () => {
  const token = newSession('admin', 'admin');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    // `title` is deliberately NOT htmlField()-tagged (rendered as plain text
    // client-side) — a script-tag-shaped VALUE must survive verbatim as
    // text; it is inert only because the render path never treats it as
    // markup (textContent), not because the write path mangled it.
    const plainValue = 'Target & Co <script>not-markup-here</script>';
    const slug = 'xss-plaintext-' + Date.now();
    const postRes = await fetch(`http://127.0.0.1:${port}/api/pages`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, title: { en: plainValue } }),
    });
    assert.strictEqual(postRes.status, 200);

    const getRes = await fetch(`http://127.0.0.1:${port}/api/pages?slug=${slug}`, { headers: { Cookie: cookieHeader(token) } });
    const page = await getRes.json();
    assert.strictEqual(page.title.en, plainValue, 'an untagged plain-text field must round-trip byte-identical, never sanitized');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('xss-sanitization (c): null, absent and non-string values in a tagged field all store as an empty string', async () => {
  const token = newSession('admin', 'admin');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();

    // Null value in the tagged `body` record.
    const nullSlug = 'xss-null-' + Date.now();
    await fetch(`http://127.0.0.1:${port}/api/pages`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: nullSlug, body: { en: null } }),
    });
    const nullPage = await (await fetch(`http://127.0.0.1:${port}/api/pages?slug=${nullSlug}`, { headers: { Cookie: cookieHeader(token) } })).json();
    assert.strictEqual(nullPage.body.en, '', 'a null value in a tagged field must store as an empty string');

    // Absent `body` entirely — the module-level sanitizeValue() unit check
    // (applySanitization is exercised end-to-end above; this proves the
    // pure function's own absent-value contract directly).
    const { applySanitization, htmlField } = require('../validators/index.js');
    const { z } = require('zod');
    const schema = z.object({ body: htmlField(z.string().max(100)).optional() });
    assert.strictEqual(applySanitization(schema, {}).body, '', 'an absent tagged field must resolve to an empty string, not stay undefined');
    assert.strictEqual(applySanitization(schema, { body: 42 }).body, '', 'a non-string value in a tagged field must store as an empty string, never a stringified placeholder like "42"');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('xss-sanitization (d): a mixed-case script tag and a whitespace-split event-handler attribute are both neutralized', async () => {
  const token = newSession('admin', 'admin');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    // Mixed-case tag name.
    const mixedCase = '<ScRiPt>alert(1)</ScRiPt><p>after</p>';
    const mixedSlug = 'xss-mixedcase-' + Date.now();
    await fetch(`http://127.0.0.1:${port}/api/pages`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: mixedSlug, body: { en: mixedCase } }),
    });
    const mixedPage = await (await fetch(`http://127.0.0.1:${port}/api/pages?slug=${mixedSlug}`, { headers: { Cookie: cookieHeader(token) } })).json();
    assert.deepStrictEqual(inertViolations(mixedPage.body.en), [], 'a mixed-case <ScRiPt> tag must be neutralized');
    assert.ok(mixedPage.body.en.includes('<p>after</p>'), 'benign markup after it must survive');

    // Whitespace (including a newline) split across the attribute name/=/value
    // — HTML-legal syntax (whitespace around `=` is permitted by the spec),
    // which the ported regex's `\s*` DOES span.
    const attrSplit = '<img src=x onclick\n=\n"alert(1)">';
    const attrSlug = 'xss-attrsplit-' + Date.now();
    await fetch(`http://127.0.0.1:${port}/api/pages`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: attrSlug, body: { en: attrSplit } }),
    });
    const attrPage = await (await fetch(`http://127.0.0.1:${port}/api/pages?slug=${attrSlug}`, { headers: { Cookie: cookieHeader(token) } })).json();
    assert.deepStrictEqual(inertViolations(attrPage.body.en), [], 'a whitespace-split onclick= attribute (HTML-legal syntax) must still be neutralized');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('xss-sanitization (e): an entity-encoded variant is stored inert as text, never decoded into an executable construct', async () => {
  const token = newSession('admin', 'admin');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const encoded = '&lt;script&gt;alert(1)&lt;/script&gt;';
    const slug = 'xss-entity-' + Date.now();
    await fetch(`http://127.0.0.1:${port}/api/pages`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, body: { en: encoded } }),
    });
    const page = await (await fetch(`http://127.0.0.1:${port}/api/pages?slug=${slug}`, { headers: { Cookie: cookieHeader(token) } })).json();
    // The write path must never DECODE entities into a live tag — the
    // stored value stays exactly the encoded text it was submitted as, so
    // it can only ever render as inert text, never as markup.
    assert.strictEqual(page.body.en, encoded, 'an entity-encoded payload must not be decoded by the write path');
    assert.deepStrictEqual(inertViolations(page.body.en), [], 'no live <script> element may appear in the stored value');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

// ---------------------------------------------------------------------------
// The Phase 3 "KNOWN RESIDUAL LIMITATION" (T-03-36 / 03-RESEARCH.md
// Assumptions Log A1) is RETIRED by 13-01 (SAFE-01 / D-13-01 / R1-03): the
// regex sanitizer stripped substrings in a single pass, so a payload built so
// that stripping the inner match reconstructed a dangerous tag survived. The
// replacement is a real allowlist parser that re-serializes, so the same
// payload can only survive as inert text. This case is the inversion of the
// old gap-documenting assertion.
// ---------------------------------------------------------------------------
test('xss-sanitization: a nested-tag reconstruction payload is neutralized by the parser (T-03-36 residual limitation retired)', () => {
  const payload = '<scr<script>ipt>alert(1)</scr</script>ipt>';
  const result = sanitizeHtml(payload);
  assert.deepStrictEqual(inertViolations(result), [], `must be structurally inert, got ${JSON.stringify(result)}`);
  assert.ok(!result.toLowerCase().includes('<script'), 'no literal <script open tag may be reconstructed');
  assert.strictEqual(sanitizeHtml(result), result, 'and the output is idempotent');
});
