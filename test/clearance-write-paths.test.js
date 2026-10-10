// Phase 11 / 11-03 (AUTHZ-03, D-11-03, R1-02, 09-SECURITY UF-2): the clean-room
// clearance rule on the task/RAID WRITE paths. v2.1.0 (F-1) closed the READ
// side — an uncleared deal member never sees a restricted task/RAID record in
// a list. R1-02 proved the by-id write side was still open: an uncleared pmo
// holding an hr-area converted record's id could read it back through the
// optimistic-locking 409 echo, overwrite it, or delete it.
//
// Contract proven here (PRD acceptance 3):
//   - an invisible record answers 404 `{ error: 'Not found' }` on update,
//     status flip and delete — with a current version, a stale version or NO
//     version — never 403, never 409, never any field of the record;
//   - the 404 body for an invisible record is byte-identical to the body for
//     an id that does not exist;
//   - the stored record is unchanged;
//   - a cleared member and admin are unaffected; conversions still work.
//
// Boots the REAL requireable app against an ISOLATED temp control/runtime/
// demo/deals/audit set (MA_* paths), exactly like test/task-access-filter.test.js.
//
// node:test — run via `node --test test/clearance-write-paths.test.js`.

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-clearance-write-paths-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-clearance-write-paths-test-token';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { ensureUser } = require('./helpers/seed-identity.js');
const { createDealDatabase } = require('../db/dealSeed.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
const fixtureUsers = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

let dealSeq = 0;
function registerDeal(deal) {
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(deal.id, dealSeq++, deal.status || 'active', JSON.stringify(deal));
}
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  ensureUser(controlConn, { username, role });
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }
function postJSON(base, urlPath, token, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Cookie: cookieHeader(token) } : {}),
    body: JSON.stringify(body || {}),
  });
}
function getJSON(base, urlPath, token) {
  return fetch(`${base}${urlPath}`, { headers: token ? { Cookie: cookieHeader(token) } : {} });
}
function delReq(base, urlPath, token) {
  return fetch(`${base}${urlPath}`, { method: 'DELETE', headers: token ? { Cookie: cookieHeader(token) } : {} });
}
function vOf(rec) { return Number.isSafeInteger(rec && rec.version) && rec.version >= 0 ? rec.version : 0; }

// admin + karen (hrbp/IL) + pmo_hr (granted ONLY 'hr') + pmo_none (a deal
// member with NO clearance grant at all — the R1-02 attacker).
function makeDeal(id) {
  const deal = {
    id, name: id, targetCompany: `${id} Co`,
    members: ['admin', 'karen', 'pmo_hr', 'pmo_none'],
    memberGrants: { pmo_hr: { ddAreas: ['hr'] } },
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}

// One hr finding converted to BOTH a task and a RAID entry (by admin), plus a
// manually created, unrestricted task and RAID entry (they must stay fully
// editable by the uncleared member — over-blocking is a regression too).
async function seedFixture(base, id) {
  const deal = makeDeal(id);
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const hrToken = newSession('pmo_hr', 'pmo'); bindDeal(hrToken, deal.id);
  const noneToken = newSession('pmo_none', 'pmo'); bindDeal(noneToken, deal.id);

  const findingRes = await postJSON(base, '/api/dd/findings', adminToken, {
    area: 'hr', title: 'HR-SECRET key-person retention exposure', severity: 'high', notes: 'HR-SECRET-NOTES do not circulate',
  });
  const { finding } = await findingRes.json();
  const convRes = await postJSON(base, `/api/dd/findings/${finding.id}/convert`, adminToken, {
    toTask: true, toRaid: true, version: vOf(finding),
  });
  assert.strictEqual(convRes.status, 200, 'fixture: admin converts the hr finding');
  const conv = await convRes.json();

  const manualTaskRes = await postJSON(base, '/api/integration-tasks', adminToken, { title: 'Manual unrestricted task', workstreamId: 'ws_imo' });
  const manualTask = (await manualTaskRes.json()).task;
  const manualRaidRes = await postJSON(base, '/api/raid', adminToken, { title: 'Manual unrestricted RAID', type: 'risk' });
  const manualRaid = (await manualRaidRes.json()).entry;

  return {
    deal,
    tokens: { adminToken, karenToken, hrToken, noneToken },
    hrTask: conv.task, hrRaid: conv.raid, finding,
    manualTask, manualRaid,
  };
}

async function listAs(base, token, urlPath) {
  const res = await getJSON(base, urlPath, token);
  assert.strictEqual(res.status, 200);
  return res.json();
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Task 1 (tracer): the R1-02 409 oracle + overwrite on POST /api/integration-tasks
// ---------------------------------------------------------------------------
test('clearance-write-paths (tracer): uncleared member POST {id, version} on an hr task -> 404 {error:"Not found"}, no record field, record unchanged; missing id answers byte-identically; cleared member still updates', async () => {
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_cwptracer');
    const taskId = fx.hrTask.id;

    const before = (await listAs(base, fx.tokens.karenToken, '/api/integration-tasks')).find((t) => t.id === taskId);
    assert.ok(before, 'fixture: karen sees the hr task');
    assert.ok(fx.hrTask.clearanceArea === 'hr' || before.clearanceArea === 'hr', 'fixture: the task is stamped hr');

    // (1) stale version: the R1-02 oracle — must be 404, NEVER 409 with a body.
    const staleRes = await postJSON(base, '/api/integration-tasks', fx.tokens.noneToken, { id: taskId, version: 999 });
    const staleText = await staleRes.text();
    assert.strictEqual(staleRes.status, 404, 'a stale version on an invisible task must be 404, never 409');
    assert.deepStrictEqual(JSON.parse(staleText), { error: 'Not found' });

    // (2) current version + overwrite + status flip attempt.
    const writeRes = await postJSON(base, '/api/integration-tasks', fx.tokens.noneToken, {
      id: taskId, status: 'done', title: 'overwritten by an uncleared member', version: vOf(before),
    });
    const writeText = await writeRes.text();
    assert.strictEqual(writeRes.status, 404);
    assert.strictEqual(writeText, staleText, 'stale-version and current-version answers must be byte-identical');

    // (3) no version at all.
    const bareRes = await postJSON(base, '/api/integration-tasks', fx.tokens.noneToken, { id: taskId, status: 'done' });
    assert.strictEqual(bareRes.status, 404);
    assert.strictEqual(await bareRes.text(), staleText);

    // No field of the record in any response body.
    for (const needle of ['HR-SECRET', 'retention', 'hr', before.owner || '@@none@@', before.source, 'clearanceArea', before.id]) {
      if (!needle || needle === 'hr') continue; // 'hr' alone is too short to be a meaningful needle
      assert.ok(!staleText.includes(needle) && !writeText.includes(needle), `404 body must not contain ${JSON.stringify(needle)}`);
    }

    // (4) the stored record is unchanged (re-read as the IL).
    const after = (await listAs(base, fx.tokens.karenToken, '/api/integration-tasks')).find((t) => t.id === taskId);
    assert.deepStrictEqual(after, before, 'the restricted task must be byte-for-byte unchanged');
    assert.ok(!after.updatedBy || after.updatedBy !== 'pmo_none', 'no write attributed to the uncleared member');

    // (5) a missing id answers the byte-identical body.
    const missingRes = await postJSON(base, '/api/integration-tasks', fx.tokens.noneToken, { id: 'task_does_not_exist', version: 0 });
    assert.strictEqual(missingRes.status, 404);
    assert.strictEqual(await missingRes.text(), staleText, 'missing and invisible must be indistinguishable');

    // (6) a cleared member is unaffected.
    const okRes = await postJSON(base, '/api/integration-tasks', fx.tokens.hrToken, { id: taskId, status: 'doing', version: vOf(before) });
    assert.strictEqual(okRes.status, 200, 'a member cleared for hr must still update the task');
    const okBody = await okRes.json();
    assert.strictEqual(okBody.task.status, 'doing');

    // (7) the unrestricted manual task stays editable by the uncleared member.
    const manualRes = await postJSON(base, '/api/integration-tasks', fx.tokens.noneToken, {
      id: fx.manualTask.id, status: 'doing', version: vOf(fx.manualTask),
    });
    assert.strictEqual(manualRes.status, 200, 'an unrestricted task must not be over-blocked');
  } finally {
    server.close();
  }
});
