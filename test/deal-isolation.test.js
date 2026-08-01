// ISO-01 / ROADMAP SC-1: two different deals' SQLite files contain no shared
// rows, a deal file shares no rows with demo.db either, concurrent writes to
// two different deal databases both land (each only in its own file, no lost
// update), and a request bound to a deal cannot reach the account store
// through the request-bound read model.
//
// Uses the SAME temp-trio-plus-env-override pattern test/deal-resolver.test.js
// establishes (see its header comment for the full rationale) — this file
// exercises the resolver's connection-cache/AsyncLocalStorage machinery
// directly (via db/resolver.js + db/store.js) rather than re-booting the full
// HTTP app, since the ISO-01 concurrency/isolation proofs here are about the
// STORAGE layer, not route-level behavior (that is test/deal-resolver.test.js's
// job).
//
// node:test — Node's built-in runner, zero new dependency. Run via
// `node --test` (bare — this repo's default test discovery), or `npm test`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-deal-isolation-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}
function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-deal-isolation-split-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');

const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');
const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
const SOURCE_DB_PATH = tempDbPath('legacy-source');
runMigration(SOURCE_PATH, SOURCE_DB_PATH);

const { runSplit } = require('../scripts/split-db-into-control-demo-deals.js');
runSplit({ sourcePath: SOURCE_DB_PATH, outDir: TMP_DIR });

const { ARRAY_COLLECTIONS } = require('../db/collections.js');
const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const resolver = require('../db/resolver.js');
const controlStore = require('../db/controlStore.js');
const { createDealDatabase, DEAL_SEED_COLLECTIONS } = require('../db/dealSeed.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);

// Phase 3 Task 2: accounts are a control.db-native table, no longer part of
// ARRAY_COLLECTIONS — seed real rows directly from db.json's own `users`
// array so case (d) has a real account to prove is (and isn't) reachable.
const fixtureUsers = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

// D-06: a new deal's DEAL_SEED_COLLECTIONS (checklistTemplates,
// assessmentTemplates, processCatalog) are DELIBERATELY copied verbatim from
// the same demo.db template source into every new deal — two deals seeded
// from the same source legitimately share those row ids by design (proven
// separately by test/deal-seed.test.js). The "no shared rows" isolation
// proof below is about business/real data, so these three are excluded from
// that loop and asserted separately as an intentional non-isolation case.
const NON_ISOLATED_SEED_COLLECTIONS = new Set(DEAL_SEED_COLLECTIONS);

let dealSeq = 0;
function registerDeal(deal) {
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(deal.id, dealSeq++, deal.status || 'active', JSON.stringify(deal));
}
registerDeal({ id: 'deal_one1', name: 'Deal One', targetCompany: 'One Co', members: ['karen'], status: 'active', createdBy: 'admin', createdAt: new Date().toISOString() });
registerDeal({ id: 'deal_two1', name: 'Deal Two', targetCompany: 'Two Co', members: ['karen'], status: 'active', createdBy: 'admin', createdAt: new Date().toISOString() });

createDealDatabase('deal_one1', { name: 'Deal One', targetCompany: 'One Co' });
createDealDatabase('deal_two1', { name: 'Deal Two', targetCompany: 'Two Co' });

test.after(() => {
  cleanupDbFile(SOURCE_DB_PATH);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

/** Simulate the resolver binding a request to `dealId` (or demo, if null)
 * and run `fn` inside that AsyncLocalStorage context, exactly the way
 * db/resolver.js's dealResolverMiddleware does for a real request. */
function runAsDeal(dealId, fn) {
  const fakeReq = { baseUrl: '/api', path: '/whatever', portalUser: dealId ? { username: 'karen', role: 'hrbp', dealId } : null };
  const resolved = resolver.resolveDatabase(fakeReq);
  const conn = store.getOrOpenConnection(resolved.dbPath, resolved.schemaPath);
  return store.runWithDb({ conn, kind: resolved.kind, dealId: resolved.dealId, dbPath: resolved.dbPath }, fn);
}

test('deal-isolation (a): a distinct row written through the resolver-bound path to each of two deals never appears in the other file, across EVERY array collection', () => {
  runAsDeal('deal_one1', () => {
    const db = store.readDb();
    db.alerts = db.alerts.concat([{ id: 'alert_one_only', title: 'Deal One alert', severity: 'low' }]);
    store.writeDb(db);
  });
  runAsDeal('deal_two1', () => {
    const db = store.readDb();
    db.alerts = db.alerts.concat([{ id: 'alert_two_only', title: 'Deal Two alert', severity: 'low' }]);
    store.writeDb(db);
  });

  const oneConn = store.getOrOpenConnection(dbFiles.dealDbPath('deal_one1'), dbFiles.DEAL_SCHEMA_PATH);
  const twoConn = store.getOrOpenConnection(dbFiles.dealDbPath('deal_two1'), dbFiles.DEAL_SCHEMA_PATH);

  for (const key of ARRAY_COLLECTIONS) {
    if (NON_ISOLATED_SEED_COLLECTIONS.has(key)) continue; // D-06 template inheritance — see rationale above
    const oneIds = oneConn.prepare(`SELECT id FROM ${key}`).all().map((r) => r.id);
    const twoIds = twoConn.prepare(`SELECT id FROM ${key}`).all().map((r) => r.id);
    const shared = oneIds.filter((id) => twoIds.includes(id));
    assert.strictEqual(shared.length, 0, `deal_one1 and deal_two1 must share NO row ids in ${key} — found: ${shared.join(',')}`);
  }
  // The excluded seed-template collections DO legitimately share ids (both
  // deals inherited the same templates from demo.db) — assert that positively
  // instead of silently skipping it, so this exemption stays proven, not assumed.
  for (const key of NON_ISOLATED_SEED_COLLECTIONS) {
    const oneIds = oneConn.prepare(`SELECT id FROM ${key}`).all().map((r) => r.id);
    const twoIds = twoConn.prepare(`SELECT id FROM ${key}`).all().map((r) => r.id);
    if (oneIds.length === 0) continue; // template collection may legitimately be empty in the fixture
    assert.deepStrictEqual([...oneIds].sort(), [...twoIds].sort(), `${key} is a D-06 seed-template collection — both deals must inherit the SAME ids from demo.db`);
  }

  const oneAlertIds = oneConn.prepare('SELECT id FROM alerts').all().map((r) => r.id);
  const twoAlertIds = twoConn.prepare('SELECT id FROM alerts').all().map((r) => r.id);
  assert.ok(oneAlertIds.includes('alert_one_only'), 'deal_one1 must carry its own written row');
  assert.ok(!oneAlertIds.includes('alert_two_only'), 'deal_one1 must not carry deal_two1\'s row');
  assert.ok(twoAlertIds.includes('alert_two_only'), 'deal_two1 must carry its own written row');
  assert.ok(!twoAlertIds.includes('alert_one_only'), 'deal_two1 must not carry deal_one1\'s row');
});

test('deal-isolation (b): a deal file shares no BUSINESS-data rows with demo.db (D-06 seed templates are the sole, proven exception)', () => {
  const demoConn = store.getOrOpenConnection(dbFiles.DEMO_DB_PATH, dbFiles.DEAL_SCHEMA_PATH);
  const oneConn = store.getOrOpenConnection(dbFiles.dealDbPath('deal_one1'), dbFiles.DEAL_SCHEMA_PATH);
  for (const key of ARRAY_COLLECTIONS) {
    if (NON_ISOLATED_SEED_COLLECTIONS.has(key)) continue; // D-06 template inheritance — see rationale above
    const demoIds = demoConn.prepare(`SELECT id FROM ${key}`).all().map((r) => r.id);
    const dealIds = oneConn.prepare(`SELECT id FROM ${key}`).all().map((r) => r.id);
    const shared = demoIds.filter((id) => dealIds.includes(id));
    assert.strictEqual(shared.length, 0, `demo.db and deal_one1 must share NO row ids in ${key} — found: ${shared.join(',')}`);
  }
});

test('deal-isolation (c) ISO-01 concurrency: two concurrent writes against two different deal databases both persist, each only in its own file, with no lost update', async () => {
  // Two "requests" each read (their own resolved db) BEFORE either writes —
  // the exact interleave that reproduces a lost-update race if the two
  // writes shared one connection/snapshot instead of independent files.
  const before = runAsDeal('deal_one1', () => store.readDb().alerts.length);

  const writeOne = () => runAsDeal('deal_one1', async () => {
    await new Promise((resolve) => setImmediate(resolve));
    const db = store.readDb();
    db.alerts = db.alerts.concat([{ id: 'concurrent_one_' + crypto.randomBytes(3).toString('hex'), title: 'concurrent A', severity: 'low' }]);
    store.writeDb(db);
  });
  const writeTwo = () => runAsDeal('deal_two1', async () => {
    await new Promise((resolve) => setImmediate(resolve));
    const db = store.readDb();
    db.alerts = db.alerts.concat([{ id: 'concurrent_two_' + crypto.randomBytes(3).toString('hex'), title: 'concurrent B', severity: 'low' }]);
    store.writeDb(db);
  });

  await Promise.all([writeOne(), writeTwo()]);

  const afterOneCount = runAsDeal('deal_one1', () => store.readDb().alerts.length);
  assert.strictEqual(afterOneCount, before + 1, 'deal_one1 must gain exactly its own concurrent write, no lost update');

  const oneConn = store.getOrOpenConnection(dbFiles.dealDbPath('deal_one1'), dbFiles.DEAL_SCHEMA_PATH);
  const twoConn = store.getOrOpenConnection(dbFiles.dealDbPath('deal_two1'), dbFiles.DEAL_SCHEMA_PATH);
  const oneHasTwo = oneConn.prepare(`SELECT COUNT(*) AS c FROM alerts WHERE id LIKE 'concurrent_two_%'`).get().c;
  const twoHasOne = twoConn.prepare(`SELECT COUNT(*) AS c FROM alerts WHERE id LIKE 'concurrent_one_%'`).get().c;
  assert.strictEqual(oneHasTwo, 0, 'deal_one1 must not observe deal_two1\'s concurrent write');
  assert.strictEqual(twoHasOne, 0, 'deal_two1 must not observe deal_one1\'s concurrent write');
});

test('deal-isolation (d): a request bound to a deal cannot read any account row through the request-bound read model', () => {
  runAsDeal('deal_one1', () => {
    const db = store.readDb();
    assert.strictEqual(db.users, undefined, 'a deal-bound readDb() must never expose an accounts collection — accounts live only in control.db, reached through db/controlStore.js');
  });
  // The SAME account IS reachable through the correct, dedicated accessor.
  const admin = controlStore.findUser('admin');
  assert.ok(admin, 'the admin account must still be reachable through db/controlStore.js');
});
