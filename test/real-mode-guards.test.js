// D-10-01 / D-10-02 (Phase 10, plan 01) — committed-file protections.
//
//   A. dev mode with the committed data/control.db ACTIVE: a real deal and a
//      credential change are refused (403), /api/auth/mode says
//      accountsWritable:false, and the committed file never changes.
//   B. dev mode with MA_CONTROL_DB_PATH on a temp copy: deal creation still
//      works and accountsWritable is true (existing suites unaffected).
//   C. boot refusals (child processes): bogus MA_MODE, real+DEMO_OPEN,
//      real+committed data dir, real+committed control path; MA_*_PATH
//      overrides still win over MA_DATA_DIR.
//   D. scripts/set-admin-password.js acts on a real temp data directory.
//
// Nothing here may modify the committed data/*.db. Section A hashes the
// committed control.db AND its -wal sidecar (a write to a WAL-mode file can
// land only in the -wal and leave the main file's hash unchanged); an absent
// and a zero-length sidecar are the same state, because a parallel test
// process reading the committed file legitimately leaves an empty -wal.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const sessionsDb = require('../db/sessions');
const passwords = require('../lib/passwords');
const { listenLocal } = require('./helpers/listen-local');

const REPO = path.join(__dirname, '..');
const RUNTIME_SCHEMA = path.join(REPO, 'db', 'runtime-schema.sql');
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-real-guards-'));
const NEW_FORMAT_RE = /^scrypt\$n=131072,r=8,p=1\$[0-9a-f]{32}\$[0-9a-f]{64}$/;

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

function cleanEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('MA_') || key === 'DEMO_OPEN' || key === 'ADMIN_TOKEN') delete env[key];
  }
  return { ...env, ...extra };
}

function child(code, env, timeout = 30000) {
  return spawnSync(process.execPath, ['-e', code], {
    cwd: REPO, env: cleanEnv(env), encoding: 'utf8', timeout, input: '',
  });
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

// --- A. committed control.db active (dev mode, no MA_CONTROL_DB_PATH) -------

const A = tempPaths('a-dev');
const COMMITTED_BEFORE = committedControlState();
process.env.MA_RUNTIME_DB_PATH = A.runtime;
process.env.MA_DEMO_DB_PATH = A.demo;
process.env.MA_AUDIT_DB_PATH = A.audit;
process.env.MA_DEALS_DIR = A.deals;
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'MA_CONTROL_DB_PATH', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];
// [security] D-12-06: section A's whole point is the committed control.db being
// the ACTIVE control database, so it explicitly opts in to the test-isolation
// guard's one exemption (data/control.db only — runtime/audit/demo/deals stay
// temp above). The committed main file and -wal are hashed before/after below.
process.env.MA_TEST_ALLOW_COMMITTED_CONTROL_DB = '1';

let app;
function loadApp() {
  if (!app) app = require('../server.js');
  return app;
}

// The admin session is created DIRECTLY on the temp runtime.db — logging in
// would be a write path into the committed control file.
function adminCookie() {
  const conn = new Database(A.runtime);
  try {
    conn.exec(fs.readFileSync(RUNTIME_SCHEMA, 'utf8'));
    return 'ma_session=' + sessionsDb.createSession(conn, { username: 'admin', role: 'admin', ttlMs: 600000 });
  } finally {
    conn.close();
  }
}

test('guards (A): GET /api/auth/mode reports accountsWritable:false while the committed control.db is active', async () => {
  const server = await listenLocal(loadApp());
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    let body = await (await fetch(base + '/api/auth/mode')).json();
    assert.deepStrictEqual(body, { mode: 'dev', demoOpen: false, accountsWritable: false });

    process.env.DEMO_OPEN = '1'; // toggled at runtime, exactly as existing suites do
    try {
      body = await (await fetch(base + '/api/auth/mode')).json();
      assert.deepStrictEqual(body, { mode: 'demo', demoOpen: true, accountsWritable: false });
    } finally {
      delete process.env.DEMO_OPEN;
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('guards (A): POST /api/deals and POST /api/auth/change-password are refused 403 on the committed control.db', async () => {
  const server = await listenLocal(loadApp());
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const cookie = adminCookie();
    const post = (route, body) => fetch(base + route, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
    });

    const deal = await post('/api/deals', { name: 'Project Guard', targetCompany: 'Guard Target Inc' });
    assert.strictEqual(deal.status, 403);
    const dealBody = await deal.json();
    assert.strictEqual(dealBody.realModeRequired, true);
    assert.match(dealBody.error, /start-real-deal/);

    const change = await post('/api/auth/change-password', { currentPassword: 'whatever-current', newPassword: 'another-long-password' });
    assert.strictEqual(change.status, 403);
    assert.strictEqual((await change.json()).committedControlDb, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('guards (A): the committed data/control.db (main file and -wal) is unchanged after every refusal', () => {
  assert.deepStrictEqual(committedControlState(), COMMITTED_BEFORE);
});

// --- B. temp control.db copy: everything still works -------------------------

test('guards (B): with MA_CONTROL_DB_PATH on a temp copy, accountsWritable is true and deal creation succeeds', () => {
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
        const res = await fetch(base + '/api/deals', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: 'ma_session=' + token },
          body: JSON.stringify({ name: 'Project Copy', targetCompany: 'Copy Target Inc' }),
        });
        const body = await res.json();
        process.stdout.write('RESULT ' + JSON.stringify({ mode, status: res.status, deal: !!(body && body.deal) }) + '\\n');
      } catch (e) {
        process.stdout.write('RESULT ' + JSON.stringify({ error: String(e && e.message) }) + '\\n');
      }
      server.close();
      process.exit(0);
    });
  `;
  const res = child(script, {
    MA_CONTROL_DB_PATH: controlCopy,
    MA_RUNTIME_DB_PATH: B.runtime, MA_DEMO_DB_PATH: B.demo, MA_AUDIT_DB_PATH: B.audit, MA_DEALS_DIR: B.deals,
  });
  assert.strictEqual(res.status, 0, res.stderr);
  const line = res.stdout.split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, 'child must report a RESULT line: ' + res.stdout + res.stderr);
  const out = JSON.parse(line.slice('RESULT '.length));
  assert.deepStrictEqual(out.mode, { mode: 'dev', demoOpen: false, accountsWritable: true });
  assert.strictEqual(out.status, 200);
  assert.strictEqual(out.deal, true);
  assert.deepStrictEqual(committedControlState(), before, 'the committed control.db must not be touched');
});

// --- C. boot refusals and override precedence --------------------------------

function assertSecurityRefusal(res, label) {
  assert.notStrictEqual(res.status, 0, `${label}: must exit non-zero`);
  assert.match(res.stderr, /\[security\]/, `${label}: refusal must carry the [security] label — got: ${res.stderr.slice(0, 300)}`);
}

test('guards (C): an unrecognised MA_MODE value refuses to boot', () => {
  assertSecurityRefusal(child("require('./db/dbFiles')", { MA_MODE: 'bogus' }), 'MA_MODE=bogus');
  assertSecurityRefusal(child("require('./db/dbFiles')", { MA_MODE: 'REAL' }), 'MA_MODE=REAL');
});

test('guards (C): MA_MODE=real together with DEMO_OPEN=1 refuses to boot', () => {
  assertSecurityRefusal(child("require('./db/dbFiles')", { MA_MODE: 'real', DEMO_OPEN: '1' }), 'real+DEMO_OPEN');
});

test('guards (C): MA_MODE=real with MA_DATA_DIR on the committed data directory refuses to boot', () => {
  assertSecurityRefusal(
    child("require('./db/dbFiles')", { MA_MODE: 'real', MA_DATA_DIR: path.join(REPO, 'data') }),
    'real + committed data dir'
  );
});

test('guards (C): MA_MODE=real with MA_CONTROL_DB_PATH on the committed control.db refuses to boot and creates nothing', () => {
  const dataDir = path.join(TMP_ROOT, 'c-refuse', 'data');
  const res = child("require('./server.js')", {
    MA_MODE: 'real', MA_DATA_DIR: dataDir, MA_CONTROL_DB_PATH: path.join(REPO, 'data', 'control.db'),
  });
  assertSecurityRefusal(res, 'real + committed control path');
  assert.ok(!fs.existsSync(dataDir), 'the refusal must precede any directory creation');
});

test('guards (C): MA_*_PATH overrides keep winning over MA_DATA_DIR', () => {
  const tmpA = path.join(TMP_ROOT, 'c-over-a');
  const tmpB = path.join(TMP_ROOT, 'c-over-b');
  const res = child(
    "const d = require('./db/dbFiles'); process.stdout.write(JSON.stringify({ c: d.CONTROL_DB_PATH, r: d.RUNTIME_DB_PATH, a: d.AUDIT_DB_PATH, dir: d.DATA_DIR, mode: d.MODE }));",
    { MA_MODE: 'real', MA_DATA_DIR: tmpA, MA_CONTROL_DB_PATH: path.join(tmpB, 'control.db') }
  );
  assert.strictEqual(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.strictEqual(out.mode, 'real');
  assert.strictEqual(out.dir, tmpA);
  assert.strictEqual(out.c, path.join(tmpB, 'control.db'));
  assert.strictEqual(out.r, path.join(tmpA, 'runtime.db'));
  assert.strictEqual(out.a, path.join(tmpA, 'audit.db'));
});

test('guards (C): dev/demo path resolution is unchanged when MA_MODE is unset', () => {
  const res = child(
    "const d = require('./db/dbFiles'); process.stdout.write(JSON.stringify({ c: d.CONTROL_DB_PATH, dm: d.DEMO_DB_PATH, real: d.IS_REAL_MODE, mode: d.MODE }));",
    {}
  );
  assert.strictEqual(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.strictEqual(out.c, path.join(REPO, 'data', 'control.db'));
  assert.strictEqual(out.dm, path.join(REPO, 'data', 'demo.db'));
  assert.strictEqual(out.real, false);
  assert.strictEqual(out.mode, 'dev');
});

// --- D. scripts/set-admin-password.js on a real temp data directory ---------

test('guards (D): set-admin-password rotates admin on the real data dir (new hash, sessions revoked, cli audit event, >=12 enforced)', () => {
  const dataDir = path.join(TMP_ROOT, 'd-real', 'data');
  const seed = child(
    "require('./scripts/bootstrap-admin').run({ password: process.env.MA_BOOTSTRAP_PASSWORD }).catch((e) => { console.error(e.message); process.exit(1); })",
    { MA_MODE: 'real', MA_DATA_DIR: dataDir, MA_BOOTSTRAP_PASSWORD: 'seeded-admin-password-1' },
    60000
  );
  assert.strictEqual(seed.status, 0, seed.stderr);

  // A live admin session minted before the rotation.
  const runtime = new Database(path.join(dataDir, 'runtime.db'));
  try {
    runtime.exec(fs.readFileSync(RUNTIME_SCHEMA, 'utf8'));
    sessionsDb.createSession(runtime, { username: 'admin', role: 'admin', ttlMs: 600000 });
  } finally {
    runtime.close();
  }

  const cli = (password) => spawnSync(process.execPath, [path.join(REPO, 'scripts', 'set-admin-password.js')], {
    env: cleanEnv({ MA_MODE: 'real', MA_DATA_DIR: dataDir, ADMIN_PASSWORD: password }),
    encoding: 'utf8', timeout: 60000, input: '',
  });
  const readAdmin = () => {
    const conn = new Database(path.join(dataDir, 'control.db'), { readonly: true });
    try { return JSON.parse(conn.prepare("SELECT data FROM users WHERE id = 'admin'").get().data); } finally { conn.close(); }
  };

  const before = readAdmin();
  const tooShort = cli('short-1234');
  assert.notStrictEqual(tooShort.status, 0, 'a password under 12 characters must be refused');
  assert.strictEqual(readAdmin().hash, before.hash, 'a refused rotation changes nothing');

  const argv = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'set-admin-password.js'), 'hunter2-hunter2'], {
    env: cleanEnv({ MA_MODE: 'real', MA_DATA_DIR: dataDir, ADMIN_PASSWORD: 'rotated-admin-password-9' }),
    encoding: 'utf8', timeout: 60000, input: '',
  });
  assert.notStrictEqual(argv.status, 0, 'a positional argument (would-be password) must be refused');
  assert.strictEqual(readAdmin().hash, before.hash);

  const ok = cli('rotated-admin-password-9');
  assert.strictEqual(ok.status, 0, ok.stderr || ok.stdout);
  const after = readAdmin();
  assert.notStrictEqual(after.hash, before.hash);
  assert.match(after.hash, NEW_FORMAT_RE);
  assert.strictEqual(after.mustChangePassword, false);
  assert.strictEqual(after.disabled, false);
  assert.strictEqual(passwords.verifyPasswordSync('rotated-admin-password-9', after).ok, true);

  const rt = new Database(path.join(dataDir, 'runtime.db'), { readonly: true });
  try {
    assert.strictEqual(rt.prepare("SELECT COUNT(*) AS n FROM sessions WHERE username = 'admin'").get().n, 0);
  } finally {
    rt.close();
  }
  const audit = new Database(path.join(dataDir, 'audit.db'), { readonly: true });
  try {
    const rows = audit.prepare('SELECT actor_username, action, row_id FROM audit_log ORDER BY id').all();
    const last = rows[rows.length - 1];
    assert.strictEqual(last.action, 'admin-password-set');
    assert.ok(last.actor_username.startsWith('cli:'));
    assert.strictEqual(last.row_id, 'admin');
  } finally {
    audit.close();
  }
});

test('guards (D): set-admin-password refuses when the active control database is the committed one', () => {
  const res = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'set-admin-password.js')], {
    env: cleanEnv({
      MA_MODE: 'real', MA_DATA_DIR: path.join(TMP_ROOT, 'd-committed', 'data'),
      MA_CONTROL_DB_PATH: path.join(REPO, 'data', 'control.db'),
      ADMIN_PASSWORD: 'a-valid-long-password-1',
    }),
    encoding: 'utf8', timeout: 60000, input: '',
  });
  assertSecurityRefusal(res, 'set-admin-password on committed control');
});

test('guards: lib/passwords KNOWN_DEMO_PASSWORDS carries the published demo password of set-admin-password.js', () => {
  const { DEMO_PASSWORD } = require('../scripts/set-admin-password.js');
  assert.ok(passwords.KNOWN_DEMO_PASSWORDS.includes(DEMO_PASSWORD));
});
