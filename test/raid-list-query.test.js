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
