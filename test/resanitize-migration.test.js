'use strict';
// D-13-01 / SAFE-01 (Phase 13, plan 13-05): deal-family migration
// 002-resanitize-html — stored HTML-bearing values re-sanitized once at boot;
// unchanged rows untouched; ordered/idempotent; fresh files stamped; the
// committed data/demo.db regenerated (rule 5) and booting ready.
//
// Temp files only: every database below lives in an os.tmpdir() directory (the
// D-12-06 isolation guard stays active). The one child-process case opens the
// committed data/demo.db the way a dev boot does, in a child WITHOUT
// NODE_TEST_CONTEXT, and asserts the file's bytes are untouched.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const dbFiles = require('../db/dbFiles');
const migrate = require('../db/migrate');
const readiness = require('../db/readiness');
const migration = require('../db/migrations/deal/002-resanitize-html');
const { sanitizeHtml } = require('../lib/sanitizeHtml');
const { cleanEnv, REPO } = require('./helpers/boot-probe');

const COMMITTED_DEMO = path.join(REPO, 'data', 'demo.db');

const dirs = [];
function tmp(label) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `gsd-13-05-${label}-`));
  dirs.push(d);
  return d;
}
process.on('exit', () => {
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
});
afterEach(() => {
  readiness._resetForTests();
  dbFiles._clearNotReadyForTests();
});

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

// A deal file exactly as a Phase-12 release left it: baseline schema, stamped 1.
function seedV1(file, seedFn) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const c = new Database(file);
  c.pragma('journal_mode = WAL');
  c.exec(fs.readFileSync(dbFiles.DEAL_SCHEMA_PATH, 'utf8'));
  if (seedFn) seedFn(c);
  c.pragma('user_version = 1');
  c.pragma('wal_checkpoint(TRUNCATE)');
  c.close();
}

function insertRow(c, table, id, seq, record) {
  c.prepare(`INSERT INTO ${table} (id, project_id, seq, data) VALUES (?, NULL, ?, ?)`).run(id, seq, JSON.stringify(record));
}

function readRows(file, table) {
  const c = new Database(file, { readonly: true });
  try { return Object.fromEntries(c.prepare(`SELECT id, data FROM ${table}`).all().map((r) => [r.id, r.data])); } finally { c.close(); }
}

function userVersion(file) {
  const c = new Database(file, { readonly: true });
  try { return c.pragma('user_version', { simple: true }); } finally { c.close(); }
}

// Run fn with console.log captured (the migration logs one line per file).
function captureLog(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };
  try { fn(); } finally { console.log = orig; }
  return lines;
}

function openDeal(file) {
  return dbFiles.openDbFile(file, dbFiles.DEAL_SCHEMA_PATH);
}

const PAYLOAD_IMG = '<img src=x onerror=alert(1)>';
const BENIGN = { id: 'C', slug: 'c', title: { en: 'C' }, body: '<p>hi</p>', published: true };

test('002 is registered as the deal family latest (id 2, slug resanitize-html)', () => {
  assert.strictEqual(migration.id, 2);
  assert.strictEqual(migration.slug, 'resanitize-html');
  const list = migrate.loadMigrations('deal');
  assert.strictEqual(list[list.length - 1].name, '002-resanitize-html');
  assert.strictEqual(migrate.latestVersion('deal'), 2);
});

test('a v1 file: malicious page bodies are cleaned and benign rows are byte-identical; second open writes nothing', () => {
  const dir = tmp('changed');
  const file = path.join(dir, 'deal.db');
  seedV1(file, (c) => {
    insertRow(c, 'pages', 'A', 1, { id: 'A', slug: 'a', title: { en: 'A' }, body: PAYLOAD_IMG, published: true });
    insertRow(c, 'pages', 'B', 2, { id: 'B', slug: 'b', title: { en: 'B' }, body: { en: '<p>ok</p>', de: '<p onclick=x>de</p>' }, published: true });
    insertRow(c, 'pages', 'C', 3, BENIGN);
  });
  const before = readRows(file, 'pages');

  const lines = captureLog(() => openDeal(file).close());
  assert.strictEqual(userVersion(file), 2);
  const after = readRows(file, 'pages');

  assert.strictEqual(after.C, before.C, 'the benign row`s data column is byte-identical');
  const a = JSON.parse(after.A);
  const b = JSON.parse(after.B);
  assert.ok(!/onerror/i.test(a.body), `A cleaned: ${a.body}`);
  assert.strictEqual(a.body, sanitizeHtml(PAYLOAD_IMG));
  assert.strictEqual(b.body.en, '<p>ok</p>');
  assert.ok(!/onclick/i.test(b.body.de), `B de cleaned: ${b.body.de}`);
  assert.deepStrictEqual(Object.keys(a).sort(), Object.keys(JSON.parse(before.A)).sort(), 'no key added or dropped');
  assert.ok(!('version' in a), 'pages are not versioned collections — the store rule stamps no version, none is invented');

  const summary = lines.find((l) => /deal\/002 resanitize-html deal-file#[0-9a-f]{8}: /.test(l));
  assert.ok(summary && /2 value\(s\) changed in 2 row\(s\)/.test(summary), `summary line: ${lines.join(' | ')}`);
  // WR-A05 (13-REVIEW): the row id is logged as sha256(id).slice(0, 8), never verbatim.
  const idTag = (id) => '#' + require('crypto').createHash('sha256').update(id).digest('hex').slice(0, 8);
  const hashLines = lines.filter((l) => /pages\/#[0-9a-f]{8} .* sha256 [0-9a-f]{64} -> [0-9a-f]{64}$/.test(l));
  assert.strictEqual(hashLines.length, 2);
  assert.deepStrictEqual(hashLines.map((l) => /pages\/(#[0-9a-f]{8}) /.exec(l)[1]).sort(), [idTag('A'), idTag('B')].sort());
  assert.ok(lines.every((l) => !/pages\/[AB]\b/.test(l)), 'no row id appears verbatim');
  assert.ok(lines.every((l) => !l.includes('onerror') && !l.includes('onclick') && !l.includes('deal.db')), 'no stored content and no file name is logged (MNPI)');

  // Idempotent: re-open does nothing — a payload planted AFTER the stamp survives the reopen
  // (proves up() did not run again) and every other byte stays identical.
  const c = new Database(file);
  insertRow(c, 'pages', 'D', 4, { id: 'D', slug: 'd', body: PAYLOAD_IMG });
  c.pragma('wal_checkpoint(TRUNCATE)');
  c.close();
  const mid = readRows(file, 'pages');
  const lines2 = captureLog(() => openDeal(file).close());
  assert.deepStrictEqual(readRows(file, 'pages'), mid, 'second open leaves every row untouched');
  assert.strictEqual(lines2.filter((l) => l.includes('deal/002')).length, 0, 'up() did not run again');
  assert.strictEqual(userVersion(file), 2);
});

test('a fresh file is stamped 2 and up() never runs', () => {
  const dir = tmp('fresh');
  const file = path.join(dir, 'deal.db');
  const lines = captureLog(() => openDeal(file).close());
  assert.strictEqual(userVersion(file), 2);
  assert.strictEqual(lines.filter((l) => l.includes('deal/002')).length, 0);
});

test('nested coverage: lessons (string + language map) and layout blocks — only payload values change', () => {
  const dir = tmp('nested');
  const file = path.join(dir, 'deal.db');
  const course = {
    id: 'crs', title: { en: 'Course' }, published: true,
    modules: [
      { id: 'm1', title: { en: 'M1' }, lessons: [
        { id: 'l1', title: { en: 'L1' }, body: PAYLOAD_IMG, xp: 5 },
        { id: 'l2', title: { en: 'L2' }, body: { en: '<p>fine</p>', de: '<script>alert(1)</script><p>x</p>' } },
      ] },
      { id: 'm2', title: { en: 'M2' }, lessons: [
        { id: 'l3', title: { en: 'L3' }, body: '<p>benign</p>' },
        { id: 'l4', title: { en: 'L4' } },
      ] },
    ],
  };
  const page = {
    id: 'P', slug: 'p', title: { en: 'P' }, body: '<p>legacy ok</p>',
    layout: [
      { id: 'b1', type: 'richtext', data: { html: PAYLOAD_IMG } },
      { id: 'b2', type: 'hero', data: { title: { en: 'Hero <b>raw</b>' }, subtitle: 'sub & <i>text</i>' } },
      { id: 'b3', type: 'richtext', data: { html: '<p>benign</p>' } },
    ],
  };
  seedV1(file, (c) => { insertRow(c, 'courses', 'crs', 1, course); insertRow(c, 'pages', 'P', 1, page); });

  captureLog(() => openDeal(file).close());
  const c2 = JSON.parse(readRows(file, 'courses').crs);
  const p2 = JSON.parse(readRows(file, 'pages').P);

  assert.strictEqual(c2.modules[0].lessons[0].body, sanitizeHtml(PAYLOAD_IMG));
  assert.strictEqual(c2.modules[0].lessons[1].body.en, '<p>fine</p>');
  assert.ok(!/<script/i.test(c2.modules[0].lessons[1].body.de));
  assert.strictEqual(c2.modules[0].lessons[0].xp, 5);
  assert.strictEqual(c2.modules[1].lessons[0].body, '<p>benign</p>');
  assert.ok(!('body' in c2.modules[1].lessons[1]), 'an absent body stays absent');

  assert.strictEqual(p2.layout[0].data.html, sanitizeHtml(PAYLOAD_IMG));
  assert.deepStrictEqual(p2.layout[1], page.layout[1], 'hero block data untouched (not an htmlField)');
  assert.deepStrictEqual(p2.layout[2], page.layout[2]);
  assert.strictEqual(p2.body, '<p>legacy ok</p>');
});

test('banners and slides are out of scope (plain text, textContent) — never rewritten', () => {
  const dir = tmp('scope');
  const file = path.join(dir, 'deal.db');
  seedV1(file, (c) => {
    insertRow(c, 'banners', 'bn', 1, { id: 'bn', title: { en: '<b>x</b>' }, message: { en: PAYLOAD_IMG } });
    insertRow(c, 'slides', 'sl', 1, { id: 'sl', title: 'T', html: PAYLOAD_IMG });
  });
  const b = readRows(file, 'banners');
  const s = readRows(file, 'slides');
  captureLog(() => openDeal(file).close());
  assert.deepStrictEqual(readRows(file, 'banners'), b);
  assert.deepStrictEqual(readRows(file, 'slides'), s);
});

test('field map equals the htmlField() inventory in validators/ (negative control: a fourth call site fails the check)', () => {
  const dir = path.join(REPO, 'validators');
  const countCalls = (src) => (src.match(/\bhtmlField\(/g) || []).length;
  let calls = 0;
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, name), 'utf8')
      // drop comment lines, then the definition and the import/export lines
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .filter((l) => !/function htmlField\(|require\('\.\/index'\)|^\s*htmlField,\s*$/.test(l))
      .join('\n');
    calls += countCalls(src);
  }
  assert.strictEqual(migration.FIELD_PATHS.length, 3);
  assert.strictEqual(calls, migration.FIELD_PATHS.length, 'a new htmlField() needs a migration-map update (and a new migration)');

  // negative control: the same scan over an input with a fourth call site disagrees
  const fake = `${'const a = htmlField(x);\n'.repeat(3)}const d = htmlField(y);`;
  assert.notStrictEqual(countCalls(fake), migration.FIELD_PATHS.length);
});

test('the committed data/demo.db is regenerated: version 2, committed path reports it with no write, zero values to change', () => {
  const dir = tmp('committed');
  const copy = path.join(dir, 'demo.db');
  const c0 = new Database(COMMITTED_DEMO, { readonly: true });
  assert.strictEqual(c0.pragma('user_version', { simple: true }), 2, 'data/demo.db is stamped at the deal latest');
  c0.close();
  fs.copyFileSync(COMMITTED_DEMO, copy);

  // 1. the runner, told this is a committed file, reports version 2 and does not write
  const conn = new Database(copy);
  const out = migrate.runMigrations(conn, { family: 'deal', file: copy, committed: true });
  assert.strictEqual(out.version, 2);
  assert.ok(!out.implied, 'real version 2, not the implied baseline');
  conn.close();

  // 2. opening through the normal path runs no migration and changes no row
  const before = { pages: readRows(copy, 'pages'), courses: readRows(copy, 'courses') };
  const lines = captureLog(() => openDeal(copy).close());
  assert.strictEqual(lines.filter((l) => l.includes('deal/002')).length, 0);
  assert.deepStrictEqual({ pages: readRows(copy, 'pages'), courses: readRows(copy, 'courses') }, before);

  // 3. nothing in the committed content would change under the sanitizer
  for (const table of ['pages', 'courses']) {
    for (const [id, raw] of Object.entries(before[table])) {
      const changes = migration.resanitizeRecord(table, JSON.parse(raw), sanitizeHtml);
      assert.deepStrictEqual(changes, [], `${table}/${id} has no value the sanitizer would change`);
    }
  }
  assert.ok(!fs.existsSync(`${COMMITTED_DEMO}-wal`) || fs.statSync(`${COMMITTED_DEMO}-wal`).size === 0, 'no pending WAL content for the committed demo.db');
});

test('dev boot against the committed data/demo.db answers /healthz ready and never writes the file', async () => {
  const dir = tmp('devboot');
  const control = path.join(dir, 'control.db');
  fs.copyFileSync(path.join(REPO, 'data', 'control.db'), control);
  const shaBefore = sha256File(COMMITTED_DEMO);
  const script = `
    const app = require('./server.js');
    const server = app.listen(0, '127.0.0.1', async () => {
      const res = await fetch('http://127.0.0.1:' + server.address().port + '/healthz');
      const body = await res.json();
      process.stdout.write('\\nHEALTH ' + JSON.stringify({ status: res.status, body }) + '\\n');
      server.close(); process.exit(0);
    });`;
  const env = cleanEnv({
    MA_CONTROL_DB_PATH: control,
    MA_RUNTIME_DB_PATH: path.join(dir, 'runtime.db'),
    MA_AUDIT_DB_PATH: path.join(dir, 'audit.db'),
    MA_DEALS_DIR: path.join(dir, 'deals'),
    MA_TEST_ALLOW_COMMITTED_CONTROL_DB: '1',
  });
  delete env.NODE_TEST_CONTEXT; // the guard exists to stop TESTS touching data/; this is the dev-boot proof
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timeout\n${stdout}\n${stderr}`)); }, 90000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  const m = /HEALTH (.*)\n/.exec(result.stdout);
  assert.ok(m, `no health line: ${result.stdout}\n${result.stderr}`);
  const health = JSON.parse(m[1]);
  assert.strictEqual(health.status, 200, JSON.stringify(health.body));
  assert.strictEqual(health.body.readiness.versions.deal.version, 2);
  assert.ok(!health.body.readiness.versions.deal.implied);
  // the committed file's main bytes are untouched by a boot
  const c = new Database(COMMITTED_DEMO);
  c.pragma('wal_checkpoint(TRUNCATE)');
  c.close();
  assert.strictEqual(sha256File(COMMITTED_DEMO), shaBefore, 'a dev boot never modifies data/demo.db');
});
