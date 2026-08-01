// ISO-01 / AUD-02 / D-02 / D-03: proves the destructive-guarded deal
// lifecycle — archive/delete are admin-only, require the deal's own id as an
// explicit confirmation value (a mismatch changes NOTHING), a deleted deal's
// file and registry row are both gone while an archived deal's file survives
// untouched, no session is ever left holding a stale binding after either
// operation, the deal-management control plane stays reachable even for a
// session whose binding just broke underneath it (CONTROL_PLANE_PATHS), and
// membership edits both grant and revoke access (including releasing an
// already-selected binding on removal).
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp trio, same pattern as test/deal-registry.test.js.
//
// node:test — Node's built-in runner, zero new dependency. Run via
// `node --test` (bare — this repo's default test discovery), or `npm test`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-deal-lifecycle-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}
function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-deal-lifecycle-split-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.ADMIN_TOKEN = ''; // this suite never exercises the admin-token branch

const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');
const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
const SOURCE_DB_PATH = tempDbPath('legacy-source');
runMigration(SOURCE_PATH, SOURCE_DB_PATH);

const { runSplit } = require('../scripts/split-db-into-control-demo-deals.js');
runSplit({ sourcePath: SOURCE_DB_PATH, outDir: TMP_DIR });

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const controlStore = require('../db/controlStore.js');

const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/deal-resolver.test.js).
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
  return { id, name: id, targetCompany: id + ' Co', members: ['karen'], status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(), ...overrides };
}

const app = require('../server.js');

function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}

test.after(() => {
  cleanupDbFile(SOURCE_DB_PATH);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('deal-lifecycle (a): hrbp is refused archive and delete; admin succeeds', async () => {
  const dealA = freshDeal('deal_lifea1a');
  registerDeal(dealA);
  const { createDealDatabase } = require('../db/dealSeed.js');
  createDealDatabase(dealA.id, { name: dealA.name, targetCompany: dealA.targetCompany });

  const dealB = freshDeal('deal_lifeb1a');
  registerDeal(dealB);
  createDealDatabase(dealB.id, { name: dealB.name, targetCompany: dealB.targetCompany });

  const hrbpToken = newSession('karen', 'hrbp');
  const adminToken = newSession('admin', 'admin');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const hrbpArchive = await fetch(`http://127.0.0.1:${port}/api/admin/deals/${dealA.id}/archive`, {
      method: 'POST', headers: { Cookie: cookieHeader(hrbpToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: dealA.id }),
    });
    assert.strictEqual(hrbpArchive.status, 403, 'hrbp must be refused archive (D-02)');

    const hrbpDelete = await fetch(`http://127.0.0.1:${port}/api/admin/deals/${dealA.id}`, {
      method: 'DELETE', headers: { Cookie: cookieHeader(hrbpToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: dealA.id }),
    });
    assert.strictEqual(hrbpDelete.status, 403, 'hrbp must be refused delete (D-02)');

    const adminArchive = await fetch(`http://127.0.0.1:${port}/api/admin/deals/${dealA.id}/archive`, {
      method: 'POST', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: dealA.id }),
    });
    assert.strictEqual(adminArchive.status, 200, 'admin must be allowed to archive');

    const adminDelete = await fetch(`http://127.0.0.1:${port}/api/admin/deals/${dealB.id}`, {
      method: 'DELETE', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: dealB.id }),
    });
    assert.strictEqual(adminDelete.status, 200, 'admin must be allowed to delete');
  } finally {
    sessionsDb.deleteSession(runtimeConn, hrbpToken);
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('deal-lifecycle (b): a mismatched confirmation value 400s and leaves the deal, its file and its registry row all intact', async () => {
  const deal = freshDeal('deal_lifec1b');
  registerDeal(deal);
  const { createDealDatabase } = require('../db/dealSeed.js');
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const dealPath = dbFiles.dealDbPath(deal.id);

  const adminToken = newSession('admin', 'admin');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/deals/${deal.id}`, {
      method: 'DELETE', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'wrong-value' }),
    });
    assert.strictEqual(res.status, 400);

    assert.ok(fs.existsSync(dealPath), 'the deal file must still exist after a mismatched confirmation');
    const row = controlConn.prepare('SELECT * FROM deals WHERE id = ?').get(deal.id);
    assert.ok(row, 'the registry row must still exist after a mismatched confirmation');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('deal-lifecycle (c): a correctly-confirmed delete removes the file, its sidecars and the registry row', async () => {
  const deal = freshDeal('deal_lifed1c');
  registerDeal(deal);
  const { createDealDatabase } = require('../db/dealSeed.js');
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const dealPath = dbFiles.dealDbPath(deal.id);
  // Open (and immediately release) a connection through the shared cache, so
  // this proves deleteDeal() evicts the cache before unlinking, not just
  // that unlinking an untouched file works.
  const openedConn = store.getOrOpenConnection(dealPath, dbFiles.DEAL_SCHEMA_PATH);
  assert.ok(openedConn, 'precondition: the deal file has a live cached connection before delete');

  const adminToken = newSession('admin', 'admin');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/deals/${deal.id}`, {
      method: 'DELETE', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: deal.id }),
    });
    assert.strictEqual(res.status, 200);

    assert.strictEqual(fs.existsSync(dealPath), false, 'the main deal file must be gone');
    assert.strictEqual(fs.existsSync(dealPath + '-wal'), false, 'the -wal sidecar must be gone');
    assert.strictEqual(fs.existsSync(dealPath + '-shm'), false, 'the -shm sidecar must be gone');
    const row = controlConn.prepare('SELECT * FROM deals WHERE id = ?').get(deal.id);
    assert.strictEqual(row, undefined, 'the registry row must be gone');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('deal-lifecycle (d): after archive, the file survives but the deal no longer resolves for a bind or appears in a member\'s list', async () => {
  const deal = freshDeal('deal_lifee1d');
  registerDeal(deal);
  const { createDealDatabase } = require('../db/dealSeed.js');
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const dealPath = dbFiles.dealDbPath(deal.id);

  const karenToken = newSession('karen', 'hrbp');
  const adminToken = newSession('admin', 'admin');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const archiveRes = await fetch(`http://127.0.0.1:${port}/api/admin/deals/${deal.id}/archive`, {
      method: 'POST', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: deal.id }),
    });
    assert.strictEqual(archiveRes.status, 200);
    assert.ok(fs.existsSync(dealPath), 'archiving must leave the file on disk untouched');

    const selectRes = await fetch(`http://127.0.0.1:${port}/api/deals/select`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: deal.id }),
    });
    assert.strictEqual(selectRes.status, 403, 'an archived deal must refuse a new bind');

    const listRes = await fetch(`http://127.0.0.1:${port}/api/deals`, { headers: { Cookie: cookieHeader(karenToken) } });
    const list = await listRes.json();
    assert.ok(!list.some((d) => d.id === deal.id), 'an archived deal must not appear in a member\'s deal list');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('deal-lifecycle (e): a session bound to a deal that is archived/deleted underneath it can still reach the control plane and rebind to demo', async () => {
  const archivedDeal = freshDeal('deal_lifef1e');
  registerDeal(archivedDeal);
  const deletedDeal = freshDeal('deal_lifeg1e');
  registerDeal(deletedDeal);
  const { createDealDatabase } = require('../db/dealSeed.js');
  createDealDatabase(archivedDeal.id, { name: archivedDeal.name, targetCompany: archivedDeal.targetCompany });
  createDealDatabase(deletedDeal.id, { name: deletedDeal.name, targetCompany: deletedDeal.targetCompany });

  const karenTokenA = newSession('karen', 'hrbp');
  sessionsDb.bindSessionDeal(runtimeConn, karenTokenA, archivedDeal.id);
  const karenTokenB = newSession('karen', 'hrbp');
  sessionsDb.bindSessionDeal(runtimeConn, karenTokenB, deletedDeal.id);
  const adminToken = newSession('admin', 'admin');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    await fetch(`http://127.0.0.1:${port}/api/admin/deals/${archivedDeal.id}/archive`, {
      method: 'POST', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: archivedDeal.id }),
    });
    await fetch(`http://127.0.0.1:${port}/api/admin/deals/${deletedDeal.id}`, {
      method: 'DELETE', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: deletedDeal.id }),
    });

    // Both sessions must be auto-released — proven by findSession() directly.
    const sessA = sessionsDb.findSession(runtimeConn, karenTokenA);
    assert.strictEqual(sessA.dealId, null, 'the session bound to the now-archived deal must be released back to demo');
    const sessB = sessionsDb.findSession(runtimeConn, karenTokenB);
    assert.strictEqual(sessB.dealId, null, 'the session bound to the now-deleted deal must be released back to demo');

    // Both sessions must still be able to reach the deal-management control
    // plane (never locked out) and successfully rebind to demo explicitly.
    const rebindA = await fetch(`http://127.0.0.1:${port}/api/deals/select`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenTokenA), 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: null }),
    });
    assert.strictEqual(rebindA.status, 200, 'a session released from an archived deal must still reach /api/deals/select');
    const rebindB = await fetch(`http://127.0.0.1:${port}/api/deals/select`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenTokenB), 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: null }),
    });
    assert.strictEqual(rebindB.status, 200, 'a session released from a deleted deal must still reach /api/deals/select');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenTokenA);
    sessionsDb.deleteSession(runtimeConn, karenTokenB);
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('deal-lifecycle (f): adding a member grants list+select access; removing reverses both and releases their binding', async () => {
  const deal = freshDeal('deal_lifeh1f', { members: ['admin'] });
  registerDeal(deal);
  const { createDealDatabase } = require('../db/dealSeed.js');
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo');
  const adminToken = newSession('admin', 'admin');
  const server = app.listen(0);
  try {
    const { port } = server.address();

    // Before being added, pmo cannot select the deal.
    const preAddSelect = await fetch(`http://127.0.0.1:${port}/api/deals/select`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: deal.id }),
    });
    assert.strictEqual(preAddSelect.status, 403);

    // Add pmo as a member.
    const addRes = await fetch(`http://127.0.0.1:${port}/api/deals/${deal.id}/members`, {
      method: 'POST', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: ['admin', 'pmo'] }),
    });
    assert.strictEqual(addRes.status, 200);

    const listAfterAdd = await fetch(`http://127.0.0.1:${port}/api/deals`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const listAfterAddBody = await listAfterAdd.json();
    assert.ok(listAfterAddBody.some((d) => d.id === deal.id), 'pmo\'s deal list must include the deal after being added');

    const postAddSelect = await fetch(`http://127.0.0.1:${port}/api/deals/select`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: deal.id }),
    });
    assert.strictEqual(postAddSelect.status, 200, 'pmo must be able to select the deal after being added as a member');

    // Now remove pmo — their EXISTING binding must be released, and future access refused.
    const removeRes = await fetch(`http://127.0.0.1:${port}/api/deals/${deal.id}/members`, {
      method: 'POST', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: ['admin'] }),
    });
    assert.strictEqual(removeRes.status, 200);

    const sess = sessionsDb.findSession(runtimeConn, pmoToken);
    assert.strictEqual(sess.dealId, null, 'removing a member must release their CURRENT binding to that deal');

    const listAfterRemove = await fetch(`http://127.0.0.1:${port}/api/deals`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const listAfterRemoveBody = await listAfterRemove.json();
    assert.ok(!listAfterRemoveBody.some((d) => d.id === deal.id), 'pmo\'s deal list must no longer include the deal after removal');

    const postRemoveSelect = await fetch(`http://127.0.0.1:${port}/api/deals/select`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: deal.id }),
    });
    assert.strictEqual(postRemoveSelect.status, 403, 'pmo must be refused re-selecting the deal after removal');

    // hrbp (non-admin) must be refused managing membership at all.
    const hrbpToken = newSession('karen', 'hrbp');
    try {
      const hrbpAttempt = await fetch(`http://127.0.0.1:${port}/api/deals/${deal.id}/members`, {
        method: 'POST', headers: { Cookie: cookieHeader(hrbpToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ members: ['admin', 'karen'] }),
      });
      assert.strictEqual(hrbpAttempt.status, 403, 'hrbp must be refused editing deal membership (admin-only)');
    } finally {
      sessionsDb.deleteSession(runtimeConn, hrbpToken);
    }
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});
