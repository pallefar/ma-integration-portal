// CONC-02 gap closure (Phase 9, plan 09-08, R7 F-1): the precondition-required
// contract. A client that loaded a never-edited record (no `version` field)
// sends `version: 0` (D-09: version-less IS version 0) and, if another writer
// stamped the record in between, gets 409 — never a silent clobber. A write or
// delete of an existing versioned record that carries NO precondition at all
// is refused 400 `{ error, versionRequired: true }` in every non-demo request
// (GD-1/GD-1a/GD-1b, D-02 no exemptions); the demo store stays lenient (D-09).
//
// Isolated harness: the real requireable app against a temp control/runtime/
// demo/deals/audit set, all five MA_* paths pinned BEFORE any require.
// Servers listen on 127.0.0.1 explicitly (R5-02: tests bind `::` but connect
// to 127.0.0.1, so a foreign local listener could otherwise answer).
//
// This file never installs test/helpers/held-version.js — it IS the explicit
// version-contract suite (GD-3).
//
// node:test — run via `node --test test/optimistic-locking-precondition.test.js`.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-optimistic-locking-precondition-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
const fixtureUsers = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

let dealSeq = 0;
function registerDeal(deal) {
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(deal.id, dealSeq++, deal.status || 'active', JSON.stringify(deal));
}
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }
function postJSON(base, urlPath, token, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Cookie: cookieHeader(token) } : {}),
    body: JSON.stringify(body || {}),
  });
}
function getJSON(base, urlPath, token) {
  return fetch(`${base}${urlPath}`, { headers: token ? { Cookie: cookieHeader(token) } : {} });
}
function deleteReq(base, urlPath, token) {
  return fetch(`${base}${urlPath}`, { method: 'DELETE', headers: token ? { Cookie: cookieHeader(token) } : {} });
}

function makeDeal(id) {
  const deal = {
    id, name: id, targetCompany: `${id} Co`,
    members: ['admin'],
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}

async function withServer(fn) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

async function dealSessionWithEntry(base, dealId, fields) {
  const deal = makeDeal(dealId);
  const token = newSession('admin', 'admin'); bindDeal(token, deal.id);
  const createRes = await postJSON(base, '/api/raid', token, Object.assign({ title: 'Fixture', type: 'risk', severity: 'medium' }, fields || {}));
  assert.strictEqual(createRes.status, 201);
  const { entry } = await createRes.json();
  return { token, entry, deal };
}

async function findRaid(base, token, id) {
  const res = await getJSON(base, '/api/raid', token);
  return (await res.json()).find((r) => r.id === id);
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ---------------------------------------------------------------------------
// P1/P2: version-less == version 0 (D-09) — empty edge + the F-1 conflict.
// ---------------------------------------------------------------------------

test('precondition (P1): a never-edited RAID entry accepts an update carrying version 0 and its stored version becomes exactly 1', async () => {
  await withServer(async (base) => {
    const { token, entry } = await dealSessionWithEntry(base, 'deal_pre1');
    assert.strictEqual(entry.version, undefined, 'a freshly created entry has no version field (D-09)');
    const res = await postJSON(base, '/api/raid', token, { id: entry.id, status: 'mitigating', version: 0 });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.entry.version, 1);
    assert.strictEqual(body.entry.status, 'mitigating');
  });
});

test('precondition (P2): a second update still carrying version 0 gets 409 whose currentRecord holds the first writer\'s value', async () => {
  await withServer(async (base) => {
    const { token, entry } = await dealSessionWithEntry(base, 'deal_pre2');
    const first = await postJSON(base, '/api/raid', token, { id: entry.id, status: 'mitigating', version: 0 });
    assert.strictEqual(first.status, 200);
    const second = await postJSON(base, '/api/raid', token, { id: entry.id, status: 'closed', version: 0 });
    assert.strictEqual(second.status, 409);
    const body = await second.json();
    assert.strictEqual(body.conflict, true);
    assert.strictEqual(body.currentVersion, 1);
    assert.strictEqual(body.currentRecord.status, 'mitigating', 'the 409 shows the first writer\'s value');
    const after = await findRaid(base, token, entry.id);
    assert.strictEqual(after.status, 'mitigating', 'the stale write persisted nothing');
    assert.strictEqual(after.version, 1);
  });
});

// ---------------------------------------------------------------------------
// P3: missing precondition on an existing record is refused in a real deal.
// ---------------------------------------------------------------------------

test('precondition (P3): in a deal-bound session a RAID update with no version is refused 400 {error, versionRequired} and the entry is unchanged', async () => {
  await withServer(async (base) => {
    const { token, entry } = await dealSessionWithEntry(base, 'deal_pre3', { notes: 'original notes' });
    const before = await findRaid(base, token, entry.id);
    const res = await postJSON(base, '/api/raid', token, { id: entry.id, notes: 'sneaky overwrite' });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.deepStrictEqual(Object.keys(body).sort(), ['error', 'versionRequired'], 'T-09-37: exactly two keys — never the record, its version or attribution');
    assert.strictEqual(body.versionRequired, true);
    assert.ok(typeof body.error === 'string' && body.error.length > 0);
    const after = await findRaid(base, token, entry.id);
    assert.deepStrictEqual(after, before, 'the refused write left the entry byte-unchanged');
    assert.strictEqual(after.notes, 'original notes');
  });
});

// ---------------------------------------------------------------------------
// P4: demo store stays lenient (D-09) — nothing stamped at INSERT.
// ---------------------------------------------------------------------------

test('precondition (P4): in a session with no deal binding (demo store) a RAID update with no version still succeeds', async () => {
  await withServer(async (base) => {
    const token = newSession('admin', 'admin'); // deliberately NOT bound to a deal
    const createRes = await postJSON(base, '/api/raid', token, { title: 'Demo fixture', type: 'risk', severity: 'low' });
    assert.strictEqual(createRes.status, 201);
    const { entry } = await createRes.json();
    assert.strictEqual(entry.version, undefined, 'nothing is stamped on INSERT (D-09)');
    const res = await postJSON(base, '/api/raid', token, { id: entry.id, notes: 'demo edit, no precondition' });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.entry.notes, 'demo edit, no precondition');
    // Clean up the demo-store row so the isolated demo DB stays tidy.
    await deleteReq(base, `/api/raid/${encodeURIComponent(entry.id)}`, token);
  });
});
