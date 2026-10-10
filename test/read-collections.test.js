// D-12-02 / DATA-02 (Phase 12, plan 12-05): store-level proof of the
// proportional read API — readCollections(), readSingleton(), readProjection().
//
//   - readCollections([...]) rows deep-equal readDb()'s for the requested keys
//   - a collection NOT requested is a throwing accessor (get AND set) naming it,
//     never an empty array (PD-11 / T-12-42: an empty lane is a fail-open
//     clearance risk) — and never trips JSON.stringify / Object.keys / spread
//   - writeDb() on a partial object writes and audits only the loaded
//     collections, leaves every other collection byte-for-byte untouched, and
//     does not re-upsert an unchanged singleton
//   - readProjection() returns { id, seq, raw, f } in seq order; field names are
//     validated and bound, never interpolated (T-12-43)
//   - raidLaneName() (server.js) and raidLane() resolve the same lane
//
// Audit rows are counted only through db/auditHook.js's query API.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-read-collections-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const resolver = require('../db/resolver.js');
const controlStore = require('../db/controlStore.js');
const auditHook = require('../db/auditHook.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const { ARRAY_COLLECTIONS, SINGLETON_KEYS } = require('../db/collections.js');

store.getOrOpenConnection(dbFiles.DEMO_DB_PATH, dbFiles.DEAL_SCHEMA_PATH);

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

let dealCounter = 0;
function registerDeal() {
  dealCounter += 1;
  const label = `Read Collections ${dealCounter}`;
  const deal = controlStore.createDeal({ name: label, targetCompany: label + ' Co', members: ['karen'], createdBy: 'admin' });
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal.id;
}

function dealCtx(dealId) {
  const fakeReq = { baseUrl: '/api', path: '/whatever', portalUser: { username: 'karen', role: 'hrbp', dealId, sessionId: 'sess_karen' } };
  const resolved = resolver.resolveDatabase(fakeReq);
  const conn = store.getOrOpenConnection(resolved.dbPath, resolved.schemaPath);
  return {
    conn,
    context: {
      conn, kind: resolved.kind, dealId: resolved.dealId, dbPath: resolved.dbPath,
      actor: { username: 'karen', role: 'hrbp', sessionId: 'sess_karen' },
      request: { method: 'TEST', path: fakeReq.path, ip: null },
    },
  };
}
function runAsDeal(dealId, fn) { return store.runWithDb(dealCtx(dealId).context, fn); }
function auditRows(dealId) { return auditHook.queryAudit({ dealId, limit: 500 }); }
function storedRaw(dealId, key) {
  const { conn } = dealCtx(dealId);
  return conn.prepare(`SELECT id, seq, data FROM ${key} ORDER BY seq`).all();
}

function mkRaid(i, extra) {
  return Object.assign({ id: `rd_${String(i).padStart(3, '0')}`, type: 'risk', title: `Risk ${i}`, severity: 'low', status: 'open', owner: i % 2 ? 'ann' : 'bob', workstreamId: 'ws_imo', notes: `note ${i}`, source: '' }, extra || {});
}

function seededDeal() {
  const dealId = registerDeal();
  runAsDeal(dealId, () => {
    const db = store.readDb();
    db.settings = { demoMode: false, dealName: 'X' };
    db.raidEntries = [mkRaid(1), mkRaid(2)];
    db.customRaidEntries = Array.from({ length: 6 }, (_, i) => mkRaid(i + 10, i === 3 ? { clearanceArea: 'hr', source: 'org-flightrisk:fr_1' } : {}));
    db.ddFindings = [{ id: 'f_1', area: 'legal', title: 'F1' }];
    db.integrationTasks = [{ id: 'it_1', title: 'Task 1', status: 'open' }, { id: 'it_2', title: 'Task 2', status: 'done' }];
    db.menus = { sidebar: ['a'] };
    store.writeDb(db);
  });
  return dealId;
}

test('read-collections (a): rows deep-equal readDb() for the requested keys, singletons included', () => {
  const dealId = seededDeal();
  runAsDeal(dealId, () => {
    const full = store.readDb();
    const part = store.readCollections(['raidEntries', 'customRaidEntries', 'settings', 'menus']);
    for (const key of ['raidEntries', 'customRaidEntries', 'settings', 'menus']) {
      assert.deepStrictEqual(part[key], full[key], `${key} must equal readDb()'s`);
    }
    assert.deepStrictEqual(Object.keys(part).sort(), ['customRaidEntries', 'menus', 'raidEntries', 'settings']);
  });
});

test('read-collections (b): touching a collection that was not requested throws CollectionNotLoadedError naming it — get AND set', () => {
  const dealId = seededDeal();
  runAsDeal(dealId, () => {
    const part = store.readCollections(['raidEntries', 'settings']);
    for (const key of ['integrationTasks', 'ddFindings', 'customRaidEntries', 'orgPositions']) {
      let err;
      try { void part[key]; } catch (e) { err = e; }
      assert.ok(err instanceof store.CollectionNotLoadedError, `${key}: get must throw CollectionNotLoadedError`);
      assert.strictEqual(err.code, 'COLLECTION_NOT_LOADED');
      assert.strictEqual(err.collection, key);
      assert.ok(err.message.includes(`'${key}'`), 'message names the collection');
      assert.throws(() => { part[key] = []; }, (e) => e instanceof store.CollectionNotLoadedError && e.collection === key, `${key}: set must throw`);
    }
    for (const key of ['customSettings', 'i18n', 'menus', 'activeProjectId']) {
      assert.throws(() => part[key], store.CollectionNotLoadedError, `singleton ${key}: get must throw`);
    }
  });
});

test('read-collections (c): the accessors are non-enumerable — JSON.stringify, Object.keys, spread and Object.assign never trip them', () => {
  const dealId = seededDeal();
  runAsDeal(dealId, () => {
    const part = store.readCollections(['raidEntries', 'settings']);
    assert.doesNotThrow(() => JSON.stringify(part));
    assert.doesNotThrow(() => Object.keys(part));
    assert.doesNotThrow(() => ({ ...part }));
    assert.doesNotThrow(() => Object.assign({}, part));
    assert.deepStrictEqual(Object.keys(JSON.parse(JSON.stringify(part))).sort(), ['raidEntries', 'settings']);
    // every known key is still "in" the object (the accessor exists) — only a read/write throws
    assert.ok('integrationTasks' in part);
  });
});

test('read-collections (d): unknown or malformed names throw immediately', () => {
  const dealId = seededDeal();
  runAsDeal(dealId, () => {
    assert.throws(() => store.readCollections(['raidEntrys']), /unknown collection name 'raidEntrys'/);
    assert.throws(() => store.readCollections('raidEntries'), TypeError);
    assert.throws(() => store.readSingleton('raidEntries'), /not a singleton key/);
    assert.throws(() => store.readProjection('settings', []), /not an array collection/);
  });
});

test('read-collections (e): writeDb() on a partial object writes and audits only the loaded collections', () => {
  const dealId = seededDeal();
  const beforeTasks = storedRaw(dealId, 'integrationTasks');
  const beforeFindings = storedRaw(dealId, 'ddFindings');
  const beforeMenus = dealCtx(dealId).conn.prepare("SELECT data FROM app_state WHERE key = 'menus'").get();
  const mark = auditRows(dealId).reduce((m, r) => Math.max(m, r.id), 0);

  runAsDeal(dealId, () => {
    const part = store.readCollections(['settings', 'raidEntries', 'customRaidEntries', 'ddFindings']);
    part.customRaidEntries.push(mkRaid(99));
    store.writeDb(part);
  });

  const delta = auditRows(dealId).filter((r) => r.id > mark);
  assert.strictEqual(delta.length, 1, 'one new row -> exactly one audit row');
  assert.strictEqual(delta[0].collection, 'customRaidEntries');
  assert.strictEqual(delta[0].action, 'insert');
  assert.deepStrictEqual(storedRaw(dealId, 'integrationTasks'), beforeTasks, 'an unloaded collection is byte-for-byte untouched');
  assert.deepStrictEqual(storedRaw(dealId, 'ddFindings'), beforeFindings);
  assert.deepStrictEqual(dealCtx(dealId).conn.prepare("SELECT data FROM app_state WHERE key = 'menus'").get(), beforeMenus, 'an unloaded singleton is untouched');
  assert.strictEqual(storedRaw(dealId, 'customRaidEntries').length, 7);
});

test('read-collections (f): a partial write never deletes rows of collections it did not load (an empty lane is not a delete)', () => {
  const dealId = seededDeal();
  runAsDeal(dealId, () => {
    const part = store.readCollections(['settings', 'raidEntries']);
    store.writeDb(part); // nothing changed
  });
  assert.strictEqual(storedRaw(dealId, 'customRaidEntries').length, 6);
  assert.strictEqual(storedRaw(dealId, 'integrationTasks').length, 2);
});

test('read-collections (g): a payload carrying an own enumerable value for an unloaded collection is refused', () => {
  const dealId = seededDeal();
  runAsDeal(dealId, () => {
    const part = store.readCollections(['settings', 'raidEntries']);
    Object.defineProperty(part, 'integrationTasks', { value: [{ id: 'sneak', title: 'x' }], enumerable: true, configurable: true });
    assert.throws(() => store.writeDb(part), /did not load/);
  });
  assert.strictEqual(storedRaw(dealId, 'integrationTasks').length, 2);
});

test('read-collections (h): an unchanged singleton is not re-upserted; a changed one is, and a later no-op write skips it again', () => {
  const dealId = seededDeal();
  const settingsRow = () => dealCtx(dealId).conn.prepare("SELECT data FROM app_state WHERE key = 'settings'").get().data;
  // Another writer changes settings after this request read it.
  runAsDeal(dealId, () => {
    const part = store.readCollections(['settings', 'raidEntries']);
    const other = store.readDb();
    other.settings.dealName = 'Changed by another writer';
    store.writeDb(other);
    part.raidEntries.push(mkRaid(50));
    store.writeDb(part); // settings unchanged by THIS request -> must not clobber
  });
  assert.strictEqual(JSON.parse(settingsRow()).dealName, 'Changed by another writer');

  runAsDeal(dealId, () => {
    const part = store.readCollections(['settings']);
    part.settings.dealName = 'Mine';
    store.writeDb(part);
    assert.strictEqual(JSON.parse(settingsRow()).dealName, 'Mine');
    // revert on the SAME object: baseline moved post-commit, so this is a real change again
    part.settings.dealName = 'Changed by another writer';
    store.writeDb(part);
    assert.strictEqual(JSON.parse(settingsRow()).dealName, 'Changed by another writer');
  });
});

test('read-collections (i): readCollections() rows carry a __snapshot only for loaded collections (hidden, non-enumerable)', () => {
  const dealId = seededDeal();
  runAsDeal(dealId, () => {
    const part = store.readCollections(['raidEntries', 'settings']);
    assert.deepStrictEqual(Object.keys(part.__snapshot), ['raidEntries']);
    assert.ok(part.__loaded instanceof Set);
    assert.deepStrictEqual([...part.__loaded].sort(), ['raidEntries', 'settings']);
    assert.ok(!Object.keys(part).includes('__snapshot'));
  });
});

test('read-collections (j): readProjection returns { id, seq, raw, f } in seq order with the extracted fields', () => {
  const dealId = seededDeal();
  runAsDeal(dealId, () => {
    const rows = store.readProjection('customRaidEntries', ['status', 'clearanceArea', 'owner']);
    const stored = storedRaw(dealId, 'customRaidEntries');
    assert.strictEqual(rows.length, stored.length);
    rows.forEach((r, i) => {
      assert.strictEqual(r.id, stored[i].id);
      assert.strictEqual(r.seq, stored[i].seq);
      assert.strictEqual(r.raw, stored[i].data, 'raw is the stored JSON text, not a re-serialization');
      const parsed = JSON.parse(stored[i].data);
      assert.strictEqual(r.f.status, parsed.status);
      assert.strictEqual(r.f.owner, parsed.owner);
      assert.strictEqual(r.f.clearanceArea, parsed.clearanceArea === undefined ? null : parsed.clearanceArea);
    });
    assert.strictEqual(rows.filter((r) => r.f.clearanceArea === 'hr').length, 1);
    // no fields -> still id/seq/raw
    const bare = store.readProjection('customRaidEntries', []);
    assert.deepStrictEqual(bare.map((r) => r.id), stored.map((r) => r.id));
    assert.deepStrictEqual(bare[0].f, {});
  });
});

test('read-collections (k): a projection field name outside the identifier shape throws and is never interpolated', () => {
  const dealId = seededDeal();
  runAsDeal(dealId, () => {
    for (const bad of ["status'); DROP TABLE raidEntries;--", 'a.b', 'a b', '', '1abc', 'x'.repeat(65), 'a$', "$.status"]) {
      assert.throws(() => store.readProjection('raidEntries', [bad]), /field names must match/, JSON.stringify(bad));
    }
    assert.throws(() => store.readProjection('raidEntries; DROP TABLE x', ['status']), /not an array collection/);
    assert.strictEqual(storedRaw(dealId, 'raidEntries').length, 2);
  });
});

test('read-collections (l): readSingleton returns the parsed value, undefined when never written', () => {
  const dealId = seededDeal();
  runAsDeal(dealId, () => {
    assert.strictEqual(store.readSingleton('settings').demoMode, false);
    assert.strictEqual(store.readSingleton('customSettings'), undefined);
    assert.deepStrictEqual(store.readSingleton('menus'), { sidebar: ['a'] });
  });
});

test('read-collections (m): every known key is covered by the accessor set — 38 collections + 5 singletons', () => {
  const dealId = seededDeal();
  runAsDeal(dealId, () => {
    const part = store.readCollections([]);
    for (const key of [...ARRAY_COLLECTIONS, ...SINGLETON_KEYS]) {
      assert.throws(() => part[key], store.CollectionNotLoadedError, key);
    }
  });
});

test('read-collections (n): server.js raidLaneName() and raidLane() resolve the same lane for demoMode false / true / absent', () => {
  // server.js is an app module: read the two functions out of its source and
  // evaluate them, rather than booting the whole app inside a store-level suite.
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const grab = (name) => {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start !== -1, `${name} not found`);
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('unbalanced');
  };
  const { raidLane, raidLaneName } = new Function(`${grab('raidLane')}\n${grab('raidLaneName')}\nreturn { raidLane, raidLaneName };`)();
  for (const settings of [{ demoMode: false }, { demoMode: true }, {}, undefined, { demoMode: 'false' }, { demoMode: null }]) {
    const db = { settings, raidEntries: [{ id: 'demo' }], customRaidEntries: [{ id: 'custom' }] };
    const viaLane = raidLane(db)[0].id === 'custom' ? 'customRaidEntries' : 'raidEntries';
    assert.strictEqual(raidLaneName(settings), viaLane, `settings=${JSON.stringify(settings)}`);
  }
});

test('read-collections (o): readCollections()/readProjection() issue no write — stored rows and audit are unchanged', () => {
  const dealId = seededDeal();
  const { conn } = dealCtx(dealId);
  const snapshot = () => JSON.stringify([
    conn.prepare('SELECT key, data FROM app_state ORDER BY key').all(),
    storedRaw(dealId, 'raidEntries'), storedRaw(dealId, 'customRaidEntries'), storedRaw(dealId, 'ddFindings'),
  ]);
  const before = snapshot();
  const mark = auditRows(dealId).length;
  runAsDeal(dealId, () => {
    store.readCollections(['raidEntries', 'settings']);
    store.readProjection('raidEntries', ['status']);
    store.readSingleton('settings');
  });
  assert.strictEqual(auditRows(dealId).length, mark);
  assert.strictEqual(snapshot(), before);
});
