// ORG-02 (06-04): the append-only decision register. Proves D-13 (append-
// only, derived-current, never stored on the position), D-14 (the fixed
// five-value vocabulary, three independent copies, anti-drift), and D-04
// tier 2 (recording a decision is restricted to admin + Integration Lead
// ONLY — a strictly narrower gate than the tier-1 hr-area-grant write
// clearance the rest of the org section uses).
//
// Modelled on test/org-access-policy.test.js's harness shape: boots the
// REAL requireable app (`require('../server.js')`) against an ISOLATED temp
// control/runtime/demo/deals/audit trio.
//
// node:test — Node's built-in runner. Run via `node --test
// test/org-decisions.test.js` (or `npm test`). Never `node --test test/`
// (the directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-org-decisions-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-org-decisions-test-token';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');

const app = require('../server.js');
const orgValidators = require('../validators/org.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/org-access-policy.test.js).
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

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// Standard test deal — admin + karen (hrbp, no explicit grant needed —
// reaches hr via grantedAreas()'s role short-circuit) + an hr-granted pmo +
// an ungranted pmo, matching org-access-policy.test.js's own four-identity
// roster shape.
function makeFourIdentityDeal(id) {
  const deal = {
    id, name: id, targetCompany: `${id} Co`,
    members: ['admin', 'karen', 'pmo_hr', 'pmo_it'],
    memberGrants: {
      pmo_hr: { ddAreas: ['hr'] },
      pmo_it: { ddAreas: ['it'] },
    },
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}

// ============================================================= Task 1 ====
// The append-only decision log, the five-value vocabulary, and the tier-2
// write gate.
// ===========================================================================

test('org-decisions (a): POST /api/org/decisions from an hrbp session with a valid body returns 201 and an entry whose id starts with "orgdec"', async () => {
  const deal = makeFourIdentityDeal('deal_oda');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const posRes = await postJSON(base, '/api/org/positions', adminToken, { title: 'CFO' });
    const { position } = await posRes.json();

    const res = await postJSON(base, '/api/org/decisions', karenToken, {
      positionId: position.id, type: 'retain', rationale: 'Strong performer, staying on.',
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.decision.id.startsWith('orgdec'), 'the created decision id must start with "orgdec"');
  } finally {
    [adminToken, karenToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-decisions (b): the same request from an admin session also returns 201', async () => {
  const deal = makeFourIdentityDeal('deal_odb');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const posRes = await postJSON(base, '/api/org/positions', adminToken, { title: 'COO' });
    const { position } = await posRes.json();

    const res = await postJSON(base, '/api/org/decisions', adminToken, {
      positionId: position.id, type: 'open', rationale: 'Role not yet filled in the target design.',
    });
    assert.strictEqual(res.status, 201);
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('org-decisions (c/d): the D-04 tier-2 four-identity matrix — the SAME payload from admin/hrbp/hr-granted-pmo/ungranted-pmo returns 201/201/403/403, proving the refusal is on the authz axis, not validation', async () => {
  const deal = makeFourIdentityDeal('deal_odcd');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoHrToken = newSession('pmo_hr', 'pmo'); bindDeal(pmoHrToken, deal.id);
  const pmoItToken = newSession('pmo_it', 'pmo'); bindDeal(pmoItToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const posRes = await postJSON(base, '/api/org/positions', adminToken, { title: 'VP Sales' });
    const { position } = await posRes.json();
    const payload = { positionId: position.id, type: 'redeploy', rationale: 'Skills better used elsewhere in the combined org.' };

    const identities = [
      { name: 'admin', token: adminToken, expect: 201 },
      { name: 'hrbp (Integration Lead)', token: karenToken, expect: 201 },
      { name: 'pmo granted hr (area-cleared, not IL)', token: pmoHrToken, expect: 403 },
      { name: 'pmo granted no area', token: pmoItToken, expect: 403 },
    ];
    for (const id of identities) {
      const res = await postJSON(base, '/api/org/decisions', id.token, payload);
      assert.strictEqual(res.status, id.expect, `${id.name}: expected ${id.expect}`);
    }

    // The hr-granted pmo's 403 proves the area grant alone is NOT sufficient
    // for a governance write — confirmed by creating zero entries for it.
    const listRes = await fetch(`${base}/api/org/decisions?positionId=${position.id}`, { headers: { Cookie: cookieHeader(adminToken) } });
    const list = await listRes.json();
    assert.strictEqual(list.length, 2, 'only the two successful (admin, hrbp) writes must have created an entry');
  } finally {
    [adminToken, karenToken, pmoHrToken, pmoItToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-decisions (e): the request presented with the break-glass admin token and no session returns 403, matching the re-baseline route\'s own exclusion', async () => {
  const deal = makeFourIdentityDeal('deal_ode');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const posRes = await postJSON(base, '/api/org/positions', adminToken, { title: 'Plant Manager' });
    const { position } = await posRes.json();

    const res = await fetch(`${base}/api/org/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': process.env.ADMIN_TOKEN },
      body: JSON.stringify({ positionId: position.id, type: 'retain', rationale: 'Should never be created.' }),
    });
    assert.strictEqual(res.status, 403, 'the break-glass token identity must be refused even though it resolves role === "admin"');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('org-decisions (f): a body whose type is outside the five values returns 400 from the schema', async () => {
  const deal = makeFourIdentityDeal('deal_odf');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const posRes = await postJSON(base, '/api/org/positions', adminToken, { title: 'Regional Head' });
    const { position } = await posRes.json();

    const res = await postJSON(base, '/api/org/decisions', adminToken, {
      positionId: position.id, type: 'promoted', rationale: 'Not a real vocabulary value.',
    });
    assert.strictEqual(res.status, 400);
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('org-decisions (g): a body with an empty or whitespace-only rationale returns 400 and creates no entry', async () => {
  const deal = makeFourIdentityDeal('deal_odg');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const posRes = await postJSON(base, '/api/org/positions', adminToken, { title: 'Ops Lead' });
    const { position } = await posRes.json();

    const emptyRes = await postJSON(base, '/api/org/decisions', adminToken, { positionId: position.id, type: 'retain', rationale: '' });
    assert.strictEqual(emptyRes.status, 400);
    const whitespaceRes = await postJSON(base, '/api/org/decisions', adminToken, { positionId: position.id, type: 'retain', rationale: '   ' });
    assert.strictEqual(whitespaceRes.status, 400);

    const listRes = await fetch(`${base}/api/org/decisions?positionId=${position.id}`, { headers: { Cookie: cookieHeader(adminToken) } });
    const list = await listRes.json();
    assert.strictEqual(list.length, 0, 'neither refused write may have created an entry');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('org-decisions (h): a body supplying decidedBy or decidedAt has both values ignored — the stored entry is stamped server-side', async () => {
  const deal = makeFourIdentityDeal('deal_odh');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const posRes = await postJSON(base, '/api/org/positions', adminToken, { title: 'Finance Director' });
    const { position } = await posRes.json();

    const before = Date.now();
    const res = await postJSON(base, '/api/org/decisions', adminToken, {
      positionId: position.id, type: 'retain', rationale: 'Key retention target.',
      decidedBy: 'someone-else', decidedAt: '2000-01-01T00:00:00.000Z',
    });
    assert.strictEqual(res.status, 201);
    const { decision } = await res.json();
    assert.strictEqual(decision.decidedBy, 'admin', 'decidedBy must equal the calling session\'s own username, not the supplied value');
    const decidedAtMs = new Date(decision.decidedAt).getTime();
    assert.ok(decidedAtMs >= before && decidedAtMs <= Date.now() + 5000, 'decidedAt must parse as a timestamp within a few seconds of now, not the supplied 2000-01-01 value');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('org-decisions (i): a body whose positionId names no position in the lane returns 404', async () => {
  const deal = makeFourIdentityDeal('deal_odi');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await postJSON(base, '/api/org/decisions', adminToken, {
      positionId: 'pos_totally_unknown', type: 'retain', rationale: 'Should 404.',
    });
    assert.strictEqual(res.status, 404);
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('org-decisions (j): recording a second decision for the same position appends a second entry; the first entry\'s id/type/rationale are unchanged, and the lane length is two', async () => {
  const deal = makeFourIdentityDeal('deal_odj');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const posRes = await postJSON(base, '/api/org/positions', adminToken, { title: 'Head of Engineering' });
    const { position } = await posRes.json();

    const firstRes = await postJSON(base, '/api/org/decisions', adminToken, { positionId: position.id, type: 'in-selection', rationale: 'Under review for the target design.' });
    const { decision: first } = await firstRes.json();

    const secondRes = await postJSON(base, '/api/org/decisions', adminToken, { positionId: position.id, type: 'retain', rationale: 'Selection concluded — retained.' });
    assert.strictEqual(secondRes.status, 201);

    const listRes = await fetch(`${base}/api/org/decisions?positionId=${position.id}`, { headers: { Cookie: cookieHeader(adminToken) } });
    const list = await listRes.json();
    assert.strictEqual(list.length, 2, 'the lane must hold both entries for this position');
    const storedFirst = list.find((d) => d.id === first.id);
    assert.strictEqual(storedFirst.type, first.type, 'the first entry\'s type must be unchanged');
    assert.strictEqual(storedFirst.rationale, first.rationale, 'the first entry\'s rationale must be unchanged');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('org-decisions (k): derivedDecisionFor() returns the entry with the latest decidedAt for that position, returns null when there are none, and ignores entries for other positions', () => {
  const decisions = [
    { id: 'd1', positionId: 'pos_x', type: 'in-selection', decidedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'd2', positionId: 'pos_x', type: 'retain', decidedAt: '2026-03-01T00:00:00.000Z' },
    { id: 'd3', positionId: 'pos_y', type: 'redundant', decidedAt: '2026-05-01T00:00:00.000Z' },
  ];
  const latestForX = app.derivedDecisionFor(decisions, 'pos_x');
  assert.strictEqual(latestForX.id, 'd2', 'must return the entry with the latest decidedAt for pos_x, ignoring pos_y\'s later entry');
  assert.strictEqual(app.derivedDecisionFor(decisions, 'pos_never_decided'), null, 'must return null for a position with no entries');
});

test('org-decisions (l): GET /api/org/decisions returns 403 for a caller without the hr grant, and 200 with the entries for a cleared caller; ?positionId= narrows to one position', async () => {
  const deal = makeFourIdentityDeal('deal_odl');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const pmoItToken = newSession('pmo_it', 'pmo'); bindDeal(pmoItToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const pos1 = (await (await postJSON(base, '/api/org/positions', adminToken, { title: 'Position 1' })).json()).position;
    const pos2 = (await (await postJSON(base, '/api/org/positions', adminToken, { title: 'Position 2' })).json()).position;
    await postJSON(base, '/api/org/decisions', adminToken, { positionId: pos1.id, type: 'retain', rationale: 'Keeping.' });
    await postJSON(base, '/api/org/decisions', adminToken, { positionId: pos2.id, type: 'open', rationale: 'Not yet decided.' });

    const uncleared = await fetch(`${base}/api/org/decisions`, { headers: { Cookie: cookieHeader(pmoItToken) } });
    assert.strictEqual(uncleared.status, 403);

    const cleared = await fetch(`${base}/api/org/decisions`, { headers: { Cookie: cookieHeader(adminToken) } });
    assert.strictEqual(cleared.status, 200);
    const all = await cleared.json();
    assert.strictEqual(all.length, 2);

    const narrowed = await fetch(`${base}/api/org/decisions?positionId=${pos1.id}`, { headers: { Cookie: cookieHeader(adminToken) } });
    const narrowedList = await narrowed.json();
    assert.strictEqual(narrowedList.length, 1);
    assert.strictEqual(narrowedList[0].positionId, pos1.id);
  } finally {
    [adminToken, pmoItToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-decisions: grep-level guard — isAdminOrIlRequest is called inside the decisions POST handler, before any controlStore.getDeal call in that handler', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const routeMatch = src.match(/app\.post\('\/api\/org\/decisions', \(req, res\) => \{([\s\S]*?)\n\}\);/);
  assert.ok(routeMatch, 'POST /api/org/decisions handler must be found in server.js');
  const body = routeMatch[1];
  const authzIndex = body.indexOf('isAdminOrIlRequest(req)');
  const dealLookupIndex = body.indexOf('controlStore.getDeal(');
  assert.ok(authzIndex !== -1, 'the handler body must call isAdminOrIlRequest(req)');
  assert.ok(dealLookupIndex !== -1, 'the handler body must call controlStore.getDeal(');
  assert.ok(authzIndex < dealLookupIndex, 'isAdminOrIlRequest(req) must run BEFORE any controlStore.getDeal call in this handler');
});

test('org-decisions: no decision field is stored on a position — a created position carries no decision-typed key', async () => {
  const deal = makeFourIdentityDeal('deal_odnodecfield');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const posRes = await postJSON(base, '/api/org/positions', adminToken, { title: 'No Decision Field Probe' });
    const { position } = await posRes.json();
    await postJSON(base, '/api/org/decisions', adminToken, { positionId: position.id, type: 'redundant', rationale: 'Role eliminated in the target design.' });

    const listRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(adminToken) } });
    const list = await listRes.json();
    const stored = list.find((p) => p.id === position.id);
    const keys = Object.keys(stored);
    const decisionKeys = keys.filter((k) => /decision/i.test(k));
    assert.deepStrictEqual(decisionKeys, [], `the stored position must carry no decision-typed key; found: ${decisionKeys.join(', ')}`);
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

// ============================================================= Task 2 ====
// Three-copy anti-drift, append-only proof, and the derived-current
// contract.
// ===========================================================================

test('org-decisions-drift: server.js, validators/org.js and public/js/org.js all hold the identical ordered five-value decision vocabulary', () => {
  const expected = ['retain', 'redeploy', 'in-selection', 'redundant', 'open'];

  assert.deepStrictEqual(app.ORG_DECISION_TYPES, expected, 'server.js ORG_DECISION_TYPES must be the exact ordered five-value vocabulary');
  assert.deepStrictEqual(orgValidators.ORG_DECISION_TYPES, expected, 'validators/org.js ORG_DECISION_TYPES must be the exact ordered five-value vocabulary');

  const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'org.js'), 'utf8');
  const match = clientSrc.match(/var ORG_DECISION_TYPES\s*=\s*(\[[^\]]*\]);/);
  assert.ok(match, 'public/js/org.js must declare a var ORG_DECISION_TYPES = [...] array literal on one statement');
  const clientTypes = JSON.parse(match[1].replace(/'/g, '"'));
  assert.deepStrictEqual(clientTypes, expected, 'public/js/org.js ORG_DECISION_TYPES must be the exact ordered five-value vocabulary');

  // Cross-file agreement, not just each-matches-expected independently — a
  // synchronised-but-wrong triple would still pass the three checks above.
  assert.deepStrictEqual(app.ORG_DECISION_TYPES, orgValidators.ORG_DECISION_TYPES);
  assert.deepStrictEqual(orgValidators.ORG_DECISION_TYPES, clientTypes);
});

test('org-decisions-append-only: three decisions recorded for one position leave the log at exactly three entries; the first two are byte-identical to their creation response; no update/delete path exists', async () => {
  const deal = makeFourIdentityDeal('deal_odao');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const posRes = await postJSON(base, '/api/org/positions', adminToken, { title: 'Append-Only Probe' });
    const { position } = await posRes.json();

    const r1 = await (await postJSON(base, '/api/org/decisions', adminToken, { positionId: position.id, type: 'in-selection', rationale: 'First: under review.' })).json();
    const r2 = await (await postJSON(base, '/api/org/decisions', adminToken, { positionId: position.id, type: 'redeploy', rationale: 'Second: redeployed elsewhere.' })).json();
    await postJSON(base, '/api/org/decisions', adminToken, { positionId: position.id, type: 'retain', rationale: 'Third: reversed, retained.' });

    const listRes = await fetch(`${base}/api/org/decisions?positionId=${position.id}`, { headers: { Cookie: cookieHeader(adminToken) } });
    const list = await listRes.json();
    assert.strictEqual(list.length, 3, 'the log must hold exactly three entries for this position');

    const stored1 = list.find((d) => d.id === r1.decision.id);
    const stored2 = list.find((d) => d.id === r2.decision.id);
    assert.deepStrictEqual(stored1, r1.decision, 'the first entry must be byte-identical to its own creation response');
    assert.deepStrictEqual(stored2, r2.decision, 'the second entry must be byte-identical to its own creation response');

    const delRes = await fetch(`${base}/api/org/decisions/${r1.decision.id}`, { method: 'DELETE', headers: { Cookie: cookieHeader(adminToken) } });
    assert.notStrictEqual(Math.floor(delRes.status / 100), 2, 'DELETE against a decision entry must not succeed');
    const putRes = await fetch(`${base}/api/org/decisions/${r1.decision.id}`, {
      method: 'PUT', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'retain' }),
    });
    assert.notStrictEqual(Math.floor(putRes.status / 100), 2, 'PUT against a decision entry must not succeed');

    const afterList = await (await fetch(`${base}/api/org/decisions?positionId=${position.id}`, { headers: { Cookie: cookieHeader(adminToken) } })).json();
    assert.strictEqual(afterList.length, 3, 'the log must be unchanged after the failed DELETE/PUT attempts');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('org-decisions-derived-current: the derived current decision is the latest by decidedAt after three entries; null for a position with none; unchanged log length after the position is deleted', async () => {
  const deal = makeFourIdentityDeal('deal_oddc');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const posRes = await postJSON(base, '/api/org/positions', adminToken, { title: 'Derived-Current Probe' });
    const { position } = await posRes.json();

    await postJSON(base, '/api/org/decisions', adminToken, { positionId: position.id, type: 'in-selection', rationale: 'One.' });
    await postJSON(base, '/api/org/decisions', adminToken, { positionId: position.id, type: 'redeploy', rationale: 'Two.' });
    const third = await (await postJSON(base, '/api/org/decisions', adminToken, { positionId: position.id, type: 'retain', rationale: 'Three — the latest.' })).json();

    const list = await (await fetch(`${base}/api/org/decisions?positionId=${position.id}`, { headers: { Cookie: cookieHeader(adminToken) } })).json();
    const derived = app.derivedDecisionFor(list, position.id);
    assert.strictEqual(derived.id, third.decision.id, 'the derived current decision must be the latest entry by decidedAt');

    const otherPosRes = await postJSON(base, '/api/org/positions', adminToken, { title: 'Never Decided' });
    const { position: otherPosition } = await otherPosRes.json();
    assert.strictEqual(app.derivedDecisionFor(list, otherPosition.id), null, 'a position with no decisions must derive to null');

    // FLAGGED PLANNER ASSUMPTION, pinned as a test: deleting the decided-upon
    // position leaves the log length UNCHANGED (append-only survives the
    // position's own deletion) — but the derivation for that now-absent
    // position id is excluded from any rollup over the LIVE positions lane,
    // by construction: a rollup only ever calls derivedDecisionFor() for
    // ids present in that lane, and the deleted position's id is no longer
    // in it.
    const delRes = await fetch(`${base}/api/org/positions/${position.id}`, { method: 'DELETE', headers: { Cookie: cookieHeader(adminToken) } });
    assert.strictEqual(delRes.status, 200);
    const afterList = await (await fetch(`${base}/api/org/decisions?positionId=${position.id}`, { headers: { Cookie: cookieHeader(adminToken) } })).json();
    assert.strictEqual(afterList.length, 3, 'the decisions lane length for the deleted position must be unchanged — the log retains the orphaned entries verbatim');

    const livePositions = await (await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(adminToken) } })).json();
    assert.ok(!livePositions.some((p) => p.id === position.id), 'the deleted position must be absent from the live positions lane');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('org-decisions-privacy: a redundant decision recorded against a linked employee never reaches that employee\'s own roster record', async () => {
  const deal = makeFourIdentityDeal('deal_odpriv');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const importRes = await postJSON(base, '/api/org/positions/import', adminToken, {
      rows: [{ title: 'Privacy Probe Role', name: 'Privacy Probe Person', email: 'privacy.probe@example.com' }],
    });
    const importBody = await importRes.json();
    assert.strictEqual(importRes.status, 201);
    const createdPosition = importBody.positions[0];

    await postJSON(base, '/api/org/decisions', adminToken, {
      positionId: createdPosition.id, employeeId: createdPosition.employeeId, type: 'redundant', rationale: 'Role eliminated in the target design.',
    });

    const employeesRes = await fetch(`${base}/api/employees`, { headers: { Cookie: cookieHeader(adminToken) } });
    const employees = await employeesRes.json();
    const employee = employees.find((e) => e.id === createdPosition.employeeId);
    assert.ok(employee, 'the imported employee must be present in the roster route\'s response');
    const serialised = JSON.stringify(employee);

    const decisionKeys = Object.keys(employee).filter((k) => /decision|risk/i.test(k));
    assert.deepStrictEqual(decisionKeys, [], `the employee object must carry no decision/risk-typed key; found: ${decisionKeys.join(', ')}`);

    ['retain', 'redeploy', 'in-selection', 'redundant', 'open'].forEach((value) => {
      assert.ok(!serialised.includes(value), `the serialised employee record must not contain the vocabulary value "${value}"`);
    });
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

// ============================================================= Task 3 ====
// Decision badge, history panel, and the absent-not-disabled record form.
// ===========================================================================

test('org-decisions-ui: no innerHTML sink exists anywhere in public/js/org.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'org.js'), 'utf8');
  const count = (src.match(/innerHTML/g) || []).length;
  assert.strictEqual(count, 0, 'public/js/org.js must contain zero innerHTML sinks — MNPI org content is textContent-only');
});

test('org-decisions-ui: the .org-node-decision rule carries no width, max-width, overflow or text-overflow declaration', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'org.html'), 'utf8');
  const match = src.match(/\.org-node-decision\{([^}]*)\}/);
  assert.ok(match, '.org-node-decision rule must exist in public/org.html');
  const body = match[1];
  ['width', 'max-width', 'overflow', 'text-overflow'].forEach((prop) => {
    assert.ok(!body.includes(prop + ':'), `.org-node-decision must not declare "${prop}" — a longer translation must reflow the pill, never clip it`);
  });
});

test('org-decisions-ui: the decision badge\'s data-i18n key is built by concatenation from the vocabulary value, matching the RAID severity precedent', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'org.js'), 'utf8');
  assert.match(src, /orgDecisionI18nKey/, 'org.js must declare an i18n-key-building helper');
  assert.match(src, /'org\.dec_'\s*\+/, 'the i18n key must be built by string concatenation with the "org.dec_" prefix, mirroring execution.js\'s "raid.lvl_" + severity precedent');
  assert.match(src, /data-i18n/, 'the badge/select/history-row elements must carry data-i18n attributes');
});

test('org-decisions-ui: the record-a-decision form is constructed only inside a branch testing the governance capability key, and no decision-form control is ever set disabled as a clearance affordance', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'org.js'), 'utf8');
  const buildCallMatch = src.match(/if \(capabilities\.recordOrgDecisions\) \{\s*panel\.appendChild\(buildDecisionForm\(position\)\);/);
  assert.ok(buildCallMatch, 'buildDecisionForm(position) must be called only inside a branch testing capabilities.recordOrgDecisions');

  // The ONLY `disabled` assignments anywhere in the file must be the
  // in-flight (submit-while-request-outstanding) idiom already established
  // for the add-form/import-form/delete-button, never a clearance gate —
  // proven by requiring every `.disabled = ` occurrence to sit on a
  // variable named `submit`, `deleteBtn`, `copyBtn` or `importBtn`
  // (the existing loading-state controls), never a decision-form-specific
  // clearance flag like `typeSelect.disabled` or `rationaleInput.disabled`.
  const disabledAssignments = src.match(/\w+\.disabled\s*=\s*(true|false)/g) || [];
  disabledAssignments.forEach((assignment) => {
    assert.match(assignment, /^(submit|deleteBtn|copyBtn|importBtn)\.disabled/, `unexpected disabled assignment "${assignment}" — decision-form clearance must be absence, never a disabled control`);
  });
});

test('org-decisions-ui: the governance-confirmation string containing the legal-and-severance sentence is invoked on the redundant and redeploy paths', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'org.js'), 'utf8');
  assert.match(src, /legal and severance consequences/, 'the legal-and-severance sentence must appear verbatim');
  const guardMatch = src.match(/if \(type === 'redundant' \|\| type === 'redeploy'\) \{\s*confirmMessage \+= ' This is a governance record with legal and severance consequences[^']*';\s*\}/);
  assert.ok(guardMatch, 'the legal-and-severance sentence must be appended ONLY when type is redundant or redeploy');
});

test('org-decisions-ui: GET /api/org/capabilities — the governance capability key is truthy for admin/hrbp and absent (not false) for a cleared-but-non-IL member', async () => {
  const deal = makeFourIdentityDeal('deal_odcap');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoHrToken = newSession('pmo_hr', 'pmo'); bindDeal(pmoHrToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const adminRes = await fetch(`${base}/api/org/capabilities`, { headers: { Cookie: cookieHeader(adminToken) } });
    const adminText = await adminRes.text();
    assert.ok(adminText.includes('recordOrgDecisions'), 'admin must see the governance capability key');
    assert.strictEqual(JSON.parse(adminText).recordOrgDecisions, true);

    const karenRes = await fetch(`${base}/api/org/capabilities`, { headers: { Cookie: cookieHeader(karenToken) } });
    const karenText = await karenRes.text();
    assert.ok(karenText.includes('recordOrgDecisions'), 'hrbp (Integration Lead) must see the governance capability key');

    // The area-cleared-but-non-IL member: sees targetOrgDesign (hr grant)
    // but NOT recordOrgDecisions — the capability probe's response,
    // serialised, must not contain the governance key name at all.
    const pmoHrRes = await fetch(`${base}/api/org/capabilities`, { headers: { Cookie: cookieHeader(pmoHrToken) } });
    const pmoHrText = await pmoHrRes.text();
    assert.ok(pmoHrText.includes('targetOrgDesign'), 'the hr-granted pmo must still see the tier-1 targetOrgDesign key');
    assert.ok(!pmoHrText.includes('recordOrgDecisions'), 'the hr-granted-but-non-IL pmo response must not contain the governance capability key name at all — absent, not false');
  } finally {
    [adminToken, karenToken, pmoHrToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});
