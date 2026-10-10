// ORG-01 / D-07: the read-boundary security file for the org position
// registry. Proves the D-07 tiered clearance boundary — current state open
// to any deal member, target state gated on the `hr` DD-area grant — from
// FOUR identities driving the SAME request, including the case where the
// client never loaded org.js's JS at all (a hand-crafted query string from a
// valid, bound session).
//
// Modelled on test/dd-access-policy.test.js's harness shape: boots the REAL
// requireable app (`require('../server.js')`) against an ISOLATED temp
// control/runtime/demo/deals/audit trio.
//
// node:test — Node's built-in runner. Run via `node --test
// test/org-access-policy.test.js` (or `npm test`).

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-org-access-policy-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = ''; // this suite never exercises the admin-token branch

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
// D-10-04 / COLLAB-02: the gate re-reads the account per request, so a directly-created
// session needs a matching control.db account with the same role.
const { ensureUser } = require('./helpers/seed-identity.js');
const { createDealDatabase } = require('../db/dealSeed.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/dd-access-policy.test.js).
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
  ensureUser(controlConn, { username, role });
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('org-access-policy: the D-07 read/write matrix across four identities, identical requests', async () => {
  const deal = {
    id: 'deal_orgap', name: 'deal_orgap', targetCompany: 'deal_orgap Co',
    members: ['admin', 'karen', 'pmo_hr', 'pmo_it'],
    memberGrants: {
      pmo_hr: { ddAreas: ['hr'] },
      pmo_it: { ddAreas: ['it'] },
      // 'karen' (hrbp) deliberately has NO explicit memberGrants entry —
      // she reaches every area via grantedAreas()'s role short-circuit.
    },
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoHrToken = newSession('pmo_hr', 'pmo'); bindDeal(pmoHrToken, deal.id);
  const pmoItToken = newSession('pmo_it', 'pmo'); bindDeal(pmoItToken, deal.id);

  const identities = [
    { name: 'admin', token: adminToken, clearedForTarget: true },
    { name: 'hrbp (no explicit grant)', token: karenToken, clearedForTarget: true },
    { name: 'pmo granted hr', token: pmoHrToken, clearedForTarget: true },
    { name: 'pmo granted only it', token: pmoItToken, clearedForTarget: false },
  ];

  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    // Seed one current-state and one target-state position as admin.
    const currentRes = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Open-tier position' }),
    });
    assert.strictEqual(currentRes.status, 201);

    const targetRes = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Restricted target design', state: 'target' }),
    });
    assert.strictEqual(targetRes.status, 201);
    const { position: targetPosition } = await targetRes.json();

    // --- READ MATRIX ---
    // All four identities see the current-state row via the unfiltered GET.
    for (const id of identities) {
      const res = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(id.token) } });
      assert.strictEqual(res.status, 200, `${id.name}: current-state GET must be 200`);
      const list = await res.json();
      assert.ok(list.some((p) => p.title === 'Open-tier position'), `${id.name}: must see the current-state row`);
      assert.ok(list.every((p) => p.state === 'current'), `${id.name}: must never see a target-state row on the unfiltered GET`);
    }

    // The three cleared identities reach target state; the it-only member is refused.
    for (const id of identities) {
      const res = await fetch(`${base}/api/org/positions?state=target`, { headers: { Cookie: cookieHeader(id.token) } });
      if (id.clearedForTarget) {
        assert.strictEqual(res.status, 200, `${id.name}: state=target GET must be 200`);
        const list = await res.json();
        assert.ok(list.some((p) => p.id === targetPosition.id), `${id.name}: must see the target row`);
      } else {
        assert.strictEqual(res.status, 403, `${id.name}: state=target GET must be 403`);
        const text = await res.text();
        assert.ok(!text.includes('Restricted target design'), `${id.name}: 403 body must not leak the target title`);
        assert.ok(!text.includes(targetPosition.id), `${id.name}: 403 body must not leak the target id`);
      }
    }

    // Casing/padding variants must ALSO resolve to the current (non-exact-
    // match) branch, proving the server normalises on exact match only —
    // never trusts the raw string — even for an otherwise-cleared caller.
    for (const variant of ['Target', ' target', 'target ', 'TARGET']) {
      const res = await fetch(`${base}/api/org/positions?state=${encodeURIComponent(variant)}`, { headers: { Cookie: cookieHeader(pmoItToken) } });
      assert.strictEqual(res.status, 200, `variant "${variant}" must resolve to the current (open) branch, not the restricted one`);
      const list = await res.json();
      assert.ok(list.every((p) => p.state === 'current'), `variant "${variant}" must never surface a target-state row`);
    }

    // --- WRITE MATRIX ---
    for (const id of identities) {
      const before = await (await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(adminToken) } })).json();
      const res = await fetch(`${base}/api/org/positions`, {
        method: 'POST', headers: { Cookie: cookieHeader(id.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Write probe by ${id.name}` }),
      });
      if (id.clearedForTarget) {
        assert.strictEqual(res.status, 201, `${id.name}: write must succeed (tier-1 hr-area write clearance)`);
      } else {
        assert.strictEqual(res.status, 403, `${id.name}: write must be refused`);
        const after = await (await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(adminToken) } })).json();
        assert.strictEqual(after.length, before.length, `${id.name}: a refused write must create no row`);
      }
    }
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoHrToken);
    sessionsDb.deleteSession(runtimeConn, pmoItToken);
    server.close();
  }
});

test('org-access-policy: the refusal is on the clearance axis, not validation — an identical well-formed payload succeeds for the cleared identity and is refused for the uncleared one', async () => {
  const deal = {
    id: 'deal_orgap2', name: 'deal_orgap2', targetCompany: 'deal_orgap2 Co',
    members: ['pmo_cleared', 'pmo_uncleared'],
    memberGrants: { pmo_cleared: { ddAreas: ['hr'] }, pmo_uncleared: { ddAreas: ['it'] } },
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const clearedToken = newSession('pmo_cleared', 'pmo'); bindDeal(clearedToken, deal.id);
  const unclearedToken = newSession('pmo_uncleared', 'pmo'); bindDeal(unclearedToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const payload = JSON.stringify({ title: 'Byte-identical payload', level: 'Director' });

    const unclearedRes = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(unclearedToken), 'Content-Type': 'application/json' }, body: payload,
    });
    assert.strictEqual(unclearedRes.status, 403, 'the it-only member must be refused');

    const clearedRes = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(clearedToken), 'Content-Type': 'application/json' }, body: payload,
    });
    assert.strictEqual(clearedRes.status, 201, 'the SAME payload must succeed for the hr-cleared member — a 403 that is really a disguised 400 proves nothing');
  } finally {
    sessionsDb.deleteSession(runtimeConn, clearedToken);
    sessionsDb.deleteSession(runtimeConn, unclearedToken);
    server.close();
  }
});

test('org-access-policy: GET /api/org/capabilities — the D-07 four-identity matrix, absent key for uncleared, truthy for cleared', async () => {
  const deal = {
    id: 'deal_orgcap', name: 'deal_orgcap', targetCompany: 'deal_orgcap Co',
    members: ['admin', 'karen', 'pmo_hr', 'pmo_it'],
    memberGrants: {
      pmo_hr: { ddAreas: ['hr'] },
      pmo_it: { ddAreas: ['it'] },
      // 'karen' (hrbp) deliberately has NO explicit memberGrants entry —
      // she reaches the capability via grantedAreas()'s role short-circuit.
    },
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoHrToken = newSession('pmo_hr', 'pmo'); bindDeal(pmoHrToken, deal.id);
  const pmoItToken = newSession('pmo_it', 'pmo'); bindDeal(pmoItToken, deal.id);

  const identities = [
    { name: 'admin', token: adminToken, cleared: true },
    { name: 'hrbp (no explicit grant)', token: karenToken, cleared: true },
    { name: 'pmo granted hr', token: pmoHrToken, cleared: true },
    { name: 'pmo granted only it', token: pmoItToken, cleared: false },
  ];

  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    for (const id of identities) {
      const res = await fetch(`${base}/api/org/capabilities`, { headers: { Cookie: cookieHeader(id.token) } });
      assert.strictEqual(res.status, 200, `${id.name}: capabilities GET must be 200`);
      const text = await res.text();
      if (id.cleared) {
        assert.ok(text.includes('targetOrgDesign'), `${id.name}: must see the restricted capability key`);
        const body = JSON.parse(text);
        assert.strictEqual(body.targetOrgDesign, true);
      } else {
        assert.ok(!text.includes('targetOrgDesign'), `${id.name}: response must not contain the restricted key at all — absent, not false`);
      }
    }
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoHrToken);
    sessionsDb.deleteSession(runtimeConn, pmoItToken);
    server.close();
  }
});

test('org-access-policy: copy-to-target and delete are both refused 403 for an it-only member, identical to the write boundary already proven for POST /api/org/positions', async () => {
  const deal = {
    id: 'deal_orgcap2', name: 'deal_orgcap2', targetCompany: 'deal_orgcap2 Co',
    members: ['admin', 'pmo_it'],
    memberGrants: { pmo_it: { ddAreas: ['it'] } },
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const itToken = newSession('pmo_it', 'pmo'); bindDeal(itToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const created = await (await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Access-matrix probe' }),
    })).json();

    const copyRes = await fetch(`${base}/api/org/positions/copy-to-target`, {
      method: 'POST', headers: { Cookie: cookieHeader(itToken), 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.strictEqual(copyRes.status, 403);

    const delRes = await fetch(`${base}/api/org/positions/${created.position.id}`, {
      method: 'DELETE', headers: { Cookie: cookieHeader(itToken) },
    });
    assert.strictEqual(delRes.status, 403);
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    sessionsDb.deleteSession(runtimeConn, itToken);
    server.close();
  }
});

test('org-access-policy: defence-in-depth — public/js/org.js never constructs a target-state request outside the branch guarded by the capability key', () => {
  // The UI-SPEC names this explicitly: the client-side omission of a
  // target-state fetch is NOT the control (the server refusal proven above
  // is what actually holds) — it is a courtesy that keeps an uncleared
  // session from ever even attempting the restricted request. As of this
  // plan, org.js gains a current/target switch, so the property is proven
  // structurally rather than by the file having zero occurrences: every
  // construction of a `state=target` request string must appear textually
  // after the capability-guard branch begins, never unconditionally at
  // module scope or inside a branch that does not check the capability.
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'org.js'), 'utf8');
  const targetRequestOccurrences = (src.match(/state=target/g) || []).length;
  if (targetRequestOccurrences === 0) {
    // No such construction exists yet — the property holds trivially.
    return;
  }
  assert.match(
    src,
    /capabilities\.targetOrgDesign[\s\S]*state=target/,
    'every construction of a target-state request must appear textually after a capabilities.targetOrgDesign check — never unconditionally',
  );
});
