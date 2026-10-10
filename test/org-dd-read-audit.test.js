// T-ERM-07 (260810-erm, milestone-close Fable 5 review): closes the MNPI
// read-audit asymmetry — GET /api/org/decisions, GET /api/org/positions
// (target branch only), GET /api/dd/findings, and GET /api/dd/findings/:id
// left no forensic trail on either a denied or a successful read, unlike
// GET /api/org/flight-risk (the established pattern this plan mirrors).
//
// Modelled on test/org-flight-risk-audit.test.js's harness shape exactly:
// boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio.
//
// node:test — Node's built-in runner. Run via `node --test
// test/org-dd-read-audit.test.js` (or bare `node --test`). Never `node
// --test test/` (the directory argument is mis-parsed on this Node version).

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-org-dd-read-audit-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-org-dd-read-audit-test-token';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const auditHook = require('../db/auditHook.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/org-flight-risk-audit.test.js).
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
// A session created but deliberately NEVER bound to a deal — db/resolver.js
// resolves req.dealContext.dealId to null for such a session, which
// resolves the request to 'demo' kind (req.isDemo = true), exactly like an
// operator viewing the shared demo showcase. req.portalUser still carries
// the real role (never nulled — that only happens under DEMO_OPEN=1's
// separate anonymous-bypass path), so a demo-mode admin/hrbp session still
// exercises this route's role/grant logic, just against a null deal.
function demoSession(username, role) {
  return newSession(username, role);
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

// Counts audit.db rows by action name — real-deal assertions scope by
// dealId; demo assertions (dealId is always null for a demo-resolved
// request) scope globally. Every assertion in this file takes a
// before/after DELTA, never an absolute total, so the test never depends on
// what else the harness wrote.
function countByAction(dealId, action) {
  return auditHook.queryAudit({ dealId, limit: 500 }).filter((r) => r.action === action).length;
}
function countByActionGlobal(action) {
  return auditHook.queryAudit({ limit: 500 }).filter((r) => r.action === action).length;
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// admin + karen (hrbp/IL, reaches every area via grantedAreas()'s role
// short-circuit) + an hr-granted pmo + an ungranted pmo — mirrors
// test/org-flight-risk-audit.test.js's makeFourIdentityDeal shape.
function makeFourIdentityDeal(id) {
  const deal = {
    id, name: id, targetCompany: `${id} Co`,
    members: ['admin', 'karen', 'pmo_hr', 'pmo_it'],
    memberGrants: {
      pmo_hr: { ddAreas: ['hr'] },
    },
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}

async function createFinding(base, adminToken, area, title) {
  const res = await postJSON(base, '/api/dd/findings', adminToken, { area, title, severity: 'high' });
  const { finding } = await res.json();
  return finding;
}

// ============================================================= org/decisions ===

test('org-dd-read-audit (a): a cleared (hr-granted) real-deal GET /api/org/decisions writes exactly one org-decisions-read row', async () => {
  const deal = makeFourIdentityDeal('deal_odraa');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const before = countByAction(deal.id, 'org-decisions-read');
    const res = await getJSON(base, '/api/org/decisions', adminToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countByAction(deal.id, 'org-decisions-read'), before + 1, 'exactly one read row must be added');
  } finally {
    server.close();
  }
});

test('org-dd-read-audit (b): an uncleared real-deal GET /api/org/decisions returns 403 and writes exactly one org-decisions-access-denied row', async () => {
  const deal = makeFourIdentityDeal('deal_odrab');
  const pmoItToken = newSession('pmo_it', 'pmo'); bindDeal(pmoItToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const before = countByAction(deal.id, 'org-decisions-access-denied');
    const res = await getJSON(base, '/api/org/decisions', pmoItToken);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(countByAction(deal.id, 'org-decisions-access-denied'), before + 1, 'exactly one denial row must be added');
  } finally {
    server.close();
  }
});

// ============================================================= org/positions ===

test('org-dd-read-audit (c): a cleared real-deal GET /api/org/positions?state=target writes one org-positions-target-read row', async () => {
  const deal = makeFourIdentityDeal('deal_odrac');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const before = countByAction(deal.id, 'org-positions-target-read');
    const res = await getJSON(base, '/api/org/positions?state=target', adminToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countByAction(deal.id, 'org-positions-target-read'), before + 1, 'exactly one target-read row must be added');
  } finally {
    server.close();
  }
});

test('org-dd-read-audit (d): an uncleared real-deal GET /api/org/positions?state=target returns 403 and writes one org-positions-target-access-denied row', async () => {
  const deal = makeFourIdentityDeal('deal_odrad');
  const pmoItToken = newSession('pmo_it', 'pmo'); bindDeal(pmoItToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const before = countByAction(deal.id, 'org-positions-target-access-denied');
    const res = await getJSON(base, '/api/org/positions?state=target', pmoItToken);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(countByAction(deal.id, 'org-positions-target-access-denied'), before + 1, 'exactly one target-denial row must be added');
  } finally {
    server.close();
  }
});

test('org-dd-read-audit (e): GET /api/org/positions (current, open tier) writes ZERO position-read/denied rows', async () => {
  const deal = makeFourIdentityDeal('deal_odrae');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const pmoItToken = newSession('pmo_it', 'pmo'); bindDeal(pmoItToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const before = countByAction(deal.id, 'org-positions-target-read') + countByAction(deal.id, 'org-positions-target-access-denied');
    await getJSON(base, '/api/org/positions', adminToken);
    await getJSON(base, '/api/org/positions', pmoItToken);
    const after = countByAction(deal.id, 'org-positions-target-read') + countByAction(deal.id, 'org-positions-target-access-denied');
    assert.strictEqual(after, before, 'the open-tier current-state read must add zero rows carrying either target-branch action name');
  } finally {
    server.close();
  }
});

// ============================================================= dd/findings (list) ===

test('org-dd-read-audit (f): a real-deal GET /api/dd/findings writes exactly one dd-findings-read row', async () => {
  const deal = makeFourIdentityDeal('deal_odraf');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const before = countByAction(deal.id, 'dd-findings-read');
    const res = await getJSON(base, '/api/dd/findings', adminToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countByAction(deal.id, 'dd-findings-read'), before + 1, 'exactly one dd-findings-read row must be added');
  } finally {
    server.close();
  }
});

// ============================================================= dd/findings/:id ===

test('org-dd-read-audit (g): a cleared real-deal GET /api/dd/findings/:id writes exactly one dd-finding-read row', async () => {
  const deal = makeFourIdentityDeal('deal_odrag');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const finding = await createFinding(base, adminToken, 'legal', 'A read-audit test finding');

    const before = countByAction(deal.id, 'dd-finding-read');
    const res = await getJSON(base, `/api/dd/findings/${finding.id}`, adminToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countByAction(deal.id, 'dd-finding-read'), before + 1, 'exactly one dd-finding-read row must be added');
  } finally {
    server.close();
  }
});

// ============================================================= demo-only gate ===

test('org-dd-read-audit (h): a DEMO request to each of the four routes writes ZERO new rows for the four new action names — the real-deal-only gate', async () => {
  const deal = makeFourIdentityDeal('deal_odrah');
  // Real-deal-bound admin session used ONLY to seed a finding via the API
  // (findings live per-deal, not in demo.db) — the actual probe requests
  // below use the UNBOUND demo sessions.
  const seedAdminToken = newSession('seed_admin', 'admin'); bindDeal(seedAdminToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const finding = await createFinding(base, seedAdminToken, 'legal', 'A demo-probe finding');

    const demoAdminToken = demoSession('admin', 'admin');
    const demoHrbpToken = demoSession('karen', 'hrbp');

    const actions = [
      'org-decisions-read', 'org-decisions-access-denied',
      'org-positions-target-read', 'org-positions-target-access-denied',
      'dd-findings-read', 'dd-finding-read',
    ];
    const before = actions.reduce((sum, a) => sum + countByActionGlobal(a), 0);

    // Every one of these resolves to demo.db (req.isDemo = true) because
    // neither demoAdminToken nor demoHrbpToken was ever bound to a deal.
    await getJSON(base, '/api/org/decisions', demoAdminToken);
    await getJSON(base, '/api/org/decisions', demoHrbpToken);
    await getJSON(base, '/api/org/positions?state=target', demoAdminToken);
    await getJSON(base, '/api/org/positions?state=target', demoHrbpToken);
    await getJSON(base, '/api/dd/findings', demoAdminToken);
    await getJSON(base, `/api/dd/findings/${finding.id}`, demoAdminToken);

    const after = actions.reduce((sum, a) => sum + countByActionGlobal(a), 0);
    assert.strictEqual(after, before, 'a demo-resolved request to any of the four routes must add ZERO rows carrying any of the six new action names');
  } finally {
    server.close();
  }
});

// ================================================================ Source-level ===

test('org-dd-read-audit (i): grep-level guard — each of the four route handlers calls recordSecurityEvent, gated on !req.isDemo', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  // Counts CODE gates (`if (...!req.isDemo...)`) rather than a bare
  // `!req.isDemo` substring — this plan's own comment prose legitimately
  // mentions `(!req.isDemo)` once per route as documentation, which would
  // otherwise inflate a naive substring count by one.
  const countIsDemoGates = (body) => (body.match(/if \([^)]*!req\.isDemo[^)]*\)\s*\{/g) || []).length;

  const decisionsMatch = /app\.get\('\/api\/org\/decisions'[\s\S]*?\n\}\);/.exec(src);
  assert.ok(decisionsMatch, 'expected to locate GET /api/org/decisions');
  assert.strictEqual((decisionsMatch[0].match(/recordSecurityEvent/g) || []).length, 2, 'GET /api/org/decisions must call recordSecurityEvent exactly twice — denial and success');
  assert.strictEqual(countIsDemoGates(decisionsMatch[0]), 2, 'both recordSecurityEvent call sites in GET /api/org/decisions must be gated on !req.isDemo');

  const positionsMatch = /app\.get\('\/api\/org\/positions'[\s\S]*?\n\}\);/.exec(src);
  assert.ok(positionsMatch, 'expected to locate GET /api/org/positions');
  assert.strictEqual((positionsMatch[0].match(/recordSecurityEvent/g) || []).length, 2, 'GET /api/org/positions must call recordSecurityEvent exactly twice — target denial and target success');
  assert.strictEqual(countIsDemoGates(positionsMatch[0]), 2, 'both recordSecurityEvent call sites in GET /api/org/positions must be gated on !req.isDemo');

  const findingsListMatch = /app\.get\('\/api\/dd\/findings',[\s\S]*?\n\}\);/.exec(src);
  assert.ok(findingsListMatch, 'expected to locate GET /api/dd/findings');
  assert.strictEqual((findingsListMatch[0].match(/recordSecurityEvent/g) || []).length, 1, 'GET /api/dd/findings must call recordSecurityEvent exactly once — success only, no denial branch exists');
  assert.ok(findingsListMatch[0].includes('!req.isDemo'), 'the recordSecurityEvent call site in GET /api/dd/findings must be gated on !req.isDemo');

  const findingByIdMatch = /app\.get\('\/api\/dd\/findings\/:id',[\s\S]*?\n\}\);/.exec(src);
  assert.ok(findingByIdMatch, 'expected to locate GET /api/dd/findings/:id');
  assert.strictEqual((findingByIdMatch[0].match(/recordSecurityEvent/g) || []).length, 1, 'GET /api/dd/findings/:id must call recordSecurityEvent exactly once — success only, ddAreaRefused() already owns the denial path');
  assert.ok(findingByIdMatch[0].includes('!req.isDemo'), 'the recordSecurityEvent call site in GET /api/dd/findings/:id must be gated on !req.isDemo');
});
