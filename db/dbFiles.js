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
// (journal_mode WAL, synchronous NORMAL, foreign_keys ON, busy_timeout 1000)
// so every new file is opened under the same concurrency-safety guarantees
// Phase 1 already established for data/ma-portal.db — this is one storage-
// layer contract, not two.
//
// D-03/D-05/CONC-01 (Phase 8): busy_timeout is 1000ms (was 5000ms pre-Phase-8)
// — the server-side contention budget is ~1 second, and the wait happens
// INSIDE SQLite (a blocking C-level wait), not in an app-level retry loop.
// D-04: because better-sqlite3 is synchronous, a contended write blocks that
// process's event loop for the duration of the wait, so every user served by
// that process stalls for up to ~1s while one write waits for another. This
// is accepted eyes-open at ~15-person deal-team scale (the reason the budget
// is 1s rather than the previous 5s) — do NOT add async machinery, a worker
// thread, or a promise-based retry wrapper to avoid it; that would mean
// converting ~90 synchronous writeDb()/readDb() call sites (D-03's explicit
// non-goal). A writer that exhausts this budget throws a SqliteError with
// `.code` starting 'SQLITE_BUSY', which propagates uncaught to server.js's
// central error middleware and becomes a 503 Retry-After (D-06).

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const migrate = require('./migrate');
const readiness = require('./readiness');

// [security] D-10-01 (Phase 10): the REAL-DEAL MODE CONTRACT lives here, at the
// single source of truth for every database path. `MA_MODE=real` is the one and
// only switch that makes a host a real-deal host:
//   - the data directory becomes MA_DATA_DIR (default <repo>/data/real, 0700,
//     gitignored) instead of the committed <repo>/data — real acquisition data
//     is MNPI and must never land in a file git tracks;
//   - the committed data/control.db and data/demo.db are NEVER opened for
//     writing: ensureRealDataDir() (db/realDataDir.js) refuses a boot whose
//     resolved paths hit them, and openDbFile() below throws on one — the
//     second line of defence, because every open in the codebase funnels
//     through that one function;
//   - any MA_MODE value other than unset/empty/"real" throws at require time:
//     a typo ("REAL", "prod") silently falling back to dev on a real host would
//     leave it serving published demo credentials (T-10-05), so it is refused;
//   - MA_MODE=real together with DEMO_OPEN=1 throws: a real host can never be
//     demo-open.
// MA_*_PATH / MA_DEALS_DIR overrides keep their existing precedence (they win
// over MA_DATA_DIR) — tests and unusual layouts depend on that; the committed-
// path refusals above still apply to whatever those overrides resolve to.
const REPO_ROOT = path.join(__dirname, '..');

/**
 * Pure mode resolution (exported for tests). Throws an Error prefixed
 * `[security]` for every invalid combination; never reads the filesystem.
 */
function resolveModeConfig(env, repoRoot) {
  const e = env || {};
  const committedDataDir = path.join(repoRoot, 'data');
  const rawMode = e.MA_MODE;
  if (rawMode !== undefined && rawMode !== '' && rawMode !== 'real') {
    throw new Error(
      `[security] MA_MODE=${JSON.stringify(String(rawMode))} is not recognised — the only accepted value is "real" (or leave MA_MODE unset). ` +
      'Refusing to boot rather than silently falling back to dev/demo behaviour on what may be a real-deal host.'
    );
  }
  const real = rawMode === 'real';
  const demoOpen = e.DEMO_OPEN === '1';
  if (real && demoOpen) {
    throw new Error('[security] MA_MODE=real together with DEMO_OPEN=1 — real-deal mode can never be demo-open. Unset DEMO_OPEN for a real-deal host.');
  }
  if (real) {
    const dataDir = path.resolve(e.MA_DATA_DIR || path.join(repoRoot, 'data', 'real'));
    if (dataDir === path.resolve(committedDataDir)) {
      throw new Error(`[security] MA_DATA_DIR resolves to the committed data directory (${dataDir}) — real-deal mode needs its own gitignored data directory (default data/real).`);
    }
    return { mode: 'real', demoOpen: false, dataDir, committedDataDir };
  }
  return { mode: demoOpen ? 'demo' : 'dev', demoOpen, dataDir: committedDataDir, committedDataDir };
}

const MODE_CONFIG = resolveModeConfig(process.env, REPO_ROOT);
const MODE = MODE_CONFIG.mode;
const IS_REAL_MODE = MODE === 'real';
const DATA_DIR = MODE_CONFIG.dataDir;
const COMMITTED_DATA_DIR = MODE_CONFIG.committedDataDir;
const COMMITTED_CONTROL_DB_PATH = path.join(COMMITTED_DATA_DIR, 'control.db');
const COMMITTED_DEMO_DB_PATH = path.join(COMMITTED_DATA_DIR, 'demo.db');

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

// D-10-01: every identity a path can be known by — the lexical absolute path
// AND, when the file exists, its realpath (defeats symlinks and
// `./data/../data/control.db` spellings).
function pathIdentities(p) {
  const ids = new Set([path.resolve(p)]);
  try { ids.add(fs.realpathSync(p)); } catch (e) { /* not on disk yet — lexical identity only */ }
  return ids;
}

/**
 * D-10-01: true when `p` is one of the two committed database files
 * (data/control.db, data/demo.db). Non-string / empty input is simply "not
 * committed".
 */
function isCommittedDbPath(p) {
  if (typeof p !== 'string' || p === '') return false;
  const candidate = pathIdentities(p);
  for (const committed of [COMMITTED_CONTROL_DB_PATH, COMMITTED_DEMO_DB_PATH]) {
    for (const id of pathIdentities(committed)) {
      if (candidate.has(id)) return true;
    }
  }
  return false;
}

/**
 * D-10-01: true when the ACTIVE control database is the committed
 * data/control.db. This single predicate backs every "refuse to write real
 * state into a committed file" guard AND the client-facing
 * `accountsWritable` flag of GET /api/auth/mode — one rule, never two.
 */
function isCommittedControlDbActive() {
  return isCommittedDbPath(CONTROL_DB_PATH);
}

function isIgnorableChmodError(e) {
  return process.platform === 'win32' && !!e && (e.code === 'EPERM' || e.code === 'ENOSYS');
}

// [security] R2-06 / OPS-08 / D-10-09 (Phase 10): MNPI database files and the
// directories that hold them are private to the service user (0600 / 0700) no
// matter what umask the process was started with. Observed before this change:
// every database 0644 and deals/ 0755 under umask 022, i.e. readable by every
// other local account on a shared host (session hashes in runtime.db, the AI
// key, audit.db and every deal database).
//
// Why an explicit chmod after create: mkdir(2)/open(2) mode arguments are
// masked by the umask, so asking for 0o700/0o600 is not enough — the bits must
// be forced afterwards. Why sidecars come out private too: SQLite's unix VFS
// creates -wal/-shm with the MAIN file's permission bits, so a main file that
// is already 0600 BEFORE SQLite opens it yields 0600 sidecars; sidecars left
// over from an earlier (0644) run are chmodded explicitly. Why ONLY directories
// this call created are chmodded: an MA_*_PATH override may point into a shared
// parent (a user's home, os.tmpdir(), the repo's own data/) whose permissions
// are not ours to change; real mode's own data dir is handled — fatally — by
// ensureRealDataDir() in db/realDataDir.js.
//
// Failure policy (PRD acceptance 6 — a dev/demo boot must never crash on a
// pre-existing path it cannot tighten): a pre-existing path that refuses the
// chmod with EPERM/EROFS (not owned by the service user, read-only filesystem)
// logs ONE `[security]` warning per path and the boot continues, because dev/
// demo run on committed/demo data, never MNPI. In real-deal mode (strict) the
// same failure is fatal — the real data dir is owned by the service user, so a
// failure means a misconfigured host and the app must fail closed. Any other
// error code, and any failure on a path this call created, is always fatal.
// win32 EPERM/ENOSYS stay ignored: POSIX modes do not apply there (Windows
// relies on the user-profile ACL + disk encryption, T-10-25).
const warnedChmodPaths = new Set();

/**
 * D-10-01/D-10-09: create `dir` (and any missing ancestors) as 0700. Only the
 * directories THIS call created are chmod'ed — a pre-existing directory is
 * never touched (see the [security] block above). Returns the list of
 * directories created.
 */
function ensurePrivateDir(dir) {
  const target = path.resolve(dir);
  const missing = [];
  let cur = target;
  while (!fs.existsSync(cur)) {
    missing.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  if (missing.length === 0) return [];
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const created of missing) {
    try { fs.chmodSync(created, 0o700); } catch (e) { if (!isIgnorableChmodError(e)) throw e; }
  }
  return missing;
}

/**
 * D-10-09: restrict an existing file to its owner (0600). A missing file is a
 * no-op; an already-0600 file is left alone (no spurious EPERM for a file we
 * cannot chmod but need not).
 *
 * Options: `preExisting` — the file was not created by this call, so an
 * EPERM/EROFS is tolerated outside strict mode (one `[security]` warning);
 * `strict` — defaults to IS_REAL_MODE and makes every failure fatal.
 * fs.chmodSync is looked up on the fs object at call time so tests can stub it.
 */
function chmodPrivateFile(file, options) {
  const opts = options || {};
  const preExisting = opts.preExisting === true;
  const strict = opts.strict === undefined ? IS_REAL_MODE : opts.strict === true;
  let st;
  try { st = fs.statSync(file); } catch (e) { return; } // missing: nothing to tighten
  if (process.platform !== 'win32' && (st.mode & 0o777) === 0o600) return;
  try {
    fs.chmodSync(file, 0o600);
  } catch (e) {
    if (isIgnorableChmodError(e)) return;
    const code = (e && e.code) || 'UNKNOWN';
    if (preExisting && !strict && (code === 'EPERM' || code === 'EROFS')) {
      const key = path.resolve(file);
      if (!warnedChmodPaths.has(key)) {
        warnedChmodPaths.add(key);
        console.warn(`[security] could not tighten ${key} to 0600 (${code}) — dev/demo continues; real-deal mode refuses to start on this`);
      }
      return;
    }
    throw new Error(`[security] could not restrict ${path.resolve(file)} to 0600 (${code}) — refusing to continue with a database file other local accounts may read.`);
  }
}

// [security] R5-04 / D-12-06 (Phase 12): the test runner must never write the
// developer's real data files. The review found `node --test` runs appending
// fabricated security events (2,509 fixture deal ids) to the real append-only
// data/audit.db, because a suite that required server.js without its MA_* temp
// overrides silently resolved the default <repo>/data paths. Individual suites
// were fixed one by one before and regressed; this guard makes a missing
// override FAIL LOUDLY at the one choke point every open passes through
// (openDbFile — the same single-choke-point strategy as D-10-01 above).
//
// Active ONLY when NODE_TEST_CONTEXT is a non-empty string — the variable Node's
// test runner sets for every file it runs and for the children those files
// spawn. node server.js, `npm run soak`, the UAT runners and CLIs never have it,
// so production behaviour is unchanged. The path is compared by lexical
// resolution AND by realpath of its nearest existing ancestor, so a
// `data/../data/x.db` or symlinked spelling cannot slip through.
function nearestExistingRealpath(p) {
  let cur = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...tail.reverse());
    } catch (e) {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

function isInsideDir(child, dir) {
  const rel = path.relative(dir, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * D-12-06: throw `[test-isolation]` when running under the Node test runner and
 * `dbFilePath` lies inside the committed <repo>/data directory (data/*.db,
 * data/deals/, data/real/, ...). Pure apart from read-only realpath lookups;
 * never opens or creates a file. `env` is injectable for tests.
 */
function assertTestIsolation(dbFilePath, env) {
  const e = env || process.env;
  if (typeof e.NODE_TEST_CONTEXT !== 'string' || e.NODE_TEST_CONTEXT === '') return;
  if (typeof dbFilePath !== 'string' || dbFilePath === '') return;
  const dataDirs = new Set([path.resolve(COMMITTED_DATA_DIR), nearestExistingRealpath(COMMITTED_DATA_DIR)]);
  const candidates = [path.resolve(dbFilePath), nearestExistingRealpath(dbFilePath)];
  const inside = candidates.some((c) => [...dataDirs].some((d) => isInsideDir(c, d)));
  if (!inside) return;
  // The ONE sanctioned exception: Phase-10 suites (accounts-writable-gate,
  // real-mode-guards section A) exist to prove that with the committed
  // data/control.db ACTIVE every account write is refused and the file never
  // changes. They cannot do that against a copy (the committed-path predicate
  // compares identities against the committed file itself), so they opt in
  // with MA_TEST_ALLOW_COMMITTED_CONTROL_DB=1 and hash the committed file
  // before/after. It exempts exactly data/control.db — never runtime.db,
  // audit.db, demo.db, deals/ or real/ — the files the R5-04 leak wrote.
  if (e.MA_TEST_ALLOW_COMMITTED_CONTROL_DB === '1') {
    const committed = pathIdentities(COMMITTED_CONTROL_DB_PATH);
    for (const id of pathIdentities(dbFilePath)) {
      if (committed.has(id)) return;
    }
  }
  const shown = path.relative(REPO_ROOT, path.resolve(dbFilePath)) || path.resolve(dbFilePath);
  throw new Error(
    `[test-isolation] node --test may not open ${shown} — set MA_CONTROL_DB_PATH, MA_RUNTIME_DB_PATH, MA_DEMO_DB_PATH, ` +
    'MA_DEALS_DIR and MA_AUDIT_DB_PATH (or MA_DATA_DIR with MA_MODE=real) to a temp directory before requiring the app'
  );
}

const SIDECAR_SUFFIXES = ['-wal', '-shm'];

/** Tighten whichever -wal/-shm sidecars of `dbFilePath` exist right now;
 * `preExistingSet` names the suffixes that already existed before this open. */
function tightenSidecars(dbFilePath, preExistingSet) {
  for (const suffix of SIDECAR_SUFFIXES) {
    chmodPrivateFile(dbFilePath + suffix, { preExisting: preExistingSet.has(suffix) });
  }
}

// --- D-12-03 (Phase 12): schema versioning wiring --------------------------
// The family of a file is derived from the schema file its caller already
// passes, so no call site changes. Any other schema path gets no family.
const SCHEMA_FAMILIES = new Map([
  [path.resolve(CONTROL_SCHEMA_PATH), 'control'],
  [path.resolve(RUNTIME_SCHEMA_PATH), 'runtime'],
  [path.resolve(DEAL_SCHEMA_PATH), 'deal'],
  [path.resolve(AUDIT_SCHEMA_PATH), 'audit'],
]);

function familyForSchema(schemaPath) {
  if (typeof schemaPath !== 'string') return null;
  return SCHEMA_FAMILIES.get(path.resolve(schemaPath)) || null;
}

// path.resolve(dbFilePath) -> the DbNotReadyError that file failed with. A
// failed migration/quick_check is sticky per path until the process restarts.
const notReadyPaths = new Map();

function safeSize(p) {
  try { return fs.statSync(p).size; } catch (e) { return 0; }
}

function isCorruptionError(e) {
  return !!(e && typeof e.code === 'string' && (e.code.startsWith('SQLITE_CORRUPT') || e.code === 'SQLITE_NOTADB'));
}

/**
 * PRAGMA quick_check, single result. Anything but 'ok' — including a thrown
 * corruption error — is an integrity failure; lock contention is not.
 */
function quickCheckOk(conn) {
  try {
    return conn.pragma('quick_check', { simple: true }) === 'ok';
  } catch (e) {
    if (isCorruptionError(e)) return false;
    throw e;
  }
}

/**
 * Create-or-migrate a file of a known family: a FRESH file gets its schema and
 * is stamped at the family's latest version; an EXISTING file is integrity-
 * checked (never audit), migrated BEFORE the idempotent schema exec, and then
 * has the schema exec'd. Committed demo/control files are never written by the
 * version runner (PD-5).
 */
function prepareVersionedFile(conn, { family, dbFilePath, schema }) {
  if (migrate.isFresh(conn)) {
    conn.exec(schema);
    migrate.runMigrations(conn, { family, file: dbFilePath, fresh: true });
    return;
  }
  if (family !== 'audit' && !quickCheckOk(conn)) {
    throw readiness.markNotReady({ family, file: dbFilePath, reason: readiness.REASONS.INTEGRITY_FAILED });
  }
  migrate.runMigrations(conn, { family, file: dbFilePath, committed: isCommittedDbPath(dbFilePath) });
  conn.exec(schema);
}

/**
 * Open (or create) the SQLite file at `dbFilePath`, apply the Phase-1 pragma
 * contract, and apply `schemaPath`'s schema idempotently (CREATE TABLE/INDEX/
 * TRIGGER IF NOT EXISTS, so re-opening an existing file is a no-op). Always
 * returns a NEW connection — callers that want a shared/cached handle (the
 * resolver, Plan 03) own that caching themselves.
 *
 * [security] D-10-01: in real-deal mode this is the single choke point that
 * refuses a committed data/*.db — see the mode-contract block above.
 * [security] D-10-09: it is also the single choke point that makes every
 * database file 0600 (sidecars included) inside a 0700 directory — see the
 * file-mode block above.
 */
function openDbFile(dbFilePath, schemaPath) {
  if (IS_REAL_MODE && isCommittedDbPath(dbFilePath)) {
    throw new Error(
      `[security] real-deal mode refuses to open the committed database file ${path.resolve(dbFilePath)} — ` +
      'real acquisition data must never be written into a git-tracked file. Point MA_DATA_DIR / MA_*_PATH at a gitignored directory.'
    );
  }
  // [security] D-12-06: AFTER the real-mode refusal (real-mode tests still see
  // `[security]`) and BEFORE ensurePrivateDir so a refused path creates nothing.
  assertTestIsolation(dbFilePath);
  // [security] D-12-03: a file that already failed its migration or integrity
  // check is refused on every later open until restart — never retried, never
  // served (T-12-51). Checked before anything is created or opened.
  const stuck = notReadyPaths.get(path.resolve(dbFilePath));
  if (stuck) throw stuck;
  ensurePrivateDir(path.dirname(dbFilePath));

  const existedBefore = fs.existsSync(dbFilePath);
  if (existedBefore) {
    chmodPrivateFile(dbFilePath, { preExisting: true });
  } else {
    // Created 0600 BEFORE SQLite opens it so its -wal/-shm inherit 0600; the
    // chmod then forces the bits a umask may have stripped. We created it, so a
    // failure here is always fatal.
    fs.closeSync(fs.openSync(dbFilePath, 'a', 0o600));
    chmodPrivateFile(dbFilePath);
  }
  const preExistingSidecars = new Set(SIDECAR_SUFFIXES.filter((s) => fs.existsSync(dbFilePath + s)));
  tightenSidecars(dbFilePath, preExistingSidecars);

  const family = familyForSchema(schemaPath);
  const hadContent = existedBefore && family !== null && safeSize(dbFilePath) > 0;
  const conn = new Database(dbFilePath);
  try {
    conn.pragma('journal_mode = WAL');
    conn.pragma('synchronous = NORMAL');
    conn.pragma('foreign_keys = ON');
    conn.pragma('busy_timeout = 1000'); // D-03/D-05/CONC-01 (Phase 8): see file header

    const schema = fs.readFileSync(schemaPath, 'utf8');
    if (family === null) {
      // A schema outside the four known families (a test-only custom schema):
      // no version, no checks — unchanged behaviour.
      conn.exec(schema);
    } else {
      prepareVersionedFile(conn, { family, dbFilePath, schema });
    }

    tightenSidecars(dbFilePath, preExistingSidecars);
  } catch (e) {
    try { conn.close(); } catch (closeErr) { /* surface the original error */ }
    if (e instanceof readiness.DbNotReadyError) {
      notReadyPaths.set(path.resolve(dbFilePath), e); // sticky until restart
      throw e;
    }
    // A header/page-level corruption surfaces as an SqliteError from the very
    // first statement. On an EXISTING non-empty file of a known family that is
    // an integrity failure, not a crash (D-12-03).
    if (hadContent && isCorruptionError(e)) {
      const nr = readiness.markNotReady({ family, file: dbFilePath, reason: readiness.REASONS.INTEGRITY_FAILED });
      notReadyPaths.set(path.resolve(dbFilePath), nr);
      throw nr;
    }
    throw e;
  }

  return conn;
}

module.exports = {
  resolveModeConfig,
  MODE,
  IS_REAL_MODE,
  DATA_DIR,
  COMMITTED_DATA_DIR,
  COMMITTED_CONTROL_DB_PATH,
  COMMITTED_DEMO_DB_PATH,
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
  isCommittedDbPath,
  isCommittedControlDbActive,
  ensurePrivateDir,
  chmodPrivateFile,
  assertTestIsolation,
  openDbFile,
  // D-12-03: test-only reset of the sticky not-ready cache.
  _clearNotReadyForTests: () => notReadyPaths.clear(),
};
