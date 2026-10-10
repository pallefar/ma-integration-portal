// AUD-01 / AUD-02 / D-08 / D-09 / D-11: store-layer audit hook — the
// compliance record for every write that lands in a real deal database, plus
// explicit control-plane security events (deal lifecycle, membership, user
// credential changes, session revocations, break-glass token use). D-09's
// checkpoint (location + mechanism + best-effort semantics) was approved
// as-specified by the user, 2026-08-01.
//
// WHY a store-layer hook, not SQLite triggers with a cross-database link:
// 03-RESEARCH.md verified against sqlite.org/lang_attach.html that a
// WAL-mode database gives NO cross-file atomicity even when one connection
// links two database files together — a trigger firing across that link
// commits no more atomically than two independent connections writing to two
// separate files. Since such a trigger would ALSO need per-connection
// link-setup bookkeeping and a SQL-side actor-context table to smuggle "who
// made this write" into a trigger body (there is no SQL-native channel for
// it), this store-layer hook — which reuses the before/after values
// db/store.js's writeDb() already computes, and has the actor as an
// in-memory JS value at the point of the call — gives the SAME atomicity
// guarantee with far less moving parts. See 03-RESEARCH.md "## Pattern 3"
// for the full comparison.
//
// WHY best-effort, not two-phase commit: the audit row for a deal write is
// written ONLY after db/store.js's own transaction has committed — a
// rolled-back write never produces an audit row (never audit a write that
// did not happen). A crash in the narrow window between the two commits can
// lose that ONE audit entry while the underlying write still lands; this is
// the accepted trade-off for this milestone (D-09's own checkpoint context)
// — tamper-evidence and hash-chaining are explicitly deferred to the
// shared-host milestone (v2). What this module DOES guarantee: an audit
// write that itself throws is NEVER swallowed — db/store.js's writeDb()
// lets it propagate, so a silently-missing entry can never look like an
// action that never happened.
//
// WHY an independent second connection, never a cross-database link: this
// module holds its OWN lazily-opened handle to audit.db (via
// db/dbFiles.js's openDbFile(), NOT db/store.js's getOrOpenConnection()
// cache — requiring db/store.js here would be circular, since db/store.js
// requires this module). No deal-file connection is ever linked to
// audit.db, and no deal-file connection ever touches audit.db directly —
// the ONLY path into audit.db is through this module's own connection. This
// file must never contain the literal SQL keyword that names that
// cross-database link mechanism (verified by test/audit-log.test.js's own
// source-grep acceptance criterion).
//
// PHASE 12 (D-12-04) — PER-DEAL PARTITIONS. Deal data deltas no longer go to
// the one shared audit.db: appendWriteAudit() routes a `deal`-kind write to the
// deal's own hash-chained partition file (data/audit/<dealId>.db, see
// db/auditChain.js for the chain and db/dbFiles.js AUDIT_DIR for the location),
// still as the final step inside the deal's `.immediate` transaction on the
// partition's OWN connection — the Phase 8 CR-01 atomicity contract is
// unchanged. audit.db keeps every recordSecurityEvent() row (lifecycle, grants,
// reads, `access-denied`) with its deal_id. queryAudit()/countAudit() read both.
// The "tamper-evidence deferred" remark above is superseded for deal data: a
// partition's chain makes an edited, deleted or reordered row detectable
// (scripts/audit-verify.js); chaining audit.db itself is plan 12-13.

const fs = require('fs');
const path = require('path');
const dbFiles = require('./dbFiles');
const auditChain = require('./auditChain');
const readiness = require('./readiness');

// D-08: which resolved db/resolver.js `kind` values are audited via
// db/store.js's writeDb() hook. 'demo' is deliberately excluded (demo writes
// carry no compliance value and must not pay the audit-write cost). 'control'
// is included per this plan's own naming, even though — as of this phase —
// no control-plane route calls writeDb() (they all go through
// db/controlStore.js's direct-SQL accessor instead, see its own header); if
// a future control-plane write path is ever routed through writeDb(), it is
// audited by construction rather than silently falling through this list.
const AUDITED_DB_KINDS = new Set(['deal', 'control']);

let auditConn = null;

// D-12-04: one cached read-write connection per deal partition, owned by THIS
// module exactly like auditConn (never db/store.js's cache — that would be a
// circular require). partitionId -> better-sqlite3 connection.
const partitionConns = new Map();

/**
 * Lazily open (or reuse) THIS module's own connection to audit.db —
 * independent of db/store.js's connection cache (see header). Safe to call
 * repeatedly; always returns the SAME handle for the process lifetime.
 */
function getAuditConnection() {
  if (!auditConn) {
    auditConn = dbFiles.openDbFile(dbFiles.AUDIT_DB_PATH, dbFiles.AUDIT_SCHEMA_PATH);
  }
  return auditConn;
}

/**
 * D-12-04 / PD-29: true once getAuditConnection() has succeeded in this
 * process (false again after closeAuditConnection()). db/store.js's writeDb()
 * opens audit.db BEFORE its transaction so a partition append can rely on
 * audit.db already being open.
 */
function isAuditOpen() {
  return auditConn !== null;
}

/**
 * Test-only teardown: close and drop the cached connection so a fresh test
 * file gets a fresh handle to its own temp audit.db, mirroring
 * db/store.js's closeAllConnections() test-only export. Partition handles are
 * dropped with it (they are only valid while audit.db is open — PD-29).
 */
function closeAuditConnection() {
  for (const id of [...partitionConns.keys()]) closePartitionConnection(id);
  if (auditConn) {
    try { auditConn.close(); } catch (e) { /* ignore */ }
    auditConn = null;
  }
}

/**
 * D-12-04: the cached read-write connection of one deal's audit partition,
 * created (0600 file in a 0700 directory, hash-chain schema, stamped at the
 * family's version) on first use.
 *
 * [security] PD-29 (checker B-1): this function is NEVER the first opener of
 * audit.db. Opening audit.db runs the audit family's migrations, and a first
 * open reached from here would run them nested INSIDE the deal's `.immediate`
 * transaction — a migration under the deal write lock. db/store.js's writeDb()
 * opens audit.db before BEGIN IMMEDIATE and the server opens it at boot, so in
 * every supported path it is already open; if it is not, that is an invariant
 * breach and this throws a DbNotReadyError (reason 'audit-not-open', NOT
 * recorded via markNotReady — it is not a file failure) WITHOUT creating any
 * file. The partition file itself may be first-opened inside the deal
 * transaction: lock order deal -> partition is the established order and the
 * partition family has only the stamp-only baseline.
 *
 * [security] T-12-74: a partition file exists only because an audited write in
 * a resolved deal context asked for it — auditPartitionPath() validates the id
 * (throws for anything but a deal id or `legacy`) before any path is built, and
 * recordSecurityEvent() never reaches this function.
 */
function getPartitionConnection(dealId) {
  if (!isAuditOpen()) {
    throw new readiness.DbNotReadyError({ family: 'audit', reason: 'audit-not-open' });
  }
  const cached = partitionConns.get(dealId);
  if (cached) return cached;
  const file = dbFiles.auditPartitionPath(dealId); // throws on a malformed id
  const conn = dbFiles.openDbFile(file, dbFiles.AUDIT_PARTITION_SCHEMA_PATH);
  partitionConns.set(dealId, conn);
  return conn;
}

/** Close and forget one partition connection (a no-op for an unknown id). */
function closePartitionConnection(dealId) {
  const conn = partitionConns.get(dealId);
  if (!conn) return;
  partitionConns.delete(dealId);
  try { conn.close(); } catch (e) { /* ignore */ }
}

const INSERT_SQL = `INSERT INTO audit_log
  (ts, actor_username, actor_role, session_id, deal_id, db_kind, action, collection, row_id, before_json, after_json, request_method, request_path, ip)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * D-11: write ONE batch of before/after row deltas for a single writeDb()
 * call, in ONE transaction on `conn` (the audit.db connection — never a
 * deal-file connection). `actor` is REQUIRED and must carry a non-empty
 * `username` — a caller with no resolved actor is a bug in the caller (an
 * audited write must never be attributed to nobody), so this throws rather
 * than silently defaulting to an anonymous row. An empty `rows` array is a
 * no-op — a write that changed nothing produces zero audit rows.
 */
function writeAuditBatch(conn, { actor, dealId, dbKind, request, ts, rows }) {
  if (!actor || !actor.username) {
    throw new Error('db/auditHook.js: writeAuditBatch() called with no resolved actor — refusing to write an anonymous audit row (D-11)');
  }
  if (!rows || rows.length === 0) return;

  // [security] D-10/D-03/CONC-01 (Phase 8): .immediate acquires audit.db's
  // write lock UP FRONT via BEGIN IMMEDIATE, mirroring db/store.js's own
  // writeDb() change in plan 08-01 — the same busy_timeout budget (db/dbFiles.js)
  // now governs this append too. A busy append that outlives the wait THROWS
  // and propagates uncaught (no try/catch is added here, deliberately — see
  // this file's own header no-swallow contract above) through writeDb()'s
  // existing no-swallow chain to server.js's central 503 middleware. This
  // must fail the WHOLE request rather than being queued, retried out-of-band,
  // or logged-and-continued: an acknowledged deal-data write with no audit
  // row would be an MNPI change with no compliance record.
  //
  // [security] CR-01 (Phase 8 review fix): this call now executes FROM
  // INSIDE the caller's own deal-level `.immediate` transaction (db/store.js's
  // writeDb(), as this function's own final step), not after that transaction
  // has already committed. This is what makes "failing the whole request is
  // safe for the client to retry" actually TRUE: a throw here propagates out
  // of the CALLER's transaction body before it commits, so better-sqlite3
  // rolls back the deal-level write too — a busy audit append can never leave
  // a committed-but-unaudited row behind. (The review found the OLD ordering
  // — dispatching this as a separate, later transaction after the caller's
  // write had already committed — meant a busy audit append here produced a
  // 503 for an already-committed write; the client's D-07 auto-retry then
  // re-ran the whole request and minted a brand-new id, silently duplicating
  // the row. "writeDb()'s snapshot-diff merge is idempotent" is true for two
  // calls sharing one snapshot within a single request — it does NOT hold
  // across an HTTP-level retry that re-executes application logic and mints
  // a fresh id, which is exactly what the old ordering allowed.) With the
  // append inside the caller's transaction, a 503 now truthfully means
  // "nothing persisted," so the 503-then-retry the client already performs
  // (D-07) costs nothing beyond the wait, and duplicates the row only if a
  // FRESH write, not a retry of an already-committed one.
  const insert = conn.prepare(INSERT_SQL);
  const runBatch = conn.transaction((entries) => {
    for (const row of entries) {
      insert.run(
        ts, actor.username, actor.role || null, actor.sessionId || null,
        dealId || null, dbKind || null, row.action, row.collection || null, row.rowId || null,
        row.before === undefined ? null : row.before,
        row.after === undefined ? null : row.after,
        (request && request.method) || null, (request && request.path) || null, (request && request.ip) || null
      );
    }
  }).immediate;
  runBatch(rows);
}

/**
 * D-12-04: the ONE entry point db/store.js's writeDb() uses for an audited
 * write's rows. Same actor-required contract as writeAuditBatch() (D-11).
 *
 *   dbKind 'deal'  -> the deal's own hash-chained partition (data/audit/<id>.db),
 *                     each row carrying deal_id = dealId;
 *   anything else  -> audit.db via writeAuditBatch(), unchanged.
 *
 * [security] PD-1 (the atomicity seam): for a deal the append is executed as
 * its OWN `BEGIN IMMEDIATE` on the partition's OWN connection — exactly the
 * Phase 8 CR-01 mechanism audit.db used, no cross-file link — and db/store.js
 * calls this as the FINAL statement inside the deal file's `.immediate`
 * transaction. Anything thrown here (SQLITE_BUSY*, a sealed partition, an I/O
 * error, an invalid deal id) propagates out of the deal transaction body before
 * the deal file commits, so the deal write rolls back too: a 503/409 still
 * means "nothing persisted" and the client's identical retry cannot duplicate a
 * row. Never wrapped in try/catch (no-swallow contract, see header). Lock
 * order is always deal file -> partition, with the partition innermost; seal
 * and migration take only partition/audit locks, so no wait cycle can form.
 */
function appendWriteAudit({ actor, dealId, dbKind, request, ts, rows }) {
  if (!actor || !actor.username) {
    throw new Error('db/auditHook.js: appendWriteAudit() called with no resolved actor — refusing to write an anonymous audit row (D-11)');
  }
  if (!rows || rows.length === 0) return;
  if (dbKind !== 'deal') {
    writeAuditBatch(getAuditConnection(), { actor, dealId, dbKind, request, ts, rows });
    return;
  }
  const conn = getPartitionConnection(dealId);
  const entries = rows.map((row) => ({
    ts,
    actor_username: actor.username,
    actor_role: actor.role || null,
    session_id: actor.sessionId || null,
    deal_id: dealId,
    db_kind: dbKind,
    action: row.action,
    collection: row.collection || null,
    row_id: row.rowId || null,
    before_json: row.before === undefined ? null : row.before,
    after_json: row.after === undefined ? null : row.after,
    request_method: (request && request.method) || null,
    request_path: (request && request.path) || null,
    ip: (request && request.ip) || null,
  }));
  auditChain.appendChained(conn, entries, { partitionId: dealId });
}

/**
 * D-08: write exactly ONE row for a named control-plane security event (deal
 * create/archive/delete, membership changes, password changes, session
 * revocations, break-glass token use). `before`/`after` may be any
 * JSON-serializable value (or omitted) — stringified here, never left as the
 * literal strings "null"/"undefined". Same actor-required contract as
 * writeAuditBatch() above — a security event with no resolved actor is
 * refused, never logged anonymously.
 */
function recordSecurityEvent({ actor, action, dealId, subject, before, after, request }) {
  if (!actor || !actor.username) {
    throw new Error('db/auditHook.js: recordSecurityEvent() called with no resolved actor — refusing to write an anonymous audit row (D-11)');
  }
  if (!action) {
    throw new Error('db/auditHook.js: recordSecurityEvent() requires an action name');
  }
  const conn = getAuditConnection();
  conn.prepare(INSERT_SQL).run(
    new Date().toISOString(), actor.username, actor.role || null, actor.sessionId || null,
    dealId || null, 'control', action, null, subject === undefined || subject === null ? null : String(subject),
    before === undefined || before === null ? null : JSON.stringify(before),
    after === undefined || after === null ? null : JSON.stringify(after),
    (request && request.method) || null, (request && request.path) || null, (request && request.ip) || null
  );
}

// D-12-04: partition file names a reader may open — a deal id or `legacy`.
const PARTITION_FILE_RE = /^(deal_[a-z0-9]+|legacy)\.db$/i;
const MAX_AUDIT_OFFSET = 100000; // a viewer can never force an unbounded merge window

/**
 * Read sources for one query: audit.db (tag 'control', the live connection)
 * plus the partitions that can hold matching rows, each opened READ-ONLY. When
 * `dealId` is given only that deal's partition and `legacy.db` (whose rows keep
 * their original deal_id) are consulted; otherwise every partition in
 * AUDIT_DIR. Never creates a directory or a file (11-06: a GET must not write).
 * Returns `{ sources: [{ partition, conn, owned }], close() }`.
 */
function openReadSources(dealId) {
  const sources = [{ partition: 'control', conn: getAuditConnection(), owned: false }];
  const names = [];
  if (dealId) {
    if (dbFiles.DEAL_ID_RE.test(dealId)) names.push(`${dealId}.db`);
    names.push('legacy.db');
  } else {
    let listing = [];
    try { listing = fs.readdirSync(dbFiles.AUDIT_DIR); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    for (const name of listing.sort()) if (PARTITION_FILE_RE.test(name)) names.push(name);
  }
  for (const name of names) {
    const file = path.join(dbFiles.AUDIT_DIR, name);
    if (!fs.existsSync(file)) continue;
    sources.push({ partition: name.replace(/\.db$/i, ''), conn: dbFiles.openDbFileReadOnly(file), owned: true });
  }
  return {
    sources,
    close() {
      for (const src of sources) {
        if (src.owned) { try { src.conn.close(); } catch (e) { /* ignore */ } }
      }
    },
  };
}

/**
 * D-10: the admin audit viewer's read path. Rows are ordered `ts DESC, id DESC`
 * — offset=0 (the tab's default, initial load) is the MOST RECENT rows, which is
 * what an admin investigating recent activity (the primary use case for a
 * compliance/audit viewer) needs to see first (WR-01 fix). `id DESC` is still
 * the stable readback order for rows that share a timestamp. `limit` is clamped
 * to a sane default (100) and a hard maximum (500), `offset` to 100000, so a
 * caller can never force an unbounded scan through this endpoint. Increasing
 * `offset` moves toward OLDER rows (paginating "Older ->"); decreasing it moves
 * toward the most recent ("<- Newer") — see public/js/admin.js's
 * btn-audit-prev/btn-audit-next wiring.
 *
 * D-12-04: spans audit.db (control-plane events, including Phase 11
 * `access-denied` rows) and every deal partition, merged by ts DESC; each row
 * is tagged `partition` ('control', a deal id, or 'legacy'). `dealId` returns
 * that deal's partition rows UNION the control rows carrying that deal_id. Row
 * ids are per file, so `(partition, id)` is a row's identity.
 */
function queryAudit({ dealId, actor, from, to, limit, offset } = {}) {
  const clauses = [];
  const params = [];
  if (dealId) { clauses.push('deal_id = ?'); params.push(dealId); }
  if (actor) { clauses.push('actor_username = ?'); params.push(actor); }
  if (from) { clauses.push('ts >= ?'); params.push(from); }
  if (to) { clauses.push('ts <= ?'); params.push(to); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const parsedLimit = parseInt(limit, 10);
  const lim = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 100;
  const parsedOffset = parseInt(offset, 10);
  const off = Number.isFinite(parsedOffset) && parsedOffset > 0 ? Math.min(parsedOffset, MAX_AUDIT_OFFSET) : 0;

  const reader = openReadSources(dealId);
  try {
    const merged = [];
    for (const src of reader.sources) {
      const rows = src.conn
        .prepare(`SELECT * FROM audit_log ${where} ORDER BY ts DESC, id DESC LIMIT ?`)
        .all(...params, off + lim);
      for (const row of rows) { row.partition = src.partition; merged.push(row); }
    }
    // Every source is already sorted (ts DESC, id DESC); sorting the bounded
    // union by the same key is the k-way merge result.
    merged.sort((a, b) => {
      if (a.ts !== b.ts) return a.ts < b.ts ? 1 : -1;
      if (a.id !== b.id) return b.id - a.id;
      return 0;
    });
    return merged.slice(off, off + lim);
  } finally {
    reader.close();
  }
}

/**
 * D-12-01 (Phase 12): how many audit rows match, WITHOUT materialising them.
 * The proportional-audit proofs (test/writedb-dirty-rows.test.js,
 * test/audit-volume.test.js, scripts/perf/write-latency.js) assert "one change
 * -> exactly one row" through this function and queryAudit() only — never raw SQL
 * on audit.db — so the physical layout behind this API can change (per-deal
 * partitions, plan 12-08) without those proofs needing an edit. Every filter is
 * optional and parameterised.
 */
function countAudit({ dealId, rowId, collection, action } = {}) {
  const clauses = [];
  const params = [];
  if (dealId) { clauses.push('deal_id = ?'); params.push(dealId); }
  if (rowId) { clauses.push('row_id = ?'); params.push(rowId); }
  if (collection) { clauses.push('collection = ?'); params.push(collection); }
  if (action) { clauses.push('action = ?'); params.push(action); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const reader = openReadSources(dealId);
  try {
    let total = 0;
    for (const src of reader.sources) {
      total += src.conn.prepare(`SELECT COUNT(*) AS n FROM audit_log ${where}`).get(...params).n;
    }
    return total;
  } finally {
    reader.close();
  }
}

/**
 * D-12-04 / plan 12-12: read the control-plane events of audit.db for one
 * partition id (a deal id or `legacy`) and, optionally, one action or a list of
 * actions. Read-only (SELECT on the cached connection), ordered oldest first;
 * every row carries its `after_json` parsed as `after` (null when absent or not
 * valid JSON). The lifecycle uses this for the seal / export / tamper events —
 * audit.db is append-only, so a recorded seal hash can never be edited away.
 */
function findControlEvents({ dealId, action } = {}) {
  const clauses = ["db_kind = 'control'"];
  const params = [];
  if (dealId) { clauses.push('deal_id = ?'); params.push(dealId); }
  const actions = Array.isArray(action) ? action : (action ? [action] : []);
  if (actions.length) {
    clauses.push(`action IN (${actions.map(() => '?').join(', ')})`);
    params.push(...actions);
  }
  const rows = getAuditConnection()
    .prepare(`SELECT * FROM audit_log WHERE ${clauses.join(' AND ')} ORDER BY id ASC`)
    .all(...params);
  for (const row of rows) {
    let after = null;
    if (typeof row.after_json === 'string') {
      try { after = JSON.parse(row.after_json); } catch (e) { after = null; }
    }
    row.after = after;
  }
  return rows;
}

/**
 * D-12-04 / plan 12-12: the partition ids that currently have a file in
 * AUDIT_DIR (deal ids and `legacy`), sorted. Never creates the directory (a GET
 * must not write, 11-06).
 */
function listPartitions() {
  let listing = [];
  try { listing = fs.readdirSync(dbFiles.AUDIT_DIR); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return listing.filter((name) => PARTITION_FILE_RE.test(name)).sort().map((name) => name.replace(/\.db$/i, ''));
}

module.exports = {
  AUDITED_DB_KINDS,
  AuditPartitionSealedError: auditChain.AuditPartitionSealedError,
  getAuditConnection, closeAuditConnection, isAuditOpen,
  getPartitionConnection, closePartitionConnection,
  writeAuditBatch, appendWriteAudit, recordSecurityEvent, queryAudit, countAudit,
  findControlEvents, listPartitions,
};
