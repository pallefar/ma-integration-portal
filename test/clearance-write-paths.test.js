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

test('clearance-write-paths (IN-01): GET /api/synergies and the synergies export drop restricted task ids for an uncleared reader; cleared readers see them; the stored hidden link survives an uncleared edit', async () => {
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_cwpin01');
    const hrId = fx.hrTask.id;
    const created = await postJSON(base, '/api/synergies', fx.tokens.karenToken, { title: 'Linked initiative', taskIds: [hrId, fx.manualTask.id] });
    assert.strictEqual(created.status, 201);
    const syn = (await created.json()).initiative;
    const synOf = async (token) => (await listAs(base, token, '/api/synergies')).find((s) => s.id === syn.id);

    const uncleared = await synOf(fx.tokens.noneToken);
    assert.deepStrictEqual(uncleared.taskIds, [fx.manualTask.id], 'the uncleared reader sees only the visible link');
    const rawText = await (await getJSON(base, '/api/synergies', fx.tokens.noneToken)).text();
    assert.ok(!rawText.includes(hrId), 'the restricted id appears nowhere in the uncleared body');
    const exp = await getJSON(base, '/api/reports/export?dataset=synergies&format=json', fx.tokens.noneToken);
    assert.strictEqual(exp.status, 200);
    assert.ok(!(await exp.text()).includes(hrId), 'nor in the synergies export');

    assert.deepStrictEqual((await synOf(fx.tokens.hrToken)).taskIds.slice().sort(), [hrId, fx.manualTask.id].sort(), 'a cleared reader sees both');

    // An uncleared edit still preserves the hidden link in storage (write path unchanged).
    const edit = await postJSON(base, '/api/synergies', fx.tokens.noneToken, { id: syn.id, version: vOf(uncleared), title: 'renamed', taskIds: [fx.manualTask.id] });
    assert.strictEqual(edit.status, 200);
    await edit.text();
    assert.deepStrictEqual((await synOf(fx.tokens.adminToken)).taskIds.slice().sort(), [hrId, fx.manualTask.id].sort(), 'the hidden link is preserved');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Phase 11 review WR-02: server-minted provenance cannot be planted.
// ---------------------------------------------------------------------------
function plantInDeal(dealId, collection, record) {
  const conn = store.getOrOpenConnection(dbFiles.dealDbPath(dealId), dbFiles.DEAL_SCHEMA_PATH);
  store.runWithDb({ conn, kind: 'demo', dealId: null, dbPath: null }, () => {
    const db = store.readDb();
    db[collection] = db[collection] || [];
    db[collection].push(Object.assign({}, record));
    store.writeDb(db);
  });
}

test('clearance-write-paths (WR-02): a client-supplied reserved provenance source is refused (400) on task AND RAID create and update; free-text sources stay valid', async () => {
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_cwpreserved');
    const none = fx.tokens.noneToken;
    const reserved = [
      `dd-finding:${fx.finding.id}`, 'org-flightrisk:whatever', 'template:tpl_x:item_y', 'remediation:tpl_x:dim',
      '  DD-Finding:ddfind_x', 'Org-FlightRisk:x',
    ];
    for (const source of reserved) {
      const t = await postJSON(base, '/api/integration-tasks', none, { title: 'PLANTED by uncleared pmo', source });
      assert.strictEqual(t.status, 400, `task create with source ${JSON.stringify(source)}`);
      assert.match((await t.json()).error, /reserved/, 'standard validation body names the reason');
      const r = await postJSON(base, '/api/raid', none, { title: 'PLANTED RAID', type: 'risk', severity: 'high', source });
      assert.strictEqual(r.status, 400, `RAID create with source ${JSON.stringify(source)}`);
      await r.text();
    }
    // ...on the update path too (an admin is refused as well: only the server mints these).
    const upd = await postJSON(base, '/api/integration-tasks', fx.tokens.adminToken, { id: fx.manualTask.id, version: vOf(fx.manualTask), source: 'dd-finding:x' });
    assert.strictEqual(upd.status, 400);
    await upd.text();
    const updR = await postJSON(base, '/api/raid', fx.tokens.adminToken, { id: fx.manualRaid.id, version: vOf(fx.manualRaid), source: 'org-flightrisk:x' });
    assert.strictEqual(updR.status, 400);
    await updR.text();
    // Nothing was planted.
    const il = await listAs(base, fx.tokens.adminToken, '/api/integration-tasks');
    assert.ok(!il.some((t) => t.title === 'PLANTED by uncleared pmo'), 'no planted task exists');
    // Legitimate free-text sources still work.
    for (const source of ['manual', 'workshop 12 May', 'imported from steering deck']) {
      const ok = await postJSON(base, '/api/integration-tasks', none, { title: `ok ${source}`, source });
      assert.strictEqual(ok.status, 201, `free-text source ${source}`);
      assert.strictEqual((await ok.json()).task.source, source);
      const okR = await postJSON(base, '/api/raid', none, { title: `ok ${source}`, type: 'risk', source });
      assert.strictEqual(okR.status, 201);
      await okR.text();
    }
  } finally {
    server.close();
  }
});

test('clearance-write-paths (WR-02): a record planted with a matching source (no server stamp) is never adopted — DD and flight-risk conversions mint the genuine task/RAID', async () => {
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_cwpplant');
    const admin = fx.tokens.adminToken;
    const il = fx.tokens.karenToken;

    // (1) DD finding: plant unstamped task + RAID carrying its source, then convert.
    const fRes = await postJSON(base, '/api/dd/findings', admin, { area: 'hr', title: 'HR-SECRET second finding', severity: 'high' });
    const { finding } = await fRes.json();
    const src = `dd-finding:${finding.id}`;
    plantInDeal(fx.deal.id, 'integrationTasks', { id: 'task_planted_dd', title: 'PLANTED', status: 'todo', phase: 'day1', source: src });
    plantInDeal(fx.deal.id, 'raidEntries', { id: 'raid_planted_dd', title: 'PLANTED RAID', type: 'risk', status: 'open', source: src });
    const conv = await postJSON(base, `/api/dd/findings/${finding.id}/convert`, admin, { toTask: true, toRaid: true, version: vOf(finding) });
    assert.strictEqual(conv.status, 200);
    const body = await conv.json();
    assert.notStrictEqual(body.task.id, 'task_planted_dd', 'the planted task is not adopted as the conversion');
    assert.notStrictEqual(body.raid.id, 'raid_planted_dd', 'the planted RAID entry is not adopted');
    assert.strictEqual(body.task.title, 'HR-SECRET second finding', 'the genuine task carries the finding title');
    assert.strictEqual(body.task.clearanceArea, 'hr');
    assert.strictEqual(body.raid.clearanceArea, 'hr');
    assert.deepStrictEqual(body.finding.linkedTaskIds, [body.task.id]);
    assert.deepStrictEqual(body.finding.linkedRaidIds, [body.raid.id]);
    // A re-convert dedupes on the GENUINE (stamped) record.
    const again = await postJSON(base, `/api/dd/findings/${finding.id}/convert`, admin, { toTask: true, toRaid: true, version: vOf(body.finding) });
    assert.strictEqual(again.status, 200);
    const againBody = await again.json();
    assert.strictEqual(againBody.task.id, body.task.id);
    assert.strictEqual(againBody.raid.id, body.raid.id);

    // (2) flight-risk: plant an unstamped task + RAID with the entry's source, then convert.
    const empRes = await postJSON(base, '/api/employees', admin, { name: 'Pat Planted', role: 'Engineer', department: 'Eng' });
    const { employee } = await empRes.json();
    const frRes = await postJSON(base, '/api/org/flight-risk', il, { employeeId: employee.id, riskLevel: 'high', owner: 'karen', mitigation: 'Talk.' });
    const { entry } = await frRes.json();
    const frSrc = `org-flightrisk:${entry.id}`;
    plantInDeal(fx.deal.id, 'integrationTasks', { id: 'task_planted_fr', title: 'PLANTED FR', status: 'todo', phase: 'day1', source: frSrc });
    plantInDeal(fx.deal.id, 'raidEntries', { id: 'raid_planted_fr', title: 'PLANTED FR RAID', type: 'risk', status: 'open', source: frSrc });
    const c = await postJSON(base, `/api/org/flight-risk/${entry.id}/convert`, il, { toTask: true, toRaid: true, version: vOf(entry) });
    assert.strictEqual(c.status, 200);
    const cb = await c.json();
    assert.notStrictEqual(cb.task.id, 'task_planted_fr');
    assert.notStrictEqual(cb.raid.id, 'raid_planted_fr');
    assert.strictEqual(cb.task.clearanceArea, 'hr');
    assert.ok(cb.task.title.includes('Pat Planted'), 'the genuine retention task is minted');
    assert.deepStrictEqual(cb.entry.linkedTaskIds, [cb.task.id]);
  } finally {
    server.close();
  }
});

test('clearance-write-paths (Task 2): in the demo store (no deal) a clearance-stamped record is invisible to every role — identical to the read filter; the by-id write 404s', async () => {
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const token = newSession('admin', 'admin'); // unbound -> demo store, deal === null
    // Phase 11 review WR-02: a reserved provenance `source` can no longer be
    // planted through the HTTP create path (400 below), so the stamped record
    // this scenario needs is written straight into the temp demo store.
    const refused = await postJSON(base, '/api/integration-tasks', token, { title: 'Demo stamped', source: 'org-flightrisk:demo_probe' });
    assert.strictEqual(refused.status, 400, 'reserved source refused on create, in the demo store too');
    const task = { id: 'task_cwp_demo_stamped', title: 'Demo stamped', status: 'todo', phase: 'day1', source: 'org-flightrisk:demo_probe' };
    const demoConn = store.getOrOpenConnection(dbFiles.DEMO_DB_PATH, dbFiles.DEAL_SCHEMA_PATH);
    store.runWithDb({ conn: demoConn, kind: 'demo', dealId: null, dbPath: dbFiles.DEMO_DB_PATH }, () => {
      const db = store.readDb();
      db.integrationTasks = db.integrationTasks || [];
      db.integrationTasks.push(task);
      store.writeDb(db);
    });
    const list = await listAs(base, token, '/api/integration-tasks');
    assert.ok(!list.some((t) => t.id === task.id), 'the read filter already hides it from every role in the demo store');
    await assertNotFound(await postJSON(base, '/api/integration-tasks', token, { id: task.id, status: 'doing', version: 0 }), 'demo-store by-id write');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Task 3: store-layer fail-closed backstop (09-SECURITY UF-2) + the structural
// gate for every clearance-carrying collection.
// ---------------------------------------------------------------------------
const collections = require('../db/collections.js');

test('clearance-write-paths (Task 3): CLEARANCE_SCOPED_COLLECTIONS covers the four task/RAID lanes, the DD lanes and the org lanes; PROVENANCE_SCOPED is its task/RAID subset; both stay within VERSIONED_COLLECTIONS', () => {
  const scoped = collections.CLEARANCE_SCOPED_COLLECTIONS;
  for (const k of ['ddFindings', 'ddRequestItems', 'integrationTasks', 'customIntegrationTasks', 'raidEntries', 'customRaidEntries', 'orgPositions', 'orgFlightRisks']) {
    assert.ok(scoped.has(k), `${k} must be clearance-scoped`);
    assert.ok(collections.VERSIONED_COLLECTIONS.has(k), `${k} must be versioned`);
  }
  assert.deepStrictEqual(
    [...collections.PROVENANCE_SCOPED_COLLECTIONS].sort(),
    ['customIntegrationTasks', 'customRaidEntries', 'integrationTasks', 'raidEntries']
  );
  for (const k of collections.PROVENANCE_SCOPED_COLLECTIONS) assert.ok(scoped.has(k));
  // The synergy lanes are NOT clearance-scoped (deal-wide-visible by design).
  assert.ok(!scoped.has('synergyInitiatives') && !scoped.has('customSynergyInitiatives'));
});

test('clearance-write-paths (Task 3): hasRestrictedProvenance — stamp, dd-finding and flight-risk sources are restricted; manual, empty, absent and other sources are not', () => {
  const r = collections.hasRestrictedProvenance;
  assert.strictEqual(r({ id: 'a', clearanceArea: 'hr' }), true);
  assert.strictEqual(r({ id: 'a', source: 'dd-finding:ddfind_1' }), true);
  assert.strictEqual(r({ id: 'a', source: 'org-flightrisk:risk_1' }), true);
  assert.strictEqual(r({ id: 'a', source: '' }), false);
  assert.strictEqual(r({ id: 'a' }), false);
  assert.strictEqual(r({ id: 'a', source: 'manual' }), false);
  assert.strictEqual(r({ id: 'a', source: 'template:tpl:item' }), false);
  assert.strictEqual(r({ id: 'a', source: 'remediation:tpl:dim' }), false);
  assert.strictEqual(r(null), false);
  assert.strictEqual(r(undefined), false);
  // Parity with the server resolvers: a record the resolver restricts is
  // never reported unrestricted here (store is the more conservative side).
  const db = { ddFindings: [{ id: 'ddfind_1', area: 'legal' }] };
  for (const rec of [
    { clearanceArea: 'financial' }, { source: 'dd-finding:ddfind_1' }, { source: 'org-flightrisk:x' },
  ]) {
    assert.notStrictEqual(app.resolveTaskClearanceArea(rec, db), null);
    assert.strictEqual(r(rec), true);
    assert.notStrictEqual(app.resolveRaidEntryClearanceArea(rec, db), null);
  }
});

// A WHERE-layer conflict (CR-01 (a) pattern) on `collection`, with the request
// db context given by `armedFilter` (undefined = nothing armed). Returns the
// thrown conflict detail.
function whereConflict(dealId, collection, record, armedFilter) {
  const conn = store.getOrOpenConnection(dbFiles.dealDbPath(dealId), dbFiles.DEAL_SCHEMA_PATH);
  const ctx = { conn, kind: 'demo', dealId: null, dbPath: null };
  if (armedFilter) ctx.areaClearanceFilter = armedFilter;
  let detail = null;
  store.runWithDb(ctx, () => {
    const create = store.readDb();
    create[collection] = create[collection] || [];
    create[collection].push(Object.assign({}, record));
    store.writeDb(create);
    const stamp = store.readDb();
    stamp[collection].find((r) => r.id === record.id).title = 'v1';
    store.writeDb(stamp);
    const snapA = store.readDb();
    const snapB = store.readDb();
    snapB[collection].find((r) => r.id === record.id).title = 'v2 (other writer)';
    store.writeDb(snapB);
    snapA[collection].find((r) => r.id === record.id).title = 'stale attempt';
    try { store.writeDb(snapA); } catch (e) {
      assert.ok(store.isConflictError(e), 'the stale write must raise the typed conflict error');
      detail = e.conflictDetail;
    }
  });
  assert.ok(detail, 'a conflict must have been raised');
  return detail;
}

test('clearance-write-paths (Task 3): store WHERE-layer conflict with NO armed filter withholds currentRecord for restricted task/RAID provenance on all four lanes, echoes ordinary records, and keeps version + attribution', () => {
  const deal = makeDeal('deal_cwpstore');
  let n = 0;
  for (const collection of ['integrationTasks', 'customIntegrationTasks', 'raidEntries', 'customRaidEntries']) {
    const restricted = [
      { clearanceArea: 'hr' },
      { source: 'dd-finding:ddfind_unarmed' },
      { source: 'org-flightrisk:risk_unarmed' },
    ];
    for (const extra of restricted) {
      const d = whereConflict(deal.id, collection, Object.assign({ id: `cwps_${n++}`, title: 'HR-SECRET v0' }, extra));
      assert.strictEqual(d.conflictKind, 'version');
      assert.strictEqual(d.currentRecord, null, `${collection} ${JSON.stringify(extra)}: restricted provenance must not be echoed`);
      assert.ok(Number.isInteger(d.currentVersion), 'the version is still disclosed');
      assert.ok(d.recordId);
    }
    for (const extra of [{}, { source: '' }, { source: 'manual' }, { source: 'template:t:i' }]) {
      const d = whereConflict(deal.id, collection, Object.assign({ id: `cwps_${n++}`, title: 'ordinary v0' }, extra));
      assert.ok(d.currentRecord, `${collection} ${JSON.stringify(extra)}: an ordinary record still echoes (Phase 9 dialog unchanged)`);
      assert.strictEqual(d.currentRecord.title, 'v2 (other writer)');
    }
  }
});

test('clearance-write-paths (Task 3): ddFindings/ddRequestItems/orgPositions/orgFlightRisks with no filter armed still fail closed; an ARMED filter decides for every collection', () => {
  const deal = makeDeal('deal_cwpstore2');
  let n = 0;
  for (const collection of ['ddFindings', 'ddRequestItems', 'orgPositions', 'orgFlightRisks']) {
    const d = whereConflict(deal.id, collection, { id: `cwps2_${n++}`, area: 'legal', title: 'MNPI v0' });
    assert.strictEqual(d.currentRecord, null, `${collection}: unarmed must fail closed`);
  }
  for (const collection of ['integrationTasks', 'customRaidEntries', 'ddFindings', 'orgPositions']) {
    const granting = (key, rec) => ({ id: rec.id, projected: true });
    const g = whereConflict(deal.id, collection, { id: `cwps2_${n++}`, clearanceArea: 'hr', area: 'hr', title: 'v0' }, granting);
    assert.strictEqual(g.currentRecord.projected, true, `${collection}: the armed filter's projection is what is echoed`);
    const denying = () => null;
    const x = whereConflict(deal.id, collection, { id: `cwps2_${n++}`, title: 'ordinary v0' }, denying);
    assert.strictEqual(x.currentRecord, null, `${collection}: an armed denying filter withholds even an ordinary record`);
  }
});

test('clearance-write-paths (Task 3, structural gate): every conflictIfStale() caller whose route works on a clearance-scoped lane passes a clearanceFilter — a new unfiltered caller fails the suite', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  // Strip whole-line `//` comments so a mention in prose cannot classify a route.
  const src = raw.split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
  const headerRe = /^app\.(get|post|put|patch|delete)\('([^']+)'/gm;
  const headers = [];
  let m;
  while ((m = headerRe.exec(src))) headers.push({ index: m.index, method: m[1].toUpperCase(), route: m[2] });
  assert.ok(headers.length > 100, 'sanity: the route scan found the route table');

  const SCOPED_LANE_HELPERS = ['taskLane(', 'raidLane(', 'ddFindingsLane(', 'ddRequestLane(', 'orgPositionsLane(', 'orgFlightRiskLane('];
  const found = [];
  const unfiltered = [];
  headers.forEach((h, i) => {
    // The handler ends at the first column-0 `});` after its header — NOT at
    // the next route header, which would sweep in any helper function
    // (`function raidLane(db) {...}`) defined between two routes.
    const close = src.indexOf('\n});', h.index);
    const nextHeader = i + 1 < headers.length ? headers[i + 1].index : src.length;
    const text = src.slice(h.index, close >= 0 ? Math.min(close, nextHeader) : nextHeader);
    const scopedRoute = SCOPED_LANE_HELPERS.some((helper) => text.includes(helper));
    let from = 0;
    for (;;) {
      const at = text.indexOf('conflictIfStale(req, res', from);
      if (at < 0) break;
      from = at + 1;
      const tail = text.slice(at);
      const stop = tail.indexOf(')) return');
      const call = stop < 0 ? tail.slice(0, 400) : tail.slice(0, stop);
      if (!scopedRoute) continue;
      found.push(`${h.method} ${h.route}`);
      if (!call.includes('clearanceFilter')) unfiltered.push(`${h.method} ${h.route}`);
    }
  });
  assert.deepStrictEqual(unfiltered, [], `these conflictIfStale() callers work on a clearance-scoped lane and pass no clearanceFilter: ${unfiltered.join(', ')}`);
  const expected = [
    'POST /api/integration-tasks', 'DELETE /api/integration-tasks/:id',
    'POST /api/raid', 'DELETE /api/raid/:id',
    'POST /api/dd/request-items', 'DELETE /api/dd/request-items/:id',
    'POST /api/dd/findings', 'DELETE /api/dd/findings/:id', 'POST /api/dd/findings/:id/convert',
    'POST /api/org/positions', 'DELETE /api/org/positions/:id',
    'POST /api/org/flight-risk', 'DELETE /api/org/flight-risk/:id', 'POST /api/org/flight-risk/:id/convert',
  ];
  for (const e of expected) assert.ok(found.includes(e), `the structural scan must see ${e} (scan sanity — it would otherwise pass vacuously)`);
});
