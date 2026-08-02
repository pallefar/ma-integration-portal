// AUD-01 / AUD-02 / D-08 / D-11: proves db/store.js's writeDb() audit hook
// (db/auditHook.js) writes one attributed, append-only entry per row mutated
// in a real deal database — full before/after JSON, correct actor, correct
// empty/adjacency/ordering behavior — that demo writes are never audited,
// and that a deal's audit trail survives the deal's own deletion (AUD-02).
//
// Uses the SAME temp-trio-plus-env-override pattern test/deal-isolation.test.js
// establishes: boots the storage layer directly (db/resolver.js +
// db/store.js + db/controlStore.js + db/auditHook.js) against an isolated
// temp control/runtime/demo/deals/audit file set, rather than the live,
// committed data/*.db files — this suite's proofs are about the STORAGE
// layer, not route-level HTTP behavior.
//
// node:test — Node's built-in runner, zero new dependency. Run via
// `node --test test/audit-log.test.js` (or `npm test`).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function randId(prefix) {
  return prefix + '_' + crypto.randomBytes(3).toString('hex');
}

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-audit-log-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const resolver = require('../db/resolver.js');
const controlStore = require('../db/controlStore.js');
const sessionsDb = require('../db/sessions.js');
const auditHook = require('../db/auditHook.js');
const { createDealDatabase } = require('../db/dealSeed.js');

// Force demo.db into existence (schema-only — no migration/split needed for
// this suite, which never reads demo's business rows, only writes a marker
// row in case (f)). dealSeed.createDealDatabase()'s template read requires
// demo.db to already exist.
store.getOrOpenConnection(dbFiles.DEMO_DB_PATH, dbFiles.DEAL_SCHEMA_PATH);

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

/** Register a real deal in control.db and provision its own database file —
 * mirrors server.js's POST /api/deals handler (controlStore.createDeal() +
 * db/dealSeed.js's createDealDatabase()). */
function registerDeal(label, member) {
  const deal = controlStore.createDeal({ name: label, targetCompany: label + ' Co', members: [member], createdBy: 'admin' });
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal.id;
}

/** Simulate the resolver binding a request bound to `dealId` for `username`/
 * `role`, and run `fn` inside that AsyncLocalStorage context — including the
 * `actor`/`request` fields db/resolver.js's dealResolverMiddleware derives
 * from req.portalUser (AUD-01/D-11), so a write inside `fn` is attributed
 * exactly the way a real HTTP request would be. */
function runAsDeal(dealId, username, role, fn) {
  const fakeReq = { baseUrl: '/api', path: '/whatever', portalUser: { username, role, dealId, sessionId: 'sess_' + username } };
  const resolved = resolver.resolveDatabase(fakeReq);
  const conn = store.getOrOpenConnection(resolved.dbPath, resolved.schemaPath);
  const actor = { username, role, sessionId: fakeReq.portalUser.sessionId };
  const request = { method: 'TEST', path: fakeReq.path, ip: null };
  return store.runWithDb({ conn, kind: resolved.kind, dealId: resolved.dealId, dbPath: resolved.dbPath, actor, request }, fn);
}

/** Same, but resolved to demo (no session/deal binding) — mirrors an
 * anonymous or demo-bound request. */
function runAsDemo(fn) {
  const fakeReq = { baseUrl: '/api', path: '/whatever', portalUser: null };
  const resolved = resolver.resolveDatabase(fakeReq);
  const conn = store.getOrOpenConnection(resolved.dbPath, resolved.schemaPath);
  const request = { method: 'TEST', path: fakeReq.path, ip: null };
  return store.runWithDb({ conn, kind: resolved.kind, dealId: resolved.dealId, dbPath: resolved.dbPath, actor: null, request }, fn);
}

test('audit-log (a): a deal-bound session inserts, updates, then deletes a row, and audit.db holds exactly three rows for it with correct actions/actor/deal/collection/row-id', () => {
  const dealId = registerDeal('Audit Deal A', 'karen');
  const rowId = randId('alert_a');

  runAsDeal(dealId, 'karen', 'hrbp', () => {
    const db = store.readDb();
    db.alerts = db.alerts.concat([{ id: rowId, title: 'Audit insert', severity: 'low' }]);
    store.writeDb(db);
  });
  runAsDeal(dealId, 'karen', 'hrbp', () => {
    const db = store.readDb();
    const idx = db.alerts.findIndex((a) => a.id === rowId);
    db.alerts[idx] = { ...db.alerts[idx], severity: 'high' };
    store.writeDb(db);
  });
  runAsDeal(dealId, 'karen', 'hrbp', () => {
    const db = store.readDb();
    db.alerts = db.alerts.filter((a) => a.id !== rowId);
    store.writeDb(db);
  });

  const rows = auditHook.queryAudit({ dealId }).filter((r) => r.row_id === rowId);
  assert.strictEqual(rows.length, 3, 'insert+update+delete must produce exactly 3 audit rows for this row id');
  const [insertRow, updateRow, deleteRow] = [...rows].sort((a, b) => a.id - b.id);

  assert.strictEqual(insertRow.action, 'insert');
  assert.strictEqual(insertRow.actor_username, 'karen');
  assert.strictEqual(insertRow.actor_role, 'hrbp');
  assert.strictEqual(insertRow.deal_id, dealId);
  assert.strictEqual(insertRow.collection, 'alerts');
  assert.strictEqual(updateRow.action, 'update');
  assert.strictEqual(updateRow.actor_username, 'karen');
  assert.strictEqual(deleteRow.action, 'delete');
  assert.strictEqual(deleteRow.actor_username, 'karen');
});

test('audit-log (b): the insert row\'s before is SQL NULL and its after parses back to the exact stored item; the update row carries both; the delete row\'s after is SQL NULL — never a stringified placeholder', () => {
  const dealId = registerDeal('Audit Deal B', 'karen');
  const rowId = randId('alert_b');

  runAsDeal(dealId, 'karen', 'hrbp', () => {
    const db = store.readDb();
    db.alerts = db.alerts.concat([{ id: rowId, title: 'Audit insert', severity: 'low' }]);
    store.writeDb(db);
  });
  runAsDeal(dealId, 'karen', 'hrbp', () => {
    const db = store.readDb();
    const idx = db.alerts.findIndex((a) => a.id === rowId);
    db.alerts[idx] = { ...db.alerts[idx], severity: 'high' };
    store.writeDb(db);
  });
  runAsDeal(dealId, 'karen', 'hrbp', () => {
    const db = store.readDb();
    db.alerts = db.alerts.filter((a) => a.id !== rowId);
    store.writeDb(db);
  });

  const rows = auditHook.queryAudit({ dealId }).filter((r) => r.row_id === rowId);
  const [insertRow, updateRow, deleteRow] = [...rows].sort((a, b) => a.id - b.id);

  assert.strictEqual(insertRow.before_json, null, 'a first insert must record before as SQL NULL, never the string "null"');
  assert.deepStrictEqual(JSON.parse(insertRow.after_json), { id: rowId, title: 'Audit insert', severity: 'low' });

  assert.deepStrictEqual(JSON.parse(updateRow.before_json), { id: rowId, title: 'Audit insert', severity: 'low' });
  assert.deepStrictEqual(JSON.parse(updateRow.after_json), { id: rowId, title: 'Audit insert', severity: 'high' });

  assert.strictEqual(deleteRow.after_json, null, 'a delete must record after as SQL NULL, never the string "null"');
  assert.deepStrictEqual(JSON.parse(deleteRow.before_json), { id: rowId, title: 'Audit insert', severity: 'high' });

  for (const r of rows) {
    assert.notStrictEqual(r.before_json, 'null');
    assert.notStrictEqual(r.before_json, 'undefined');
    assert.notStrictEqual(r.after_json, 'null');
    assert.notStrictEqual(r.after_json, 'undefined');
  }
});

test('audit-log (c): a write that changes nothing produces zero audit rows (AUD-01 empty case)', () => {
  const dealId = registerDeal('Audit Deal C', 'karen');
  const before = auditHook.queryAudit({ dealId }).length;
  runAsDeal(dealId, 'karen', 'hrbp', () => {
    const db = store.readDb();
    store.writeDb(db); // no mutation at all
  });
  const after = auditHook.queryAudit({ dealId }).length;
  assert.strictEqual(after, before, 'an unchanged write must produce zero new audit rows');
});

test('audit-log (d) adjacency: two writes to the same row inside one write batch window produce two distinct, retrievable rows', () => {
  const dealId = registerDeal('Audit Deal D', 'karen');
  const rowId = randId('alert_adj');
  runAsDeal(dealId, 'karen', 'hrbp', () => {
    const db = store.readDb();
    db.alerts = db.alerts.concat([{ id: rowId, title: 'v1', severity: 'low' }]);
    store.writeDb(db);
  });
  runAsDeal(dealId, 'karen', 'hrbp', () => {
    const db = store.readDb();
    const idx = db.alerts.findIndex((a) => a.id === rowId);
    db.alerts[idx] = { ...db.alerts[idx], severity: 'high' };
    store.writeDb(db);
  });
  const rows = auditHook.queryAudit({ dealId }).filter((r) => r.row_id === rowId);
  assert.strictEqual(rows.length, 2, 'two writes to the same row must never be merged into one audit row');
  assert.notStrictEqual(rows[0].id, rows[1].id, 'the two rows must be distinguished by distinct autoincrement ids');
});

test('audit-log (e) ordering: rows from one write batch share a timestamp and read back in stable autoincrement-id order', () => {
  const dealId = registerDeal('Audit Deal E', 'karen');
  const ids = [randId('a'), randId('b'), randId('c')];
  runAsDeal(dealId, 'karen', 'hrbp', () => {
    const db = store.readDb();
    db.alerts = db.alerts.concat(ids.map((id) => ({ id, title: 'batch', severity: 'low' })));
    store.writeDb(db);
  });
  const first = auditHook.queryAudit({ dealId }).filter((r) => ids.includes(r.row_id));
  assert.strictEqual(first.length, 3);
  const tsSet = new Set(first.map((r) => r.ts));
  assert.strictEqual(tsSet.size, 1, 'rows from one write batch must share exactly one timestamp');
  // WR-01: queryAudit() orders DESCENDING (most-recent-first) so the default,
  // offset=0 page an admin sees first is the newest activity, not the oldest.
  const idsInIdOrder = [...first].sort((a, b) => b.id - a.id).map((r) => r.id);
  assert.deepStrictEqual(first.map((r) => r.id), idsInIdOrder, 'queryAudit must return rows in descending (most-recent-first) autoincrement-id order');

  const second = auditHook.queryAudit({ dealId }).filter((r) => ids.includes(r.row_id));
  assert.deepStrictEqual(second.map((r) => r.id), first.map((r) => r.id), 'repeated queries must return the SAME stable order');
});

test('audit-log (e2) WR-01: the default first page (limit, no offset) surfaces the MOST RECENT rows, not the oldest', () => {
  // Ten writes, each to its OWN freshly-registered deal (empty alerts array),
  // so every write is genuinely-new-row-only (exactly one insert delta, no
  // "already in this write's own snapshot -> unconditional update" deltas
  // from revisiting earlier rows in a shared array — see writeDb()'s own
  // per-item merge rule doc comment in db/store.js). A unique actor
  // ('pageuser', used nowhere else in this file) isolates this test's rows
  // without needing a before/after baseline subtraction.
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const dealId = registerDeal('Audit Page Deal ' + i, 'pageuser');
    const id = randId('page' + i);
    ids.push(id);
    runAsDeal(dealId, 'pageuser', 'hrbp', () => {
      const db = store.readDb();
      db.alerts = db.alerts.concat([{ id, title: 'page test ' + i, severity: 'low' }]);
      store.writeDb(db);
    });
  }

  const allRows = auditHook.queryAudit({ actor: 'pageuser', limit: 500 });
  assert.strictEqual(allRows.length, 10, 'each of the 10 writes must produce exactly one audit row (no accidental update-noise from a shared array)');
  const allIdsDescending = [...allRows].sort((a, b) => b.id - a.id).map((r) => r.id);
  const highestFiveIds = allIdsDescending.slice(0, 5);
  const lowestFiveIds = allIdsDescending.slice(5);

  // A small "first page" (offset=0) must contain the highest-id (most
  // recent) rows first, matching allIdsDescending exactly — proving the API
  // itself, not just a client-side reverse(), now returns most-recent-first
  // (the pre-fix bug: ASC ordering meant offset=0 returned the OLDEST rows).
  const firstPage = auditHook.queryAudit({ actor: 'pageuser', limit: 5 });
  assert.deepStrictEqual(firstPage.map((r) => r.id), highestFiveIds, 'the default (offset=0) page must contain the most recent rows, not the oldest');

  const secondPage = auditHook.queryAudit({ actor: 'pageuser', limit: 5, offset: 5 });
  assert.deepStrictEqual(secondPage.map((r) => r.id), lowestFiveIds, 'increasing the offset ("Older →") must move toward OLDER rows');
});

test('audit-log (f): the same mutations performed against demo.db produce zero audit rows (D-08)', () => {
  const before = auditHook.queryAudit({ limit: 500 }).length;
  runAsDemo(() => {
    const db = store.readDb();
    db.alerts = db.alerts.concat([{ id: randId('alert_demo'), title: 'demo write', severity: 'low' }]);
    store.writeDb(db);
  });
  const after = auditHook.queryAudit({ limit: 500 }).length;
  assert.strictEqual(after, before, 'a demo write must never produce an audit row, regardless of how many rows changed');
});

test('audit-log (g) AUD-02: deleting a deal (mirroring the Plan 04 delete route) leaves every one of its audit rows present and readable', () => {
  const dealId = registerDeal('Audit Deal G', 'karen');
  runAsDeal(dealId, 'karen', 'hrbp', () => {
    const db = store.readDb();
    db.alerts = db.alerts.concat([{ id: randId('alert_survive'), title: 'survive', severity: 'low' }]);
    store.writeDb(db);
  });
  const before = auditHook.queryAudit({ dealId });
  assert.ok(before.length > 0, 'precondition: the deal must have at least one audit row before deletion');

  // Mirrors server.js's DELETE /api/admin/deals/:id handler exactly (Plan 04):
  // release bound sessions, then controlStore.deleteDeal() — which holds NO
  // reference to audit.db anywhere in its body (see its own header comment).
  const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
  sessionsDb.releaseSessionsForDeal(runtimeConn, dealId);
  controlStore.deleteDeal(dealId);

  assert.ok(!fs.existsSync(dbFiles.dealDbPath(dealId)), 'precondition: the deal\'s own database file must be gone after delete');
  const after = auditHook.queryAudit({ dealId });
  assert.strictEqual(after.length, before.length, 'every audit row describing the deleted deal must remain readable (AUD-02)');
  assert.deepStrictEqual(after.map((r) => r.id), before.map((r) => r.id));
});

test('audit-log (h): a write resolved to an audited context with no attributed actor throws rather than writing an anonymous row', () => {
  const dealId = registerDeal('Audit Deal H', 'karen');
  const fakeReq = { baseUrl: '/api', path: '/whatever', portalUser: { username: 'karen', role: 'hrbp', dealId } };
  const resolved = resolver.resolveDatabase(fakeReq);
  const conn = store.getOrOpenConnection(resolved.dbPath, resolved.schemaPath);

  const before = auditHook.queryAudit({ dealId }).length;
  assert.throws(
    () => {
      store.runWithDb({ conn, kind: resolved.kind, dealId: resolved.dealId, dbPath: resolved.dbPath, actor: null, request: null }, () => {
        const db = store.readDb();
        db.alerts = db.alerts.concat([{ id: randId('alert_noactor'), title: 'no actor', severity: 'low' }]);
        store.writeDb(db);
      });
    },
    /no attributed actor|D-11/,
    'writeDb() must throw when an audited context resolves with no actor, rather than logging an anonymous row'
  );
  const after = auditHook.queryAudit({ dealId }).length;
  assert.strictEqual(after, before, 'the throw must happen before any anonymous audit row is written');
});
