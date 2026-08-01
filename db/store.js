// SQLite-backed compatibility layer for the legacy db.json file-store API.
//
// Exposes initDb(path), readDb(), writeDb(data) with the EXACT same whole-object
// signatures server.js's ~90 endpoint call sites already depend on (D-03) — no
// endpoint changes required for this swap.
//
// readDb() reconstructs the full in-memory object from SQLite (one SELECT per
// collection, ORDER BY seq) and stamps a hidden, non-enumerable __snapshot onto
// the returned object: a per-collection Map of id -> the exact serialized JSON
// string stored at read time. writeDb(data) diffs data[key] against
// data.__snapshot[key] (THIS request's own read baseline, never live DB state,
// and REQUIRED — writeDb() throws if it's missing) inside one SQLite
// transaction: ids new to this request's snapshot are INSERTed, ids already in
// this request's snapshot are unconditionally UPDATEd (so seq/data are rewritten
// even when content is unchanged — this is what makes pure reorders and
// non-tail inserts persist, and an UPDATE against an already-deleted row is a
// harmless 0-row no-op rather than a resurrection), and only ids this request's
// own snapshot saw and dropped are deleted. This snapshot-tagged three-way merge
// is what closes both the same-collection lost-update race (D-04) — a
// concurrent add to the same collection by another reader/writer is never
// touched by this request's delete pass, because that id was never in this
// request's own snapshot to begin with — and the delete-vs-stale-edit race
// (a concurrently deleted row is never resurrected by a stale writer's UPDATE).
//
// Concrete algorithm per 01-RESEARCH.md "Code Examples" (readDb/writeDb
// reimplementation) and 01-PATTERNS.md ("server.js — readDb()/writeDb() rewrite").
//
// ISO-03 (Phase 3): this module now also generalizes "one connection" into
// "one connection per resolved database", with ZERO changes to any of the
// ~90 existing readDb()/writeDb() call sites. A `requestDbStorage`
// AsyncLocalStorage carries the CURRENT request's bound connection through
// whatever async call chain the request takes; `requireDb()` consults it
// FIRST and falls back to the pre-existing module singleton `db` only when
// there is no active request context (server startup, migration scripts,
// every pre-Phase-3 test that calls initDb()/readDb() directly) — that
// fallback is load-bearing, not defensive padding (03-RESEARCH.md Pattern 1).
// `getOrOpenConnection()` is the resolver's (and controlStore's) shared
// connection cache, delegating the actual open to db/dbFiles.js's
// `openDbFile()` so there is exactly one pragma contract in the codebase —
// initDb() itself now goes through the SAME cache/open path, not a second
// independent one, so the module singleton and a cache lookup for the same
// path are always the SAME underlying handle.

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { ARRAY_COLLECTIONS, SINGLETON_KEYS } = require('./collections');
const { openDbFile } = require('./dbFiles');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'ma-portal.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;
let dbPath = null;

// dbFilePath (resolved absolute) -> better-sqlite3 Database. Shared by
// initDb() (module singleton), db/resolver.js (per-request deal/demo/control
// binding) and db/controlStore.js (its own lazy control.db/runtime.db
// opens) — ONE cache, so two callers resolving the SAME path always get the
// SAME open handle (no duplicate connections to one file). No eviction
// policy this phase (03-RESEARCH.md Open Question 2) — handles live for the
// process lifetime, same as today's singleton.
const connectionCache = new Map();

/**
 * Open-or-reuse a connection to `dbFilePath`, applying `schemaPath`'s schema
 * idempotently on first open (db/dbFiles.js's openDbFile() — the single
 * pragma contract for every SQLite file this app opens). Safe to call
 * repeatedly with the same path; always returns the SAME handle.
 */
function getOrOpenConnection(dbFilePath, schemaPath) {
  const key = path.resolve(dbFilePath);
  const cached = connectionCache.get(key);
  if (cached) return cached;
  const conn = openDbFile(dbFilePath, schemaPath);
  connectionCache.set(key, conn);
  return conn;
}

/**
 * AsyncLocalStorage carrying the CURRENT request's bound database context:
 * `{ conn, kind, dealId, dbPath }` (db/resolver.js sets this once per
 * request, before any route handler runs). `undefined` outside any
 * runWithDb()/requestDbStorage.run() context — server startup, migration
 * scripts, and every test that calls readDb()/writeDb() directly all see
 * `undefined` here and fall back to the module singleton below, unchanged.
 */
const requestDbStorage = new AsyncLocalStorage();

/** Wrap `fn` so every readDb()/writeDb()/requireDb() call made during its
 * execution (including across awaits) resolves `context.conn` instead of the
 * module singleton. `context` is the same shape readDb()'s `__dbContext`
 * stamp and db/resolver.js's `req.dealContext` use: `{ conn, kind, dealId,
 * dbPath }`. */
function runWithDb(context, fn) {
  return requestDbStorage.run(context, fn);
}

/** The current request's bound database context, or `null` outside any
 * runWithDb() context — exported for db/auditHook.js (a later plan) and for
 * tests that want to assert the ALS binding directly without going through
 * readDb(). */
function currentDbContext() {
  return requestDbStorage.getStore() || null;
}

/** Test-only teardown: close every cached connection (module singleton
 * included) and clear the cache. Every existing test that wants a fully
 * isolated db/store.js module instance already does
 * `delete require.cache[require.resolve('../db/store.js')]` instead (module
 * state, including this Map, is per-require-cache-entry) — this export
 * exists for tests that instead want to close connections WITHOUT a module
 * reset (e.g. a test that opens several temp deal files and wants them all
 * closed at teardown without invalidating other still-referenced modules'
 * bindings to db/store.js). */
function closeAllConnections() {
  for (const conn of connectionCache.values()) {
    try { conn.close(); } catch (e) { /* ignore */ }
  }
  connectionCache.clear();
  db = null;
  dbPath = null;
}

/**
 * The item's own stable identity used as the SQLite row's primary key. Every
 * collection except `users` already carries an `id` field (newId()-minted,
 * never re-minted here). `users` items have no `id` field — they are keyed by
 * `username` (unique, stable) instead. This is purely an internal bookkeeping
 * key for the row/diff mechanism; the stored `data` column is the item's exact,
 * untouched JSON — this function never mutates or adds fields to the item.
 */
function idOf(item) {
  if (item && item.id !== undefined && item.id !== null) return String(item.id);
  if (item && item.username !== undefined && item.username !== null) return String(item.username);
  throw new Error('db/store.js: item has neither an id nor a username field — cannot key it for storage');
}

function projectIdOf(item) {
  if (!item) return null;
  if (item.projectId !== undefined && item.projectId !== null) return String(item.projectId);
  if (item.project_id !== undefined && item.project_id !== null) return String(item.project_id);
  return null;
}

/**
 * Open (or re-open) the SQLite database at `dbFilePath` (defaulting to
 * data/ma-portal.db — the legacy pre-Phase-3 default, retained only as a
 * fallback for any caller that still invokes initDb() with no argument; the
 * live app itself always passes an explicit path since Phase 3's cutover,
 * see server.js startup), set the required pragmas, and ensure the schema
 * exists. Safe to call multiple times (e.g. once at server startup, or once
 * per test file against a fresh temp path) — CREATE TABLE IF NOT EXISTS
 * makes repeated calls against the same file idempotent. Delegates the
 * actual open to getOrOpenConnection() (the SAME cache db/resolver.js and
 * db/controlStore.js use) so the module singleton is never a second,
 * independent connection to a file another caller already has open.
 */
function initDb(dbFilePath) {
  const target = dbFilePath || DEFAULT_DB_PATH;
  if (db && dbPath === target) return db;
  db = getOrOpenConnection(target, SCHEMA_PATH);
  dbPath = target;
  return db;
}

/**
 * Resolve the connection THIS call should use: the current request's
 * AsyncLocalStorage-bound connection if one exists (db/resolver.js's
 * dealResolverMiddleware set it), otherwise the module singleton opened by
 * initDb() — UNCHANGED fallback behavior for server startup, migration
 * scripts and every pre-Phase-3 test (03-RESEARCH.md Pattern 1).
 */
function requireDb() {
  const scoped = requestDbStorage.getStore();
  if (scoped && scoped.conn) return scoped.conn;
  if (!db) throw new Error('db/store.js: initDb() must be called before readDb()/writeDb()');
  return db;
}

/**
 * Expose the single shared connection to sibling modules that need direct SQL
 * access outside the whole-object readDb()/writeDb() API (e.g. db/sessions.js,
 * Phase 2 AUTH-03) — so they share the SAME open handle/pragmas rather than
 * opening a second Database instance on the same file.
 */
function getConnection() {
  return requireDb();
}

/**
 * Reconstruct the full whole-object database from SQLite. Throws (does not
 * silently return an empty object) on any unrecoverable read failure — the
 * throw-on-failure contract server.js's endpoints already depend on.
 */
function readDb() {
  const conn = requireDb();
  const out = {};
  const snapshot = {};

  for (const key of ARRAY_COLLECTIONS) {
    const rows = conn.prepare(`SELECT id, data FROM ${key} ORDER BY seq`).all();
    out[key] = rows.map((r) => JSON.parse(r.data));
    // The stored `data` string is exactly what was written (JSON.stringify at
    // write time) — string comparison against it is a cheap, exact "did this
    // row change since I read it" check with no re-serialization needed.
    snapshot[key] = new Map(rows.map((r) => [r.id, r.data]));
  }
  for (const key of SINGLETON_KEYS) {
    const row = conn.prepare('SELECT data FROM app_state WHERE key = ?').get(key);
    out[key] = row ? JSON.parse(row.data) : undefined;
  }

  // Non-enumerable: never leaks into JSON.stringify(db)/res.json(db) responses,
  // and Object.keys(db) never exposes it — dozens of endpoints serialize the
  // read-model object straight to API clients.
  Object.defineProperty(out, '__snapshot', { value: snapshot, enumerable: false, configurable: true });

  // ISO-03: which physical database this read actually came from, stamped
  // the same non-enumerable way as __snapshot so a later plan's audit hook
  // (db/auditHook.js, Plan 05) can tell which database a write is landing in
  // without a second AsyncLocalStorage lookup of its own. `null` outside any
  // request context (server startup, migration scripts, pre-Phase-3 tests).
  const scoped = requestDbStorage.getStore();
  const dbContext = scoped
    ? { kind: scoped.kind, dealId: scoped.dealId, dbPath: scoped.dbPath }
    : { kind: null, dealId: null, dbPath };
  Object.defineProperty(out, '__dbContext', { value: dbContext, enumerable: false, configurable: true });
  return out;
}

/**
 * Transactional, per-collection snapshot-diff merge. Diffs data[key] against
 * data.__snapshot[key] (the caller's own read baseline captured by readDb()),
 * NOT against current live DB state — this is the mechanism that prevents a
 * concurrent writer's same-collection addition from being deleted by this
 * write (D-04). `data.__snapshot` is REQUIRED — writeDb() throws rather than
 * silently treating a missing snapshot as "nothing to diff against", since
 * that would silently degrade into never deleting anything.
 *
 * Per-item merge rule, keyed on whether this request's OWN snapshot already
 * had the id (not on whether the content changed):
 *   - id NOT in this request's snapshot -> genuinely new this request -> INSERT.
 *   - id IS in this request's snapshot -> UPDATE unconditionally (never a
 *     skip-if-unchanged upsert). This is deliberate, not a missed
 *     optimization: an UPDATE rewrites `seq`/`data` even when content is
 *     unchanged, so a pure reorder (or a non-tail insert that shifts
 *     trailing items' positions) actually persists (CR-01) — and if a
 *     concurrent writer already DELETEd that row, the UPDATE affects 0 rows
 *     instead of resurrecting it (CR-02), because UPDATE (unlike INSERT ...
 *     ON CONFLICT DO UPDATE) can never re-create a row that no longer
 *     exists.
 * A prepare() call is issued for every array collection on every writeDb()
 * call regardless of whether that collection has any delta (only the
 * .run() execution is conditional) — this is a parse/plan round-trip, not
 * "no SQL issued", contrary to what an earlier version of this comment
 * claimed.
 *
 * Throws on unrecoverable failure (better-sqlite3's db.transaction()
 * re-throws and rolls back automatically).
 */
function writeDb(data) {
  const conn = requireDb();
  if (!data || !data.__snapshot) {
    throw new Error('writeDb(): data was not produced by readDb() — missing __snapshot');
  }
  const before = data.__snapshot;

  const applyWrite = conn.transaction((payload) => {
    for (const key of ARRAY_COLLECTIONS) {
      const beforeMap = before[key] || new Map();
      const afterArr = payload[key] || [];
      const afterIds = new Set();

      const insert = conn.prepare(
        `INSERT INTO ${key} (id, project_id, seq, data) VALUES (?, ?, ?, ?)`
      );
      const update = conn.prepare(
        `UPDATE ${key} SET project_id = ?, seq = ?, data = ? WHERE id = ?`
      );
      const del = conn.prepare(`DELETE FROM ${key} WHERE id = ?`);

      afterArr.forEach((item, i) => {
        const id = idOf(item);
        afterIds.add(id);
        const serialized = JSON.stringify(item);
        if (beforeMap.get(id) === undefined) {
          // This request's own snapshot never saw this id — genuinely new.
          insert.run(id, projectIdOf(item), i, serialized);
        } else {
          // This request's own snapshot already had this id: always UPDATE
          // (never insert-or-upsert here). If the row still exists this
          // rewrites seq/data unconditionally, so reordering and non-tail
          // inserts persist (CR-01). If a concurrent writer already deleted
          // this row, the UPDATE affects 0 rows and does NOT resurrect it
          // (CR-02).
          update.run(projectIdOf(item), i, serialized, id);
        }
      });

      // Only delete ids THIS request's own snapshot saw and no longer has —
      // never an id this request never knew about (never touch another
      // writer's concurrent same-collection addition).
      for (const id of beforeMap.keys()) {
        if (!afterIds.has(id)) del.run(id);
      }
    }

    for (const key of SINGLETON_KEYS) {
      if (payload[key] !== undefined) {
        conn.prepare(
          `INSERT INTO app_state (key, data) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET data = excluded.data`
        ).run(key, JSON.stringify(payload[key]));
      }
    }
  });

  applyWrite(data);
  return true; // preserves existing callers' truthy-return expectation
}

module.exports = {
  initDb, readDb, writeDb, idOf, projectIdOf, DEFAULT_DB_PATH, getConnection,
  // ISO-03 (Phase 3): request-scoped connection resolution.
  requestDbStorage, getOrOpenConnection, runWithDb, currentDbContext, closeAllConnections,
};
