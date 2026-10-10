// D-09/D-10: bulk paste import coverage — POST /api/org/positions/import.
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/dd-access-policy.test.js's own harness shape (mkdtemp prefix changed
// only).
//
// node:test — Node's built-in runner. Run via `node --test
// test/org-import.test.js` (or `npm test`).

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ORG_JS_PATH = path.join(__dirname, '..', 'public', 'js', 'org.js');
const ORG_HTML_PATH = path.join(__dirname, '..', 'public', 'org.html');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-org-import-'));
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

const app = require('../server.js');
const orgValidators = require('../validators/org.js');

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
function freshDeal(id, overrides) {
  return {
    id, name: id, targetCompany: id + ' Co', members: ['karen', 'pmo', 'admin'], memberGrants: {},
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(), ...overrides,
  };
}
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }

// hr-cleared deal + a bound pmo session, ready to fire import requests at.
function setupHrDeal(id) {
  const deal = freshDeal(id, { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  return { deal, pmoToken };
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('org-import (a): three well-formed rows from an hr-granted member create three positions with a created count of three', async () => {
  const { pmoToken } = setupHrDeal('deal_orgimpa');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/org/positions/import`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [
        { title: 'CEO' },
        { title: 'VP Engineering', reportsTo: 'CEO' },
        { title: 'VP Sales', reportsTo: 'CEO' },
      ] }),
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.createdPositions, 3, 'the response must report a created count of three');

    const listRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const list = await listRes.json();
    assert.strictEqual(list.length, 3);
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-import (b): reportsTo naming another row\'s title in the SAME paste resolves to that row\'s newly created id', async () => {
  const { pmoToken } = setupHrDeal('deal_orgimpb');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/org/positions/import`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [
        { title: 'CEO' },
        { title: 'VP Engineering', reportsTo: 'CEO' },
      ] }),
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    const ceo = body.positions.find((p) => p.title === 'CEO');
    const vp = body.positions.find((p) => p.title === 'VP Engineering');
    assert.strictEqual(vp.reportsToId, ceo.id, 'the VP row must resolve reportsToId to the CEO row\'s newly allocated id');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-import (c): reportsTo naming an EXISTING position\'s title in the requested state resolves to that position\'s id', async () => {
  const { pmoToken } = setupHrDeal('deal_orgimpc');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'CEO' }),
    });
    const { position: ceo } = await createRes.json();

    const importRes = await fetch(`${base}/api/org/positions/import`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [{ title: 'VP Engineering', reportsTo: 'CEO' }] }),
    });
    assert.strictEqual(importRes.status, 201);
    const body = await importRes.json();
    assert.strictEqual(body.positions[0].reportsToId, ceo.id, 'the imported row must resolve reportsToId to the pre-existing CEO position');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-import (d): an unresolvable reportsTo returns 400 naming the offending row index, and a follow-up read shows zero positions created', async () => {
  const { pmoToken } = setupHrDeal('deal_orgimpd');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const beforeRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const before = await beforeRes.json();

    const res = await fetch(`${base}/api/org/positions/import`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [{ title: 'VP Engineering', reportsTo: 'Nobody By This Title' }] }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.problems[0].row, 0, 'the problem list must name row index 0');

    const afterRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const after = await afterRes.json();
    assert.strictEqual(after.length, before.length, 'a refused import must leave the position count unchanged');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-import (e): two rows sharing the same title return 400 naming the duplicate, and nothing is created', async () => {
  const { pmoToken } = setupHrDeal('deal_orgimpe');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const beforeRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const before = await beforeRes.json();

    const res = await fetch(`${base}/api/org/positions/import`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [{ title: 'CEO' }, { title: 'CEO' }] }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.problems[0].row, 1, 'the SECOND occurrence of the duplicate title must be the one named');
    assert.match(body.problems[0].message, /Duplicate title/);

    const afterRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const after = await afterRes.json();
    assert.strictEqual(after.length, before.length, 'a refused import must leave the position count unchanged');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-import (f): a row with an empty title returns 400 with that row\'s index, and nothing is created', async () => {
  const { pmoToken } = setupHrDeal('deal_orgimpf');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const beforeRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const before = await beforeRes.json();

    const res = await fetch(`${base}/api/org/positions/import`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [{ title: 'CEO' }, { title: '   ' }] }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.problems[0].row, 1, 'the empty-titled row (index 1) must be named');

    const afterRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const after = await afterRes.json();
    assert.strictEqual(after.length, before.length, 'a refused import must leave the position count unchanged');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-import (g): a row carrying name and email for a new person creates exactly one employee and links the position to it', async () => {
  const { pmoToken } = setupHrDeal('deal_orgimpg');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const beforeEmpRes = await fetch(`${base}/api/employees`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const beforeEmp = await beforeEmpRes.json();

    const res = await fetch(`${base}/api/org/positions/import`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [{ title: 'CEO', name: 'Jane Doe', email: 'jane@example.com' }] }),
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.createdEmployees, 1);
    assert.ok(body.positions[0].employeeId, 'the position must carry the newly created employee\'s id');

    const afterEmpRes = await fetch(`${base}/api/employees`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const afterEmp = await afterEmpRes.json();
    assert.strictEqual(afterEmp.length, beforeEmp.length + 1, 'exactly one new employee row must exist');
    assert.strictEqual(afterEmp.find((e) => e.id === body.positions[0].employeeId).name, 'Jane Doe');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-import (h): two rows carrying the same email in different casing create exactly ONE employee and both positions link to it', async () => {
  const { pmoToken } = setupHrDeal('deal_orgimph');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/org/positions/import`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [
        { title: 'Co-Lead A', name: 'Jamie Rivera', email: 'Jamie.Rivera@Example.com' },
        { title: 'Co-Lead B', name: 'Jamie Rivera', email: 'jamie.rivera@example.com' },
      ] }),
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.createdEmployees, 1, 'only one employee row must be created across both rows');
    assert.strictEqual(body.positions[0].employeeId, body.positions[1].employeeId, 'both positions must link to the SAME employee id');

    const empRes = await fetch(`${base}/api/employees`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const employees = await empRes.json();
    const matches = employees.filter((e) => e.id === body.positions[0].employeeId);
    assert.strictEqual(matches.length, 1, 'GET /api/employees must show exactly one employee row for this person');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-import (i): a row whose email matches an EXISTING employee (from a prior import) reuses that employee\'s id and creates no second employee row', async () => {
  const { pmoToken } = setupHrDeal('deal_orgimpi');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const firstRes = await fetch(`${base}/api/org/positions/import`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [{ title: 'CEO', name: 'Sam Lee', email: 'sam@example.com' }] }),
    });
    const firstBody = await firstRes.json();
    const existingEmployeeId = firstBody.positions[0].employeeId;

    const empBeforeRes = await fetch(`${base}/api/employees`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const empBefore = await empBeforeRes.json();

    const secondRes = await fetch(`${base}/api/org/positions/import`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [{ title: 'COO', name: 'Sam Lee (typo)', email: 'SAM@EXAMPLE.COM' }] }),
    });
    assert.strictEqual(secondRes.status, 201);
    const secondBody = await secondRes.json();
    assert.strictEqual(secondBody.createdEmployees, 0, 'no second employee row must be created');
    assert.strictEqual(secondBody.positions[0].employeeId, existingEmployeeId, 'the second row must reuse the SAME employee id');

    const empAfterRes = await fetch(`${base}/api/employees`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const empAfter = await empAfterRes.json();
    assert.strictEqual(empAfter.length, empBefore.length, 'the employee roster count must not grow');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-import (j): an employee row created by the import carries no truthy gamification points value and no badge value', async () => {
  const { pmoToken } = setupHrDeal('deal_orgimpj');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/org/positions/import`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [{ title: 'CEO', name: 'Pat Kim', email: 'pat@example.com' }] }),
    });
    const body = await res.json();

    const empRes = await fetch(`${base}/api/employees`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const employees = await empRes.json();
    const created = employees.find((e) => e.id === body.positions[0].employeeId);
    assert.ok(created, 'the created employee must be readable');
    assert.ok(!created.points, 'the created employee must carry no truthy gamification points value');
    assert.ok(!created.badge, 'the created employee must carry no badge value');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-import (k): the route is refused with 403 for a member without the hr grant, and nothing is created', async () => {
  const deal = freshDeal('deal_orgimpk', { memberGrants: { pmo: { ddAreas: ['it'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/org/positions/import`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [{ title: 'CEO' }] }),
    });
    assert.strictEqual(res.status, 403);

    const listRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const list = await listRes.json();
    assert.strictEqual(list.length, 0, 'nothing may be created by an uncleared caller');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-import (l): a payload exceeding the schema\'s row cap is refused by the validator with 400, before the handler runs, and names the limit', async () => {
  const { pmoToken } = setupHrDeal('deal_orgimpl');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const tooManyRows = Array.from({ length: orgValidators.ORG_IMPORT_MAX_ROWS + 1 }, (_, i) => ({ title: `Row ${i}` }));
    const res = await fetch(`${base}/api/org/positions/import`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: tooManyRows }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, new RegExp(String(orgValidators.ORG_IMPORT_MAX_ROWS)), 'the 400 message must name the row cap');

    const listRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const list = await listRes.json();
    assert.strictEqual(list.length, 0, 'a validator-refused payload must create nothing');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

// -----------------------------------------------------------------------
// Task 2: the paste-and-preview importer UI — source-level assertions on
// public/js/org.js and public/org.html (no DOM test harness in this repo,
// mirroring test/org-positions.test.js's own source-level convention for
// client-render contracts).
// -----------------------------------------------------------------------

test('org-import (m): no innerHTML sink exists anywhere in public/js/org.js', () => {
  const src = fs.readFileSync(ORG_JS_PATH, 'utf8');
  const occurrences = (src.match(/innerHTML/g) || []).length;
  assert.strictEqual(occurrences, 0, 'org.js must never assign markup — MNPI org content is textContent-only');
});

test('org-import (n): the "Couldn\'t read that paste" apology appears exactly once, and is set via an explicit visible display value', () => {
  const src = fs.readFileSync(ORG_JS_PATH, 'utf8');
  const occurrences = (src.match(/Couldn't read that paste/g) || []).length;
  assert.strictEqual(occurrences, 1, 'the parse-failure message must appear exactly once in the source');
  assert.match(
    src,
    /showImportError\("Couldn't read that paste[^]*?"\);/,
    'the parse-failure message must be routed through showImportError()',
  );
});

test('org-import (o): every style.display assignment in public/js/org.js uses a non-empty literal value', () => {
  const src = fs.readFileSync(ORG_JS_PATH, 'utf8');
  const assignments = src.match(/style\.display\s*=\s*[^;]+;/g) || [];
  assert.ok(assignments.length > 0, 'the file must contain at least one style.display assignment');
  assignments.forEach((assignment) => {
    assert.doesNotMatch(assignment, /=\s*''\s*;/, `style.display must never be reset to an empty string (found: ${assignment})`);
    assert.match(assignment, /=\s*'(block|none)'\s*;/, `style.display must be set to a non-empty literal (found: ${assignment})`);
  });
});

test('org-import (p): the import commit handler is reachable only after a preview has been produced', () => {
  const src = fs.readFileSync(ORG_JS_PATH, 'utf8');
  // importBtn starts disabled and is enabled ONLY inside the Preview click
  // handler's success path (after importParsedRows is assigned a parsed
  // array); the Import click handler itself early-returns unless
  // importParsedRows is already set, so a click reaching the fetch() call
  // is structurally impossible without a prior successful parse.
  assert.match(src, /importBtn\.disabled = true;\s*\/\/ enabled only once a preview exists/, 'the Import button must start disabled');
  assert.match(
    src,
    /importBtn\.addEventListener\('click', function \(\) \{\s*\/\/[^]*?\s*if \(!importParsedRows\) return;/,
    'the Import click handler must early-return before doing anything unless a preview has already populated importParsedRows',
  );
});

test('org-import (q): public/org.html\'s .org-import-preview rule carries no fixed height declaration — the table scrolls with the page', () => {
  const src = fs.readFileSync(ORG_HTML_PATH, 'utf8');
  const match = src.match(/\.org-import-preview\{[^}]*\}/);
  assert.ok(match, '.org-import-preview rule block must exist');
  assert.doesNotMatch(match[0], /(?:max-)?height\s*:/, '.org-import-preview must not declare a fixed/max height');
});

test('org-import (r): the paste importer\'s header matching lowercases, trims, strips spaces/underscores, and accepts "manager" as a reportsTo alias', () => {
  const src = fs.readFileSync(ORG_JS_PATH, 'utf8');
  assert.match(src, /toLowerCase\(\)\.trim\(\)\.replace\(\/\[\\s_\]\+\/g, ''\)/, 'header normalization must lowercase, trim and strip spaces/underscores');
  assert.match(src, /manager:\s*'reportsTo'/, '"manager" must be registered as a reportsTo alias');
});
