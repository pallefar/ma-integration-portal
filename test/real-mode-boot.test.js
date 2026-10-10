// D-10-01 / D-10-08a (Phase 10, plan 01) — TRACER: `MA_MODE=real` boots the
// real requireable app against an EMPTY data directory, seeds an account-less
// control.db + a demo.db copy into a private (0700) directory, reports
// mode=real on the unauthenticated GET /api/auth/mode probe, and never
// touches the committed data/control.db or data/demo.db (sha256 unchanged).
//
// The environment is configured BEFORE require('../server.js'): db/dbFiles.js
// resolves the mode and every path once, at require time. Each test file runs
// in its own process under `node --test`, so this cannot leak into siblings.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { listenLocal } = require('./helpers/listen-local');

const REPO = path.join(__dirname, '..');
// -shm is deliberately excluded: it is the volatile wal-index SQLite maintains
// for any reader and carries no database content.
const COMMITTED = ['control.db', 'control.db-wal', 'demo.db', 'demo.db-wal']
  .map((n) => path.join(REPO, 'data', n));

// An absent file and a zero-length one are the same state: a sibling test
// process (dev mode, run in parallel by `node --test`) may legitimately OPEN the
// committed demo.db read-side and leave an empty -wal sidecar behind. What
// this test guards is CONTENT — a real write lands as non-empty bytes.
function sha256OrAbsent(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return 'empty'; }
  return buf.length === 0 ? 'empty' : crypto.createHash('sha256').update(buf).digest('hex');
}
const BEFORE = COMMITTED.map(sha256OrAbsent);

for (const key of Object.keys(process.env)) {
  if (/^MA_.*_PATH$/.test(key) || key === 'MA_DEALS_DIR') delete process.env[key];
}
delete process.env.DEMO_OPEN;
delete process.env.ADMIN_TOKEN;

const PARENT = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-real-boot-'));
const DATA_DIR = path.join(PARENT, 'real-data'); // deliberately does NOT exist yet
process.env.MA_MODE = 'real';
process.env.MA_DATA_DIR = DATA_DIR;

const app = require('../server.js');
const dbFiles = require('../db/dbFiles.js');

test.after(() => {
  try { fs.rmSync(PARENT, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('real-mode boot: GET /api/auth/mode reports mode real, not demo-open, accounts writable', async () => {
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/mode`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('cache-control') || '', /no-store/);
    assert.deepStrictEqual(await res.json(), { mode: 'real', demoOpen: false, accountsWritable: true });

    // The demo password must not authenticate anything on a real host: there
    // are no accounts at all (T-10-02).
    const demoPassword = /const DEMO_PASSWORD = '([^']+)'/.exec(
      fs.readFileSync(path.join(REPO, 'scripts', 'set-admin-password.js'), 'utf8')
    )[1];
    const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: demoPassword }),
    });
    assert.strictEqual(login.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('real-mode boot: data dir is private and seeded — control.db has no accounts/deals, demo.db copied', () => {
  assert.strictEqual(dbFiles.DATA_DIR, DATA_DIR);
  assert.ok(fs.existsSync(path.join(DATA_DIR, 'control.db')), 'control.db must be seeded on first boot');
  assert.ok(fs.existsSync(path.join(DATA_DIR, 'demo.db')), 'demo.db must be copied on first boot');
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(DATA_DIR).mode & 0o777, 0o700, 'real-mode data dir must be 0700');
  }
  const conn = new Database(path.join(DATA_DIR, 'control.db'), { readonly: true });
  try {
    assert.strictEqual(conn.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0, 'seeded control.db must carry no accounts');
    assert.strictEqual(conn.prepare('SELECT COUNT(*) AS n FROM deals').get().n, 0, 'seeded control.db must carry no deals');
    assert.ok(
      conn.prepare("SELECT 1 FROM app_state WHERE key = 'controlSettings'").get(),
      'app_state controlSettings must survive the seed (schema + app_state kept)'
    );
  } finally {
    conn.close();
  }
  const leftovers = fs.readdirSync(DATA_DIR).filter((n) => n.startsWith('.seeding-'));
  assert.deepStrictEqual(leftovers, [], 'no .seeding-* temp file may remain');
});

test('real-mode boot: openDbFile() refuses the committed control.db / demo.db (second line of defence)', () => {
  assert.throws(
    () => dbFiles.openDbFile(dbFiles.COMMITTED_CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH),
    /\[security\].*committed/
  );
  assert.throws(
    () => dbFiles.openDbFile(dbFiles.COMMITTED_DEMO_DB_PATH, dbFiles.DEAL_SCHEMA_PATH),
    /\[security\].*committed/
  );
  assert.strictEqual(dbFiles.isCommittedControlDbActive(), false);
  assert.strictEqual(dbFiles.IS_REAL_MODE, true);
  assert.strictEqual(dbFiles.MODE, 'real');
});

test('real-mode boot: the committed data/control.db and data/demo.db are byte-for-byte unchanged', () => {
  const after = COMMITTED.map(sha256OrAbsent);
  assert.deepStrictEqual(after, BEFORE, 'a real-mode boot must never write a committed database file (or its sidecars)');
});
