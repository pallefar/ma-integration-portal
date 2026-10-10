// ISO-01 / AUD-02: proves the four new database kinds (control, runtime,
// audit, deal) all open through db/dbFiles.js's shared openDbFile() contract
// with the Phase-1 pragma set, apply their schema idempotently, round-trip a
// row, and — for audit_log specifically — cannot be UPDATEd or DELETEd.
//
// node:test — Node's built-in runner, zero new dependency. Run via
// `node --test test/db-file-layout.test.js` (bare `node --test test/` does
// NOT work on this project's target Node version — see
// test/concurrent-write.test.js's header for the same note).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const dbFiles = require('../db/dbFiles.js');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-db-file-layout-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}

function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

const KINDS = [
  { label: 'control', schemaPath: dbFiles.CONTROL_SCHEMA_PATH },
  { label: 'runtime', schemaPath: dbFiles.RUNTIME_SCHEMA_PATH },
  { label: 'audit', schemaPath: dbFiles.AUDIT_SCHEMA_PATH },
  { label: 'deal', schemaPath: dbFiles.DEAL_SCHEMA_PATH },
];

test('db-file-layout: all four db kinds open with the Phase-1 pragma contract', () => {
  for (const { label, schemaPath } of KINDS) {
    const dbPath = tempDbPath(`pragma-${label}`);
    try {
      const conn = dbFiles.openDbFile(dbPath, schemaPath);
      try {
        assert.strictEqual(conn.pragma('journal_mode', { simple: true }), 'wal', `${label}: journal_mode must be WAL`);
        // 12-REVIEW WR-01: the audit family commits with synchronous=FULL (2) so
        // an audit row is durable before its deal write; every other kind
        // keeps the Phase-1 NORMAL (1).
        const wantSync = label === 'audit' ? 2 : 1;
        assert.strictEqual(conn.pragma('synchronous', { simple: true }), wantSync, `${label}: synchronous must be ${wantSync === 2 ? 'FULL (2)' : 'NORMAL (1)'}`);
        assert.strictEqual(conn.pragma('foreign_keys', { simple: true }), 1, `${label}: foreign_keys must be ON (1)`);
        // D-03/D-05/CONC-01 (Phase 8): busy_timeout is 1000ms as of Phase 8
        // (was 5000ms pre-Phase-8) — see db/dbFiles.js's file header.
        assert.strictEqual(conn.pragma('busy_timeout', { simple: true }), 1000, `${label}: busy_timeout must be 1000 (Phase 8)`);
      } finally {
        conn.close();
      }
    } finally {
      cleanupDbFile(dbPath);
    }
  }
});

test('db-file-layout: openDbFile() is idempotent — re-opening an existing file does not throw and leaves the table set unchanged', () => {
  const dbPath = tempDbPath('idempotent-control');
  try {
    const first = dbFiles.openDbFile(dbPath, dbFiles.CONTROL_SCHEMA_PATH);
    const tablesFirst = first.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
    first.close();

    const second = dbFiles.openDbFile(dbPath, dbFiles.CONTROL_SCHEMA_PATH);
    const tablesSecond = second.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
    second.close();

    assert.deepStrictEqual(tablesSecond, tablesFirst, 're-opening an existing db file must not change its table set');
  } finally {
    cleanupDbFile(dbPath);
  }
});

test('db-file-layout: a deals row round-trips through control.db with its members array intact', () => {
  const dbPath = tempDbPath('control-roundtrip');
  try {
    const conn = dbFiles.openDbFile(dbPath, dbFiles.CONTROL_SCHEMA_PATH);
    try {
      const deal = {
        id: 'deal_test123',
        name: 'Project Falcon',
        targetCompany: 'Acme Sensors Inc.',
        status: 'active',
        members: ['il_karsten', 'hrbp_jane'],
        createdBy: 'il_karsten',
        createdAt: new Date().toISOString(),
      };
      conn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, ?, ?, ?, ?)')
        .run(deal.id, null, 0, deal.status, JSON.stringify(deal));

      const row = conn.prepare('SELECT * FROM deals WHERE id = ?').get(deal.id);
      assert.ok(row, 'inserted deals row must be readable back');
      const roundTripped = JSON.parse(row.data);
      assert.deepStrictEqual(roundTripped.members, deal.members, 'members array must round-trip intact');
      assert.strictEqual(roundTripped.name, deal.name);
      assert.strictEqual(roundTripped.targetCompany, deal.targetCompany);
      assert.strictEqual(row.status, 'active', 'status metadata column must be populated for indexed filtering');
    } finally {
      conn.close();
    }
  } finally {
    cleanupDbFile(dbPath);
  }
});

test('db-file-layout: audit_log rows cannot be UPDATEd or DELETEd (append-only by construction, AUD-02)', () => {
  const dbPath = tempDbPath('audit-append-only');
  try {
    const conn = dbFiles.openDbFile(dbPath, dbFiles.AUDIT_SCHEMA_PATH);
    try {
      conn.prepare(
        `INSERT INTO audit_log (ts, actor_username, actor_role, deal_id, db_kind, action, collection, row_id, before_json, after_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(new Date().toISOString(), 'il_karsten', 'admin', 'deal_test123', 'deal', 'insert', 'employees', 'emp_1', null, JSON.stringify({ name: 'Jane Doe' }));

      const before = conn.prepare('SELECT COUNT(*) c FROM audit_log').get().c;
      assert.strictEqual(before, 1, 'one audit row must have been inserted');

      assert.throws(
        () => conn.prepare('UPDATE audit_log SET action = ? WHERE id = 1').run('tampered'),
        /append-only/i,
        'an UPDATE against audit_log must be rejected'
      );
      assert.throws(
        () => conn.prepare('DELETE FROM audit_log WHERE id = 1').run(),
        /append-only/i,
        'a DELETE against audit_log must be rejected'
      );

      const after = conn.prepare('SELECT COUNT(*) c FROM audit_log').get().c;
      assert.strictEqual(after, 1, 'the row must still be present after the rejected UPDATE and DELETE attempts');
      const row = conn.prepare('SELECT action FROM audit_log WHERE id = 1').get();
      assert.strictEqual(row.action, 'insert', 'the row content must be unchanged (the UPDATE must not have partially applied)');
    } finally {
      conn.close();
    }
  } finally {
    cleanupDbFile(dbPath);
  }
});

test('db-file-layout: dealDbPath() builds the expected path and rejects path-traversal / malformed ids', () => {
  const p = dbFiles.dealDbPath('deal_abc123');
  assert.ok(p.endsWith(path.join('deals', 'deal_abc123.db')), `dealDbPath() must place the file under deals/, got: ${p}`);
  assert.strictEqual(path.dirname(p), dbFiles.DEALS_DIR);

  for (const badId of ['../escape', 'deal_../../etc/passwd', 'deal_abc/123', 'not_a_deal_id', '', null, undefined]) {
    assert.throws(() => dbFiles.dealDbPath(badId), `dealDbPath(${JSON.stringify(badId)}) must throw`);
  }
});

test('db-file-layout: db/dbFiles.js exports every documented symbol', () => {
  for (const key of ['CONTROL_DB_PATH', 'RUNTIME_DB_PATH', 'AUDIT_DB_PATH', 'DEMO_DB_PATH', 'DEALS_DIR', 'dealDbPath', 'openDbFile']) {
    assert.notStrictEqual(dbFiles[key], undefined, `db/dbFiles.js must export ${key}`);
  }
});
