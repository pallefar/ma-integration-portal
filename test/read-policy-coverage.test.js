// D-11-01 / AUTHZ-01 — the fail-the-build coverage gate over the LIVE GET route
// inventory (VAL-01 precedent): a GET /api route registered without a
// ROLE_READ_POLICY rule fails here, a rule that governs no route fails here, and
// the gate refuses an unlisted path even when no handler exists (fail-closed).
// Isolated temp databases; the committed data/*.db is never opened.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-read-policy-coverage-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const app = require('../server.js');
const { ROLE_READ_POLICY, readRuleFor } = require('../lib/readPolicy');
const { listApiRoutes, concretePath, uncoveredGetRoutes } = require('./helpers/route-inventory');
const { createDealFixture } = require('./helpers/deal-fixture');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// The only /api paths reachable without a session — auth bootstrapping itself.
const PUBLIC_API_PATHS = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/me', '/api/auth/mode']);

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('coverage: every registered GET /api route has a ROLE_READ_POLICY rule', () => {
  const routes = listApiRoutes(app);
  const gets = routes.filter((r) => r.method === 'GET');
  assert.ok(gets.length > 40, `inventory must not be vacuous, got ${gets.length} GET routes`);
  const missing = uncoveredGetRoutes(routes, readRuleFor, PUBLIC_API_PATHS);
  assert.deepStrictEqual(missing, [], `GET routes with no ROLE_READ_POLICY rule: ${JSON.stringify(missing)}`);
});

test('coverage: negative control — a synthetic unlisted GET route is reported as uncovered', () => {
  const routes = [...listApiRoutes(app), { method: 'GET', path: '/api/zz-unlisted-probe' }];
  const missing = uncoveredGetRoutes(routes, readRuleFor, PUBLIC_API_PATHS);
  assert.deepStrictEqual(missing, [{ method: 'GET', path: '/api/zz-unlisted-probe' }]);
});

test('coverage: every ROLE_READ_POLICY rule governs at least one registered GET route (no dead or shadowed rules)', () => {
  const gets = listApiRoutes(app).filter((r) => r.method === 'GET').map((r) => concretePath(r.path));
  for (const rule of ROLE_READ_POLICY) {
    assert.ok(typeof rule.why === 'string' && rule.why.length > 0, `${rule.prefix} needs a why`);
    assert.ok(gets.some((p) => readRuleFor(p) === rule), `rule ${rule.prefix}${rule.exact ? ' (exact)' : ''} governs no registered GET route`);
  }
});

test('coverage: every registered /api route path is lowercase (the canonical form the tables are written in)', () => {
  for (const { method, path: p } of listApiRoutes(app)) {
    const literal = p.replace(/:[a-zA-Z0-9_]+/g, '');
    assert.strictEqual(literal, literal.toLowerCase(), `${method} ${p} must be registered in canonical lowercase`);
  }
});

test('coverage live: a deal-bound pmo GET to an unlisted /api path is refused 403 by the gate (not 404)', async () => {
  const fx = createDealFixture({
    controlConn, runtimeConn, dealId: 'deal_rpcov1',
    members: [{ username: 'rpc-pmo', role: 'pmo' }],
  });
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const r = await fetch(`${base}/api/zz-unlisted-probe`, { headers: { cookie: fx.cookie('rpc-pmo') } });
    const body = await r.json();
    assert.strictEqual(r.status, 403);
    assert.deepStrictEqual(body, { error: 'Your role cannot view this information.' });
    const h = await fetch(`${base}/api/zz-unlisted-probe`, { method: 'HEAD', headers: { cookie: fx.cookie('rpc-pmo') } });
    assert.strictEqual(h.status, 403, 'HEAD is judged as GET');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
