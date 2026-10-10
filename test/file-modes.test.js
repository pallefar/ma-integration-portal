// OPS-08 / R2-06 / D-10-09 (Phase 10, plan 04) — database file modes.
//
// Every database the app opens goes through db/dbFiles.js openDbFile(); that one
// choke point must leave the file 0600 (sidecars included) inside a 0700
// directory under ANY umask — here the worst realistic one, 022 (which is what
// produced the 0644 databases / 0755 deals/ directory R2-06 observed).
//
//   A. unit cases against a temp dir: create, pre-existing 0644 tighten,
//      pre-existing parent left alone, sidecars, chmod-failure policy.
//   B. whole-app children: a dev/demo boot that cannot chmod a pre-existing
//      database still serves /healthz (PRD acceptance 6); the same failure in
//      real-deal mode refuses to start.
//   C. (see the second half of this file) a real-mode instance under umask 022
//      end to end, including a deal created through the API.
//
// POSIX-only: Windows modes are not expressible, so the file skips there.
// The umask is set BEFORE anything is required.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SKIP = process.platform === 'win32' ? 'POSIX file modes are not assertable on win32' : false;
if (!SKIP) process.umask(0o022);

for (const key of Object.keys(process.env)) {
  if (/^MA_/.test(key)) delete process.env[key];
}
delete process.env.DEMO_OPEN;
delete process.env.ADMIN_TOKEN;

const Database = require('better-sqlite3');
const dbFiles = require('../db/dbFiles.js');

const REPO = path.join(__dirname, '..');
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-file-modes-'));
let seq = 0;
function tmp(label) {
  const dir = path.join(TMP_ROOT, `${label}-${++seq}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.chmodSync(dir, 0o755);
  return dir;
}
const modeOf = (p) => fs.statSync(p).mode & 0o777;
const oct = (n) => n.toString(8).padStart(4, '0');

test.after(() => {
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// Build a valid, closed, 0644 SQLite file (as an earlier umask-022 run left it).
function make0644Db(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.exec('CREATE TABLE IF NOT EXISTS t (x)');
  conn.close();
  fs.chmodSync(file, 0o644);
}

// Temporarily route fs.chmodSync through `decide(path, mode)` — return an error
// code string to throw EPERM/EROFS-style for that path, falsy to pass through.
function stubChmod(decide) {
  const original = fs.chmodSync;
  fs.chmodSync = function stubbedChmod(p, mode) {
    const code = decide(path.resolve(String(p)), mode);
    if (code) {
      const err = new Error(`${code}: simulated chmod failure, chmod '${p}'`);
      err.code = code;
      throw err;
    }
    return original.apply(this, arguments);
  };
  return () => { fs.chmodSync = original; };
}

function captureWarnings() {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => { lines.push(args.join(' ')); };
  return { lines, restore: () => { console.warn = original; } };
}

// --- A. unit ---------------------------------------------------------------

test('file-modes (A): umask is 022 for this process (precondition of every assertion below)', { skip: SKIP }, () => {
  const mask = process.umask();
  assert.strictEqual(mask, 0o022, 'the test must run under umask 022 — otherwise it proves nothing');
});

test('file-modes (A): a new database in a new nested directory is 0600 in 0700 directories, sidecars 0600', { skip: SKIP }, () => {
  const parent = tmp('create');
  const nested = path.join(parent, 'a', 'b', 'c');
  const file = path.join(nested, 'x.db');
  const conn = dbFiles.openDbFile(file, dbFiles.CONTROL_SCHEMA_PATH);
  try {
    conn.exec('CREATE TABLE IF NOT EXISTS t (x); INSERT INTO t VALUES (1)');
    for (const dir of [path.join(parent, 'a'), path.join(parent, 'a', 'b'), nested]) {
      assert.strictEqual(oct(modeOf(dir)), '0700', `${dir} must be created 0700`);
    }
    assert.strictEqual(oct(modeOf(file)), '0600', 'database file must be 0600');
    for (const suffix of ['-wal', '-shm']) {
      assert.ok(fs.existsSync(file + suffix), `${suffix} must exist after a write on an open WAL connection`);
      assert.strictEqual(oct(modeOf(file + suffix)), '0600', `${suffix} sidecar must be 0600`);
    }
  } finally {
    conn.close();
  }
  assert.strictEqual(oct(modeOf(parent)), '0755', 'the pre-existing parent must not be chmodded');
});

test('file-modes (A): a pre-existing 0644 database and a 0644 -wal sidecar are tightened to 0600 on first open', { skip: SKIP }, () => {
  const dir = tmp('tighten');
  const file = path.join(dir, 'old.db');
  make0644Db(file);
  fs.writeFileSync(file + '-wal', '', { mode: 0o644 });
  fs.chmodSync(file + '-wal', 0o644);
  assert.strictEqual(oct(modeOf(file)), '0644');

  const conn = dbFiles.openDbFile(file, dbFiles.CONTROL_SCHEMA_PATH);
  try {
    conn.exec('CREATE TABLE IF NOT EXISTS t2 (x); INSERT INTO t2 VALUES (1)');
    assert.strictEqual(oct(modeOf(file)), '0600');
    assert.strictEqual(oct(modeOf(file + '-wal')), '0600');
    if (fs.existsSync(file + '-shm')) assert.strictEqual(oct(modeOf(file + '-shm')), '0600');
  } finally {
    conn.close();
  }
  assert.strictEqual(oct(modeOf(dir)), '0755', 'the pre-existing directory must not be chmodded');
});

test('file-modes (A): a PRE-EXISTING 0755 parent stays 0755; only directories this call created become 0700', { skip: SKIP }, () => {
  const parent = tmp('parent');
  assert.strictEqual(oct(modeOf(parent)), '0755');
  const conn = dbFiles.openDbFile(path.join(parent, 'new.db'), dbFiles.AUDIT_SCHEMA_PATH);
  conn.close();
  assert.strictEqual(oct(modeOf(parent)), '0755');
  assert.strictEqual(oct(modeOf(path.join(parent, 'new.db'))), '0600');

  const created = dbFiles.ensurePrivateDir(path.join(parent, 'sub', 'deeper'));
  assert.deepStrictEqual(created.map((p) => path.relative(parent, p)).sort(), ['sub', path.join('sub', 'deeper')].sort());
  assert.strictEqual(oct(modeOf(path.join(parent, 'sub'))), '0700');
  assert.strictEqual(oct(modeOf(path.join(parent, 'sub', 'deeper'))), '0700');
  assert.deepStrictEqual(dbFiles.ensurePrivateDir(parent), [], 'an existing directory is a no-op');
  assert.strictEqual(oct(modeOf(parent)), '0755');
});

for (const code of ['EPERM', 'EROFS']) {
  test(`file-modes (A): ${code} on a pre-existing 0644 database in dev mode warns once and still opens; strict throws`, { skip: SKIP }, () => {
    const dir = tmp(`stub-${code}`);
    const file = path.join(dir, 'locked.db');
    make0644Db(file);
    const target = path.resolve(file);
    const restore = stubChmod((p) => (p === target ? code : null));
    const warnings = captureWarnings();
    let conn;
    try {
      conn = dbFiles.openDbFile(file, dbFiles.CONTROL_SCHEMA_PATH);
      assert.strictEqual(conn.prepare('SELECT 1 AS one').get().one, 1, 'the connection must be usable');
      conn.close();
      // A second open of the same path must not repeat the warning.
      conn = dbFiles.openDbFile(file, dbFiles.CONTROL_SCHEMA_PATH);
      conn.close();
      conn = null;
      assert.throws(
        () => dbFiles.chmodPrivateFile(file, { preExisting: true, strict: true }),
        new RegExp(`\\[security\\].*${code}`)
      );
    } finally {
      if (conn) conn.close();
      warnings.restore();
      restore();
    }
    const tighten = warnings.lines.filter((l) => l.includes('[security] could not tighten'));
    assert.strictEqual(tighten.length, 1, `expected exactly one warning, got: ${JSON.stringify(warnings.lines)}`);
    assert.ok(tighten[0].includes(code));
    assert.strictEqual(oct(modeOf(file)), '0644', 'the stubbed chmod must not have taken effect');
  });
}

test('file-modes (A): a chmod failure on a path this call created, or any other error code, is always fatal', { skip: SKIP }, () => {
  const dir = tmp('fatal');
  const created = path.join(dir, 'created.db');
  fs.writeFileSync(created, '', { mode: 0o644 });
  fs.chmodSync(created, 0o644);

  const restore = stubChmod((p) => (p === path.resolve(created) ? 'EPERM' : null));
  try {
    // Not flagged preExisting => we own it => fatal even in dev mode.
    assert.throws(() => dbFiles.chmodPrivateFile(created), /\[security\].*EPERM/);
  } finally {
    restore();
  }

  const other = path.join(dir, 'other.db');
  fs.writeFileSync(other, '', { mode: 0o644 });
  fs.chmodSync(other, 0o644);
  const restoreEio = stubChmod((p) => (p === path.resolve(other) ? 'EIO' : null));
  try {
    assert.throws(() => dbFiles.chmodPrivateFile(other, { preExisting: true }), /\[security\].*EIO/);
  } finally {
    restoreEio();
  }
});

// --- B. whole-app children -------------------------------------------------

function cleanEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('MA_') || key === 'DEMO_OPEN' || key === 'ADMIN_TOKEN' || key === 'NODE_TEST_CONTEXT') delete env[key];
  }
  return { ...env, ...extra };
}

// Boot the real app with fs.chmodSync made to fail EPERM for GSD_EPERM_PATHS,
// listen on an ephemeral loopback port, probe /healthz, exit. A non-owned or
// read-only file cannot be produced without root, so the stub stands in for it.
const BOOT_WITH_EPERM_SCRIPT = `
  process.umask(0o022);
  const fs = require('fs');
  const path = require('path');
  const blocked = new Set(JSON.parse(process.env.GSD_EPERM_PATHS).map((p) => path.resolve(p)));
  const original = fs.chmodSync;
  fs.chmodSync = function (p, mode) {
    if (blocked.has(path.resolve(String(p)))) {
      const err = new Error("EPERM: operation not permitted, chmod '" + p + "'");
      err.code = 'EPERM';
      throw err;
    }
    return original.apply(this, arguments);
  };
  const app = require('./server.js');
  const server = app.listen(0, '127.0.0.1', async () => {
    let status = 0;
    try {
      const res = await fetch('http://127.0.0.1:' + server.address().port + '/healthz');
      status = res.status;
    } catch (e) {
      process.stderr.write('PROBE-ERROR ' + e.message + '\\n');
    }
    process.stdout.write('HEALTHZ ' + status + '\\n');
    server.close();
    process.exit(status === 200 ? 0 : 3);
  });
`;

function placeDatabaseCopies(dir) {
  const control = path.join(dir, 'control.db');
  const demo = path.join(dir, 'demo.db');
  fs.copyFileSync(path.join(REPO, 'data', 'control.db'), control);
  fs.copyFileSync(path.join(REPO, 'data', 'demo.db'), demo);
  fs.chmodSync(control, 0o644);
  fs.chmodSync(demo, 0o644);
  return { control, demo };
}

test('file-modes (B): dev/demo boot with non-chmod-able pre-existing databases still serves /healthz and warns', { skip: SKIP }, () => {
  const dir = tmp('child-dev');
  const { control, demo } = placeDatabaseCopies(dir);
  const res = spawnSync(process.execPath, ['-e', BOOT_WITH_EPERM_SCRIPT], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60000,
    input: '',
    env: cleanEnv({
      GSD_EPERM_PATHS: JSON.stringify([control, demo]),
      MA_CONTROL_DB_PATH: control,
      MA_DEMO_DB_PATH: demo,
      MA_RUNTIME_DB_PATH: path.join(dir, 'runtime.db'),
      MA_AUDIT_DB_PATH: path.join(dir, 'audit.db'),
      MA_DEALS_DIR: path.join(dir, 'deals'),
    }),
  });
  assert.strictEqual(res.status, 0, `dev boot must not crash on a chmod EPERM: ${res.stderr}`);
  assert.match(res.stdout, /HEALTHZ 200/);
  assert.match(res.stderr, /\[security\] could not tighten/);
  // Files we CAN chmod (created by this boot) are private as usual.
  assert.strictEqual(oct(modeOf(path.join(dir, 'runtime.db'))), '0600');
});

test('file-modes (B): the same chmod failure in real-deal mode refuses to boot with a [security] message', { skip: SKIP }, () => {
  const dataDir = tmp('child-real');
  fs.chmodSync(dataDir, 0o700);
  const { control, demo } = placeDatabaseCopies(dataDir);
  const res = spawnSync(process.execPath, ['-e', BOOT_WITH_EPERM_SCRIPT], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60000,
    input: '',
    env: cleanEnv({
      GSD_EPERM_PATHS: JSON.stringify([control, demo]),
      MA_MODE: 'real',
      MA_DATA_DIR: dataDir,
    }),
  });
  assert.notStrictEqual(res.status, 0, 'real-deal mode must refuse to start when a database cannot be tightened');
  assert.match(res.stderr, /\[security\] could not restrict/);
  assert.doesNotMatch(res.stdout, /HEALTHZ/);
});

// --- C. whole-app proof: real-mode boot + a deal created through the API ----
//
// Runs in a CHILD process so real-mode module state (db/dbFiles.js resolves the
// mode once, at require time) cannot clash with the unit section above. The
// child sets umask 022 itself before requiring server.js, boots the app,
// creates an admin, signs in, creates a deal over HTTP, selects it and writes
// to it (so the deal database is opened through the resolver with live
// sidecars), then reports the mode of everything under the data directory.

const REAL_BOOT_SCRIPT = `
  process.umask(0o022);
  const fs = require('fs');
  const path = require('path');
  const app = require('./server.js');
  const controlStore = require('./db/controlStore');
  const passwords = require('./lib/passwords');
  const dataDir = process.env.MA_DATA_DIR;
  const PASSWORD = 'correct-horse-battery-staple';

  function walk(dir, out) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      out[path.relative(dataDir, p)] = { mode: st.mode & 0o777, dir: st.isDirectory() };
      if (st.isDirectory()) walk(p, out);
    }
    return out;
  }

  (async () => {
    const result = {};
    const server = await new Promise((resolve, reject) => {
      const s = app.listen(0, '127.0.0.1');
      s.once('listening', () => resolve(s));
      s.once('error', reject);
    });
    try {
      const base = 'http://127.0.0.1:' + server.address().port;
      controlStore.createAccount({
        username: 'admin', name: 'Administrator', role: 'admin',
        hash: await passwords.hashPassword(PASSWORD),
        disabled: false, mustChangePassword: false,
        createdAt: new Date().toISOString(), createdBy: 'file-modes-test',
      });
      const login = await fetch(base + '/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: PASSWORD }),
      });
      result.loginStatus = login.status;
      const setCookie = login.headers.getSetCookie ? login.headers.getSetCookie() : [login.headers.get('set-cookie')];
      const cookie = setCookie.map((c) => String(c).split(';')[0]).find((c) => c.startsWith('ma_session='));
      const headers = { 'content-type': 'application/json', cookie };
      const created = await fetch(base + '/api/deals', {
        method: 'POST', headers, body: JSON.stringify({ name: 'Project Modes', targetCompany: 'Modes Target Inc' }),
      });
      result.createStatus = created.status;
      const body = await created.json();
      result.dealId = body && body.deal && body.deal.id;
      const select = await fetch(base + '/api/deals/select', {
        method: 'POST', headers, body: JSON.stringify({ dealId: result.dealId }),
      });
      result.selectStatus = select.status;
      const write = await fetch(base + '/api/departments', {
        method: 'POST', headers, body: JSON.stringify({ name: 'Modes Dept' }),
      });
      result.writeStatus = write.status;
      result.umask = process.umask();
      result.files = walk(dataDir, {});
      result.files['.'] = { mode: fs.statSync(dataDir).mode & 0o777, dir: true };
    } catch (e) {
      result.error = String(e && e.stack || e);
    }
    process.stdout.write('RESULT ' + JSON.stringify(result) + '\\n');
    server.close();
    process.exit(0);
  })();
`;

function committedState(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return 'empty'; }
  return buf.length === 0 ? 'empty' : crypto.createHash('sha256').update(buf).digest('hex');
}

test('file-modes (C): a real-mode instance under umask 022 holds only 0700 directories and 0600 files, including a freshly created deal', { skip: SKIP }, () => {
  const committed = ['control.db', 'control.db-wal', 'demo.db', 'demo.db-wal'].map((n) => path.join(REPO, 'data', n));
  const before = committed.map(committedState);

  const parent = tmp('real-whole-app');
  const dataDir = path.join(parent, 'real-data'); // does not exist yet
  const res = spawnSync(process.execPath, ['-e', REAL_BOOT_SCRIPT], {
    cwd: REPO, encoding: 'utf8', timeout: 90000, input: '',
    env: cleanEnv({ MA_MODE: 'real', MA_DATA_DIR: dataDir }),
  });
  assert.strictEqual(res.status, 0, res.stderr);
  const line = res.stdout.split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, 'child must report a RESULT line: ' + res.stdout + res.stderr);
  const out = JSON.parse(line.slice('RESULT '.length));
  assert.ok(!out.error, out.error);
  assert.strictEqual(out.umask, 0o022, 'the child must have run under umask 022');
  assert.strictEqual(out.loginStatus, 200);
  assert.strictEqual(out.createStatus, 200, 'POST /api/deals must succeed on a real-mode instance');
  assert.match(out.dealId, /^deal_[a-z0-9]+$/i);
  assert.strictEqual(out.selectStatus, 200);
  assert.strictEqual(out.writeStatus, 200);

  const dealRel = path.join('deals', `${out.dealId}.db`);
  for (const required of ['control.db', 'demo.db', 'runtime.db', 'audit.db', dealRel]) {
    assert.ok(out.files[required], `${required} must exist under the data directory`);
  }
  assert.ok(out.files['deals'] && out.files['deals'].dir, 'the deals directory must exist');
  assert.ok(out.files[dealRel + '-wal'],
    'the deal database must have a live -wal sidecar (opened through the resolver) so its mode is proven');

  const offenders = [];
  for (const [rel, info] of Object.entries(out.files)) {
    if (info.dir) {
      if (info.mode !== 0o700) offenders.push(`dir ${rel} is ${oct(info.mode)}`);
    } else if (info.mode !== 0o600) {
      offenders.push(`file ${rel} is ${oct(info.mode)}`);
    }
    if (info.mode & 0o077) offenders.push(`${rel} grants group/other bits (${oct(info.mode)})`);
  }
  assert.deepStrictEqual(offenders, [], 'every directory must be 0700 and every file 0600: ' + JSON.stringify(out.files));

  assert.deepStrictEqual(committed.map(committedState), before,
    'a real-mode instance must never write the committed data/control.db or data/demo.db');
});
