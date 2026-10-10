// ACCT-05 / D-10-06 (Phase 10, plan 05): per-account + per-source sign-in
// throttling.
//
//   1. lib/loginThrottle.js unit behaviour on a fake clock (free failures,
//      exponential backoff, window slide, clear, bounded map, per-call ceiling).
//   2. server.js throttleOptionsFor (admin ceiling) as a pure function.
//   3. HTTP: nine wrong passwords for alice do not block bob from the same
//      address; a correct password while locked is still 429; an unknown name
//      behaves exactly like a known one; 429 bodies are identical with a
//      Retry-After.
//
// Boots the REAL app in dev mode against an ISOLATED temp control/runtime/
// demo/audit set; the committed data/*.db are never opened.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');
const { createThrottle } = require('../lib/loginThrottle');

const REPO = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-login-throttle-'));
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
const { ensureUser } = require('./helpers/seed-identity.js');
const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);

// --- 1. lib/loginThrottle.js on a fake clock ---------------------------------

function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}
function makeThrottle(clock, overrides) {
  return createThrottle({
    windowMs: 15 * 60 * 1000, freeFailures: 5, baseDelayMs: 1000,
    maxDelayMs: 15 * 60 * 1000, maxEntries: 10000, now: clock.now, ...overrides,
  });
}

test('throttle: five failures are free, the next attempt is refused with a retry-after', () => {
  const clock = fakeClock();
  const th = makeThrottle(clock);
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(th.check('u:alice').allowed, true, `attempt ${i + 1} is allowed`);
    th.fail('u:alice');
  }
  const verdict = th.check('u:alice');
  assert.strictEqual(verdict.allowed, false);
  assert.ok(verdict.retryAfterMs > 0);
  clock.advance(verdict.retryAfterMs);
  assert.strictEqual(th.check('u:alice').allowed, true, 'allowed again once the backoff has elapsed');
});

test('throttle: backoff doubles per further failure and is capped at maxDelayMs', () => {
  const clock = fakeClock();
  const th = makeThrottle(clock, { maxDelayMs: 8000 });
  for (let i = 0; i < 5; i++) th.fail('k');
  assert.strictEqual(th.check('k').retryAfterMs, 1000);
  clock.advance(1000);
  th.fail('k'); // 6th failure -> 2^1
  assert.strictEqual(th.check('k').retryAfterMs, 2000);
  clock.advance(2000);
  th.fail('k'); // 7th -> 2^2
  assert.strictEqual(th.check('k').retryAfterMs, 4000);
  clock.advance(4000);
  th.fail('k'); // 8th -> 2^3 = 8000 (== cap)
  assert.strictEqual(th.check('k').retryAfterMs, 8000);
  clock.advance(8000);
  th.fail('k'); // 9th -> would be 16000, capped
  assert.strictEqual(th.check('k').retryAfterMs, 8000);
});

test('throttle: failures older than the window no longer count; clear() resets', () => {
  const clock = fakeClock();
  const th = makeThrottle(clock);
  for (let i = 0; i < 5; i++) th.fail('k');
  assert.strictEqual(th.check('k').allowed, false);
  clock.advance(15 * 60 * 1000 + 1);
  assert.strictEqual(th.check('k').allowed, true, 'the window slid past every failure');

  for (let i = 0; i < 5; i++) th.fail('k2');
  assert.strictEqual(th.check('k2').allowed, false);
  th.clear('k2');
  assert.strictEqual(th.check('k2').allowed, true);
});

test('throttle: fail() reports the one failure that engages backoff', () => {
  const th = makeThrottle(fakeClock());
  const engaged = [];
  for (let i = 0; i < 8; i++) engaged.push(th.fail('k').engaged);
  assert.deepStrictEqual(engaged, [false, false, false, false, true, false, false, false]);
});

test('throttle: the map stays bounded under 20,000 distinct keys', () => {
  const clock = fakeClock();
  const th = makeThrottle(clock, { maxEntries: 10000 });
  for (let i = 0; i < 20000; i++) th.fail('u:name-' + i);
  assert.ok(th.size() <= 10000, `size ${th.size()} must not exceed maxEntries`);
});

test('throttle: expired keys are pruned', () => {
  const clock = fakeClock();
  const th = makeThrottle(clock);
  for (let i = 0; i < 50; i++) th.fail('u:' + i);
  assert.strictEqual(th.size(), 50);
  clock.advance(16 * 60 * 1000);
  th.prune();
  assert.strictEqual(th.size(), 0);
});

test('throttle: a per-call maxDelayMs caps an admin account at 5 minutes while the default reaches 15', () => {
  const clock = fakeClock();
  const th = makeThrottle(clock, { windowMs: 24 * 60 * 60 * 1000 });
  const ADMIN_CAP = 300000;
  let adminMax = 0;
  let defaultMax = 0;
  for (let i = 0; i < 20; i++) {
    th.fail('u:admin');
    const capped = th.check('u:admin', { maxDelayMs: ADMIN_CAP });
    const plain = th.check('u:admin');
    adminMax = Math.max(adminMax, capped.retryAfterMs);
    defaultMax = Math.max(defaultMax, plain.retryAfterMs);
    assert.ok(capped.retryAfterMs <= ADMIN_CAP, 'admin backoff never exceeds 5 minutes');
    clock.advance(plain.retryAfterMs); // wait out the (uncapped) backoff, then fail again
  }
  assert.strictEqual(adminMax, ADMIN_CAP);
  assert.strictEqual(defaultMax, 900000, 'the default ceiling is reached');
});

// --- 2. throttleOptionsFor ---------------------------------------------------

// WR-01 (Phase 10 review): the ceiling used to be 5 min for an enabled admin and
// 15 min for everyone else — an admin-enumeration oracle via Retry-After and via
// when the 429 lifts. It is now the SAME 5-minute ceiling for every name.
test('throttleOptionsFor (WR-01): one ceiling for every account — role, existence and disabled state are not observable', () => {
  assert.strictEqual(app.ADMIN_MAX_BACKOFF_MS, 300000);
  const expected = { maxDelayMs: 300000 };
  for (const acct of [{ role: 'admin' }, { role: 'pmo' }, { role: 'hrbp' }, { role: 'employee' },
    { role: 'admin', disabled: true }, null, undefined]) {
    assert.deepStrictEqual(app.throttleOptionsFor(acct), expected, JSON.stringify(acct));
  }
});

// --- 3. HTTP -------------------------------------------------------------------

let server;
let base;
test.before(async () => {
  for (const [username, password] of [['alice', 'alice-correct-passphrase'], ['bob', 'bob-correct-passphrase']]) {
    ensureUser(controlConn, { username, role: 'pmo' });
    const row = controlConn.prepare('SELECT data FROM users WHERE id = ?').get(username);
    const blob = JSON.parse(row.data);
    blob.hash = await passwords.hashPassword(password);
    controlConn.prepare('UPDATE users SET data = ? WHERE id = ?').run(JSON.stringify(blob), username);
  }
  server = await listenLocal(app);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

async function login(username, password) {
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* none */ }
  return { status: res.status, json, retryAfter: res.headers.get('retry-after') };
}

test('HTTP: nine wrong passwords for alice do not block bob; alice stays 429 even with the right password', async () => {
  const aliceStatuses = [];
  const throttledBodies = [];
  let retryAfter = null;
  for (let i = 0; i < 9; i++) {
    const r = await login('alice', 'definitely-wrong-' + i);
    aliceStatuses.push(r.status);
    if (r.status === 429) { throttledBodies.push(r.json); retryAfter = r.retryAfter; }
  }
  assert.deepStrictEqual(aliceStatuses, [401, 401, 401, 401, 401, 429, 429, 429, 429]);

  // Her CORRECT password is refused while she is in backoff.
  const correctWhileLocked = await login('alice', 'alice-correct-passphrase');
  assert.strictEqual(correctWhileLocked.status, 429);
  throttledBodies.push(correctWhileLocked.json);

  // Bob, same source address, is unaffected.
  const bob = await login('bob', 'bob-correct-passphrase');
  assert.strictEqual(bob.status, 200, JSON.stringify(bob.json));

  // An unknown name produces the very same sequence and the very same 429 body.
  const ghostStatuses = [];
  for (let i = 0; i < 9; i++) {
    const r = await login('ghost-user', 'definitely-wrong-' + i);
    ghostStatuses.push(r.status);
    if (r.status === 429) throttledBodies.push(r.json);
  }
  assert.deepStrictEqual(ghostStatuses, aliceStatuses, 'unknown and known names are indistinguishable');

  for (const body of throttledBodies) assert.deepStrictEqual(body, throttledBodies[0]);
  assert.ok(retryAfter !== null && Number(retryAfter) >= 1, 'a 429 carries Retry-After (seconds)');
});

test('HTTP: a successful sign-in clears that account\'s failure episode', async () => {
  // bob: three failures (under the free limit), then a success, then three more
  // failures — if success had not cleared the count the 6th failure would 429.
  for (let i = 0; i < 3; i++) assert.strictEqual((await login('bob', 'nope-' + i)).status, 401);
  assert.strictEqual((await login('bob', 'bob-correct-passphrase')).status, 200);
  for (let i = 0; i < 3; i++) assert.strictEqual((await login('bob', 'nope-again-' + i)).status, 401);
});

test('HTTP (WR-01): an enabled admin name and an unknown name get identical statuses, bodies AND Retry-After', async () => {
  const run = async (name) => {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const r = await login(name, 'wrong-wr01-' + i);
      out.push([r.status, r.status === 429 ? r.retryAfter : null, r.status === 429 ? JSON.stringify(r.json) : null]);
    }
    return out;
  };
  const adminSeq = await run('admin');
  const ghostSeq = await run('ghost-wr01');
  assert.ok(adminSeq.some(([s]) => s === 429), 'the admin name reached backoff');
  assert.deepStrictEqual(adminSeq, ghostSeq, 'nothing in the throttled answer reveals an enabled admin');
});
