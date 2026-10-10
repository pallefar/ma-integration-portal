#!/usr/bin/env node
// D-12-04 (Phase 12): verify the hash chain of one or more audit files.
//
// Usage:
//   node scripts/audit-verify.js <file.db> [<file.db> ...]
//   node scripts/audit-verify.js --deal <dealId>
//   node scripts/audit-verify.js --all
//   node scripts/audit-verify.js --jsonl <export.jsonl>
//
//   --jsonl <f>   verify an exported partition on its own (header + chained
//                 rows; prints the file's SHA-256 for the export event)
//   --deal <id>   data/audit/<id>.db (the resolved audit directory)
//   --all         every partition in the audit directory (deal_*.db, legacy.db);
//                 audit.db is reported `unchained` until plan 12-13 chains it
//
// The audit directory is resolved exactly as the server resolves it
// (db/dbFiles.js AUDIT_DIR: MA_AUDIT_DIR, else next to MA_AUDIT_DB_PATH, else
// <data dir>/audit — set MA_MODE=real / MA_DATA_DIR for a real-deal host).
//
// Output, one line per file:
//   OK <file> rows=<n> head=<hash> sealed=<yes|no> [sealed-sha=<match|no-event>]
//   FAIL <file> id=<k> <reason> [sealed-sha=MISMATCH]
//                                      (reason: row-hash-mismatch | prev-link-broken | unchained-row | genesis-mismatch)
//   FAIL <file> rows=<n> head=<hash> chain=ok sealed-sha=MISMATCH   (chain intact, bytes differ from the seal event)
// For a SEALED partition (plan 12-12) the file's SHA-256 is compared with the
// latest `audit-partition-sealed` control event in audit.db (read-only): a
// flipped byte exits 1 with sealed-sha=MISMATCH.
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
const auditLifecycle = require('../db/auditLifecycle');

const PARTITION_FILE_RE = /^(deal_[a-z0-9]+|legacy)\.db$/i;

/** The partition id a file's chain is bound to: audit.db -> control, X.db -> X. */
function partitionIdFor(file) {
  const base = path.basename(file).replace(/\.db$/i, '');
  return base === 'audit' ? 'control' : base;
}

/**
 * [security] D-12-04 / PD-7 / T-12-110 (plan 12-12): the SHA-256 the latest
 * `audit-partition-sealed` control event recorded for `partitionId`, read from
 * audit.db READ-ONLY (never opened writable, never migrated). null when there is
 * no such event, no audit.db, or it cannot be read.
 */
function recordedSealSha(partitionId) {
  const auditDb = dbFiles.AUDIT_DB_PATH;
  if (!fs.existsSync(auditDb)) return null;
  let conn;
  try {
    conn = dbFiles.openDbFileReadOnly(auditDb);
  } catch (e) {
    return null;
  }
  try {
    const row = conn.prepare(
      "SELECT after_json FROM audit_log WHERE db_kind = 'control' AND action = 'audit-partition-sealed' AND deal_id = ? ORDER BY id DESC LIMIT 1"
    ).get(partitionId);
    if (!row || typeof row.after_json !== 'string') return null;
    const after = JSON.parse(row.after_json);
    return after && typeof after.sha256 === 'string' ? after.sha256 : null;
  } catch (e) {
    return null;
  } finally {
    try { conn.close(); } catch (e) { /* ignore */ }
  }
}

/**
 * Compare a SEALED partition's file hash with its recorded seal event.
 * Returns 'match' | 'MISMATCH' | 'no-event' (sealed but nothing recorded — the
 * crash window of PD-7; a repeated seal repairs it) | null (not a sealed
 * partition: nothing to compare, the line is unchanged from plan 12-08).
 */
function sealedShaCheck(file, partitionId, chainSealed) {
  if (partitionId === 'control') return null;
  const recorded = recordedSealSha(partitionId);
  if (!recorded) return chainSealed ? 'no-event' : null;
  return auditLifecycle.fileSha256(file) === recorded ? 'match' : 'MISMATCH';
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
    const partitionId = partitionIdFor(file);
    const result = auditChain.verifyChain(conn, partitionId);
    // D-12-04 (plan 12-12): a sealed partition's bytes must also hash to the
    // SHA-256 its seal event recorded. A flipped byte fails BOTH the chain and
    // this check; an edit that re-computed the chain still fails this one.
    const shaCheck = sealedShaCheck(file, partitionId, result.sealed);
    const shaSuffix = shaCheck ? ` sealed-sha=${shaCheck}` : '';
    if (result.ok && shaCheck !== 'MISMATCH') {
      return {
        file, status: 'ok', result, exit: 0, sealedSha: shaCheck,
        line: `OK ${file} rows=${result.rows} head=${result.headHash} sealed=${result.sealed ? 'yes' : 'no'}${shaSuffix}`,
      };
    }
    if (result.ok) {
      return {
        file, status: 'fail', result, exit: 1, sealedSha: shaCheck,
        line: `FAIL ${file} rows=${result.rows} head=${result.headHash} chain=ok${shaSuffix}`,
      };
    }
    // The first row failing its genesis link is the signature of a renamed or
    // swapped file; say so rather than a bare prev-link-broken.
    const first = conn.prepare('SELECT id FROM audit_log ORDER BY id LIMIT 1').get();
    const reason = result.reason === 'prev-link-broken' && first && first.id === result.badId ? 'genesis-mismatch' : result.reason;
    return { file, status: 'fail', result, exit: 1, sealedSha: shaCheck, line: `FAIL ${file} id=${result.badId} ${reason}${shaSuffix}` };
  } catch (e) {
    return { file, status: 'error', line: `ERROR ${file} ${e && e.message ? e.message : e}`, exit: 2 };
  } finally {
    try { conn.close(); } catch (e) { /* ignore */ }
  }
}

/**
 * [security] D-12-04 (plan 12-12): verify an exported JSONL on its own — no
 * database, no audit.db. Line 1 is the `ma-audit-export` header; every other
 * line is one row. The chain is walked from the partition-bound genesis
 * (derived from the header's partition id), so an edited, deleted, reordered or
 * appended line, or a truncated file, fails. The file's own SHA-256 is printed
 * so it can be compared with the `audit-partition-exported` control event.
 */
function verifyJsonl(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { file, status: 'error', exit: 2, line: `ERROR ${file} cannot read: ${e && e.message ? e.message : e}` };
  }
  const fail = (lineNo, reason) => ({ file, status: 'fail', exit: 1, line: `FAIL ${file} line=${lineNo} ${reason}` });
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) return fail(1, 'empty-file');
  let header;
  try { header = JSON.parse(lines[0]); } catch (e) { return fail(1, 'header-not-json'); }
  const partition = header && header.partition;
  if (!header || header.type !== 'ma-audit-export' || header.version !== 1
      || typeof partition !== 'string' || !(dbFiles.DEAL_ID_RE.test(partition) || partition === 'legacy')) {
    return fail(1, 'bad-header');
  }
  let prev = auditChain.genesisHash(partition);
  let lastId = 0;
  let rows = 0;
  for (let i = 1; i < lines.length; i += 1) {
    let row;
    try { row = JSON.parse(lines[i]); } catch (e) { return fail(i + 1, 'row-not-json'); }
    if (!row || typeof row !== 'object' || typeof row.row_hash !== 'string' || typeof row.prev_hash !== 'string') {
      return fail(i + 1, 'unchained-row');
    }
    if (!Number.isInteger(row.id) || row.id <= lastId) return fail(i + 1, 'id-order');
    if (row.prev_hash !== prev) return fail(i + 1, 'prev-link-broken');
    if (auditChain.rowHash(row, row.prev_hash) !== row.row_hash) return fail(i + 1, 'row-hash-mismatch');
    prev = row.row_hash;
    lastId = row.id;
    rows += 1;
  }
  if (rows !== header.rowCount) return fail(lines.length, 'row-count-mismatch');
  if (prev !== header.headHash) return fail(lines.length, 'head-mismatch');
  const sha = auditLifecycle.fileSha256(file);
  return {
    file, status: 'ok', exit: 0, sha256: sha,
    line: `OK ${file} jsonl partition=${partition} rows=${rows} head=${prev} sha256=${sha}`,
  };
}

function usage(out) {
  out('usage: node scripts/audit-verify.js <file.db>... | --deal <dealId> | --all | --jsonl <export.jsonl>');
}

/**
 * CLI entry. `out`/`err` are injectable for tests. Returns the exit code.
 */
function main(argv, io) {
  const out = (io && io.out) || ((s) => console.log(s));
  const err = (io && io.err) || ((s) => console.error(s));
  const args = argv.slice();
  const files = [];
  const jsonlFiles = [];
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
    } else if (a === '--jsonl') {
      const jf = args.shift();
      if (!jf) { err('audit-verify: --jsonl needs a file'); usage(err); return 2; }
      jsonlFiles.push(jf);
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
  if (files.length === 0 && jsonlFiles.length === 0 && !all) {
    usage(err);
    return 2;
  }
  let code = 0;
  for (const jf of jsonlFiles) {
    const r = verifyJsonl(jf);
    out(r.line);
    if (r.exit === 1) code = 1;
    else if (r.exit === 2 && code !== 1) code = 2;
  }
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

module.exports = { main, verifyFile, verifyJsonl, partitionIdFor };
