#!/usr/bin/env node
// Re-runnable, verified control/demo/runtime split of the live SQLite store
// (ISO-01 / D-05 / D-07).
//
// Usage:
//   node scripts/split-db-into-control-demo-deals.js [--source data/ma-portal.db] [--out data] [--verify]
//
// - Reads --source (data/ma-portal.db, the Phase-1 migration's output) with a
//   better-sqlite3 `{ readonly: true, fileMustExist: true }` connection ONLY
//   — this is the ONLY touch of sourcePath in this entire script; it is
//   never written, renamed, chmod-ed or unlinked (T-03-09). Cutover/archival
//   of ma-portal.db is a separate, later action (Plan 03), not this script's
//   job.
// - Fans OUT to THREE output files instead of the 1-source-to-1-output shape
//   of scripts/migrate-db-json-to-sqlite.js (this script's analog): every
//   ARRAY_COLLECTIONS row and SINGLETON_KEYS value is routed to exactly one
//   of control.db / demo.db / runtime.db per db/collections.js's
//   COLLECTION_TARGETS map — the single source of truth for that routing
//   (D-05).
// - Each output is built at a temp path first. The --verify union-parity
//   gate (below) runs against the THREE TEMP FILES before any rename — a
//   failure here throws and leaves every already-existing final output
//   completely untouched; a crash/interrupt mid-run never corrupts a
//   previously-good split (D-05's "crash-safe" requirement). Only on a green
//   gate are the temp files (+ WAL/SHM sidecars, non-fatal on sidecar rename
//   failure, exactly like the analog) renamed over their real paths.
// - `settings`'s two SECRET_SETTINGS_FIELDS (db/collections.js) are deep-
//   deleted from the copy that lands in demo.db's `settings` and instead
//   land in runtime.db's `secretSettings` singleton — a credential must
//   never reach the COMMITTED demo.db (T-03-06).
// - `--verify` alone (no rebuild) re-runs the same comparison against
//   whatever is already on disk at --out's final paths — this is what lets
//   the CLI be used as a standalone post-hoc parity check.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { ARRAY_COLLECTIONS, SINGLETON_KEYS, COLLECTION_TARGETS, SECRET_SETTINGS_FIELDS } = require('../db/collections');
const dbFiles = require('../db/dbFiles');

// Per D-06 ("same schema as demo"), demo.db uses the existing Phase-1
// db/schema.sql verbatim — the same schema dbFiles.DEAL_SCHEMA_PATH already
// points a per-deal database at.
const DEMO_SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

const DEFAULT_SOURCE = path.join('data', 'ma-portal.db');
const DEFAULT_OUT_DIR = 'data';

const OUTPUT_SPECS = [
  { target: 'control', basename: path.basename(dbFiles.CONTROL_DB_PATH), schemaPath: dbFiles.CONTROL_SCHEMA_PATH },
  { target: 'demo', basename: path.basename(dbFiles.DEMO_DB_PATH), schemaPath: DEMO_SCHEMA_PATH },
  { target: 'runtime', basename: path.basename(dbFiles.RUNTIME_DB_PATH), schemaPath: dbFiles.RUNTIME_SCHEMA_PATH },
];

function parseArgs(argv) {
  const args = { source: DEFAULT_SOURCE, out: DEFAULT_OUT_DIR, verify: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') args.source = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--verify') args.verify = true;
    else if (a.startsWith('--source=')) args.source = a.slice('--source='.length);
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length);
  }
  return args;
}

// Key-order-agnostic structural equality, copied verbatim from
// scripts/migrate-db-json-to-sqlite.js — JSON.stringify's key order depends
// on object insertion order, which would produce false diff failures if
// compared as plain strings without canonicalizing first.
function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((acc, k) => { acc[k] = canonicalize(v[k]); return acc; }, {});
  }
  return v;
}
function canonicalJSON(v) { return JSON.stringify(canonicalize(v)); }

// Dotted-path helpers for SECRET_SETTINGS_FIELDS (e.g.
// 'databaseConfig.connectionDetails') — deliberately simple (no array-index
// support) since every entry in SECRET_SETTINGS_FIELDS is a plain nested
// object path, matching server.js's existing publicSettings() strip-list
// shape.
function hasField(obj, dottedPath) {
  const parts = dottedPath.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || !(p in cur)) return false;
    cur = cur[p];
  }
  return true;
}

/**
 * Deep-clone `settingsObj`, then extract every SECRET_SETTINGS_FIELDS path
 * out of the clone into a mirrored-shape `secrets` object, deleting it from
 * the clone. Returns `{ settings, secrets }`. A field absent from the source
 * is simply absent from both outputs (no fabricated placeholder values).
 */
function splitSecretFields(settingsObj) {
  const settings = settingsObj ? JSON.parse(JSON.stringify(settingsObj)) : {};
  const secrets = {};
  for (const fieldPath of SECRET_SETTINGS_FIELDS) {
    const parts = fieldPath.split('.');
    const lastKey = parts[parts.length - 1];
    let src = settings;
    let ok = true;
    for (let i = 0; i < parts.length - 1; i++) {
      if (src && typeof src === 'object' && parts[i] in src) src = src[parts[i]];
      else { ok = false; break; }
    }
    if (ok && src && typeof src === 'object' && lastKey in src) {
      let dst = secrets;
      for (let i = 0; i < parts.length - 1; i++) {
        dst[parts[i]] = dst[parts[i]] || {};
        dst = dst[parts[i]];
      }
      dst[lastKey] = src[lastKey];
      delete src[lastKey];
    }
  }
  return { settings, secrets };
}

/** Inverse of splitSecretFields()'s extraction — used only by verifyModel() to
 * reconstruct the original whole `settings` object for canonical comparison
 * against the source, by merging demo.db's redacted settings with
 * runtime.db's secretSettings. Never used on a write path. */
function mergeSecretFields(settingsObj, secretsObj) {
  const merged = settingsObj ? JSON.parse(JSON.stringify(settingsObj)) : {};
  const secrets = secretsObj || {};
  for (const fieldPath of SECRET_SETTINGS_FIELDS) {
    const parts = fieldPath.split('.');
    const lastKey = parts[parts.length - 1];
    let src = secrets;
    let ok = true;
    for (let i = 0; i < parts.length - 1; i++) {
      if (src && typeof src === 'object' && parts[i] in src) src = src[parts[i]];
      else { ok = false; break; }
    }
    if (ok && src && typeof src === 'object' && lastKey in src) {
      let dst = merged;
      for (let i = 0; i < parts.length - 1; i++) {
        dst[parts[i]] = dst[parts[i]] || {};
        dst = dst[parts[i]];
      }
      dst[lastKey] = src[lastKey];
    }
  }
  return merged;
}

/**
 * Read the ENTIRE source in one read-only pass: raw rows (id/project_id/seq/
 * data, for exact-order-preserving re-insertion) per ARRAY_COLLECTIONS table,
 * and raw JSON text per SINGLETON_KEYS app_state row, plus a parsed
 * whole-object `model` (mirrors db/store.js's readDb() shape) for
 * comparison. This is the ONLY function in this script that ever opens
 * sourcePath.
 */
function readSourceModel(resolvedSource) {
  const src = new Database(resolvedSource, { readonly: true, fileMustExist: true });
  try {
    const rawRows = {};
    const model = {};
    for (const key of ARRAY_COLLECTIONS) {
      const rows = src.prepare(`SELECT id, project_id, seq, data FROM ${key} ORDER BY seq`).all();
      rawRows[key] = rows;
      model[key] = rows.map((r) => JSON.parse(r.data));
    }
    const rawSingletons = {};
    for (const key of SINGLETON_KEYS) {
      const row = src.prepare('SELECT data FROM app_state WHERE key = ?').get(key);
      rawSingletons[key] = row ? row.data : undefined;
      model[key] = row ? JSON.parse(row.data) : undefined;
    }
    return { model, rawRows, rawSingletons };
  } finally {
    src.close();
  }
}

/** Remove stale temp files left behind by a prior run that crashed before it
 * could rename its temp DB (+ sidecars) into place — mirrors
 * scripts/migrate-db-json-to-sqlite.js's cleanup exactly, just per output. */
function cleanupStaleTemp(dir, basename) {
  const tmpPrefix = `.${basename}.migrating-`;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(tmpPrefix)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* ignore */ }
    }
  }
}

/** Build ONE output database at `tmpPath`: apply its schema, then insert only
 * the rows/singletons COLLECTION_TARGETS routes to `spec.target`. */
function buildOutput(spec, sourceModel, tmpPath) {
  const db = new Database(tmpPath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.exec(fs.readFileSync(spec.schemaPath, 'utf8'));

    const insertAll = db.transaction(() => {
      for (const key of ARRAY_COLLECTIONS) {
        if (COLLECTION_TARGETS[key] !== spec.target) continue;
        const rows = sourceModel.rawRows[key] || [];
        const insert = db.prepare(`INSERT INTO ${key} (id, project_id, seq, data) VALUES (?, ?, ?, ?)`);
        for (const row of rows) insert.run(row.id, row.project_id, row.seq, row.data);
      }

      if (spec.target === 'control') {
        // Placeholder deployment-level singleton (D-07). Not sourced from
        // ma-portal.db — no such key exists pre-split. Written unconditionally
        // (empty object) so the app_state row exists from the first split
        // onward for later phases to read/update; NEVER a secret (see
        // control-schema.sql's header).
        db.prepare('INSERT INTO app_state (key, data) VALUES (?, ?)').run('controlSettings', JSON.stringify({}));
      }

      if (spec.target === 'demo') {
        for (const key of SINGLETON_KEYS) {
          if (sourceModel.rawSingletons[key] === undefined) continue;
          let data = sourceModel.rawSingletons[key];
          if (key === 'settings') {
            const { settings } = splitSecretFields(JSON.parse(data));
            data = JSON.stringify(settings);
          }
          db.prepare('INSERT INTO app_state (key, data) VALUES (?, ?)').run(key, data);
        }
      }

      if (spec.target === 'runtime') {
        const rawSettings = sourceModel.rawSingletons.settings;
        const { secrets } = splitSecretFields(rawSettings ? JSON.parse(rawSettings) : {});
        db.prepare('INSERT INTO app_state (key, data) VALUES (?, ?)').run('secretSettings', JSON.stringify(secrets));
      }
    });
    insertAll();
  } finally {
    db.close();
  }
}

/**
 * The hard parity gate (D-05 / T-03-05). Opens the three output files
 * read-only at whatever paths `targetPaths` names (temp paths during
 * runSplit()'s pre-rename gate, or final paths for a standalone --verify),
 * and re-reads the source fresh. Fails on:
 *  - a row-count or field-level mismatch for any ARRAY_COLLECTIONS/
 *    SINGLETON_KEYS entry versus the source (a drop),
 *  - a non-zero row count for a collection in any output OTHER than its
 *    COLLECTION_TARGETS-assigned one, where that output's schema happens to
 *    define the same table (demo/deal schema defines all 33 — a duplicate),
 *  - a SECRET_SETTINGS_FIELDS value present in control.db or demo.db, or
 *    missing from runtime.db's secretSettings when the source actually had it.
 * Returns `{ ok, failures }` — never throws itself (the caller decides
 * whether a failure is fatal).
 */
function verifyModel(sourceModel, targetPaths) {
  const failures = [];
  const opened = {};
  try {
    for (const target of Object.keys(targetPaths)) {
      opened[target] = new Database(targetPaths[target], { readonly: true, fileMustExist: true });
    }
  } catch (e) {
    for (const k of Object.keys(opened)) { try { opened[k].close(); } catch (e2) { /* ignore */ } }
    return { ok: false, failures: [`could not open one or more split outputs for verification: ${e.message}`] };
  }

  try {
    for (const key of ARRAY_COLLECTIONS) {
      const target = COLLECTION_TARGETS[key];
      const rows = opened[target].prepare(`SELECT data FROM ${key} ORDER BY seq`).all();
      const got = rows.map((r) => JSON.parse(r.data));
      const src = sourceModel.model[key] || [];
      if (got.length !== src.length) {
        failures.push(`row-count mismatch for ${key} (target=${target}): source=${src.length} got=${got.length}`);
      } else {
        for (let i = 0; i < src.length; i++) {
          if (canonicalJSON(got[i]) !== canonicalJSON(src[i])) {
            failures.push(`field-level mismatch in ${key}[${i}] (target=${target})`);
          }
        }
      }

      // Duplication check: any OTHER output whose schema also defines this
      // table (only demo/deal schema defines all 33) must have zero rows for
      // a collection routed elsewhere.
      for (const other of Object.keys(targetPaths)) {
        if (other === target) continue;
        let otherCount;
        try {
          otherCount = opened[other].prepare(`SELECT COUNT(*) AS c FROM ${key}`).get().c;
        } catch (e) {
          continue; // table doesn't exist in this output's schema — no duplication possible
        }
        if (otherCount > 0) {
          failures.push(`duplication: ${otherCount} row(s) of "${key}" found in ${other}.db, whose assigned target is "${target}"`);
        }
      }
    }

    for (const key of SINGLETON_KEYS) {
      const demoRow = opened.demo.prepare('SELECT data FROM app_state WHERE key = ?').get(key);
      const rawDemoValue = demoRow ? JSON.parse(demoRow.data) : undefined;
      let gotValue = rawDemoValue;

      if (key === 'settings') {
        const secretRow = opened.runtime.prepare('SELECT data FROM app_state WHERE key = ?').get('secretSettings');
        const secrets = secretRow ? JSON.parse(secretRow.data) : {};
        const controlSettingsRow = opened.control.prepare('SELECT data FROM app_state WHERE key = ?').get('controlSettings');
        const rawControlSettings = controlSettingsRow ? JSON.parse(controlSettingsRow.data) : {};
        const srcSettings = sourceModel.model.settings || {};

        for (const fieldPath of SECRET_SETTINGS_FIELDS) {
          if (hasField(rawDemoValue || {}, fieldPath)) {
            failures.push(`secret field "${fieldPath}" leaked into demo.db's settings singleton`);
          }
          if (hasField(rawControlSettings, fieldPath)) {
            failures.push(`secret field "${fieldPath}" leaked into control.db's controlSettings singleton`);
          }
          if (hasField(srcSettings, fieldPath) && !hasField(secrets, fieldPath)) {
            failures.push(`secret field "${fieldPath}" missing from runtime.db's secretSettings singleton`);
          }
        }

        gotValue = mergeSecretFields(rawDemoValue, secrets);
      }

      const src = sourceModel.model[key];
      if (canonicalJSON(gotValue) !== canonicalJSON(src)) {
        failures.push(`singleton mismatch for ${key}`);
      }
    }
  } finally {
    for (const k of Object.keys(opened)) { try { opened[k].close(); } catch (e) { /* ignore */ } }
  }

  return { ok: failures.length === 0, failures };
}

/**
 * Split `sourcePath` into control.db/demo.db/runtime.db under `outDir`.
 * Builds all three at temp paths, runs the --verify parity gate against
 * those temp paths, and ONLY on a green gate renames them over their final
 * paths. Re-runnable: a pre-existing output is overwritten by the rename;
 * stale temp files from a failed prior run are cleaned at the start. Never
 * touches `sourcePath` beyond the single read-only open in readSourceModel().
 */
function runSplit({ sourcePath = DEFAULT_SOURCE, outDir = DEFAULT_OUT_DIR } = {}) {
  const resolvedSource = path.resolve(sourcePath);
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`scripts/split-db-into-control-demo-deals.js: source database not found at ${resolvedSource} — refusing to produce empty outputs`);
  }
  const resolvedOutDir = path.resolve(outDir);
  if (!fs.existsSync(resolvedOutDir)) fs.mkdirSync(resolvedOutDir, { recursive: true });

  const sourceModel = readSourceModel(resolvedSource);

  const finalPaths = {};
  const tmpPaths = {};
  for (const spec of OUTPUT_SPECS) {
    finalPaths[spec.target] = path.join(resolvedOutDir, spec.basename);
    cleanupStaleTemp(resolvedOutDir, spec.basename);
    tmpPaths[spec.target] = path.join(
      resolvedOutDir,
      `.${spec.basename}.migrating-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.tmp`
    );
  }

  for (const spec of OUTPUT_SPECS) {
    buildOutput(spec, sourceModel, tmpPaths[spec.target]);
  }

  // Hard parity gate BEFORE any rename (D-05, T-03-05): a failure here throws
  // and every already-existing FINAL output is left completely untouched —
  // only the (now-provably-bad) temp files exist, for postmortem inspection.
  const verifyResult = verifyModel(sourceModel, tmpPaths);
  if (!verifyResult.ok) {
    throw new Error(
      'scripts/split-db-into-control-demo-deals.js: --verify gate failed, refusing to finalize:\n' +
      verifyResult.failures.map((f) => ' - ' + f).join('\n')
    );
  }

  // Finalize: rename each temp file (+ WAL/SHM sidecars, if present) over its
  // real path. rename() is atomic on the same filesystem, exactly like the
  // analog's finalize step.
  for (const spec of OUTPUT_SPECS) {
    const tmpPath = tmpPaths[spec.target];
    const finalPath = finalPaths[spec.target];
    for (const ext of ['', '-wal', '-shm']) {
      try {
        if (fs.existsSync(tmpPath + ext)) fs.renameSync(tmpPath + ext, finalPath + ext);
      } catch (e) {
        if (ext === '') throw e; // the main .db file must land; sidecar rename failures are non-fatal
      }
    }
  }

  return { finalPaths };
}

/**
 * Standalone parity check against whatever is already on disk at `outDir`'s
 * final paths — does NOT rebuild anything. Used by `--verify` alone, and
 * exported for tests that want to verify an already-produced split (or
 * detect a deliberately corrupted one) without re-running runSplit().
 */
function verifySplit({ sourcePath = DEFAULT_SOURCE, outDir = DEFAULT_OUT_DIR } = {}) {
  const resolvedSource = path.resolve(sourcePath);
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`scripts/split-db-into-control-demo-deals.js: source database not found at ${resolvedSource}`);
  }
  const resolvedOutDir = path.resolve(outDir);
  const sourceModel = readSourceModel(resolvedSource);

  const finalPaths = {};
  for (const spec of OUTPUT_SPECS) {
    finalPaths[spec.target] = path.join(resolvedOutDir, spec.basename);
  }

  const result = verifyModel(sourceModel, finalPaths);
  if (result.ok) {
    console.log(
      `Split verify OK: ${ARRAY_COLLECTIONS.length} collections + ${SINGLETON_KEYS.length} singletons match source exactly across control/demo/runtime (row-count parity + canonical-JSON field equality, no drops, no duplicates).`
    );
  } else {
    console.error('SPLIT VERIFY FAILED:');
    for (const f of result.failures) console.error(' - ' + f);
  }
  return result.ok;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.verify) {
    console.log(`Verifying split outputs in ${args.out} against ${args.source} (--verify only, no rebuild)`);
    const ok = verifySplit({ sourcePath: args.source, outDir: args.out });
    if (!ok) process.exit(1);
    return;
  }
  console.log(`Splitting ${args.source} -> ${args.out}/{control,demo,runtime}.db`);
  const { finalPaths } = runSplit({ sourcePath: args.source, outDir: args.out });
  console.log(`Split complete and verified (parity gate green before rename): ${Object.values(finalPaths).join(', ')}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  runSplit,
  verifySplit,
  canonicalize,
  canonicalJSON,
  splitSecretFields,
  mergeSecretFields,
  hasField,
};
