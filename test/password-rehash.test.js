// ACCT-04 / D-10-05 (Phase 10, plan 05): password hash cost and lazy rehash.
//
//   - a legacy-format account (salt + bare 64-hex Node-default scrypt) signs in,
//     and its stored hash is transparently replaced by the self-describing
//     N=2^17 format with salt:null; the next sign-in works; a wrong password is
//     refused and never rehashes
//   - the rehash NEVER writes while the committed control.db is the active one
//     (T-10-36, proven by forcing the predicate — the committed file itself is
//     never opened)
//   - accounts created by bootstrap / admin-create / reset / change all carry
//     parseHashParams(hash).n === 131072
//
// Boots the REAL app in dev mode against an ISOLATED temp control/runtime/
// demo/audit set; the bootstrap CLI runs as a child against a temp real data
// directory. The committed data/*.db are never opened.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { listenLocal } = require('./helpers/listen-local');

const REPO = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-password-rehash-'));
fs.copyFileSync(path.join(REPO, 'data', 'control.db'), path.join(TMP, 'control.db'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN', 'TRUST_PROXY']) delete process.env[key];

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const passwords = require('../lib/passwords.js');
const { ensureUser, sessionAs } = require('./helpers/seed-identity.js');
const app = require('../server.js');

const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);

let server;
let base;
test.before(async () => {
  server = await listenLocal(app);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

function blobOf(username) {
  return JSON.parse(controlConn.prepare('SELECT data FROM users WHERE id = ?').get(username).data);
}
function seedLegacy(username, password) {
  ensureUser(controlConn, { username, role: 'pmo' });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 32).toString('hex');
  const blob = { ...blobOf(username), hash, salt };
  controlConn.prepare('UPDATE users SET data = ? WHERE id = ?').run(JSON.stringify(blob), username);
  return { hash, salt };
}
async function post(route, body, cookie) {
  const res = await fetch(base + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* none */ }
  return { status: res.status, json, headers: res.headers };
}
function cookieFrom(res) {
  const m = /ma_session=([^;]+)/.exec(res.headers.get('set-cookie') || '');
  return m ? 'ma_session=' + m[1] : null;
}

test('legacy hash: a successful sign-in rewrites it to the current format with salt null', async () => {
  const before = seedLegacy('legacy-lena', 'lena-legacy-passphrase');
  assert.strictEqual(passwords.parseHashParams(before.hash).format, 'legacy');

  const wrong = await post('/api/auth/login', { username: 'legacy-lena', password: 'not-her-password' });
  assert.strictEqual(wrong.status, 401);
  assert.strictEqual(blobOf('legacy-lena').hash, before.hash, 'a failed sign-in never rehashes');

  const ok = await post('/api/auth/login', { username: 'legacy-lena', password: 'lena-legacy-passphrase' });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  const after = blobOf('legacy-lena');
  assert.notStrictEqual(after.hash, before.hash);
  assert.deepStrictEqual(passwords.parseHashParams(after.hash), { format: 'scrypt', n: 131072, r: 8, p: 1 });
  assert.strictEqual(after.salt, null, 'the legacy salt field is nulled; the new hash carries its own');

  const again = await post('/api/auth/login', { username: 'legacy-lena', password: 'lena-legacy-passphrase' });
  assert.strictEqual(again.status, 200, 'the rehashed account still signs in');
  const wrongAgain = await post('/api/auth/login', { username: 'legacy-lena', password: 'still-not-her-password' });
  assert.strictEqual(wrongAgain.status, 401);
  assert.strictEqual(blobOf('legacy-lena').hash, after.hash, 'an already-current hash is not rewritten again');
});

test('legacy hash: the rehash is skipped (sign-in still succeeds) while the committed control.db is active', async () => {
  const before = seedLegacy('legacy-carl', 'carl-legacy-passphrase');
  const original = dbFiles.isCommittedControlDbActive;
  dbFiles.isCommittedControlDbActive = () => true; // server.js reads it through the module object
  try {
    const res = await post('/api/auth/login', { username: 'legacy-carl', password: 'carl-legacy-passphrase' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  } finally {
    dbFiles.isCommittedControlDbActive = original;
  }
  const after = blobOf('legacy-carl');
  assert.strictEqual(after.hash, before.hash, 'no credential write while the committed database is active');
  assert.strictEqual(after.salt, before.salt);
});

test('new accounts: create, reset and change all produce N=131072 hashes', async () => {
  const admin = 'ma_session=' + sessionAs(runtimeConn, controlConn, { username: 'admin', role: 'admin' });

  const created = await post('/api/admin/users', { username: 'fresh-fay', name: 'Fay', role: 'employee' }, admin);
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  assert.strictEqual(passwords.parseHashParams(blobOf('fresh-fay').hash).n, 131072, 'create');
  const createdHash = blobOf('fresh-fay').hash;

  const reset = await post('/api/admin/users/fresh-fay/reset-password', {}, admin);
  assert.strictEqual(reset.status, 200, JSON.stringify(reset.json));
  const resetHash = blobOf('fresh-fay').hash;
  assert.notStrictEqual(resetHash, createdHash);
  assert.strictEqual(passwords.parseHashParams(resetHash).n, 131072, 'reset');

  const login = await post('/api/auth/login', { username: 'fresh-fay', password: reset.json.tempPassword });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  const changed = await post('/api/auth/change-password', {
    currentPassword: reset.json.tempPassword, newPassword: 'fay-brand-new-passphrase',
  }, cookieFrom(login));
  assert.strictEqual(changed.status, 200, JSON.stringify(changed.json));
  const changedHash = blobOf('fresh-fay').hash;
  assert.notStrictEqual(changedHash, resetHash);
  assert.strictEqual(passwords.parseHashParams(changedHash).n, 131072, 'change');
  assert.strictEqual(blobOf('fresh-fay').salt, null);
});

test('bootstrap CLI: the first admin is created with an N=131072 hash', () => {
  const dataDir = path.join(TMP, 'bootstrap-data');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('MA_')) delete env[key];
  for (const key of ['DEMO_OPEN', 'ADMIN_TOKEN', 'TRUST_PROXY']) delete env[key];
  env.MA_MODE = 'real';
  env.MA_DATA_DIR = dataDir;
  env.MA_BOOTSTRAP_PASSWORD = 'bootstrap-first-admin-passphrase';
  const res = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'bootstrap-admin.js')], {
    env, encoding: 'utf8', timeout: 60000, input: '',
  });
  assert.strictEqual(res.status, 0, res.stderr + res.stdout);
  const db = new Database(path.join(dataDir, 'control.db'), { readonly: true });
  try {
    const rows = db.prepare('SELECT data FROM users').all().map((r) => JSON.parse(r.data));
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].role, 'admin');
    assert.strictEqual(passwords.parseHashParams(rows[0].hash).n, 131072);
  } finally {
    db.close();
  }
});
