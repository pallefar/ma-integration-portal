'use strict';
// Phase 12 (plan 12-13, PD-31, checker W-2): generator of a SYNTHETIC legacy
// (version-0, unchained) audit.db plus a matching control.db, for rehearsing
// migration #1 of the audit family (db/migrations/audit/001-partition-legacy.js)
// at a stated volume.
//
//   const { buildLegacyAuditTree } = require('./lib/legacy-audit-volume');
//   const tree = buildLegacyAuditTree({ dir, rows: 150000 });
//   // { auditPath, controlPath, rows, fileBytes, presentDeals, absentDeals, expected }
//
// WHY SYNTHETIC. The migration cost matters on a host whose real audit file may
// be years old, but a real MNPI file must never feed a test artifact, and
// executors run in worktrees where the developer's data/audit.db does not exist.
// So the volume is manufactured: deterministic pseudo-random rows of ~rowBytes
// (default 1 KB — a before/after JSON snapshot pair), spread over `dealIds`
// deal ids of which `presentShare` are registered in the generated control.db
// (those migrate into their own partition) and the rest are not (those land in
// the sealed `legacy` partition); `controlShare` of the rows are control-plane
// events that stay in audit.db.
//
// DISK. This host is often >= 90 % full, so the generator is capped: `rows` >
// MAX_ROWS (300,000 ~ 340 MB of source file; peak scratch of a migration is
// ~4x that) is refused BEFORE anything is written (error code ROWS_CAP).
//
// The file is built with the verbatim pre-Phase-12 schema
// (test/fixtures/legacy-audit-v0.sql: no hash columns, user_version 0) so it is
// exactly what an upgrade finds on disk.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const V0_SCHEMA = path.join(REPO_ROOT, 'test', 'fixtures', 'legacy-audit-v0.sql');
const CONTROL_SCHEMA = path.join(REPO_ROOT, 'db', 'control-schema.sql');

const MAX_ROWS = 300000;
const DEFAULT_ROWS = 150000;
const INSERT_BATCH = 5000;
// Source-file bytes per row: the two JSON snapshots (rowBytes) + the other
// columns, the three indexes and page overhead. Measured at ~1.14 KB/row for
// rowBytes = 1024 (150,000 rows ~ 170 MB); used to PROJECT size before writing.
const OVERHEAD_BYTES_PER_ROW = 130;

/** mulberry32: small deterministic PRNG so two runs build byte-comparable data. */
function prng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function projectedFileBytes(rows, rowBytes) {
  return Math.round(rows * ((rowBytes || 1024) + OVERHEAD_BYTES_PER_ROW));
}

function dealIdFor(index) {
  return `deal_gen${index.toString(36).padStart(5, '0')}`;
}

function refuse(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * @param {object} o
 * @param {string} o.dir            existing directory the two files are written into
 * @param {number} [o.rows=150000]  total audit rows (max 300,000)
 * @param {number} [o.dealIds=1000]
 * @param {number} [o.controlShare=0.05]  share of rows that are control-plane events
 * @param {number} [o.presentShare=0.8]   share of deal ids registered in control.db
 * @param {number} [o.rowBytes=1024]      approx bytes of before+after JSON per row
 * @param {number} [o.seed=12013]
 */
function buildLegacyAuditTree(o = {}) {
  const rows = o.rows === undefined ? DEFAULT_ROWS : o.rows;
  const dealIds = o.dealIds === undefined ? 1000 : o.dealIds;
  const controlShare = o.controlShare === undefined ? 0.05 : o.controlShare;
  const presentShare = o.presentShare === undefined ? 0.8 : o.presentShare;
  const rowBytes = o.rowBytes === undefined ? 1024 : o.rowBytes;
  const seed = o.seed === undefined ? 12013 : o.seed;

  if (!Number.isInteger(rows) || rows < 1) throw refuse('ROWS_INVALID', `rows must be a positive integer, got ${rows}`);
  if (rows > MAX_ROWS) {
    throw refuse('ROWS_CAP', `rows ${rows} exceeds the cap of ${MAX_ROWS} (the host disk is shared and often nearly full) — nothing was written`);
  }
  if (!o.dir || !fs.existsSync(o.dir)) throw refuse('DIR_MISSING', 'dir must be an existing directory');
  if (!Number.isInteger(dealIds) || dealIds < 1) throw refuse('DEALS_INVALID', 'dealIds must be a positive integer');

  const auditPath = path.join(o.dir, 'audit.db');
  const controlPath = path.join(o.dir, 'control.db');
  const presentCount = Math.max(1, Math.round(dealIds * presentShare));
  const presentDeals = [];
  const absentDeals = [];
  for (let i = 0; i < dealIds; i += 1) (i < presentCount ? presentDeals : absentDeals).push(dealIdFor(i));
  const presentSet = new Set(presentDeals);

  // --- control.db: the present deals registered --------------------------------
  const control = new Database(controlPath);
  try {
    control.pragma('journal_mode = WAL');
    control.exec(fs.readFileSync(CONTROL_SCHEMA, 'utf8'));
    const insertDeal = control.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, ?, ?, ?, ?)');
    control.transaction(() => {
      presentDeals.forEach((id, i) => {
        insertDeal.run(id, null, i + 1, 'active', JSON.stringify({ id, name: `Synthetic ${i}`, status: 'active', members: ['admin'] }));
      });
    })();
    control.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    control.close();
  }

  // --- audit.db: version 0, no hash columns --------------------------------------
  const rand = prng(seed);
  const audit = new Database(auditPath);
  const expected = { controlRows: 0, presentRows: 0, legacyRows: 0, perPresentDeal: Object.create(null) };
  try {
    audit.pragma('journal_mode = WAL');
    audit.pragma('synchronous = OFF'); // a generator: durability is irrelevant, speed is not
    audit.exec(fs.readFileSync(V0_SCHEMA, 'utf8'));
    const insert = audit.prepare(`INSERT INTO audit_log
      (ts, actor_username, actor_role, session_id, deal_id, db_kind, action, collection, row_id, before_json, after_json, request_method, request_path, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const actors = ['admin', 'karen', 'bob', 'pmo-lead', 'il-1', 'il-2', 'hrbp-7'];
    const roles = ['admin', 'hrbp', 'hrbp', 'pmo', 'hrbp', 'hrbp', 'hrbp'];
    const collections = ['raid', 'tasks', 'synergies', 'decisions', 'orgPositions', 'ddFindings'];
    const actions = ['insert', 'update', 'update', 'delete'];
    const controlActions = ['access-denied', 'deal-update', 'member-add', 'login', 'dd-read', 'password-change'];
    const t0 = Date.parse('2025-01-01T00:00:00.000Z');
    // Half the byte budget per snapshot, less the JSON scaffolding.
    const padLen = Math.max(0, Math.floor(rowBytes / 2) - 40);
    const padChar = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const pads = [];
    for (let p = 0; p < 16; p += 1) {
      let s = '';
      for (let i = 0; i < padLen; i += 1) s += padChar[Math.floor(rand() * padChar.length)];
      pads.push(s);
    }

    const run = audit.transaction((from, to) => {
      for (let i = from; i < to; i += 1) {
        const a = Math.floor(rand() * actors.length);
        const ts = new Date(t0 + i * 37000).toISOString();
        const isControl = rand() < controlShare;
        if (isControl) {
          expected.controlRows += 1;
          const withDeal = rand() < 0.5;
          const deal = withDeal ? dealIdFor(Math.floor(rand() * dealIds)) : null;
          insert.run(
            ts, actors[a], roles[a], `s${a}`, deal, 'control', controlActions[Math.floor(rand() * controlActions.length)],
            null, deal, null, JSON.stringify({ i, note: pads[i % pads.length].slice(0, 64) }), 'GET', '/api/synthetic', `10.0.${a}.1`
          );
          continue;
        }
        const deal = dealIdFor(Math.floor(rand() * dealIds));
        if (presentSet.has(deal)) {
          expected.presentRows += 1;
          expected.perPresentDeal[deal] = (expected.perPresentDeal[deal] || 0) + 1;
        } else {
          expected.legacyRows += 1;
        }
        const coll = collections[Math.floor(rand() * collections.length)];
        const action = actions[Math.floor(rand() * actions.length)];
        const rid = `r${i}`;
        const before = action === 'insert' ? null : JSON.stringify({ id: rid, title: `row ${i}`, body: pads[(i + 3) % pads.length] });
        const after = action === 'delete' ? null : JSON.stringify({ id: rid, title: `row ${i} v2`, body: pads[(i + 7) % pads.length] });
        insert.run(ts, actors[a], roles[a], `s${a}`, deal, 'deal', action, coll, rid, before, after, 'PUT', `/api/${coll}/${rid}`, `10.0.${a}.1`);
      }
    });
    for (let from = 0; from < rows; from += INSERT_BATCH) run(from, Math.min(rows, from + INSERT_BATCH));
    audit.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    audit.close();
  }

  return {
    auditPath,
    controlPath,
    rows,
    fileBytes: fs.statSync(auditPath).size,
    presentDeals,
    absentDeals,
    expected,
  };
}

module.exports = {
  buildLegacyAuditTree,
  projectedFileBytes,
  dealIdFor,
  MAX_ROWS,
  DEFAULT_ROWS,
  OVERHEAD_BYTES_PER_ROW,
};
