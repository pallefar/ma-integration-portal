// D-12-02 / DATA-02 / PD-16 (Phase 12, plan 12-10): GET /api/dd/workspace — the
// due-diligence workspace in ONE clearance-filtered request.
//
// Proves, through the REAL HTTP stack (the requireable app on an isolated temp
// control/runtime/demo/deals/audit set):
//   (a) for every area the caller is cleared for, the workspace's per-area
//       items / findings / data-room links / areas / mine are deep-equal to
//       what the per-area routes return for that caller (hrbp = all areas,
//       a pmo cleared for `financial` only);
//   (b) the uncleared caller's response JSON names no uncleared area id
//       anywhere (no key, no empty array, no count) — the D-16 shape;
//   (c) a real-deal load writes exactly one `dd-findings-read` (subject
//       'workspace') security event, a demo load writes none;
//   (d) the page makes ONE /api/dd/* request per load — source scan of
//       public/js/due-diligence.js AND an executed run of the real file in a
//       stubbed DOM that counts fetch calls;
//   (e) the converted DD write handlers (request-item / finding create and
//       update on DD_READ_SET) keep their contracts: create, stale update ->
//       409 with the clearance-filtered echo, uncleared create -> uniform 403
//       plus exactly one `dd-access-denied` event.
//
// node:test. Run via `node --test test/dd-workspace-batch.test.js`.

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dd-workspace-batch-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = '';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { ensureUser } = require('./helpers/seed-identity.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const auditHook = require('../db/auditHook.js');
const accessPolicy = require('../db/accessPolicy.js');

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
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
}
function makeDeal(id, extraMembers) {
  const deal = {
    id, name: id, targetCompany: id + ' Co', members: ['karen', 'pmo'].concat(extraMembers || []),
    memberGrants: { pmo: { ddAreas: ['financial'] } },
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  return deal;
}
function cookie(token) { return { Cookie: `ma_session=${token}` }; }
function newSession(username, role) {
  ensureUser(controlConn, { username, role });
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }
async function get(base, urlPath, token) {
  const r = await fetch(base + urlPath, { headers: cookie(token) });
  return { status: r.status, body: await r.json() };
}
async function post(base, urlPath, token, body) {
  const r = await fetch(base + urlPath, {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, cookie(token)),
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
function countByAction(dealId, action, subject) {
  return auditHook.queryAudit({ dealId, limit: 1000 })
    .filter((r) => r.action === action && (subject === undefined || r.row_id === subject)).length;
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// Seeds items in several areas (one with a data-room link, one closed, one
// owned by `pmo` + overdue) and findings in two areas, as karen (hrbp).
async function seedWorkspace(base, karenToken) {
  await post(base, '/api/dd/request-items', karenToken, { area: 'legal', text: 'Legal item', owner: 'karen' });
  await post(base, '/api/dd/request-items', karenToken, {
    area: 'financial', text: 'Fin item with link', owner: 'pmo', dueDate: '2000-01-01',
    vdrLink: { url: 'https://dataroom.example/fin', folderRef: '3.1', label: 'Fin folder' },
  });
  await post(base, '/api/dd/request-items', karenToken, { area: 'financial', text: 'Fin item two', owner: 'karen' });
  await post(base, '/api/dd/request-items', karenToken, { area: 'hr', text: 'HR item', owner: 'pmo' });
  await post(base, '/api/dd/findings', karenToken, { area: 'legal', title: 'Legal finding', severity: 'high', owner: 'karen' });
  await post(base, '/api/dd/findings', karenToken, { area: 'financial', title: 'Fin finding', severity: 'low', owner: 'pmo' });
  await post(base, '/api/dd/findings', karenToken, { area: 'hr', title: 'HR finding', severity: 'critical' });
}

async function assertWorkspaceEqualsPerArea(base, token) {
  const ws = (await get(base, '/api/dd/workspace', token));
  assert.strictEqual(ws.status, 200);
  const areas = (await get(base, '/api/dd/areas', token)).body;
  assert.deepStrictEqual(ws.body.areas, areas, 'areas equals GET /api/dd/areas');
  const vdr = (await get(base, '/api/dd/vdr-links', token)).body.areas;
  const summary = (await get(base, '/api/dd/summary', token)).body;
  assert.deepStrictEqual(ws.body.mine, summary.mine, 'mine equals GET /api/dd/summary mine');
  const ids = areas.map((a) => a.id).sort();
  for (const key of ['itemsByArea', 'findingsByArea', 'vdrLinksByArea']) {
    assert.deepStrictEqual(Object.keys(ws.body[key]).sort(), ids, key + ' carries exactly the granted area keys');
  }
  for (const a of areas) {
    const items = (await get(base, '/api/dd/request-items?area=' + a.id, token)).body;
    const findings = (await get(base, '/api/dd/findings?area=' + a.id, token)).body;
    const entry = vdr.find((v) => v.area === a.id);
    assert.deepStrictEqual(ws.body.itemsByArea[a.id], items, 'items for ' + a.id);
    assert.deepStrictEqual(ws.body.findingsByArea[a.id], findings, 'findings for ' + a.id);
    assert.deepStrictEqual(ws.body.vdrLinksByArea[a.id], entry ? entry.links : [], 'links for ' + a.id);
  }
  return ws.body;
}

test('dd-workspace-batch (a): workspace == the per-area endpoints for hrbp (all areas) and a financial-only pmo', async () => {
  const deal = makeDeal('deal_dwba');
  const karen = newSession('karen', 'hrbp'); bindDeal(karen, deal.id);
  const pmo = newSession('pmo', 'pmo'); bindDeal(pmo, deal.id);
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await seedWorkspace(base, karen);

    const full = await assertWorkspaceEqualsPerArea(base, karen);
    assert.strictEqual(full.areas.length, accessPolicy.DD_AREAS.length, 'hrbp is cleared for every area');
    assert.strictEqual(full.itemsByArea.financial.length, 2);
    assert.strictEqual(full.vdrLinksByArea.financial.length, 1);
    assert.strictEqual(full.vdrLinksByArea.legal.length, 0, 'a cleared area with no links is [] not absent');
    assert.strictEqual(full.findingsByArea.hr.length, 1);
    assert.strictEqual(full.itemsByArea.legal[0].overdue, false);
    assert.strictEqual(full.itemsByArea.financial.find((i) => i.owner === 'pmo').overdue, true);

    const narrow = await assertWorkspaceEqualsPerArea(base, pmo);
    assert.deepStrictEqual(narrow.areas.map((a) => a.id), ['financial']);
    assert.strictEqual(narrow.itemsByArea.financial.length, 2);
    assert.deepStrictEqual(narrow.mine, { openItems: 1, overdueItems: 1, openFindings: 1 });
  } finally {
    sessionsDb.deleteSession(runtimeConn, karen); sessionsDb.deleteSession(runtimeConn, pmo);
    server.close();
  }
});

test('dd-workspace-batch (b): an uncleared caller\'s workspace names no uncleared area anywhere (D-16)', async () => {
  const deal = makeDeal('deal_dwbb');
  const karen = newSession('karen', 'hrbp'); bindDeal(karen, deal.id);
  const pmo = newSession('pmo', 'pmo'); bindDeal(pmo, deal.id);
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await seedWorkspace(base, karen);
    const { status, body } = await get(base, '/api/dd/workspace', pmo);
    assert.strictEqual(status, 200);
    const text = JSON.stringify(body);
    for (const a of accessPolicy.DD_AREAS) {
      if (a.id === 'financial') continue;
      assert.ok(!text.includes('"' + a.id + '"'), 'no key or value names uncleared area ' + a.id);
    }
    assert.ok(!text.includes('Legal item') && !text.includes('HR finding') && !text.includes('Legal finding'));
  } finally {
    sessionsDb.deleteSession(runtimeConn, karen); sessionsDb.deleteSession(runtimeConn, pmo);
    server.close();
  }
});

test('dd-workspace-batch (c): a real-deal load writes exactly one dd-findings-read (subject workspace); a demo load writes none', async () => {
  const deal = makeDeal('deal_dwbc');
  const karen = newSession('karen', 'hrbp'); bindDeal(karen, deal.id);
  const demoKaren = newSession('karen', 'hrbp'); // never bound -> demo store
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await seedWorkspace(base, karen);
    const before = countByAction(deal.id, 'dd-findings-read', 'workspace');
    const beforeAll = countByAction(deal.id, 'dd-findings-read');
    await get(base, '/api/dd/workspace', karen);
    assert.strictEqual(countByAction(deal.id, 'dd-findings-read', 'workspace') - before, 1);
    assert.strictEqual(countByAction(deal.id, 'dd-findings-read') - beforeAll, 1, 'no per-area read rows besides the one');

    const globalBefore = auditHook.queryAudit({ limit: 1000 }).filter((r) => r.action === 'dd-findings-read').length;
    const demo = await get(base, '/api/dd/workspace', demoKaren);
    assert.strictEqual(demo.status, 200);
    const globalAfter = auditHook.queryAudit({ limit: 1000 }).filter((r) => r.action === 'dd-findings-read').length;
    assert.strictEqual(globalAfter, globalBefore, 'a demo-store load writes no read-audit event');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karen); sessionsDb.deleteSession(runtimeConn, demoKaren);
    server.close();
  }
});

test('dd-workspace-batch (c2): the existing /api/dd read policy covers the workspace — an employee is refused, no data returned', async () => {
  const deal = makeDeal('deal_dwbf', ['emp1']);
  const emp = newSession('emp1', 'employee'); bindDeal(emp, deal.id);
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const r = await get(base, '/api/dd/workspace', emp);
    assert.strictEqual(r.status, 403);
    assert.ok(!('itemsByArea' in r.body) && !('areas' in r.body));
  } finally {
    sessionsDb.deleteSession(runtimeConn, emp);
    server.close();
  }
});

// ----- (d) the page issues ONE /api/dd/* request ---------------------------

const PAGE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'due-diligence.js'), 'utf8');
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

test('dd-workspace-batch (d1): due-diligence.js load() has exactly one fetch and it is the workspace route', () => {
  const src = stripComments(PAGE_SRC);
  const start = src.indexOf('function load()');
  const end = src.indexOf('function refresh()');
  assert.ok(start > -1 && end > start);
  const body = src.slice(start, end);
  assert.strictEqual((body.match(/fetch\(/g) || []).length, 1, 'load() issues exactly one fetch');
  assert.ok(body.includes("fetch('/api/dd/workspace')"), 'and it is the workspace route');
  for (const gone of ['/api/dd/areas', 'request-items?area=', 'findings?area=', '/api/dd/vdr-links', '/api/dd/summary']) {
    assert.ok(!src.includes(gone), 'no remaining fetch of ' + gone);
  }
  const nudgeStart = src.indexOf('function loadOwnerNudge()');
  const nudgeBody = src.slice(nudgeStart, src.indexOf("document.addEventListener('DOMContentLoaded'"));
  assert.ok(!/fetch\(/.test(nudgeBody), 'the nudge makes no request of its own');
});

function fakeElement() {
  const props = {};
  const fn = function () {};
  return new Proxy(fn, {
    get(_t, k) {
      if (k in props) return props[k];
      if (k === 'then') return undefined;
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'length') return 0;
      if (k === 'style') return (props.style = {});
      if (k === 'children' || k === 'childNodes') return [];
      return function () { return fakeElement(); };
    },
    set(_t, k, v) { props[k] = v; return true; },
    apply() { return fakeElement(); },
  });
}

test('dd-workspace-batch (d2): executing the real page issues exactly one /api/dd/* request on load', async () => {
  const urls = [];
  const listeners = {};
  const wsBody = {
    areas: [{ id: 'financial', label: 'Financial' }],
    itemsByArea: { financial: [{ id: 'i1', area: 'financial', text: 'x', status: 'open', owner: 'pmo' }] },
    findingsByArea: { financial: [] }, vdrLinksByArea: { financial: [] },
    mine: { openItems: 1, overdueItems: 0, openFindings: 0 },
  };
  const document = {
    createElement: () => fakeElement(), createTextNode: () => fakeElement(), createDocumentFragment: () => fakeElement(), getElementById: () => fakeElement(), querySelector: () => fakeElement(),
    querySelectorAll: () => [], addEventListener: (ev, cb) => { listeners[ev] = cb; },
    body: fakeElement(),
  };
  const sandbox = {
    document, console, Promise, Object, Array, JSON, String, Number, Math, Date, encodeURIComponent,
    sessionStorage: { getItem: () => null, setItem() {} },
    fetch: (url) => {
      urls.push(String(url));
      const body = String(url).startsWith('/api/dd/workspace') ? wsBody
        : String(url).startsWith('/api/auth/me') ? { user: { role: 'hrbp' }, dealId: 'deal_x' } : {};
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(PAGE_SRC, sandbox);
  assert.strictEqual(typeof listeners.DOMContentLoaded, 'function');
  listeners.DOMContentLoaded();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  const dd = urls.filter((u) => u.startsWith('/api/dd/'));
  assert.deepStrictEqual(dd, ['/api/dd/workspace'], 'exactly one DD request: ' + JSON.stringify(urls));
});

// ----- (e) converted DD write handlers keep their contracts ----------------

test('dd-workspace-batch (e): item/finding create + update, stale 409 filtered echo, uncleared create 403 + one denial event', async () => {
  const deal = makeDeal('deal_dwbe');
  const karen = newSession('karen', 'hrbp'); bindDeal(karen, deal.id);
  const pmo = newSession('pmo', 'pmo'); bindDeal(pmo, deal.id);
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;

    const created = await post(base, '/api/dd/request-items', karen, { area: 'legal', text: 'Created legal item' });
    assert.strictEqual(created.status, 201);
    const item = created.body.item;
    const fcreated = await post(base, '/api/dd/findings', karen, { area: 'legal', title: 'Created legal finding' });
    assert.strictEqual(fcreated.status, 201);
    const finding = fcreated.body.finding;

    // Update (version precondition supplied exactly as a real client does).
    const upd = await post(base, '/api/dd/request-items', karen, { id: item.id, status: 'requested', version: item.version || 0 });
    assert.strictEqual(upd.status, 200);
    assert.strictEqual(upd.body.item.status, 'requested');
    const fupd = await post(base, '/api/dd/findings', karen, { id: finding.id, status: 'mitigating', version: finding.version || 0 });
    assert.strictEqual(fupd.status, 200);
    assert.strictEqual(fupd.body.finding.status, 'mitigating');

    // Stale update by karen (version 0 against a stamped record) -> 409 for the cleared caller.
    const stale = await post(base, '/api/dd/request-items', karen, { id: item.id, status: 'closed', version: 0 });
    assert.strictEqual(stale.status, 409);
    const staleF = await post(base, '/api/dd/findings', karen, { id: finding.id, status: 'closed', version: 0 });
    assert.strictEqual(staleF.status, 409);

    // An uncleared caller (pmo: financial only) targeting a legal record: uniform 403, no echo of the record.
    const deniedBefore = countByAction(deal.id, 'dd-access-denied');
    const refusedUpdate = await post(base, '/api/dd/request-items', pmo, { id: item.id, status: 'closed', version: 0 });
    assert.strictEqual(refusedUpdate.status, 403);
    assert.ok(!JSON.stringify(refusedUpdate.body).includes('Created legal item'));
    const refusedFinding = await post(base, '/api/dd/findings', pmo, { id: finding.id, title: 'x', version: 0 });
    assert.strictEqual(refusedFinding.status, 403);
    assert.ok(!JSON.stringify(refusedFinding.body).includes('Created legal finding'));

    // Uncleared create -> 403 + exactly one new dd-access-denied row.
    const midDenied = countByAction(deal.id, 'dd-access-denied');
    const refusedCreate = await post(base, '/api/dd/request-items', pmo, { area: 'hr', text: 'sneaky' });
    assert.strictEqual(refusedCreate.status, 403);
    assert.strictEqual(countByAction(deal.id, 'dd-access-denied') - midDenied, 1);
    assert.ok(midDenied >= deniedBefore);
    const refusedFindingCreate = await post(base, '/api/dd/findings', pmo, { area: 'hr', title: 'sneaky finding' });
    assert.strictEqual(refusedFindingCreate.status, 403);

    // The new rows are visible through the workspace, the sneaky ones are not.
    const ws = (await get(base, '/api/dd/workspace', karen)).body;
    assert.strictEqual(ws.itemsByArea.legal.length, 1);
    assert.strictEqual(ws.itemsByArea.hr.length, 0);
    assert.strictEqual(ws.findingsByArea.hr.length, 0);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karen); sessionsDb.deleteSession(runtimeConn, pmo);
    server.close();
  }
});

// ----- (f) DD handlers read only the collections they need -----------------

test('dd-workspace-batch (f): the DD GET handlers and the item/finding upserts load through readCollections, not readDb', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const from = src.indexOf('// Due Diligence workspace (DD-01/DD-04)');
  const to = src.indexOf('// In-app notifications — computed on demand');
  assert.ok(from > -1 && to > from, 'both section markers are intact');
  const section = src.slice(from, to);
  // Split into per-route chunks at each `app.<verb>('/api/dd/...'`.
  const re = /^app\.(get|post|delete)\('(\/api\/dd\/[^']*)'/gm;
  const marks = [];
  let m;
  while ((m = re.exec(section))) marks.push({ verb: m[1], route: m[2], at: m.index });
  const chunks = {};
  marks.forEach((mk, i) => {
    // Comments stripped: a route's trailing comment may legitimately name readDb().
    chunks[mk.verb + ' ' + mk.route] = stripComments(
      section.slice(mk.at, i + 1 < marks.length ? marks[i + 1].at : undefined));
  });

  const proportional = [
    'get /api/dd/areas', 'get /api/dd/workspace', 'get /api/dd/request-items', 'get /api/dd/request-items/:id',
    'post /api/dd/request-items', 'get /api/dd/vdr-links', 'get /api/dd/request-templates', 'get /api/dd/findings',
    'get /api/dd/findings/:id', 'post /api/dd/findings', 'get /api/dd/summary',
  ];
  for (const key of proportional) {
    assert.ok(chunks[key], 'route present: ' + key);
    assert.ok(!/\breadDb\(\)/.test(chunks[key]), key + ' must not call readDb()');
  }
  for (const key of ['get /api/dd/workspace', 'get /api/dd/request-items', 'get /api/dd/findings', 'get /api/dd/summary',
    'post /api/dd/request-items', 'post /api/dd/findings']) {
    assert.ok(chunks[key].includes('readCollections(DD_READ_SET)'), key + ' loads DD_READ_SET');
  }
  // The rare multi-lane / destructive routes deliberately stay on readDb().
  for (const key of ['delete /api/dd/request-items/:id', 'delete /api/dd/findings/:id',
    'post /api/dd/request-items/instantiate', 'post /api/dd/findings/:id/convert']) {
    assert.ok(/\breadDb\(\)/.test(chunks[key]), key + ' stays on readDb()');
  }
  assert.ok(src.includes("const DD_READ_SET = ['settings', 'ddRequestItems', 'ddFindings'];"));
});
