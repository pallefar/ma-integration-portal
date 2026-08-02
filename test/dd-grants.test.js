// DD-04 / D-02 / D-08 / D-23: proves the clean-room grant/revoke management
// surface end-to-end — an hrbp Integration Lead or admin can grant and revoke
// a named member's clearance for a named DD area, deal-scoped; every real
// change is an audited `dd-area-grant`/`dd-area-revoke`/`dd-area-grants-update`
// security event; a revoke takes effect on the member's VERY NEXT request
// (grants are read from control.db per request, never session-cached);
// granting the same area twice is idempotent (one stored entry, no duplicate
// audit row); an unknown area id or a non-member username is refused with no
// partial write; a pmo session is refused both routes; and — Task 3 — the
// additive `memberGrants` map disturbs none of the four call sites that read
// `deal.members` as a flat array of username strings (D-23's central bet).
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/dd-workspace.test.js's own harness shape.
//
// node:test — Node's built-in runner. Run via `node --test
// test/dd-grants.test.js` (or `npm test`). Never `node --test test/` (the
// directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dd-grants-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = ''; // this suite never exercises the admin-token branch

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const auditHook = require('../db/auditHook.js');
const controlStore = require('../db/controlStore.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/dd-workspace.test.js).
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
function freshDeal(id, overrides) {
  return {
    id, name: id, targetCompany: id + ' Co', members: ['karen', 'pmo'], memberGrants: {},
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(), ...overrides,
  };
}
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }

function grantRows(dealId) {
  return auditHook.queryAudit({ dealId, limit: 500 })
    .filter((r) => ['dd-area-grant', 'dd-area-revoke', 'dd-area-grants-update'].includes(r.action));
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Task 1: grant/revoke routes, audited security events
// ---------------------------------------------------------------------------

test('dd-grants (a): an hrbp IL grants a pmo member "legal"; that member\'s very next DD list request returns the legal item', async () => {
  const deal = freshDeal('deal_ddgra');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', text: 'Pre-grant legal item' }),
    });

    const preGrantList = await (await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(pmoToken) } })).json();
    assert.deepStrictEqual(preGrantList, [], 'before any grant, pmo must see nothing');

    const grantRes = await fetch(`${base}/api/deals/${deal.id}/grants`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pmo', ddAreas: ['legal'] }),
    });
    assert.strictEqual(grantRes.status, 200, 'an hrbp IL must be able to grant a deal member');

    const postGrantList = await (await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(pmoToken) } })).json();
    assert.strictEqual(postGrantList.length, 1, 'immediately after the grant, pmo\'s very next request must return the legal item');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-grants (b): revoking (posting an empty ddAreas array) takes effect on the member\'s VERY NEXT request — no session-level caching', async () => {
  const deal = freshDeal('deal_ddgrb', { memberGrants: { pmo: { ddAreas: ['legal'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', text: 'Item pmo can see before revoke' }),
    });

    const beforeRevoke = await (await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(pmoToken) } })).json();
    assert.strictEqual(beforeRevoke.length, 1, 'pmo must see the legal item before the revoke');

    const revokeRes = await fetch(`${base}/api/deals/${deal.id}/grants`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pmo', ddAreas: [] }),
    });
    assert.strictEqual(revokeRes.status, 200);

    const afterRevoke = await (await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(pmoToken) } })).json();
    assert.deepStrictEqual(afterRevoke, [], 'pmo\'s very next request after the revoke must return [] — no logout/login/re-select needed');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-grants (c): granting the same area twice leaves exactly one stored entry and exactly one audit row', async () => {
  const deal = freshDeal('deal_ddgrc');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const before = grantRows(deal.id).length;
    const first = await fetch(`${base}/api/deals/${deal.id}/grants`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pmo', ddAreas: ['legal'] }),
    });
    assert.strictEqual(first.status, 200);
    assert.strictEqual(grantRows(deal.id).length, before + 1, 'the first grant must produce exactly one audit row');

    const second = await fetch(`${base}/api/deals/${deal.id}/grants`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pmo', ddAreas: ['legal'] }),
    });
    assert.strictEqual(second.status, 200);
    assert.strictEqual(grantRows(deal.id).length, before + 1, 'granting the identical area a second time must add ZERO new audit rows');

    const stored = controlStore.getDealMemberGrants(deal.id);
    assert.deepStrictEqual(stored.pmo.ddAreas, ['legal'], 'the stored grant list must still contain exactly one entry, not a duplicate');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-grants (d): a ddAreas array containing an unknown area id 400s with no stored change', async () => {
  const deal = freshDeal('deal_ddgrd');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/deals/${deal.id}/grants`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pmo', ddAreas: ['not-a-real-area'] }),
    });
    assert.strictEqual(res.status, 400, 'an unknown area id must 400');

    const stored = controlStore.getDealMemberGrants(deal.id);
    assert.deepStrictEqual(stored, {}, 'a rejected grant must leave memberGrants completely unchanged');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-grants (e): a username not on the deal\'s members list 400s', async () => {
  const deal = freshDeal('deal_ddgre'); // members: karen, pmo — 'stranger' is not a member
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/deals/${deal.id}/grants`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'stranger', ddAreas: ['legal'] }),
    });
    assert.strictEqual(res.status, 400, 'a username absent from deal.members must 400 — clearance can never exist without membership');

    const stored = controlStore.getDealMemberGrants(deal.id);
    assert.strictEqual(stored.stranger, undefined, 'no shadow-access memberGrants entry may be created for a non-member');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-grants (f): a pmo session is refused both GET and POST /api/deals/:id/grants', async () => {
  const deal = freshDeal('deal_ddgrf');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const postRes = await fetch(`${base}/api/deals/${deal.id}/grants`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pmo', ddAreas: ['legal'] }),
    });
    assert.strictEqual(postRes.status, 403, 'a pmo session must be refused POSTing a grant (D-02: IL + admin only)');

    // GET is not covered by ROLE_WRITE_POLICY (write-only, except /api/admin*
    // paths) — the route handler must narrow this inline, or any
    // authenticated role could read another deal's membership/clearance map.
    const getRes = await fetch(`${base}/api/deals/${deal.id}/grants`, { headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(getRes.status, 403, 'a pmo session must also be refused GETting the grants map (D-02: IL + admin only)');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-grants (g): the audit rows for a grant and a revoke carry the correct action name, actor, deal id, subject and before/after arrays', async () => {
  const deal = freshDeal('deal_ddgrg');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const grantRes = await fetch(`${base}/api/deals/${deal.id}/grants`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pmo', ddAreas: ['legal', 'financial'] }),
    });
    assert.strictEqual(grantRes.status, 200);

    const revokeRes = await fetch(`${base}/api/deals/${deal.id}/grants`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pmo', ddAreas: [] }),
    });
    assert.strictEqual(revokeRes.status, 200);

    const rows = grantRows(deal.id);
    assert.strictEqual(rows.length, 2, 'exactly one grant row and one revoke row must exist');

    // queryAudit() orders DESC by id — rows[0] is the more recent revoke, rows[1] the grant.
    const revokeRow = rows[0];
    const grantRow = rows[1];

    assert.strictEqual(grantRow.action, 'dd-area-grant');
    assert.strictEqual(grantRow.actor_username, 'karen');
    assert.strictEqual(grantRow.deal_id, deal.id);
    assert.strictEqual(grantRow.row_id, 'pmo', 'the subject/row_id column must name the target username');
    assert.deepStrictEqual(JSON.parse(grantRow.before_json || '[]'), []);
    assert.deepStrictEqual(JSON.parse(grantRow.after_json || '[]'), ['legal', 'financial']);

    assert.strictEqual(revokeRow.action, 'dd-area-revoke');
    assert.strictEqual(revokeRow.actor_username, 'karen');
    assert.strictEqual(revokeRow.deal_id, deal.id);
    assert.strictEqual(revokeRow.row_id, 'pmo');
    assert.deepStrictEqual(JSON.parse(revokeRow.before_json || '[]'), ['legal', 'financial']);
    assert.deepStrictEqual(JSON.parse(revokeRow.after_json || '[]'), []);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-grants (h): a member with no prior grants gains a memberGrants entry on first grant; revoking their last area leaves an empty array, not a dangling/undefined entry', async () => {
  const deal = freshDeal('deal_ddgrh');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    assert.deepStrictEqual(controlStore.getDealMemberGrants(deal.id), {}, 'precondition: no memberGrants entry exists yet');

    await fetch(`${base}/api/deals/${deal.id}/grants`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pmo', ddAreas: ['tax'] }),
    });
    assert.deepStrictEqual(controlStore.getDealMemberGrants(deal.id).pmo.ddAreas, ['tax'], 'the first grant must create a memberGrants entry');

    await fetch(`${base}/api/deals/${deal.id}/grants`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pmo', ddAreas: [] }),
    });
    const finalGrant = controlStore.getDealMemberGrants(deal.id).pmo;
    assert.ok(finalGrant, 'revoking the last area must leave the memberGrants entry present, not deleted');
    assert.deepStrictEqual(finalGrant.ddAreas, [], 'revoking the last area must leave an empty array, never undefined/null');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-grants (n): GET /api/deals/:id/grants succeeds for the deal\'s hrbp IL and for admin, returning one entry per member with an empty ddAreas for an ungranted member', async () => {
  const deal = freshDeal('deal_ddgrn', { memberGrants: { pmo: { ddAreas: ['legal'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const karenRes = await fetch(`${base}/api/deals/${deal.id}/grants`, { headers: { Cookie: cookieHeader(karenToken) } });
    assert.strictEqual(karenRes.status, 200, 'the deal\'s own hrbp IL must be able to read the grants map');
    const karenBody = await karenRes.json();
    const pmoEntry = karenBody.members.find((m) => m.username === 'pmo');
    assert.deepStrictEqual(pmoEntry.ddAreas, ['legal']);
    const karenEntry = karenBody.members.find((m) => m.username === 'karen');
    assert.deepStrictEqual(karenEntry.ddAreas, [], 'a member with no memberGrants entry at all must report an empty ddAreas array, not undefined');

    const adminRes = await fetch(`${base}/api/deals/${deal.id}/grants`, { headers: { Cookie: cookieHeader(adminToken) } });
    assert.strictEqual(adminRes.status, 200, 'admin must be able to read the grants map for any deal');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Task 2: admin console source-level checks (Real Deals tab grants editor)
// ---------------------------------------------------------------------------

test('dd-grants (source): admin.js POSTs to the grants route and renders with no innerHTML sink for member/area values', () => {
  const adminSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin.js'), 'utf8');
  const startMarker = '---------- Clean-room grants';
  const endMarker = '---------- Audit Log Viewer';
  const startIdx = adminSrc.indexOf(startMarker);
  const endIdx = adminSrc.indexOf(endMarker);
  assert.ok(startIdx !== -1 && endIdx !== -1 && endIdx > startIdx, 'admin.js must contain a demarcated Clean-room grants section');
  const section = adminSrc.slice(startIdx, endIdx);

  assert.match(section, /\/grants/, 'the grants panel must reference the /grants route');
  assert.match(section, /method:\s*'POST'/, 'the grants panel must POST a save');
  assert.strictEqual(section.includes('innerHTML'), false, 'the grants panel must render entirely via textContent/DOM APIs, never innerHTML');
});

test('dd-grants (source): admin.html loads admin.js at the bumped cache stamp', () => {
  const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  assert.match(adminHtml, /admin\.js\?v=1784700001/, 'admin.html must reference the bumped ?v= cache stamp for admin.js');
});

// ---------------------------------------------------------------------------
// Task 3: the additive memberGrants shape disturbs none of the four
// deal.members: string[] consumers (D-23's central bet)
// ---------------------------------------------------------------------------

test('dd-grants (i): isDealMember() behaves identically with memberGrants populated — true for a listed member, false for an unlisted one, true for admin regardless', () => {
  const deal = freshDeal('deal_ddgri', {
    members: ['karen'],
    memberGrants: { karen: { ddAreas: ['legal'] }, ghost: { ddAreas: ['tax'] } }, // 'ghost' is a stale grant entry with NO membership
  });
  registerDeal(deal);

  assert.strictEqual(controlStore.isDealMember(deal.id, { username: 'karen', role: 'hrbp' }), true, 'a listed member must still be recognized with memberGrants populated');
  assert.strictEqual(controlStore.isDealMember(deal.id, { username: 'pmo', role: 'pmo' }), false, 'an unlisted user must still be refused');
  assert.strictEqual(controlStore.isDealMember(deal.id, { username: 'ghost', role: 'pmo' }), false, 'a memberGrants entry with no membership entry must NOT grant membership');
  assert.strictEqual(controlStore.isDealMember(deal.id, { username: 'anyone', role: 'admin' }), true, 'admin must be treated as a member regardless of the members[] list');
});

test('dd-grants (j): listDealsForUser() returns the deal for a listed member and omits it for an unlisted one, with memberGrants populated', () => {
  const deal = freshDeal('deal_ddgrj', { members: ['karen'], memberGrants: { karen: { ddAreas: ['legal'] } } });
  registerDeal(deal);

  const karenList = controlStore.listDealsForUser({ username: 'karen', role: 'hrbp' });
  assert.ok(karenList.some((d) => d.id === deal.id), 'a listed member must see the deal in their list');

  const pmoList = controlStore.listDealsForUser({ username: 'pmo', role: 'pmo' });
  assert.ok(!pmoList.some((d) => d.id === deal.id), 'an unlisted user must not see the deal in their list');
});

test('dd-grants (k): a bind through POST /api/deals/select succeeds for a listed member and uniform-403s for an unlisted one; memberGrants is present on the deal in both cases', async () => {
  const deal = freshDeal('deal_ddgrk', { members: ['karen'], memberGrants: { karen: { ddAreas: ['legal'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  assert.ok(controlStore.getDeal(deal.id).memberGrants, 'precondition: the deal record itself carries memberGrants');

  const karenToken = newSession('karen', 'hrbp');
  const pmoToken = newSession('pmo', 'pmo');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const listedRes = await fetch(`${base}/api/deals/select`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: deal.id }),
    });
    assert.strictEqual(listedRes.status, 200, 'a listed member must bind successfully');
    const listedBody = await listedRes.json();
    assert.ok(listedBody.deal.memberGrants, 'the bound deal object returned on success must still carry memberGrants');

    const unlistedRes = await fetch(`${base}/api/deals/select`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: deal.id }),
    });
    assert.strictEqual(unlistedRes.status, 403, 'an unlisted user must get the uniform 403');

    // The refusal must not have mutated the underlying deal record's memberGrants.
    assert.ok(controlStore.getDeal(deal.id).memberGrants, 'memberGrants must still be present on the deal after a refused bind attempt');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-grants (l): removing a member via POST /api/deals/:id/members releases their session binding AND leaves their memberGrants entry intact; the stale grant is unreachable', async () => {
  const deal = freshDeal('deal_ddgrl', {
    members: ['admin', 'pmo'],
    memberGrants: { pmo: { ddAreas: ['legal', 'financial'] } },
  });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const removeRes = await fetch(`${base}/api/deals/${deal.id}/members`, {
      method: 'POST', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: ['admin'] }),
    });
    assert.strictEqual(removeRes.status, 200);

    const pmoSession = sessionsDb.findSession(runtimeConn, pmoToken);
    assert.strictEqual(pmoSession.dealId, null, 'removing pmo from members must release their CURRENT binding to this deal');

    const stale = controlStore.getDealMemberGrants(deal.id).pmo;
    assert.deepStrictEqual(stale.ddAreas, ['legal', 'financial'], 'removal from members is a membership decision — the stale memberGrants entry must survive intact, not be pruned');

    // The stale grant is unreachable: pmo cannot re-select the deal, so they
    // can never reach a DD route where that grant would be consulted.
    const reselect = await fetch(`${base}/api/deals/select`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: deal.id }),
    });
    assert.strictEqual(reselect.status, 403, 'a removed member holding a stale memberGrants entry must be refused at deal-bind time — the stale grant is unreachable');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-grants (m): GET /api/deals returns deals whose members elements are all of type string when memberGrants is populated', async () => {
  const deal = freshDeal('deal_ddgrm', {
    members: ['admin', 'karen'],
    memberGrants: { karen: { ddAreas: ['legal'] } },
  });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const adminToken = newSession('admin', 'admin');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const listRes = await fetch(`${base}/api/deals`, { headers: { Cookie: cookieHeader(adminToken) } });
    const list = await listRes.json();
    const found = list.find((d) => d.id === deal.id);
    assert.ok(found, 'the deal must appear in admin\'s list');
    assert.ok(Array.isArray(found.members), 'members must still be an array');
    found.members.forEach((m) => assert.strictEqual(typeof m, 'string', 'every members[] element must be a plain string — the deal switcher\'s and admin member editor\'s join(\', \')/.length reads depend on this'));
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});
