// ACCT-07 / D-10-08b (Phase 10, plan 05): the real-mode demo-credential
// lockdown (PRD acceptance 3).
//
//   - a real-mode instance whose control.db is a HAND COPY of the committed one
//     (seed skipped because the file exists) serves only the login page and its
//     assets, /api/auth/* and /healthz, logs a [security] banner naming the
//     offending accounts, and lifts the lockdown only after EVERY account that
//     verified a published demo password has changed it
//   - the middleware's static allowlist is one exported frozen constant and
//     every entry is proven to pass through it
//   - dev mode on a copy of the committed control.db is never locked down
//   - the committed data/control.db and data/demo.db are never written
//
// The environment is configured BEFORE require('../server.js'): db/dbFiles.js
// resolves the mode and every path once, at require time.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { listenLocal } = require('./helpers/listen-local');
const {
  LOCKDOWN_STATIC_ALLOWLIST, createLockdown, lockdownMiddleware,
} = require('../lib/credentialLockdown');
const passwords = require('../lib/passwords');

const REPO = path.join(__dirname, '..');
const COMMITTED = ['control.db', 'control.db-wal', 'demo.db', 'demo.db-wal']
  .map((n) => path.join(REPO, 'data', n));
function sha256OrEmpty(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return 'empty'; }
  return buf.length === 0 ? 'empty' : crypto.createHash('sha256').update(buf).digest('hex');
}
const BEFORE = COMMITTED.map(sha256OrEmpty);
const DEMO_PASSWORD = passwords.KNOWN_DEMO_PASSWORDS[0];
const DEMO_ACCOUNTS = ['admin', 'karen', 'pmo', 'employee-demo'];

for (const key of Object.keys(process.env)) {
  if (/^MA_.*_PATH$/.test(key) || key === 'MA_DEALS_DIR') delete process.env[key];
}
for (const key of ['DEMO_OPEN', 'ADMIN_TOKEN', 'TRUST_PROXY', 'PUBLIC_BASE_URL', 'ENABLE_HSTS']) delete process.env[key];

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-credential-lockdown-'));
const DATA_DIR = path.join(TMP, 'real-data');
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
// The hand copy: a byte copy of the committed control.db, so ensureRealDataDir
// sees the file and skips the account-less seed.
fs.copyFileSync(path.join(REPO, 'data', 'control.db'), path.join(DATA_DIR, 'control.db'));
process.env.MA_MODE = 'real';
process.env.MA_DATA_DIR = DATA_DIR;

// Capture boot warnings (the lockdown banner is logged at require time).
const bootWarnings = [];
const originalWarn = console.warn;
console.warn = (...args) => { bootWarnings.push(args.join(' ')); originalWarn.apply(console, args); };
const app = require('../server.js');
console.warn = originalWarn;

const dbFiles = require('../db/dbFiles.js');
const store = require('../db/store.js');

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
  const conn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
  return JSON.parse(conn.prepare('SELECT data FROM users WHERE id = ?').get(username).data);
}
async function call(method, route, { body, cookie } = {}) {
  const res = await fetch(base + route, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* html / binary */ }
  return { status: res.status, headers: res.headers, text, json };
}
function cookieFrom(res) {
  const m = /ma_session=([^;]+)/.exec(res.headers.get('set-cookie') || '');
  return m ? 'ma_session=' + m[1] : null;
}

// --- middleware unit (no server, no files) ---------------------------------------

function fakeRes() {
  const res = { statusCode: null, body: null, headers: {}, ended: false };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; res.ended = true; return res; };
  res.type = (t) => { res.headers['content-type'] = t; return res; };
  res.send = (b) => { res.body = b; res.ended = true; return res; };
  return res;
}
function run(lockdown, method, reqPath) {
  const res = fakeRes();
  let nextCalled = false;
  lockdownMiddleware(lockdown)({ method, path: reqPath }, res, () => { nextCalled = true; });
  return { res, nextCalled };
}
function activeLockdown() {
  const lockdown = createLockdown({ enabled: true });
  lockdown.noteDemoLogin('someone');
  assert.strictEqual(lockdown.isActive(), true);
  return lockdown;
}

test('allowlist: one frozen constant of exactly the eleven public names (seven pages/assets + the four vendored fonts)', () => {
  assert.strictEqual(Object.isFrozen(LOCKDOWN_STATIC_ALLOWLIST), true);
  assert.deepStrictEqual([...LOCKDOWN_STATIC_ALLOWLIST].sort(), [
    '/change-password.html', '/css/style.css', '/favicon.ico', '/js/change-password.js',
    '/js/login.js', '/login.html', '/te-logo.png',
    '/vendor/fonts/inter-latin-ext.woff2', '/vendor/fonts/inter-latin.woff2',
    '/vendor/fonts/outfit-latin-ext.woff2', '/vendor/fonts/outfit-latin.woff2',
  ]);
  // server.js holds no second copy of the list (plan 10-09 imports this one).
  const src = fs.readFileSync(path.join(REPO, 'server.js'), 'utf8');
  assert.ok(!src.includes('change-password.js'));
});

test('middleware: every allowlisted GET/HEAD passes through and writes nothing', () => {
  const lockdown = activeLockdown();
  for (const entry of LOCKDOWN_STATIC_ALLOWLIST) {
    for (const method of ['GET', 'HEAD']) {
      const { res, nextCalled } = run(lockdown, method, entry);
      assert.strictEqual(nextCalled, true, `${method} ${entry} must pass through`);
      assert.strictEqual(res.ended, false, `${method} ${entry} must write no response`);
      assert.strictEqual(res.statusCode, null);
    }
  }
  for (const [method, p] of [['GET', '/healthz'], ['POST', '/api/auth/login'], ['GET', '/api/auth/mode'],
    ['POST', '/api/auth/change-password'], ['GET', '/api/auth/me']]) {
    assert.strictEqual(run(lockdown, method, p).nextCalled, true, `${method} ${p}`);
  }
});

test('middleware: everything else is a 403 and never calls next()', () => {
  const lockdown = activeLockdown();
  for (const [method, p] of [
    ['POST', '/login.html'], ['PUT', '/css/style.css'], ['DELETE', '/te-logo.png'],
    ['GET', '/index.html'], ['GET', '/js/transitions.js'], ['GET', '/'], ['GET', '/login.html/../index.html'],
    ['GET', '/api/raid'], ['POST', '/api/raid'], ['GET', '/api/authx'], ['GET', '/api/auth'],
  ]) {
    const { res, nextCalled } = run(lockdown, method, p);
    assert.strictEqual(nextCalled, false, `${method} ${p} must not pass`);
    assert.strictEqual(res.statusCode, 403, `${method} ${p}`);
  }
  const api = run(lockdown, 'GET', '/api/raid').res;
  assert.strictEqual(api.body.credentialLockdown, true);
  const page = run(lockdown, 'GET', '/index.html').res;
  assert.match(page.headers['content-type'], /html/);
  assert.match(page.body, /<a href="\/login\.html">/);
});

test('middleware: an inactive lockdown calls next() for every request', () => {
  const inactive = createLockdown({ enabled: true });
  const disabled = createLockdown({ enabled: false });
  disabled.noteDemoLogin('someone'); // a disabled lockdown ignores detections
  for (const lockdown of [inactive, disabled]) {
    for (const [method, p] of [['GET', '/index.html'], ['POST', '/api/raid'], ['GET', '/']]) {
      assert.strictEqual(run(lockdown, method, p).nextCalled, true);
    }
  }
});

test('scanAccounts: enabled accounts verifying a demo password are offenders; disabled ones are not', () => {
  const lockdown = createLockdown({ enabled: true });
  const accounts = [{ username: 'a' }, { username: 'b', disabled: true }, { username: 'c' }];
  const verify = (pw, account) => ({ ok: pw === 'demo-pw' && account.username !== 'c' });
  lockdown.scanAccounts(accounts, verify, ['demo-pw']);
  assert.deepStrictEqual(lockdown.offenders(), ['a']);
  lockdown.clear('a');
  assert.strictEqual(lockdown.isActive(), false);
});

// --- the hand-copied committed control.db -----------------------------------------

test('boot: one [security] lockdown banner naming the offenders and never a password', () => {
  const banners = bootWarnings.filter((l) => l.includes('[security]') && l.includes('CREDENTIAL LOCKDOWN'));
  assert.strictEqual(banners.length, 1, bootWarnings.join('\n'));
  for (const name of DEMO_ACCOUNTS) assert.ok(banners[0].includes(name), `banner names ${name}`);
  assert.ok(!banners[0].includes(DEMO_PASSWORD));
  assert.strictEqual(app.isCredentialLockdownActive(), true);
});

test('locked: only /healthz, the login page + assets and /api/auth/* are served', async () => {
  assert.strictEqual((await call('GET', '/healthz')).status, 200);

  const login = await call('GET', '/login.html');
  assert.strictEqual(login.status, 200);
  assert.ok(login.text.includes('<form'), 'the login page body is served');

  const css = await call('GET', '/css/style.css');
  assert.strictEqual(css.status, 200);
  assert.match(css.headers.get('content-type') || '', /text\/css/);
  assert.ok(css.text.length > 0);

  const logo = await call('GET', '/te-logo.png');
  assert.strictEqual(logo.status, 200);
  assert.match(logo.headers.get('content-type') || '', /^image\//);

  const mode = await call('GET', '/api/auth/mode');
  assert.strictEqual(mode.status, 200);
  assert.strictEqual(mode.json.mode, 'real');

  const index = await call('GET', '/index.html');
  assert.strictEqual(index.status, 403);
  assert.match(index.headers.get('content-type') || '', /html/);
  assert.ok(index.text.includes('/login.html'));

  assert.strictEqual((await call('GET', '/')).status, 403);
  assert.strictEqual((await call('GET', '/js/transitions.js')).status, 403);

  const api = await call('GET', '/api/raid');
  assert.strictEqual(api.status, 403);
  assert.strictEqual(api.json.credentialLockdown, true);
});

test('middleware: POST /api/csp-report alone passes while locked (SAFE-02); every other spelling or method is refused', () => {
  const lockdown = activeLockdown();
  assert.strictEqual(run(lockdown, 'POST', '/api/csp-report').nextCalled, true);
  for (const [method, p] of [
    ['GET', '/api/csp-report'], ['PUT', '/api/csp-report'], ['DELETE', '/api/csp-report'],
    ['POST', '/api/csp-report/'], ['POST', '/api/csp-report/x'], ['POST', '/api//csp-report'],
    ['POST', '/api/CSP-report'], ['POST', '/api/csp-report/..%2Fraid'], ['POST', '/api/csp-reports'],
    ['GET', '/api/admin/csp-violations'], ['POST', '/api/raid'],
  ]) {
    const { res, nextCalled } = run(lockdown, method, p);
    assert.strictEqual(nextCalled, false, `${method} ${p} must not pass`);
    assert.strictEqual(res.statusCode, 403, `${method} ${p}`);
  }
});

test('locked (live): POST /api/csp-report answers 204, the violation list and other API calls stay 403', async () => {
  const report = await fetch(base + '/api/csp-report', {
    method: 'POST',
    headers: { 'content-type': 'application/csp-report' },
    body: JSON.stringify({ 'csp-report': {
      'document-uri': base + '/login.html?next=%2Fdeal-x', 'effective-directive': 'script-src-elem',
      'blocked-uri': 'inline', 'source-file': base + '/login.html', 'line-number': 3,
    } }),
  });
  assert.strictEqual(report.status, 204);
  await report.text();

  const list = await call('GET', '/api/admin/csp-violations');
  assert.strictEqual(list.status, 403);
  assert.strictEqual(list.json.credentialLockdown, true);
  const other = await call('POST', '/api/raid', { body: {} });
  assert.strictEqual(other.status, 403);
  assert.strictEqual(other.json.credentialLockdown, true);
});

test('remedy: sign in with the demo password forces rotation; the lockdown holds until all four rotate', async () => {
  // karen: demo password -> 200 with the forced-change marker, persisted.
  const login = await call('POST', '/api/auth/login', { body: { username: 'karen', password: DEMO_PASSWORD } });
  assert.strictEqual(login.status, 200, login.text);
  assert.strictEqual(login.json.mustChangePassword, true);
  assert.strictEqual(blobOf('karen').mustChangePassword, true);
  const karenCookie = cookieFrom(login);

  const me = await call('GET', '/api/auth/me', { cookie: karenCookie });
  assert.strictEqual(me.json.user.mustChangePassword, true);
  // Locked: even a signed-in session reaches no data route.
  const locked = await call('GET', '/api/raid', { cookie: karenCookie });
  assert.strictEqual(locked.status, 403);
  assert.strictEqual(locked.json.credentialLockdown, true);

  const rotated = await call('POST', '/api/auth/change-password', {
    cookie: karenCookie, body: { currentPassword: DEMO_PASSWORD, newPassword: 'karen-rotated-passphrase-1' },
  });
  assert.strictEqual(rotated.status, 200, rotated.text);
  assert.strictEqual(app.isCredentialLockdownActive(), true, 'three offenders remain');

  // admin: the demo password itself is refused as a NEW password in real mode.
  const adminLogin = await call('POST', '/api/auth/login', { body: { username: 'admin', password: DEMO_PASSWORD } });
  assert.strictEqual(adminLogin.status, 200, adminLogin.text);
  const refused = await call('POST', '/api/auth/change-password', {
    cookie: cookieFrom(adminLogin), body: { currentPassword: DEMO_PASSWORD, newPassword: DEMO_PASSWORD },
  });
  assert.strictEqual(refused.status, 400);
  assert.strictEqual(app.isCredentialLockdownActive(), true);

  let adminCookie = cookieFrom(adminLogin);
  const adminRotated = await call('POST', '/api/auth/change-password', {
    cookie: adminCookie, body: { currentPassword: DEMO_PASSWORD, newPassword: 'admin-rotated-passphrase-1' },
  });
  assert.strictEqual(adminRotated.status, 200, adminRotated.text);
  adminCookie = cookieFrom(adminRotated);
  assert.strictEqual(app.isCredentialLockdownActive(), true, 'pmo and employee-demo remain');

  for (const username of ['pmo', 'employee-demo']) {
    const l = await call('POST', '/api/auth/login', { body: { username, password: DEMO_PASSWORD } });
    assert.strictEqual(l.status, 200, l.text);
    const c = await call('POST', '/api/auth/change-password', {
      cookie: cookieFrom(l), body: { currentPassword: DEMO_PASSWORD, newPassword: `${username}-rotated-passphrase-1` },
    });
    assert.strictEqual(c.status, 200, c.text);
  }

  assert.strictEqual(app.isCredentialLockdownActive(), false, 'every offender has rotated');

  // Unlocked: the portal behaves normally again.
  const index = await call('GET', '/index.html');
  assert.strictEqual(index.status, 200);
  const raid = await call('GET', '/api/raid', { cookie: adminCookie });
  assert.strictEqual(raid.status, 200, raid.text);
});

// --- dev mode and committed-file invariants ------------------------------------------

test('dev mode on a copy of the committed control.db is never locked down', () => {
  const dir = path.join(TMP, 'dev-copy');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(REPO, 'data', 'control.db'), path.join(dir, 'control.db'));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('MA_')) delete env[key];
  for (const key of ['DEMO_OPEN', 'ADMIN_TOKEN', 'TRUST_PROXY', 'PUBLIC_BASE_URL']) delete env[key];
  Object.assign(env, {
    MA_CONTROL_DB_PATH: path.join(dir, 'control.db'),
    MA_RUNTIME_DB_PATH: path.join(dir, 'runtime.db'),
    MA_DEMO_DB_PATH: path.join(dir, 'demo.db'),
    MA_AUDIT_DB_PATH: path.join(dir, 'audit.db'),
    MA_DEALS_DIR: path.join(dir, 'deals'),
  });
  const result = spawnSync(process.execPath, ['-e',
    "const app = require('./server.js'); console.log('LOCKDOWN=' + app.isCredentialLockdownActive()); process.exit(0);"],
  { cwd: REPO, env, encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('LOCKDOWN=false'), result.stdout);
  assert.ok(!result.stderr.includes('CREDENTIAL LOCKDOWN'));
});

test('the committed data/control.db and data/demo.db are unchanged', () => {
  // Content only: a sibling process may legitimately leave an empty sidecar.
  assert.deepStrictEqual(COMMITTED.map(sha256OrEmpty), BEFORE);
});
