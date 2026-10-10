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
  const readOnly = isReadOnlyMode(st.mode);
  let info = null;
  try {
    info = peekPartition(file);
  } catch (e) {
    // [security] T-12-110: a SEALED (read-only, recorded) file that SQLite can
    // no longer read has certainly been modified — report it through the hash
    // comparison below instead of failing the status call. Anything else
    // (lock contention, an unsealed file) is a real error.
    const busy = e && typeof e.code === 'string' && e.code.startsWith('SQLITE_BUSY');
    if (!readOnly || busy || !base.sealedSha256) throw e;
  }
  base.exists = true;
  base.writable = !readOnly;
  if (info) {
    base.rows = info.rows;
    base.headHash = info.headHash;
    base.sealed = info.lastAction === auditChain.SEAL_ACTION;
  } else {
    base.sealed = true; // read-only + a recorded seal; content unreadable
    base.unreadable = true;
  }
  // The main file's hash is only meaningful once sealed (an unsealed partition's
  // newest rows may still sit in the WAL).
  if (base.sealed) {
    base.fileSha256 = fileSha256(file);
    base.fileMatchesSeal = base.sealedSha256 ? base.fileSha256 === base.sealedSha256 : null;
  }
  return base;
}

// --- retention (D-12-04: TE legal owns the period; the default is never) -----

let warnedInvalidRetention = false;

/**
 * `MA_AUDIT_RETENTION_DAYS`: unset, empty or `never` => `{ days: null }` (a
 * partition is never purged); a positive integer => `{ days }`, counted from
 * the seal event. Anything else is treated as `never` and warned once —
 * a typo must never SHORTEN retention.
 */
function retentionPolicy(env) {
  const raw = env ? env.MA_AUDIT_RETENTION_DAYS : undefined;
  if (raw === undefined || raw === null) return { days: null };
  const s = String(raw).trim();
  if (s === '' || s.toLowerCase() === 'never') return { days: null };
  if (/^[1-9][0-9]{0,5}$/.test(s)) return { days: parseInt(s, 10) };
  if (!warnedInvalidRetention) {
    warnedInvalidRetention = true;
    console.warn(
      `[security] MA_AUDIT_RETENTION_DAYS=${JSON.stringify(s.slice(0, 40))} is not a positive integer or "never" — ` +
      'treating it as "never": no audit partition will be purged.'
    );
  }
  return { days: null, invalid: true };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO time a sealed partition becomes purge-eligible, or null (no retention / no seal time). */
function purgeEligibleAt(sealedAt, retention) {
  if (!retention || retention.days === null || retention.days === undefined) return null;
  const sealedMs = Date.parse(sealedAt);
  if (!Number.isFinite(sealedMs)) return null;
  return new Date(sealedMs + retention.days * DAY_MS).toISOString();
}

/**
 * [security] PD-9 / T-12-111: the purge gate. Refusal order (first failing wins):
 *   no-partition -> not-sealed -> modified-after-seal -> no-sealed-export ->
 *   retention-never -> retention-not-elapsed.
 * Pure — `status` is partitionStatus() output, the events are parsed control
 * events, `now` a Date. A purge is allowed ONLY when the partition is sealed,
 * the file still hashes to the recorded seal, an export of exactly that sealed
 * state was recorded, and the retention period has elapsed since the seal.
 */
function purgeDecision({ status, sealedEvent, exportEvents, retention, now }) {
  const st = status || {};
  const sealed = sealedEvent && sealedEvent.sha256 ? sealedEvent : null;
  if (!st.exists) return { allowed: false, reason: 'no-partition' };
  if (!st.sealed || !sealed) return { allowed: false, reason: 'not-sealed' };
  if (st.fileSha256 !== sealed.sha256) return { allowed: false, reason: 'modified-after-seal' };
  const exported = (exportEvents || []).some((e) => e && e.sealedSha256 === sealed.sha256);
  if (!exported) return { allowed: false, reason: 'no-sealed-export' };
  if (!retention || retention.days === null || retention.days === undefined) {
    return { allowed: false, reason: 'retention-never' };
  }
  const eligibleAt = purgeEligibleAt(sealed.ts, retention);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  // Fail closed: an unparsable seal time or clock is "not elapsed".
  if (eligibleAt === null || !Number.isFinite(nowMs) || nowMs < Date.parse(eligibleAt)) {
    return { allowed: false, reason: 'retention-not-elapsed', eligibleAt };
  }
  return { allowed: true, reason: null, eligibleAt };
}

/**
 * Delete a partition's files: chmod 0600 first (Windows cannot unlink a
 * read-only file), then the main file, -wal, -shm. The CALLER has already
 * recorded `audit-partition-purged` and closed cached connections; nothing in
 * this module ever calls this on a timer (T-12-111).
 */
function purgePartitionFile(partitionId) {
  const file = dbFiles.auditPartitionPath(partitionId);
  try { fs.chmodSync(file, 0o600); } catch (e) { /* ENOENT or best effort — the unlink below decides */ }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(file + suffix);
    } catch (e) {
      if (!e || e.code !== 'ENOENT') throw e;
    }
  }
}

// --- export (JSONL) ----------------------------------------------------------

const EXPORT_BATCH_ROWS = 500;

/**
 * Stream a SEALED partition as JSONL: a header line, then one JSON line per row
 * (every column), in batches of 500 with a `setImmediate` yield between batches
 * so a large export never blocks the event loop for more than one batch
 * (T-12-114). `write(chunk)` may return a promise (backpressure). Returns
 * `{ sha256, rowCount, headHash, sealedSha256, batches, bytes }` — `sha256` is the
 * hash of exactly the bytes handed to `write`.
 *
 * @param {string} partitionId
 * @param {(chunk: string) => (void|Promise<void>)} write
 * @param {object} [opts]
 * @param {Date}   [opts.now]
 * @param {string} [opts.sealedSha256]  recorded seal hash, echoed in the header
 * @param {() => boolean} [opts.shouldAbort]
 */
async function exportPartitionJsonl(partitionId, write, opts) {
  const o = opts || {};
  const file = dbFiles.auditPartitionPath(partitionId);
  const conn = dbFiles.openDbFileReadOnly(file);
  try {
    const info = summarize(conn);
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    const emit = async (text) => {
      hash.update(text, 'utf8');
      bytes += Buffer.byteLength(text, 'utf8');
      const r = write(text);
      if (r && typeof r.then === 'function') await r;
    };
    await emit(JSON.stringify({
      type: 'ma-audit-export',
      version: 1,
      partition: partitionId,
      sealedSha256: o.sealedSha256 || null,
      rowCount: info.rows,
      headHash: info.headHash,
      exportedAt: (o.now instanceof Date ? o.now : new Date()).toISOString(),
    }) + '\n');
    const page = conn.prepare(`SELECT * FROM audit_log WHERE id > ? ORDER BY id LIMIT ${EXPORT_BATCH_ROWS}`);
    let lastId = 0;
    let batches = 0;
    for (;;) {
      if (typeof o.shouldAbort === 'function' && o.shouldAbort()) return { aborted: true };
      const batch = page.all(lastId);
      if (batch.length === 0) break;
      let text = '';
      for (const row of batch) text += JSON.stringify(row) + '\n';
      await emit(text);
      lastId = batch[batch.length - 1].id;
      batches += 1;
      await new Promise((resolve) => setImmediate(resolve)); // bounded event-loop blocking
    }
    return {
      aborted: false, sha256: hash.digest('hex'), rowCount: info.rows, headHash: info.headHash,
      sealedSha256: o.sealedSha256 || null, batches, bytes,
    };
  } finally {
    try { conn.close(); } catch (e) { /* ignore */ }
  }
}

const LIFECYCLE_ACTIONS = Object.freeze([
  'audit-partition-sealed', 'audit-partition-seal-refused', 'audit-partition-exported',
  'audit-partition-export-refused', 'audit-partition-purged', 'audit-partition-purge-refused',
  'audit-partition-purge-failed', 'audit-partition-tamper-detected',
]);

function exportInfosOf(rows) {
  return (rows || []).map((r) => {
    const a = r.after && typeof r.after === 'object' ? r.after : {};
    return { ts: r.ts || null, exportSha256: a.exportSha256 || null, sealedSha256: a.sealedSha256 || null, rows: a.rows, headHash: a.headHash || null };
  });
}

/** Status + retention + purge eligibility + the partition's lifecycle events (route GET, CLI status). */
function lifecycleStatus(partitionId, deps) {
  const sealedEvent = sealedInfoOf(latestEvent(deps.findEvents(['audit-partition-sealed'])));
  const exportEvents = exportInfosOf(deps.findEvents(['audit-partition-exported']));
  const status = partitionStatus(partitionId, { sealedEvent, exportEvents });
  const retention = retentionPolicy(deps.env || process.env);
  const now = deps.now instanceof Date ? deps.now : new Date();
  const decision = purgeDecision({ status, sealedEvent, exportEvents, retention, now });
  const events = deps.findEvents(LIFECYCLE_ACTIONS).map((r) => ({
    at: r.ts, action: r.action, actor: r.actor_username, detail: r.after || null,
  }));
  return {
    partition: partitionId,
    exists: status.exists,
    rows: status.rows,
    headHash: status.headHash,
    sealed: status.sealed,
    writable: status.writable,
    sealedAt: status.sealedAt,
    sealedSha256: status.sealedSha256,
    fileSha256: status.fileSha256,
    fileMatchesSeal: status.fileMatchesSeal,
    exports: status.exports,
    retentionDays: retention.days,
    purgeEligibleAt: status.sealed && sealedEvent ? purgeEligibleAt(sealedEvent.ts, retention) : null,
    purgeAllowed: decision.allowed,
    purgeBlockedBy: decision.allowed ? null : decision.reason,
    events,
  };
}

/**
 * Export a sealed partition AND record `audit-partition-exported` after the
 * last byte. Refusals (`no-partition`, `not-sealed`, `modified-after-seal`) are
 * decided BEFORE `deps.onReady()` / the first `write`, so a caller can still
 * answer with a status code. An aborted stream (`deps.shouldAbort`) records
 * nothing.
 *
 * @param {string} partitionId
 * @param {object} deps  findEvents, recordEvent, write, [onReady], [shouldAbort], [now]
 * @returns {Promise<{outcome:'exported', sha256, sealedSha256, rows, headHash, batches}
 *                  |{outcome:'refused', reason}|{outcome:'aborted'}>}
 */
async function exportPartition(partitionId, deps) {
  const sealedEvent = sealedInfoOf(latestEvent(deps.findEvents(['audit-partition-sealed'])));
  const status = partitionStatus(partitionId, { sealedEvent, exportEvents: [] });
  const refuse = (reason) => {
    deps.recordEvent({ action: 'audit-partition-export-refused', after: { reason } });
    return { outcome: 'refused', reason };
  };
  if (!status.exists) return refuse('no-partition');
  if (!status.sealed || !sealedEvent || !sealedEvent.sha256) return refuse('not-sealed');
  if (status.fileSha256 !== sealedEvent.sha256) {
    deps.recordEvent({ action: 'audit-partition-tamper-detected', after: { sealedSha256: sealedEvent.sha256, currentSha256: status.fileSha256 } });
    return refuse('modified-after-seal');
  }
  if (typeof deps.onReady === 'function') deps.onReady();
  const result = await exportPartitionJsonl(partitionId, deps.write, {
    now: deps.now, sealedSha256: sealedEvent.sha256, shouldAbort: deps.shouldAbort,
  });
  if (result.aborted) return { outcome: 'aborted' };
  // Recorded only after the complete stream; the caller ends the response AFTER
  // this returns, so an export is never delivered without its event.
  deps.recordEvent({
    action: 'audit-partition-exported',
    after: { exportSha256: result.sha256, sealedSha256: sealedEvent.sha256, rows: result.rowCount, headHash: result.headHash },
  });
  return {
    outcome: 'exported', sha256: result.sha256, sealedSha256: sealedEvent.sha256,
    rows: result.rowCount, headHash: result.headHash, batches: result.batches,
  };
}

/**
 * Purge a partition if — and only if — purgeDecision() allows it. Every refusal
 * is an `audit-partition-purge-refused` event (plus a tamper event for
 * `modified-after-seal`); a permitted purge records `audit-partition-purged`
 * BEFORE deleting anything, so a crash between the two leaves an event and a
 * file, never a deleted trail with no record.
 *
 * @param {string} partitionId
 * @param {object} deps  findEvents, recordEvent, [closeConnection], [now], [env]
 * @returns {{outcome:'purged', sealedSha256, rows, headHash, exportSha256}
 *          |{outcome:'refused', reason, eligibleAt?}|{outcome:'failed', reason:'unlink-failed'}}
 */
function purgePartition(partitionId, deps) {
  const sealedEvent = sealedInfoOf(latestEvent(deps.findEvents(['audit-partition-sealed'])));
  const exportEvents = exportInfosOf(deps.findEvents(['audit-partition-exported']));
  const status = partitionStatus(partitionId, { sealedEvent, exportEvents });
  const decision = purgeDecision({
    status, sealedEvent, exportEvents,
    retention: retentionPolicy(deps.env || process.env),
    now: deps.now instanceof Date ? deps.now : new Date(),
  });
  if (!decision.allowed) {
    if (decision.reason === 'modified-after-seal') {
      deps.recordEvent({ action: 'audit-partition-tamper-detected', after: { sealedSha256: sealedEvent.sha256, currentSha256: status.fileSha256 } });
    }
    deps.recordEvent({ action: 'audit-partition-purge-refused', after: { reason: decision.reason } });
    return { outcome: 'refused', reason: decision.reason, eligibleAt: decision.eligibleAt || null };
  }
  const exported = exportEvents.filter((e) => e.sealedSha256 === sealedEvent.sha256).pop();
  const detail = {
    sealedSha256: sealedEvent.sha256, rows: status.rows, headHash: status.headHash,
    exportSha256: exported ? exported.exportSha256 : null,
  };
  deps.recordEvent({ action: 'audit-partition-purged', after: detail }); // BEFORE the delete
  if (typeof deps.closeConnection === 'function') deps.closeConnection();
  try {
    purgePartitionFile(partitionId);
  } catch (e) {
    try {
      deps.recordEvent({ action: 'audit-partition-purge-failed', after: { reason: 'unlink-failed', code: e && e.code ? String(e.code) : null } });
    } catch (recordErr) { /* the generic failure below still surfaces */ }
    return { outcome: 'failed', reason: 'unlink-failed' };
  }
  return { outcome: 'purged', ...detail };
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
  lifecycleStatus,
  retentionPolicy,
  purgeEligibleAt,
  purgeDecision,
  purgePartitionFile,
  purgePartition,
  exportPartitionJsonl,
  exportPartition,
  EXPORT_BATCH_ROWS,
  LIFECYCLE_ACTIONS,
  sealedInfoOf,
  latestEvent,
  REFUSAL_MESSAGES,
};
