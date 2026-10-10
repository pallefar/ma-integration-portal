// D-12-03 (Phase 12): process-level database READINESS.
//
// One object per process records, for every schema-versioned database file
// that has been opened, the user_version it is at, and every failure (a
// migration that threw, a PRAGMA quick_check that did not return 'ok', a
// backup migration refused for lack of disk). GET /healthz reports the
// snapshot; db/dbFiles.js keeps a failed file refused (sticky) until restart.
//
// [security] T-12-52: /healthz is UNAUTHENTICATED, so nothing here may carry an
// absolute path or a deal id. A failure records the family, the migration id
// ('002-broken'), a fixed reason code and a BASENAME — and for the `deal`
// family (including demo.db, which shares the deal schema) the literal string
// `deal` instead of any file name, because a deal file is named after its id.
//
// Process-local on purpose: a replica set is out of scope (replicas:1, D-12-03);
// the on-disk truth is the file's own PRAGMA user_version.

const path = require('path');

// Fixed reason vocabulary (asserted by tests; never free text from an error).
const REASONS = Object.freeze({
  MIGRATION_FAILED: 'migration-failed',
  INTEGRITY_FAILED: 'integrity-check-failed',
  INSUFFICIENT_DISK: 'insufficient-disk-for-migration',
  COMMITTED_NEEDS_REGEN: 'committed-file-needs-regeneration',
});

class DbNotReadyError extends Error {
  constructor({ family, migration, reason }) {
    // The message is generic and path-free: it can reach a log line or (never,
    // by the central handler's fixed body) a response.
    super(`database not ready: family=${family}${migration ? ` migration=${migration}` : ''} reason=${reason}`);
    this.name = 'DbNotReadyError';
    this.code = 'DB_NOT_READY';
    this.family = family;
    this.migration = migration || null;
    this.reason = reason;
  }
}

// key (absolute path, never exposed) -> { family, version, implied }
const versions = new Map();
// key -> failure object (family, file, migration, reason) — de-duplicated per path+reason
const failures = new Map();

function exposedFile(family, file) {
  // A deal file AND a per-deal audit partition are named after the deal id
  // (an MNPI target pre-announcement) — never expose the basename (T-12-52).
  if (family === 'deal' || family === 'audit-partition') return family === 'deal' ? 'deal' : 'audit-partition';
  return file ? path.basename(String(file)) : null;
}

/**
 * Record a failure and return the DbNotReadyError to throw. `file` is the
 * database path (only its basename, or `deal`, is ever exposed).
 */
function markNotReady({ family, file, migration, reason }) {
  const key = `${family}|${file ? path.resolve(String(file)) : ''}|${migration || ''}|${reason}`;
  if (!failures.has(key)) {
    const entry = { family, file: exposedFile(family, file), reason };
    if (migration) entry.migration = migration;
    failures.set(key, entry);
  }
  return new DbNotReadyError({ family, migration, reason });
}

function recordVersion({ family, file, version, implied }) {
  const key = `${family}|${file ? path.resolve(String(file)) : ''}`;
  versions.set(key, { family, version, implied: implied === true });
}

function isReady() {
  return failures.size === 0;
}

function snapshot() {
  const out = {};
  for (const v of versions.values()) {
    const cur = out[v.family];
    if (!cur) {
      out[v.family] = { version: v.version, files: 1 };
      if (v.implied) out[v.family].implied = true;
    } else {
      cur.files += 1;
      if (v.version < cur.version) cur.version = v.version; // the family is only as new as its oldest file
      if (v.implied) cur.implied = true;
    }
  }
  return { ready: isReady(), failures: [...failures.values()], versions: out };
}

function _resetForTests() {
  versions.clear();
  failures.clear();
}

module.exports = { REASONS, DbNotReadyError, markNotReady, recordVersion, isReady, snapshot, _resetForTests };
