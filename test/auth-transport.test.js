// ACCT-05 / D-10-06 (Phase 10, plan 05): transport-level authentication
// hardening.
//
//   - the session cookie is Secure under TRUST_PROXY + X-Forwarded-Proto https
//     and whenever PUBLIC_BASE_URL is https, independent of ENABLE_HSTS (T-10-32)
//   - HSTS is max-age=31536000 with includeSubDomains only on explicit opt-in
//   - the shared-source-address warning (T-10-55) at boot and at runtime
//   - the ADMIN_TOKEN boot warning states the truth (T-10-37)
//
// The in-process app boots in dev mode against an ISOLATED temp control/
// runtime/demo/audit set with TRUST_PROXY=1; the warning cases run as CHILD
// PROCESSES (boot-time behaviour needs a fresh module graph) against their own
// temp sets. The committed data/*.db are never opened.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { listenLocal } = require('./helpers/listen-local');

const REPO = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-auth-transport-'));
function tempSet(name) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(REPO, 'data', 'control.db'), path.join(dir, 'control.db'));
  return {
    MA_CONTROL_DB_PATH: path.join(dir, 'control.db'),
    MA_RUNTIME_DB_PATH: path.join(dir, 'runtime.db'),
    MA_DEMO_DB_PATH: path.join(dir, 'demo.db'),
    MA_AUDIT_DB_PATH: path.join(dir, 'audit.db'),
    MA_DEALS_DIR: path.join(dir, 'deals'),
  };
}
Object.assign(process.env, tempSet('main'));
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN', 'ENABLE_HSTS', 'HSTS_INCLUDE_SUBDOMAINS', 'PUBLIC_BASE_URL']) {
  delete process.env[key];
}
process.env.TRUST_PROXY = '1'; // must be set BEFORE server.js is required

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const passwords = require('../lib/passwords.js');
const { ensureUser } = require('./helpers/seed-identity.js');
const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);

let server;
let base;
test.before(async () => {
  ensureUser(controlConn, { username: 'carol', role: 'pmo' });
  const blob = JSON.parse(controlConn.prepare('SELECT data FROM users WHERE id = ?').get('carol').data);
  blob.hash = await passwords.hashPassword('carol-correct-passphrase');
  controlConn.prepare('UPDATE users SET data = ? WHERE id = ?').run(JSON.stringify(blob), 'carol');
  server = await listenLocal(app);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  delete process.env.ENABLE_HSTS;
  delete process.env.HSTS_INCLUDE_SUBDOMAINS;
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

async function post(route, { body, cookie, headers } = {}) {
  return fetch(base + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(headers || {}) },
    body: JSON.stringify(body || {}),
  });
}
function cookieAttrs(res) {
  return (res.headers.get('set-cookie') || '').split(';').map((s) => s.trim());
}

// --- pure helper ---------------------------------------------------------------

test('isSecureCookieContext: req.secure or an https PUBLIC_BASE_URL', () => {
  assert.strictEqual(app.isSecureCookieContext({ secure: true, publicBaseUrl: 'http://localhost:3000' }), true);
  assert.strictEqual(app.isSecureCookieContext({ secure: false, publicBaseUrl: 'https://portal.example' }), true);
  assert.strictEqual(app.isSecureCookieContext({ secure: false, publicBaseUrl: 'HTTPS://portal.example' }), true);
  assert.strictEqual(app.isSecureCookieContext({ secure: false, publicBaseUrl: 'http://localhost:3000' }), false);
  assert.strictEqual(app.isSecureCookieContext({ secure: false }), false);
  assert.strictEqual(app.isSecureCookieContext({}), false);
});

// --- Secure cookie, independent of ENABLE_HSTS ---------------------------------

test('cookie: Secure behind TRUST_PROXY + X-Forwarded-Proto https, even with ENABLE_HSTS unset', async () => {
  assert.strictEqual(process.env.ENABLE_HSTS, undefined);
  const secure = await post('/api/auth/login', {
    body: { username: 'carol', password: 'carol-correct-passphrase' },
    headers: { 'x-forwarded-proto': 'https' },
  });
  assert.strictEqual(secure.status, 200);
  const attrs = cookieAttrs(secure);
  assert.ok(attrs.includes('Secure'), `expected Secure in ${attrs.join('; ')}`);
  assert.ok(attrs.includes('HttpOnly'));
  assert.ok(attrs.includes('SameSite=Strict'));

  const plain = await post('/api/auth/login', { body: { username: 'carol', password: 'carol-correct-passphrase' } });
  assert.strictEqual(plain.status, 200);
  assert.ok(!cookieAttrs(plain).includes('Secure'), 'a plain-http request must not get Secure');
});

test('cookie: ENABLE_HSTS alone no longer decides Secure', async () => {
  process.env.ENABLE_HSTS = '1';
  try {
    const res = await post('/api/auth/login', { body: { username: 'carol', password: 'carol-correct-passphrase' } });
    assert.strictEqual(res.status, 200);
    assert.ok(!cookieAttrs(res).includes('Secure'), 'plain http + ENABLE_HSTS must not set Secure');
  } finally {
    delete process.env.ENABLE_HSTS;
  }
});

test('cookie: change-password re-issue and logout carry Secure under https', async () => {
  const https = { 'x-forwarded-proto': 'https' };
  const login = await post('/api/auth/login', {
    body: { username: 'carol', password: 'carol-correct-passphrase' }, headers: https,
  });
  const cookie = 'ma_session=' + /ma_session=([^;]+)/.exec(login.headers.get('set-cookie'))[1];

  const changed = await post('/api/auth/change-password', {
    cookie, headers: https,
    body: { currentPassword: 'carol-correct-passphrase', newPassword: 'carol-new-passphrase' },
  });
  assert.strictEqual(changed.status, 200);
  assert.ok(cookieAttrs(changed).includes('Secure'), 'the re-issued session cookie is Secure');
  const fresh = 'ma_session=' + /ma_session=([^;]+)/.exec(changed.headers.get('set-cookie'))[1];

  const out = await post('/api/auth/logout', { cookie: fresh, headers: https });
  assert.strictEqual(out.status, 200);
  const attrs = cookieAttrs(out);
  assert.ok(attrs.includes('Max-Age=0'));
  assert.ok(attrs.includes('Secure'), 'the clearing cookie matches the Secure attribute of the one it clears');
});

// --- HSTS ------------------------------------------------------------------------

test('HSTS: absent by default; max-age only with ENABLE_HSTS; includeSubDomains only on opt-in', async () => {
  let res = await fetch(base + '/api/auth/mode');
  assert.strictEqual(res.headers.get('strict-transport-security'), null);

  process.env.ENABLE_HSTS = '1';
  try {
    res = await fetch(base + '/api/auth/mode');
    assert.strictEqual(res.headers.get('strict-transport-security'), 'max-age=31536000');

    process.env.HSTS_INCLUDE_SUBDOMAINS = '1';
    res = await fetch(base + '/api/auth/mode');
    assert.strictEqual(res.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  } finally {
    delete process.env.ENABLE_HSTS;
    delete process.env.HSTS_INCLUDE_SUBDOMAINS;
  }
});

// --- boot / runtime warnings (child processes) -------------------------------------

function cleanEnv(extra) {
  const env = { ...process.env };
  for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN', 'ENABLE_HSTS', 'HSTS_INCLUDE_SUBDOMAINS',
    'PUBLIC_BASE_URL', 'TRUST_PROXY', 'PORT']) delete env[key];
  return { ...env, ...extra };
}
function runChild(code, extraEnv, label) {
  const result = spawnSync(process.execPath, ['-e', code], {
    cwd: REPO, env: cleanEnv({ ...tempSet(label), ...extraEnv }), encoding: 'utf8', timeout: 60000,
  });
  assert.strictEqual(result.status, 0, `child '${label}' failed: ${result.stderr}`);
  return result.stderr;
}
function sharedSourceLines(stderr) {
  return stderr.split('\n').filter((l) => l.includes('[security]') && l.includes('TRUST_PROXY is unset'));
}
const BOOT_ONLY = "require('./server.js'); process.exit(0);";
const TWO_FORWARDED_REQUESTS = `
  const app = require('./server.js');
  const s = app.listen(0, '127.0.0.1', async () => {
    const port = s.address().port;
    for (let i = 0; i < 2; i++) {
      await fetch('http://127.0.0.1:' + port + '/api/auth/mode',
        { headers: { 'x-forwarded-for': '10.1.1.1', 'x-forwarded-proto': 'https' } });
    }
    process.exit(0);
  });`;

test('shared-source warning: https PUBLIC_BASE_URL with TRUST_PROXY unset warns once at boot', () => {
  const stderr = runChild(BOOT_ONLY, { PUBLIC_BASE_URL: 'https://portal.example' }, 'warn-boot');
  assert.strictEqual(sharedSourceLines(stderr).length, 1, stderr);
});

test('shared-source warning: TRUST_PROXY set -> no such warning', () => {
  const stderr = runChild(BOOT_ONLY, { PUBLIC_BASE_URL: 'https://portal.example', TRUST_PROXY: '1' }, 'warn-none');
  assert.strictEqual(sharedSourceLines(stderr).length, 0, stderr);
});

test('shared-source warning: forwarded headers with TRUST_PROXY unset warn exactly once at runtime', () => {
  const stderr = runChild(TWO_FORWARDED_REQUESTS, {}, 'warn-runtime');
  assert.strictEqual(sharedSourceLines(stderr).length, 1, stderr);
});

test('shared-source warning: no forwarded headers and an http base URL stays silent', () => {
  const stderr = runChild(BOOT_ONLY, {}, 'warn-silent');
  assert.strictEqual(sharedSourceLines(stderr).length, 0, stderr);
});

test('ADMIN_TOKEN boot warning: silent when unset (no false OPEN claim), truthful when set', () => {
  const unset = runChild(BOOT_ONLY, {}, 'admin-token-unset');
  assert.ok(!/ADMIN_TOKEN/.test(unset), `unset must not warn: ${unset}`);
  assert.ok(!/OPEN/.test(unset.split('\n').filter((l) => l.includes('ADMIN_TOKEN')).join('')));

  const set = runChild(BOOT_ONLY, { ADMIN_TOKEN: 'a-test-token-value-0123456789' }, 'admin-token-set');
  const line = set.split('\n').find((l) => l.includes('ADMIN_TOKEN is set'));
  assert.ok(line, set);
  assert.ok(line.includes("'admin-token' admin identity"));
  assert.ok(!set.includes('a-test-token-value-0123456789'), 'the token value is never logged');
});

test('source-level: the stale ADMIN_TOKEN OPEN claim and the old per-IP map are gone', () => {
  const src = fs.readFileSync(path.join(REPO, 'server.js'), 'utf8');
  assert.ok(!src.includes('API endpoints are OPEN'));
  assert.ok(!src.includes('_loginAttempts'));
  assert.ok(!src.includes('function loginThrottled'));
  assert.ok(!/ENABLE_HSTS === '1'\) cookie/.test(src));
});
