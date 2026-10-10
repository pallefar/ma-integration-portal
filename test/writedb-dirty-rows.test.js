// D-12-01 / DATA-01 (Phase 12, plan 12-02): store-level proof that db/store.js's
// writeDb() makes writes — and the audit trail — proportional to what CHANGED:
//
//   - one changed row  -> exactly one audit row, the other rows untouched
//   - nothing changed  -> zero audit rows, zero UPDATEs
//   - a pure reorder   -> persisted (next readDb() returns the new order) with
//                         zero audit rows and no `data` blob rewritten
//   - an untouched row is never UPDATEd, so another writer's committed change
//     to it survives this writer's unrelated write (no clobber, no 409)
//   - a row a concurrent writer already deleted is a CR-02 no-op: not
//     resurrected and not audited
//   - a second writeDb() on the same readDb() object only writes/audits NEW
//     changes; a rolled-back write never mutates the caller's baseline
//
// Audit rows are counted ONLY through db/auditHook.js's public query API —
// never raw SQL on audit.db — so plan 12-08 (per-deal audit partitions) can move
// the rows without this suite needing an edit.
//
// Temp trio + runAsDeal pattern from test/audit-log.test.js; the
// untouched-never-clobbers cases use a SECOND better-sqlite3 connection to the
// same deal file (the cross-process stand-in test/concurrent-write.test.js
// style uses).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-writedb-dirty-'));
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
const { isConflictError } = store;

store.getOrOpenConnection(dbFiles.DEMO_DB_PATH, dbFiles.DEAL_SCHEMA_PATH);

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

let dealCounter = 0;
function registerDeal() {
  dealCounter += 1;
  const label = `Dirty Rows ${dealCounter}`;
  const deal = controlStore.createDeal({ name: label, targetCompany: label + ' Co', members: ['karen'], createdBy: 'admin' });
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal.id;
}

function dealCtx(dealId) {
  const fakeReq = { baseUrl: '/api', path: '/whatever', portalUser: { username: 'karen', role: 'hrbp', dealId, sessionId: 'sess_karen' } };
  const resolved = resolver.resolveDatabase(fakeReq);
  const conn = store.getOrOpenConnection(resolved.dbPath, resolved.schemaPath);
  return {
    dbPath: resolved.dbPath,
    context: {
      conn, kind: resolved.kind, dealId: resolved.dealId, dbPath: resolved.dbPath,
      actor: { username: 'karen', role: 'hrbp', sessionId: 'sess_karen' },
      request: { method: 'TEST', path: fakeReq.path, ip: null },
    },
  };
}

function runAsDeal(dealId, fn) {
  return store.runWithDb(dealCtx(dealId).context, fn);
}

function dealDbPath(dealId) { return dealCtx(dealId).dbPath; }

/** Every audit row for the deal, through the public query API only. */
function auditRows(dealId) {
  return auditHook.queryAudit({ dealId, limit: 500 });
}

/** Rows appended by `fn` — the audit rows whose id exceeds the high-water mark. */
function auditDelta(dealId, fn) {
  const mark = auditRows(dealId).reduce((m, r) => Math.max(m, r.id), 0);
  fn();
  return auditRows(dealId).filter((r) => r.id > mark);
}

/** Stored (seq, data) for every row of `key`, keyed by id — read straight from the deal file. */
function storedRows(dealId, key) {
  const conn = dealCtx(dealId).context.conn;
  const out = new Map();
  for (const r of conn.prepare(`SELECT id, seq, data FROM ${key} ORDER BY seq`).all()) out.set(r.id, { seq: r.seq, data: r.data });
  return out;
}

function mkAlert(i) { return { id: `al_${String(i).padStart(3, '0')}`, title: `Alert ${i}`, severity: 'low' }; }
function mkRaid(i) { return { id: `rd_${String(i).padStart(3, '0')}`, type: 'risk', title: `Risk ${i}`, severity: 'low', status: 'open' }; }

function seed(dealId, key, n, mk) {
  runAsDeal(dealId, () => {
    const db = store.readDb();
    db[key] = Array.from({ length: n }, (_, i) => mk(i));
    store.writeDb(db);
  });
}

// The two kinds: a non-versioned collection and a versioned (Phase 9) one.
const KINDS = [
  { label: 'non-versioned (alerts)', key: 'alerts', mk: mkAlert, versioned: false },
  { label: 'versioned (raidEntries)', key: 'raidEntries', mk: mkRaid, versioned: true },
];

for (const kind of KINDS) {
  test(`writedb-dirty-rows [${kind.label}]: changing one row of 50 appends exactly 1 audit row for that id and leaves the other 49 stored rows byte-identical`, () => {
    const dealId = registerDeal();
    seed(dealId, kind.key, 50, kind.mk);
    const storedBefore = storedRows(dealId, kind.key);
    const targetId = kind.mk(17).id;

    const rows = auditDelta(dealId, () => runAsDeal(dealId, () => {
      const db = store.readDb();
      const idx = db[kind.key].findIndex((r) => r.id === targetId);
      db[kind.key][idx] = { ...db[kind.key][idx], title: 'Changed title' };
      store.writeDb(db);
    }));

    assert.strictEqual(rows.length, 1, `one change must append exactly one audit row, got ${rows.length}`);
    assert.strictEqual(rows[0].action, 'update');
    assert.strictEqual(rows[0].row_id, targetId);
    assert.strictEqual(rows[0].collection, kind.key);

    const storedAfter = storedRows(dealId, kind.key);
    for (const [id, was] of storedBefore) {
      if (id === targetId) continue;
      assert.deepStrictEqual(storedAfter.get(id), was, `untouched row ${id} must be byte-identical (data and seq)`);
    }
    const changed = JSON.parse(storedAfter.get(targetId).data);
    assert.strictEqual(changed.title, 'Changed title');
    if (kind.versioned) assert.strictEqual(changed.version, 1, 'a changed versioned row goes 0 -> 1 (Phase 9 stamp unchanged)');
  });

  test(`writedb-dirty-rows [${kind.label}]: an unmodified readDb() -> writeDb() appends 0 audit rows and writes nothing`, () => {
    const dealId = registerDeal();
    seed(dealId, kind.key, 20, kind.mk);
    const storedBefore = storedRows(dealId, kind.key);

    const rows = auditDelta(dealId, () => runAsDeal(dealId, () => {
      const db = store.readDb();
      store.writeDb(db);
    }));

    assert.strictEqual(rows.length, 0, 'a write that changed nothing must produce zero audit rows');
    assert.deepStrictEqual([...storedRows(dealId, kind.key)], [...storedBefore], 'no row may be rewritten');
  });

  test(`writedb-dirty-rows [${kind.label}]: a pure reorder persists the new order with 0 audit rows and no data blob rewritten`, () => {
    const dealId = registerDeal();
    seed(dealId, kind.key, 10, kind.mk);
    const storedBefore = storedRows(dealId, kind.key);
    const reversedIds = [...storedBefore.keys()].reverse();

    const rows = auditDelta(dealId, () => runAsDeal(dealId, () => {
      const db = store.readDb();
      db[kind.key] = [...db[kind.key]].reverse();
      store.writeDb(db);
    }));

    assert.strictEqual(rows.length, 0, 'a reorder is not a content change — zero audit rows');
    const after = runAsDeal(dealId, () => store.readDb());
    assert.deepStrictEqual(after[kind.key].map((r) => r.id), reversedIds, 'the new order must persist (CR-01)');
    const storedAfter = storedRows(dealId, kind.key);
    for (const [id, was] of storedBefore) {
      assert.strictEqual(storedAfter.get(id).data, was.data, `row ${id}: data text (and version) must be byte-identical after a reorder`);
    }
  });

  test(`writedb-dirty-rows [${kind.label}]: a non-tail insert is audited once, trailing rows keep their order and get 0 audit rows`, () => {
    const dealId = registerDeal();
    seed(dealId, kind.key, 8, kind.mk);
    const storedBefore = storedRows(dealId, kind.key);
    const orderBefore = [...storedBefore.keys()];
    const newRow = kind.mk(99);

    const rows = auditDelta(dealId, () => runAsDeal(dealId, () => {
      const db = store.readDb();
      db[kind.key] = [...db[kind.key].slice(0, 3), newRow, ...db[kind.key].slice(3)];
      store.writeDb(db);
    }));

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].action, 'insert');
    assert.strictEqual(rows[0].row_id, newRow.id);

    const after = runAsDeal(dealId, () => store.readDb());
    assert.deepStrictEqual(
      after[kind.key].map((r) => r.id),
      [...orderBefore.slice(0, 3), newRow.id, ...orderBefore.slice(3)],
      'the inserted row sits at index 3 and every trailing row keeps its relative order'
    );
    const storedAfter = storedRows(dealId, kind.key);
    for (const [id, was] of storedBefore) {
      assert.strictEqual(storedAfter.get(id).data, was.data, `trailing row ${id} data must be byte-identical`);
    }
  });

  test(`writedb-dirty-rows [${kind.label}]: an untouched row never clobbers another writer's committed change to it`, () => {
    const dealId = registerDeal();
    seed(dealId, kind.key, 5, kind.mk);
    const rId = kind.mk(1).id;
    const sId = kind.mk(3).id;

    // Writer A reads first.
    const a = runAsDeal(dealId, () => store.readDb());

    // Writer B (a second connection to the same file) commits a change to r.
    const other = new Database(dealDbPath(dealId));
    other.pragma('busy_timeout = 5000');
    let bContent;
    try {
      const raw = other.prepare(`SELECT data FROM ${kind.key} WHERE id = ?`).get(rId).data;
      const obj = JSON.parse(raw);
      obj.title = 'B changed this';
      if (kind.versioned) obj.version = 7;
      bContent = JSON.stringify(obj);
      other.prepare(`UPDATE ${kind.key} SET data = ? WHERE id = ?`).run(bContent, rId);
    } finally {
      other.close();
    }

    // Writer A now makes an UNRELATED change to s and writes.
    const rows = auditDelta(dealId, () => runAsDeal(dealId, () => {
      const idx = a[kind.key].findIndex((r) => r.id === sId);
      a[kind.key][idx] = { ...a[kind.key][idx], title: 'A changed s' };
      assert.doesNotThrow(() => store.writeDb(a), 'A\'s unrelated write must succeed (no 409)');
    }));

    assert.strictEqual(rows.length, 1, 'only A\'s own change is audited');
    assert.strictEqual(rows[0].row_id, sId);
    const storedAfter = storedRows(dealId, kind.key);
    assert.strictEqual(storedAfter.get(rId).data, bContent, 'B\'s committed change to r (content and version) must survive A\'s write');
    assert.strictEqual(JSON.parse(storedAfter.get(sId).data).title, 'A changed s');
  });

  test(`writedb-dirty-rows [${kind.label}]: deleting a row a concurrent writer already deleted is a no-op — not resurrected, not audited`, () => {
    const dealId = registerDeal();
    seed(dealId, kind.key, 5, kind.mk);
    const xId = kind.mk(2).id;

    const a = runAsDeal(dealId, () => store.readDb());

    const other = new Database(dealDbPath(dealId));
    other.pragma('busy_timeout = 5000');
    try { other.prepare(`DELETE FROM ${kind.key} WHERE id = ?`).run(xId); } finally { other.close(); }

    const rows = auditDelta(dealId, () => runAsDeal(dealId, () => {
      a[kind.key] = a[kind.key].filter((r) => r.id !== xId);
      assert.doesNotThrow(() => store.writeDb(a), 'the delete intent is already satisfied — not a conflict');
    }));

    assert.strictEqual(rows.length, 0, 'nothing was changed by this write, so nothing may be audited');
    assert.ok(!storedRows(dealId, kind.key).has(xId), 'the row stays deleted');
  });

  test(`writedb-dirty-rows [${kind.label}]: two writeDb() calls on one readDb() object — the second appends 0 rows and re-inserts nothing`, () => {
    const dealId = registerDeal();
    seed(dealId, kind.key, 4, kind.mk);
    const newRow = kind.mk(50);

    runAsDeal(dealId, () => {
      const db = store.readDb();
      const first = auditDelta(dealId, () => {
        db[kind.key] = [...db[kind.key], newRow];
        db[kind.key][0] = { ...db[kind.key][0], title: 'first-call change' };
        store.writeDb(db);
      });
      assert.strictEqual(first.length, 2, 'one insert + one update on the first call');

      const second = auditDelta(dealId, () => {
        assert.doesNotThrow(() => store.writeDb(db), 'a second call must not re-INSERT or self-conflict');
      });
      assert.strictEqual(second.length, 0, 'the second call, with no further change, appends 0 rows');

      const third = auditDelta(dealId, () => {
        db[kind.key][1] = { ...db[kind.key][1], title: 'second-call change' };
        store.writeDb(db);
      });
      assert.strictEqual(third.length, 1, 'only the NEW change is written and audited');
      assert.strictEqual(third[0].row_id, kind.mk(1).id);
    });
  });
}

test('writedb-dirty-rows: a rolled-back write (version conflict) leaves the caller\'s baseline and the audit trail untouched', () => {
  const dealId = registerDeal();
  seed(dealId, 'raidEntries', 4, mkRaid);
  const rId = mkRaid(2).id;

  const a = runAsDeal(dealId, () => store.readDb());
  const other = new Database(dealDbPath(dealId));
  other.pragma('busy_timeout = 5000');
  try {
    const obj = JSON.parse(other.prepare('SELECT data FROM raidEntries WHERE id = ?').get(rId).data);
    obj.title = 'B won'; obj.version = 1;
    other.prepare('UPDATE raidEntries SET data = ? WHERE id = ?').run(JSON.stringify(obj), rId);
  } finally {
    other.close();
  }

  const newRow = mkRaid(77);
  const snapshotBefore = new Map(a.__snapshot.raidEntries);
  const rows = auditDelta(dealId, () => runAsDeal(dealId, () => {
    // The insert is placed BEFORE the conflicting row, so it has already been
    // executed inside the transaction when the conflict throws.
    a.raidEntries = [newRow, ...a.raidEntries.map((r) => (r.id === rId ? { ...r, title: 'A stale edit' } : r))];
    assert.throws(() => store.writeDb(a), (err) => isConflictError(err));
  }));

  assert.strictEqual(rows.length, 0, 'a rolled-back write appends no audit rows');
  assert.ok(!storedRows(dealId, 'raidEntries').has(newRow.id), 'the insert must have rolled back');
  assert.deepStrictEqual([...a.__snapshot.raidEntries], [...snapshotBefore], 'the caller\'s snapshot baseline must not be mutated by a rolled-back write');
});

test('writedb-dirty-rows: __seq is a non-enumerable sibling of __snapshot — never leaks into serialized responses', () => {
  const dealId = registerDeal();
  seed(dealId, 'alerts', 3, mkAlert);
  const db = runAsDeal(dealId, () => store.readDb());
  assert.ok(!Object.keys(db).includes('__seq'));
  assert.ok(!JSON.stringify(db).includes('__seq'));
  assert.ok(db.__seq && db.__seq.alerts instanceof Map);
  assert.ok(db.__snapshot.alerts instanceof Map, '__snapshot keeps its id -> raw Map shape');
});

test('writedb-dirty-rows: an object carrying __snapshot but no __seq still persists a reorder (position unknown -> conservative re-seq)', () => {
  const dealId = registerDeal();
  seed(dealId, 'alerts', 5, mkAlert);
  const db = runAsDeal(dealId, () => store.readDb());
  const bare = {};
  for (const k of Object.keys(db)) bare[k] = db[k];
  Object.defineProperty(bare, '__snapshot', { value: db.__snapshot, enumerable: false, configurable: true });
  bare.alerts = [...bare.alerts].reverse();
  const rows = auditDelta(dealId, () => runAsDeal(dealId, () => store.writeDb(bare)));
  assert.strictEqual(rows.length, 0);
  const after = runAsDeal(dealId, () => store.readDb());
  assert.deepStrictEqual(after.alerts.map((r) => r.id), ['al_004', 'al_003', 'al_002', 'al_001', 'al_000']);
});
