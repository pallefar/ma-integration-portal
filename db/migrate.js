// D-12-03 (Phase 12, DATA-03): schema versioning + ordered forward-only
// migrations for every SQLite file the app opens.
//
// Every database file carries `PRAGMA user_version`. db/dbFiles.js openDbFile()
// calls runMigrations() on each open of a file whose schema argument names a
// known family; this module owns what "the file's version" means and how a file
// moves forward. Migrations run AT BOOT, never inside a request (server.js
// opens every file family before listen — see its `bootOpen` statements).
//
// FAMILIES. The family is derived from the schema file passed to openDbFile():
//   control  db/control-schema.sql   (data/control.db)
//   runtime  db/runtime-schema.sql   (data/runtime.db)
//   deal     db/schema.sql           (data/demo.db and every deals/<id>.db)
//   audit    db/audit-schema.sql     (data/audit.db — migrations arrive with the
//                                     audit partition work; none yet)
// A schema file outside this list (a test-only custom schema) is left alone:
// no family, no version, no checks.
//
// LAYOUT. db/migrations/<family>/NNN-<slug>.js, ids contiguous from 1. A module
// exports `{ id, slug, up(conn, ctx), requiredTables?, backup?, precheck? }`
// (`precheck(conn, ctx)`: read-only, runs before the backup, throws to refuse) and is
// validated at load: `id` equals the NNN prefix, `slug` equals the file slug.
// A family whose directory does not exist yet has latest version 0.
//
// SEMANTICS.
//   - A FRESH file (no user tables) is created from its schema and stamped
//     straight at the family's latest version; no migration's up() runs.
//   - An EXISTING file runs its pending migrations BEFORE the idempotent schema
//     exec. Each migration and its user_version bump share ONE BEGIN IMMEDIATE
//     transaction with the version re-read under the lock, so two processes
//     opening the same file never run one migration twice.
//   - A migration that throws rolls back (the file stays at its previous
//     version), the failure is recorded in db/readiness.js and the file is
//     refused (sticky) until restart. SQLITE_BUSY* during a migration is plain
//     lock contention, not a failure: it propagates unchanged to the normal
//     retryable 503.
//   - COMMITTED files (data/demo.db, data/control.db) are NEVER written by the
//     runner (PD-5): at user_version 0 with every baseline table present they
//     are REPORTED as version 1 (`implied`); anything beyond the baseline
//     pending on a committed file marks not-ready instead of writing.
//   - `backup: true` migrations first take `VACUUM INTO '<file>.pre-v<id>.bak'`
//     (0600) outside the transaction, after a free-space precondition of
//     3 x file size + 64 MB (PD-28).
//
// AUTHORING RULES.
//   1. forward-only: there is no down(). A migration moves a file from id-1 to
//      id and nothing moves it back.
//   2. NEVER edit a released migration — add a new NNN-<slug>.js. A released
//      id is already stamped into files in the field; changing its body would
//      make "version N" mean two different schemas.
//   3. A migration is additive and idempotent where it can be: it runs before
//      the family schema's own `CREATE ... IF NOT EXISTS` exec, so a new table
//      or column belongs in BOTH the schema file (fresh files) and a migration
//      (existing files). Fresh files never run up() — they are stamped.
//   4. Heavy or destructive migrations set `backup: true` (see above).
//   5. Committed demo/control files (PD-5): if a non-baseline migration is ever
//      needed for data/demo.db or data/control.db, regenerate those files with a
//      dedicated script in a deliberate commit — a boot never writes them, and a
//      pending migration on one reports not-ready
//      ('committed-file-needs-regeneration').
//
// NOT-READY. A failed migration, a failed PRAGMA quick_check, a refused backup
// or a committed file that would need a write records a failure in
// db/readiness.js and keeps THAT file refused until restart (sticky, per path);
// GET /healthz answers 503 `not-ready` with the family, migration id and reason,
// and every request that needs the file fails closed (503, retryable:false).
// The instance keeps listening so the failure is reportable.
//
// ROLLBACK PATH. Migrations are forward-only, so recovery is a restore, not an
// undo: stop the service, restore the data directory from the last WAL-aware
// backup taken BEFORE upgrading (a `backup: true` migration also leaves
// `<file>.pre-v<id>.bak`), start the previous release. The stamp-only baselines
// need no rollback at all: an older release ignores `user_version`, so a file
// stamped at version 1 opens unchanged in a pre-Phase-12 release.
//
// [security] MA_MIGRATIONS_DIR (test-only) loads CODE from an alternative
// directory; with MA_MODE=real a set value is a [security] fatal at require
// time (T-12-53).

const fs = require('fs');
const path = require('path');
const readiness = require('./readiness');

// 'audit-partition' (D-12-04, plan 12-08): data/audit/<dealId>.db and legacy.db.
const FAMILIES = Object.freeze(['control', 'runtime', 'deal', 'audit', 'audit-partition']);
const BUILTIN_ROOT = path.join(__dirname, 'migrations');
const MIN_FREE_FLOOR_BYTES = 64 * 1024 * 1024; // PD-28
const FREE_SPACE_MULTIPLIER = 3;               // backup + partition copy + rebuilt file/WAL at peak

const REAL_MODE = process.env.MA_MODE === 'real';

function assertMigrationsDirAllowed() {
  if (REAL_MODE && process.env.MA_MIGRATIONS_DIR) {
    throw new Error(
      '[security] MA_MIGRATIONS_DIR is set with MA_MODE=real — migration modules are executable code and a real-deal host ' +
      'must only ever run the migrations shipped in db/migrations. Unset MA_MIGRATIONS_DIR.'
    );
  }
}
assertMigrationsDirAllowed(); // refuse at require time, before any database is opened

function isBusy(err) {
  return !!(err && typeof err.code === 'string' && err.code.startsWith('SQLITE_BUSY'));
}

const FILE_RE = /^(\d{3})-([a-z0-9][a-z0-9-]*)\.js$/;
const loadCache = new Map(); // absolute family dir -> validated migration list

function familyDir(family) {
  if (!FAMILIES.includes(family)) throw new Error(`db/migrate.js: unknown database family ${JSON.stringify(family)}`);
  assertMigrationsDirAllowed();
  const override = process.env.MA_MIGRATIONS_DIR;
  if (override) {
    const candidate = path.join(path.resolve(override), family);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(BUILTIN_ROOT, family);
}

/**
 * Load + validate the ordered migration list of `family`. A missing family
 * directory yields []. Throws (plain Error — a broken shipped layout is a
 * programming error, not a not-ready database) on a bad file name, an id that
 * does not match its prefix, a gap, or a module without up().
 */
function loadMigrations(family) {
  const dir = familyDir(family);
  if (loadCache.has(dir)) return loadCache.get(dir);
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.js')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  names.sort();
  const list = names.map((name, index) => {
    const m = FILE_RE.exec(name);
    if (!m) throw new Error(`db/migrate.js: ${family}/${name} does not match NNN-<slug>.js`);
    const id = Number(m[1]);
    if (id !== index + 1) throw new Error(`db/migrate.js: ${family} migration ids must be contiguous from 1 — ${name} is at position ${index + 1}`);
    const mod = require(path.join(dir, name)); // eslint-disable-line global-require
    if (!mod || mod.id !== id) throw new Error(`db/migrate.js: ${family}/${name} exports id ${mod && mod.id}, expected ${id}`);
    if (typeof mod.slug === 'string' && mod.slug !== m[2]) throw new Error(`db/migrate.js: ${family}/${name} exports slug ${mod.slug}`);
    if (typeof mod.up !== 'function') throw new Error(`db/migrate.js: ${family}/${name} must export up(conn, ctx)`);
    return Object.freeze({
      id,
      slug: m[2],
      name: `${m[1]}-${m[2]}`,
      up: mod.up,
      precheck: typeof mod.precheck === 'function' ? mod.precheck : null,
      backup: mod.backup === true,
      requiredTables: Array.isArray(mod.requiredTables) ? mod.requiredTables.slice() : [],
    });
  });
  loadCache.set(dir, list);
  return list;
}

function latestVersion(family) {
  const list = loadMigrations(family);
  return list.length ? list[list.length - 1].id : 0;
}

function currentVersion(conn) {
  return conn.pragma('user_version', { simple: true });
}

function userTables(conn) {
  return conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
}

/** True when the file holds no user tables at all (a brand-new / empty file). */
function isFresh(conn) {
  return userTables(conn).length === 0;
}

function sidecarBytes(file) {
  let total = 0;
  for (const suffix of ['', '-wal']) {
    try { total += fs.statSync(file + suffix).size; } catch (e) { /* absent */ }
  }
  return total;
}

function realFreeBytes(dir) {
  const s = fs.statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}

function removeQuiet(file) {
  try { fs.unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}

// PD-28: take the pre-migration backup of a `backup: true` migration.
function takeBackup(conn, file, mig, opts) {
  const size = sidecarBytes(file);
  const injected = !REAL_MODE && opts.freeBytes !== undefined && opts.freeBytes !== null;
  let free;
  if (injected) free = typeof opts.freeBytes === 'function' ? opts.freeBytes() : Number(opts.freeBytes);
  else free = realFreeBytes(path.dirname(path.resolve(file)));
  const needed = FREE_SPACE_MULTIPLIER * size + MIN_FREE_FLOOR_BYTES;
  if (free < needed) {
    // reason 'insufficient-disk-for-migration' (readiness.REASONS.INSUFFICIENT_DISK): nothing is written.
    throw readiness.markNotReady({ family: opts.family, file, migration: mig.name, reason: readiness.REASONS.INSUFFICIENT_DISK });
  }
  const bak = `${file}.pre-v${mig.id}.bak`;
  // A .bak left by an interrupted earlier attempt: the file is still below
  // version `id` (the failed migration rolled back), so it is replaced.
  removeQuiet(bak);
  try {
    conn.exec(`VACUUM INTO '${bak.replace(/'/g, "''")}'`);
    fs.chmodSync(bak, 0o600);
  } catch (e) {
    removeQuiet(bak); // never leave a partial backup behind
    throw e;
  }
}

/**
 * Bring `conn` (an open connection to `file`) to the family's latest version.
 *
 *   fresh      the caller has exec'd the schema; stamp the latest version.
 *   committed  never write; version-0 baseline files are REPORTED as 1.
 *   freeBytes  test-only free-space injection (number | () => number); ignored
 *              when MA_MODE=real.
 *
 * Throws readiness.DbNotReadyError (already recorded) on a failed migration, a
 * refused backup or a committed file that would need a write; an SQLITE_BUSY*
 * error propagates unchanged.
 */
function runMigrations(conn, { family, file, fresh, committed, freeBytes } = {}) {
  const migrations = loadMigrations(family);
  const latest = migrations.length ? migrations[migrations.length - 1].id : 0;

  if (fresh) {
    if (latest > 0) conn.pragma(`user_version = ${latest}`);
    readiness.recordVersion({ family, file, version: latest });
    return { version: latest, fresh: true };
  }

  let current = currentVersion(conn);

  if (committed) {
    if (current >= latest) {
      readiness.recordVersion({ family, file, version: current });
      return { version: current, committed: true };
    }
    // Only the baseline may be implied; it must be provably satisfied.
    let pendingFrom = current;
    if (current === 0 && migrations.length > 0) {
      const have = new Set(userTables(conn));
      const baselineHolds = migrations[0].requiredTables.length > 0
        && migrations[0].requiredTables.every((t) => have.has(t));
      if (baselineHolds) {
        if (latest === 1) {
          readiness.recordVersion({ family, file, version: 1, implied: true });
          return { version: 1, implied: true, committed: true };
        }
        pendingFrom = 1; // the baseline is implied; what is pending is beyond it
      }
    }
    throw readiness.markNotReady({
      family, file, migration: migrations[pendingFrom] ? migrations[pendingFrom].name : undefined,
      reason: readiness.REASONS.COMMITTED_NEEDS_REGEN,
    });
  }

  for (const mig of migrations) {
    if (mig.id <= current) continue;
    try {
      // An optional read-only precondition runs BEFORE the backup, so a
      // migration that must fail closed (12-REVIEW WR-02) writes nothing at all.
      if (mig.precheck && currentVersion(conn) < mig.id) mig.precheck(conn, { family, file, id: mig.id, name: mig.name });
      if (mig.backup && currentVersion(conn) < mig.id) takeBackup(conn, file, mig, { family, freeBytes });
      const apply = conn.transaction(() => {
        const v = currentVersion(conn); // re-read under the write lock
        if (v >= mig.id) return false;
        mig.up(conn, { family, file, id: mig.id, name: mig.name });
        conn.pragma(`user_version = ${mig.id}`);
        return true;
      });
      apply.immediate();
      current = Math.max(current, mig.id);
    } catch (e) {
      if (e instanceof readiness.DbNotReadyError) throw e;
      if (isBusy(e)) throw e;
      throw readiness.markNotReady({ family, file, migration: mig.name, reason: readiness.REASONS.MIGRATION_FAILED });
    }
  }
  const finalVersion = currentVersion(conn);
  readiness.recordVersion({ family, file, version: finalVersion });
  return { version: finalVersion };
}

module.exports = {
  FAMILIES,
  loadMigrations,
  latestVersion,
  runMigrations,
  isFresh,
  currentVersion,
};
