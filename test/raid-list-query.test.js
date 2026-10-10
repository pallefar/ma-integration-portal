// D-12-02 / DATA-02 (Phase 12, plan 12-05): the proportional RAID list read.
//
//   no list parameter  -> the legacy bare array, BYTE-identical to the previous
//                         output (asserted against the response text and an
//                         independently computed JSON.stringify of the visible
//                         rows read straight from the deal file)
//   ?limit=N[&offset]  -> { items, total }, `total` = rows the caller may see
//   ?status/owner/workstream/q -> narrowed server-side
//   clearance is applied BEFORE filtering, counting and paging (T-12-40)
//
// Fixture: a real deal with a 60-row RAID lane written straight into the deal
// file (interleaved restricted rows: a stamped hr entry, a stamped legal entry
// whose finding no longer exists, unstamped legacy rows resolved through
// `dd-finding:<id>` and `org-flightrisk:` provenance, an orphan) and five
// identities: admin, karen (hrbp), and three pmo members holding no area /
// `legal` / `hr`.

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-raid-list-query-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-raid-list-query-test-token';

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
function ids(arr) { return arr.map((e) => e.id); }

// ---------------------------------------------------------------- fixture ---

const FINDING_AREAS = { f_legal: 'legal', f_fin: 'financial' };
const OWNERS = ['ann', 'bob', 'chen'];
const STATUSES = ['open', 'mitigating', 'closed'];
const WORKSTREAMS = ['ws_imo', 'ws_hr', 'ws_finance'];

/** The 60 RAID rows, in the order they are written (= seq order). */
function buildRows() {
  const rows = [];
  for (let i = 0; i < 54; i++) {
    rows.push({
      id: `raid_m${String(i).padStart(2, '0')}`,
      type: 'risk',
      title: i % 2 === 0 ? `Supplier risk ${i}` : `Customer issue ${i}`,
      severity: 'medium',
      owner: OWNERS[i % 3],
      workstreamId: WORKSTREAMS[i % 3],
      status: STATUSES[i % 3],
      notes: i === 7 ? 'Lieferanten Vertrag prüfen' : `routine note ${i}`,
      source: '',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  }
  rows[10].title = 'Äpfel Risiko';
  const restricted = {
    legalUnstamped: { id: 'raid_r_legal', title: 'Restricted legal Zebrafish', source: 'dd-finding:f_legal' },
    finUnstamped: { id: 'raid_r_fin', title: 'Restricted financial Zebrafish', source: 'dd-finding:f_fin' },
    hrUnstamped: { id: 'raid_r_hr', title: 'Restricted retention Zebrafish', source: 'org-flightrisk:fr_9' },
    hrStamped: { id: 'raid_r_hrstamp', title: 'Stamped hr Zebrafish', source: '', clearanceArea: 'hr' },
    legalStampedOrphan: { id: 'raid_r_legalstamp', title: 'Stamped legal Zebrafish', source: 'dd-finding:f_gone', clearanceArea: 'legal' },
    orphan: { id: 'raid_r_orphan', title: 'Orphan provenance, no stamp', source: 'dd-finding:f_gone2' },
  };
  const at = [3, 9, 15, 22, 31, 44];
  Object.values(restricted).forEach((r, k) => {
    rows.splice(at[k], 0, Object.assign({
      type: 'risk', severity: 'high', owner: 'ann', workstreamId: 'ws_imo', status: 'open', notes: '',
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
/** A fresh deal with the 60-row lane written straight into its file. */
function seedDeal() {
  fxCounter += 1;
  const dealId = `deal_rlq${fxCounter}`;
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
  const lane = settingsRow && JSON.parse(settingsRow.data).demoMode === false ? 'customRaidEntries' : 'raidEntries';
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

// ================================================================= Task 1 ===

test('raid-list-query (a): unparameterized GET /api/raid is BYTE-identical to JSON.stringify of the visible rows read from the deal file — hrbp and a restricted pmo', async () => {
  const { fx, rows } = seedDeal();
  await withServer(async (base) => {
    const all = await get(base, '/api/raid', fx.tokens.karen);
    assert.strictEqual(all.status, 200);
    assert.match(all.headers.get('content-type'), /^application\/json; charset=utf-8$/);
    const allText = await all.text();
    assert.strictEqual(rows.length, 60);
    assert.strictEqual(allText, JSON.stringify(expectedVisible(rows, 'all')), 'hrbp: the whole 60-row lane, byte for byte');

    const none = await (await get(base, '/api/raid', fx.tokens.pmo_none)).text();
    const expectedNone = expectedVisible(rows, []);
    assert.strictEqual(expectedNone.length, 54 + 1, '54 manual rows + the orphan provenance row');
    assert.strictEqual(none, JSON.stringify(expectedNone), 'uncleared pmo: restricted rows removed, the rest byte-identical');
    assert.ok(!none.includes('Zebrafish'), 'no restricted title text in the response');

    const legal = await (await get(base, '/api/raid', fx.tokens.pmo_legal)).text();
    assert.strictEqual(legal, JSON.stringify(expectedVisible(rows, ['legal'])));
    const hr = await (await get(base, '/api/raid', fx.tokens.pmo_hr)).text();
    assert.strictEqual(hr, JSON.stringify(expectedVisible(rows, ['hr'])));
  });
});

test('raid-list-query (b): the unparameterized body equals what res.json() would have sent (the pre-change implementation) — parse and re-stringify the response', async () => {
  const { fx, rows } = seedDeal();
  await withServer(async (base) => {
    const text = await (await get(base, '/api/raid', fx.tokens.admin)).text();
    assert.strictEqual(JSON.stringify(JSON.parse(text)), text, 'the raw-join body is its own canonical serialization');
    assert.deepStrictEqual(JSON.parse(text), rows);
  });
});

test('raid-list-query (c): an empty lane answers a bare [] (not {items:[]}) when unparameterized', async () => {
  const { fx, conn, lane } = seedDeal();
  conn.prepare(`DELETE FROM ${lane}`).run();
  await withServer(async (base) => {
    const res = await get(base, '/api/raid', fx.tokens.admin);
    assert.strictEqual(await res.text(), '[]');
    const paged = await (await get(base, '/api/raid?limit=5', fx.tokens.admin)).json();
    assert.deepStrictEqual(paged, { items: [], total: 0 });
  });
});

test('raid-list-query (d): ?limit=10 -> { items: first 10 visible in seq order, total: visible count }; ?limit=10&offset=10 -> the next 10', async () => {
  const { fx, rows } = seedDeal();
  await withServer(async (base) => {
    const visible = expectedVisible(rows, 'all');
    const first = await (await get(base, '/api/raid?limit=10', fx.tokens.karen)).json();
    assert.deepStrictEqual(Object.keys(first).sort(), ['items', 'total']);
    assert.strictEqual(first.total, 60);
    assert.deepStrictEqual(first.items, visible.slice(0, 10));

    const second = await (await get(base, '/api/raid?limit=10&offset=10', fx.tokens.karen)).json();
    assert.strictEqual(second.total, 60);
    assert.deepStrictEqual(second.items, visible.slice(10, 20));

    const tail = await (await get(base, '/api/raid?limit=50&offset=55', fx.tokens.karen)).json();
    assert.deepStrictEqual(ids(tail.items), ids(visible.slice(55)));
    assert.strictEqual(tail.total, 60);

    const beyond = await (await get(base, '/api/raid?limit=10&offset=500', fx.tokens.karen)).json();
    assert.deepStrictEqual(beyond, { items: [], total: 60 });
  });
});

test('raid-list-query (e): paging is over the CALLER\'S visible rows — an uncleared pmo\'s total and pages exclude restricted rows', async () => {
  const { fx, rows } = seedDeal();
  await withServer(async (base) => {
    const visible = expectedVisible(rows, []);
    const page = await (await get(base, '/api/raid?limit=200', fx.tokens.pmo_none)).json();
    assert.strictEqual(page.total, visible.length);
    assert.deepStrictEqual(ids(page.items), ids(visible));
    const p2 = await (await get(base, '/api/raid?limit=20&offset=20', fx.tokens.pmo_none)).json();
    assert.deepStrictEqual(ids(p2.items), ids(visible.slice(20, 40)));
    assert.ok(!JSON.stringify(page).includes('Zebrafish'));
  });
});

test('raid-list-query (f): restricted visibility is the same through the legacy array and the paged form, for every identity', async () => {
  const { fx, rows } = seedDeal();
  await withServer(async (base) => {
    const cases = [['admin', 'all'], ['karen', 'all'], ['pmo_none', []], ['pmo_legal', ['legal']], ['pmo_hr', ['hr']]];
    for (const [who, grants] of cases) {
      const legacy = await (await get(base, '/api/raid', fx.tokens[who])).json();
      const paged = await (await get(base, '/api/raid?limit=200', fx.tokens[who])).json();
      assert.deepStrictEqual(ids(paged.items), ids(legacy), `${who}: paged and legacy agree`);
      assert.deepStrictEqual(ids(legacy), ids(expectedVisible(rows, grants)), `${who}: matches the independent rule`);
      assert.strictEqual(paged.total, legacy.length);
    }
  });
});

// ================================================================= Task 2 ===

test('raid-list-query (g): ?status / ?owner / ?workstream narrow correctly; the response is a bare array unless limit is given', async () => {
  const { fx, rows } = seedDeal();
  await withServer(async (base) => {
    const visible = expectedVisible(rows, 'all');
    const open = await (await get(base, '/api/raid?status=open', fx.tokens.karen)).json();
    assert.ok(Array.isArray(open));
    assert.deepStrictEqual(ids(open), ids(visible.filter((r) => r.status === 'open')));
    const bob = await (await get(base, '/api/raid?owner=bob', fx.tokens.karen)).json();
    assert.deepStrictEqual(ids(bob), ids(visible.filter((r) => r.owner === 'bob')));
    const ws = await (await get(base, '/api/raid?workstream=ws_hr', fx.tokens.karen)).json();
    assert.deepStrictEqual(ids(ws), ids(visible.filter((r) => r.workstreamId === 'ws_hr')));
    const combo = await (await get(base, '/api/raid?status=closed&owner=chen&workstream=ws_finance', fx.tokens.karen)).json();
    assert.deepStrictEqual(ids(combo), ids(visible.filter((r) => r.status === 'closed' && r.owner === 'chen' && r.workstreamId === 'ws_finance')));
    assert.ok(combo.length > 0, 'the combined filter is not vacuous');
  });
});

test('raid-list-query (h): ?q is a case-insensitive Unicode substring over title and notes; with limit, total is the filtered visible count', async () => {
  const { fx, rows } = seedDeal();
  await withServer(async (base) => {
    const visible = expectedVisible(rows, 'all');
    const byTitle = await (await get(base, '/api/raid?q=SUPPLIER', fx.tokens.karen)).json();
    assert.deepStrictEqual(ids(byTitle), ids(visible.filter((r) => /supplier/i.test(r.title) || /supplier/i.test(r.notes))));
    const byNotes = await (await get(base, `/api/raid?q=${encodeURIComponent('lieferanten')}`, fx.tokens.karen)).json();
    assert.deepStrictEqual(ids(byNotes), ['raid_m07']);
    const unicode = await (await get(base, `/api/raid?q=${encodeURIComponent('äPFEL')}`, fx.tokens.karen)).json();
    assert.deepStrictEqual(ids(unicode), ['raid_m10']);
    const umlautInNotes = await (await get(base, `/api/raid?q=${encodeURIComponent('prüfen')}`, fx.tokens.karen)).json();
    assert.deepStrictEqual(ids(umlautInNotes), ['raid_m07']);

    const paged = await (await get(base, '/api/raid?q=risk&limit=5&status=open', fx.tokens.karen)).json();
    const expected = visible.filter((r) => r.status === 'open' && (/risk/i.test(r.title) || /risk/i.test(r.notes)));
    assert.strictEqual(paged.total, expected.length);
    assert.deepStrictEqual(ids(paged.items), ids(expected.slice(0, 5)));
  });
});

test('raid-list-query (i): no existence oracle — an uncleared pmo\'s total excludes restricted rows and ?q on a restricted word answers 0', async () => {
  const { fx, rows } = seedDeal();
  await withServer(async (base) => {
    const visibleNone = expectedVisible(rows, []);
    const total = await (await get(base, '/api/raid?limit=1', fx.tokens.pmo_none)).json();
    assert.strictEqual(total.total, visibleNone.length);
    for (const word of ['Zebrafish', 'retention', 'Restricted', 'legal Zebrafish']) {
      const q = await (await get(base, `/api/raid?q=${encodeURIComponent(word)}&limit=50`, fx.tokens.pmo_none)).json();
      assert.deepStrictEqual(q, { items: [], total: 0 }, `q=${word}`);
      const qa = await (await get(base, `/api/raid?q=${encodeURIComponent(word)}`, fx.tokens.pmo_none)).json();
      assert.deepStrictEqual(qa, [], `legacy q=${word}`);
    }
    // the cleared holder DOES find them — the filter works, it is the clearance that hides them
    const legal = await (await get(base, `/api/raid?q=${encodeURIComponent('legal Zebrafish')}`, fx.tokens.pmo_legal)).json();
    assert.deepStrictEqual(ids(legal).sort(), ['raid_r_legal', 'raid_r_legalstamp']);
    const hr = await (await get(base, `/api/raid?q=Zebrafish`, fx.tokens.pmo_hr)).json();
    assert.deepStrictEqual(ids(hr).sort(), ['raid_r_hr', 'raid_r_hrstamp']);
    // status / owner / workstream filters never reveal a restricted row either
    const openCount = await (await get(base, '/api/raid?status=open&limit=200', fx.tokens.pmo_none)).json();
    assert.strictEqual(openCount.total, visibleNone.filter((r) => r.status === 'open').length);
  });
});

test('raid-list-query (j): invalid list parameters answer 400 with one fixed body; unknown keys are ignored', async () => {
  const { fx, rows } = seedDeal();
  await withServer(async (base) => {
    const bad = [
      'limit=0', 'limit=201', 'limit=abc', 'limit=-1', 'limit=1.5', 'limit=', 'limit=1e2',
      'offset=-1', 'offset=5', 'offset=abc&limit=5',
      'status=bogus', 'status=', 'status[]=open', 'status=open&status=closed',
      `owner=${'x'.repeat(121)}`, `q=${'y'.repeat(201)}`,
      'limit[a]=1', 'q[]=a',
    ];
    for (const qs of bad) {
      const res = await get(base, `/api/raid?${qs}`, fx.tokens.karen);
      assert.strictEqual(res.status, 400, `?${qs}`);
      assert.deepStrictEqual(await res.json(), { error: 'Invalid list query.' }, `?${qs}`);
    }
    // unknown keys (including `phase`, which RAID does not define) are ignored -> the legacy array
    const ignored = await get(base, '/api/raid?phase=day1&sort=title&foo=bar', fx.tokens.karen);
    assert.strictEqual(ignored.status, 200);
    assert.strictEqual(await ignored.text(), JSON.stringify(expectedVisible(rows, 'all')));
    // limit boundaries are accepted
    assert.strictEqual((await get(base, '/api/raid?limit=1', fx.tokens.karen)).status, 200);
    assert.strictEqual((await get(base, '/api/raid?limit=200', fx.tokens.karen)).status, 200);
  });
});

test('raid-list-query (k): POST /api/raid create, update, stale 409 (filtered echo), 404 for an invisible id — and DELETE — behave exactly as before on the RAID read set', async () => {
  const { fx, rows } = seedDeal();
  await withServer(async (base) => {
    // create
    const created = await post(base, '/api/raid', fx.tokens.pmo_none, { title: 'Fresh entry', type: 'risk', severity: 'low' });
    assert.strictEqual(created.status, 201);
    const entry = (await created.json()).entry;
    const afterCreate = await (await get(base, '/api/raid?limit=200', fx.tokens.pmo_none)).json();
    assert.strictEqual(afterCreate.total, expectedVisible(rows, []).length + 1);
    assert.strictEqual(afterCreate.items[afterCreate.items.length - 1].id, entry.id, 'appended at the tail of the lane');

    // update (version 0 -> 1), then a stale write is a 409
    const upd = await post(base, '/api/raid', fx.tokens.pmo_none, { id: entry.id, title: 'Renamed', version: 0 });
    assert.strictEqual(upd.status, 200);
    const stale = await post(base, '/api/raid', fx.tokens.pmo_none, { id: entry.id, title: 'Stale', version: 0 });
    assert.strictEqual(stale.status, 409);
    assert.strictEqual((await stale.json()).conflictKind, 'version');

    // an invisible id is a byte-identical 404 BEFORE any 409 — for update and delete
    const hidden = await post(base, '/api/raid', fx.tokens.pmo_none, { id: 'raid_r_hrstamp', title: 'x', version: 0 });
    assert.strictEqual(hidden.status, 404);
    const hiddenBody = await hidden.text();
    const missing = await post(base, '/api/raid', fx.tokens.pmo_none, { id: 'raid_does_not_exist', title: 'x', version: 0 });
    assert.strictEqual(missing.status, 404);
    assert.strictEqual(await missing.text(), hiddenBody, 'invisible and missing are indistinguishable');
    const hiddenDel = await fetch(`${base}/api/raid/raid_r_hr?expectedVersion=0`, { method: 'DELETE', headers: { Cookie: cookieHeader(fx.tokens.pmo_none) } });
    assert.strictEqual(hiddenDel.status, 404);

    // delete works and the lane shrinks
    const del = await fetch(`${base}/api/raid/${entry.id}?expectedVersion=1`, { method: 'DELETE', headers: { Cookie: cookieHeader(fx.tokens.pmo_none) } });
    assert.strictEqual(del.status, 200);
    const afterDelete = await (await get(base, '/api/raid?limit=200', fx.tokens.pmo_none)).json();
    assert.strictEqual(afterDelete.total, expectedVisible(rows, []).length);

    // the restricted rows survived every one of those writes untouched
    const stillThere = await (await get(base, '/api/raid?limit=200', fx.tokens.karen)).json();
    assert.strictEqual(stillThere.total, 60);
  });
});

test('raid-list-query (l): the RAID write handlers load only RAID_READ_SET — source-level', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok((src.match(/RAID_READ_SET/g) || []).length >= 3);
  for (const route of ["app.post('/api/raid',", "app.delete('/api/raid/:id',"]) {
    const start = src.indexOf(route);
    assert.ok(start !== -1, route);
    const body = src.slice(start, src.indexOf('\n});', start));
    assert.ok(body.includes('readCollections(RAID_READ_SET)'), `${route} must read through the RAID read set`);
    assert.ok(!/=\s*readDb\(\)/.test(body), `${route} must not assign from readDb()`);
  }
  const listStart = src.indexOf("app.get('/api/raid',");
  const listBody = src.slice(listStart, src.indexOf('\n});', listStart));
  assert.ok(!/=\s*readDb\(\)/.test(listBody), 'GET /api/raid must not assign from readDb()');
  assert.ok(listBody.includes('raidRowVisible('), 'GET /api/raid applies the shared provenance predicate');
});
