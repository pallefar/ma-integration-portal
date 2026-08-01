// ISO-01 / AUD-02: single source of truth for every Phase-3 database file path
// and the shared "open + pragma + schema" contract that opens each of them.
//
// WHY centralized: Phase 3 introduces four new physical database files
// (control.db, runtime.db, audit.db, one deals/<id>.db per deal) on top of
// the existing demo.db. Two independent path strings for the same file is
// exactly how a .gitignore entry and a real file drift apart — the leak this
// plan's Task 2 pre-empted (T-03-01) only stays closed if every later
// consumer (the resolver, the audit hook, the split migration, tests) reads
// the path from HERE rather than re-deriving it. No caching lives in this
// module — the connection cache is the resolver's job (Plan 03).
//
// openDbFile() reproduces db/store.js's initDb() pragma contract exactly
// (journal_mode WAL, synchronous NORMAL, foreign_keys ON, busy_timeout 5000)
// so every new file is opened under the same concurrency-safety guarantees
// Phase 1 already established for data/ma-portal.db — this is one storage-
// layer contract, not two.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');

// --- Database file paths -----------------------------------------------
// Each path is overridable via an env var (unset in every real deployment —
// production always resolves the real data/ paths below). This is what lets
// a test boot the REAL requireable app (`require('../server.js')`) against
// isolated temp control/runtime/demo/deal files instead of the live,
// committed data/*.db — the exact need Plan 03's own read_first calls out
// ("booting the requireable app against temp control/runtime/demo/deal
// files"), without threading a path parameter through every module that
// resolves one of these constants at require time (server.js, db/store.js,
// db/resolver.js, db/controlStore.js, db/dealSeed.js, the split script).
const CONTROL_DB_PATH = process.env.MA_CONTROL_DB_PATH || path.join(DATA_DIR, 'control.db');
const RUNTIME_DB_PATH = process.env.MA_RUNTIME_DB_PATH || path.join(DATA_DIR, 'runtime.db');
const AUDIT_DB_PATH = process.env.MA_AUDIT_DB_PATH || path.join(DATA_DIR, 'audit.db');
const DEMO_DB_PATH = process.env.MA_DEMO_DB_PATH || path.join(DATA_DIR, 'demo.db');
const DEALS_DIR = process.env.MA_DEALS_DIR || path.join(DATA_DIR, 'deals');

// --- Schema file paths ---------------------------------------------------
const CONTROL_SCHEMA_PATH = path.join(__dirname, 'control-schema.sql');
const RUNTIME_SCHEMA_PATH = path.join(__dirname, 'runtime-schema.sql');
const AUDIT_SCHEMA_PATH = path.join(__dirname, 'audit-schema.sql');
// Per D-06 ("same schema as demo"), a real deal's per-deal database and the
// demo database share the existing Phase-1 schema — no new deal-specific
// schema file.
const DEAL_SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Deal ids are minted by newId('deal') (server.js's existing newId()
// convention: `${prefix}_${Date.now().toString(36)}${randomHex}`) — lowercase
// alphanumeric after the `deal_` prefix. Anything else (a path separator, a
// `..` segment, or an id from an untrusted source) must never reach
// path.join() below, which is the only thing standing between a caller-
// supplied string and an arbitrary filesystem write (T-03-03).
const DEAL_ID_RE = /^deal_[a-z0-9]+$/i;

/**
 * Build the on-disk path for a single deal's database file. Throws (does not
 * sanitize/truncate/best-effort-fix) for any id that does not match the
 * expected `deal_<alphanumeric>` shape, so a path-traversal or separator
 * character can never escape DEALS_DIR.
 */
function dealDbPath(dealId) {
  if (typeof dealId !== 'string' || !DEAL_ID_RE.test(dealId)) {
    throw new Error(`db/dbFiles.js: dealDbPath() rejected invalid dealId: ${JSON.stringify(dealId)}`);
  }
  return path.join(DEALS_DIR, `${dealId}.db`);
}

/**
 * Open (or create) the SQLite file at `dbFilePath`, apply the Phase-1 pragma
 * contract, and apply `schemaPath`'s schema idempotently (CREATE TABLE/INDEX/
 * TRIGGER IF NOT EXISTS, so re-opening an existing file is a no-op). Always
 * returns a NEW connection — callers that want a shared/cached handle (the
 * resolver, Plan 03) own that caching themselves.
 */
function openDbFile(dbFilePath, schemaPath) {
  const dir = path.dirname(dbFilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const conn = new Database(dbFilePath);
  conn.pragma('journal_mode = WAL');
  conn.pragma('synchronous = NORMAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 5000');

  const schema = fs.readFileSync(schemaPath, 'utf8');
  conn.exec(schema);

  return conn;
}

module.exports = {
  CONTROL_DB_PATH,
  RUNTIME_DB_PATH,
  AUDIT_DB_PATH,
  DEMO_DB_PATH,
  DEALS_DIR,
  CONTROL_SCHEMA_PATH,
  RUNTIME_SCHEMA_PATH,
  AUDIT_SCHEMA_PATH,
  DEAL_SCHEMA_PATH,
  dealDbPath,
  openDbFile,
};
