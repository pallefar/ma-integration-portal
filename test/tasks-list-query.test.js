// D-12-02 / DATA-02 (Phase 12, plan 12-09): the proportional task list read.
//
//   no list parameter  -> the legacy bare array, BYTE-identical to the previous
//                         reportTaskRows() output (asserted against an
//                         independently computed JSON.stringify of the visible
//                         rows read straight from the deal file)
//   ?limit=N[&offset]  -> { items, total }, `total` = tasks the caller may see
//   ?status/owner/workstream/phase/q -> narrowed server-side
//   clearance is applied BEFORE filtering, counting and paging (T-12-80)
//
// Fixture: a real deal with a 60-row task lane written straight into the deal
// file (interleaved restricted rows: an hr-stamped task, a stamped-legal task
// whose finding no longer exists, unstamped legacy rows resolved through
// `dd-finding:<id>` and `org-flightrisk:` provenance, an orphan) and five
// identities: admin, karen (hrbp) and three pmo members holding no area /
// `legal` / `hr`.

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-tasks-list-query-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-tasks-list-query-test-token';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const { createDealFixture } = require('./helpers/deal-fixture.js');

const app = require('../server.js');
require('./helpers/held-version.js').installHeldVersionFetch();

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

function cookieHeader(token) { return `ma_session=${token}`; }
function get(base, urlPath, token) {
  return fetch(`${base}${urlPath}`, { headers: token ? { Cookie: cookieHeader(token) } : {} });
}
function post(base, urlPath, token, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Cookie: cookieHeader(token) } : {}),
    body: JSON.stringify(body || {}),
  });
}
function del(base, urlPath, token) {
  return fetch(`${base}${urlPath}`, { method: 'DELETE', headers: { Cookie: cookieHeader(token) } });
}
function ids(arr) { return arr.map((e) => e.id); }

// ---------------------------------------------------------------- fixture ---

const FINDING_AREAS = { f_legal: 'legal', f_fin: 'financial' };
const OWNERS = ['ann', 'bob', 'chen'];
const STATUSES = ['todo', 'doing', 'blocked', 'done'];
const WORKSTREAMS = ['ws_imo', 'ws_hr', 'ws_finance'];
const PHASES = ['pre', 'day1', 'd30', 'd60', 'd100'];

/** The 60 task rows, in the order they are written (= seq order). */
function buildRows() {
  const rows = [];
  for (let i = 0; i < 54; i++) {
    rows.push({
      id: `task_m${String(i).padStart(2, '0')}`,
      title: i % 2 === 0 ? `Prepare payroll cutover ${i}` : `Confirm vendor contract ${i}`,
      workstreamId: WORKSTREAMS[i % 3],
      phase: PHASES[i % 5],
      owner: OWNERS[i % 3],
      due: '2026-03-01',
      status: STATUSES[i % 4],
      source: i % 6 === 0 ? 'template:tpl_day1:item_' + i : 'manual',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  }
  rows[10].title = 'Äpfel Aufgabe';
  const restricted = {
    legalUnstamped: { id: 'task_r_legal', title: 'Restricted legal Zebrafish', source: 'dd-finding:f_legal' },
    finUnstamped: { id: 'task_r_fin', title: 'Restricted financial Zebrafish', source: 'dd-finding:f_fin' },
    hrUnstamped: { id: 'task_r_hr', title: 'Restricted retention Zebrafish', source: 'org-flightrisk:fr_9' },
    hrStamped: { id: 'task_r_hrstamp', title: 'Stamped hr Zebrafish', source: '', clearanceArea: 'hr' },
    legalStampedOrphan: { id: 'task_r_legalstamp', title: 'Stamped legal Zebrafish', source: 'dd-finding:f_gone', clearanceArea: 'legal' },
    orphan: { id: 'task_r_orphan', title: 'Orphan provenance, no stamp', source: 'dd-finding:f_gone2' },
  };
  const at = [3, 9, 15, 22, 31, 44];
  Object.values(restricted).forEach((r, k) => {
    rows.splice(at[k], 0, Object.assign({
      workstreamId: 'ws_hr', phase: 'd30', owner: 'ann', due: '2026-03-01', status: 'blocked',
      createdAt: '2026-01-01T00:00:00.000Z',
    }, r));
  });
  return rows;
}

/** Independent re-statement of the clearance rule, over parsed rows. */
function expectedVisible(rows, grants) {
  return rows.filter((e) => {
    let area = null;
    if (e.clearanceArea) area = e.clearanceArea;
    else if (e.source && /^dd-finding:(.+)$/.test(e.source)) area = FINDING_AREAS[e.source.slice('dd-finding:'.length)] || null;
    else if (e.source && e.source.startsWith('org-flightrisk:')) area = 'hr';
    return area === null || grants === 'all' || grants.includes(area);
  });
}

let fxCounter = 0;
function seedDeal() {
  fxCounter += 1;
  const dealId = `deal_tlq${fxCounter}`;
  const fx = createDealFixture({
    controlConn, runtimeConn, dealId,
    members: [
      { username: 'admin', role: 'admin' },
      { username: 'karen', role: 'hrbp' },
      { username: 'pmo_none', role: 'pmo' },
      { username: 'pmo_legal', role: 'pmo', ddAreas: ['legal'] },
      { username: 'pmo_hr', role: 'pmo', ddAreas: ['hr'] },
    ],
  });
  const conn = store.getOrOpenConnection(dbFiles.dealDbPath(dealId), dbFiles.DEAL_SCHEMA_PATH);
  const settingsRow = conn.prepare("SELECT data FROM app_state WHERE key = 'settings'").get();
  const lane = settingsRow && JSON.parse(settingsRow.data).demoMode === false ? 'customIntegrationTasks' : 'integrationTasks';
  const rows = buildRows();
  const insert = conn.prepare(`INSERT INTO ${lane} (id, project_id, seq, data) VALUES (?, NULL, ?, ?)`);
  conn.transaction(() => rows.forEach((r, i) => insert.run(r.id, i, JSON.stringify(r))))();
  const insertFinding = conn.prepare('INSERT INTO ddFindings (id, project_id, seq, data) VALUES (?, NULL, ?, ?)');
  Object.entries(FINDING_AREAS).forEach(([id, area], i) => {
    insertFinding.run(id, i, JSON.stringify({ id, area, title: `Finding ${id}`, severity: 'high', status: 'open' }));
  });
  return { fx, lane, rows, dealId, conn };
}

async function withServer(fn) {
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

// ------------------------------------------------------------------ tests ---

test('tasks-list-query (a): unparameterized GET /api/integration-tasks is BYTE-identical to JSON.stringify of the visible rows read from the deal file — hrbp and every restricted pmo', async () => {
  const { fx, rows } = seedDeal();
  await withServer(async (base) => {
    const all = await get(base, '/api/integration-tasks', fx.tokens.karen);
    assert.strictEqual(all.status, 200);
    assert.match(all.headers.get('content-type'), /^application\/json; charset=utf-8$/);
    assert.strictEqual(await all.text(), JSON.stringify(expectedVisible(rows, 'all')), 'hrbp: the whole 60-row lane, byte for byte');

    const none = await (await get(base, '/api/integration-tasks', fx.tokens.pmo_none)).text();
    const expectedNone = expectedVisible(rows, []);
    assert.strictEqual(expectedNone.length, 54 + 1, '54 ordinary rows + the orphan provenance row');
    assert.strictEqual(none, JSON.stringify(expectedNone));
    assert.ok(!none.includes('Zebrafish'), 'no restricted title text in the response');

    assert.strictEqual(await (await get(base, '/api/integration-tasks', fx.tokens.pmo_legal)).text(), JSON.stringify(expectedVisible(rows, ['legal'])));
    assert.strictEqual(await (await get(base, '/api/integration-tasks', fx.tokens.pmo_hr)).text(), JSON.stringify(expectedVisible(rows, ['hr'])));
  });
});

test('tasks-list-query (b): the body equals what res.json() would have sent; an empty lane answers a bare []', async () => {
  const { fx, rows, conn, lane } = seedDeal();
  await withServer(async (base) => {
    const text = await (await get(base, '/api/integration-tasks', fx.tokens.admin)).text();
    assert.strictEqual(JSON.stringify(JSON.parse(text)), text);
    assert.deepStrictEqual(JSON.parse(text), rows);
    conn.prepare(`DELETE FROM ${lane}`).run();
    assert.strictEqual(await (await get(base, '/api/integration-tasks', fx.tokens.admin)).text(), '[]');
    assert.deepStrictEqual(await (await get(base, '/api/integration-tasks?limit=5', fx.tokens.admin)).json(), { items: [], total: 0 });
  });
});

test('tasks-list-query (c): paging is over the CALLER\'S visible rows, after the clearance filter', async () => {
  const { fx, rows } = seedDeal();
  await withServer(async (base) => {
    const visAll = expectedVisible(rows, 'all');
    const first = await (await get(base, '/api/integration-tasks?limit=20', fx.tokens.karen)).json();
    assert.deepStrictEqual(Object.keys(first).sort(), ['items', 'total']);
    assert.strictEqual(first.total, 60);
    assert.deepStrictEqual(first.items, visAll.slice(0, 20));
    const second = await (await get(base, '/api/integration-tasks?limit=20&offset=20', fx.tokens.karen)).json();
    assert.deepStrictEqual(second.items, visAll.slice(20, 40));
    assert.deepStrictEqual(await (await get(base, '/api/integration-tasks?limit=10&offset=500', fx.tokens.karen)).json(), { items: [], total: 60 });

    const visNone = expectedVisible(rows, []);
    const page = await (await get(base, '/api/integration-tasks?limit=200', fx.tokens.pmo_none)).json();
    assert.strictEqual(page.total, visNone.length);
    assert.deepStrictEqual(ids(page.items), ids(visNone));
    const p2 = await (await get(base, '/api/integration-tasks?limit=20&offset=20', fx.tokens.pmo_none)).json();
    assert.deepStrictEqual(ids(p2.items), ids(visNone.slice(20, 40)));
    assert.ok(!JSON.stringify(page).includes('Zebrafish'));
  });
});

test('tasks-list-query (d): status / phase / owner / workstream / q filter server-side and combine; the legacy array form narrows too', async () => {
  const { fx, rows } = seedDeal();
  await withServer(async (base) => {
    const vis = expectedVisible(rows, 'all');
    const check = async (qs, pred, token = fx.tokens.karen, grants = 'all') => {
      const want = expectedVisible(rows, grants).filter(pred);
      assert.ok(want.length > 0, `fixture has rows for ${qs}`);
      const arr = await (await get(base, `/api/integration-tasks?${qs}`, token)).json();
      assert.deepStrictEqual(ids(arr), ids(want), `${qs} (array form)`);
      const paged = await (await get(base, `/api/integration-tasks?${qs}&limit=200`, token)).json();
      assert.strictEqual(paged.total, want.length, `${qs} total`);
      assert.deepStrictEqual(ids(paged.items), ids(want), `${qs} (paged form)`);
    };
    await check('status=blocked', (t) => t.status === 'blocked');
    await check('phase=d30', (t) => t.phase === 'd30');
    await check('owner=bob', (t) => t.owner === 'bob');
    await check('workstream=ws_hr', (t) => t.workstreamId === 'ws_hr');
    await check('status=done&phase=day1', (t) => t.status === 'done' && t.phase === 'day1');
    await check('q=PAYROLL', (t) => /payroll/i.test(t.title));
    await check('q=%C3%A4pfel', (t) => /äpfel/i.test(t.title));
    await check('status=blocked', (t) => t.status === 'blocked', fx.tokens.pmo_none, []);
    assert.ok(vis.length === 60);
  });
});

test('tasks-list-query (e): no existence oracle — an uncleared pmo\'s total excludes restricted tasks and ?q on a restricted word answers 0', async () => {
  const { fx } = seedDeal();
  await withServer(async (base) => {
    const q = await (await get(base, '/api/integration-tasks?q=Zebrafish&limit=10', fx.tokens.pmo_none)).json();
    assert.deepStrictEqual(q, { items: [], total: 0 });
    const asHr = await (await get(base, '/api/integration-tasks?q=Zebrafish&limit=50', fx.tokens.pmo_hr)).json();
    assert.deepStrictEqual(ids(asHr.items).sort(), ['task_r_hr', 'task_r_hrstamp']);
    // restricted rows are blocked/ws_hr: the per-status total of the uncleared caller never counts them
    const blockedNone = await (await get(base, '/api/integration-tasks?status=blocked&limit=200', fx.tokens.pmo_none)).json();
    assert.ok(!ids(blockedNone.items).some((id) => id.startsWith('task_r_') && id !== 'task_r_orphan'));
    const blockedAll = await (await get(base, '/api/integration-tasks?status=blocked&limit=200', fx.tokens.karen)).json();
    assert.strictEqual(blockedAll.total - blockedNone.total, 5);
  });
});

test('tasks-list-query (f): invalid list parameters answer 400 with one fixed body; unknown keys are ignored', async () => {
  const { fx } = seedDeal();
  await withServer(async (base) => {
    for (const qs of ['phase=d999', 'status=bogus', 'limit=0', 'limit=201', 'limit=abc', 'offset=5', 'limit=5&offset=-1', 'owner[]=x']) {
      const res = await get(base, `/api/integration-tasks?${qs}`, fx.tokens.karen);
      assert.strictEqual(res.status, 400, qs);
      assert.deepStrictEqual(await res.json(), { error: 'Invalid list query.' }, qs);
    }
    const ok = await get(base, '/api/integration-tasks?nonsense=1', fx.tokens.karen);
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(JSON.parse(await ok.text()).length, 60);
  });
});

test('tasks-list-query (g): POST create / update / stale 409 / 404-before-409 for an invisible id / DELETE behave as before on the task read set', async () => {
  const { fx, rows } = seedDeal();
  await withServer(async (base) => {
    const created = await post(base, '/api/integration-tasks', fx.tokens.pmo_none, { title: 'Fresh task', workstreamId: 'ws_imo' });
    assert.strictEqual(created.status, 201);
    const task = (await created.json()).task;
    const afterCreate = await (await get(base, '/api/integration-tasks?limit=200', fx.tokens.pmo_none)).json();
    assert.strictEqual(afterCreate.total, expectedVisible(rows, []).length + 1);
    assert.strictEqual(afterCreate.items[afterCreate.items.length - 1].id, task.id);

    const upd = await post(base, '/api/integration-tasks', fx.tokens.pmo_none, { id: task.id, title: 'Renamed', version: 0 });
    assert.strictEqual(upd.status, 200);
    const stale = await post(base, '/api/integration-tasks', fx.tokens.pmo_none, { id: task.id, title: 'Stale', version: 0 });
    assert.strictEqual(stale.status, 409);
    assert.strictEqual((await stale.json()).conflictKind, 'version');

    const hidden = await post(base, '/api/integration-tasks', fx.tokens.pmo_none, { id: 'task_r_hrstamp', title: 'x', version: 0 });
    assert.strictEqual(hidden.status, 404);
    const hiddenBody = await hidden.text();
    const missing = await post(base, '/api/integration-tasks', fx.tokens.pmo_none, { id: 'task_nope', title: 'x', version: 0 });
    assert.strictEqual(missing.status, 404);
    assert.strictEqual(await missing.text(), hiddenBody, 'invisible and missing are indistinguishable');
    assert.strictEqual((await del(base, '/api/integration-tasks/task_r_hr?expectedVersion=0', fx.tokens.pmo_none)).status, 404);

    assert.strictEqual((await del(base, `/api/integration-tasks/${task.id}?expectedVersion=1`, fx.tokens.pmo_none)).status, 200);
    const afterDelete = await (await get(base, '/api/integration-tasks?limit=200', fx.tokens.pmo_none)).json();
    assert.strictEqual(afterDelete.total, expectedVisible(rows, []).length);
    assert.strictEqual((await (await get(base, '/api/integration-tasks?limit=200', fx.tokens.karen)).json()).total, 60);
  });
});

test('tasks-list-query (h): taskLaneName agrees with taskLane for demoMode false / true / absent; one provenance core serves both lanes; write handlers use TASK_READ_SET — source-level', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const fnBody = (name) => {
    const at = src.indexOf(`function ${name}(`);
    assert.ok(at !== -1, name);
    return src.slice(at, src.indexOf('\n}\n', at));
  };
  // taskLane's own body keeps exactly its two collection keys (Phase 9 structural scan)
  assert.deepStrictEqual([...new Set(fnBody('taskLane').match(/db\.(\w+)/g))].sort(), ['db.customIntegrationTasks', 'db.integrationTasks', 'db.settings'].sort());
  // behavioural agreement, evaluated from the real functions
  const taskLane = new Function(`${fnBody('taskLane')}\n}\nreturn taskLane;`)();
  const taskLaneName = new Function(`${fnBody('taskLaneName')}\n}\nreturn taskLaneName;`)();
  const LANE_KEYS = { customIntegrationTasks: 'custom', integrationTasks: 'demo' };
  for (const settings of [{ demoMode: false }, { demoMode: true }, {}, undefined]) {
    const db = { settings, integrationTasks: [{ id: 'd' }], customIntegrationTasks: [{ id: 'c' }] };
    const name = taskLaneName(settings);
    assert.ok(LANE_KEYS[name]);
    assert.strictEqual(taskLane(db), db[name], `lane for ${JSON.stringify(settings)}`);
  }
  // one provenance core for both lanes
  assert.ok(fnBody('resolveTaskClearanceArea').includes('clearanceAreaFromProvenance('));
  assert.ok(fnBody('taskRowVisible').includes('clearanceAreaFromProvenance('));
  assert.ok(fnBody('reportTaskRows').includes('taskRowVisible('));
  assert.ok(src.includes('const TASK_READ_SET'));
  for (const route of ["app.post('/api/integration-tasks',", "app.delete('/api/integration-tasks/:id',"]) {
    const start = src.indexOf(route);
    assert.ok(start !== -1, route);
    const body = src.slice(start, src.indexOf('\n});', start));
    assert.ok(body.includes('readCollections(TASK_READ_SET)'), `${route} must read through the task read set`);
    assert.ok(!/=\s*readDb\(\)/.test(body), `${route} must not assign from readDb()`);
  }
  const listStart = src.indexOf("app.get('/api/integration-tasks',");
  const listBody = src.slice(listStart, src.indexOf('\n});', listStart));
  assert.ok(!/=\s*readDb\(\)/.test(listBody));
  assert.ok(src.slice(src.indexOf('function taskProjectionVisibleRows'), listStart).includes('taskRowVisible('));
});
