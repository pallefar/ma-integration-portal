// DD-05 / D-17 / D-18: proves the data-room reference and access-grant
// surface end-to-end through the REAL HTTP stack.
//
// Task 1 (this file's initial content): a request item's `vdrLink` is
// settable/readable/clearable through the existing POST /api/dd/request-items
// upsert route, server-stamped, replace-wholesale (never appended), scheme-
// restricted at write time, and clean-room filtered on the GET
// /api/dd/vdr-links aggregate exactly like every other DD list route
// (filterByAreaGrant()).
//
// Task 2 extends this file with the audited access-grant route
// (POST /api/deals/:id/vdr-grants) and the document-storage proof.
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/dd-workspace.test.js's own established harness shape.
//
// node:test — Node's built-in runner. Run via `node --test
// test/dd-vdr.test.js` (or `npm test`). Never `node --test test/` (the
// directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dd-vdr-'));
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
  return auditHook.queryAudit({ dealId, limit: 500 }).filter((r) => r.action === 'vdr-access-grant');
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Task 1: per-item vdrLink + the area aggregate view
// ---------------------------------------------------------------------------

test('dd-vdr (a): setting a reference on an item reads back with a server-stamped updatedAt and updatedBy', async () => {
  const deal = freshDeal('deal_ddvra');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', text: 'Cap table' }),
    });
    const { item } = await createRes.json();

    const before = Date.now();
    const setRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, vdrLink: { url: 'https://vdr.example.com/room1', folderRef: 'Legal/CapTable' } }),
    });
    assert.strictEqual(setRes.status, 200);
    const { item: updated } = await setRes.json();
    assert.strictEqual(updated.vdrLink.url, 'https://vdr.example.com/room1');
    assert.strictEqual(updated.vdrLink.folderRef, 'Legal/CapTable');
    assert.strictEqual(updated.vdrLink.updatedBy, 'karen', 'updatedBy must be the session identity');
    assert.ok(Date.parse(updated.vdrLink.updatedAt) >= before, 'updatedAt must be a server-stamped, current timestamp');

    const readRes = await fetch(`${base}/api/dd/request-items/${item.id}`, { headers: { Cookie: cookieHeader(karenToken) } });
    const read = await readRes.json();
    assert.strictEqual(read.vdrLink.url, 'https://vdr.example.com/room1');
    assert.strictEqual(read.vdrLink.updatedBy, 'karen');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-vdr (b): posting the same reference twice leaves exactly one reference, not a duplicate', async () => {
  const deal = freshDeal('deal_ddvrb');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'hr', text: 'Org chart' }),
    });
    const { item } = await createRes.json();

    const link = { url: 'https://vdr.example.com/hr', folderRef: 'HR/OrgChart', label: 'HR folder' };
    await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, vdrLink: link }),
    });
    const secondRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, vdrLink: link }),
    });
    const { item: after } = await secondRes.json();

    assert.strictEqual(typeof after.vdrLink, 'object', 'stored vdrLink must be a single object, not an array');
    assert.ok(!Array.isArray(after.vdrLink), 'stored vdrLink must never become an array');
    assert.strictEqual(after.vdrLink.url, link.url);
    assert.strictEqual(after.vdrLink.folderRef, link.folderRef);
    assert.strictEqual(after.vdrLink.label, link.label);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-vdr (c): an explicit vdrLink: null clears a previously-set reference', async () => {
  const deal = freshDeal('deal_ddvrc');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'it', text: 'System inventory' }),
    });
    const { item } = await createRes.json();

    await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, vdrLink: { url: 'https://vdr.example.com/it', folderRef: 'IT/Inventory' } }),
    });

    const clearRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, vdrLink: null }),
    });
    const { item: cleared } = await clearRes.json();
    assert.strictEqual(cleared.vdrLink, null, 'an explicit null must clear the reference');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-vdr (d): a non-http scheme and a relative path are each refused with a 400 naming the field, leaving the stored value unchanged', async () => {
  const deal = freshDeal('deal_ddvrd');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'commercial', text: 'Customer contracts', vdrLink: { url: 'https://vdr.example.com/orig', folderRef: 'Commercial/Contracts' } }),
    });
    const { item } = await createRes.json();

    const jsRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, vdrLink: { url: 'javascript:alert(1)', folderRef: 'x' } }),
    });
    assert.strictEqual(jsRes.status, 400);
    const jsBody = await jsRes.json();
    assert.match(jsBody.error, /vdrLink\.url/, 'the 400 must name the vdrLink.url field');

    const relRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, vdrLink: { url: '/relative/path', folderRef: 'x' } }),
    });
    assert.strictEqual(relRes.status, 400);
    const relBody = await relRes.json();
    assert.match(relBody.error, /vdrLink\.url/, 'the 400 must name the vdrLink.url field');

    const stillRes = await fetch(`${base}/api/dd/request-items/${item.id}`, { headers: { Cookie: cookieHeader(karenToken) } });
    const still = await stillRes.json();
    assert.strictEqual(still.vdrLink.url, 'https://vdr.example.com/orig', 'the prior valid reference must be unchanged by either refused write');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-vdr (e): a caller-supplied updatedBy is ignored in favour of the session identity', async () => {
  const deal = freshDeal('deal_ddvre');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        area: 'operations', text: 'Ops playbook',
        vdrLink: { url: 'https://vdr.example.com/ops', folderRef: 'Ops/Playbook', updatedBy: 'attacker', updatedAt: '1999-01-01T00:00:00.000Z' },
      }),
    });
    const { item } = await createRes.json();
    assert.strictEqual(item.vdrLink.updatedBy, 'karen', 'a caller-supplied updatedBy must be ignored in favour of the session identity');
    assert.notStrictEqual(item.vdrLink.updatedAt, '1999-01-01T00:00:00.000Z', 'a caller-supplied updatedAt must be ignored in favour of the server-stamped time');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-vdr (f): the aggregate route returns only areas the caller is cleared for', async () => {
  const deal = freshDeal('deal_ddvrf', { memberGrants: { pmo: { ddAreas: ['legal'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const legalItem = await (await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', text: 'Legal item', vdrLink: { url: 'https://vdr.example.com/legal', folderRef: 'Legal/Room' } }),
    })).json();
    const financialItem = await (await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'financial', text: 'Financial item', vdrLink: { url: 'https://vdr.example.com/fin', folderRef: 'Financial/Room' } }),
    })).json();
    assert.strictEqual(legalItem.item.area, 'legal');
    assert.strictEqual(financialItem.item.area, 'financial');

    const pmoAgg = await (await fetch(`${base}/api/dd/vdr-links`, { headers: { Cookie: cookieHeader(pmoToken) } })).json();
    assert.strictEqual(pmoAgg.areas.length, 1, 'pmo (legal-only) must see exactly one area in the aggregate');
    assert.strictEqual(pmoAgg.areas[0].area, 'legal');
    assert.strictEqual(pmoAgg.areas[0].links.length, 1);
    assert.strictEqual(pmoAgg.areas[0].links[0].url, 'https://vdr.example.com/legal');

    const karenAgg = await (await fetch(`${base}/api/dd/vdr-links`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    const karenAreaIds = karenAgg.areas.map((a) => a.area).sort();
    assert.deepStrictEqual(karenAreaIds, ['financial', 'legal'], 'the IL (full clearance) must see both referenced areas');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-vdr (g): the aggregate route omits an area entirely when the caller lacks it, rather than returning it with an empty link list', async () => {
  const deal = freshDeal('deal_ddvrg', { memberGrants: { pmo: { ddAreas: [] } } });
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
      body: JSON.stringify({ area: 'tax', text: 'Tax item', vdrLink: { url: 'https://vdr.example.com/tax', folderRef: 'Tax/Room' } }),
    });

    const pmoAgg = await (await fetch(`${base}/api/dd/vdr-links`, { headers: { Cookie: cookieHeader(pmoToken) } })).json();
    assert.deepStrictEqual(pmoAgg.areas, [], 'an uncleared area must be OMITTED entirely, never returned with an empty links array');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Task 2: audited data-room access-grant records, and the document-storage
// proof
// ---------------------------------------------------------------------------

test('dd-vdr (h): an IL records a grant and exactly one vdr-access-grant audit row appears, carrying the actor, deal id, subject and record', async () => {
  const deal = freshDeal('deal_ddvrh');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const before = grantRows(deal.id).length;
    const res = await fetch(`${base}/api/deals/${deal.id}/vdr-grants`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pmo', vdrRef: 'Legal/CapTable', note: 'Diligence review' }),
    });
    assert.strictEqual(res.status, 200, 'an hrbp IL must be able to record a data-room access grant');
    const body = await res.json();
    assert.strictEqual(body.grant.username, 'pmo');
    assert.strictEqual(body.grant.vdrRef, 'Legal/CapTable');
    assert.strictEqual(body.grant.grantedBy, 'karen');

    const rows = grantRows(deal.id);
    assert.strictEqual(rows.length, before + 1, 'exactly one vdr-access-grant audit row must appear');
    const row = rows[0];
    assert.strictEqual(row.actor_username, 'karen', 'the audit row must identify the granter');
    assert.strictEqual(row.deal_id, deal.id, 'the audit row must identify the deal');
    assert.strictEqual(row.row_id, 'pmo', 'the subject/row_id column must identify the grantee');
    const after = JSON.parse(row.after_json);
    assert.strictEqual(after.username, 'pmo');
    assert.strictEqual(after.vdrRef, 'Legal/CapTable');
    assert.strictEqual(after.note, 'Diligence review');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-vdr (i): a pmo session is refused the access-grant route', async () => {
  const deal = freshDeal('deal_ddvri');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const before = grantRows(deal.id).length;
    const res = await fetch(`${base}/api/deals/${deal.id}/vdr-grants`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pmo', vdrRef: 'Legal/CapTable' }),
    });
    assert.strictEqual(res.status, 403, 'a pmo session must be refused the access-grant route');
    assert.strictEqual(grantRows(deal.id).length, before, 'a refused request must add no audit row');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-vdr (j): a username outside the deal\'s members is refused with a 400 and no audit row appears', async () => {
  const deal = freshDeal('deal_ddvrj');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const before = grantRows(deal.id).length;
    const res = await fetch(`${base}/api/deals/${deal.id}/vdr-grants`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'not-a-member', vdrRef: 'Legal/CapTable' }),
    });
    assert.strictEqual(res.status, 400, 'a username outside the deal\'s members must be refused');
    assert.strictEqual(grantRows(deal.id).length, before, 'a refused grant naming a non-member must add no audit row');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-vdr (k): two grants recorded back to back both persist as two distinct audit rows with distinct subjects', async () => {
  const deal = freshDeal('deal_ddvrk', { members: ['karen', 'pmo', 'employee'] });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const before = grantRows(deal.id).length;
    const [r1, r2] = await Promise.all([
      fetch(`${base}/api/deals/${deal.id}/vdr-grants`, {
        method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'pmo', vdrRef: 'Legal/CapTable' }),
      }),
      fetch(`${base}/api/deals/${deal.id}/vdr-grants`, {
        method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'employee', vdrRef: 'HR/OrgChart' }),
      }),
    ]);
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r2.status, 200);

    const rows = grantRows(deal.id);
    assert.strictEqual(rows.length, before + 2, 'both grants must persist as two distinct audit rows; neither overwrites the other');
    const subjects = rows.map((r) => r.row_id).sort();
    assert.deepStrictEqual(subjects, ['employee', 'pmo'], 'the two rows must carry the two distinct subjects');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-vdr (l): the DD workspace never accepts, stores or serves a diligence document — no upload-shaped write route under the DD path prefix', async () => {
  // Mirrors test/auth-route-inventory.test.js's own listApiRoutes()
  // reflection exactly (T-04-26) — the SAME live route-inventory mechanism,
  // not a second, divergent walking mechanism.
  function listApiRoutes(expressApp) {
    const out = [];
    const stack = (expressApp._router && expressApp._router.stack) || [];
    for (const layer of stack) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
        for (const m of methods) {
          if (layer.route.path.startsWith('/api')) {
            out.push({ method: m.toUpperCase(), path: layer.route.path });
          }
        }
      }
    }
    return out;
  }
  const ddRoutes = listApiRoutes(app).filter((r) => r.path.startsWith('/api/dd'));
  assert.ok(ddRoutes.length > 0, 'the DD route inventory must not be empty — a 0-length list would make this test vacuously pass');
  const uploadShaped = ddRoutes.filter((r) => /upload/i.test(r.path));
  assert.deepStrictEqual(uploadShaped, [], 'no DD-prefixed route may be upload-shaped — the app must never accept a document itself');
});

test('dd-vdr (m): source inspection — the DD section of server.js performs no filesystem write', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = src.indexOf('// Due Diligence workspace (DD-01/DD-04)');
  const end = src.indexOf('// In-app notifications — computed on demand');
  assert.ok(start > -1 && end > start, 'the DD section start/end markers must be found in server.js — a renamed section header would silently vacuous this check');
  const ddSection = src.slice(start, end);
  // T-04-26: none of these filesystem/upload-handling primitives may appear
  // anywhere in the DD section — the app stores a REFERENCE, never a file.
  const forbidden = ['fs.writeFile', 'fs.createWriteStream', 'multer', 'req.files', 'formidable', 'busboy'];
  forbidden.forEach((token) => {
    assert.ok(!ddSection.includes(token), `the DD section of server.js must never contain "${token}" — that would mean it accepts/stores a file`);
  });
});
