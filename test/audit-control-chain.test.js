'use strict';
// D-12-04 (Phase 12, plan 12-13, T-12-121 / T-12-122): from migration #1 on every
// control-plane event is appended HASH-CHAINED to audit.db (genesis 'control').
//
// The proof that matters is cross-process: the denial auditor (Phase 11), routes
// and CLIs all append to one audit.db from different OS processes. The chain
// head is read under BEGIN IMMEDIATE (db/auditChain.js), so SQLite's single
// write lock must linearise them — if it did not, two appenders would link to
// the same head and verifyChain would report a prev-link-broken row.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const { REPO, cleanEnv } = require('./helpers/boot-probe');
const auditChain = require('../db/auditChain');

const dirs = [];
function tmp(label) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `gsd-12-13-chain-${label}-`));
  dirs.push(d);
  return d;
}
process.on('exit', () => {
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
});

const EVENTS_PER_CHILD = 200;

// One child: half plain recordSecurityEvent() rows, half Phase 11 `access-denied`
// rows through createDenialAuditor with the SAME injected writer server.js uses.
const CHILD_SRC = `
const path = require('path');
const root = process.env.CHILD_REPO_ROOT;
const hook = require(path.join(root, 'db/auditHook.js'));
const { createDenialAuditor } = require(path.join(root, 'lib/denialAudit.js'));
const label = process.env.CHILD_LABEL;
const n = parseInt(process.env.CHILD_EVENTS, 10);
const denial = createDenialAuditor({ windowMs: 3600000, write: (event) => hook.recordSecurityEvent(event) });
let written = 0;
for (let i = 0; i < n; i++) {
  let attempt = 0;
  for (;;) {
    try {
      if (i % 2 === 0) {
        hook.recordSecurityEvent({
          actor: { username: 'user-' + label, role: 'admin', sessionId: 'sess-' + label },
          action: 'chain-test', subject: label + '-' + i, after: { i }, request: { method: 'TEST', path: '/chain', ip: null },
        });
        written++;
      } else {
        // a unique route template per call => a fresh key => one row each
        if (denial.record({
          actor: { username: 'user-' + label, role: 'employee', sessionId: 'sess-' + label },
          method: 'GET', path: '/api/probe-' + label + '-' + i, reason: 'role', status: 403, route: '/api/probe-' + label + '-' + i,
          dealId: null, request: { method: 'GET', path: '/api/probe-' + label + '-' + i, ip: '10.0.0.1' },
        })) written++;
      }
      break;
    } catch (e) {
      if (e && typeof e.code === 'string' && e.code.startsWith('SQLITE_BUSY') && attempt++ < 20) continue;
      throw e;
    }
  }
}
hook.closeAuditConnection();
process.stdout.write(JSON.stringify({ label, written }) + '\\n');
`;

function runChild(label, paths) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', CHILD_SRC], {
      env: cleanEnv({
        ...paths, CHILD_REPO_ROOT: REPO, CHILD_LABEL: label, CHILD_EVENTS: String(EVENTS_PER_CHILD),
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`child ${label} exited ${code}: ${err}`));
      try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch (e) { reject(new Error(`child ${label} bad output: ${out} ${err}`)); }
    });
  });
}

function isolated(dir) {
  return {
    MA_CONTROL_DB_PATH: path.join(dir, 'control.db'),
    MA_RUNTIME_DB_PATH: path.join(dir, 'runtime.db'),
    MA_DEMO_DB_PATH: path.join(dir, 'demo.db'),
    MA_AUDIT_DB_PATH: path.join(dir, 'audit.db'),
    MA_DEALS_DIR: path.join(dir, 'deals'),
  };
}

test('two processes record 200 security events each (incl. access-denied via the denial auditor) -> one contiguous valid control chain', async () => {
  const dir = tmp('mp');
  const paths = isolated(dir);
  // Create the file once (fresh v1) so the children race on appends, not on creation.
  const seed = await runChild('seed', paths);
  assert.strictEqual(seed.written, EVENTS_PER_CHILD);

  const results = await Promise.all([runChild('a', paths), runChild('b', paths)]);
  for (const r of results) assert.strictEqual(r.written, EVENTS_PER_CHILD, `child ${r.label} wrote every event`);

  const conn = new Database(paths.MA_AUDIT_DB_PATH, { readonly: true });
  try {
    const rows = conn.prepare('SELECT id, action, actor_username FROM audit_log ORDER BY id').all();
    assert.strictEqual(rows.length, 3 * EVENTS_PER_CHILD, '400 new rows (+ the 200 seed rows), none lost, none duplicated');
    rows.forEach((r, i) => assert.strictEqual(r.id, i + 1, 'ids are contiguous'));
    for (const label of ['a', 'b']) {
      const mine = rows.filter((r) => r.actor_username === `user-${label}`);
      assert.strictEqual(mine.length, EVENTS_PER_CHILD);
      assert.strictEqual(mine.filter((r) => r.action === 'access-denied').length, EVENTS_PER_CHILD / 2);
    }
    const verdict = auditChain.verifyChain(conn, 'control');
    assert.strictEqual(verdict.ok, true, `chain verifies: ${JSON.stringify(verdict.problems.slice(0, 3))}`);
    assert.strictEqual(verdict.rows, 3 * EVENTS_PER_CHILD);
    assert.strictEqual(conn.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE row_hash IS NULL OR prev_hash IS NULL').get().n, 0);
  } finally {
    conn.close();
  }
});

test('a fresh install: audit.db is created at version 1 and the first security event chains from genesis control', async () => {
  const dir = tmp('fresh');
  const paths = isolated(dir);
  const child = spawn(process.execPath, ['-e', `
    const hook = require(process.env.CHILD_REPO_ROOT + '/db/auditHook.js');
    hook.recordSecurityEvent({ actor: { username: 'admin', role: 'admin' }, action: 'first-event', subject: 'x' });
    hook.closeAuditConnection();
  `], { env: cleanEnv({ ...paths, CHILD_REPO_ROOT: REPO }), stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.strictEqual(code, 0, err);

  const conn = new Database(paths.MA_AUDIT_DB_PATH, { readonly: true });
  try {
    assert.strictEqual(conn.pragma('user_version', { simple: true }), 1);
    const rows = conn.prepare('SELECT * FROM audit_log ORDER BY id').all();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].prev_hash, auditChain.genesisHash('control'));
    assert.strictEqual(rows[0].row_hash, auditChain.rowHash(rows[0], rows[0].prev_hash));
    assert.strictEqual(rows[0].legacy_id, null);
  } finally {
    conn.close();
  }
});
