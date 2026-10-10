// ACCT-06 server half (Phase 10, plan 03, D-10-07): every signed-in user can
// list and end ONLY their own sessions through GET /api/auth/sessions and
// DELETE /api/auth/sessions/:id.
//
//   - the listed `id` is a derived 32-hex identifier, never a stored token_hash
//   - exactly one entry is `current:true`
//   - ending another of my sessions kills that cookie; ending the current one
//     answers {endedCurrent:true} with a clearing Set-Cookie
//   - another user's session id answers 404 and leaves that session working
//   - the employee role may end its own sessions (it is on the self-service
//     allowlist, not the default write tier); anonymous is 401, even with
//     DEMO_OPEN=1 (control-plane path)
//   - ending a non-current own session writes exactly one `session-end-own`
//     security event
//
// Boots the real app on an ISOLATED temp control/runtime/demo/audit set.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const REPO = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-self-sessions-'));
fs.copyFileSync(path.join(REPO, 'data', 'control.db'), path.join(TMP, 'control.db'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const auditHook = require('../db/auditHook.js');
const { ensureUser } = require('./helpers/seed-identity.js');
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

let counter = 0;
// Create one session with a distinct, deterministic created_at (newest = last created).
function mint(username, role, userAgent) {
  ensureUser(controlConn, { username, role });
  const token = sessionsDb.createSession(runtimeConn, {
    username, role, ttlMs: 60 * 60 * 1000, userAgent, ip: '10.0.0.' + (++counter),
  });
  const createdAt = new Date(Date.now() - 600000 + counter * 1000).toISOString();
  runtimeConn.prepare('UPDATE sessions SET created_at = ? WHERE token_hash = ?')
    .run(createdAt, sessionsDb.hashToken(token));
  return token;
}
function cookie(token) { return 'ma_session=' + token; }
async function api(method, route, token, body) {
  const headers = {};
  if (token) headers.cookie = cookie(token);
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch (e) { /* none */ }
  return { status: res.status, json, headers: res.headers };
}

test('GET /api/auth/sessions lists only the caller\'s unexpired sessions, newest first, with derived ids', async () => {
  const t1 = mint('sess-pmo', 'pmo', 'Browser One/1.0');
  const t2 = mint('sess-pmo', 'pmo', 'Browser Two/2.0');
  const t3 = mint('sess-pmo', 'pmo', 'x'.repeat(500));
  const other = mint('sess-other', 'hrbp', 'Other Agent');
  // an expired row must not be listed
  const expired = mint('sess-pmo', 'pmo', 'Expired Agent');
  runtimeConn.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
    .run(new Date(Date.now() - 1000).toISOString(), sessionsDb.hashToken(expired));

  const res = await api('GET', '/api/auth/sessions', t2);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('cache-control') || '', /no-store/);
  assert.strictEqual(res.json.length, 3, 'only the three live sessions of this user');
  for (const entry of res.json) {
    assert.deepStrictEqual(Object.keys(entry).sort(), ['createdAt', 'current', 'expiresAt', 'id', 'ip', 'userAgent']);
    assert.match(entry.id, /^[0-9a-f]{32}$/);
  }
  assert.deepStrictEqual(
    res.json.map((e) => e.userAgent.slice(0, 9)),
    ['xxxxxxxxx', 'Browser T', 'Browser O'],
    'newest first'
  );
  assert.strictEqual(res.json[0].userAgent.length, 200, 'user agent is truncated to 200 characters');
  assert.strictEqual(res.json.filter((e) => e.current).length, 1, 'exactly one current session');
  assert.strictEqual(res.json.find((e) => e.current).userAgent, 'Browser Two/2.0');

  // The id is never a stored token hash (nor a prefix/suffix of one).
  const stored = runtimeConn.prepare('SELECT token_hash FROM sessions').all().map((r) => r.token_hash);
  assert.ok(stored.length >= 5);
  for (const entry of res.json) {
    for (const hash of stored) {
      assert.notStrictEqual(entry.id, hash);
      assert.ok(!hash.startsWith(entry.id) && !hash.endsWith(entry.id));
    }
  }
  void t1; void t3; void other;
});

test('DELETE another own session: 200, that cookie then 401s; the caller is untouched and one session-end-own event is written', async () => {
  const keep = mint('sess-del', 'pmo', 'Keeper');
  const victim = mint('sess-del', 'pmo', 'Victim');
  const list = await api('GET', '/api/auth/sessions', keep);
  const victimEntry = list.json.find((e) => !e.current);
  assert.ok(victimEntry);

  const eventsBefore = auditHook.queryAudit({ actor: 'sess-del', limit: 500 }).filter((r) => r.action === 'session-end-own').length;
  assert.strictEqual((await api('GET', '/api/menus', victim)).status, 200);
  const del = await api('DELETE', '/api/auth/sessions/' + victimEntry.id, keep);
  assert.strictEqual(del.status, 200);
  assert.deepStrictEqual(del.json, { success: true });
  assert.strictEqual((await api('GET', '/api/menus', victim)).status, 401, 'the ended session no longer authenticates');
  assert.strictEqual((await api('GET', '/api/menus', keep)).status, 200, 'the calling session is untouched');

  const events = auditHook.queryAudit({ actor: 'sess-del', limit: 500 }).filter((r) => r.action === 'session-end-own');
  assert.strictEqual(events.length, eventsBefore + 1, 'exactly one session-end-own event');
  assert.strictEqual(events[0].row_id, 'sess-del');
  assert.strictEqual(events[0].actor_role, 'pmo');
});

test('DELETE the current session: 200 {endedCurrent:true} with a clearing Set-Cookie, then 401', async () => {
  const solo = mint('sess-cur', 'hrbp', 'Solo');
  const list = await api('GET', '/api/auth/sessions', solo);
  assert.strictEqual(list.json.length, 1);
  const del = await api('DELETE', '/api/auth/sessions/' + list.json[0].id, solo);
  assert.strictEqual(del.status, 200);
  assert.deepStrictEqual(del.json, { success: true, endedCurrent: true });
  const setCookie = del.headers.get('set-cookie') || '';
  assert.match(setCookie, /ma_session=;/);
  assert.match(setCookie, /Max-Age=0/);
  assert.strictEqual((await api('GET', '/api/menus', solo)).status, 401);
});

test('DELETE with another user\'s session id: 404, and that session keeps working', async () => {
  const mine = mint('sess-mine', 'pmo', 'Mine');
  const theirs = mint('sess-theirs', 'pmo', 'Theirs');
  const theirList = await api('GET', '/api/auth/sessions', theirs);
  const theirId = theirList.json[0].id;
  const del = await api('DELETE', '/api/auth/sessions/' + theirId, mine);
  assert.strictEqual(del.status, 404);
  assert.strictEqual((await api('GET', '/api/menus', theirs)).status, 200);
  // a made-up id is indistinguishable from a foreign one
  const unknown = await api('DELETE', '/api/auth/sessions/' + 'a'.repeat(32), mine);
  assert.strictEqual(unknown.status, 404);
  assert.deepStrictEqual(unknown.json, del.json);
});

test('employee may end its own session (self-service allowlist, not the default write tier)', async () => {
  const emp = mint('sess-emp', 'employee', 'Desk');
  const second = mint('sess-emp', 'employee', 'Phone');
  const list = await api('GET', '/api/auth/sessions', emp);
  const other = list.json.find((e) => !e.current);
  const del = await api('DELETE', '/api/auth/sessions/' + other.id, emp);
  assert.strictEqual(del.status, 200);
  assert.strictEqual((await api('GET', '/api/menus', second)).status, 401);
});

test('anonymous requests are 401, including under DEMO_OPEN=1 (control-plane, never open)', async () => {
  assert.strictEqual((await api('GET', '/api/auth/sessions')).status, 401);
  assert.strictEqual((await api('DELETE', '/api/auth/sessions/' + 'b'.repeat(32))).status, 401);
  process.env.DEMO_OPEN = '1';
  try {
    assert.strictEqual((await api('GET', '/api/auth/sessions')).status, 401);
    assert.strictEqual((await api('DELETE', '/api/auth/sessions/' + 'b'.repeat(32))).status, 401);
  } finally {
    delete process.env.DEMO_OPEN;
  }
});

test('GET /api/auth/sessions never carries a token hash or secret', async () => {
  const t = mint('sess-scan', 'pmo', 'Scan');
  const res = await api('GET', '/api/auth/sessions', t);
  const text = JSON.stringify(res.json);
  for (const row of runtimeConn.prepare('SELECT token_hash FROM sessions').all()) {
    assert.ok(!text.includes(row.token_hash));
  }
  assert.ok(!text.includes(t), 'the raw cookie value must never be echoed');
});

// IN-01 (Phase 10 review): the `current` flag compares a stored token hash with
// req.portalUser.sessionId — correct only because findSession() reports the
// token HASH as sessionId. Pin that invariant so a refactor that changes it
// cannot silently turn `current` into "never" (or leak the hash as the id).
test('IN-01: findSession().sessionId is the stored token hash; the public id is derived from it and never equal', async () => {
  const token = mint('in01-user', 'pmo', 'UA in01');
  const found = sessionsDb.findSession(runtimeConn, token);
  assert.strictEqual(found.sessionId, sessionsDb.hashToken(token));
  const listed = sessionsDb.listSessionsForUser(runtimeConn, 'in01-user');
  assert.strictEqual(listed.length, 1);
  assert.strictEqual(listed[0].tokenHash, found.sessionId);
  assert.strictEqual(listed[0].id, sessionsDb.publicSessionId(found.sessionId));
  assert.notStrictEqual(listed[0].id, found.sessionId);
  const res = await api('GET', '/api/auth/sessions', token);
  assert.deepStrictEqual(res.json.map((s) => [s.id, s.current, 'tokenHash' in s]), [[listed[0].id, true, false]]);
});
