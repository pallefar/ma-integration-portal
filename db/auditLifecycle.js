// D-12-04 (Phase 12, DATA-04, plan 12-12): the audit-partition LIFECYCLE —
// seal, status, export (JSONL) and purge of one per-deal audit partition
// (data/audit/<dealId>.db, hash-chained by db/auditChain.js).
//
// This module requires dbFiles, auditChain, fs and crypto ONLY — never
// db/auditHook.js — so plan 12-13's migration can call sealPartitionFile()
// inside audit.db's own transaction without a require cycle. Anything that must
// be recorded as a control-plane event is handed in as an injected function.
//
// [security] PD-7 (revision 1, checker W-3). A seal is only worth recording if
// the SHA-256 of the main file is STABLE, i.e. the WAL has been folded into the
// main file and no other connection can fold more of it later. `PRAGMA
// wal_checkpoint(TRUNCATE)` reports `{ busy, log, checkpointed }`: busy = 1 (a
// second connection — the server's cached partition handle while the CLI seals
// from another process — holds a read snapshot) or checkpointed < log means the
// WAL was NOT fully folded, and hashing then would record a SHA-256 that changes
// when the last connection later checkpoints on close (a false
// `modified-after-seal`, purge refused forever). So the checkpoint result is
// CHECKED, before AND after the seal row, retried 3 x 250 ms, and a seal that
// cannot get a clean checkpoint is refused `checkpoint-busy` WITHOUT chmod and
// WITHOUT a hash. After the refusal in step (3) the seal row is already
// committed, so appends are refused everywhere (db/auditChain.js appendChained);
// a repeated seal simply completes the file seal.
//
// [security] There is no unseal. A sealed partition is the legal tamper-evidence
// record of a closed deal (D-12-04, locked).

const fs = require('fs');
const crypto = require('crypto');
const dbFiles = require('./dbFiles');
const auditChain = require('./auditChain');

const CHECKPOINT_RETRIES = 3;
const CHECKPOINT_RETRY_MS = 250;
const HASH_CHUNK_BYTES = 1024 * 1024;

/** A seal that was refused; `reason` is a fixed code, the message carries no id or path. */
class AuditSealRefusedError extends Error {
  constructor(reason) {
    super(`audit partition seal refused: ${reason}`);
    this.name = 'AuditSealRefusedError';
    this.code = 'AUDIT_SEAL_REFUSED';
    this.reason = reason;
  }
}

/** Synchronous sleep (the seal is synchronous so the 12-13 migration can call it inside a sync up()). */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** SHA-256 hex of a file's bytes, streamed in 1 MiB chunks (a partition can be large). */
function fileSha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      hash.update(n === buf.length ? buf : buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/** True when the file has no owner-write bit (0400 / the Windows read-only attribute). */
function isReadOnlyMode(mode) {
  return (mode & 0o200) === 0;
}

/**
 * One TRUNCATE checkpoint attempt. Accepts only `busy === 0 && checkpointed ===
 * log` (the WAL was fully folded and truncated). A non-WAL connection reports
 * log = checkpointed = -1, which also passes — there is no WAL to fold.
 */
function defaultCheckpoint(conn) {
  // busy_timeout 0 for the attempt: the retries below ARE the bounded wait
  // (<= 750 ms) rather than SQLite's own 1 s busy handler per attempt.
  conn.pragma('busy_timeout = 0');
  try {
    const result = conn.pragma('wal_checkpoint(TRUNCATE)');
    const row = Array.isArray(result) ? result[0] : result;
    return !!row && row.busy === 0 && row.checkpointed === row.log;
  } catch (e) {
    // A busy checkpoint may surface as a thrown SQLITE_BUSY rather than a row.
    if (e && typeof e.code === 'string' && e.code.startsWith('SQLITE_BUSY')) return false;
    throw e;
  } finally {
    conn.pragma('busy_timeout = 1000');
  }
}

function checkpointWithRetries(conn, impl, phase) {
  for (let attempt = 0; attempt <= CHECKPOINT_RETRIES; attempt += 1) {
    if (attempt > 0) sleepSync(CHECKPOINT_RETRY_MS);
    if (impl(conn, phase)) return true;
  }
  return false;
}

function summarize(conn) {
  const rows = conn.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
  const head = conn.prepare('SELECT row_hash FROM audit_log WHERE row_hash IS NOT NULL ORDER BY id DESC LIMIT 1').get();
  const last = conn.prepare('SELECT action FROM audit_log ORDER BY id DESC LIMIT 1').get();
  return {
    rows,
    headHash: head ? head.row_hash : null,
    lastAction: last ? last.action : null,
  };
}

/** Read-only summary of a partition file: `{ rows, headHash, lastAction }`. */
function peekPartition(file) {
  const conn = dbFiles.openDbFileReadOnly(file);
  try {
    return summarize(conn);
  } finally {
    try { conn.close(); } catch (e) { /* ignore */ }
  }
}

function chmodReadOnly(file) {
  try {
    fs.chmodSync(file, 0o400);
  } catch (e) {
    // POSIX modes do not apply on win32 the way they do elsewhere (same stance
    // as db/dbFiles.js); every other failure is fatal — an unsealed-looking
    // "sealed" file must not be reported as sealed.
    if (!(process.platform === 'win32' && e && (e.code === 'EPERM' || e.code === 'ENOSYS'))) throw e;
  }
}

/**
 * Seal one partition: append the chained `partition-seal` row, fold the WAL
 * into the main file, close, make the file read-only, hash it. Synchronous.
 *
 * Returns `{ sha256, rows, headHash, alreadySealed }`. `alreadySealed` is true
 * when a seal row existed BEFORE this call (idempotent re-seal / crash repair —
 * no second seal row is ever appended).
 *
 * Throws AuditSealRefusedError: 'no-partition' (file missing) or
 * 'checkpoint-busy' (PD-7 revision 1 — see the file header). On 'checkpoint-busy'
 * nothing is chmodded or hashed; if the refusal came from the checkpoint AFTER
 * the seal row, the row is committed (appends are already refused everywhere).
 *
 * @param {string} partitionId  a deal id or `legacy`
 * @param {object} [opts]
 * @param {{username:string, role?:string, sessionId?:string}} [opts.actor]  recorded on the seal row
 * @param {string} [opts.ts]  ISO timestamp of the seal row (default now)
 * @param {Function} [opts.checkpoint]  TEST SEAM: (conn, 'pre'|'post') => boolean
 */
function sealPartitionFile(partitionId, opts) {
  const o = opts || {};
  const file = dbFiles.auditPartitionPath(partitionId); // throws on a malformed id
  const impl = typeof o.checkpoint === 'function' ? o.checkpoint : defaultCheckpoint;
  const actor = o.actor && o.actor.username ? o.actor : { username: 'system', role: 'system' };
  const ts = o.ts || new Date().toISOString();

  let st;
  try {
    st = fs.statSync(file);
  } catch (e) {
    if (e && e.code === 'ENOENT') throw new AuditSealRefusedError('no-partition');
    throw e;
  }

  // A read-only file that already ends in a seal row is a completed seal: report
  // it without ever opening it writable.
  if (isReadOnlyMode(st.mode)) {
    const info = peekPartition(file);
    if (info.lastAction === auditChain.SEAL_ACTION) {
      return { sha256: fileSha256(file), rows: info.rows, headHash: info.headHash, alreadySealed: true };
    }
    // Read-only but NOT sealed (someone chmodded it by hand): there is no
    // tamper evidence to preserve yet — restore owner-write so it can be sealed.
    fs.chmodSync(file, 0o600);
  }

  let info;
  let alreadySealed = false;
  const conn = dbFiles.openDbFile(file, dbFiles.AUDIT_PARTITION_SCHEMA_PATH);
  try {
    // (1) PRE-CHECK — before anything is appended.
    if (!checkpointWithRetries(conn, impl, 'pre')) throw new AuditSealRefusedError('checkpoint-busy');

    const before = summarize(conn);
    if (before.lastAction === auditChain.SEAL_ACTION) {
      alreadySealed = true;
    } else {
      // (2) the chained seal row.
      auditChain.appendChained(conn, [{
        ts,
        actor_username: actor.username,
        actor_role: actor.role || 'cli',
        session_id: actor.sessionId || null,
        deal_id: partitionId,
        db_kind: 'audit',
        action: auditChain.SEAL_ACTION,
        collection: null,
        row_id: partitionId,
        before_json: null,
        after_json: JSON.stringify({ rows: before.rows, headHashBeforeSeal: before.headHash }),
        request_method: null,
        request_path: null,
        ip: null,
      }], { partitionId });
    }

    // (3) fold the seal row into the main file; refuse (no chmod, no hash) if
    // another connection still holds the WAL open.
    if (!checkpointWithRetries(conn, impl, 'post')) throw new AuditSealRefusedError('checkpoint-busy');
    info = summarize(conn);
  } finally {
    try { conn.close(); } catch (e) { /* ignore */ }
  }

  // (4) every connection of THIS call is closed: read-only, then hash.
  chmodReadOnly(file);
  return { sha256: fileSha256(file), rows: info.rows, headHash: info.headHash, alreadySealed };
}

/**
 * Status of one partition from its file plus the control events the caller
 * already looked up (this module never reads audit.db).
 *
 * @param {string} partitionId
 * @param {{sealedEvent?: object|null, exportEvents?: object[]}} [events]
 *   sealedEvent = the LATEST `audit-partition-sealed` event's parsed `after`
 *   ({ sha256, rows, headHash }) plus `ts`; exportEvents = parsed
 *   `audit-partition-exported` events ({ ts, exportSha256, sealedSha256 }).
 */
function partitionStatus(partitionId, events) {
  const ev = events || {};
  const file = dbFiles.auditPartitionPath(partitionId);
  const base = {
    partition: partitionId,
    exists: false,
    rows: 0,
    headHash: null,
    sealed: false,
    writable: null,
    fileSha256: null,
    sealedAt: ev.sealedEvent ? ev.sealedEvent.ts || null : null,
    sealedSha256: ev.sealedEvent ? ev.sealedEvent.sha256 || null : null,
    fileMatchesSeal: null,
    exports: Array.isArray(ev.exportEvents) ? ev.exportEvents : [],
  };
  let st;
  try {
    st = fs.statSync(file);
  } catch (e) {
    if (e && e.code === 'ENOENT') return base;
    throw e;
  }
  const info = peekPartition(file);
  const sealed = info.lastAction === auditChain.SEAL_ACTION;
  base.exists = true;
  base.rows = info.rows;
  base.headHash = info.headHash;
  base.sealed = sealed;
  base.writable = !isReadOnlyMode(st.mode);
  // The main file's hash is only meaningful once sealed (an unsealed partition's
  // newest rows may still sit in the WAL).
  if (sealed) {
    base.fileSha256 = fileSha256(file);
    base.fileMatchesSeal = base.sealedSha256 ? base.fileSha256 === base.sealedSha256 : null;
  }
  return base;
}

// Fixed, id-free sentences per refusal reason — shared by the admin routes and
// the CLI so the two surfaces never word a refusal differently, and so no
// response ever echoes a path, an id or an error message.
const REFUSAL_MESSAGES = Object.freeze({
  'deal-active': 'This deal must be archived before its audit trail can be sealed.',
  'no-partition': 'This deal has no audit trail on this host.',
  'checkpoint-busy': 'The audit trail is in use; try sealing again in a moment.',
  'modified-after-seal': 'The sealed audit trail no longer matches its recorded seal.',
  'not-sealed': 'The audit trail is not sealed.',
  'no-sealed-export': 'The audit trail has no export of its sealed state; export it before purging.',
  'retention-never': 'No retention period is configured, so the audit trail is never purged.',
  'retention-not-elapsed': 'The retention period for this audit trail has not elapsed.',
});

function latestEvent(events) {
  return events && events.length ? events[events.length - 1] : null;
}

/** `{ ts, sha256, rows, headHash }` of a seal event row, tolerant of a missing/odd `after`. */
function sealedInfoOf(eventRow) {
  if (!eventRow) return null;
  const after = eventRow.after && typeof eventRow.after === 'object' ? eventRow.after : {};
  return { ts: eventRow.ts || null, sha256: after.sha256 || null, rows: after.rows, headHash: after.headHash || null };
}

/**
 * Seal one partition AND record its control events (the single orchestration
 * the admin route and the CLI both call).
 *
 * @param {string} partitionId
 * @param {object} deps
 * @param {() => ('active'|'archived'|'absent')} deps.dealState  registry state of the deal
 * @param {(actions: string[]) => object[]} deps.findEvents      control events for this partition (oldest first, `.after` parsed)
 * @param {(ev: {action: string, after?: object}) => void} deps.recordEvent  control-plane event recorder
 * @param {() => void} [deps.closeConnection]  drop this process's cached RW handle before sealing
 * @param {object} [deps.actor] seal-row actor
 * @param {string} [deps.ts]
 * @param {Function} [deps.checkpoint] TEST SEAM forwarded to sealPartitionFile
 * @returns {{outcome:'sealed', sha256, rows, headHash, alreadySealed:boolean, eventRecorded:boolean}
 *          |{outcome:'refused', reason:string}}
 */
function sealPartition(partitionId, deps) {
  const file = dbFiles.auditPartitionPath(partitionId);
  const refuse = (reason, after) => {
    deps.recordEvent({ action: 'audit-partition-seal-refused', after: { reason, ...(after || {}) } });
    return { outcome: 'refused', reason };
  };

  // [security] D-12-04: only a CLOSED deal's trail is sealed — an active deal is
  // still being written.
  if (deps.dealState() === 'active') return refuse('deal-active');
  if (!fs.existsSync(file)) return refuse('no-partition');

  const existing = sealedInfoOf(latestEvent(deps.findEvents(['audit-partition-sealed'])));
  // [security] T-12-110: a re-seal must never launder a modified file into a
  // fresh, matching seal event. When a seal is already recorded and the sealed
  // (read-only, stable) file no longer hashes to it, refuse and say so.
  if (existing && existing.sha256) {
    let st = null;
    try { st = fs.statSync(file); } catch (e) { st = null; }
    if (st && isReadOnlyMode(st.mode)) {
      const current = fileSha256(file);
      if (current !== existing.sha256) {
        deps.recordEvent({ action: 'audit-partition-tamper-detected', after: { sealedSha256: existing.sha256, currentSha256: current } });
        return refuse('modified-after-seal');
      }
    }
  }

  if (typeof deps.closeConnection === 'function') deps.closeConnection();
  let result;
  try {
    result = sealPartitionFile(partitionId, { actor: deps.actor, ts: deps.ts, checkpoint: deps.checkpoint });
  } catch (e) {
    if (e instanceof AuditSealRefusedError) return refuse(e.reason);
    throw e;
  }

  let eventRecorded = false;
  if (existing && existing.sha256 === result.sha256) {
    // idempotent: the seal is already on record — never a duplicate event.
  } else if (existing && existing.sha256 && existing.sha256 !== result.sha256) {
    // The file was writable (hand-chmodded) and its hash differs from the
    // recorded seal: same tamper signal as above.
    deps.recordEvent({ action: 'audit-partition-tamper-detected', after: { sealedSha256: existing.sha256, currentSha256: result.sha256 } });
    return refuse('modified-after-seal');
  } else {
    // First seal, or the crash-repair path (seal row committed, event lost).
    deps.recordEvent({ action: 'audit-partition-sealed', after: { sha256: result.sha256, rows: result.rows, headHash: result.headHash } });
    eventRecorded = true;
  }
  return {
    outcome: 'sealed',
    sha256: result.sha256,
    rows: result.rows,
    headHash: result.headHash,
    alreadySealed: result.alreadySealed, // a seal row existed BEFORE this call (event may have been repaired: eventRecorded)
    eventRecorded,
  };
}

module.exports = {
  AuditSealRefusedError,
  CHECKPOINT_RETRIES,
  CHECKPOINT_RETRY_MS,
  fileSha256,
  isReadOnlyMode,
  peekPartition,
  sealPartitionFile,
  sealPartition,
  partitionStatus,
  sealedInfoOf,
  latestEvent,
  REFUSAL_MESSAGES,
};
