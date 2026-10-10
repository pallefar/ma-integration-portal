// D-12-04 / PD-3 / T-12-72 (Phase 12, plan 12-08): two OS PROCESSES appending
// audited writes for the SAME deal must leave ONE contiguous, valid hash chain
// in the deal's partition.
//
// Why this is the proof that matters: every append is BEGIN IMMEDIATE -> read
// the head row -> insert chained rows -> commit on the partition file, so
// SQLite's single write lock linearises appenders across processes. If the
// head were read outside that lock, two processes would both link to the same
// head and fork the chain; verifyChain would then report a prev-link-broken
// row. Each child retries a busy write with the SAME id — safe precisely
// because a busy append rolls the deal write back (Phase 8 CR-01, PD-1), so a
// retry can never duplicate a row: the partition must still hold each
// acknowledged id exactly once.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-audit-chain-mp-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
delete process.env.MA_AUDIT_DIR;

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const controlStore = require('../db/controlStore.js');
const auditChain = require('../db/auditChain.js');
const { createDealDatabase } = require('../db/dealSeed.js');

store.getOrOpenConnection(dbFiles.DEMO_DB_PATH, dbFiles.DEAL_SCHEMA_PATH);

test.after(() => {
  try { store.closeAllConnections(); } catch (e) { /* ignore */ }
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

const WRITES_PER_CHILD = 150;

// The child process: bound to one deal exactly the way a request would be
// (resolver -> runWithDb with an actor), then WRITES_PER_CHILD audited inserts.
const CHILD_SRC = `
const path = require('path');
const root = process.env.CHILD_REPO_ROOT;
const store = require(path.join(root, 'db/store.js'));
const resolver = require(path.join(root, 'db/resolver.js'));
const dealId = process.env.CHILD_DEAL_ID;
const label = process.env.CHILD_LABEL;
const n = parseInt(process.env.CHILD_WRITES, 10);
const fakeReq = { baseUrl: '/api', path: '/mp', portalUser: { username: 'karen', role: 'hrbp', dealId, sessionId: 'sess_' + label } };
const resolved = resolver.resolveDatabase(fakeReq);
const conn = store.getOrOpenConnection(resolved.dbPath, resolved.schemaPath);
const actor = { username: 'karen', role: 'hrbp', sessionId: 'sess_' + label };
const request = { method: 'TEST', path: '/mp', ip: null };
const acked = [];
let busyRetries = 0;
for (let i = 0; i < n; i++) {
  const id = 'mp_' + label + '_' + i;
  for (let attempt = 0; ; attempt++) {
    try {
      store.runWithDb({ conn, kind: resolved.kind, dealId: resolved.dealId, dbPath: resolved.dbPath, actor, request }, () => {
        const db = store.readDb();
        db.alerts = db.alerts.concat([{ id, title: 'mp ' + id, severity: 'low' }]);
        store.writeDb(db);
      });
      acked.push(id);
      break;
    } catch (e) {
      if (e && typeof e.code === 'string' && e.code.startsWith('SQLITE_BUSY') && attempt < 20) { busyRetries++; continue; }
      throw e;
    }
  }
}
process.stdout.write(JSON.stringify({ label, acked, busyRetries }) + '\\n');
`;

function runChild(label, dealId) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', CHILD_SRC], {
      env: {
        ...process.env,
        CHILD_REPO_ROOT: path.join(__dirname, '..'),
        CHILD_DEAL_ID: dealId,
        CHILD_LABEL: label,
        CHILD_WRITES: String(WRITES_PER_CHILD),
      },
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

test('audit-chain-multiprocess: two processes appending to one partition leave a contiguous valid chain', async () => {
  const deal = controlStore.createDeal({ name: 'MP Deal', targetCompany: 'MP Co', members: ['karen'], createdBy: 'admin' });
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const dealId = deal.id;

  const results = await Promise.all([runChild('a', dealId), runChild('b', dealId)]);
  const acked = results.flatMap((r) => r.acked);
  assert.strictEqual(acked.length, 2 * WRITES_PER_CHILD, 'every write was acknowledged');

  const file = dbFiles.auditPartitionPath(dealId);
  assert.ok(fs.existsSync(file), 'the partition exists');
  const conn = dbFiles.openDbFileReadOnly(file);
  try {
    const rows = conn.prepare('SELECT id, row_id, action FROM audit_log ORDER BY id').all();
    assert.strictEqual(rows.length, 2 * WRITES_PER_CHILD, 'exactly one audit row per acknowledged write');
    rows.forEach((r, i) => assert.strictEqual(r.id, i + 1, 'ids are contiguous'));

    const seen = new Map();
    for (const r of rows) seen.set(r.row_id, (seen.get(r.row_id) || 0) + 1);
    for (const id of acked) assert.strictEqual(seen.get(id), 1, `${id} appears exactly once in the partition`);

    const verdict = auditChain.verifyChain(conn, dealId);
    assert.strictEqual(verdict.ok, true, `chain verifies: ${JSON.stringify(verdict.problems.slice(0, 3))}`);
    assert.strictEqual(verdict.rows, 2 * WRITES_PER_CHILD);
  } finally {
    conn.close();
  }

  // And the deal file holds exactly the acknowledged rows (nothing the audit
  // refused, nothing unaudited).
  const dealConn = store.getOrOpenConnection(dbFiles.dealDbPath(dealId), dbFiles.DEAL_SCHEMA_PATH);
  const stored = new Set(dealConn.prepare("SELECT id FROM alerts WHERE id LIKE 'mp\\_%' ESCAPE '\\'").all().map((r) => r.id));
  assert.strictEqual(stored.size, acked.length);
  for (const id of acked) assert.ok(stored.has(id), `${id} is in the deal file`);
});
