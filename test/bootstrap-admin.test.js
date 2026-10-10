// D-10-02 / D-10-05 (Phase 10, plan 01) — first-admin bootstrap CLI and the
// shared password-hashing module.
//
//   1. lib/passwords.js unit behaviour (self-describing scrypt format, legacy
//      verify + needsRehash, strict parse bounds, policy, temp passwords).
//   2. scripts/bootstrap-admin.js as a CHILD PROCESS against a temp real data
//      directory: create, refuse-second-run, --force-reset-admin, argv-secret
//      refusal (must create nothing), policy refusals.
//   3. The bootstrapped admin signs in over HTTP and rotates its password
//      through the real server (new-format hash, mustChangePassword cleared).
//
// Nothing here may touch the committed data/*.db — every child and the
// in-process server run against temp directories (MA_DATA_DIR).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const passwords = require('../lib/passwords');
const sessionsDb = require('../db/sessions');
const { listenLocal } = require('./helpers/listen-local');

const REPO = path.join(__dirname, '..');
const CLI = path.join(REPO, 'scripts', 'bootstrap-admin.js');
const RUNTIME_SCHEMA = path.join(REPO, 'db', 'runtime-schema.sql');
const NEW_FORMAT_RE = /^scrypt\$n=131072,r=8,p=1\$[0-9a-f]{32}\$[0-9a-f]{64}$/;
const DEMO_PASSWORD = /const DEMO_PASSWORD = '([^']+)'/.exec(
  fs.readFileSync(path.join(REPO, 'scripts', 'set-admin-password.js'), 'utf8')
)[1];

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-bootstrap-admin-'));
test.after(() => {
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

function legacyHash(pw, saltHex) {
  return crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 32).toString('hex');
}

// --- 1. lib/passwords.js ---------------------------------------------------

test('passwords: hashPassword emits the self-describing scrypt N=131072 format', async () => {
  const h = await passwords.hashPassword('x'.repeat(12));
  assert.match(h, NEW_FORMAT_RE);
  assert.notStrictEqual(h, await passwords.hashPassword('x'.repeat(12)), 'salted: two hashes of one password differ');
  assert.deepStrictEqual(passwords.parseHashParams(h), { format: 'scrypt', n: 131072, r: 8, p: 1 });
});

test('passwords: verifyPassword — new format ok / wrong password not ok / no rehash needed', async () => {
  const pw = 'correct horse battery';
  const h = await passwords.hashPassword(pw);
  assert.deepStrictEqual(await passwords.verifyPassword(pw, { hash: h }), { ok: true, needsRehash: false });
  assert.strictEqual((await passwords.verifyPassword('wrong password!!', { hash: h })).ok, false);
  assert.deepStrictEqual(passwords.verifyPasswordSync(pw, { hash: h }), { ok: true, needsRehash: false });
});

test('passwords: legacy 64-hex hash + salt still verifies and always reports needsRehash', async () => {
  const salt = crypto.randomBytes(16).toString('hex');
  const account = { salt, hash: legacyHash('legacy-pass-1', salt) };
  assert.deepStrictEqual(await passwords.verifyPassword('legacy-pass-1', account), { ok: true, needsRehash: true });
  assert.strictEqual((await passwords.verifyPassword('legacy-pass-2', account)).ok, false);
  assert.deepStrictEqual(passwords.parseHashParams(account.hash), { format: 'legacy', n: 16384, r: 8, p: 1 });
});

test('passwords: a lower-cost new-format hash verifies but needsRehash (cost travels with the hash)', async () => {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync('lowcost-password', salt, 32, { N: 16384, r: 8, p: 1 });
  const h = `scrypt$n=16384,r=8,p=1$${salt.toString('hex')}$${key.toString('hex')}`;
  assert.deepStrictEqual(await passwords.verifyPassword('lowcost-password', { hash: h }), { ok: true, needsRehash: true });
});

// WR-02 (Phase 10 review): the lazy rehash must never DOWNGRADE a stored hash.
test('passwords (WR-02): a stronger-than-current or mixed-cost hash verifies with needsRehash:false', async () => {
  const make = (pw, N, r, p) => {
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(pw, salt, 32, { N, r, p, maxmem: 512 * 1024 * 1024 });
    return `scrypt$n=${N},r=${r},p=${p}$${salt.toString('hex')}$${key.toString('hex')}`;
  };
  // N=262144 at r=8 needs more than the 256 MiB derivation ceiling, so the
  // "stronger N" case is asserted on the predicate; the derivable stronger /
  // mixed hashes are verified end-to-end below.
  assert.strictEqual(passwords.isWeakerThanCurrent({ n: 262144, r: 8, p: 1 }), false, 'stronger N is never rehashed');
  assert.strictEqual(passwords.isWeakerThanCurrent({ n: 131072, r: 16, p: 1 }), false, 'stronger r is never rehashed');
  assert.strictEqual(passwords.isWeakerThanCurrent({ n: 131072, r: 8, p: 1 }), false, 'current is not rehashed');
  assert.strictEqual(passwords.isWeakerThanCurrent({ n: 16384, r: 8, p: 1 }), true, 'weaker N is rehashed');
  const cases = [
    ['stronger p', 131072, 8, 2, false],
    ['mixed: N higher, r lower', 262144, 4, 1, false],
    ['weaker N only', 65536, 8, 1, true],
    ['weaker r only', 131072, 4, 1, true],
  ];
  for (const [label, N, r, p, expected] of cases) {
    const pw = 'wr02-' + label;
    const h = make(pw, N, r, p);
    assert.deepStrictEqual(await passwords.verifyPassword(pw, { hash: h }), { ok: true, needsRehash: expected }, label);
    assert.deepStrictEqual(passwords.verifyPasswordSync(pw, { hash: h }), { ok: true, needsRehash: expected }, label + ' (sync)');
  }
});

test('passwords: malformed / missing / out-of-bounds stored hashes are not-ok and never throw', async () => {
  const salt = '00'.repeat(16);
  const key = '11'.repeat(32);
  const cases = [
    { hash: 'not a hash' },
    { hash: '' },
    {},
    null,
    undefined,
    { hash: 'a'.repeat(64) }, // legacy-looking but no salt
    { hash: `scrypt$n=2097152,r=8,p=1$${salt}$${key}` }, // n = 2^21 > 2^20
    { hash: `scrypt$n=1048576,r=8,p=1$${salt}$${key}` }, // 1 GiB > ceiling
    { hash: `scrypt$n=131073,r=8,p=1$${salt}$${key}` }, // not a power of two
    { hash: `scrypt$n=16384,r=64,p=1$${salt}$${key}` }, // r > 32
    { hash: `scrypt$n=16384,r=8,p=99$${salt}$${key}` }, // p > 16
    { hash: `scrypt$n=16384,r=8,p=1$zz$${key}` }, // bad salt
  ];
  for (const account of cases) {
    const verdict = await passwords.verifyPassword('whatever-password', account);
    assert.strictEqual(verdict.ok, false, `must reject ${JSON.stringify(account)}`);
    assert.strictEqual(passwords.verifyPasswordSync('whatever-password', account).ok, false);
  }
  assert.strictEqual(passwords.parseHashParams(`scrypt$n=2097152,r=8,p=1$${salt}$${key}`), null);
});

test('passwords: checkNewPassword policy — 12 in real mode, 8 otherwise, demo password refused in real mode', () => {
  assert.ok(passwords.checkNewPassword('a'.repeat(11), { realMode: true }));
  assert.strictEqual(passwords.checkNewPassword('a'.repeat(12), { realMode: true }), null);
  assert.strictEqual(passwords.checkNewPassword('a'.repeat(8), { realMode: false }), null);
  assert.ok(passwords.checkNewPassword('a'.repeat(7), { realMode: false }));
  assert.ok(passwords.checkNewPassword(DEMO_PASSWORD, { realMode: true }), 'published demo password refused in real mode');
  assert.strictEqual(passwords.checkNewPassword(DEMO_PASSWORD, { realMode: false }), null);
  assert.ok(passwords.checkNewPassword(12345678901234, { realMode: true }), 'non-strings refused');
  assert.ok(passwords.checkNewPassword('a'.repeat(501), { realMode: true }), 'over-long refused');
  assert.strictEqual(passwords.isKnownDemoPassword(DEMO_PASSWORD), true);
  assert.strictEqual(passwords.isKnownDemoPassword('something else'), false);
});

test('passwords: generateTempPassword — >=16 unambiguous characters, never repeats', () => {
  const a = passwords.generateTempPassword();
  const b = passwords.generateTempPassword();
  assert.ok(a.length >= 16);
  assert.match(a, /^[A-Za-z2-9]+$/);
  assert.doesNotMatch(a + b, /[0O1lI]/);
  assert.notStrictEqual(a, b);
});

// --- 2. scripts/bootstrap-admin.js as a child process -----------------------

function cleanEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('MA_') || key === 'DEMO_OPEN' || key === 'ADMIN_TOKEN') delete env[key];
  }
  return { ...env, ...extra };
}

function runCli(dataDir, { args = [], password, extraEnv = {} } = {}) {
  const env = cleanEnv({ MA_MODE: 'real', MA_DATA_DIR: dataDir, ...extraEnv });
  if (password !== undefined) env.MA_BOOTSTRAP_PASSWORD = password;
  return spawnSync(process.execPath, [CLI, ...args], {
    env, encoding: 'utf8', timeout: 60000, input: '',
  });
}

function readAdmin(dataDir) {
  const conn = new Database(path.join(dataDir, 'control.db'), { readonly: true });
  try {
    const rows = conn.prepare('SELECT id, data FROM users').all();
    return rows.map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
  } finally {
    conn.close();
  }
}

function auditRows(dataDir) {
  const conn = new Database(path.join(dataDir, 'audit.db'), { readonly: true });
  try {
    return conn.prepare('SELECT actor_username, actor_role, action, row_id AS subject FROM audit_log ORDER BY id').all();
  } finally {
    conn.close();
  }
}

const DIR_A = path.join(TMP_ROOT, 'a', 'data');
const PASSWORD_1 = 'bootstrap-secret-one!';
const PASSWORD_2 = 'bootstrap-secret-two!';

test('bootstrap-admin: creates exactly one admin (mustChangePassword, no salt field, new-format hash) with a cli:<os-user> audit row', () => {
  const res = runCli(DIR_A, { password: PASSWORD_1 });
  assert.strictEqual(res.status, 0, res.stderr || res.stdout);
  const users = readAdmin(DIR_A);
  assert.strictEqual(users.length, 1);
  const admin = users[0];
  assert.strictEqual(admin.id, 'admin');
  assert.strictEqual(admin.username, 'admin');
  assert.strictEqual(admin.role, 'admin');
  assert.strictEqual(admin.mustChangePassword, true);
  assert.strictEqual(admin.disabled, false);
  assert.ok(!('salt' in admin), 'a self-describing hash needs no separate salt field');
  assert.match(admin.hash, NEW_FORMAT_RE);
  assert.ok(String(admin.createdBy).startsWith('cli:'));
  assert.ok(!res.stdout.includes(PASSWORD_1) && !res.stderr.includes(PASSWORD_1), 'the password must never be printed');

  const events = auditRows(DIR_A);
  assert.strictEqual(events.length, 1);
  assert.ok(events[0].actor_username.startsWith('cli:'), `actor was ${events[0].actor_username}`);
  assert.strictEqual(events[0].action, 'bootstrap-admin');
  assert.strictEqual(events[0].subject, 'admin');
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(DIR_A).mode & 0o777, 0o700);
  }
});

test('bootstrap-admin: a second run without --force-reset-admin refuses and changes nothing', () => {
  const before = readAdmin(DIR_A)[0].hash;
  const res = runCli(DIR_A, { password: PASSWORD_2 });
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /--force-reset-admin/);
  assert.strictEqual(readAdmin(DIR_A)[0].hash, before);
  assert.strictEqual(auditRows(DIR_A).length, 1, 'a refused run records nothing');
});

test('bootstrap-admin: --force-reset-admin re-hashes admin, keeps mustChangePassword, revokes its sessions, audits it', () => {
  // A live admin session minted under the OLD credential.
  const runtime = new Database(path.join(DIR_A, 'runtime.db'));
  try {
    runtime.exec(fs.readFileSync(RUNTIME_SCHEMA, 'utf8'));
    sessionsDb.createSession(runtime, { username: 'admin', role: 'admin', ttlMs: 60000 });
    assert.strictEqual(runtime.prepare("SELECT COUNT(*) AS n FROM sessions WHERE username = 'admin'").get().n, 1);
  } finally {
    runtime.close();
  }

  const before = readAdmin(DIR_A)[0].hash;
  const res = runCli(DIR_A, { password: PASSWORD_2, args: ['--force-reset-admin'] });
  assert.strictEqual(res.status, 0, res.stderr || res.stdout);
  const admin = readAdmin(DIR_A)[0];
  assert.notStrictEqual(admin.hash, before);
  assert.match(admin.hash, NEW_FORMAT_RE);
  assert.strictEqual(admin.mustChangePassword, true);
  assert.strictEqual(passwords.verifyPasswordSync(PASSWORD_2, admin).ok, true);

  const check = new Database(path.join(DIR_A, 'runtime.db'), { readonly: true });
  try {
    assert.strictEqual(check.prepare("SELECT COUNT(*) AS n FROM sessions WHERE username = 'admin'").get().n, 0,
      'a force-reset must delete the admin sessions minted under the old credential');
  } finally {
    check.close();
  }
  const events = auditRows(DIR_A);
  assert.strictEqual(events[events.length - 1].action, 'bootstrap-admin-force-reset');
  assert.ok(events[events.length - 1].actor_username.startsWith('cli:'));
});

test('bootstrap-admin: any positional argv (a would-be password) exits non-zero BEFORE touching a database', () => {
  const dir = path.join(TMP_ROOT, 'argv', 'data');
  const res = runCli(dir, { args: ['hunter2-hunter2'], password: PASSWORD_1 });
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /never accepted on the command line/);
  assert.ok(!fs.existsSync(dir), 'nothing may be created — not even the data directory');
});

test('bootstrap-admin: weak / published-demo / missing passwords are refused and create nothing', () => {
  const short = runCli(path.join(TMP_ROOT, 'short', 'data'), { password: 'tooshort' });
  assert.notStrictEqual(short.status, 0);
  const demo = runCli(path.join(TMP_ROOT, 'demo', 'data'), { password: DEMO_PASSWORD });
  assert.notStrictEqual(demo.status, 0);
  assert.match(demo.stderr, /demo password/i);
  // Non-TTY stdin and no MA_BOOTSTRAP_PASSWORD: refuse rather than hang or read argv.
  const none = runCli(path.join(TMP_ROOT, 'none', 'data'), {});
  assert.notStrictEqual(none.status, 0);
  for (const name of ['short', 'demo', 'none']) {
    const dir = path.join(TMP_ROOT, name, 'data');
    if (fs.existsSync(path.join(dir, 'control.db'))) {
      assert.strictEqual(readAdmin(dir).length, 0, `${name}: no account may exist after a refused run`);
    }
  }
});

test('bootstrap-admin: refuses when the active control database is the committed data/control.db', () => {
  const res = spawnSync(process.execPath, [CLI], {
    env: cleanEnv({
      MA_MODE: 'real', MA_DATA_DIR: path.join(TMP_ROOT, 'committed', 'data'),
      MA_CONTROL_DB_PATH: path.join(REPO, 'data', 'control.db'),
      MA_BOOTSTRAP_PASSWORD: PASSWORD_1,
    }),
    encoding: 'utf8', timeout: 60000, input: '',
  });
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /\[security\]/);
});

// --- 3. the bootstrapped admin signs in and rotates its password ------------

test('bootstrap-admin: bootstrapped admin logs in (200, mustChangePassword) and changes its password (new hash format)', async () => {
  const dataDir = path.join(TMP_ROOT, 'b', 'data');
  const boot = runCli(dataDir, { password: PASSWORD_1 });
  assert.strictEqual(boot.status, 0, boot.stderr || boot.stdout);

  // env-before-require: dbFiles resolves the mode and every path at require time.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('MA_') || key === 'DEMO_OPEN' || key === 'ADMIN_TOKEN') delete process.env[key];
  }
  process.env.MA_MODE = 'real';
  process.env.MA_DATA_DIR = dataDir;
  const app = require('../server.js');
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (route, body, cookie) => fetch(base + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });

    const login = await post('/api/auth/login', { username: 'admin', password: PASSWORD_1 });
    assert.strictEqual(login.status, 200);
    const loginBody = await login.json();
    assert.strictEqual(loginBody.user.username, 'admin');
    assert.strictEqual(loginBody.user.role, 'admin');
    assert.strictEqual(loginBody.mustChangePassword, true);
    const cookie = /ma_session=[^;]+/.exec(login.headers.get('set-cookie'))[0];

    const newPassword = 'a-brand-new-passphrase-42';
    const change = await post('/api/auth/change-password', { currentPassword: PASSWORD_1, newPassword }, cookie);
    assert.strictEqual(change.status, 200, JSON.stringify(await change.clone().json()));

    const stored = readAdmin(dataDir)[0];
    assert.match(stored.hash, NEW_FORMAT_RE);
    assert.strictEqual(stored.mustChangePassword, false);
    assert.strictEqual(stored.salt, null);
    assert.strictEqual(passwords.verifyPasswordSync(newPassword, stored).ok, true);

    const relogin = await post('/api/auth/login', { username: 'admin', password: newPassword });
    assert.strictEqual(relogin.status, 200);
    assert.strictEqual((await relogin.json()).mustChangePassword, false);
    const stale = await post('/api/auth/login', { username: 'admin', password: PASSWORD_1 });
    assert.strictEqual(stale.status, 401);

    // Real-mode policy: a weak new password is a 400 from the shared policy check.
    const relogin2 = await post('/api/auth/login', { username: 'admin', password: newPassword });
    const cookie2 = /ma_session=[^;]+/.exec(relogin2.headers.get('set-cookie'))[0];
    const weak = await post('/api/auth/change-password', { currentPassword: newPassword, newPassword: 'elevenchars' }, cookie2);
    assert.strictEqual(weak.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
