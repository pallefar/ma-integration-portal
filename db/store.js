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
const { ARRAY_COLLECTIONS, SINGLETON_KEYS, VERSIONED_COLLECTIONS, CLEARANCE_SCOPED_COLLECTIONS, PROVENANCE_SCOPED_COLLECTIONS, hasRestrictedProvenance, comparableVersion } = require('./collections');
const { openDbFile } = require('./dbFiles');
// AUD-01/D-08/D-09/D-11 (Phase 3 Plan 05): the store-layer audit hook.
// db/auditHook.js has NO require() back to this module (it opens its own
// independent connection to audit.db via db/dbFiles.js's openDbFile(), never
// via the getOrOpenConnection() cache below) — safe to require directly here.
const auditHook = require('./auditHook');

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
 * Close and evict the cached connection for ONE `dbFilePath`, if any is
 * currently open — a narrower sibling of closeAllConnections() above (which
 * is test-only teardown for the whole cache). This IS load-bearing in
 * production: db/controlStore.js's deleteDeal() (Plan 04, D-02) must call
 * this before unlinking a deal's database file — better-sqlite3 holds an OS
 * file handle for the process lifetime once opened, and on Windows an open
 * file cannot be unlinked at all; on POSIX it would otherwise leave a
 * dangling handle to a now-deleted inode. A no-op (returns false) if no
 * connection was ever cached for this path.
 */
function closeConnection(dbFilePath) {
  const key = path.resolve(dbFilePath);
  const cached = connectionCache.get(key);
  if (!cached) return false;
  try { cached.close(); } catch (e) { /* ignore */ }
  connectionCache.delete(key);
  return true;
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
 * CONC-02 (Phase 9, PD-3): the single typed-error shape a versioned write's
 * WHERE-clause mismatch throws inside writeDb()'s `.immediate` transaction —
 * the direct sibling of isBusyError()'s discrimination-by-SqliteError-code
 * (server.js), but discriminated by an own-property flag instead, since this
 * is an application-level throw, not a SqliteError. `detail` carries exactly
 * PD-3's fixed 409 body fields (conflictKind, collection, recordId,
 * currentRecord, currentVersion, changedBy, changedAt) so server.js's central
 * 409 middleware and this module's own conflict-throw sites share ONE
 * definition of the shape.
 */
function isConflictError(err) {
  return !!(err && err.isConflict === true);
}

function makeConflictError(detail) {
  const err = new Error(
    `db/store.js: writeDb() detected a version conflict on ${detail.collection}/${detail.recordId} (${detail.conflictKind})`
  );
  err.isConflict = true;
  err.conflictDetail = detail;
  return err;
}

// [security] CR-01 (09-REVIEW): the record echoed in a WHERE-layer conflict
// throw gets the SAME clearance treatment the route-level precheck
// (server.js conflictIfStale's clearanceFilter) gives it. The route arms
// `areaClearanceFilter` on the request's runWithDb() context; when no filter
// is armed for a CLEARANCE_SCOPED_COLLECTIONS member, fail closed and
// withhold the record entirely — version and attribution stay disclosed
// (the T-09-17 rule: field VALUES are withheld, never the fact of the
// conflict itself).
//
// [security] D-11-03 / 09-SECURITY UF-2 (Phase 11): the task/RAID lanes are
// clearance-scoped by PROVENANCE, not by a stored area, so their unarmed
// fallback is provenance-aware — a record with restricted provenance
// (clearanceArea stamp, or a dd-finding:/org-flightrisk: source) is withheld,
// an ordinary manual task/RAID entry is still echoed (the Phase 9 compare
// dialog is unchanged for it). Fail closed for a restricted record even if
// some future caller on these lanes forgets to arm a filter. An ARMED filter
// still decides for every collection, unchanged.
function conflictVisibleRecord(collectionKey, current, scoped) {
  const filter = scoped && scoped.areaClearanceFilter;
  if (typeof filter === 'function') return filter(collectionKey, current);
  if (PROVENANCE_SCOPED_COLLECTIONS.has(collectionKey)) {
    return hasRestrictedProvenance(current) ? null : current;
  }
  return CLEARANCE_SCOPED_COLLECTIONS.has(collectionKey) ? null : current;
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

  // AUD-01/D-08 (Phase 3 Plan 05): only collect a per-row delta list when
  // THIS request's resolved context is one of auditHook.AUDITED_DB_KINDS —
  // `scoped` is null/undefined outside any runWithDb() context (server
  // startup, migration scripts, every pre-Phase-3 test), and a demo write
  // must not pay for collecting deltas it will never use. `deltas` staying
  // `null` (not an empty array) is the signal below that this write is not
  // audited at all, distinct from "audited but produced zero rows".
  const scoped = requestDbStorage.getStore();
  const auditKind = scoped ? scoped.kind : null;
  const deltas = (scoped && auditHook.AUDITED_DB_KINDS.has(auditKind)) ? [] : null;

  // D-03/CONC-01 (Phase 8): .immediate acquires the write lock UP FRONT via
  // BEGIN IMMEDIATE, rather than a plain/deferred BEGIN that only acquires
  // the write lock the first time a write statement runs inside the
  // transaction. This avoids a mid-transaction lock-upgrade failure class —
  // without .immediate, a transaction that starts as a read and only later
  // attempts to write can hit SQLITE_BUSY_SNAPSHOT partway through, after
  // some statements may already have executed; .immediate fails fast, before
  // any statement in the body runs, if the lock cannot be acquired within
  // busy_timeout (db/dbFiles.js). The transaction BODY below is otherwise
  // unchanged — the snapshot-diff merge algorithm (see this function's own
  // doc comment above) is byte-identical to pre-Phase-8. No try/catch is
  // added around applyWrite(data) below — a SqliteError (including
  // SQLITE_BUSY*) must propagate uncaught through writeDb()'s existing
  // no-swallow contract so it reaches server.js's central 503 error
  // middleware (D-06).
  //
  // [security] CR-01 (Phase 8 review fix): the audit append (previously a
  // SEPARATE transaction dispatched only after this transaction had already
  // committed) now runs as the FINAL STEP of THIS SAME .immediate
  // transaction — see the comment immediately above the audit block below
  // for the full invariant this establishes.
  const applyWrite = conn.transaction((payload) => {
    for (const key of ARRAY_COLLECTIONS) {
      const beforeMap = before[key] || new Map();
      before[key] = beforeMap; // FA-4: so a later refresh below is visible to a second writeDb() call reusing this same snapshot.
      const afterArr = payload[key] || [];
      const afterIds = new Set();

      const insert = conn.prepare(
        `INSERT INTO ${key} (id, project_id, seq, data) VALUES (?, ?, ?, ?)`
      );
      const update = conn.prepare(
        `UPDATE ${key} SET project_id = ?, seq = ?, data = ? WHERE id = ?`
      );
      const del = conn.prepare(`DELETE FROM ${key} WHERE id = ?`);

      // CONC-02 (Phase 9, PD-1/PD-2/D-09): a versioned branch, taken ONLY
      // when this collection is in VERSIONED_COLLECTIONS — every other
      // collection's statements/behavior above are byte-for-byte unchanged.
      // The three extra prepared statements below are gated the same way,
      // so a non-versioned collection's writeDb() call pays zero extra
      // parse/plan cost.
      const versioned = VERSIONED_COLLECTIONS.has(key);
      // WR-04 (09-REVIEW round 2): the stored version is compared through the
      // SAME rule as db/collections.js comparableVersion() — a value that is
      // not a non-negative safe integer (JSON type text/real/true, a negative
      // or out-of-range integer) compares as 0. json_type (not the value
      // extractor, which maps JSON true to 1) decides "integer". A missing
      // (or JSON null) version still matches any expectation — the D-09
      // lazy-adoption arm, unchanged. Kept on ONE line: the structural test
      // requires every line naming the extractor to carry the bound `?`.
      const versionMatchSql = "(json_extract(data,'$.version') IS NULL OR (CASE WHEN json_type(data,'$.version') = 'integer' AND json_extract(data,'$.version') BETWEEN 0 AND 9007199254740991 THEN json_extract(data,'$.version') ELSE 0 END) = ?)";
      const versionedUpdate = versioned
        ? conn.prepare(
          `UPDATE ${key} SET project_id = ?, seq = ?, data = ? WHERE id = ? AND ${versionMatchSql}`
        )
        : null;
      const versionedDelete = versioned
        ? conn.prepare(
          `DELETE FROM ${key} WHERE id = ? AND ${versionMatchSql}`
        )
        : null;
      // Pitfall 5: changes===0 from either statement above cannot by itself
      // distinguish "stale version" from "row concurrently deleted" — this
      // disambiguating SELECT runs inside the SAME transaction (the write
      // lock is already held, so it adds no race) whenever that happens.
      const conflictSelect = versioned ? conn.prepare(`SELECT data FROM ${key} WHERE id = ?`) : null;

      afterArr.forEach((item, i) => {
        const id = idOf(item);
        afterIds.add(id);
        const priorRaw = beforeMap.get(id);
        if (priorRaw === undefined) {
          // This request's own snapshot never saw this id — genuinely new.
          // D-09: a freshly INSERTed row starts with no version field at
          // all (unversioned == version 0, the same lazy-adoption state as
          // a pre-Phase-9 legacy row) — its FIRST subsequent edit is what
          // stamps version:1, exactly like any other unstamped row.
          const serialized = JSON.stringify(item);
          insert.run(id, projectIdOf(item), i, serialized);
          if (deltas) deltas.push({ collection: key, rowId: id, action: 'insert', before: null, after: serialized });
        } else if (versioned) {
          // This request's own snapshot already had this id, and this
          // collection is version-checked (CONC-02/D-01/D-02: uniform
          // check, no exemptions — a single-field kanban status flip goes
          // through the identical path as a full edit).
          const priorObj = JSON.parse(priorRaw);
          const expectedVersion = comparableVersion(priorObj && priorObj.version);
          const candidate = JSON.stringify(item);
          if (candidate === priorRaw) {
            // CR-01 (Phase 1) + CONC-02 correctness: untouched-by-THIS-
            // writer, so no version bump — but writeDb()'s per-collection
            // loop still visits EVERY row in the array on EVERY call
            // (whole-object snapshot-diff, D-03), including ids this
            // writer never intended to touch. A plain unconditional
            // update() here would silently overwrite another process's
            // ALREADY-COMMITTED change to this same row with this
            // writer's now-stale copy of it — exactly the class of
            // cross-process clobber CONC-02 exists to close, just
            // reached through the "reorder/no-op" path instead of an
            // explicit edit. So this still goes through the SAME
            // version-checked WHERE clause as a real edit: on a match it
            // rewrites seq/data (preserving CR-01 reordering); on a
            // mismatch, someone else already changed (or deleted) this
            // row since this writer's own readDb() — since this writer
            // never intended to modify ITS CONTENT, that is silently NOT
            // this writer's conflict to raise; the other write's newer
            // state stands untouched (CR-02's no-resurrect precedent
            // applies identically when the row is now gone).
            const untouchedResult = versionedUpdate.run(projectIdOf(item), i, candidate, id, expectedVersion);
            if (untouchedResult.changes > 0 && deltas) {
              deltas.push({ collection: key, rowId: id, action: 'update', before: priorRaw, after: candidate });
            }
          } else {
            // A changed row is stamped BEFORE serialization (PD-1): version
            // becomes the numeric baseline (0 for a legacy/unstamped row)
            // plus one; updatedAt is the current ISO timestamp; updatedBy is
            // the request actor's username when one is resolvable from the
            // AsyncLocalStorage store (D-11-style — never synthesized), and
            // is left untouched when it is not (server startup, migration
            // scripts, tests) — Pitfall 10: never sourced from audit.db,
            // which structurally excludes demo-mode writes.
            item.version = expectedVersion + 1;
            item.updatedAt = new Date().toISOString();
            if (scoped && scoped.actor && scoped.actor.username) {
              item.updatedBy = scoped.actor.username;
            }
            const serialized = JSON.stringify(item);
            const result = versionedUpdate.run(projectIdOf(item), i, serialized, id, expectedVersion);
            if (result.changes === 0) {
              const row = conflictSelect.get(id);
              if (row) {
                // Row still exists: a genuine version conflict — someone
                // else's write landed between this request's readDb() and
                // this writeDb() call (the cross-process window Phase 8's
                // multi-process WAL model introduced).
                const current = JSON.parse(row.data);
                throw makeConflictError({
                  conflictKind: 'version', collection: key, recordId: id,
                  currentRecord: conflictVisibleRecord(key, current, scoped),
                  currentVersion: comparableVersion(current.version),
                  changedBy: current.updatedBy || null, changedAt: current.updatedAt || null,
                });
              }
              // PD-4: row is now gone — a concurrent delete, scoped ONLY to
              // versioned collections (every other collection keeps the
              // pre-Phase-9 CR-02 silent no-resurrect no-op verbatim).
              throw makeConflictError({
                conflictKind: 'deleted', collection: key, recordId: id,
                currentRecord: null, currentVersion: null, changedBy: null, changedAt: null,
              });
            }
            // FA-4: refresh THIS request's own snapshot for `id` so a
            // handler that calls writeDb(db) twice against one readDb()
            // result does not self-conflict on its own second call.
            beforeMap.set(id, serialized);
            if (deltas) deltas.push({ collection: key, rowId: id, action: 'update', before: priorRaw, after: serialized });
          }
        } else {
          // This request's own snapshot already had this id: always UPDATE
          // (never insert-or-upsert here). If the row still exists this
          // rewrites seq/data unconditionally, so reordering and non-tail
          // inserts persist (CR-01). If a concurrent writer already deleted
          // this row, the UPDATE affects 0 rows and does NOT resurrect it
          // (CR-02).
          const serialized = JSON.stringify(item);
          update.run(projectIdOf(item), i, serialized, id);
          if (deltas) deltas.push({ collection: key, rowId: id, action: 'update', before: priorRaw, after: serialized });
        }
      });

      // Only delete ids THIS request's own snapshot saw and no longer has —
      // never an id this request never knew about (never touch another
      // writer's concurrent same-collection addition).
      for (const id of beforeMap.keys()) {
        if (!afterIds.has(id)) {
          if (versioned) {
            // D-08 (Phase 9): a delete based on a stale version gets the
            // same typed conflict as an update — bound to THIS request's
            // own snapshot-remembered version, closing the same
            // cross-process window the update branch above closes.
            const priorRaw = beforeMap.get(id);
            const priorObj = JSON.parse(priorRaw);
            const expectedVersion = comparableVersion(priorObj && priorObj.version);
            const result = versionedDelete.run(id, expectedVersion);
            if (result.changes === 0) {
              const row = conflictSelect.get(id);
              if (row) {
                const current = JSON.parse(row.data);
                throw makeConflictError({
                  conflictKind: 'version', collection: key, recordId: id,
                  currentRecord: conflictVisibleRecord(key, current, scoped),
                  currentVersion: comparableVersion(current.version),
                  changedBy: current.updatedBy || null, changedAt: current.updatedAt || null,
                });
              }
              // Row already gone (concurrent delete elsewhere): this
              // writer's own intent — the record being gone — is already
              // satisfied. CR-02's idempotent no-resurrect no-op, not a
              // conflict.
            }
          } else {
            del.run(id);
          }
          if (deltas) deltas.push({ collection: key, rowId: id, action: 'delete', before: beforeMap.get(id), after: null });
        }
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

    // [security] AUD-01/D-09/D-11/CR-01 (Phase 8 review fix): the audit
    // append now runs as the FINAL STEP of THIS transaction, not as a
    // separate, later transaction dispatched only after this one had already
    // committed. It writes to a DIFFERENT connection (audit.db, via
    // auditHook.getAuditConnection()) than `conn` (this deal/control/demo
    // file's connection) — better-sqlite3's no-nested-transactions rule
    // applies per-connection, so acquiring audit.db's own `.immediate` lock
    // from inside `conn`'s transaction body is not a nested transaction and
    // is safe.
    //
    // Invariant this establishes: the deal-level write and its audit row now
    // succeed or fail TOGETHER. If the audit append is busy (SQLITE_BUSY* on
    // the contended, process-wide audit.db) or D-11's actor check below
    // throws, that error propagates out of THIS transaction body BEFORE
    // `conn` ever commits — better-sqlite3 rolls back every array/singleton
    // write this call just made, so no committed-but-unaudited row is ever
    // left behind. The error still propagates uncaught to server.js's
    // central 503 middleware exactly as before, but a 503 now truthfully
    // means "nothing persisted": the client's existing identical-payload
    // auto-retry (D-07, public/js/transitions.js) is genuinely safe, because
    // there is no already-committed row for a retry to duplicate (closes
    // review finding CR-01: previously, a busy audit append after an
    // already-committed deal write, followed by the client's automatic
    // retry, could silently double-insert an MNPI business record under a
    // fresh id).
    //
    // Accepted residual: if `conn`'s own COMMIT fails AFTER this audit
    // transaction has already committed (only reachable via a disk-level
    // I/O error on `conn` — a SQLITE_BUSY* on `conn` itself cannot occur
    // here, since this transaction already holds `conn`'s write lock via
    // `.immediate`), an audit row could still exist for an uncommitted deal
    // write. That direction remains detectable via the audit-vs-acknowledged
    // 1:1 reconciliation in scripts/soak.js's verification pass.
    if (deltas && deltas.length) {
      const actor = scoped.actor;
      if (!actor || !actor.username) {
        // D-11: never synthesize an actor here — an audited write reaching
        // this point with no resolved identity is a bug in the caller (a
        // request that should have 401'd, or a test/script that opened a
        // runWithDb() context without an actor), not something this hook may
        // silently paper over with an anonymous row. Thrown INSIDE the
        // transaction: the deal-level writes above are rolled back before
        // this error ever reaches writeDb()'s caller.
        throw new Error(
          `db/store.js: writeDb() resolved an audited context (kind=${auditKind}) with no attributed actor — refusing to write an anonymous audit row (D-11)`
        );
      }
      // Never swallowed: if the audit write itself throws (e.g. audit.db is
      // busy or unwritable), it propagates out of this transaction body —
      // rolling back the deal-level write above — through writeDb()'s
      // existing no-swallow error contract, so a silently-missing audit
      // entry can never look like an action that never happened, and a
      // rolled-back write can never look like it succeeded.
      auditHook.writeAuditBatch(auditHook.getAuditConnection(), {
        actor, dealId: scoped.dealId || null, dbKind: auditKind,
        request: scoped.request || null, ts: new Date().toISOString(), rows: deltas,
      });
    }
  }).immediate; // D-03/CONC-01: BEGIN IMMEDIATE — see comment above applyWrite's declaration

  applyWrite(data);

  return true; // preserves existing callers' truthy-return expectation
}

module.exports = {
  initDb, readDb, writeDb, idOf, projectIdOf, DEFAULT_DB_PATH, getConnection,
  // ISO-03 (Phase 3): request-scoped connection resolution.
  requestDbStorage, getOrOpenConnection, runWithDb, currentDbContext, closeAllConnections,
  closeConnection,
  // CONC-02 (Phase 9): the shared conflict-error predicate/factory — server.js
  // re-exports isConflictError the same way it exports isBusyError.
  isConflictError, makeConflictError,
};
