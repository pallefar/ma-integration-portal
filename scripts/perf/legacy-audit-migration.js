#!/usr/bin/env node
'use strict';
// Phase 12 (plan 12-13, PD-31, checker W-2): rehearse migration #1 of the audit
// family (db/migrations/audit/001-partition-legacy.js) at a stated volume and
// print what it costs: duration, peak WAL, peak scratch disk, free-space delta.
//
//   node scripts/perf/legacy-audit-migration.js [--rows N] [--keep]
//
//   --rows N   synthetic legacy rows (default 150,000 ~ 170 MB, MAX 300,000;
//              above the cap exit 2 BEFORE anything is written)
//   --keep     keep the temp tree for inspection (default: removed)
//
// WHAT IS MEASURED. A version-0 audit.db + control.db are manufactured by
// scripts/perf/lib/legacy-audit-volume.js in a fresh temp directory, a real
// server (`require('./server.js')`, the boot path that runs the migration) is
// spawned on them, and the parent samples every 100 ms: the summed size of
// audit.db-wal + audit/*.db-wal, the audit scratch bytes (source file +
// `.pre-v1.bak` + partitions + WALs; the boot's own demo.db / runtime.db seed
// is counted separately as `tree_peak_mb`) and the free space of the volume
// (`free_delta_mb` = everything the run consumed). The boot is timed
// spawn -> listening; a SECOND boot of the migrated tree gives the plain boot
// cost so `migration_ms` = first boot - second boot.
// Then `audit-verify --all` is run on the tree.
//
// WHY SYNTHETIC. A real MNPI audit file must never feed a test artifact and
// executors run where the developer's data/audit.db does not exist; this script
// never opens, copies or reads a file outside its own temp directory (its MA_*
// environment is built from scratch and self-checked before anything spawns).
//
// DISK RULES (the host is shared and often >= 90 % full): refuses to start
// (exit 2, shortfall named) unless free space >= 4 x the projected file size +
// 1 GB; removes the temp tree in a `finally` AND on SIGINT/SIGTERM (child
// killed first; exit 130/143).
//
// Results are LINEAR extrapolations to a 5 GB file, labelled `extrapolated`.
//
// Output (stdout): one `REHEARSAL ...` line, `MOVED ...`, `VERIFY ...`,
// `EXTRAPOLATED ...`. Exit 0 ok, 1 migration/verify failure, 2 usage/refusal.

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const Database = require('better-sqlite3');

const { buildLegacyAuditTree, projectedFileBytes, MAX_ROWS, DEFAULT_ROWS } = require('./lib/legacy-audit-volume');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MB = 1024 * 1024;
const GB = 1024 * MB;
const FREE_MARGIN_BYTES = GB;
const SCRATCH_FACTOR = 4; // original + backup + partitions + their WAL ~ 4 x the file
const SAMPLE_MS = 100;
const BOOT_TIMEOUT_MS = 20 * 60 * 1000;
const FIVE_GB = 5 * GB;

function usage(out) {
  out('usage: node scripts/perf/legacy-audit-migration.js [--rows N] [--keep]');
  out(`       --rows N  synthetic legacy rows (default ${DEFAULT_ROWS}, max ${MAX_ROWS})`);
  out('       --keep    keep the temp tree');
}

function parseArgs(argv) {
  const o = { rows: DEFAULT_ROWS, keep: false };
  const args = argv.slice();
  while (args.length) {
    const a = args.shift();
    if (a === '--rows') {
      const v = args.shift();
      if (!/^[0-9]+$/.test(String(v))) return { error: `--rows needs a positive integer, got ${JSON.stringify(v)}` };
      o.rows = parseInt(v, 10);
    } else if (a === '--keep') {
      o.keep = true;
    } else if (a === '-h' || a === '--help') {
      o.help = true;
    } else {
      return { error: `unknown argument ${JSON.stringify(a)}` };
    }
  }
  return { options: o };
}

function freeBytes(dir) {
  const s = fs.statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}

/**
 * Sizes under `dir`: `total` = every file; `audit` = only what the audit
 * migration itself occupies (audit.db and its -wal/-shm, `audit.db.pre-v1.bak`,
 * audit/*) — the "scratch" figure, so the boot's demo.db / runtime.db seed does
 * not inflate the migration's cost; `wal` = summed size of every audit `*-wal`.
 */
function walk(dir) {
  let total = 0;
  let audit = 0;
  let wal = 0;
  const auditDir = path.join(dir, 'audit') + path.sep;
  const auditFile = path.join(dir, 'audit.db');
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch (e) { continue; }
    for (const ent of entries) {
      const p = path.join(cur, ent.name);
      if (ent.isDirectory()) { stack.push(p); continue; }
      let size = 0;
      try { size = fs.lstatSync(p).size; } catch (e) { continue; }
      total += size;
      if (p.startsWith(auditDir) || p.startsWith(auditFile)) {
        audit += size;
        if (ent.name.endsWith('-wal')) wal += size;
      }
    }
  }
  return { total, audit, wal };
}

/**
 * The child environment, built from scratch (no inherited MA_* / DEMO_OPEN /
 * ADMIN_TOKEN) with every data path inside `dir`. MA_AUDIT_DIR is the one
 * documented pass-through, so the self-check below has a real case to refuse.
 */
function buildChildEnv(dir, baseEnv) {
  const env = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (k.startsWith('MA_') || k === 'DEMO_OPEN' || k === 'ADMIN_TOKEN' || k === 'PORT' || k === 'PUBLIC_BASE_URL') continue;
    env[k] = v;
  }
  Object.assign(env, {
    MA_CONTROL_DB_PATH: path.join(dir, 'control.db'),
    MA_RUNTIME_DB_PATH: path.join(dir, 'runtime.db'),
    MA_DEMO_DB_PATH: path.join(dir, 'demo.db'),
    MA_AUDIT_DB_PATH: path.join(dir, 'audit.db'),
    MA_DEALS_DIR: path.join(dir, 'deals'),
  });
  if (baseEnv.MA_AUDIT_DIR) env.MA_AUDIT_DIR = baseEnv.MA_AUDIT_DIR;
  return env;
}

/** Names of MA_* path variables whose resolved value lies outside `dir`. */
function pathsOutside(env, dir) {
  const root = path.resolve(dir);
  const bad = [];
  for (const [name, value] of Object.entries(env)) {
    if (!/^MA_.*(PATH|DIR)$/.test(name) || typeof value !== 'string' || !value) continue;
    const resolved = path.resolve(value);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) bad.push(name);
  }
  return bad;
}

const CHILD_SCRIPT = `
  const app = require('./server.js');
  const server = app.listen(0, '127.0.0.1', () => {
    process.stdout.write('LISTENING ' + server.address().port + '\\n');
  });
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
`;

const liveChildren = new Set();

function startServer(env) {
  const t0 = Date.now();
  const child = childProcess.spawn(process.execPath, ['-e', CHILD_SCRIPT], {
    cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  liveChildren.add(child);
  let stdout = '';
  let stderr = '';
  let exited = false;
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  child.once('exit', () => { exited = true; liveChildren.delete(child); });
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not listen within ${BOOT_TIMEOUT_MS / 60000} min`)), BOOT_TIMEOUT_MS);
    child.stdout.on('data', (d) => {
      stdout += d;
      const m = /LISTENING (\d+)/.exec(stdout);
      if (m) { clearTimeout(timer); resolve({ port: Number(m[1]), bootMs: Date.now() - t0 }); }
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`server exited before listening (code ${code}, signal ${signal})\n${stderr}`));
    });
  });
  const stop = () => new Promise((resolve) => {
    if (exited) { resolve(); return; }
    child.once('exit', () => resolve());
    try { child.kill('SIGTERM'); } catch (e) { resolve(); return; }
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* gone */ } }, 5000).unref();
  });
  return { child, listening, stop, stderr: () => stderr };
}

function removeTree(dir) {
  // Sealed partitions are 0400: clear the bits so the tree is removable everywhere.
  const auditDir = path.join(dir, 'audit');
  try {
    for (const name of fs.readdirSync(auditDir)) {
      try { fs.chmodSync(path.join(auditDir, name), 0o600); } catch (e) { /* best effort */ }
    }
  } catch (e) { /* no audit dir */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

function countMoved(dir, auditPath) {
  const auditDir = path.join(dir, 'audit');
  let present = 0;
  let legacy = 0;
  let partitions = 0;
  let listing = [];
  try { listing = fs.readdirSync(auditDir).filter((n) => n.endsWith('.db')); } catch (e) { /* none */ }
  for (const name of listing) {
    const c = new Database(path.join(auditDir, name), { readonly: true });
    try {
      const n = c.prepare('SELECT COUNT(legacy_id) AS n FROM audit_log').get().n;
      if (name === 'legacy.db') legacy += n; else { present += n; partitions += 1; }
    } finally { c.close(); }
  }
  const a = new Database(auditPath, { readonly: true });
  let control;
  try {
    control = a.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE actor_username != 'system:migration'").get().n;
  } finally { a.close(); }
  return { present, legacy, control, partitions };
}

async function main(argv, io) {
  const out = (io && io.out) || ((s) => process.stdout.write(`${s}\n`));
  const err = (io && io.err) || ((s) => process.stderr.write(`${s}\n`));
  const parsed = parseArgs(argv);
  if (parsed.error) { err(`legacy-audit-migration: ${parsed.error}`); usage(err); return 2; }
  const { rows, keep, help } = parsed.options;
  if (help) { usage(out); return 0; }
  if (rows < 1) { err('legacy-audit-migration: --rows must be at least 1'); return 2; }
  if (rows > MAX_ROWS) {
    err(`legacy-audit-migration: --rows ${rows} exceeds the cap of ${MAX_ROWS} (shared, nearly full host) — nothing was written`);
    return 2;
  }

  const tmpRoot = os.tmpdir();
  const projectedFile = projectedFileBytes(rows);
  const need = SCRATCH_FACTOR * projectedFile + FREE_MARGIN_BYTES;
  const freeStart = freeBytes(tmpRoot);
  if (freeStart < need) {
    err(`legacy-audit-migration: refusing to start — ${(freeStart / MB).toFixed(0)} MB free under ${tmpRoot}, need ` +
      `${(need / MB).toFixed(0)} MB (4 x ~${(projectedFile / MB).toFixed(0)} MB projected file + 1 GB); short by ${((need - freeStart) / MB).toFixed(0)} MB`);
    return 2;
  }

  const dir = fs.mkdtempSync(path.join(tmpRoot, 'gsd-12-13-rehearsal-'));
  // Self-check BEFORE anything is generated or spawned: every data path of the
  // child must lie inside the temp tree (never a committed data/*.db).
  const env = buildChildEnv(dir, process.env);
  const outside = pathsOutside(env, dir);
  if (outside.length) {
    err(`legacy-audit-migration: refusing to spawn — ${outside.join(', ')} resolve outside the temp tree ${dir}; nothing was written`);
    removeTree(dir);
    return 2;
  }

  let sampler = null;
  const metrics = { peakWal: 0, peakScratch: 0, peakTree: 0, minFree: freeStart };
  const sample = () => {
    const w = walk(dir);
    if (w.wal > metrics.peakWal) metrics.peakWal = w.wal;
    if (w.audit > metrics.peakScratch) metrics.peakScratch = w.audit;
    if (w.total > metrics.peakTree) metrics.peakTree = w.total;
    let f = freeStart;
    try { f = freeBytes(tmpRoot); } catch (e) { /* keep last */ }
    if (f < metrics.minFree) metrics.minFree = f;
  };
  let server = null;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (sampler) clearInterval(sampler);
    for (const c of liveChildren) { try { c.kill('SIGKILL'); } catch (e) { /* gone */ } }
    if (!keep) removeTree(dir);
  };
  const onSignal = (code) => () => { cleanup(); process.exit(code); };
  const sigint = onSignal(130);
  const sigterm = onSignal(143);
  process.once('SIGINT', sigint);
  process.once('SIGTERM', sigterm);

  try {
    out(`legacy-audit-migration: generating ${rows} synthetic legacy rows in ${dir} (projected ~${(projectedFile / MB).toFixed(0)} MB)`);
    const tree = buildLegacyAuditTree({ dir, rows });
    sample();

    sampler = setInterval(sample, SAMPLE_MS);
    server = startServer(env);
    const boot = await server.listening;
    sample();
    const health = await fetch(`http://127.0.0.1:${boot.port}/healthz`).then(async (r) => ({ status: r.status, body: await r.json() }));
    await server.stop();
    clearInterval(sampler);
    sampler = null;
    sample();

    const auditVersion = health.body && health.body.readiness && health.body.readiness.versions && health.body.readiness.versions.audit
      ? health.body.readiness.versions.audit.version : null;
    if (health.status !== 200 || auditVersion !== 1) {
      err(`REHEARSAL-FAILED /healthz ${health.status} audit.version=${auditVersion} ` +
        `failures=${JSON.stringify((health.body && health.body.readiness && health.body.readiness.failures) || [])}`);
      return 1;
    }

    // Plain boot cost of the already migrated tree, to isolate the migration.
    const second = startServer(env);
    const bootAgain = await second.listening;
    await second.stop();
    const migrationMs = Math.max(0, boot.bootMs - bootAgain.bootMs);

    const verify = childProcess.spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'audit-verify.js'), '--all'], {
      cwd: REPO_ROOT, env, encoding: 'utf8', maxBuffer: 64 * MB,
    });
    const verifyLines = verify.stdout.split('\n').filter(Boolean);
    const okCount = verifyLines.filter((l) => l.startsWith('OK ')).length;
    const failLines = verifyLines.filter((l) => !l.startsWith('OK '));
    const verifyOk = verify.status === 0 && failLines.length === 0;

    const moved = countMoved(dir, tree.auditPath);
    const accountingOk = moved.present === tree.expected.presentRows
      && moved.legacy === tree.expected.legacyRows
      && moved.control === tree.expected.controlRows;

    const fileMb = tree.fileBytes / MB;
    out(`REHEARSAL rows=${rows} file_mb=${fileMb.toFixed(1)} duration_ms=${boot.bootMs} peak_wal_mb=${(metrics.peakWal / MB).toFixed(1)} ` +
      `peak_scratch_mb=${(metrics.peakScratch / MB).toFixed(1)} tree_peak_mb=${(metrics.peakTree / MB).toFixed(1)} free_delta_mb=${((freeStart - metrics.minFree) / MB).toFixed(1)} ` +
      `verify=${verifyOk ? 'OK' : 'FAIL'} boot_baseline_ms=${bootAgain.bootMs} migration_ms=${migrationMs} ` +
      `scratch_ratio=${(metrics.peakScratch / tree.fileBytes).toFixed(2)}`);
    out(`MOVED present_deal_partitions=${moved.partitions} present_rows=${moved.present} (expected ${tree.expected.presentRows}) ` +
      `legacy_rows=${moved.legacy} (expected ${tree.expected.legacyRows}) control_rows=${moved.control} (expected ${tree.expected.controlRows}) ` +
      `accounting=${accountingOk ? 'OK' : 'MISMATCH'}`);
    out(`VERIFY files_ok=${okCount} non_ok=${failLines.length} exit=${verify.status}`);
    for (const l of failLines.slice(0, 5)) out(`VERIFY-DETAIL ${l}`);
    const factor = FIVE_GB / tree.fileBytes;
    out(`EXTRAPOLATED 5GB (linear in file size, NOT measured): migration_ms~${Math.round(migrationMs * factor)} ` +
      `(~${((migrationMs * factor) / 60000).toFixed(1)} min) peak_scratch_gb~${((metrics.peakScratch * factor) / GB).toFixed(1)} ` +
      `peak_wal_gb~${((metrics.peakWal * factor) / GB).toFixed(1)} runner_free_space_rule_gb=${((3 * FIVE_GB + 64 * MB) / GB).toFixed(1)}`);
    if (keep) out(`legacy-audit-migration: kept ${dir}`);
    return verifyOk && accountingOk ? 0 : 1;
  } catch (e) {
    err(`legacy-audit-migration: ${e && e.message ? e.message : e}`);
    return e && (e.code === 'ROWS_CAP' || e.code === 'ROWS_INVALID') ? 2 : 1;
  } finally {
    process.removeListener('SIGINT', sigint);
    process.removeListener('SIGTERM', sigterm);
    if (server) { try { await server.stop(); } catch (e) { /* ignore */ } }
    cleanup();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(`legacy-audit-migration: ${e && e.stack ? e.stack : e}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs, buildChildEnv, pathsOutside };
