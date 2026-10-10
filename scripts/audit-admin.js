#!/usr/bin/env node
// D-12-04 (Phase 12, plan 12-12): host-local operator CLI for the audit
// partition LIFECYCLE — the same seal / export / purge the admin routes under
// /api/admin/deals/:id/audit… expose, for a host operator (and for a host whose
// server is stopped). One orchestration (db/auditLifecycle.js) behind both, so
// the two surfaces can never disagree.
//
// Usage:
//   node scripts/audit-admin.js list
//   node scripts/audit-admin.js status <partitionId> [--json]
//   node scripts/audit-admin.js seal   <partitionId> --confirm <partitionId>
//   node scripts/audit-admin.js export <partitionId> --out <file.jsonl>
//   node scripts/audit-admin.js purge  <partitionId> --confirm <partitionId>
//
// <partitionId> is a deal id (deal_...) or `legacy`.
//
// Exit codes: 0 done, 1 refused (a fixed reason code is printed), 2 usage error
// or a failure.
//
// [security]
//   - Nothing here is ever scheduled: seal and purge are explicit commands with
//     a typed `--confirm <id>` (T-12-111). Purge is refused unless the partition
//     is sealed, unmodified since the seal, a sealed export exists and the
//     retention period (MA_AUDIT_RETENTION_DAYS, default never) has elapsed.
//   - Every step records a control-plane event in audit.db with actor
//     `cli:<os-user>` (`:` is outside the username charset, so it can never
//     collide with a real account — same convention as bootstrap-admin.js).
//     Seal events carry the file's SHA-256; export events the export's.
//   - No secret is ever read from or printed to argv; the only values are
//     partition ids and a file path.
//   - `export` writes the JSONL as a NEW 0600 file and refuses to overwrite an
//     existing one: the export carries the full MNPI trail out of the data
//     directory — handle it like the database itself.
//   - MA_MODE defaults to `real` when this file is run directly (it is the
//     real-host tool). The committed data/*.db are never opened for writing
//     (db/dbFiles.js openDbFile refuses them in real mode).

const fs = require('fs');
const os = require('os');

const COMMANDS = new Set(['list', 'status', 'seal', 'export', 'purge']);

function usage() {
  return [
    'Usage: node scripts/audit-admin.js <command> [<partitionId>] [options]',
    '  list                                     partitions on this host',
    '  status <partitionId> [--json]            seal / export / retention state + lifecycle events',
    '  seal   <partitionId> --confirm <id>      seal an ARCHIVED or deleted deal\'s trail (read-only + SHA-256 event)',
    '  export <partitionId> --out <file.jsonl>  write the sealed trail as JSONL (new 0600 file)',
    '  purge  <partitionId> --confirm <id>      delete a sealed, exported trail once retention has elapsed',
    '<partitionId> is a deal id or `legacy`. Verify with: node scripts/audit-verify.js --deal <id> | --jsonl <file>',
  ].join('\n');
}

/** Returns { command, id, confirm, out, json, help } or { error }. Pure — no I/O. */
function parseArgv(args) {
  const out = { command: null, id: null, confirm: null, out: null, json: false, help: false };
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (a === '--json') { out.json = true; continue; }
    const m = /^(--confirm|--out)(?:=(.*))?$/.exec(a);
    if (m) {
      const value = m[2] !== undefined ? m[2] : args[++i];
      if (value === undefined || value === '' || value.startsWith('--')) return { error: `${m[1]} needs a value.\n${usage()}` };
      if (m[1] === '--confirm') out.confirm = value; else out.out = value;
      continue;
    }
    if (a.startsWith('-')) return { error: `Unknown option ${a}.\n${usage()}` };
    positional.push(a);
  }
  if (out.help) return out;
  if (positional.length === 0) return { error: `A command is required.\n${usage()}` };
  out.command = positional[0];
  if (!COMMANDS.has(out.command)) return { error: `Unknown command ${JSON.stringify(out.command)}.\n${usage()}` };
  if (out.command === 'list') {
    if (positional.length > 1) return { error: `list takes no argument.\n${usage()}` };
  } else {
    if (positional.length !== 2) return { error: `${out.command} needs exactly one <partitionId>.\n${usage()}` };
    out.id = positional[1];
  }
  return out;
}

function currentOsUser() {
  try { return os.userInfo().username; } catch (e) { return process.env.USER || process.env.USERNAME || 'unknown'; }
}

/** The deal registry state of `id`, read READ-ONLY (never migrates or creates control.db). */
function readDealState(dbFiles, id) {
  if (!fs.existsSync(dbFiles.CONTROL_DB_PATH)) return 'absent';
  const conn = dbFiles.openDbFileReadOnly(dbFiles.CONTROL_DB_PATH);
  try {
    const row = conn.prepare('SELECT data FROM deals WHERE id = ?').get(id);
    if (!row) return 'absent';
    let status = null;
    try { status = JSON.parse(row.data).status; } catch (e) { status = null; }
    return status === 'archived' ? 'archived' : 'active';
  } finally {
    try { conn.close(); } catch (e) { /* ignore */ }
  }
}

function fmtStatus(s, out) {
  out(`partition      ${s.partition}`);
  out(`exists         ${s.exists ? 'yes' : 'no'}`);
  if (!s.exists) return;
  out(`rows           ${s.rows}`);
  out(`head           ${s.headHash}`);
  out(`sealed         ${s.sealed ? 'yes' : 'no'}${s.sealed ? '' : ` (writable=${s.writable ? 'yes' : 'no'})`}`);
  if (s.sealed) {
    out(`sealed at      ${s.sealedAt || '(no seal event)'}`);
    out(`sealed sha256  ${s.sealedSha256 || '(no seal event)'}`);
    out(`file sha256    ${s.fileSha256}`);
    out(`file == seal   ${s.fileMatchesSeal === null ? 'unknown (no seal event)' : (s.fileMatchesSeal ? 'yes' : 'NO — MODIFIED AFTER SEAL')}`);
  }
  out(`exports        ${s.exports.length}`);
  out(`retention      ${s.retentionDays === null ? 'never (MA_AUDIT_RETENTION_DAYS unset)' : `${s.retentionDays} days from the seal`}`);
  out(`purge          ${s.purgeAllowed ? 'ALLOWED' : `refused: ${s.purgeBlockedBy}`}${s.purgeEligibleAt ? ` (eligible ${s.purgeEligibleAt})` : ''}`);
  out('control events:');
  if (s.events.length === 0) out('  (none)');
  for (const e of s.events) out(`  ${e.at}  ${e.action}  by ${e.actor}  ${e.detail ? JSON.stringify(e.detail) : ''}`);
}

/**
 * Run one command. Returns the exit code; `io.out` / `io.err` are injectable.
 * `opts.osUser` / `opts.now` / `opts.env` are for tests.
 */
async function run(argv, opts) {
  const o = opts || {};
  const out = (o.io && o.io.out) || ((s) => console.log(s));
  const err = (o.io && o.io.err) || ((s) => console.error(s));
  const parsed = parseArgv(argv);
  if (parsed.error) { err(parsed.error); return 2; }
  if (parsed.help) { out(usage()); return 0; }

  const dbFiles = require('../db/dbFiles');
  const auditHook = require('../db/auditHook');
  const lifecycle = require('../db/auditLifecycle');

  const { command, id } = parsed;
  if (id !== null) {
    // [security] CR-01 (12-REVIEW): the same FILE-IDENTITY rule as the routes
    // (db/dbFiles.js resolveAuditPartitionId) — the id must exactly equal a
    // registered deal id or an exact-case partition file basename, so a case
    // variant of a live deal's id can never reach its partition file.
    const r = dbFiles.resolveAuditPartitionId(id, (x) => readDealState(dbFiles, x) !== 'absent');
    if (!r.ok && r.reason === 'malformed') {
      err(`Invalid partition id — expected a deal id (deal_...) or "legacy".`);
      return 2;
    }
    if (!r.ok) {
      err('Unknown partition id — no registered deal and no audit partition has exactly that id.');
      return 2;
    }
  }
  if ((command === 'seal' || command === 'purge') && parsed.confirm !== id) {
    err(`${command} needs --confirm <partitionId> exactly equal to the partition id.`);
    return 2;
  }
  if (command === 'export' && !parsed.out) {
    err('export needs --out <file.jsonl>.');
    return 2;
  }

  const actorName = 'cli:' + (o.osUser || currentOsUser());
  const actor = { username: actorName, role: 'cli' };
  const auditDbExists = fs.existsSync(dbFiles.AUDIT_DB_PATH);
  const readOnlyCommand = command === 'list' || command === 'status';

  if (!parsed.json) out(`[security] audit directory: ${dbFiles.AUDIT_DIR}`);
  if (command === 'list') {
    const ids = auditHook.listPartitions();
    if (ids.length === 0) out('(no audit partitions on this host)');
    for (const pid of ids) {
      const s = lifecycle.partitionStatus(pid, {});
      out(`${pid}  rows=${s.rows}  sealed=${s.sealed ? 'yes' : 'no'}  writable=${s.writable ? 'yes' : 'no'}`);
    }
    return 0;
  }

  const deps = {
    dealState: () => readDealState(dbFiles, id),
    // A read-only command on a host with no audit.db must not create one.
    findEvents: (actions) => ((readOnlyCommand && !auditDbExists) ? [] : auditHook.findControlEvents({ dealId: id, action: actions })),
    recordEvent: (ev) => auditHook.recordSecurityEvent({
      actor, action: ev.action, dealId: id, subject: id, after: ev.after,
      request: { method: 'CLI', path: `audit-admin ${command}`, ip: null },
    }),
    closeConnection: () => {},
    actor,
    now: o.now instanceof Date ? o.now : new Date(),
    env: o.env || process.env,
  };

  if (command === 'status') {
    const s = lifecycle.lifecycleStatus(id, deps);
    if (parsed.json) out(JSON.stringify(Object.assign({ dealState: deps.dealState() }, s), null, 2));
    else { fmtStatus(s, out); out(`deal state     ${deps.dealState()}`); }
    return 0;
  }

  if (command === 'seal') {
    const r = lifecycle.sealPartition(id, deps);
    if (r.outcome === 'refused') {
      err(`REFUSED ${r.reason}: ${lifecycle.REFUSAL_MESSAGES[r.reason]}`);
      return 1;
    }
    out(`SEALED ${id} rows=${r.rows} head=${r.headHash} sha256=${r.sha256}${r.alreadySealed ? ' (already sealed)' : ''}`);
    return 0;
  }

  if (command === 'export') {
    const target = parsed.out;
    if (fs.existsSync(target)) {
      err('REFUSED: the --out file already exists; choose a new path (an export is never overwritten).');
      return 2;
    }
    let fd = null;
    const cleanup = () => {
      if (fd !== null) { try { fs.closeSync(fd); } catch (e) { /* ignore */ } fd = null; }
    };
    let result;
    try {
      result = await lifecycle.exportPartition(id, Object.assign({}, deps, {
        onReady: () => { fd = fs.openSync(target, 'wx', 0o600); },
        write: (chunk) => { fs.writeSync(fd, chunk); },
      }));
    } catch (e) {
      cleanup();
      try { fs.unlinkSync(target); } catch (u) { /* ignore */ }
      throw e;
    }
    if (fd !== null) { try { fs.fsyncSync(fd); } catch (e) { /* ignore */ } }
    cleanup();
    if (result.outcome === 'refused') {
      try { fs.unlinkSync(target); } catch (e) { /* ignore: nothing was created */ }
      err(`REFUSED ${result.reason}: ${lifecycle.REFUSAL_MESSAGES[result.reason]}`);
      return 1;
    }
    try { fs.chmodSync(target, 0o600); } catch (e) { /* win32 */ }
    out(`EXPORTED ${id} -> ${target} rows=${result.rows} sha256=${result.sha256} sealedSha256=${result.sealedSha256}`);
    return 0;
  }

  // purge
  const r = lifecycle.purgePartition(id, deps);
  if (r.outcome === 'refused') {
    err(`REFUSED ${r.reason}: ${lifecycle.REFUSAL_MESSAGES[r.reason]}${r.eligibleAt ? ` (eligible ${r.eligibleAt})` : ''}`);
    return 1;
  }
  if (r.outcome === 'failed') {
    err('FAILED the audit trail could not be removed (unlink failed); the purge was recorded as failed.');
    return 2;
  }
  out(`PURGED ${id} rows=${r.rows} head=${r.headHash} sealedSha256=${r.sealedSha256} exportSha256=${r.exportSha256}`);
  return 0;
}

async function main() {
  // The real-host tool: default the mode BEFORE any db module is required.
  if (!process.env.MA_MODE) process.env.MA_MODE = 'real';
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (e) {
    const busy = e && typeof e.code === 'string' && e.code.startsWith('SQLITE_BUSY');
    console.error(busy
      ? 'audit-admin: the audit database is busy; try again in a moment.'
      : `audit-admin failed: ${e && e.message ? e.message : e}`);
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main();
}

module.exports = { run, parseArgv, usage, readDealState, currentOsUser };
