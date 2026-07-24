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

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { ARRAY_COLLECTIONS, SINGLETON_KEYS } = require('./collections');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'ma-portal.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;
let dbPath = null;

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
 * data/ma-portal.db), set the required pragmas, and ensure the schema exists.
 * Safe to call multiple times (e.g. once at server startup, or once per test
 * file against a fresh temp path) — CREATE TABLE IF NOT EXISTS makes repeated
 * calls against the same file idempotent.
 */
function initDb(dbFilePath) {
  const target = dbFilePath || DEFAULT_DB_PATH;
  if (db && dbPath === target) return db;
  if (db) { try { db.close(); } catch (e) { /* ignore */ } }

  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(target);
  dbPath = target;
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  // No-op today: schema.sql defines no FOREIGN KEY constraints (project_id is
  // deliberately just an indexed metadata column, per schema.sql's own
  // comment). Kept set now so a future phase that adds real FK constraints
  // gets enforcement for free without anyone remembering to flip this on.
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);

  return db;
}

function requireDb() {
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

module.exports = { initDb, readDb, writeDb, idOf, projectIdOf, DEFAULT_DB_PATH, getConnection };
