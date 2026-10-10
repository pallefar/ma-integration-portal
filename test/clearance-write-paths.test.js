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

// admin + karen (hrbp/IL) + pmo_hr (granted ONLY 'hr') + pmo_legal (granted
// ONLY 'legal') + pmo_none (a deal member with NO clearance grant at all — the
// R1-02 attacker).
function makeDeal(id) {
  const deal = {
    id, name: id, targetCompany: `${id} Co`,
    members: ['admin', 'karen', 'pmo_hr', 'pmo_legal', 'pmo_none'],
    memberGrants: { pmo_hr: { ddAreas: ['hr'] }, pmo_legal: { ddAreas: ['legal'] } },
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}

// One hr finding converted to BOTH a task and a RAID entry (by admin), plus a
// manually created, unrestricted task and RAID entry (they must stay fully
// editable by the uncleared member — over-blocking is a regression too).
//
// `opts.custom: true` flips the deal to demoMode:false BEFORE any record
// exists so the SAME routes resolve through the custom* lanes
// (customIntegrationTasks / customRaidEntries) — the dual-lane proof
// (09-RESEARCH Pitfall 7): a suite that only exercised the default lane would
// pass while the real-deal lane stayed open.
async function seedFixture(base, id, opts) {
  const deal = makeDeal(id);
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const hrToken = newSession('pmo_hr', 'pmo'); bindDeal(hrToken, deal.id);
  const legalToken = newSession('pmo_legal', 'pmo'); bindDeal(legalToken, deal.id);
  const noneToken = newSession('pmo_none', 'pmo'); bindDeal(noneToken, deal.id);
  if (opts && opts.custom) {
    const modeRes = await postJSON(base, '/api/settings', adminToken, { demoMode: false });
    assert.strictEqual(modeRes.status, 200, 'fixture: admin switches the deal to the custom lane');
  }

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
    tokens: { adminToken, karenToken, hrToken, legalToken, noneToken },
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

// ---------------------------------------------------------------------------
// Task 2: every task/RAID write, delete, status-flip, synergy link and
// conversion path (both lanes).
// ---------------------------------------------------------------------------
const NOT_FOUND_BODY = '{"error":"Not found"}';

async function assertNotFound(res, label) {
  const text = await res.text();
  assert.strictEqual(res.status, 404, `${label}: must be 404 (got ${res.status}: ${text.slice(0, 160)})`);
  assert.strictEqual(text, NOT_FOUND_BODY, `${label}: the body must be the byte-identical central 404`);
}

// The full R1-02 write matrix for one lane. `custom` selects demoMode:false.
async function runWriteMatrix(dealId, custom) {
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, dealId, { custom });
    const none = fx.tokens.noneToken;
    const il = fx.tokens.karenToken;
    const tid = fx.hrTask.id;
    const rid = fx.hrRaid.id;

    const snapshot = async () => ({
      tasks: await listAs(base, il, '/api/integration-tasks'),
      raid: await listAs(base, il, '/api/raid'),
    });
    const before = await snapshot();
    const hrTaskBefore = before.tasks.find((t) => t.id === tid);
    const hrRaidBefore = before.raid.find((r) => r.id === rid);
    assert.ok(hrTaskBefore && hrRaidBefore, 'fixture: the IL sees both restricted records');
    assert.strictEqual(hrTaskBefore.clearanceArea, 'hr');
    assert.strictEqual(hrRaidBefore.clearanceArea, 'hr');

    // The uncleared member's own lists omit them (v2.1.0 F-1 read filter kept).
    const noneTasks = await listAs(base, none, '/api/integration-tasks');
    const noneRaid = await listAs(base, none, '/api/raid');
    assert.ok(!noneTasks.some((t) => t.id === tid), 'uncleared GET tasks omits the hr task');
    assert.ok(!noneRaid.some((r) => r.id === rid), 'uncleared GET raid omits the hr RAID entry');

    // --- RAID update / status flip: stale, current, absent version, missing id.
    await assertNotFound(await postJSON(base, '/api/raid', none, { id: rid, version: 999 }), 'raid stale version');
    await assertNotFound(await postJSON(base, '/api/raid', none, {
      id: rid, status: 'closed', title: 'overwritten', version: vOf(hrRaidBefore),
    }), 'raid status flip, current version');
    await assertNotFound(await postJSON(base, '/api/raid', none, { id: rid, status: 'closed' }), 'raid no version');
    await assertNotFound(await postJSON(base, '/api/raid', none, { id: 'raid_does_not_exist', version: 0 }), 'raid missing id');
    // --- task update (the tracer path, re-proven on this lane).
    await assertNotFound(await postJSON(base, '/api/integration-tasks', none, { id: tid, version: 999 }), 'task stale version');
    await assertNotFound(await postJSON(base, '/api/integration-tasks', none, {
      id: tid, status: 'done', version: vOf(hrTaskBefore),
    }), 'task status flip, current version');

    // --- DELETE: no version, stale, current; both collections; missing ids.
    for (const q of ['', '?expectedVersion=999', `?expectedVersion=${vOf(hrTaskBefore)}`]) {
      await assertNotFound(await delReq(base, `/api/integration-tasks/${tid}${q}`, none), `DELETE task ${q || '(no version)'}`);
    }
    for (const q of ['', '?expectedVersion=999', `?expectedVersion=${vOf(hrRaidBefore)}`]) {
      await assertNotFound(await delReq(base, `/api/raid/${rid}${q}`, none), `DELETE raid ${q || '(no version)'}`);
    }
    await assertNotFound(await delReq(base, '/api/integration-tasks/task_does_not_exist', none), 'DELETE missing task');
    await assertNotFound(await delReq(base, '/api/raid/raid_does_not_exist', none), 'DELETE missing raid');

    // --- D-11-07 path variants never answer 200 and never echo a record.
    for (const variant of [`/api/RAID/${rid}`, `/api/raid//${rid}`, `/api/raid/${rid}/`, `/api/integration-tasks/${tid}/`]) {
      const res = await delReq(base, variant, none);
      const text = await res.text();
      assert.notStrictEqual(res.status, 200, `DELETE ${variant} must not succeed`);
      assert.ok(!text.includes('HR-SECRET') && !text.includes('clearanceArea'), `DELETE ${variant} must not echo the record`);
    }

    // --- nothing changed, nothing was removed.
    const after = await snapshot();
    assert.deepStrictEqual(after, before, 'every restricted record must be byte-for-byte unchanged and still present');

    // --- over-blocking regression: the uncleared member still edits and
    // deletes UNRESTRICTED records.
    const manualUpd = await postJSON(base, '/api/raid', none, { id: fx.manualRaid.id, status: 'closed', version: vOf(fx.manualRaid) });
    assert.strictEqual(manualUpd.status, 200, 'an unrestricted RAID entry must stay editable by the uncleared member');
    const manualDel = await delReq(base, `/api/integration-tasks/${fx.manualTask.id}?expectedVersion=${vOf(fx.manualTask)}`, none);
    assert.strictEqual(manualDel.status, 200, 'an unrestricted task must stay deletable by the uncleared member');

    // --- the cleared member (hr grant) edits both; admin deletes both.
    const hrRaidUpd = await postJSON(base, '/api/raid', fx.tokens.hrToken, { id: rid, status: 'closed', version: vOf(hrRaidBefore) });
    assert.strictEqual(hrRaidUpd.status, 200, 'a member cleared for hr updates the restricted RAID entry');
    const hrTaskUpd = await postJSON(base, '/api/integration-tasks', fx.tokens.hrToken, { id: tid, status: 'doing', version: vOf(hrTaskBefore) });
    assert.strictEqual(hrTaskUpd.status, 200, 'a member cleared for hr updates the restricted task');
    const mid = await snapshot();
    const hrTaskNow = mid.tasks.find((t) => t.id === tid);
    const hrRaidNow = mid.raid.find((r) => r.id === rid);
    assert.strictEqual(hrTaskNow.status, 'doing');
    assert.strictEqual(hrRaidNow.status, 'closed');
    const adminTaskDel = await delReq(base, `/api/integration-tasks/${tid}?expectedVersion=${vOf(hrTaskNow)}`, fx.tokens.adminToken);
    assert.strictEqual(adminTaskDel.status, 200, 'admin deletes the restricted task');
    const ilRaidDel = await delReq(base, `/api/raid/${rid}?expectedVersion=${vOf(hrRaidNow)}`, il);
    assert.strictEqual(ilRaidDel.status, 200, 'the IL deletes the restricted RAID entry');
    const end = await snapshot();
    assert.ok(!end.tasks.some((t) => t.id === tid) && !end.raid.some((r) => r.id === rid), 'both are gone after the cleared deletes');
  } finally {
    server.close();
  }
}

test('clearance-write-paths (Task 2, default lane): uncleared member -> 404 {error:"Not found"} on RAID update/status-flip, task+RAID delete (no/stale/current version), path variants; records unchanged; unrestricted records and cleared members unaffected', async () => {
  await runWriteMatrix('deal_cwpmatrix', false);
});

test('clearance-write-paths (Task 2, custom lane demoMode:false): the SAME matrix holds on customIntegrationTasks / customRaidEntries', async () => {
  await runWriteMatrix('deal_cwpmatrixc', true);
});

test('clearance-write-paths (Task 2): synergy link — a restricted task id is rejected exactly like an unknown id; existing restricted links survive an uncleared edit; cleared members may link; no restricted title in any synergy read', async () => {
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_cwpsyn');
    const none = fx.tokens.noneToken;
    const hrId = fx.hrTask.id;

    const linkHr = await postJSON(base, '/api/synergies', none, { title: 'Probe', taskIds: [hrId] });
    const linkMissing = await postJSON(base, '/api/synergies', none, { title: 'Probe', taskIds: ['task_does_not_exist'] });
    assert.strictEqual(linkHr.status, 400);
    assert.strictEqual(linkMissing.status, 400);
    const hrBody = await linkHr.text();
    const missingBody = await linkMissing.text();
    assert.strictEqual(
      hrBody.split(hrId).join('<id>'),
      missingBody.split('task_does_not_exist').join('<id>'),
      'a restricted id must be indistinguishable from an unknown id (the only difference is the id the caller supplied)'
    );
    assert.ok(!hrBody.includes('HR-SECRET'), 'no record content in the refusal');

    // Admin (cleared) links the restricted task to a synergy.
    const created = await postJSON(base, '/api/synergies', fx.tokens.adminToken, { title: 'Linked synergy', taskIds: [hrId] });
    assert.strictEqual(created.status, 201, 'a cleared caller may link a restricted task');
    const syn = (await created.json()).initiative;
    assert.deepStrictEqual(syn.taskIds, [hrId]);

    // No synergy read carries a restricted task's content for the uncleared member.
    for (const p of ['/api/synergies', '/api/synergies/rollup']) {
      const res = await getJSON(base, p, none);
      assert.strictEqual(res.status, 200);
      assert.ok(!(await res.text()).includes('HR-SECRET'), `${p} must carry no restricted task content`);
    }

    // The uncleared member re-links to a visible task: the hidden link survives.
    const relink = await postJSON(base, '/api/synergies', none, { id: syn.id, version: vOf(syn), taskIds: [fx.manualTask.id] });
    assert.strictEqual(relink.status, 200, 'an uncleared member may edit the synergy with visible ids');
    const relinked = (await relink.json()).initiative;
    assert.ok(relinked.taskIds.includes(fx.manualTask.id));
    assert.ok(relinked.taskIds.includes(hrId), 'a restricted link the caller cannot see is preserved, not silently dropped');

    // ...and cannot ADD a restricted link on an update either.
    const addHr = await postJSON(base, '/api/synergies', none, { id: syn.id, version: vOf(relinked), taskIds: [hrId, fx.manualTask.id] });
    assert.strictEqual(addHr.status, 400, 'a restricted id supplied on update is refused like an unknown id');

    // A cleared member links it fine.
    const okLink = await postJSON(base, '/api/synergies', fx.tokens.hrToken, { id: syn.id, version: vOf(relinked), taskIds: [hrId] });
    assert.strictEqual(okLink.status, 200);
  } finally {
    server.close();
  }
});

test('clearance-write-paths (Task 2): conversions — re-convert dedupes for the cleared converter; a record stamped for an area the converter lacks answers the central 404, never a leak and never a duplicate; flight-risk conversion still works end to end', async () => {
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_cwpconv');
    const il = fx.tokens.karenToken;
    const sourceCount = async (token, collection, source) => (
      (await listAs(base, token, collection)).filter((r) => r.source === source).length
    );
    const findingNow = async (token) => (await listAs(base, token, '/api/dd/findings')).find((f) => f.id === fx.finding.id);
    const src = `dd-finding:${fx.finding.id}`;

    // (1) cleared re-convert: dedupes, returns the SAME records.
    const f1 = await findingNow(fx.tokens.adminToken);
    const again = await postJSON(base, `/api/dd/findings/${fx.finding.id}/convert`, fx.tokens.adminToken, { toTask: true, toRaid: true, version: vOf(f1) });
    assert.strictEqual(again.status, 200);
    const againBody = await again.json();
    assert.strictEqual(againBody.task.id, fx.hrTask.id);
    assert.strictEqual(againBody.raid.id, fx.hrRaid.id);
    assert.strictEqual(await sourceCount(il, '/api/integration-tasks', src), 1);
    assert.strictEqual(await sourceCount(il, '/api/raid', src), 1);

    // (2) the finding is re-pointed to 'legal' (the stamped hr clearance is
    // sticky). pmo_legal is cleared for the FINDING's new area but NOT for the
    // converted records' stamped area — the re-convert must 404, not hand the
    // hr task back in the 200 body.
    const f2 = await findingNow(fx.tokens.adminToken);
    const move = await postJSON(base, '/api/dd/findings', fx.tokens.adminToken, { id: fx.finding.id, area: 'legal', version: vOf(f2) });
    assert.strictEqual(move.status, 200, 'fixture: admin re-points the finding to legal');
    const f3 = await findingNow(fx.tokens.legalToken);
    assert.ok(f3, 'fixture: pmo_legal now sees the finding');
    for (const body of [{ toTask: true }, { toRaid: true }, { toTask: true, toRaid: true }]) {
      const res = await postJSON(base, `/api/dd/findings/${fx.finding.id}/convert`, fx.tokens.legalToken, Object.assign({ version: vOf(f3) }, body));
      await assertNotFound(res, `re-convert ${JSON.stringify(body)} by a member not cleared for the stamped area`);
    }
    assert.strictEqual(await sourceCount(il, '/api/integration-tasks', src), 1, 'no duplicate task was minted');
    assert.strictEqual(await sourceCount(il, '/api/raid', src), 1, 'no duplicate RAID entry was minted');
    const f4 = await findingNow(fx.tokens.adminToken);
    assert.deepStrictEqual(f4.linkedTaskIds, f3.linkedTaskIds, 'the refused conversion left the finding untouched');

    // (3) the cleared converter (admin) still converts and sees both.
    const adminAgain = await postJSON(base, `/api/dd/findings/${fx.finding.id}/convert`, fx.tokens.adminToken, { toTask: true, toRaid: true, version: vOf(f4) });
    assert.strictEqual(adminAgain.status, 200);
    assert.strictEqual((await adminAgain.json()).task.id, fx.hrTask.id);

    // (4) flight-risk conversion: create -> convert -> dedupe, converter sees both.
    const empRes = await postJSON(base, '/api/employees', fx.tokens.adminToken, { name: 'Pat Retention', role: 'Engineer', department: 'Eng' });
    const { employee } = await empRes.json();
    const frRes = await postJSON(base, '/api/org/flight-risk', il, { employeeId: employee.id, riskLevel: 'high', owner: 'karen', mitigation: 'Talk.' });
    assert.strictEqual(frRes.status, 201);
    const { entry } = await frRes.json();
    const c1 = await postJSON(base, `/api/org/flight-risk/${entry.id}/convert`, il, { toTask: true, toRaid: true, version: vOf(entry) });
    assert.strictEqual(c1.status, 200);
    const c1b = await c1.json();
    assert.ok(c1b.task && c1b.raid);
    const frSrc = `org-flightrisk:${entry.id}`;
    assert.strictEqual(await sourceCount(il, '/api/integration-tasks', frSrc), 1, 'the converter sees the new task');
    assert.strictEqual(await sourceCount(il, '/api/raid', frSrc), 1, 'the converter sees the new RAID entry');
    assert.strictEqual(await sourceCount(fx.tokens.noneToken, '/api/integration-tasks', frSrc), 0, 'the uncleared member does not');
    const entryNow = (await listAs(base, il, '/api/org/flight-risk')).find((r) => r.id === entry.id);
    const c2 = await postJSON(base, `/api/org/flight-risk/${entry.id}/convert`, il, { toTask: true, toRaid: true, version: vOf(entryNow) });
    assert.strictEqual(c2.status, 200);
    const c2b = await c2.json();
    assert.strictEqual(c2b.task.id, c1b.task.id);
    assert.strictEqual(c2b.raid.id, c1b.raid.id);
    assert.strictEqual(await sourceCount(il, '/api/integration-tasks', frSrc), 1, 'flight-risk re-convert dedupes');
    // The converted task is editable by the converter.
    const upd = await postJSON(base, '/api/integration-tasks', il, { id: c1b.task.id, status: 'doing', version: vOf(c2b.task) });
    assert.strictEqual(upd.status, 200);
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Structural: the guard precedes conflictIfStale on every by-id write route.
// ---------------------------------------------------------------------------
function routeSource(src, header) {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `route not found in server.js: ${header}`);
  const end = src.indexOf('\napp.', start + header.length);
  return src.slice(start, end < 0 ? src.length : end);
}

test('clearance-write-paths (Task 2, structural): every by-id task/RAID write route and both conversion routes call assertRecordVisibleOr404(req, db, deal, ...) before conflictIfStale and before any lane mutation', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const headers = [
    "app.post('/api/integration-tasks', ",
    "app.delete('/api/integration-tasks/:id', ",
    "app.post('/api/raid', ",
    "app.delete('/api/raid/:id', ",
    "app.post('/api/dd/findings/:id/convert', ",
    "app.post('/api/org/flight-risk/:id/convert', ",
  ];
  for (const h of headers) {
    const body = routeSource(src, h);
    const guard = body.indexOf('assertRecordVisibleOr404(req, db, deal');
    assert.ok(guard >= 0, `${h} must call assertRecordVisibleOr404(req, db, deal, ...)`);
    // The CALL (`if (conflictIfStale(req, res, ...`), not a comment mention.
    const stale = body.indexOf('if (conflictIfStale(req, res');
    if (stale >= 0 && !/convert/.test(h)) {
      assert.ok(guard < stale, `${h}: the visibility guard must precede conflictIfStale (its 409 body is the R1-02 oracle)`);
    }
    if (/convert/.test(h)) {
      const firstPush = body.indexOf('.push(');
      assert.ok(guard < firstPush, `${h}: the existing-record guard must run before the first lane mutation (shared readDb cache)`);
    }
  }
  assert.ok(!src.includes("'Task not found.'") && !src.includes("'Entry not found.'"), "the retired 'Task not found.' / 'Entry not found.' bodies must be gone");
});

test('clearance-write-paths (Task 2): in the demo store (no deal) a clearance-stamped record is invisible to every role — identical to the read filter; the by-id write 404s', async () => {
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const token = newSession('admin', 'admin'); // unbound -> demo store, deal === null
    const created = await postJSON(base, '/api/integration-tasks', token, { title: 'Demo stamped', source: 'org-flightrisk:demo_probe' });
    assert.strictEqual(created.status, 201);
    const { task } = await created.json();
    const list = await listAs(base, token, '/api/integration-tasks');
    assert.ok(!list.some((t) => t.id === task.id), 'the read filter already hides it from every role in the demo store');
    await assertNotFound(await postJSON(base, '/api/integration-tasks', token, { id: task.id, status: 'doing', version: 0 }), 'demo-store by-id write');
  } finally {
    server.close();
  }
});
