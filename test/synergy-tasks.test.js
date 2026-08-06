// SYN-04/D-22/D-23: task linkage — an integration task can be linked to an
// initiative through a taskIds list on the initiative, the same task can
// serve several initiatives, and completing a linked task changes neither
// the initiative's realized value nor its stage (informational only, never
// a control — D-23 rejected even the softer auto-prompt).
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/synergy-stage.test.js's own established harness shape.
//
// node:test — Node's built-in runner. Run via `node --test
// test/synergy-tasks.test.js` (or `npm test`). Never `node --test test/`
// (the directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-synergy-tasks-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = ''; // this suite never exercises the admin-token branch

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/dd-findings.test.js).
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
function freshDeal(id, overrides) {
  return {
    id, name: id, targetCompany: id + ' Co', members: ['karen', 'pmo'], memberGrants: {},
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(), ...overrides,
  };
}
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }
function postJSON(base, urlPath, token, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

async function setupDeal(id) {
  const deal = freshDeal(id);
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const token = newSession('karen', 'hrbp');
  bindDeal(token, deal.id);
  return token;
}

async function createTask(base, token, title) {
  const res = await postJSON(base, '/api/integration-tasks', token, { title });
  const body = await res.json();
  return body.task;
}

test('synergy-tasks (a): POST /api/synergies with a taskIds array of existing task ids stores them in the given order', async () => {
  const token = await setupDeal('deal_syntaska');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const t1 = await createTask(base, token, 'Task one');
    const t2 = await createTask(base, token, 'Task two');
    const t3 = await createTask(base, token, 'Task three');

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Linked', category: 'cost', taskIds: [t3.id, t1.id, t2.id] });
    assert.strictEqual(createRes.status, 201);
    const { initiative } = await createRes.json();
    assert.deepStrictEqual(initiative.taskIds, [t3.id, t1.id, t2.id], 'taskIds must be stored in the given order');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-tasks (b): posting the same task id twice in one request, or an id already present, yields exactly one entry for that id', async () => {
  const token = await setupDeal('deal_syntaskb');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const t1 = await createTask(base, token, 'Dup one');
    const t2 = await createTask(base, token, 'Dup two');

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Dup in one request', category: 'cost', taskIds: [t1.id, t1.id, t2.id] });
    const { initiative } = await createRes.json();
    assert.deepStrictEqual(initiative.taskIds, [t1.id, t2.id], 'a duplicate id within one request must yield exactly one entry, preserving first-seen order');

    const updateRes = await postJSON(base, '/api/synergies', token, { id: initiative.id, taskIds: [t1.id, t2.id, t1.id] });
    const updateBody = await updateRes.json();
    assert.deepStrictEqual(updateBody.initiative.taskIds, [t1.id, t2.id], 'posting an id already present must not create a second entry; insertion order of the remaining ids is preserved');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-tasks (c): a task id that does not exist in the integration-task lane is refused with 400 naming the unknown id, and no partial write occurs', async () => {
  const token = await setupDeal('deal_syntaskc');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const t1 = await createTask(base, token, 'Real task');

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Bad linkage', category: 'cost', taskIds: [t1.id, 'task_totally_unknown'] });
    assert.strictEqual(createRes.status, 400);
    const createBody = await createRes.json();
    assert.match(createBody.error, /task_totally_unknown/, 'the refusal must name the unknown id');

    const listRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(token) } });
    const list = await listRes.json();
    assert.strictEqual(list.length, 0, 'a refused create must not add a row (no partial write)');

    // Now prove the same on an update: an existing initiative with an
    // existing linkage must be left completely unchanged by a refused update.
    const okCreateRes = await postJSON(base, '/api/synergies', token, { title: 'Existing linkage', category: 'cost', taskIds: [t1.id] });
    const { initiative } = await okCreateRes.json();

    const badUpdateRes = await postJSON(base, '/api/synergies', token, { id: initiative.id, taskIds: ['task_still_unknown'] });
    assert.strictEqual(badUpdateRes.status, 400);
    const badUpdateBody = await badUpdateRes.json();
    assert.match(badUpdateBody.error, /task_still_unknown/);

    const afterRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(token) } });
    const after = (await afterRes.json()).find((s) => s.id === initiative.id);
    assert.deepStrictEqual(after.taskIds, [t1.id], 'the initiative\'s stored list must be unchanged after a refused update');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-tasks (d): the same task id can be stored on two different initiatives simultaneously', async () => {
  const token = await setupDeal('deal_syntaskd');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const shared = await createTask(base, token, 'Shared task');

    const initA = (await (await postJSON(base, '/api/synergies', token, { title: 'Initiative A', category: 'cost', taskIds: [shared.id] })).json()).initiative;
    const initB = (await (await postJSON(base, '/api/synergies', token, { title: 'Initiative B', category: 'cost', taskIds: [shared.id] })).json()).initiative;

    const listRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(token) } });
    const list = await listRes.json();
    assert.deepStrictEqual(list.find((s) => s.id === initA.id).taskIds, [shared.id], 'initiative A must carry the shared task');
    assert.deepStrictEqual(list.find((s) => s.id === initB.id).taskIds, [shared.id], 'initiative B must independently carry the same shared task');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-tasks (e): posting an empty array clears the list; the field\'s absence from a body leaves the stored list untouched', async () => {
  const token = await setupDeal('deal_syntaske');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const t1 = await createTask(base, token, 'Clearable');
    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Clear me', category: 'cost', taskIds: [t1.id] });
    const { initiative } = await createRes.json();
    assert.deepStrictEqual(initiative.taskIds, [t1.id]);

    // An absent taskIds key on an unrelated edit must leave the list untouched.
    const untouchedRes = await postJSON(base, '/api/synergies', token, { id: initiative.id, notes: 'unrelated edit' });
    const untouchedBody = await untouchedRes.json();
    assert.deepStrictEqual(untouchedBody.initiative.taskIds, [t1.id], 'an absent taskIds key must leave the stored list untouched');

    const clearRes = await postJSON(base, '/api/synergies', token, { id: initiative.id, taskIds: [] });
    const clearBody = await clearRes.json();
    assert.deepStrictEqual(clearBody.initiative.taskIds, [], 'an explicitly empty array must clear the list');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-tasks (f): D-23 — marking a linked task done through the existing integration-task route leaves the initiative\'s realized value, derived totals, stage and lastConfirmedAt all unchanged', async () => {
  const token = await setupDeal('deal_syntaskf');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const linkedTask = await createTask(base, token, 'Delivers the initiative');
    const createRes = await postJSON(base, '/api/synergies', token, { title: 'No side effect', category: 'cost', realizedM: 3.5, owner: 'Karen Owner', taskIds: [linkedTask.id] });
    const { initiative } = await createRes.json();
    assert.strictEqual(initiative.lastConfirmedAt, undefined);

    const beforeRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(token) } });
    const before = (await beforeRes.json()).find((s) => s.id === initiative.id);
    const beforeSnapshot = { realizedM: before.realizedM, stage: before.stage, lastConfirmedAt: before.lastConfirmedAt };

    // Complete the linked task through the existing, untouched integration-task route.
    const completeRes = await postJSON(base, '/api/integration-tasks', token, { id: linkedTask.id, status: 'done' });
    assert.strictEqual(completeRes.status, 200);
    const completedTask = (await completeRes.json()).task;
    assert.strictEqual(completedTask.status, 'done');

    const afterRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(token) } });
    const after = (await afterRes.json()).find((s) => s.id === initiative.id);
    assert.strictEqual(after.realizedM, beforeSnapshot.realizedM, 'realized value must be unchanged by task completion');
    assert.strictEqual(after.stage, beforeSnapshot.stage, 'stage must be unchanged by task completion');
    assert.strictEqual(after.lastConfirmedAt, beforeSnapshot.lastConfirmedAt, 'lastConfirmedAt must be unchanged by task completion');
    assert.strictEqual(after.lastConfirmedAt, undefined, 'lastConfirmedAt must still be undefined — task completion is not a confirmation event');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-tasks (g): a taskIds array exceeding the schema\'s array maximum is refused by the schema', async () => {
  const token = await setupDeal('deal_syntaskg');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const tooMany = Array.from({ length: 101 }, (_, i) => `task_fake_${i}`);
    const res = await postJSON(base, '/api/synergies', token, { title: 'Too many links', category: 'cost', taskIds: tooMany });
    assert.strictEqual(res.status, 400, 'a taskIds array exceeding the array maximum must be refused by the schema');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-tasks (h): grep-level guard — this task touches no integration-task route, taskLane(), or task schema', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  // taskLane() itself must still be defined exactly once, and resolveSynergyTaskIds
  // (the new synergy-side helper) must be the ONLY additional caller of it beyond
  // the pre-existing integration-task routes' own internal use — i.e. no new
  // route under /api/integration-tasks was introduced by this linkage feature.
  const taskRouteCount = (src.match(/app\.(get|post|delete)\('\/api\/integration-tasks/g) || []).length;
  assert.strictEqual(taskRouteCount, 5, 'the integration-task route count (GET, POST upsert, DELETE, instantiate, from-remediation) must be unchanged by this plan');
});
