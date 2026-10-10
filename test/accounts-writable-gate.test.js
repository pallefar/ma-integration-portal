// D-10-01 / D-10-03 (Phase 10, plan 03) — parity between the client-facing flag
// GET /api/auth/mode `accountsWritable` and the server's refusal of every
// control.db account write.
//
//   A. dev mode, NO MA_CONTROL_DB_PATH: the committed data/control.db is the
//      active control database. accountsWritable is false, and POST
//      /api/admin/users, PATCH /api/admin/users/:u, POST
//      /api/admin/users/:u/reset-password and POST /api/auth/change-password
//      each answer 403 {committedControlDb:true}; reads (GET /api/admin/users)
//      still work; the committed main file and its -wal never change.
//   B. (child process — the committed-control boot must not share module state
//      with a temp-copy boot) MA_CONTROL_DB_PATH on a temp copy:
//      accountsWritable is true and the same POST answers 201.
//
// An absent and a zero-length -wal sidecar are the same state (a parallel test
// process reading the committed file legitimately leaves an empty -wal); a
// real write lands as non-empty bytes or changes the main file.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const sessionsDb = require('../db/sessions');
const { listenLocal } = require('./helpers/listen-local');

const REPO = path.join(__dirname, '..');
const RUNTIME_SCHEMA = path.join(REPO, 'db', 'runtime-schema.sql');
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-accounts-writable-'));

test.after(() => {
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

function fileState(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return 'empty'; }
  return buf.length === 0 ? 'empty' : crypto.createHash('sha256').update(buf).digest('hex');
}
function committedControlState() {
  return [fileState(path.join(REPO, 'data', 'control.db')), fileState(path.join(REPO, 'data', 'control.db-wal'))];
}

function tempPaths(label) {
  const dir = path.join(TMP_ROOT, label);
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    runtime: path.join(dir, 'runtime.db'),
    demo: path.join(dir, 'demo.db'),
    audit: path.join(dir, 'audit.db'),
    deals: path.join(dir, 'deals'),
  };
}

// --- A. committed control.db active ------------------------------------------

const A = tempPaths('a-committed');
const COMMITTED_BEFORE = committedControlState();
process.env.MA_RUNTIME_DB_PATH = A.runtime;
process.env.MA_DEMO_DB_PATH = A.demo;
process.env.MA_AUDIT_DB_PATH = A.audit;
process.env.MA_DEALS_DIR = A.deals;
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'MA_CONTROL_DB_PATH', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const app = require('../server.js');

// The admin session is created DIRECTLY on the temp runtime.db — logging in
// would be a write path next to the committed control file.
function adminCookie() {
  const conn = new Database(A.runtime);
  try {
    conn.exec(fs.readFileSync(RUNTIME_SCHEMA, 'utf8'));
    return 'ma_session=' + sessionsDb.createSession(conn, { username: 'admin', role: 'admin', ttlMs: 600000 });
  } finally {
    conn.close();
  }
}

test('accounts-writable parity (A): accountsWritable:false <=> every account write is 403 {committedControlDb:true}; reads still work', async () => {
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const mode = await (await fetch(base + '/api/auth/mode')).json();
    assert.strictEqual(mode.accountsWritable, false);

    const cookie = adminCookie();
    const send = (method, route, body) => fetch(base + route, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const writes = [
      ['POST', '/api/admin/users', { username: 'newperson', name: 'New Person', role: 'pmo' }],
      ['PATCH', '/api/admin/users/karen', { role: 'pmo' }],
      ['POST', '/api/admin/users/karen/reset-password', {}],
      ['POST', '/api/auth/change-password', { currentPassword: 'whatever-current', newPassword: 'another-long-password' }],
    ];
    for (const [method, route, body] of writes) {
      const res = await send(method, route, body);
      assert.strictEqual(res.status, 403, `${method} ${route} must be refused`);
      const json = await res.json();
      assert.strictEqual(json.committedControlDb, true, `${method} ${route} must carry committedControlDb:true`);
    }

    const list = await send('GET', '/api/admin/users');
    assert.strictEqual(list.status, 200, 'listing accounts is a read and must keep working');
    const users = await list.json();
    assert.ok(users.some((u) => u.username === 'karen'));
    assert.ok(users.every((u) => !('hash' in u) && !('salt' in u)));

    const sessionsList = await send('GET', '/api/auth/sessions');
    assert.notStrictEqual(sessionsList.status, 403, 'own-session listing is not an account write');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('accounts-writable parity (A): the committed data/control.db (main file and -wal) is unchanged', () => {
  assert.deepStrictEqual(committedControlState(), COMMITTED_BEFORE);
});

// --- B. temp copy: writable --------------------------------------------------

test('accounts-writable parity (B): with MA_CONTROL_DB_PATH on a temp copy accountsWritable is true and the same POST succeeds', () => {
  const B = tempPaths('b-copy');
  const controlCopy = path.join(B.dir, 'control.db');
  fs.copyFileSync(path.join(REPO, 'data', 'control.db'), controlCopy);
  const before = committedControlState();

  const script = `
    const app = require('./server.js');
    const sessions = require('./db/sessions');
    const store = require('./db/store');
    const dbFiles = require('./db/dbFiles');
    const conn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
    const token = sessions.createSession(conn, { username: 'admin', role: 'admin', ttlMs: 600000 });
    const server = app.listen(0, '127.0.0.1', async () => {
      try {
        const base = 'http://127.0.0.1:' + server.address().port;
        const mode = await (await fetch(base + '/api/auth/mode')).json();
        const res = await fetch(base + '/api/admin/users', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: 'ma_session=' + token },
          body: JSON.stringify({ username: 'newperson', name: 'New Person', role: 'pmo' }),
        });
        const body = await res.json();
        process.stdout.write('RESULT ' + JSON.stringify({ mode, status: res.status, user: body.user && body.user.username }) + '\\n');
      } catch (e) {
        process.stdout.write('RESULT ' + JSON.stringify({ error: String(e && e.message) }) + '\\n');
      }
      server.close();
      process.exit(0);
    });
  `;
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('MA_') || key === 'DEMO_OPEN' || key === 'ADMIN_TOKEN') delete env[key];
  }
  const res = spawnSync(process.execPath, ['-e', script], {
    cwd: REPO, encoding: 'utf8', timeout: 60000, input: '',
    env: {
      ...env,
      MA_CONTROL_DB_PATH: controlCopy,
      MA_RUNTIME_DB_PATH: B.runtime, MA_DEMO_DB_PATH: B.demo, MA_AUDIT_DB_PATH: B.audit, MA_DEALS_DIR: B.deals,
    },
  });
  assert.strictEqual(res.status, 0, res.stderr);
  const line = res.stdout.split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, res.stdout + res.stderr);
  const out = JSON.parse(line.slice('RESULT '.length));
  assert.deepStrictEqual(out.mode, { mode: 'dev', demoOpen: false, accountsWritable: true });
  assert.strictEqual(out.status, 201);
  assert.strictEqual(out.user, 'newperson');
  assert.deepStrictEqual(committedControlState(), before, 'the committed control.db must not be touched');
});
