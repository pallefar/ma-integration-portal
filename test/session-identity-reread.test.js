// COLLAB-02 (Phase 10, plan 03, D-10-04): a change to a member's standing binds
// on their NEXT request with the SAME cookie — nothing is cached on the
// session row.
//
//   1. clearance grants (the "grants half"): granting a deal member a DD area
//      makes the area's content visible on the member's very next request;
//      revoking hides it again — no re-login, no re-select.
//   2. the account itself: an account that disappears or is disabled
//      out-of-band (a direct control.db change — no admin route involved)
//      stops authorizing on the next request and its sessions are swept.
//
// Mirrors test/dd-grants.test.js's harness (temp control/runtime/demo/deals/
// audit set; accounts seeded from db.json's fixture users).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-identity-reread-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const controlStore = require('../db/controlStore.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

const fixtureUsers = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'db.json'), 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

let dealSeq = 0;
function registerDeal(deal) {
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(deal.id, dealSeq++, deal.status || 'active', JSON.stringify(deal));
}
function freshDeal(id) {
  return {
    id, name: id, targetCompany: id + ' Co', members: ['karen', 'pmo'], memberGrants: {},
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
}
function session(username, role, dealId) {
  const token = sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
  if (dealId) sessionsDb.bindSessionDeal(runtimeConn, token, dealId);
  return token;
}
const H = (token, json) => ({ Cookie: 'ma_session=' + token, ...(json ? { 'Content-Type': 'application/json' } : {}) });

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('COLLAB-02 grants: grant then revoke bind on the member\'s next request with the same cookie', async () => {
  const deal = freshDeal('deal_reread1');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karen = session('karen', 'hrbp', deal.id);
  const pmo = session('pmo', 'pmo', deal.id);
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const created = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: H(karen, true), body: JSON.stringify({ area: 'legal', text: 'Legal item for reread' }),
    });
    assert.ok(created.status === 200 || created.status === 201, 'DD item create must succeed, got ' + created.status);
    const list = async () => (await fetch(`${base}/api/dd/request-items`, { headers: H(pmo) })).json();

    assert.deepStrictEqual(await list(), [], 'no grant: nothing visible');

    const grant = await fetch(`${base}/api/deals/${deal.id}/grants`, {
      method: 'POST', headers: H(karen, true), body: JSON.stringify({ username: 'pmo', ddAreas: ['legal'] }),
    });
    assert.strictEqual(grant.status, 200);
    assert.strictEqual((await list()).length, 1, 'granted: the very next request sees the area');

    const revoke = await fetch(`${base}/api/deals/${deal.id}/grants`, {
      method: 'POST', headers: H(karen, true), body: JSON.stringify({ username: 'pmo', ddAreas: [] }),
    });
    assert.strictEqual(revoke.status, 200);
    assert.deepStrictEqual(await list(), [], 'revoked: hidden again on the very next request');
  } finally {
    server.close();
  }
});

test('COLLAB-02 account: an account deleted or disabled out-of-band stops authorizing on the next request and its sessions are swept', async () => {
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const probe = async (token) => fetch(`${base}/api/menus`, { headers: H(token) });

    // disabled via the store (not the admin route)
    const pmo = session('pmo', 'pmo');
    assert.strictEqual((await probe(pmo)).status, 200);
    controlStore.updateUser('pmo', { disabled: true });
    assert.strictEqual((await probe(pmo)).status, 401);
    assert.strictEqual(
      runtimeConn.prepare('SELECT COUNT(*) AS n FROM sessions WHERE username = ?').get('pmo').n, 0,
      'the disabled account\'s sessions are deleted by the identity resolver'
    );
    controlStore.updateUser('pmo', { disabled: false });
    assert.strictEqual((await probe(pmo)).status, 401, 're-enabling does not revive the old cookie');
    assert.strictEqual((await probe(session('pmo', 'pmo'))).status, 200, 'a fresh session works again');

    // row removed entirely
    const karen = session('karen', 'hrbp');
    assert.strictEqual((await probe(karen)).status, 200);
    controlConn.prepare('DELETE FROM users WHERE id = ?').run('karen');
    assert.strictEqual((await probe(karen)).status, 401);
    assert.strictEqual(
      runtimeConn.prepare('SELECT COUNT(*) AS n FROM sessions WHERE username = ?').get('karen').n, 0
    );
  } finally {
    server.close();
  }
});
