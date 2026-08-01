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

const dbFiles = require('./dbFiles');

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
 * Test-only teardown: close and drop the cached connection so a fresh test
 * file gets a fresh handle to its own temp audit.db, mirroring
 * db/store.js's closeAllConnections() test-only export.
 */
function closeAuditConnection() {
  if (auditConn) {
    try { auditConn.close(); } catch (e) { /* ignore */ }
    auditConn = null;
  }
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
  });
  runBatch(rows);
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

/**
 * D-10: the admin audit viewer's read path. Always ordered by the
 * autoincrement id — the schema's own header names this as the specified,
 * stable readback order for rows that share a timestamp. `limit` is clamped
 * to a sane default (100) and a hard maximum (500) so a caller can never
 * force an unbounded table scan through this endpoint.
 */
function queryAudit({ dealId, actor, from, to, limit, offset } = {}) {
  const conn = getAuditConnection();
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
  const off = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

  return conn.prepare(`SELECT * FROM audit_log ${where} ORDER BY id ASC LIMIT ? OFFSET ?`).all(...params, lim, off);
}

module.exports = {
  AUDITED_DB_KINDS,
  getAuditConnection, closeAuditConnection,
  writeAuditBatch, recordSecurityEvent, queryAudit,
};
