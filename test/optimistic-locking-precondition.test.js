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

// ---------------------------------------------------------------------------
// P5-P7: the delete half (GD-1a — a delete with no precondition cannot be
// judged stale, so it is refused in a deal; D-08 stale-delete unchanged).
// ---------------------------------------------------------------------------

test('precondition (P5): in a deal-bound session DELETE /api/raid/:id with no expectedVersion is refused 400 versionRequired and the entry survives', async () => {
  await withServer(async (base) => {
    const { token, entry } = await dealSessionWithEntry(base, 'deal_pre5');
    const res = await deleteReq(base, `/api/raid/${encodeURIComponent(entry.id)}`, token);
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.deepStrictEqual(Object.keys(body).sort(), ['error', 'versionRequired']);
    assert.strictEqual(body.versionRequired, true);
    const after = await findRaid(base, token, entry.id);
    assert.ok(after, 'the refused delete left the entry in place');
  });
});

test('precondition (P6): DELETE /api/raid/:id?expectedVersion=0 on a never-edited entry succeeds and the entry is gone', async () => {
  await withServer(async (base) => {
    const { token, entry } = await dealSessionWithEntry(base, 'deal_pre6');
    const res = await deleteReq(base, `/api/raid/${encodeURIComponent(entry.id)}?expectedVersion=0`, token);
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).success, true);
    assert.strictEqual(await findRaid(base, token, entry.id), undefined);
  });
});

// ---------------------------------------------------------------------------
// H1/H2: the test-infrastructure helper (GD-3, T-09-40). This file never calls
// installHeldVersionFetch() — it only exercises the pure function.
// ---------------------------------------------------------------------------

const heldVersionHelper = require('./helpers/held-version.js');

function braceMatchPre(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

test('precondition (H1, structural): the helper\'s VERSIONED_WRITE_ROUTES equals, in both directions, the set of server.js handlers that call conflictIfStale(', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const re = /app\.(post|put|patch|delete)\(\s*(['"])((?:[^'"\\]|\\.)*)\2\s*,\s*(async\s+)?\(\s*req\s*,\s*res(?:\s*,\s*next)?\s*\)\s*=>\s*\{/g;
  const live = new Set();
  let m;
  while ((m = re.exec(src))) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = braceMatchPre(src, openIdx);
    if (closeIdx === -1) continue;
    if (src.slice(openIdx, closeIdx + 1).includes('conflictIfStale(')) live.add(`${m[1].toUpperCase()} ${m[3]}`);
  }
  assert.ok(live.size > 0, 'the structural scan matched zero handlers — it must fail loudly rather than pass vacuously');
  const table = new Set(heldVersionHelper.VERSIONED_WRITE_ROUTES.map((r) => `${r.method} ${r.route}`));
  const missingFromTable = [...live].filter((k) => !table.has(k)).sort();
  const staleInTable = [...table].filter((k) => !live.has(k)).sort();
  assert.deepStrictEqual(missingFromTable, [], `server.js routes calling conflictIfStale( that test/helpers/held-version.js does not list:\n${missingFromTable.join('\n')}`);
  assert.deepStrictEqual(staleInTable, [], `held-version.js lists routes that no longer call conflictIfStale(:\n${staleInTable.join('\n')}`);
  assert.strictEqual(heldVersionHelper.VERSIONED_WRITE_ROUTES.length, 23);
});

test('precondition (H2): the helper fills only an ABSENT precondition, from the stored version, for a deal-bound session and an existing record', async () => {
  await withServer(async (base) => {
    const { token, entry } = await dealSessionWithEntry(base, 'deal_preh2');
    const stamp = await postJSON(base, '/api/raid', token, { id: entry.id, title: 'stamped', version: 0 });
    assert.strictEqual(stamp.status, 200);
    const headers = { Cookie: cookieHeader(token), 'Content-Type': 'application/json' };
    const { withHeldPrecondition, heldVersion } = heldVersionHelper;

    assert.strictEqual(heldVersion('deal_preh2', entry.id), 1);
    assert.strictEqual(heldVersion('deal_preh2', 'raid_does_not_exist'), undefined);

    const filled = withHeldPrecondition(`${base}/api/raid`, { method: 'POST', headers, body: JSON.stringify({ id: entry.id, notes: 'x' }) });
    assert.strictEqual(JSON.parse(filled.init.body).version, 1, 'a POST without version gains the stored version');

    const delFilled = withHeldPrecondition(`${base}/api/raid/${entry.id}`, { method: 'DELETE', headers });
    assert.strictEqual(delFilled.url, `${base}/api/raid/${entry.id}?expectedVersion=1`, 'a DELETE without expectedVersion gains it');

    const viaHeadersObj = withHeldPrecondition(`${base}/api/raid`, { method: 'POST', headers: new Headers(headers), body: JSON.stringify({ id: entry.id }) });
    assert.strictEqual(JSON.parse(viaHeadersObj.init.body).version, 1, 'a Headers instance is read too');

    const explicitBody = JSON.stringify({ id: entry.id, notes: 'x', version: 0 });
    const explicit = withHeldPrecondition(`${base}/api/raid`, { method: 'POST', headers, body: explicitBody });
    assert.strictEqual(explicit.init.body, explicitBody, 'an explicit (stale) version is never touched');
    const explicitDel = withHeldPrecondition(`${base}/api/raid/${entry.id}?expectedVersion=0`, { method: 'DELETE', headers });
    assert.strictEqual(explicitDel.url, `${base}/api/raid/${entry.id}?expectedVersion=0`, 'an explicit expectedVersion is never touched');

    const unknownBody = JSON.stringify({ id: 'raid_does_not_exist', notes: 'x' });
    const unknown = withHeldPrecondition(`${base}/api/raid`, { method: 'POST', headers, body: unknownBody });
    assert.strictEqual(unknown.init.body, unknownBody, 'an unknown id is left for the route to 404');

    const createBody = JSON.stringify({ title: 'a create' });
    assert.strictEqual(withHeldPrecondition(`${base}/api/raid`, { method: 'POST', headers, body: createBody }).init.body, createBody, 'a create (no id) is unchanged');

    const demoToken = newSession('admin', 'admin'); // no deal binding -> demo store
    const demoBody = JSON.stringify({ id: entry.id, notes: 'x' });
    const demo = withHeldPrecondition(`${base}/api/raid`, { method: 'POST', headers: { Cookie: cookieHeader(demoToken) }, body: demoBody });
    assert.strictEqual(demo.init.body, demoBody, 'a demo-store session is left alone');

    const nonApi = withHeldPrecondition(`${base}/index.html`, { method: 'POST', headers, body: demoBody });
    assert.strictEqual(nonApi.init.body, demoBody, 'a non-API URL is unchanged');
  });
});

test('precondition (P7): in the demo store (unbound session) DELETE /api/raid/:id with no expectedVersion still succeeds', async () => {
  await withServer(async (base) => {
    const token = newSession('admin', 'admin'); // deliberately NOT bound to a deal
    const createRes = await postJSON(base, '/api/raid', token, { title: 'Demo delete fixture', type: 'issue', severity: 'low' });
    assert.strictEqual(createRes.status, 201);
    const { entry } = await createRes.json();
    const res = await deleteReq(base, `/api/raid/${encodeURIComponent(entry.id)}`, token);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await findRaid(base, token, entry.id), undefined);
  });
});
