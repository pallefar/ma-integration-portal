#!/usr/bin/env node
// D-12-04 (Phase 12): verify the hash chain of one or more audit files.
//
// Usage:
//   node scripts/audit-verify.js <file.db> [<file.db> ...]
//   node scripts/audit-verify.js --deal <dealId>
//   node scripts/audit-verify.js --all
//
//   --deal <id>   data/audit/<id>.db (the resolved audit directory)
//   --all         every partition in the audit directory (deal_*.db, legacy.db);
//                 audit.db is reported `unchained` until plan 12-13 chains it
//
// The audit directory is resolved exactly as the server resolves it
// (db/dbFiles.js AUDIT_DIR: MA_AUDIT_DIR, else next to MA_AUDIT_DB_PATH, else
// <data dir>/audit — set MA_MODE=real / MA_DATA_DIR for a real-deal host).
//
// Output, one line per file:
//   OK <file> rows=<n> head=<hash> sealed=<yes|no>
//   FAIL <file> id=<k> <reason>        (reason: row-hash-mismatch | prev-link-broken | unchained-row | genesis-mismatch)
//   UNCHAINED <file> (pre-12-13)       (audit.db before plan 12-13)
// Exit code: 0 every file verified, 1 at least one FAIL, 2 usage / unreadable file.
//
// [security] Files are opened READ-ONLY with no chmod, schema exec or migration
// (db/dbFiles.js openDbFileReadOnly): verifying a sealed 0400 partition never
// re-opens it writable and never changes it. The partition id the chain is
// bound to is derived from the FILE NAME (genesis = sha256('ma-audit-genesis|'
// + id)), so a partition renamed or swapped into another deal's slot fails at
// its first row.

const fs = require('fs');
const path = require('path');
const dbFiles = require('../db/dbFiles');
const auditChain = require('../db/auditChain');

const PARTITION_FILE_RE = /^(deal_[a-z0-9]+|legacy)\.db$/i;

/** The partition id a file's chain is bound to: audit.db -> control, X.db -> X. */
function partitionIdFor(file) {
  const base = path.basename(file).replace(/\.db$/i, '');
  return base === 'audit' ? 'control' : base;
}

/**
 * Verify one file. Returns `{ file, status: 'ok'|'fail'|'unchained'|'error',
 * line, exit }` where `line` is the printable report line.
 */
function verifyFile(file) {
  let conn;
  try {
    conn = dbFiles.openDbFileReadOnly(file);
  } catch (e) {
    return { file, status: 'error', line: `ERROR ${file} cannot open: ${e && e.message ? e.message : e}`, exit: 2 };
  }
  try {
    const cols = conn.prepare("PRAGMA table_info('audit_log')").all().map((c) => c.name);
    if (!cols.includes('row_hash') || !cols.includes('prev_hash')) {
      return { file, status: 'unchained', line: `UNCHAINED ${file} (pre-12-13)`, exit: 0 };
    }
    const result = auditChain.verifyChain(conn, partitionIdFor(file));
    if (result.ok) {
      return {
        file, status: 'ok', result, exit: 0,
        line: `OK ${file} rows=${result.rows} head=${result.headHash} sealed=${result.sealed ? 'yes' : 'no'}`,
      };
    }
    // The first row failing its genesis link is the signature of a renamed or
    // swapped file; say so rather than a bare prev-link-broken.
    const first = conn.prepare('SELECT id FROM audit_log ORDER BY id LIMIT 1').get();
    const reason = result.reason === 'prev-link-broken' && first && first.id === result.badId ? 'genesis-mismatch' : result.reason;
    return { file, status: 'fail', result, exit: 1, line: `FAIL ${file} id=${result.badId} ${reason}` };
  } catch (e) {
    return { file, status: 'error', line: `ERROR ${file} ${e && e.message ? e.message : e}`, exit: 2 };
  } finally {
    try { conn.close(); } catch (e) { /* ignore */ }
  }
}

function usage(out) {
  out('usage: node scripts/audit-verify.js <file.db>... | --deal <dealId> | --all');
}

/**
 * CLI entry. `out`/`err` are injectable for tests. Returns the exit code.
 */
function main(argv, io) {
  const out = (io && io.out) || ((s) => console.log(s));
  const err = (io && io.err) || ((s) => console.error(s));
  const args = argv.slice();
  const files = [];
  let all = false;
  while (args.length) {
    const a = args.shift();
    if (a === '--all') {
      all = true;
    } else if (a === '--deal') {
      const id = args.shift();
      let p;
      try { p = dbFiles.auditPartitionPath(id); } catch (e) { err('audit-verify: --deal needs a valid deal id'); usage(err); return 2; }
      files.push(p);
    } else if (a === '-h' || a === '--help') {
      usage(out);
      return 0;
    } else if (a.startsWith('--')) {
      err(`audit-verify: unknown option ${a}`);
      usage(err);
      return 2;
    } else {
      files.push(a);
    }
  }
  if (all) {
    let listing = [];
    try { listing = fs.readdirSync(dbFiles.AUDIT_DIR); } catch (e) { if (e.code !== 'ENOENT') { err(`audit-verify: cannot read ${dbFiles.AUDIT_DIR}`); return 2; } }
    for (const name of listing.sort()) if (PARTITION_FILE_RE.test(name)) files.push(path.join(dbFiles.AUDIT_DIR, name));
    if (fs.existsSync(dbFiles.AUDIT_DB_PATH)) files.push(dbFiles.AUDIT_DB_PATH);
  }
  if (files.length === 0 && !all) {
    usage(err);
    return 2;
  }
  let code = 0;
  for (const file of files) {
    if (!fs.existsSync(file)) {
      err(`ERROR ${file} does not exist`);
      if (code !== 1) code = 2;
      continue;
    }
    const r = verifyFile(file);
    out(r.line);
    // A FAIL (1) outranks a usage/unreadable error (2) only in that a tamper
    // finding must never be masked: report the highest-severity condition.
    if (r.exit === 1) code = 1;
    else if (r.exit === 2 && code !== 1) code = 2;
  }
  return code;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { main, verifyFile, partitionIdFor };
