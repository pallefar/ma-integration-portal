// D-12-03 / D-12-04 (Phase 12, DATA-03 + DATA-04, plan 12-13): migration #1 of
// the audit family — the legacy single `audit.db` becomes
//
//   data/audit/<dealId>.db   per-deal hash-chained partitions (rows of deals that
//                            still exist in control.db),
//   data/audit/legacy.db     every other deal data row (its deal was deleted
//                            before the upgrade) — SEALED here: read-only 0400,
//                            SHA-256 recorded as a control event, never written
//                            again,
//   audit.db                 the CONTROL-PLANE log only, rebuilt hash-chained
//                            (genesis 'control') with original ids preserved.
//
// RUNS AT BOOT. server.js opens audit.db before listen() (`bootOpen('audit',…)`,
// 12-06 PD-27), so this runs outside any request and outside any deal write
// transaction; a throw here is a boot-time not-ready on /healthz (the runner
// records `migration-failed`), never a half-migrated file.
//
// WHICH ROWS MOVE (PD-22). A row moves iff `db_kind = 'deal' AND deal_id IS NOT
// NULL` — a writeDb() data delta. Everything else (deal lifecycle, grants, read
// audits, Phase 11 `access-denied`, CLI and token events) stays in audit.db with
// its deal_id.
//
// CRASH SAFETY / IDEMPOTENCY. The runner takes a WAL-aware backup
// (`audit.db.pre-v1.bak`, 0600) first (`backup: true`). Partition files are
// written on their OWN connections and commit before audit.db does, so a crash
// between "partitions imported" and "audit.db committed" leaves audit.db at
// version 0 and the partitions populated. The next boot re-runs this module and
// it must not duplicate a row: every imported row carries `legacy_id` = its
// original id and rows are imported in id order, so a partition's
// MAX(legacy_id) is exactly the resume watermark — only rows with a greater
// original id are appended. After the import the partition's
// COUNT(legacy_id) = COUNT(DISTINCT legacy_id) = the number of source rows is
// ASSERTED, so a loss or a duplicate fails the migration instead of shipping.
//
// SEALED TARGETS ARE NEVER OPENED WRITABLE (checker W-4). For a target whose
// file already exists the watermark and the sealed state are read through
// dbFiles.openDbFileReadOnly(). The file is opened read-write ONLY when rows
// remain to be appended; a sealed target with rows remaining throws
// 'legacy-sealed-incomplete' (not-ready) instead of writing. Sealing the legacy
// partition is itself idempotent: db/auditLifecycle.js sealPartitionFile()
// reports an already sealed read-only file without opening it writable.
//
// ATOMIC SWAP. The new audit.db table is built, chained, verified and swapped in
// ONE transaction (the runner's BEGIN IMMEDIATE): old indexes and triggers are
// dropped, the table renamed aside, the v1 table created WITH its indexes and
// both append-only triggers (no trigger-less window is ever visible to another
// connection), control rows copied with their original ids, the `audit-migrated`
// (and legacy `audit-partition-sealed`) control events appended, both chains
// verified, the old table dropped — any throw rolls ALL of it back.
//
// The v1 DDL is FROZEN HERE (a released migration never changes — db/migrate.js
// authoring rule 2); db/audit-schema.sql is the live schema for fresh files and
// carries the same shape.

const fs = require('fs');
const dbFiles = require('../../dbFiles');
const auditChain = require('../../auditChain');
const auditLifecycle = require('../../auditLifecycle');

const ACTOR = Object.freeze({ username: 'system:migration', role: 'system' });
const BATCH_ROWS = 2000;
const MAX_PER_PARTITION_IN_EVENT = 200;

const V1_DDL = `
CREATE TABLE audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL,
  actor_username  TEXT NOT NULL,
  actor_role      TEXT NOT NULL,
  session_id      TEXT,
  deal_id         TEXT,
  db_kind         TEXT NOT NULL,
  action          TEXT NOT NULL,
  collection      TEXT,
  row_id          TEXT,
  before_json     TEXT,
  after_json      TEXT,
  request_method  TEXT,
  request_path    TEXT,
  ip              TEXT,
  legacy_id       INTEGER,
  prev_hash       TEXT,
  row_hash        TEXT
);
CREATE INDEX idx_audit_deal   ON audit_log(deal_id);
CREATE INDEX idx_audit_actor  ON audit_log(actor_username);
CREATE INDEX idx_audit_ts     ON audit_log(ts);
CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log rows are append-only: UPDATE is not permitted (AUD-02)');
END;
CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log rows are append-only: DELETE is not permitted (AUD-02)');
END;
`;

const INSERT_WITH_ID_SQL = `INSERT INTO audit_log
  (id, ts, actor_username, actor_role, session_id, deal_id, db_kind, action, collection, row_id, before_json, after_json,
   request_method, request_path, ip, legacy_id, prev_hash, row_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const COPIED_COLUMNS = Object.freeze([
  'ts', 'actor_username', 'actor_role', 'session_id', 'deal_id', 'db_kind', 'action', 'collection', 'row_id',
  'before_json', 'after_json', 'request_method', 'request_path', 'ip',
]);

function hasColumn(conn, table, column) {
  return conn.prepare(`PRAGMA table_info('${table}')`).all().some((c) => c.name === column);
}

/** Ids of every deal registered in control.db, read-only; a missing/unreadable control.db => none. */
function loadExistingDealIds() {
  const file = dbFiles.CONTROL_DB_PATH;
  const ids = new Set();
  if (!fs.existsSync(file)) return ids;
  let ro;
  try {
    ro = dbFiles.openDbFileReadOnly(file);
  } catch (e) {
    return ids;
  }
  try {
    for (const row of ro.prepare('SELECT id FROM deals').iterate()) ids.add(row.id);
  } catch (e) {
    if (!/no such table/i.test(String(e && e.message))) throw e;
  } finally {
    try { ro.close(); } catch (e) { /* ignore */ }
  }
  return ids;
}

function toEntry(row) {
  const entry = { legacy_id: row.id };
  for (const col of COPIED_COLUMNS) entry[col] = row[col];
  return entry;
}

const COUNT_SQL = 'SELECT COUNT(legacy_id) AS n, COUNT(DISTINCT legacy_id) AS d FROM audit_log';

/**
 * Import the rows `makeIterator(watermark)` yields (source rows with original id
 * greater than the watermark, id order) into partition `partitionId`, then
 * ASSERT that the partition holds each of the `expected` source rows exactly
 * once (COUNT(legacy_id) = COUNT(DISTINCT legacy_id) = expected) — a loss or a
 * duplicate fails the migration instead of shipping. The assertion reads the
 * connection already open (or the read-only probe when nothing was appended),
 * so no extra open — and no stray -shm/-wal sidecar — is made per partition.
 * Returns `{ imported, watermark }`.
 */
function importPartition(partitionId, makeIterator, expected) {
  const file = dbFiles.auditPartitionPath(partitionId);
  let watermark = 0;
  let sealed = false;
  let probeCounts = { n: 0, d: 0 };
  if (fs.existsSync(file)) {
    // W-4: a possibly sealed 0400 file is only ever probed read-only here.
    const ro = dbFiles.openDbFileReadOnly(file);
    try {
      const m = ro.prepare('SELECT MAX(legacy_id) AS m FROM audit_log').get();
      const last = ro.prepare('SELECT action FROM audit_log ORDER BY id DESC LIMIT 1').get();
      probeCounts = ro.prepare(COUNT_SQL).get();
      watermark = m && m.m ? Number(m.m) : 0;
      sealed = !!last && last.action === auditChain.SEAL_ACTION;
    } catch (e) {
      if (!/no such table/i.test(String(e && e.message))) throw e; // an empty shell of a crashed create
    } finally {
      try { ro.close(); } catch (e) { /* ignore */ }
    }
  }

  let rw = null;
  let batch = [];
  let imported = 0;
  const flush = () => {
    if (batch.length === 0) return;
    auditChain.appendChained(rw, batch, { partitionId });
    imported += batch.length;
    batch = [];
  };
  try {
    for (const row of makeIterator(watermark)) {
      if (!rw) {
        if (sealed) throw new Error('legacy-sealed-incomplete');
        rw = dbFiles.openDbFile(file, dbFiles.AUDIT_PARTITION_SCHEMA_PATH);
      }
      batch.push(toEntry(row));
      if (batch.length >= BATCH_ROWS) flush();
    }
    flush();
    let counts = probeCounts;
    if (rw) {
      const verdict = auditChain.verifyChain(rw, partitionId);
      if (!verdict.ok) throw new Error(`audit partition chain failed verification after import (${verdict.reason})`);
      counts = rw.prepare(COUNT_SQL).get();
    }
    if (counts.n !== expected || counts.d !== expected) {
      throw new Error(`audit partition holds ${counts.n} imported rows (${counts.d} distinct), expected ${expected}`);
    }
  } finally {
    if (rw) { try { rw.close(); } catch (e) { /* ignore */ } }
  }
  return { imported, watermark };
}

function up(conn) {
  // Defensive: a file that already carries the hash columns is already v1-shaped.
  if (hasColumn(conn, 'audit_log', 'row_hash')) return;

  const failAt = process.env.MA_MODE === 'real' ? '' : (process.env.MA_TEST_AUDIT_MIGRATION_FAIL_AT || '');
  const existing = loadExistingDealIds();
  const now = new Date().toISOString();

  // --- classify ----------------------------------------------------------
  const perDeal = new Map(); // deal_id -> source row count (movable rows only)
  for (const r of conn.prepare(
    "SELECT deal_id, COUNT(*) AS n FROM audit_log WHERE db_kind = 'deal' AND deal_id IS NOT NULL GROUP BY deal_id"
  ).iterate()) {
    perDeal.set(r.deal_id, r.n);
  }
  const ownDeals = [...perDeal.keys()].filter((id) => dbFiles.DEAL_ID_RE.test(id) && existing.has(id)).sort();
  const ownSet = new Set(ownDeals);
  let legacyExpected = 0;
  for (const [id, n] of perDeal) if (!ownSet.has(id)) legacyExpected += n;

  // --- import into partitions (each commits on its own connection) --------
  const moved = {};
  const dealRows = conn.prepare(
    "SELECT * FROM audit_log WHERE db_kind = 'deal' AND deal_id = ? AND id > ? ORDER BY id"
  );
  for (const dealId of ownDeals) {
    importPartition(dealId, (watermark) => dealRows.iterate(dealId, watermark), perDeal.get(dealId));
    moved[dealId] = perDeal.get(dealId);
  }

  let legacyRows = 0;
  if (legacyExpected > 0) {
    const legacySelect = conn.prepare(
      "SELECT * FROM audit_log WHERE db_kind = 'deal' AND deal_id IS NOT NULL AND id > ? ORDER BY id"
    );
    importPartition('legacy', function* legacyRowsAfter(watermark) {
      for (const row of legacySelect.iterate(watermark)) {
        if (!ownSet.has(row.deal_id)) yield row;
      }
    }, legacyExpected);
    legacyRows = legacyExpected;
  }

  // --- seal the legacy partition -------------------------------------------
  let legacySeal = null;
  if (fs.existsSync(dbFiles.auditPartitionPath('legacy'))) {
    // Every connection of this migration to legacy.db is closed; an already
    // sealed read-only file is reported without ever being opened writable.
    // A 'checkpoint-busy' refusal propagates: not-ready, never a half-seal.
    legacySeal = auditLifecycle.sealPartitionFile('legacy', { actor: ACTOR, ts: now });
  }

  if (failAt === 'rebuild') {
    throw new Error('MA_TEST_AUDIT_MIGRATION_FAIL_AT=rebuild');
  }

  // --- rebuild audit.db as the chained control-plane log -------------------
  const oldSeqRow = conn.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'audit_log'").get();
  const oldSeq = oldSeqRow ? Number(oldSeqRow.seq) : 0;
  const sourceRows = conn.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;

  conn.exec('DROP TRIGGER IF EXISTS audit_log_no_update');
  conn.exec('DROP TRIGGER IF EXISTS audit_log_no_delete');
  conn.exec('DROP INDEX IF EXISTS idx_audit_deal');
  conn.exec('DROP INDEX IF EXISTS idx_audit_actor');
  conn.exec('DROP INDEX IF EXISTS idx_audit_ts');
  conn.exec('ALTER TABLE audit_log RENAME TO audit_log_v0');
  conn.exec(V1_DDL);

  const insert = conn.prepare(INSERT_WITH_ID_SQL);
  // Paged by id (an open iterator would make this connection "busy" for the
  // inserts, and a page bounds memory however large the control log is).
  const controlPage = conn.prepare(
    "SELECT * FROM audit_log_v0 WHERE id > ? AND NOT (db_kind = 'deal' AND deal_id IS NOT NULL) ORDER BY id LIMIT 1000"
  );
  let prev = auditChain.genesisHash('control');
  let controlRows = 0;
  let lastId = 0;
  for (;;) {
    const page = controlPage.all(lastId);
    if (page.length === 0) break;
    for (const row of page) {
      const stored = { legacy_id: null };
      for (const col of COPIED_COLUMNS) stored[col] = row[col] === undefined ? null : row[col];
      const hash = auditChain.rowHash(stored, prev);
      insert.run(
        row.id, stored.ts, stored.actor_username, stored.actor_role, stored.session_id, stored.deal_id, stored.db_kind,
        stored.action, stored.collection, stored.row_id, stored.before_json, stored.after_json,
        stored.request_method, stored.request_path, stored.ip, null, prev, hash
      );
      prev = hash;
      controlRows += 1;
      lastId = row.id;
    }
  }

  const totalMoved = Object.values(moved).reduce((a, b) => a + b, 0) + legacyRows;
  if (controlRows + totalMoved !== sourceRows) {
    throw new Error(`audit migration row accounting failed: ${controlRows} control + ${totalMoved} moved != ${sourceRows} source rows`);
  }

  // ids are never reused: the sequence continues from the old file's high-water mark.
  const cur = conn.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'audit_log'").get();
  if (!cur) conn.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('audit_log', ?)").run(oldSeq);
  else if (Number(cur.seq) < oldSeq) conn.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'audit_log'").run(oldSeq);

  const perPartition = Object.keys(moved).length <= MAX_PER_PARTITION_IN_EVENT ? moved : undefined;
  const events = [{
    ts: now, actor_username: ACTOR.username, actor_role: ACTOR.role, session_id: null, deal_id: null, db_kind: 'control',
    action: 'audit-migrated', collection: null, row_id: null, before_json: null,
    after_json: JSON.stringify({
      migration: '001-partition-legacy',
      sourceRows,
      controlRows,
      movedRows: totalMoved,
      partitions: ownDeals.length,
      legacyRows,
      perPartition,
    }),
    request_method: 'MIGRATION', request_path: '001-partition-legacy', ip: null,
  }];
  if (legacySeal) {
    events.push({
      ts: now, actor_username: ACTOR.username, actor_role: ACTOR.role, session_id: null, deal_id: 'legacy', db_kind: 'control',
      action: 'audit-partition-sealed', collection: null, row_id: 'legacy', before_json: null,
      after_json: JSON.stringify({ sha256: legacySeal.sha256, rows: legacySeal.rows, headHash: legacySeal.headHash }),
      request_method: 'MIGRATION', request_path: '001-partition-legacy', ip: null,
    });
  }
  // The table is `audit_log` again, so the shared chained append (inside the
  // runner's transaction -> a savepoint) continues the chain from the last hash.
  auditChain.appendChained(conn, events, { partitionId: 'control' });

  const verdict = auditChain.verifyChain(conn, 'control');
  if (!verdict.ok) throw new Error(`audit.db chain failed verification after rebuild (${verdict.reason})`);
  conn.exec('DROP TABLE audit_log_v0');
}

module.exports = {
  id: 1,
  slug: 'partition-legacy',
  backup: true,
  requiredTables: ['audit_log'],
  up,
};
