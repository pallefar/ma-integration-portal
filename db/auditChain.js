// D-12-04 (Phase 12, DATA-04): pure hash-chain primitives for the per-deal
// audit partitions (data/audit/<dealId>.db). No requires beyond node:crypto —
// this module never opens a file; callers hand it an open better-sqlite3
// connection. db/auditHook.js owns routing and connection caching.
//
// [security] CANONICAL FORM (PD-3). Every row's hash covers the JSON array
//   [ts, actor_username, actor_role, session_id, deal_id, db_kind, action,
//    collection, row_id, before_json, after_json, request_method,
//    request_path, ip, legacy_id, prev_hash]
// with every missing value as null and every present value as a STRING (the
// columns are TEXT; legacy_id is the one INTEGER and is hashed as a number or
// null). `row_hash = sha256(JSON.stringify(canonical array))`. Because
// prev_hash is inside the hashed array, editing, deleting or reordering any
// row breaks every link after it.
//
// [security] GENESIS BINDING. The first row of a partition links to
// sha256('ma-audit-genesis|' + partitionId) — the partition id is the deal id
// (or `legacy` / `control`) and the verifier derives it from the FILE NAME, so
// a partition file renamed or swapped into another deal's slot fails
// verification at its first row.
//
// [security] WHY THE HEAD READ UNDER BEGIN IMMEDIATE LINEARISES WRITERS. Every
// append is one `.immediate` transaction on the partition's own connection:
// SQLite takes the file's single write lock BEFORE the head row is read and
// holds it through the insert and commit. Two appenders — threads or OS
// processes — therefore serialise on that lock, and the second one reads the
// head the first one committed. The chain cannot fork, and no application-level
// counter or lock exists that a crash could leave stale.
//
// [security] PD-30 HEAD RULE. `prev_hash` is the row_hash of the most recent
// row that HAS one (`WHERE row_hash IS NOT NULL`), else the genesis; the seal
// check reads the absolute last row. Partitions declare the hash columns NOT
// NULL, so there the rule is inert; it matters for audit.db, whose nullable
// hash columns can hold a raw un-hashed row (plan 12-13).

const crypto = require('crypto');

// The seal marker action (plan 12-12 appends it; plan 12-08 only refuses to
// append after it — PD-7 backstop).
const SEAL_ACTION = 'partition-seal';

// Column order of the canonical array. Exported so a test can recompute a hash
// independently of rowHash().
const CANONICAL_COLUMNS = Object.freeze([
  'ts', 'actor_username', 'actor_role', 'session_id', 'deal_id', 'db_kind', 'action',
  'collection', 'row_id', 'before_json', 'after_json', 'request_method', 'request_path', 'ip',
  'legacy_id', 'prev_hash',
]);

class AuditPartitionSealedError extends Error {
  constructor(partitionId) {
    // Generic + id-free message: this can reach a log line, never a response
    // (server.js maps it to a fixed body).
    super('audit partition is sealed: no further rows may be appended');
    this.name = 'AuditPartitionSealedError';
    this.code = 'AUDIT_PARTITION_SEALED';
    this.partitionId = partitionId;
  }
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function genesisHash(partitionId) {
  return sha256Hex('ma-audit-genesis|' + String(partitionId));
}

function textOrNull(v) {
  return v === undefined || v === null ? null : String(v);
}

function legacyOrNull(v) {
  return v === undefined || v === null ? null : Number(v);
}

/**
 * The canonical JSON string a row is hashed over. `row` may be a stored row
 * (snake_case column names) — the one entry point, so hashing and verifying can
 * never disagree about the form.
 */
function canonicalRow(row) {
  const r = row || {};
  return JSON.stringify([
    textOrNull(r.ts), textOrNull(r.actor_username), textOrNull(r.actor_role), textOrNull(r.session_id),
    textOrNull(r.deal_id), textOrNull(r.db_kind), textOrNull(r.action), textOrNull(r.collection),
    textOrNull(r.row_id), textOrNull(r.before_json), textOrNull(r.after_json),
    textOrNull(r.request_method), textOrNull(r.request_path), textOrNull(r.ip),
    legacyOrNull(r.legacy_id), textOrNull(r.prev_hash),
  ]);
}

/** sha256 hex of `row` linked to `prevHash` (prev_hash is part of the hashed form). */
function rowHash(row, prevHash) {
  return sha256Hex(canonicalRow({ ...row, prev_hash: prevHash }));
}

const INSERT_CHAINED_SQL = `INSERT INTO audit_log
  (ts, actor_username, actor_role, session_id, deal_id, db_kind, action, collection, row_id, before_json, after_json,
   request_method, request_path, ip, legacy_id, prev_hash, row_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Append `rows` (objects keyed by column name: ts, actor_username, actor_role,
 * session_id, deal_id, db_kind, action, collection, row_id, before_json,
 * after_json, request_method, request_path, ip) to `conn`'s audit_log as ONE
 * chained batch inside ONE `BEGIN IMMEDIATE` transaction on `conn`.
 *
 * The caller's connection is the partition's own connection — never a deal
 * file's — so calling this from inside a deal-file transaction is not a nested
 * transaction (better-sqlite3's rule is per connection). Anything this throws
 * (SQLITE_BUSY*, a sealed partition, an I/O error) propagates out of the
 * caller's deal transaction body and rolls the deal write back (PD-1).
 *
 * Returns `{ count, headHash }`; an empty batch is a no-op.
 */
function appendChained(conn, rows, { partitionId } = {}) {
  if (!partitionId) throw new Error('db/auditChain.js: appendChained() requires a partitionId');
  if (!rows || rows.length === 0) return { count: 0, headHash: null };
  const lastStmt = conn.prepare('SELECT action FROM audit_log ORDER BY id DESC LIMIT 1');
  const headStmt = conn.prepare('SELECT row_hash FROM audit_log WHERE row_hash IS NOT NULL ORDER BY id DESC LIMIT 1');
  const insert = conn.prepare(INSERT_CHAINED_SQL);
  const run = conn.transaction((entries) => {
    const last = lastStmt.get();
    if (last && last.action === SEAL_ACTION) throw new AuditPartitionSealedError(partitionId);
    const head = headStmt.get();
    let prev = head && head.row_hash ? head.row_hash : genesisHash(partitionId);
    for (const entry of entries) {
      const stored = {
        ts: textOrNull(entry.ts), actor_username: textOrNull(entry.actor_username), actor_role: textOrNull(entry.actor_role),
        session_id: textOrNull(entry.session_id), deal_id: textOrNull(entry.deal_id), db_kind: textOrNull(entry.db_kind),
        action: textOrNull(entry.action), collection: textOrNull(entry.collection), row_id: textOrNull(entry.row_id),
        before_json: textOrNull(entry.before_json), after_json: textOrNull(entry.after_json),
        request_method: textOrNull(entry.request_method), request_path: textOrNull(entry.request_path), ip: textOrNull(entry.ip),
        legacy_id: legacyOrNull(entry.legacy_id),
      };
      const hash = rowHash(stored, prev);
      insert.run(
        stored.ts, stored.actor_username, stored.actor_role, stored.session_id, stored.deal_id, stored.db_kind,
        stored.action, stored.collection, stored.row_id, stored.before_json, stored.after_json,
        stored.request_method, stored.request_path, stored.ip, stored.legacy_id, prev, hash
      );
      prev = hash;
    }
    return prev;
  }).immediate;
  const headHash = run(rows);
  return { count: rows.length, headHash };
}

/**
 * Walk `conn`'s audit_log by id and verify every link.
 *
 * Returns `{ ok, rows, headHash, sealed, badId, reason, problems }`:
 *   - `badId` / `reason` — the FIRST problem (`row-hash-mismatch`,
 *     `prev-link-broken` or `unchained-row`), null when ok;
 *   - `problems` — every problem as `{ id, reason }`;
 *   - `headHash` — row_hash of the last hashed row (the genesis for an empty
 *     chain); `sealed` — the last row is a `partition-seal`.
 *
 * A row without hashes is reported once as `unchained-row` (ok = false) and the
 * next chained row is linked to the last HASHED row (PD-30), so one raw insert
 * never turns the following rows' prev_hash into noise. After a broken row the
 * walk continues from that row's STORED hash, so a single flipped byte yields a
 * single problem rather than one per later row.
 */
function verifyChain(conn, partitionId) {
  let prev = genesisHash(partitionId);
  let rows = 0;
  let lastAction = null;
  const problems = [];
  const stmt = conn.prepare('SELECT * FROM audit_log ORDER BY id');
  for (const row of stmt.iterate()) {
    rows += 1;
    lastAction = row.action;
    if (!row.row_hash || !row.prev_hash) {
      problems.push({ id: row.id, reason: 'unchained-row' });
      continue;
    }
    if (row.prev_hash !== prev) {
      problems.push({ id: row.id, reason: 'prev-link-broken' });
    } else if (rowHash(row, row.prev_hash) !== row.row_hash) {
      problems.push({ id: row.id, reason: 'row-hash-mismatch' });
    }
    prev = row.row_hash;
  }
  return {
    ok: problems.length === 0,
    rows,
    headHash: prev,
    sealed: lastAction === SEAL_ACTION,
    badId: problems.length ? problems[0].id : null,
    reason: problems.length ? problems[0].reason : null,
    problems,
  };
}

module.exports = {
  SEAL_ACTION,
  CANONICAL_COLUMNS,
  AuditPartitionSealedError,
  genesisHash,
  canonicalRow,
  rowHash,
  appendChained,
  verifyChain,
};
