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

// ---------------------------------------------------------------------------
// 09-10 Task 1 (tracer): the rule is unconditional inside conflictIfStale().
// U1-U6 drive the function directly with a recording fake `res`; S1 is the
// structural guard that no per-route opt-in can come back (T-09-36/T-09-42).
// ---------------------------------------------------------------------------

function recordingRes() {
  const r = { code: null, body: null, sent: 0 };
  r.status = function (c) { r.code = c; return r; };
  r.json = function (b) { r.body = b; r.sent += 1; return r; };
  return r;
}

test('precondition (U1): a non-demo request with no precondition against an existing record is refused 400 versionRequired', () => {
  const res = recordingRes();
  const handled = app.conflictIfStale({ body: {}, query: {}, isDemo: false }, res, { id: 'x', version: 2 });
  assert.strictEqual(handled, true);
  assert.strictEqual(res.code, 400);
  assert.strictEqual(res.body.versionRequired, true);
  assert.deepStrictEqual(Object.keys(res.body).sort(), ['error', 'versionRequired']);
});

test('precondition (U2): a demo-store request (isDemo === true) with no precondition passes through untouched', () => {
  const res = recordingRes();
  const handled = app.conflictIfStale({ body: {}, query: {}, isDemo: true }, res, { id: 'x', version: 2 });
  assert.strictEqual(handled, false);
  assert.strictEqual(res.sent, 0, 'nothing is sent for a lenient demo request');
});

test('precondition (U3): fail-closed — a request with no isDemo key at all is strict', () => {
  const res = recordingRes();
  const handled = app.conflictIfStale({ body: {}, query: {} }, res, { id: 'x', version: 2 });
  assert.strictEqual(handled, true);
  assert.strictEqual(res.code, 400);
  assert.strictEqual(res.body.versionRequired, true);
});

test('precondition (U4): a create (no existing record) is never refused for lacking a precondition', () => {
  for (const record of [null, undefined]) {
    const res = recordingRes();
    const handled = app.conflictIfStale({ body: {}, query: {}, isDemo: false }, res, record);
    assert.strictEqual(handled, false);
    assert.strictEqual(res.sent, 0);
  }
});

test('precondition (U5): only exact equality passes; one below and one above are 409 carrying the stored currentVersion', () => {
  const stored = { id: 'x', version: 2 };
  const ok = recordingRes();
  assert.strictEqual(app.conflictIfStale({ body: { version: 2 }, query: {}, isDemo: false }, ok, stored), false);
  assert.strictEqual(ok.sent, 0);
  for (const v of [1, 3]) {
    const res = recordingRes();
    assert.strictEqual(app.conflictIfStale({ body: { version: v }, query: {}, isDemo: false }, res, stored), true);
    assert.strictEqual(res.code, 409);
    assert.strictEqual(res.body.conflict, true);
    assert.strictEqual(res.body.currentVersion, 2);
  }
});

test('precondition (U6): an invalid expectedVersion query is a 400 with the unchanged message, never "no precondition"', () => {
  const res = recordingRes();
  const handled = app.conflictIfStale({ body: {}, query: { expectedVersion: 'abc' }, isDemo: false }, res, { id: 'x', version: 2 });
  assert.strictEqual(handled, true);
  assert.strictEqual(res.code, 400);
  assert.strictEqual(res.body.error, 'expectedVersion must be a non-negative integer.');
  assert.strictEqual(res.body.versionRequired, undefined);
});

test('precondition (S1, structural): the rule sits in the body of conflictIfStale(); no call site passes any option but clearanceFilter; no per-route opt-in exists', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const defIdx = src.indexOf('function conflictIfStale(');
  assert.ok(defIdx !== -1, 'the single definition must exist');
  const openIdx = src.indexOf('{', src.indexOf(')', defIdx));
  const closeIdx = braceMatchPre(src, openIdx);
  assert.ok(closeIdx > openIdx);
  const body = src.slice(openIdx, closeIdx + 1);
  assert.ok(body.includes('versionRequired: true'), 'the precondition-required response lives in the function body');
  assert.ok(!/(options|opts)\.\w*[Pp]recondition/.test(body), 'the function body must not consult a per-route option');
  assert.ok(!/requirePrecondition/.test(src), 'server.js must contain no reference to a per-route precondition option');

  // Every call site: collect the paren-balanced argument text and its options-object keys.
  const callRe = /conflictIfStale\(/g;
  let m; let sites = 0;
  while ((m = callRe.exec(src))) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const linePrefix = src.slice(lineStart, m.index);
    if (!/^\s*if \(\s*$/.test(linePrefix)) continue; // the definition and comment mentions
    let depth = 1; let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    const args = src.slice(m.index + m[0].length, i - 1);
    sites += 1;
    const braceAt = args.indexOf('{');
    if (braceAt === -1) continue; // plain three-argument form
    const objEnd = braceMatchPre(args, braceAt);
    const obj = args.slice(braceAt + 1, objEnd).replace(/\/\/[^\n]*/g, '');
    // top-level keys only (clearanceFilter's arrow body holds nested parens/ternary colons)
    let d = 0; let stripped = '';
    for (const ch of obj) {
      if (ch === '{' || ch === '(' || ch === '[') d++;
      else if (ch === '}' || ch === ')' || ch === ']') d--;
      else if (d === 0) stripped += ch;
    }
    const keys = [...stripped.matchAll(/(?:^|,)\s*([A-Za-z_]\w*)\s*:/g)].map((k) => k[1]);
    assert.deepStrictEqual([...new Set(keys)], ['clearanceFilter'], `call site passes an option other than clearanceFilter: ${args.slice(0, 120)}`);
  }
  assert.strictEqual(sites, 23, 'every one of the 23 versioned write handlers calls conflictIfStale()');
});

// ---------------------------------------------------------------------------
// 09-10 Task 2: per-route proof (T-table, T-demo) and the probe edges
// (E-adjacency, E-invalid, E-ordering, E-idempotency). Explicit requests only —
// the held-version fetch wrapper is never installed in this file (GD-3).
// ---------------------------------------------------------------------------

function enc(s) { return encodeURIComponent(s); }

function send(base, token, spec) {
  const headers = { Cookie: cookieHeader(token) };
  const init = { method: spec.method, headers };
  if (spec.method === 'POST') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(spec.body || {});
  }
  return fetch(`${base}${spec.path}`, init);
}

function withPrecondition(spec, version) {
  if (version === undefined) return spec;
  if (spec.method === 'POST') return Object.assign({}, spec, { body: Object.assign({}, spec.body, { version }) });
  const sep = spec.path.includes('?') ? '&' : '?';
  return Object.assign({}, spec, { path: `${spec.path}${sep}expectedVersion=${version}` });
}

async function readRecord(base, token, listPath, id) {
  const res = await getJSON(base, listPath, token);
  assert.strictEqual(res.status, 200, `GET ${listPath} must succeed`);
  let list = await res.json();
  if (!Array.isArray(list)) list = Object.values(list).find(Array.isArray) || [];
  return list.find((r) => r.id === id);
}

function storedVersionOf(rec) {
  return (rec && typeof rec.version === 'number') ? rec.version : 0;
}

// One fixture builder per record family: creates a fresh, never-edited record
// (a create carries no precondition — D-06) and says where to read it back.
const FAMILIES = {
  raid: {
    list: '/api/raid', key: 'entry',
    create: () => ({ path: '/api/raid', body: { title: 'T-table raid', type: 'risk', severity: 'medium' } }),
  },
  task: {
    list: '/api/integration-tasks', key: 'task',
    create: () => ({ path: '/api/integration-tasks', body: { title: 'T-table task', workstreamId: 'ws_imo', phase: 'd30' } }),
  },
  synergy: {
    list: '/api/synergies', key: 'initiative',
    create: () => ({ path: '/api/synergies', body: { title: 'T-table synergy', category: 'revenue', targetM: 5 } }),
  },
  position: {
    list: '/api/org/positions', key: 'position',
    create: () => ({ path: '/api/org/positions', body: { title: 'T-table position', level: 'VP' } }),
  },
  flight: {
    list: '/api/org/flight-risk', key: 'entry',
    create: (ctx) => ({ path: '/api/org/flight-risk', body: { employeeId: ctx.employeeId, riskLevel: 'medium', owner: 'admin' } }),
  },
  ddItem: {
    list: '/api/dd/request-items?area=financial', key: 'item',
    create: () => ({ path: '/api/dd/request-items', body: { area: 'financial', text: 'T-table request item' } }),
  },
  finding: {
    list: '/api/dd/findings?area=legal', key: 'finding',
    create: () => ({ path: '/api/dd/findings', body: { area: 'legal', title: 'T-table finding', severity: 'medium', owner: 'Karen' } }),
  },
};

async function createFamilyRecord(base, token, famName, ctx) {
  const fam = FAMILIES[famName];
  const c = fam.create(ctx || {});
  const res = await postJSON(base, c.path, token, c.body);
  assert.ok(res.status === 200 || res.status === 201, `create ${famName} must succeed, got ${res.status}`);
  const rec = (await res.json())[fam.key];
  assert.ok(rec && rec.id, `create ${famName} must return the record`);
  return rec;
}

// The 23 versioned write routes, keyed exactly as test/helpers/held-version.js
// lists them. `spec(rec, pre)` builds the route's minimal valid request for a
// fresh `rec`; `prep` (optional) sets up per-route state first (a cost entry to
// delete, phasing rows to edit) and returns `pre`.
const ROUTE_CASES = {
  'POST /api/raid': { fam: 'raid', spec: (r) => ({ method: 'POST', path: '/api/raid', body: { id: r.id, notes: 'T-table edit' } }) },
  'DELETE /api/raid/:id': { fam: 'raid', spec: (r) => ({ method: 'DELETE', path: `/api/raid/${enc(r.id)}` }) },
  'POST /api/integration-tasks': { fam: 'task', spec: (r) => ({ method: 'POST', path: '/api/integration-tasks', body: { id: r.id, title: 'T-table task edit' } }) },
  'DELETE /api/integration-tasks/:id': { fam: 'task', spec: (r) => ({ method: 'DELETE', path: `/api/integration-tasks/${enc(r.id)}` }) },
  'POST /api/synergies': { fam: 'synergy', spec: (r) => ({ method: 'POST', path: '/api/synergies', body: { id: r.id, title: 'T-table synergy edit' } }) },
  'DELETE /api/synergies/:id': { fam: 'synergy', spec: (r) => ({ method: 'DELETE', path: `/api/synergies/${enc(r.id)}` }) },
  'POST /api/synergies/:id/cost-entries': { fam: 'synergy', spec: (r) => ({ method: 'POST', path: `/api/synergies/${enc(r.id)}/cost-entries`, body: { date: '2026-01-15', amountM: 0.5 } }) },
  'DELETE /api/synergies/:id/cost-entries/:eid': {
    fam: 'synergy',
    prep: async (base, token, r) => {
      const add = await postJSON(base, `/api/synergies/${enc(r.id)}/cost-entries`, token, { date: '2026-01-15', amountM: 0.5, version: 0 });
      assert.strictEqual(add.status, 200);
      return { entryId: (await add.json()).initiative.costEntries[0].id };
    },
    spec: (r, pre) => ({ method: 'DELETE', path: `/api/synergies/${enc(r.id)}/cost-entries/${enc(pre.entryId)}` }),
  },
  'POST /api/synergies/:id/generate-phasing': { fam: 'synergy', spec: (r) => ({ method: 'POST', path: `/api/synergies/${enc(r.id)}/generate-phasing`, body: { runRateM: 12, startMonth: '2026-04', curveShape: 'cost' } }) },
  'POST /api/synergies/:id/phasing/:month': {
    fam: 'synergy',
    prep: async (base, token, r) => {
      const gen = await postJSON(base, `/api/synergies/${enc(r.id)}/generate-phasing`, token, { runRateM: 12, startMonth: '2026-04', curveShape: 'cost', version: 0 });
      assert.strictEqual(gen.status, 200);
      return {};
    },
    spec: (r) => ({ method: 'POST', path: `/api/synergies/${enc(r.id)}/phasing/2026-04`, body: { targetM: 1.5 } }),
  },
  'POST /api/synergies/:id/stage': { fam: 'synergy', spec: (r) => ({ method: 'POST', path: `/api/synergies/${enc(r.id)}/stage`, body: { targetStage: 'validated' } }) },
  'POST /api/synergies/:id/rebaseline': { fam: 'synergy', spec: (r) => ({ method: 'POST', path: `/api/synergies/${enc(r.id)}/rebaseline`, body: { reason: 'T-table re-baseline' } }) },
  'POST /api/synergies/:id/confirm-current': { fam: 'synergy', spec: (r) => ({ method: 'POST', path: `/api/synergies/${enc(r.id)}/confirm-current`, body: {} }) },
  'POST /api/org/positions': { fam: 'position', spec: (r) => ({ method: 'POST', path: '/api/org/positions', body: { id: r.id, title: 'T-table position edit' } }) },
  'DELETE /api/org/positions/:id': { fam: 'position', spec: (r) => ({ method: 'DELETE', path: `/api/org/positions/${enc(r.id)}` }) },
  'POST /api/org/flight-risk': { fam: 'flight', spec: (r) => ({ method: 'POST', path: '/api/org/flight-risk', body: { id: r.id, notes: 'T-table flight-risk edit' } }) },
  'DELETE /api/org/flight-risk/:id': { fam: 'flight', spec: (r) => ({ method: 'DELETE', path: `/api/org/flight-risk/${enc(r.id)}` }) },
  'POST /api/org/flight-risk/:id/convert': { fam: 'flight', spec: (r) => ({ method: 'POST', path: `/api/org/flight-risk/${enc(r.id)}/convert`, body: { toTask: true, toRaid: true } }) },
  'POST /api/dd/request-items': { fam: 'ddItem', spec: (r) => ({ method: 'POST', path: '/api/dd/request-items', body: { id: r.id, text: 'T-table item edit' } }) },
  'DELETE /api/dd/request-items/:id': { fam: 'ddItem', spec: (r) => ({ method: 'DELETE', path: `/api/dd/request-items/${enc(r.id)}` }) },
  'POST /api/dd/findings': { fam: 'finding', spec: (r) => ({ method: 'POST', path: '/api/dd/findings', body: { id: r.id, title: 'T-table finding edit' } }) },
  'DELETE /api/dd/findings/:id': { fam: 'finding', spec: (r) => ({ method: 'DELETE', path: `/api/dd/findings/${enc(r.id)}` }) },
  'POST /api/dd/findings/:id/convert': { fam: 'finding', spec: (r) => ({ method: 'POST', path: `/api/dd/findings/${enc(r.id)}/convert`, body: { toTask: true, toRaid: true } }) },
};

test('precondition (T-table): exactly the 23 versioned write routes, each refuses a missing precondition in a real deal (record unchanged) and accepts the stored version', async () => {
  const tableKeys = heldVersionHelper.VERSIONED_WRITE_ROUTES.map((r) => `${r.method} ${r.route}`).sort();
  const caseKeys = Object.keys(ROUTE_CASES).sort();
  assert.strictEqual(caseKeys.length, 23, 'the table covers exactly 23 route entries');
  assert.deepStrictEqual(caseKeys, tableKeys, 'the T-table covers exactly the routes held-version.js (and, via H1, server.js) lists');

  await withServer(async (base) => {
    const deal = makeDeal('deal_ptable');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);
    const empRes = await postJSON(base, '/api/employees', token, { name: 'T-table Employee', role: 'Engineer', department: 'Eng' });
    const ctx = { employeeId: (await empRes.json()).employee.id };

    for (const key of caseKeys) {
      const c = ROUTE_CASES[key];
      const rec = await createFamilyRecord(base, token, c.fam, ctx);
      const pre = c.prep ? await c.prep(base, token, rec) : {};
      const spec = c.spec(rec, pre);
      const listPath = FAMILIES[c.fam].list;
      const before = await readRecord(base, token, listPath, rec.id);
      assert.ok(before, `${key}: fixture must be readable`);

      // 1. No precondition -> 400 versionRequired, record unchanged.
      const refused = await send(base, token, spec);
      assert.strictEqual(refused.status, 400, `${key}: omitting the precondition must be 400`);
      const refusedBody = await refused.json();
      assert.strictEqual(refusedBody.versionRequired, true, `${key}: the 400 must be versionRequired (got ${JSON.stringify(refusedBody)})`);
      assert.deepStrictEqual(Object.keys(refusedBody).sort(), ['error', 'versionRequired'], `${key}: the refusal carries no record data`);
      const afterRefusal = await readRecord(base, token, listPath, rec.id);
      assert.deepStrictEqual(afterRefusal, before, `${key}: the refused request left the record unchanged`);

      // 2. The stored version (0 for never-edited) -> the route's normal outcome.
      const stored = storedVersionOf(before);
      const ok = await send(base, token, withPrecondition(spec, stored));
      const okBody = await ok.json();
      assert.notStrictEqual(ok.status, 409, `${key}: the stored version must not conflict`);
      assert.notStrictEqual(okBody.versionRequired, true, `${key}: a supplied precondition is never "required"`);
      assert.ok(ok.status < 400, `${key}: the stored version must give the route's success outcome, got ${ok.status} ${JSON.stringify(okBody)}`);
    }
  });
});

test('precondition (T-demo): in an unbound (demo-store) admin session an update/delete with no precondition is never versionRequired', async () => {
  await withServer(async (base) => {
    const token = newSession('admin', 'admin'); // deliberately NOT bound to a deal
    const mk = async (famName) => createFamilyRecord(base, token, famName, {});
    const noRequired = async (label, res) => {
      let body = null;
      try { body = await res.json(); } catch (e) { /* non-JSON body */ }
      assert.ok(!(body && body.versionRequired === true), `${label}: the demo store stays lenient (D-09), got ${res.status} ${JSON.stringify(body)}`);
    };

    const raid = await mk('raid');
    await noRequired('POST /api/raid', await send(base, token, ROUTE_CASES['POST /api/raid'].spec(raid)));
    await noRequired('DELETE /api/raid/:id', await send(base, token, ROUTE_CASES['DELETE /api/raid/:id'].spec(raid)));

    const task = await mk('task');
    await noRequired('POST /api/integration-tasks', await send(base, token, ROUTE_CASES['POST /api/integration-tasks'].spec(task)));
    await send(base, token, ROUTE_CASES['DELETE /api/integration-tasks/:id'].spec(task)); // cleanup

    const syn = await mk('synergy');
    await noRequired('POST /api/synergies/:id/stage', await send(base, token, ROUTE_CASES['POST /api/synergies/:id/stage'].spec(syn)));
    await send(base, token, ROUTE_CASES['DELETE /api/synergies/:id'].spec(syn)); // cleanup
  });
});

// --- probe edges, run on RAID (+ integration tasks for ordering) ------------

test('precondition (E-adjacency): only exact equality passes — one below and one above the stored version are 409 carrying the stored version', async () => {
  await withServer(async (base) => {
    const { token, entry } = await dealSessionWithEntry(base, 'deal_padj');
    for (const v of [0, 1]) { // stored 0 -> 1 -> 2
      const s = await postJSON(base, '/api/raid', token, { id: entry.id, title: `stamp ${v}`, version: v });
      assert.strictEqual(s.status, 200);
    }
    assert.strictEqual(storedVersionOf(await findRaid(base, token, entry.id)), 2);
    for (const v of [1, 3]) {
      const res = await postJSON(base, '/api/raid', token, { id: entry.id, notes: `adjacent ${v}`, version: v });
      assert.strictEqual(res.status, 409, `precondition ${v} vs stored 2 must conflict`);
      const body = await res.json();
      assert.strictEqual(body.conflict, true);
      assert.strictEqual(body.currentVersion, 2);
    }
    assert.strictEqual(storedVersionOf(await findRaid(base, token, entry.id)), 2, 'the two refused writes persisted nothing');
    const ok = await postJSON(base, '/api/raid', token, { id: entry.id, notes: 'exact', version: 2 });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(storedVersionOf(await findRaid(base, token, entry.id)), 3);
  });
});

test('precondition (E-invalid): null / string / negative / fractional body versions and empty / non-numeric / negative / fractional query versions are 400 and change nothing', async () => {
  await withServer(async (base) => {
    const { token, entry } = await dealSessionWithEntry(base, 'deal_pinv', { notes: 'keep me' });
    const before = await findRaid(base, token, entry.id);
    for (const bad of [null, '1', -1, 1.5]) {
      const res = await postJSON(base, '/api/raid', token, { id: entry.id, notes: 'invalid-version overwrite', version: bad });
      assert.strictEqual(res.status, 400, `body version ${JSON.stringify(bad)} must be refused 400`);
      const refusedBody = await res.json();
      assert.notStrictEqual(refusedBody.versionRequired, true, 'an INVALID precondition is a validation error, never treated as "no precondition"');
      assert.deepStrictEqual(await findRaid(base, token, entry.id), before, `body version ${JSON.stringify(bad)} left the record unchanged`);
    }
    for (const bad of ['', 'abc', '-1', '1.5']) {
      const res = await deleteReq(base, `/api/raid/${enc(entry.id)}?expectedVersion=${encodeURIComponent(bad)}`, token);
      assert.strictEqual(res.status, 400, `query expectedVersion ${JSON.stringify(bad)} must be refused 400`);
      assert.deepStrictEqual(await findRaid(base, token, entry.id), before, `query expectedVersion ${JSON.stringify(bad)} left the record in place`);
    }
  });
});

async function orderingRun(base, famName, field, dealId, firstIsB) {
  const deal = makeDeal(dealId);
  const token = newSession('admin', 'admin'); bindDeal(token, deal.id);
  const fam = FAMILIES[famName];
  const rec = await createFamilyRecord(base, token, famName, {});
  const upd = (extra) => ({ method: 'POST', path: fam.create({}).path, body: Object.assign({ id: rec.id }, extra) });
  // B and C both load the record at v1 (stamped once).
  assert.strictEqual((await send(base, token, upd({ [field]: 'v1 stamp', version: 0 }))).status, 200);
  // A writes first: stored becomes v2.
  assert.strictEqual((await send(base, token, upd({ [field]: 'A wins', version: 1 }))).status, 200);
  // B and C both hold v1 -> each gets a 409 carrying currentVersion 2.
  for (const who of ['B', 'C']) {
    const res = await send(base, token, upd({ [field]: `${who} stale`, version: 1 }));
    assert.strictEqual(res.status, 409);
    assert.strictEqual((await res.json()).currentVersion, 2);
  }
  // Both reapply with currentVersion 2, in the order under test.
  const order = firstIsB ? ['B', 'C'] : ['C', 'B'];
  const winner = order[0]; const loser = order[1];
  const win = await send(base, token, upd({ [field]: `${winner} reapplied`, version: 2 }));
  assert.strictEqual(win.status, 200, `${famName}: the first reapplier wins`);
  const lose = await send(base, token, upd({ [field]: `${loser} reapplied`, version: 2 }));
  assert.strictEqual(lose.status, 409, `${famName}: the second reapplier gets a fresh 409`);
  const loseBody = await lose.json();
  assert.strictEqual(loseBody.currentVersion, 3, 'the stored version advanced by exactly one');
  assert.strictEqual(loseBody.currentRecord[field], `${winner} reapplied`, 'the 409 shows the first reapplier\'s value');
  const final = await readRecord(base, token, fam.list, rec.id);
  assert.strictEqual(final[field], `${winner} reapplied`);
  assert.strictEqual(storedVersionOf(final), 3, 'exactly one success -> exactly one version step');
  return { token, rec, upd, field, winner };
}

test('precondition (E-ordering): two stale writers reapplying with their 409 currentVersion — in either order — give one success and one fresh 409 (RAID and integration tasks)', async () => {
  await withServer(async (base) => {
    await orderingRun(base, 'raid', 'notes', 'deal_pord1', true);
    await orderingRun(base, 'raid', 'notes', 'deal_pord2', false);
    await orderingRun(base, 'task', 'title', 'deal_pord3', true);
    await orderingRun(base, 'task', 'title', 'deal_pord4', false);
  });
});

test('precondition (E-idempotency): replaying a succeeded update 409s and changes nothing; replaying a succeeded delete 404s with no conflict field', async () => {
  await withServer(async (base) => {
    const { token, rec, upd, field, winner } = await orderingRun(base, 'raid', 'notes', 'deal_pidem', true);
    const replay = await send(base, token, upd({ [field]: `${winner} reapplied`, version: 2 }));
    assert.strictEqual(replay.status, 409, 'the replayed (same body, same precondition) request is stale now');
    const afterReplay = await findRaid(base, token, rec.id);
    assert.strictEqual(storedVersionOf(afterReplay), 3, 'the replay changed nothing');

    const del = await deleteReq(base, `/api/raid/${enc(rec.id)}?expectedVersion=3`, token);
    assert.strictEqual(del.status, 200);
    assert.strictEqual(await findRaid(base, token, rec.id), undefined);
    const delReplay = await deleteReq(base, `/api/raid/${enc(rec.id)}?expectedVersion=3`, token);
    assert.strictEqual(delReplay.status, 404);
    const delBody = await delReplay.json();
    assert.strictEqual(delBody.conflict, undefined, 'a replayed delete is a plain not-found, never a conflict');
  });
});
